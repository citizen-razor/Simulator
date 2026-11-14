/**
 * Leaderboards. Everyone in the organisation appears by name (no opt-out).
 *
 *   main board     ranked by scenarios mastered, then average solo score
 *                  (ties on both share a rank). Can be narrowed to a set of people
 *                  (a leader's team) or to the scenarios carrying a topic's tags.
 *   scenario board best completed solo score for one scenario, then fastest time
 *
 * Only people with at least one attempt in scope appear. Attempts saved before accounts
 * existed are matched to people by name (withUserIds).
 */
import { sameName } from "./assignments";
import { isSolo, summarizeTrainee } from "./progress";
import type { Attempt } from "./schema";

export interface Person {
  id: string;
  name: string;
}

/** Give older attempts (typed name only) the id of the person with that name. */
export function withUserIds(attempts: Attempt[], people: Person[]): Attempt[] {
  return attempts.map((a) => {
    if (a.userId) return a;
    const match = people.filter((p) => sameName(p.name, a.trainee));
    return match.length === 1 ? { ...a, userId: match[0].id } : a;
  });
}

export interface BoardRow {
  rank: number;
  userId: string;
  name: string;
  mastered: number;
  attempted: number;
  avgSolo: number | null;
}

export function mainBoard(
  people: Person[],
  attempts: Attempt[],
  opts: { onlyUserIds?: Set<string>; inScope?: (a: Attempt) => boolean } = {},
): BoardRow[] {
  const scoped = attempts.filter((a) => a.userId && (!opts.inScope || opts.inScope(a)));
  const rows = people
    .filter((p) => !opts.onlyUserIds || opts.onlyUserIds.has(p.id))
    .map((p) => {
      const mine = scoped.filter((a) => a.userId === p.id).map((a) => ({ ...a, trainee: p.id }));
      if (!mine.length) return null;
      const s = summarizeTrainee(p.id, mine);
      return { userId: p.id, name: p.name, mastered: s.mastered, attempted: s.scenarios.length, avgSolo: s.avgSolo };
    })
    .filter((r): r is Omit<BoardRow, "rank"> => r !== null)
    .sort((a, b) => b.mastered - a.mastered || (b.avgSolo ?? -1) - (a.avgSolo ?? -1) || a.name.localeCompare(b.name));
  return withRanks(rows, (r) => `${r.mastered}/${r.avgSolo}`);
}

export interface ScenarioRow {
  rank: number;
  userId: string;
  name: string;
  best: number;
  durationSec: number;
  attempts: number;
}

export function scenarioBoard(people: Person[], attempts: Attempt[], simulationId: string, scenarioId: string, onlyUserIds?: Set<string>): ScenarioRow[] {
  const rows = people
    .filter((p) => !onlyUserIds || onlyUserIds.has(p.id))
    .map((p) => {
      const mine = attempts.filter((a) => a.userId === p.id && a.simulationId === simulationId && a.scenarioId === scenarioId);
      const solo = mine.filter((a) => isSolo(a) && a.completed);
      if (!solo.length) return null;
      const best = solo.reduce((x, y) => (y.score > x.score || (y.score === x.score && y.durationSec < x.durationSec) ? y : x));
      return { userId: p.id, name: p.name, best: best.score, durationSec: best.durationSec, attempts: mine.length };
    })
    .filter((r): r is Omit<ScenarioRow, "rank"> => r !== null)
    .sort((a, b) => b.best - a.best || a.durationSec - b.durationSec || a.name.localeCompare(b.name));
  return withRanks(rows, (r) => `${r.best}/${r.durationSec}`);
}

/** 1, 2, 2, 4: equal keys share a rank. */
function withRanks<T>(sorted: T[], key: (r: T) => string): (T & { rank: number })[] {
  let rank = 0;
  let prev: string | null = null;
  return sorted.map((r, i) => {
    const k = key(r);
    if (k !== prev) rank = i + 1;
    prev = k;
    return { ...r, rank };
  });
}
