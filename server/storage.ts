/**
 * File-based storage. Everything lives under ./data (git-ignored):
 *   data/simulations/<id>.json   one file per simulation
 *   data/assets/<id>.<ext>       uploaded screenshots / video frames
 *   data/attempts.json           scored scenario attempts
 * Plain files keep the prototype dependency-free and easy to inspect or back up.
 */
import { AsyncLocalStorage } from "node:async_hooks";
import { randomBytes } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import {
  DEFAULT_SCHEME_ID,
  GradingLibrarySchema,
  GradingSchemeSchema,
  STANDARD_SCHEME,
  TaxonomySchema,
  type GradingLibrary,
  type GradingScheme,
  type Taxonomy,
} from "../shared/library";
import { findUnusedImages, type StoredFile, type UsageReport } from "./cleanup";
import { AssignmentSchema, type Assignment } from "../shared/assignments";
import { settleUnmarked } from "../shared/grading";
import {
  PersonaLibrarySchema,
  PersonaSchema,
  PersonaTemplateSchema,
  type Persona,
  type PersonaLibrary,
  type PersonaTemplate,
} from "../shared/personas";
import { ASSET_ID_PATTERN, AttemptSchema, ID_PATTERN, SimulationSchema, type Attempt, type Simulation } from "../shared/schema";
import { composeSimulation, sameToolParts, splitSimulation, StoredSimulationSchema, ToolSchema, toolParts, type StoredSimulation, type Tool } from "../shared/tools";

export const DATA_DIR = path.resolve(process.env.DATA_DIR || "data");

/**
 * Organisations. Every request runs "inside" its user's organisation (set by the auth
 * middleware with runInOrg), and every path below is resolved for that organisation, so
 * one organisation can never read another's files. The default organisation uses data/
 * itself (where everything lived before organisations existed); others get
 * data/orgs/<id>/. Users, sessions and the organisation list are global (see server/auth.ts).
 */
export const DEFAULT_ORG = "default";
const orgContext = new AsyncLocalStorage<string>();
export const runInOrg = <T>(orgId: string, fn: () => T): T => orgContext.run(orgId, fn);
export const currentOrg = () => orgContext.getStore() ?? DEFAULT_ORG;
function orgDir(): string {
  const id = currentOrg();
  if (!ID_PATTERN.test(id)) throw new HttpError(400, "Invalid organisation");
  return id === DEFAULT_ORG ? DATA_DIR : path.join(DATA_DIR, "orgs", id);
}
const SIM_DIR = () => path.join(orgDir(), "simulations");
const TOOL_DIR = () => path.join(orgDir(), "tools");
const ASSET_DIR = () => path.join(orgDir(), "assets");
const ATTEMPTS_FILE = () => path.join(orgDir(), "attempts.json");

/** Create an organisation's folders (and seed the sample) the first time it's used. */
const readyOrgs = new Set<string>();
let seedSims: Simulation[] = [];
export async function ensureOrgStorage() {
  const id = currentOrg();
  if (readyOrgs.has(id)) return;
  await fs.mkdir(SIM_DIR(), { recursive: true });
  await fs.mkdir(TOOL_DIR(), { recursive: true });
  await fs.mkdir(ASSET_DIR(), { recursive: true });
  if ((await fs.readdir(SIM_DIR())).length === 0) for (const s of seedSims) await saveSimulation(s);
  readyOrgs.add(id);
}

export const ASSET_TYPES: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
};

export async function initStorage(seed: Simulation[]) {
  seedSims = seed;
  await runInOrg(DEFAULT_ORG, ensureOrgStorage);
}

/** Write via temp file + rename so a crash never leaves a half-written file. */
async function writeAtomic(file: string, data: string | Buffer) {
  const tmp = `${file}.${randomBytes(4).toString("hex")}.tmp`;
  await fs.writeFile(tmp, data);
  await fs.rename(tmp, file);
}

function simPath(id: string) {
  if (!ID_PATTERN.test(id)) throw new HttpError(400, "Invalid simulation id");
  return path.join(SIM_DIR(), `${id}.json`);
}

export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export function newId(prefix = "sim") {
  return `${prefix}-${randomBytes(5).toString("hex")}`;
}

// ------------------------------------------------------------------ tools (shared/tools.ts)

function toolPath(id: string) {
  if (!ID_PATTERN.test(id)) throw new HttpError(400, "Invalid tool id");
  return path.join(TOOL_DIR(), `${id}.json`);
}

export async function getTool(id: string): Promise<Tool> {
  try {
    return ToolSchema.parse(JSON.parse(await fs.readFile(toolPath(id), "utf8")));
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") throw new HttpError(404, "Tool not found");
    throw e;
  }
}

export async function listTools(): Promise<Tool[]> {
  const files = (await fs.readdir(TOOL_DIR()).catch(() => [] as string[])).filter((f) => f.endsWith(".json"));
  const tools = await Promise.all(files.map((f) => getTool(f.slice(0, -5)).catch(() => null)));
  return tools.filter((t) => t !== null).sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Save a tool. With `expectVersion`, refuse if someone else saved it since it was loaded,
 * rather than silently overwriting their change to every simulation that uses it.
 */
export async function saveTool(input: unknown, expectVersion?: number): Promise<Tool> {
  const tool = ToolSchema.parse(input);
  const current = await getTool(tool.id).catch(() => null);
  if (current && expectVersion !== undefined && current.version !== expectVersion) {
    throw new HttpError(409, `The tool "${current.name}" was changed by someone else since you opened it. Reload to get their changes, then make yours again.`);
  }
  const now = new Date().toISOString();
  const saved = { ...tool, version: (current?.version ?? 0) + 1, createdAt: current?.createdAt ?? tool.createdAt ?? now, updatedAt: now };
  await writeAtomic(toolPath(tool.id), JSON.stringify(saved, null, 2));
  return saved;
}

export async function deleteTool(id: string) {
  const users = await simulationsUsingTool(id);
  if (users.length) throw new HttpError(409, `This tool is used by ${users.length} simulation${users.length === 1 ? "" : "s"}. Move or delete them first.`);
  await fs.rm(toolPath(id), { force: true });
}

/** The stored simulation, converting one saved before tools existed (its screens become a tool). */
async function readStored(id: string): Promise<StoredSimulation> {
  let raw: unknown;
  try {
    raw = JSON.parse(await fs.readFile(simPath(id), "utf8"));
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") throw new HttpError(404, "Simulation not found");
    throw e;
  }
  if (raw && typeof raw === "object" && "toolId" in raw && !("screens" in raw)) return StoredSimulationSchema.parse(raw);
  const legacy = SimulationSchema.parse(raw);
  const tool = await saveTool({ id: newId("tool"), name: legacy.title, description: legacy.description, ...toolParts(legacy) });
  const { stored } = splitSimulation({ ...legacy, toolId: tool.id });
  const out = StoredSimulationSchema.parse(stored);
  await writeAtomic(simPath(id), JSON.stringify(out, null, 2));
  return out;
}

async function storedIds(): Promise<string[]> {
  return (await fs.readdir(SIM_DIR())).filter((f) => f.endsWith(".json")).map((f) => f.slice(0, -5));
}

export async function simulationsUsingTool(toolId: string): Promise<{ id: string; title: string }[]> {
  const all = await Promise.all((await storedIds()).map((id) => readStored(id).catch(() => null)));
  return all.filter((s) => s?.toolId === toolId).map((s) => ({ id: s!.id, title: s!.title }));
}

export async function listSimulations() {
  const stored = await Promise.all((await storedIds()).map((id) => readStored(id).catch(() => null))); // skip unreadable files
  const tools = new Map((await listTools()).map((t) => [t.id, t]));
  return stored
    .filter((s) => s !== null && tools.has(s.toolId))
    .map((s) => {
      const tool = tools.get(s!.toolId)!;
      return {
        id: s!.id,
        title: s!.title,
        description: s!.description,
        toolId: tool.id,
        toolName: tool.name,
        screens: tool.screens.length,
        scenarios: s!.scenarios.length,
        cover: tool.screens.find((sc) => sc.imageAssetId)?.imageAssetId ?? null,
        tagIds: s!.tagIds,
        updatedAt: s!.updatedAt ?? null,
      };
    })
    .sort((a, b) => (b.updatedAt ?? "").localeCompare(a.updatedAt ?? ""));
}

export async function getSimulation(id: string): Promise<Simulation> {
  const stored = await readStored(id);
  return composeSimulation(stored, await getTool(stored.toolId));
}

/**
 * Save a simulation. Its screens, controls and variables go to its tool: if they changed, the
 * tool is updated (for every simulation that uses it), unless someone else changed the tool
 * since this simulation was loaded (toolVersion). A simulation without a tool gets a new one.
 */
export async function saveSimulation(input: unknown): Promise<Simulation> {
  const sim = SimulationSchema.parse(input);
  const now = new Date().toISOString();
  const { stored, parts } = splitSimulation(sim);
  let tool = stored.toolId ? await getTool(stored.toolId).catch(() => null) : null;
  if (!tool) tool = await saveTool({ id: newId("tool"), name: sim.title, description: sim.description, ...parts });
  else if (!sameToolParts(tool, parts)) tool = await saveTool({ ...tool, ...parts }, sim.toolVersion);
  const out = StoredSimulationSchema.parse({ ...stored, toolId: tool.id, createdAt: stored.createdAt ?? now, updatedAt: now });
  await writeAtomic(simPath(out.id), JSON.stringify(out, null, 2));
  return composeSimulation(out, tool);
}

/** Move a simulation onto another tool (its scenarios then use that tool's screens). */
export async function setSimulationTool(id: string, toolId: string): Promise<Simulation> {
  const stored = await readStored(id);
  const tool = await getTool(toolId);
  const out = StoredSimulationSchema.parse({ ...stored, toolId: tool.id, updatedAt: new Date().toISOString() });
  await writeAtomic(simPath(out.id), JSON.stringify(out, null, 2));
  return composeSimulation(out, tool);
}

export async function deleteSimulation(id: string) {
  await fs.rm(simPath(id), { force: true });
}

/** Identify an image from its first bytes, so a file can't pretend to be an image it isn't. */
export function sniffImageType(data: Buffer): string | null {
  if (data.length >= 8 && data.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (data.length >= 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) return "image/jpeg";
  if (data.length >= 6 && /^GIF8[79]a$/.test(data.subarray(0, 6).toString("latin1"))) return "image/gif";
  if (data.length >= 12 && data.subarray(0, 4).toString("latin1") === "RIFF" && data.subarray(8, 12).toString("latin1") === "WEBP") return "image/webp";
  return null;
}

export const MAX_ASSET_BYTES = 15_000_000;

export async function saveAsset(mediaType: string, data: Buffer): Promise<string> {
  const ext = ASSET_TYPES[mediaType];
  if (!ext) throw new HttpError(400, `Unsupported image type: ${mediaType}`);
  if (data.length > MAX_ASSET_BYTES) throw new HttpError(413, "Image too large (15 MB max).");
  if (sniffImageType(data) !== mediaType) throw new HttpError(400, `File content is not a valid ${mediaType} image.`);
  const id = `${newId("img")}.${ext}`;
  await writeAtomic(path.join(ASSET_DIR(), id), data);
  return id;
}

export function assetPath(id: string): string {
  if (!ASSET_ID_PATTERN.test(id)) throw new HttpError(400, "Invalid asset id");
  return path.join(ASSET_DIR(), id);
}

export async function readAsset(id: string): Promise<{ data: Buffer; mediaType: string }> {
  const data = await fs.readFile(assetPath(id));
  const ext = id.split(".").pop()!;
  const mediaType = Object.entries(ASSET_TYPES).find(([, e]) => e === ext)![0];
  return { data, mediaType };
}

/** The attempts file as stored. */
async function readAllAttempts(): Promise<Attempt[]> {
  try {
    return AttemptSchema.array().parse(JSON.parse(await fs.readFile(ATTEMPTS_FILE(), "utf8")));
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
    return [];
  }
}

export async function listAttempts(simulationId?: string): Promise<Attempt[]> {
  const all = await readAllAttempts();
  const mine = simulationId ? all.filter((a) => a.simulationId === simulationId) : all;
  return settleWhereNoMarking(mine);
}

/** Attempts in simulations without trainer marking never wait: settle any unmarked criteria. */
async function settleWhereNoMarking(attempts: Attempt[]): Promise<Attempt[]> {
  // AI-judged criteria are never left waiting: if the AI couldn't judge them, they're dropped.
  attempts = attempts.map((a) => settleUnmarked(a, { manual: false }));
  const waiting = new Set(attempts.filter((a) => a.grading?.rubric.some((c) => c.manual && c.met === null)).map((a) => a.simulationId));
  if (!waiting.size) return attempts;
  const marking = new Map<string, boolean>();
  for (const id of waiting) marking.set(id, await getSimulation(id).then((s) => s.grading.trainerMarking).catch(() => false));
  return attempts.map((a) => (waiting.has(a.simulationId) && !marking.get(a.simulationId) ? settleUnmarked(a) : a));
}

let attemptsLock: Promise<unknown> = Promise.resolve();
export function addAttempt(input: unknown): Promise<Attempt> {
  const attempt = AttemptSchema.parse({ ...(input as object), id: newId("att") });
  // Serialise writes so two attempts finishing together don't overwrite each other.
  const job = attemptsLock.then(async () => {
    const all = await readAllAttempts();
    const saved = (await settleWhereNoMarking([attempt]))[0];
    all.unshift(saved);
    await writeAtomic(ATTEMPTS_FILE(), JSON.stringify(all.slice(0, 5000), null, 2));
    return saved;
  });
  attemptsLock = job.catch(() => undefined);
  return job;
}

// ------------------------------------------------------------------ libraries

const TAXONOMY_FILE = () => path.join(orgDir(), "taxonomy.json");
const GRADING_FILE = () => path.join(orgDir(), "grading.json");

async function readJson<T>(file: string, fallback: T): Promise<unknown | T> {
  try {
    return JSON.parse(await fs.readFile(file, "utf8"));
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return fallback;
    throw e;
  }
}

export async function readTaxonomy(): Promise<Taxonomy> {
  return TaxonomySchema.parse(await readJson(TAXONOMY_FILE(), { topics: [] }));
}

export async function saveTaxonomy(input: unknown): Promise<Taxonomy> {
  const tax = TaxonomySchema.parse(input);
  const ids = new Set<string>();
  for (const t of tax.topics) for (const x of [t, ...t.tags]) {
    if (ids.has(x.id)) throw new HttpError(400, `Duplicate id "${x.id}" in topics/tags.`);
    ids.add(x.id);
  }
  await writeAtomic(TAXONOMY_FILE(), JSON.stringify(tax, null, 2));
  return tax;
}

/** The grading library, always including the built-in Standard scheme. */
export async function readGrading(): Promise<GradingLibrary> {
  const lib = GradingLibrarySchema.parse(await readJson(GRADING_FILE(), { schemes: [] }));
  if (!lib.schemes.some((s) => s.id === DEFAULT_SCHEME_ID)) lib.schemes.unshift(STANDARD_SCHEME);
  return lib;
}

export async function saveScheme(input: unknown): Promise<GradingScheme> {
  const scheme = GradingSchemeSchema.parse(input);
  const lib = await readGrading();
  const i = lib.schemes.findIndex((s) => s.id === scheme.id);
  if (i === -1) lib.schemes.push(scheme);
  else lib.schemes[i] = scheme;
  await writeAtomic(GRADING_FILE(), JSON.stringify(lib, null, 2));
  return scheme;
}

export async function deleteScheme(schemeId: string) {
  if (schemeId === DEFAULT_SCHEME_ID) throw new HttpError(400, "The Standard scheme can be edited but not deleted.");
  const users: string[] = [];
  for (const summary of await listSimulations()) {
    const sim = await getSimulation(summary.id);
    if (sim.grading.schemeId === schemeId) users.push(sim.title);
    for (const sc of sim.scenarios) if (sc.gradingSchemeId === schemeId) users.push(`${sim.title} → ${sc.title}`);
  }
  if (users.length) throw new HttpError(409, `This scheme is still used by: ${users.join("; ")}. Switch them to another scheme first.`);
  const lib = await readGrading();
  lib.schemes = lib.schemes.filter((s) => s.id !== schemeId);
  await writeAtomic(GRADING_FILE(), JSON.stringify(lib, null, 2));
}

/**
 * Attach results and assignments saved under a typed name (before accounts) to a person.
 * Only records without an account are changed; returns how many of each.
 */
export async function linkNamedResults(trainee: string, userId: string): Promise<{ attempts: number; assignments: number }> {
  const same = (name: string) => name.trim().toLowerCase() === trainee.trim().toLowerCase();
  const job = attemptsLock.then(async () => {
    const all = await readAllAttempts();
    let n = 0;
    const next = all.map((a) => (!a.userId && same(a.trainee) ? (n++, { ...a, userId }) : a));
    if (n) await writeAtomic(ATTEMPTS_FILE(), JSON.stringify(next, null, 2));
    return n;
  });
  attemptsLock = job.catch(() => undefined);
  const attempts = await job;
  let assignments = 0;
  await updateAssignments((all) => all.map((a) => (!a.userId && same(a.trainee) ? (assignments++, { ...a, userId }) : a)));
  return { attempts, assignments };
}

/** Change one saved attempt (used for trainer marking). Serialised with other attempt writes. */
export function updateAttempt(attemptId: string, fn: (a: Attempt) => Attempt): Promise<Attempt> {
  const job = attemptsLock.then(async () => {
    const all = await readAllAttempts();
    const i = all.findIndex((a) => a.id === attemptId);
    if (i === -1) throw new HttpError(404, "Attempt not found");
    all[i] = AttemptSchema.parse(fn(all[i]));
    await writeAtomic(ATTEMPTS_FILE(), JSON.stringify(all, null, 2));
    return all[i];
  });
  attemptsLock = job.catch(() => undefined);
  return job;
}

// ------------------------------------------------------------------ image clean-up

async function storedImages(): Promise<StoredFile[]> {
  const names = (await fs.readdir(ASSET_DIR())).filter((n) => ASSET_ID_PATTERN.test(n));
  return Promise.all(
    names.map(async (id) => {
      const st = await fs.stat(path.join(ASSET_DIR(), id));
      return { id, size: st.size, mtimeMs: st.mtimeMs };
    }),
  );
}

async function referencedImages(): Promise<Set<string>> {
  const used = new Set<string>();
  // Screens live in tools, including tools no simulation uses yet.
  for (const tool of await listTools()) for (const s of tool.screens) if (s.imageAssetId) used.add(s.imageAssetId);
  return used;
}

export async function imageUsage(): Promise<UsageReport> {
  return findUnusedImages(await storedImages(), await referencedImages());
}

/** Delete removable images. Recomputed at the moment of deletion, never from a stale preview. */
export async function deleteUnusedImages(): Promise<{ deleted: number; bytes: number }> {
  const report = await imageUsage();
  for (const id of report.removable.ids) await fs.rm(assetPath(id), { force: true });
  return { deleted: report.removable.count, bytes: report.removable.bytes };
}

// ------------------------------------------------------------------ assignments

const ASSIGNMENTS_FILE = () => path.join(orgDir(), "assignments.json");
let assignmentsLock: Promise<unknown> = Promise.resolve();

export async function listAssignments(): Promise<Assignment[]> {
  return AssignmentSchema.array().parse(await readJson(ASSIGNMENTS_FILE(), []));
}

export async function getAssignment(id: string): Promise<Assignment> {
  const a = (await listAssignments()).find((x) => x.id === id);
  if (!a) throw new HttpError(404, "Assignment not found");
  return a;
}

function updateAssignments(fn: (all: Assignment[]) => Assignment[]): Promise<Assignment[]> {
  const job = assignmentsLock.then(async () => {
    const next = fn(await listAssignments());
    await writeAtomic(ASSIGNMENTS_FILE(), JSON.stringify(next, null, 2));
    return next;
  });
  assignmentsLock = job.catch(() => undefined);
  return job;
}

/** Assign one scenario to several people. One assignment per person; anyone listed twice gets one. */
export async function createAssignments(input: {
  assignees: { userId: string; name: string }[];
  assignedBy: string;
  simulationId: string;
  scenarioId: string;
  requirement?: string;
  dueDate?: string | null;
  note?: string;
}): Promise<Assignment[]> {
  const sim = await getSimulation(input.simulationId);
  const sc = sim.scenarios.find((s) => s.id === input.scenarioId);
  if (!sc) throw new HttpError(400, "That scenario doesn't exist in the simulation.");
  const assignees = [...new Map(input.assignees.map((a) => [a.userId, a])).values()];
  if (!assignees.length) throw new HttpError(400, "Choose at least one person.");
  const now = new Date().toISOString();
  const created = assignees.map((a) =>
    AssignmentSchema.parse({
      id: newId("asg"),
      userId: a.userId,
      trainee: a.name,
      assignedBy: input.assignedBy,
      simulationId: sim.id,
      scenarioId: sc.id,
      simulationTitle: sim.title,
      scenarioTitle: sc.title,
      requirement: input.requirement,
      dueDate: input.dueDate || null,
      note: input.note ?? "",
      createdAt: now,
    }),
  );
  await updateAssignments((all) => [...created, ...all]);
  return created;
}

export async function deleteAssignment(id: string) {
  await updateAssignments((all) => all.filter((a) => a.id !== id));
}

// ------------------------------------------------------------------ personas

const PERSONAS_FILE = () => path.join(orgDir(), "personas.json");
let personasLock: Promise<unknown> = Promise.resolve();

export async function readPersonas(): Promise<PersonaLibrary> {
  return PersonaLibrarySchema.parse(await readJson(PERSONAS_FILE(), { templates: [], personas: [] }));
}

function updatePersonas<T>(fn: (lib: PersonaLibrary) => T | Promise<T>): Promise<T> {
  const job = personasLock.then(async () => {
    const lib = await readPersonas();
    const out = await fn(lib);
    await writeAtomic(PERSONAS_FILE(), JSON.stringify(PersonaLibrarySchema.parse(lib), null, 2));
    return out;
  });
  personasLock = job.catch(() => undefined);
  return job;
}

export function savePersonaTemplate(input: unknown): Promise<PersonaTemplate> {
  const t = PersonaTemplateSchema.parse(input);
  const keys = [...t.fields.map((f) => f.key), ...t.tables.map((x) => x.key)];
  const dup = keys.find((k, i) => keys.indexOf(k) !== i);
  if (dup) throw new HttpError(400, `The key "${dup}" is used twice in this template.`);
  return updatePersonas((lib) => {
    const i = lib.templates.findIndex((x) => x.id === t.id);
    if (i === -1) lib.templates.push(t);
    else lib.templates[i] = t;
    return t;
  });
}

export function deletePersonaTemplate(templateId: string): Promise<void> {
  return updatePersonas((lib) => {
    const users = lib.personas.filter((p) => p.templateId === templateId).map((p) => p.name);
    if (users.length) throw new HttpError(409, `These personas use this template: ${users.join(", ")}. Change or delete them first.`);
    lib.templates = lib.templates.filter((t) => t.id !== templateId);
  });
}

export function savePersona(input: unknown): Promise<Persona> {
  const p = PersonaSchema.parse(input);
  return updatePersonas((lib) => {
    if (p.templateId && !lib.templates.some((t) => t.id === p.templateId)) throw new HttpError(400, "That persona template doesn't exist.");
    const i = lib.personas.findIndex((x) => x.id === p.id);
    if (i === -1) lib.personas.push(p);
    else lib.personas[i] = p;
    return p;
  });
}

/** Where a persona appears: "Simulation" (all of it) or "Simulation → Scenario". */
export async function personaUsage(personaId: string): Promise<string[]> {
  const users: string[] = [];
  for (const summary of await listSimulations()) {
    const sim = await getSimulation(summary.id);
    if (sim.personas.some((l) => l.personaId === personaId)) users.push(sim.title);
    for (const sc of sim.scenarios) if (sc.personaOverrides.some((o) => o.personaId === personaId)) users.push(`${sim.title} → ${sc.title}`);
  }
  return users;
}

export async function deletePersona(personaId: string): Promise<void> {
  const users = await personaUsage(personaId);
  if (users.length) throw new HttpError(409, `This persona is used by: ${users.join("; ")}. Remove it there first.`);
  await updatePersonas((lib) => {
    lib.personas = lib.personas.filter((p) => p.id !== personaId);
  });
}
