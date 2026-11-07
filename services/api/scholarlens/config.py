from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=(".env", "../../.env"), extra="ignore")

    database_url: str = "postgresql://scholarlens:scholarlens@localhost:5433/scholarlens"

    openalex_api_key: str = ""
    openalex_email: str = ""
    openalex_cache_ttl_hours: int = 24 * 7

    embedding_model: str = "BAAI/bge-small-en-v1.5"  # 384-dim, ONNX via fastembed; fits a 512 MB dyno

    # LLM tiers. "fast" runs the narrow agents (planner, scout, analyst, cartographer) at low effort;
    # "strong" writes the final report. Both default to Opus 5.5; set LLM_FAST_MODEL=claude-haiku-5-5
    # to trade some quality for a much lower bill.
    anthropic_api_key: str = ""
    llm_fast_model: str = "claude-opus-5-5"
    llm_fast_effort: str = "low"
    llm_strong_model: str = "claude-opus-5-5"
    llm_strong_effort: str = "medium"

    # Cost guardrails
    agent_runs_per_client_per_day: int = 5
    agent_runs_global_per_day: int = 300

    cors_origins: list[str] = ["http://localhost:3000"]


@lru_cache
def get_settings() -> Settings:
    return Settings()
