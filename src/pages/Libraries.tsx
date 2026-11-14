/**
 * Admin-managed libraries that simulations draw on:
 *   #/libraries/tags     topics and the tags inside them
 *   #/libraries/grading  grading schemes (points rules, rubric, open-world objectives)
 * Everyone can view; editing is for the Admin-Builder (see AdminBar).
 */
import { useEffect, useState } from "react";
import { newId } from "../../shared/engine";
import {
  CRITERION_CHECKS,
  DEFAULT_SCHEME_ID,
  GradingSchemeSchema,
  OBJECTIVE_CHECKS,
  type Check,
  type CheckType,
  type GradingScheme,
  type Taxonomy,
} from "../../shared/library";
import { api } from "../api";
import { AdminBar } from "../components/AdminGate";
import { useAdmin } from "../lib/admin";
import { PersonaLibraryPanel } from "./PersonaLibrary";

export default function Libraries({ tab, personaId }: { tab?: string; personaId?: string }) {
  const current = tab === "grading" || tab === "storage" || tab === "personas" ? tab : "tags";
  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Libraries</h1>
          <p className="muted">Shared topics, tags, personas and grading schemes that every simulation can use.</p>
        </div>
      </div>
      <div className="segmented page-tabs" role="tablist">
        <a role="tab" aria-selected={current === "tags"} className={current === "tags" ? "on" : ""} href="#/libraries/tags">Topics & tags</a>
        <a role="tab" aria-selected={current === "personas"} className={current === "personas" ? "on" : ""} href="#/libraries/personas">Personas</a>
        <a role="tab" aria-selected={current === "grading"} className={current === "grading" ? "on" : ""} href="#/libraries/grading">Grading schemes</a>
        <a role="tab" aria-selected={current === "storage"} className={current === "storage" ? "on" : ""} href="#/libraries/storage">Storage</a>
      </div>
      {current === "tags" ? <TaxonomyEditor /> : current === "personas" ? <PersonaLibraryPanel initialPersonaId={personaId} /> : current === "grading" ? <GradingEditor /> : <StoragePanel />}
    </div>
  );
}

// ------------------------------------------------------------------ topics & tags

function TaxonomyEditor() {
  const { isAdmin } = useAdmin();
  const [tax, setTax] = useState<Taxonomy | null>(null);
  const [saved, setSaved] = useState("");
  const [error, setError] = useState("");
  const [newTag, setNewTag] = useState<Record<string, string>>({});
  useEffect(() => {
    api.taxonomy().then((t) => {
      setTax(t);
      setSaved(JSON.stringify(t));
    }).catch((e) => setError(e.message));
  }, []);
  if (!tax) return <p className="muted">{error || "Loading…"}</p>;
  const dirty = JSON.stringify(tax) !== saved;
  const edit = (fn: (t: Taxonomy) => void) => {
    const next = structuredClone(tax);
    fn(next);
    setTax(next);
  };
  const save = async () => {
    setError("");
    try {
      const t = await api.saveTaxonomy(tax);
      setTax(t);
      setSaved(JSON.stringify(t));
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const addTag = (topicId: string) => {
    const name = (newTag[topicId] ?? "").trim();
    if (!name) return;
    edit((t) => t.topics.find((x) => x.id === topicId)!.tags.push({ id: newId("tag"), name }));
    setNewTag({ ...newTag, [topicId]: "" });
  };

  return (
    <>
      <AdminBar what="topics and tags" />
      <p className="muted small">
        Topics group related tags, e.g. topic "Customer service" with tags "Refunds" and "Escalation". Authors tag simulations in the
        editor's Settings; the Library can be filtered by topic or tag, and Progress shows mastery per topic.
      </p>
      {error && <div className="alert error">{error}</div>}
      {tax.topics.length === 0 && <div className="empty"><p>No topics yet.</p></div>}
      <div className="topic-list">
        {tax.topics.map((topic) => (
          <section key={topic.id} className="panel topic">
            <div className="topic-head">
              <input
                className="topic-name"
                value={topic.name}
                disabled={!isAdmin}
                aria-label="Topic name"
                onChange={(e) => edit((t) => { t.topics.find((x) => x.id === topic.id)!.name = e.target.value; })}
              />
              {isAdmin && (
                <button
                  className="btn sm ghost danger"
                  onClick={() => confirm(`Delete topic "${topic.name}" and its ${topic.tags.length} tags? Simulations lose these tags.`) && edit((t) => { t.topics = t.topics.filter((x) => x.id !== topic.id); })}
                >
                  Delete topic
                </button>
              )}
            </div>
            <input
              className="topic-desc"
              value={topic.description}
              placeholder={isAdmin ? "Description (optional)" : ""}
              disabled={!isAdmin}
              aria-label="Topic description"
              onChange={(e) => edit((t) => { t.topics.find((x) => x.id === topic.id)!.description = e.target.value; })}
            />
            <div className="tag-row">
              {topic.tags.map((tag) => (
                <span key={tag.id} className="tag editable">
                  <input
                    value={tag.name}
                    disabled={!isAdmin}
                    aria-label="Tag name"
                    size={Math.max(4, tag.name.length)}
                    onChange={(e) => edit((t) => { t.topics.find((x) => x.id === topic.id)!.tags.find((x) => x.id === tag.id)!.name = e.target.value; })}
                  />
                  {isAdmin && (
                    <button className="link-btn" aria-label={`Delete tag ${tag.name}`} onClick={() => edit((t) => {
                      const tp = t.topics.find((x) => x.id === topic.id)!;
                      tp.tags = tp.tags.filter((x) => x.id !== tag.id);
                    })}>✕</button>
                  )}
                </span>
              ))}
              {isAdmin && (
                <form className="tag-add" onSubmit={(e) => { e.preventDefault(); addTag(topic.id); }}>
                  <input value={newTag[topic.id] ?? ""} placeholder="+ add tag" aria-label="New tag" onChange={(e) => setNewTag({ ...newTag, [topic.id]: e.target.value })} />
                </form>
              )}
            </div>
          </section>
        ))}
      </div>
      {isAdmin && (
        <div className="row">
          <button className="btn" onClick={() => edit((t) => { t.topics.push({ id: newId("topic"), name: "New topic", description: "", tags: [] }); })}>+ Add topic</button>
          <span className="spacer" />
          {dirty && <span className="badge warn">Unsaved</span>}
          <button className="btn primary" disabled={!dirty} onClick={save}>Save topics & tags</button>
        </div>
      )}
    </>
  );
}

// ------------------------------------------------------------------ grading schemes

const CHECK_LABEL: Record<CheckType, string> = {
  completed: "Completed the task",
  maxErrors: "At most N errors",
  noHints: "No hints used",
  withinTime: "Finished within the time limit",
  coverage: "Visited N % of screens",
  screen: "Reached a specific screen",
  state: "System ends in a specific state",
  manual: "Marked by a trainer",
};
const PER_SIM_NOTE = "Which screen/state is set per simulation, in the editor's Settings.";

function CheckEditor({ check, types, onChange, disabled }: { check: Check; types: CheckType[]; onChange: (c: Check) => void; disabled: boolean }) {
  return (
    <div className="check-editor">
      <select value={check.type} disabled={disabled} onChange={(e) => onChange({ type: e.target.value as CheckType, n: e.target.value === "coverage" ? 100 : 0 })}>
        {types.map((t) => <option key={t} value={t}>{CHECK_LABEL[t]}</option>)}
      </select>
      {(check.type === "maxErrors" || check.type === "coverage") && (
        <label className="inline-num">
          {check.type === "maxErrors" ? "N =" : "%"}
          <input type="number" min={0} max={check.type === "coverage" ? 100 : 50} value={check.n ?? 0} disabled={disabled} onChange={(e) => onChange({ ...check, n: Number(e.target.value) })} />
        </label>
      )}
      {(check.type === "screen" || check.type === "state") && <span className="muted small">{PER_SIM_NOTE}</span>}
    </div>
  );
}

function NumberField({ label, value, onChange, disabled, min = 0, max = 100, suffix, help }: {
  label: string; value: number | ""; onChange: (v: number | null) => void; disabled: boolean; min?: number; max?: number; suffix?: string; help?: string;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      <span className="num-suffix">
        <input type="number" min={min} max={max} value={value} disabled={disabled} onChange={(e) => onChange(e.target.value === "" ? null : Number(e.target.value))} />
        {suffix && <span className="muted small">{suffix}</span>}
      </span>
      {help && <small className="muted">{help}</small>}
    </label>
  );
}

function GradingEditor() {
  const { isAdmin } = useAdmin();
  const [schemes, setSchemes] = useState<GradingScheme[] | null>(null);
  const [selected, setSelected] = useState(DEFAULT_SCHEME_ID);
  const [draft, setDraft] = useState<GradingScheme | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const load = (select?: string) =>
    api.grading().then((lib) => {
      setSchemes(lib.schemes);
      const pick = lib.schemes.find((s) => s.id === (select ?? selected)) ?? lib.schemes[0];
      setSelected(pick.id);
      setDraft(structuredClone(pick));
    }).catch((e) => setError(e.message));
  useEffect(() => {
    load();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  if (!schemes || !draft) return <p className="muted">{error || "Loading…"}</p>;
  const original = schemes.find((s) => s.id === draft.id);
  const dirty = JSON.stringify(original) !== JSON.stringify(draft);
  const ro = !isAdmin;
  const set = (patch: Partial<GradingScheme>) => setDraft({ ...draft, ...patch });
  const setPoints = (patch: Partial<GradingScheme["points"]>) => setDraft({ ...draft, points: { ...draft.points, ...patch } });

  const select = (id: string) => {
    if (dirty && !confirm("Discard unsaved changes to this scheme?")) return;
    setSelected(id);
    setDraft(structuredClone(schemes.find((s) => s.id === id)!));
    setError("");
    setNotice("");
  };
  const create = (from?: GradingScheme) => {
    if (dirty && !confirm("Discard unsaved changes to this scheme?")) return;
    const s = GradingSchemeSchema.parse({ ...(from ? structuredClone(from) : {}), id: newId("scheme"), name: from ? `${from.name} (copy)` : "New scheme" });
    setSchemes([...schemes, s]);
    setSelected(s.id);
    setDraft(s);
  };
  const save = async () => {
    setError("");
    try {
      await api.saveScheme(GradingSchemeSchema.parse(draft));
      await load(draft.id);
      setNotice("Saved.");
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const remove = async () => {
    if (!confirm(`Delete the scheme "${draft.name}"?`)) return;
    setError("");
    try {
      await api.deleteScheme(draft.id);
      await load(DEFAULT_SCHEME_ID);
    } catch (e) {
      // Not saved yet: just drop it locally.
      if (!original || /not found/i.test((e as Error).message)) {
        setSchemes(schemes.filter((s) => s.id !== draft.id));
        select(DEFAULT_SCHEME_ID);
      } else setError((e as Error).message);
    }
  };
  const p = draft.points;
  const rubricTotal = draft.rubric.reduce((n, c) => n + c.weight, 0);

  return (
    <>
      <AdminBar what="grading schemes" />
      <div className="lib-grid">
        <aside className="lib-list">
          {schemes.map((s) => (
            <button key={s.id} className={`nav-item ${s.id === selected ? "on" : ""}`} onClick={() => select(s.id)}>
              {s.id === draft.id ? draft.name || "(unnamed)" : s.name}
              {s.id === DEFAULT_SCHEME_ID && <span className="count">default</span>}
            </button>
          ))}
          {isAdmin && <button className="link-btn add" onClick={() => create()}>+ New scheme</button>}
        </aside>

        <section className="panel lib-editor">
          <div className="row tight-top">
            <input className="scheme-name" value={draft.name} disabled={ro} aria-label="Scheme name" onChange={(e) => set({ name: e.target.value })} />
            <span className="spacer" />
            {isAdmin && <button className="btn sm ghost" onClick={() => create(draft)}>⧉ Duplicate</button>}
            {isAdmin && draft.id !== DEFAULT_SCHEME_ID && <button className="btn sm ghost danger" onClick={remove}>Delete</button>}
          </div>
          <label className="field">
            <span>Description</span>
            <textarea rows={2} value={draft.description} disabled={ro} onChange={(e) => set({ description: e.target.value })} />
          </label>

          <h4>Points</h4>
          <p className="muted small">Trainees start at 100 for completing the task (partial runs score by progress), minus these penalties.</p>
          <div className="field-grid">
            <NumberField label="Per error" suffix="points" value={p.errorPenalty} disabled={ro} onChange={(v) => setPoints({ errorPenalty: v ?? 0 })} />
            <NumberField label="Per hint" suffix="points" value={p.hintPenalty} disabled={ro} onChange={(v) => setPoints({ hintPenalty: v ?? 0 })} />
            <NumberField
              label="Time limit"
              suffix="minutes"
              min={1}
              max={1440}
              value={p.timeLimitSec === null ? "" : Math.round(p.timeLimitSec / 60)}
              help="Leave empty for no limit."
              disabled={ro}
              onChange={(v) => setPoints({ timeLimitSec: v === null || v <= 0 ? null : Math.round(v * 60) })}
            />
            {p.timeLimitSec !== null && (
              <NumberField label="Overtime" suffix="points per started minute" value={p.overtimePenaltyPerMin} disabled={ro} onChange={(v) => setPoints({ overtimePenaltyPerMin: v ?? 0 })} />
            )}
            <NumberField label="Pass mark" suffix="/ 100" value={p.passScore} disabled={ro} onChange={(v) => setPoints({ passScore: v ?? 0 })} />
            <NumberField label="Mastery mark" suffix="/ 100" value={p.masteryScore} disabled={ro} help="Solo runs at or above this count as mastered." onChange={(v) => setPoints({ masteryScore: v ?? 0 })} />
          </div>

          <h4>Rubric</h4>
          <p className="muted small">
            Weighted criteria. Each is checked automatically, or marked by a trainer on the Results page afterwards (the score is provisional
            until then).
          </p>
          {draft.rubric.map((c, i) => (
            <div key={c.id} className="criterion">
              <div className="row tight-top">
                <input className="grow" value={c.label} disabled={ro} aria-label="Criterion" placeholder="e.g. Chose the correct priority" onChange={(e) => set({ rubric: draft.rubric.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)) })} />
                <label className="inline-num" title="Relative weight">
                  weight
                  <input type="number" min={0} max={100} value={c.weight} disabled={ro} onChange={(e) => set({ rubric: draft.rubric.map((x, j) => (j === i ? { ...x, weight: Number(e.target.value) } : x)) })} />
                </label>
                {rubricTotal > 0 && <span className="muted small pct">{Math.round((100 * c.weight) / rubricTotal)}%</span>}
                {isAdmin && <button className="link-btn" aria-label="Remove criterion" onClick={() => set({ rubric: draft.rubric.filter((_, j) => j !== i) })}>✕</button>}
              </div>
              <CheckEditor check={c.check} types={CRITERION_CHECKS} disabled={ro} onChange={(check) => set({ rubric: draft.rubric.map((x, j) => (j === i ? { ...x, check } : x)) })} />
            </div>
          ))}
          {isAdmin && (
            <button className="btn sm" onClick={() => set({ rubric: [...draft.rubric, { id: newId("crit"), label: "", weight: 1, check: { type: "completed" } }] })}>+ Add criterion</button>
          )}
          {draft.rubric.length > 0 && (
            <div className="field rubric-weight">
              <span>How much of the final score comes from the rubric</span>
              <div className="row tight-top">
                <input type="range" min={0} max={100} step={5} value={draft.rubricWeight} disabled={ro} onChange={(e) => set({ rubricWeight: Number(e.target.value) })} aria-label="Rubric weight" />
                <b>{draft.rubricWeight}%</b>
                <span className="muted small">rubric · {100 - draft.rubricWeight}% points</span>
              </div>
              {draft.rubricWeight === 0 && <small className="muted">At 0% the rubric is shown to trainers but doesn't change the score.</small>}
            </div>
          )}

          <h4>Open-world objectives</h4>
          <p className="muted small">An optional checklist shown to trainees exploring in Open world. Ticked off automatically; never penalized.</p>
          {draft.objectives.map((o, i) => (
            <div key={o.id} className="criterion">
              <div className="row tight-top">
                <input className="grow" value={o.label} disabled={ro} aria-label="Objective" placeholder="e.g. Find where to reset a password" onChange={(e) => set({ objectives: draft.objectives.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)) })} />
                {isAdmin && <button className="link-btn" aria-label="Remove objective" onClick={() => set({ objectives: draft.objectives.filter((_, j) => j !== i) })}>✕</button>}
              </div>
              <CheckEditor check={o.check} types={OBJECTIVE_CHECKS} disabled={ro} onChange={(check) => set({ objectives: draft.objectives.map((x, j) => (j === i ? { ...x, check } : x)) })} />
            </div>
          ))}
          {isAdmin && (
            <button className="btn sm" onClick={() => set({ objectives: [...draft.objectives, { id: newId("obj"), label: "", check: { type: "coverage", n: 100 } }] })}>+ Add objective</button>
          )}

          {error && <div className="alert error">{error}</div>}
          {isAdmin && (
            <div className="row">
              <span className="spacer" />
              {notice && !dirty && <span className="muted small">{notice}</span>}
              {dirty && <span className="badge warn">Unsaved</span>}
              <button className="btn primary" disabled={!dirty && !!original} onClick={save}>Save scheme</button>
            </div>
          )}
        </section>
      </div>
    </>
  );
}

// ------------------------------------------------------------------ storage

const fmtBytes = (n: number) =>
  n >= 1e9 ? `${(n / 1e9).toFixed(1)} GB` : n >= 1e6 ? `${(n / 1e6).toFixed(1)} MB` : n >= 1e3 ? `${Math.round(n / 1e3)} KB` : `${n} bytes`;

function StoragePanel() {
  const { isAdmin, ready } = useAdmin();
  const [usage, setUsage] = useState<Awaited<ReturnType<typeof api.imageUsage>> | null>(null);
  const [result, setResult] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const load = () => api.imageUsage().then(setUsage).catch((e) => setError(e.message));
  useEffect(() => {
    if (isAdmin) load();
  }, [isAdmin]);

  const cleanup = async () => {
    if (!usage || !confirm(`Permanently delete ${usage.removable.count} unused image${usage.removable.count === 1 ? "" : "s"} (${fmtBytes(usage.removable.bytes)})? This can't be undone.`)) return;
    setBusy(true);
    setError("");
    try {
      const r = await api.cleanupImages();
      await load();
      setResult(`Deleted ${r.deleted} image${r.deleted === 1 ? "" : "s"}, freeing ${fmtBytes(r.bytes)}.`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <AdminBar what="storage" />
      {ready && !isAdmin ? (
        <p className="muted">Unlock as Admin-Builder to see storage.</p>
      ) : !usage ? (
        <p className="muted">{error || "Loading…"}</p>
      ) : (
        <section className="panel storage">
          <h3>Screenshot images</h3>
          <div className="tiles">
            <div className="tile"><span className="muted small">Stored</span><b>{usage.total.count}</b><span className="muted small">{fmtBytes(usage.total.bytes)}</span></div>
            <div className="tile"><span className="muted small">Unused, can be deleted</span><b>{usage.removable.count}</b><span className="muted small">{fmtBytes(usage.removable.bytes)}</span></div>
            <div className="tile"><span className="muted small">Unused, kept for now</span><b>{usage.recentUnused}</b><span className="muted small">less than a day old</span></div>
          </div>
          <p className="muted small">
            Images become unused when screens are deleted, screenshots replaced, or simulations removed. Images less than a day
            old are always kept, in case they belong to an editor that hasn't been saved yet. Exported files keep their own copies.
          </p>
          {error && <div className="alert error">{error}</div>}
          {result && <div className="alert info">{result}</div>}
          <button className="btn danger" disabled={busy || usage.removable.count === 0} onClick={cleanup}>
            {busy ? "Deleting…" : usage.removable.count ? `Delete ${usage.removable.count} unused image${usage.removable.count === 1 ? "" : "s"}` : "Nothing to clean up"}
          </button>
        </section>
      )}
    </>
  );
}
