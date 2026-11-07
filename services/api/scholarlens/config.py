from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=(".env", "../../.env"), extra="ignore")

    database_url: str = "postgresql://scholarlens:scholarlens@localhost:5433/scholarlens"

    openalex_api_key: str = ""
    openalex_email: str = ""
    openalex_cache_ttl_hours: int = 24 * 7

    embedding_model: str = "BAAI/bge-small-en-v1.5"  # 384-dim, ONNX via fastembed; fits a 512 MB dyno
    embedding_cache_dir: str = ""  # set in the Docker image so the model is baked in, not downloaded at boot

    # LLM provider: "auto" picks Gemini if GEMINI_API_KEY is set, else Anthropic, else AI reports are off.
    llm_provider: str = "auto"
    # Thinking effort per tier ("low"/"medium"/"high"); "fast" runs the narrow agents
    # (planner, scout, analyst, cartographer), "strong" writes the final report.
    llm_fast_effort: str = "low"
    llm_strong_effort: str = "medium"

    # Gemini (Google AI Studio free tier). Two models = two separate free quotas.
    gemini_api_key: str = ""
    gemini_fast_model: str = "gemini-3.5-flash-lite"
    # 3.6-flash, not 3.8-flash: on the free tier 3.8 queued ~150 s before answering (2026-11 benchmark).
    gemini_strong_model: str = "gemini-3.6-flash"

    # Anthropic (paid). Set ANTHROPIC_FAST_MODEL=claude-haiku-5-5 for a much lower bill.
    anthropic_api_key: str = ""
    anthropic_fast_model: str = "claude-opus-5-5"
    anthropic_strong_model: str = "claude-opus-5-5"

    # Cost guardrails
    agent_runs_per_client_per_day: int = 5
    agent_runs_global_per_day: int = 100  # keep under the free-tier daily request quota
    # Copilot messages are lighter (2 LLM calls each) and frequent; separate budget.
    copilot_per_client_per_day: int = 40
    copilot_global_per_day: int = 600

    cors_origins: list[str] = ["http://localhost:3000"]


@lru_cache
def get_settings() -> Settings:
    return Settings()
