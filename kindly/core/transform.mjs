// "Kindify" — the deterministic half.
//
// This is what runs when the model is unreachable, and what the model is shown
// as a starting point when it is. Keeping it whole (rather than letting the LLM
// invent swaps from nothing) is what makes transformations reproducible and
// makes the cost and nutrition numbers defensible.
//
// LEVELS ARE CUMULATIVE — see the header of server/seed/substitutions.mjs.

import { toGrams, fromGrams } from './units.mjs';
import { nutritionFor } from './nutrition.mjs';

const MEATY = new Set(['meat', 'poultry', 'seafood']);
const ANIMAL_AT = {
  vegetarian: (cls) => MEATY.has(cls),
  vegan: (cls) => cls != null,
};

/**
 * @param lines   recipe lines [{ ord, qty, unit, ingredient_key, raw_name, note, is_core }]
 * @param level   'vegetarian' | 'vegan'
 * @param ctx     { ingredients: Map<key,row>, subs: Map<`${from}|${level}`, row[]> }
 * @param choices optional { [from_key]: to_key } to override the default swap
 */
export function transformLines(lines, level, ctx, choices = {}) {
  const { ingredients, subs } = ctx;
  const needsSwap = ANIMAL_AT[level];
  if (!needsSwap) throw new Error(`unknown level: ${level}`);

  const out = [];
  const swaps = [];
  const unresolved = [];

  for (const line of lines) {
    const ing = line.ingredient_key ? ingredients.get(line.ingredient_key) : null;

    if (!ing || !needsSwap(ing.animal_class)) {
      out.push({ ...line });
      continue;
    }

    const options = candidatesFor(line.ingredient_key, level, subs);
    if (!options.length) {
      // An animal ingredient we have no swap for. Never silently keep it —
      // the recipe would not be what the button promised.
      unresolved.push({ key: line.ingredient_key, name: ing.name, raw_name: line.raw_name });
      out.push({ ...line, unresolved: true });
      continue;
    }

    const chosen = options.find((o) => o.to_key === choices[line.ingredient_key]) || options[0];
    const target = ingredients.get(chosen.to_key);
    const g = toGrams(line.qty, line.unit, ing);
    let qty = line.qty, unit = line.unit;
    if (g && target) {
      const conv = fromGrams(g.grams * chosen.ratio, target, line.unit);
      qty = conv.qty; unit = conv.unit;
    }

    out.push({
      ...line,
      ingredient_key: chosen.to_key,
      raw_name: target ? target.name : chosen.to_key,
      qty, unit,
      note: line.note,
      swapped_from: line.ingredient_key,
    });
    swaps.push({
      from_key: line.ingredient_key, from_name: ing.name,
      is_core: Boolean(line.is_core), animal_class: ing.animal_class,
      to_key: chosen.to_key, to_name: target?.name ?? chosen.to_key,
      ratio: chosen.ratio, technique: chosen.technique,
      flavor_note: chosen.flavor_note, why: chosen.why,
      alternates: options.filter((o) => o.to_key !== chosen.to_key)
        .map((o) => ({ to_key: o.to_key, to_name: ingredients.get(o.to_key)?.name ?? o.to_key, why: o.why })),
    });
  }

  return { lines: out, swaps, unresolved };
}

function candidatesFor(key, level, subs) {
  const veg = subs.get(`${key}|vegetarian`) || [];
  if (level === 'vegetarian') return veg;
  return [...veg, ...(subs.get(`${key}|vegan`) || [])];
}

/**
 * How close the transformed recipe stays to the original, 0-100 on three axes.
 * Deliberately conservative: we would rather under-claim fidelity than promise
 * a match the cook will not taste.
 */
export function fidelity(originalLines, newLines, swaps, unresolved, ctx, servings) {
  const a = nutritionFor(originalLines, ctx.ingredients, servings).perServing;
  const b = nutritionFor(newLines, ctx.ingredients, servings).perServing;

  const axes = ['kcal', 'protein', 'fat', 'carb'];
  let drift = 0, n = 0;
  for (const ax of axes) {
    if (!a[ax]) continue;
    drift += Math.min(1, Math.abs(b[ax] - a[ax]) / a[ax]);
    n++;
  }
  const macros = n ? Math.round(100 - (drift / n) * 100) : null;

  const techniqueChanges = swaps.filter((s) => s.technique).length;
  const effort = clamp(100 - techniqueChanges * 8 - unresolved.length * 15, 40, 100);

  const needsAddingBack = swaps.filter((s) => s.flavor_note).length;
  const flavor = clamp(100 - needsAddingBack * 9 - unresolved.length * 25, 30, 100);

  return { macros, effort, flavor };
}

function clamp(n, lo, hi) { return Math.max(lo, Math.min(hi, Math.round(n))); }

/** Method notes the cook needs, in the order the swaps appear. */
export function methodNotes(swaps) {
  return swaps.flatMap((s) => [
    s.technique && { kind: 'technique', about: s.to_name, text: s.technique },
    s.flavor_note && { kind: 'flavor', about: s.to_name, text: s.flavor_note },
  ].filter(Boolean));
}

// ---------------------------------------------------------------------------
// Rewriting prose without a model.
//
// When the LLM is unavailable we still must not hand back a method that says
// "brown the beef" over a list with no beef in it. These two helpers do the
// crude-but-correct thing: swap the words. The model does this far better, and
// that difference is exactly what the API key buys.

// Words that qualify a meat rather than naming one. Stripped along with it, so
// "Ground Beef Tacos" becomes "Tacos" and not "Ground Tacos".
const QUALIFIER = 'ground|minced|pulled|shredded|smoked|roast|roasted|grilled|fried|crispy|braised|pan-fried';
const MEAT_WORD = 'chicken|beef|pork|lamb|bacon|sausages?|steak|shrimps?|prawns?|salmon|tuna|fish|turkey|ham|pepperoni|chorizo|prosciutto|anchovy|anchovies|meat|mince';
// "con carne", "alla bolognese" — a trailing foreign prepositional phrase reads
// as a contradiction if you swap the noun inside it ("Plant-Based Chili con
// Carne"), so the whole phrase is dropped and the star goes in front instead.
const FOREIGN_TRAIL = 'con|de|alla|al|di|a la';

// How an ingredient wants to be named in a title. Falls back to title-casing
// the ingredient's own name, so a new row in the table needs no entry here.
const STAR_NAME = {
  plant_mince: 'Plant-Based', plant_sausage: 'Plant-Based Sausage',
  lentils_brown: 'Lentil', red_lentils: 'Red Lentil',
  cremini: 'Mushroom', shiitake: 'Shiitake', portobello: 'Portobello',
  king_oyster: 'King Oyster Mushroom', dried_porcini: 'Porcini',
  tofu_extra_firm: 'Tofu', tofu_firm: 'Tofu', tofu_silken: 'Silken Tofu',
  chickpeas: 'Chickpea', black_beans: 'Black Bean', kidney_beans: 'Kidney Bean',
  cannellini_beans: 'White Bean', jackfruit: 'Jackfruit', tempeh: 'Tempeh',
  seitan: 'Seitan', walnut: 'Walnut', cashew: 'Cashew', tvp: 'Soy',
  cauliflower: 'Cauliflower', eggplant: 'Aubergine', butternut: 'Butternut',
};

/**
 * The swap a title should be named after: the one that replaced the dish's
 * headline animal ingredient. Meat outranks dairy, and a line the recipe marked
 * `is_core` outranks one it did not — swapping the parmesan does not rename
 * a carbonara, swapping the bacon does.
 */
function starSwap(swaps) {
  const MEATY = new Set(['meat', 'poultry', 'seafood']);
  return swaps.find((s) => s.is_core && MEATY.has(s.animal_class))
      || swaps.find((s) => MEATY.has(s.animal_class))
      || swaps.find((s) => s.is_core)
      || swaps[0]
      || null;
}

export function starName(swaps) {
  const s = starSwap(swaps);
  if (!s) return null;
  if (STAR_NAME[s.to_key]) return STAR_NAME[s.to_key];
  return String(s.to_name)
    .replace(/\s*\([^)]*\)/g, '')
    .replace(/,.*$/, '')
    .trim()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * Name the dish after what is actually in it, not after what it is missing.
 * "Ground Beef Tacos" swapped to lentils becomes "Lentil Tacos", not
 * "Vegetarian Tacos" — the diet is already on the badge, and a title that
 * leads with a negation makes the food sound like a concession.
 */
export function kindTitle(title, level, swaps = []) {
  const star = starName(swaps);
  if (!star) return title;

  const foreignTrail = new RegExp(`\\s+(?:${FOREIGN_TRAIL})\\s+(?:${MEAT_WORD}|carne|carnitas)\\s*$`, 'i');
  if (foreignTrail.test(title)) {
    const stem = title.replace(foreignTrail, '').trim();
    if (stem.length >= 3) return `${star} ${stem}`;
  }

  const meatPhrase = new RegExp(`\\b(?:(?:${QUALIFIER})\\s+)?(?:${MEAT_WORD})\\b`, 'i');
  if (meatPhrase.test(title)) {
    const out = title.replace(meatPhrase, star)
      .replace(/\s{2,}/g, ' ')
      .replace(/\s+([,:-])/g, '$1')
      .trim();
    // Guard against a title that was nothing but the meat word.
    if (out.length >= 3 && out.toLowerCase() !== star.toLowerCase()) return out;
  }
  // No meat word to replace — lead with the star instead.
  if (title.toLowerCase().startsWith(star.toLowerCase())) return title;
  return `${star} ${title}`;
}

/**
 * Substitute swapped ingredients into the method text. Longest names first so
 * "chicken thigh" is replaced before a bare "chicken" can match half of it.
 */
export function rewriteSteps(steps, swaps) {
  if (!swaps.length) return steps;

  const rules = [];
  for (const s of swaps) {
    for (const term of nameVariants(s.from_key, s.from_name)) {
      rules.push([term, s.to_name]);
    }
  }
  rules.sort((a, b) => b[0].length - a[0].length);

  return steps.map((step) => {
    let out = step;
    for (const [term, replacement] of rules) {
      out = out.replace(pluralAware(term), replacement);
    }
    return out;
  });
}

// "chicken_breast" / "chicken breast" -> ["chicken breast", "chicken"]
// The bare animal word matters most: a method says "poach the chicken", never
// "poach the chicken breast". Longest-first sorting in rewriteSteps stops a
// short variant from eating half of a longer one.
function nameVariants(key, name) {
  const out = new Set();
  const clean = String(name).replace(/\s*\([^)]*\)/g, '').trim().toLowerCase();
  if (clean) out.add(clean);
  const fromKey = String(key).replace(/_/g, ' ');
  out.add(fromKey);

  const words = [...new Set([...fromKey.split(' '), ...clean.split(/[\s,]+/)])].filter(Boolean);
  const meat = new RegExp(`^(?:${MEAT_WORD})$`, 'i');
  for (const w of words) if (meat.test(w)) out.add(w.toLowerCase());

  if (![...out].some((v) => meat.test(v))) {
    const noun = words.filter((w) => !new RegExp(`^(?:${QUALIFIER})$`, 'i').test(w)).pop();
    if (noun && noun.length > 2) out.add(noun.toLowerCase());
  }
  return [...out];
}

// Methods write "anchovies" and "sausages" where the ingredient table says
// "anchovy" and "sausage".
function pluralAware(term) {
  const e = escapeRe(term);
  const forms = [e, `${e}s`, `${e}es`];
  if (/y$/i.test(term)) forms.push(`${escapeRe(term.slice(0, -1))}ies`);
  forms.sort((a, b) => b.length - a.length);
  return new RegExp(`\\b(?:${forms.join('|')})\\b`, 'gi');
}

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
