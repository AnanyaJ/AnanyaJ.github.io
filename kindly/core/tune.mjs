// Fit a recipe to macro RANGES by nudging how much of each ingredient goes in.
//
// Targets are two-sided (see axes.mjs). The consequence that matters: a recipe
// already sitting inside every active range is left completely alone. A point
// target would have dragged it toward an exact number for no reason.
//
// Only ingredients a cook would plausibly vary get adjusted — you scale the
// tofu and the oil, you do not scale the bay leaf. Everything stays inside
// [0.5x, 2x] so the result is still recognisably the same dish; the caller is
// told when the ranges could not be reached rather than being handed a recipe
// that is 4x the beans.

import { toGrams, fromGrams } from './units.mjs';
import { nutritionFor } from './nutrition.mjs';
import { AXES, AK, penalty, fitOf, isActive, axisText, normaliseBounds, fmt } from './axes.mjs';

const TUNABLE = new Set(['protein', 'fat', 'grain', 'dairy']);
const BOUNDS = [0.5, 2.0];
const WEIGHT = { kcal: 1, protein: 1.4, carb: 0.7, fat: 0.7 };

/**
 * @param targets bounds object { kcal: {lo,hi}, ... } (or the legacy point
 *                shape, which normaliseBounds migrates)
 * @returns { lines, multipliers, before, after, bounds, fitBefore, fitAfter, reached, notes }
 */
export function tuneToTargets(lines, index, servings, targets) {
  const bounds = normaliseBounds(targets);
  const active = AK.filter((k) => isActive(k, bounds));
  const before = nutritionFor(lines, index, servings).perServing;

  if (!active.length) {
    return { lines, multipliers: {}, before, after: before, bounds,
      fitBefore: 100, fitAfter: 100, reached: true, notes: [] };
  }

  const fitBefore = fitOf(before, bounds);
  // Already inside every range — changing anything would be meddling.
  if (fitBefore === 100) {
    return { lines, multipliers: {}, before, after: before, bounds,
      fitBefore, fitAfter: 100, reached: true, notes: [], alreadyFits: true };
  }

  const idx = lines
    .map((l, i) => [l, i])
    .filter(([l]) => {
      const ing = l.ingredient_key ? index.get(l.ingredient_key) : null;
      return ing && TUNABLE.has(ing.category) && toGrams(l.qty, l.unit, ing);
    })
    .map(([, i]) => i);

  const mult = new Array(lines.length).fill(1);
  if (!idx.length) {
    return { lines, multipliers: {}, before, after: before, bounds,
      fitBefore, fitAfter: fitBefore, reached: false,
      notes: ['Nothing in this recipe is safe to scale automatically.'] };
  }

  // Coordinate descent. Small search space; runs in well under a millisecond.
  const STEPS = [1.25, 1.1, 1.02, 0.98, 0.91, 0.8];
  let best = errorOf(apply(lines, mult, index), index, servings, bounds, active);
  for (let pass = 0; pass < 14; pass++) {
    let improved = false;
    for (const i of idx) {
      for (const s of STEPS) {
        const next = mult[i] * s;
        if (next < BOUNDS[0] || next > BOUNDS[1]) continue;
        const trial = mult.slice();
        trial[i] = next;
        const e = errorOf(apply(lines, trial, index), index, servings, bounds, active);
        if (e < best - 1e-9) { best = e; mult[i] = next; improved = true; }
      }
    }
    if (!improved) break;
  }

  const tuned = apply(lines, mult, index);
  const after = nutritionFor(tuned, index, servings).perServing;
  const fitAfter = fitOf(after, bounds);

  const notes = [];
  for (const k of active) {
    if (penalty(k, after[k], bounds) === 0) continue;
    const A = AXES[k];
    const where = after[k] < bounds[k].lo ? 'short of' : 'over';
    notes.push(`${A.label} landed at ${fmt(k, after[k])}, ${where} your ${axisText(k, bounds)} range — the ingredients here cannot stretch further without changing the dish.`);
  }

  const multipliers = {};
  idx.forEach((i) => { if (Math.abs(mult[i] - 1) > 0.02) multipliers[lines[i].ingredient_key] = round2(mult[i]); });

  return { lines: tuned, multipliers, before, after, bounds, fitBefore, fitAfter,
    reached: notes.length === 0, notes };
}

function apply(lines, mult, index) {
  return lines.map((l, i) => {
    if (mult[i] === 1) return l;
    const ing = l.ingredient_key ? index.get(l.ingredient_key) : null;
    const g = ing && toGrams(l.qty, l.unit, ing);
    if (!g) return l;
    const conv = fromGrams(g.grams * mult[i], ing, l.unit);
    return { ...l, qty: conv.qty, unit: conv.unit, tuned: true };
  });
}

function errorOf(lines, index, servings, bounds, active) {
  const n = nutritionFor(lines, index, servings).perServing;
  let e = 0;
  for (const k of active) {
    // Uncapped: a saturated penalty has no gradient for the search to follow.
    const p = penalty(k, n[k], bounds, { capped: false });
    if (p) e += p * p * WEIGHT[k];
  }
  return e;
}

function round2(n) { return Math.round(n * 100) / 100; }
