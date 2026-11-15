import { describe, expect, it } from "vitest";
import { createSession, interact } from "../shared/engine";
import { SimulationSchema } from "../shared/schema";

const table = JSON.stringify({
  columns: [{ key: "id", label: "Order", type: "text" }, { key: "status", label: "Status", type: "text" }],
  rows: [{ id: "ORD-1", status: "Shipped" }, { id: "ORD-2", status: "Lost" }],
});
const sim = SimulationSchema.parse({
  id: "t", title: "T", startScreenId: "list",
  variables: [{ name: "orders", initial: table }],
  screens: [
    {
      id: "list", name: "Orders",
      elements: [
        { id: "tbl", label: "Orders", kind: "table", rect: { x: 0, y: 0, w: 100, h: 50 }, tableSource: "orders", rowKey: "id", bindVar: "picked", rules: [{ if: [], then: [{ type: "navigate", screenId: "detail" }] }] },
        { id: "ro", label: "Read only", kind: "table", rect: { x: 0, y: 50, w: 100, h: 50 }, tableSource: "orders" },
      ],
    },
    { id: "detail", name: "Order", elements: [] },
  ],
  scenarios: [{ id: "s", title: "Open the lost order", goal: "", steps: [{ id: "a", instruction: "Open the lost order.", elementId: "tbl", expect: "eq", value: "ORD-2" }] }],
});

describe("clickable table rows", () => {
  it("stores the row and its columns, runs the rules, and can complete a step", () => {
    const r = interact(sim, createSession(sim, "s", 0), "scenario", { type: "commit", elementId: "tbl", value: "ORD-2" }, 1000);
    expect(r.state.vars).toMatchObject({ picked: "ORD-2", "picked.id": "ORD-2", "picked.status": "Lost" });
    expect(r.state.screenId).toBe("detail");
    expect(r.state.completed).toBe(true);
  });

  it("counts the wrong row as an error, and ignores read-only tables", () => {
    const wrong = interact(sim, createSession(sim, "s", 0), "scenario", { type: "commit", elementId: "tbl", value: "ORD-1" }, 1000);
    expect(wrong.state.errors).toBe(1);
    const start = createSession(sim, "s", 0);
    expect(interact(sim, start, "scenario", { type: "commit", elementId: "ro", value: "ORD-1" }, 1000).state).toBe(start);
  });
});
