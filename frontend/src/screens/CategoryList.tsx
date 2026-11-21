// "See all connections": every option, ranked, with simple tabs.
import { useStore } from "../store";
import type { AlternativeCategory } from "../types";
import { CATEGORIES, CATEGORY_META } from "../lib/categories";
import { hhmm } from "../lib/format";
import AlternativeCard from "../components/AlternativeCard";
import { Header, Icon } from "../components/ui";

export default function CategoryList({ category }: { category: AlternativeCategory }) {
  const { alternatives, back, push, status, setSheetOpen, clock, prefs } = useStore();
  const meta = CATEGORY_META[category];
  const list = alternatives?.by_category[category] ?? [];
  const dest = status?.journey?.destination.name ?? "destination";

  const switchTo = (c: AlternativeCategory) => { back(); push({ name: "list", category: c }); };

  return (
    <>
      <Header
        title={`Connections to ${dest}`}
        subtitle={`From ${hhmm(clock)}${prefs.deadline ? `, arrive by ${hhmm(prefs.deadline)}` : ""}`}
        onBack={back}
        right={<button className="icon-btn" onClick={() => setSheetOpen(true)} aria-label="Preferences"><Icon name="sliders" size={22} /></button>}
      />
      <div className="content">
        <div className="tabs" role="tablist">
          {CATEGORIES.map((c) => (
            <button key={c} role="tab" aria-selected={c === category} className={`tab ${c === category ? "active" : ""}`} onClick={() => switchTo(c)}>
              {CATEGORY_META[c].short}
            </button>
          ))}
        </div>
        <p className="muted small tab-hint">{meta.sort}</p>
        {list.length === 0 && <div className="card muted">No connection in this list.</div>}
        {list.map((a) => <AlternativeCard key={a.id} alternative={a} deadline={prefs.deadline} />)}
      </div>
    </>
  );
}
