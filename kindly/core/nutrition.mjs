// Recipe -> macros, derived only from the ingredient table.
//
// A recipe never stores its own nutrition. If a number here looks wrong the fix
// is in server/seed/ingredients.mjs, not in a per-recipe override.

import { toGrams } from './units.mjs';

export const FIELDS = ['kcal','protein','carb','fat','satfat','fiber','sodium_mg','chol_mg'];

const PER_100G = {
  kcal: 'kcal_100g', protein: 'protein_100g', carb: 'carb_100g', fat: 'fat_100g',
  satfat: 'satfat_100g', fiber: 'fiber_100g', sodium_mg: 'sodium_mg_100g', chol_mg: 'chol_mg_100g',
};

function zero() { return Object.fromEntries(FIELDS.map(f => [f, 0])); }

/**
 * @param lines  [{ qty, unit, ingredient_key, raw_name }]
 * @param index  Map ingredient_key -> ingredient row
 * @param servings
 * @returns { total, perServing, coverage, unmatched, inexact }
 *   coverage: share of lines we could actually weigh, 0..1. The UI must show
 *   this — a 60%-covered estimate is not the same claim as a 100% one.
 */
export function nutritionFor(lines, index, servings = 1) {
  const total = zero();
  const unmatched = [];
  let counted = 0, inexact = 0;

  for (const line of lines) {
    const ing = line.ingredient_key ? index.get(line.ingredient_key) : null;
    if (!ing) { unmatched.push(line.raw_name); continue; }
    const g = toGrams(line.qty, line.unit, ing);
    if (!g) { unmatched.push(line.raw_name); continue; }
    if (!g.exact) inexact++;
    counted++;
    const factor = g.grams / 100;
    for (const f of FIELDS) {
      const v = ing[PER_100G[f]];
      if (v != null) total[f] += v * factor;
    }
  }

  const n = Math.max(1, servings);
  const perServing = Object.fromEntries(FIELDS.map(f => [f, total[f] / n]));
  return {
    total: round(total),
    perServing: round(perServing),
    coverage: lines.length ? counted / lines.length : 0,
    unmatched,
    inexact,
  };
}

function round(o) {
  return Object.fromEntries(Object.entries(o).map(([k, v]) => [k, Math.round(v * 10) / 10]));
}

/** Grams of each ingredient the recipe needs, keyed by ingredient_key. */
export function gramsByIngredient(lines, index, scale = 1) {
  const out = new Map();
  for (const line of lines) {
    if (!line.ingredient_key) continue;
    const ing = index.get(line.ingredient_key);
    if (!ing) continue;
    const g = toGrams(line.qty, line.unit, ing);
    if (!g) continue;
    out.set(line.ingredient_key, (out.get(line.ingredient_key) || 0) + g.grams * scale);
  }
  return out;
}
