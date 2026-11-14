/**
 * The simulation data model.
 *
 * A simulation is plain JSON. Everything the app does (authoring, AI generation,
 * playing in any mode, scoring) reads and writes this one shape, so it is the
 * single most important file to understand. It is validated with Zod on the
 * server whenever a simulation is saved or produced by the AI.
 *
 *   Simulation
 *   ├─ variables[]   named pieces of state (all values are strings)
 *   ├─ screens[]     what the trainee sees; optional screenshot background
 *   │   └─ elements[]  clickable / typeable regions positioned in % of the screen
 *   │       └─ rules[]   "when activated, if <conditions>, then <actions>"
 *   └─ scenarios[]   goals for Scenario and Guided mode
 *       └─ steps[]     the expected interactions, in order
 */
import { z } from "zod";
import { RandomVarSchema } from "./random";

export const ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
const id = z.string().regex(ID_PATTERN, "ids may only contain letters, numbers, _ and -");

/** Position and size as percentages (0-100) of the screen, so it scales with any display size. */
export const RectSchema = z.object({
  x: z.number(),
  y: z.number(),
  w: z.number(),
  h: z.number(),
});

export const ConditionOps = ["eq", "neq", "contains", "empty", "notEmpty"] as const;
export const ConditionSchema = z.object({
  var: z.string(),
  op: z.enum(ConditionOps),
  /** Compared value. May use {{var}} templates. Ignored for empty/notEmpty. */
  value: z.string().optional(),
});

export const ActionTypes = ["navigate", "set", "toggle", "message"] as const;
export const ActionSchema = z.object({
  type: z.enum(ActionTypes),
  /** navigate: target screen id */
  screenId: z.string().optional(),
  /** set / toggle: variable name */
  var: z.string().optional(),
  /** set: new value; message: text. Both may use {{var}} templates. */
  value: z.string().optional(),
  /** message: visual tone */
  tone: z.enum(["info", "success", "error"]).optional(),
});

/** Evaluated top to bottom when an element is activated; the FIRST rule whose conditions all pass runs. */
export const RuleSchema = z.object({
  if: z.array(ConditionSchema).default([]),
  then: z.array(ActionSchema).default([]),
});

export const ElementKinds = [
  "button",
  "link",
  "hotspot",
  "input",
  "textarea",
  "select",
  "checkbox",
  "text",
  "table",
] as const;
export type ElementKind = (typeof ElementKinds)[number];
/** Kinds whose value the trainee edits (stored in a variable). */
export const FIELD_KINDS: ElementKind[] = ["input", "textarea", "select", "checkbox"];

export const ElementSchema = z.object({
  id,
  label: z.string(),
  kind: z.enum(ElementKinds),
  rect: RectSchema,
  placeholder: z.string().optional(),
  /** select: the choices */
  options: z.array(z.string()).optional(),
  /** Field kinds store their value in this variable (defaults to the element id). */
  bindVar: z.string().optional(),
  /** Only shown when all conditions pass. */
  visibleIf: z.array(ConditionSchema).optional(),
  /** table: the variable holding the table, e.g. "customer.orders" (from a persona). */
  tableSource: z.string().optional(),
  rules: z.array(RuleSchema).default([]),
});

export const ScreenSchema = z.object({
  id,
  name: z.string(),
  description: z.string().optional(),
  /** Uploaded screenshot. Without one, elements render as a wireframe UI. */
  imageAssetId: z.string().nullable().optional(),
  /** width / height */
  aspect: z.number().positive().default(16 / 10),
  elements: z.array(ElementSchema).default([]),
});

export const VariableSchema = z.object({
  name: z.string().min(1),
  initial: z.string().default(""),
  description: z.string().optional(),
});

export const ExpectOps = ["any", "eq", "contains"] as const;
export const StepSchema = z.object({
  id,
  instruction: z.string(),
  hint: z.string().optional(),
  /** The element the trainee must use for this step. */
  elementId: z.string(),
  /** Other elements that also count for this step (e.g. a toolbar button and a menu item that do the same thing). */
  alsoElementIds: z.array(z.string()).optional(),
  /** For fields: what the entered value must be. "any" = anything non-empty. */
  expect: z.enum(ExpectOps).default("any"),
  value: z.string().optional(),
});

/** Another valid way to complete a scenario: its own ordered list of steps. */
export const PathSchema = z.object({
  id,
  name: z.string(),
  steps: z.array(StepSchema).default([]),
});

export const MAIN_PATH_ID = "main";

const ROLE = z.string().regex(/^[a-z][a-z0-9_]{0,29}$/, "Roles are lower-case letters, numbers and _");
/**
 * A persona is like a real customer record: one source of truth. Simulations and scenarios
 * choose WHICH persona plays a role; they never change the persona's details. (Older files
 * may carry a "details" field from an earlier design; it is dropped when they load.)
 */
export const PersonaLinkSchema = z.object({ role: ROLE, personaId: z.string() });
export const PersonaOverrideSchema = z
  .object({ role: ROLE, personaId: z.string().nullable().optional() })
  // Older files: an override without a persona only carried detail changes; it now means "same as the simulation".
  .transform((o) => ({ role: o.role, personaId: o.personaId === undefined ? undefined : o.personaId }));
export type PersonaLink = z.infer<typeof PersonaLinkSchema>;
export type PersonaOverride = z.infer<typeof PersonaOverrideSchema>;

export const ScenarioSchema = z.object({
  id,
  title: z.string(),
  goal: z.string(),
  briefing: z.string().optional(),
  startScreenId: z.string().optional(),
  /** Overrides for variable initial values in this scenario. */
  initialVars: z.array(z.object({ name: z.string(), value: z.string() })).default([]),
  /** The main (recommended) path. Guided mode coaches this one unless the trainee takes another valid path. */
  steps: z.array(StepSchema).default([]),
  /** Other ways to complete the scenario. Completing ANY path (plus successCriteria) completes the scenario. */
  alternatePaths: z.array(PathSchema).default([]),
  /** Optional extra checks on state required to finish (e.g. status = "Resolved"). */
  successCriteria: z.array(ConditionSchema).default([]),
  /** Use a different grading scheme for this scenario (null = the simulation's scheme). */
  gradingSchemeId: z.string().nullable().default(null),
  /** Use fresh random values (Simulation.randomData) on each run. Off = always the initial values. */
  randomize: z.boolean().default(true),
  /**
   * Personas for this scenario, by role. personaId: a persona to use (also for roles only this
   * scenario has); null = no persona for that role here; left out = the simulation's persona.
   */
  personaOverrides: z.array(PersonaOverrideSchema).default([]),
});

/** Per-simulation targets for a grading scheme's screen/state checks (see shared/library.ts). */
export const BindingSchema = z.object({
  itemId: z.string(),
  screenId: z.string().optional(),
  conditions: z.array(ConditionSchema).optional(),
});
export type Binding = z.infer<typeof BindingSchema>;

export const SimulationSchema = z.object({
  id,
  title: z.string().min(1),
  description: z.string().default(""),
  startScreenId: z.string(),
  variables: z.array(VariableSchema).default([]),
  screens: z.array(ScreenSchema).min(1),
  scenarios: z.array(ScenarioSchema).default([]),
  /** Tag ids from the topic/tag library. */
  tagIds: z.array(z.string()).default([]),
  /** Personas from the persona library, by role (e.g. "customer"). Their details become {{role.field}} variables. */
  personas: z.array(PersonaLinkSchema).default([]),
  /** Random value generators for variables, applied at the start of every run (see shared/random.ts). */
  randomData: z.array(RandomVarSchema).default([]),
  /** Grading scheme from the grading library (null = Standard), plus per-simulation check targets. */
  grading: z
    .object({ schemeId: z.string().nullable().default(null), bindings: z.array(BindingSchema).default([]) })
    .default({ schemeId: null, bindings: [] }),
  createdAt: z.string().optional(),
  updatedAt: z.string().optional(),
});

export type Rect = z.infer<typeof RectSchema>;
export type Condition = z.infer<typeof ConditionSchema>;
export type Action = z.infer<typeof ActionSchema>;
export type Rule = z.infer<typeof RuleSchema>;
export type SimElement = z.infer<typeof ElementSchema>;
export type Screen = z.infer<typeof ScreenSchema>;
export type Variable = z.infer<typeof VariableSchema>;
export type Step = z.infer<typeof StepSchema>;
export type Scenario = z.infer<typeof ScenarioSchema>;
export type Path = z.infer<typeof PathSchema>;

/** All the scenario's paths, main path first. */
export function scenarioPaths(sc: Scenario): Path[] {
  return [{ id: MAIN_PATH_ID, name: "Main path", steps: sc.steps }, ...sc.alternatePaths];
}

/** Elements that count for a step. */
export const stepTargets = (st: Step): string[] => [st.elementId, ...(st.alsoElementIds ?? [])];
export type Simulation = z.infer<typeof SimulationSchema>;

/** A finished Scenario/Guided run, saved for the Results page. */
export const PenaltyEventSchema = z.object({
  kind: z.enum(["error", "hint"]),
  stepNo: z.number().int().min(1),
  step: z.string(),
});
export type PenaltyEvent = z.infer<typeof PenaltyEventSchema>;

export const AttemptSchema = z.object({
  id,
  /** Who made the attempt: their account, and their name at the time (older attempts have only a typed name). */
  userId: z.string().optional(),
  trainee: z.string().trim().max(100).default(""),
  simulationId: z.string(),
  simulationTitle: z.string(),
  scenarioId: z.string(),
  scenarioTitle: z.string(),
  /** Mode the attempt ended in; `assisted` is true if guided mode was used at any point. */
  mode: z.enum(["guided", "scenario"]),
  assisted: z.boolean(),
  completed: z.boolean(),
  score: z.number(),
  errors: z.number(),
  hintsUsed: z.number(),
  durationSec: z.number(),
  stepsCompleted: z.number(),
  stepsTotal: z.number(),
  /** Which path the trainee followed ("Main path" or an alternative's name). */
  pathName: z.string().default(""),
  mistakes: z.array(z.string()).default([]),
  /** Step instruction for each error or hint, used to find where a trainee struggles. */
  troubleSteps: z.array(z.string()).default([]),
  /** Each error and hint in order, with the step (1-based, on the path taken) it happened on. */
  penalties: z.array(PenaltyEventSchema).default([]),
  /** Grading details (absent on attempts saved before the grading library existed). */
  grading: z
    .object({
      schemeId: z.string(),
      schemeName: z.string(),
      passScore: z.number(),
      masteryScore: z.number(),
      pointsScore: z.number(),
      rubricWeight: z.number(),
      rubric: z.array(
        z.object({
          id: z.string(),
          label: z.string(),
          weight: z.number(),
          manual: z.boolean(),
          /** null = waiting for a trainer to mark it. */
          met: z.boolean().nullable(),
        }),
      ),
      overtimeSec: z.number().default(0),
      /** Points lost to each penalty (absent on attempts saved before this was recorded). */
      pointsLost: z
        .object({
          errors: z.number(),
          hints: z.number(),
          overtime: z.number(),
          /** The scheme's penalty per error and per hint when this was graded. */
          perError: z.number().optional(),
          perHint: z.number().optional(),
        })
        .optional(),
    })
    .optional(),
  /** Random values this run used, and the seed that produced them. */
  data: z.record(z.string(), z.string()).optional(),
  seed: z.number().optional(),
  /** null while manual rubric items are unmarked (or for older attempts). */
  passed: z.boolean().nullable().default(null),
  finishedAt: z.string(),
});
export type Attempt = z.infer<typeof AttemptSchema>;

export const ASSET_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}\.(png|jpg|webp|gif)$/;
