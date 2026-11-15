import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { describe, expect, it } from "vitest";
import sample from "../samples/helpdesk.json";
import { DraftSimulation, draftToSimulation, simulationToDraft } from "../server/generate";
import { SimulationSchema } from "../shared/schema";

const sim = SimulationSchema.parse(sample);

describe("AI draft conversion", () => {
  it("builds a structured-output JSON schema", () => {
    const fmt = betaZodOutputFormat(DraftSimulation) as unknown as { type: string; schema: object };
    expect(fmt.type).toBe("json_schema");
    expect(JSON.stringify(fmt.schema)).toContain("imageIndex");
  });

  it("round-trips a simulation through the draft format", () => {
    const draft = DraftSimulation.parse(simulationToDraft(sim, []));
    const back = draftToSimulation(draft, sim.id, []);
    expect(back.screens.map((s) => s.id)).toEqual(sim.screens.map((s) => s.id));
    expect(back.scenarios[0].steps).toEqual(sim.scenarios[0].steps);
    expect(back.scenarios[0].alternatePaths).toEqual(sim.scenarios[0].alternatePaths);
    expect(back.screens[2].elements.find((e) => e.id === "tk-save")!.rules).toEqual(
      sim.screens[2].elements.find((e) => e.id === "tk-save")!.rules,
    );
  });

  it("maps image numbers to stored assets and repairs messy AI output", () => {
    const draft = DraftSimulation.parse(simulationToDraft(sim, []));
    draft.screens[0].imageIndex = 0;
    draft.screens[0].id = "Log In Page!"; // unsafe id
    draft.startScreenId = "Log In Page!";
    draft.screens[1].elements[0].rect = { x: -5, y: 120, w: 500, h: 3 }; // out of bounds
    const out = draftToSimulation(draft, "sim-x", [
      { assetId: "img-abc.png", width: 1600, height: 900, mediaType: "image/png", data: "", label: "shot" },
    ]);
    expect(out.screens[0].id).toBe("log-in-page");
    expect(out.startScreenId).toBe("log-in-page");
    expect(out.screens[0].imageAssetId).toBe("img-abc.png");
    expect(out.screens[0].aspect).toBeCloseTo(16 / 9);
    const r = out.screens[1].elements[0].rect;
    expect(r.x).toBe(0);
    expect(r.y + r.h).toBeLessThanOrEqual(100);
    expect(r.x + r.w).toBeLessThanOrEqual(100);
  });
});
