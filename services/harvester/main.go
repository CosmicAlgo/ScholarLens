// Command harvester pulls works from OpenAlex into the ScholarLens Postgres database.
//
//	harvester -filter "primary_topic.id:T10181,from_publication_date:2018-01-01" -max 5000
//	harvester -search "retrieval augmented generation" -max 2000
//
// Env: DATABASE_URL (required), OPENALEX_API_KEY, OPENALEX_EMAIL.
package main

import (
	"context"
	"flag"
	"log"
	"os"
	"os/signal"
	"time"
)

func main() {
	filter := flag.String("filter", "", "OpenAlex filter expression")
	search := flag.String("search", "", "OpenAlex full-text search query")
	max := flag.Int("max", 2000, "maximum papers to fetch (0 = no limit)")
	flag.Parse()

	if *filter == "" && *search == "" {
		log.Fatal("provide -filter and/or -search")
	}
	dsn := os.Getenv("DATABASE_URL")
	if dsn == "" {
		log.Fatal("DATABASE_URL is not set")
	}

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt)
	defer stop()

	store, err := NewStore(ctx, dsn)
	if err != nil {
		log.Fatalf("connect: %v", err)
	}
	defer store.Close()

	client := NewOpenAlexClient(os.Getenv("OPENALEX_API_KEY"), os.Getenv("OPENALEX_EMAIL"))
	desc := *filter
	if *search != "" {
		desc += " search=" + *search
	}
	runID, err := store.StartRun(ctx, "openalex", desc)
	if err != nil {
		log.Fatalf("start run: %v", err)
	}

	start := time.Now()
	total, err := client.FetchWorks(ctx, *filter, *search, *max, func(batch []Paper) error {
		if err := store.UpsertPapers(ctx, batch); err != nil {
			return err
		}
		log.Printf("upserted %d papers", len(batch))
		return nil
	})
	store.FinishRun(context.Background(), runID, total, err)
	if err != nil {
		log.Fatalf("harvest failed after %d papers: %v", total, err)
	}
	log.Printf("done: %d papers in %s", total, time.Since(start).Round(time.Second))
}
