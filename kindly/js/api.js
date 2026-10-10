// The static build's api.js.
//
// Same interface as the server-backed one, but there is no server: the
// catalogue and recipes are JSON loaded once, the engine is server/core/*
// running unmodified in the browser, and anything you change lives in
// localStorage. See scripts/build-static.mjs.
//
// Everything that needs a secret — craving interpretation, reading a pasted
// link, writing a new recipe, Instacart — refuses with a plain message rather
// than pretending. An API key cannot live in a public static site.

import { searchRecipes, tokenize } from '../core/search.mjs';
import { nutritionFor, gramsByIngredient } from '../core/nutrition.mjs';
import { transformLines, fidelity, methodNotes, kindTitle, rewriteSteps } from '../core/transform.mjs';
import { ingredientCost, basketLines, fmtUSD } from '../core/cost.mjs';
import { benefitsFor } from '../core/benefits.mjs';
import { tuneToTargets } from '../core/tune.mjs';
import { normaliseBounds, defaultBounds } from '../core/axes.mjs';

const KEY = 'kindly:v1';
const DEFAULT_PREFS = { level: 'vegetarian', store_slug: 'valley-market', targets: defaultBounds() };

let DB = null;

async function load() {
  if (DB) return DB;
  const [catalog, recipes] = await Promise.all([
    fetch('data/catalog.json').then((r) => r.json()),
    fetch('data/recipes.json').then((r) => r.json()),
  ]);

  const ingredients = new Map(catalog.ingredients.map((i) => [i.key, i]));
  const subs = new Map();
  for (const s of catalog.substitutions) {
    const k = `${s.from_key}|${s.level}`;
    if (!subs.has(k)) subs.set(k, []);
    subs.get(k).push(s);
  }

  const saved = loadLocal();
  const all = [...recipes, ...(saved.recipes || [])];

  DB = {
    ingredients, subs, catalog,
    axes: catalog.axes,
    stores: catalog.stores,
    byId: new Map(all.map((r) => [r.id, r])),
    bySlug: new Map(all.map((r) => [r.slug, r])),
    local: saved,
  };
  return DB;
}

// ---------------------------------------------------------------- storage

function loadLocal() {
  try {
    const raw = localStorage.getItem(KEY);
    const v = raw ? JSON.parse(raw) : {};
    return {
      prefs: { ...DEFAULT_PREFS, ...(v.prefs || {}) },
      saved: v.saved || [],
      recipes: v.recipes || [],
      lists: v.lists || [],
      nextId: v.nextId || 100000,
    };
  } catch {
    // Private browsing, blocked storage — the site still works, it just forgets.
    return { prefs: { ...DEFAULT_PREFS }, saved: [], recipes: [], lists: [], nextId: 100000 };
  }
}

function persist() {
  try { localStorage.setItem(KEY, JSON.stringify(DB.local)); } catch { /* nothing we can do */ }
}

function addRecipe(rec) {
  DB.local.recipes.push(rec);
  DB.byId.set(rec.id, rec);
  DB.bySlug.set(rec.slug, rec);
  persist();
}

const uniqueSlug = (base) => {
  const root = String(base).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'recipe';
  let slug = root, n = 2;
  while (DB.bySlug.has(slug)) slug = `${root}-${n++}`;
  return slug;
};

// ---------------------------------------------------------------- helpers

const supportsNutrition = (r) => r.kind === 'transformed' || r.kind === 'authored';
const productsFor = (slug) => new Map(Object.entries(DB.catalog.products[slug] || DB.catalog.products[DB.stores[0].slug]));
const hydrate = (r) => ({ ...r, saved: DB.local.saved.includes(r.id) });

function storeBySlug(slug) {
  return DB.stores.find((s) => s.slug === slug) || DB.stores[0];
}

function report(recipe, storeSlug) {
  const index = DB.ingredients;
  const store = storeBySlug(storeSlug || DB.local.prefs.store_slug);
  const products = productsFor(store.slug);
  const parent = recipe.parent_id ? DB.byId.get(recipe.parent_id) : null;

  const after = nutritionFor(recipe.ingredients, index, recipe.servings);
  const costAfter = ingredientCost(gramsByIngredient(recipe.ingredients, index), products);

  let benefits = null;
  if (parent) {
    const before = nutritionFor(parent.ingredients, index, parent.servings);
    const costBefore = ingredientCost(gramsByIngredient(parent.ingredients, index), products);
    benefits = benefitsFor({
      before: before.perServing, after: after.perServing,
      costBefore: costBefore.cents, costAfter: costAfter.cents, servings: recipe.servings,
    });
  }

  return {
    nutrition: { after: after.perServing, coverage: after.coverage, unmatched: after.unmatched },
    cost: { store: { slug: store.slug, name: store.name }, after_cents: costAfter.cents, after: fmtUSD(costAfter.cents) },
    benefits,
    fidelity: recipe.fidelity,
    transform: recipe.transform || { swaps: [], method_notes: [], unresolved: [] },
  };
}

function groceryList(id) {
  const list = DB.local.lists.find((l) => l.id === id);
  if (!list) throw new Error('No such list.');
  const buy = list.items.filter((i) => !i.unmatched && !i.likely_have);
  const staples = list.items.filter((i) => !i.unmatched && i.likely_have);
  const sum = (xs) => xs.reduce((a, i) => a + (i.price_cents || 0), 0);
  return {
    list, items: list.items,
    totals: {
      cents: sum(buy), display: fmtUSD(sum(buy)),
      staples_cents: sum(staples), staples_display: fmtUSD(sum(staples)),
      staples_count: staples.length,
      unmatched: list.items.filter((i) => i.unmatched).length,
    },
  };
}

const unavailable = (what) => {
  throw new Error(`${what} needs a server, so it is not available on this published copy. The full version runs locally.`);
};

// ---------------------------------------------------------------- api

export const api = {
  async bootstrap() {
    await load();
    return {
      stores: DB.stores,
      prefs: DB.local.prefs,
      llm: { enabled: false, model: null },
      instacart: { enabled: false },
      axes: DB.axes,
      static: true,
    };
  },

  async search(q) {
    await load();
    const intent = { terms: tokenize(q), boost: {}, plant_leaning: null, reading: null };
    const corpus = [...DB.byId.values()]
      .filter((r) => r.kind === 'seed' || r.kind === 'authored')
      .map((r) => ({ ...r, ingredientNames: r.ingredients.map((l) => l.raw_name) }));
    return { intent, results: searchRecipes(corpus, intent, { limit: 12 }), authored: null, authorNote: null };
  },

  async import() { await load(); unavailable('Reading a recipe from a link'); },
  async instacart() { await load(); unavailable('Sending to Instacart'); },

  async recipe(slug) {
    await load();
    const r = DB.bySlug.get(slug) || DB.byId.get(Number(slug));
    if (!r) throw new Error('No such recipe.');
    const out = { recipe: hydrate(r), supportsNutrition: supportsNutrition(r) };
    if (r.parent_id) out.parent = DB.byId.get(r.parent_id) || null;
    if (out.supportsNutrition) out.nutrition = nutritionFor(r.ingredients, DB.ingredients, r.servings);
    return out;
  },

  async transform(recipe_id, level, store_slug) {
    await load();
    const original = DB.byId.get(Number(recipe_id));
    if (!original) throw new Error('No such recipe.');

    // Prefer a version Claude already wrote: those are baked into the build and
    // are much better than anything the rules produce.
    //
    // A vegan version also satisfies someone who asked for plant-based — vegan
    // is the stricter set — so fall back to one rather than generating a weaker
    // rules version. Never the other way round. The server does NOT do this: it
    // can write a fresh vegetarian version on demand, so reusing a vegan one
    // there would be a downgrade rather than an upgrade.
    const made = [...DB.byId.values()].filter((r) => r.kind === 'transformed' && r.parent_id === original.id);
    const existing = made.find((r) => r.transform_level === level)
      || (level === 'vegetarian' ? made.find((r) => r.transform_level === 'vegan') : null);
    if (existing) return { recipe: hydrate(existing), reused: true, ...report(existing, store_slug) };

    // Otherwise run the same deterministic engine the server falls back to.
    const ctx = { ingredients: DB.ingredients, subs: DB.subs };
    const base = transformLines(original.ingredients, level, ctx);
    const title = kindTitle(original.title, level, base.swaps);
    const rec = {
      id: DB.local.nextId++,
      slug: uniqueSlug(title),
      title,
      blurb: original.blurb,
      cuisine: original.cuisine,
      servings: original.servings,
      prep_min: original.prep_min, cook_min: original.cook_min, effort: original.effort,
      diet: level, kind: 'transformed', emoji: original.emoji,
      tags: original.tags,
      provenance: `Adapted by Kindly from ${original.title}.`,
      parent_id: original.id, transform_level: level,
      fidelity: fidelity(original.ingredients, base.lines, base.swaps, base.unresolved, ctx, original.servings),
      ingredients: base.lines,
      steps: rewriteSteps(original.steps, base.swaps),
      transform: { swaps: base.swaps, method_notes: methodNotes(base.swaps), unresolved: base.unresolved, source: 'rules' },
    };
    addRecipe(rec);
    return { recipe: hydrate(rec), reused: false, ...report(rec, store_slug) };
  },

  async report(id, store_slug) {
    await load();
    const r = DB.byId.get(Number(id));
    if (!r) throw new Error('No such recipe.');
    return report(r, store_slug);
  },

  async tune(id, targets, save) {
    await load();
    const r = DB.byId.get(Number(id));
    if (!r) throw new Error('No such recipe.');
    if (!supportsNutrition(r)) throw new Error('Macro tuning is available once you Kindify a recipe.');
    const bounds = normaliseBounds(targets);
    const tuned = tuneToTargets(r.ingredients, DB.ingredients, r.servings, bounds);
    DB.local.prefs.targets = bounds;
    persist();
    if (save) {
      r.ingredients = tuned.lines;
      if (!DB.local.recipes.includes(r)) DB.local.recipes.push(r);   // baked recipes become local once edited
      persist();
    }
    return { ...tuned, saved: Boolean(save), recipe: save ? hydrate(r) : null };
  },

  async grocery(recipe_id, store_slug, servings) {
    await load();
    const r = DB.byId.get(Number(recipe_id));
    if (!r) throw new Error('No such recipe.');
    if (!supportsNutrition(r)) throw new Error('Grocery lists are available once you Kindify a recipe.');

    const store = storeBySlug(store_slug);
    const products = productsFor(store.slug);
    const want = Math.max(1, Number(servings) || r.servings);
    const grams = gramsByIngredient(r.ingredients, DB.ingredients, want / r.servings);

    const items = basketLines(grams, products, DB.ingredients).map((l, i) => ({ ...l, id: i + 1, checked: 0 }));
    for (const l of r.ingredients) {
      if (!l.ingredient_key) items.push({ id: items.length + 1, display: l.raw_name, unmatched: true, aisle: 'unmatched', checked: 0 });
    }

    const list = {
      id: DB.local.nextId++, recipe_id: r.id, slug: r.slug, title: r.title,
      store_name: store.name, store_slug: store.slug, servings: want,
      created_at: new Date().toISOString(), items,
    };
    DB.local.lists.unshift(list);
    DB.local.prefs.store_slug = store.slug;
    persist();
    return groceryList(list.id);
  },

  async groceryList(id) { await load(); return groceryList(Number(id)); },

  async check(listId, item_id, checked) {
    await load();
    const list = DB.local.lists.find((l) => l.id === Number(listId));
    const item = list?.items.find((i) => i.id === Number(item_id));
    if (item) { item.checked = checked ? 1 : 0; persist(); }
    return groceryList(Number(listId));
  },

  async save(id, saved) {
    await load();
    const n = Number(id);
    DB.local.saved = saved === false ? DB.local.saved.filter((x) => x !== n)
                                     : [...new Set([...DB.local.saved, n])];
    persist();
    return { saved: DB.local.saved.includes(n) };
  },

  async library() {
    await load();
    const pick = (r) => ({ id: r.id, slug: r.slug, title: r.title, emoji: r.emoji, diet: r.diet, kind: r.kind, blurb: r.blurb });
    return {
      saved: DB.local.saved.map((id) => DB.byId.get(id)).filter(Boolean).map(pick),
      transformed: [...DB.byId.values()].filter((r) => r.kind === 'transformed')
        .map((r) => ({ ...pick(r), parent_title: DB.byId.get(r.parent_id)?.title || null })),
      lists: DB.local.lists.map((l) => ({ id: l.id, title: l.title, store: l.store_name, servings: l.servings, created_at: l.created_at })),
    };
  },

  async prefs(p) {
    await load();
    Object.assign(DB.local.prefs, p || {});
    if (p?.targets) DB.local.prefs.targets = normaliseBounds(p.targets);
    persist();
    return DB.local.prefs;
  },
};
