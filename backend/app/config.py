"""App settings, read from environment variables or a .env file at the repo root."""

from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

REPO_ROOT = Path(__file__).resolve().parents[2]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=REPO_ROOT / ".env", extra="ignore")

    ojp_api_key: str = ""
    ojp_endpoint: str = "https://api.opentransportdata.swiss/ojp20"
    tomtom_api_key: str = ""
    here_api_key: str = ""
    data_dir: Path = REPO_ROOT / "Daten"


settings = Settings()
