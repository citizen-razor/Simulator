/**
 * Randomised scenario data: fresh, realistic values for variables on every run, so
 * trainees practise the process instead of memorising answers.
 *
 * Generators (Simulation.randomData):
 *   pick     one of `options`. Generators with the same `group` and equally long option
 *            lists pick the SAME position, so linked values stay together
 *            (customerName "Ana Silva" ↔ customerEmail "ana.silva@example.com").
 *   number   between `min` and `max`, with `decimals` places
 *   pattern  `#` → digit, `A` → capital letter, `a` → lower-case letter, `?` → letter or digit,
 *            `\` makes the next character literal. e.g. "TCK-####", "AA-###-a"
 *   name     a full name from a built-in, internationally varied list
 *   date     today + a random number of days between `min` and `max` (can be negative),
 *            written as YYYY-MM-DD
 *
 * Runs use a seeded generator, so the same seed always gives the same values; the seed
 * is saved with each attempt.
 */
import { z } from "zod";

export const GeneratorKinds = ["pick", "number", "pattern", "name", "date"] as const;

export const RandomVarSchema = z.object({
  var: z.string().min(1),
  kind: z.enum(GeneratorKinds),
  options: z.array(z.string()).optional(),
  group: z.string().optional(),
  min: z.number().optional(),
  max: z.number().optional(),
  decimals: z.number().int().min(0).max(4).optional(),
  pattern: z.string().max(100).optional(),
});
export type RandomVar = z.infer<typeof RandomVarSchema>;

/** Small, fast, seedable PRNG (mulberry32). Returns numbers in [0, 1). */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const newSeed = () => Math.floor(Math.random() * 2 ** 31);

const FIRST = [
  "Ana", "Ben", "Chloé", "Dmitri", "Emeka", "Fatima", "Grace", "Hiroshi", "Isabel", "Jamal", "Kavya", "Liam",
  "Mei", "Nikolai", "Olivia", "Pedro", "Priya", "Rafael", "Sara", "Tomasz", "Uma", "Wei", "Yusuf", "Zainab",
];
const LAST = [
  "Silva", "Okafor", "Nguyen", "Kowalski", "Haddad", "Johansson", "Patel", "Kim", "Moreau", "Mensah", "García",
  "Tanaka", "Murphy", "Rossi", "Schmidt", "Ali", "Chen", "Novak", "Fernández", "Abebe", "Larsen", "Cohen",
];

const DIGITS = "0123456789";
const UPPER = "ABCDEFGHJKLMNPQRSTUVWXYZ"; // no I or O: easily confused with 1 and 0
const LOWER = "abcdefghjkmnpqrstuvwxyz";

function fromPattern(pattern: string, r: () => number): string {
  const pick = (chars: string) => chars[Math.floor(r() * chars.length)];
  let out = "";
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i];
    if (c === "\\" && i + 1 < pattern.length) out += pattern[++i];
    else if (c === "#") out += pick(DIGITS);
    else if (c === "A") out += pick(UPPER);
    else if (c === "a") out += pick(LOWER);
    else if (c === "?") out += pick(UPPER + DIGITS);
    else out += c;
  }
  return out;
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Generate one value per generator. `today` is injectable for tests. */
export function generateValues(gens: RandomVar[], seed: number, today = new Date()): Record<string, string> {
  const r = rng(seed);
  const groupIndex = new Map<string, number>();
  const out: Record<string, string> = {};
  for (const g of gens) {
    switch (g.kind) {
      case "pick": {
        const opts = (g.options ?? []).filter((o) => o.trim() !== "");
        if (!opts.length) break;
        let i: number;
        const key = g.group ? `${g.group}/${opts.length}` : null;
        if (key && groupIndex.has(key)) i = groupIndex.get(key)!;
        else {
          i = Math.floor(r() * opts.length);
          if (key) groupIndex.set(key, i);
        }
        out[g.var] = opts[i];
        break;
      }
      case "number": {
        const min = g.min ?? 0;
        const max = Math.max(min, g.max ?? 100);
        const d = g.decimals ?? 0;
        const v = min + r() * (max - min);
        out[g.var] = d ? v.toFixed(d) : String(Math.round(v));
        break;
      }
      case "pattern":
        out[g.var] = fromPattern(g.pattern || "####", r);
        break;
      case "name":
        out[g.var] = `${FIRST[Math.floor(r() * FIRST.length)]} ${LAST[Math.floor(r() * LAST.length)]}`;
        break;
      case "date": {
        const min = Math.round(g.min ?? 0);
        const max = Math.max(min, Math.round(g.max ?? 30));
        const days = min + Math.floor(r() * (max - min + 1));
        const d = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() + days));
        out[g.var] = isoDate(d);
        break;
      }
    }
  }
  return out;
}

/** A plain-language description of a generator, for the editor. */
export function describeGenerator(g: RandomVar): string {
  switch (g.kind) {
    case "pick":
      return `one of ${(g.options ?? []).length} values${g.group ? ` (linked group "${g.group}")` : ""}`;
    case "number":
      return `a number from ${g.min ?? 0} to ${g.max ?? 100}`;
    case "pattern":
      return `pattern ${g.pattern || "####"}`;
    case "name":
      return "a person's name";
    case "date":
      return `a date ${g.min ?? 0} to ${g.max ?? 30} days from today`;
  }
}
