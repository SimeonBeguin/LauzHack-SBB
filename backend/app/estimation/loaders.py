"""Load the provided hackathon data from DATA_DIR (default: ./Daten).

Files (see Daten/*/README*.md for the column meaning):
- extern-liveticker/incident_*.csv        current state of each public incident
- extern-liveticker/incident_audit_*.csv  every earlier version of an incident
- extern-liveticker/message_*.csv         public ticker messages
- extern-liveticker/message_audit_*.csv   earlier versions of messages
- extern-liveticker/reason_*.csv          lookup table of causes (reason_id_fk)
- intern-liveticker/*.csv                 internal KULT ticker (cases, categories, messages, logs)
- Ereignismeldungen/Ereignismeldungen Via.xlsx  VIA event reports
"""

from pathlib import Path

import pandas as pd

from app.config import settings


def _find(pattern: str, data_dir: Path | None = None) -> Path:
    data_dir = data_dir or settings.data_dir
    matches = sorted(data_dir.glob(pattern))
    if not matches:
        raise FileNotFoundError(f"No file matching {pattern!r} in {data_dir}")
    return matches[-1]


def load_incidents() -> pd.DataFrame:
    """Current state of each public liveticker incident."""
    # TODO: parse date columns, keep only useful columns
    return pd.read_csv(_find("extern-liveticker/incident_2*.csv"))


def load_incident_audit() -> pd.DataFrame:
    """Every version of each incident. Key input for learning real durations."""
    # TODO
    return pd.read_csv(_find("extern-liveticker/incident_audit_*.csv"))


def load_reasons() -> pd.DataFrame:
    # TODO
    return pd.read_csv(_find("extern-liveticker/reason_*.csv"))


def load_messages() -> pd.DataFrame:
    # TODO
    raise NotImplementedError


def load_intern_ticker() -> dict[str, pd.DataFrame]:
    """Internal KULT ticker tables, keyed by short name."""
    # TODO
    raise NotImplementedError


def load_via_reports() -> pd.DataFrame:
    # TODO: pd.read_excel(_find("Ereignismeldungen/*.xlsx"))
    raise NotImplementedError
