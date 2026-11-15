/**
 * Shared libraries that admins manage and simulations refer to by id:
 *
 *   Taxonomy        topics (e.g. "Customer service"), each containing tags ("Refunds")
 *   GradingScheme   how attempts are scored: point rules, an optional rubric of weighted
 *                   criteria, and optional open-world objectives
 *
 * A grading scheme is shared by many simulations, and each has its own screens and
 * variables. So "reached a screen" and "system state" checks can be *bound* per
 * simulation (Simulation.grading.bindings); a scheme's own values are the default.
 */
import { z } from "zod";
import { ConditionSchema, ID_PATTERN } from "./schema";

const id = z.string().regex(ID_PATTERN);

// ------------------------------------------------------------------ taxonomy

export const TagSchema = z.object({ id, name: z.string().trim().min(1).max(60) });
export const TopicSchema = z.object({
  id,
  name: z.string().trim().min(1).max(60),
  description: z.string().max(500).default(""),
  tags: z.array(TagSchema).default([]),
});
export const TaxonomySchema = z.object({ topics: z.array(TopicSchema).default([]) });

export type Tag = z.infer<typeof TagSchema>;
export type Topic = z.infer<typeof TopicSchema>;
export type Taxonomy = z.infer<typeof TaxonomySchema>;

/** Look up a tag and its topic by tag id. */
export function findTag(tax: Taxonomy, tagId: string): { topic: Topic; tag: Tag } | null {
  for (const topic of tax.topics) {
    const tag = topic.tags.find((t) => t.id === tagId);
    if (tag) return { topic, tag };
  }
  return null;
}

// ------------------------------------------------------------------ grading

/**
 * One testable thing about an attempt.
 *   completed   the scenario was completed
 *   maxErrors   at most `n` errors
 *   noHints     no hints taken
 *   withinTime  finished within the scheme's time limit
 *   coverage    visited at least `n` % of the simulation's screens (open world)
 *   screen      reached the screen `screenId` (bindable per simulation)
 *   state       the system state matches `conditions` at the end (bindable per simulation)
 *   manual      a trainer marks it afterwards
 */
export const CheckTypes = ["completed", "maxErrors", "noHints", "withinTime", "coverage", "screen", "state", "manual"] as const;
export type CheckType = (typeof CheckTypes)[number];
export const CRITERION_CHECKS: CheckType[] = ["completed", "maxErrors", "noHints", "withinTime", "screen", "state", "manual"];
export const OBJECTIVE_CHECKS: CheckType[] = ["coverage", "screen", "state"];
/** Check types whose target differs per simulation. */
export const BINDABLE_CHECKS: CheckType[] = ["screen", "state"];

export const CheckSchema = z.object({
  type: z.enum(CheckTypes),
  n: z.number().min(0).max(1000).optional(),
  screenId: z.string().optional(),
  conditions: z.array(ConditionSchema).optional(),
});
export type Check = z.infer<typeof CheckSchema>;

export const CriterionSchema = z.object({
  id,
  label: z.string().trim().min(1).max(200),
  description: z.string().max(500).optional(),
  /** Relative weight within the rubric. */
  weight: z.number().min(0).max(100).default(1),
  check: CheckSchema,
});
export type Criterion = z.infer<typeof CriterionSchema>;

export const ObjectiveSchema = z.object({
  id,
  label: z.string().trim().min(1).max(200),
  check: CheckSchema,
});
export type Objective = z.infer<typeof ObjectiveSchema>;

export const GradingSchemeSchema = z.object({
  id,
  name: z.string().trim().min(1).max(80),
  description: z.string().max(1000).default(""),
  points: z
    .object({
      errorPenalty: z.number().min(0).max(100).default(10),
      hintPenalty: z.number().min(0).max(100).default(5),
      /** Seconds; null = no limit. */
      timeLimitSec: z.number().int().positive().max(86400).nullable().default(null),
      /** Points off per started minute over the time limit. */
      overtimePenaltyPerMin: z.number().min(0).max(100).default(5),
      passScore: z.number().min(0).max(100).default(60),
      masteryScore: z.number().min(0).max(100).default(80),
    })
    .default({ errorPenalty: 10, hintPenalty: 5, timeLimitSec: null, overtimePenaltyPerMin: 5, passScore: 60, masteryScore: 80 }),
  /** Share of the final score (0–100 %) that comes from the rubric; the rest comes from points. */
  rubricWeight: z.number().min(0).max(100).default(0),
  rubric: z.array(CriterionSchema).default([]),
  objectives: z.array(ObjectiveSchema).default([]),
});
export type GradingScheme = z.infer<typeof GradingSchemeSchema>;

export const DEFAULT_SCHEME_ID = "standard";

/** The built-in scheme; matches the app's original fixed scoring. Admins can edit it but not delete it. */
export const STANDARD_SCHEME: GradingScheme = GradingSchemeSchema.parse({
  id: DEFAULT_SCHEME_ID,
  name: "Standard",
  description: "100 points for completing the task, minus 10 per error and 5 per hint. Pass at 60, mastery at 80.",
});

export const GradingLibrarySchema = z.object({ schemes: z.array(GradingSchemeSchema).default([]) });
export type GradingLibrary = z.infer<typeof GradingLibrarySchema>;

export { BindingSchema, type Binding } from "./schema";
