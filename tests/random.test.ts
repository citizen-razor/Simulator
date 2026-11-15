import { describe, expect, it } from "vitest";
import sample from "../samples/helpdesk.json";
import { createSession, interact, lintSimulation, takeHint } from "../shared/engine";
import { generateValues, type RandomVar } from "../shared/random";
import { SimulationSchema } from "../shared/schema";

const sim = () => SimulationSchema.parse(structuredClone(sample));
const TODAY = new Date("2026-11-14T12:00:00Z");

describe("random value generators", () => {
  const gens: RandomVar[] = [
    { var: "ticket", kind: "pattern", pattern: "TCK-####-A\\#" },
    { var: "amount", kind: "number", min: 10, max: 20, decimals: 2 },
    { var: "qty", kind: "number", min: 1, max: 3 },
    { var: "who", kind: "name" },
    { var: "due", kind: "date", min: 1, max: 3 },
    { var: "customer", kind: "pick", group: "c", options: ["Ana", "Ben", "Wei"] },
    { var: "email", kind: "pick", group: "c", options: ["ana@x.io", "ben@x.io", "wei@x.io"] },
  ];

  it("is reproducible from the seed and varies between seeds", () => {
    expect(generateValues(gens, 42, TODAY)).toEqual(generateValues(gens, 42, TODAY));
    const seen = new Set(Array.from({ length: 20 }, (_, i) => generateValues(gens, i, TODAY).ticket));
    expect(seen.size).toBeGreaterThan(15);
  });

  it("respects patterns, ranges and dates, and keeps linked picks together", () => {
    for (let seed = 0; seed < 200; seed++) {
      const v = generateValues(gens, seed, TODAY);
      expect(v.ticket).toMatch(/^TCK-\d{4}-[A-Z]#$/);
      expect(Number(v.amount)).toBeGreaterThanOrEqual(10);
      expect(Number(v.amount)).toBeLessThanOrEqual(20);
      expect(v.amount).toMatch(/^\d+\.\d{2}$/);
      expect(["1", "2", "3"]).toContain(v.qty);
      expect(v.who).toMatch(/^\S+ \S+$/);
      expect(["2026-11-15", "2026-11-16", "2026-11-17"]).toContain(v.due);
      expect(v.email.startsWith(v.customer.toLowerCase())).toBe(true);
    }
  });
});

describe("random data in runs", () => {
  it("fills variables, labels and instructions with this run's values", () => {
    const s = sim();
    expect(lintSimulation(s)).toEqual([]);
    const run = createSession(s, "resolve-printer", Date.now(), 7);
    expect(run.vars.ticketId).toMatch(/^TCK-\d{4}$/);
    expect(run.generated.ticketId).toBe(run.vars.ticketId);
    expect(createSession(s, "resolve-printer", Date.now(), 7).vars).toEqual(run.vars);
    // Hints and instructions show the run's values.
    let r = run;
    for (const [elementId, value] of [["login-user", "a"], ["login-pass", "b"]] as const) {
      r = interact(s, r, "scenario", { type: "commit", elementId, value }).state;
    }
    r = interact(s, r, "scenario", { type: "activate", elementId: "login-submit" }).state;
    expect(takeHint(s, r).hint).toBe(`Open ticket ${run.vars.ticketId} from your queue.`);
  });

  it("judges expected answers against this run's value", () => {
    const s = sim();
    const start = createSession(s, "log-vpn", Date.now(), 3);
    const caller = start.vars.caller;
    const play = (desc: string) => {
      let r = start;
      r = interact(s, r, "scenario", { type: "activate", elementId: "dash-new" }).state;
      r = interact(s, r, "scenario", { type: "commit", elementId: "nt-title", value: "VPN down" }).state;
      r = interact(s, r, "scenario", { type: "commit", elementId: "nt-priority", value: "High" }).state;
      r = interact(s, r, "scenario", { type: "commit", elementId: "nt-desc", value: desc }).state;
      return interact(s, r, "scenario", { type: "activate", elementId: "nt-submit" }).state;
    };
    expect(play(`Sales can't connect. Reported by ${caller}.`).completed).toBe(true);
    const other = ["Ana Silva", "Wei Chen"].find((n) => n !== caller)!;
    expect(play(`Sales can't connect. Reported by ${other}.`).completed).toBe(false);
  });

  it("scenarios can opt out and use the initial values", () => {
    const s = sim();
    s.scenarios[0].randomize = false;
    const run = createSession(s, "resolve-printer", Date.now(), 7);
    expect(run.vars.ticketId).toBe("TCK-1042");
    expect(run.generated).toEqual({});
  });
});

describe("random data housekeeping", () => {
  it("lint flags generators for unknown variables or with nothing to pick", async () => {
    const s = sim();
    s.randomData.push({ var: "nope", kind: "name" }, { var: "caller", kind: "pick", options: [" "] });
    expect(lintSimulation(s)).toEqual([
      `Random values are set for "nope", which isn't a declared variable.`,
      `Random values for "caller" have no options to pick from.`,
    ]);
  });
  it("renaming a variable updates its generator", async () => {
    const { renameVariable } = await import("../shared/refactor");
    const s = sim();
    renameVariable(s, "ticketId", "ticketNumber");
    expect(s.randomData[0].var).toBe("ticketNumber");
    expect(JSON.stringify(s)).not.toContain("{{ticketId}}");
    expect(lintSimulation(s)).toEqual([]);
  });
});
