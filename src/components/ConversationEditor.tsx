/**
 * Scenario settings for the AI-played customer (shared/conversation.ts): channel, which persona
 * plays the customer, the brief, an optional opening line, and what good looks like.
 */
import { newId } from "../../shared/engine";
import { CHANNEL_INFO } from "../../shared/conversation";
import type { GradingScheme } from "../../shared/library";
import { resolveRoles, type PersonaLibrary } from "../../shared/personas";
import { Channels, ConversationSchema, type Conversation, type Scenario, type Simulation } from "../../shared/schema";

export function ConversationEditor({ scenario, sim, personaLib, scheme, onChange }: {
  scenario: Scenario;
  sim: Simulation;
  personaLib: PersonaLibrary | null;
  /** The grading scheme this scenario uses (to explain how the criteria are weighted). */
  scheme: GradingScheme | null;
  onChange: (c: Conversation) => void;
}) {
  const conv = scenario.conversation ?? ConversationSchema.parse({});
  const set = (patch: Partial<Conversation>) => onChange({ ...conv, ...patch });
  const roles = resolveRoles(sim.personas, scenario.personaOverrides);
  const roleNames = [...new Set([...roles.map((r) => r.role), conv.role])];
  const persona = personaLib?.personas.find((p) => p.id === roles.find((r) => r.role === conv.role)?.personaId);
  const noSystemWork = !scenario.steps.length && !scenario.alternatePaths.some((p) => p.steps.length) && !scenario.successCriteria.length;
  const setCriterion = (i: number, patch: Partial<Conversation["criteria"][number]>) =>
    set({ criteria: conv.criteria.map((c, j) => (j === i ? { ...c, ...patch } : c)) });

  return (
    <div className="conversation-editor">
      <label className="check-line">
        <input type="checkbox" checked={conv.enabled} onChange={(e) => set({ enabled: e.target.checked })} />
        The learner talks to an AI-played customer
      </label>
      {!conv.enabled ? (
        <p className="muted small">Claude plays one of this scenario's personas, beside the screens. It needs the server's Anthropic API key.</p>
      ) : (
        <>
          <div className="row">
            <label className="field">
              <span>How they're in touch</span>
              <select value={conv.channel} onChange={(e) => set({ channel: e.target.value as Conversation["channel"] })}>
                {Channels.map((c) => <option key={c} value={c}>{CHANNEL_INFO[c].icon} {CHANNEL_INFO[c].label}</option>)}
              </select>
            </label>
            <label className="field">
              <span>Customer (persona role)</span>
              <select value={conv.role} onChange={(e) => set({ role: e.target.value })}>
                {roleNames.map((r) => <option key={r} value={r}>{r}{roles.find((x) => x.role === r) ? "" : " (no persona)"}</option>)}
              </select>
            </label>
          </div>
          <p className="muted small">
            {persona
              ? <>Played by <b>{persona.name}</b>. They know their own details and share them only when asked.</>
              : <>No persona plays this role here yet, so the customer has no account details. Assign one under Personas above or in Settings.</>}
            {conv.channel !== "chat" && " Learners type what they'd say for now; voice can come later."}
          </p>
          <label className="field">
            <span>The customer's situation</span>
            <textarea
              rows={4}
              maxLength={4000}
              value={conv.brief}
              placeholder="Why they're getting in touch, how they feel, what they want, what they'll accept. E.g. Your card was declined at the shop this morning and you're embarrassed and annoyed. You want it fixed today. You get calmer if the agent apologises and explains."
              onChange={(e) => set({ brief: e.target.value })}
            />
            <small className="muted">Written to the customer ("You…"). {"{{variables}}"} work here, such as random values.</small>
          </label>
          <label className="field">
            <span>Opening line (optional)</span>
            <input maxLength={500} value={conv.opening} placeholder="Leave empty and the customer opens in their own words" onChange={(e) => set({ opening: e.target.value })} />
          </label>

          <h4>What good looks like (judged by AI)</h4>
          <p className="muted small">
            At the end of the run Claude checks the conversation against each of these and tells the learner why. Results are final straight away.
          </p>
          {conv.criteria.map((c, i) => (
            <div key={c.id} className="cond-row">
              <input
                value={c.label}
                maxLength={200}
                aria-label="Criterion"
                placeholder="e.g. Verified the customer's identity before sharing account details"
                onChange={(e) => setCriterion(i, { label: e.target.value })}
              />
              <select value={c.weight} aria-label="Weight" title="Weight" onChange={(e) => setCriterion(i, { weight: Number(e.target.value) })}>
                {[1, 2, 3, 4, 5].map((w) => <option key={w} value={w}>×{w}</option>)}
              </select>
              <button className="link-btn" aria-label="Remove criterion" onClick={() => set({ criteria: conv.criteria.filter((_, j) => j !== i) })}>✕</button>
            </div>
          ))}
          {conv.criteria.length < 12 && (
            <button className="link-btn add" onClick={() => set({ criteria: [...conv.criteria, { id: newId("c").slice(0, 12), label: "", weight: 1 }] })}>+ Criterion</button>
          )}
          {conv.criteria.length > 0 && (
            noSystemWork ? (
              <p className="muted small">This scenario has no steps, so the score comes entirely from these criteria.</p>
            ) : scheme && scheme.rubricWeight > 0 ? (
              <p className="muted small">They join the "{scheme.name}" rubric, which makes up {scheme.rubricWeight}% of the score.</p>
            ) : (
              <label className="field inline">
                <span>Share of the score from the conversation</span>
                <input type="number" min={0} max={100} value={conv.weight} onChange={(e) => set({ weight: Math.max(0, Math.min(100, Math.round(Number(e.target.value) || 0))) })} />
                <span>%</span>
              </label>
            )
          )}
        </>
      )}
    </div>
  );
}
