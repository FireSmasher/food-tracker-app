// ---------- IndexedDB setup ----------
const DB_NAME = 'food-tracker';
const DB_VERSION = 2;
let db;

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = e => {
      const d = e.target.result;
      if (!d.objectStoreNames.contains('foods')) {
        const s = d.createObjectStore('foods', { keyPath: 'id', autoIncrement: true });
        s.createIndex('name', 'name', { unique: false });
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

// ---------- wger.de exercise search (Buhat's muscle-group fallback) ----------
// Free, no key required. Used only when an exercise isn't already in the bundled/local
// dictionary.
//
// wger removed its old free-text suggest endpoint (/api/v2/exercise/search/, used by the
// original build). It now 404s outright, confirmed by hand 2026-09-08. Its replacement
// list endpoint (exercise-translation) also has no working substring/fuzzy filter (its
// `search=` param is a silent no-op that returns the whole ~3300-row table unfiltered,
// also confirmed by hand), so this can only do an exact, case-sensitive name lookup,
// tried as typed, then Title Cased, since wger's own names are Title Case. That's real
// but narrower than "fuzzy search": it hits when the typed name matches wger's naming,
// same overall fallback shape as before (local dictionary -> wger -> ask Edwin).
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
  } catch (err) {
    alert(err.message);
  }
}
function handleSyncSignOut() {
  clearSbSession();
  renderSyncStatus();
}

// ---------- Rendering ----------
const $ = sel => document.querySelector(sel);
const $$ = sel => document.querySelectorAll(sel);

let currentDate = todayStr();

async function refreshAll() {
  await renderLog();
  await renderFoodDatalist();
  await renderRecipeDatalist();
  await renderRecipeList();
  await renderExerciseDatalist();
  await renderWorkouts();
}

async function renderExerciseDatalist() {
  const exercises = await getAll('exercises');
  exercises.sort((a, b) => a.name.localeCompare(b.name));
  const dl = $('#exerciseList');
  dl.innerHTML = exercises.map(e => `<option value="${escapeHtml(e.name)}">`).join('');
  window._exercisesCache = exercises;
}

async function renderFoodDatalist() {
  const foods = await getAll('foods');
  foods.sort((a, b) => a.name.localeCompare(b.name));
  const dl = $('#foodList');
  dl.innerHTML = foods.map(f => `<option value="${escapeHtml(f.name)}">`).join('');
  window._foodsCache = foods;
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
    btn.onclick = async () => { await del('recipes', Number(btn.dataset.delRecipe)); await refreshAll(); };
  });
}

async function renderLog() {
  const all = await getAll('logs');
  const entries = all.filter(l => l.date === currentDate && !pendingDeletes.logs.has(l.id)).sort((a, b) => a.time.localeCompare(b.time));
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
          <button class="ghost small danger" data-del-log="${e.id}">×</button>
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
  }
  await renderTotals(entries);
}

async function renderTotals(entries) {
  if (!entries) {
    const all = await getAll('logs');
    entries = all.filter(l => l.date === currentDate);
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
  const all = await getAll('workouts');
  const entries = all.filter(w => w.date === currentDate && !pendingDeletes.workouts.has(w.id)).sort((a, b) => a.time.localeCompare(b.time));
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
async function findExerciseByName(name) {
  const exercises = window._exercisesCache || await getAll('exercises');
  return exercises.find(e => e.name.toLowerCase() === name.trim().toLowerCase());
}

async function handleLogSubmit(e) {
  e.preventDefault();
  const name = $('#logName').value.trim();
  const grams = Number($('#logGrams').value);
  const notes = $('#logNotes').value.trim();
  const isRestaurant = $('#logRestaurant').checked;
  if (!name || !grams || grams <= 0) { alert('Enter a food/recipe name and a weight in grams.'); return; }

  let food = await findFoodByName(name);
  let recipe = !food ? await findRecipeByName(name) : null;

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
  await refreshAll();
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
  await refreshAll();
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
    const hit = await searchWger(name);
    if (hit && hit.muscle) {
      resolvedMuscle = { muscle: hit.muscle, source: 'wger' };
      tagEl.textContent = `Tagged (wger.de): ${hit.muscle}`;
      await add('exercises', { name, muscle: hit.muscle, split: null, source: 'wger' });
      await renderExerciseDatalist();
      return;
    }
  } catch (err) {
    console.warn('wger lookup failed:', err);
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
  await seedExercisesIfEmpty();
  await refreshAll();
  initTabs();

  $('#logForm').addEventListener('submit', handleLogSubmit);
  $('#ingForm').addEventListener('submit', handleAddIngredient);
  $('#recipeForm').addEventListener('submit', handleSaveRecipe);
  $('#prevDay').addEventListener('click', () => shiftDate(-1));
  $('#nextDay').addEventListener('click', () => shiftDate(1));
  $('#todayBtn').addEventListener('click', () => { currentDate = todayStr(); renderLog(); renderWorkouts(); });
  $('#searchFoodBtn').addEventListener('click', () => openSearchModal('logName'));
  $('#searchIngBtn').addEventListener('click', () => openSearchModal('ingName'));
  $('#closeSearchModal').addEventListener('click', closeSearchModal);
  $('#searchForm').addEventListener('submit', handleSearchSubmit);
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
  $('#wTodayBtn').addEventListener('click', () => { currentDate = todayStr(); renderLog(); renderWorkouts(); });

  $('#syncSignInBtn').addEventListener('click', handleSyncSignIn);
  $('#syncSignOutBtn').addEventListener('click', handleSyncSignOut);
  renderSyncStatus();
  syncTargets();

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  }
}

init();
