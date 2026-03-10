# Commercial Action Plan for ScholarLens

To transition **ScholarLens** from a university portfolio project into an income-generating tool (SaaS or specialized API), follow this structured phase approach:

## Phase 1: MVP Polish & Portfolio Readiness (Next 2 Weeks)
*Target: Look flawless for UK recruiters while preparing for the market.*
- [ ] **Clean the UI**: Make the Streamlit dashboard look highly professional. Use custom CSS rather than default styling.
- [ ] **Add a Demo Dataset**: Bundle the repository with a pre-indexed dataset of ~500 papers so anyone who clones it can instantly test it without waiting for API downloads.
- [ ] **Screen Recording**: Record a 60-second Loom video demonstrating the app finding an obscure research trend. Put this GIF/video at the very top of `README.md`.

## Phase 2: Building the "Freemium" Web Version (Month 1-2)
*Target: Get actual researchers using a hosted version to prove demand.*
- [ ] **Deploy to the Cloud**: Host the Streamlit app on Streamlit Community Cloud (free) or a cheap DigitalOcean droplet ($5/mo). 
- [ ] **Host a Central DB**: Move from SQLite to PostgreSQL (hosted on Supabase or Neon for free). This avoids the "shipping zips" problem.
- [ ] **Lock Premium Features**: Keep basic keyword search free. Put the "Semantic Timeline Evolution" and "Export to CSV/PDF" features behind a Paywall (Stripe integration).

## Phase 3: The API & Enterprise Pivot (Month 3+)
*Target: B2B sales. Companies will pay much more for API access than students will for a UI.*
- [ ] **Build a FastAPI Wrapper**: Create a REST API around your `search_papers` and `analyze_years` functions.
- [ ] **API Key Management**: Use a service like Unkey.dev to generate API keys.
- [ ] **Sell to Niche Industries**: Target hedge funds (analyzing financial research trends), bio-tech startups (tracking medical paper trends), or patent lawyers. Sell API access for $50-$200/month.

## Phase 4: Long-Term Tech Debt to Fix
- [ ] Switch from `scikit-learn NearestNeighbors` to a proper vector database (like **Qdrant** or **Pinecone**). `scikit-learn` does not scale past ~100k papers in memory.
- [ ] Build up a massive, continuously updated central database of papers to be your "moat".
