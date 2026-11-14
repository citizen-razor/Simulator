/**
 * The editor's Settings panel: title and description, tags from the topic/tag library,
 * and the grading scheme, including where this simulation's screen and state checks point.
 */
import { BINDABLE_CHECKS, DEFAULT_SCHEME_ID, type Binding, type GradingScheme, type Taxonomy } from "../../shared/library";
import { boundCheck, unboundChecks } from "../../shared/grading";
import type { Condition, Simulation } from "../../shared/schema";
import { ConditionsEditor } from "./Inspector";
import type { PersonaLibrary } from "../../shared/personas";
import { SimulationPersonas } from "./PersonaAssignments";

export function SimSettings({ sim, taxonomy, schemes, personaLib, update }: {
  personaLib: PersonaLibrary | null;
  sim: Simulation;
  taxonomy: Taxonomy | null;
  schemes: GradingScheme[] | null;
  update: (fn: (d: Simulation) => void, key?: string) => void;
}) {
  const scheme = schemes?.find((s) => s.id === (sim.grading.schemeId ?? DEFAULT_SCHEME_ID)) ?? schemes?.find((s) => s.id === DEFAULT_SCHEME_ID);
  const bindable = scheme ? [...scheme.rubric, ...scheme.objectives].filter((i) => BINDABLE_CHECKS.includes(i.check.type)) : [];
  const missing = scheme ? unboundChecks(sim, scheme) : [];
  const knownTags = new Set(taxonomy?.topics.flatMap((t) => t.tags.map((x) => x.id)) ?? []);

  const toggleTag = (id: string) =>
    update((d) => {
      d.tagIds = d.tagIds.includes(id) ? d.tagIds.filter((t) => t !== id) : [...d.tagIds, id];
    });

  const setBinding = (itemId: string, patch: Partial<Binding>) =>
    update((d) => {
      const rest = d.grading.bindings.filter((b) => b.itemId !== itemId);
      const cur = d.grading.bindings.find((b) => b.itemId === itemId) ?? { itemId };
      d.grading.bindings = [...rest, { ...cur, ...patch }];
    }, `binding-${itemId}`);

  return (
    <div className="inspector">
      <h3>Simulation</h3>
      <label className="field">
        <span>Title</span>
        <input value={sim.title} onChange={(e) => update((d) => { d.title = e.target.value; }, "title")} />
      </label>
      <label className="field">
        <span>Description</span>
        <textarea rows={4} value={sim.description} onChange={(e) => update((d) => { d.description = e.target.value; }, "desc")} />
      </label>

      <h4>Tags</h4>
      {!taxonomy ? (
        <p className="muted small">Loading…</p>
      ) : taxonomy.topics.length === 0 ? (
        <p className="muted small">No topics or tags yet. An admin can add them in <a href="#/libraries/tags">Libraries</a>.</p>
      ) : (
        <div className="tag-picker">
          {taxonomy.topics.map((topic) => (
            <div key={topic.id}>
              <div className="muted small">{topic.name}</div>
              <div className="tag-row">
                {topic.tags.map((tag) => (
                  <button
                    key={tag.id}
                    className={`tag-toggle ${sim.tagIds.includes(tag.id) ? "on" : ""}`}
                    aria-pressed={sim.tagIds.includes(tag.id)}
                    onClick={() => toggleTag(tag.id)}
                  >
                    {sim.tagIds.includes(tag.id) ? "✓ " : ""}{tag.name}
                  </button>
                ))}
                {topic.tags.length === 0 && <span className="muted small">No tags in this topic</span>}
              </div>
            </div>
          ))}
          {sim.tagIds.some((t) => !knownTags.has(t)) && (
            <p className="muted small">
              Some tags no longer exist in the library.{" "}
              <button className="link-btn add" onClick={() => update((d) => { d.tagIds = d.tagIds.filter((t) => knownTags.has(t)); })}>Remove them</button>
            </p>
          )}
        </div>
      )}

      <h4>Personas</h4>
      {!personaLib ? (
        <p className="muted small">Loading…</p>
      ) : personaLib.personas.length === 0 ? (
        <p className="muted small">No personas yet. An admin can create them in <a href="#/libraries/personas">Libraries → Personas</a>.</p>
      ) : (
        <>
          <p className="muted small">
            Assign personas to roles for the whole simulation. Their details fill the screens, e.g. <code>{"{{customer.name}}"}</code>.
            Each scenario can use a different persona. A persona is one record: editing it changes it everywhere it's used.
          </p>
          <SimulationPersonas sim={sim} lib={personaLib} onChange={(links) => update((d) => { d.personas = links; }, "persona-links")} />
        </>
      )}

      <h4>Grading</h4>
      {!schemes ? (
        <p className="muted small">Loading…</p>
      ) : (
        <>
          <label className="field">
            <span>Grading scheme</span>
            <select value={sim.grading.schemeId ?? DEFAULT_SCHEME_ID} onChange={(e) => update((d) => { d.grading.schemeId = e.target.value === DEFAULT_SCHEME_ID ? null : e.target.value; })}>
              {schemes.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
            {scheme?.description && <small className="muted">{scheme.description}</small>}
            <small className="muted">Individual scenarios can use a different scheme. Manage schemes in <a href="#/libraries/grading">Libraries</a>.</small>
          </label>
          {bindable.length > 0 && (
            <div className="bindings">
              <p className="small"><b>Point this scheme's checks at this simulation</b></p>
              {bindable.map((item) => {
                const check = boundCheck(sim, item);
                return (
                  <div key={item.id} className="criterion">
                    <div className="small"><b>{item.label || "(unnamed)"}</b></div>
                    {check.type === "screen" ? (
                      <select value={check.screenId ?? ""} onChange={(e) => setBinding(item.id, { screenId: e.target.value || undefined })} aria-label={`Screen for ${item.label}`}>
                        <option value="">Choose the screen to reach…</option>
                        {sim.screens.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                      </select>
                    ) : (
                      <ConditionsEditor
                        value={check.conditions ?? []}
                        onChange={(c: Condition[]) => setBinding(item.id, { conditions: c })}
                        sim={sim}
                        emptyText="Add the condition(s) the system state must meet."
                      />
                    )}
                  </div>
                );
              })}
            </div>
          )}
          {missing.length > 0 && (
            <div className="alert warn small">Not set up yet, so these can never be met: {missing.join(", ")}.</div>
          )}
        </>
      )}
    </div>
  );
}
