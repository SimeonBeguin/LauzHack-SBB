"""Match a public incident with the internal KULT ticker and extract the details.

KULT (internal SBB ticker for staff) has no common id with VIA / the public
liveticker, and only covers September 2026. We match on:
- time:  KULT case created within +-3 h of the public incident start,
- place: station names of the KULT case found in the public title/description,
- cause: same EG_xxx code (or same cause group).

From the matched case we extract, for the "More details" screen:
- the operating concept, the replacement buses, the cancelled / turned-back
  trains, travel recommendations and ticket goodwill (Infoboard modules,
  parsed from the Java toString() dumps in the KULT logs),
- the internal ticker messages,
- how much earlier staff knew than the public (information dosing pitch).
"""

from __future__ import annotations

import html
import re
import unicodedata
from functools import lru_cache

import pandas as pd

from app.estimation import features, loaders
from app.models import IncidentDetails, InternalMessage

MAX_TIME_GAP_MIN = 180
MIN_SCORE = 0.55

# --- Java toString() parsing -------------------------------------------------

_FIELDS = {
    "InfoboardModule": ["id", "ereignisfall", "active", "sender", "titel", "linie", "text",
                        "textVia", "timestamp", "index", "betriebspunkt"],
    "Ereignisfall": ["id", "datum", "zugNrStrecke", "beschreibung", "ereigniskategorie", "concept"],
}


def parse_java_dump(data: str, entity: str | None = None) -> dict[str, str]:
    """'Cls{a=1, b='x, y', c=}' -> {'a': '1', 'b': 'x, y', 'c': ''}.

    Only known field names (per entity) are treated as separators, so commas
    and quotes inside HTML texts do not break the parsing.
    """
    if not isinstance(data, str) or "{" not in data:
        return {}
    body = data[data.index("{") + 1:]
    body = body[:-1] if body.endswith("}") else body
    names = _FIELDS.get(entity or data.split("{", 1)[0]) or None
    pattern = r"(?:^|, )(%s)=" % ("|".join(map(re.escape, names)) if names else r"[A-Za-z_]+")
    matches = list(re.finditer(pattern, body))
    out: dict[str, str] = {}
    for i, m in enumerate(matches):
        end = matches[i + 1].start() if i + 1 < len(matches) else len(body)
        value = body[m.end():end].strip()
        if len(value) >= 2 and value[0] == value[-1] == "'":
            value = value[1:-1]
        out[m.group(1)] = "" if value == "null" else value
    return out


def html_to_lines(text: str | None) -> list[str]:
    """HTML from KULT -> clean text lines (no tags, no unfilled XXX templates)."""
    if not text:
        return []
    t = re.sub(r"(?i)<br\s*/?>|</p>|</li>|</div>", "\n", text)
    t = html.unescape(re.sub(r"<[^>]+>", "", t)).replace("\xa0", " ")
    lines = []
    for line in t.split("\n"):
        line = re.sub(r"\s+", " ", line).strip(" -•")
        if not line or "XXX" in line or "xxh00" in line.lower():
            continue
        lines.append(line)
    return lines


# --- Place matching ---------------------------------------------------------

def _norm(s: str) -> str:
    s = unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode().lower()
    s = re.sub(r"\b(vd|fr|be|vs|so|sg|zh|ag|lu|ne|ge|ti|bl|gr|sz|zg|ur|tg|sh)\b", " ", s)
    return re.sub(r"[^a-z0-9]+", " ", s).strip()


def _places(text: str | None) -> list[str]:
    """'Puidoux - Vauderens et Lucens' -> ['puidoux', 'vauderens', 'lucens']."""
    if not text or not isinstance(text, str):
        return []
    parts = re.split(r"\s+-\s+|\s*-\s*$|\s+(?:et|und|e|and)\s+|,|/", text)
    return [p for p in (_norm(x) for x in parts) if len(p) >= 3]


def _place_score(case_place: str, public_text: str) -> tuple[float, list[str]]:
    places = _places(case_place)
    if not places:
        return 0.0, []
    norm_text = " " + _norm(public_text) + " "
    found = [p for p in places if f" {p} " in norm_text or f" {p.split()[0]} " in norm_text]
    return len(found) / len(places), found


# --- Data -------------------------------------------------------------------

@lru_cache(maxsize=1)
def _kult() -> dict[str, pd.DataFrame]:
    return loaders.load_intern_ticker()


@lru_cache(maxsize=1)
def _public_text() -> pd.DataFrame:
    """Per incident: all titles and descriptions (fr + de) joined, to find place names."""
    v = features.incident_versions()
    text = (v["summary_fr"].fillna("") + " " + v["summary_de"].fillna("") + " "
            + v["description_fr"].fillna("") + " " + v["description_de"].fillna(""))
    return text.groupby(v["id"]).agg(lambda s: " ".join(dict.fromkeys(s))).rename("text").to_frame()


def find_kult_case(incident_id: str) -> tuple[pd.Series | None, float, str]:
    """Best KULT case for a public incident: (case or None, score 0-1, explanation)."""
    history = features.build_incident_history().set_index("incident_id")
    if incident_id not in history.index:
        return None, 0.0, "Unknown incident."
    inc = history.loc[incident_id]
    cases = _kult()["cases"]
    lo, hi = cases["created_at"].min(), cases["created_at"].max()
    if not (lo - pd.Timedelta(hours=3) <= inc["start"] <= hi + pd.Timedelta(hours=3)):
        return None, 0.0, (f"Internal ticker data only covers {lo:%d.%m.%Y} - {hi:%d.%m.%Y}.")

    public = _public_text()["text"].get(incident_id, "")
    gap = (cases["created_at"] - inc["start"]).abs().dt.total_seconds() / 60
    cand = cases[gap <= MAX_TIME_GAP_MIN].copy()
    if cand.empty:
        return None, 0.0, "No internal case within 3 h of the incident."
    cand["gap_min"] = gap[cand.index]
    best, best_score, best_expl = None, 0.0, ""
    for _, c in cand.iterrows():
        place, found = _place_score(c["zug_nr_strecke"], public)
        if c["category_code"] == inc["reason_id"]:
            cause, cause_txt = 1.0, "same cause"
        elif features.reason_group(c["category_code"]) == inc["reason_group"] != "other":
            cause, cause_txt = 0.5, "similar cause"
        else:
            cause, cause_txt = 0.0, "different cause"
        time_s = 1 - c["gap_min"] / MAX_TIME_GAP_MIN
        score = 0.4 * place + 0.35 * time_s + 0.25 * cause
        if place == 0 and cause < 1:
            continue  # neither the place nor the cause match: too risky
        if score > best_score:
            best, best_score = c, score
            best_expl = (f"KULT case {c['id']} '{c['zug_nr_strecke']}': "
                         f"{'places ' + ', '.join(found) if found else 'no common place'}, "
                         f"{cause_txt}, created {c['gap_min']:.0f} min from the public incident.")
    if best is None or best_score < MIN_SCORE:
        return None, round(best_score, 2), "No internal case matches place, time and cause well enough."
    return best, round(best_score, 2), best_expl


def _modules(case_id: str, at: pd.Timestamp | None = None) -> pd.DataFrame:
    logs = _kult()["logs"]
    m = logs[(logs["ereignisfall_id"] == case_id) & (logs["entity"] == "InfoboardModule")]
    if at is not None:
        m = m[m["created_at"] <= at]
    rows = []
    for r in m.itertuples():
        d = parse_java_dump(r.data, "InfoboardModule")
        if d.get("id"):
            rows.append({**d, "logged_at": r.created_at, "action": r.action})
    if not rows:
        return pd.DataFrame(columns=["id", "titel", "text", "textVia", "active", "index", "logged_at"])
    df = pd.DataFrame(rows).sort_values("logged_at")
    return df.groupby("id").tail(1)  # last version of each module


def _section_of(title: str) -> str:
    t = title.upper()
    if "ERSATZVERKEHR" in t:
        return "bus"
    if "REISEEMPFEHLUNG" in t:
        return "recommendation"
    if "KULANZ" in t:
        return "goodwill"
    if "STOERUNGSBESCHRIEB" in t:
        return "description"
    return "trains"  # BETRIEBSKONZEPT_*, MASSNAHMEN, free modules per line ("IR 15 25xx")


def _pretty_title(title: str) -> str:
    if title.startswith("INFOBOARD_TITLE_"):
        return {
            "BETRIEBSKONZEPT_FERN": "Long distance", "BETRIEBSKONZEPT_REGIONAL": "Regional",
            "MASSNAHMEN": "Measures",
        }.get(title.removeprefix("INFOBOARD_TITLE_"), "")
    return title.strip()


@lru_cache(maxsize=256)
def incident_details(incident_id: str, at: pd.Timestamp | None = None) -> IncidentDetails:
    """Everything the 'More details' screen needs for one public incident.

    With `at`, only what staff knew at that moment is returned (for the replay).
    """
    try:
        case, score, explanation = find_kult_case(incident_id)
    except FileNotFoundError:
        return IncidentDetails(incident_id=incident_id, match_explanation="Data folder not found.")

    lines_affected = _via_lines(incident_id)
    if case is None:
        return IncidentDetails(incident_id=incident_id, match_score=score or None,
                               match_explanation=explanation, lines_affected=lines_affected)

    case_id = case["id"]
    sections: dict[str, list[str]] = {"bus": [], "trains": [], "recommendation": [], "goodwill": []}
    mods = _modules(case_id, at)
    mods = mods.assign(index_num=pd.to_numeric(mods.get("index"), errors="coerce")).sort_values("index_num")
    for m in mods.itertuples():
        if str(getattr(m, "active", "true")).lower() == "false":
            continue
        kind = _section_of(m.titel or "")
        if kind == "description":
            continue
        lines = html_to_lines(m.text) or html_to_lines(m.textVia)
        prefix = _pretty_title(m.titel or "")
        for line in lines:
            sections[kind].append(f"{prefix}: {line}" if prefix and kind == "trains" else line)

    msgs = _kult()["messages"]
    msgs = msgs[(msgs["ereignisfall_id"] == case_id) & (msgs["sender"] != "uxxx")]
    if at is not None:
        msgs = msgs[msgs["timestamp"] <= at]
    internal = [
        InternalMessage(time=r.timestamp.to_pydatetime(), text=" ".join(html_to_lines(r.message)))
        for r in msgs.itertuples() if html_to_lines(r.message)
    ]

    return IncidentDetails(
        incident_id=incident_id,
        found=True,
        kult_case_id=str(case_id),
        match_score=score,
        match_explanation=explanation,
        operating_concept=_concept(case_id),
        lines_affected=lines_affected,
        replacement_buses=_dedupe(sections["bus"]),
        cancelled_or_diverted_trains=_dedupe(sections["trains"]),
        travel_recommendations=_dedupe(sections["recommendation"]),
        ticket_goodwill=_dedupe(sections["goodwill"]),
        internal_messages=internal,
        internal_lead_minutes=_lead_minutes(incident_id, case, internal),
    )


def _dedupe(items: list[str]) -> list[str]:
    return list(dict.fromkeys(items))


def _concept(case_id: str) -> str | None:
    logs = _kult()["logs"]
    m = logs[(logs["ereignisfall_id"] == case_id) & (logs["entity"] == "Ereignisfall")]
    concepts = [parse_java_dump(d, "Ereignisfall").get("concept") for d in m["data"]]
    concepts = [c for c in concepts if c]
    return concepts[-1] if concepts else None


def _via_lines(incident_id: str) -> list[str]:
    try:
        via = loaders.load_via_reports()
    except FileNotFoundError:
        return []
    v = via[via["alea_fall_id"] == incident_id]["stoerungs_liniennummer"].dropna()
    lines: list[str] = []
    for s in v:
        lines += [x.strip() for x in str(s).split(",") if x.strip()]
    return list(dict.fromkeys(lines))


def _lead_minutes(incident_id: str, case: pd.Series, internal: list[InternalMessage]) -> int | None:
    """Minutes between the first internal message and the first public liveticker message."""
    msgs = loaders.load_messages()
    public = msgs[msgs["incident_id_fk"] == incident_id]["created_date"]
    first_internal = min([m.time for m in internal], default=None) or case["created_at"]
    if public.empty or first_internal is None:
        return None
    return int((public.min() - pd.Timestamp(first_internal)).total_seconds() // 60)
