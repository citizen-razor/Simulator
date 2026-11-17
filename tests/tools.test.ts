import { describe, expect, it } from "vitest";
import sample from "../samples/helpdesk.json";
import { toolImpact } from "../shared/health";
import { STANDARD_SCHEME } from "../shared/library";
import { PersonaLibrarySchema } from "../shared/personas";
import { SimulationSchema } from "../shared/schema";
import { composeSimulation, sameToolParts, splitSimulation, StoredSimulationSchema, ToolSchema, toolParts } from "../shared/tools";

const sim = SimulationSchema.parse(structuredClone(sample));
const noPersonas = PersonaLibrarySchema.parse({});

describe("tools", () => {
  it("stores a simulation without its screens and puts them back from the tool", () => {
    const tool = ToolSchema.parse({ id: "tool-1", name: "Helpdesk", ...toolParts(sim), version: 4 });
    const { stored, parts } = splitSimulation({ ...sim, toolId: "tool-1", toolName: "x", toolVersion: 3 });
    expect(stored).not.toHaveProperty("screens");
    expect(stored).not.toHaveProperty("toolVersion");
    expect(sameToolParts(parts, tool)).toBe(true);
    const back = composeSimulation(StoredSimulationSchema.parse(stored), tool);
    expect(back).toMatchObject({ toolId: "tool-1", toolName: "Helpdesk", toolVersion: 4 });
    expect(back.screens).toEqual(sim.screens);
    expect(back.scenarios).toEqual(sim.scenarios);
  });

  it("shows what a tool change would break in each simulation using it", () => {
    const other = { ...structuredClone(sim), id: "other", title: "Other practice", scenarios: sim.scenarios.slice(1) };
    const proposed = structuredClone(toolParts(sim));
    const ticket = proposed.screens.find((s) => s.elements.some((e) => e.id === "tk-save"))!;
    ticket.elements = ticket.elements.filter((e) => e.id !== "tk-save"); // remove the Save button
    const rows = toolImpact([sim, other], proposed, [STANDARD_SCHEME], noPersonas);
    const first = rows.find((r) => r.simulationId === sim.id)!;
    expect(first.breaks.map((b) => b.scenario)).toContain("Resolve the printer ticket");
    expect(first.breaks[0].detail).toMatch(/no longer exists/);
    expect(first.newIssues.join(" ")).toMatch(/tk-save/);
    // The other simulation only has the outage scenario, which doesn't use Save.
    expect(rows.find((r) => r.simulationId === "other")!.breaks).toEqual([]);
    // No change, no impact.
    expect(toolImpact([sim], toolParts(sim), [STANDARD_SCHEME], noPersonas)[0]).toMatchObject({ breaks: [], newIssues: [] });
  });
});

describe("renames across a shared tool", () => {
  it("combines chains and drops renames that were undone", async () => {
    const { recordRename } = await import("../shared/refactor");
    let list = recordRename([], { kind: "element", from: "a", to: "b" });
    list = recordRename(list, { kind: "element", from: "b", to: "c" });
    expect(list).toEqual([{ kind: "element", from: "a", to: "c" }]);
    expect(recordRename(list, { kind: "element", from: "c", to: "a" })).toEqual([]);
    expect(recordRename(list, { kind: "screen", from: "b", to: "x" })).toHaveLength(2); // different kind
  });

  it("carries a tool's renames into another simulation's scenarios, grading and AI customer", async () => {
    const { applyRenames, effectiveRenames, renameElement, renameScreen, renameVariable } = await import("../shared/refactor");
    // Simulation B uses the same tool as the one being edited.
    const b = structuredClone(sim);
    b.grading.bindings = [{ itemId: "x", screenId: "ticket" }, { itemId: "y", conditions: [{ var: "t1042_status", op: "eq", value: "Resolved" }] }];
    b.scenarios[0].conversation = { enabled: true, channel: "chat", role: "customer", brief: "Your ticket is {{t1042_status}}.", opening: "", criteria: [{ id: "c", label: "Said it's {{t1042_status}}", weight: 1 }], weight: 30 };
    // The builder renames things while editing simulation A (same tool).
    const a = structuredClone(sim);
    renameElement(a, "tk-save", "ticket-save");
    renameScreen(a, "ticket", "ticket-detail");
    renameVariable(a, "t1042_status", "printer_status");
    const renames = effectiveRenames(
      [
        { kind: "element", from: "tk-save", to: "ticket-save" },
        { kind: "screen", from: "ticket", to: "ticket-detail" },
        { kind: "variable", from: "t1042_status", to: "printer_status" },
        { kind: "element", from: "gone", to: "nowhere" }, // not in the new tool: ignored
      ],
      a,
    );
    expect(renames).toHaveLength(3);
    const out = applyRenames(b, renames);
    const steps = out.scenarios.flatMap((s) => s.steps);
    expect(steps.some((s) => s.elementId === "ticket-save")).toBe(true);
    expect(steps.some((s) => s.elementId === "tk-save")).toBe(false);
    expect(out.grading.bindings).toEqual([{ itemId: "x", screenId: "ticket-detail" }, { itemId: "y", conditions: [{ var: "printer_status", op: "eq", value: "Resolved" }] }]);
    expect(out.scenarios[0].conversation).toMatchObject({ brief: "Your ticket is {{printer_status}}.", criteria: [{ label: "Said it's {{printer_status}}" }] });
    expect(JSON.stringify(out.scenarios)).not.toMatch(/t1042_status/);
    // With the renames, the impact check sees nothing broken in B.
    expect(toolImpact([b], toolParts(a), [STANDARD_SCHEME], noPersonas, renames)[0]).toMatchObject({ breaks: [], newIssues: [] });
    // Without them, B's scenarios would break.
    expect(toolImpact([b], toolParts(a), [STANDARD_SCHEME], noPersonas)[0].breaks.length).toBeGreaterThan(0);
  });
});
