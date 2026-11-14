import { describe, expect, it } from "vitest";
import sample from "../samples/helpdesk.json";
import { sniffImageType } from "../server/storage";
import { buildBundle, exportFileName, importBundle } from "../server/transfer";
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
