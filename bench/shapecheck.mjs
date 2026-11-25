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
// Shifted overlay or wrong geometry? (external geospatial review's test idea) Move the run outline so its area centroid sits on
// the reference's and compare again: a shape that fits after the move was drawn in the wrong place (a georeferencing shift);
// one that still does not fit has the wrong geometry. `shift` is the move in the polygons' units.
export function classifyMismatch(refPolys, runPolys, o = {}) {
  const before = compareOutlines(refPolys, runPolys);
  const cen = (polys) => { let W = 0, cx = 0, cy = 0; for (const r of polys) { let A = 0, x = 0, y = 0; for (let i = 0; i < r.length; i++) { const p = r[i], q = r[(i + 1) % r.length]; const f = p[0] * q[1] - q[0] * p[1]; A += f; x += (p[0] + q[0]) * f; y += (p[1] + q[1]) * f; } if (!A) continue; const w = Math.abs(A / 2); W += w; cx += w * x / (3 * A); cy += w * y / (3 * A); } return W ? [cx / W, cy / W] : [0, 0]; };
  const [rx, ry] = cen(refPolys), [ux, uy] = cen(runPolys); const dx = rx - ux, dy = ry - uy;
  const after = compareOutlines(refPolys, runPolys.map((r) => r.map((p) => [p[0] + dx, p[1] + dy])));
  const okIoU = o.iouOk == null ? 0.9 : o.iouOk;
  const kind = before.iou >= okIoU ? 'match' : after.iou >= okIoU ? 'shifted' : 'wrong-shape';
  return { kind, shift: Math.hypot(dx, dy), dx, dy, before, after };
}
