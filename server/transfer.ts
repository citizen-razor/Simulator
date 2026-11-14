/**
 * Import / export of a simulation as one self-contained JSON file:
 *
 *   {
 *     "format": "simulator-export", "version": 1, "exportedAt": "...",
 *     "simulation": { ...the Simulation... },
 *     "assets": { "<assetId>": { "mediaType": "image/png", "data": "<base64>" } }
 *   }
 *
 * Only images the simulation actually uses are included. On import every image is
 * re-stored under a new id (its bytes are checked to really be that image type), the
 * simulation gets a new id so nothing is overwritten, and it is fully validated.
 * Plain simulation JSON (no wrapper, no images) is accepted too.
 *
 * Storage is passed in as functions so this logic can be tested without a disk.
 */
import { z } from "zod";
import { lintSimulation } from "../shared/engine";
import { ASSET_ID_PATTERN, SimulationSchema, type Simulation } from "../shared/schema";

export const EXPORT_FORMAT = "simulator-export";

const BundleSchema = z.object({
  format: z.literal(EXPORT_FORMAT),
  version: z.literal(1),
  exportedAt: z.string().optional(),
  simulation: z.unknown(),
  assets: z.record(z.string(), z.object({ mediaType: z.string(), data: z.string() })).default({}),
});

export interface Bundle {
  format: typeof EXPORT_FORMAT;
  version: 1;
  exportedAt: string;
  simulation: Simulation;
  assets: Record<string, { mediaType: string; data: string }>;
}

type ReadAsset = (id: string) => Promise<{ data: Buffer; mediaType: string }>;
type SaveAsset = (mediaType: string, data: Buffer) => Promise<string>;

export async function buildBundle(sim: Simulation, readAsset: ReadAsset): Promise<{ bundle: Bundle; missing: string[] }> {
  const assets: Bundle["assets"] = {};
  const missing: string[] = [];
  for (const screen of sim.screens) {
    const id = screen.imageAssetId;
    if (!id || assets[id]) continue;
    try {
      const { data, mediaType } = await readAsset(id);
      assets[id] = { mediaType, data: data.toString("base64") };
    } catch {
      missing.push(screen.name);
    }
  }
  return {
    bundle: { format: EXPORT_FORMAT, version: 1, exportedAt: new Date().toISOString(), simulation: sim, assets },
    missing,
  };
}

export class ImportError extends Error {}

export async function importBundle(
  raw: unknown,
  saveAsset: SaveAsset,
  newSimId: string,
): Promise<{ simulation: Simulation; warnings: string[] }> {
  const warnings: string[] = [];
  let simulationRaw: unknown;
  let assets: Record<string, { mediaType: string; data: string }> = {};

  if (raw && typeof raw === "object" && (raw as { format?: unknown }).format === EXPORT_FORMAT) {
    const parsed = BundleSchema.safeParse(raw);
    if (!parsed.success) throw new ImportError("This export file is damaged or from an unsupported version.");
    simulationRaw = parsed.data.simulation;
    assets = parsed.data.assets;
  } else {
    simulationRaw = raw; // plain simulation JSON
  }

  const check = SimulationSchema.safeParse({ ...(simulationRaw as object), id: newSimId });
  if (!check.success) {
    const first = check.error.issues[0];
    throw new ImportError(`Not a valid simulation file${first ? ` (${first.path.join(".") || "root"}: ${first.message})` : ""}.`);
  }
  const sim = check.data;

  // Store images first, then point screens at the new ids.
  const idMap = new Map<string, string>();
  for (const [oldId, asset] of Object.entries(assets)) {
    if (!ASSET_ID_PATTERN.test(oldId)) continue;
    if (!sim.screens.some((s) => s.imageAssetId === oldId)) continue; // unused: skip
    try {
      idMap.set(oldId, await saveAsset(asset.mediaType, Buffer.from(asset.data, "base64")));
    } catch (e) {
      warnings.push(`An image was skipped: ${(e as Error).message}`);
    }
  }
  for (const screen of sim.screens) {
    if (!screen.imageAssetId) continue;
    const mapped = idMap.get(screen.imageAssetId);
    if (!mapped) warnings.push(`Screen "${screen.name}" had no usable image in the file; it will show as a wireframe.`);
    screen.imageAssetId = mapped ?? null;
  }

  sim.createdAt = undefined;
  sim.updatedAt = undefined;
  warnings.push(...lintSimulation(sim));
  return { simulation: sim, warnings };
}

/** A safe download file name for a simulation title. */
export function exportFileName(title: string): string {
  const base = title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "simulation";
  return `${base}.simulation.json`;
}
