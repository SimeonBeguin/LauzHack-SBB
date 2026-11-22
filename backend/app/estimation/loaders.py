"""Load and clean the provided hackathon data from DATA_DIR (default: ./Daten).

Every loader returns a pandas DataFrame with proper dtypes:
- ids are strings (VIA ids are 13 digits, they must never become floats),
- every timestamp is tz-aware in Europe/Zurich,
- booleans are real booleans.

Files (see Daten/*/README*.md for the column meaning):
- extern-liveticker/incident_*.csv        current state of each public incident
- extern-liveticker/incident_audit_*.csv  every earlier version of an incident
- extern-liveticker/message_*.csv         public ticker messages
- extern-liveticker/message_audit_*.csv   earlier versions of messages
- extern-liveticker/reason_*.csv          lookup table of causes (reason_id_fk)
- intern-liveticker/*.csv                 internal KULT ticker (cases, categories, messages, logs)
- Ereignismeldungen/Ereignismeldungen Via.xlsx  VIA event reports

Data pitfalls handled here:
- Text fields contain line breaks and emoji: we always use the real CSV parser.
- Public timestamps mix +0100 / +0200 (winter / summer time): parsed as UTC,
  then converted to Europe/Zurich.
- KULT and VIA timestamps have no offset: they are Swiss local time and get
  localised to Europe/Zurich (DST gaps / overlaps become NaT or are shifted).
- KULT files start with a UTF-8 BOM and export ids as floats ("361720.0").
- `duration_at_least` looks shifted by 2 h in checked examples: kept as raw
  text only, use `duration_to` for the announced end.

Loaders are cached (the API calls them on every request). They return a copy,
so callers may modify the result freely.

Usage in a notebook (from the backend/ folder, or with backend/ on sys.path):
    from app.estimation import loaders
    history = loaders.load_incident_versions()
"""

from __future__ import annotations

from functools import lru_cache
from pathlib import Path

import pandas as pd

from app.config import settings

TZ = "Europe/Zurich"

LANGS = ("de", "fr", "it", "en")

# Timestamp columns of the public liveticker tables (they carry a UTC offset).
_INCIDENT_DATE_COLS = [
    "duration_from",
    "duration_to",
    "created_date",
    "last_modified_date",
    "created_at_source",
    "updated_at_source",
]
_MESSAGE_DATE_COLS = ["created_date", "last_modified_date"]

# Timestamp columns of the VIA xlsx (Swiss local time, no offset).
_VIA_DATE_COLS = [
    "modified",
    "logging_date_time",
    "alea_erstellungszeitpunkt",
    "alea_zeitpunkt_eroeffnung_zugliste",
    "zeitpunkt_inbearbeitungnahme",
    "zeitpunkt_erstpublikation",
    "zeitpunkt_globale_endmeldung",
    "zeitpunkt_weitere_informationen_geaendert",
    "zeitpunkt_erstpublikation_reiseempfehlung",
    "zeitpunkt_erstpublikation_bahnersatz",
]


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _find(pattern: str, data_dir: Path | None = None) -> Path:
    data_dir = Path(data_dir) if data_dir else settings.data_dir
    matches = sorted(data_dir.glob(pattern))
    if not matches:
        raise FileNotFoundError(f"No file matching {pattern!r} in {data_dir}")
    return matches[-1]  # most recent export if there are several


def _read_csv(path: Path) -> pd.DataFrame:
    """Read everything as text first, then convert column by column.

    `utf-8-sig` strips the BOM of the KULT files and is harmless otherwise.
    """
    return pd.read_csv(path, dtype=str, keep_default_na=True, encoding="utf-8-sig")


def _to_zurich(series: pd.Series) -> pd.Series:
    """Timestamps with an offset (+0100 / +0200) -> tz-aware Europe/Zurich."""
    return pd.to_datetime(series, utc=True, errors="coerce").dt.tz_convert(TZ)


def _localize_zurich(series: pd.Series) -> pd.Series:
    """Naive Swiss local timestamps -> tz-aware Europe/Zurich."""
    s = pd.to_datetime(series, errors="coerce")
    return s.dt.tz_localize(TZ, ambiguous="NaT", nonexistent="shift_forward")


def _to_bool(series: pd.Series) -> pd.Series:
    mapping = {"true": True, "false": False, "t": True, "f": False, "1": True, "0": False}
    return series.str.strip().str.lower().map(mapping).astype("boolean")


def _float_id_to_str(series: pd.Series) -> pd.Series:
    """'361720.0' -> '361720' (KULT exports integer ids as floats)."""
    return pd.to_numeric(series, errors="coerce").astype("Int64").astype("string")


def _clean_incident_table(df: pd.DataFrame) -> pd.DataFrame:
    df = df.copy()
    for col in _INCIDENT_DATE_COLS:
        df[col] = _to_zurich(df[col])
    df["version"] = pd.to_numeric(df["version"], errors="coerce").astype("Int64")
    df["author_id_fk"] = df["author_id_fk"].astype("string")
    for col in ("id", "reason_id_fk", "duration_type", "lifecycle", "origin_language"):
        df[col] = df[col].astype("string").str.strip()
    return df


def _clean_message_table(df: pd.DataFrame) -> pd.DataFrame:
    df = df.copy()
    for col in _MESSAGE_DATE_COLS:
        df[col] = _to_zurich(df[col])
    for lang in LANGS:
        df[f"{lang}_translated"] = _to_bool(df[f"{lang}_translated"])
    for col in ("id", "incident_id_fk", "author_id_fk", "status"):
        df[col] = df[col].astype("string").str.strip()
    return df


# ---------------------------------------------------------------------------
# Public liveticker (extern)
# ---------------------------------------------------------------------------

@lru_cache(maxsize=None)
def _load_incidents(data_dir: Path | None) -> pd.DataFrame:
    df = _read_csv(_find("extern-liveticker/incident_2*.csv", data_dir))
    return _clean_incident_table(df)


def load_incidents(data_dir: Path | None = None) -> pd.DataFrame:
    """Current (= final) state of each public liveticker incident. One row per id."""
    return _load_incidents(data_dir).copy()


@lru_cache(maxsize=None)
def _load_incident_audit(data_dir: Path | None) -> pd.DataFrame:
    df = _read_csv(_find("extern-liveticker/incident_audit_*.csv", data_dir))
    return _clean_incident_table(df)


@lru_cache(maxsize=None)
def _load_incident_versions(data_dir: Path | None) -> pd.DataFrame:
    audit = _load_incident_audit(data_dir).assign(is_current=False)
    current = _load_incidents(data_dir).assign(is_current=True)
    versions = pd.concat([audit, current], ignore_index=True)
    # (id, last_modified_date) is unique according to the README; keep the
    # current row if the same version appears in both tables.
    versions = (
        versions.sort_values(["id", "last_modified_date", "is_current"])
        .drop_duplicates(["id", "last_modified_date"], keep="last")
        .reset_index(drop=True)
    )
    versions["version_rank"] = versions.groupby("id").cumcount()
    return versions


def load_incident_versions(data_dir: Path | None = None) -> pd.DataFrame:
    """Full history of every incident: audit rows + current row, in time order.

    Sorted by (id, last_modified_date). Extra columns:
    - is_current:   True for the row coming from `incident` (final state)
    - version_rank: 0 for the first known version, 1, 2, ... afterwards
    Incidents deleted by the nightly job only exist in the audit (no current row).
    This is the main input of features.build_incident_history().
    """
    return _load_incident_versions(data_dir).copy()


@lru_cache(maxsize=None)
def _load_reasons(data_dir: Path | None) -> pd.DataFrame:
    df = _read_csv(_find("extern-liveticker/reason_*.csv", data_dir))
    df["id"] = df["id"].str.strip()
    return df.set_index("id", drop=False).sort_index()


def load_reasons(data_dir: Path | None = None) -> pd.DataFrame:
    """Cause lookup (EG_xxx -> label in de/fr/it/en). Indexed by id."""
    return _load_reasons(data_dir).copy()


@lru_cache(maxsize=None)
def _load_messages(data_dir: Path | None) -> pd.DataFrame:
    df = _read_csv(_find("extern-liveticker/message_2*.csv", data_dir))
    return _clean_message_table(df)


def load_messages(data_dir: Path | None = None) -> pd.DataFrame:
    """Public messages written by the TCC (current state). Join on incident_id_fk."""
    return _load_messages(data_dir).copy()


@lru_cache(maxsize=None)
def _load_message_audit(data_dir: Path | None) -> pd.DataFrame:
    df = _read_csv(_find("extern-liveticker/message_audit_*.csv", data_dir))
    return _clean_message_table(df)


def load_message_audit(data_dir: Path | None = None) -> pd.DataFrame:
    """Earlier versions of public messages."""
    return _load_message_audit(data_dir).copy()


# ---------------------------------------------------------------------------
# Internal KULT ticker (intern) - September 2026 only
# ---------------------------------------------------------------------------

@lru_cache(maxsize=None)
def _load_intern_ticker(data_dir: Path | None) -> dict[str, pd.DataFrame]:
    # Categories: id -> EG_xxx code (same codes as the public `reason` table,
    # plus EK_IT_STOERUNG and EK_VERMISSTMELDUNG).
    categories = _read_csv(_find("intern-liveticker/2__Ereigniskategorien*.csv", data_dir))
    categories["id"] = categories["id"].str.strip()

    # Cases
    cases = _read_csv(_find("intern-liveticker/1__Ereignisfaelle*.csv", data_dir))
    cases["created_at"] = _localize_zurich(cases["created_at"])
    cases["datum"] = _localize_zurich(cases["datum"])
    cases["active"] = _to_bool(cases["active"])
    cases["archived"] = _to_bool(cases["archived"])
    cases["ereigniskategorie_id"] = cases["ereigniskategorie_id"].str.strip()
    cases = cases.merge(
        categories[["id", "name"]].rename(
            columns={"id": "ereigniskategorie_id", "name": "category_code"}
        ),
        on="ereigniskategorie_id",
        how="left",
    )

    # Messages (one fully empty line; personal columns always empty)
    messages = _read_csv(_find("intern-liveticker/3_liveticker_messages*.csv", data_dir))
    messages = messages.dropna(subset=["id", "ereignisfall_id"])
    messages["id"] = _float_id_to_str(messages["id"])
    messages["ereignisfall_id"] = _float_id_to_str(messages["ereignisfall_id"])
    messages["timestamp"] = _localize_zurich(messages["timestamp"])
    messages = messages.drop(columns=["name", "vorname", "telefonnummer"], errors="ignore")

    # Logs (Spalte1 / Spalte2 are empty export artefacts; `data` is a Java
    # toString() dump, to parse later with regexes if needed)
    logs = _read_csv(_find("intern-liveticker/4__Logs*.csv", data_dir))
    logs = logs.drop(columns=["Spalte1", "Spalte2"], errors="ignore")
    logs["created_at"] = _localize_zurich(logs["created_at"])
    logs["ereignisfall_id"] = _float_id_to_str(logs["ereignisfall_id"])

    return {
        "cases": cases.sort_values("created_at").reset_index(drop=True),
        "categories": categories,
        "messages": messages.sort_values(["ereignisfall_id", "timestamp"]).reset_index(drop=True),
        "logs": logs.sort_values(["ereignisfall_id", "created_at"]).reset_index(drop=True),
    }


def load_intern_ticker(data_dir: Path | None = None) -> dict[str, pd.DataFrame]:
    """Internal KULT ticker tables, keyed by short name.

    Keys: "cases", "categories", "messages", "logs".
    No common id with VIA / public ticker: match by time + place + cause.
    """
    return {name: df.copy() for name, df in _load_intern_ticker(data_dir).items()}


# ---------------------------------------------------------------------------
# VIA event reports (xlsx) - September 2026 only
# ---------------------------------------------------------------------------

@lru_cache(maxsize=None)
def _load_via_reports(data_dir: Path | None) -> pd.DataFrame:
    path = _find("Ereignismeldungen/*.xlsx", data_dir)
    df = pd.read_excel(path, sheet_name=0)  # sheet 2 ("Schema") = column docs
    for col in _VIA_DATE_COLS:
        if col in df.columns:
            df[col] = _localize_zurich(df[col])
    # alea_fall_id == incident.id of the public ticker: same string type.
    df["alea_fall_id"] = _float_id_to_str(df["alea_fall_id"])
    # Service point codes (85xxxxx) -> strings, NaN stays <NA>.
    for col in ("stoerungs_ort1", "stoerungs_ort2", "stoerungs_linie_von", "stoerungs_linie_bis"):
        if col in df.columns:
            df[col] = _float_id_to_str(df[col])
    df["ereignisgrund"] = df["ereignisgrund"].astype("string").str.strip()
    df["stoerungs_liniennummer"] = df["stoerungs_liniennummer"].astype("string")
    return df.sort_values(["alea_fall_id", "modified"]).reset_index(drop=True)


def load_via_reports(data_dir: Path | None = None) -> pd.DataFrame:
    """VIA publication log: one row per (re)publication of an event.

    `alea_fall_id` joins with the public `incident.id`.
    Split `stoerungs_liniennummer` with `.str.split(r",\\s*")` to get line names.
    """
    return _load_via_reports(data_dir).copy()
