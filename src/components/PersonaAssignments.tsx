/**
 * Assigning personas, used in two places:
 *   - a simulation's ⚙ Settings: which persona plays each role everywhere
 *   - a scenario: use the simulation's persona, a different one, none, or add a role only
 *     this scenario has
 * Either place can "Adjust details": change field values (a balance, a plan, the name)
 * for just this simulation or scenario. The shared persona in the library never changes;
 * "Edit in library" is the way to change it everywhere.
 */
import { useState } from "react";
import {
  DEFAULT_ROLE,
  editableFields,
  personaVariableNames,
  resolveRoles,
  ROLE_PATTERN,
  type Persona,
  type PersonaLibrary,
  type PersonaTemplate,
} from "../../shared/personas";
import type { PersonaLink, PersonaOverride, Scenario, Simulation } from "../../shared/schema";

const libraryLink = (personaId: string) => `#/libraries/personas?persona=${encodeURIComponent(personaId)}`;

function nextRole(used: string[]): string {
  if (!used.includes(DEFAULT_ROLE)) return DEFAULT_ROLE;
  for (let i = 2; ; i++) if (!used.includes(`person${i}`)) return `person${i}`;
}

/** Field-by-field changes for one assigned persona. Empty = use the inherited value. */
function DetailsEditor({ persona, template, inherited, details, onChange, scope }: {
  persona: Persona;
  template: PersonaTemplate | null;
  /** The value each field has before this level's changes. */
  inherited: Record<string, string>;
  details: Record<string, string>;
  onChange: (d: Record<string, string>) => void;
  scope: "simulation" | "scenario";
}) {
  const fields = editableFields(persona, template);
  const changed = Object.keys(details).filter((k) => fields.some((f) => f.key === k)).length;
  const [open, setOpen] = useState(changed > 0);
  const set = (key: string, value: string) => {
    const next = { ...details };
    if (value === "") delete next[key];
    else next[key] = value;
    onChange(next);
  };
  return (
    <details className="persona-details" open={open} onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)}>
      <summary className="small">
        Adjust details for this {scope}
        {changed > 0 && <span className="badge">{changed} changed</span>}
      </summary>
      <p className="muted small">Only affects this {scope}. Leave a field empty to keep the value shown in grey.</p>
      <div className="details-grid">
        {fields.map((f) => {
          const value = details[f.key] ?? "";
          const label = `${f.label} (for this ${scope})`;
          return (
            <label key={f.key} className={`field ${value ? "changed" : ""}`}>
              <span>
                {f.label}
                {value && (
                  <button type="button" className="link-btn" title="Back to the inherited value" onClick={() => set(f.key, "")}>↺</button>
                )}
              </span>
              {f.type === "choice" ? (
                <select value={value} aria-label={label} onChange={(e) => set(f.key, e.target.value)}>
                  <option value="">{inherited[f.key] ? `${inherited[f.key]} (unchanged)` : "(unchanged)"}</option>
                  {(f.options ?? []).filter((o) => o !== inherited[f.key]).map((o) => <option key={o}>{o}</option>)}
                </select>
              ) : f.type === "longtext" ? (
                <textarea rows={2} value={value} placeholder={inherited[f.key]} aria-label={label} onChange={(e) => set(f.key, e.target.value)} />
              ) : (
                <input
                  type={f.type === "date" ? "date" : f.type === "number" || f.type === "money" ? "number" : "text"}
                  step={f.type === "money" ? "0.01" : undefined}
                  value={value}
                  placeholder={inherited[f.key]}
                  aria-label={label}
                  onChange={(e) => set(f.key, e.target.value)}
                />
              )}
              {/* Date boxes can't show a grey placeholder, so say what the value is now. */}
              {f.type === "date" && !value && inherited[f.key] && <small className="muted">now: {inherited[f.key]}</small>}
            </label>
          );
        })}
      </div>
    </details>
  );
}

function PersonaPreview({ persona, role, template }: { persona: Persona; role: string; template: PersonaTemplate | null }) {
  return (
    <div className="persona-preview small">
      {persona.summary && <div>{persona.summary}</div>}
      <a href={libraryLink(persona.id)} target="_blank" rel="noreferrer" className="muted">Edit in library ↗</a>
      <details className="var-help">
        <summary className="small">Variables</summary>
        <div className="tag-row">{personaVariableNames(role, persona, template).map((v) => <code key={v} className="chip">{`{{${v}}}`}</code>)}</div>
      </details>
    </div>
  );
}

const findPersona = (lib: PersonaLibrary, id: string | null | undefined) => (id ? lib.personas.find((p) => p.id === id) : undefined);
const findTemplate = (lib: PersonaLibrary, p: Persona | undefined) => (p ? lib.templates.find((t) => t.id === p.templateId) ?? null : null);
/** A persona's own value for each editable field. */
const ownValues = (p: Persona, t: PersonaTemplate | null) => Object.fromEntries(editableFields(p, t).map((f) => [f.key, f.value]));

// ------------------------------------------------------------------ simulation

export function SimulationPersonas({ sim, lib, onChange }: { sim: Simulation; lib: PersonaLibrary; onChange: (links: PersonaLink[]) => void }) {
  const set = (i: number, patch: Partial<PersonaLink>) => onChange(sim.personas.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  return (
    <div className="persona-assignments">
      {sim.personas.map((link, i) => {
        const persona = findPersona(lib, link.personaId);
        const tpl = findTemplate(lib, persona);
        return (
          <div key={i} className="criterion">
            <div className="cond-row">
              <input
                className="mono role-input"
                value={link.role}
                aria-label="Role"
                onChange={(e) => set(i, { role: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, "") })}
              />
              <select value={link.personaId} aria-label={`Persona for ${link.role}`} onChange={(e) => set(i, { personaId: e.target.value, details: undefined })}>
                {!persona && <option value={link.personaId}>(missing persona)</option>}
                {lib.personas.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
              <button className="link-btn" aria-label={`Remove ${link.role}`} onClick={() => onChange(sim.personas.filter((_, j) => j !== i))}>✕</button>
            </div>
            {!ROLE_PATTERN.test(link.role) && <small className="text-error">Roles are lower-case letters, numbers and _, starting with a letter.</small>}
            {persona && (
              <>
                <PersonaPreview persona={persona} role={link.role} template={tpl} />
                <DetailsEditor
                  persona={persona}
                  template={tpl}
                  inherited={ownValues(persona, tpl)}
                  details={link.details ?? {}}
                  scope="simulation"
                  onChange={(d) => set(i, { details: Object.keys(d).length ? d : undefined })}
                />
              </>
            )}
          </div>
        );
      })}
      <button className="btn sm" onClick={() => onChange([...sim.personas, { role: nextRole(sim.personas.map((p) => p.role)), personaId: lib.personas[0].id }])}>
        + Assign a persona
      </button>
    </div>
  );
}

// ------------------------------------------------------------------ scenario

export function ScenarioPersonas({ sim, scenario, lib, onChange }: {
  sim: Simulation;
  scenario: Scenario;
  lib: PersonaLibrary;
  onChange: (overrides: PersonaOverride[]) => void;
}) {
  const simRoles = sim.personas.map((l) => l.role);
  const scenarioOnly = scenario.personaOverrides.filter((o) => !simRoles.includes(o.role)).map((o) => o.role);
  const roles = [...simRoles, ...scenarioOnly.filter((r, i, a) => a.indexOf(r) === i)];
  const resolved = resolveRoles(sim.personas, scenario.personaOverrides);

  const put = (role: string, o: PersonaOverride | null) => {
    const rest = scenario.personaOverrides.filter((x) => x.role !== role);
    onChange(o ? [...rest, o] : rest);
  };

  return (
    <div className="persona-assignments">
      {roles.map((role) => {
        const link = sim.personas.find((l) => l.role === role);
        const o = scenario.personaOverrides.find((x) => x.role === role);
        const choice = o?.personaId === null ? "__none" : o?.personaId === undefined ? (link ? "__same" : "") : o.personaId;
        const r = resolved.find((x) => x.role === role);
        const persona = findPersona(lib, r?.personaId);
        const tpl = findTemplate(lib, persona);
        const simPersona = link ? findPersona(lib, link.personaId) : undefined;
        // What the fields read before this scenario's changes.
        const inherited = persona
          ? { ...ownValues(persona, tpl), ...(choice === "__same" ? link?.details ?? {} : {}) }
          : {};
        return (
          <div key={role} className="criterion">
            <div className="cond-row">
              <code className="role-name">{role}</code>
              <select
                value={choice}
                aria-label={`Persona for ${role} in this scenario`}
                onChange={(e) => {
                  const v = e.target.value;
                  if (v === "__same") put(role, null);
                  else if (v === "__none") put(role, { role, personaId: null });
                  else put(role, { role, personaId: v });
                }}
              >
                {link && <option value="__same">Same as simulation ({simPersona?.name ?? "missing persona"})</option>}
                {link && <option value="__none">No persona in this scenario</option>}
                {lib.personas.filter((p) => !link || p.id !== link.personaId).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
              {!link && <button className="link-btn" aria-label={`Remove ${role}`} onClick={() => put(role, null)}>✕</button>}
            </div>
            {!link && <small className="muted">Only in this scenario.</small>}
            {persona && (
              <>
                <PersonaPreview persona={persona} role={role} template={tpl} />
                <DetailsEditor
                  persona={persona}
                  template={tpl}
                  inherited={inherited}
                  details={o?.details ?? {}}
                  scope="scenario"
                  onChange={(d) => {
                    const details = Object.keys(d).length ? d : undefined;
                    if (choice === "__same") put(role, details ? { role, details } : null);
                    else put(role, { role, personaId: o?.personaId, details });
                  }}
                />
              </>
            )}
          </div>
        );
      })}
      {roles.length === 0 && <p className="muted small">No personas yet. Assign one here, or for the whole simulation in ⚙ Settings.</p>}
      <button className="btn sm" onClick={() => put(nextRole(roles), { role: nextRole(roles), personaId: lib.personas[0].id })}>
        + Assign a persona to this scenario
      </button>
    </div>
  );
}
