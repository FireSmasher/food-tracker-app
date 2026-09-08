# Handoff: Kain → Saulog OS

Status as of 2026-09-08. Read this before touching the next phase of this project.

## ⚠ Continue this exact app — do not create a new one

- **Local source:** `~/food-tracker-app` (this directory).
- **GitHub repo:** `FireSmasher/food-tracker-app` (public), remote already
  configured as `origin` in this directory's git config.
- **Live URL:** https://firesmasher.github.io/food-tracker-app/ — deployed via
  GitHub Pages from the `main` branch, root path. A push to `main` goes live
  in ~30-60s.
- The Buhat tab, the Saulog OS rename, and the Nippard/Sevro sync all belong
  **in this same repo, this same `index.html`/`app.js`, this same deploy** —
  add the Buhat tab and rename inside the existing files, the same way the
  Settings tab and Search modal were added on top of the original two-tab
  (Log/Recipes) layout. Do not spin up a second repo, a second GitHub Pages
  site, a second Artifact, or a second local project directory for any part
  of this. If a future session can't find this directory or repo, it should
  search for it (`gh repo view FireSmasher/food-tracker-app`, or look for
  `~/food-tracker-app`) before creating anything new.
- If the storage architecture changes (see Option A below — republishing as
  an Artifact with a `db` capability), that Artifact should also be a
  **redeploy of the existing GitHub Pages HTML** into Artifact form, or a
  clearly-linked companion, not an unrelated fresh build that abandons the
  IndexedDB data model, the food dataset, the styling, or the URL history
  already established here.

## What exists right now

**Kain** — a free, installable PWA food/calorie tracker, live at
https://firesmasher.github.io/food-tracker-app/, source in this repo (public,
on GitHub as FireSmasher/food-tracker-app).

- Static site: `index.html` + `app.js` + `sw.js` (service worker) + `foods.json`
  (offline nutrition dataset, Berlin-aware: döner, currywurst, Quark, Lidl
  jasmine rice, etc.) + self-hosted fonts (`fonts/`: Satoshi body, Cormorant
  Garamond display — both self-hosted specifically so the app has zero
  external network dependency and works fully offline).
- **All data is phone-local.** IndexedDB stores three object stores: `foods`
  (name + per-100g macros), `recipes` (ingredient list + derived per-100g
  macros), `logs` (date, time, name, grams, quantity, notes, macros,
  isRestaurant flag, itemType/itemId). Nothing is uploaded anywhere. This was
  a deliberate privacy choice — see `edwin_credential_boundary` memory and the
  original build conversation.
- Manual entry, custom recipes (built from ingredients by weight), a live
  USDA FoodData Central search (Settings tab holds a personal API key,
  masked, localStorage-only, never in source — public repo can't hold it,
  USDA auto-deactivates keys found in public code).
- Daily targets pulled from Nippard: 2,300 kcal / 150g protein floor / 70g
  fat floor / ~265g carb, rendered as progress bars against the day's log.
  Hardcoded in `app.js` as `TARGETS` — **not currently read live from
  Nippard's `TARGETS.md`, just copied in at build time.** If Nippard's numbers
  change after the two-week recalibration, `TARGETS` needs a manual update
  unless the sync described below gets built first.
- Deployed via GitHub Pages, updates on every `git push` to `main` (~30-60s
  to go live). No backend, no accounts, no paid services anywhere in the
  stack.

## What's being asked for next

Rename the app **Saulog OS**, restructure it as two tabs:

1. **Kain** — the existing food tracker, unchanged in function.
2. **Buhat** (new) — a gym workout logger:
   - Workout type/split selector: Push, Pull, Legs, Upper, Lower, Cardio.
   - Per-exercise entry: exercise name, sets, weight, reps.
   - **Exercise → muscle group should be automatic** — typing "bench press"
     should tag chest/triceps without the user picking a muscle group
     manually. This needs either a bundled exercise→muscle-group dictionary
     (same pattern as the offline food dataset) or a live lookup, mirroring
     how Kain handles unknown foods via USDA search. A free exercise
     database equivalent to USDA FDC doesn't have one universally-agreed
     source — wger.de has a free open API and database (self-hostable, has
     a public instance) and is the closest fit; needs evaluation before
     committing to it.

3. **The integration requirement, which is the actual hard part:** every log
   from both tabs — food and workout — needs to be **"noticed" by Nippard and
   Sevro**, so that when Edwin asks Sevro for analysis, Sevro can see what was
   actually logged, not just what Nippard's static plan says should happen.

## Why the integration is the real design decision here

Kain's privacy model (phone-only IndexedDB, nothing leaves the device) is
fundamentally in tension with "Nippard and Sevro should see every log,"
because Nippard and Sevro run as separate Claude Code sessions with
filesystem-based memory (`~/Documents/claude/Nippard/`,
`~/.claude/projects/.../memory/`) — they have no way to read a phone's
browser storage. Something has to bridge that gap. Three real options, not
mutually exclusive:

**Option A — Artifact shared database (recommended starting point).**
Claude's Artifact tool supports publishing a page with a `db` capability
(and optionally `user`, for per-viewer-private paths like `data/users/me`).
If Saulog OS is republished as an Artifact with that capability instead of
(or alongside) the current static GitHub Pages deploy, logs could write to
that shared database, and *any* Claude session — including a Nippard or
Sevro session — can read it directly via the `Artifact` tool's `read_db`
action, no separate backend, no hosting cost, still free. This is the
cleanest path because it doesn't introduce new infrastructure.
**Trade-off:** it's a real architecture change from the current pure-static
build — needs `artifact-capabilities` skill loaded before touching it, and
means moving off GitHub Pages as the primary deploy target (or running both
in parallel, which adds sync complexity).

**Option B — manual/periodic export.** Add an "Export" button producing
JSON or CSV of the day's/week's logs, which Edwin drops into
`~/Documents/claude/Nippard/` himself. Cheapest to build, zero ongoing
automation, but doesn't satisfy "every log... noticed" — it's opt-in and
lagged, not live.

**Option C — lightweight external sync backend.** A free-tier hosted
database (e.g., Supabase, Firebase free tier) that both the phone app and a
script Sevro/Nippard runs can reach. More moving parts, another account,
another free-tier limit to track — only worth it if Option A turns out to
have a real limitation (e.g., needs to work when the artifact is closed,
needs push notifications, etc.).

**Recommendation for whoever picks this up:** start with Option A. It's the
only one that actually delivers "every log automatically visible to Sevro"
without adding new hosting/accounts, and the tooling to read it already
exists in every Claude Code session via the `Artifact` tool.

## Open questions before implementation starts

- Does moving to an Artifact-hosted DB replace the GitHub Pages deploy, or
  run alongside it? (Running both means the IndexedDB-only version and the
  DB-backed version could drift — probably don't do both long-term.)
- Privacy re-scope: right now "nothing leaves the phone" is a stated,
  deliberate property of this app (see conversation history). Moving to a
  shared DB is a real privacy trade-off Edwin should confirm explicitly, not
  something to infer from "I will integrate Kain and Nippard together."
- Muscle-group auto-tagging data source: bundle a small curated exercise
  list (fast, offline, limited coverage — same trade-off Kain made with its
  79-food starter dataset) vs. wire up a live API like wger.de (broader
  coverage, another external dependency to evaluate for CSP/offline
  behavior, same pattern as the USDA integration).
- Does "Sevro does an analysis when asked" mean Sevro queries the DB live
  during a conversation, or does something pre-aggregate daily/weekly
  summaries into Nippard's own markdown files? Live query is simpler to
  build; pre-aggregation is more resilient if the DB schema changes later.
- `TARGETS` in `app.js` is currently a hardcoded copy of Nippard's numbers —
  worth deciding whether the same sync mechanism built for logs should also
  make targets flow the other direction (Nippard → Kain) instead of staying
  a manual copy.

## Relevant memory entries

- `edwin_nippard_system` — canonical training/nutrition system, authoritative
  source for targets and training structure.
- `edwin_diet_targets` — where the 2,300/150/70/265 numbers came from.
- `edwin_credential_boundary` — the standing rule that shaped Kain's
  phone-only privacy model; the DB-integration decision needs to be squared
  with this explicitly, not silently overridden.
- `sevro_identity` — Sevro's own architecture, for whoever wires up the read
  side of this integration.
