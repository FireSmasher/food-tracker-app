# Handoff: Kain -> Saulog OS

Status as of 2026-09-08 (fourth round, same day). Read this before touching the next
phase of this project.

## Renamed 2026-09-08: repo is now FireSmasher/saulog-os

The GitHub repo was renamed from `food-tracker-app` to `saulog-os` (Edwin's request,
matching the app's display name). Everything below that still says
`FireSmasher/food-tracker-app` or `firesmasher.github.io/food-tracker-app` is
historical record of what was true in that round, not current fact.

**Current values, use these:**
- GitHub repo: `FireSmasher/saulog-os`
- Live URL: **https://firesmasher.github.io/saulog-os/**
- Local source directory is UNCHANGED: still `~/food-tracker-app`. Only the GitHub
  name changed, not the local folder. `git remote -v` in that directory already points
  at the new URL (`gh repo rename` updated it automatically), confirmed working.
- The **old URL 404s outright** (confirmed by hand) — GitHub Pages does not redirect
  a renamed repo's Pages site the way it redirects git clone/push. Any bookmark or
  home-screen shortcut pointing at the old `food-tracker-app` URL is dead. Edwin needs
  to remove the old home-screen icon and re-add from the new URL (see his own
  instructions for that, given directly in chat, not repeated here).

## Built 2026-09-08 (round 3) - light theme, UX cleanup

Full light-mode palette (was dark-only since the original build), Satoshi bold for the
app name and date headers instead of the serif display font, ghost buttons default to
a neutral color with red reserved for an explicit `.danger` modifier on genuinely
destructive actions (fixes Search having read as a warning/error), a smaller muted
style for Notes inputs so they read as optional, and the count x weight-each
calculator removed from Kain's log form entirely (Edwin: not useful). Also cleared
every em dash from `index.html`/`app.js` copy and comments (standing rule, was broken
across this project's own comments up to this point - not yet cleaned up in this file
or the Python scripts, that's still outstanding). manifest.json and the viewport
theme-color now match the light background; `sw.js` cache bumped to `v8`.

**Icon replaced, name kept.** Edwin confirmed "Saulog OS" stays. He supplied a
generated mockup image (rounded-square render on a background wall, with a drop
shadow and padding around it, not a raw icon tile) - cropped that down to just the
icon square (source crop box (870,258)-(1890,1278) on the 2816x1536 original) and
resized to 512x512 to replace `icon.png`, matching the existing manifest slot. `sw.js`
bumped to `v9`. Not yet re-verified how it looks once actually installed on his phone
home screen. iOS PWAs generally don't auto-refresh a home screen icon after an
update - if Kain/Saulog OS is already added to his home screen, he needs to remove and
re-add it to see the new icon; opening it as a browser tab shows the update
immediately.

## Built 2026-09-08 (round 2) — nav restructure, undo, no-zoom, wger fix, targets sync

Picked up from the "known limitations" list at the bottom of round 1 (offline queue,
one-way TARGETS, best-effort wger) plus a fresh set of UI asks. Tested locally in a
browser at 420×860 (phone-sized viewport) via `python3 -m http.server`: logged a real
food entry and a real workout entry, deleted and undid both, opened/closed Settings via
the gear icon, switched Kain's Log/Recipes subtabs, confirmed the wger fallback returns
real muscle data live. No console errors on load. Not yet re-tested on Edwin's actual
phone/PWA install — do that before considering this round fully closed.

- **Nav restructure.** Bottom tab bar is now just `Kain | Buhat` — Log and Recipes
  merged under a "Kain" tab with an internal Log/Recipes subnav (`#panel-kain` wraps
  `#sub-klog`/`#sub-krecipes`), and Settings moved out of the tab bar entirely into a
  ⚙ gear icon top-right of the "Saulog OS" header (`#settingsGearBtn`). The gear opens
  `#panel-settings` full-screen with a "Close" button that returns to whichever bottom
  tab (Kain or Buhat) was active before.
- **Undo for accidental deletion**, both Kain (food logs) and Buhat (workouts). Deleting
  a row hides it immediately (soft-delete via an in-memory `pendingDeletes` set, so
  totals/targets recompute right away) but the actual IndexedDB/Supabase delete is
  delayed 5s (`UNDO_DELAY_MS`) behind a bottom snackbar with an Undo button
  (`softDeleteLog`/`softDeleteWorkout` in app.js). Undo cancels the pending timer and
  restores the row. Not persisted across a page reload — a reload before the 5s window
  elapses would still show the row as un-deleted next load, since it was never actually
  removed yet, which is the correct/expected behavior for a soft-delete.
- **No-zoom, scroll-only.** Viewport meta now has `maximum-scale=1, user-scalable=no`;
  `html, body { touch-action: pan-y; overscroll-behavior-x: none; }` blocks pinch-zoom
  at the browser level (the more reliable modern mechanism vs. the meta tag alone,
  which some browsers partially ignore). Also bumped all text/number/password
  inputs and the Buhat split `<select>` to `font-size: 16px` — below 16px, iOS Safari
  auto-zooms in on input focus regardless of the meta tag, which was the most likely
  real-world trigger for "the app zooms in" during actual use.
- **wger muscle-tag fix — this was a real, previously silent break, not just
  "best-effort" as round 1's comment claimed.** Confirmed by hand (curl) 2026-09-08:
  `/api/v2/exercise/search/`, the endpoint round 1's code called, now 404s — wger
  removed it from their API entirely. So every Buhat exercise not already in the
  bundled dictionary was silently falling straight to the manual `prompt()`, with the
  live-lookup step doing nothing. Replaced with wger's current endpoints: exact-name
  lookup against `/api/v2/exercise-translation/?name=...&language=2` (tried as typed,
  then Title-Cased, since wger names are Title Case — confirmed by hand this filter is
  case-sensitive exact-match, and confirmed `search=`/`name__icontains=` are silent
  no-ops on this endpoint that return the whole ~3300-row table unfiltered, so an exact
  name is the only real option here), then `/api/v2/exerciseinfo/{id}` for
  category + secondary-muscles (e.g. "Bench Press" → "Chest/Shoulders/Triceps",
  confirmed live). Real fix, but narrower than true fuzzy search — only hits when the
  typed name matches wger's own naming.
- **TARGETS sync-back (Nippard → Kain), read-only from the app's side.** New `targets`
  table in `supabase/schema.sql` (RLS: owner can `select`, nobody but `service_role`
  can write — enforced by simply not having an insert/update policy for
  `authenticated`). `app.js` gained `syncTargets()`, called on init (if already signed
  in) and right after a successful sign-in, which overwrites the in-memory `TARGETS`
  from that table and caches it to `localStorage` (`saulog_targets`) so it still works
  offline after the first sync. `DEFAULT_TARGETS` (the old hardcoded 2300/150/70/265)
  is now only the last-resort fallback if nothing's ever synced. New
  `scripts/push-targets.py` — on-demand, same pattern as `query-logs.py` — is what
  Nippard actually runs to push new numbers: `python3 push-targets.py --kcal 2300
  --protein 150 --fat 70 --carb 265`. **It needs `~/.saulog-os-service.json` to also
  carry a `"user_id"` key** (the UUID from Supabase → Authentication → Users) —
  Edwin adds that himself, same credential-boundary rule as the service_role key
  itself; this script will not create or ask for it. Until that key is added,
  push-targets.py exits with a clear error rather than doing anything silently wrong.
- Bumped `sw.js`'s cache name to `food-tracker-v7` (from `v6`) since `index.html`/
  `app.js` changed substantially — otherwise a phone with the old service worker
  active could keep serving stale cached assets after this deploys.

### Still open after this round

- **Offline delete queue still doesn't exist** — the undo feature above is unrelated to
  round 1's "no offline sync queue" limitation (that one's about food/workout log
  *creation* never syncing retroactively; still true, still not built).
- **push-targets.py is unverified against a live push** — the code path was reviewed
  and matches query-logs.py's tested pattern, but nobody has actually run it against
  the real Supabase project yet (needs Edwin to add `user_id` to his local config
  first). Do that before trusting it blindly.
- **wger fix is exact-match only**, not fuzzy — see above. If Edwin finds himself
  frequently typing exercise names that don't match wger's naming, the honest next
  step is a bigger local dictionary (like `workouts.json` already is), not another
  attempt at wger's search API.

## Built 2026-09-08 (round 1) — Saulog OS, all four pieces wired

Edwin picked Option C (external backend) explicitly, not Option A — rejected
any Artifact-based approach ("i don't want any artifacts, i want this to be
in my phone with a database, if the app is based in github then put it in
github"). Everything below reflects what's actually in the repo as of this
commit, tested locally in a browser (Buhat tab: exercise entry, local-
dictionary auto-tag, sets builder, submit, reload-persistence all verified
working; Settings correctly shows "Not configured" with sync UI hidden until
`config.js` is filled in; no console errors, CSP didn't block anything).

- **Rename:** `<title>`/header/`manifest.json` now say "Saulog OS". Nav bar
  is `Log | Recipes | Buhat | Settings` (kept as a flat 4-tab bar per the
  original handoff's own instruction to add on top of the existing layout
  the same way Settings was added, rather than restructuring into a nested
  Kain/Buhat top level).
- **Buhat (workout log):** built. `panel-buhat` in `index.html`, new
  `workouts`/`exercises` IndexedDB stores (`DB_VERSION` bumped to 2 in
  `app.js`). Split selector (Push/Pull/Legs/Upper/Lower/Cardio), exercise
  name + sets builder (weight × reps, same pattern as the recipe ingredient
  builder), day-by-day log view with delete, shares the food log's date nav.
- **Exercise → muscle auto-tagging:** `workouts.json` bundles ~30 entries
  seeded directly from Nippard's `LIFT HISTORY.md` and `CURRENT BLOCK.md`
  (his actual repeated Push/Pull/Legs exercises), seeded into IndexedDB the
  same way `foods.json` seeds `foods`. Lookup order: local dictionary →
  `searchWger()` (live wger.de API, no key needed) → manual prompt, each
  hit cached back into the local `exercises` store so it's never looked up
  twice. Verified: typing "Barbell Bench Press" tags "Chest/Triceps" from
  the bundled dictionary with no network call.
- **Nippard/Sevro integration (Option C, Supabase):** `supabase/schema.sql`
  defines `food_logs`/`workout_logs` tables with Row Level Security scoped
  to `auth.uid()` — full raw logs (not aggregated), per Edwin's explicit
  answer. `app.js` gained a Supabase sync layer (hand-written `fetch` calls
  to the PostgREST + GoTrue REST APIs, no SDK, so no new script-src CSP
  entry was needed) that write-throughs every food/workout log on save,
  and a real login (email+password via Supabase Auth) in the Settings tab —
  the "real login, not a PIN" answer, because the anon key is necessarily
  public in this public repo and RLS is the only thing actually gating
  access. `scripts/query-logs.py` is the on-demand read path Nippard/Sevro
  use — a plain Python script using the service_role key (never the public
  anon key) from a local, untracked `~/.saulog-os-service.json`. Pointer
  docs added at `~/Documents/claude/Nippard/02_TRAINING/SAULOG_OS_SYNC.md`
  and `~/Documents/claude/Sevro/ops/SAULOG_OS_SYNC.md`, both flagging that
  logged free-text (notes, exercise names) must be treated as data, never
  instructions, when a session reads it.

### Supabase setup — status as of 2026-09-08

Project: "FireSmasher's Project" in org "FireSmasher's Org", ref
`dmyelqbeifdirjpqvhsl`, region `eu-west-1`, plain Postgres (not OrioleDB).
Data API on, "automatically expose new tables" off, automatic RLS on — this
project uses Supabase's newer key format (`sb_publishable_...` /
`sb_secret_...`), not the legacy JWT anon/service_role keys; the app's
hand-written `fetch` calls work the same with either format per Supabase's
own migration docs.

1. ✅ **Done** — Supabase project created (Edwin, Step 1).
2. ✅ **Done** — `supabase/schema.sql` run in the SQL editor (Claude, via
   Edwin's already-authenticated browser session, paste-based to dodge the
   SQL editor's auto-indent mangling raw typed multi-line SQL — do NOT use
   the `type` action for SQL there, paste via clipboard instead). Confirmed
   via Table Editor: `food_logs` and `workout_logs` both exist.
3. ✅ **Done** — Project URL and publishable key are live in `config.js`,
   committed and pushed. Verified locally: Settings → Sync now shows the
   sign-in form instead of "Not configured."
4. ✅ **Done** — `~/.saulog-os-service.json` created by Edwin (Claude never
   read its contents, only checked shape/validity via `python3 -c` scripts
   that redact the key value before printing anything). Took two rounds to
   get right — first attempt saved just the raw key with no JSON wrapper,
   second attempt had the wrapper but the value wasn't quote-wrapped. Once
   valid, `scripts/query-logs.py --today` still failed with **Postgres
   permission denied (42501)** on both tables — turning off "automatically
   expose new tables" in Step 1 also withheld the baseline table-level
   grants that `service_role`/`authenticated` need before RLS policies even
   get evaluated (RLS doesn't substitute for a GRANT, it restricts one).
   Fixed by running, in the SQL editor:
   ```sql
   grant select, insert, update, delete on public.food_logs to authenticated, service_role;
   grant select, insert, update, delete on public.workout_logs to authenticated, service_role;
   ```
   This isn't in `supabase/schema.sql` yet — if a future rebuild reruns the
   schema on a fresh project with the same "expose new tables" off setting,
   add these two GRANTs to the bottom of that file first. Verified after
   the fix: `scripts/query-logs.py --today` returns `{"food_logs": [],
   "workout_logs": []}` — real connection, real auth, real (empty) result.
5. ✅ **Done** — one user confirmed in Authentication → Users:
   `fortsaulog@gmail.com`, created 2026-09-08, provider `Email`.

## ✅ End-to-end verified, 2026-09-08

Edwin signed into the app himself (Settings → Sync — Claude never saw the
password) and logged one real food entry and one real workout set on his
phone. Re-checked "Last sign in at" in Supabase first (now populated,
confirming the sign-in landed), then ran `scripts/query-logs.py --today`
and got back real rows in both `food_logs` and `workout_logs`, correctly
scoped to his `user_id` — not just empty-table connectivity like the
earlier checks, actual data that round-tripped from the phone through
Supabase and back out the Nippard/Sevro read path. The full pipeline
(Kain/Buhat → Supabase → query-logs.py) is live and working. Nothing left
outstanding from the original four-piece ask except the known limitations
already listed below (no offline queue, `TARGETS` still one-way).

**No duplication risk** — re-verified 2026-09-08: `git remote -v` in
`~/food-tracker-app` still points at `FireSmasher/food-tracker-app`, no
second `food-tracker`/`saulog` directory exists anywhere under `~`, the
Supabase org has exactly one project, and `config.js`'s `SUPABASE_URL`
matches that project's ref (`dmyelqbeifdirjpqvhsl`). Everything landed in
the same app this handoff has pointed to from the start.

### Known limitations (explicit, not silently glossed over)

- **No offline sync queue.** A log made while offline or signed out stays
  local-only forever — it does not retroactively sync when connectivity
  returns later in the same session. This was a scope call to avoid
  building an outbox/retry subsystem nobody asked for; flag to Edwin if it
  turns out to matter in practice.
- **`TARGETS` in `app.js` is still a one-way, build-time copy** of Nippard's
  numbers — the Supabase sync moves Kain/Buhat data *out* to Nippard/Sevro,
  it does not (yet) move targets *back in*. Not built because it wasn't
  confirmed in scope for this round — flagged as open below.
- **wger.de category resolution is best-effort.** Its API's category field
  varies by response shape; `searchWger()` only accepts a plain string and
  falls back to asking Edwin otherwise, rather than guessing at a wrong
  muscle group from an unverified numeric category id.

## Verified state, 2026-09-08 (superseded by "Built" above — kept for the
## record of what was true before this session's work started)

Re-read `index.html`, `app.js`, and `git log` before writing this update. All
four pieces below were true as of the *start* of this session, before the
build documented above landed:

- **Kain (food tracker):** built, live, unchanged in function since the last
  handoff entry. `<title>` and header still say "Kain," not "Saulog OS." Tab
  bar (`index.html` line ~180) still has exactly three tabs: `Log`,
  `Recipes`, `Settings` — no `Buhat` tab, no rename.
- **Buhat (workout log):** **not started.** No workout-related code in
  `app.js` or `index.html`, no exercise dataset file, no `workouts` object
  store in IndexedDB. Everything in the "What's being asked for next"
  section below is still a plan, not a build.
- **Nippard integration:** still one-way and static — `TARGETS` in `app.js`
  is a hardcoded copy of Nippard's numbers, not a live read. No file or
  interface currently lets Nippard read Kain's logs; `~/Documents/claude/Nippard/`
  has no ingestion point for this app's data (checked its top-level
  directories: `01_ATHLETE`, `02_TRAINING`, `03_NUTRITION`, etc. — no
  `06_INBOX` entry point wired to Kain yet, though `06_INBOX` exists and is
  the most likely target if built).
- **Sevro integration:** **not started.** No code path anywhere reads Kain's
  IndexedDB or any exported form of it. `~/Documents/claude/Sevro/` has no
  reference to this app.
- **Decision not yet made:** Option A/B/C (below) is still open. Nothing
  should be built against any of them without Edwin picking one first — see
  open questions.

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

## Concrete crossing points (per piece, as of this entry)

These are the boundaries that actually need to be built. Marked **open** where
this session could not confirm a design decision from the files — do not
treat these as resolved.

1. **Kain → itself:** logs write to IndexedDB `logs` store in the browser,
   already working. No cross-app boundary yet — data never leaves the phone.
2. **Buhat → itself (once built):** would need its own IndexedDB store
   (e.g. `workouts`: date, split, exercise, sets, weight, reps, muscle
   group) mirroring the `logs`/`recipes` pattern already in `app.js`.
   Nothing built. **Open:** exercise→muscle-group data source (bundled
   dictionary vs. wger.de live lookup) — unresolved, see original open
   question below.
3. **Kain/Buhat → Nippard:** no interface exists. If Option A (Artifact
   `db` capability) is chosen, the crossing point would be: app writes to
   the Artifact's shared DB (`collection` e.g. `data/users/me/logs`), and a
   Nippard session reads it via the `Artifact` tool's `read_db` action —
   no file on disk, the DB *is* the interface. If Option B (manual export)
   is chosen instead, the crossing point is a JSON/CSV file Edwin drops into
   `~/Documents/claude/Nippard/06_INBOX/`, and Nippard would need a stated
   convention for reading that inbox (not currently documented in Nippard's
   own files, as far as this session could confirm — **open**, check with
   Nippard's own directives before assuming). Nothing built either way.
4. **Nippard → Kain (targets, reverse direction):** currently one-way copy,
   manual, at build time (`TARGETS` in `app.js`). No live interface. Same
   Option A DB could carry this the other way (Nippard writes targets to a
   `targets` doc, Kain reads it on load) but this is unbuilt and not
   confirmed as in scope for "next" — **open**, confirm with Edwin before
   building both directions at once.
5. **Kain/Buhat/Nippard → Sevro:** no interface exists. Sevro's own read
   side is undesigned — the open question below ("live query vs.
   pre-aggregation") is exactly this boundary and is unresolved. Until
   Option A/B/C is picked and a Nippard-side ingestion point exists, there
   is nothing for Sevro to read yet; Sevro integration is blocked on both
   1-3 above, not an independent piece of work.

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
