package main

import (
	"encoding/json"
	"testing"
)

func TestReconstructAbstract(t *testing.T) {
	inv := map[string][]int{"world": {1}, "hello": {0, 2}}
	if got := ReconstructAbstract(inv); got != "hello world hello" {
		t.Fatalf("got %q", got)
	}
	if ReconstructAbstract(nil) != "" {
		t.Fatal("nil index should give empty abstract")
	}
}

const sampleWork = `{
  "id": "https://openalex.org/W123",
  "doi": "https://doi.org/10.1/abc",
  "title": "Attention Is All You Need",
  "publication_year": 2017,
  "publication_date": "2017-06-12",
  "type": "article",
  "cited_by_count": 100000,
  "is_retracted": false,
  "open_access": {"is_oa": true, "oa_url": "https://arxiv.org/pdf/1706.03762"},
  "primary_location": {"version": "submittedVersion", "source": {"display_name": "arXiv", "type": "repository"}},
  "primary_topic": {"id": "https://openalex.org/T10181", "display_name": "NLP",
    "subfield": {"display_name": "AI"}, "field": {"display_name": "CS"}, "domain": {"display_name": "Physical Sciences"}},
  "authorships": [
    {"author": {"id": "https://openalex.org/A1", "display_name": "Ashish Vaswani", "orcid": null}, "institutions": [{"display_name": "Google"}]},
    {"author": {"id": "https://openalex.org/A1", "display_name": "Duplicate", "orcid": null}, "institutions": []}
  ],
  "abstract_inverted_index": {"The": [0], "dominant": [1]}
}`

func TestNormalise(t *testing.T) {
	var w oaWork
	if err := json.Unmarshal([]byte(sampleWork), &w); err != nil {
		t.Fatal(err)
	}
	p, ok := normalise(w)
	if !ok {
		t.Fatal("expected paper")
	}
	if p.ID != "W123" || p.DOI != "10.1/abc" || p.Year != 2017 {
		t.Fatalf("bad ids/year: %+v", p)
	}
	if !p.IsPreprint {
		t.Fatal("arXiv repository copy should be flagged as preprint")
	}
	if p.Topic == nil || p.Topic.ID != "T10181" {
		t.Fatalf("bad topic: %+v", p.Topic)
	}
	if len(p.Authors) != 1 || p.Authors[0].Institution != "Google" {
		t.Fatalf("duplicate authors should be dropped: %+v", p.Authors)
	}
	if p.Abstract != "The dominant" {
		t.Fatalf("abstract: %q", p.Abstract)
	}
}

func TestNormaliseSkipsUntitled(t *testing.T) {
	if _, ok := normalise(oaWork{ID: "https://openalex.org/W9"}); ok {
		t.Fatal("untitled works should be skipped")
	}
}
