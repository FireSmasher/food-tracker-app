// ---------- IndexedDB setup ----------
const DB_NAME = 'food-tracker';
const DB_VERSION = 1;
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
async function seedFoodsIfEmpty() {
  const existing = await getAll('foods');
  const existingByName = new Map(existing.map(f => [f.name.toLowerCase(), f]));
  const res = await fetch('./foods.json');
  const dataset = await res.json();
  for (const f of dataset) {
    const match = existingByName.get(f.name.toLowerCase());
    const row = { name: f.name, kcal100: f.kcal, protein100: f.protein, carb100: f.carb, fat100: f.fat, source: 'dataset' };
    if (match) { row.id = match.id; await put('foods', row); }
    else { await add('foods', row); }
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
const RESTAURANT_BUMP = 1.15;

// Nippard system targets, set 14 Aug 2026 (~/Documents/claude/Nippard/03_NUTRITION/TARGETS.md)
const TARGETS = { kcal: 2300, protein: 150, fat: 70, carb: 265 };

// ---------- Rendering ----------
const $ = sel => document.querySelector(sel);
const $$ = sel => document.querySelectorAll(sel);

let currentDate = todayStr();

async function refreshAll() {
  await renderLog();
  await renderFoodDatalist();
  await renderRecipeDatalist();
  await renderRecipeList();
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
        <button class="ghost small" data-del-recipe="${r.id}">delete</button>
      </div>
      <div class="muted small">${r.totalGrams}g total · per 100g: ${round1(r.kcal100)} kcal, P${round1(r.protein100)} C${round1(r.carb100)} F${round1(r.fat100)}</div>
    </div>`).join('');
  box.querySelectorAll('[data-del-recipe]').forEach(btn => {
    btn.onclick = async () => { await del('recipes', Number(btn.dataset.delRecipe)); await refreshAll(); };
  });
}

async function renderLog() {
  const all = await getAll('logs');
  const entries = all.filter(l => l.date === currentDate).sort((a, b) => a.time.localeCompare(b.time));
  const box = $('#logBox');
  $('#logDate').textContent = currentDate;

  if (entries.length === 0) {
    box.innerHTML = '<p class="muted">No entries for this day.</p>';
  } else {
    box.innerHTML = entries.map(e => `
      <div class="card">
        <div class="row between">
          <div>
            <strong>${escapeHtml(e.name)}</strong> ${e.isRestaurant ? '<span class="badge">restaurant</span>' : ''}
            <div class="muted small">${e.time} · ${e.grams}g</div>
          </div>
          <button class="ghost small" data-del-log="${e.id}">×</button>
        </div>
        <div class="macros">${e.kcal} kcal · P ${e.protein}g · C ${e.carb}g · F ${e.fat}g</div>
      </div>`).join('');
    box.querySelectorAll('[data-del-log]').forEach(btn => {
      btn.onclick = async () => { await del('logs', Number(btn.dataset.delLog)); await renderLog(); await renderTotals(); };
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
          <span>${r.label}</span>
          <span class="muted">${round1(val)} / ${target}${r.unit} · ${statusText}</span>
        </div>
        <div class="bar-track"><div class="bar-fill ${barClass}" style="width:${pct}%"></div></div>
      </div>`;
  }).join('');
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

async function handleLogSubmit(e) {
  e.preventDefault();
  const name = $('#logName').value.trim();
  const grams = Number($('#logGrams').value);
  const isRestaurant = $('#logRestaurant').checked;
  if (!name || !grams || grams <= 0) { alert('Enter a food/recipe name and a weight in grams.'); return; }

  let food = await findFoodByName(name);
  let recipe = !food ? await findRecipeByName(name) : null;

  if (!food && !recipe) {
    // Unknown food -> prompt for manual macro entry (per 100g), save to library
    const kcal = Number(prompt(`"${name}" is not in your library.\nEnter calories per 100g:`));
    if (isNaN(kcal)) return;
    const protein = Number(prompt('Protein per 100g (g):') || 0);
    const carb = Number(prompt('Carbs per 100g (g):') || 0);
    const fat = Number(prompt('Fat per 100g (g):') || 0);
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

  await add('logs', {
    date: currentDate, time: nowTimeStr(), name, grams,
    kcal: nutrition.kcal, protein: nutrition.protein, carb: nutrition.carb, fat: nutrition.fat,
    isRestaurant, itemType, itemId
  });

  $('#logName').value = ''; $('#logGrams').value = ''; $('#logRestaurant').checked = false;
  await refreshAll();
}

// ---------- Recipe builder ----------
let recipeIngredients = [];

function renderRecipeBuilder() {
  const box = $('#recipeIngredients');
  if (recipeIngredients.length === 0) { box.innerHTML = '<p class="muted small">No ingredients added yet.</p>'; return; }
  box.innerHTML = recipeIngredients.map((ing, i) => `
    <div class="row between">
      <span>${escapeHtml(ing.name)} — ${ing.grams}g</span>
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

// ---------- Date navigation ----------
function shiftDate(days) {
  const d = new Date(currentDate);
  d.setDate(d.getDate() + days);
  currentDate = d.toISOString().slice(0, 10);
  renderLog();
}

// ---------- Tabs ----------
function initTabs() {
  $$('.tab').forEach(tab => {
    tab.onclick = () => {
      $$('.tab').forEach(t => t.classList.remove('active'));
      $$('.panel').forEach(p => p.classList.remove('active'));
      tab.classList.add('active');
      $('#panel-' + tab.dataset.tab).classList.add('active');
    };
  });
}

// ---------- Init ----------
async function init() {
  await openDB();
  await seedFoodsIfEmpty();
  await refreshAll();
  initTabs();

  $('#logForm').addEventListener('submit', handleLogSubmit);
  $('#ingForm').addEventListener('submit', handleAddIngredient);
  $('#recipeForm').addEventListener('submit', handleSaveRecipe);
  $('#prevDay').addEventListener('click', () => shiftDate(-1));
  $('#nextDay').addEventListener('click', () => shiftDate(1));
  $('#todayBtn').addEventListener('click', () => { currentDate = todayStr(); renderLog(); });

  renderRecipeBuilder();

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  }
}

init();
