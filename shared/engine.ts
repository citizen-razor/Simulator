/**
 * The simulation engine: pure functions, no React, no network.
 *
 * The Player keeps ONE SessionState and passes it through `interact()` on every
 * click or field change. Modes do not own separate state, they only change how
 * an interaction is judged:
 *
 *   open      every interaction just runs its rules. No goals, no scoring.
 *   guided    the next step's element is highlighted; wrong clicks are blocked
 *             with a hint, so the trainee can't get lost.
 *   scenario  no hints shown; wrong clicks still happen (like real life) but
 *             count as errors, and the attempt is scored at the end.
 *
 * Because state is shared, switching modes mid-run keeps the trainee exactly
 * where they are. Switching to guided during a scenario marks it "assisted".
 *
 * A scenario can have several valid paths (its main steps plus alternatePaths).
 * Progress is tracked on every path at once: an interaction is correct if it is the
 * next step of ANY path, and shared opening steps advance all paths together. The
 * "lead" path is the one the trainee is currently following; guidance and scoring
 * use it, and it switches when the trainee takes a step only another path has.
 */
import {
  FIELD_KINDS,
  MAIN_PATH_ID,
  scenarioPaths,
  stepTargets,
  type Path,
  type Action,
  type Condition,
  type Scenario,
  type Screen,
  type SimElement,
  type Simulation,
  type Step,
  type PenaltyEvent,
} from "./schema";
import { generateValues, newSeed } from "./random";
import { parseTableVar } from "./personas";

export type Mode = "open" | "guided" | "scenario";
export type Tone = "info" | "success" | "error";
export interface Feedback {
  tone: Tone;
  text: string;
}

export interface SessionState {
  screenId: string;
  vars: Record<string, string>;
  scenarioId: string | null;
  /** Steps completed on the lead path (kept in sync with pathProgress[leadPath]). */
  stepIndex: number;
  /** Steps completed on each path, by path id. */
  pathProgress: Record<string, number>;
  /** The path the trainee is following. */
  leadPath: string;
  errors: number;
  hintsUsed: number;
  mistakes: string[];
  assisted: boolean;
  finished: boolean;
  completed: boolean;
  startedAt: number;
  finishedAt: number | null;
  /** Screens visited, most recent last (last 50). */
  history: string[];
  /** Every screen visited at least once (for coverage objectives). */
  visited: string[];
  /** Field element ids the trainee has edited (lets out-of-order field steps auto-complete). */
  touched: string[];
  /** Instruction of the step the trainee was on each time they made an error or took a hint. */
  troubleSteps: string[];
  /** Each error and hint with the step it happened on (for the points breakdown). */
  penalties: PenaltyEvent[];
  /** Seed for this run's random data, and the values it produced. */
  seed: number;
  generated: Record<string, string>;
}

export type InteractionEvent =
  | { type: "activate"; elementId: string }
  | { type: "commit"; elementId: string; value: string };

export interface InteractionResult {
  state: SessionState;
  feedback: Feedback[];
  /** Guided mode refused the interaction. */
  blocked: boolean;
  completedStep: Step | null;
}

// ---------------------------------------------------------------- helpers

export function interpolate(template: string | undefined, vars: Record<string, string>): string {
  if (!template) return "";
  return template.replace(/\{\{\s*([\w.-]+)\s*\}\}/g, (_, name: string) => vars[name] ?? "");
}

export function checkCondition(c: Condition, vars: Record<string, string>): boolean {
  const actual = (vars[c.var] ?? "").trim();
  const expected = interpolate(c.value, vars).trim();
  switch (c.op) {
    case "eq":
      return actual.toLowerCase() === expected.toLowerCase();
    case "neq":
      return actual.toLowerCase() !== expected.toLowerCase();
    case "contains":
      return actual.toLowerCase().includes(expected.toLowerCase());
    case "empty":
      return actual === "";
    case "notEmpty":
      return actual !== "";
  }
}

export function checkAll(conds: Condition[] | undefined, vars: Record<string, string>): boolean {
  return (conds ?? []).every((c) => checkCondition(c, vars));
}

export const isField = (el: SimElement) => FIELD_KINDS.includes(el.kind);
export const fieldVar = (el: SimElement) => el.bindVar || el.id;

/** A clicked table row's columns as <variable>.<column>, e.g. selected_order.status. */
export function selectedRowVars(el: SimElement, value: string, vars: Record<string, string>): Record<string, string> {
  const table = parseTableVar(vars[el.tableSource ?? ""]);
  const row = table?.rows.find((r) => (r[el.rowKey ?? ""] ?? "") === value);
  if (!table || !row) return {};
  return Object.fromEntries(table.columns.map((c) => [`${fieldVar(el)}.${c.key}`, row[c.key] ?? ""]));
}
export const isVisible = (el: SimElement, vars: Record<string, string>) => checkAll(el.visibleIf, vars);

export function getScreen(sim: Simulation, id: string): Screen | undefined {
  return sim.screens.find((s) => s.id === id);
}

export function findElement(sim: Simulation, elementId: string): { screen: Screen; element: SimElement } | null {
  for (const screen of sim.screens) {
    const element = screen.elements.find((e) => e.id === elementId);
    if (element) return { screen, element };
  }
  return null;
}

export function getScenario(sim: Simulation, id: string | null): Scenario | undefined {
  return id ? sim.scenarios.find((s) => s.id === id) : undefined;
}

/** The path the trainee is following (main path if unknown). */
export function leadingPath(sim: Simulation, state: SessionState): Path | null {
  const sc = getScenario(sim, state.scenarioId);
  if (!sc) return null;
  const paths = scenarioPaths(sc);
  return paths.find((p) => p.id === state.leadPath) ?? paths[0];
}

export function currentStep(sim: Simulation, state: SessionState): Step | null {
  if (state.finished) return null;
  const path = leadingPath(sim, state);
  return path?.steps[state.pathProgress[path.id] ?? 0] ?? null;
}

function valueMatches(step: Step, value: string, vars: Record<string, string>): boolean {
  const v = value.trim().toLowerCase();
  const expected = interpolate(step.value, vars).trim().toLowerCase();
  if (step.expect === "eq") return v === expected;
  if (step.expect === "contains") return v.includes(expected);
  return v !== "";
}

const describe = (el: SimElement) => `"${el.label || el.id}"`;

// ---------------------------------------------------------------- session

/**
 * Start a run. Variables get their initial values, then the personas' details
 * (`personaVars`, see shared/personas.ts), then this run's random values (unless the
 * scenario turns randomising off), then the scenario's starting-state overrides, which
 * may themselves use {{templates}} of any of those.
 */
export function createSession(
  sim: Simulation,
  scenarioId: string | null,
  now = Date.now(),
  seed = newSeed(),
  personaVars: Record<string, string> = {},
): SessionState {
  const vars: Record<string, string> = {};
  for (const v of sim.variables) vars[v.name] = v.initial ?? "";
  Object.assign(vars, personaVars);
  const sc = getScenario(sim, scenarioId);
  const generated = !sc || sc.randomize ? generateValues(sim.randomData, seed, new Date(now)) : {};
  Object.assign(vars, generated);
  for (const iv of sc?.initialVars ?? []) vars[iv.name] = interpolate(iv.value, vars);
  const start =
    (sc?.startScreenId && getScreen(sim, sc.startScreenId)?.id) ||
    getScreen(sim, sim.startScreenId)?.id ||
    sim.screens[0].id;
  return {
    screenId: start,
    vars,
    scenarioId: sc ? sc.id : null,
    stepIndex: 0,
    pathProgress: Object.fromEntries((sc ? scenarioPaths(sc) : []).map((p) => [p.id, 0])),
    leadPath: MAIN_PATH_ID,
    errors: 0,
    hintsUsed: 0,
    mistakes: [],
    assisted: false,
    finished: false,
    completed: false,
    startedAt: now,
    finishedAt: null,
    history: [start],
    visited: [start],
    touched: [],
    troubleSteps: [],
    penalties: [],
    seed,
    generated,
  };
}

/** Call when the trainee changes mode. Keeps all state. */
export function switchMode(state: SessionState, to: Mode): SessionState {
  if (to === "guided" && state.scenarioId && !state.finished) return { ...state, assisted: true };
  return state;
}

export function takeHint(sim: Simulation, state: SessionState): { state: SessionState; hint: string } {
  const step = currentStep(sim, state);
  if (!step) return { state, hint: "" };
  const target = findElement(sim, step.elementId);
  const where =
    target && target.screen.id !== state.screenId ? ` (on the "${target.screen.name}" screen)` : "";
  const hint = interpolate(step.hint || step.instruction, state.vars) + where;
  return {
    state: {
      ...state,
      hintsUsed: state.hintsUsed + 1,
      troubleSteps: [...state.troubleSteps, step.instruction],
      penalties: [...state.penalties, { kind: "hint", stepNo: state.stepIndex + 1, step: step.instruction }],
    },
    hint,
  };
}

function runActions(actions: Action[], state: SessionState, sim: Simulation, feedback: Feedback[]) {
  for (const a of actions) {
    switch (a.type) {
      case "navigate":
        if (a.screenId && getScreen(sim, a.screenId)) {
          state.screenId = a.screenId;
          state.history = [...state.history, a.screenId].slice(-50);
          if (!state.visited.includes(a.screenId)) state.visited = [...state.visited, a.screenId];
        }
        break;
      case "set":
        if (a.var) state.vars = { ...state.vars, [a.var]: interpolate(a.value, state.vars) };
        break;
      case "toggle":
        if (a.var) state.vars = { ...state.vars, [a.var]: state.vars[a.var] === "true" ? "false" : "true" };
        break;
      case "message":
        feedback.push({ tone: a.tone ?? "info", text: interpolate(a.value, state.vars) });
        break;
    }
  }
}

function runRules(el: SimElement, state: SessionState, sim: Simulation, feedback: Feedback[]) {
  const rule = el.rules.find((r) => checkAll(r.if, state.vars));
  if (rule) runActions(rule.then, state, sim, feedback);
}

/** A field step is already satisfied if one of its fields was touched and holds a matching value. */
function fieldStepSatisfied(sim: Simulation, state: SessionState, step: Step): boolean {
  return stepTargets(step).some((id) => {
    const target = findElement(sim, id);
    if (!target || !isField(target.element)) return false;
    // Only count fields the trainee actually edited; avoids pre-filled defaults counting.
    if (!state.touched.includes(id)) return false;
    return valueMatches(step, state.vars[fieldVar(target.element)] ?? "", state.vars);
  });
}

/**
 * On every path, advance past field steps the trainee already satisfied (e.g. fields
 * filled out of order), then check for completion. A scenario is complete when any
 * non-empty path is finished and the success criteria pass (or, with no steps at all,
 * when the criteria pass).
 */
function settle(sim: Simulation, state: SessionState, now: number) {
  const sc = getScenario(sim, state.scenarioId);
  if (!sc || state.finished) return;
  const paths = scenarioPaths(sc);
  const progress = { ...state.pathProgress };
  for (const p of paths) {
    let i = progress[p.id] ?? 0;
    while (p.steps[i] && fieldStepSatisfied(sim, state, p.steps[i])) i++;
    progress[p.id] = i;
  }
  state.pathProgress = progress;
  const withSteps = paths.filter((p) => p.steps.length > 0);
  const done = withSteps.find((p) => progress[p.id] >= p.steps.length);
  if (done) state.leadPath = done.id;
  state.stepIndex = progress[state.leadPath] ?? 0;
  const criteriaOnly = withSteps.length === 0 && sc.successCriteria.length > 0;
  if ((done || criteriaOnly) && checkAll(sc.successCriteria, state.vars)) {
    state.finished = true;
    state.completed = true;
    state.finishedAt = now;
  }
}

/**
 * Apply one trainee interaction. Returns a NEW state (the input is not mutated).
 */
export function interact(
  sim: Simulation,
  prev: SessionState,
  mode: Mode,
  ev: InteractionEvent,
  now = Date.now(),
): InteractionResult {
  const feedback: Feedback[] = [];
  const screen = getScreen(sim, prev.screenId);
  const el = screen?.elements.find((e) => e.id === ev.elementId);
  if (!screen || !el || !isVisible(el, prev.vars) || el.kind === "text" || (el.kind === "table" && (!el.rowKey || ev.type !== "commit"))) {
    return { state: prev, feedback, blocked: false, completedStep: null };
  }

  const state: SessionState = { ...prev };
  // Any interaction judged in guided mode makes the run "assisted", however it started.
  if (mode === "guided" && prev.scenarioId && !prev.finished) state.assisted = true;
  const judging = mode !== "open" && !!state.scenarioId && !state.finished;
  const step = judging ? currentStep(sim, state) : null;
  const fieldCommit = ev.type === "commit";

  // Check this interaction against the next step of every path.
  const sc = judging ? getScenario(sim, state.scenarioId) : undefined;
  const matchedPaths: Path[] = [];
  let wrongValueStep: Step | null = null; // right field, wrong value
  for (const p of sc ? scenarioPaths(sc) : []) {
    const next = p.steps[state.pathProgress[p.id] ?? 0];
    if (!next || !stepTargets(next).includes(el.id)) continue;
    if (ev.type === "activate" || valueMatches(next, ev.value, state.vars)) matchedPaths.push(p);
    else wrongValueStep ??= next;
  }
  const matches = matchedPaths.length > 0;
  const isTarget = matches || !!wrongValueStep;
  const hintStep = wrongValueStep ?? step;
  const say = (text: string) => interpolate(text, state.vars);

  if (judging && step && !matches) {
    if (fieldCommit && !isTarget) {
      // Filling in a different field is never penalised; it may satisfy a later step.
      if (mode === "guided") feedback.push({ tone: "info", text: `Next: ${say(step.instruction)}` });
    } else if (mode === "guided") {
      const text = isTarget
        ? `That value isn't quite right. ${say(hintStep!.hint ?? hintStep!.instruction)}`
        : `Not yet. ${say(step.instruction)}`;
      const mistake = isTarget ? `Wrong value in ${describe(el)}` : `Clicked ${describe(el)} instead of the next step`;
      const blockedState = {
        ...prev,
        assisted: true,
        errors: prev.errors + 1,
        mistakes: [...prev.mistakes, mistake],
        troubleSteps: [...prev.troubleSteps, (isTarget ? hintStep! : step).instruction],
        penalties: [...prev.penalties, { kind: "error" as const, stepNo: prev.stepIndex + 1, step: (isTarget ? hintStep! : step).instruction }],
      };
      if (fieldCommit) {
        // Keep what they typed so the field doesn't reset, but don't advance.
        blockedState.vars = { ...prev.vars, [fieldVar(el)]: ev.value };
        if (!prev.touched.includes(el.id)) blockedState.touched = [...prev.touched, el.id];
      }
      return { state: blockedState, feedback: [{ tone: "error", text }], blocked: true, completedStep: null };
    } else {
      state.errors++;
      state.troubleSteps = [...state.troubleSteps, (isTarget ? hintStep! : step).instruction];
      state.penalties = [...state.penalties, { kind: "error", stepNo: prev.stepIndex + 1, step: (isTarget ? hintStep! : step).instruction }];
      state.mistakes = [
        ...state.mistakes,
        isTarget ? `Wrong value in ${describe(el)} (step: ${say(hintStep!.instruction)})` : `Used ${describe(el)} when the step was: ${say(step.instruction)}`,
      ];
    }
  }

  // Apply the interaction to the simulated system.
  if (ev.type === "commit") {
    state.vars = { ...state.vars, [fieldVar(el)]: ev.value, ...(el.kind === "table" ? selectedRowVars(el, ev.value, state.vars) : {}) };
    if (!state.touched.includes(el.id)) state.touched = [...state.touched, el.id];
  }
  runRules(el, state, sim, feedback);

  let completedStep: Step | null = null;
  if (judging && matches) {
    // Advance every path this step belongs to. Stay on the lead path if it matched;
    // otherwise the trainee has chosen another valid path, so follow that one.
    const progress = { ...state.pathProgress };
    for (const p of matchedPaths) progress[p.id] = (progress[p.id] ?? 0) + 1;
    const lead = matchedPaths.find((p) => p.id === state.leadPath) ?? matchedPaths[0];
    completedStep = lead.steps[(state.pathProgress[lead.id] ?? 0)];
    state.pathProgress = progress;
    state.leadPath = lead.id;
    state.stepIndex = progress[lead.id];
    if (mode === "guided") feedback.push({ tone: "success", text: "Correct." });
  }
  if (judging) settle(sim, state, now);
  if (state.completed && !prev.completed) {
    feedback.push({ tone: "success", text: "Scenario complete!" });
  }
  return { state, feedback, blocked: false, completedStep };
}

export interface ScoreSummary {
  score: number;
  stepsCompleted: number;
  stepsTotal: number;
  durationSec: number;
  /** Name of the path the score is measured against. */
  pathName: string;
}

/**
 * Points: 100 for full completion (partial runs by progress), minus a penalty per error
 * and per hint. Defaults match the Standard grading scheme; shared/grading.ts passes a
 * scheme's own penalties and adds time limits and rubrics on top.
 */
export function scoreSession(
  sim: Simulation,
  state: SessionState,
  now = Date.now(),
  rules: { errorPenalty: number; hintPenalty: number } = { errorPenalty: 10, hintPenalty: 5 },
): ScoreSummary {
  const path = leadingPath(sim, state);
  const total = path?.steps.length ?? 0;
  const done = Math.min(path ? state.pathProgress[path.id] ?? 0 : 0, total);
  const progress = state.completed ? 1 : total ? done / total : 0;
  const score = Math.max(0, Math.round(100 * progress - rules.errorPenalty * state.errors - rules.hintPenalty * state.hintsUsed));
  const end = state.finishedAt ?? now;
  return {
    score,
    stepsCompleted: done,
    stepsTotal: total,
    durationSec: Math.round((end - state.startedAt) / 1000),
    pathName: path?.name ?? "",
  };
}

// ---------------------------------------------------------------- validation

/** Finds broken references that the type schema can't catch (e.g. a step pointing at a deleted element). */
export function lintSimulation(sim: Simulation): string[] {
  const issues: string[] = [];
  const screenIds = new Set(sim.screens.map((s) => s.id));
  const elementIds = new Map<string, string>();
  const varNames = new Set(sim.variables.map((v) => v.name));
  for (const s of sim.screens) for (const e of s.elements) {
    if (elementIds.has(e.id)) issues.push(`Element id "${e.id}" is used on more than one screen.`);
    elementIds.set(e.id, s.id);
    if (isField(e)) varNames.add(fieldVar(e));
  }
  if (!screenIds.has(sim.startScreenId)) issues.push(`Start screen "${sim.startScreenId}" does not exist.`);
  for (const s of sim.screens) for (const e of s.elements) for (const r of e.rules) for (const a of r.then) {
    if (a.type === "navigate" && !screenIds.has(a.screenId ?? "")) {
      issues.push(`"${e.label}" on ${s.name} navigates to missing screen "${a.screenId}".`);
    }
    if ((a.type === "set" || a.type === "toggle") && a.var && !varNames.has(a.var)) {
      issues.push(`"${e.label}" on ${s.name} sets undeclared variable "${a.var}".`);
    }
  }
  for (const s of sim.screens) for (const e of s.elements) {
    if (e.kind === "table" && !e.tableSource) issues.push(`Table "${e.label}" on ${s.name} doesn't say which table to show.`);
  }
  const roles = new Set<string>();
  for (const p of sim.personas) {
    if (roles.has(p.role)) issues.push(`The persona role "${p.role}" is set twice.`);
    roles.add(p.role);
  }
  for (const g of sim.randomData) {
    if (!varNames.has(g.var)) issues.push(`Random values are set for "${g.var}", which isn't a declared variable.`);
    if (g.kind === "pick" && !(g.options ?? []).some((o) => o.trim())) issues.push(`Random values for "${g.var}" have no options to pick from.`);
  }
  for (const sc of sim.scenarios) {
    const paths = scenarioPaths(sc);
    if (paths.every((p) => p.steps.length === 0) && sc.successCriteria.length === 0) issues.push(`Scenario "${sc.title}" has no steps.`);
    if (sc.startScreenId && !screenIds.has(sc.startScreenId)) issues.push(`Scenario "${sc.title}" starts on a missing screen.`);
    const pathIds = new Set<string>();
    for (const p of paths) {
      if (pathIds.has(p.id)) issues.push(`Scenario "${sc.title}" has two paths with the id "${p.id}".`);
      pathIds.add(p.id);
      const where = p.id === MAIN_PATH_ID ? `Scenario "${sc.title}"` : `Scenario "${sc.title}" path "${p.name}"`;
      if (p.id !== MAIN_PATH_ID && p.steps.length === 0) issues.push(`${where} has no steps.`);
      p.steps.forEach((st, i) => {
        for (const id of stepTargets(st)) {
          if (!elementIds.has(id)) issues.push(`${where} step ${i + 1} targets missing element "${id}".`);
        }
      });
    }
  }
  return issues;
}

/** Short random id for new screens/elements/steps. */
export function newId(prefix: string): string {
  return `${prefix}-${Math.random().toString(36).slice(2, 8)}`;
}
