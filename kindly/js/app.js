// Kindly's single-page front end.
//
// The one UI rule worth stating: nothing on a meat recipe's page argues with
// the reader. There is a button, and it explains what it does. The persuasion
// is in the quality of what comes back after they press it, not in the copy
// before they do.

import { api } from './api.js';
import { el, frag, amount, DIET_LABEL, isPlant, timeLabel } from './dom.js';
import { AXES, AK, axisText, isActive, setAxes } from './axes.js';

const view = document.getElementById('view');
const state = { prefs: { level: 'vegetarian', store_slug: 'valley-market', targets: {} }, stores: [], llm: {}, search: null };

// ------------------------------------------------------------------ routing

const ROUTES = [
  [/^\/?$/, renderHome],
  [/^\/r\/([\w-]+)$/, renderRecipe],
  [/^\/list\/(\d+)$/, renderList],
  [/^\/library$/, renderLibrary],
];

async function route() {
  const path = location.hash.replace(/^#/, '') || '/';
  for (const [re, fn] of ROUTES) {
    const m = re.exec(path);
    if (m) { try { await fn(...m.slice(1)); } catch (err) { fail(err); } window.scrollTo(0, 0); return; }
  }
  view.replaceChildren(el('div', { class: 'center' }, 'Nothing here.'));
}

function fail(err) {
  console.error(err);
  view.replaceChildren(el('div', { class: 'center' },
    el('p', { class: 'error' }, err.message || 'Something went wrong.'),
    el('button', { class: 'ghost', onClick: () => route() }, 'Try again')));
}

function busy(label) {
  view.replaceChildren(el('div', { class: 'center' }, el('span', { class: 'spinner' }), ' ', label));
}

// ------------------------------------------------------------------ home

function renderHome() {
  const isLink = (s) => /^https?:\/\//i.test(s.trim());
  const input = el('input', {
    id: 'q', type: 'text', autocomplete: 'off', spellcheck: false,
    value: state.search?.q || '',
    placeholder: 'something warm and brothy — or paste https://…',
    'aria-label': 'What are you craving?',
  });
  const hint = el('p', { class: 'hint' }, state.static
    ? 'Search here matches on words. Kindify, nutrition, macro tuning and grocery lists all work.'
    : state.llm.enabled
      ? 'Or paste a link to a recipe you already have.'
      : 'Links can’t be read at the moment.');
  input.addEventListener('input', () => {
    hint.textContent = isLink(input.value)
      ? (state.static ? 'Links can’t be read on this published copy.' : 'We’ll read that page.')
      : (state.static
          ? 'Search here matches on words. Kindify, nutrition, macro tuning and grocery lists all work.'
          : state.llm.enabled ? 'Or paste a link to a recipe you already have.'
                              : 'Links can’t be read at the moment.');
  });

  const results = el('div');
  const form = el('form', {
    class: 'search',
    onSubmit: async (e) => {
      e.preventDefault();
      const q = input.value.trim();
      if (!q) return;
      results.replaceChildren(el('div', { class: 'center' }, el('span', { class: 'spinner' }), isLink(q) ? ' Reading that page…' : ' Looking…'));
      try {
        if (isLink(q)) {
          const out = await api.import(q);
          location.hash = `#/r/${out.recipe.slug}`;
          return;
        }
        state.search = { q, ...(await api.search(q)) };
        results.replaceChildren(renderResults(state.search));
      } catch (err) {
        results.replaceChildren(el('div', { class: 'note warn' }, err.message));
      }
    },
  }, input, el('button', { type: 'submit', class: 'primary' }, 'Find it'));

  view.replaceChildren(frag(
    el('section', { class: 'hero' },
      el('h1', {}, 'I’m craving…'),
      el('p', { class: 'lede' }, 'Tell us what you feel like eating, and we’ll find it.'),
      form, hint),
    results));

  if (state.search) results.replaceChildren(renderResults(state.search));
  input.focus();
}

function renderResults(s) {
  const out = [];
  if (s.intent?.reading) out.push(el('p', { class: 'quiet', style: 'text-align:center' }, s.intent.reading));

  if (s.authored) {
    out.push(el('section', { class: 'section' },
      el('div', { class: 'section-head' },
        el('h2', {}, 'Written for you'),
        el('p', { class: 'quiet' }, 'Not a published recipe — Kindly wrote this one for this craving.')),
      el('div', { class: 'grid' }, recipeCard(s.authored, { badge: 'new' }))));
  }

  if (!s.results.length && !s.authored) {
    out.push(el('div', { class: 'center' }, 'Nothing in the corpus matched that. Try a dish name, an ingredient, or a mood.'));
  } else if (s.results.length) {
    out.push(el('section', { class: 'section' },
      el('div', { class: 'section-head' }, el('h2', {}, 'Recipes')),
      el('div', { class: 'grid' }, s.results.map((r) => recipeCard(r)))));
  }
  if (s.authorNote) out.push(el('p', { class: 'quiet' }, s.authorNote));
  return frag(out);
}

function recipeCard(r, { badge } = {}) {
  return el('a', { class: 'card recipe-card', href: `#/r/${r.slug}`, style: 'text-decoration:none;color:inherit' },
    el('span', { class: 'emoji' }, r.emoji || '🍽️'),
    el('h3', {}, r.title),
    r.blurb && el('p', {}, r.blurb),
    el('div', { class: 'meta' },
      badge === 'new' && el('span', { class: 'tag new' }, 'New'),
      el('span', { class: `tag${isPlant(r.diet) ? ' plant' : ''}` }, DIET_LABEL[r.diet] || r.diet),
      r.cuisine && el('span', { class: 'tag' }, r.cuisine),
      timeLabel(r.prep_min, r.cook_min) && el('span', { class: 'tag' }, timeLabel(r.prep_min, r.cook_min)),
      r.origin_site && el('span', { class: 'tag' }, r.origin_site)));
}

// ------------------------------------------------------------------ recipe

async function renderRecipe(slug) {
  busy('Loading…');
  const data = await api.recipe(slug);
  const r = data.recipe;
  const parts = [];

  if (data.parent) {
    parts.push(el('p', { class: 'quiet' }, 'A kinder version of ',
      el('a', { href: `#/r/${data.parent.slug}` }, data.parent.title)));
  }

  parts.push(el('div', { class: 'recipe-head' },
    el('span', { class: 'emoji' }, r.emoji || '🍽️'),
    el('div', { style: 'flex:1;min-width:14rem' },
      el('h1', {}, r.title),
      r.blurb && el('p', { class: 'lede', style: 'margin:0;text-align:left' }, r.blurb)),
    el('button', {
      class: 'ghost', onClick: async (e) => {
        const out = await api.save(r.id, !r.saved);
        r.saved = out.saved;
        e.target.textContent = r.saved ? '★ Saved' : '☆ Save';
      },
    }, r.saved ? '★ Saved' : '☆ Save')));

  parts.push(el('ul', { class: 'facts' },
    el('li', {}, el('b', {}, r.servings), 'servings'),
    timeLabel(r.prep_min, r.cook_min) && el('li', {}, el('b', {}, timeLabel(r.prep_min, r.cook_min)), 'start to finish'),
    r.effort && el('li', {}, el('b', {}, `${r.effort}/5`), 'effort'),
    el('li', {}, el('b', {}, DIET_LABEL[r.diet] || r.diet), r.cuisine || '')));

  // The button. Only on recipes that actually contain meat or fish.
  if (!isPlant(r.diet)) parts.push(kindifyBar(r));

  parts.push(el('div', { class: 'columns', style: 'margin-top:2rem' },
    el('div', {},
      el('h2', {}, 'Ingredients'),
      el('ul', { class: 'ingredients' }, r.ingredients.map((l) =>
        el('li', { class: l.swapped_from ? 'swapped' : '' },
          el('span', {}, l.raw_name, l.note && el('small', { class: 'quiet' }, ` — ${l.note}`)),
          el('span', { class: 'amount' }, amount(l.qty, l.unit)))))),
    el('div', {},
      el('h2', {}, 'Method'),
      el('ol', { class: 'steps' }, r.steps.map((s) => el('li', {}, s))))));

  if (data.supportsNutrition) {
    const panel = el('div', { class: 'stack', style: 'margin-top:2.5rem' }, el('div', { class: 'center' }, el('span', { class: 'spinner' }), ' Working out the numbers…'));
    parts.push(panel);
    api.report(r.id, state.prefs.store_slug)
      .then((rep) => panel.replaceChildren(reportPanel(r, rep)))
      .catch((err) => panel.replaceChildren(el('div', { class: 'note warn' }, err.message)));
  } else {
    parts.push(el('p', { class: 'note' },
      'Nutrition, macro tuning and a grocery list become available once you Kindify this.'));
  }

  parts.push(el('p', { class: 'provenance' }, r.provenance,
    r.origin_url && frag(' ', el('a', { href: r.origin_url, target: '_blank', rel: 'noopener noreferrer' }, 'Original page'))));

  view.replaceChildren(frag(parts));
}

// One button, one action. Which kind of swap it makes is a site-level setting
// (see the header toggle) rather than a decision pushed onto the reader every
// time they look at a recipe: the default is plant-based, and someone who eats
// vegan sets that once.
function kindifyBar(r) {
  const status = el('span', { class: 'quiet' });

  const go = el('button', {
    class: 'kindness',
    onClick: async () => {
      go.disabled = true;
      status.replaceChildren(el('span', { class: 'spinner' }),
        state.llm.enabled ? ' Rewriting the recipe…' : ' Applying swaps…');
      try {
        const out = await api.transform(r.id, state.prefs.level || 'vegetarian', state.prefs.store_slug);
        location.hash = `#/r/${out.recipe.slug}`;
      } catch (err) {
        status.replaceChildren(el('span', { class: 'error' }, err.message));
        go.disabled = false;
      }
    },
  }, '🌿 Kindify');

  // No pitch and no justification — just what you get. The copy stays
  // level-neutral ("plant-based" is true of vegan too) so it does not go stale
  // when the header toggle changes underneath an open page.
  return el('div', { class: 'kindness-bar' },
    el('div', {},
      el('p', {}, 'Kindify it for a plant-based version, with macro tuning and a grocery list.'),
      status),
    go);
}

// ------------------------------------------------------------------ report

function reportPanel(recipe, rep) {
  const out = [];
  const t = rep.transform || {};

  if (t.degraded) out.push(el('p', { class: 'note warn' }, t.degraded));
  if (t.swaps?.length || t.unresolved?.length) {
    out.push(el('section', { class: 'card' },
      el('h2', {}, 'What changed'),
      (t.swaps || []).map((s) => el('div', { class: 'benefit' },
        el('span', { class: 'icon' }, '→'),
        el('div', {},
          el('b', {}, `${s.from_name} → ${s.to_name}`),
          s.why && el('span', {}, s.why),
          s.alternates?.length && el('span', { class: 'quiet' }, ` Other options: ${s.alternates.map((a) => a.to_name).join(', ')}.`)))),
      // Not a caveat about quality — an ingredient we have no swap for, which
      // the cook has to decide about themselves. Hiding this would leave meat
      // in a recipe the button said it had taken out.
      (t.unresolved || []).map((u) => el('div', { class: 'benefit caveat' },
        el('span', { class: 'icon' }, '?'),
        el('div', {},
          el('b', {}, u.name),
          el('span', {}, 'We have no swap for this one, so it is left as it was — your call what to do with it.'))))));
  }

  if (t.method_notes?.length) {
    out.push(el('section', { class: 'card' },
      el('h2', {}, 'Cooking notes'),
      t.method_notes.map((n) => el('div', { class: 'benefit' },
        el('span', { class: 'icon' }, '·'),
        el('div', {}, el('b', {}, n.about), el('span', {}, n.text))))));
  }

  // Gains only. The server still computes `benefits.caveats` and the full
  // nutrition table below shows every figure — sodium, protein and the rest —
  // so nothing is concealed; this panel simply does not editorialise a number
  // as a loss. Product decision, see CLAUDE.md.
  const b = rep.benefits;
  if (b && b.good.length) {
    const ICON = { cost: '💰', satfat: '🫀', fiber: '🌾', cholesterol: '🥚', sodium: '🧂', protein: '💪', kcal: '🔥' };
    out.push(el('section', { class: 'card' },
      el('h2', {}, 'What you gain'),
      b.good.map((x) => el('div', { class: 'benefit' },
        el('span', { class: 'icon' }, ICON[x.kind] || '✓'),
        el('div', {}, el('b', {}, x.headline), x.detail && el('span', {}, x.detail)))),
      rep.cost.store && el('p', { class: 'quiet', style: 'margin:.9rem 0 0' },
        `Estimated prices at ${rep.cost.store.name}.`)));
  }

  out.push(macrosCard(recipe, rep));
  out.push(tuningCard(recipe, rep));
  out.push(groceryCard(recipe));
  return frag(out);
}

function macrosCard(recipe, rep) {
  const ROWS = [['kcal', 'Calories', ''], ['protein', 'Protein', ' g'], ['carb', 'Carbs', ' g'],
    ['fat', 'Fat', ' g'], ['satfat', 'Saturated fat', ' g'], ['fiber', 'Fibre', ' g'],
    ['sodium_mg', 'Sodium', ' mg'], ['chol_mg', 'Cholesterol', ' mg']];
  const { after } = rep.nutrition;

  // Deliberately this recipe's numbers only. The original's macros are not
  // shown and neither is a diff — the "what you gain" panel above already makes
  // the comparisons that are worth making, and only where they clear a
  // threshold. A full side-by-side invites reading noise as signal.
  return el('section', { class: 'card' },
    el('h2', {}, 'Nutrition, per serving'),
    el('table', { class: 'macros' },
      el('tbody', {}, ROWS.map(([k, label, unit]) => el('tr', {},
        el('th', {}, label),
        el('td', {}, Math.round(after[k]) + unit))))),
    el('p', { class: 'quiet', style: 'margin-top:.9rem' },
      rep.nutrition.coverage >= 0.999
        ? 'Estimated, with every ingredient counted.'
        : `Estimated, with about ${Math.round(rep.nutrition.coverage * 100)}% of the ingredients counted.`,
      rep.nutrition.unmatched?.length ? ` Not counted: ${rep.nutrition.unmatched.join(', ')}.` : ''));
}

// What the recipe calls this ingredient, rather than the key we store it under.
function ingredientLabel(recipe, key) {
  const line = (recipe.ingredients || []).find((l) => l.ingredient_key === key);
  const name = line?.raw_name || key.replace(/_/g, ' ');
  return name.split(',')[0].replace(/\s*\([^)]*\)/g, '').trim();
}

// Two-sided macro targets, the same idea as platemath's axes: a bound only
// starts constraining once you pull its handle off the end of the track, and
// anything inside the range is already a pass.
function tuningCard(recipe, rep) {
  const bounds = JSON.parse(JSON.stringify(state.prefs.targets || {}));
  const result = el('div');
  const rows = el('div', { class: 'axes' });
  const sync = {};

  for (const k of AK) {
    const A = AXES[k];
    if (!bounds[k]) bounds[k] = { lo: A.min, hi: A.max };
    const b = bounds[k];

    const valueLabel = el('span', { class: 'axis-v' });
    const fill = el('i', { class: 'fill' });
    const lo = el('input', { type: 'range', min: A.min, max: A.max, step: A.step, value: b.lo,
      'aria-label': `${A.label} lower bound` });
    const hi = el('input', { type: 'range', min: A.min, max: A.max, step: A.step, value: b.hi,
      'aria-label': `${A.label} upper bound` });

    sync[k] = () => {
      const pc = (v) => ((v - A.min) / (A.max - A.min)) * 100;
      fill.style.left = `${pc(b.lo)}%`;
      fill.style.right = `${100 - pc(b.hi)}%`;
      // Whichever handle is nearer the middle has to sit on top, or the pair
      // can get stuck at one end.
      const mid = (b.lo + b.hi) / 2 > (A.min + A.max) / 2;
      lo.style.zIndex = mid ? 6 : 4;
      hi.style.zIndex = mid ? 4 : 6;
      const t = axisText(k, bounds);
      valueLabel.textContent = t;
      valueLabel.classList.toggle('inert', t === 'any');
    };

    const onInput = (which) => () => {
      const v = Number(which === 'lo' ? lo.value : hi.value);
      if (which === 'lo') b.lo = Math.min(v, b.hi);
      else b.hi = Math.max(v, b.lo);
      lo.value = b.lo; hi.value = b.hi;
      sync[k]();
    };
    lo.addEventListener('input', onInput('lo'));
    hi.addEventListener('input', onInput('hi'));

    rows.append(el('div', { class: 'axis' },
      el('div', { class: 'axis-h' }, el('span', { class: 'axis-n' }, A.label), valueLabel),
      el('div', { class: 'dual' }, el('span', { class: 'rail' }), fill, lo, hi)));
    sync[k]();
  }

  const anyActive = () => AK.some((k) => isActive(k, bounds));

  const run = async (save) => {
    if (!anyActive()) {
      result.replaceChildren(el('p', { class: 'quiet' }, 'Every axis is set to "any" — drag a handle inward to set a range.'));
      return;
    }
    result.replaceChildren(el('span', { class: 'spinner' }));
    try {
      const out = await api.tune(recipe.id, bounds, save);
      state.prefs.targets = out.bounds;
      if (save) { location.hash = `#/r/${recipe.slug}`; route(); return; }

      result.replaceChildren(frag(
        el('table', { class: 'macros', style: 'margin-top:1rem' },
          el('thead', {}, el('tr', {}, el('th', {}, ''), el('th', {}, 'Now'), el('th', {}, 'Tuned'), el('th', {}, 'Your range'))),
          el('tbody', {}, AK.map((k) => {
            const active = isActive(k, bounds);
            const inside = active && out.after[k] >= bounds[k].lo && out.after[k] <= bounds[k].hi;
            return el('tr', {},
              el('th', {}, AXES[k].label),
              el('td', { class: 'quiet' }, Math.round(out.before[k])),
              el('td', { class: active ? (inside ? 'in-range' : 'out-range') : '' }, Math.round(out.after[k])),
              el('td', { class: 'quiet' }, axisText(k, bounds)));
          }))),
        out.alreadyFits
          ? el('p', { class: 'note' }, 'This recipe is already inside every range you set, so nothing was changed.')
          : Object.keys(out.multipliers).length
            ? el('p', { class: 'quiet' }, 'Adjusted: ' + Object.entries(out.multipliers)
                .map(([k, v]) => `${ingredientLabel(recipe, k)} ${v > 1 ? 'up' : 'down'} to ×${v}`).join(', '))
            : el('p', { class: 'quiet' }, 'Nothing needed changing.'),
        out.notes.map((n) => el('p', { class: 'note warn' }, n)),
        !out.alreadyFits && Object.keys(out.multipliers).length
          ? el('button', { class: 'tiny', onClick: () => run(true) }, 'Apply to this recipe')
          : null));
    } catch (err) {
      result.replaceChildren(el('p', { class: 'error' }, err.message));
    }
  };

  return el('section', { class: 'card' },
    el('h2', {}, 'Fit it to your macros'),
    el('p', { class: 'quiet' },
      'Per serving. Drag the handles to set a range, or leave one wide open for “any”.'),
    rows,
    el('div', { class: 'row', style: 'margin-top:1rem' },
      el('button', { onClick: () => run(false) }, 'Preview'),
      el('button', {
        class: 'ghost tiny', onClick: () => {
          for (const k of AK) { bounds[k] = { lo: AXES[k].min, hi: AXES[k].max }; sync[k](); }
          result.replaceChildren();
        },
      }, 'Reset')),
    result);
}

function groceryCard(recipe) {
  const storeSel = el('select', {}, state.stores.map((s) =>
    el('option', { value: s.slug, selected: s.slug === state.prefs.store_slug }, s.name)));
  const servings = el('input', { type: 'number', min: '1', max: '24', value: recipe.servings });
  const result = el('div');

  return el('section', { class: 'card' },
    el('h2', {}, 'Turn it into a shop'),
    el('div', { class: 'fields' },
      el('label', {}, 'Store', storeSel),
      el('label', {}, 'Servings', servings)),
    el('div', { class: 'row', style: 'margin-top:.9rem' },
      el('button', {
        class: 'primary', onClick: async (e) => {
          e.target.disabled = true;
          result.replaceChildren(el('span', { class: 'spinner' }));
          try {
            const out = await api.grocery(recipe.id, storeSel.value, Number(servings.value));
            state.prefs.store_slug = storeSel.value;
            location.hash = `#/list/${out.list.id}`;
          } catch (err) {
            result.replaceChildren(el('p', { class: 'error' }, err.message));
          } finally { e.target.disabled = false; }
        },
      }, 'Make a grocery list'),
      state.instacart?.enabled && instacartButton(recipe, servings, result)),
    result);
}

// Hands the ingredient list to Instacart, which matches products per store and
// returns a page the reader checks out on. We never place the order — same
// posture as platemath linking out rather than taking payment. The link is
// opened only by the reader's own click, and it is cached server-side so
// pressing this twice does not issue two.
function instacartButton(recipe, servings, result) {
  const btn = el('button', {
    onClick: async () => {
      btn.disabled = true;
      result.replaceChildren(el('span', { class: 'spinner' }), ' Asking Instacart to match products…');
      try {
        const out = await api.instacart(recipe.id, Number(servings.value), location.href);
        result.replaceChildren(
          el('p', {},
            el('a', { href: out.url, target: '_blank', rel: 'noopener noreferrer', class: 'instacart-link' },
              'Open this recipe on Instacart ↗')),
          el('p', { class: 'quiet' },
            out.cached ? 'Reusing the link made earlier. ' : '',
            'You pick the store and review everything before anything is bought. ',
            'Instacart only shows stores that carry enough of the recipe.'));
      } catch (err) {
        result.replaceChildren(el('p', { class: 'error' }, err.message));
      } finally { btn.disabled = false; }
    },
  }, '🛒 Send to Instacart');
  return btn;
}

// ------------------------------------------------------------------ list

async function renderList(id) {
  busy('Loading list…');
  const data = await api.groceryList(Number(id));
  const byAisle = new Map();
  for (const i of data.items) {
    const key = i.unmatched ? 'not matched to a product'
      : i.likely_have ? 'probably already in your kitchen'
      : (i.aisle || 'other');
    if (!byAisle.has(key)) byAisle.set(key, []);
    byAisle.get(key).push(i);
  }

  const rows = [];
  for (const [aisle, items] of [...byAisle].sort((a, b) => a[0].localeCompare(b[0]))) {
    rows.push(el('p', { class: 'aisle' }, aisle));
    for (const i of items) {
      const box = el('input', {
        type: 'checkbox', checked: Boolean(i.checked), disabled: Boolean(i.unmatched),
        onChange: async (e) => {
          const out = await api.check(Number(id), i.id, e.target.checked);
          const row = e.target.closest('.item');
          row.classList.toggle('checked', e.target.checked);
          total.textContent = out.totals.display;
        },
      });
      rows.push(el('div', { class: `item${i.checked ? ' checked' : ''}` }, box,
        el('label', {}, i.display,
          i.unmatched
            ? el('small', {}, 'no product matched — pick this one up yourself')
            : el('small', {}, `need about ${grams(i.need_grams)} · ${i.packs} pack${i.packs > 1 ? 's' : ''}`)),
        !i.unmatched && el('span', { class: 'price' }, `$${(i.price_cents / 100).toFixed(2)}`)));
    }
  }

  const total = el('b', {}, data.totals.display);
  view.replaceChildren(frag(
    el('p', { class: 'quiet' }, el('a', { href: `#/r/${data.list.slug}` }, `← ${data.list.title}`)),
    el('h1', {}, 'Grocery list'),
    el('p', { class: 'lede', style: 'text-align:left;margin-left:0' },
      `${data.list.store_name} · ${data.list.servings} servings`),
    el('section', { class: 'card' }, rows),
    el('p', { class: 'row', style: 'justify-content:space-between;margin-top:1.2rem' },
      el('span', {}, 'Estimated total'), total),
    data.totals.staples_count > 0 && el('p', { class: 'row quiet', style: 'justify-content:space-between' },
      el('span', {}, `Plus ${data.totals.staples_count} staple${data.totals.staples_count > 1 ? 's' : ''} you probably already have`),
      el('span', {}, data.totals.staples_display)),
    el('p', { class: 'quiet' },
      'Estimated prices. Whole packages are counted, so one teaspoon of a spice shows the price of the jar.')));
}

// A pinch of thyme is a real quantity; "0 g" reads like a bug.
function grams(g) {
  if (g == null) return '—';
  if (g < 1) return 'a pinch';
  if (g < 10) return `${Math.round(g * 10) / 10} g`;
  if (g >= 1000) return `${Math.round(g / 100) / 10} kg`;
  return `${Math.round(g)} g`;
}

// ------------------------------------------------------------------ library

async function renderLibrary() {
  busy('Loading…');
  const data = await api.library();
  const section = (title, items, render, empty) => el('section', { class: 'section' },
    el('div', { class: 'section-head' }, el('h2', {}, title)),
    items.length ? el('div', { class: 'grid' }, items.map(render)) : el('p', { class: 'quiet' }, empty));

  view.replaceChildren(frag(
    el('h1', {}, 'Library'),
    el('p', { class: 'lede', style: 'text-align:left;margin-left:0' }, 'Everything you’ve saved and made.'),
    section('Saved', data.saved, (r) => recipeCard(r), 'Nothing saved yet.'),
    section('Transformed', data.transformed, (r) => el('a', { class: 'card recipe-card', href: `#/r/${r.slug}`, style: 'text-decoration:none;color:inherit' },
      el('span', { class: 'emoji' }, r.emoji || '🌿'),
      el('h3', {}, r.title),
      r.parent_title && el('p', {}, `from ${r.parent_title}`),
      el('div', { class: 'meta' }, el('span', { class: 'tag plant' }, DIET_LABEL[r.diet] || r.diet))),
      'No transformations yet.'),
    section('Grocery lists', data.lists, (l) => el('a', { class: 'card recipe-card', href: `#/list/${l.id}`, style: 'text-decoration:none;color:inherit' },
      el('span', { class: 'emoji' }, '🧺'),
      el('h3', {}, l.title),
      el('p', {}, `${l.store} · ${l.servings} servings`)),
      'No lists yet.')));
}

// ------------------------------------------------------------------ header

// "Plant-based" is the default and means vegetarian — dairy and eggs stay.
// "Vegan" narrows it. Set once, applies to every Kindify from then on.
function mountDietToggle() {
  const host = document.getElementById('diet-toggle');
  if (!host) return;

  const mk = (val, label, title) => el('button', {
    type: 'button', title, 'aria-pressed': String((state.prefs.level || 'vegetarian') === val),
    onClick: (e) => {
      if (state.prefs.level === val) return;
      state.prefs.level = val;
      for (const b of e.target.parentElement.children) {
        b.setAttribute('aria-pressed', String(b === e.target));
      }
      api.prefs({ level: val }).catch(() => {});
    },
  }, label);

  host.replaceChildren(el('div', { class: 'toggle mini', role: 'group', 'aria-label': 'What Kindify swaps out' },
    mk('vegetarian', 'Plant-based', 'Swap out meat and fish. Dairy and eggs stay.'),
    mk('vegan', 'Vegan', 'Swap out every animal ingredient, dairy and eggs included.')));
  host.hidden = false;
}

// ------------------------------------------------------------------ boot

(async function boot() {
  try {
    const b = await api.bootstrap();
    setAxes(b.axes);
    Object.assign(state, { stores: b.stores, llm: b.llm, instacart: b.instacart });
    state.static = Boolean(b.static);
    state.prefs = { ...state.prefs, ...b.prefs };
    mountDietToggle();
    if (!b.llm.enabled) {
      const badge = document.getElementById('llm-badge');
      badge.textContent = state.static ? 'published copy' : 'limited mode';
      badge.title = state.static
        ? 'A published copy of a tool that runs locally. Writing new recipes and reading links need a server.'
        : 'Recipe rewriting and link reading are unavailable. Everything else works.';
      badge.hidden = false;
    }
  } catch (err) {
    view.replaceChildren(el('div', { class: 'center error' }, 'Could not reach the server. Is it running?'));
    return;
  }
  window.addEventListener('hashchange', route);
  route();
})();
