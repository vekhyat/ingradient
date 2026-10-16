"""Process settings loaded from the environment.

Names use the ``INGRADIENT_`` prefix, so a shell ``LOG_LEVEL`` does not change
this app. No database URL is defined: ``GET /health`` must be able to answer
without one.
"""

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Environment for this process. Defaults are enough to run locally."""

    model_config = SettingsConfigDict(
        env_prefix="INGRADIENT_",
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    env: str = "local"
    log_level: str = "INFO"
