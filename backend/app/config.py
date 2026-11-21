"""App settings, read from environment variables or a .env file at the repo root."""

from pathlib import Path

from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

REPO_ROOT = Path(__file__).resolve().parents[2]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=REPO_ROOT / ".env", extra="ignore")

    ojp_api_key: str = ""
    ojp_endpoint: str = "https://api.opentransportdata.swiss/ojp20"
    tomtom_api_key: str = ""
    here_api_key: str = ""
    data_dir: Path = REPO_ROOT / "Daten"

    # Routing (workstream B)
    ojp_mode: str = "live"  # live | record | replay | auto (see app/routing/ojp_client.py)
    ojp_recordings_dir: Path = REPO_ROOT / "backend" / "data" / "ojp_recordings"
    cache_dir: Path = REPO_ROOT / "backend" / "data" / "cache"  # downloaded static data, git-ignored

    @field_validator("data_dir", "ojp_recordings_dir", "cache_dir")
    @classmethod
    def _relative_to_repo(cls, p: Path) -> Path:
        # Relative paths in .env (e.g. DATA_DIR=./Daten) are relative to the repo
        # root, not to the directory uvicorn / pytest is started from.
        return p if p.is_absolute() else REPO_ROOT / p


settings = Settings()
