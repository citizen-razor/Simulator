# Simulator

Build interactive training simulations of software and workflows from screenshots,
screen recordings, source code and procedure documents. Trainees then practise in
three modes, and can switch between them at any moment:

| Mode | What the trainee experiences | Scored? |
|---|---|---|
| **Open world** | A free sandbox. Everything is clickable and the system reacts realistically. | No |
| **Guided** | Step-by-step coaching: the next control is highlighted, hints are shown, and wrong moves are blocked. | Yes, marked *assisted* |
| **Scenario** | A goal and a briefing, with no hints unless requested. Wrong moves still happen, as they would in real life, and count as errors. | Yes |

Switching modes keeps the trainee exactly where they are. For example, someone stuck in
a scenario can flip to Guided for a step and then flip back. The run is then recorded as
*assisted*.

---

## Quick start

You need [Node.js](https://nodejs.org) 20 or newer.

```bash
npm install
cp .env.example .env          # then paste your Anthropic API key into .env
npm run dev
```

Open **http://127.0.0.1:5173**. A sample *Helpdesk Ticketing* simulation is included, so
you can try every mode right away. Manual authoring works without an API key; only
"Generate with AI" and "Ask AI to change it" need one.

| Command | What it does |
|---|---|
| `npm run dev` | Runs the app with live reload (web on :5173, API on :8787) |
| `npm start` | Builds and runs the production version at http://127.0.0.1:8787 |
| `npm test` | Runs the automated tests |
| `npm run typecheck` | Checks the TypeScript for errors |

Everything you create is stored in the `data/` folder. Back it up by copying it.

---

## Creating a simulation

1. **Create → drop in your material.**
   - *Screenshots / mockups*: each one can become a screen with clickable regions on top.
   - *Screen recordings*: the browser samples the video and keeps a frame each time the
     screen changes noticeably (up to 16 frames). Claude uses the sequence to work out the workflow.
   - *Source code / HTML*: used to infer real fields, validation rules and navigation.
   - *Procedures (PDF, Word, text)*: turned into scenarios. Without images, they become wireframe screens.
2. **Describe what trainees should learn.** Tasks, rules and common mistakes give the
   best scenarios.
3. **Generate with AI.** This usually takes 1–3 minutes. Claude drafts the screens, controls,
   state, rules and 1–3 scenarios, plus notes on what to double-check.
4. **Review in the editor.** AI is good at structure but only approximate at placing boxes
   on screenshots, so drag them into place.

You can also click **Start blank** or **Build manually from N images** to author by hand.

### The editor

- **Draw** controls by dragging on the screen. Pick the kind first: button, link, hotspot
  (an invisible area over part of a screenshot), input, textarea, select, checkbox or text.
- **Rules** say what happens when a control is used: *if* conditions → *then* actions
  (go to a screen, set or toggle a variable, show a message). The first rule whose
  conditions pass runs, so model validation as an early rule, e.g. "if email is empty, show
  an error", followed by a catch-all rule with no conditions.
- **Variables** are the system's memory. Fields store their values in them, rules change
  them, and labels can display them: `Status: {{ticketStatus}}`.
- **Visible only when…** shows or hides a control based on state, e.g. an error banner.
- **Scenarios** list the steps a trainee must do in order. Use **● Record steps by doing**
  to perform the task yourself; each click or entry becomes a step.
- **✦ Ask AI to change it**: e.g. "add a scenario where the customer has no order number".
  You review the result before saving, and **Undo** (Ctrl+Z) reverts it.
- The **⚠ issues** button lists broken references, such as a step pointing at a deleted control.
- Save with the button or Ctrl+S. If you try to leave with unsaved changes, you'll be asked first.

### Scoring

Scenario attempts start at 100: **−10 per error**, **−5 per hint**. An incomplete run scores
by the share of steps completed. Before a scored run, the Player asks for the trainee's name
(remembered on that device; click the name in the top bar to change it). Results (trainee,
score, mistakes, time, assisted or not) are saved and shown on the **Results** page, where
you can filter by trainee.

---

## How it works

```
 Browser (React)                              Local server (Node, 127.0.0.1 only)
┌──────────────────────────────┐   JSON      ┌────────────────────────────────────┐
│ Create   media.ts: resize    │ ──────────► │ /api/generate                      │
│          images, pull video  │             │   generate.ts ──► Claude API       │
│          key frames, read    │ ◄── stream ─│   (structured output = valid JSON) │
│          text                │  progress   │                                    │
│ Editor   edits Simulation    │ ──────────► │ /api/simulations  storage.ts       │
│          JSON                │             │   data/simulations/*.json          │
│ Player   engine.ts runs the  │             │   data/assets/* (images)           │
│          simulation locally  │ ──────────► │   data/attempts.json               │
└──────────────────────────────┘             └────────────────────────────────────┘
```

**One data format drives everything.** A simulation is a JSON document defined in
[`shared/schema.ts`](shared/schema.ts): screens → elements → rules, plus variables and
scenarios → steps. The editor edits it, the AI produces it, and the player runs it. To
understand the app, start with that file.

**The engine** ([`shared/engine.ts`](shared/engine.ts)) is a set of small, pure functions
with no UI. `interact(simulation, state, mode, event)` takes one click or field entry and
returns the new state plus feedback. Modes only change how an interaction is *judged*
(blocked, counted as an error, or free). They don't own separate state, which is why
switching modes is seamless. The engine is fully covered by tests in `tests/`.

**The AI step** ([`server/generate.ts`](server/generate.ts)) sends your material to Claude
with a description of the format. It uses *structured outputs*, which guarantees the reply
matches the schema, so the app never has to repair malformed JSON. The draft is then
cleaned up (safe ids, boxes clamped inside the screen, image numbers mapped to stored
files) and validated again before saving. If Claude's safety filter declines a request, the
API automatically retries on a fallback model.

### Project layout

```
shared/schema.ts      data model (start here)
shared/engine.ts      simulation engine: modes, rules, steps, scoring, lint checks
server/index.ts       API routes and security checks
server/generate.ts    Claude integration (generate + refine)
server/storage.ts     file storage under data/
src/pages/            Library, Create, Editor, Player, Results
src/components/       ScreenView (renders screens for play and edit), Inspector panels
src/lib/media.ts      in-browser image resizing and video key-frame extraction
samples/              the built-in Helpdesk sample
tests/                engine and AI-conversion tests
```

---

## Security

The app is designed to run on your own computer.

- **Your API key stays on the server.** It is read from `.env` (which git ignores) and is
  never sent to the browser.
- **Local only.** The server listens on 127.0.0.1, so other machines can't connect.
- **Protection from other websites.** A web page you visit could try to send requests to a
  local server. The server rejects any request whose `Host` isn't localhost (this blocks
  "DNS rebinding"). It also requires a custom `X-Simulator` header on every change, which
  browsers won't let another site add. Other sites therefore can't modify data or spend
  your API credits.
- **Validated input.** Every saved simulation, attempt and upload is checked against a
  schema. File and asset ids must match strict patterns before they touch the disk, which
  prevents path traversal. Only image types are accepted as assets.
- **No uploaded code runs.** Uploaded HTML or code is treated as text for the AI to read.
  It is never rendered or executed. In production a strict Content-Security-Policy is
  applied.

Hosting this for other people would need more: user accounts and login, per-user data,
rate limits on AI calls, HTTPS, and a real database.

## Costs

Generation uses `claude-opus-5-5` by default (set `SIM_MODEL` in `.env` to change it). Cost
depends on the amount of input (each screenshot is roughly 1,500 tokens) and mostly on the
size of the simulation written back. Expect well under a few dollars per generation; check
actual usage in the Claude Console. Playing and editing simulations makes no AI calls.

## Known limitations and next steps

- Element boxes placed by AI on screenshots are approximate and usually need a quick drag.
- Video narration (audio) isn't transcribed; only frames are used.
- Scenario steps are strictly ordered. Field entries can be done in any order, but clicks can't.
- Single user, local files. Moving to a database and accounts is the main step before hosting.
- Ideas: branching scenarios (multiple valid paths), timed challenges, trainer dashboards per
  learner, exporting simulations as a standalone file for sharing.
