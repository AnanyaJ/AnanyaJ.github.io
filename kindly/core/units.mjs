// Unit conversion. Everything downstream works in grams.
//
// server/core never imports from server/routes or the DB layer — it takes plain
// objects and returns plain objects, which is what keeps it testable.

// Nouns a recipe writes instead of "unit". They all mean "one of the thing",
// and ingredient.g_per_unit says how much that weighs.
export const UNIT_ALIASES = {
  clove: 'unit', slice: 'unit', can: 'unit', fillet: 'unit', block: 'unit',
  sausage: 'unit', breast: 'unit', thigh: 'unit', leaf: 'unit', rasher: 'unit',
  mushroom: 'unit', cap: 'unit', tortilla: 'unit', head: 'unit', steak: 'unit',
  ball: 'unit', bunch: 'unit', stalk: 'unit', piece: 'unit', ea: 'unit',
};

export const MASS_G = { g: 1, gram: 1, grams: 1, kg: 1000, oz: 28.3495, lb: 453.592 };
export const VOLUME_ML = { ml: 1, l: 1000, cup: 236.588, tbsp: 14.787, tsp: 4.929 };

export function normaliseUnit(unit) {
  if (!unit) return null;
  const u = String(unit).toLowerCase().trim();
  return UNIT_ALIASES[u] || u;
}

/**
 * Convert a recipe line to grams.
 * Returns { grams, exact }. `exact` is false when we had to assume a density,
 * which the UI uses to decide whether to hedge a number.
 * Returns null when the conversion is genuinely not possible.
 */
export function toGrams(qty, unit, ing) {
  if (qty == null || !Number.isFinite(Number(qty))) return null;
  const q = Number(qty);
  const u = normaliseUnit(unit);
  if (!u) return null;

  if (MASS_G[u]) return { grams: q * MASS_G[u], exact: true };

  if (u === 'unit') {
    const per = ing?.g_per_unit;
    if (per == null) return null;          // no idea what one of these weighs
    return { grams: q * per, exact: true };
  }

  if (VOLUME_ML[u]) {
    const ml = q * VOLUME_ML[u];
    // Prefer a measured density, in the closest-matching unit we have.
    if (u === 'cup' && ing?.g_per_cup != null) return { grams: q * ing.g_per_cup, exact: true };
    if ((u === 'tbsp' || u === 'tsp') && ing?.g_per_tbsp != null) {
      const perTbsp = ing.g_per_tbsp;
      return { grams: u === 'tbsp' ? q * perTbsp : (q * perTbsp) / 3, exact: true };
    }
    if (ing?.g_per_cup != null) return { grams: (ml / VOLUME_ML.cup) * ing.g_per_cup, exact: true };
    if (ing?.g_per_tbsp != null) return { grams: (ml / VOLUME_ML.tbsp) * ing.g_per_tbsp, exact: true };
    // Nothing to go on: assume it behaves like water. Liquids are the common
    // case here (stock, milk, wine) so this is usually close.
    return { grams: ml, exact: false };
  }

  if (u === 'pinch') return { grams: 0.3, exact: false };
  return null;
}

/** Human-readable amount, for grocery lists and scaled recipes. */
export function formatQty(qty, unit) {
  if (qty == null) return '';
  const rounded = qty < 10 ? Math.round(qty * 4) / 4 : Math.round(qty);
  const FRACTIONS = { 0.25: '¼', 0.5: '½', 0.75: '¾' };
  const whole = Math.floor(rounded);
  const frac = Math.round((rounded - whole) * 100) / 100;
  let n;
  if (FRACTIONS[frac]) n = whole ? `${whole}${FRACTIONS[frac]}` : FRACTIONS[frac];
  else n = String(rounded);
  const u = unit && normaliseUnit(unit) !== 'unit' ? ` ${unit}` : '';
  return `${n}${u}`;
}

/**
 * Grams -> a quantity a cook would actually write, for a given ingredient.
 * Prefers whole units ("2 blocks"), then tbsp/cup for things measured that way,
 * then plain grams.
 */
export function fromGrams(grams, ing, preferredUnit = null) {
  if (grams == null) return { qty: null, unit: null };
  const pref = normaliseUnit(preferredUnit);

  if (pref === 'unit' && ing?.g_per_unit) {
    const n = grams / ing.g_per_unit;
    return { qty: n < 1 ? Math.round(n * 4) / 4 : Math.round(n * 2) / 2, unit: 'unit' };
  }
  if (pref && VOLUME_ML[pref]) {
    // A recipe that said "1500 ml stock" must not come back as "101.5 tbsp":
    // stay in the unit the cook was already using.
    if (pref === 'ml' || pref === 'l') {
      const perMl = density(ing);
      const ml = perMl ? grams / perMl : grams;
      return pref === 'l' ? { qty: round2(ml / 1000), unit: 'l' } : { qty: Math.round(ml), unit: 'ml' };
    }
    if (pref === 'cup' && ing?.g_per_cup) return { qty: round2(grams / ing.g_per_cup), unit: 'cup' };
    if (ing?.g_per_tbsp) {
      const tbsp = grams / ing.g_per_tbsp;
      return pref === 'tsp' ? { qty: round2(tbsp * 3), unit: 'tsp' } : { qty: round2(tbsp), unit: 'tbsp' };
    }
    if (ing?.g_per_cup) return { qty: round2(grams / ing.g_per_cup), unit: 'cup' };
    return { qty: Math.round(grams), unit: 'ml' };
  }
  if (pref && MASS_G[pref] && pref !== 'g') {
    return { qty: round2(grams / MASS_G[pref]), unit: pref };
  }
  // Small amounts read better as spoons than as "4 g".
  if (grams < 20 && ing?.g_per_tbsp) {
    const tbsp = grams / ing.g_per_tbsp;
    if (tbsp < 0.9) return { qty: round2(tbsp * 3), unit: 'tsp' };
    return { qty: round2(tbsp), unit: 'tbsp' };
  }
  return { qty: Math.round(grams), unit: 'g' };
}

// Grams per millilitre, from whichever density we happen to have.
function density(ing) {
  if (ing?.g_per_cup) return ing.g_per_cup / VOLUME_ML.cup;
  if (ing?.g_per_tbsp) return ing.g_per_tbsp / VOLUME_ML.tbsp;
  return null;
}

function round2(n) { return Math.round(n * 4) / 4; }
