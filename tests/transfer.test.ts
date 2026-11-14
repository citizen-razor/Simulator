import { describe, expect, it } from "vitest";
import sample from "../samples/helpdesk.json";
import { sniffImageType } from "../server/storage";
import { buildBundle, exportFileName, importBundle } from "../server/transfer";
import { GradingSchemeSchema } from "../shared/library";
import { SimulationSchema, type Simulation } from "../shared/schema";

// A real 1x1 PNG.
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");

/** In-memory stand-in for the asset store, with the same content check as the real one. */
function memoryStore() {
  const files = new Map<string, { data: Buffer; mediaType: string }>();
  let n = 0;
  return {
    files,
    read: async (id: string) => {
      const f = files.get(id);
      if (!f) throw new Error("missing");
      return f;
    },
    save: async (mediaType: string, data: Buffer) => {
      if (sniffImageType(data) !== mediaType) throw new Error(`File content is not a valid ${mediaType} image.`);
      const id = `img-${++n}.png`;
      files.set(id, { data, mediaType });
      return id;
    },
  };
}

function simWithImage(assetId: string): Simulation {
  const sim = SimulationSchema.parse(structuredClone(sample));
  sim.screens[0].imageAssetId = assetId;
  sim.screens[1].imageAssetId = assetId; // shared image is exported once
  return sim;
}

describe("image content check", () => {
  it("recognises real images and rejects disguised files", () => {
    expect(sniffImageType(PNG)).toBe("image/png");
    expect(sniffImageType(Buffer.from([0xff, 0xd8, 0xff, 0xe0]))).toBe("image/jpeg");
    expect(sniffImageType(Buffer.from("GIF89a....."))).toBe("image/gif");
    expect(sniffImageType(Buffer.from("<svg onload=alert(1)>"))).toBeNull();
  });
});

describe("export / import", () => {
  it("round-trips a simulation with its images under new ids", async () => {
    const source = memoryStore();
    source.files.set("img-orig.png", { data: PNG, mediaType: "image/png" });
    const { bundle, missing } = await buildBundle(simWithImage("img-orig.png"), source.read);
    expect(missing).toEqual([]);
    expect(Object.keys(bundle.assets)).toEqual(["img-orig.png"]);

    const target = memoryStore();
    const { simulation, warnings } = await importBundle(JSON.parse(JSON.stringify(bundle)), target.save, "sim-new");
    expect(warnings).toEqual([]);
    expect(simulation.id).toBe("sim-new");
    expect(simulation.screens[0].imageAssetId).toBe("img-1.png");
    expect(simulation.screens[1].imageAssetId).toBe("img-1.png");
    expect(target.files.get("img-1.png")!.data.equals(PNG)).toBe(true);
    expect(simulation.scenarios).toEqual(SimulationSchema.parse(sample).scenarios);
  });

  it("accepts plain simulation JSON without images", async () => {
    const { simulation, warnings } = await importBundle(sample, memoryStore().save, "sim-plain");
    expect(simulation.title).toBe(sample.title);
    expect(warnings).toEqual([]);
  });

  it("skips images whose content doesn't match, and says so", async () => {
    const source = memoryStore();
    source.files.set("img-orig.png", { data: PNG, mediaType: "image/png" });
    const { bundle } = await buildBundle(simWithImage("img-orig.png"), source.read);
    bundle.assets["img-orig.png"].data = Buffer.from("<html>not an image</html>").toString("base64");
    const { simulation, warnings } = await importBundle(bundle, memoryStore().save, "sim-x");
    expect(simulation.screens[0].imageAssetId).toBeNull();
    expect(warnings.join(" ")).toMatch(/not a valid image\/png/);
    expect(warnings.join(" ")).toMatch(/wireframe/);
  });

  it("rejects files that aren't simulations", async () => {
    await expect(importBundle({ hello: "world" }, memoryStore().save, "x")).rejects.toThrow(/Not a valid simulation/);
    await expect(importBundle({ format: "simulator-export", version: 99 }, memoryStore().save, "x")).rejects.toThrow(/unsupported version/);
  });

  it("makes safe file names", () => {
    expect(exportFileName("CRM: Refunds / Returns!")).toBe("crm-refunds-returns.simulation.json");
    expect(exportFileName("???")).toBe("simulation.simulation.json");
  });
});

describe("tags and grading schemes travel with exports", () => {
  // The exporting installation's libraries.
  const source = {
    taxonomy: { topics: [{ id: "topic-src", name: "Customer service", description: "", tags: [{ id: "tag-src", name: "Tickets" }] }] },
    schemes: [
      GradingSchemeSchema.parse({
        id: "scheme-src",
        name: "Support assessment",
        rubric: [{ id: "crit-src", label: "Ticket ends up resolved", check: { type: "state" } }],
      }),
    ],
  };
  const binding = { itemId: "crit-src", conditions: [{ var: "t1042_status", op: "eq" as const, value: "Resolved" }] };
  async function exported() {
    const sim = SimulationSchema.parse(structuredClone(sample));
    sim.tagIds = ["tag-src"];
    sim.grading = { schemeId: "scheme-src", bindings: [binding] };
    const { bundle } = await buildBundle(sim, memoryStore().read, source);
    return JSON.parse(JSON.stringify(bundle));
  }
  let n = 0;
  const makeId = (p: string) => `${p}-new${++n}`;

  it("exports tag names and the schemes used", async () => {
    const b = await exported();
    expect(b.library.tags).toEqual([{ id: "tag-src", name: "Tickets", topic: "Customer service" }]);
    expect(b.library.schemes.map((s: { name: string }) => s.name)).toEqual(["Support assessment"]);
  });

  it("keeps everything when imported into the same installation", async () => {
    const r = await importBundle(await exported(), memoryStore().save, "x", { ...source, canCreate: false, makeId });
    expect(r.simulation.tagIds).toEqual(["tag-src"]);
    expect(r.simulation.grading).toEqual({ schemeId: "scheme-src", bindings: [binding] });
    expect(r.created).toEqual({ taxonomy: null, schemes: [] });
  });

  it("matches by name on another installation and re-links rubric targets", async () => {
    const target = {
      taxonomy: { topics: [{ id: "topic-t", name: "customer service", description: "", tags: [{ id: "tag-t", name: "tickets" }] }] },
      schemes: [
        GradingSchemeSchema.parse({
          id: "scheme-t",
          name: "Support Assessment",
          rubric: [{ id: "crit-t", label: "Ticket ends up resolved", check: { type: "state" } }],
        }),
      ],
    };
    const r = await importBundle(await exported(), memoryStore().save, "x", { ...target, canCreate: false, makeId });
    expect(r.simulation.tagIds).toEqual(["tag-t"]);
    expect(r.simulation.grading.schemeId).toBe("scheme-t");
    expect(r.simulation.grading.bindings).toEqual([{ ...binding, itemId: "crit-t" }]);
    expect(r.warnings).toEqual([]);
  });

  it("drops what's missing for non-admins, with warnings", async () => {
    const r = await importBundle(await exported(), memoryStore().save, "x", { taxonomy: { topics: [] }, schemes: [], canCreate: false, makeId });
    expect(r.simulation.tagIds).toEqual([]);
    expect(r.simulation.grading).toEqual({ schemeId: null, bindings: [] });
    expect(r.created).toEqual({ taxonomy: null, schemes: [] });
    expect(r.warnings.join(" ")).toMatch(/1 tag .* removed\. An admin can import/);
    expect(r.warnings.join(" ")).toMatch(/"Support assessment" isn't in this library, so Standard grading is used instead\. An admin/);
  });

  it("creates what's missing for admins", async () => {
    const r = await importBundle(await exported(), memoryStore().save, "x", { taxonomy: { topics: [] }, schemes: [], canCreate: true, makeId });
    const topic = r.created.taxonomy!.topics[0];
    expect(topic.name).toBe("Customer service");
    expect(r.simulation.tagIds).toEqual([topic.tags[0].id]);
    expect(r.created.schemes.map((s) => s.name)).toEqual(["Support assessment"]);
    expect(r.simulation.grading.schemeId).toBe(r.created.schemes[0].id);
    expect(r.simulation.grading.bindings).toEqual([binding]); // criterion ids are kept with the copied scheme
  });
});
