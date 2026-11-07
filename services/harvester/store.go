package main

import (
	"context"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type Store struct{ pool *pgxpool.Pool }

func NewStore(ctx context.Context, dsn string) (*Store, error) {
	pool, err := pgxpool.New(ctx, dsn)
	if err != nil {
		return nil, err
	}
	if err := pool.Ping(ctx); err != nil {
		return nil, fmt.Errorf("db ping: %w", err)
	}
	return &Store{pool: pool}, nil
}

func (s *Store) Close() { s.pool.Close() }

func nullIfEmpty(v string) any {
	if v == "" {
		return nil
	}
	return v
}

func nullDate(v string) any {
	if v == "" {
		return nil
	}
	if t, err := time.Parse("2006-01-02", v); err == nil {
		return t
	}
	return nil
}

func nullYear(y int) any {
	if y <= 0 {
		return nil
	}
	return y
}

// UpsertPapers writes one page of papers (with topics and authors) in a single
// transaction. Existing papers are refreshed; their embeddings are kept unless
// the title or abstract changed.
func (s *Store) UpsertPapers(ctx context.Context, papers []Paper) error {
	if len(papers) == 0 {
		return nil
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)

	b := &pgx.Batch{}
	for _, p := range papers {
		var topicID any
		if t := p.Topic; t != nil {
			topicID = t.ID
			b.Queue(`INSERT INTO topics (id, name, subfield, field, domain) VALUES ($1,$2,$3,$4,$5)
			         ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name, subfield=EXCLUDED.subfield,
			           field=EXCLUDED.field, domain=EXCLUDED.domain`,
				t.ID, t.Name, nullIfEmpty(t.Subfield), nullIfEmpty(t.Field), nullIfEmpty(t.Domain))
		}
		b.Queue(`INSERT INTO papers (id, doi, title, abstract, year, publication_date, work_type, venue,
		           cited_by_count, is_oa, oa_url, is_retracted, is_preprint, primary_topic_id, updated_at)
		         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14, now())
		         ON CONFLICT (id) DO UPDATE SET
		           doi=EXCLUDED.doi, title=EXCLUDED.title, abstract=EXCLUDED.abstract, year=EXCLUDED.year,
		           publication_date=EXCLUDED.publication_date, work_type=EXCLUDED.work_type, venue=EXCLUDED.venue,
		           cited_by_count=EXCLUDED.cited_by_count, is_oa=EXCLUDED.is_oa, oa_url=EXCLUDED.oa_url,
		           is_retracted=EXCLUDED.is_retracted, is_preprint=EXCLUDED.is_preprint,
		           primary_topic_id=EXCLUDED.primary_topic_id, updated_at=now(),
		           embedding = CASE WHEN papers.title IS DISTINCT FROM EXCLUDED.title
		                              OR papers.abstract IS DISTINCT FROM EXCLUDED.abstract
		                            THEN NULL ELSE papers.embedding END`,
			p.ID, nullIfEmpty(p.DOI), p.Title, nullIfEmpty(p.Abstract), nullYear(p.Year), nullDate(p.PublicationDate),
			nullIfEmpty(p.WorkType), nullIfEmpty(p.Venue), p.CitedByCount, p.IsOA, nullIfEmpty(p.OAURL),
			p.IsRetracted, p.IsPreprint, topicID)
		for _, a := range p.Authors {
			b.Queue(`INSERT INTO authors (id, name, orcid) VALUES ($1,$2,$3)
			         ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name, orcid=COALESCE(EXCLUDED.orcid, authors.orcid)`,
				a.ID, a.Name, nullIfEmpty(a.ORCID))
			b.Queue(`INSERT INTO paper_authors (paper_id, author_id, position, institution) VALUES ($1,$2,$3,$4)
			         ON CONFLICT (paper_id, author_id) DO UPDATE SET position=EXCLUDED.position, institution=EXCLUDED.institution`,
				p.ID, a.ID, a.Position, nullIfEmpty(a.Institution))
		}
	}
	if err := tx.SendBatch(ctx, b).Close(); err != nil {
		return fmt.Errorf("upsert batch: %w", err)
	}
	return tx.Commit(ctx)
}

func (s *Store) StartRun(ctx context.Context, source, filter string) (int64, error) {
	var id int64
	err := s.pool.QueryRow(ctx, `INSERT INTO harvest_runs (source, filter) VALUES ($1,$2) RETURNING id`, source, filter).Scan(&id)
	return id, err
}

func (s *Store) FinishRun(ctx context.Context, id int64, fetched int, runErr error) {
	var msg any
	if runErr != nil {
		msg = runErr.Error()
	}
	_, _ = s.pool.Exec(ctx, `UPDATE harvest_runs SET fetched=$2, upserted=$2, finished_at=now(), error=$3 WHERE id=$1`, id, fetched, msg)
}
