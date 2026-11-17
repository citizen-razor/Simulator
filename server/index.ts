/**
 * The local API server. Runs only on 127.0.0.1 (your machine).
 *
 * Security measures, since a local server can still be reached by web pages you
 * visit in the same browser:
 *  - Binds to 127.0.0.1 only, so nothing else on the network can connect.
 *  - Rejects requests whose Host header isn't localhost (blocks "DNS rebinding").
 *  - Every state-changing request must carry the X-Simulator header. Browsers
 *    won't let another website add custom headers to a cross-site request
 *    without a CORS approval we never give, so other sites can't trigger saves
 *    or spend your API credits.
 *  - All input is validated with Zod; ids are checked against strict patterns
 *    before touching the filesystem.
 *  - The Anthropic API key stays in this process (.env), never sent to the browser.
 *  - Everyone signs in (server/auth.ts). Every route checks the person's role
 *    (shared/people.ts): Builders build, Admin-Builders run the libraries and people,
 *    Leaders see and assign within their reporting tree, everyone learns.
 */
import "dotenv/config";
import express, { type NextFunction, type Request, type Response } from "express";
import path from "node:path";
import { z, ZodError } from "zod";
import sample from "../samples/helpdesk.json";
import { SimulationSchema } from "../shared/schema";
import {
  AlignInputSchema,
  alignElements,
  describeApiError,
  draftPersonas,
  generateSimulation,
  GenerateInputSchema,
  MODEL,
  refineSimulation,
  type GenerateResult,
  type LibraryContext,
  type StoredImage,
} from "./generate";
import {
  addAttempt,
  assetPath,
  deleteSimulation,
  getSimulation,
  HttpError,
  initStorage,
  listAttempts,
  listSimulations,
  newId,
  readAsset,
  saveAsset,
  saveSimulation,
  deleteScheme,
  readGrading,
  readTaxonomy,
  saveScheme,
  saveTaxonomy,
  updateAttempt,
  imageUsage,
  deleteUnusedImages,
  listAssignments,
  createAssignments,
  deleteAssignment,
  readPersonas,
  savePersonaTemplate,
  deletePersonaTemplate,
  savePersona,
  deletePersona,
  personaUsage,
  getTool,
  listTools,
  saveTool,
  deleteTool,
  simulationsUsingTool,
  setSimulationTool,
  saveToolEverywhere,
} from "./storage";
import { buildBundle, exportFileName, importBundle, ImportError } from "./transfer";
import {
  authenticate,
  authState,
  changeOwnPassword,
  login,
  logout,
  requirePermission,
  requireUser,
  rolesOf,
  setup,
  userCan,
  viewerCanAssign,
  viewerCanSee,
  type AuthedRequest,
} from "./auth";
import { peopleRoutes } from "./people";
import { conversationRoutes } from "./conversation";
import { scimRouter } from "./scim";
import { withUserIds, mainBoard, scenarioBoard } from "../shared/leaderboard";
import { reportingTree } from "../shared/people";
import { sameName } from "../shared/assignments";
import { finalScore, reviewAiMark } from "../shared/grading";
import { checkSimulation, toolImpact } from "../shared/health";
import { ToolSchema, toolParts } from "../shared/tools";
import { lintSimulation } from "../shared/engine";
import { DEFAULT_SCHEME_ID } from "../shared/library";
import { analyzeSimulation, inDateRange, MIN_TEAM_LEARNERS, stats, teamAttempts } from "../shared/analytics";
import type { Attempt } from "../shared/schema";

const teamParam = (v: unknown) => (typeof v === "string" && /^[\w-]{1,100}$/.test(v) ? v : undefined);
/** Attempts within the date range and, if a team (leader id) is given, by that leader's reporting tree. */
function scoped(r: AuthedRequest, attempts: Attempt[], q: Request["query"], team: string | undefined): Attempt[] {
  const dated = inDateRange(attempts, dateParam(q.from), dateParam(q.to));
  return team ? teamAttempts(dated, r.people, team) : dated;
}

/** A YYYY-MM-DD query parameter, or undefined. */
const dateParam = (v: unknown) => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : undefined);

const PORT = Number(process.env.PORT || 8787);
const HOST = "127.0.0.1";
const PROD = process.env.NODE_ENV === "production";

const app = express();
app.disable("x-powered-by");

app.use((req, res, next) => {
  const host = (req.headers.host ?? "").replace(/:\d+$/, "");
  if (!["localhost", "127.0.0.1", "[::1]"].includes(host)) {
    res.status(403).send("Forbidden host");
    return;
  }
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "no-referrer");
  if (PROD) {
    res.setHeader(
      "Content-Security-Policy",
      "default-src 'self'; img-src 'self' data: blob:; media-src 'self' blob:; style-src 'self' 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'",
    );
  }
  next();
});

app.use("/api", (req, res, next) => {
  if (req.method !== "GET" && req.get("X-Simulator") !== "1") {
    res.status(403).json({ error: "Missing X-Simulator header" });
    return;
  }
  next();
});
// Imports can carry many screenshots, so that one route accepts larger bodies.
const jsonDefault = express.json({ limit: "60mb" });
const jsonImport = express.json({ limit: "250mb" });
app.use((req, res, next) => (req.path === "/api/import" ? jsonImport : jsonDefault)(req, res, next));

type Handler = (req: Request, res: Response) => Promise<unknown>;
const route = (fn: Handler) => (req: Request, res: Response, next: NextFunction) => fn(req, res).catch(next);
const param = (req: Request, name: string) => String(req.params[name]);

// SCIM provisioning (Okta, Entra…): bearer-token auth, its own JSON type. See server/scim.ts.
app.use("/scim/v2", scimRouter);

app.use(authenticate);

// ---- sign-in (no account needed)
app.get("/api/auth/state", route(async (req, res) => res.json(await authState(req))));
app.post("/api/auth/setup", route(async (req, res) => {
  await setup(req, res);
  res.status(201).json({ ok: true });
}));
app.post("/api/auth/login", route(async (req, res) => {
  await login(req, res);
  res.json({ ok: true });
}));
app.post("/api/auth/logout", route(async (req, res) => {
  await logout(req, res);
  res.json({ ok: true });
}));
app.post("/api/auth/password", route(async (req, res) => {
  await changeOwnPassword(req);
  res.json({ ok: true });
}));

// Everything else needs a signed-in user.
app.use(["/api", "/assets"], (req, _res, next) => {
  if (req.path.startsWith("/auth/") && req.baseUrl === "/api") return next();
  try {
    requireUser(req);
    next();
  } catch (e) {
    next(e);
  }
});

peopleRoutes(app);


// ------------------------------------------------------------ routes

app.get("/api/status", (_req, res) => {
  res.json({
    model: MODEL,
    aiConfigured: Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN),
  });
});

app.get("/api/simulations", route(async (_req, res) => res.json(await listSimulations())));

app.get("/api/simulations/:id", route(async (req, res) => res.json(await getSimulation(param(req, "id")))));

app.post(
  "/api/simulations",
  route(async (req, res) => {
    requirePermission(req, "simulations.build");
    const sim = await saveSimulation({ ...req.body, id: newId(), createdAt: undefined });
    res.status(201).json(sim);
  }),
);

app.put(
  "/api/simulations/:id",
  route(async (req, res) => {
    requirePermission(req, "simulations.build");
    const id = param(req, "id");
    await getSimulation(id); // 404 if missing
    // Renames made to the tool's controls, screens and variables go to every simulation on it.
    res.json(await saveSimulation({ ...req.body, id }, renamesParam(req.body?.renames)));
  }),
);

app.delete(
  "/api/simulations/:id",
  route(async (req, res) => {
    requirePermission(req, "simulations.build");
    await deleteSimulation(param(req, "id"));
    res.status(204).end();
  }),
);

app.get(
  "/api/simulations/:id/export",
  route(async (req, res) => {
    requirePermission(req, "simulations.build");
    const sim = await getSimulation(param(req, "id"));
    const [taxonomy, grading, personas] = await Promise.all([readTaxonomy(), readGrading(), readPersonas()]);
    const { bundle, missing } = await buildBundle(sim, readAsset, { taxonomy, schemes: grading.schemes, personas });
    if (missing.length) res.setHeader("X-Missing-Images", String(missing.length));
    res.setHeader("Content-Disposition", `attachment; filename="${exportFileName(sim.title)}"`);
    res.type("application/json").send(JSON.stringify(bundle));
  }),
);

app.post(
  "/api/import",
  route(async (req, res) => {
    requirePermission(req, "simulations.build");
    try {
      const [taxonomy, grading, personas] = await Promise.all([readTaxonomy(), readGrading(), readPersonas()]);
      const { simulation, warnings, created } = await importBundle(req.body, saveAsset, newId(), {
        taxonomy,
        schemes: grading.schemes,
        personas,
        canCreate: userCan(req, "libraries.edit"),
        makeId: newId,
      });
      // Save library additions first so the simulation never points at something missing.
      if (created.taxonomy) await saveTaxonomy(created.taxonomy);
      for (const scheme of created.schemes) await saveScheme(scheme);
      for (const tpl of created.personaTemplates) await savePersonaTemplate(tpl);
      for (const persona of created.personas) await savePersona(persona);
      res.status(201).json({ simulation: await saveSimulation(simulation), warnings });
    } catch (e) {
      if (e instanceof ImportError) throw new HttpError(400, e.message);
      throw e;
    }
  }),
);

// ---- admin + libraries


app.get("/api/library/taxonomy", route(async (_req, res) => res.json(await readTaxonomy())));
app.put(
  "/api/library/taxonomy",
  route(async (req, res) => {
    requirePermission(req, "libraries.edit");
    res.json(await saveTaxonomy(req.body));
  }),
);

app.get("/api/library/grading", route(async (_req, res) => res.json(await readGrading())));
app.put(
  "/api/library/grading/:id",
  route(async (req, res) => {
    requirePermission(req, "libraries.edit");
    res.json(await saveScheme({ ...req.body, id: param(req, "id") }));
  }),
);
app.delete(
  "/api/library/grading/:id",
  route(async (req, res) => {
    requirePermission(req, "libraries.edit");
    await deleteScheme(param(req, "id"));
    res.status(204).end();
  }),
);

app.get(
  "/api/admin/images",
  route(async (req, res) => {
    requirePermission(req, "storage.manage");
    const r = await imageUsage();
    res.json({ total: r.total, removable: { count: r.removable.count, bytes: r.removable.bytes }, recentUnused: r.recentUnused });
  }),
);

app.post(
  "/api/admin/images/cleanup",
  route(async (req, res) => {
    requirePermission(req, "storage.manage");
    res.json(await deleteUnusedImages());
  }),
);

// ---- assignments (anyone can read, so trainees can see theirs; admins create and remove)

/** Assignments the viewer may see (by assignee; older name-only ones are matched by name). */
async function visibleAssignments(r: AuthedRequest) {
  const byName = (name: string) => {
    const matches = r.people.filter((u) => sameName(u.name, name));
    return matches.length === 1 ? matches[0].id : undefined;
  };
  return (await listAssignments())
    .map((a) => (a.userId ? a : { ...a, userId: byName(a.trainee) }))
    .filter((a) => a.userId && viewerCanSee(r, a.userId));
}

app.get("/api/assignments", route(async (req, res) => res.json(await visibleAssignments(requireUser(req)))));
app.get(
  "/api/assignments/:id",
  route(async (req, res) => {
    const a = (await visibleAssignments(requireUser(req))).find((x) => x.id === param(req, "id"));
    if (!a) throw new HttpError(404, "Assignment not found");
    res.json(a);
  }),
);
app.post(
  "/api/assignments",
  route(async (req, res) => {
    // Admin-Builders assign to anyone; leaders to people in their reporting tree.
    const r = requireUser(req);
    const b = req.body ?? {};
    if (!Array.isArray(b.userIds)) throw new HttpError(400, "userIds must be a list");
    const assignees = (b.userIds as unknown[]).map(String).slice(0, 500).map((id) => {
      const u = r.people.find((p) => p.id === id && p.active);
      if (!u) throw new HttpError(400, "One of those people doesn't exist or isn't active.");
      if (!viewerCanAssign(r, u.id)) throw new HttpError(403, `You can't assign training to ${u.name}.`);
      return { userId: u.id, name: u.name };
    });
    res.status(201).json(
      await createAssignments({
        assignees,
        assignedBy: r.user.id,
        simulationId: String(b.simulationId ?? ""),
        scenarioId: String(b.scenarioId ?? ""),
        requirement: b.requirement,
        dueDate: b.dueDate ?? null,
        note: typeof b.note === "string" ? b.note : "",
      }),
    );
  }),
);
app.delete(
  "/api/assignments/:id",
  route(async (req, res) => {
    const r = requireUser(req);
    const a = (await visibleAssignments(r)).find((x) => x.id === param(req, "id"));
    if (!a || !viewerCanAssign(r, a.userId!)) throw new HttpError(403, "You can't remove that assignment.");
    await deleteAssignment(param(req, "id"));
    res.status(204).end();
  }),
);

// ---- personas (anyone can read; the Admin-Builder edits personas and templates)
// A persona is one record: saving it changes it everywhere it's used.

app.get("/api/library/personas", route(async (_req, res) => res.json(await readPersonas())));
app.put(
  "/api/library/personas/templates/:id",
  route(async (req, res) => {
    requirePermission(req, "libraries.edit");
    res.json(await savePersonaTemplate({ ...req.body, id: param(req, "id") }));
  }),
);
app.delete(
  "/api/library/personas/templates/:id",
  route(async (req, res) => {
    requirePermission(req, "libraries.edit");
    await deletePersonaTemplate(param(req, "id"));
    res.status(204).end();
  }),
);
app.get("/api/library/personas/:id/usage", route(async (req, res) => res.json({ uses: await personaUsage(param(req, "id")) })));
app.put(
  "/api/library/personas/:id",
  route(async (req, res) => {
    requirePermission(req, "libraries.edit");
    res.json(await savePersona({ ...req.body, id: param(req, "id") }));
  }),
);
app.delete(
  "/api/library/personas/:id",
  route(async (req, res) => {
    requirePermission(req, "libraries.edit");
    await deletePersona(param(req, "id"));
    res.status(204).end();
  }),
);
/** AI drafts personas (not saved: the admin reviews them first). */
app.post(
  "/api/library/personas/draft",
  route(async (req, res) => {
    requirePermission(req, "libraries.edit");
    const description = String(req.body?.description ?? "").trim().slice(0, 4000);
    if (!description) throw new HttpError(400, "Describe the personas you want.");
    const count = Math.min(10, Math.max(1, Number(req.body?.count) || 3));
    const lib = await readPersonas();
    const template = req.body?.templateId ? lib.templates.find((t) => t.id === req.body.templateId) ?? null : null;
    try {
      res.json({ personas: await draftPersonas({ description, count, template }, newId) });
    } catch (e) {
      const { status, message } = describeApiError(e);
      res.status(status).json({ error: message });
    }
  }),
);

app.use("/api/conversation", conversationRoutes());

/** Correct an AI-judged mark (Builders and Admin-Builders). A note is required, and the learner sees it. */
app.post(
  "/api/attempts/:id/review",
  route(async (req, res) => {
    const r = requirePermission(req, "simulations.build");
    const input = z.object({ criterionId: z.string().max(100), met: z.boolean(), note: z.string().trim().min(1).max(500) }).parse(req.body);
    const updated = await updateAttempt(param(req, "id"), (a) => {
      try {
        return reviewAiMark(a, input.criterionId, input.met, input.note, r.user.id);
      } catch (e) {
        throw new HttpError(400, (e as Error).message);
      }
    });
    res.json(reviewView(r, [updated])[0]);
  }),
);

/**
 * Attempts for review. Builders see them anonymised ("Learner A", "B"… in order of each
 * person's first attempt on this simulation); Admin-Builders also see names.
 */
function reviewView(r: AuthedRequest, attempts: Attempt[]) {
  const named = userCan(r, "people.manage");
  const key = (a: Attempt) => a.userId ?? `name:${a.trainee.trim().toLowerCase()}`;
  const order: string[] = [];
  for (const a of [...attempts].sort((x, y) => x.finishedAt.localeCompare(y.finishedAt))) if (!order.includes(key(a))) order.push(key(a));
  const label = (i: number) => `Learner ${i < 26 ? String.fromCharCode(65 + i) : `${String.fromCharCode(65 + Math.floor(i / 26) - 1)}${String.fromCharCode(65 + (i % 26))}`}`;
  return attempts.map(({ userId: _u, trainee, reviews, ...a }) => {
    void _u;
    return {
      ...a,
      learner: label(order.indexOf(key({ userId: _u, trainee } as Attempt))),
      name: named ? trainee : undefined,
      // Reviewers stay anonymous to each other and to learners: only that a person reviewed it.
      reviews: (reviews ?? []).map(({ by: _b, ...x }) => (void _b, x)),
      trainee: "",
    };
  });
}

// ------------------------------------------------------------------ tool library (shared/tools.ts)

const RenamesSchema = z.array(z.object({ kind: z.enum(["element", "screen", "variable"]), from: z.string().max(100), to: z.string().max(100) })).max(500);
/** Renames sent with a save or impact check (anything malformed is ignored). */
const renamesParam = (v: unknown) => RenamesSchema.safeParse(v ?? []).data ?? [];

/** Every tool, with the simulations that use it. Everyone who builds can see and edit tools. */
app.get(
  "/api/tools",
  route(async (req, res) => {
    requirePermission(req, "simulations.build");
    const [tools, sims] = await Promise.all([listTools(), listSimulations()]);
    res.json(
      tools.map((t) => ({
        id: t.id,
        name: t.name,
        description: t.description,
        screens: t.screens.length,
        cover: t.screens.find((s) => s.imageAssetId)?.imageAssetId ?? null,
        version: t.version,
        updatedAt: t.updatedAt ?? null,
        usedBy: sims.filter((s) => s.toolId === t.id).map((s) => ({ id: s.id, title: s.title })),
      })),
    );
  }),
);

app.get(
  "/api/tools/:id",
  route(async (req, res) => {
    requirePermission(req, "simulations.build");
    res.json(await getTool(param(req, "id")));
  }),
);

/** Create a tool (POST) or save one (PUT, with the version it was loaded at). */
app.post(
  "/api/tools",
  route(async (req, res) => {
    requirePermission(req, "simulations.build");
    res.status(201).json(await saveTool({ ...req.body, id: newId("tool"), version: undefined }));
  }),
);
app.put(
  "/api/tools/:id",
  route(async (req, res) => {
    requirePermission(req, "simulations.build");
    const id = param(req, "id");
    const current = await getTool(id);
    const expect = typeof req.body?.version === "number" ? req.body.version : undefined;
    res.json(await saveToolEverywhere({ ...current, ...req.body, id }, { expectVersion: expect, renames: renamesParam(req.body?.renames) }));
  }),
);
app.delete(
  "/api/tools/:id",
  route(async (req, res) => {
    requirePermission(req, "simulations.build");
    await deleteTool(param(req, "id"));
    res.status(204).end();
  }),
);

/** Before saving a tool change: what would it break in each simulation that uses the tool? */
app.post(
  "/api/tools/:id/impact",
  route(async (req, res) => {
    requirePermission(req, "simulations.build");
    const id = param(req, "id");
    const tool = await getTool(id);
    const proposed = ToolSchema.pick({ startScreenId: true, variables: true, screens: true }).parse(req.body);
    const users = await simulationsUsingTool(id);
    const [grading, personas] = await Promise.all([readGrading(), readPersonas()]);
    const sims = await Promise.all(users.map((u) => getSimulation(u.id)));
    res.json({ tool: { id: tool.id, name: tool.name, version: tool.version }, rows: toolImpact(sims, proposed, grading.schemes, personas, renamesParam(req.body?.renames)) });
  }),
);

/** A new simulation (no scenarios yet) on an existing tool. */
app.post(
  "/api/tools/:id/simulations",
  route(async (req, res) => {
    requirePermission(req, "simulations.build");
    const tool = await getTool(param(req, "id"));
    const title = String(req.body?.title ?? "").trim().slice(0, 200) || `${tool.name} practice`;
    const sim = await saveSimulation({ id: newId(), title, description: "", toolId: tool.id, toolVersion: tool.version, ...toolParts(tool), scenarios: [] });
    res.status(201).json(sim);
  }),
);

/**
 * Move a simulation onto another tool (e.g. to merge copies). Without `apply`, only checks:
 * each scenario path is auto-played on the target tool and the results are returned.
 */
app.post(
  "/api/simulations/:id/tool",
  route(async (req, res) => {
    requirePermission(req, "simulations.build");
    const sim = await getSimulation(param(req, "id"));
    const target = await getTool(String(req.body?.toolId ?? ""));
    const [grading, personas] = await Promise.all([readGrading(), readPersonas()]);
    const moved = { ...sim, ...toolParts(target), toolId: target.id };
    const health = checkSimulation(moved, grading.schemes, personas);
    const issues = lintSimulation(moved);
    if (req.body?.apply === true) {
      const saved = await setSimulationTool(sim.id, target.id);
      return void res.json({ simulation: saved, paths: health.paths, issues });
    }
    res.json({ paths: health.paths, issues });
  }),
);

/** Health of every simulation (Builders): status and counts, for the Quality list. */
app.get(
  "/api/quality",
  route(async (req, res) => {
    requirePermission(req, "simulations.build");
    const [summaries, grading, personas, attempts] = await Promise.all([listSimulations(), readGrading(), readPersonas(), listAttempts()]);
    const out = [];
    for (const s of summaries) {
      const sim = await getSimulation(s.id);
      const h = checkSimulation(sim, grading.schemes, personas, attempts.filter((a) => a.simulationId === s.id));
      out.push({ id: s.id, title: s.title, status: h.status, errors: h.problems.filter((p) => p.level === "error").length, warnings: h.problems.filter((p) => p.level === "warning").length, paths: h.paths.length });
    }
    const rank = { problems: 0, check: 1, healthy: 2 };
    res.json(out.sort((a, b) => rank[a.status] - rank[b.status] || a.title.localeCompare(b.title)));
  }),
);

/** One simulation's health, and its recent attempts for review (anonymised for Builders). */
app.get(
  "/api/quality/:simId",
  route(async (req, res) => {
    const r = requirePermission(req, "simulations.build");
    const sim = await getSimulation(param(req, "simId"));
    const [grading, personas, raw] = await Promise.all([readGrading(), readPersonas(), listAttempts(sim.id)]);
    const attempts = withUserIds(raw, r.people);
    const recent = [...attempts].sort((a, b) => b.finishedAt.localeCompare(a.finishedAt)).slice(0, 200);
    res.json({ health: checkSimulation(sim, grading.schemes, personas, attempts), attempts: reviewView(r, recent), total: attempts.length });
  }),
);

/** Trainer marking: set manual rubric criteria to met / not met / unmarked (null), then rescore. */
app.post(
  "/api/attempts/:id/marks",
  route(async (req, res) => {
    requirePermission(req, "attempts.mark");
    const marks = (req.body?.marks ?? {}) as Record<string, unknown>;
    const updated = await updateAttempt(param(req, "id"), (a) => {
      if (!a.grading) throw new HttpError(400, "This attempt has no rubric to mark.");
      const rubric = a.grading.rubric.map((c) =>
        c.manual && c.id in marks ? { ...c, met: marks[c.id] === null ? null : Boolean(marks[c.id]) } : c,
      );
      const grading = { ...a.grading, rubric };
      const { score, passed } = finalScore(grading, a.completed);
      return { ...a, grading, score, passed };
    });
    res.json(updated);
  }),
);

app.post(
  "/api/assets",
  route(async (req, res) => {
    requirePermission(req, "simulations.build");
    const { mediaType, data } = req.body ?? {};
    if (typeof mediaType !== "string" || typeof data !== "string") throw new HttpError(400, "mediaType and data required");
    res.status(201).json({ assetId: await saveAsset(mediaType, Buffer.from(data, "base64")) });
  }),
);

app.get("/assets/:id", (req, res) => {
  try {
    res.sendFile(assetPath(param(req, "id")), { maxAge: "365d", immutable: true }, (err) => {
      if (err && !res.headersSent) res.status(404).end();
    });
  } catch {
    res.status(400).end();
  }
});

/** Attempts the viewer may see: their own, their reporting tree's (leaders), or all (Admin-Builders). */
async function visibleAttempts(r: AuthedRequest, simulationId?: string) {
  const all = withUserIds(await listAttempts(simulationId), r.people);
  // Older attempts whose typed name matches no account stay visible to Admin-Builders.
  return all.filter((a) => (a.userId ? viewerCanSee(r, a.userId) : userCan(r, "people.manage")));
}

app.get(
  "/api/attempts",
  route(async (req, res) => {
    const simulationId = typeof req.query.simulationId === "string" ? req.query.simulationId : undefined;
    res.json(await visibleAttempts(requireUser(req), simulationId));
  }),
);

app.post(
  "/api/attempts",
  route(async (req, res) => {
    // The attempt always belongs to whoever is signed in.
    const r = requireUser(req);
    res.status(201).json(await addAttempt({ ...req.body, userId: r.user.id, trainee: r.user.name }));
  }),
);

/**
 * Course performance for Builders and Admin-Builders: aggregate figures only (no names),
 * across every learner's attempts. `guided=0` leaves out Guided runs.
 */
app.get(
  "/api/analytics",
  route(async (req, res) => {
    const r = requirePermission(req, "simulations.build");
    const [sims, all] = await Promise.all([listSimulations(), listAttempts()]);
    const team = teamParam(req.query.team);
    const attempts = scoped(r, all, req.query, team);
    res.json(
      sims
        .map((s) => {
          const st = stats(attempts.filter((a) => a.simulationId === s.id));
          // With a team chosen, too few learners would identify individuals: show nothing.
          const hidden = !!team && st.learners > 0 && st.learners < MIN_TEAM_LEARNERS;
          return { id: s.id, title: s.title, tagIds: s.tagIds, scenarios: s.scenarios, hidden, stats: hidden ? stats([]) : st };
        })
        .sort((a, b) => b.stats.attempts - a.stats.attempts),
    );
  }),
);

app.get(
  "/api/analytics/:simId",
  route(async (req, res) => {
    const r = requirePermission(req, "simulations.build");
    const sim = await getSimulation(param(req, "simId"));
    const team = teamParam(req.query.team);
    const result = analyzeSimulation(sim, scoped(r, await listAttempts(sim.id), req.query, team), req.query.guided !== "0");
    if (team && result.overall.learners > 0 && result.overall.learners < MIN_TEAM_LEARNERS) {
      return void res.json({ ...analyzeSimulation(sim, []), hidden: true });
    }
    res.json(result);
  }),
);

/**
 * Leaderboards (computed here so learners see rankings without seeing others' attempts).
 * scope: org | team (leaders: their tree and themselves) | topic:<topicId> | scenario:<simId>/<scenarioId>
 */
app.get(
  "/api/leaderboard",
  route(async (req, res) => {
    const r = requireUser(req);
    const scope = String(req.query.scope ?? "org");
    const people = r.people.filter((u) => u.active).map((u) => ({ id: u.id, name: u.name }));
    const attempts = withUserIds(await listAttempts(), r.people);
    const team = new Set([r.user.id, ...reportingTree(r.people, r.user.id)]);
    if (scope === "team" && !rolesOf(r).includes("leader")) throw new HttpError(403, "Team leaderboards are for leaders.");
    if (scope.startsWith("scenario:")) {
      const [simId, scId] = scope.slice(9).split("/");
      return res.json({ scope, rows: scenarioBoard(people, attempts, simId, scId) });
    }
    let inScope: ((a: (typeof attempts)[number]) => boolean) | undefined;
    if (scope.startsWith("topic:")) {
      const topic = (await readTaxonomy()).topics.find((t) => t.id === scope.slice(6));
      if (!topic) throw new HttpError(404, "Topic not found");
      const tagIds = new Set(topic.tags.map((t) => t.id));
      const simIds = new Set((await listSimulations()).filter((s) => s.tagIds.some((t) => tagIds.has(t))).map((s) => s.id));
      inScope = (a) => simIds.has(a.simulationId);
    }
    res.json({ scope, rows: mainBoard(people, attempts, { onlyUserIds: scope === "team" ? team : undefined, inScope }) });
  }),
);

/**
 * AI routes stream newline-delimited JSON so the browser can show progress
 * during the minute or two generation takes:
 *   {"type":"progress","phase":"writing","chars":1234}
 *   {"type":"done", ...GenerateResult}   or   {"type":"error","message":"..."}
 */
async function streamAi(res: Response, work: (send: (o: object) => void) => Promise<GenerateResult>) {
  res.setHeader("Content-Type", "application/x-ndjson");
  res.setHeader("Cache-Control", "no-cache");
  const send = (o: object) => res.write(JSON.stringify(o) + "\n");
  let last = 0;
  try {
    const result = await work((o) => {
      const now = Date.now();
      if (now - last > 400) {
        last = now;
        send(o);
      }
    });
    send({ type: "done", ...result });
  } catch (e) {
    console.error(e);
    send({ type: "error", message: describeApiError(e).message });
  }
  res.end();
}

/** The tags and grading schemes Claude may choose from (the default scheme is "null"). */
async function libraryContext(): Promise<LibraryContext> {
  const [tax, grading] = await Promise.all([readTaxonomy(), readGrading()]);
  return {
    tags: tax.topics.flatMap((t) => t.tags.map((g) => ({ id: g.id, name: g.name, topic: t.name }))),
    schemes: grading.schemes.filter((s) => s.id !== DEFAULT_SCHEME_ID).map((s) => ({ id: s.id, name: s.name, description: s.description ?? "" })),
  };
}

app.post(
  "/api/generate",
  route(async (req, res) => {
    requirePermission(req, "simulations.build");
    const input = GenerateInputSchema.parse(req.body);
    // Store images first so the simulation can reference them by asset id.
    const images: StoredImage[] = [];
    for (const img of input.images) {
      const assetId = await saveAsset(img.mediaType, Buffer.from(img.data, "base64"));
      images.push({ assetId, width: img.width, height: img.height, mediaType: img.mediaType, data: img.data, label: img.source ?? img.name });
    }
    await streamAi(res, async (progress) => {
      const result = await generateSimulation(input, images, newId(), (p) => progress({ type: "progress", ...p }), await libraryContext());
      result.simulation = await saveSimulation(result.simulation);
      return result;
    });
  }),
);

app.post(
  "/api/simulations/:id/refine",
  route(async (req, res) => {
    requirePermission(req, "simulations.build");
    const instruction = String(req.body?.instruction ?? "").slice(0, 10000);
    if (!instruction.trim()) throw new HttpError(400, "instruction required");
    // Refine the version the editor currently holds (may be unsaved).
    const sim = req.body?.simulation ? SimulationSchema.parse(req.body.simulation) : await getSimulation(param(req, "id"));
    const images: StoredImage[] = [];
    for (const s of sim.screens) {
      if (!s.imageAssetId || images.some((i) => i.assetId === s.imageAssetId)) continue;
      const { data, mediaType } = await readAsset(s.imageAssetId).catch(() => ({ data: null, mediaType: "" }));
      if (!data) continue;
      const height = 1000;
      images.push({ assetId: s.imageAssetId, width: Math.round(height * s.aspect), height, mediaType, data: data.toString("base64"), label: `screen "${s.name}"` });
    }
    // Refinement returns the revised simulation without saving; the author reviews it in the editor.
    const lib = await libraryContext();
    await streamAi(res, (progress) => refineSimulation(sim, instruction, images, (p) => progress({ type: "progress", ...p }), lib));
  }),
);

app.post(
  "/api/align",
  route(async (req, res) => {
    requirePermission(req, "simulations.build");
    const input = AlignInputSchema.parse(req.body);
    try {
      res.json({ elements: await alignElements(input) });
    } catch (e) {
      const { status, message } = describeApiError(e);
      res.status(status).json({ error: message });
    }
  }),
);

// ------------------------------------------------------------ errors + static

app.use("/api", (_req, res) => res.status(404).json({ error: "Not found" }));

app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  if (err instanceof ZodError) {
    res.status(400).json({ error: "Invalid data", details: err.issues.slice(0, 10) });
  } else if (err instanceof HttpError) {
    res.status(err.status).json({ error: err.message });
  } else if ((err as { type?: string }).type === "entity.too.large") {
    res.status(413).json({ error: "Upload too large (60 MB max per request; 250 MB for imports)." });
  } else {
    console.error(err);
    res.status(500).json({ error: "Internal error" });
  }
});

if (PROD) {
  const dist = path.resolve("dist");
  app.use(express.static(dist));
  app.get(/.*/, (_req, res) => res.sendFile(path.join(dist, "index.html")));
}

await initStorage([SimulationSchema.parse(sample)]);
app.listen(PORT, HOST, () => {
  console.log(`Simulator API on http://${HOST}:${PORT}${PROD ? "" : " (open the web app at http://127.0.0.1:5173)"}`);
  if (!process.env.ANTHROPIC_API_KEY && !process.env.ANTHROPIC_AUTH_TOKEN) {
    console.log("No ANTHROPIC_API_KEY set: AI generation is disabled, manual authoring still works.");
  }
});
