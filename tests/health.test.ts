import { describe, expect, it } from "vitest";
import sample from "../samples/helpdesk.json";
import { checkSimulation } from "../shared/health";
import { GradingSchemeSchema, STANDARD_SCHEME } from "../shared/library";
import { PersonaLibrarySchema } from "../shared/personas";
import { SimulationSchema, type Attempt, type Simulation } from "../shared/schema";

const load = (): Simulation => SimulationSchema.parse(structuredClone(sample));
const noPersonas = PersonaLibrarySchema.parse({});

describe("simulation health", () => {
  it("plays every path of the sample to full points", () => {
    const h = checkSimulation(load(), [STANDARD_SCHEME], noPersonas);
    expect(h.paths.length).toBeGreaterThanOrEqual(2);
    expect(h.paths.every((p) => p.ok && p.score === 100)).toBe(true);
    expect(h.status).toBe("healthy");
  });

  it("catches a step that can't be done without a mistake, and a value that's never accepted", () => {
    const sim = load();
    const sc = sim.scenarios.find((s) => s.id === "resolve-printer")!;
    [sc.steps[3], sc.steps[4]] = [sc.steps[4], sc.steps[3]]; // set status before opening the ticket
    const h = checkSimulation(sim, [STANDARD_SCHEME], noPersonas);
    expect(h.status).toBe("problems");
    expect(h.problems[0]).toMatchObject({ level: "error", where: sc.title, message: expect.stringMatching(/^Main path: Step 4 .*on the "Ticket" screen, but the trainee is on "Dashboard".*make a mistake/) });

    const sim2 = load();
    const sc2 = sim2.scenarios.find((s) => s.id === "resolve-printer")!;
    const status = sc2.steps.find((s) => s.expect === "eq")!;
    status.value = "Fixed"; // not one of the options
    const h2 = checkSimulation(sim2, [STANDARD_SCHEME], noPersonas);
    expect(h2.problems.map((p) => p.message).join(" ")).toMatch(/success checks \(t1042_status eq "Resolved"\) aren't met|isn't accepted/);
  });

  it("flags a rubric check a perfect run doesn't meet, and checks that aren't set up", () => {
    const sim = load();
    const scheme = GradingSchemeSchema.parse({
      id: "s", name: "S", rubricWeight: 50,
      rubric: [
        { id: "end", label: "Ends on the new-ticket form", check: { type: "screen", screenId: "new-ticket" } },
        { id: "unset", label: "Ticket resolved", check: { type: "state" } },
      ],
    });
    sim.grading.schemeId = "s";
    const h = checkSimulation(sim, [STANDARD_SCHEME, scheme], noPersonas);
    const text = h.problems.map((p) => `${p.level}: ${p.message}`).join("\n");
    expect(text).toMatch(/error: Grading check "Ticket resolved" \(S\) isn't pointed/);
    expect(text).toMatch(/warning: .*A perfect run doesn't meet "Ends on the new-ticket form"/);
  });

  it("warns about AI customers without a persona", () => {
    const sim = load();
    sim.scenarios[0].conversation = { enabled: true, channel: "chat", role: "customer", brief: "", opening: "", criteria: [], weight: 30 };
    const msgs = checkSimulation(sim, [STANDARD_SCHEME], noPersonas).problems.map((p) => p.message);
    expect(msgs).toEqual(expect.arrayContaining([expect.stringMatching(/has no persona/), expect.stringMatching(/no situation/), expect.stringMatching(/isn't scored/)]));
  });

  it("reads warning signs from real results once there are enough", () => {
    const sim = load();
    const steps = sim.scenarios.find((s) => s.id === "resolve-printer")!.steps;
    const attempt = (i: number, lose: boolean): Attempt => ({
      id: `a${i}`, userId: `u${i}`, trainee: "", simulationId: sim.id, simulationTitle: "", scenarioId: "resolve-printer", scenarioTitle: "",
      mode: "scenario", assisted: false, completed: true, score: lose ? 90 : 100, errors: lose ? 1 : 0, hintsUsed: 0, durationSec: 30,
      stepsCompleted: 7, stepsTotal: 7, pathName: "", passed: true, mistakes: [], troubleSteps: [], log: [],
      penalties: lose ? [{ kind: "error", stepNo: 5, step: steps[4].instruction }] : [], finishedAt: "2026-11-01T00:00:00Z",
    });
    const few = checkSimulation(sim, [STANDARD_SCHEME], noPersonas, [0, 1, 2].map((i) => attempt(i, true)));
    expect(few.problems).toEqual([]); // too few to say anything
    const many = checkSimulation(sim, [STANDARD_SCHEME], noPersonas, [0, 1, 2, 3, 4, 5].map((i) => attempt(i, i < 4)));
    expect(many.problems.map((p) => p.message)).toEqual([expect.stringMatching(/^67% of attempts lose points at step 5/)]);
  });
});
