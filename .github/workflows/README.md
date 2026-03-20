# GitHub Actions Workflows

This directory contains the CI/CD pipelines for ScholarLens.

## CI Pipeline (`ci.yml`)

The main CI pipeline handles:
1. **Linting**: Using `ruff` for code quality.
2. **Testing**: Running `pytest` across multiple Python versions (3.10, 3.11, 3.12).
3. **Security**: Dependency scanning with `pip-audit`.

### Bypassed Vulnerabilities

The following `nltk` vulnerabilities are explicitly ignored in the `pip-audit` stage because they pertain to components not used by ScholarLens (specifically the NLTK WordNet Browser):

- **GHSA-rf74-v2fm-23pw**: RecursionError in `JSONTaggedDecoder`. Not used.
- **CVE-2026-33230**: Reflected XSS in `wordnet_app`. Not used.
- **CVE-2026-33231**: Unauthenticated shutdown in `wordnet_app`. Not used.

These bypasses should be re-evaluated if a non-vulnerable version of `nltk` (likely `3.9.4+`) is released.
