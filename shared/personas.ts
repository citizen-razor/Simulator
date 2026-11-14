/**
 * Personas: rich, FICTIONAL customers (or other people) that simulations show on screen.
 *
 *   PersonaTemplate  a kind of persona, defined by an admin: its fields (account number,
 *                    balance, plan…) and its record tables (transactions, orders…)
 *   Persona          one person: name, one-line summary, backstory, values for the
 *                    template's fields, extra free fields, and rows for each table
 *
 * A simulation links personas to ROLES (usually "customer"); a scenario can swap in a
 * different persona for a role. At the start of a run, each role's persona becomes
 * variables, so screens can show `{{customer.name}}`, `{{customer.balance}}`, and so on:
 *
 *   <role>.name, <role>.summary, <role>.backstory
 *   <role>.<fieldKey>                one per template field and extra field
 *   <role>.<tableKey>                the whole table as JSON (used by "table" elements)
 *   <role>.<tableKey>.count          number of rows
 *   <role>.<tableKey>.<n>.<column>   one cell; rows are numbered from 1 (most recent first)
 */
import { z } from "zod";
import { ID_PATTERN } from "./schema";

const id = z.string().regex(ID_PATTERN);
/** Field, table and column keys become variable names, so they're kept simple. */
export const KEY_PATTERN = /^[A-Za-z][A-Za-z0-9_]{0,39}$/;
const key = z.string().regex(KEY_PATTERN, "Keys start with a letter and use only letters, numbers and _");

export const FieldTypes = ["text", "number", "money", "date", "email", "phone", "longtext", "choice"] as const;
export type FieldType = (typeof FieldTypes)[number];

export const TemplateFieldSchema = z.object({
  key,
  label: z.string().trim().min(1).max(60),
  type: z.enum(FieldTypes).default("text"),
  /** choice: the allowed values */
  options: z.array(z.string()).optional(),
});
export const TemplateColumnSchema = z.object({
  key,
  label: z.string().trim().min(1).max(60),
  type: z.enum(FieldTypes).default("text"),
});
export const TemplateTableSchema = z.object({
  key,
  label: z.string().trim().min(1).max(60),
  columns: z.array(TemplateColumnSchema).min(1).max(12),
});
export const PersonaTemplateSchema = z.object({
  id,
  name: z.string().trim().min(1).max(80),
  description: z.string().max(500).default(""),
  fields: z.array(TemplateFieldSchema).max(60).default([]),
  tables: z.array(TemplateTableSchema).max(10).default([]),
});

export const PersonaSchema = z.object({
  id,
  name: z.string().trim().min(1).max(100),
  /** One line, e.g. "Small-business owner, disputes a roaming charge, short on time". */
  summary: z.string().max(300).default(""),
  backstory: z.string().max(5000).default(""),
  templateId: z.string().nullable().default(null),
  /** Values for the template's fields, by field key. */
  values: z.record(z.string(), z.string().max(2000)).default({}),
  /** Fields this persona has beyond its template. */
  extra: z.array(z.object({ key, label: z.string().max(60), value: z.string().max(2000) })).max(40).default([]),
  /** Rows for each of the template's tables, by table key. Most recent first. */
  tables: z.record(z.string(), z.array(z.record(z.string(), z.string().max(500))).max(200)).default({}),
});

export const PersonaLibrarySchema = z.object({
  templates: z.array(PersonaTemplateSchema).default([]),
  personas: z.array(PersonaSchema).default([]),
});

export type TemplateField = z.infer<typeof TemplateFieldSchema>;
export type TemplateTable = z.infer<typeof TemplateTableSchema>;
export type PersonaTemplate = z.infer<typeof PersonaTemplateSchema>;
export type Persona = z.infer<typeof PersonaSchema>;
export type PersonaLibrary = z.infer<typeof PersonaLibrarySchema>;

/** A role name, as used in {{role.field}}. */
export const ROLE_PATTERN = /^[a-z][a-z0-9_]{0,29}$/;
export const DEFAULT_ROLE = "customer";

/** Turn a label into a usable key: "Account number" → "accountNumber". */
export function keyFromLabel(label: string): string {
  const words = label.replace(/[^A-Za-z0-9 ]+/g, " ").trim().split(/\s+/).filter(Boolean);
  const k = words.map((w, i) => (i === 0 ? w.toLowerCase() : w[0].toUpperCase() + w.slice(1).toLowerCase())).join("");
  if (!k) return "field";
  return (/^[A-Za-z]/.test(k) ? k : `f${k}`).slice(0, 40);
}

/** Money values always read with two decimals ("212.4" → "212.40"), so text and tables agree. */
const normalise = (value: string, type: FieldType) =>
  type === "money" && value.trim() !== "" && !Number.isNaN(Number(value)) ? Number(value).toFixed(2) : value;

/** The variables a persona provides for a role (see the file comment). */
export function personaVariables(role: string, persona: Persona, template: PersonaTemplate | null): Record<string, string> {
  const vars: Record<string, string> = {
    [`${role}.name`]: persona.name,
    [`${role}.summary`]: persona.summary,
    [`${role}.backstory`]: persona.backstory,
  };
  for (const f of template?.fields ?? []) vars[`${role}.${f.key}`] = normalise(persona.values[f.key] ?? "", f.type);
  for (const x of persona.extra) vars[`${role}.${x.key}`] = x.value;
  for (const t of template?.tables ?? []) {
    const rows = (persona.tables[t.key] ?? []).map((r) => Object.fromEntries(t.columns.map((c) => [c.key, normalise(r[c.key] ?? "", c.type)])));
    vars[`${role}.${t.key}`] = JSON.stringify({ columns: t.columns.map((c) => ({ key: c.key, label: c.label, type: c.type })), rows });
    vars[`${role}.${t.key}.count`] = String(rows.length);
    rows.forEach((r, i) => {
      for (const c of t.columns) vars[`${role}.${t.key}.${i + 1}.${c.key}`] = r[c.key];
    });
  }
  return vars;
}

/** Parse the JSON a table variable holds; null if it isn't a table. Used by the table element. */
export function parseTableVar(raw: string | undefined): { columns: { key: string; label: string; type: FieldType }[]; rows: Record<string, string>[] } | null {
  if (!raw || raw[0] !== "{") return null;
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v.columns) && Array.isArray(v.rows) ? v : null;
  } catch {
    return null;
  }
}

/**
 * Variables from the personas linked to a simulation's roles, with the scenario's
 * overrides applied (an override of null removes the role's persona for that scenario).
 */
export function resolvePersonaVariables(
  links: { role: string; personaId: string }[],
  overrides: { role: string; personaId: string | null }[],
  library: PersonaLibrary,
): Record<string, string> {
  const vars: Record<string, string> = {};
  const roles = new Map(links.map((l) => [l.role, l.personaId as string | null]));
  for (const o of overrides) roles.set(o.role, o.personaId);
  for (const [role, personaId] of roles) {
    const persona = personaId ? library.personas.find((p) => p.id === personaId) : undefined;
    if (!persona) continue;
    const template = library.templates.find((t) => t.id === persona.templateId) ?? null;
    Object.assign(vars, personaVariables(role, persona, template));
  }
  return vars;
}

/** Variable names a role will provide with this persona (for the editor's suggestions). */
export function personaVariableNames(role: string, persona: Persona, template: PersonaTemplate | null): string[] {
  return Object.keys(personaVariables(role, persona, template)).filter((k) => !/\.\d+\./.test(k) || /\.1\./.test(k));
}

/** How a field value is displayed (money gets two decimals; everything else as written). */
export function formatValue(value: string, type: FieldType): string {
  if (type === "money" && value.trim() !== "" && !Number.isNaN(Number(value))) {
    return Number(value).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  return value;
}

/** Persona variables for a run of this simulation (and scenario, if any). */
export function sessionPersonaVariables(
  sim: { personas: { role: string; personaId: string }[]; scenarios: { id: string; personaOverrides: { role: string; personaId: string | null }[] }[] },
  scenarioId: string | null,
  library: PersonaLibrary,
): Record<string, string> {
  const sc = scenarioId ? sim.scenarios.find((s) => s.id === scenarioId) : undefined;
  return resolvePersonaVariables(sim.personas, sc?.personaOverrides ?? [], library);
}
