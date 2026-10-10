// Search over the seeded corpus.
//
// This is the seam a real recipe-search API replaces: same signature, same
// returned shape. See server/llm/interpret.mjs for the query understanding half.

const STOP = new Set(['a','an','the','and','or','of','with','for','some','i','im',"i'm",'want','something','food','dish','recipe','recipes','make','cook','craving','crave','feel','like','really','bit','really']);

export function tokenize(s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9\s'-]/g, ' ')
    .split(/\s+/).filter((t) => t && t.length > 1 && !STOP.has(t));
}

/**
 * @param recipes [{ id, title, blurb, cuisine, tags[], diet, ingredientNames[] , kind }]
 * @param intent  { terms[], boost{}, exclude[] } from interpretCraving
 * @returns scored, sorted, with `why` explaining the match
 */
export function searchRecipes(recipes, intent, { limit = 12 } = {}) {
  const terms = [...new Set([...(intent.terms || [])].map((t) => t.toLowerCase()))];
  if (!terms.length) return [];

  const scored = [];
  for (const r of recipes) {
    let score = 0;
    const hits = [];
    const title = r.title.toLowerCase();
    const tags = (r.tags || []).map((t) => t.toLowerCase());
    const ings = (r.ingredientNames || []).map((t) => t.toLowerCase());
    const blurb = (r.blurb || '').toLowerCase();
    const cuisine = (r.cuisine || '').toLowerCase();

    for (const t of terms) {
      if (title.includes(t)) { score += 10; hits.push(t); }
      else if (tags.some((g) => g === t)) { score += 7; hits.push(t); }
      else if (tags.some((g) => g.includes(t))) { score += 4; hits.push(t); }
      else if (cuisine.includes(t)) { score += 5; hits.push(t); }
      else if (ings.some((g) => g.includes(t))) { score += 3; hits.push(t); }
      else if (blurb.includes(t)) { score += 1.5; hits.push(t); }
    }
    if (!score) continue;

    // Coverage bonus: matching three of the user's words beats matching one word thrice.
    score *= 1 + 0.25 * (new Set(hits).size - 1);
    for (const [k, v] of Object.entries(intent.boost || {})) {
      if (tags.includes(k) || title.includes(k)) score += v;
    }
    scored.push({ ...r, score: Math.round(score * 10) / 10, matched: [...new Set(hits)] });
  }

  scored.sort((a, b) => b.score - a.score || a.title.localeCompare(b.title));
  return scored.slice(0, limit);
}

/**
 * Is the craving itself already plant-based? Decides whether we ALSO ask the
 * model to author an original recipe rather than only listing existing ones.
 */
export function cravingIsPlantLeaning(intent, results) {
  const meaty = ['chicken','beef','pork','lamb','bacon','sausage','steak','shrimp','salmon','fish','tuna','meat','turkey','ham','pepperoni','chorizo','prawn','mince'];
  const terms = (intent.terms || []).map((t) => t.toLowerCase());
  if (terms.some((t) => meaty.includes(t))) return false;
  if (intent.plant_leaning === true) return true;
  const top = results.slice(0, 5);
  if (!top.length) return true;
  return top.filter((r) => r.diet === 'vegan' || r.diet === 'vegetarian').length >= top.length / 2;
}
