package main

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"sort"
	"strings"
	"time"
)

const openAlexBase = "https://api.openalex.org"

// Fields we request from OpenAlex. Keeping this narrow keeps responses small
// and stays well inside the free daily budget.
var workFields = []string{
	"id", "doi", "title", "publication_year", "publication_date", "type",
	"primary_location", "cited_by_count", "open_access", "is_retracted",
	"primary_topic", "authorships", "abstract_inverted_index",
}

type OpenAlexClient struct {
	http   *http.Client
	apiKey string
	email  string
}

func NewOpenAlexClient(apiKey, email string) *OpenAlexClient {
	return &OpenAlexClient{http: &http.Client{Timeout: 60 * time.Second}, apiKey: apiKey, email: email}
}

// --- Raw OpenAlex shapes (only the parts we use) ---

type oaWork struct {
	ID              string           `json:"id"`
	DOI             *string          `json:"doi"`
	Title           *string          `json:"title"`
	PublicationYear *int             `json:"publication_year"`
	PublicationDate *string          `json:"publication_date"`
	Type            *string          `json:"type"`
	CitedByCount    int              `json:"cited_by_count"`
	IsRetracted     bool             `json:"is_retracted"`
	OpenAccess      struct {
		IsOA  bool    `json:"is_oa"`
		OAURL *string `json:"oa_url"`
	} `json:"open_access"`
	PrimaryLocation *struct {
		Version *string `json:"version"`
		Source  *struct {
			DisplayName *string `json:"display_name"`
			Type        *string `json:"type"`
		} `json:"source"`
	} `json:"primary_location"`
	PrimaryTopic *struct {
		ID          string `json:"id"`
		DisplayName string `json:"display_name"`
		Subfield    struct{ DisplayName string `json:"display_name"` } `json:"subfield"`
		Field       struct{ DisplayName string `json:"display_name"` } `json:"field"`
		Domain      struct{ DisplayName string `json:"display_name"` } `json:"domain"`
	} `json:"primary_topic"`
	Authorships []struct {
		Author struct {
			ID          string  `json:"id"`
			DisplayName string  `json:"display_name"`
			ORCID       *string `json:"orcid"`
		} `json:"author"`
		Institutions []struct {
			DisplayName string `json:"display_name"`
		} `json:"institutions"`
	} `json:"authorships"`
	AbstractInvertedIndex map[string][]int `json:"abstract_inverted_index"`
}

type oaPage struct {
	Meta struct {
		Count      int     `json:"count"`
		NextCursor *string `json:"next_cursor"`
	} `json:"meta"`
	Results []oaWork `json:"results"`
}

// --- Normalised records written to Postgres ---

type Topic struct{ ID, Name, Subfield, Field, Domain string }

type Author struct {
	ID, Name, ORCID, Institution string
	Position                     int
}

type Paper struct {
	ID, DOI, Title, Abstract, PublicationDate, WorkType, Venue, OAURL string
	Year                                                              int
	CitedByCount                                                      int
	IsOA, IsRetracted, IsPreprint                                     bool
	Topic                                                             *Topic
	Authors                                                           []Author
}

// shortID turns "https://openalex.org/W123" into "W123".
func shortID(id string) string {
	if i := strings.LastIndex(id, "/"); i >= 0 {
		return id[i+1:]
	}
	return id
}

func deref(s *string) string {
	if s == nil {
		return ""
	}
	return *s
}

// ReconstructAbstract rebuilds plain text from OpenAlex's inverted index
// ({"word": [positions...]}), which they use for licensing reasons.
func ReconstructAbstract(inv map[string][]int) string {
	if len(inv) == 0 {
		return ""
	}
	type wp struct {
		pos  int
		word string
	}
	var words []wp
	for w, positions := range inv {
		for _, p := range positions {
			words = append(words, wp{p, w})
		}
	}
	sort.Slice(words, func(i, j int) bool { return words[i].pos < words[j].pos })
	out := make([]string, len(words))
	for i, w := range words {
		out[i] = w.word
	}
	return strings.Join(out, " ")
}

const maxAuthorsPerPaper = 25 // giant consortium papers would otherwise bloat a 1 GB database

func normalise(w oaWork) (Paper, bool) {
	title := strings.TrimSpace(deref(w.Title))
	if title == "" {
		return Paper{}, false
	}
	p := Paper{
		ID:              shortID(w.ID),
		DOI:             strings.TrimPrefix(deref(w.DOI), "https://doi.org/"),
		Title:           title,
		Abstract:        ReconstructAbstract(w.AbstractInvertedIndex),
		PublicationDate: deref(w.PublicationDate),
		WorkType:        deref(w.Type),
		CitedByCount:    w.CitedByCount,
		IsOA:            w.OpenAccess.IsOA,
		OAURL:           deref(w.OpenAccess.OAURL),
		IsRetracted:     w.IsRetracted,
	}
	if w.PublicationYear != nil {
		p.Year = *w.PublicationYear
	}
	if loc := w.PrimaryLocation; loc != nil {
		if loc.Source != nil {
			p.Venue = deref(loc.Source.DisplayName)
			if deref(loc.Source.Type) == "repository" {
				p.IsPreprint = true
			}
		}
		if deref(loc.Version) == "submittedVersion" {
			p.IsPreprint = true
		}
	}
	if p.WorkType == "preprint" {
		p.IsPreprint = true
	}
	if t := w.PrimaryTopic; t != nil && t.ID != "" {
		p.Topic = &Topic{
			ID: shortID(t.ID), Name: t.DisplayName,
			Subfield: t.Subfield.DisplayName, Field: t.Field.DisplayName, Domain: t.Domain.DisplayName,
		}
	}
	seen := map[string]bool{}
	for i, a := range w.Authorships {
		if i >= maxAuthorsPerPaper {
			break
		}
		id := shortID(a.Author.ID)
		if id == "" || seen[id] {
			continue
		}
		seen[id] = true
		inst := ""
		if len(a.Institutions) > 0 {
			inst = a.Institutions[0].DisplayName
		}
		p.Authors = append(p.Authors, Author{
			ID: id, Name: a.Author.DisplayName, ORCID: strings.TrimPrefix(deref(a.Author.ORCID), "https://orcid.org/"),
			Institution: inst, Position: i,
		})
	}
	return p, true
}

// FetchWorks pages through /works with cursor pagination and calls onPage for
// each normalised page. Stops after max papers (0 = no limit).
func (c *OpenAlexClient) FetchWorks(ctx context.Context, filter, search string, max int, onPage func([]Paper) error) (int, error) {
	cursor := "*"
	fetched := 0
	for cursor != "" {
		q := url.Values{}
		q.Set("per-page", "200")
		q.Set("cursor", cursor)
		q.Set("select", strings.Join(workFields, ","))
		if filter != "" {
			q.Set("filter", filter)
		}
		if search != "" {
			q.Set("search", search)
		}
		if c.apiKey != "" {
			q.Set("api_key", c.apiKey)
		}
		if c.email != "" {
			q.Set("mailto", c.email)
		}

		page, err := c.getPage(ctx, openAlexBase+"/works?"+q.Encode())
		if err != nil {
			return fetched, err
		}
		if len(page.Results) == 0 {
			break
		}
		batch := make([]Paper, 0, len(page.Results))
		for _, w := range page.Results {
			if p, ok := normalise(w); ok {
				batch = append(batch, p)
			}
		}
		if max > 0 && fetched+len(batch) > max {
			batch = batch[:max-fetched]
		}
		if err := onPage(batch); err != nil {
			return fetched, err
		}
		fetched += len(batch)
		if max > 0 && fetched >= max {
			break
		}
		cursor = deref(page.Meta.NextCursor)
	}
	return fetched, nil
}

// getPage fetches one page with retries and backoff on 429 / 5xx.
func (c *OpenAlexClient) getPage(ctx context.Context, u string) (*oaPage, error) {
	var lastErr error
	for attempt := 0; attempt < 5; attempt++ {
		if attempt > 0 {
			select {
			case <-ctx.Done():
				return nil, ctx.Err()
			case <-time.After(time.Duration(1<<attempt) * time.Second):
			}
		}
		req, _ := http.NewRequestWithContext(ctx, http.MethodGet, u, nil)
		req.Header.Set("User-Agent", "ScholarLens-Harvester/0.1 (+https://github.com/CosmicAlgo/ScholarLens)")
		resp, err := c.http.Do(req)
		if err != nil {
			lastErr = err
			continue
		}
		body, err := io.ReadAll(resp.Body)
		resp.Body.Close()
		if err != nil {
			lastErr = err
			continue
		}
		if resp.StatusCode == http.StatusTooManyRequests || resp.StatusCode >= 500 {
			lastErr = fmt.Errorf("openalex: HTTP %d", resp.StatusCode)
			continue
		}
		if resp.StatusCode != http.StatusOK {
			return nil, fmt.Errorf("openalex: HTTP %d: %s", resp.StatusCode, truncate(string(body), 300))
		}
		var page oaPage
		if err := json.Unmarshal(body, &page); err != nil {
			return nil, fmt.Errorf("openalex: decode: %w", err)
		}
		return &page, nil
	}
	return nil, lastErr
}

func truncate(s string, n int) string {
	if len(s) <= n {
		return s
	}
	return s[:n] + "..."
}
