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
