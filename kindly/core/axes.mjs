// The macro axes and their two-sided bounds.
//
// Ported from platemath's src/core/axes.js + the penalty maths in scoring.js,
// deliberately keeping the same shape so the two projects stay legible to each
// other. The important idea is that a target is a RANGE, not a point:
//
//   - A bound is only "on" once its handle moves off the end of the track.
//     lo at min and hi at max means "any", and that axis is ignored entirely.
//   - Anything inside the range scores zero penalty. A recipe that already fits
//     is left alone rather than being nudged toward some notional midpoint.
//   - Outside the range, the overshoot is normalised by the range's own width
//     (floored by tolFloor) so a wide range forgives more than a narrow one.
//
// Values are PER SERVING.

export const AXES = {
  kcal:    { label: 'Calories', unit: '',   min: 0, max: 1200, step: 10, tolFloor: 60 },
  protein: { label: 'Protein',  unit: ' g', min: 0, max: 80,   step: 1,  tolFloor: 6 },
  carb:    { label: 'Carbs',    unit: ' g', min: 0, max: 150,  step: 1,  tolFloor: 10 },
  fat:     { label: 'Fat',      unit: ' g', min: 0, max: 90,   step: 1,  tolFloor: 6 },
};

/** The browser gets these over /api/bootstrap rather than keeping its own copy. */
export const fmt = (k, v) => `${Math.round(v).toLocaleString()}${AXES[k].unit}`;

export const AK = Object.keys(AXES);

export const clamp = (x, a, b) => Math.min(b, Math.max(a, x));

/** Full-width (i.e. "any") bounds for every axis. */
export function defaultBounds() {
  return Object.fromEntries(AK.map((k) => [k, { lo: AXES[k].min, hi: AXES[k].max }]));
}

/** Which ends of this axis are actually constraining anything. */
export function bounds(k, b) {
  const A = AXES[k];
  const v = b?.[k];
  if (!v) return { loOn: false, hiOn: false };
  return { loOn: v.lo > A.min, hiOn: v.hi < A.max };
}

export const isActive = (k, b) => {
  const { loOn, hiOn } = bounds(k, b);
  return loOn || hiOn;
};

/**
 * How far outside the range a value sits, as a multiple of the axis tolerance.
 *
 * `capped` mirrors platemath: clamped to 1, for turning into a 0-100 fit score.
 * Uncapped is what the optimiser uses — a clamped penalty has zero gradient
 * once it saturates, which would leave a badly-off recipe with nothing to
 * descend towards.
 */
export function penalty(k, value, b, { capped = true } = {}) {
  const A = AXES[k];
  const v = b?.[k];
  const { loOn, hiOn } = bounds(k, b);
  if (!loOn && !hiOn) return null;          // axis is "any"

  let over;
  if (loOn && value < v.lo) over = v.lo - value;
  else if (hiOn && value > v.hi) over = value - v.hi;
  else return 0;                            // inside the range

  const width = loOn && hiOn ? v.hi - v.lo : (A.max - A.min) * 0.5;
  const scale = Math.max(A.tolFloor, 0.4 * width);
  const p = over / scale;
  return capped ? Math.min(1, p) : p;
}

/** 0-100, across every active axis. 100 when everything is inside its range. */
export function fitOf(macros, b) {
  let sum = 0, n = 0;
  for (const k of AK) {
    const p = penalty(k, macros[k] ?? 0, b);
    if (p === null) continue;
    sum += p; n++;
  }
  return n ? Math.round(100 * (1 - sum / n)) : 100;
}

/** "any" / "≥ 30 g" / "≤ 600" / "400 – 600" */
export function axisText(k, b) {
  const v = b?.[k];
  const { loOn, hiOn } = bounds(k, b);
  if (!loOn && !hiOn) return 'any';
  if (!loOn) return `≤ ${fmt(k, v.hi)}`;
  if (!hiOn) return `≥ ${fmt(k, v.lo)}`;
  return `${fmt(k, v.lo)} – ${fmt(k, v.hi)}`;
}

/**
 * Coerce anything that arrives over the wire into valid bounds.
 * Also migrates the old single-number target shape ({kcal: 600}) by opening a
 * ±10% band around it, so a saved preference from before ranges existed still
 * means roughly what the user meant.
 */
export function normaliseBounds(input) {
  const out = defaultBounds();
  if (!input || typeof input !== 'object') return out;
  for (const k of AK) {
    const raw = input[k];
    if (raw == null) continue;
    const A = AXES[k];
    let lo, hi;
    if (typeof raw === 'number' && Number.isFinite(raw)) {
      lo = raw * 0.9; hi = raw * 1.1;
    } else if (typeof raw === 'object') {
      lo = Number(raw.lo); hi = Number(raw.hi);
    }
    if (!Number.isFinite(lo)) lo = A.min;
    if (!Number.isFinite(hi)) hi = A.max;
    lo = clamp(lo, A.min, A.max);
    hi = clamp(hi, A.min, A.max);
    if (lo > hi) [lo, hi] = [hi, lo];
    out[k] = { lo: round(lo, A.step), hi: round(hi, A.step) };
  }
  return out;
}

function round(v, step) { return Math.round(v / step) * step; }
