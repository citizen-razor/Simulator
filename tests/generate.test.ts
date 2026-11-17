import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { describe, expect, it } from "vitest";
import sample from "../samples/helpdesk.json";
import { DraftSimulation, draftToSimulation, keepUnrevised, libraryText, simulationToDraft, suggestionNotes } from "../server/generate";
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

describe("AI suggestions and revisions", () => {
  const lib = {
    tags: [{ id: "tag-refunds", name: "Refunds", topic: "Customer service" }],
    schemes: [{ id: "scheme-support", name: "Support assessment", description: "Calls and tickets" }],
  };

  it("keeps only library tags and schemes, and turns a suggested conversation into a scenario customer", () => {
    const draft = DraftSimulation.parse(simulationToDraft(sim, []));
    draft.tagIds = ["tag-refunds", "tag-made-up", "tag-refunds"];
    draft.gradingSchemeId = "scheme-invented";
    draft.scenarios[0].conversation = {
      channel: "phone",
      brief: "You're annoyed your printer is still down.",
      opening: "",
      criteria: [{ label: "Apologised for the delay", weight: 9 }, { label: " ", weight: 1 }, { label: "Confirmed the fix worked", weight: 0 }],
    };
    const out = draftToSimulation(draft, "s", [], lib);
    expect(out.tagIds).toEqual(["tag-refunds"]);
    expect(out.grading.schemeId).toBeNull();
    expect(out.scenarios[0].conversation).toMatchObject({
      enabled: true, channel: "phone", role: "customer", weight: 30,
      criteria: [{ id: "c1", label: "Apologised for the delay", weight: 5 }, { id: "c2", label: "Confirmed the fix worked", weight: 1 }],
    });
    draft.gradingSchemeId = "scheme-support";
    expect(draftToSimulation(draft, "s", [], lib).grading.schemeId).toBe("scheme-support");
    expect(suggestionNotes(out, lib)).toMatch(/Suggested tags: Refunds\. Added an AI customer to "/);
    expect(libraryText(lib)).toContain("- scheme-support: Support assessment, Calls and tickets");
  });

  it("keeps what the AI doesn't edit when it revises a simulation", () => {
    const before = structuredClone(sim);
    before.personas = [{ role: "customer", personaId: "p1" }];
    before.randomData = [{ var: "ticketId", kind: "pattern", pattern: "TCK-####" } as never];
    before.grading = { schemeId: "scheme-support", bindings: [{ itemId: "x", screenId: "dashboard" }], trainerMarking: true };
    before.tagIds = ["tag-refunds"];
    const sc = before.scenarios[0];
    sc.personaOverrides = [{ role: "customer", personaId: "p2" }];
    sc.randomize = false;
    sc.conversation = { enabled: true, channel: "chat", role: "caller", brief: "b", opening: "", criteria: [{ id: "keep-me", label: "Was polite", weight: 2 }], weight: 45 };
    before.screens[1].elements.push({ id: "orders", label: "Orders", kind: "table", rect: { x: 0, y: 0, w: 50, h: 20 }, tableSource: "customer.orders", rowKey: "id", rules: [] });
    // Claude's revision only sees the draft.
    const revised = draftToSimulation(DraftSimulation.parse(simulationToDraft(before, [])), before.id, [], lib);
    const out = keepUnrevised(before, revised);
    expect(out.personas).toEqual(before.personas);
    expect(out.randomData).toEqual(before.randomData);
    expect(out.grading).toEqual(before.grading);
    expect(out.tagIds).toEqual(["tag-refunds"]);
    expect(out.scenarios[0]).toMatchObject({ personaOverrides: sc.personaOverrides, randomize: false });
    expect(out.scenarios[0].conversation).toMatchObject({ role: "caller", weight: 45, criteria: [{ id: "keep-me", label: "Was polite", weight: 2 }] });
    expect(out.screens[1].elements.find((e) => e.id === "orders")).toMatchObject({ tableSource: "customer.orders", rowKey: "id" });
  });
});
