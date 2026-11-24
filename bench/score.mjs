// Scores engine output exactly the way app.js summarize()/edgeMetrics() turns it into report numbers.
import { FT, SQFT } from './synth.mjs';

const pitchFactor = (p) => Math.sqrt(144 + p * p) / 12;
const hipFactor = (p) => Math.sqrt(1 + (p * p) / 288);
const SLOPE = { eave: 'flat', valley: 'hip', hip: 'hip', ridge: 'flat', rake: 'rake', wall: 'flat', step: 'rake', transition: 'flat', parapet: 'flat', unspecified: 'flat' };
export const TYPES = ['eave', 'rake', 'ridge', 'hip', 'valley', 'step', 'wall', 'transition', 'unspecified'];

const ringArea = (r) => { let s = 0; for (let i = 0; i < r.length; i++) { const a = r[i], b = r[(i + 1) % r.length]; s += a[0] * b[1] - b[0] * a[1]; } return Math.abs(s / 2); };
function pointSeg(p, a, b) { const d = [b[0] - a[0], b[1] - a[1]]; const L2 = d[0] * d[0] + d[1] * d[1] || 1e-12; let t = ((p[0] - a[0]) * d[0] + (p[1] - a[1]) * d[1]) / L2; t = Math.max(0, Math.min(1, t)); return Math.hypot(p[0] - a[0] - t * d[0], p[1] - a[1] - t * d[1]); }

// exact = true: use the engine's fitted slope per facet and the plane-derived slope factor per line (what the app does for
// auto-traced geometry); false: rounded pitch and the generic rake / hip factors (the app's rule for hand-drawn geometry)
export function summarizeEngine(res, defaultPitch = 6, exact = false) {
  const facets = res.facets.map((f) => ({ pitch: f.pitch, slope: f.slope, poly: f.poly, plan: ringArea(f.poly) * SQFT }));
  let sloped = 0; const pitchAreas = {};
  for (const f of facets) { const a = f.plan * (exact && f.slope != null ? Math.sqrt(1 + f.slope * f.slope) : pitchFactor(f.pitch)); sloped += a; pitchAreas[f.pitch] = (pitchAreas[f.pitch] || 0) + a; }
  const byType = {}; for (const t of TYPES) byType[t] = 0;
  for (const e of res.edges) {
    const L = e.line; let plan = 0; for (let i = 1; i < L.length; i++) plan += Math.hypot(L[i][0] - L[i - 1][0], L[i][1] - L[i - 1][1]);
    const mid = [(L[0][0] + L[1][0]) / 2, (L[0][1] + L[1][1]) / 2];
    let best = null, bd = 0.6;
    for (const f of facets) for (let i = 0; i < f.poly.length; i++) { const d = pointSeg(mid, f.poly[i], f.poly[(i + 1) % f.poly.length]); if (d < bd) { bd = d; best = f.pitch; } }
    const p = best ?? defaultPitch; const s = SLOPE[e.type] || 'flat';
    byType[e.type] = (byType[e.type] || 0) + plan * FT * (exact && e.factor != null ? e.factor : s === 'flat' ? 1 : s === 'rake' ? pitchFactor(p) : hipFactor(p));
  }
  let pred = null, pa = -1; for (const [p, a] of Object.entries(pitchAreas)) if (a > pa) { pa = a; pred = +p; }
  return { sloped, facetCount: facets.length, byType, pitchAreas, predominant: pred };
}

export function compare(gt, en) {
  const row = { areaErrPct: (en.sloped - gt.sloped) / gt.sloped * 100, facetsGT: gt.facetCount, facetsEN: en.facetCount };
  for (const t of TYPES) { row['gt_' + t] = gt.byType[t] || 0; row['en_' + t] = en.byType[t] || 0; }
  // predominant pitch
  let gp = null, ga = -1; for (const [p, a] of Object.entries(gt.pitchAreas)) if (a > ga) { ga = a; gp = +p; }
  row.predGT = gp; row.predEN = en.predominant;
  // area-weighted pitch error: share of roof area whose engine pitch differs from truth (bin-wise overlap)
  const keys = new Set([...Object.keys(gt.pitchAreas).map((p) => Math.round(+p)), ...Object.keys(en.pitchAreas).map(Number)]);
  const g = {}; for (const [p, a] of Object.entries(gt.pitchAreas)) g[Math.round(+p)] = (g[Math.round(+p)] || 0) + a;
  let ov = 0; for (const k of keys) ov += Math.min(g[k] || 0, en.pitchAreas[k] || 0);
  row.pitchMatchPct = ov / gt.sloped * 100;
  return row;
}
