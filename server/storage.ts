/**
 * File-based storage. Everything lives under ./data (git-ignored):
 *   data/simulations/<id>.json   one file per simulation
 *   data/assets/<id>.<ext>       uploaded screenshots / video frames
 *   data/attempts.json           scored scenario attempts
 * Plain files keep the prototype dependency-free and easy to inspect or back up.
 */
import { randomBytes } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { ASSET_ID_PATTERN, AttemptSchema, ID_PATTERN, SimulationSchema, type Attempt, type Simulation } from "../shared/schema";

const DATA_DIR = path.resolve(process.env.DATA_DIR || "data");
const SIM_DIR = path.join(DATA_DIR, "simulations");
const ASSET_DIR = path.join(DATA_DIR, "assets");
const ATTEMPTS_FILE = path.join(DATA_DIR, "attempts.json");

export const ASSET_TYPES: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
};

export async function initStorage(seed: Simulation[]) {
  await fs.mkdir(SIM_DIR, { recursive: true });
  await fs.mkdir(ASSET_DIR, { recursive: true });
  const existing = await fs.readdir(SIM_DIR);
  if (existing.length === 0) for (const s of seed) await saveSimulation(s);
}

/** Write via temp file + rename so a crash never leaves a half-written file. */
async function writeAtomic(file: string, data: string | Buffer) {
  const tmp = `${file}.${randomBytes(4).toString("hex")}.tmp`;
  await fs.writeFile(tmp, data);
  await fs.rename(tmp, file);
}

function simPath(id: string) {
  if (!ID_PATTERN.test(id)) throw new HttpError(400, "Invalid simulation id");
  return path.join(SIM_DIR, `${id}.json`);
}

export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export function newId(prefix = "sim") {
  return `${prefix}-${randomBytes(5).toString("hex")}`;
}

export async function listSimulations() {
  const files = (await fs.readdir(SIM_DIR)).filter((f) => f.endsWith(".json"));
  const sims = await Promise.all(
    files.map(async (f) => {
      try {
        const s = SimulationSchema.parse(JSON.parse(await fs.readFile(path.join(SIM_DIR, f), "utf8")));
        const cover = s.screens.find((sc) => sc.imageAssetId)?.imageAssetId ?? null;
        return {
          id: s.id,
          title: s.title,
          description: s.description,
          screens: s.screens.length,
          scenarios: s.scenarios.length,
          cover,
          updatedAt: s.updatedAt ?? null,
        };
      } catch {
        return null; // skip unreadable files rather than breaking the library
      }
    }),
  );
  return sims.filter((s) => s !== null).sort((a, b) => (b.updatedAt ?? "").localeCompare(a.updatedAt ?? ""));
}

export async function getSimulation(id: string): Promise<Simulation> {
  try {
    return SimulationSchema.parse(JSON.parse(await fs.readFile(simPath(id), "utf8")));
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") throw new HttpError(404, "Simulation not found");
    throw e;
  }
}

export async function saveSimulation(input: unknown): Promise<Simulation> {
  const sim = SimulationSchema.parse(input);
  const now = new Date().toISOString();
  sim.createdAt ??= now;
  sim.updatedAt = now;
  await writeAtomic(simPath(sim.id), JSON.stringify(sim, null, 2));
  return sim;
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
  await writeAtomic(path.join(ASSET_DIR, id), data);
  return id;
}

export function assetPath(id: string): string {
  if (!ASSET_ID_PATTERN.test(id)) throw new HttpError(400, "Invalid asset id");
  return path.join(ASSET_DIR, id);
}

export async function readAsset(id: string): Promise<{ data: Buffer; mediaType: string }> {
  const data = await fs.readFile(assetPath(id));
  const ext = id.split(".").pop()!;
  const mediaType = Object.entries(ASSET_TYPES).find(([, e]) => e === ext)![0];
  return { data, mediaType };
}

export async function listAttempts(simulationId?: string): Promise<Attempt[]> {
  let all: Attempt[] = [];
  try {
    all = AttemptSchema.array().parse(JSON.parse(await fs.readFile(ATTEMPTS_FILE, "utf8")));
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
  }
  return simulationId ? all.filter((a) => a.simulationId === simulationId) : all;
}

let attemptsLock: Promise<unknown> = Promise.resolve();
export function addAttempt(input: unknown): Promise<Attempt> {
  const attempt = AttemptSchema.parse({ ...(input as object), id: newId("att") });
  // Serialise writes so two attempts finishing together don't overwrite each other.
  const job = attemptsLock.then(async () => {
    const all = await listAttempts();
    all.unshift(attempt);
    await writeAtomic(ATTEMPTS_FILE, JSON.stringify(all.slice(0, 5000), null, 2));
    return attempt;
  });
  attemptsLock = job.catch(() => undefined);
  return job;
}
