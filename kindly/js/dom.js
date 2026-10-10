// Tiny DOM helpers. Everything is built with these rather than innerHTML so
// recipe text from an imported page can never inject markup.

export function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v == null || v === false) continue;
    if (k === 'class') node.className = v;
    else if (k === 'html') node.innerHTML = v;
    else if (k.startsWith('on')) node.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'dataset') Object.assign(node.dataset, v);
    else if (k in node && k !== 'list') node[k] = v;
    else node.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat(Infinity)) {
    if (c == null || c === false) continue;
    node.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return node;
}

export const frag = (...kids) => { const f = document.createDocumentFragment(); f.append(...kids.flat(Infinity).filter(Boolean)); return f; };

export function amount(qty, unit) {
  if (qty == null) return '';
  const FRACTIONS = { 0.25: '¼', 0.5: '½', 0.75: '¾' };
  const rounded = qty < 10 ? Math.round(qty * 4) / 4 : Math.round(qty);
  const whole = Math.floor(rounded);
  const frac = Math.round((rounded - whole) * 100) / 100;
  let n = FRACTIONS[frac] ? (whole ? `${whole}${FRACTIONS[frac]}` : FRACTIONS[frac]) : String(rounded);
  if (!unit || unit === 'unit') return n;
  return `${n} ${unit}`;
}

export const DIET_LABEL = { vegan: 'Vegan', vegetarian: 'Vegetarian', pescatarian: 'Pescatarian', omnivore: 'Contains meat' };
export const isPlant = (d) => d === 'vegan' || d === 'vegetarian';

export function timeLabel(prep, cook) {
  const total = (prep || 0) + (cook || 0);
  if (!total) return null;
  if (total < 60) return `${total} min`;
  const h = Math.floor(total / 60), m = total % 60;
  return m ? `${h} hr ${m} min` : `${h} hr`;
}
