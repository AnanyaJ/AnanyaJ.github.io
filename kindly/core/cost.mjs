// Two different money questions, deliberately kept apart:
//
//   ingredientCost — cost of exactly the grams the recipe uses, priced per
//                    gram. This is the fair way to COMPARE two recipes.
//   basketCost     — whole packages you would actually put in a cart. This is
//                    what the grocery list totals.
//
// Comparing basket totals would punish a recipe for needing one teaspoon of an
// expensive spice, so "you save $X" always quotes ingredientCost.

export function pricePerGram(product) {
  if (!product || !product.grams) return null;
  return product.price_cents / product.grams;
}

/**
 * @param gramsByKey Map<ingredient_key, grams>
 * @param products   Map<ingredient_key, product row> for one store
 * @returns { cents, priced, unpriced: string[] }
 */
export function ingredientCost(gramsByKey, products) {
  let cents = 0, priced = 0;
  const unpriced = [];
  for (const [key, grams] of gramsByKey) {
    const p = products.get(key);
    const ppg = pricePerGram(p);
    if (ppg == null) { unpriced.push(key); continue; }
    cents += ppg * grams;
    priced++;
  }
  return { cents: Math.round(cents), priced, unpriced };
}

/** Whole packages, the way a checkout would count them. */
export function basketLines(gramsByKey, products, ingredients) {
  const lines = [];
  for (const [key, grams] of gramsByKey) {
    const p = products.get(key);
    const ing = ingredients.get(key);
    if (!p) {
      lines.push({ ingredient_key: key, display: ing?.name ?? key, need_grams: grams, unmatched: true });
      continue;
    }
    const packs = Math.max(1, Math.ceil(grams / p.grams - 1e-9));
    lines.push({
      ingredient_key: key,
      product_id: p.id,
      display: p.name,
      size: `${trim(p.size_qty)} ${p.size_unit}`,
      need_grams: Math.round(grams),
      packs,
      price_cents: packs * p.price_cents,
      aisle: p.aisle,
      // A whole jar of cumin for two teaspoons is not a real shopping decision.
      likely_have: (ing?.category === 'spice' || STAPLES.has(key)) && grams / p.grams < 0.25,
      unmatched: false,
    });
  }
  return lines;
}

// Things most kitchens already have. Kept explicit rather than inferred so it
// can be argued with.
export const STAPLES = new Set([
  'salt','black_pepper','olive_oil','canola_oil','sugar','brown_sugar','flour',
  'cornstarch','soy_sauce','rice_vinegar','balsamic','dijon','honey','maple_syrup',
  'sesame_oil','baking_powder','yeast_dry',
]);

export function fmtUSD(cents) {
  if (cents == null) return null;
  return `$${(cents / 100).toFixed(2)}`;
}

function trim(n) { return Number.isInteger(n) ? String(n) : String(n); }
