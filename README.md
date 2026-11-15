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

Open **http://127.0.0.1:5173**. The first time, you create your organisation and your own
account (you become its first **Admin-Builder**), then add everyone else on the **People**
page. A sample *Helpdesk Ticketing* simulation is included, so you can try every mode right
away. Manual authoring works without an API key; only
"Generate with AI" and "Ask AI to change it" need one.

| Command | What it does |
|---|---|
| `npm run dev` | Runs the app with live reload (web on :5173, API on :8787) |
| `npm start` | Builds and runs the production version at http://127.0.0.1:8787 |
| `npm test` | Runs the automated tests |
| `npm run typecheck` | Checks the TypeScript for errors |

The same typecheck, tests and build run automatically on GitHub for every push and pull
request (`.github/workflows/ci.yml`).

Everything you create is stored in the `data/` folder. Back it up by copying it, or export
individual simulations (below).

### Sharing and backing up simulations

- **Export:** the ⤓ button on a simulation card (or **⤓ Export** in the editor) downloads
  one `.simulation.json` file containing the simulation and all its screenshots.
- **Import:** **⤒ Import** on the Library page. The import is added as a new simulation and
  never overwrites an existing one. Plain simulation JSON (without images) also works.
- **Tags, grading schemes and personas** travel with the file and are matched by name on import, since
  ids differ between installations. Anything this installation doesn't have is **added**
  if an Admin-Builder imports the file, and otherwise left out with a
  warning.
- Imported files are checked before anything is saved. The simulation is validated, and
  each image's actual content must match its type, so a disguised file is rejected. Any
  problems are listed after the import.

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
4. **Box fine-tuning (automatic).** After drafting, a second AI pass checks each screenshot
   screen. It draws a percentage grid and the current numbered boxes onto a copy of the
   image, and Claude corrects each box against the grid. You can turn this off with the
   checkbox under the upload area.
5. **Review in the editor.** Check the AI's notes, and drag any boxes that are still off.

You can also click **Start blank** or **Build manually from N images** to author by hand.

### The editor

- **Draw** controls by dragging on the screen. Pick the kind first: button, link, hotspot
  (an invisible area over part of a screenshot), input, textarea, select, checkbox or text.
- **Rules** say what happens when a control is used: *if* conditions → *then* actions
  (go to a screen, set or toggle a variable, show a message). The first rule whose
  conditions pass runs, so model validation as an early rule, e.g. "if email is empty, show
  an error", followed by a catch-all rule with no conditions.
- **Random values** (in 𝑥 Variables) give chosen variables fresh, realistic values every
  run, so trainees learn the process rather than memorising answers. The options are:
  pick from a list, a number in a range, a pattern such as `TCK-####`, a person's name, or
  a date near today. Lists can be *linked* so related values stay together (a name and its
  email). Use the values anywhere with `{{name}}`: labels, instructions, hints, goals, and
  even expected answers (e.g. "description contains `{{caller}}`" checks against *this
  run's* caller). Scenarios can switch random values off. Results show the values each
  attempt used. The sample's ticket numbers and people change every run.
- **Variables** are the system's memory. Fields store their values in them, rules change
  them, and labels can display them: `Status: {{ticketStatus}}`.
- **Visible only when…** shows or hides a control based on state, e.g. an error banner.
- **Scenarios** list the steps a trainee must do in order. Use **● Record steps by doing**
  to perform the task yourself; each click or entry becomes a step.
- **More than one right way:** if a task can be done differently (say, a quick action
  instead of the full form), add an **alternative path**. It starts as a copy of the main
  path, and you change the steps that differ. Completing *any* path counts. For a single step
  that two controls can do (a toolbar button and a menu item), use **+ also accept…** on
  that step instead. The sample's "Resolve the printer ticket" scenario has two paths.
- **✦ Ask AI to change it**: e.g. "add a scenario where the customer has no order number".
  You review the result before saving, and **Undo** (Ctrl+Z) reverts it.
- **✦ Align boxes to screenshot** (above the canvas) re-runs the box fine-tuning on the
  current screen, e.g. after you've added controls. It's undoable like any other edit.
- **Faster editing:** ⧉ Duplicate an element (Ctrl+D) or a whole screen; copy and paste
  elements, including onto another screen (Ctrl+C / Ctrl+V); nudge with the arrow keys
  (Shift for bigger steps); reorder screens with the ↑ ↓ arrows on the selected screen.
  Boxes snap to each other's edges and centres while you drag (hold Alt to place freely).
- **Renaming** an element, screen or variable id updates every reference to it (steps,
  navigation, conditions, `{{templates}}`), so nothing breaks.
- The **⚠ issues** button lists broken references, such as a step pointing at a deleted control.
- Save with the button or Ctrl+S. If you try to leave with unsaved changes, you'll be asked first.

### Libraries: topics, tags and grading

The **Libraries** page holds shared lists that every simulation can use. Editing them needs
the Admin-Builder role (see "Accounts, roles and teams" below); Builders can view them to pick
tags, personas and schemes. Learners and Leaders don't see the page.

- **Topics & tags:** topics (e.g. "Customer service") contain tags (e.g. "Refunds"). Tag a
  simulation in the editor's ⚙ Settings. You can then filter the Library page by topic or
  tag, and the Progress page shows mastery per topic.
- **Personas:** rich, fictional customers with backstories and account information.
  - An admin defines **templates** (e.g. "Telecom customer"): fields such as account
    number, plan (a choice), balance (money) and customer-since (date), plus **record
    tables** such as bills or transactions.
  - Each **persona** fills in a template: a name, one-line summary, backstory, field values,
    table rows and any extra details.
  - **✦ Draft personas with AI** writes several from a description to fit a template; you
    keep or discard each one.
  - **Assign personas** to roles (usually `customer`) for the whole simulation in ⚙ Settings,
    or in a scenario's **Personas in this scenario** section. A scenario can keep the
    simulation's persona, use a different one, have none, or add roles only it has.
  - **A persona is one record, like a real customer.** Editing it changes it everywhere it's
    used: every scenario, open-world and guided run. The Admin-Builder edits personas in
    Libraries, or with **✎ Edit persona** right inside the simulation editor, which lists
    every simulation and scenario a change will affect. Others can view personas and assign
    them to simulations and scenarios.
  - Their details then appear on screens as
    `{{customer.name}}`, `{{customer.balance}}` or `{{customer.bills.1.amount}}`. A
    **table** element shows a whole record table, e.g. `customer.bills`.
  - Use invented details only; the editor reminds you, because simulations get exported
    and shared.
- **Grading schemes:** how attempts are scored.
  - **Points:** penalty per error and per hint, an optional time limit with an overtime
    penalty, a pass mark and a mastery mark.
  - **Rubric:** weighted criteria, each checked automatically or marked by a trainer
    afterwards (only counted where a builder turns trainer marking on). Automatic checks are: completed the task, at most N errors, no hints,
    within the time limit, reached a screen, or the system ends in a given state.
  - **Rubric weight:** sets how much of the final score comes from the rubric.
  - **Open-world objectives:** an optional checklist for trainees exploring freely; it's
    never penalized.

  The built-in **Standard** scheme matches the original scoring. A simulation picks its
  scheme in ⚙ Settings, and a scenario can override it. Settings is also where you point
  the scheme's "reached a screen" and "system state" checks at this simulation's own
  screens and variables, since each simulation has different ones.

**Storage** (Libraries → Storage, Admin-Builders only) shows how much space screenshots use, and
deletes the ones no simulation uses any more. Images less than a day old are always kept,
in case they belong to an editor that hasn't been saved yet.

### Accounts, roles and teams

Everyone signs in with their email and password. Roles stack, so one person can hold several:

| Role | Can |
|---|---|
| **Admin-Builder** | Everything: the libraries (tags, grading schemes and rubrics, personas and templates), assignments for anyone, trainer marking, storage, and managing people |
| **Builder** | Build and edit simulations and scenarios (create, AI generation, import/export), and see course **Performance** (totals and averages, no names). Can view, but not edit, the libraries |
| **Leader** | Everything a learner can, plus: see every learner in their reporting tree (direct reports and further down), assign them training, and see a team leaderboard |
| **Learner** | Everyone. Take simulations, receive assignments, see their own results and progress, and see the leaderboard |

**Hierarchy:** each person can have a manager. Anyone with active people reporting to them
is a Leader automatically; the role can also be given by hand. Leaders see their whole tree,
not just direct reports. Loops (someone ending up as their own manager) are refused.

**People page** (Admin-Builders): add people (each gets a one-time password, shown once),
set roles and managers, deactivate people (they're signed out at once and can't sign in;
their history is kept), reset passwords, and **import a CSV** with the columns
`email, name, manager_email, roles`. Everyone can change their own password under their name
in the top bar.

**SCIM (sync from Okta, Microsoft Entra ID, …):** on the People page, turn on SCIM to get a
bearer token, then point your identity provider's SCIM 2.0 app at `https://<your
host>/scim/v2`. It creates, updates and deactivates people, and sends each person's manager
(the enterprise extension), which builds the hierarchy. Deleting someone in the identity
provider deactivates them here. Roles are managed in the app; people synced by SCIM start as
learners. SCIM needs the app to be hosted where the identity provider can reach it; it can
be tried locally with `curl`.

**Organisations:** every person, simulation and result belongs to an organisation, so one
installation can later serve several customers separately. For now there is one: the one
you create on first run. (The existing `data/` folder is that organisation's storage.)

### Leaderboard

Everyone in the organisation appears by name. The main board ranks people by **scenarios
mastered**, then by **average solo score**; people tied on both share a rank. Tabs:
**Organisation**, **My team** (leaders), **By topic** (scenarios tagged with that topic),
and **By scenario** (best solo score, then fastest time). Your own row is highlighted, with
"You're #N of M" at the top.

### Scoring

With the Standard scheme, scenario attempts start at 100: **−10 per error**, **−5 per hint**.
An incomplete run scores by the share of steps completed. Other schemes change these
numbers, add a time limit, and/or blend in a rubric:
`final = points × (100 − rubric weight)% + rubric % met × rubric weight%`. Trainees can open
"How you're graded" in the Player to see the rules for their run.

**Results never wait on another person unless a builder chooses that.** A rubric can include
trainer-marked criteria, but they only count in simulations where the builder ticks
**Include trainer-marked criteria** (editor → Settings → Grading); it's off by default.
When it's off, those criteria are skipped and every score and pass/fail is final as soon as
the run ends. Older results that were still waiting are settled the same way. When it's on, the score is provisional
and marked "⏳ To mark" on the Results page until an Admin-Builder marks them. Every Guided
and Scenario run is saved under the signed-in person's account. Results (score, mistakes,
time, assisted or not, path taken) appear on the **Results** page for Admin-Builders (everyone)
and leaders (their team), and on each person's own **My progress**.

### Assignments and "My training"

On **Assignments**, Admin-Builders assign a scenario to anyone, and leaders to anyone in their
reporting tree ("Add my whole team" picks everyone at once). Each assignment has a requirement (**complete** it, guided help allowed; **pass**
it in Scenario mode; or **master** it without help), an optional due date, and an optional
note.

Learners open **My training** to see their assignments,
most urgent first, with **Start** and **Practise with guidance** buttons. The Player shows
what's required, and the end-of-run summary says whether the assignment is now complete.

Status is worked out from results: **done**, **awaiting marking**, **overdue**, **due
soon** (within 3 days), or **to do**. Credit follows the work: any qualifying attempt counts,
including one a trainee made on their own before the scenario was assigned. Those are
marked "already done before it was assigned". Assignments also appear on each person's
progress page.

### Course performance (Builders)

**Performance** (Builders and Admin-Builders) shows how each course is doing across all
learners, so you can see what to improve. It shows totals and averages only and never names anyone.
- **All courses:** attempts, learners, completion, pass and mastery rates, and average score
  for every simulation, busiest first.
- **One course** (also from **Performance** on a Library card or in the editor):
  - the headline figures, then for each scenario:
  - **where points are gained and lost**, step by step in order: the average points each
    step earns, the average lost there to errors and hints, the share of attempts that lost
    points there, and over-time penalties;
  - a **score spread** chart;
  - **rubric criteria at the point level**: what each criterion is worth (points of the final
    100), how often it was met, the average points earned, and how many trainer-marked
    ones are still awaiting marking;
  - **where unfinished runs stopped**, and which **paths** were taken.
  - Untick **Include Guided runs** to see Scenario mode only.

Attempts saved before this was added didn't record which step each error or hint was on, so they're
left out of the step-by-step view and counted in everything else.

### AI-played customers

A scenario can have a customer the learner talks to while they work the system, played by
Claude. Builders set it up in the scenario's **Customer conversation** section:
- **How they're in touch:** chat, phone call or in person. Learners type for now. The channel
  sets how the customer talks (chat-style typing, spoken words, or face to face with brief
  actions such as "[slides a card across the counter]") and how the panel looks. Voice can be
  added later.
- **Who:** the persona playing that role in the scenario. The customer knows their own details
  (the same record the screens show) and shares them only when asked.
- **The customer's situation:** why they're in touch, how they feel, what they want, and
  what calms them down. An optional opening line can set their first words.
- **What good looks like:** criteria such as "Verified identity before sharing account details",
  each weighted ×1–×5. When the run ends, Claude judges the conversation against each one and
  gives the learner a one-line reason. These criteria join the rubric (or, if the grading scheme
  has none, count for the share of the score you set). A scenario with no steps is scored
  entirely on the conversation.

In Guided and Scenario mode the conversation sits beside the screens. In Guided mode,
**💡 What should I say?** suggests a next line and why it helps (the coach knows the goal and
what good looks like, but not the customer's private details). When the steps are done,
the learner wraps up with the customer and ends the conversation (End chat / Hang up / Finish).
The transcript is saved with the attempt and shown on My progress and Results. If the AI can't
judge a conversation, those criteria are left out rather than leaving the result waiting.

### Where your points came from

Every scored run comes with a ledger of the score in step order, so learners see how they're
graded and where to improve. It appears on the end-of-run summary, on **My progress**
(click an attempt), and on **Results** for Admin-Builders and leaders. All figures are points out of 100:
- each completed step earns its share of the steps' points (with a 60/40 points/rubric
  scheme, 7 steps earn 60 ÷ 7 ≈ 8.6 each); steps not reached show as missed;
- each error or hint shows on the step where it happened, with what it cost;
- over-time penalties are listed separately, and so is the rule that the steps' part can't go below 0;
- each rubric criterion shows what it earned or missed; trainer-marked ones awaiting marking
  show what they're worth.

The lines add up to the score.

### Trainee progress

**My progress** shows your own record. Leaders get **My team** (everyone in their reporting
tree, including people who haven't started) and Admin-Builders get **Progress** (everyone).
Click a person to see:
- each scenario's status:
  - **✓ Mastered:** completed in Scenario mode without guided help, at or above the grading
  scheme's mastery mark (80 with Standard)
  - **Passed:** completed on their own, but below 80
  - **With help:** completed only with guided help so far
  - **Not yet:** attempted but not completed
- a small chart of their scores over time, with the change from first to latest solo run
- **where they struggle:** the steps where they most often made errors or asked for hints
- their recent attempts

Each grading scheme sets its own mastery mark. Attempts saved before grading schemes existed
use `MASTERY_SCORE` (80) in `shared/progress.ts`. If simulations are tagged, a **By topic**
section shows how many of each topic's scenarios the trainee has mastered.

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
with no UI. A scenario's paths are all tracked at once, so the trainee's actions are
correct if they follow any of them. `interact(simulation, state, mode, event)` takes one click or field entry and
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
server/generate.ts    Claude integration (generate, refine, align boxes)
server/storage.ts     file storage under data/ (and image content checks)
server/transfer.ts    export / import of a simulation with its images, tags and grading
server/cleanup.ts     finding unused images
src/pages/            Library, Create, Editor, Player, Results
src/components/       ScreenView (renders screens for play and edit), Inspector panels
src/lib/media.ts      in-browser image resizing and video key-frame extraction
src/lib/align.ts      draws the grid + numbered boxes for box fine-tuning
shared/layout.ts      box clamping, fine-tune merging, and snapping
shared/refactor.ts    safe renames, duplicating, reordering
shared/progress.ts    per-trainee progress: mastery, trends, trouble spots, topics
shared/random.ts      random value generators (seeded, reproducible)
shared/assignments.ts assignment requirements and status
shared/personas.ts    persona templates, personas, and the {{role.field}} variables they provide
shared/library.ts     topic/tag and grading-scheme data model
shared/grading.ts     applies a grading scheme: points, rubric, time limit, objectives
server/auth.ts        accounts, sign-in, sessions, organisations
server/people.ts      people management and CSV import routes
server/scim.ts        SCIM 2.0 provisioning (users + managers)
shared/people.ts      roles, hierarchy, permissions, CSV parsing
shared/leaderboard.ts leaderboard ranking
shared/analytics.ts   course performance for builders (aggregate only)
shared/breakdown.ts   an attempt's score as a step-by-step ledger of points gained and lost
shared/conversation.ts AI-played customers: prompts, persona details, conversation criteria
server/conversation.ts customer replies and conversation judging (Claude calls)
samples/              the built-in Helpdesk sample
tests/                engine and AI-conversion tests
```

---

## Security

The app currently runs on your own computer; hosting it for others is the next big step.

- **Your API key stays on the server.** It is read from `.env` (which git ignores) and is
  never sent to the browser.
- **Local only.** The server listens on 127.0.0.1, so other machines can't connect.
- **Protection from other websites.** A web page you visit could try to send requests to a
  local server. The server rejects any request whose `Host` isn't localhost (this blocks
  "DNS rebinding"). It also requires a custom `X-Simulator` header on every change, which
  browsers won't let another site add. Other sites therefore can't modify data or spend
  your API credits.
- **Accounts.** Passwords are stored as salted scrypt hashes (never in plain text) and
  compared in constant time; at least 10 characters. Sign-in is rate-limited. Sessions use a
  random token in an HttpOnly, SameSite=Strict cookie, and only a hash of it is stored.
  Deactivating someone signs them out everywhere.
- **Permissions are enforced by the server**, on every request: the menu just hides what
  you can't use. Attempts are always saved under the signed-in person (the browser can't
  claim to be someone else). People only receive results they may see. The leaderboard is
  computed on the server, so learners see rankings, not other people's attempts.
- **Organisations are kept apart** by giving each its own storage folder, chosen from the
  signed-in person's organisation on every request. SCIM tokens are stored hashed and
  belong to one organisation.
- **Validated input.** Every saved simulation, attempt, upload and import is checked against a
  schema, and uploaded images must really be PNG, JPEG, WebP or GIF (checked from the file's
  contents, not just its name). File and asset ids must match strict patterns before they touch the disk, which
  prevents path traversal. Only image types are accepted as assets.
- **No uploaded code runs.** Uploaded HTML or code is treated as text for the AI to read.
  It is never rendered or executed. In production a strict Content-Security-Policy is
  applied.

Hosting this for other people still needs: HTTPS, a real database, company single sign-on
(SAML/OIDC), and limits on AI spending.

## Costs

Box fine-tuning adds one smaller AI call per screenshot screen (two images in, a short list
of boxes out). Generation uses `claude-opus-5-5` by default (set `SIM_MODEL` in `.env` to change it). Cost
depends on the amount of input (each screenshot is roughly 1,500 tokens) and mostly on the
size of the simulation written back. Expect well under a few dollars per generation; check
actual usage in the Claude Console. Playing and editing simulations makes no AI calls, except
scenarios with an AI customer: one short call per customer reply (at low effort, for speed) and
one call to judge the conversation at the end. Each person is limited to 200 customer replies and
30 judgements an hour.

## Known limitations and next steps

- Box fine-tuning greatly reduces manual dragging, but very small or crowded controls may
  still need a nudge.
- Video narration (audio) isn't transcribed; only frames are used.
- Within a path, clicks must follow the step order (field entries can be done in any order).
  Use alternative paths for other valid orders.
- Local files and a local server. Hosting (HTTPS, a database, single sign-on) is the main
  step before other people can use it.
- See [docs/BACKLOG.md](docs/BACKLOG.md) for everything still to do.
