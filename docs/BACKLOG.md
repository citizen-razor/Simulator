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
- ⬜ **Assignment reminders**: email or in-app notices before a due date (needs accounts
  or an email service).
- ⬜ **Random persona per run**: let a scenario draw from a set of personas so trainees
  meet different customers (decided against for now; data on screens only).
- ⬜ **Persona briefing card / AI-played customer**: show the persona to the trainee, or
  let Claude role-play them in a chat (not chosen for now).
- ⬜ **Clickable table rows**: let a table element's rows act like buttons (e.g. open an
  order).
- ⬜ **Random values inside screenshots**: today random values appear in text elements and
  wireframes, not in the pixels of an uploaded screenshot.
- ⬜ **Re-grade past attempts** when a scheme changes (today each attempt keeps the rules
  it was graded with, which is usually what you want for fairness).
- ⬜ **Hosting for other people**: user accounts and roles (admin / author / trainee),
  a real database, HTTPS, limits on AI spending. Replaces the admin PIN.
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
- ✅ Admin mode via `ADMIN_PIN` (rate-limited; enforced by the server)
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
- ✅ Decided: Open world stays unrecorded practice (objectives are a live checklist only);
  credit comes from Guided and Scenario runs

## Housekeeping (needs you, on GitHub)

- Merge pull request #1.
- Set the default branch to `main` (Settings → General → Default branch).
- Delete the stray `claude/align-boxes` branch.
