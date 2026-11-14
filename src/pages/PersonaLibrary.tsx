/**
 * Libraries → Personas: persona templates and the personas built from them, plus AI
 * drafting. Builders create and edit personas freely (like simulations); templates, which
 * define every persona's structure, need admin mode. A persona is one record: editing it
 * changes it everywhere it's used.
 */
import { useEffect, useMemo, useState } from "react";
import { newId } from "../../shared/engine";
import {
  DEFAULT_ROLE,
  FieldTypes,
  keyFromLabel,
  KEY_PATTERN,
  PersonaSchema,
  PersonaTemplateSchema,
  personaVariableNames,
  type FieldType,
  type Persona,
  type PersonaLibrary,
  type PersonaTemplate,
  type TemplateField,
} from "../../shared/personas";
import { api } from "../api";
import { AdminBar } from "../components/AdminGate";
import { useAdmin } from "../lib/admin";

type Sel = { kind: "persona"; id: string } | { kind: "template"; id: string } | { kind: "draft" } | null;

const TYPE_LABEL: Record<FieldType, string> = {
  text: "Text",
  number: "Number",
  money: "Money",
  date: "Date",
  email: "Email",
  phone: "Phone",
  longtext: "Long text",
  choice: "Choice",
};

export function PersonaLibraryPanel({ initialPersonaId }: { initialPersonaId?: string }) {
  const { isAdmin } = useAdmin();
  const [lib, setLib] = useState<PersonaLibrary | null>(null);
  const [sel, setSel] = useState<Sel>(null);
  const [error, setError] = useState("");
  const [aiAvailable, setAiAvailable] = useState(false);

  const load = (select?: Sel) =>
    api.personas().then((l) => {
      setLib(l);
      if (select !== undefined) setSel(select);
      else if (!sel && initialPersonaId && l.personas.some((p) => p.id === initialPersonaId)) setSel({ kind: "persona", id: initialPersonaId });
      else if (!sel) setSel(l.personas[0] ? { kind: "persona", id: l.personas[0].id } : l.templates[0] ? { kind: "template", id: l.templates[0].id } : null);
    }).catch((e) => setError(e.message));
  useEffect(() => {
    load();
    api.status().then((s) => setAiAvailable(s.aiConfigured)).catch(() => undefined);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  if (!lib) return <p className="muted">{error || "Loading…"}</p>;
  const templateName = (id: string | null) => lib.templates.find((t) => t.id === id)?.name ?? "No template";

  const newPersona = () => {
    const p = PersonaSchema.parse({ id: newId("persona"), name: "New persona", templateId: lib.templates[0]?.id ?? null });
    setLib({ ...lib, personas: [...lib.personas, p] });
    setSel({ kind: "persona", id: p.id });
  };
  const newTemplate = () => {
    const t = PersonaTemplateSchema.parse({
      id: newId("tpl"),
      name: "New template",
      fields: [{ key: "accountNumber", label: "Account number", type: "text" }],
    });
    setLib({ ...lib, templates: [...lib.templates, t] });
    setSel({ kind: "template", id: t.id });
  };

  const persona = sel?.kind === "persona" ? lib.personas.find((p) => p.id === sel.id) : undefined;
  const template = sel?.kind === "template" ? lib.templates.find((t) => t.id === sel.id) : undefined;

  return (
    <>
      <AdminBar what="persona templates" />
      <div className="alert warn small">
        🔒 Use invented details only. Don't enter real customers' names, account numbers or other personal information:
        simulations are exported and shared.
      </div>
      {error && <div className="alert error">{error}</div>}
      <div className="lib-grid">
        <aside className="lib-list">
          <h4>Personas</h4>
          {lib.personas.map((p) => (
            <button key={p.id} className={`nav-item ${sel?.kind === "persona" && sel.id === p.id ? "on" : ""}`} onClick={() => setSel({ kind: "persona", id: p.id })}>
              <span className="persona-item">
                {p.name}
                <span className="muted small">{templateName(p.templateId)}</span>
              </span>
            </button>
          ))}
          {lib.personas.length === 0 && <p className="muted small">No personas yet.</p>}
          <button className="link-btn add" onClick={newPersona}>+ New persona</button>
          {aiAvailable && (
            <button className={`link-btn add ${sel?.kind === "draft" ? "on" : ""}`} onClick={() => setSel({ kind: "draft" })}>✦ Draft personas with AI</button>
          )}
          <h4>Templates</h4>
          {lib.templates.map((t) => (
            <button key={t.id} className={`nav-item ${sel?.kind === "template" && sel.id === t.id ? "on" : ""}`} onClick={() => setSel({ kind: "template", id: t.id })}>
              {t.name}
              <span className="count">{lib.personas.filter((p) => p.templateId === t.id).length}</span>
            </button>
          ))}
          {lib.templates.length === 0 && <p className="muted small">Templates define the fields and record tables a kind of persona has, e.g. "Bank customer".</p>}
          {isAdmin && <button className="link-btn add" onClick={newTemplate}>+ New template</button>}
        </aside>
        <section className="panel lib-editor">
          {persona ? (
            <PersonaEditor
              key={persona.id}
              persona={persona}
              lib={lib}
              readOnly={false}
              onSaved={(p) => load({ kind: "persona", id: p.id })}
              onDeleted={() => load(null)}
              onDuplicate={(p) => {
                setLib({ ...lib, personas: [...lib.personas, p] });
                setSel({ kind: "persona", id: p.id });
              }}
            />
          ) : template ? (
            <TemplateEditor key={template.id} template={template} lib={lib} readOnly={!isAdmin} onSaved={(t) => load({ kind: "template", id: t.id })} onDeleted={() => load(null)} />
          ) : sel?.kind === "draft" ? (
            <DraftPanel lib={lib} onKept={(p) => load({ kind: "persona", id: p.id })} />
          ) : (
            <p className="muted">Choose a persona or template, or create one.</p>
          )}
        </section>
      </div>
    </>
  );
}

// ------------------------------------------------------------------ persona

function FieldInput({ field, value, onChange, disabled }: { field: Pick<TemplateField, "type" | "options" | "label">; value: string; onChange: (v: string) => void; disabled: boolean }) {
  switch (field.type) {
    case "longtext":
      return <textarea rows={3} value={value} disabled={disabled} aria-label={field.label} onChange={(e) => onChange(e.target.value)} />;
    case "choice":
      return (
        <select value={value} disabled={disabled} aria-label={field.label} onChange={(e) => onChange(e.target.value)}>
          <option value="">—</option>
          {(field.options ?? []).map((o) => <option key={o}>{o}</option>)}
          {value && !(field.options ?? []).includes(value) && <option>{value}</option>}
        </select>
      );
    default: {
      const type = { number: "number", money: "number", date: "date", email: "email", phone: "tel" }[field.type as string] ?? "text";
      return <input type={type} step={field.type === "money" ? "0.01" : undefined} value={value} disabled={disabled} aria-label={field.label} onChange={(e) => onChange(e.target.value)} />;
    }
  }
}

/**
 * Edits one persona, the single record used everywhere. Used in Libraries and, embedded,
 * in the simulation editor (without Duplicate/Delete there).
 */
export function PersonaEditor({ persona, lib, readOnly, onSaved, onDeleted, onDuplicate }: {
  persona: Persona;
  lib: PersonaLibrary;
  readOnly: boolean;
  onSaved: (p: Persona) => void;
  onDeleted?: () => void;
  onDuplicate?: (p: Persona) => void;
}) {
  const [draft, setDraft] = useState<Persona>(structuredClone(persona));
  const [saved, setSaved] = useState(JSON.stringify(persona));
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [uses, setUses] = useState<string[] | null>(null);
  useEffect(() => {
    api.personaUsage(persona.id).then((r) => setUses(r.uses)).catch(() => setUses(null));
  }, [persona.id]);
  const tpl = lib.templates.find((t) => t.id === draft.templateId) ?? null;
  const dirty = JSON.stringify(draft) !== saved;
  const set = (patch: Partial<Persona>) => setDraft({ ...draft, ...patch });
  const vars = useMemo(() => personaVariableNames(DEFAULT_ROLE, draft, tpl), [draft, tpl]);

  const save = async () => {
    setError("");
    try {
      const p = await api.savePersona(PersonaSchema.parse(draft));
      setSaved(JSON.stringify(p));
      setNotice("Saved.");
      onSaved(p);
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const remove = async () => {
    if (!confirm(`Delete the persona "${draft.name}"?`)) return;
    setError("");
    try {
      await api.deletePersona(draft.id);
      onDeleted?.();
    } catch (e) {
      if (/not found/i.test((e as Error).message)) onDeleted?.();
      else setError((e as Error).message);
    }
  };

  return (
    <div>
      <div className="row tight-top">
        <input className="scheme-name" value={draft.name} disabled={readOnly} aria-label="Persona name" onChange={(e) => set({ name: e.target.value })} />
        <span className="spacer" />
        {!readOnly && onDuplicate && (
          <button className="btn sm ghost" onClick={() => onDuplicate({ ...structuredClone(draft), id: newId("persona"), name: `${draft.name} (copy)` })}>⧉ Duplicate</button>
        )}
        {!readOnly && onDeleted && <button className="btn sm ghost danger" onClick={remove}>Delete</button>}
      </div>
      {uses && uses.length > 0 && (
        <p className="persona-usage small">
          <b>One record, used everywhere:</b> changes apply to every scenario, open-world and guided run that uses {draft.name || "this persona"}:{" "}
          {uses.join(" · ")}
        </p>
      )}
      <label className="field">
        <span>Summary</span>
        <input value={draft.summary} disabled={readOnly} maxLength={300} placeholder="e.g. Café owner disputing a roaming charge; polite but short on time" onChange={(e) => set({ summary: e.target.value })} />
      </label>
      <label className="field">
        <span>Template</span>
        <select value={draft.templateId ?? ""} disabled={readOnly} onChange={(e) => set({ templateId: e.target.value || null })}>
          <option value="">No template (extra fields only)</option>
          {lib.templates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
      </label>
      <label className="field">
        <span>Backstory</span>
        <textarea rows={5} value={draft.backstory} disabled={readOnly} placeholder="Their situation, what happened, what they want now, how they communicate…" onChange={(e) => set({ backstory: e.target.value })} />
      </label>

      {tpl && tpl.fields.length > 0 && (
        <>
          <h4>Account details</h4>
          <div className="field-grid persona-fields">
            {tpl.fields.map((f) => (
              <label key={f.key} className={`field ${f.type === "longtext" ? "wide" : ""}`}>
                <span>{f.label}</span>
                <FieldInput field={f} value={draft.values[f.key] ?? ""} disabled={readOnly} onChange={(v) => set({ values: { ...draft.values, [f.key]: v } })} />
              </label>
            ))}
          </div>
        </>
      )}

      <h4>Extra details</h4>
      {draft.extra.map((x, i) => (
        <div key={i} className="cond-row">
          <input value={x.label} disabled={readOnly} placeholder="Label" aria-label="Extra field label" onChange={(e) => {
            const label = e.target.value;
            set({ extra: draft.extra.map((y, j) => (j === i ? { ...y, label, key: keyFromLabel(label) } : y)) });
          }} />
          <input value={x.value} disabled={readOnly} placeholder="Value" aria-label="Extra field value" onChange={(e) => set({ extra: draft.extra.map((y, j) => (j === i ? { ...y, value: e.target.value } : y)) })} />
          {!readOnly && <button className="link-btn" aria-label="Remove field" onClick={() => set({ extra: draft.extra.filter((_, j) => j !== i) })}>✕</button>}
        </div>
      ))}
      {!readOnly && <button className="link-btn add" onClick={() => set({ extra: [...draft.extra, { key: "detail", label: "", value: "" }] })}>+ extra detail</button>}

      {tpl?.tables.map((t) => {
        const rows = draft.tables[t.key] ?? [];
        const setRows = (next: Record<string, string>[]) => set({ tables: { ...draft.tables, [t.key]: next } });
        return (
          <div key={t.key}>
            <h4>{t.label} <span className="muted small">(most recent first)</span></h4>
            <div className="table-scroll">
              <table className="var-table record-table">
                <thead><tr>{t.columns.map((c) => <th key={c.key}>{c.label}</th>)}{!readOnly && <th />}</tr></thead>
                <tbody>
                  {rows.map((r, i) => (
                    <tr key={i}>
                      {t.columns.map((c) => (
                        <td key={c.key}>
                          <FieldInput field={{ type: c.type, label: `${t.label} row ${i + 1} ${c.label}` }} value={r[c.key] ?? ""} disabled={readOnly} onChange={(v) => setRows(rows.map((x, j) => (j === i ? { ...x, [c.key]: v } : x)))} />
                        </td>
                      ))}
                      {!readOnly && <td><button className="link-btn" aria-label="Remove row" onClick={() => setRows(rows.filter((_, j) => j !== i))}>✕</button></td>}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {!readOnly && <button className="link-btn add" onClick={() => setRows([Object.fromEntries(t.columns.map((c) => [c.key, ""])), ...rows])}>+ row at top</button>}
          </div>
        );
      })}

      <details className="var-help">
        <summary className="small">Use on screens</summary>
        <p className="muted small">Link this persona to a role in a simulation's ⚙ Settings, then use these on screens (shown for the role "customer"):</p>
        <div className="tag-row">{vars.map((v) => <code key={v} className="chip">{`{{${v}}}`}</code>)}</div>
      </details>

      {error && <div className="alert error">{error}</div>}
      {!readOnly && (
        <div className="row">
          <span className="spacer" />
          {notice && !dirty && <span className="muted small">{notice}</span>}
          {dirty && <span className="badge warn">Unsaved</span>}
          <button className="btn primary" disabled={!dirty && lib.personas.some((p) => p.id === draft.id && JSON.stringify(p) === saved)} onClick={save}>Save persona</button>
        </div>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ template

function TemplateEditor({ template, lib, readOnly, onSaved, onDeleted }: {
  template: PersonaTemplate;
  lib: PersonaLibrary;
  readOnly: boolean;
  onSaved: (t: PersonaTemplate) => void;
  onDeleted: () => void;
}) {
  const [draft, setDraft] = useState<PersonaTemplate>(structuredClone(template));
  const [saved, setSaved] = useState(JSON.stringify(template));
  const [error, setError] = useState("");
  const dirty = JSON.stringify(draft) !== saved;
  const set = (patch: Partial<PersonaTemplate>) => setDraft({ ...draft, ...patch });
  const users = lib.personas.filter((p) => p.templateId === draft.id).length;
  const badKeys = [...draft.fields.map((f) => f.key), ...draft.tables.flatMap((t) => [t.key, ...t.columns.map((c) => c.key)])].filter((k) => !KEY_PATTERN.test(k));

  const save = async () => {
    setError("");
    try {
      const t = await api.savePersonaTemplate(PersonaTemplateSchema.parse(draft));
      setSaved(JSON.stringify(t));
      onSaved(t);
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const remove = async () => {
    if (!confirm(`Delete the template "${draft.name}"?`)) return;
    try {
      await api.deletePersonaTemplate(draft.id);
      onDeleted();
    } catch (e) {
      setError((e as Error).message);
    }
  };
  /**
   * A key follows its label while it's still a placeholder (field2, col3) or was made from the
   * old label, and no persona uses the template yet; after that it stays put so saved values
   * keep matching.
   */
  const followsLabel = (key: string, oldLabel: string) => !users && (/^(field|col)\d*$/.test(key) || key === keyFromLabel(oldLabel));
  const setField = (i: number, patch: Partial<TemplateField>) => set({ fields: draft.fields.map((f, j) => (j === i ? { ...f, ...patch } : f)) });

  return (
    <div>
      <div className="row tight-top">
        <input className="scheme-name" value={draft.name} disabled={readOnly} aria-label="Template name" onChange={(e) => set({ name: e.target.value })} />
        <span className="spacer" />
        {!readOnly && <button className="btn sm ghost danger" onClick={remove}>Delete</button>}
      </div>
      <label className="field">
        <span>Description</span>
        <input value={draft.description} disabled={readOnly} placeholder="e.g. Retail banking customer with current account and cards" onChange={(e) => set({ description: e.target.value })} />
      </label>
      {users > 0 && <p className="muted small">Used by {users} persona{users === 1 ? "" : "s"}. Renaming a field's key leaves their old values behind.</p>}

      <h4>Fields</h4>
      {draft.fields.map((f, i) => (
        <div key={i} className="criterion">
          <div className="row tight-top">
            <input className="grow" value={f.label} disabled={readOnly} placeholder="Label, e.g. Account number" aria-label="Field label" onChange={(e) => {
              const label = e.target.value;
              setField(i, followsLabel(f.key, f.label) ? { label, key: keyFromLabel(label) } : { label });
            }} />
            <select value={f.type} disabled={readOnly} aria-label="Field type" onChange={(e) => setField(i, { type: e.target.value as FieldType })}>
              {FieldTypes.map((t) => <option key={t} value={t}>{TYPE_LABEL[t]}</option>)}
            </select>
            {!readOnly && <button className="link-btn" aria-label="Remove field" onClick={() => set({ fields: draft.fields.filter((_, j) => j !== i) })}>✕</button>}
          </div>
          <div className="row tight-top key-row">
            <span className="muted small">key</span>
            <input className="mono" value={f.key} disabled={readOnly} aria-label="Field key" onChange={(e) => setField(i, { key: e.target.value })} />
            {f.type === "choice" && (
              <input className="grow" value={(f.options ?? []).join(", ")} disabled={readOnly} placeholder="Options, comma-separated" aria-label="Options" onChange={(e) => setField(i, { options: e.target.value.split(",").map((o) => o.trim()).filter(Boolean) })} />
            )}
          </div>
        </div>
      ))}
      {!readOnly && <button className="btn sm" onClick={() => set({ fields: [...draft.fields, { key: `field${draft.fields.length + 1}`, label: "", type: "text" }] })}>+ Add field</button>}

      <h4>Record tables</h4>
      <p className="muted small">Lists of records each persona has, such as transactions, orders or support tickets. Show them on a screen with a "table" element.</p>
      {draft.tables.map((t, i) => {
        const setTable = (patch: Partial<PersonaTemplate["tables"][number]>) => set({ tables: draft.tables.map((x, j) => (j === i ? { ...x, ...patch } : x)) });
        return (
          <div key={i} className="criterion">
            <div className="row tight-top">
              <input className="grow" value={t.label} disabled={readOnly} placeholder="e.g. Transactions" aria-label="Table name" onChange={(e) => setTable({ label: e.target.value, ...(followsLabel(t.key, t.label) ? { key: keyFromLabel(e.target.value) } : {}) })} />
              <span className="muted small">key</span>
              <input className="mono" value={t.key} disabled={readOnly} aria-label="Table key" onChange={(e) => setTable({ key: e.target.value })} />
              {!readOnly && <button className="link-btn" aria-label="Remove table" onClick={() => set({ tables: draft.tables.filter((_, j) => j !== i) })}>✕</button>}
            </div>
            <div className="columns-row">
              {t.columns.map((c, k) => (
                <span key={k} className="column-chip">
                  <input value={c.label} disabled={readOnly} placeholder="Column" aria-label="Column label" onChange={(e) => setTable({ columns: t.columns.map((x, m) => (m === k ? { ...x, label: e.target.value, key: followsLabel(x.key, x.label) ? keyFromLabel(e.target.value) : x.key } : x)) })} />
                  <select value={c.type} disabled={readOnly} aria-label="Column type" onChange={(e) => setTable({ columns: t.columns.map((x, m) => (m === k ? { ...x, type: e.target.value as FieldType } : x)) })}>
                    {FieldTypes.filter((x) => x !== "longtext" && x !== "choice").map((x) => <option key={x} value={x}>{TYPE_LABEL[x]}</option>)}
                  </select>
                  {!readOnly && t.columns.length > 1 && <button className="link-btn" aria-label="Remove column" onClick={() => setTable({ columns: t.columns.filter((_, m) => m !== k) })}>✕</button>}
                </span>
              ))}
              {!readOnly && <button className="link-btn add" onClick={() => setTable({ columns: [...t.columns, { key: `col${t.columns.length + 1}`, label: "", type: "text" }] })}>+ column</button>}
            </div>
          </div>
        );
      })}
      {!readOnly && (
        <button className="btn sm" onClick={() => set({ tables: [...draft.tables, { key: "records", label: "Records", columns: [{ key: "date", label: "Date", type: "date" }, { key: "description", label: "Description", type: "text" }] }] })}>
          + Add table
        </button>
      )}
      {badKeys.length > 0 && <div className="alert warn small">Keys must start with a letter and use only letters, numbers and _: {badKeys.join(", ")}</div>}
      {error && <div className="alert error">{error}</div>}
      {!readOnly && (
        <div className="row">
          <span className="spacer" />
          {dirty && <span className="badge warn">Unsaved</span>}
          <button className="btn primary" disabled={(!dirty && lib.templates.some((t) => t.id === draft.id && JSON.stringify(t) === saved)) || badKeys.length > 0} onClick={save}>Save template</button>
        </div>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ AI drafting

function DraftPanel({ lib, onKept }: { lib: PersonaLibrary; onKept: (p: Persona) => void }) {
  const [description, setDescription] = useState("");
  const [count, setCount] = useState(3);
  const [templateId, setTemplateId] = useState(lib.templates[0]?.id ?? "");
  const [drafts, setDrafts] = useState<Persona[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const run = async () => {
    setBusy(true);
    setError("");
    try {
      const r = await api.draftPersonas({ description, count, templateId: templateId || null });
      setDrafts(r.personas);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const keep = async (p: Persona) => {
    try {
      const saved = await api.savePersona(p);
      setDrafts((d) => d.filter((x) => x.id !== p.id));
      if (drafts.length === 1) onKept(saved);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <div>
      <h3>✦ Draft personas with AI</h3>
      <p className="muted small">Describe who you need. Claude writes complete, fictional personas that fit the template, for you to review. Nothing is saved until you keep it.</p>
      <label className="field">
        <span>Who do you need?</span>
        <textarea rows={3} value={description} placeholder="e.g. Small-business telecom customers with billing disputes; mix of calm and frustrated; one is a long-standing loyal customer" onChange={(e) => setDescription(e.target.value)} />
      </label>
      <div className="row tight-top">
        <label className="field inline">
          <span>Template</span>
          <select value={templateId} onChange={(e) => setTemplateId(e.target.value)}>
            <option value="">No template</option>
            {lib.templates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </label>
        <label className="inline-num">How many<input type="number" min={1} max={10} value={count} onChange={(e) => setCount(Math.min(10, Math.max(1, Number(e.target.value) || 1)))} /></label>
        <button className="btn primary" disabled={!description.trim() || busy} onClick={run}>{busy ? "Writing…" : "Draft"}</button>
      </div>
      {error && <div className="alert error">{error}</div>}
      {drafts.length > 0 && (
        <div className="drafts">
          <div className="row"><b>{drafts.length} draft{drafts.length === 1 ? "" : "s"}</b><span className="spacer" /><button className="btn sm" onClick={async () => { for (const d of [...drafts]) await keep(d); }}>Keep all</button></div>
          {drafts.map((p) => (
            <article key={p.id} className="criterion">
              <div className="row tight-top"><b>{p.name}</b><span className="spacer" /><button className="btn sm primary" onClick={() => keep(p)}>Keep</button><button className="btn sm ghost" onClick={() => setDrafts(drafts.filter((x) => x.id !== p.id))}>Discard</button></div>
              <p className="small">{p.summary}</p>
              <p className="muted small">{p.backstory}</p>
              <div className="tag-row">{Object.entries(p.values).slice(0, 8).map(([k, v]) => <span key={k} className="chip">{k}: {v}</span>)}</div>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
