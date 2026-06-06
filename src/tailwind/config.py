"""Application configuration loaded from environment variables."""

from __future__ import annotations

from functools import lru_cache
from typing import Literal, Self

from pydantic import Field, SecretStr, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

DEFAULT_SECRET_KEY = "replace-me"  # noqa: S105

WarehouseType = Literal["stub", "snowflake", "bigquery", "postgres"]
Environment = Literal["dev", "staging", "prod", "test"]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        env_prefix="TAILWIND_",
        case_sensitive=False,
        extra="ignore",
    )

    env: Environment = "dev"
    debug: bool = False
    log_level: str = "INFO"
    host: str = "0.0.0.0"
    port: int = 8050
    secret_key: SecretStr = SecretStr(DEFAULT_SECRET_KEY)

    warehouse_type: WarehouseType = "stub"
    warehouse_dsn: SecretStr | None = None

    ai_enabled: bool = True
    ai_model: str = "claude-opus-4-7"
    anthropic_api_key: SecretStr | None = Field(default=None, alias="ANTHROPIC_API_KEY")

    github_token: SecretStr | None = None
    github_repo: str | None = None

    @model_validator(mode="after")
    def _require_strong_secret_in_prod(self) -> Self:
        if self.env not in ("staging", "prod"):
            return self
        if self.secret_key.get_secret_value() == DEFAULT_SECRET_KEY:
            raise ValueError(
                f"TAILWIND_SECRET_KEY must be set to a non-default value when env={self.env!r}"
            )
        return self


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
