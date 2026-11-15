/** Small shared pieces for showing assignments. */
import type { AssignmentStatus, Requirement } from "../../shared/assignments";

const STATE: Record<AssignmentStatus["state"], { icon: string; label: string; cls: string }> = {
  done: { icon: "✓", label: "Done", cls: "good" },
  awaiting: { icon: "⏳", label: "Awaiting marking", cls: "neutral" },
  overdue: { icon: "!", label: "Overdue", cls: "bad" },
  "due-soon": { icon: "◷", label: "Due soon", cls: "warn" },
  open: { icon: "○", label: "To do", cls: "neutral" },
};

export function AssignmentBadge({ status }: { status: AssignmentStatus }) {
  const s = STATE[status.state];
  return <span className={`status ${s.cls}`}>{s.icon} {s.label}</span>;
}

export const REQUIREMENT_SHORT: Record<Requirement, string> = {
  complete: "Complete",
  pass: "Pass",
  master: "Master",
};

export function dueText(dueDate: string | null, status: AssignmentStatus): string {
  if (!dueDate) return "No due date";
  const d = new Date(`${dueDate}T12:00:00`).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
  if (status.state === "done" || status.daysLeft === null) return `Due ${d}`;
  if (status.daysLeft < 0) return `Was due ${d} (${-status.daysLeft} day${status.daysLeft === -1 ? "" : "s"} ago)`;
  if (status.daysLeft === 0) return `Due today`;
  if (status.daysLeft === 1) return `Due tomorrow`;
  return `Due ${d} (in ${status.daysLeft} days)`;
}
