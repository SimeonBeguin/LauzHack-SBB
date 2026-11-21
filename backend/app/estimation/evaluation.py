"""Back-test of the reopening estimate: is it honest (calibrated) and useful?

Run from backend/:
    python -m app.estimation.evaluation              # metrics in the terminal
    python -m app.estimation.evaluation --plot docs/calibration-2026.png

Protocol
- Test set: every published version ("snapshot") of every usable incident
  that started in 2026 (or after --test-from). Each incident counts once in
  total (its snapshots share a weight of 1), so long incidents with many
  versions do not dominate.
- Rolling origin: at each snapshot, the history only contains incidents that
  had already ended at that moment. No look-ahead.
- Methods compared:
    official  : the SBB announced end, as a point forecast
    survival  : remaining duration of similar incidents (ignores the announcement)
    ours      : official end corrected by similar incidents at the same age
- Metrics:
    pinball   : mean quantile loss over q = 10, 25, 50, 75, 90 % (minutes,
                lower is better; for a point forecast it is half the MAE)
    mae50     : mean absolute error of the median (minutes)
    calib     : share of real ends before each predicted quantile
                (perfect = 0.10 / 0.25 / 0.50 / 0.75 / 0.90)
    in_likely : share of real ends inside the displayed likely range
    late30    : "bad surprise" rate: real end > 30 min after the median
"""

from __future__ import annotations

import argparse

import numpy as np
import pandas as pd

from app.estimation import estimator, features

QS = np.array([0.10, 0.25, 0.50, 0.75, 0.90])


def _point_quantiles(minutes: float) -> np.ndarray:
    return np.full(len(QS), max(minutes, 0.0))


def backtest(test_from: str = "2026-01-01") -> pd.DataFrame:
    """One row per (test snapshot, method): predicted quantiles + truth (minutes after t)."""
    h = features.build_incident_history()
    test_ids = set(h[h["usable"] & (h["start"] >= pd.Timestamp(test_from, tz=estimator.TZ))]["incident_id"])
    snaps = features.build_snapshots()
    snaps = snaps[snaps["incident_id"].isin(test_ids)]
    rows = []
    for s in snaps.itertuples():
        truth = s.real_remaining_min
        state = estimator.IncidentState(
            s.incident_id, s.t, s.start, s.reason_id,
            s.kind if s.kind in ("interruption", "restriction") else "interruption",
            official_end=estimator._ts(s.announced_end), duration_type=s.duration_type,
        )
        base = {"incident_id": s.incident_id, "t": s.t, "truth": truth,
                "has_official": state.official_end is not None, "elapsed_min": s.elapsed_min}

        ours = estimator.predict(state, known_before=s.t)
        rows.append({**base, "method": "ours", "q": np.array([(ours.quantile(q) - s.t).total_seconds() / 60 for q in QS]),
                     "likely": _likely_range(state, ours)})

        surv_state = estimator.IncidentState(s.incident_id, s.t, s.start, s.reason_id, state.kind)
        surv = estimator.predict(surv_state, known_before=s.t)
        rows.append({**base, "method": "survival", "q": np.array([(surv.quantile(q) - s.t).total_seconds() / 60 for q in QS])})

        if state.official_end is not None:
            rows.append({**base, "method": "official", "q": _point_quantiles(s.announced_remaining_min)})
    df = pd.DataFrame(rows)
    df["weight"] = 1 / df.groupby(["method", "incident_id"])["incident_id"].transform("size")
    return df


def _likely_range(state: estimator.IncidentState, dist: estimator.EndDistribution) -> tuple[float, float]:
    """Same range as shown in the app (contains the official time, not before now)."""
    lo, hi = dist.quantile(estimator.LIKELY_Q[0]), dist.quantile(estimator.LIKELY_Q[1])
    if state.official_end is not None and state.official_end > state.at:
        lo, hi = min(lo, state.official_end), max(hi, state.official_end)
    lo = max(lo, state.at)
    return ((lo - state.at).total_seconds() / 60, (hi - state.at).total_seconds() / 60)


def summarize(df: pd.DataFrame, only_with_official: bool = True) -> pd.DataFrame:
    if only_with_official:
        df = df[df["has_official"]]
    out = {}
    for method, d in df.groupby("method"):
        P = np.vstack(d["q"].to_numpy())
        y = d["truth"].to_numpy()
        w = d["weight"].to_numpy()
        pin = np.mean([np.average(np.maximum(q * (y - P[:, j]), (q - 1) * (y - P[:, j])), weights=w)
                       for j, q in enumerate(QS)])
        row = {
            "incidents": d["incident_id"].nunique(),
            "snapshots": len(d),
            "pinball": round(pin, 1),
            "mae50": round(np.average(np.abs(y - P[:, 2]), weights=w), 1),
            "late30": round(np.average(y > P[:, 2] + 30, weights=w), 2),
            "width80": round(np.average(P[:, 4] - P[:, 0], weights=w)),
        }
        for j, q in enumerate(QS):
            row[f"calib{int(q * 100)}"] = round(np.average(y <= P[:, j], weights=w), 2)
        if "likely" in d and d["likely"].notna().all():
            L = np.vstack(d["likely"].to_numpy())
            row["in_likely"] = round(np.average((y >= L[:, 0]) & (y <= L[:, 1]), weights=w), 2)
        out[method] = row
    return pd.DataFrame(out).T


def plot_calibration(df: pd.DataFrame, path: str) -> None:
    import matplotlib

    matplotlib.use("Agg")
    import matplotlib.pyplot as plt

    d = df[df["has_official"]]
    fig, ax = plt.subplots(figsize=(5.2, 5))
    ax.plot([0, 1], [0, 1], color="#999", lw=1, ls="--", label="perfectly calibrated")
    styles = {"ours": ("#c60018", "o", "Our estimate (SBB time + history)"),
              "survival": ("#2d6a9f", "s", "History only (2x wider ranges)")}
    off = d[d["method"] == "official"]
    if not off.empty:
        share = np.average(off["truth"].to_numpy() <= np.vstack(off["q"].to_numpy())[:, 2],
                           weights=off["weight"].to_numpy())
        ax.text(0.98, 0.04, f"Line reopened by the SBB announced time\nin only {share:.0%} of cases",
                ha="right", va="bottom", fontsize=9, color="#444", transform=ax.transAxes)
    for method, (color, marker, label) in styles.items():
        m = d[d["method"] == method]
        if m.empty:
            continue
        P = np.vstack(m["q"].to_numpy())
        y, w = m["truth"].to_numpy(), m["weight"].to_numpy()
        obs = [np.average(y <= P[:, j], weights=w) for j in range(len(QS))]
        ax.plot(QS, obs, marker=marker, color=color, label=label, lw=2 if method == "ours" else 1.2)
    ax.set_xlabel("Predicted probability that the line has reopened")
    ax.set_ylabel("Observed share of incidents reopened")
    ax.set_title("Calibration on 2026 incidents (no look-ahead)")
    ax.set_xlim(0, 1)
    ax.set_ylim(0, 1)
    ax.legend(loc="upper left", frameon=False, fontsize=9)
    ax.grid(alpha=0.2)
    fig.tight_layout()
    fig.savefig(path, dpi=160)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--test-from", default="2026-01-01")
    parser.add_argument("--plot", help="save a calibration chart (PNG) to this path")
    args = parser.parse_args()
    df = backtest(args.test_from)
    pd.set_option("display.width", 200)
    print("Snapshots with an official end time:")
    print(summarize(df).to_string())
    print("\nAll snapshots (with or without official end):")
    print(summarize(df[df["method"] != "official"], only_with_official=False).to_string())
    if args.plot:
        plot_calibration(df, args.plot)
        print(f"\nCalibration chart saved to {args.plot}")


if __name__ == "__main__":
    main()
