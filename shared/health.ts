/**
 * Simulation health for builders: is this simulation scoring properly?
 *
 * Automatic checks (no learners needed):
 *   - every path of every scenario is played by a "perfect trainee" (each step done exactly as
 *     written, nothing else). It must finish with no errors and full points; otherwise the
 *     scenario can't be passed cleanly and scores would be wrong.
 *   - after that perfect run, the automatic rubric criteria should be met; one that isn't is
 *     probably pointed at the wrong screen or state.
 *   - broken references, grading checks not set up, AI customers without a persona or criteria.
 * Warning signs from real results (once there are enough attempts):
 *   - a step where most learners lose points, a criterion nobody or everybody meets, a scenario
 *     few people finish, AI marks that reviewers often correct.
 */
import { analyzeSimulation } from "./analytics";
import { activeConversation, customerPersona } from "./conversation";
import { checkCondition, createSession, findElement, interact, interpolate, isField, isVisible, lintSimulation, type InteractionEvent, type SessionState } from "./engine";
import { activeRubric, gradeSession, resolveScheme, unboundChecks } from "./grading";
import type { GradingScheme } from "./library";
import type { PersonaLibrary } from "./personas";
import { applyRenames, effectiveRenames, type Rename } from "./refactor";
import { sessionPersonaVariables } from "./personas";
import { scenarioPaths, type Attempt, type Path, type Scenario, type Simulation, type Step } from "./schema";

export type Level = "error" | "warning" | "info";
export interface Problem {
  level: Level;
  /** "Simulation" or the scenario's title. */
  where: string;
  message: string;
  /** Problems from the auto-played paths (also shown in the paths table). */
  fromPath?: boolean;
}

export interface PathCheck {
  scenarioId: string;
  scenario: string;
  path: string;
  ok: boolean;
  /** Score a perfect trainee gets on this path. */
  score: number | null;
  detail: string;
}

export interface Health {
  status: "healthy" | "check" | "problems";
  problems: Problem[];
  paths: PathCheck[];
}

/** Need at least this many attempts before reading anything into real results. */
export const MIN_SAMPLE = 5;
const T0 = 1_000_000;

/** What a perfect trainee would do for this step, on the screen they're on. */
function perfectAction(sim: Simulation, s: SessionState, st: Step): { ev: InteractionEvent } | { problem: string } {
  const targets = [st.elementId, ...(st.alsoElementIds ?? [])].map((id) => findElement(sim, id)).filter((x) => !!x);
  if (!targets.length) return { problem: `the control it uses no longer exists` };
  const here = targets.find((t) => t.screen.id === s.screenId);
  if (!here) {
    const screen = sim.screens.find((x) => x.id === s.screenId)?.name ?? s.screenId;
    return { problem: `its control is on the "${targets[0].screen.name}" screen, but the trainee is on "${screen}" at that point, so they'd have to make a mistake to get there` };
  }
  const el = here.element;
  if (!isVisible(el, s.vars)) return { problem: `its control ("${el.label}") is hidden at that point` };
  const fixed = st.expect === "eq" || st.expect === "contains" ? interpolate(st.value, s.vars) : null;
  if (el.kind === "table" && el.rowKey) {
    const table = JSON.parse(s.vars[el.tableSource ?? ""] || "{}") as { rows?: Record<string, string>[] };
    const value = fixed ?? table.rows?.[0]?.[el.rowKey] ?? "";
    return { ev: { type: "commit", elementId: el.id, value } };
  }
  if (isField(el)) {
    const value = fixed ?? (el.kind === "checkbox" ? "true" : el.kind === "select" ? el.options?.[0] ?? "" : "Test entry");
    return { ev: { type: "commit", elementId: el.id, value } };
  }
  return { ev: { type: "activate", elementId: el.id } };
}

/** Play one path as a perfect trainee (fixed random seed, the scenario's personas). */
export function playPath(sim: Simulation, sc: Scenario, path: Path, scheme: GradingScheme, personaVars: Record<string, string>): PathCheck {
  const base = { scenarioId: sc.id, scenario: sc.title, path: path.name };
  if (!path.steps.length) return { ...base, ok: false, score: null, detail: "This path has no steps." };
  let s = createSession(sim, sc.id, T0, 12345, personaVars);
  for (const [i, st] of path.steps.entries()) {
    const action = perfectAction(sim, s, st);
    const label = `Step ${i + 1} ("${interpolate(st.instruction, s.vars)}")`;
    if ("problem" in action) return { ...base, ok: false, score: null, detail: `${label}: ${action.problem}.` };
    const before = s.errors;
    s = interact(sim, s, "scenario", action.ev, T0 + 1000 * (i + 1)).state;
    if (s.errors > before) {
      const why = s.log[s.log.length - 1]?.outcome === "wrong-value" ? "the expected value isn't accepted" : "it was scored as a mistake";
      return { ...base, ok: false, score: null, detail: `${label}: doing exactly what the step says counts as an error (${why}).` };
    }
  }
  if (!s.completed) {
    const failing = sc.successCriteria.filter((c) => !checkCondition(c, s.vars)).map((c) => `${c.var} ${c.op}${c.value ? ` "${c.value}"` : ""}`);
    return {
      ...base,
      ok: false,
      score: null,
      detail: sc.successCriteria.length
        ? `All steps done, but the scenario doesn't finish: its success checks (${failing.join("; ")}) aren't met.`
        : "All steps done, but the scenario doesn't finish.",
    };
  }
  const g = gradeSession(sim, s, scheme, T0 + 1000 * (path.steps.length + 1));
  const missed = g.rubric.filter((c) => !c.ai && !c.manual && c.met === false).map((c) => `"${c.label}"`);
  return {
    ...base,
    ok: g.pointsScore === 100 && !missed.length,
    score: g.score,
    detail:
      g.pointsScore !== 100
        ? `A perfect run scores only ${g.pointsScore} points for the steps; check the time limit and penalties.`
        : missed.length
          ? `A perfect run doesn't meet ${missed.join(", ")}. Check what ${missed.length === 1 ? "it checks" : "they check"} (screen or state targets in Settings).`
          : `A perfect run finishes with ${g.score === 100 || g.rubric.some((c) => c.ai || c.manual) ? "full points" : `${g.score}/100`}${g.rubric.some((c) => c.ai) ? " for the steps (the conversation is judged separately)" : ""}.`,
  };
}

export function checkSimulation(sim: Simulation, schemes: GradingScheme[], personas: PersonaLibrary, attempts: Attempt[] = []): Health {
  const problems: Problem[] = [];
  const paths: PathCheck[] = [];
  const add = (level: Level, where: string, message: string) => problems.push({ level, where, message });

  for (const issue of lintSimulation(sim)) add("error", "Simulation", issue);
  if (!sim.scenarios.length) add("info", "Simulation", "No scenarios yet, so nothing is scored. Learners can only explore.");

  const checkedSchemes = new Set<string>();
  for (const sc of sim.scenarios) {
    const scheme = resolveScheme(sim, sc.id, schemes);
    const conv = activeConversation(sc);
    const hasSteps = scenarioPaths(sc).some((p) => p.steps.length);
    if (!hasSteps && !conv && !sc.successCriteria.length) add("error", sc.title, "Nothing to do: no steps, no success checks and no customer conversation.");
    if (hasSteps) {
      const vars = sessionPersonaVariables(sim, sc.id, personas);
      for (const p of scenarioPaths(sc)) if (p.steps.length || p.id === "main") paths.push(playPath(sim, sc, p, scheme, vars));
    }
    if (!checkedSchemes.has(scheme.id)) {
      checkedSchemes.add(scheme.id);
      for (const label of unboundChecks(sim, scheme)) add("error", "Simulation", `Grading check "${label}" (${scheme.name}) isn't pointed at a screen or state, so it can never be met. Set it in Settings → Grading.`);
      const skipped = scheme.rubric.filter((c) => c.check.type === "manual");
      if (skipped.length && !sim.grading.trainerMarking) {
        add("info", "Simulation", `${skipped.map((c) => `"${c.label}"`).join(", ")} ${skipped.length === 1 ? "is" : "are"} trainer-marked and trainer marking is off, so ${skipped.length === 1 ? "it's" : "they're"} skipped.`);
      }
      if (scheme.rubricWeight > 0 && !activeRubric(sim, scheme).length && !conv) {
        add("warning", "Simulation", `"${scheme.name}" gives the rubric ${scheme.rubricWeight}% of the score, but no rubric criteria count here, so scores are points only.`);
      }
    }
    if (conv) {
      if (!customerPersona(sim, sc.id, personas)) add("warning", sc.title, `The AI customer ("${conv.role}") has no persona here, so they have no name or account details. Assign one in Settings → Personas.`);
      if (!conv.brief.trim()) add("warning", sc.title, "The AI customer has no situation written, so they'll improvise a generic problem.");
      if (!conv.criteria.some((c) => c.label.trim())) add("info", sc.title, "The customer conversation has no criteria, so it isn't scored.");
    }
  }
  for (const p of paths) if (!p.ok) problems.push({ level: p.score === null ? "error" : "warning", where: p.scenario, message: `${p.path}: ${p.detail}`, fromPath: true });

  // Warning signs from real results.
  const analysis = analyzeSimulation(sim, attempts);
  for (const sc of analysis.scenarios) {
    if (sc.stats.attempts >= MIN_SAMPLE && sc.stats.completedRate < 0.3) {
      add("warning", sc.title, `Only ${Math.round(sc.stats.completedRate * 100)}% of ${sc.stats.attempts} attempts were finished. The task may be unclear, too long, or blocked somewhere.`);
    }
    if (sc.flow.basedOn >= MIN_SAMPLE) {
      for (const l of sc.flow.steps) {
        if (l.lostShare >= 0.5) add("warning", sc.title, `${Math.round(l.lostShare * 100)}% of attempts lose points at step ${l.stepNo} ("${l.label}"). Check the instruction is clear and the right control and value are expected.`);
      }
    }
    for (const c of sc.rubric) {
      const decided = c.met + c.notMet;
      if (decided < MIN_SAMPLE) continue;
      if (c.metRate === 0) add("warning", sc.title, `Nobody has met "${c.label}" (${decided} attempts). Check it's achievable and measuring the right thing.`);
      if (c.metRate === 1 && !/complet/i.test(c.label)) add("info", sc.title, `Everyone has met "${c.label}" (${decided} attempts). Fine if it's meant to be basic; otherwise it isn't telling learners apart.`);
    }
  }
  // AI marks that reviewers corrected.
  const byCriterion = new Map<string, { label: string; judged: number; corrected: number }>();
  for (const a of attempts) {
    for (const c of a.grading?.rubric ?? []) {
      if (!c.ai || (c.met === null && !c.review)) continue;
      const g = byCriterion.get(c.id) ?? { label: c.label, judged: 0, corrected: 0 };
      g.judged++;
      if (c.review && c.review.originalMet !== c.met) g.corrected++;
      byCriterion.set(c.id, g);
    }
  }
  for (const g of byCriterion.values()) {
    if (g.corrected >= 2 && g.corrected / g.judged >= 0.2) {
      add("warning", "Simulation", `Reviewers corrected the AI on "${g.label}" in ${g.corrected} of ${g.judged} conversations. Consider rewording it so it's clearer what counts.`);
    }
  }

  const order: Record<Level, number> = { error: 0, warning: 1, info: 2 };
  problems.sort((a, b) => order[a.level] - order[b.level]);
  return {
    status: problems.some((p) => p.level === "error") ? "problems" : problems.some((p) => p.level === "warning") ? "check" : "healthy",
    problems,
    paths,
  };
}

export interface ImpactRow {
  simulationId: string;
  title: string;
  /** Scenario paths that played through before and would not after the change. */
  breaks: PathCheck[];
  /** Broken references the change would introduce (e.g. a step pointing at a removed control). */
  newIssues: string[];
  /** Paths checked with the new version. */
  checked: number;
}

/**
 * What a change to a tool would do to each simulation using it: auto-play every scenario
 * path before and after, and list what newly fails. Problems that already existed aren't
 * blamed on the change.
 */
export function toolImpact(
  sims: Simulation[],
  proposed: Pick<Simulation, "startScreenId" | "variables" | "screens">,
  schemes: GradingScheme[],
  personas: PersonaLibrary,
  renames: Rename[] = [],
): ImpactRow[] {
  // Renames are carried into every simulation on save, so check them with the renames applied.
  const carried = effectiveRenames(renames, proposed);
  return sims.map((sim) => {
    const next: Simulation = { ...applyRenames(sim, carried), startScreenId: proposed.startScreenId, variables: proposed.variables, screens: proposed.screens };
    const before = checkSimulation(sim, schemes, personas);
    const after = checkSimulation(next, schemes, personas);
    const key = (p: PathCheck) => `${p.scenarioId}/${p.path}`;
    const okBefore = new Set(before.paths.filter((p) => p.ok).map(key));
    const lintBefore = new Set(lintSimulation(sim));
    return {
      simulationId: sim.id,
      title: sim.title,
      breaks: after.paths.filter((p) => !p.ok && okBefore.has(key(p))),
      newIssues: lintSimulation(next).filter((i) => !lintBefore.has(i)),
      checked: after.paths.length,
    };
  });
}
