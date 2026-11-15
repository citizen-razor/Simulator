/**
 * Assigning personas, used in two places:
 *   - a simulation's ⚙ Settings: which persona plays each role everywhere
 *   - a scenario: use the simulation's persona, a different one, none, or add a role only
 *     this scenario has
 *
 * A persona is one record, like a real customer. "✎ Edit persona" opens that record right
 * here; saving changes it everywhere it's used: every scenario, open world and guided run.
 * Editing is for the Admin-Builder (others see it read-only, with the unlock bar).
 * Simulations and scenarios only choose WHICH persona plays a role, never its details.
 */
import { createContext, useContext, useState } from "react";
import {
  DEFAULT_ROLE,
  personaVariableNames,
  resolveRoles,
  ROLE_PATTERN,
  type Persona,
  type PersonaLibrary,
  type PersonaTemplate,
} from "../../shared/personas";
import type { PersonaLink, PersonaOverride, Scenario, Simulation } from "../../shared/schema";
import { PersonaEditor } from "../pages/PersonaLibrary";
import { useAdmin } from "../lib/admin";

/** Lets an embedded persona editor tell the page to reload the persona library after a save. */
export const ReloadPersonasContext = createContext<() => void>(() => undefined);

const libraryLink = (personaId: string) => `#/libraries/personas?persona=${encodeURIComponent(personaId)}`;

function nextRole(used: string[]): string {
  if (!used.includes(DEFAULT_ROLE)) return DEFAULT_ROLE;
  for (let i = 2; ; i++) if (!used.includes(`person${i}`)) return `person${i}`;
}

const findPersona = (lib: PersonaLibrary, id: string | null | undefined) => (id ? lib.personas.find((p) => p.id === id) : undefined);
const findTemplate = (lib: PersonaLibrary, p: Persona | undefined) => (p ? lib.templates.find((t) => t.id === p.templateId) ?? null : null);

/** Summary, variables, and an in-place editor for the persona record itself. */
function PersonaCard({ persona, role, template, lib }: { persona: Persona; role: string; template: PersonaTemplate | null; lib: PersonaLibrary }) {
  const [editing, setEditing] = useState(false);
  const reload = useContext(ReloadPersonasContext);
  const { isAdmin } = useAdmin();
  return (
    <div className="persona-preview small">
      {persona.summary && <div>{persona.summary}</div>}
      <div className="row tight-top">
        <button className={`btn sm ${editing ? "" : "ghost"}`} onClick={() => setEditing(!editing)} aria-expanded={editing}>
          {editing ? "Close" : isAdmin ? "✎ Edit persona" : "View persona"}
        </button>
        <a href={libraryLink(persona.id)} target="_blank" rel="noreferrer" className="muted">Open in library ↗</a>
      </div>
      {editing && (
        <div className="embedded-persona">
          <PersonaEditor key={persona.id} persona={persona} lib={lib} readOnly={!isAdmin} onSaved={() => reload()} />
        </div>
      )}
      <details className="var-help">
        <summary className="small">Variables</summary>
        <div className="tag-row">{personaVariableNames(role, persona, template).map((v) => <code key={v} className="chip">{`{{${v}}}`}</code>)}</div>
      </details>
    </div>
  );
}

// ------------------------------------------------------------------ simulation

export function SimulationPersonas({ sim, lib, onChange }: { sim: Simulation; lib: PersonaLibrary; onChange: (links: PersonaLink[]) => void }) {
  const set = (i: number, patch: Partial<PersonaLink>) => onChange(sim.personas.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  return (
    <div className="persona-assignments">
      {sim.personas.map((link, i) => {
        const persona = findPersona(lib, link.personaId);
        return (
          <div key={i} className="criterion">
            <div className="cond-row">
              <input
                className="mono role-input"
                value={link.role}
                aria-label="Role"
                onChange={(e) => set(i, { role: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, "") })}
              />
              <select value={link.personaId} aria-label={`Persona for ${link.role}`} onChange={(e) => set(i, { personaId: e.target.value })}>
                {!persona && <option value={link.personaId}>(missing persona)</option>}
                {lib.personas.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
              <button className="link-btn" aria-label={`Remove ${link.role}`} onClick={() => onChange(sim.personas.filter((_, j) => j !== i))}>✕</button>
            </div>
            {!ROLE_PATTERN.test(link.role) && <small className="text-error">Roles are lower-case letters, numbers and _, starting with a letter.</small>}
            {persona && <PersonaCard persona={persona} role={link.role} template={findTemplate(lib, persona)} lib={lib} />}
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
  const scenarioOnly = scenario.personaOverrides.filter((o) => !simRoles.includes(o.role) && o.personaId).map((o) => o.role);
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
        const choice = o?.personaId === null ? "__none" : o?.personaId ? o.personaId : link ? "__same" : "";
        const persona = findPersona(lib, resolved.find((x) => x.role === role)?.personaId);
        const simPersona = link ? findPersona(lib, link.personaId) : undefined;
        return (
          <div key={role} className="criterion">
            <div className="cond-row">
              <code className="role-name">{role}</code>
              <select
                value={choice}
                aria-label={`Persona for ${role} in this scenario`}
                onChange={(e) => {
                  const v = e.target.value;
                  put(role, v === "__same" ? null : { role, personaId: v === "__none" ? null : v });
                }}
              >
                {link && <option value="__same">Same as simulation ({simPersona?.name ?? "missing persona"})</option>}
                {link && <option value="__none">No persona in this scenario</option>}
                {lib.personas.filter((p) => !link || p.id !== link.personaId).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
              {!link && <button className="link-btn" aria-label={`Remove ${role}`} onClick={() => put(role, null)}>✕</button>}
            </div>
            {!link && <small className="muted">Only in this scenario.</small>}
            {persona && <PersonaCard persona={persona} role={role} template={findTemplate(lib, persona)} lib={lib} />}
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
