# Handoff: Saulog OS (Kain + Buhat + Quarters)

Status as of 2026-09-08, end of day. This file was rewritten from scratch on this
date to consolidate five rounds of same-day work into one current reference — the
old round-by-round log was getting too long to safely skim. Read this whole file
before touching this project again.

## Read this first — do not create anything new

- **Local source:** `~/food-tracker-app` (this directory). Unchanged all day —
  only the GitHub repo name changed, never the local folder.
- **GitHub repo:** `FireSmasher/saulog-os` (public). Renamed from
  `food-tracker-app` on 2026-09-08 at Edwin's request. `git remote -v` in this
  directory already points at the new URL — `gh repo rename` updated it
  automatically, confirmed working.
- **Live URL:** **https://firesmasher.github.io/saulog-os/** — deployed via
  GitHub Pages from `main`, root path. A push goes live in ~30-60s.
- **The old URL is dead.** `https://firesmasher.github.io/food-tracker-app/`
  404s outright (confirmed by hand) — GitHub Pages does not redirect a renamed
  repo's Pages site the way it redirects `git clone`/`push`. Never write that
  URL anywhere as if it still works.
- **No backend other than Supabase, no accounts beyond the one described below.**
  If a future session can't find this directory or repo, search for it
  (`gh repo view FireSmasher/saulog-os`, or look for `~/food-tracker-app`)
  before creating anything new. Do not spin up a second repo, a second GitHub
  Pages site, a second Artifact, or a second local project directory for any
  part of this, ever.

## What Saulog OS is, right now

A free, installable PWA with two tabs on the bottom nav — **Kain** (food/macro
logging, with Log and Recipes as an internal subnav) and **Buhat** (gym workout
logging) — plus a Settings screen behind a gear icon in the header.

**Stack:** static site (`index.html` + `app.js` + `sw.js` service worker +
`foods.json` + `workouts.json` + self-hosted fonts), IndexedDB for all local
data, optional Supabase sync layer, no build step, no npm, deployed straight to
GitHub Pages on every push to `main`.

**Storage model:** everything is written to IndexedDB on the device first
(`foods`, `recipes`, `logs`, `exercises`, `workouts` object stores,
`DB_VERSION` 2). If the user is signed into Sync (Settings → Sync), every new
food/workout log *also* write-throughs to Supabase (see below) — but this is
opt-in and not signed into by default, so most of a user's history can still be
phone-only. **See the incident log below before assuming phone-only storage is
safe against every failure mode.**

**Theme:** light mode (bg `#faf7f0`, card `#ffffff`, text `#241f18`, accent
`#96723c`, danger `#b1503d` — full palette in `index.html`'s `:root`). App name
and date headers use Satoshi bold, not the Cormorant Garamond serif display font
(that's reserved for section `<h2>`s only). Ghost buttons default to a neutral
muted color; red (`.danger` class) is reserved for genuinely destructive actions
(delete ×, "Remove saved key") so Search/Tag/Close etc. don't read as
warnings. Pinch-zoom is disabled (`touch-action: pan-y` + viewport meta); all
inputs are 16px to stop iOS auto-zooming on focus.

**Icon:** `icon.png`, a 512×512 crop of a generated S-mark mockup Edwin supplied
(cropped down from a larger render that included background/shadow padding).
Name stayed "Saulog OS" — Edwin confirmed, no rename needed.

### Kain (food log)

- Log tab: name/recipe autocomplete against the local `foods`/`recipes` stores,
  a "Search" button that hits USDA FoodData Central live (Settings holds an
  optional personal API key, localStorage-only, falls back to a shared 30/hr
  demo key), weight in grams, optional notes (styled smaller/muted so it reads
  as skippable), a restaurant toggle (+15% kcal/fat correction), daily
  kcal/protein/fat/carb targets rendered as progress bars.
- The old "count × weight-each" calculator is gone — removed 2026-09-08,
  Edwin said it wasn't useful.
- Recipes subtab: build a recipe from existing food-library ingredients by
  weight, save it, it becomes loggable like any food.
- **Food dataset (`foods.json`, 135 entries as of this writing):** a curated
  offline set (raw/cooked meats, staples, common Berlin/German items — döner,
  currywurst, Quark, etc.) plus specific branded products Edwin asked for by
  name. USDA's live search covers generic items far beyond the bundled list;
  it does NOT cover German retail branded products (USDA is a US database), so
  those have to be added by hand here.
  - **Branded entries added 2026-09-08, sourced by web search, not from
    Edwin's own packaging — flag this to him if he ever asks why a number
    looks off:**
    - `Heinz Mayonnaise, Das Original` — 644 kcal, 0.8g protein, 3g carb, 70g
      fat /100g. Reasonably confident (single consistent source, matches
      mayo's typical profile).
    - `Milbona High Protein Joghurt, Natur` — 92 kcal, 11.8g protein, 5.1g
      carb, 2.5g fat /100g. **Genuinely uncertain** — Milbona (Lidl's dairy
      house brand; Edwin said "Limbona," that's not a real brand) sells this
      in several flavors with different macros, and the exact "Natur"/plain
      variant's numbers couldn't be confirmed. Ask Edwin to check his tub's
      label if this ever looks wrong.
    - `Bull's-Eye Spicy Garlic Sauce` — 260 kcal, 0.9g protein, 13g carb, 22g
      fat /100g. Cross-checked against two independent sources, both agreed.
      High fat because it's oil-based, not tomato-based like standard BBQ
      sauce — don't "fix" this thinking it's an error.
  - **Open ask from Edwin, not yet acted on:** he wants a much larger set of
    Lidl products added, especially more of the meat section, and floated
    using his local Ollama to bulk-research/structure the data instead of
    Claude doing one-by-one web searches (matches his standing credit rule:
    prefer local Ollama for volume work). Proposed but not yet built:
    for *branded* packaged goods, OpenFoodFacts has a free structured API
    (real label data, no LLM guessing needed) — better than either Ollama or
    Claude "searching." If Edwin or a script hands back data, the exact shape
    each entry needs is `{"name": "...", "kcal": 0, "protein": 0.0, "carb":
    0.0, "fat": 0.0}` per 100g, appended to `foods.json`. Ask him what
    specific meat items/cuts he actually wants before guessing at a big batch.

### Buhat (workout log)

- Split selector (Push/Pull/Legs/Upper/Lower/Cardio), exercise name with a
  "Tag" button, a sets builder (weight × reps), optional notes (same
  smaller/muted styling as Kain).
- **Muscle-group auto-tagging**, lookup order: local `exercises` IndexedDB
  store (seeded from `workouts.json`, 32 entries taken from Edwin's actual
  Nippard block — Pull/Push/Legs/one Cardio entry) → live wger.de lookup →
  manual prompt (asks Edwin once, remembers the answer forever after).
- **wger fix, 2026-09-08:** the endpoint the original build used
  (`/api/v2/exercise/search/`) is gone from wger's API entirely — confirmed by
  hand, it 404s. So every exercise not in the bundled 32 was silently falling
  straight to the manual prompt with the "live lookup" doing nothing. Replaced
  with wger's current endpoints: exact-name match against
  `/api/v2/exercise-translation/?name=...&language=2` (tried as typed, then
  Title-Cased), then `/api/v2/exerciseinfo/{id}` for category + secondary
  muscles (verified live: "Bench Press" → "Chest/Shoulders/Triceps"). **Real
  fix, but narrower than fuzzy search** — confirmed by hand that wger's
  `search=`/`name__icontains=` params are silent no-ops that return the whole
  ~3300-row table unfiltered, so exact-name is the only working option against
  their live API today.
- **Open ask from Edwin, proposed but not yet confirmed or built:** cache
  wger's full ~3300-entry name+id list locally (a handful of paginated API
  calls, purely mechanical, no LLM/search cost) and match against that
  client-side instead of requiring an exact hit against wger's live API — this
  would make far more typed exercise names auto-tag successfully. Waiting on
  Edwin to say go.

### Sync (Nippard/Sevro visibility) and targets

- Settings → Sync: real email/password login via Supabase Auth (not a PIN —
  the anon key is necessarily public in this public repo, so RLS + a real
  session is the only actual access control). When signed in, every new
  food/workout log also POSTs to Supabase (`food_logs`/`workout_logs` tables,
  RLS scoped to `auth.uid()`).
- `scripts/query-logs.py` — on-demand read path for a Nippard or Sevro
  session, using the service_role key (bypasses RLS) from a local, untracked
  `~/.saulog-os-service.json` that Edwin creates himself (Claude never reads
  its contents, only checks shape via redacting scripts). Usage:
  `python3 query-logs.py --today` or `--since YYYY-MM-DD --until YYYY-MM-DD`.
- `scripts/push-targets.py` — the Nippard → Kain direction. Pushes updated
  targets into a read-only-from-the-app `targets` table (RLS: owner can
  `select`, only `service_role` can write — there's deliberately no
  insert/update policy for `authenticated`). Usage: `python3 push-targets.py
  --kcal 2300 --protein 150 --fat 70 --carb 265`. **Needs
  `~/.saulog-os-service.json` to also carry a `"user_id"` key** (the UUID from
  Supabase → Authentication → Users) — not there yet as of this writing, and
  this script has never actually been run against the live project. Don't
  trust it blind; verify a real push before relying on it.
- `app.js`'s `syncTargets()` pulls from that `targets` table on init (if
  already signed in) and after sign-in, overwriting in-memory `TARGETS` and
  caching to `localStorage` (`saulog_targets`) so it still works offline after
  the first sync. `DEFAULT_TARGETS` (2300/150/70/265, Nippard's numbers as of
  14 Aug 2026) is only the last-resort fallback if nothing's ever synced.

## ⚠ Incident, 2026-09-08: Edwin's local logs were lost

**What happened:** Edwin had been using the app (added to his iPhone home
screen, pointed at the old `food-tracker-app` URL) with real food/workout
logs. After the GitHub rename, he was told to remove that home-screen icon and
re-add one pointed at the new `saulog-os` URL. After doing that, his previous
logs were gone.

**Root cause, best understanding:** iOS gives a "standalone" home-screen web
app (added via Share → Add to Home Screen) its own **isolated storage
container**, separate from regular Safari browsing *and* separate from any
previous home-screen install of the same site. This is a known, long-standing
WebKit quirk, not something specific to this app. Removing the old icon very
likely deleted (or orphaned beyond reach) the IndexedDB data tied to that
specific install. The theory that "IndexedDB is scoped by origin, not by URL
path, so the old and new paths would share storage" — which is what Edwin was
told before this happened — **turned out not to be the operative factor**; the
home-screen-install boundary matters more than the origin-vs-path one in this
context.

**Checked and ruled out as a recovery path:** queried Supabase directly
(`scripts/query-logs.py --since 2026-08-01 --until 2026-09-08`) — came back
empty for both tables. Edwin was never signed into Sync during his actual
day-to-day phone use, so there was no cloud backup to fall back on. As of this
writing it's unconfirmed whether checking a plain Safari tab (not the
home-screen icon) turns up anything — that was suggested to Edwin as a last
diagnostic, result not yet reported back.

**Why this matters for whoever picks this up next:**
- **Never tell Edwin (or anyone) to remove and re-add a home-screen PWA icon
  without warning that it can wipe local data first.** This is now a known
  risk, not a theoretical one.
- The strongest actual mitigation is getting Edwin to sign into Sync as his
  normal mode of use, not an optional extra — that makes Supabase a real
  backup independent of whatever iOS does to local storage next time.
  **Update, same evening:** confirmed via `scripts/query-logs.py --today`
  that he's now signed in and actively syncing — 5 food logs and a full
  5-exercise Push workout from tonight both round-tripped to Supabase. Don't
  re-raise this as an open ask; it's done. If a future `query-logs.py` check
  ever comes back empty for a day he says he logged, that's the signal he's
  fallen back to signed-out/local-only and it's worth surfacing again.
- The "no offline sync queue" known limitation (see below) is a related but
  distinct gap — that one's about logs made while offline never syncing
  retroactively, not about local storage being wiped outright.

## Known limitations (current, not historical)

- **`supabase/schema.sql` not yet run against the live project (2026-09-09).**
  `quarters_logs`, `weight_logs`, `health_logs`, `strava_activities` exist in
  the schema file but not in the real Supabase project. Quarters/weight
  logging works fine locally on the phone either way, it just won't sync
  until this is run. Edwin needs to paste the file into the Supabase SQL
  editor and run it — see "Setup reference: Supabase project" below.
- **Apple Health Shortcut not built yet** — walkthrough at
  `docs/apple-health-shortcut.md`, phone-side setup only Edwin can do.
- **Strava not connected yet** — walkthrough at `docs/strava-setup.md`,
  needs Edwin to register a Strava API app and do a one-time OAuth step.
- **No offline sync queue.** A log made while offline or signed out stays
  local-only until it syncs on its own — there's no outbox/retry mechanism
  that catches up later in the same session. Scope call, not an oversight.
- **push-targets.py is unverified against a live push** — needs Edwin to add
  `user_id` to his local service config first, then an actual test run.
- **wger fix is exact-name-match only**, not fuzzy — see Buhat section above.
  Client-side name-cache proposed, not yet built.
- **Kain's food dataset has real, known gaps** — specifically more Lidl
  products, especially meat-section items Edwin hasn't specified yet.
- **iOS home-screen storage is fragile** — see incident above. Nothing has
  been built yet to make this more resilient beyond "sign into Sync."

## Setup reference: Supabase project

Project: "FireSmasher's Project" in org "FireSmasher's Org", ref
`dmyelqbeifdirjpqvhsl`, region `eu-west-1`, plain Postgres. Data API on,
"automatically expose new tables" **off**, automatic RLS on. Uses Supabase's
newer key format (`sb_publishable_...` / `sb_secret_...`), not legacy JWT
anon/service_role — the app's hand-written `fetch` calls (no SDK, avoids a new
CSP `script-src` entry) work the same with either format.

**If this project is ever rebuilt from scratch against a fresh Supabase
project**, remember: turning off "automatically expose new tables" also
withholds the baseline table-level GRANTs that `service_role`/`authenticated`
need before RLS policies are even evaluated (RLS restricts access, it doesn't
grant it). `supabase/schema.sql` includes the necessary `grant select, insert,
update, delete on ... to authenticated, service_role;` lines at the bottom —
don't skip them, a fresh project without them fails every query with Postgres
`42501 permission denied` even with valid credentials.

One user exists: `fortsaulog@gmail.com`, Email provider. `config.js` holds the
public project URL + publishable key (safe to be public, RLS is the actual
gate). `~/.saulog-os-service.json` (local, untracked, Edwin-created-only) holds
`supabase_url` + `service_role_key`, and needs a `user_id` key added before
`push-targets.py` will work.

## Relevant memory entries

- `edwin_nippard_system` — canonical training/nutrition system, authoritative
  source for targets and training structure.
- `edwin_diet_targets` — where the 2,300/150/70/265 numbers came from.
- `edwin_credential_boundary` — the standing rule that shaped this app's
  privacy model and why Claude never reads `~/.saulog-os-service.json`'s
  actual key values.
- `sevro_identity` — Sevro's own architecture, relevant to the read side of
  the Nippard/Sevro integration.
- `saulog_os_handoff` — the auto-memory pointer to this project; keep it in
  sync with this file's "current state," don't let them drift.

## Condensed changelog (same day, 2026-09-08)

1. **Round 1 — built the four-piece ask.** Renamed to Saulog OS, built Buhat
   from scratch, exercise auto-tagging via bundled dictionary, Supabase sync
   layer (Option C, Edwin's explicit pick over an Artifact-based approach).
   End-to-end verified: Edwin signed in and logged one real food + workout
   entry on his phone, confirmed round-tripping through Supabase.
2. **Round 2 — nav restructure, undo, no-zoom, wger fix, targets sync-back.**
   Kain/Buhat-only bottom nav with Settings moved to a gear icon, soft-delete
   with a 5s undo toast, pinch-zoom disabled, discovered and fixed wger's dead
   search endpoint, added the read-only `targets` table + `push-targets.py`.
3. **Round 3 — light theme, UX cleanup.** Full light-mode palette, Satoshi
   bold name/date, neutral-by-default ghost buttons with red reserved for
   `.danger`, muted smaller Notes styling, removed the count×weight-each
   calculator, cleared em dashes from app copy.
4. **Round 4 — icon + GitHub rename.** Replaced `icon.png` with Edwin's
   generated mockup (cropped to a clean tile), kept the name "Saulog OS,"
   renamed the GitHub repo from `food-tracker-app` to `saulog-os` at Edwin's
   request (old Pages URL now dead, confirmed).
5. **Round 5 — food additions, then the storage incident.** Added Heinz Mayo,
   Milbona yogurt, Bull's-Eye sauce to `foods.json` (web-search sourced, some
   uncertainty flagged). Edwin reported his prior logs gone after removing/
   re-adding the home-screen icon — see incident log above. He's now testing
   fresh logging in the actual installed app (not a Safari tab) to confirm the
   new install persists correctly; awaiting his confirmation.
6. **Round 6 (2026-09-09) — mislabeled fruit fix, weight hints, edit-a-log.**
   Edwin logged mandarins as "Orange" (240g) because there was no Mandarin
   entry and no easy way to size fruit without a scale. Added `Mandarin` to
   `foods.json` and corrected the already-synced Supabase row by hand
   (`id a8a76989-...`) to the new name/macros — local IndexedDB on his phone
   still shows the old "Orange" entry until he edits or re-logs it, this was
   a one-off Supabase patch, not a full fix. Added `TYPICAL_WEIGHTS` reference
   hints (small/medium/large gram estimates) shown under the grams field for
   banana/orange/mandarin/apple/avocado — still logs by grams, just gives a
   starting point instead of a blind guess. Added an **Edit** button on each
   log entry (`startEditLog`/`saveEditedLog`/`syncUpdate` in `app.js`) so a
   wrong name/grams/notes can be corrected in place instead of delete-and-
   relog — updates IndexedDB and, if synced, PATCHes the Supabase row.
7. **Round 7 (2026-09-09) — German food import, barcode scan, Quarters tab,
   body weight, Health/Strava bridges.** Big one, several distinct asks in the
   same session:
   - **German retailer food import.** `scripts/import_off_foods.py` pulls
     OpenFoodFacts data tagged Lidl/Rewe/Edeka/Netto (in that priority order,
     Edwin's call), dedupes by barcode, caps at 5,000 — landed 3,462 usable
     entries (`germany_foods.json`) since OFF's public API was flaky (rolling
     503/401s) and cut Netto (lowest priority) short; Lidl/Rewe/Edeka got
     through mostly intact. Imported once into IndexedDB via
     `seedGermanFoodsIfEmpty()`, gated by a `localStorage` flag so it doesn't
     re-diff 3,462 rows on every launch like the small curated `foods.json`
     does. `renderFoodDatalist`/`filterFoodDatalist` were changed to filter
     on typing (max 60 shown) instead of dumping every row into the
     `<datalist>` — that broke down at this scale.
   - **Barcode scanning.** `html5-qrcode` (cdnjs) reads EAN/UPC codes via the
     camera; looks up the local `foods` store by a new `barcode` index first
     (DB bumped to v3 for this), falls back to a live OpenFoodFacts product
     lookup and adds a hit to the library. CSP updated: `script-src` now
     allows `cdnjs.cloudflare.com`, `connect-src` allows
     `world.openfoodfacts.org`, `img-src` allows `blob:` for the camera feed.
   - **Quarters tab (DB v4).** The old Quarters Claude Artifact
     (`~/quarters/quarters.html`) is rebuilt as a third bottom-nav tab here,
     fresh start per Edwin's call — pre-migration days stay archived in the
     old Artifact, not backfilled. 96 slots/day, military time, `00:00`
     first slot. Category rules (`Q_RULES` in `app.js`) are a byte-for-byte
     copy of the original `RULES` array so a label categorizes the same way
     in both places. Edwin's own convention of comma-separating multiple
     things done in one 15-min slot ("Duolingo, breakfast") is parsed and
     each piece categorized separately (`qSplitActivities`); a multi-activity
     slot's 15 minutes gets split proportionally across those categories in
     the day summary rather than assigned whole to just the first one. Synced
     to a new `quarters_logs` Supabase table (needs the updated
     `supabase/schema.sql` run manually). **No midnight "finalize" job** — iOS
     won't reliably run background JS for a home-screen PWA at a fixed time,
     so the day summary (category totals + activity list) is computed live
     on read instead, same result without depending on a timer that might
     not fire.
   - **Body weight (Buhat, DB v5).** One entry per day, `weight_logs` table,
     small form above the workout log — closes the gap that food/workout/
     time logs didn't connect to the actual recomp outcome measure.
   - **Apple Health and Strava bridges, plumbing only.** Neither can be built
     from inside this PWA (HealthKit isn't reachable from Safari at all;
     Strava needs an OAuth app only Edwin can register). Added `health_logs`
     and `strava_activities` tables plus `scripts/sync_strava.py`, and wrote
     `docs/apple-health-shortcut.md` / `docs/strava-setup.md` as exact
     walkthroughs for the phone-side/browser-side setup steps only Edwin can
     do. Nothing in the app displays `health_logs` or `strava_activities`
     yet — they're queryable via `query-logs.py --table health_logs` etc.,
     not shown in the UI. Ask specifically if an in-app view is wanted.
   - `query-logs.py` now reads `quarters_logs` and `weight_logs` too (default
     `--table both` covers all four); both Nippard's and Sevro's
     `SAULOG_OS_SYNC.md` copies updated to mention Quarters.
   - **Outstanding: `supabase/schema.sql` has NOT been run against the live
     project.** `quarters_logs`, `weight_logs`, `health_logs`, and
     `strava_activities` don't exist in Supabase yet — Edwin needs to run the
     updated file in the SQL editor before any of these sync for real
     (IndexedDB/local will still work, sync will silently no-op until then,
     same graceful-degradation behavior as any other offline case).
