// "See all connections", laid out like the SBB "Connections" screen.
import { useStore } from "../store";
import type { AlternativeCategory } from "../types";
import { CATEGORIES, CATEGORY_META } from "../lib/categories";
import { hhmm } from "../lib/format";
import { ConnectionCard, Header, Icon } from "../components/ui";

function shortDate(iso: string) {
  const d = new Date(iso);
  const wd = d.toLocaleDateString("en-GB", { weekday: "short", timeZone: "Europe/Zurich" });
  const dm = d.toLocaleDateString("de-CH", { day: "2-digit", month: "2-digit", timeZone: "Europe/Zurich" });
  return `${wd} ${dm}.`;
}

function longDate(iso: string) {
  const d = new Date(iso);
  const wd = d.toLocaleDateString("en-GB", { weekday: "long", timeZone: "Europe/Zurich" });
  const dmy = d.toLocaleDateString("de-CH", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "Europe/Zurich" });
  return `${wd} ${dmy}`;
}

export default function CategoryList({ category }: { category: AlternativeCategory }) {
  const { alternatives, back, push, status, setSheetOpen, clock, prefs } = useStore();
  const list = alternatives?.by_category[category] ?? [];
  const j = status?.journey;

  const switchTo = (c: AlternativeCategory) => { back(); push({ name: "list", category: c }); };

  return (
    <>
      <Header title="Connections" onBack={back}>
        <div className="seg" role="tablist">
          {CATEGORIES.map((c) => (
            <button key={c} role="tab" aria-selected={c === category} className={c === category ? "active" : ""} onClick={() => switchTo(c)}>
              {CATEGORY_META[c].short}
            </button>
          ))}
        </div>
      </Header>
      <div className="content overlap">
        <section className="card search-card">
          <div className="search-fields">
            <div className="search-field"><Icon name="target" size={24} className="from-icon" /><span>{j?.origin.name}</span></div>
            <div className="search-field"><Icon name="ring" size={24} /><span>{j?.destination.name}</span></div>
            <button className="circle-btn swap" aria-label="Swap"><Icon name="swap" size={26} /></button>
          </div>
          <div className="search-meta">
            <span>{shortDate(clock)}</span>
            <span className="sep" />
            <span>{prefs.deadline ? `${hhmm(prefs.deadline)} arr` : `${hhmm(clock)} dep`}</span>
            <span className="sep" />
            <Icon name="history" size={24} />
            <button className="filter-btn" onClick={() => setSheetOpen(true)} aria-label="Preferences"><Icon name="filter" size={26} /></button>
          </div>
        </section>
        <div className="date-bar">{longDate(clock)}</div>

        {list.length === 0 && <div className="card muted">No connection in this list.</div>}
        {list.map((a) => (
          <ConnectionCard key={a.id} alt={a} deadline={prefs.deadline} tag={a.recommended ? "Our advice" : undefined}
            onOpen={() => push({ name: "connection", id: a.id })} />
        ))}
      </div>
    </>
  );
}
