/**
 * Tools: the systems an organisation simulates (a ticketing system, a banking app…), kept in a
 * library so many simulations can share one. A tool holds the screens, their controls and rules,
 * the system's variables and its start screen. A simulation (a practice) uses one tool and adds
 * its own scenarios, grading, personas, random data and tags.
 *
 * Changing a tool changes every simulation that uses it. Before such a change is saved, the
 * editor runs an impact check: each scenario of each simulation on the tool is auto-played
 * (shared/health.ts) with the new screens, and anything that would stop working is listed.
 */
import { z } from "zod";
import { ID_PATTERN, ScreenSchema, SimulationSchema, VariableSchema, type Simulation } from "./schema";

export const ToolSchema = z.object({
  id: z.string().regex(ID_PATTERN),
  name: z.string().trim().min(1).max(200),
  description: z.string().max(2000).default(""),
  startScreenId: z.string(),
  variables: z.array(VariableSchema).default([]),
  screens: z.array(ScreenSchema).min(1),
  /** Goes up by one on every saved change (to catch two people editing at once). */
  version: z.number().int().default(1),
  createdAt: z.string().optional(),
  updatedAt: z.string().optional(),
});
export type Tool = z.infer<typeof ToolSchema>;

/** The parts of a simulation that come from its tool. */
export type ToolParts = Pick<Tool, "startScreenId" | "variables" | "screens">;

export const toolParts = (s: ToolParts): ToolParts => ({ startScreenId: s.startScreenId, variables: s.variables, screens: s.screens });

export const sameToolParts = (a: ToolParts, b: ToolParts) => JSON.stringify(toolParts(a)) === JSON.stringify(toolParts(b));

/** How a simulation is stored: everything except what comes from the tool. */
export const StoredSimulationSchema = SimulationSchema.omit({ startScreenId: true, variables: true, screens: true, toolName: true, toolVersion: true }).extend({
  toolId: z.string().regex(ID_PATTERN),
});
export type StoredSimulation = z.infer<typeof StoredSimulationSchema>;

/** A simulation as the app uses it: the stored simulation with its tool's screens filled in. */
export function composeSimulation(stored: StoredSimulation, tool: Tool): Simulation {
  return SimulationSchema.parse({ ...stored, ...toolParts(tool), toolId: tool.id, toolName: tool.name, toolVersion: tool.version });
}

/** Split a simulation into what's stored with it and what belongs to its tool. */
export function splitSimulation(sim: Simulation): { stored: Omit<StoredSimulation, "toolId"> & { toolId?: string }; parts: ToolParts } {
  const { startScreenId, variables, screens, toolName: _n, toolVersion: _v, ...stored } = sim;
  void _n;
  void _v;
  return { stored, parts: { startScreenId, variables, screens } };
}
