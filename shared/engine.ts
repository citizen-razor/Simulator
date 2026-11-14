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
 */
import {
  FIELD_KINDS,
  type Action,
  type Condition,
  type Scenario,
  type Screen,
  type SimElement,
  type Simulation,
  type Step,
} from "./schema";

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
  stepIndex: number;
  errors: number;
  hintsUsed: number;
  mistakes: string[];
  assisted: boolean;
  finished: boolean;
  completed: boolean;
  startedAt: number;
  finishedAt: number | null;
  /** Screens visited, most recent last. */
  history: string[];
  /** Field element ids the trainee has edited (lets out-of-order field steps auto-complete). */
  touched: string[];
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

export function currentStep(sim: Simulation, state: SessionState): Step | null {
  const sc = getScenario(sim, state.scenarioId);
  if (!sc || state.finished) return null;
  return sc.steps[state.stepIndex] ?? null;
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

export function createSession(sim: Simulation, scenarioId: string | null, now = Date.now()): SessionState {
  const vars: Record<string, string> = {};
  for (const v of sim.variables) vars[v.name] = v.initial ?? "";
  const sc = getScenario(sim, scenarioId);
  for (const iv of sc?.initialVars ?? []) vars[iv.name] = iv.value;
  const start =
    (sc?.startScreenId && getScreen(sim, sc.startScreenId)?.id) ||
    getScreen(sim, sim.startScreenId)?.id ||
    sim.screens[0].id;
  return {
    screenId: start,
    vars,
    scenarioId: sc ? sc.id : null,
    stepIndex: 0,
    errors: 0,
    hintsUsed: 0,
    mistakes: [],
    assisted: false,
    finished: false,
    completed: false,
    startedAt: now,
    finishedAt: null,
    history: [start],
    touched: [],
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
  const hint = (step.hint || step.instruction) + where;
  return { state: { ...state, hintsUsed: state.hintsUsed + 1 }, hint };
}

function runActions(actions: Action[], state: SessionState, sim: Simulation, feedback: Feedback[]) {
  for (const a of actions) {
    switch (a.type) {
      case "navigate":
        if (a.screenId && getScreen(sim, a.screenId)) {
          state.screenId = a.screenId;
          state.history = [...state.history, a.screenId].slice(-50);
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

/** Advance past field steps the trainee already satisfied (e.g. filled fields out of order), then check for completion. */
function settle(sim: Simulation, state: SessionState, now: number) {
  const sc = getScenario(sim, state.scenarioId);
  if (!sc || state.finished) return;
  for (;;) {
    const step = sc.steps[state.stepIndex];
    if (!step) break;
    const target = findElement(sim, step.elementId);
    if (!target || !isField(target.element)) break;
    const value = state.vars[fieldVar(target.element)] ?? "";
    if (!valueMatches(step, value, state.vars)) break;
    // Only auto-complete if the field was actually touched; avoids pre-filled defaults counting.
    if (!state.touched.includes(target.element.id)) break;
    state.stepIndex++;
  }
  const stepsDone = state.stepIndex >= sc.steps.length;
  if (stepsDone && checkAll(sc.successCriteria, state.vars) && (sc.steps.length > 0 || sc.successCriteria.length > 0)) {
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
  if (!screen || !el || !isVisible(el, prev.vars) || el.kind === "text") {
    return { state: prev, feedback, blocked: false, completedStep: null };
  }

  const state: SessionState = { ...prev };
  // Any interaction judged in guided mode makes the run "assisted", however it started.
  if (mode === "guided" && prev.scenarioId && !prev.finished) state.assisted = true;
  const judging = mode !== "open" && !!state.scenarioId && !state.finished;
  const step = judging ? currentStep(sim, state) : null;
  const isTarget = !!step && step.elementId === el.id;
  const matches =
    isTarget && (ev.type === "activate" ? true : valueMatches(step!, ev.value, state.vars));
  const fieldCommit = ev.type === "commit";

  if (judging && step && !matches) {
    if (fieldCommit && !isTarget) {
      // Filling in a different field is never penalised; it may satisfy a later step.
      if (mode === "guided") feedback.push({ tone: "info", text: `Next: ${step.instruction}` });
    } else if (mode === "guided") {
      const text = isTarget
        ? `That value isn't quite right. ${step.hint ?? step.instruction}`
        : `Not yet. ${step.instruction}`;
      const mistake = isTarget ? `Wrong value in ${describe(el)}` : `Clicked ${describe(el)} instead of the next step`;
      const blockedState = { ...prev, assisted: true, errors: prev.errors + 1, mistakes: [...prev.mistakes, mistake] };
      if (fieldCommit) {
        // Keep what they typed so the field doesn't reset, but don't advance.
        blockedState.vars = { ...prev.vars, [fieldVar(el)]: ev.value };
        if (!prev.touched.includes(el.id)) blockedState.touched = [...prev.touched, el.id];
      }
      return { state: blockedState, feedback: [{ tone: "error", text }], blocked: true, completedStep: null };
    } else {
      state.errors++;
      state.mistakes = [
        ...state.mistakes,
        isTarget ? `Wrong value in ${describe(el)} (step: ${step.instruction})` : `Used ${describe(el)} when the step was: ${step.instruction}`,
      ];
    }
  }

  // Apply the interaction to the simulated system.
  if (ev.type === "commit") {
    state.vars = { ...state.vars, [fieldVar(el)]: ev.value };
    if (!state.touched.includes(el.id)) state.touched = [...state.touched, el.id];
  }
  runRules(el, state, sim, feedback);

  let completedStep: Step | null = null;
  if (judging && step && matches) {
    completedStep = step;
    state.stepIndex++;
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
}

/** 100 points for full completion, minus 10 per error and 5 per hint; partial runs score by progress. */
export function scoreSession(sim: Simulation, state: SessionState, now = Date.now()): ScoreSummary {
  const sc = getScenario(sim, state.scenarioId);
  const total = sc?.steps.length ?? 0;
  const done = Math.min(state.stepIndex, total);
  const progress = state.completed ? 1 : total ? done / total : 0;
  const score = Math.max(0, Math.round(100 * progress - 10 * state.errors - 5 * state.hintsUsed));
  const end = state.finishedAt ?? now;
  return { score, stepsCompleted: done, stepsTotal: total, durationSec: Math.round((end - state.startedAt) / 1000) };
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
  for (const sc of sim.scenarios) {
    if (sc.steps.length === 0 && sc.successCriteria.length === 0) issues.push(`Scenario "${sc.title}" has no steps.`);
    if (sc.startScreenId && !screenIds.has(sc.startScreenId)) issues.push(`Scenario "${sc.title}" starts on a missing screen.`);
    sc.steps.forEach((st, i) => {
      if (!elementIds.has(st.elementId)) issues.push(`Scenario "${sc.title}" step ${i + 1} targets missing element "${st.elementId}".`);
    });
  }
  return issues;
}

/** Short random id for new screens/elements/steps. */
export function newId(prefix: string): string {
  return `${prefix}-${Math.random().toString(36).slice(2, 8)}`;
}
