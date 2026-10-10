// What actually improved — and what did not.
//
// Two rules that are product decisions, not implementation details:
//   1. A benefit is only shown when it clears a threshold that a cook would
//      notice. No "0.3 g more fibre!". Many transformations will show none,
//      and that is the correct outcome, not a bug.
//   2. Every real downside is shown too, in the same panel, with the same
//      prominence. The tool is trying to be gently persuasive, not misleading.
//
// Nutrient differences only. Nothing here claims a health outcome, because a
// recipe swap cannot promise one.

import { fmtUSD } from './cost.mjs';

export function benefitsFor({ before, after, costBefore, costAfter, servings }) {
  const good = [], caveats = [];
  const d = (f) => (after[f] ?? 0) - (before[f] ?? 0);
  const pct = (f) => (before[f] ? d(f) / before[f] : 0);

  // ---- money ----
  if (costBefore != null && costAfter != null && costBefore > 0) {
    const saved = costBefore - costAfter;
    const perServing = saved / Math.max(1, servings);
    if (saved > 0 && saved / costBefore >= 0.05 && perServing >= 25) {
      good.push({
        kind: 'cost',
        headline: `About ${fmtUSD(Math.round(saved))} cheaper`,
        detail: `Roughly ${fmtUSD(Math.round(perServing))} a serving, at the store you picked. Estimated from package prices, so treat it as a ballpark.`,
      });
    } else if (saved < 0 && Math.abs(saved) / costBefore >= 0.1) {
      caveats.push({
        kind: 'cost',
        headline: `About ${fmtUSD(Math.round(-saved))} more expensive`,
        detail: 'Specialty plant products usually cost more than the meat they replace. Beans, lentils and mushrooms are the cheaper routes.',
      });
    }
  }

  // ---- nutrients ----
  if (d('satfat') <= -2 && pct('satfat') <= -0.15) {
    good.push({
      kind: 'satfat',
      headline: `${Math.abs(d('satfat')).toFixed(1)} g less saturated fat per serving`,
      detail: `Down from ${before.satfat.toFixed(1)} g to ${after.satfat.toFixed(1)} g.`,
    });
  }
  if (d('fiber') >= 2) {
    good.push({
      kind: 'fiber',
      headline: `${d('fiber').toFixed(1)} g more fibre per serving`,
      detail: `Up from ${before.fiber.toFixed(1)} g to ${after.fiber.toFixed(1)} g. Beans, lentils and whole vegetables carry fibre that meat does not.`,
    });
  }
  if ((before.chol_mg ?? 0) >= 30 && (after.chol_mg ?? 0) < 5) {
    good.push({
      kind: 'cholesterol',
      headline: 'No dietary cholesterol',
      detail: `The original had about ${Math.round(before.chol_mg)} mg a serving. Plants contain none.`,
    });
  }
  if (d('sodium_mg') <= -150) {
    good.push({
      kind: 'sodium',
      headline: `${Math.abs(Math.round(d('sodium_mg')))} mg less sodium per serving`,
      detail: null,
    });
  } else if (d('sodium_mg') >= 200) {
    caveats.push({
      kind: 'sodium',
      headline: `${Math.round(d('sodium_mg'))} mg more sodium per serving`,
      detail: 'Prepared plant proteins and soy seasonings are salty. Cut the added salt elsewhere to even it out.',
    });
  }
  if (before.protein >= 10 && pct('protein') <= -0.2) {
    caveats.push({
      kind: 'protein',
      headline: `${Math.abs(Math.round(d('protein')))} g less protein per serving`,
      detail: `Down from ${Math.round(before.protein)} g to ${Math.round(after.protein)} g. Tofu, tempeh or seitan close most of that gap if it matters to you.`,
    });
  } else if (before.protein >= 10 && Math.abs(pct('protein')) < 0.1) {
    good.push({
      kind: 'protein',
      headline: 'Protein holds up',
      detail: `${Math.round(after.protein)} g a serving against the original's ${Math.round(before.protein)} g.`,
    });
  }
  if (pct('kcal') >= 0.2 && d('kcal') >= 80) {
    caveats.push({
      kind: 'kcal',
      headline: `${Math.round(d('kcal'))} more calories per serving`,
      detail: 'Nuts and oils are calorie-dense. Worth knowing if you are tracking.',
    });
  }

  return { good, caveats };
}
