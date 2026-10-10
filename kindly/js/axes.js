// Axis metadata arrives from /api/bootstrap so the ranges live in exactly one
// place (server/core/axes.mjs). These are live bindings: `setAxes` runs during
// boot, before any view renders.

export let AXES = {};
export let AK = [];

export function setAxes(served) {
  AXES = served || {};
  AK = Object.keys(AXES);
}

export const fmt = (k, v) => `${Math.round(v).toLocaleString()}${AXES[k]?.unit ?? ''}`;

/** "any" / "≥ 30 g" / "≤ 600" / "400 – 600" — mirrors axisText on the server. */
export function axisText(k, bounds) {
  const A = AXES[k];
  const v = bounds?.[k];
  if (!A || !v) return 'any';
  const loOn = v.lo > A.min;
  const hiOn = v.hi < A.max;
  if (!loOn && !hiOn) return 'any';
  if (!loOn) return `≤ ${fmt(k, v.hi)}`;
  if (!hiOn) return `≥ ${fmt(k, v.lo)}`;
  return `${fmt(k, v.lo)} – ${fmt(k, v.hi)}`;
}

export const isActive = (k, bounds) =>
  Boolean(AXES[k] && bounds?.[k] && (bounds[k].lo > AXES[k].min || bounds[k].hi < AXES[k].max));
