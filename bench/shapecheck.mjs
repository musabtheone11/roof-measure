// Outline comparison for the benchmark and the fixtures: a roof with the right total area but the wrong shape must not pass.
// Polygons are rings of [x, y] in feet (or metres: units cancel in the percentages). Uses polygon-clipping (bench dependency).
import pc from 'polygon-clipping';
const ringArea = (r) => Math.abs(r.reduce((s, p, i) => { const q = r[(i + 1) % r.length]; return s + p[0] * q[1] - q[0] * p[1]; }, 0)) / 2;
const multiArea = (m) => m.reduce((s, poly) => s + poly.reduce((t, ring, i) => t + (i ? -1 : 1) * ringArea(ring), 0), 0);
const asMulti = (polys) => polys.map((r) => [r.map((p) => [p[0], p[1]])]);
// refPolys / runPolys: arrays of rings (plan outlines of facets or whole structures). Returns areas and the missing / extra parts.
export function compareOutlines(refPolys, runPolys) {
  const R = asMulti(refPolys), U = asMulti(runPolys);
  const ref = pc.union(...R), run = pc.union(...U);
  const refA = multiArea(ref), runA = multiArea(run);
  const missing = multiArea(pc.difference(ref, run)), extra = multiArea(pc.difference(run, ref)), inter = multiArea(pc.intersection(ref, run));
  const iou = refA + runA - inter > 0 ? inter / (refA + runA - inter) : 0;
  return { refArea: refA, runArea: runA, areaDiffPct: refA ? (runA - refA) / refA * 100 : null, missingArea: missing, extraArea: extra, missingPct: refA ? missing / refA * 100 : null, extraPct: refA ? extra / refA * 100 : null, iou };
}
// the rule the scorer applies: a report may not count as matching on area alone; shape must agree too
export function outlineVerdict(cmp, o = {}) { const tol = o.shapeTolPct == null ? 5 : o.shapeTolPct; const bad = []; if (cmp.missingPct > tol) bad.push(`missing ${cmp.missingPct.toFixed(1)}% of the reference outline`); if (cmp.extraPct > tol) bad.push(`${cmp.extraPct.toFixed(1)}% of the run outline is outside the reference`); return { ok: !bad.length, reasons: bad, areaMatches: Math.abs(cmp.areaDiffPct) <= (o.areaTolPct == null ? 2 : o.areaTolPct) }; }
