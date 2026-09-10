// ---------- IndexedDB setup ----------
const DB_NAME = 'food-tracker';
const DB_VERSION = 5;
let db;

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = e => {
      const d = e.target.result;
      if (!d.objectStoreNames.contains('foods')) {
        const s = d.createObjectStore('foods', { keyPath: 'id', autoIncrement: true });
        s.createIndex('name', 'name', { unique: false });
        s.createIndex('barcode', 'barcode', { unique: false });
      } else if (e.oldVersion < 3) {
        // v2 -> v3: added barcode scanning, existing installs need the index added in place.
        const s = e.target.transaction.objectStore('foods');
        if (!s.indexNames.contains('barcode')) s.createIndex('barcode', 'barcode', { unique: false });
      }
      if (!d.objectStoreNames.contains('recipes')) {
        d.createObjectStore('recipes', { keyPath: 'id', autoIncrement: true });
      }
      if (!d.objectStoreNames.contains('logs')) {
        const s = d.createObjectStore('logs', { keyPath: 'id', autoIncrement: true });
        s.createIndex('date', 'date', { unique: false });
      }
      if (!d.objectStoreNames.contains('exercises')) {
        const s = d.createObjectStore('exercises', { keyPath: 'id', autoIncrement: true });
        s.createIndex('name', 'name', { unique: false });
      }
      if (!d.objectStoreNames.contains('workouts')) {
        const s = d.createObjectStore('workouts', { keyPath: 'id', autoIncrement: true });
        s.createIndex('date', 'date', { unique: false });
      }
      if (!d.objectStoreNames.contains('quarters')) {
        const s = d.createObjectStore('quarters', { keyPath: 'id', autoIncrement: true });
        s.createIndex('date', 'date', { unique: false });
        s.createIndex('date_time', ['date', 'time'], { unique: true });
      }
      if (!d.objectStoreNames.contains('weights')) {
        const s = d.createObjectStore('weights', { keyPath: 'id', autoIncrement: true });
        s.createIndex('date', 'date', { unique: true });
      }
    };
    req.onsuccess = e => { db = e.target.result; resolve(db); };
    req.onerror = e => reject(e);
  });
}

function tx(store, mode = 'readonly') {
  return db.transaction(store, mode).objectStore(store);
}
function reqToPromise(req) {
  return new Promise((res, rej) => { req.onsuccess = () => res(req.result); req.onerror = () => rej(req.error); });
}
async function getAll(store) { return reqToPromise(tx(store).getAll()); }
async function add(store, obj) { return reqToPromise(tx(store, 'readwrite').add(obj)); }
async function put(store, obj) { return reqToPromise(tx(store, 'readwrite').put(obj)); }
async function del(store, id) { return reqToPromise(tx(store, 'readwrite').delete(id)); }
async function getById(store, id) { return reqToPromise(tx(store).get(id)); }
// Date-scoped stores (logs/workouts/quarters/weights) have a `date` index -- use it instead
// of getAll()+filter so a render only touches today's rows, not the whole history. This
// matters a lot for quarters (up to 96 rows/day) and logs, both of which grow forever.
async function getAllByIndex(store, indexName, key) { return reqToPromise(tx(store).index(indexName).getAll(key)); }
async function getByIndex(store, indexName, key) { return reqToPromise(tx(store).index(indexName).get(key)); }
async function getRecentByIndex(store, indexName, upperBound, limit) {
  return new Promise((resolve, reject) => {
    const results = [];
    const req = tx(store).index(indexName).openCursor(IDBKeyRange.upperBound(upperBound), 'prev');
    req.onsuccess = e => {
      const cursor = e.target.result;
      if (cursor && results.length < limit) { results.push(cursor.value); cursor.continue(); }
      else resolve(results);
    };
    req.onerror = () => reject(req.error);
  });
}

// ---------- Quarters: 96 slots/day, same category rules as ~/quarters/quarters.html ----------
// Kept byte-for-byte identical to the original artifact's `RULES` (per the quarters skill:
// never re-derive these, read them out of the source of truth) so a label categorizes the
// same way in both places.
const Q_RULES = [
  ['sleep',   ['sleep','asleep','nap','bed','went to bed','in bed','bedtime']],
  ['consume', ['doomscroll','doomscrolling','doom scroll','scrolling','scroll','youtube','netflix','movie','film','tiktok','instagram','reddit','twitter','anime','series','episode','minecraft','gaming','game','watch','watching','podcast','vlog']],
  ['build',   ['claude','code','codex','coding','loome','website','build','building','deploy','ledge','audit','auditing','apply','application','cv','resume','portfolio','project','script','debug','design','work']],
  ['study',   ['duolingo','study','studying','course','class','lecture','escp','exam','revision','thesis','read','reading','anki','homework','assignment']],
  ['health',  ['deeding','deading','walk','walking','bike','cycling','run','running','gym','lift','workout','stretch','shower','shit','toilet','bath','brush','eat','eating','food','lunch','dinner','breakfast','snack','cook','cooking','groceries','sunlight','rice','pringles','water']],
  ['people',  ['mommy','mom','mama','papa','family','keluarga','call with','facetime','friend','friends','girlfriend','date','hang out','dinner with']],
  ['admin',   ['email','mail','inbox','admin','errand','bank','laundry','clean','tidy','pack','packing','commute','metro','train','travel','dress','prepare','preparing','interview','appointment','doctor','visa','paperwork','plan','planning','diary','washing','dishes','plates','transcript']]
];
function qNormLabel(s) { return String(s || '').trim().toLowerCase().replace(/\s+/g, ' '); }
const Q_RULE_RX = Q_RULES.map(r => [r[0], r[1].map(k => new RegExp('\\b' + k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'i'))]);
function qGuessCat(label) {
  const n = qNormLabel(label);
  for (const [cat, rxList] of Q_RULE_RX) {
    if (rxList.some(rx => rx.test(n))) return cat;
  }
  return 'unsorted';
}
// A slot's raw text can hold more than one thing done in that 15 minutes, comma-separated
// (Edwin's own convention, e.g. "Duolingo, breakfast"). Each piece gets its own category;
// a slot with more than one activity stays unconfirmed, same rule as the tidy loop --
// he decides the real split, this just makes the pieces visible instead of guessing one.
function qSplitActivities(label) {
  return String(label || '').split(',').map(s => s.trim()).filter(Boolean)
    .map(text => ({ text, category: qGuessCat(text) }));
}
function qPad2(n) { return (n < 10 ? '0' : '') + n; }
function qSlotTime(i) { return qPad2(Math.floor(i / 4)) + ':' + qPad2((i % 4) * 15); }
const Q_SLOTKEYS = Array.from({ length: 96 }, (_, i) => qSlotTime(i));

// ---------- Seed dataset foods, re-syncing bundled entries without touching custom ones ----------
// Wrapped so a dead connection on first launch (elevator, subway, airplane mode) can't block
// the whole app from rendering. It just skips the re-sync and uses whatever's already local.
async function seedFoodsIfEmpty() {
  try {
    const existing = await getAll('foods');
    const existingByName = new Map(existing.map(f => [f.name.toLowerCase(), f]));
    const res = await fetch('./foods.json');
    if (!res.ok) throw new Error(`foods.json fetch failed (${res.status})`);
    const dataset = await res.json();
    for (const f of dataset) {
      const match = existingByName.get(f.name.toLowerCase());
      const row = { name: f.name, kcal100: f.kcal, protein100: f.protein, carb100: f.carb, fat100: f.fat, source: 'dataset' };
      if (match) { row.id = match.id; await put('foods', row); }
      else { await add('foods', row); }
    }
  } catch (err) {
    console.warn('Food dataset sync skipped (offline or unreachable):', err);
  }
}

// ---------- One-time bulk import: German retailer foods (Lidl/Rewe/Edeka/Netto) ----------
// Unlike seedFoodsIfEmpty (135 curated entries, cheap to re-diff every launch), this is a
// ~5,000-row import from OpenFoodFacts (scripts/import_off_foods.py) -- diffing/putting all
// 5,000 rows on every app open would be needless IndexedDB churn on a phone, so it runs once,
// gated by a localStorage flag, not on every launch like the curated set.
const DE_IMPORT_FLAG = 'saulog_de_foods_imported_v1';
async function seedGermanFoodsIfEmpty() {
  if (localStorage.getItem(DE_IMPORT_FLAG)) return;
  try {
    const res = await fetch('./germany_foods.json');
    if (!res.ok) throw new Error(`germany_foods.json fetch failed (${res.status})`);
    const dataset = await res.json();
    const existing = await getAll('foods');
    const existingByBarcode = new Set(existing.map(f => f.barcode).filter(Boolean));
    for (const f of dataset) {
      if (existingByBarcode.has(f.barcode)) continue;
      await add('foods', {
        name: f.name, kcal100: f.kcal, protein100: f.protein, carb100: f.carb, fat100: f.fat,
        barcode: f.barcode, source: 'off-de'
      });
    }
    localStorage.setItem(DE_IMPORT_FLAG, String(dataset.length));
  } catch (err) {
    console.warn('German food import skipped (offline or unreachable):', err);
    // Deliberately not setting the flag -- retry on next launch until it actually succeeds.
  }
}

// Same pattern as seedFoodsIfEmpty, for Buhat's exercise->muscle-group dictionary. Seeded
// from Nippard's own LIFT HISTORY.md and CURRENT BLOCK.md (2026-09-08). This is the
// small, stable, repeated set Edwin actually trains, not a generic exercise database.
async function seedExercisesIfEmpty() {
  try {
    const existing = await getAll('exercises');
    const existingByName = new Map(existing.map(e => [e.name.toLowerCase(), e]));
    const res = await fetch('./workouts.json');
    if (!res.ok) throw new Error(`workouts.json fetch failed (${res.status})`);
    const dataset = await res.json();
    for (const e of dataset) {
      const match = existingByName.get(e.name.toLowerCase());
      const row = { name: e.name, muscle: e.muscle, split: e.split, source: 'dataset' };
      if (match) { row.id = match.id; await put('exercises', row); }
      else { await add('exercises', row); }
    }
  } catch (err) {
    console.warn('Exercise dataset sync skipped (offline or unreachable):', err);
  }
}

// ---------- Helpers ----------
function scaleNutrition(per100, grams) {
  const factor = grams / 100;
  return {
    kcal: round1(per100.kcal100 * factor),
    protein: round1(per100.protein100 * factor),
    carb: round1(per100.carb100 * factor),
    fat: round1(per100.fat100 * factor)
  };
}
function round1(n) { return Math.round(n * 10) / 10; }
function todayStr() {
  const d = new Date();
  return d.toISOString().slice(0, 10);
}
function nowTimeStr() {
  const d = new Date();
  return d.toTimeString().slice(0, 5);
}
function formatFullDate(isoDate) {
  const [y, m, d] = isoDate.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
}
const RESTAURANT_BUMP = 1.15;

// Nippard system targets, set 14 Aug 2026 (~/Documents/claude/Nippard/03_NUTRITION/TARGETS.md).
// This is only the offline/never-synced fallback now. See syncTargets() below, which
// overrides it from Supabase's `targets` table (the Nippard -> Kain direction of the sync).
const DEFAULT_TARGETS = { kcal: 2300, protein: 150, fat: 70, carb: 265 };
let TARGETS = { ...DEFAULT_TARGETS };

function loadCachedTargets() {
  try {
    const raw = localStorage.getItem('saulog_targets');
    if (!raw) return;
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed.kcal === 'number') TARGETS = parsed;
  } catch {}
}

// Pulls Edwin's current Nippard targets from Supabase, if signed in and online. Read-only
// from the app's side, only Nippard's own scripts/push-targets.py (service_role key) can
// write this table, see supabase/schema.sql. Falls back to whatever was last cached in
// localStorage (or DEFAULT_TARGETS, if nothing's ever synced) on any failure.
async function syncTargets() {
  if (!supabaseConfigured() || !loadSbSession()) return;
  try {
    const res = await supabaseRequest('/rest/v1/targets?select=kcal,protein,fat,carb&limit=1');
    if (!res || !res.ok) return;
    const rows = await res.json();
    const row = rows[0];
    if (!row) return;
    TARGETS = { kcal: row.kcal, protein: row.protein, fat: row.fat, carb: row.carb };
    try { localStorage.setItem('saulog_targets', JSON.stringify(TARGETS)); } catch {}
    await renderTotals();
  } catch (err) {
    console.warn('Targets sync skipped:', err);
  }
}

// ---------- USDA FoodData Central search ----------
// DEMO_KEY works with no signup (30 req/hr, 50/day per IP, shared by everyone using it).
// A personal key removes that cap: https://fdc.nal.usda.gov/api-key-signup. Pasted into
// Settings and kept in this device's localStorage only, never in source code.
const USDA_NUTRIENT_IDS = { kcal: 1008, protein: 1003, carb: 1005, fat: 1004 };

function getApiKey() {
  try { return localStorage.getItem('usda_api_key') || 'DEMO_KEY'; }
  catch { return 'DEMO_KEY'; }
}

async function searchUSDA(query) {
  const dataType = encodeURIComponent('Foundation,SR Legacy,Survey (FNDDS)');
  const url = `https://api.nal.usda.gov/fdc/v1/foods/search?api_key=${encodeURIComponent(getApiKey())}&query=${encodeURIComponent(query)}&pageSize=20&dataType=${dataType}`;

  // USDA's own gateway is measurably flaky. Identical requests intermittently 400 from a
  // subset of their backend instances (confirmed: ~50% failure rate on repeated identical
  // calls, alternating pass/fail). One bounded retry absorbs that without user-visible
  // failure; a second real failure is treated as genuine and surfaces normally.
  let res;
  for (let attempt = 0; attempt < 2; attempt++) {
    res = await fetch(url);
    if (res.ok) break;
  }
  if (!res.ok) throw new Error(`USDA search failed (${res.status})`);
  const data = await res.json();
  return (data.foods || []).map(f => {
    const nutrients = {};
    for (const n of f.foodNutrients || []) {
      for (const key in USDA_NUTRIENT_IDS) {
        if (n.nutrientId === USDA_NUTRIENT_IDS[key]) nutrients[key] = n.value;
      }
    }
    return {
      name: f.description,
      kcal100: nutrients.kcal ?? 0,
      protein100: nutrients.protein ?? 0,
      carb100: nutrients.carb ?? 0,
      fat100: nutrients.fat ?? 0
    };
  }).filter(f => f.kcal100 > 0 || f.protein100 > 0);
}

// ---------- wger.de live exercise search (last-resort fallback) ----------
// Free, no key required. Only reached now when searchWgerCache() (below) misses -- i.e. the
// typed name isn't in the local wger_exercises.json snapshot at all, most likely because it's
// an exercise wger added after the cache was last built (scripts/build_wger_cache.py).
//
// wger removed its old free-text suggest endpoint (/api/v2/exercise/search/, used by the
// original build). It now 404s outright, confirmed by hand 2026-09-08. Its replacement
// list endpoint (exercise-translation) also has no working substring/fuzzy filter (its
// `search=` param is a silent no-op that returns the whole ~3300-row table unfiltered,
// also confirmed by hand), so this can only do an exact, case-sensitive name lookup,
// tried as typed, then Title Cased, since wger's own names are Title Case. Full fallback
// shape: local dictionary -> local wger cache (exact, then substring) -> live wger exact
// match -> ask Edwin.
// ---------- Local wger name cache (scripts/build_wger_cache.py -> wger_exercises.json) ----------
// A static snapshot of wger's ~3138 unique exercise names + muscle groups, built once offline
// (see the script for why: only 900 base exercises but ~3365 name variants/aliases across
// them, and wger's live `search=`/`name__icontains=` params are silent no-ops -- see the
// comment above searchWger). Checked before the live call so most typed names -- including
// ones that don't exactly match wger's canonical capitalization -- resolve with no network
// round trip at all. Lazy-loaded once per session; ~300KB, fine to hold in memory.
let wgerCachePromise = null;
function loadWgerCache() {
  if (!wgerCachePromise) {
    wgerCachePromise = fetch('./wger_exercises.json')
      .then(res => { if (!res.ok) throw new Error(`wger_exercises.json fetch failed (${res.status})`); return res.json(); })
      .catch(err => { console.warn('wger cache load failed:', err); wgerCachePromise = null; return []; });
  }
  return wgerCachePromise;
}
async function searchWgerCache(name) {
  const cache = await loadWgerCache();
  if (!cache.length) return null;
  const needle = name.trim().toLowerCase();
  if (!needle) return null;
  const exact = cache.find(e => e.name.toLowerCase() === needle);
  if (exact) return exact;
  // No exact hit: fall back to substring matching either direction, picking the shortest
  // candidate name (the most specific match, least likely to be a loosely-related exercise).
  const candidates = cache.filter(e => {
    const n = e.name.toLowerCase();
    return n.includes(needle) || needle.includes(n);
  });
  if (!candidates.length) return null;
  candidates.sort((a, b) => a.name.length - b.name.length);
  return candidates[0];
}

async function searchWger(name) {
  const variants = [...new Set([name, name.replace(/\w\S*/g, w => w[0].toUpperCase() + w.slice(1).toLowerCase())])];
  for (const variant of variants) {
    const url = `https://wger.de/api/v2/exercise-translation/?name=${encodeURIComponent(variant)}&language=2&format=json`;
    const res = await fetch(url);
    if (!res.ok) continue;
    const data = await res.json();
    const match = (data.results || [])[0];
    if (!match) continue;
    const infoRes = await fetch(`https://wger.de/api/v2/exerciseinfo/${match.exercise}/?format=json`);
    if (!infoRes.ok) return { name: match.name, muscle: null };
    const info = await infoRes.json();
    const primary = info.category && info.category.name;
    const secondaries = (info.muscles_secondary || []).map(m => m.name_en).filter(Boolean);
    const muscle = primary ? (secondaries.length ? `${primary}/${secondaries.join('/')}` : primary) : null;
    return { name: match.name, muscle };
  }
  return null;
}

// ---------- Supabase sync (Nippard/Sevro visibility) ----------
// Best-effort, write-through, on-demand only, no offline queue. A log made while offline or
// signed out stays local-only forever (this app doesn't retroactively sync past entries when
// connectivity returns). That's a known limitation, not an oversight. See HANDOFF.md.
//
// config.js supplies SUPABASE_URL/SUPABASE_ANON_KEY. The anon key is meant to be public;
// Row Level Security (supabase/schema.sql) is what actually protects the data, so a signed-in
// session is required for every read/write this app makes. See supabase/schema.sql.
function supabaseConfigured() {
  return typeof SUPABASE_URL === 'string' && SUPABASE_URL && typeof SUPABASE_ANON_KEY === 'string' && SUPABASE_ANON_KEY;
}
function loadSbSession() {
  try { return JSON.parse(localStorage.getItem('sb_session') || 'null'); }
  catch { return null; }
}
function saveSbSession(session) {
  try { localStorage.setItem('sb_session', JSON.stringify(session)); } catch {}
}
function clearSbSession() {
  try { localStorage.removeItem('sb_session'); } catch {}
}

async function supabaseSignIn(email, password) {
  if (!supabaseConfigured()) throw new Error('Supabase isn\'t configured yet. Fill in config.js first.');
  const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: SUPABASE_ANON_KEY },
    body: JSON.stringify({ email, password })
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error_description || data.msg || 'Sign in failed.');
  saveSbSession({ access_token: data.access_token, refresh_token: data.refresh_token, email });
  return data;
}

async function supabaseRefresh() {
  const session = loadSbSession();
  if (!session || !session.refresh_token) throw new Error('No refresh token.');
  const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: SUPABASE_ANON_KEY },
    body: JSON.stringify({ refresh_token: session.refresh_token })
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error_description || data.msg || 'Refresh failed.');
  const updated = { access_token: data.access_token, refresh_token: data.refresh_token, email: session.email };
  saveSbSession(updated);
  return updated;
}

async function supabaseRequest(path, options = {}) {
  if (!supabaseConfigured()) return null;
  const session = loadSbSession();
  if (!session) return null;
  const doFetch = token => fetch(`${SUPABASE_URL}${path}`, {
    ...options,
    headers: { 'Content-Type': 'application/json', apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${token}`, ...(options.headers || {}) }
  });
  let res = await doFetch(session.access_token);
  if (res.status === 401) {
    try {
      const refreshed = await supabaseRefresh();
      res = await doFetch(refreshed.access_token);
    } catch {
      clearSbSession();
      renderSyncStatus();
      return null;
    }
  }
  return res;
}

// Returns the new row's Supabase id, or null if the write didn't happen (offline, signed
// out, not configured, or a genuine failure). Callers must treat null as "stayed local-only."
async function syncInsert(table, row) {
  try {
    const res = await supabaseRequest(`/rest/v1/${table}`, {
      method: 'POST',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify(row)
    });
    if (!res || !res.ok) return null;
    const data = await res.json();
    return data[0] ? data[0].id : null;
  } catch (err) {
    console.warn(`Supabase sync skipped for ${table}:`, err);
    return null;
  }
}
async function syncUpdate(table, supaId, row) {
  if (!supaId) return false;
  try {
    const res = await supabaseRequest(`/rest/v1/${table}?id=eq.${encodeURIComponent(supaId)}`, {
      method: 'PATCH',
      body: JSON.stringify(row)
    });
    return !!(res && res.ok);
  } catch (err) {
    console.warn(`Supabase update skipped for ${table}:`, err);
    return false;
  }
}
async function syncDelete(table, supaId) {
  if (!supaId) return;
  try { await supabaseRequest(`/rest/v1/${table}?id=eq.${encodeURIComponent(supaId)}`, { method: 'DELETE' }); }
  catch (err) { console.warn(`Supabase delete skipped for ${table}:`, err); }
}

function renderSyncStatus() {
  const status = $('#syncStatus');
  const signedOutBox = $('#syncSignedOut');
  const signOutBtn = $('#syncSignOutBtn');
  if (!status) return;
  if (!supabaseConfigured()) {
    status.textContent = 'Not configured. Fill in config.js (see HANDOFF.md) to enable sync.';
    signedOutBox.style.display = 'none';
    signOutBtn.style.display = 'none';
    return;
  }
  const session = loadSbSession();
  if (session) {
    status.textContent = `✓ Signed in as ${session.email}. New logs sync while online.`;
    signedOutBox.style.display = 'none';
    signOutBtn.style.display = 'inline-block';
  } else {
    status.textContent = 'Signed out. Logs stay phone-only until you sign in.';
    signedOutBox.style.display = 'block';
    signOutBtn.style.display = 'none';
  }
}

async function handleSyncSignIn() {
  const email = $('#syncEmail').value.trim();
  const password = $('#syncPassword').value;
  if (!email || !password) { alert('Enter both email and password.'); return; }
  try {
    await supabaseSignIn(email, password);
    $('#syncPassword').value = '';
    renderSyncStatus();
    await syncTargets();
    await renderHealth();
  } catch (err) {
    alert(err.message);
  }
}
function handleSyncSignOut() {
  clearSbSession();
  renderSyncStatus();
  renderHealth();
}

// ---------- Rendering ----------
const $ = sel => document.querySelector(sel);
const $$ = sel => document.querySelectorAll(sel);

let currentDate = todayStr();

// Full refresh -- every tab, every store. Only for init() and date navigation (currentDate
// changed under every tab at once). A single food/workout/recipe save should NOT go through
// this: it was rebuilding all three tabs (plus a live Supabase fetch for Health) on every
// single log, which is most of why logging food felt slow. See the narrower refreshers below.
async function refreshAll() {
  await renderLog();
  await renderFoodDatalist();
  await renderRecipeDatalist();
  await renderRecipeList();
  await renderExerciseDatalist();
  await renderWorkouts();
  await renderWeight();
  await renderHealth();
  await renderQuarters();
}

function isBuhatActive() {
  return !!$('#panel-buhat')?.classList.contains('active');
}

async function renderExerciseDatalist() {
  const exercises = await getAll('exercises');
  exercises.sort((a, b) => a.name.localeCompare(b.name));
  const dl = $('#exerciseList');
  dl.innerHTML = exercises.map(e => `<option value="${escapeHtml(e.name)}">`).join('');
  window._exercisesCache = exercises;
}

// With the German import, `foods` can run into the thousands -- capping matches shown is a
// real perf/usability need on a phone either way. This used to be a native <datalist>, but
// iOS renders a <datalist>'s suggestion popup in a way that can sit on top of the input's own
// text while typing (a known WebKit quirk) -- replaced with a plain dropdown we position and
// show/hide ourselves (see setupFoodSuggest/updateFoodSuggest below).
// renderFoodDatalist() itself (the getAll+sort) is only called on load and when a food is
// actually added to the library, not on every log/edit/delete -- see handleLogSubmit.
const FOOD_DATALIST_MAX = 60;
async function renderFoodDatalist() {
  const foods = await getAll('foods');
  foods.sort((a, b) => a.name.localeCompare(b.name));
  window._foodsCache = foods;
  updateFoodSuggest('logName', 'logNameSuggestions');
  updateFoodSuggest('ingName', 'ingNameSuggestions');
}
function foodMatches(query) {
  const foods = window._foodsCache || [];
  const q = query.trim().toLowerCase();
  return (q ? foods.filter(f => f.name.toLowerCase().includes(q)) : foods).slice(0, FOOD_DATALIST_MAX);
}
function updateFoodSuggest(inputId, listId) {
  const input = $('#' + inputId);
  const list = $('#' + listId);
  if (!input || !list) return;
  if (document.activeElement !== input) { list.hidden = true; return; } // don't refresh a closed list
  const matches = foodMatches(input.value);
  if (!matches.length) { list.hidden = true; list.innerHTML = ''; return; }
  list.innerHTML = matches.map(f => `<div class="suggest-item" data-name="${escapeHtml(f.name)}">${escapeHtml(f.name)}</div>`).join('');
  list.hidden = false;
}
function setupFoodSuggest(inputId, listId) {
  const input = $('#' + inputId);
  const list = $('#' + listId);
  input.addEventListener('focus', () => updateFoodSuggest(inputId, listId));
  input.addEventListener('input', () => updateFoodSuggest(inputId, listId));
  // mousedown, not click, fires before the input's blur -- click would arrive too late,
  // after blur has already hidden the list.
  list.addEventListener('mousedown', e => {
    const item = e.target.closest('[data-name]');
    if (!item) return;
    e.preventDefault();
    input.value = item.dataset.name;
    list.hidden = true;
    if (inputId === 'logName') updateWeightHint();
  });
  input.addEventListener('blur', () => { list.hidden = true; });
  input.addEventListener('keydown', e => { if (e.key === 'Escape') list.hidden = true; });
}

async function renderRecipeDatalist() {
  const recipes = await getAll('recipes');
  const dl = $('#recipeList');
  dl.innerHTML = recipes.map(r => `<option value="${escapeHtml(r.name)}">`).join('');
  window._recipesCache = recipes;
}

async function renderRecipeList() {
  const recipes = await getAll('recipes');
  const box = $('#recipesBox');
  if (recipes.length === 0) { box.innerHTML = '<p class="muted">No recipes yet.</p>'; return; }
  box.innerHTML = recipes.map(r => `
    <div class="card">
      <div class="row between">
        <strong>${escapeHtml(r.name)}</strong>
        <button class="ghost small danger" data-del-recipe="${r.id}">delete</button>
      </div>
      <div class="muted small"><em>${r.totalGrams}g total</em> · per 100g: <strong>${round1(r.kcal100)}</strong> kcal, P<strong>${round1(r.protein100)}</strong> C<strong>${round1(r.carb100)}</strong> F<strong>${round1(r.fat100)}</strong></div>
    </div>`).join('');
  box.querySelectorAll('[data-del-recipe]').forEach(btn => {
    btn.onclick = async () => { await del('recipes', Number(btn.dataset.delRecipe)); await renderRecipeDatalist(); await renderRecipeList(); };
  });
}

async function renderLog() {
  const all = await getAllByIndex('logs', 'date', currentDate);
  const entries = all.filter(l => !pendingDeletes.logs.has(l.id)).sort((a, b) => a.time.localeCompare(b.time));
  const box = $('#logBox');
  $('#logDate').textContent = formatFullDate(currentDate);

  if (entries.length === 0) {
    box.innerHTML = '<p class="muted">No entries for this day.</p>';
  } else {
    box.innerHTML = entries.map(e => `
      <div class="card">
        <div class="row between">
          <div>
            <strong>${escapeHtml(e.name)}</strong> ${e.isRestaurant ? '<span class="badge">restaurant</span>' : ''}
            <div class="muted small"><em>${e.time} · ${e.grams}g${e.quantity ? ' · ' + escapeHtml(e.quantity) : ''}</em></div>
            ${e.notes ? `<div class="muted small notes">${escapeHtml(e.notes)}</div>` : ''}
          </div>
          <span><button class="ghost small" data-edit-log="${e.id}">Edit</button> <button class="ghost small danger" data-del-log="${e.id}">×</button></span>
        </div>
        <div class="macros"><strong>${e.kcal}</strong> kcal · P <strong>${e.protein}</strong>g · C <strong>${e.carb}</strong>g · F <strong>${e.fat}</strong>g</div>
      </div>`).join('');
    box.querySelectorAll('[data-del-log]').forEach(btn => {
      btn.onclick = () => {
        const logId = Number(btn.dataset.delLog);
        const target = entries.find(e => e.id === logId);
        if (target) softDeleteLog(target);
      };
    });
    box.querySelectorAll('[data-edit-log]').forEach(btn => {
      btn.onclick = () => {
        const logId = Number(btn.dataset.editLog);
        const target = entries.find(e => e.id === logId);
        if (target) startEditLog(target);
      };
    });
  }
  await renderTotals(entries);
}

async function renderTotals(entries) {
  if (!entries) {
    entries = await getAllByIndex('logs', 'date', currentDate);
  }
  const totals = entries.reduce((acc, e) => {
    acc.kcal += e.kcal; acc.protein += e.protein; acc.carb += e.carb; acc.fat += e.fat;
    return acc;
  }, { kcal: 0, protein: 0, carb: 0, fat: 0 });
  $('#totals').innerHTML = `
    <div class="tot"><span>${round1(totals.kcal)}</span><label>kcal</label></div>
    <div class="tot"><span>${round1(totals.protein)}</span><label>protein g</label></div>
    <div class="tot"><span>${round1(totals.carb)}</span><label>carb g</label></div>
    <div class="tot"><span>${round1(totals.fat)}</span><label>fat g</label></div>`;
  renderTargets(totals);
}

function renderTargets(totals) {
  const rows = [
    { key: 'kcal', label: 'Calories', unit: 'kcal', floor: false },
    { key: 'protein', label: 'Protein', unit: 'g', floor: true },
    { key: 'fat', label: 'Fat', unit: 'g', floor: true },
    { key: 'carb', label: 'Carbs', unit: 'g', floor: false }
  ];
  $('#targets').innerHTML = rows.map(r => {
    const val = totals[r.key];
    const target = TARGETS[r.key];
    const pct = Math.min(100, round1(val / target * 100));
    const hit = r.floor ? val >= target : val <= target;
    const over = val > target;
    const barClass = r.floor ? (hit ? 'bar-good' : 'bar-under') : (over ? 'bar-over' : 'bar-good');
    const statusText = r.floor
      ? (hit ? '✓ floor met' : `${round1(target - val)}${r.unit} to floor`)
      : (over ? `${round1(val - target)}${r.unit} over` : `${round1(target - val)}${r.unit} left`);
    return `
      <div class="target-row">
        <div class="row between small">
          <strong>${r.label}</strong>
          <span class="muted"><strong>${round1(val)}</strong> / ${target}${r.unit} · <em>${statusText}</em></span>
        </div>
        <div class="bar-track"><div class="bar-fill ${barClass}" style="width:${pct}%"></div></div>
      </div>`;
  }).join('');
}

async function renderWorkouts() {
  const dateEl = $('#workoutDate');
  if (!dateEl) return; // Buhat panel not in DOM yet on first paint of an old cached index.html
  const all = await getAllByIndex('workouts', 'date', currentDate);
  const entries = all.filter(w => !pendingDeletes.workouts.has(w.id)).sort((a, b) => a.time.localeCompare(b.time));
  const box = $('#workoutBox');
  dateEl.textContent = formatFullDate(currentDate);

  if (entries.length === 0) {
    box.innerHTML = '<p class="muted">No exercises logged for this day.</p>';
  } else {
    box.innerHTML = entries.map(w => `
      <div class="card">
        <div class="row between">
          <div>
            <strong>${escapeHtml(w.exercise)}</strong> <span class="badge">${escapeHtml(w.split)}</span>
            <div class="muted small"><em>${w.time}${w.muscle && w.muscle !== 'Cardio' ? ' · ' + escapeHtml(w.muscle) : ''}</em></div>
            <div class="small">${w.cardio ? formatCardio(w.cardio) : (w.sets || []).map(s => `${s.weight}kg × ${s.reps}`).join(', ')}</div>
            ${w.notes ? `<div class="muted small notes">${escapeHtml(w.notes)}</div>` : ''}
          </div>
          <button class="ghost small danger" data-del-workout="${w.id}">×</button>
        </div>
      </div>`).join('');
    box.querySelectorAll('[data-del-workout]').forEach(btn => {
      btn.onclick = () => {
        const wId = Number(btn.dataset.delWorkout);
        const target = entries.find(w => w.id === wId);
        if (target) softDeleteWorkout(target);
      };
    });
  }
}

// ---------- Body weight (Buhat) ----------
// One entry per calendar day, tracks currentDate like the rest of the app. The real
// outcome measure for the recomp goal, which food/workout/time logs don't otherwise connect to.
async function renderWeight() {
  const today = await getByIndex('weights', 'date', currentDate);
  $('#weightInput').value = today ? today.kg : '';

  const recent = await getRecentByIndex('weights', 'date', currentDate, 5);
  $('#weightRecent').textContent = recent.length
    ? recent.map(w => `${w.date.slice(5)}: ${w.kg}kg`).join(' · ')
    : 'No entries yet.';
}

async function handleWeightSubmit(e) {
  e.preventDefault();
  const kg = Number($('#weightInput').value);
  if (!kg || kg <= 0) { alert('Enter a weight in kg.'); return; }

  const existing = await getByIndex('weights', 'date', currentDate);
  const entry = existing || { date: currentDate };
  entry.kg = round1(kg);
  entry.id = existing ? existing.id : await add('weights', entry);
  if (existing) await put('weights', entry);

  const supaRow = { date: entry.date, kg: entry.kg };
  if (entry.supaId) {
    await syncUpdate('weight_logs', entry.supaId, supaRow);
  } else {
    const supaId = await syncInsert('weight_logs', supaRow);
    if (supaId) { entry.supaId = supaId; await put('weights', entry); }
  }
  await renderWeight();
}

// ---------- Apple Health (read-only, synced-in-only) ----------
// health_logs is written entirely from outside this app, by the iOS Shortcut in
// docs/apple-health-shortcut.md, so there's no local IndexedDB store for it; the app only
// ever reads it from Supabase, and only when signed in (that's the only way this data can
// exist for the current user at all).
//
// There was a Strava card here too until 2026-09-09, dropped the same day: Strava moved API
// access behind a paid subscription, so strava_activities can never fill for Edwin and the
// card would have read "No Strava activity" every day forever. The backend half
// (scripts/sync_strava.py, the table, docs/strava-setup.md) is left dormant, see HANDOFF.md.
async function renderHealth() {
  const section = $('#healthSection');
  if (!section) return;
  // This is a live Supabase fetch, not a local read -- skip it whenever Buhat isn't the
  // visible tab (the section is invisible behind Kain/Quarters anyway) so saving a food log
  // or a Quarters slot never has to wait on a network round trip it doesn't need. Whatever
  // triggers a switch to Buhat calls this again to catch up.
  if (!isBuhatActive()) return;
  if (!supabaseConfigured() || !loadSbSession()) { section.hidden = true; return; }
  section.hidden = false;

  const healthBox = $('#healthBox');
  healthBox.textContent = 'Loading…';

  try {
    const cols = 'steps,sleep_hours,active_energy_kcal,exercise_minutes,workout_type,resting_hr';
    const res = await supabaseRequest(`/rest/v1/health_logs?select=${cols}&date=eq.${currentDate}&limit=1`);
    const rows = res && res.ok ? await res.json() : [];
    const row = rows[0];
    if (!row) {
      healthBox.textContent = `No Health data for ${currentDate.slice(5)} yet.`;
      return;
    }
    const parts = [
      row.steps != null ? `${row.steps.toLocaleString()} steps` : null,
      row.active_energy_kcal != null ? `${Math.round(row.active_energy_kcal)} kcal burned` : null,
      row.exercise_minutes != null ? `${Math.round(row.exercise_minutes)} min exercise` : null,
      row.workout_type ? escapeHtml(row.workout_type) : null,
      row.sleep_hours != null ? `${row.sleep_hours}h sleep` : null,
      row.resting_hr != null ? `${Math.round(row.resting_hr)} bpm resting` : null
    ].filter(Boolean);
    healthBox.innerHTML = parts.length ? parts.join(' · ') : 'Row synced, no fields set.';
  } catch (err) {
    console.warn('Health log fetch skipped:', err);
    healthBox.textContent = 'Couldn\'t load (offline?).';
  }
}

// ---------- Quarters render/save ----------
// One doc per slot in IndexedDB (`quarters`, unique on date+time). Category/activities are
// computed at save time and re-derivable any time from `label`, so nothing gets "finalized"
// on a timer -- see the note on why (iOS won't reliably run background JS at midnight for a
// home-screen PWA). The day summary below just recomputes from whatever's saved, live.
let quartersDayCache = [];

async function renderQuarters() {
  $('#quartersDate').textContent = formatFullDate(currentDate);
  const all = await getAllByIndex('quarters', 'date', currentDate);
  const byTime = new Map(all.map(q => [q.time, q]));
  quartersDayCache = Q_SLOTKEYS.map(t => byTime.get(t) || { date: currentDate, time: t, label: '', category: 'unsorted', activities: [] });

  const grid = $('#quartersGrid');
  grid.innerHTML = Q_SLOTKEYS.map((t, i) => {
    const entry = quartersDayCache[i];
    const hourStart = t.endsWith(':00') ? ' hour-start' : '';
    return `
      <div class="qrow${hourStart}">
        <span class="qtime">${t}</span>
        <span class="qdot" style="background:var(--c-${entry.category})"></span>
        <input type="text" data-qslot="${t}" value="${escapeHtml(entry.label)}" placeholder="—" autocomplete="off">
      </div>`;
  }).join('');

  grid.querySelectorAll('[data-qslot]').forEach(input => {
    input.addEventListener('change', () => saveQuarterSlot(input.dataset.qslot, input.value));
  });

  renderQuartersSummary();
  scrollQuartersToRelevantSlot();
}

// Rebuilding the grid always used to leave it scrolled to 00:00 -- fine at 6am, useless at
// 2pm when the row you actually need is 56 rows down. Land on today's current-time slot (or,
// for a past date, the last slot that's actually filled in) instead, so opening/reopening
// Quarters drops you where you'd type next rather than making you scroll down every time.
function scrollQuartersToRelevantSlot() {
  const grid = $('#quartersGrid');
  if (!grid) return;
  let targetTime;
  if (currentDate === todayStr()) {
    const now = new Date();
    targetTime = qPad2(now.getHours()) + ':' + qPad2(Math.floor(now.getMinutes() / 15) * 15);
  } else {
    const filled = quartersDayCache.filter(e => e.label);
    if (!filled.length) return;
    targetTime = filled[filled.length - 1].time;
  }
  const row = grid.querySelector(`[data-qslot="${targetTime}"]`)?.closest('.qrow');
  if (row) row.scrollIntoView({ block: 'center' });
}

async function saveQuarterSlot(time, rawLabel) {
  const label = rawLabel.trim();
  const activities = qSplitActivities(label);
  const category = activities.length ? activities[0].category : 'unsorted';
  const confirmed = activities.length <= 1;

  const existing = await getByIndex('quarters', 'date_time', [currentDate, time]);

  if (!label) {
    if (existing) {
      if (existing.supaId) await syncDelete('quarters_logs', existing.supaId);
      await del('quarters', existing.id);
    }
    await renderQuarters();
    return;
  }

  const entry = existing || { date: currentDate, time };
  Object.assign(entry, { label, category, activities, confirmed });
  entry.id = existing ? existing.id : await add('quarters', entry);
  if (existing) await put('quarters', entry);

  const supaRow = { date: entry.date, time: entry.time, label: entry.label, category: entry.category, confirmed: entry.confirmed };
  if (entry.supaId) {
    await syncUpdate('quarters_logs', entry.supaId, supaRow);
  } else {
    const supaId = await syncInsert('quarters_logs', supaRow);
    if (supaId) { entry.supaId = supaId; await put('quarters', entry); }
  }

  // Update the dot/state on that row without a full re-render, and the row below it (row's
  // own input already shows what the user typed, no need to touch its value).
  const row = $(`[data-qslot="${time}"]`)?.closest('.qrow');
  if (row) row.querySelector('.qdot').style.background = `var(--c-${category})`;
  renderQuartersSummary();
}

function renderQuartersSummary() {
  const box = $('#quartersSummary');
  if (!box) return;
  const totals = {};
  const activityList = [];
  let loggedSlots = 0;
  for (const entry of quartersDayCache) {
    if (!entry.label) continue;
    loggedSlots++;
    const activities = entry.activities && entry.activities.length ? entry.activities : qSplitActivities(entry.label);
    for (const a of activities) {
      totals[a.category] = (totals[a.category] || 0) + 15 / activities.length; // split the 15min across co-occurring activities
      activityList.push(a.text);
    }
  }
  if (loggedSlots === 0) { box.innerHTML = '<p class="muted small">No slots logged yet for this day.</p>'; return; }

  const catRows = Object.entries(totals).sort((a, b) => b[1] - a[1]).map(([cat, mins]) => {
    const h = Math.floor(mins / 60), m = Math.round(mins % 60);
    const dur = h && m ? `${h}h ${m}m` : h ? `${h}h` : `${m}m`;
    return `<div class="row between small" style="margin-bottom:4px;"><span><span class="qdot" style="background:var(--c-${cat}); display:inline-block; margin-right:6px;"></span>${cat}</span><span class="muted">${dur}</span></div>`;
  }).join('');

  const untracked = (96 - loggedSlots) * 15;
  const uh = Math.floor(untracked / 60), um = untracked % 60;
  const untrackedStr = uh && um ? `${uh}h ${um}m` : uh ? `${uh}h` : `${um}m`;

  // Unique activities, most-recent-first, deduped case-insensitively for a quick glance.
  const seen = new Set();
  const uniqueActivities = activityList.reverse().filter(a => {
    const k = a.toLowerCase();
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });

  box.innerHTML = `
    <div class="card">
      <strong class="small">Category totals</strong>
      <div style="margin-top:6px;">${catRows}</div>
      <div class="muted small" style="margin-top:4px;">${untrackedStr} untracked</div>
    </div>
    <div class="card">
      <strong class="small">Activities today (${uniqueActivities.length})</strong>
      <div class="muted small" style="margin-top:6px;">${uniqueActivities.map(escapeHtml).join(' · ')}</div>
    </div>`;
}

// ---------- Undo (soft-delete for logs/workouts) ----------
// A "deleted" row is hidden from render immediately but not actually removed from
// IndexedDB/Supabase until UNDO_DELAY_MS passes with no undo, so a mis-tap is always
// recoverable, for both Kain's food log and Buhat's workout log.
const UNDO_DELAY_MS = 5000;
const pendingDeletes = { logs: new Set(), workouts: new Set() };
const pendingTimers = {};

function showUndoToast(message, onUndo) {
  const toast = $('#undoToast');
  toast.querySelector('.undo-message').textContent = message;
  toast.hidden = false;
  clearTimeout(toast._hideTimer);
  toast._hideTimer = setTimeout(() => { toast.hidden = true; }, UNDO_DELAY_MS);
  $('#undoBtn').onclick = () => { onUndo(); toast.hidden = true; clearTimeout(toast._hideTimer); };
}

function softDeleteLog(entry) {
  pendingDeletes.logs.add(entry.id);
  renderLog();
  const timerKey = `log-${entry.id}`;
  pendingTimers[timerKey] = setTimeout(async () => {
    delete pendingTimers[timerKey];
    if (!pendingDeletes.logs.has(entry.id)) return; // already undone
    pendingDeletes.logs.delete(entry.id);
    await del('logs', entry.id);
    if (entry.supaId) await syncDelete('food_logs', entry.supaId);
  }, UNDO_DELAY_MS);
  showUndoToast(`Deleted "${entry.name}"`, () => {
    clearTimeout(pendingTimers[timerKey]);
    delete pendingTimers[timerKey];
    pendingDeletes.logs.delete(entry.id);
    renderLog();
  });
}

function softDeleteWorkout(entry) {
  pendingDeletes.workouts.add(entry.id);
  renderWorkouts();
  const timerKey = `workout-${entry.id}`;
  pendingTimers[timerKey] = setTimeout(async () => {
    delete pendingTimers[timerKey];
    if (!pendingDeletes.workouts.has(entry.id)) return; // already undone
    pendingDeletes.workouts.delete(entry.id);
    await del('workouts', entry.id);
    if (entry.supaId) await syncDelete('workout_logs', entry.supaId);
  }, UNDO_DELAY_MS);
  showUndoToast(`Deleted "${entry.exercise}"`, () => {
    clearTimeout(pendingTimers[timerKey]);
    delete pendingTimers[timerKey];
    pendingDeletes.workouts.delete(entry.id);
    renderWorkouts();
  });
}

function formatCardio(c) {
  const parts = [`${c.distanceKm}km`];
  if (c.timeMin) parts.push(`${c.timeMin}min`);
  if (c.pace) parts.push(`${c.pace}/km`);
  if (c.avgHr) parts.push(`${c.avgHr}bpm avg`);
  if (c.kcal) parts.push(`${c.kcal}kcal`);
  return parts.join(' · ');
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// ---------- Log a food/recipe entry ----------
async function findFoodByName(name) {
  const foods = window._foodsCache || await getAll('foods');
  return foods.find(f => f.name.toLowerCase() === name.trim().toLowerCase());
}
async function findRecipeByName(name) {
  const recipes = window._recipesCache || await getAll('recipes');
  return recipes.find(r => r.name.toLowerCase() === name.trim().toLowerCase());
}
async function findFoodByBarcode(barcode) {
  const foods = window._foodsCache || await getAll('foods');
  return foods.find(f => f.barcode === barcode);
}
async function findExerciseByName(name) {
  const exercises = window._exercisesCache || await getAll('exercises');
  return exercises.find(e => e.name.toLowerCase() === name.trim().toLowerCase());
}

// Whole-produce items where "how many/what size" is the natural unit, not a gram guess.
// USDA/average reference weights, edible portion, per single item.
const TYPICAL_WEIGHTS = {
  'banana': 'small ≈ 101g · medium ≈ 118g · large ≈ 136g',
  'orange': 'small ≈ 96g · medium ≈ 131g · large ≈ 184g',
  'mandarin': 'one ≈ 74g',
  'apple': 'small ≈ 149g · medium ≈ 182g · large ≈ 223g',
  'avocado': 'half ≈ 100g · whole ≈ 200g'
};

function updateWeightHint() {
  const hint = $('#weightHint');
  const name = $('#logName').value.trim().toLowerCase();
  const match = Object.keys(TYPICAL_WEIGHTS).find(k => name.includes(k));
  if (match) { hint.textContent = TYPICAL_WEIGHTS[match]; hint.hidden = false; }
  else { hint.hidden = true; }
}

// ---------- Edit an already-logged entry ----------
let editingLogEntry = null;

function startEditLog(entry) {
  editingLogEntry = entry;
  $('#logName').value = entry.name;
  $('#logGrams').value = entry.grams;
  $('#logNotes').value = entry.notes || '';
  $('#logRestaurant').checked = !!entry.isRestaurant;
  updateWeightHint();
  $('#logSubmitBtn').textContent = 'Save changes';
  $('#logCancelEditBtn').hidden = false;
  $('#logForm').scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function cancelEditLog() {
  editingLogEntry = null;
  $('#logName').value = ''; $('#logGrams').value = ''; $('#logNotes').value = ''; $('#logRestaurant').checked = false;
  $('#weightHint').hidden = true;
  $('#logSubmitBtn').textContent = 'Log entry';
  $('#logCancelEditBtn').hidden = true;
}

async function handleLogSubmit(e) {
  e.preventDefault();
  const name = $('#logName').value.trim();
  const grams = Number($('#logGrams').value);
  const notes = $('#logNotes').value.trim();
  const isRestaurant = $('#logRestaurant').checked;
  if (!name || !grams || grams <= 0) { alert('Enter a food/recipe name and a weight in grams.'); return; }

  if (editingLogEntry) { await saveEditedLog(editingLogEntry, name, grams, notes, isRestaurant); return; }

  let food = await findFoodByName(name);
  let recipe = !food ? await findRecipeByName(name) : null;
  let addedNewFood = false;

  if (!food && !recipe) {
    // Unknown food -> prompt for manual macro entry (per 100g), save to library
    const kcal = Number(prompt(`"${name}" is not in your library.\nEnter calories per 100g:`));
    if (!isFinite(kcal) || kcal < 0) { alert('Calories must be a number ≥ 0. Nothing was logged.'); return; }
    const parseMacro = raw => { const n = Number(raw || 0); return isFinite(n) && n >= 0 ? n : 0; };
    const protein = parseMacro(prompt('Protein per 100g (g):'));
    const carb = parseMacro(prompt('Carbs per 100g (g):'));
    const fat = parseMacro(prompt('Fat per 100g (g):'));
    const newFood = { name, kcal100: kcal, protein100: protein, carb100: carb, fat100: fat, source: 'custom' };
    const id = await add('foods', newFood);
    newFood.id = id;
    food = newFood;
    addedNewFood = true;
  }

  let nutrition, itemType, itemId;
  if (food) {
    nutrition = scaleNutrition(food, grams);
    itemType = 'food'; itemId = food.id;
  } else {
    nutrition = scaleNutrition({ kcal100: recipe.kcal100, protein100: recipe.protein100, carb100: recipe.carb100, fat100: recipe.fat100 }, grams);
    itemType = 'recipe'; itemId = recipe.id;
  }

  if (isRestaurant) {
    nutrition.kcal = round1(nutrition.kcal * RESTAURANT_BUMP);
    nutrition.fat = round1(nutrition.fat * RESTAURANT_BUMP);
  }

  const entry = {
    date: currentDate, time: nowTimeStr(), name, grams, notes,
    kcal: nutrition.kcal, protein: nutrition.protein, carb: nutrition.carb, fat: nutrition.fat,
    isRestaurant, itemType, itemId
  };
  const id = await add('logs', entry);
  entry.id = id;

  const supaId = await syncInsert('food_logs', {
    date: entry.date, time: entry.time, name: entry.name, grams: entry.grams,
    notes: entry.notes, kcal: entry.kcal, protein: entry.protein, carb: entry.carb, fat: entry.fat,
    is_restaurant: entry.isRestaurant, item_type: entry.itemType, item_id: String(entry.itemId)
  });
  if (supaId) { entry.supaId = supaId; await put('logs', entry); }

  $('#logName').value = ''; $('#logGrams').value = ''; $('#logNotes').value = ''; $('#logRestaurant').checked = false;
  // A food log never touches recipes/exercises/workouts/weight/health/quarters, and the food
  // library only changed if this was a genuinely new custom food -- so only re-render those,
  // not the whole app, on every single entry. This (plus the Health-fetch gate above) is the
  // main fix for logging feeling slow.
  await renderLog();
  if (addedNewFood) await renderFoodDatalist();
}

async function saveEditedLog(entry, name, grams, notes, isRestaurant) {
  const food = await findFoodByName(name);
  const recipe = !food ? await findRecipeByName(name) : null;
  if (!food && !recipe) { alert(`"${name}" isn't in your library. Pick an existing food/recipe name, or delete and re-log to add a new one.`); return; }

  let nutrition, itemType, itemId;
  if (food) { nutrition = scaleNutrition(food, grams); itemType = 'food'; itemId = food.id; }
  else { nutrition = scaleNutrition({ kcal100: recipe.kcal100, protein100: recipe.protein100, carb100: recipe.carb100, fat100: recipe.fat100 }, grams); itemType = 'recipe'; itemId = recipe.id; }

  if (isRestaurant) {
    nutrition.kcal = round1(nutrition.kcal * RESTAURANT_BUMP);
    nutrition.fat = round1(nutrition.fat * RESTAURANT_BUMP);
  }

  Object.assign(entry, {
    name, grams, notes, isRestaurant, itemType, itemId,
    kcal: nutrition.kcal, protein: nutrition.protein, carb: nutrition.carb, fat: nutrition.fat
  });
  await put('logs', entry);

  if (entry.supaId) {
    await syncUpdate('food_logs', entry.supaId, {
      name: entry.name, grams: entry.grams, notes: entry.notes,
      kcal: entry.kcal, protein: entry.protein, carb: entry.carb, fat: entry.fat,
      is_restaurant: entry.isRestaurant, item_type: entry.itemType, item_id: String(entry.itemId)
    });
  }

  cancelEditLog();
  // Editing requires an existing food/recipe name, so the library itself never changes here.
  await renderLog();
}

// ---------- Recipe builder ----------
let recipeIngredients = [];

function renderRecipeBuilder() {
  const box = $('#recipeIngredients');
  if (recipeIngredients.length === 0) { box.innerHTML = '<p class="muted small">No ingredients added yet.</p>'; return; }
  box.innerHTML = recipeIngredients.map((ing, i) => `
    <div class="row between">
      <span><strong>${escapeHtml(ing.name)}</strong> · <em>${ing.grams}g</em></span>
      <button class="ghost small" data-rm-ing="${i}">×</button>
    </div>`).join('');
  box.querySelectorAll('[data-rm-ing]').forEach(btn => {
    btn.onclick = () => { recipeIngredients.splice(Number(btn.dataset.rmIng), 1); renderRecipeBuilder(); };
  });
}

async function handleAddIngredient(e) {
  e.preventDefault();
  const name = $('#ingName').value.trim();
  const grams = Number($('#ingGrams').value);
  if (!name || !grams || grams <= 0) return;
  const food = await findFoodByName(name);
  if (!food) { alert(`"${name}" is not in your food library yet. Log it once as a manual food first, then use it in a recipe.`); return; }
  recipeIngredients.push({ foodId: food.id, name: food.name, grams, per100: food });
  $('#ingName').value = ''; $('#ingGrams').value = '';
  renderRecipeBuilder();
}

async function handleSaveRecipe(e) {
  e.preventDefault();
  const name = $('#recipeName').value.trim();
  if (!name) { alert('Name the recipe.'); return; }
  if (recipeIngredients.length === 0) { alert('Add at least one ingredient.'); return; }

  const totals = recipeIngredients.reduce((acc, ing) => {
    const n = scaleNutrition(ing.per100, ing.grams);
    acc.kcal += n.kcal; acc.protein += n.protein; acc.carb += n.carb; acc.fat += n.fat;
    acc.grams += ing.grams;
    return acc;
  }, { kcal: 0, protein: 0, carb: 0, fat: 0, grams: 0 });

  const recipe = {
    name,
    ingredients: recipeIngredients.map(i => ({ foodId: i.foodId, name: i.name, grams: i.grams })),
    totalGrams: totals.grams,
    kcal100: totals.kcal / totals.grams * 100,
    protein100: totals.protein / totals.grams * 100,
    carb100: totals.carb / totals.grams * 100,
    fat100: totals.fat / totals.grams * 100
  };
  await add('recipes', recipe);
  recipeIngredients = [];
  $('#recipeName').value = '';
  renderRecipeBuilder();
  // Saving a recipe only touches the recipes store -- no need to also re-render Log/foods/
  // Buhat/Quarters.
  await renderRecipeDatalist();
  await renderRecipeList();
}

// ---------- Buhat: workout logging ----------
let workoutSets = [];
let editingSetIndex = null; // index into workoutSets currently loaded into the weight/reps inputs for editing, or null
let resolvedMuscle = null; // { muscle, source } for whatever's currently typed in #wExercise

// Remembers the last weight used per exercise (localStorage, keyed by lowercased exercise
// name) so re-logging the same lift doesn't require retyping the weight for every set.
function getLastWeights() {
  try { return JSON.parse(localStorage.getItem('saulog_last_weights') || '{}'); }
  catch { return {}; }
}
function setLastWeight(exerciseName, weight) {
  const name = exerciseName.trim().toLowerCase();
  if (!name) return;
  try {
    const map = getLastWeights();
    map[name] = weight;
    localStorage.setItem('saulog_last_weights', JSON.stringify(map));
  } catch {}
}
function prefillLastWeight() {
  const name = $('#wExercise').value.trim();
  if (!name || $('#wWeight').value) return; // don't clobber a weight already typed
  const last = getLastWeights()[name.toLowerCase()];
  if (last != null) $('#wWeight').value = last;
}

function renderSetsPreview() {
  const el = $('#setsPreview');
  if (workoutSets.length === 0) { el.innerHTML = ''; return; }
  el.innerHTML = workoutSets.map((s, i) => `
    <div class="row between set-row">
      <span>${i + 1}. ${s.weight}kg × ${s.reps}</span>
      <span class="row" style="gap:4px;">
        <button type="button" class="ghost small" data-edit-set="${i}">edit</button>
        <button type="button" class="ghost small danger" data-del-set="${i}">×</button>
      </span>
    </div>`).join('');
  el.querySelectorAll('[data-edit-set]').forEach(btn => {
    btn.onclick = () => startEditSet(Number(btn.dataset.editSet));
  });
  el.querySelectorAll('[data-del-set]').forEach(btn => {
    btn.onclick = () => {
      const i = Number(btn.dataset.delSet);
      if (editingSetIndex === i) cancelEditSet();
      workoutSets.splice(i, 1);
      renderSetsPreview();
    };
  });
}

function startEditSet(i) {
  const s = workoutSets[i];
  $('#wWeight').value = s.weight;
  $('#wReps').value = s.reps;
  editingSetIndex = i;
  $('#addSetBtn').textContent = 'Update set';
}
function cancelEditSet() {
  editingSetIndex = null;
  $('#addSetBtn').textContent = 'Add set';
  $('#wWeight').value = ''; $('#wReps').value = '';
}

function handleAddSet() {
  const weight = Number($('#wWeight').value);
  const reps = Number($('#wReps').value);
  if (!(weight >= 0) || !(reps > 0)) { alert('Enter a weight (0 or more) and reps (more than 0) first.'); return; }
  if (editingSetIndex !== null) {
    workoutSets[editingSetIndex] = { weight, reps };
    editingSetIndex = null;
    $('#addSetBtn').textContent = 'Add set';
  } else {
    workoutSets.push({ weight, reps });
  }
  setLastWeight($('#wExercise').value.trim(), weight);
  // Weight is left in place (not cleared) since the next set for this exercise is
  // usually the same weight — only reps tends to change set to set.
  $('#wReps').value = '';
  renderSetsPreview();
}

// ---------- Buhat: cardio fields ----------
// Cardio splits skip muscle-group tagging and the weight/reps sets builder entirely —
// distance/time/pace describe a cardio session better than sets ever could.
function isCardioSplit() { return $('#wSplit').value === 'Cardio'; }

function updateSplitFieldVisibility() {
  const cardio = isCardioSplit();
  $('#strengthFields').hidden = cardio;
  $('#cardioFields').hidden = !cardio;
}
function updateCardioOtherVisibility() {
  $('#cardioOther').hidden = $('#cardioType').value !== 'Other';
}

// Fills in pace automatically from distance+time when the user hasn't typed one of their
// own — still a plain editable text input, this is just a starting guess.
function maybeAutoCardioPace() {
  if ($('#cardioPace').value.trim()) return;
  const distance = Number($('#cardioDistance').value);
  const time = Number($('#cardioTime').value);
  if (!(distance > 0) || !(time > 0)) return;
  const paceMin = time / distance;
  const min = Math.floor(paceMin);
  const sec = Math.round((paceMin - min) * 60);
  $('#cardioPace').value = `${min}:${String(sec).padStart(2, '0')}`;
}

// Auto-tags the typed exercise to a muscle group: local dictionary first (bundled +
// anything logged before), then wger.de live search, then asks Edwin directly, same
// fallback shape as Kain's unknown-food flow.
async function lookupMuscle() {
  const name = $('#wExercise').value.trim();
  const tagEl = $('#muscleTag');
  if (!name) { tagEl.textContent = ''; resolvedMuscle = null; return; }

  const local = await findExerciseByName(name);
  if (local) {
    resolvedMuscle = { muscle: local.muscle, source: local.source };
    tagEl.textContent = `Tagged: ${local.muscle}`;
    return;
  }

  tagEl.textContent = 'Looking up…';
  try {
    const cached = await searchWgerCache(name);
    if (cached && cached.muscle) {
      resolvedMuscle = { muscle: cached.muscle, source: 'wger' };
      tagEl.textContent = `Tagged (wger.de): ${cached.muscle}`;
      await add('exercises', { name, muscle: cached.muscle, split: null, source: 'wger' });
      await renderExerciseDatalist();
      return;
    }
  } catch (err) {
    console.warn('wger cache lookup failed:', err);
  }

  // Cache miss (exercise added to wger after the last cache build, or the fetch itself
  // failed) -- fall back to the live exact-name API call before giving up to the manual ask.
  try {
    const hit = await searchWger(name);
    if (hit && hit.muscle) {
      resolvedMuscle = { muscle: hit.muscle, source: 'wger' };
      tagEl.textContent = `Tagged (wger.de): ${hit.muscle}`;
      await add('exercises', { name, muscle: hit.muscle, split: null, source: 'wger' });
      await renderExerciseDatalist();
      return;
    }
  } catch (err) {
    console.warn('wger live lookup failed:', err);
  }

  const manual = prompt(`Couldn't auto-tag "${name}". Enter a muscle group (e.g. Chest/Triceps):`);
  if (manual && manual.trim()) {
    resolvedMuscle = { muscle: manual.trim(), source: 'custom' };
    tagEl.textContent = `Tagged: ${manual.trim()}`;
    await add('exercises', { name, muscle: manual.trim(), split: null, source: 'custom' });
    await renderExerciseDatalist();
  } else {
    resolvedMuscle = { muscle: null, source: null };
    tagEl.textContent = 'Not tagged. Logged without a muscle group.';
  }
}

async function handleWorkoutSubmit(e) {
  e.preventDefault();
  const split = $('#wSplit').value;
  const notes = $('#wNotes').value.trim();
  let exercise, muscle, sets = [], cardio = null;

  if (split === 'Cardio') {
    const type = $('#cardioType').value;
    exercise = type === 'Other' ? $('#cardioOther').value.trim() : type;
    if (!exercise) { alert('Name the cardio activity (pick a type, or fill in "Other").'); return; }
    const distanceKm = Number($('#cardioDistance').value);
    if (!(distanceKm > 0)) { alert('Enter a distance (km).'); return; }
    maybeAutoCardioPace();
    cardio = {
      type,
      distanceKm,
      timeMin: $('#cardioTime').value ? Number($('#cardioTime').value) : null,
      pace: $('#cardioPace').value.trim() || null,
      avgHr: $('#cardioHr').value ? Number($('#cardioHr').value) : null,
      kcal: $('#cardioKcal').value ? Number($('#cardioKcal').value) : null
    };
    muscle = 'Cardio';
  } else {
    exercise = $('#wExercise').value.trim();
    if (!exercise) { alert('Enter an exercise name.'); return; }
    if (workoutSets.length === 0) { alert('Add at least one set (weight + reps, then "Add set").'); return; }
    if (!resolvedMuscle) await lookupMuscle();
    muscle = resolvedMuscle ? resolvedMuscle.muscle : null;
    sets = workoutSets;
  }

  const entry = { date: currentDate, time: nowTimeStr(), split, exercise, muscle, sets, cardio, notes };
  const id = await add('workouts', entry);
  entry.id = id;

  // The Supabase `sets` column is jsonb with no shape constraint, so a cardio entry's
  // distance/time/pace object rides in the same column as a strength entry's set list —
  // split tells a reader which shape to expect.
  const supaId = await syncInsert('workout_logs', {
    date: entry.date, time: entry.time, split: entry.split, exercise: entry.exercise,
    muscle: entry.muscle, sets: entry.cardio || entry.sets, notes: entry.notes
  });
  if (supaId) { entry.supaId = supaId; await put('workouts', entry); }

  $('#wExercise').value = ''; $('#wNotes').value = ''; $('#muscleTag').textContent = '';
  $('#cardioDistance').value = ''; $('#cardioTime').value = ''; $('#cardioPace').value = '';
  $('#cardioHr').value = ''; $('#cardioKcal').value = '';
  workoutSets = []; resolvedMuscle = null;
  cancelEditSet();
  renderSetsPreview();
  await renderWorkouts();
}

// ---------- Search modal ----------
let searchTargetInput = null;

function openSearchModal(targetId) {
  searchTargetInput = $('#' + targetId);
  $('#searchInput').value = searchTargetInput.value || '';
  $('#searchResults').innerHTML = '';
  $('#searchStatus').textContent = '';
  $('#searchModal').hidden = false;
  $('#searchInput').focus();
}
function closeSearchModal() {
  $('#searchModal').hidden = true;
}

// ---------- Barcode scan modal ----------
// Lookup order (Edwin's call): local IndexedDB first (instant, offline-safe, covers the
// ~5,000-item German import), live OpenFoodFacts product lookup only if not found locally.
let scanTargetInput = null;
let scanner = null;

function openScanModal(targetId) {
  if (typeof Html5Qrcode === 'undefined') { alert('Barcode scanner failed to load (offline?). Use Search or type the name instead.'); return; }
  scanTargetInput = $('#' + targetId);
  $('#scanStatus').textContent = 'Point the camera at the barcode.';
  $('#scanModal').hidden = false;
  scanner = new Html5Qrcode('scanReader', { formatsToSupport: [Html5QrcodeSupportedFormats.EAN_13, Html5QrcodeSupportedFormats.EAN_8, Html5QrcodeSupportedFormats.UPC_A, Html5QrcodeSupportedFormats.UPC_E] });
  scanner.start({ facingMode: 'environment' }, { fps: 10, qrbox: { width: 250, height: 120 } }, onBarcodeDetected, () => {})
    .catch(err => { $('#scanStatus').textContent = `Camera failed: ${err}. Check camera permission in Settings.`; });
}

async function closeScanModal() {
  if (scanner) {
    try { await scanner.stop(); scanner.clear(); } catch (err) { /* already stopped */ }
    scanner = null;
  }
  $('#scanModal').hidden = true;
}

async function onBarcodeDetected(code) {
  if (!scanner) return; // already handling one, ignore repeat frames
  const active = scanner;
  scanner = null; // stop re-entrant detections while we look this one up
  try { await active.pause(true); } catch (err) { /* ignore */ }

  $('#scanStatus').textContent = `Found ${code}, looking up…`;
  let food = await findFoodByBarcode(code);
  if (!food) food = await lookupBarcodeLive(code);

  if (food) {
    if (scanTargetInput) scanTargetInput.value = food.name;
    await closeScanModal();
    await renderFoodDatalist();
  } else {
    $('#scanStatus').textContent = `"${code}" isn't in the local library or OpenFoodFacts. Close this and enter it manually, or use Search.`;
    scanner = active;
    try { await scanner.resume(); } catch (err) { /* ignore */ }
  }
}

// Live fallback for a barcode not in the ~5,000-item local import. Adds it to the food
// library on a hit so future scans/typing of the same product resolve locally.
async function lookupBarcodeLive(code) {
  try {
    const res = await fetch(`https://world.openfoodfacts.org/api/v2/product/${encodeURIComponent(code)}.json?fields=code,product_name,brands,nutriments`);
    if (!res.ok) return null;
    const data = await res.json();
    const p = data.product;
    const n = p && p.nutriments;
    if (!p || !n || n['energy-kcal_100g'] == null || n.proteins_100g == null || n.carbohydrates_100g == null || n.fat_100g == null) return null;
    const brand = (p.brands || '').split(',')[0].trim();
    let name = (p.product_name || '').trim();
    if (!name) return null;
    if (brand && !name.toLowerCase().includes(brand.toLowerCase())) name = `${name} (${brand})`;
    const row = {
      name, kcal100: round1(n['energy-kcal_100g']), protein100: round1(n.proteins_100g),
      carb100: round1(n.carbohydrates_100g), fat100: round1(n.fat_100g), barcode: code, source: 'off-live'
    };
    const id = await add('foods', row);
    return { id, ...row };
  } catch (err) {
    console.warn('Live OpenFoodFacts lookup failed:', err);
    return null;
  }
}

async function handleSearchSubmit(e) {
  e.preventDefault();
  const query = $('#searchInput').value.trim();
  if (!query) return;
  $('#searchStatus').textContent = 'Searching…';
  $('#searchResults').innerHTML = '';
  try {
    const results = await searchUSDA(query);
    if (results.length === 0) {
      $('#searchStatus').textContent = `No matches for "${query}". You can close this and enter it manually.`;
      return;
    }
    $('#searchStatus').innerHTML = `<strong>${results.length}</strong> result${results.length === 1 ? '' : 's'} · <em>values per 100g</em>`;
    $('#searchResults').innerHTML = results.map((r, i) => `
      <div class="search-result">
        <div>
          <div class="name"><strong>${escapeHtml(r.name)}</strong></div>
          <div class="macros-inline"><strong>${round1(r.kcal100)}</strong> kcal · P<strong>${round1(r.protein100)}</strong> C<strong>${round1(r.carb100)}</strong> F<strong>${round1(r.fat100)}</strong></div>
        </div>
        <button type="button" data-pick="${i}">Use</button>
      </div>`).join('');
    $('#searchResults').querySelectorAll('[data-pick]').forEach(btn => {
      btn.onclick = async () => {
        const r = results[Number(btn.dataset.pick)];
        let food = await findFoodByName(r.name);
        if (!food) {
          const id = await add('foods', { name: r.name, kcal100: r.kcal100, protein100: r.protein100, carb100: r.carb100, fat100: r.fat100, source: 'usda' });
          food = { id, ...r };
        }
        await renderFoodDatalist();
        if (searchTargetInput) searchTargetInput.value = food.name;
        closeSearchModal();
      };
    });
  } catch (err) {
    $('#searchStatus').textContent = 'Search failed. Check your connection and try again.';
  }
}

// ---------- Settings ----------
// The input is never re-populated with the stored key (even masked). Once saved, it's
// write-only from the UI's perspective, so there's nothing on screen to shoulder-surf.
function renderApiKeyStatus() {
  let stored = null;
  try { stored = localStorage.getItem('usda_api_key'); }
  catch { $('#apiKeyStatus').textContent = 'This browser is blocking local storage (private mode?). The key can\'t be saved here.'; return; }
  $('#apiKeyStatus').textContent = stored
    ? '✓ Personal key saved on this device.'
    : 'Using the shared demo key (30 searches/hour, shared with everyone else on it).';
  $('#apiKeyInput').value = '';
}
function handleSaveApiKey() {
  const val = $('#apiKeyInput').value.trim();
  if (!val) return;
  try { localStorage.setItem('usda_api_key', val); }
  catch {
    $('#apiKeyStatus').textContent = 'Could not save. This browser is blocking local storage (private mode?).';
    return;
  }
  renderApiKeyStatus();
}
function handleRemoveApiKey() {
  try { localStorage.removeItem('usda_api_key'); }
  catch { $('#apiKeyStatus').textContent = 'Could not remove. This browser is blocking local storage (private mode?).'; return; }
  renderApiKeyStatus();
}

// ---------- Date navigation ----------
function shiftDate(days) {
  const d = new Date(currentDate);
  d.setDate(d.getDate() + days);
  currentDate = d.toISOString().slice(0, 10);
  renderLog();
  renderWorkouts();
  renderWeight();
  renderHealth();
  renderQuarters();
}

// ---------- Tabs ----------
// Bottom nav only ever holds Kain/Buhat now. Settings moved to the header gear icon
// (⚙) so it doesn't compete for space in the tab bar. Kain itself hosts Log and
// Recipes as an internal subnav rather than separate top-level tabs.
function initTabs() {
  $$('.tab').forEach(tab => {
    tab.onclick = () => {
      $$('.tab').forEach(t => t.classList.remove('active'));
      $$('.panel').forEach(p => p.classList.remove('active'));
      $('#settingsGearBtn').classList.remove('active');
      tab.classList.add('active');
      $('#panel-' + tab.dataset.tab).classList.add('active');
      // Health is gated to Buhat-visible (see renderHealth) to keep it off the food-log path,
      // so catch it up here in case a date nav happened while another tab was showing.
      if (tab.dataset.tab === 'buhat') renderHealth();
      // scrollIntoView on a row is a no-op while the Quarters panel is display:none (e.g. the
      // very first renderQuarters() at init, before any tab is switched to), so re-run it here
      // once the panel is actually visible -- this is what makes opening Quarters land near
      // "now" instead of always at 00:00.
      if (tab.dataset.tab === 'quarters') scrollQuartersToRelevantSlot();
    };
  });
  $$('.subtab').forEach(sub => {
    sub.onclick = () => {
      $$('.subtab').forEach(s => s.classList.remove('active'));
      $$('.subpanel').forEach(p => p.classList.remove('active'));
      sub.classList.add('active');
      $('#sub-' + sub.dataset.subtab).classList.add('active');
    };
  });
  $('#settingsGearBtn').addEventListener('click', () => {
    $$('.panel').forEach(p => p.classList.remove('active'));
    $('#panel-settings').classList.add('active');
    $('#settingsGearBtn').classList.add('active');
  });
  $('#closeSettingsBtn').addEventListener('click', () => {
    $('#panel-settings').classList.remove('active');
    $('#settingsGearBtn').classList.remove('active');
    const activeTab = $('.tab.active') || $('.tab');
    $('#panel-' + activeTab.dataset.tab).classList.add('active');
  });
}

// ---------- Init ----------
async function init() {
  await openDB();
  loadCachedTargets();
  await seedFoodsIfEmpty();
  await seedGermanFoodsIfEmpty();
  await seedExercisesIfEmpty();
  loadWgerCache(); // fire-and-forget: warms the cache so the first Buhat tag doesn't wait on it
  await refreshAll();
  initTabs();

  $('#logForm').addEventListener('submit', handleLogSubmit);
  $('#logName').addEventListener('input', updateWeightHint);
  setupFoodSuggest('logName', 'logNameSuggestions');
  $('#logCancelEditBtn').addEventListener('click', cancelEditLog);
  $('#ingForm').addEventListener('submit', handleAddIngredient);
  setupFoodSuggest('ingName', 'ingNameSuggestions');
  $('#recipeForm').addEventListener('submit', handleSaveRecipe);
  $('#prevDay').addEventListener('click', () => shiftDate(-1));
  $('#nextDay').addEventListener('click', () => shiftDate(1));
  $('#todayBtn').addEventListener('click', () => { currentDate = todayStr(); renderLog(); renderWorkouts(); renderWeight(); renderQuarters(); });
  $('#searchFoodBtn').addEventListener('click', () => openSearchModal('logName'));
  $('#searchIngBtn').addEventListener('click', () => openSearchModal('ingName'));
  $('#closeSearchModal').addEventListener('click', closeSearchModal);
  $('#searchForm').addEventListener('submit', handleSearchSubmit);
  $('#scanBarcodeBtn').addEventListener('click', () => openScanModal('logName'));
  $('#closeScanModal').addEventListener('click', closeScanModal);
  $('#saveApiKeyBtn').addEventListener('click', handleSaveApiKey);
  $('#removeApiKeyBtn').addEventListener('click', handleRemoveApiKey);
  renderApiKeyStatus();

  renderRecipeBuilder();

  $('#workoutForm').addEventListener('submit', handleWorkoutSubmit);
  $('#addSetBtn').addEventListener('click', handleAddSet);
  $('#lookupMuscleBtn').addEventListener('click', async () => { await lookupMuscle(); prefillLastWeight(); });
  $('#wExercise').addEventListener('change', prefillLastWeight);
  $('#wSplit').addEventListener('change', updateSplitFieldVisibility);
  $('#cardioType').addEventListener('change', updateCardioOtherVisibility);
  $('#cardioDistance').addEventListener('change', maybeAutoCardioPace);
  $('#cardioTime').addEventListener('change', maybeAutoCardioPace);
  updateSplitFieldVisibility();
  updateCardioOtherVisibility();
  $('#wPrevDay').addEventListener('click', () => shiftDate(-1));
  $('#wNextDay').addEventListener('click', () => shiftDate(1));
  $('#wTodayBtn').addEventListener('click', () => { currentDate = todayStr(); renderLog(); renderWorkouts(); renderWeight(); });
  $('#weightForm').addEventListener('submit', handleWeightSubmit);
  $('#qPrevDay').addEventListener('click', () => shiftDate(-1));
  $('#qNextDay').addEventListener('click', () => shiftDate(1));
  $('#qTodayBtn').addEventListener('click', () => { currentDate = todayStr(); renderLog(); renderWorkouts(); renderWeight(); renderQuarters(); });

  $('#syncSignInBtn').addEventListener('click', handleSyncSignIn);
  $('#syncSignOutBtn').addEventListener('click', handleSyncSignOut);
  renderSyncStatus();
  syncTargets();

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  }
}

init();
