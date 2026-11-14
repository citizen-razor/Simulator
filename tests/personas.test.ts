import { describe, expect, it } from "vitest";
import sample from "../samples/helpdesk.json";
import { createSession, interpolate, lintSimulation } from "../shared/engine";
import {
  keyFromLabel,
  parseTableVar,
  PersonaLibrarySchema,
  personaVariables,
  sessionPersonaVariables,
  type PersonaLibrary,
} from "../shared/personas";
import { SimulationSchema } from "../shared/schema";

const library: PersonaLibrary = PersonaLibrarySchema.parse({
  templates: [
    {
      id: "tpl-telecom",
      name: "Telecom customer",
      fields: [
        { key: "accountNumber", label: "Account number" },
        { key: "plan", label: "Plan", type: "choice", options: ["Basic", "Unlimited"] },
        { key: "balance", label: "Balance", type: "money" },
      ],
      tables: [
        { key: "bills", label: "Bills", columns: [{ key: "month", label: "Month" }, { key: "amount", label: "Amount", type: "money" }] },
      ],
    },
  ],
  personas: [
    {
      id: "p-maya",
      name: "Maya Okonkwo",
      summary: "Café owner disputing a roaming charge",
      backstory: "Runs a busy café; travelled to Lisbon in October.",
      templateId: "tpl-telecom",
      values: { accountNumber: "TEL-55120", plan: "Unlimited", balance: "212.4" },
      extra: [{ key: "preferredContact", label: "Preferred contact", value: "SMS" }],
      tables: { bills: [{ month: "October", amount: "212.40" }, { month: "September", amount: "59.00" }] },
    },
    { id: "p-tom", name: "Tom Reyes", templateId: "tpl-telecom", values: { accountNumber: "TEL-10001" } },
  ],
});

describe("personas", () => {
  it("turn into role variables, including table rows", () => {
    const v = personaVariables("customer", library.personas[0], library.templates[0]);
    expect(v["customer.name"]).toBe("Maya Okonkwo");
    expect(v["customer.accountNumber"]).toBe("TEL-55120");
    expect(v["customer.preferredContact"]).toBe("SMS");
    expect(v["customer.balance"]).toBe("212.40"); // money gets two decimals
    expect(v["customer.bills.count"]).toBe("2");
    expect(v["customer.bills.1.amount"]).toBe("212.40");
    expect(parseTableVar(v["customer.bills"])).toEqual({
      columns: [{ key: "month", label: "Month", type: "text" }, { key: "amount", label: "Amount", type: "money" }],
      rows: [{ month: "October", amount: "212.40" }, { month: "September", amount: "59.00" }],
    });
    expect(interpolate("Hi {{customer.name}}, your {{customer.plan}} bill is {{customer.bills.1.amount}}", v)).toBe(
      "Hi Maya Okonkwo, your Unlimited bill is 212.40",
    );
  });

  it("fill a run, with scenario overrides, before random values and starting state", () => {
    const sim = SimulationSchema.parse(structuredClone(sample));
    sim.personas = [{ role: "customer", personaId: "p-maya" }];
    sim.scenarios[1].personaOverrides = [{ role: "customer", personaId: "p-tom" }];
    sim.scenarios[0].initialVars = [{ name: "notes", value: "Account {{customer.accountNumber}}" }];
    const run1 = createSession(sim, "resolve-printer", Date.now(), 1, sessionPersonaVariables(sim, "resolve-printer", library));
    expect(run1.vars["customer.name"]).toBe("Maya Okonkwo");
    expect(run1.vars.notes).toBe("Account TEL-55120");
    const run2 = createSession(sim, "log-vpn", Date.now(), 1, sessionPersonaVariables(sim, "log-vpn", library));
    expect(run2.vars["customer.name"]).toBe("Tom Reyes");
    expect(run2.vars["customer.bills.count"]).toBe("0");
    sim.scenarios[1].personaOverrides = [{ role: "customer", personaId: null }];
    expect(sessionPersonaVariables(sim, "log-vpn", library)["customer.name"]).toBeUndefined();
    expect(lintSimulation(sim)).toEqual([]);
  });

  it("makes keys from labels", () => {
    expect(keyFromLabel("Account number")).toBe("accountNumber");
    expect(keyFromLabel("3-month spend (£)")).toBe("f3MonthSpend");
    expect(keyFromLabel("  ")).toBe("field");
  });

  it("table elements must name their source", () => {
    const sim = SimulationSchema.parse(structuredClone(sample));
    sim.screens[1].elements.push({ id: "bills-table", label: "Bills", kind: "table", rect: { x: 1, y: 60, w: 50, h: 20 }, rules: [] });
    expect(lintSimulation(sim)).toEqual([`Table "Bills" on Dashboard doesn't say which table to show.`]);
  });
});

describe("AI persona drafts", () => {
  it("keep only the template's fields and tables, and give extra fields keys", async () => {
    const { personasFromDraft } = await import("../server/generate");
    let n = 0;
    const out = personasFromDraft(
      {
        personas: [
          {
            name: "Ines Duarte",
            summary: "Pensioner confused by a new tariff",
            backstory: "…",
            values: [{ key: "accountNumber", value: "TEL-77001" }, { key: "notAField", value: "x" }],
            extra: [{ label: "Hearing aid user", value: "Yes" }, { label: "Account number", value: "dup" }],
            tables: [
              { key: "bills", rows: [{ cells: [{ key: "month", value: "October" }, { key: "amount", value: "48.10" }, { key: "junk", value: "?" }] }] },
              { key: "unknownTable", rows: [] },
            ],
          },
        ],
      },
      library.templates[0],
      (p) => `${p}-${++n}`,
    );
    expect(out).toHaveLength(1);
    expect(out[0].id).toBe("persona-1");
    expect(out[0].values).toEqual({ accountNumber: "TEL-77001" });
    expect(out[0].extra).toEqual([{ key: "hearingAidUser", label: "Hearing aid user", value: "Yes" }]);
    expect(out[0].tables).toEqual({ bills: [{ month: "October", amount: "48.10" }] });
  });
});

describe("a persona is one record, used everywhere", () => {
  it("scenarios choose which persona; the details always come from the persona itself", () => {
    const sim = SimulationSchema.parse(structuredClone(sample));
    sim.personas = [{ role: "customer", personaId: "p-maya" }];
    sim.scenarios[0].personaOverrides = [{ role: "manager", personaId: "p-tom" }];
    sim.scenarios[1].personaOverrides = [{ role: "customer", personaId: "p-tom" }];
    const lib = structuredClone(library);
    const before = sessionPersonaVariables(sim, "resolve-printer", lib);
    expect(before["customer.plan"]).toBe("Unlimited");
    expect(before["manager.name"]).toBe("Tom Reyes");
    // Change the customer record once…
    lib.personas[0].values.plan = "Basic";
    lib.personas[1].name = "Tomás Reyes";
    // …and every scenario and open world see it.
    expect(sessionPersonaVariables(sim, "resolve-printer", lib)["customer.plan"]).toBe("Basic");
    expect(sessionPersonaVariables(sim, null, lib)["customer.plan"]).toBe("Basic");
    expect(sessionPersonaVariables(sim, "resolve-printer", lib)["manager.name"]).toBe("Tomás Reyes");
    expect(sessionPersonaVariables(sim, "log-vpn", lib)["customer.name"]).toBe("Tomás Reyes");
  });

  it("drops per-simulation and per-scenario detail changes saved by the earlier design", () => {
    const raw = structuredClone(sample) as Record<string, unknown>;
    raw.personas = [{ role: "customer", personaId: "p-maya", details: { plan: "Basic" } }];
    (raw.scenarios as Record<string, unknown>[])[0].personaOverrides = [{ role: "customer", details: { name: "Someone else" } }];
    const sim = SimulationSchema.parse(raw);
    expect(sim.personas).toEqual([{ role: "customer", personaId: "p-maya" }]);
    expect(sim.scenarios[0].personaOverrides).toEqual([{ role: "customer", personaId: undefined }]);
    const v = sessionPersonaVariables(sim, "resolve-printer", library);
    expect(v["customer.plan"]).toBe("Unlimited");
    expect(v["customer.name"]).toBe("Maya Okonkwo");
  });
});
