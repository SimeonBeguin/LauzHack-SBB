// "Personalize": three quick questions, one at a time. Tapping an answer moves
// on to the next question; after the last one we go back to "Need help", which
// then shows the single best itinerary for these answers (lib/personalize.ts).
import { useRef, useState } from "react";
import { useStore } from "../store";
import { Header, Icon } from "../components/ui";
import { answersOf, QUESTIONS, withAnswers, type PersonalAnswers } from "../lib/personalize";

const NEXT_DELAY_MS = 220; // let the tap show before moving on

/** Set when the questions are done: "Need help" then scrolls to the chosen itinerary. */
export const focusBestOption = { current: false };

export default function Personalize() {
  const { prefs, setPrefs, back, showToast, status } = useStore();
  const [step, setStep] = useState(0);
  const [draft, setDraft] = useState<Partial<PersonalAnswers>>(() => answersOf(prefs) ?? {});
  const busy = useRef(false);

  const q = QUESTIONS[step];
  const last = step === QUESTIONS.length - 1;
  const destination = status?.journey?.destination.name;
  const selected = draft[q.key];

  function choose(value: string) {
    if (busy.current) return;
    busy.current = true;
    const next = { ...draft, [q.key]: value } as Partial<PersonalAnswers>;
    setDraft(next);
    window.setTimeout(() => {
      busy.current = false;
      if (!last) {
        setStep(step + 1);
        return;
      }
      setPrefs(withAnswers(prefs, next as PersonalAnswers));
      focusBestOption.current = true;
      back();
      showToast("Here is your best option");
    }, NEXT_DELAY_MS);
  }

  return (
    <>
      <Header title="Personalize" onBack={() => (step > 0 ? setStep(step - 1) : back())} />
      <div className="content overlap">
        <section className="card pz-card" key={q.key}>
          <div className="pz-progress" aria-hidden="true">
            {QUESTIONS.map((x, i) => <i key={x.key} className={i <= step ? "on" : ""} />)}
          </div>
          <p className="pz-step">Question {step + 1} of {QUESTIONS.length}</p>
          <h2 className="pz-title" id="pz-title">{q.title}</h2>
          <div className="pz-options" role="radiogroup" aria-labelledby="pz-title">
            {q.options.map((o) => {
              const on = selected === o.value;
              const hint = o.value === "exact" && destination ? destination : o.hint;
              return (
                <button key={o.value} type="button" role="radio" aria-checked={on}
                  className={`pz-option ${on ? "on" : ""}`} onClick={() => choose(o.value)}>
                  <span className="pz-icon"><Icon name={o.icon} size={24} /></span>
                  <span className="pz-text">
                    <strong>{o.label}</strong>
                    {hint && <span className="pz-hint">{hint}</span>}
                  </span>
                  <span className="pz-radio" aria-hidden="true" />
                </button>
              );
            })}
          </div>
        </section>
        <p className="fineprint">
          We use your answers to pick one connection for you. You can change them at any time.
        </p>
      </div>
    </>
  );
}
