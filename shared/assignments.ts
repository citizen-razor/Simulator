/**
 * Assignments: a trainer asks a trainee to do a scenario, optionally by a due date, and
 * says what counts as done:
 *
 *   complete  finish the scenario, in any mode (guided help allowed)
 *   pass      a Scenario-mode attempt that passes its grading scheme's pass mark
 *   master    a solo Scenario-mode attempt (no guided help) at or above the mastery mark
 *
 * Status is worked out from the trainee's attempts made AFTER the assignment was given.
 * Earlier results never count, even a mastery: an assignment means "take it now".
 *   done      an attempt meets the requirement
 *   awaiting  an attempt might, once a trainer marks its rubric
 *   overdue   past the due date and not done
 *   due-soon  due within the next 3 days
 *   open      everything else
 * Names are matched without regard to case or surrounding spaces.
 */
import { z } from "zod";
import { isSolo, masteryMark } from "./progress";
import { ID_PATTERN, type Attempt } from "./schema";

export const Requirements = ["complete", "pass", "master"] as const;
export type Requirement = (typeof Requirements)[number];

export const AssignmentSchema = z.object({
  id: z.string().regex(ID_PATTERN),
  trainee: z.string().trim().min(1).max(100),
  simulationId: z.string(),
  scenarioId: z.string(),
  /** Titles at the time of assigning, so the assignment still reads well if they change. */
  simulationTitle: z.string(),
  scenarioTitle: z.string(),
  requirement: z.enum(Requirements).default("pass"),
  /** YYYY-MM-DD, or null for no due date. */
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().default(null),
  note: z.string().max(500).default(""),
  createdAt: z.string(),
});
export type Assignment = z.infer<typeof AssignmentSchema>;

export const sameName = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

export const REQUIREMENT_TEXT: Record<Requirement, string> = {
  complete: "Complete it (guided help allowed)",
  pass: "Pass it in Scenario mode",
  master: "Master it: pass at the mastery mark without guided help",
};

/** Does this attempt satisfy the requirement? null = can't tell until a trainer marks it. */
export function meetsRequirement(a: Attempt, req: Requirement): boolean | null {
  if (!a.completed) return false;
  if (req === "complete") return true;
  if (a.mode !== "scenario") return false;
  if (req === "pass") return a.grading ? a.passed : a.score >= 60; // older attempts: Standard pass mark
  if (!isSolo(a)) return false;
  if (a.grading && a.passed === null) return null;
  return a.score >= masteryMark(a);
}

export type AssignmentState = "done" | "awaiting" | "overdue" | "due-soon" | "open";

export interface AssignmentStatus {
  state: AssignmentState;
  /** When it was done (the first qualifying attempt). */
  doneAt: string | null;
  attempts: number;
  bestScore: number | null;
  /** Days until due (negative = overdue), or null with no due date. */
  daysLeft: number | null;
  /** Attempts at this scenario from BEFORE it was assigned. They don't count; shown so trainees know why. */
  earlierAttempts: number;
}

const dayNumber = (ymd: string) => Math.round(Date.parse(`${ymd}T00:00:00Z`) / 86_400_000);

/** `today` is the viewer's local date as YYYY-MM-DD. */
export function assignmentStatus(asg: Assignment, attempts: Attempt[], today: string): AssignmentStatus {
  const theirs = attempts.filter((a) => sameName(a.trainee, asg.trainee) && a.simulationId === asg.simulationId && a.scenarioId === asg.scenarioId);
  const relevant = theirs.filter((a) => a.finishedAt >= asg.createdAt).sort((a, b) => a.finishedAt.localeCompare(b.finishedAt));
  const done = relevant.find((a) => meetsRequirement(a, asg.requirement) === true);
  const awaiting = relevant.some((a) => meetsRequirement(a, asg.requirement) === null);
  const daysLeft = asg.dueDate ? dayNumber(asg.dueDate) - dayNumber(today) : null;
  const state: AssignmentState = done
    ? "done"
    : awaiting
      ? "awaiting"
      : daysLeft !== null && daysLeft < 0
        ? "overdue"
        : daysLeft !== null && daysLeft <= 3
          ? "due-soon"
          : "open";
  return {
    state,
    doneAt: done?.finishedAt ?? null,
    attempts: relevant.length,
    bestScore: relevant.length ? Math.max(...relevant.map((a) => a.score)) : null,
    daysLeft,
    earlierAttempts: theirs.length - relevant.length,
  };
}

/** Today's date in the viewer's time zone, as YYYY-MM-DD. */
export function localToday(d = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Sort for display: overdue, due soon, awaiting, open (by due date), then done. */
export function byUrgency(a: { status: AssignmentStatus; assignment: Assignment }, b: { status: AssignmentStatus; assignment: Assignment }) {
  const order: Record<AssignmentState, number> = { overdue: 0, "due-soon": 1, awaiting: 2, open: 3, done: 4 };
  return (
    order[a.status.state] - order[b.status.state] ||
    (a.assignment.dueDate ?? "9999").localeCompare(b.assignment.dueDate ?? "9999") ||
    a.assignment.scenarioTitle.localeCompare(b.assignment.scenarioTitle)
  );
}
