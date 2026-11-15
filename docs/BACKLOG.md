# Backlog

The running list of what's done, in progress, and still to do. Update it as part of
any change that finishes, adds or reshapes an item.

Status key: ✅ done · 🚧 in progress · ⬜ to do

## In progress

Nothing right now.

## To do

- ⬜ **Phone access**: let phones on the same Wi-Fi play simulations (with an access
  code); check the Player at phone sizes.
- ⬜ **Video narration**: transcribe recordings' audio so the AI hears the explanation
  (needs a speech-to-text service).
- ⬜ **AI suggestions for tags and rubric criteria** when generating a simulation.
- ⬜ **Scheme-level defaults for screen/state checks**: let a scheme carry default
  conditions, for schemes written for one specific simulation.
- ⬜ **Assignment reminders**: email or in-app notices before a due date (needs an email
  service).
- ⬜ **SCIM groups → roles**: optionally map identity-provider groups to Builder /
  Admin-Builder roles (today roles are managed in the app).
- ⬜ **Link older name-only results to people**: an Admin-Builder tool to attach results saved
  before accounts (by typed name) to the right person when names don't match exactly.
- ⬜ **Several organisations in the app**: a way to create and switch organisations (the
  storage and permissions already separate them).
- ⬜ **Random persona per run**: let a scenario draw from a set of personas so trainees
  meet different customers (decided against for now; data on screens only).
- ⬜ **Voice for AI customers**: speak and listen on phone and in-person conversations
  (needs speech-to-text and text-to-speech services); the channel is already stored.
- ⬜ **Persona briefing card**: show the persona's details to the trainee up front (not chosen
  for now; the AI customer shares them when asked).
- ⬜ **Random values inside screenshots**: today random values appear in text elements and
  wireframes, not in the pixels of an uploaded screenshot.
- ⬜ **Re-grade past attempts** when a scheme changes (today each attempt keeps the rules
  it was graded with, which is usually what you want for fairness).
- ⬜ **Hosting for other people**: a real database, HTTPS, company single sign-on
  (SAML/OIDC), limits on AI spending; turn on SCIM from the customer's identity provider.
- ⬜ **Performance by team and topic**: filter course performance to a leader's team or a
  topic (dates, weekly trend and CSV are done).
- ⬜ **Verify AI features with a real API key**: generation quality, box fine-tuning
  accuracy, and whether the AI proposes sensible alternative paths.

## Done

- ✅ Core app: screens, elements, rules, variables, scenarios; Open world / Guided /
  Scenario modes with live switching; scoring; results
- ✅ AI generation from screenshots, video key frames, code/HTML, PDF/Word/text
- ✅ "Ask AI to change it" in the editor
- ✅ Record scenario steps by doing them
- ✅ Unsaved-changes guard in the editor
- ✅ Trainee names on attempts; Results filter by trainee
- ✅ `main` branch created
- ✅ AI box fine-tuning on screenshots (automatic + editor button)
- ✅ Editor conveniences: duplicate, copy/paste across screens, snapping, nudging,
  screen reordering, safe renames
- ✅ Import / export of a simulation with its images; image content checks
- ✅ Multiple valid paths per scenario; "also accept" alternatives per step
- ✅ Trainee progress view: mastery per scenario, score trends, where they struggle
- ✅ Topic & tag library: admin-managed topics containing tags; tag simulations; filter
  the Library by topic/tag; progress by topic
- ✅ Grading library: schemes with point rules (penalties, time limit + overtime, pass and
  mastery marks), weighted rubric (automatic or trainer-marked criteria), rubric weight,
  open-world objectives; per-simulation scheme with scenario override and check targets;
  trainer marking on Results; pass/fail and mastery from the scheme
- ✅ Admin mode via `ADMIN_PIN` (later replaced by accounts and the Admin-Builder role)
- ✅ Automatic checks on GitHub: typecheck, tests and build on every push and pull request
- ✅ Clean up unused images (Libraries → Storage; admin only; keeps anything under a day old)
- ✅ Tags and grading schemes carried through export/import, matched by name; created on
  import by admins, otherwise dropped with a warning
- ✅ Randomised scenario data: seeded generators (list, number, pattern, name, date;
  linked lists); `{{variables}}` in instructions, hints, goals and expected answers;
  per-scenario opt-out; values saved with attempts
- ✅ Assignments: complete / pass / master with due dates and notes; "My training" for
  trainees; status from results; shown in the Player, summary and Progress. Decided: credit follows
  the work, so attempts made before assigning count too
- ✅ Personas: admin templates (typed fields + record tables), personas with backstories,
  account details and records, AI drafting from a description, roles per simulation with
  scenario overrides, `{{customer.field}}` variables, a "table" element, carried through
  export/import, and deletion guards
- ✅ Personas per scenario: assign any persona to a scenario (including scenario-only roles).
  Decided: a persona is one record like a real customer; edits always apply everywhere it's
  used (no per-simulation or per-scenario detail overrides). The Admin-Builder edits
  personas in place from the simulation editor, with a list of everything a change affects
- ✅ Accounts, roles and hierarchy: email + password sign-in, first-run setup, organisations
  (one for now, each with its own storage); roles Admin-Builder / Builder / Leader / Learner
  (stacking; anyone with reports is a Leader); permissions enforced on the server for every
  route; People page (add, roles, managers, deactivate, reset password, CSV import); SCIM 2.0
  (users + enterprise manager, bearer token per organisation); leaderboard (org-wide by name,
  my team, by topic, by scenario); My team; assignments by leaders within their tree.
  Replaced the admin PIN and the typed-name prompt.
- ✅ Course performance for Builders: per-simulation and per-scenario completion, pass and
  mastery rates, score spread, rubric criteria at the point level (worth, met rate, average
  earned, awaiting marking), points lost to errors / hints / overtime, trouble steps, where
  unfinished runs stopped, paths taken; Guided runs can be left out. Aggregate only, no names
- ✅ Points breakdown: every run's score as a step-by-step ledger (points earned per step,
  errors and hints on the step where they happened, overtime, rubric criteria), on the
  end-of-run summary, My progress and Results; Builders see the average per step on
  Performance
- ✅ No dead ends: things a role can't use are hidden rather than shown locked; links to
  pages you can't open go back to the Library (or your own progress)
- ✅ No waiting on people: trainer-marked criteria are skipped unless a builder turns on
  "Include trainer-marked criteria" for a simulation (off by default); results waiting for
  marking in simulations without it are settled automatically
- ✅ AI-played customers: a scenario's persona played by Claude beside the screens, over chat,
  phone or in person (typed for now). Shares details only when asked; builder writes the
  situation, an optional opening line, and criteria judged by AI at the end with a reason per
  criterion; criteria join the rubric (or carry their own weight); conversation-only scenarios;
  transcripts on My progress and Results; per-person hourly limits
- ✅ Conversation coaching in Guided mode: "What should I say?" suggests the next line and why
  (knows the goal, situation and criteria, not the customer's private details)
- ✅ Clickable table rows: a table can select a row by a column; the row's values become
  variables, the table's rules run (e.g. open the order screen), and steps can require a row
- ✅ Performance: date range (with last 30/90 days), week-by-week table, and CSV download of
  the course list and of a course's figures (scenarios, weeks, steps, penalties, criteria)
- ✅ Decided: Open world stays unrecorded practice (objectives are a live checklist only);
  credit comes from Guided and Scenario runs

## Housekeeping (needs you, on GitHub)

- Merge pull request #1.
- Set the default branch to `main` (Settings → General → Default branch).
- Delete the stray `claude/align-boxes` branch.
- Remove `ADMIN_PIN` from your `.env` if you set one; it's no longer used.
