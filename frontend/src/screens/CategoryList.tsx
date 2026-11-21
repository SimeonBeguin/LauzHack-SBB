// Screen 2 of the mockup: all options of one category, ranked.
import { useStore } from "../store";
import type { AlternativeCategory } from "../types";
import { CATEGORIES, CATEGORY_META } from "../lib/categories";
import { hhmm } from "../lib/format";
import AlternativeCard from "../components/AlternativeCard";
import { Header, Icon } from "../components/ui";

export default function CategoryList({ category }: { category: AlternativeCategory }) {
  const { alternatives, back, push, status, setSheetOpen, clock } = useStore();
  const meta = CATEGORY_META[category];
  const list = alternatives?.by_category[category] ?? [];
  const dest = status?.journey?.destination.name ?? "destination";

  const switchTo = (c: AlternativeCategory) => { back(); push({ name: "list", category: c }); };

  return (
    <>
      <Header
        title={meta.label}
        subtitle={`To ${dest} · leaving from ${hhmm(clock)}`}
        onBack={back}
        right={<button className="icon-btn" onClick={() => setSheetOpen(true)} aria-label="Personalise"><Icon name="sliders" size={22} /></button>}
      />
      <div className="content">
        <div className="tabs" role="tablist">
          {CATEGORIES.map((c) => (
            <button key={c} role="tab" aria-selected={c === category} className={`tab ${c === category ? "active" : ""}`} onClick={() => switchTo(c)}>
              <Icon name={CATEGORY_META[c].icon} size={15} /> {CATEGORY_META[c].short}
            </button>
          ))}
        </div>
        {list.length === 0 && <div className="card muted">No option in this category.</div>}
        {list.map((a) => <AlternativeCard key={a.id} alternative={a} />)}
        <p className="fineprint"><Icon name="info" size={14} /> {meta.sort} Tap an option to see each step.</p>
      </div>
    </>
  );
}
