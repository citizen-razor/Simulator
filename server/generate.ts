/**
 * AI-assisted authoring: turn uploaded media into a simulation draft with Claude.
 *
 * Flow:
 *   1. The browser sends images (screenshots and frames it pulled out of videos),
 *      text/code files, PDFs and Word docs.
 *   2. We send them to Claude with a description of our simulation format and ask
 *      for a draft using *structured outputs*: the API guarantees the reply
 *      matches the Zod schema below, so we never have to repair broken JSON.
 *   3. The draft is converted into a real Simulation (image numbers become stored
 *      asset ids, ids are cleaned up) and checked again with SimulationSchema.
 *
 * The author then fixes anything the AI got wrong in the visual editor.
 * The API key is read from the environment on the server and never reaches the browser.
 */
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import mammoth from "mammoth";
import { z } from "zod";
import { lintSimulation } from "../shared/engine";
import { keyFromLabel, PersonaSchema, type Persona, type PersonaTemplate } from "../shared/personas";
import {
  ActionTypes,
  Channels,
  ConditionOps,
  ElementKinds,
  ExpectOps,
  SimulationSchema,
  type Simulation,
} from "../shared/schema";

export const MODEL = process.env.SIM_MODEL || "claude-opus-5-5";

// ------------------------------------------------------------ draft schema
// Same shape as SimulationSchema, but every field is required (nullable instead
// of optional) and screenshots are referenced by number. That form works best
// with structured outputs.

const DraftCondition = z.object({ var: z.string(), op: z.enum(ConditionOps), value: z.string().nullable() });
const DraftAction = z.object({
  type: z.enum(ActionTypes),
  screenId: z.string().nullable(),
  var: z.string().nullable(),
  value: z.string().nullable(),
  tone: z.enum(["info", "success", "error"]).nullable(),
});
const DraftElement = z.object({
  id: z.string(),
  label: z.string(),
  kind: z.enum(ElementKinds),
  rect: z.object({ x: z.number(), y: z.number(), w: z.number(), h: z.number() }),
  placeholder: z.string().nullable(),
  options: z.array(z.string()),
  bindVar: z.string().nullable(),
  visibleIf: z.array(DraftCondition),
  rules: z.array(z.object({ if: z.array(DraftCondition), then: z.array(DraftAction) })),
});
const DraftScreen = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  imageIndex: z.number().int().nullable(),
  elements: z.array(DraftElement),
});
const DraftStep = z.object({
  id: z.string(),
  instruction: z.string(),
  hint: z.string(),
  elementId: z.string(),
  alsoElementIds: z.array(z.string()),
  expect: z.enum(ExpectOps),
  value: z.string().nullable(),
});
const DraftScenario = z.object({
  id: z.string(),
  title: z.string(),
  goal: z.string(),
  briefing: z.string(),
  startScreenId: z.string().nullable(),
  initialVars: z.array(z.object({ name: z.string(), value: z.string() })),
  steps: z.array(DraftStep),
  alternatePaths: z.array(z.object({ id: z.string(), name: z.string(), steps: z.array(DraftStep) })),
  successCriteria: z.array(DraftCondition),
  /** A customer the trainee talks to (AI-played), when the task naturally involves one. */
  conversation: z
    .object({
      channel: z.enum(Channels),
      brief: z.string(),
      opening: z.string(),
      criteria: z.array(z.object({ label: z.string(), weight: z.number().int() })),
    })
    .nullable(),
});
export const DraftSimulation = z.object({
  title: z.string(),
  description: z.string(),
  startScreenId: z.string(),
  variables: z.array(z.object({ name: z.string(), initial: z.string(), description: z.string() })),
  screens: z.array(DraftScreen),
  scenarios: z.array(DraftScenario),
  /** Tags chosen from the organisation's library (ids from the list provided). */
  tagIds: z.array(z.string()),
  /** A grading scheme from the library that fits best, or null for the default. */
  gradingSchemeId: z.string().nullable(),
  authorNotes: z.string(),
});
type Draft = z.infer<typeof DraftSimulation>;

const SYSTEM_PROMPT = `You build interactive software-training simulations from source material (screenshots, frames from screen recordings, source code/HTML, and written procedures). Trainees will click and type in your simulation in three modes: open-world exploration, guided step-by-step coaching, and graded scenarios. Your output is a JSON simulation in the given schema.

How the format works:
- screens: each is one view of the system. If a provided image shows that view, set imageIndex to its number; otherwise null and the app draws a wireframe from your elements, so lay them out like a clean UI.
- elements: interactive or display regions on a screen. rect x/y/w/h are PERCENTAGES (0-100) of the screen's width/height. When a screen has an image, place each rect tightly over the matching control in the image; measure carefully. kind:
  - button / link / hotspot: activated by a click. hotspot = invisible clickable area over an image region (table rows, tabs, icons).
  - input / textarea / select / checkbox: fields. Their value is stored in the variable named by bindVar (always set bindVar to a declared variable). Checkbox values are "true"/"false". select needs options.
  - text: static label, not interactive. Use it on wireframe screens to show headings, data and status. On image screens, only add text elements for values that change during the simulation.
- Labels, set values, message text and condition values may contain {{variableName}} templates that show current state, e.g. "Status: {{ticketStatus}}".
- rules run when an element is activated (or when a field's value is committed). The FIRST rule whose "if" conditions all pass runs its "then" actions; use an empty "if" as the final catch-all. Actions: navigate (screenId), set (var, value), toggle (var), message (value, tone). Model realistic validation (e.g. required fields show an error message instead of navigating) and realistic consequences (state changes that show up on other screens).
- visibleIf hides an element until its conditions pass (e.g. an error banner, a success row).
- variables: declare every variable used anywhere, with sensible initial values.
- scenarios: 1-3 realistic training tasks a new user of this system must learn. Each step names exactly one elementId the trainee must use, in order. For fields, use expect "eq"/"contains" with value when the correct entry matters, otherwise "any". Give each step a short imperative instruction and a hint that teaches the reasoning. successCriteria are optional end-state checks. initialVars and startScreenId let a scenario begin mid-workflow.
- Real tasks often have more than one correct way. If a step can be done equally well with another control (e.g. a toolbar button and a menu item), list those in alsoElementIds. If the task can be completed by a genuinely different sequence (e.g. a quick action instead of the full form), put the recommended sequence in steps and each other valid sequence in alternatePaths with a short name; include the shared opening steps in every path. Leave both empty when there is only one sensible way.
- ids: short kebab-case, unique across the whole simulation (element ids must be unique across ALL screens).
- Video frames arrive in order. Merge frames that show the same screen into one screen (use the clearest frame as its image) and use the transitions between frames to infer what was clicked and the workflow's steps.
- Source code/HTML: derive real screens, field names, validation rules and navigation from it.
- Written procedures: turn them into scenarios and, if there are no images, wireframe screens.
- tagIds: choose the tags that fit this simulation from the "Library" list provided (use their ids exactly; never invent tags). Empty if none fit or no list is given.
- gradingSchemeId: pick the grading scheme from the Library list whose description best fits this training, or null to use the organisation's default. Never invent ids.
- conversation (per scenario): if the task naturally involves dealing with a customer or member of the public (a support call, a counter, a chat), describe the customer the trainee talks to while doing the task: channel (chat, phone or in-person), brief (written TO the customer in second person: why they're getting in touch, their mood, what they want, what reassures them; no personal account details, those come from a persona), opening ("" to let the customer open in their own words), and 2-5 criteria for good handling, each a short observable behaviour ("Verified the customer's identity before discussing the account") with a weight 1-5. Otherwise null.
- authorNotes: briefly tell the author what you assumed, what you could not determine, and what they should check in the editor.
Prefer a complete, coherent, working simulation over an exhaustive one: typically 3-8 screens.`;

// ------------------------------------------------------------ inputs

export const GenerateInputSchema = z.object({
  title: z.string().max(200).optional(),
  notes: z.string().max(20000).default(""),
  images: z
    .array(
      z.object({
        name: z.string().max(300),
        mediaType: z.enum(["image/png", "image/jpeg", "image/webp", "image/gif"]),
        data: z.string(), // base64
        width: z.number().positive(),
        height: z.number().positive(),
        source: z.string().max(300).optional(), // e.g. "video demo.mp4 @ 12.5s"
      }),
    )
    .max(40)
    .default([]),
  texts: z.array(z.object({ name: z.string().max(300), content: z.string().max(400_000) })).max(50).default([]),
  pdfs: z.array(z.object({ name: z.string().max(300), data: z.string() })).max(5).default([]),
  docx: z.array(z.object({ name: z.string().max(300), data: z.string() })).max(10).default([]),
});
export type GenerateInput = z.infer<typeof GenerateInputSchema>;

export interface StoredImage {
  assetId: string;
  width: number;
  height: number;
  mediaType: string;
  data: string;
  label: string;
}

type Content = Anthropic.Beta.BetaContentBlockParam;

async function buildContent(input: GenerateInput, images: StoredImage[]): Promise<Content[]> {
  const content: Content[] = [];
  for (const pdf of input.pdfs) {
    content.push({
      type: "document",
      title: pdf.name,
      source: { type: "base64", media_type: "application/pdf", data: pdf.data },
    });
  }
  images.forEach((img, i) => {
    content.push({ type: "text", text: `Image ${i}: ${img.label} (${img.width}x${img.height}px)` });
    content.push({
      type: "image",
      source: { type: "base64", media_type: img.mediaType as "image/png", data: img.data },
    });
  });
  for (const t of input.texts) content.push({ type: "text", text: `<file name="${t.name}">\n${t.content}\n</file>` });
  for (const d of input.docx) {
    const { value } = await mammoth.extractRawText({ buffer: Buffer.from(d.data, "base64") });
    content.push({ type: "text", text: `<file name="${d.name}">\n${value}\n</file>` });
  }
  return content;
}

// ------------------------------------------------------------ Claude call

export type Progress = (p: { phase: "thinking" | "writing"; chars: number }) => void;

let client: Anthropic | null = null;
export const getClient = () => (client ??= new Anthropic());

async function callClaude(content: Content[], onProgress: Progress): Promise<Draft> {
  const stream = getClient().beta.messages.stream({
    model: MODEL,
    max_tokens: 64000,
    // If a safety classifier declines, retry on a suitable fallback model automatically.
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    output_config: { effort: "high", format: betaZodOutputFormat(DraftSimulation) },
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content }],
  });
  let chars = 0;
  onProgress({ phase: "thinking", chars });
  stream.on("text", (delta) => {
    chars += delta.length;
    onProgress({ phase: "writing", chars });
  });
  const message = await stream.finalMessage();
  if (message.stop_reason === "refusal") {
    throw new Error(`The model declined this request${message.stop_details?.explanation ? `: ${message.stop_details.explanation}` : "."}`);
  }
  if (message.stop_reason === "max_tokens") {
    throw new Error("The simulation was too large to generate in one pass. Try fewer files or narrower notes.");
  }
  if (!message.parsed_output) throw new Error("The model's reply could not be read as a simulation.");
  return message.parsed_output;
}

export function describeApiError(e: unknown): { status: number; message: string } {
  if (e instanceof Anthropic.AuthenticationError) {
    return { status: 401, message: "The Anthropic API key is missing or invalid. Set ANTHROPIC_API_KEY in .env and restart." };
  }
  if (e instanceof Anthropic.RateLimitError) return { status: 429, message: "Rate limited by the Anthropic API. Wait a minute and try again." };
  if (e instanceof Anthropic.BadRequestError) return { status: 400, message: `The API rejected the request: ${e.message}` };
  if (e instanceof Anthropic.APIError) return { status: 502, message: `Anthropic API error ${e.status ?? ""}: ${e.message}` };
  if (e instanceof Error && /api key|apiKey|authentication/i.test(e.message)) {
    return { status: 401, message: "No Anthropic API key found. Copy .env.example to .env, add your key, and restart." };
  }
  return { status: 500, message: e instanceof Error ? e.message : String(e) };
}

// ------------------------------------------------------------ draft -> Simulation

const slug = (s: string, fallback: string) =>
  s.toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || fallback;
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, Number.isFinite(n) ? n : lo));
const nn = <T>(v: T | null): T | undefined => (v === null ? undefined : v);

/** Tags and grading schemes the organisation has, offered to Claude to choose from. */
export interface LibraryContext {
  tags: { id: string; name: string; topic: string }[];
  schemes: { id: string; name: string; description: string }[];
}

export function libraryText(lib: LibraryContext): string {
  return (
    `<library>\nTags (id: topic / tag):\n${lib.tags.map((t) => `- ${t.id}: ${t.topic} / ${t.name}`).join("\n") || "(none)"}\n` +
    `Grading schemes (id: name, description):\n${lib.schemes.map((s) => `- ${s.id}: ${s.name}${s.description ? `, ${s.description}` : ""}`).join("\n") || "(none)"}\n</library>`
  );
}

export function draftToSimulation(draft: Draft, id: string, images: StoredImage[], lib: LibraryContext = { tags: [], schemes: [] }): Simulation {
  // Make ids safe and unique, remembering renames so references still resolve.
  const used = new Set<string>();
  const unique = (raw: string, fallback: string) => {
    let base = slug(raw, fallback);
    let candidate = base;
    for (let i = 2; used.has(candidate); i++) candidate = `${base}-${i}`;
    used.add(candidate);
    return candidate;
  };
  const screenMap = new Map<string, string>();
  const elementMap = new Map<string, string>();
  for (const s of draft.screens) screenMap.set(s.id, unique(s.id, "screen"));
  for (const s of draft.screens) for (const e of s.elements) elementMap.set(e.id, unique(e.id, "el"));
  const screenRef = (r: string | null) => (r ? screenMap.get(r) ?? slug(r, "screen") : undefined);
  const cond = (c: z.infer<typeof DraftCondition>) => ({ var: c.var, op: c.op, value: nn(c.value) });
  const elementRef = (id: string) => elementMap.get(id) ?? id;
  const step = (st: z.infer<typeof DraftStep>, i: number) => ({
    id: slug(st.id, `step-${i + 1}`),
    instruction: st.instruction,
    hint: st.hint || undefined,
    elementId: elementRef(st.elementId),
    alsoElementIds: st.alsoElementIds.length ? st.alsoElementIds.map(elementRef) : undefined,
    expect: st.expect,
    value: nn(st.value),
  });

  return SimulationSchema.parse({
    id,
    tagIds: [...new Set(draft.tagIds)].filter((t) => lib.tags.some((x) => x.id === t)),
    grading: { schemeId: lib.schemes.some((s) => s.id === draft.gradingSchemeId) ? draft.gradingSchemeId : null, bindings: [] },
    title: draft.title || "Untitled simulation",
    description: draft.description,
    startScreenId: screenRef(draft.startScreenId) ?? screenMap.values().next().value,
    variables: draft.variables.map((v) => ({ name: v.name, initial: v.initial, description: v.description || undefined })),
    screens: draft.screens.map((s) => {
      const img = s.imageIndex !== null ? images[s.imageIndex] : undefined;
      return {
        id: screenMap.get(s.id)!,
        name: s.name,
        description: s.description || undefined,
        imageAssetId: img?.assetId ?? null,
        aspect: img ? img.width / img.height : 1.6,
        elements: s.elements.map((e) => {
          const x = clamp(e.rect.x, 0, 99);
          const y = clamp(e.rect.y, 0, 99);
          return {
            id: elementMap.get(e.id)!,
            label: e.label,
            kind: e.kind,
            rect: { x, y, w: clamp(e.rect.w, 1, 100 - x), h: clamp(e.rect.h, 1, 100 - y) },
            placeholder: nn(e.placeholder),
            options: e.options.length ? e.options : undefined,
            bindVar: nn(e.bindVar),
            visibleIf: e.visibleIf.length ? e.visibleIf.map(cond) : undefined,
            rules: e.rules.map((r) => ({
              if: r.if.map(cond),
              then: r.then.map((a) => ({
                type: a.type,
                screenId: screenRef(a.screenId),
                var: nn(a.var),
                value: nn(a.value),
                tone: nn(a.tone),
              })),
            })),
          };
        }),
      };
    }),
    scenarios: draft.scenarios.map((sc) => ({
      id: slug(sc.id, "scenario"),
      title: sc.title,
      goal: sc.goal,
      briefing: sc.briefing || undefined,
      startScreenId: screenRef(sc.startScreenId),
      initialVars: sc.initialVars,
      steps: sc.steps.map(step),
      alternatePaths: sc.alternatePaths
        .filter((p) => p.steps.length > 0)
        .map((p, i) => ({ id: slug(p.id, `path-${i + 2}`).replace(/^main$/, `path-${i + 2}`), name: p.name || `Alternative ${i + 1}`, steps: p.steps.map(step) })),
      successCriteria: sc.successCriteria.map(cond),
      conversation: sc.conversation
        ? {
            enabled: true,
            channel: sc.conversation.channel,
            role: "customer",
            brief: sc.conversation.brief.slice(0, 4000),
            opening: sc.conversation.opening.slice(0, 500),
            criteria: sc.conversation.criteria
              .filter((c) => c.label.trim())
              .slice(0, 12)
              .map((c, i) => ({ id: `c${i + 1}`, label: c.label.trim().slice(0, 200), weight: clamp(Math.round(c.weight), 1, 5) })),
            weight: 30,
          }
        : undefined,
    })),
  });
}

/**
 * Keep what Claude doesn't see or edit when it revises a simulation: personas, random data,
 * grading targets and trainer-marking choice, and per scenario its personas, scheme, random-data
 * choice and the customer's role and weight; per element a table's source and clickable rows.
 */
export function keepUnrevised(original: Simulation, revised: Simulation): Simulation {
  const out = structuredClone(revised);
  out.personas = original.personas;
  out.randomData = original.randomData;
  out.grading = { ...out.grading, bindings: original.grading.bindings, trainerMarking: original.grading.trainerMarking };
  out.createdAt = original.createdAt;
  for (const sc of out.scenarios) {
    const before = original.scenarios.find((x) => x.id === sc.id);
    if (!before) continue;
    sc.personaOverrides = before.personaOverrides;
    sc.gradingSchemeId = before.gradingSchemeId;
    sc.randomize = before.randomize;
    if (sc.conversation && before.conversation) {
      sc.conversation.role = before.conversation.role;
      sc.conversation.weight = before.conversation.weight;
      sc.conversation.enabled = before.conversation.enabled;
      // Keep criterion ids where the wording is unchanged, so results stay comparable.
      sc.conversation.criteria = sc.conversation.criteria.map((c) => ({ ...c, id: before.conversation!.criteria.find((b) => b.label === c.label)?.id ?? c.id }));
    }
  }
  const elementsBefore = new Map(original.screens.flatMap((s) => s.elements).map((e) => [e.id, e]));
  for (const s of out.screens) {
    for (const e of s.elements) {
      const before = elementsBefore.get(e.id);
      if (before?.kind === "table" && e.kind === "table") {
        e.tableSource ??= before.tableSource;
        e.rowKey ??= before.rowKey;
      }
    }
  }
  return SimulationSchema.parse(out);
}

/** What Claude suggested from the library, for the author's notes. */
export function suggestionNotes(sim: Simulation, lib: LibraryContext): string {
  const notes: string[] = [];
  const tags = sim.tagIds.map((id) => lib.tags.find((t) => t.id === id)?.name).filter(Boolean);
  if (tags.length) notes.push(`Suggested tags: ${tags.join(", ")}.`);
  const scheme = lib.schemes.find((s) => s.id === sim.grading.schemeId);
  if (scheme) notes.push(`Suggested grading scheme: ${scheme.name}.`);
  const talks = sim.scenarios.filter((s) => s.conversation?.enabled);
  if (talks.length) {
    notes.push(
      `Added an AI customer to ${talks.map((s) => `"${s.title}"`).join(", ")}. Choose which persona plays them (Settings → Personas), then check the situation and criteria in each scenario.`,
    );
  }
  return notes.join(" ");
}

/** Turn a saved simulation back into a draft so Claude can revise it. */
export function simulationToDraft(sim: Simulation, images: StoredImage[]): Draft {
  const indexOf = (assetId?: string | null) => {
    const i = images.findIndex((im) => im.assetId === assetId);
    return i === -1 ? null : i;
  };
  const cond = (c: { var: string; op: Draft["screens"][0]["elements"][0]["visibleIf"][0]["op"]; value?: string }) => ({
    var: c.var,
    op: c.op,
    value: c.value ?? null,
  });
  const draftStep = (st: Simulation["scenarios"][0]["steps"][0]) => ({
    id: st.id,
    instruction: st.instruction,
    hint: st.hint ?? "",
    elementId: st.elementId,
    alsoElementIds: st.alsoElementIds ?? [],
    expect: st.expect,
    value: st.value ?? null,
  });
  return {
    title: sim.title,
    description: sim.description,
    startScreenId: sim.startScreenId,
    variables: sim.variables.map((v) => ({ name: v.name, initial: v.initial, description: v.description ?? "" })),
    screens: sim.screens.map((s) => ({
      id: s.id,
      name: s.name,
      description: s.description ?? "",
      imageIndex: indexOf(s.imageAssetId),
      elements: s.elements.map((e) => ({
        id: e.id,
        label: e.label,
        kind: e.kind,
        rect: e.rect,
        placeholder: e.placeholder ?? null,
        options: e.options ?? [],
        bindVar: e.bindVar ?? null,
        visibleIf: (e.visibleIf ?? []).map(cond),
        rules: e.rules.map((r) => ({
          if: r.if.map(cond),
          then: r.then.map((a) => ({
            type: a.type,
            screenId: a.screenId ?? null,
            var: a.var ?? null,
            value: a.value ?? null,
            tone: a.tone ?? null,
          })),
        })),
      })),
    })),
    scenarios: sim.scenarios.map((sc) => ({
      id: sc.id,
      title: sc.title,
      goal: sc.goal,
      briefing: sc.briefing ?? "",
      startScreenId: sc.startScreenId ?? null,
      initialVars: sc.initialVars,
      steps: sc.steps.map(draftStep),
      alternatePaths: sc.alternatePaths.map((p) => ({ id: p.id, name: p.name, steps: p.steps.map(draftStep) })),
      successCriteria: sc.successCriteria.map(cond),
      conversation: sc.conversation?.enabled
        ? {
            channel: sc.conversation.channel,
            brief: sc.conversation.brief,
            opening: sc.conversation.opening,
            criteria: sc.conversation.criteria.map((c) => ({ label: c.label, weight: c.weight })),
          }
        : null,
    })),
    tagIds: sim.tagIds,
    gradingSchemeId: sim.grading.schemeId,
    authorNotes: "",
  };
}

export interface GenerateResult {
  simulation: Simulation;
  notes: string;
  issues: string[];
}

export async function generateSimulation(
  input: GenerateInput,
  images: StoredImage[],
  id: string,
  onProgress: Progress,
  lib: LibraryContext = { tags: [], schemes: [] },
): Promise<GenerateResult> {
  const content = await buildContent(input, images);
  if (content.length === 0 && !input.notes.trim()) throw new Error("Add at least one file or a description.");
  content.push({
    type: "text",
    text:
      `Build a training simulation from the material above.` +
      (input.title ? `\nWorking title: ${input.title}` : "") +
      (input.notes.trim() ? `\nAuthor's notes and training goals:\n${input.notes.trim()}` : "") +
      `\n\n${libraryText(lib)}`,
  });
  const draft = await callClaude(content, onProgress);
  if (input.title) draft.title = input.title;
  const simulation = draftToSimulation(draft, id, images, lib);
  return { simulation, notes: [draft.authorNotes, suggestionNotes(simulation, lib)].filter(Boolean).join("\n\n"), issues: lintSimulation(simulation) };
}

export async function refineSimulation(
  sim: Simulation,
  instruction: string,
  images: StoredImage[],
  onProgress: Progress,
  lib: LibraryContext = { tags: [], schemes: [] },
): Promise<GenerateResult> {
  const content: Content[] = [];
  images.forEach((img, i) => {
    content.push({ type: "text", text: `Image ${i}: ${img.label} (${img.width}x${img.height}px)` });
    content.push({ type: "image", source: { type: "base64", media_type: img.mediaType as "image/png", data: img.data } });
  });
  content.push({
    type: "text",
    text:
      `Here is the current simulation:\n<simulation>\n${JSON.stringify(simulationToDraft(sim, images))}\n</simulation>\n\n` +
      `Revise it according to the author's request below and return the COMPLETE updated simulation. ` +
      `Keep existing ids, layout and content unless the request requires changing them.\n\n${libraryText(lib)}\n\n<request>\n${instruction}\n</request>`,
  });
  const draft = await callClaude(content, onProgress);
  const updated = keepUnrevised(sim, draftToSimulation(draft, sim.id, images, lib));
  return { simulation: updated, notes: draft.authorNotes, issues: lintSimulation(updated) };
}

// ------------------------------------------------------------ box alignment pass
// Claude places boxes on screenshots only approximately on the first pass. This
// second pass shows it the clean screenshot plus a copy with a percentage grid and
// the current boxes drawn and numbered, and asks for corrected boxes. Seeing its
// own boxes against a grid makes the correction far more accurate than guessing
// coordinates blind. The browser draws the marked-up image (see src/lib/align.ts).

const AlignResult = z.object({
  elements: z.array(
    z.object({ n: z.number().int(), found: z.boolean(), x: z.number(), y: z.number(), w: z.number(), h: z.number() }),
  ),
});

const AlignImage = z.object({
  mediaType: z.enum(["image/png", "image/jpeg", "image/webp", "image/gif"]),
  data: z.string().max(15_000_000),
});

export const AlignInputSchema = z.object({
  screenName: z.string().max(300),
  elements: z
    .array(z.object({ n: z.number().int().positive(), kind: z.enum(ElementKinds), label: z.string().max(500) }))
    .min(1)
    .max(150),
  clean: AlignImage,
  annotated: AlignImage,
});
export type AlignInput = z.infer<typeof AlignInputSchema>;

const ALIGN_PROMPT = `You correct the positions of interactive regions on a software screenshot used in a training simulation.

You get two images of the same screen:
- Image 1: the clean screenshot.
- Image 2: the same screenshot with a magenta percentage grid (lines every 10%, labelled along the top and left edges, thin lines every 5%) and the CURRENT boxes drawn as numbered coloured rectangles. The current boxes are rough guesses and may be offset, too large, too small, or on the wrong control.

For every numbered element, find the control it describes in Image 1 and return a box that tightly covers it, as percentages of the image's width (x, w) and height (y, h), where x,y is the top-left corner. Use the grid in Image 2 to measure each edge precisely; estimate to the nearest 0.5%.
- input / textarea / select: cover the entry area itself, not its label.
- button / link: cover the button or link text.
- hotspot: cover the whole clickable region it describes (e.g. an entire table row, card, tab or icon).
- checkbox: cover the box and its label text.
- text: cover the area where that text or value is displayed.
If two elements describe different controls, their boxes should not overlap. If the control is not visible in the screenshot at all, set found to false and return the current box unchanged. Return one entry per number.`;

export async function alignElements(input: AlignInput) {
  const list = input.elements.map((e) => `${e.n}. [${e.kind}] ${e.label}`).join("\n");
  const message = await getClient().beta.messages.parse({
    model: MODEL,
    max_tokens: 16000,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    output_config: { effort: "high", format: betaZodOutputFormat(AlignResult) },
    system: ALIGN_PROMPT,
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: "Image 1 (clean):" },
          { type: "image", source: { type: "base64", media_type: input.clean.mediaType, data: input.clean.data } },
          { type: "text", text: "Image 2 (grid and current boxes):" },
          { type: "image", source: { type: "base64", media_type: input.annotated.mediaType, data: input.annotated.data } },
          { type: "text", text: `Screen: ${input.screenName}\nElements:\n${list}` },
        ],
      },
    ],
  });
  if (message.stop_reason === "refusal") throw new Error("The model declined to align this screen.");
  if (message.stop_reason === "max_tokens") throw new Error("Too many elements to align in one pass.");
  if (!message.parsed_output) throw new Error("The model's reply could not be read.");
  return message.parsed_output.elements;
}

// ------------------------------------------------------------------ persona drafting

const DraftPersonas = z.object({
  personas: z.array(
    z.object({
      name: z.string(),
      summary: z.string(),
      backstory: z.string(),
      values: z.array(z.object({ key: z.string(), value: z.string() })),
      extra: z.array(z.object({ label: z.string(), value: z.string() })),
      tables: z.array(z.object({ key: z.string(), rows: z.array(z.object({ cells: z.array(z.object({ key: z.string(), value: z.string() })) })) })),
    }),
  ),
});

const PERSONA_PROMPT = `You write realistic but entirely FICTIONAL customer personas for training simulations (support desks, banks, telecoms, retail, and so on). Trainees will look these people up in a simulated system and handle their requests, so every detail must be internally consistent.

Rules:
- Invent everything. Never use real people, real companies' customer data, or real account numbers. Use example.com / example.org email addresses, phone numbers in the 555-01xx range, and clearly made-up account, card and reference numbers (cards: only the last 4 digits).
- Vary names, ages, backgrounds, temperaments and circumstances, unless the request says otherwise.
- summary: one line a trainer can scan (who they are, what they want, their mood).
- backstory: 80-150 words: their situation, what happened, what they want now, how they tend to communicate, and any detail a trainee could discover in their records.
- values: give a value for EVERY template field, using the field's key. For "choice" fields use one of the listed options exactly. Money as a plain number (e.g. 212.40). Dates as YYYY-MM-DD, close to today's date given below.
- tables: for each template table, 3-8 rows, most recent first, using the column keys. Make the records back up the backstory (e.g. the disputed charge appears in the bills).
- extra: only details that matter to this persona and have no template field (may be empty).`;

export interface PersonaDraftInput {
  description: string;
  count: number;
  template: PersonaTemplate | null;
}

export async function draftPersonas(input: PersonaDraftInput, makeId: (prefix: string) => string): Promise<Persona[]> {
  const t = input.template;
  const templateText = t
    ? `Template "${t.name}"${t.description ? ` (${t.description})` : ""}.\nFields:\n` +
      t.fields.map((f) => `- ${f.key} (${f.label}; ${f.type}${f.options?.length ? `: one of ${f.options.join(" | ")}` : ""})`).join("\n") +
      (t.tables.length
        ? `\nTables:\n` + t.tables.map((x) => `- ${x.key} (${x.label}): columns ${x.columns.map((c) => `${c.key} (${c.label}; ${c.type})`).join(", ")}`).join("\n")
        : "")
    : "No template: put all account details in extra, and leave values and tables empty.";
  const stream = getClient().beta.messages.stream({
    model: MODEL,
    max_tokens: 32000,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    output_config: { effort: "medium", format: betaZodOutputFormat(DraftPersonas) },
    system: PERSONA_PROMPT,
    messages: [
      {
        role: "user",
        content: `Today's date: ${new Date().toISOString().slice(0, 10)}\n${templateText}\n\nWrite ${input.count} persona${input.count === 1 ? "" : "s"}:\n<request>\n${input.description}\n</request>`,
      },
    ],
  });
  const message = await stream.finalMessage();
  if (message.stop_reason === "refusal") throw new Error("The model declined this request.");
  if (message.stop_reason === "max_tokens") throw new Error("Too many personas to write at once. Ask for fewer.");
  if (!message.parsed_output) throw new Error("The model's reply could not be read.");

  return personasFromDraft(message.parsed_output, t, makeId).slice(0, input.count);
}

/** Turn Claude's draft into valid personas: keep only the template's fields and tables; extra fields get keys. */
export function personasFromDraft(draft: z.infer<typeof DraftPersonas>, t: PersonaTemplate | null, makeId: (prefix: string) => string): Persona[] {
  const fieldKeys = new Set(t?.fields.map((f) => f.key) ?? []);
  return draft.personas.map((d) =>
    PersonaSchema.parse({
      id: makeId("persona"),
      name: d.name.slice(0, 100) || "Unnamed",
      summary: d.summary.slice(0, 300),
      backstory: d.backstory.slice(0, 5000),
      templateId: t?.id ?? null,
      values: Object.fromEntries(d.values.filter((v) => fieldKeys.has(v.key)).map((v) => [v.key, v.value.slice(0, 2000)])),
      extra: d.extra
        .filter((x) => x.label.trim())
        .slice(0, 40)
        .map((x) => ({ key: keyFromLabel(x.label), label: x.label.slice(0, 60), value: x.value.slice(0, 2000) }))
        .filter((x, i, all) => !fieldKeys.has(x.key) && all.findIndex((y) => y.key === x.key) === i),
      tables: Object.fromEntries(
        (t?.tables ?? []).map((tbl) => {
          const rows = d.tables.find((x) => x.key === tbl.key)?.rows ?? [];
          return [tbl.key, rows.slice(0, 50).map((r) => Object.fromEntries(tbl.columns.map((c) => [c.key, (r.cells.find((x) => x.key === c.key)?.value ?? "").slice(0, 500)])))];
        }),
      ),
    }),
  );
}
