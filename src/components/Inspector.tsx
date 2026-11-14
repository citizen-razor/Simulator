/** Property panels for the editor's right-hand side. Each takes a value and an onChange. */
import { createContext, useContext, useEffect, useState } from "react";
import {
  ActionTypes,
  ConditionOps,
  ElementKinds,
  ExpectOps,
  FIELD_KINDS,
  MAIN_PATH_ID,
  scenarioPaths,
  type Action,
  type Condition,
  type Rule,
  type Scenario,
  type Screen,
  type SimElement,
  type Simulation,
  type Step,
} from "../../shared/schema";
import { newId } from "../../shared/engine";
import type { GradingScheme } from "../../shared/library";
import type { PersonaLibrary } from "../../shared/personas";
import { ScenarioPersonas } from "./PersonaAssignments";

/**
 * Variables that exist only at play time and aren't declared in the simulation, such as
 * those provided by personas ({{customer.name}}). The editor provides them so variable
 * fields can suggest them.
 */
export const ExtraVariablesContext = createContext<{ names: string[]; tables: string[] }>({ names: [], tables: [] });
import { GeneratorKinds, generateValues, newSeed, type RandomVar } from "../../shared/random";

const OP_LABEL: Record<(typeof ConditionOps)[number], string> = {
  eq: "equals",
  neq: "does not equal",
  contains: "contains",
  empty: "is empty",
  notEmpty: "is not empty",
};
const ACTION_LABEL: Record<(typeof ActionTypes)[number], string> = {
  navigate: "Go to",
  set: "Set",
  toggle: "Toggle",
  message: "Message",
};
const EXPECT_LABEL: Record<(typeof ExpectOps)[number], string> = {
  any: "any value",
  eq: "exactly",
  contains: "containing",
};

function move<T>(arr: T[], i: number, d: number): T[] {
  const j = i + d;
  if (j < 0 || j >= arr.length) return arr;
  const next = [...arr];
  [next[i], next[j]] = [next[j], next[i]];
  return next;
}

/** Every variable name usable in conditions/actions: declared ones plus field bindings. */
export function variableNames(sim: Simulation): string[] {
  const names = new Set(sim.variables.map((v) => v.name));
  for (const s of sim.screens) for (const e of s.elements) if (FIELD_KINDS.includes(e.kind)) names.add(e.bindVar || e.id);
  return [...names].sort();
}

/**
 * An id/name that other parts of the simulation refer to. Edits are applied on Enter or
 * when leaving the field, through `onRename`, which updates every reference and returns
 * an error message if the new name isn't allowed. Escape cancels.
 */
export function IdField({ label, value, onRename }: { label: string; value: string; onRename: (next: string) => string | null }) {
  const [draft, setDraft] = useState(value);
  const [err, setErr] = useState("");
  useEffect(() => {
    setDraft(value);
    setErr("");
  }, [value]);
  const commit = () => {
    const next = draft.trim();
    if (next === value) return setErr("");
    setErr(onRename(next) ?? "");
  };
  return (
    <label className="field">
      <span>{label}</span>
      <input
        className="mono"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") commit();
          if (e.key === "Escape") {
            setDraft(value);
            setErr("");
          }
        }}
      />
      {err ? <small className="text-error">{err}</small> : <small className="muted">Renaming updates every reference to it.</small>}
    </label>
  );
}

function VarInput({ value, onChange, sim, placeholder = "variable" }: { value: string; onChange: (v: string) => void; sim: Simulation; placeholder?: string }) {
  const listId = "vars-datalist";
  const extra = useContext(ExtraVariablesContext);
  return (
    <>
      <input className="mono" list={listId} value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />
      <datalist id={listId}>
        {[...variableNames(sim), ...extra.names.filter((n) => !n.includes(".") || !/\.(backstory)$/.test(n))].map((n) => <option key={n} value={n} />)}
      </datalist>
    </>
  );
}

export function ConditionsEditor({ value, onChange, sim, emptyText }: { value: Condition[]; onChange: (c: Condition[]) => void; sim: Simulation; emptyText: string }) {
  const set = (i: number, patch: Partial<Condition>) => onChange(value.map((c, j) => (j === i ? { ...c, ...patch } : c)));
  return (
    <div className="cond-list">
      {value.length === 0 && <div className="muted small">{emptyText}</div>}
      {value.map((c, i) => (
        <div key={i} className="cond-row">
          <VarInput value={c.var} onChange={(v) => set(i, { var: v })} sim={sim} />
          <select value={c.op} onChange={(e) => set(i, { op: e.target.value as Condition["op"] })}>
            {ConditionOps.map((o) => <option key={o} value={o}>{OP_LABEL[o]}</option>)}
          </select>
          {c.op !== "empty" && c.op !== "notEmpty" && <input value={c.value ?? ""} placeholder="value" onChange={(e) => set(i, { value: e.target.value })} />}
          <button className="link-btn" onClick={() => onChange(value.filter((_, j) => j !== i))} aria-label="Remove condition">✕</button>
        </div>
      ))}
      <button className="link-btn add" onClick={() => onChange([...value, { var: "", op: "eq", value: "" }])}>+ condition</button>
    </div>
  );
}

function ActionsEditor({ value, onChange, sim }: { value: Action[]; onChange: (a: Action[]) => void; sim: Simulation }) {
  const set = (i: number, patch: Partial<Action>) => onChange(value.map((a, j) => (j === i ? { ...a, ...patch } : a)));
  return (
    <div className="cond-list">
      {value.length === 0 && <div className="muted small">Does nothing.</div>}
      {value.map((a, i) => (
        <div key={i} className="cond-row">
          <select value={a.type} onChange={(e) => set(i, { type: e.target.value as Action["type"] })}>
            {ActionTypes.map((t) => <option key={t} value={t}>{ACTION_LABEL[t]}</option>)}
          </select>
          {a.type === "navigate" && (
            <select value={a.screenId ?? ""} onChange={(e) => set(i, { screenId: e.target.value })}>
              <option value="">Choose screen…</option>
              {sim.screens.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          )}
          {(a.type === "set" || a.type === "toggle") && <VarInput value={a.var ?? ""} onChange={(v) => set(i, { var: v })} sim={sim} />}
          {a.type === "set" && <input value={a.value ?? ""} placeholder="value or {{var}}" onChange={(e) => set(i, { value: e.target.value })} />}
          {a.type === "message" && (
            <>
              <input value={a.value ?? ""} placeholder="Message text" onChange={(e) => set(i, { value: e.target.value })} />
              <select value={a.tone ?? "info"} onChange={(e) => set(i, { tone: e.target.value as Action["tone"] })}>
                <option value="info">info</option>
                <option value="success">success</option>
                <option value="error">error</option>
              </select>
            </>
          )}
          <button className="link-btn" onClick={() => onChange(value.filter((_, j) => j !== i))} aria-label="Remove action">✕</button>
        </div>
      ))}
      <button className="link-btn add" onClick={() => onChange([...value, { type: "navigate", screenId: "" }])}>+ action</button>
    </div>
  );
}

export function RulesEditor({ value, onChange, sim }: { value: Rule[]; onChange: (r: Rule[]) => void; sim: Simulation }) {
  const set = (i: number, patch: Partial<Rule>) => onChange(value.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  return (
    <div>
      <p className="muted small">The first rule whose conditions all pass runs. Leave a rule's conditions empty to make it the fallback.</p>
      {value.map((r, i) => (
        <div key={i} className="rule">
          <div className="rule-head">
            <b>Rule {i + 1}</b>
            <span className="spacer" />
            <button className="link-btn" onClick={() => onChange(move(value, i, -1))} disabled={i === 0} aria-label="Move up">↑</button>
            <button className="link-btn" onClick={() => onChange(move(value, i, 1))} disabled={i === value.length - 1} aria-label="Move down">↓</button>
            <button className="link-btn" onClick={() => onChange(value.filter((_, j) => j !== i))} aria-label="Remove rule">✕</button>
          </div>
          <div className="rule-label">If</div>
          <ConditionsEditor value={r.if} onChange={(c) => set(i, { if: c })} sim={sim} emptyText="Always" />
          <div className="rule-label">Then</div>
          <ActionsEditor value={r.then} onChange={(a) => set(i, { then: a })} sim={sim} />
        </div>
      ))}
      <button className="btn sm" onClick={() => onChange([...value, { if: [], then: [] }])}>+ Add rule</button>
    </div>
  );
}

export function ElementInspector({ el, sim, onChange, onDelete, onRename, onDuplicate, onCopy }: {
  el: SimElement;
  sim: Simulation;
  onChange: (e: SimElement) => void;
  onDelete: () => void;
  onRename: (next: string) => string | null;
  onDuplicate: () => void;
  onCopy: () => void;
}) {
  const isField = FIELD_KINDS.includes(el.kind);
  const set = (patch: Partial<SimElement>) => onChange({ ...el, ...patch });
  return (
    <div className="inspector">
      <div className="inspector-head">
        <h3>Element</h3>
        <span className="spacer" />
        <button className="btn sm" onClick={onDuplicate} title="Duplicate (Ctrl+D)">⧉ Duplicate</button>
        <button className="btn sm ghost" onClick={onCopy} title="Copy, then paste on any screen with Ctrl+V">Copy</button>
      </div>
      <label className="field">
        <span>Label</span>
        <input value={el.label} onChange={(e) => set({ label: e.target.value })} />
        <small className="muted">Use {"{{variable}}"} to show live values.</small>
      </label>
      <label className="field">
        <span>Kind</span>
        <select value={el.kind} onChange={(e) => set({ kind: e.target.value as SimElement["kind"] })}>
          {ElementKinds.map((k) => <option key={k}>{k}</option>)}
        </select>
      </label>
      <IdField label="Id" value={el.id} onRename={onRename} />
      <div className="field">
        <span>Position (% of screen)</span>
        <div className="rect-inputs">
          {(["x", "y", "w", "h"] as const).map((k) => (
            <label key={k}>
              {k}
              <input type="number" step={0.5} value={el.rect[k]} onChange={(e) => set({ rect: { ...el.rect, [k]: Number(e.target.value) } })} />
            </label>
          ))}
        </div>
      </div>
      {isField && (
        <>
          <label className="field">
            <span>Stores value in variable</span>
            <VarInput value={el.bindVar ?? ""} onChange={(v) => set({ bindVar: v || undefined })} sim={sim} placeholder={el.id} />
          </label>
          {(el.kind === "input" || el.kind === "textarea") && (
            <label className="field">
              <span>Placeholder</span>
              <input value={el.placeholder ?? ""} onChange={(e) => set({ placeholder: e.target.value || undefined })} />
            </label>
          )}
          {el.kind === "select" && (
            <label className="field">
              <span>Options (one per line)</span>
              <textarea rows={4} value={(el.options ?? []).join("\n")} onChange={(e) => set({ options: e.target.value.split("\n") })} />
            </label>
          )}
        </>
      )}
      {el.kind === "table" && <TableSourceField el={el} onChange={(tableSource) => set({ tableSource })} />}
      <details open={!!el.visibleIf?.length}>
        <summary>Visible only when…</summary>
        <ConditionsEditor value={el.visibleIf ?? []} onChange={(c) => set({ visibleIf: c.length ? c : undefined })} sim={sim} emptyText="Always visible" />
      </details>
      {el.kind !== "text" && (
        <details open>
          <summary>{isField ? "When the value changes…" : "When clicked…"}</summary>
          <RulesEditor value={el.rules} onChange={(r) => set({ rules: r })} sim={sim} />
        </details>
      )}
      <button className="btn sm danger" onClick={onDelete}>Delete element</button>
    </div>
  );
}

export function ScreenInspector({ screen, sim, onChange, onDelete, onReplaceImage, onMakeStart, onSelectElement, onRename, onDuplicate }: {
  onRename: (next: string) => string | null;
  onDuplicate: () => void;
  screen: Screen;
  sim: Simulation;
  onChange: (s: Screen) => void;
  onDelete: () => void;
  onReplaceImage: (f: File) => void;
  onMakeStart: () => void;
  onSelectElement: (id: string) => void;
}) {
  return (
    <div className="inspector">
      <div className="inspector-head">
        <h3>Screen</h3>
        <span className="spacer" />
        <button className="btn sm" onClick={onDuplicate}>⧉ Duplicate screen</button>
      </div>
      <label className="field">
        <span>Name</span>
        <input value={screen.name} onChange={(e) => onChange({ ...screen, name: e.target.value })} />
      </label>
      <IdField label="Id" value={screen.id} onRename={onRename} />
      <label className="field">
        <span>Description</span>
        <textarea rows={2} value={screen.description ?? ""} onChange={(e) => onChange({ ...screen, description: e.target.value || undefined })} />
      </label>
      <div className="field">
        <span>Screenshot</span>
        <div className="row">
          <label className="btn sm">
            {screen.imageAssetId ? "Replace image" : "Add image"}
            <input type="file" accept="image/*" hidden onChange={(e) => e.target.files?.[0] && onReplaceImage(e.target.files[0])} />
          </label>
          {screen.imageAssetId && (
            <button className="btn sm ghost" onClick={() => onChange({ ...screen, imageAssetId: null, aspect: 1.6 })}>Use wireframe</button>
          )}
        </div>
      </div>
      {!screen.imageAssetId && (
        <label className="field">
          <span>Aspect ratio (width ÷ height)</span>
          <input type="number" step={0.05} min={0.3} max={4} value={screen.aspect} onChange={(e) => onChange({ ...screen, aspect: Number(e.target.value) || 1.6 })} />
        </label>
      )}
      <div className="row">
        {sim.startScreenId === screen.id ? <span className="badge">Start screen</span> : <button className="btn sm" onClick={onMakeStart}>Make start screen</button>}
        <button className="btn sm danger" onClick={onDelete} disabled={sim.screens.length === 1}>Delete screen</button>
      </div>
      <h4>Elements ({screen.elements.length})</h4>
      <p className="muted small">Drag on the screen to draw a new element. Click one to edit it.</p>
      <ul className="el-list">
        {screen.elements.map((e) => (
          <li key={e.id}><button className="link-btn" onClick={() => onSelectElement(e.id)}><b>{e.kind}</b> {e.label}</button></li>
        ))}
      </ul>
    </div>
  );
}

function elementOptions(sim: Simulation) {
  return sim.screens.map((s) => (
    <optgroup key={s.id} label={s.name}>
      {s.elements.filter((e) => e.kind !== "text").map((e) => <option key={e.id} value={e.id}>{e.label || e.id} ({e.kind})</option>)}
    </optgroup>
  ));
}

function elementName(sim: Simulation, id: string) {
  for (const s of sim.screens) {
    const e = s.elements.find((x) => x.id === id);
    if (e) return e.label || e.id;
  }
  return `${id} (missing)`;
}

export function ScenarioInspector({ scenario, sim, onChange, onDelete, onRecord, onPlay, initialPathId, schemes, personaLib }: {
  schemes: GradingScheme[] | null;
  personaLib: PersonaLibrary | null;
  scenario: Scenario;
  sim: Simulation;
  onChange: (s: Scenario) => void;
  onDelete: () => void;
  onRecord: (pathId: string) => void;
  onPlay: (mode: "guided" | "scenario") => void;
  initialPathId?: string;
}) {
  const set = (patch: Partial<Scenario>) => onChange({ ...scenario, ...patch });
  const paths = scenarioPaths(scenario);
  const [pathId, setPathId] = useState(initialPathId ?? MAIN_PATH_ID);
  const path = paths.find((p) => p.id === pathId) ?? paths[0];
  const isMain = path.id === MAIN_PATH_ID;
  const steps = path.steps;
  const setSteps = (next: Step[]) =>
    isMain ? set({ steps: next }) : set({ alternatePaths: scenario.alternatePaths.map((p) => (p.id === path.id ? { ...p, steps: next } : p)) });
  const setStep = (i: number, patch: Partial<Step>) => setSteps(steps.map((st, j) => (j === i ? { ...st, ...patch } : st)));

  const addPath = () => {
    const id = newId("path");
    // Alternatives usually share their opening steps, so start from a copy of the main path.
    const copy = scenario.steps.map((st) => ({ ...structuredClone(st), id: newId("step") }));
    set({ alternatePaths: [...scenario.alternatePaths, { id, name: `Alternative ${scenario.alternatePaths.length + 1}`, steps: copy }] });
    setPathId(id);
  };
  const renamePath = (name: string) =>
    set({ alternatePaths: scenario.alternatePaths.map((p) => (p.id === path.id ? { ...p, name } : p)) });
  const deletePath = () => {
    if (!confirm(`Delete the path "${path.name}"?`)) return;
    set({ alternatePaths: scenario.alternatePaths.filter((p) => p.id !== path.id) });
    setPathId(MAIN_PATH_ID);
  };
  const makeMain = () => {
    // Swap: this path's steps become the main path; the old main path takes its place as an alternative.
    set({
      steps: path.steps,
      alternatePaths: scenario.alternatePaths.map((p) => (p.id === path.id ? { ...p, name: "Previous main path", steps: scenario.steps } : p)),
    });
    setPathId(MAIN_PATH_ID);
  };
  return (
    <div className="inspector wide">
      <div className="inspector-head">
        <h3>Scenario</h3>
        <span className="spacer" />
        <button className="btn sm" onClick={() => onPlay("guided")}>▶ Guided</button>
        <button className="btn sm" onClick={() => onPlay("scenario")}>▶ Scenario</button>
      </div>
      <label className="field">
        <span>Title</span>
        <input value={scenario.title} onChange={(e) => set({ title: e.target.value })} />
      </label>
      <label className="field">
        <span>Goal (shown to the trainee)</span>
        <input value={scenario.goal} onChange={(e) => set({ goal: e.target.value })} />
      </label>
      <label className="field">
        <span>Briefing / situation</span>
        <textarea rows={2} value={scenario.briefing ?? ""} onChange={(e) => set({ briefing: e.target.value || undefined })} />
      </label>
      <label className="field">
        <span>Starts on</span>
        <select value={scenario.startScreenId ?? ""} onChange={(e) => set({ startScreenId: e.target.value || undefined })}>
          <option value="">Simulation start screen</option>
          {sim.screens.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
      </label>
      {sim.randomData.length > 0 && (
        <label className="check-line">
          <input type="checkbox" checked={scenario.randomize} onChange={(e) => set({ randomize: e.target.checked })} />
          Use fresh random values each run
        </label>
      )}
      <details open={scenario.initialVars.length > 0}>
        <summary>Starting state ({scenario.initialVars.length})</summary>
        <p className="muted small">Override variable values so the scenario can begin mid-workflow.</p>
        {scenario.initialVars.map((iv, i) => (
          <div key={i} className="cond-row">
            <VarInput value={iv.name} onChange={(v) => set({ initialVars: scenario.initialVars.map((x, j) => (j === i ? { ...x, name: v } : x)) })} sim={sim} />
            <span>=</span>
            <input value={iv.value} onChange={(e) => set({ initialVars: scenario.initialVars.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)) })} />
            <button className="link-btn" onClick={() => set({ initialVars: scenario.initialVars.filter((_, j) => j !== i) })}>✕</button>
          </div>
        ))}
        <button className="link-btn add" onClick={() => set({ initialVars: [...scenario.initialVars, { name: "", value: "" }] })}>+ value</button>
      </details>

      {personaLib && personaLib.personas.length > 0 && (
        <>
          <h4>Personas in this scenario</h4>
          <ScenarioPersonas sim={sim} scenario={scenario} lib={personaLib} onChange={(o) => set({ personaOverrides: o })} />
        </>
      )}

      <h4>Steps</h4>
      <p className="muted small">
        The trainee performs a path's steps in order. If a task has more than one correct way, add an alternative path:
        completing <i>any</i> path counts. Guided mode coaches the main path and follows the trainee if they take another.
      </p>
      <div className="path-tabs" role="tablist">
        {paths.map((p) => (
          <button key={p.id} role="tab" aria-selected={p.id === path.id} className={`chip-btn ${p.id === path.id ? "on" : ""}`} onClick={() => setPathId(p.id)}>
            {p.name} <span className="count">{p.steps.length}</span>
          </button>
        ))}
        <button className="link-btn add" onClick={addPath} title="Starts as a copy of the main path; change the steps that differ">+ Alternative path</button>
      </div>
      {!isMain && (
        <div className="path-head">
          <input value={path.name} aria-label="Path name" onChange={(e) => renamePath(e.target.value)} />
          <button className="btn sm ghost" onClick={makeMain} title="Swap this path with the main path">Make main</button>
          <button className="btn sm ghost danger" onClick={deletePath}>Delete path</button>
        </div>
      )}
      <ol className="step-editor">
        {steps.map((st, i) => (
          <li key={st.id}>
            <div className="step-row">
              <input className="grow" value={st.instruction} placeholder="Instruction" onChange={(e) => setStep(i, { instruction: e.target.value })} />
              <button className="link-btn" onClick={() => setSteps(move(steps, i, -1))} disabled={i === 0}>↑</button>
              <button className="link-btn" onClick={() => setSteps(move(steps, i, 1))} disabled={i === steps.length - 1}>↓</button>
              <button className="link-btn" onClick={() => setSteps(steps.filter((_, j) => j !== i))}>✕</button>
            </div>
            <div className="step-row">
              <select className="grow" value={st.elementId} onChange={(e) => setStep(i, { elementId: e.target.value })}>
                <option value="">Target element…</option>
                {elementOptions(sim)}
              </select>
              <select value={st.expect} onChange={(e) => setStep(i, { expect: e.target.value as Step["expect"] })} title="For fields: what value is required">
                {ExpectOps.map((o) => <option key={o} value={o}>{EXPECT_LABEL[o]}</option>)}
              </select>
              {st.expect !== "any" && <input value={st.value ?? ""} placeholder="value" onChange={(e) => setStep(i, { value: e.target.value })} />}
            </div>
            <div className="also-row">
              {(st.alsoElementIds ?? []).map((id) => (
                <span key={id} className="chip">
                  or {elementName(sim, id)}
                  <button
                    className="link-btn"
                    aria-label="Remove alternative"
                    onClick={() => {
                      const rest = (st.alsoElementIds ?? []).filter((x) => x !== id);
                      setStep(i, { alsoElementIds: rest.length ? rest : undefined });
                    }}
                  >✕</button>
                </span>
              ))}
              <select
                className="also-add"
                value=""
                title="Other controls that also count for this step"
                onChange={(e) => e.target.value && setStep(i, { alsoElementIds: [...(st.alsoElementIds ?? []), e.target.value] })}
              >
                <option value="">+ also accept…</option>
                {elementOptions(sim)}
              </select>
            </div>
            <input className="hint-input" value={st.hint ?? ""} placeholder="Hint (optional): explain why" onChange={(e) => setStep(i, { hint: e.target.value || undefined })} />
          </li>
        ))}
      </ol>
      <div className="row">
        <button className="btn sm" onClick={() => setSteps([...steps, { id: newId("step"), instruction: "", elementId: "", expect: "any" }])}>+ Add step</button>
        <button className="btn sm" onClick={() => onRecord(path.id)}>● Record steps by doing</button>
      </div>
      <label className="field">
        <span>Grading</span>
        <select value={scenario.gradingSchemeId ?? ""} onChange={(e) => set({ gradingSchemeId: e.target.value || null })}>
          <option value="">Same as the simulation</option>
          {(schemes ?? []).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
      </label>
      <h4>Success criteria</h4>
      <ConditionsEditor
        value={scenario.successCriteria}
        onChange={(c) => set({ successCriteria: c })}
        sim={sim}
        emptyText="Completing all steps is enough."
      />
      <hr />
      <button className="btn sm danger" onClick={onDelete}>Delete scenario</button>
    </div>
  );
}

export function VariablesPanel({ sim, onChange, onRename, onRandomChange }: {
  sim: Simulation;
  onChange: (v: Simulation["variables"]) => void;
  onRename: (oldName: string, next: string) => string | null;
  onRandomChange: (r: RandomVar[]) => void;
}) {
  const vars = sim.variables;
  const set = (i: number, patch: Partial<Simulation["variables"][number]>) => onChange(vars.map((v, j) => (j === i ? { ...v, ...patch } : v)));
  const undeclared = variableNames(sim).filter((n) => !vars.some((v) => v.name === n));
  return (
    <div className="inspector wide">
      <h3>Variables</h3>
      <p className="muted small">
        Variables are the system's memory: field values, statuses, counters. Rules change them, conditions test them, and
        labels can display them with {"{{name}}"}.
      </p>
      <table className="var-table">
        <thead><tr><th>Name</th><th>Initial value</th><th>Description</th><th /></tr></thead>
        <tbody>
          {vars.map((v, i) => (
            <tr key={i}>
              <td><VarNameCell value={v.name} onRename={(next) => onRename(v.name, next)} /></td>
              <td><input value={v.initial} onChange={(e) => set(i, { initial: e.target.value })} /></td>
              <td><input value={v.description ?? ""} onChange={(e) => set(i, { description: e.target.value || undefined })} /></td>
              <td><button className="link-btn" onClick={() => onChange(vars.filter((_, j) => j !== i))}>✕</button></td>
            </tr>
          ))}
        </tbody>
      </table>
      <button className="btn sm" onClick={() => onChange([...vars, { name: `var${vars.length + 1}`, initial: "" }])}>+ Add variable</button>
      {undeclared.length > 0 && (
        <p className="muted small">
          Used by fields but not declared (start empty): {undeclared.map((n) => <code key={n}>{n} </code>)}
          <button className="link-btn add" onClick={() => onChange([...vars, ...undeclared.map((name) => ({ name, initial: "" }))])}>Declare all</button>
        </p>
      )}
      <RandomDataEditor sim={sim} onChange={onRandomChange} />
    </div>
  );
}

const KIND_LABEL: Record<RandomVar["kind"], string> = {
  pick: "Pick from a list",
  number: "Number in a range",
  pattern: "Pattern",
  name: "Person's name",
  date: "Date near today",
};

/** Random value generators: fresh values for chosen variables at the start of every run. */
function RandomDataEditor({ sim, onChange }: { sim: Simulation; onChange: (r: RandomVar[]) => void }) {
  const gens = sim.randomData;
  const [samples, setSamples] = useState<Record<string, string>[] | null>(null);
  const set = (i: number, patch: Partial<RandomVar>) => {
    setSamples(null);
    onChange(gens.map((g, j) => (j === i ? { ...g, ...patch } : g)));
  };
  const names = variableNames(sim);
  const free = names.filter((n) => !gens.some((g) => g.var === n));
  const num = (v: string) => (v === "" ? undefined : Number(v));
  return (
    <div className="random-data">
      <h3>Random values</h3>
      <p className="muted small">
        Give variables fresh, realistic values every run so trainees learn the process rather than memorising answers. Use them
        anywhere with {"{{name}}"}: labels, instructions, hints, and expected answers. Scenarios can turn this off.
      </p>
      {gens.map((g, i) => (
        <div key={i} className="criterion">
          <div className="row tight-top">
            <select value={g.var} onChange={(e) => set(i, { var: e.target.value })} aria-label="Variable">
              {[g.var, ...free].filter((v, k, a) => a.indexOf(v) === k).map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
            <select value={g.kind} onChange={(e) => set(i, { kind: e.target.value as RandomVar["kind"] })} aria-label="Kind">
              {GeneratorKinds.map((k) => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}
            </select>
            <span className="spacer" />
            <button className="link-btn" aria-label="Remove generator" onClick={() => { setSamples(null); onChange(gens.filter((_, j) => j !== i)); }}>✕</button>
          </div>
          <div className="gen-params">
            {g.kind === "pick" && (
              <>
                <label className="field">
                  <span>Options (one per line)</span>
                  <textarea rows={3} value={(g.options ?? []).join("\n")} onChange={(e) => set(i, { options: e.target.value.split("\n") })} />
                </label>
                <label className="field">
                  <span>Linked group (optional)</span>
                  <input value={g.group ?? ""} placeholder="e.g. customer" onChange={(e) => set(i, { group: e.target.value || undefined })} />
                  <small className="muted">Lists in the same group with the same number of lines pick the same line, e.g. a name and its email.</small>
                </label>
              </>
            )}
            {(g.kind === "number" || g.kind === "date") && (
              <div className="row tight-top">
                <label className="inline-num">{g.kind === "date" ? "from day" : "min"}<input type="number" value={g.min ?? ""} onChange={(e) => set(i, { min: num(e.target.value) })} /></label>
                <label className="inline-num">{g.kind === "date" ? "to day" : "max"}<input type="number" value={g.max ?? ""} onChange={(e) => set(i, { max: num(e.target.value) })} /></label>
                {g.kind === "number" && (
                  <label className="inline-num">decimals<input type="number" min={0} max={4} value={g.decimals ?? 0} onChange={(e) => set(i, { decimals: num(e.target.value) })} /></label>
                )}
                {g.kind === "date" && <span className="muted small">relative to today; negative = in the past</span>}
              </div>
            )}
            {g.kind === "pattern" && (
              <label className="field">
                <span>Pattern</span>
                <input className="mono" value={g.pattern ?? ""} placeholder="TCK-####" onChange={(e) => set(i, { pattern: e.target.value })} />
                <small className="muted"># digit · A capital letter · a lower-case letter · ? letter or digit · \ before a symbol keeps it as-is</small>
              </label>
            )}
          </div>
        </div>
      ))}
      <div className="row">
        <button
          className="btn sm"
          disabled={free.length === 0}
          title={free.length ? "" : "Every variable already has random values"}
          onClick={() => onChange([...gens, { var: free[0], kind: "name" }])}
        >
          + Random value
        </button>
        {gens.length > 0 && (
          <button className="btn sm ghost" onClick={() => setSamples([1, 2, 3].map(() => generateValues(gens, newSeed())))}>🎲 Try it</button>
        )}
      </div>
      {samples && (
        <table className="var-table samples">
          <thead><tr>{gens.map((g) => <th key={g.var}>{g.var}</th>)}</tr></thead>
          <tbody>{samples.map((row, k) => <tr key={k}>{gens.map((g) => <td key={g.var}>{row[g.var] ?? "–"}</td>)}</tr>)}</tbody>
        </table>
      )}
    </div>
  );
}

/** Variable name cell: renames on Enter/blur and updates every use of the variable. */
function VarNameCell({ value, onRename }: { value: string; onRename: (next: string) => string | null }) {
  const [draft, setDraft] = useState(value);
  const [err, setErr] = useState("");
  useEffect(() => setDraft(value), [value]);
  const commit = () => {
    const next = draft.trim();
    if (next !== value) setErr(onRename(next) ?? "");
  };
  return (
    <>
      <input
        className="mono"
        value={draft}
        title={err || "Renaming updates every use of this variable"}
        aria-invalid={!!err}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => e.key === "Enter" && commit()}
      />
      {err && <small className="text-error">{err}</small>}
    </>
  );
}

/** Which table a "table" element shows: usually a persona's record table such as customer.orders. */
function TableSourceField({ el, onChange }: { el: SimElement; onChange: (v: string | undefined) => void }) {
  const { tables } = useContext(ExtraVariablesContext);
  return (
    <label className="field">
      <span>Shows the table</span>
      <input className="mono" list="table-sources" value={el.tableSource ?? ""} placeholder="e.g. customer.orders" onChange={(e) => onChange(e.target.value || undefined)} />
      <datalist id="table-sources">{tables.map((t) => <option key={t} value={t} />)}</datalist>
      <small className="muted">
        {tables.length
          ? `Tables from this simulation's personas: ${tables.join(", ")}.`
          : "Link a persona whose template has record tables in ⚙ Settings, then pick one of its tables here."}
      </small>
    </label>
  );
}
