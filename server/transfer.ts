/**
 * Import / export of a simulation as one self-contained JSON file:
 *
 *   {
 *     "format": "simulator-export", "version": 1, "exportedAt": "...",
 *     "simulation": { ...the Simulation... },
 *     "assets": { "<assetId>": { "mediaType": "image/png", "data": "<base64>" } },
 *     "library": {                                  (optional; files from older versions lack it)
 *       "tags":    [{ "id", "name", "topic" }],     the simulation's tags, by name
 *       "schemes": [ ...GradingScheme ]             grading schemes it or its scenarios use
 *       "personas": [ ...Persona ], "personaTemplates": [ ...PersonaTemplate ]
 *     }
 *   }
 *
 * Only images the simulation actually uses are included. On import every image is
 * re-stored under a new id (its bytes are checked to really be that image type), the
 * simulation gets a new id so nothing is overwritten, and it is fully validated.
 *
 * Library references are matched by NAME, because ids differ between installations:
 *   tags     same id here → kept; else same topic + tag name → that tag;
 *            else created (admins only) or dropped with a warning
 *   schemes  same id and name here → kept; else a scheme with the same name → that one
 *            (rubric targets re-linked by criterion label); else created (admins only) or
 *            replaced by Standard with a warning
 *   personas same id here → kept; else a persona with the same name → that one; else created
 *            with its template (matched by name, or created) for admins, or unlinked with a warning
 * Plain simulation JSON (no wrapper, no images, no library) is accepted too.
 *
 * Storage is passed in as functions so this logic can be tested without a disk.
 */
import { z } from "zod";
import { lintSimulation } from "../shared/engine";
import { DEFAULT_SCHEME_ID, findTag, GradingSchemeSchema, type GradingScheme, type Taxonomy } from "../shared/library";
import { ASSET_ID_PATTERN, SimulationSchema, type Binding, type Simulation } from "../shared/schema";
import { PersonaSchema, PersonaTemplateSchema, type Persona, type PersonaLibrary, type PersonaTemplate } from "../shared/personas";

export const EXPORT_FORMAT = "simulator-export";

const BundleSchema = z.object({
  format: z.literal(EXPORT_FORMAT),
  version: z.literal(1),
  exportedAt: z.string().optional(),
  simulation: z.unknown(),
  assets: z.record(z.string(), z.object({ mediaType: z.string(), data: z.string() })).default({}),
  library: z
    .object({
      tags: z.array(z.object({ id: z.string(), name: z.string(), topic: z.string() })).default([]),
      schemes: z.array(GradingSchemeSchema).default([]),
      personas: z.array(PersonaSchema).default([]),
      personaTemplates: z.array(PersonaTemplateSchema).default([]),
    })
    .default({ tags: [], schemes: [], personas: [], personaTemplates: [] }),
});

export interface Bundle {
  format: typeof EXPORT_FORMAT;
  version: 1;
  exportedAt: string;
  simulation: Simulation;
  assets: Record<string, { mediaType: string; data: string }>;
  library: {
    tags: { id: string; name: string; topic: string }[];
    schemes: GradingScheme[];
    personas: Persona[];
    personaTemplates: PersonaTemplate[];
  };
}

type ReadAsset = (id: string) => Promise<{ data: Buffer; mediaType: string }>;
type SaveAsset = (mediaType: string, data: Buffer) => Promise<string>;

/** The libraries as they are on this installation (for exporting names, or matching on import). */
export interface LocalLibrary {
  taxonomy: Taxonomy;
  schemes: GradingScheme[];
  personas?: PersonaLibrary;
}

export async function buildBundle(
  sim: Simulation,
  readAsset: ReadAsset,
  library: LocalLibrary = { taxonomy: { topics: [] }, schemes: [] },
): Promise<{ bundle: Bundle; missing: string[] }> {
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
  const tags = sim.tagIds.flatMap((id) => {
    const found = findTag(library.taxonomy, id);
    return found ? [{ id, name: found.tag.name, topic: found.topic.name }] : [];
  });
  const schemeIds = new Set([sim.grading.schemeId, ...sim.scenarios.map((s) => s.gradingSchemeId)].filter((x): x is string => !!x));
  const schemes = library.schemes.filter((s) => schemeIds.has(s.id));
  const personaIds = new Set([...sim.personas.map((p) => p.personaId), ...sim.scenarios.flatMap((sc) => sc.personaOverrides.map((o) => o.personaId))]);
  const personas = (library.personas?.personas ?? []).filter((p) => personaIds.has(p.id));
  const templateIds = new Set(personas.map((p) => p.templateId));
  const personaTemplates = (library.personas?.templates ?? []).filter((t) => templateIds.has(t.id));
  return {
    bundle: {
      format: EXPORT_FORMAT,
      version: 1,
      exportedAt: new Date().toISOString(),
      simulation: sim,
      assets,
      library: { tags, schemes, personas, personaTemplates },
    },
    missing,
  };
}

export class ImportError extends Error {}

export interface ImportOptions extends LocalLibrary {
  /** May the import add missing topics, tags and grading schemes to the libraries? (admins) */
  canCreate: boolean;
  makeId: (prefix: string) => string;
}

export interface ImportResult {
  simulation: Simulation;
  warnings: string[];
  /** Library additions to save (only when canCreate): the whole updated taxonomy, new schemes, new personas and templates. */
  created: { taxonomy: Taxonomy | null; schemes: GradingScheme[]; personas: Persona[]; personaTemplates: PersonaTemplate[] };
}

const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

export async function importBundle(raw: unknown, saveAsset: SaveAsset, newSimId: string, opts?: ImportOptions): Promise<ImportResult> {
  const warnings: string[] = [];
  let simulationRaw: unknown;
  let assets: Record<string, { mediaType: string; data: string }> = {};
  let fileLibrary: Bundle["library"] = { tags: [], schemes: [], personas: [], personaTemplates: [] };

  if (raw && typeof raw === "object" && (raw as { format?: unknown }).format === EXPORT_FORMAT) {
    const parsed = BundleSchema.safeParse(raw);
    if (!parsed.success) throw new ImportError("This export file is damaged or from an unsupported version.");
    simulationRaw = parsed.data.simulation;
    assets = parsed.data.assets;
    fileLibrary = parsed.data.library;
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

  const created: ImportResult["created"] = { taxonomy: null, schemes: [], personas: [], personaTemplates: [] };
  if (opts) {
    mapTags(sim, fileLibrary, opts, created, warnings);
    mapSchemes(sim, fileLibrary, opts, created, warnings);
    mapPersonas(sim, fileLibrary, opts, created, warnings);
  }

  sim.createdAt = undefined;
  sim.updatedAt = undefined;
  warnings.push(...lintSimulation(sim));
  return { simulation: sim, warnings, created };
}

function mapTags(sim: Simulation, file: Bundle["library"], opts: ImportOptions, created: ImportResult["created"], warnings: string[]) {
  let tax = opts.taxonomy;
  const mapped: string[] = [];
  let added = 0;
  let dropped = 0;
  for (const tagId of sim.tagIds) {
    if (findTag(tax, tagId)) {
      mapped.push(tagId); // same installation (or same ids)
      continue;
    }
    const info = file.tags.find((t) => t.id === tagId);
    if (!info) {
      dropped++;
      continue;
    }
    const topic = tax.topics.find((t) => same(t.name, info.topic));
    const tag = topic?.tags.find((t) => same(t.name, info.name));
    if (tag) {
      mapped.push(tag.id);
      continue;
    }
    if (!opts.canCreate) {
      dropped++;
      continue;
    }
    // Admin import: add the missing topic and/or tag.
    if (!created.taxonomy) created.taxonomy = tax = structuredClone(tax);
    let target = tax.topics.find((t) => same(t.name, info.topic));
    if (!target) {
      target = { id: opts.makeId("topic"), name: info.topic, description: "", tags: [] };
      tax.topics.push(target);
    }
    const newTag = { id: opts.makeId("tag"), name: info.name };
    target.tags.push(newTag);
    mapped.push(newTag.id);
    added++;
  }
  sim.tagIds = [...new Set(mapped)];
  if (added) warnings.push(`Added ${plural(added, "tag")} from the file to the tag library.`);
  if (dropped) {
    warnings.push(
      `${plural(dropped, "tag")} from the file ${dropped === 1 ? "isn't" : "aren't"} in this library and ${dropped === 1 ? "was" : "were"} removed` +
        (opts.canCreate ? "." : ". An admin can import the file to add them."),
    );
  }
}

/** Re-point bindings at the local scheme's items, matching by item label. */
function remapBindings(bindings: Binding[], from: GradingScheme, to: GradingScheme, warnings: string[]): Binding[] {
  const items = (s: GradingScheme) => [...s.rubric, ...s.objectives];
  let lost = 0;
  const out = bindings.flatMap((b) => {
    const label = items(from).find((i) => i.id === b.itemId)?.label;
    const target = label ? items(to).find((i) => same(i.label, label)) : undefined;
    if (!target) {
      lost++;
      return [];
    }
    return [{ ...b, itemId: target.id }];
  });
  if (lost) warnings.push(`${plural(lost, "grading check target")} couldn't be matched to "${to.name}" and must be set again in Settings.`);
  return out;
}

function mapSchemes(sim: Simulation, file: Bundle["library"], opts: ImportOptions, created: ImportResult["created"], warnings: string[]) {
  const resolved = new Map<string, GradingScheme | null>(); // file scheme id → local scheme (null = none)
  const local = () => [...opts.schemes, ...created.schemes];

  const resolve = (schemeId: string): GradingScheme | null => {
    if (resolved.has(schemeId)) return resolved.get(schemeId)!;
    const fromFile = file.schemes.find((s) => s.id === schemeId);
    const sameId = local().find((s) => s.id === schemeId);
    let result: GradingScheme | null = null;
    if (schemeId === DEFAULT_SCHEME_ID) result = sameId ?? null;
    else if (sameId && (!fromFile || same(sameId.name, fromFile.name))) result = sameId;
    else if (fromFile) {
      result = local().find((s) => same(s.name, fromFile.name)) ?? null;
      if (!result && opts.canCreate) {
        result = { ...structuredClone(fromFile), id: opts.makeId("scheme") };
        created.schemes.push(result);
        warnings.push(`Added the grading scheme "${fromFile.name}" from the file to the grading library.`);
      }
    }
    if (!result && schemeId !== DEFAULT_SCHEME_ID) {
      const name = fromFile ? `"${fromFile.name}"` : "used by the file";
      warnings.push(
        `The grading scheme ${name} isn't in this library, so Standard grading is used instead` +
          (opts.canCreate ? "." : ". An admin can import the file to add it."),
      );
    }
    resolved.set(schemeId, result);
    return result;
  };

  if (sim.grading.schemeId) {
    const fromFile = file.schemes.find((s) => s.id === sim.grading.schemeId);
    const target = resolve(sim.grading.schemeId);
    if (!target) sim.grading = { schemeId: null, bindings: [] };
    else {
      if (fromFile && target.id !== fromFile.id) sim.grading.bindings = remapBindings(sim.grading.bindings, fromFile, target, warnings);
      sim.grading.schemeId = target.id;
    }
  }
  for (const sc of sim.scenarios) {
    if (!sc.gradingSchemeId) continue;
    sc.gradingSchemeId = resolve(sc.gradingSchemeId)?.id ?? null;
  }
}

function mapPersonas(sim: Simulation, file: Bundle["library"], opts: ImportOptions, created: ImportResult["created"], warnings: string[]) {
  const local = opts.personas ?? { templates: [], personas: [] };
  const resolved = new Map<string, string | null>();
  const resolve = (personaId: string): string | null => {
    if (resolved.has(personaId)) return resolved.get(personaId)!;
    const fromFile = file.personas.find((p) => p.id === personaId);
    const all = [...local.personas, ...created.personas];
    let result: string | null = null;
    const sameId = all.find((p) => p.id === personaId);
    if (sameId && (!fromFile || same(sameId.name, fromFile.name))) result = sameId.id;
    else if (fromFile) {
      result = all.find((p) => same(p.name, fromFile.name))?.id ?? null;
      if (!result && opts.canCreate) {
        // Bring the persona's template too: same name here, or a copy.
        let templateId: string | null = null;
        const fileTpl = file.personaTemplates.find((t) => t.id === fromFile.templateId);
        if (fileTpl) {
          const tpls = [...local.templates, ...created.personaTemplates];
          templateId = tpls.find((t) => same(t.name, fileTpl.name))?.id ?? null;
          if (!templateId) {
            const copy = { ...structuredClone(fileTpl), id: opts.makeId("tpl") };
            created.personaTemplates.push(copy);
            templateId = copy.id;
          }
        }
        const copy = { ...structuredClone(fromFile), id: opts.makeId("persona"), templateId };
        created.personas.push(copy);
        result = copy.id;
        warnings.push(`Added the persona "${fromFile.name}" from the file to the persona library.`);
      }
    }
    if (!result) {
      warnings.push(
        `The persona ${fromFile ? `"${fromFile.name}"` : "used by the file"} isn't in this library, so it was unlinked` +
          (opts.canCreate ? "." : ". An admin can import the file to add it."),
      );
    }
    resolved.set(personaId, result);
    return result;
  };
  sim.personas = sim.personas.flatMap((l) => {
    const id = resolve(l.personaId);
    return id ? [{ ...l, personaId: id }] : [];
  });
  for (const sc of sim.scenarios) {
    sc.personaOverrides = sc.personaOverrides.flatMap((o) => {
      if (o.personaId === null) return [o];
      const id = resolve(o.personaId);
      return id ? [{ ...o, personaId: id }] : [];
    });
  }
}

/** A safe download file name for a simulation title. */
export function exportFileName(title: string): string {
  const base = title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "simulation";
  return `${base}.simulation.json`;
}
