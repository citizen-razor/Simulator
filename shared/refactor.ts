/**
 * Editing operations that must keep a simulation's internal references intact:
 * renaming ids, duplicating elements and screens, reordering screens.
 *
 * Everything that refers to something else by name:
 *   element id   ← scenario steps on every path (elementId, alsoElementIds);
 *                  a field's variable when it has no bindVar
 *   screen id    ← startScreenId, "navigate" actions, scenario startScreenId
 *   variable     ← declarations, bindVar, every condition, set/toggle actions,
 *                  scenario initialVars, and {{name}} templates in labels and values
 *
 * All functions mutate the simulation passed in (the editor passes a fresh clone)
 * and throw an Error with a readable message when the change isn't allowed.
 */
import { FIELD_KINDS, ID_PATTERN, scenarioPaths, type Condition, type Screen, type SimElement, type Simulation, type Step } from "./schema";

const randomSuffix = () => Math.random().toString(36).slice(2, 6);

/** Every id in use (elements and screens share a namespace to keep things unambiguous). */
export function usedIds(sim: Simulation): Set<string> {
  const ids = new Set<string>();
  for (const s of sim.screens) {
    ids.add(s.id);
    for (const e of s.elements) ids.add(e.id);
  }
  return ids;
}

/** A free id based on `base`, e.g. "submit" → "submit-copy" → "submit-copy-2". */
export function uniqueId(sim: Simulation, base: string, taken = usedIds(sim)): string {
  const clean = base.replace(/[^A-Za-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 50) || `id-${randomSuffix()}`;
  if (!taken.has(clean)) return clean;
  for (let i = 2; i < 1000; i++) if (!taken.has(`${clean}-${i}`)) return `${clean}-${i}`;
  return `${clean}-${randomSuffix()}`;
}

function checkNewId(sim: Simulation, next: string) {
  if (!ID_PATTERN.test(next)) throw new Error("Ids may only use letters, numbers, _ and - (max 64).");
  if (usedIds(sim).has(next)) throw new Error(`"${next}" is already used by another element or screen.`);
}

const isField = (e: SimElement) => FIELD_KINDS.includes(e.kind);
/** Every step of every path of every scenario. */
const allSteps = (sim: Simulation): Step[] => sim.scenarios.flatMap((sc) => scenarioPaths(sc).flatMap((p) => p.steps));
const allElements = (sim: Simulation) => sim.screens.flatMap((s) => s.elements);

function forEachCondition(sim: Simulation, fn: (c: Condition) => void) {
  for (const e of allElements(sim)) {
    e.visibleIf?.forEach(fn);
    for (const r of e.rules) r.if.forEach(fn);
  }
  for (const sc of sim.scenarios) sc.successCriteria.forEach(fn);
}

// ------------------------------------------------------------------ renames

export function renameElement(sim: Simulation, oldId: string, newId: string) {
  if (oldId === newId) return;
  checkNewId(sim, newId);
  const el = allElements(sim).find((e) => e.id === oldId);
  if (!el) throw new Error(`No element "${oldId}".`);
  // A field without bindVar stores its value under its id; pin the variable name so state survives.
  if (isField(el) && !el.bindVar) el.bindVar = oldId;
  el.id = newId;
  for (const st of allSteps(sim)) {
    if (st.elementId === oldId) st.elementId = newId;
    if (st.alsoElementIds) st.alsoElementIds = st.alsoElementIds.map((id) => (id === oldId ? newId : id));
  }
}

export function renameScreen(sim: Simulation, oldId: string, newId: string) {
  if (oldId === newId) return;
  checkNewId(sim, newId);
  const screen = sim.screens.find((s) => s.id === oldId);
  if (!screen) throw new Error(`No screen "${oldId}".`);
  screen.id = newId;
  if (sim.startScreenId === oldId) sim.startScreenId = newId;
  for (const e of allElements(sim)) for (const r of e.rules) for (const a of r.then) if (a.type === "navigate" && a.screenId === oldId) a.screenId = newId;
  for (const sc of sim.scenarios) if (sc.startScreenId === oldId) sc.startScreenId = newId;
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export function renameVariable(sim: Simulation, oldName: string, newName: string) {
  if (oldName === newName) return;
  if (!/^[\w.-]{1,64}$/.test(newName)) throw new Error("Variable names may only use letters, numbers, _ . and - (max 64).");
  const exists = (n: string) =>
    sim.variables.some((v) => v.name === n) || allElements(sim).some((e) => isField(e) && (e.bindVar || e.id) === n);
  if (exists(newName)) throw new Error(`A variable called "${newName}" already exists.`);

  const tpl = new RegExp(`\\{\\{\\s*${escapeRe(oldName)}\\s*\\}\\}`, "g");
  const retemplate = (s: string | undefined) => (s === undefined ? s : s.replace(tpl, `{{${newName}}}`));

  for (const v of sim.variables) if (v.name === oldName) v.name = newName;
  for (const e of allElements(sim)) {
    if (isField(e) && (e.bindVar || e.id) === oldName) e.bindVar = newName;
    e.label = retemplate(e.label)!;
    for (const r of e.rules) {
      for (const a of r.then) {
        if (a.var === oldName) a.var = newName;
        a.value = retemplate(a.value);
      }
    }
  }
  forEachCondition(sim, (c) => {
    if (c.var === oldName) c.var = newName;
    c.value = retemplate(c.value);
  });
  for (const sc of sim.scenarios) for (const iv of sc.initialVars) if (iv.name === oldName) iv.name = newName;
  for (const st of allSteps(sim)) st.value = retemplate(st.value);
}

// ------------------------------------------------------------------ duplicate

/**
 * Copy an element onto `targetScreenId`. The copy gets a new id, and a copied field gets
 * its own variable so typing in the copy doesn't change the original. With
 * `keepNamedVariables` (used when duplicating a whole screen to make a variant of it),
 * fields bound to a named variable keep sharing it. Returns the new element's id.
 */
export function duplicateElement(
  sim: Simulation,
  source: SimElement,
  targetScreenId: string,
  offset = 2,
  keepNamedVariables = false,
): string {
  const target = sim.screens.find((s) => s.id === targetScreenId);
  if (!target) throw new Error("Target screen not found.");
  const copy: SimElement = structuredClone(source);
  copy.id = uniqueId(sim, `${source.id}-copy`);
  copy.rect = {
    ...copy.rect,
    x: Math.min(100 - copy.rect.w, copy.rect.x + offset),
    y: Math.min(100 - copy.rect.h, copy.rect.y + offset),
  };
  const named = !!source.bindVar && source.bindVar !== source.id;
  if (isField(source) && !(keepNamedVariables && named)) {
    copy.bindVar = copy.id;
    const orig = sim.variables.find((v) => v.name === (source.bindVar || source.id));
    sim.variables.push({ name: copy.id, initial: orig?.initial ?? "" });
  }
  target.elements.push(copy);
  return copy.id;
}

/**
 * Copy a whole screen with fresh element ids, inserted right after the original. Fields
 * bound to a named variable (e.g. "username") keep sharing it, since a duplicated screen
 * is usually a variant of the same screen. Returns the new screen id.
 */
export function duplicateScreen(sim: Simulation, screenId: string): string {
  const index = sim.screens.findIndex((s) => s.id === screenId);
  if (index === -1) throw new Error("Screen not found.");
  const source = sim.screens[index];
  const copy: Screen = { ...structuredClone(source), id: uniqueId(sim, `${source.id}-copy`), name: `${source.name} (copy)`, elements: [] };
  sim.screens.splice(index + 1, 0, copy);
  for (const el of source.elements) duplicateElement(sim, el, copy.id, 0, true);
  return copy.id;
}

/** Move a screen up (-1) or down (+1) in the list. */
export function moveScreen(sim: Simulation, screenId: string, delta: number) {
  const i = sim.screens.findIndex((s) => s.id === screenId);
  const j = i + delta;
  if (i === -1 || j < 0 || j >= sim.screens.length) return;
  [sim.screens[i], sim.screens[j]] = [sim.screens[j], sim.screens[i]];
}
