'use strict';
/* roofpdf.js - the Roof Measure report, drawn as vectors with jsPDF to the Diversity Contracting design handoff
 * (Nov 2026): grayscale, US Letter, two sheets plus detail sheets when plan labels would overlap and continuation
 * sheets when a schedule runs long.
 *   Sheet 1  Roof overview & takeoff: compact header (logo, address, imagery date, status), the axonometric roof sketch
 *            (a partial sketch when elevations are missing), a smaller property aerial, the net area / squares / pitch
 *            band, one building-takeoff row per building, and waste & order quantities shown separately.
 *   Sheet 2  Scaled measurement plan: vector plan with north arrow, scale bar and dimensions, keyed edge and facet
 *            schedules. Supported edges are solid, evidence-backed continuations dashed, unresolved zones hatched.
 *            Unsupported quantities print blank. Plan, sketch and schedules come from one geometry (rpModel).
 * Uses globals from app.js (state, computeTotals, EDGE_TYPES, ROOF_LINE_TYPES, structureOf, fileBase), report.js
 * (company, deliverFile, imageToDataURL), review.js (reviewState, reviewReportStatus) and roofmodel.js (RM).
 */
const GR = (g) => { const v = Math.round(Math.max(0, Math.min(1, g)) * 255); return [v, v, v]; };
const RP = {
  W: 612, H: 792, L: 32, R: 580, FOOT: 750, M: 32,
  INK: GR(0.1), TEXT: GR(0.12), CAP: GR(0.28), MUTE: GR(0.31), MUTE2: GR(0.36), RULE: GR(0.7), LINE: GR(0.18),
  // one line style per roof feature (weight, dash, gray). The same key is printed on the plan sheet.
  STYLE: {
    eave: { w: 1.4 }, rake: { w: 0.8 }, ridge: { w: 1.6 }, hip: { w: 0.85, dash: [4, 1.8] }, valley: { w: 1.05, dash: [1.6, 1.6] },
    step: { w: 0.9, dash: [0.9, 1.3] }, wall: { w: 0.9, dash: [0.9, 1.3] }, transition: { w: 0.9, dash: [5, 1.5, 1.1, 1.5] },
    parapet: { w: 1.1, g: 0.45 }, unspecified: { w: 0.8, dash: [2, 2], g: 0.5 },
  },
  FACET: [0.93, 0.9, 0.974, 0.951, 0.893, 0.925, 0.882],
};
const rpFtIn = (ft) => { let f = Math.floor(ft + 1e-9), i = Math.round((ft - f) * 12); if (i === 12) { f += 1; i = 0; } return `${f}' ${i}"`; };
const rpDimTxt = (ft) => { let f = Math.floor(ft + 1e-9), i = Math.round((ft - f) * 12); if (i === 12) { f += 1; i = 0; } return `${f}'-${i}"`; };
const rpNum = (v, d = 0) => (v == null || !isFinite(v) ? '' : (Math.round(v * 10 ** d) / 10 ** d).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d }));
const rpPitch = (p) => (p == null ? '' : p === 0 ? 'Flat' : `${Number.isInteger(p) ? p : (Math.round(p * 10) / 10)} / 12`);
const rpDate = (iso) => { if (!iso) return null; const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso)); if (!m) return String(iso); const M = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']; return `${m[3]} ${M[+m[2] - 1]} ${m[1]}`; };

// ------------------------------------------------------------------ model: everything the sheets draw, computed once
function rpModel() {
  const t = computeTotals(); const rv = typeof reviewState === 'function' ? reviewState() : null; const tr = state.trace; const src = state.source || null;
  const status = rv && typeof reviewReportStatus === 'function' ? reviewReportStatus(rv) : { status: 'COMPLETE', reasons: [] };
  const paths = [...t.facetsAll.map((x) => x.m.path), ...t.edges.map((x) => x.m.path), ...(t.hiddenZones || []).map((z) => z.path)];
  const fr = RM.frame(paths); if (!fr) return null;
  const ft = (v) => { const p = fr.xy(v); return [p[0] * RM.FT, p[1] * RM.FT]; };
  const facets = t.facetsAll.map((x) => ({ id: x.f.name, f: x.f, m: x.m, xy: x.m.path.map(ft), status: RM.statusOf(x.f), structure: structureOf(t, x.f.id) || 1 }));
  // roof lines carry key numbers and are counted; an obstruction boundary (visible roof stops at tree canopy) is neither
  const lines = t.edges.filter((x) => !EDGE_TYPES[x.e.type].notRoof).map((x, i) => ({ key: String(i + 1).padStart(2, '0'), n: i + 1, e: x.e, m: x.m, xy: x.m.path.map(ft), status: RM.statusOf(x.e), type: x.e.type, ref: x.e.ref || null, displayedFt: x.e.displayedFt == null ? null : +x.e.displayedFt }));
  const obLines = t.edges.filter((x) => EDGE_TYPES[x.e.type].notRoof).map((x, i) => ({ id: 'OB' + (i + 1), e: x.e, m: x.m, xy: x.m.path.map(ft) }));
  // hidden / review zones: possible roof that nothing seen supports. Hatched, never in a total; upper bound blank when unknown
  const zones = (t.hiddenZones || []).map((z) => { const F = facets.find((q) => q.id === z.facetName); return { ...z, xy: z.path.map(ft), group: F ? F.structure : (z.structure || null) }; });
  for (const L of [...lines, ...obLines]) { const a = L.xy[0], b = L.xy[1]; const m2 = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    L.facets = facets.filter((F) => !F.f.excluded && F.xy.some((p, k) => RM.pointSeg(m2, p, F.xy[(k + 1) % F.xy.length]) < 1.6)).map((F) => F.id).slice(0, 3);
    L.structure = (L.e.structure) || (facets.find((F) => L.facets.includes(F.id)) || {}).structure || 1; }
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const g of [...facets, ...lines, ...obLines, ...zones]) for (const p of g.xy) { if (p[0] < x0) x0 = p[0]; if (p[0] > x1) x1 = p[0]; if (p[1] < y0) y0 = p[1]; if (p[1] > y1) y1 = p[1]; }
  const ob = tr && tr.obstruction ? { ...tr.obstruction, trees: tr.obstruction.trees.map((o) => ({ ...o, xy: o.path.map(ft) })), structures: tr.obstruction.structures.map((o) => ({ ...o, xy: o.path.map(ft) })) } : null;
  const d = tr && tr.imageryDate ? tr.imageryDate : (state.solar && state.solar.imageryDate) || null;
  const imageryIso = src && src.imageryDate ? src.imageryDate : d ? `${d.year}-${String(d.month).padStart(2, '0')}-${String(d.day).padStart(2, '0')}` : null;
  const imagery = { date: imageryIso, label: src && src.imageryLabel ? src.imageryLabel : (imageryIso ? rpDate(imageryIso) : (src && src.kind === 'illustrative' ? 'Model only' : 'not reported')),
    quality: (tr && tr.imageryQuality) || (state.solar && state.solar.imageryQuality) || null,
    source: src && src.imagerySource ? src.imagerySource : tr ? 'Google Solar API aerial photo, building mask and 10 cm height model' : 'Google satellite imagery (trace drawn by hand)' };
  // area: confirmed first, then the supported estimate for hidden roof, then what is unresolved
  const ab = t.areaByStatus; let estLo = 0, estHi = 0, ranged = true;
  for (const F of facets) { if (F.f.excluded || F.status !== 'inferred') continue; const full = F.m.sloped; const inf = F.f.inferredSqft > 0 && F.f.inferredSqft < full && !F.f.edited ? F.f.inferredSqft : full; const r = F.f.rangeSqft;
    if (r && !F.f.edited) { const dd = Math.min(inf, (r[1] - r[0]) / 2); estLo += inf - dd; estHi += inf + dd; F.range = [full - dd, full + dd]; } else { estLo += inf; estHi += inf; ranged = false; } }
  const zoneUpper = zones.reduce((a, z) => a + (z.upperSqft || 0), 0), zoneUnknown = zones.some((z) => z.upperSqft == null);
  const area = { confirmed: ab.measured, estimate: ab.inferred, estLo, estHi, ranged, unresolvedTraced: ab.unresolved, zoneUpper, zoneUnknown, zoneCount: zones.length, obstructionFt: t.obstructionFt || 0 };
  area.fullKnown = !zones.length && ab.unresolved < 0.5;
  // buildings: the main house and each detached building, never merged silently
  const names = (src && src.buildingNames) || {};
  const structs = t.structures.map((g) => { const b = g.byType, zs = zones.filter((z) => z.group === g.index); const fs = facets.filter((F) => F.structure === g.index && !F.f.excluded);
    return { index: g.index, name: names[g.index] || (g.index === 1 ? 'Main house' : `Detached building ${g.index - 1}`), short: (() => { const nm = names[g.index] ? names[g.index].replace(/^(Main|Detached)\s+/i, '') : (g.index === 1 ? 'House' : `Bldg ${g.index}`); return nm.charAt(0).toUpperCase() + nm.slice(1); })(), facets: g.facetCount,
      sloped: g.sloped, confirmed: g.areaByStatus.measured, estimate: g.areaByStatus.inferred, unresolved: g.areaByStatus.unresolved, unresolvedFacets: fs.filter((F) => F.status === 'unresolved').length, zones: zs.length, zoneUpper: zs.reduce((a, z) => a + (z.upperSqft || 0), 0),
      predominant: g.predominant, eave: b.eave.true, rake: b.rake.true, ridge: b.ridge.true, hip: b.hip.true, valley: b.valley.true, step: b.step.true, wall: b.wall.true, transition: b.transition.true, flashing: b.step.true + b.wall.true }; });
  const kind = src ? (src.kind === 'illustrative' ? 'illustrative' : 'source') : 'measured';
  const review = status.status === 'REVIEW REQUIRED';
  const statusLabel = kind === 'illustrative' ? 'ILLUSTRATIVE' : review ? 'REVIEW REQUIRED' : kind === 'source' ? 'SOURCE TAKEOFF' : 'COMPLETE';
  const addr = String(state.address || '').split(','); const line1 = (src && src.addressLine1) || addr[0].trim() || 'Roof'; const line2 = (src && src.addressLine2) || addr.slice(1).join(',').replace(/,?\s*USA\s*$/, '').trim();
  const alt = tr && tr.alt && tr.alt.used ? tr.alt : null;
  const M = { status, statusLabel, kind, review, src, t, rv, tr, fr, ft, facets, lines, obLines, zones, area, structs, alt, ob, imagery, line1, line2,
    views: (state.altViews || []).slice(), evidence: (state.evidence || []).slice(), box: [x0, y0, x1, y1], address: state.address || '', job: state.jobName || '', auto: !!tr && !src,
    date: new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' }) };
  M.keys = rpKeys(M); return M;
}
// a descriptive sheet title from the geometry (the handoff examples carry their own)
function rpTitle(M) {
  if (M.src && M.src.title) return M.src.title;
  const b = M.t.byType; if (M.zones.length || M.area.unresolvedTraced > 0.5) return 'Roof with unresolved sections';
  if (b.valley.true > 10) return 'Intersecting roof planes';
  if ((M.t.predominant || 0) <= 2) return 'Low-slope roof';
  return b.hip.true > b.rake.true ? 'Residential hip roof' : 'Residential gable roof';
}

// ------------------------------------------------------------------ drawing primitives (gray levels 0 = black, 1 = white)
function rpDoc() {
  const doc = new window.jspdf.jsPDF({ unit: 'pt', format: 'letter', orientation: 'portrait', compress: true });
  doc.setFont('helvetica', 'normal'); doc.setLineJoin('round'); doc.setLineCap('butt');
  return doc;
}
const rpColor = (doc, kind, c) => (kind === 'fill' ? doc.setFillColor(c[0], c[1], c[2]) : kind === 'draw' ? doc.setDrawColor(c[0], c[1], c[2]) : doc.setTextColor(c[0], c[1], c[2]));
function rpText(doc, s, x, y, o = {}) {
  doc.setFont(o.font || 'helvetica', o.bold ? 'bold' : o.italic ? 'italic' : 'normal'); doc.setFontSize(o.size || 9); rpColor(doc, 'text', o.color || RP.INK);
  if (o.maxWidth) { const ls = doc.splitTextToSize(String(s), o.maxWidth); doc.text(ls, x, y, { align: o.align || 'left', lineHeightFactor: o.lh || 1.3 }); return y + ls.length * (o.size || 9) * (o.lh || 1.3); }
  doc.text(String(s), x, y, { align: o.align || 'left' }); return y + (o.size || 9) * 1.3;
}
const rpCap = (doc, s, x, y, size = 7.7, align = 'left') => rpText(doc, String(s).toUpperCase(), x, y, { size, bold: true, color: RP.CAP, align });
const rpWidth = (doc, s, size, bold, font) => { doc.setFont(font || 'helvetica', bold ? 'bold' : 'normal'); doc.setFontSize(size); return doc.getTextWidth(String(s)); };
function rpLn(doc, a, b, w = 0.55, g = 0.46, dash = []) { rpColor(doc, 'draw', GR(g)); doc.setLineWidth(w); doc.setLineDashPattern(dash, 0); doc.line(a[0], a[1], b[0], b[1]); doc.setLineDashPattern([], 0); }
function rpRect(doc, x, y, w, h, fill, stroke, lw = 0.55) { if (fill != null) rpColor(doc, 'fill', GR(fill)); if (stroke != null) { rpColor(doc, 'draw', GR(stroke)); doc.setLineWidth(lw); } doc.setLineDashPattern([], 0); doc.rect(x, y, w, h, fill != null && stroke != null ? 'FD' : fill != null ? 'F' : 'S'); }
function rpPoly(doc, pts, style) { if (pts.length < 2) return; const d = []; for (let i = 1; i < pts.length; i++) d.push([pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]]); doc.lines(d, pts[0][0], pts[0][1], [1, 1], style, true); }
function rpPolyline(doc, pts) { if (pts.length < 2) return; const d = []; for (let i = 1; i < pts.length; i++) d.push([pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]]); doc.lines(d, pts[0][0], pts[0][1], [1, 1], 'S', false); }
function rpPolyG(doc, pts, fill, stroke, w = 0.65, dash = []) { if (fill != null) rpColor(doc, 'fill', GR(fill)); if (stroke != null) { rpColor(doc, 'draw', GR(stroke)); doc.setLineWidth(w); } doc.setLineDashPattern(dash, 0); rpPoly(doc, pts, fill != null && stroke != null ? 'FD' : fill != null ? 'F' : 'S'); doc.setLineDashPattern([], 0); }
function rpHatch(doc, pts, step = 6, g = 0.52, w = 0.37) { rpColor(doc, 'draw', GR(g)); doc.setLineWidth(w); doc.setLineDashPattern([], 0); for (const s of RM.hatch(pts, step, 45)) doc.line(s[0][0], s[0][1], s[1][0], s[1][1]); }
// the line style of a roof feature: by type when it is measured; a dashed, lighter line for an evidence-backed continuation
// (inferred); a coarse stipple for a line marked unresolved. k scales the weight for small drawings.
function rpLineStyle(doc, type, status, k = 1) {
  const s = RP.STYLE[type] || RP.STYLE.unspecified;
  if (status === 'unresolved') { rpColor(doc, 'draw', GR(0.4)); doc.setLineWidth(1.5 * k); doc.setLineDashPattern([0.5, 2.2], 0); return; }
  if (status === 'inferred') { rpColor(doc, 'draw', GR(0.45)); doc.setLineWidth(0.95 * k); doc.setLineDashPattern([6, 2.6], 0); return; }
  rpColor(doc, 'draw', GR(s.g == null ? 0.18 : s.g)); doc.setLineWidth(s.w * k); doc.setLineDashPattern((s.dash || []).map((v) => v * Math.max(0.6, k)), 0);
}
// a key label: white box with a thin frame, or solid dark for facet IDs
function rpTag(doc, x, y, s, size = 8.2, solid = false) {
  const w = rpWidth(doc, s, size, true) + 7; rpRect(doc, x - w / 2, y - 6.6, w, 12, solid ? 0.19 : 1, solid ? null : 0.62, 0.45);
  rpText(doc, s, x, y + 2.6, { size, bold: true, color: solid ? GR(1) : GR(0.13), align: 'center' }); return { x0: x - w / 2, y0: y - 6.6, x1: x + w / 2, y1: y + 5.4 };
}
const rpRule = (doc, y) => rpLn(doc, [RP.L, y], [RP.R, y], 0.75, 0.18);
// design table: light header band, hairline between rows. widths sum to the table width; num = right-aligned columns
function rpTableD(doc, x, y, widths, head, rows, o = {}) {
  const rowh = o.rowh || 22, size = o.size || 10, headsz = o.headsz || 8.2, num = new Set(o.num || []); const total = widths.reduce((a, b) => a + b, 0);
  rpRect(doc, x, y, total, 19, 0.931); let cur = x;
  head.forEach((h, i) => { const right = num.has(i); rpText(doc, h, right ? cur + widths[i] - 6 : cur + 6, y + 13, { size: headsz, bold: true, color: GR(0.24), align: right ? 'right' : 'left' }); cur += widths[i]; });
  let yy = y + 19;
  rows.forEach((row, j) => { cur = x; const bold = o.lastBold && j === rows.length - 1;
    row.forEach((val, i) => { const right = num.has(i); if (val != null && val !== '') rpText(doc, val, right ? cur + widths[i] - 6 : cur + 6, yy + rowh * 0.66, { size, bold: bold || i === 0, color: GR(0.12), align: right ? 'right' : 'left' }); cur += widths[i]; });
    yy += rowh; rpLn(doc, [x, yy], [x + total, yy], 0.42, 0.7); });
  return yy;
}
function rpNorth(doc, x, y, ang = 0) {
  const a = ang * Math.PI / 180, v = [Math.sin(a), -Math.cos(a)], n = [-v[1], v[0]]; const pt = (z, k = 0) => [x + v[0] * z + n[0] * k, y + v[1] * z + n[1] * k];
  rpLn(doc, pt(-9), pt(13), 0.85, 0.18); rpPolyG(doc, [pt(14), pt(3, -3.7), pt(5), pt(3, 3.7)], 0.13, null); const e = pt(22); rpText(doc, 'N', e[0], e[1] + 3, { size: 8.3, bold: true, color: GR(0.1), align: 'center' });
}
// scale bar: two segments of `step` feet (filled, open) with monospaced labels
function rpBar(doc, x, y, k, step) { const d = step * k; rpRect(doc, x, y, d, 3.5, 0.15, 0.15); rpRect(doc, x + d, y, d, 3.5, 1, 0.15); [0, step, step * 2 + ' ft'].forEach((v, j) => rpText(doc, v, x + d * j, y + 15, { size: 7.7, font: 'courier', color: GR(0.25), align: 'center' })); }
// dimension line between a and b (page points), offset `off` points to the left of a->b (negative = right)
function rpDim(doc, a, b, off, label) {
  const dx = b[0] - a[0], dy = b[1] - a[1], L = Math.hypot(dx, dy) || 1, w = [dx / L, dy / L], n = [-w[1], w[0]]; const p = [a[0] + n[0] * off, a[1] + n[1] * off], q = [b[0] + n[0] * off, b[1] + n[1] * off]; const s = off > 0 ? 1 : -1;
  for (const [u, v] of [[a, p], [b, q]]) { rpLn(doc, [u[0] + n[0] * 2 * s, u[1] + n[1] * 2 * s], [v[0] + n[0] * 3 * s, v[1] + n[1] * 3 * s], 0.38, 0.54); rpLn(doc, [v[0] - 2.4 * w[0] + 2.4 * n[0], v[1] - 2.4 * w[1] + 2.4 * n[1]], [v[0] + 2.4 * w[0] - 2.4 * n[0], v[1] + 2.4 * w[1] - 2.4 * n[1]], 0.8, 0.26); }
  rpLn(doc, p, q, 0.48, 0.38);
  const mid = [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2]; let th = Math.atan2(-w[1], w[0]) * 180 / Math.PI; if (th < -90 || th > 90) th += 180;
  const sz = 8.7, tw = rpWidth(doc, label, sz, true); const ca = Math.cos(th * Math.PI / 180), sa = Math.sin(th * Math.PI / 180);
  const hw = tw / 2 + 3, hh = 5.5; const quad = [[-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh]].map(([u, v]) => [mid[0] + u * ca + v * sa, mid[1] - u * sa + v * ca]); rpPolyG(doc, quad, 1, null);   // white box behind the label
  rpRotText(doc, label, mid[0], mid[1], th, sz, GR(0.18), true);
}
// text centred on (x, y), rotated by deg (counter-clockwise), drawn from a computed start so every viewer agrees
function rpRotText(doc, s, x, y, deg, size, color, bold) {
  doc.setFont('helvetica', bold ? 'bold' : 'normal'); doc.setFontSize(size); rpColor(doc, 'text', color);
  const w = doc.getTextWidth(s), a = deg * Math.PI / 180, ca = Math.cos(a), sa = Math.sin(a), up = size * 0.34;
  doc.text(s, x - ca * w / 2 + sa * up, y + sa * w / 2 + ca * up, { angle: deg }); return w;
}
const rpInside = (p, r) => { let c = false; for (let i = 0, j = r.length - 1; i < r.length; j = i++) if ((r[i][1] > p[1]) !== (r[j][1] > p[1]) && p[0] < (r[j][0] - r[i][0]) * (p[1] - r[i][1]) / (r[j][1] - r[i][1]) + r[i][0]) c = !c; return c; };
// a point well inside a polygon for its label: the centroid when it is inside, else the middle of the widest chord
function rpLabelPoint(r) {
  let a = 0, cx = 0, cy = 0; for (let i = 0; i < r.length; i++) { const p = r[i], q = r[(i + 1) % r.length]; const k = p[0] * q[1] - q[0] * p[1]; a += k; cx += (p[0] + q[0]) * k; cy += (p[1] + q[1]) * k; }
  const c = Math.abs(a) > 1e-9 ? [cx / (3 * a), cy / (3 * a)] : r[0];
  let best = null, bw = -1; const ys = r.map((p) => p[1]), lo = Math.min(...ys), hi = Math.max(...ys);
  for (const tt of [0.5, 0.35, 0.65, 0.2, 0.8]) { const y = lo + (hi - lo) * tt; const xs = []; for (let i = 0; i < r.length; i++) { const p = r[i], q = r[(i + 1) % r.length]; if ((p[1] > y) !== (q[1] > y)) xs.push(p[0] + (y - p[1]) * (q[0] - p[0]) / (q[1] - p[1])); } xs.sort((p, q) => p - q);
    for (let i = 0; i + 1 < xs.length; i += 2) if (xs[i + 1] - xs[i] > bw) { bw = xs[i + 1] - xs[i]; best = [(xs[i] + xs[i + 1]) / 2, y]; } }
  return rpInside(c, r) ? { p: c, room: Math.max(bw, 0) } : { p: best || c, room: Math.max(bw, 0) };
}
function rpClip(doc, x, y, w, h) { doc.saveGraphicsState(); doc.rect(x, y, w, h, null); doc.clip(); doc.discardPath(); }
function rpUnclip(doc) { doc.restoreGraphicsState(); }

// ------------------------------------------------------------------ images: the logo, and aerials in grayscale
const rpAssets = { logo: null, logoTried: false };
async function rpLoadLogo() {
  if (rpAssets.logo || rpAssets.logoTried) return rpAssets.logo; rpAssets.logoTried = true;
  try { const r = await fetch('assets/logo-black.png'); if (!r.ok) throw new Error(r.status); const b = await r.blob(); rpAssets.logo = await new Promise((res, rej) => { const rd = new FileReader(); rd.onload = () => res(rd.result); rd.onerror = rej; rd.readAsDataURL(b); }); }
  catch (e) { console.warn('logo not available; drawing the vector mark', e); rpAssets.logo = null; }
  return rpAssets.logo;
}
// the Diversity Contracting logo (verified black artwork, transparent), fitted in a box; vector fallback when the file is missing
function rpLogo(doc, x, y, w, h) {
  if (rpAssets.logo) { const iw = 3157, ih = 1540; const k = Math.min(w / iw, h / ih); const dw = iw * k, dh = ih * k; doc.addImage(rpAssets.logo, 'PNG', x + (w - dw) / 2, y + (h - dh) / 2, dw, dh, 'dclogo', 'FAST'); return; }
  const U = 783, k = Math.min(w / 1568, h / U), ox = x + (w - 1568 * k) / 2, oy = y + (h - U * k) / 2; const X = (v) => ox + v * k, Y = (v) => oy + v * k;
  rpColor(doc, 'fill', GR(0.1)); rpColor(doc, 'draw', GR(0.1)); doc.setLineDashPattern([], 0);
  rpPoly(doc, [[783, 38], [984, 218], [984, 355], [890, 355], [890, 260], [783, 163], [730, 211], [730, 197], [709, 197], [709, 230], [676, 260], [676, 355], [583, 355], [583, 218]].map((p) => [X(p[0]), Y(p[1])]), 'F');
  for (const [wx, wy] of [[760, 221], [786, 221], [760, 248], [786, 248]]) doc.rect(X(wx), Y(wy), 21 * k, 21 * k, 'F');
  doc.setLineWidth(15 * k); doc.rect(X(46), Y(439), 1475 * k, 172 * k, 'S');
  doc.setFont('helvetica', 'bold'); doc.setFontSize(100 * k); const word = 'DIVERSITY CONTRACTING'; const cs = Math.max(0, (1280 * k - doc.getTextWidth(word)) / (word.length - 1)); rpColor(doc, 'text', GR(0.1)); doc.text(word, X(104), Y(561), { charSpace: cs });
  doc.setFontSize(36 * k); const tag = 'PROTECTING HOMES. RESPECTING PEOPLE'; const tsp = Math.max(0, (1090 * k - doc.getTextWidth(tag)) / (tag.length - 1)); doc.text(tag, X(240), Y(724), { charSpace: tsp });
}
// a data URL -> grayscale JPEG cropped to cover w:h (object-fit: cover); returns {src, w, h} or null
function rpGrayCover(src, ratio, maxW = 900, crop = null) {
  return new Promise((resolve) => { if (!src) { resolve(null); return; } const im = new Image(); im.onload = () => { try {
    let sw = im.naturalWidth, sh = im.naturalHeight, sx = 0, sy = 0; if (crop && crop.length === 4) { sx = crop[0]; sy = crop[1]; sw = crop[2] - crop[0]; sh = crop[3] - crop[1]; } if (ratio) { if (sw / sh > ratio) { const nw = sh * ratio; sx += (sw - nw) / 2; sw = nw; } else { const nh = sw / ratio; sy += (sh - nh) / 2; sh = nh; } }
    const k = Math.min(1, maxW / sw); const c = document.createElement('canvas'); c.width = Math.round(sw * k); c.height = Math.round(sh * k); const g = c.getContext('2d'); g.drawImage(im, sx, sy, sw, sh, 0, 0, c.width, c.height);
    const d = g.getImageData(0, 0, c.width, c.height); const a = d.data; for (let i = 0; i < a.length; i += 4) { const v = 0.299 * a[i] + 0.587 * a[i + 1] + 0.114 * a[i + 2]; a[i] = a[i + 1] = a[i + 2] = v; } g.putImageData(d, 0, 0);
    resolve({ src: c.toDataURL('image/jpeg', 0.88), w: c.width, h: c.height }); } catch (e) { resolve(null); } }; im.onerror = () => resolve(null); im.src = src; });
}
// the property aerial for sheet 1: the source document's photo (source takeoffs), else the Solar aerial layer of the
// trace flight, else Google Static Maps. North up. Returns {src, w, h, caption, credit} or null.
async function rpHeroAerial(M) {
  const ratio = 149 / 136;
  if (M.src && M.src.aerial && M.src.aerial.src) { const g = await rpGrayCover(M.src.aerial.src, ratio, 900, M.src.aerial.crop || null); return g ? { ...g, caption: M.src.aerial.caption || M.imagery.label, credit: M.src.aerial.credit || '' } : null; }
  if (M.kind === 'illustrative') return null;
  const [x0, y0, x1, y1] = M.box; const c = M.fr.ll([((x0 + x1) / 2) / RM.FT, ((y0 + y1) / 2) / RM.FT]); const padFt = 20;
  try { const cache = window.__layerCache || {}; const keys = Object.keys(cache).filter((k) => state.solar && k.startsWith(state.solar.name + '|')); const key = keys[keys.length - 1]; const rgb = key && cache[key].rgbT;
    if (rgb && rgb.bands) { const { w, h } = rgb; const o = rgb.toLL(0, 0), ex = rgb.toLL(w, 0), ey = rgb.toLL(0, h); const ax = (ex.lng - o.lng) / w, ay = (ex.lat - o.lat) / w, bx = (ey.lng - o.lng) / h, by = (ey.lat - o.lat) / h, det = ax * by - bx * ay;
      const toPx = (v) => { const dl = v.lng - o.lng, da = v.lat - o.lat; return [(dl * by - bx * da) / det, (ax * da - ay * dl) / det]; };
      const cs = [[x0 - padFt, y0 - padFt], [x1 + padFt, y1 + padFt], [x0 - padFt, y1 + padFt], [x1 + padFt, y0 - padFt]].map((p) => toPx(M.fr.ll([p[0] / RM.FT, p[1] / RM.FT])));
      let cx0 = Math.max(0, Math.floor(Math.min(...cs.map((p) => p[0])))), cx1 = Math.min(w, Math.ceil(Math.max(...cs.map((p) => p[0])))), cy0 = Math.max(0, Math.floor(Math.min(...cs.map((p) => p[1])))), cy1 = Math.min(h, Math.ceil(Math.max(...cs.map((p) => p[1]))));
      // make the crop the panel's aspect ratio, centred on the roof
      let cw = cx1 - cx0, ch = cy1 - cy0; if (cw / ch > ratio) { const nh = cw / ratio; const mid = (cy0 + cy1) / 2; cy0 = Math.max(0, Math.round(mid - nh / 2)); cy1 = Math.min(h, Math.round(mid + nh / 2)); } else { const nw = ch * ratio; const mid = (cx0 + cx1) / 2; cx0 = Math.max(0, Math.round(mid - nw / 2)); cx1 = Math.min(w, Math.round(mid + nw / 2)); }
      cw = cx1 - cx0; ch = cy1 - cy0;
      if (cw > 20 && ch > 20) { const cv = document.createElement('canvas'); cv.width = cw; cv.height = ch; const g = cv.getContext('2d'); const im = g.createImageData(cw, ch);
        for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) { const i = (cy0 + y) * w + cx0 + x, j = (y * cw + x) * 4; const v = 0.299 * rgb.bands[0][i] + 0.587 * rgb.bands[1][i] + 0.114 * rgb.bands[2][i]; im.data[j] = im.data[j + 1] = im.data[j + 2] = v; im.data[j + 3] = 255; }
        g.putImageData(im, 0, 0); return { src: cv.toDataURL('image/jpeg', 0.88), w: cw, h: ch, caption: (M.imagery.label || '') + '  /  north up', credit: 'Google Solar API aerial, same flight as the height model' }; } }
  } catch (e) { console.warn('aerial layer unavailable', e); }
  if (!state.key) return null;
  const z = 20, sc = 2, W = 640, H = 584;
  const url = `https://maps.googleapis.com/maps/api/staticmap?center=${c.lat.toFixed(7)},${c.lng.toFixed(7)}&zoom=${z}&size=${W}x${H}&scale=${sc}&maptype=satellite&key=${encodeURIComponent(state.key)}`;
  const src = typeof imageToDataURL === 'function' ? await imageToDataURL(url, 9000) : null; const g = await rpGrayCover(src, ratio); return g ? { ...g, caption: 'Current satellite view  /  north up', credit: 'Google Maps satellite (date not published)' } : null;
}

// ------------------------------------------------------------------ the plan view: one mapping from feet to the page
// Scale: the largest architectural scale that fits (1/4" ... 1/64" = 1'-0"), else a round "1 in = N ft". The plan can be
// rotated to the roof's long axis when that uses the sheet markedly better; the north arrow then shows true north.
const RP_SCALES = [{ perIn: 4, label: '1/4" = 1\'-0"' }, { perIn: 16 / 3, label: '3/16" = 1\'-0"' }, { perIn: 8, label: '1/8" = 1\'-0"' }, { perIn: 10, label: '1" = 10\'-0"' }, { perIn: 32 / 3, label: '3/32" = 1\'-0"' }, { perIn: 12, label: '1" = 12\'-0"' },
  { perIn: 16, label: '1/16" = 1\'-0"' }, { perIn: 20, label: '1" = 20\'-0"' }, { perIn: 24, label: '1" = 24\'-0"' }, { perIn: 30, label: '1" = 30\'-0"' }, { perIn: 32, label: '1/32" = 1\'-0"' }, { perIn: 40, label: '1" = 40\'-0"' }, { perIn: 50, label: '1" = 50\'-0"' }, { perIn: 64, label: '1/64" = 1\'-0"' }, { perIn: 80, label: '1" = 80\'-0"' }, { perIn: 100, label: '1" = 100\'-0"' }];
function rpDominantAngle(M) {
  // direction of the longest ridge or eave, in degrees from east (counter-clockwise), folded to (-90, 90]
  let best = null; for (const L of M.lines) { if (!['ridge', 'eave'].includes(L.type)) continue; const a = L.xy[0], b = L.xy[L.xy.length - 1]; const len = Math.hypot(b[0] - a[0], b[1] - a[1]); if (!best || len > best.len) best = { len, ang: Math.atan2(b[1] - a[1], b[0] - a[0]) * 180 / Math.PI }; }
  if (!best) return 0; let a = best.ang; while (a > 90) a -= 180; while (a <= -90) a += 180; return a;
}
function rpView(M, box, o = {}) {
  const rot = o.rotDeg || 0, cr = Math.cos(-rot * Math.PI / 180), sr = Math.sin(-rot * Math.PI / 180);
  const T = (p) => (rot ? [p[0] * cr - p[1] * sr, p[0] * sr + p[1] * cr] : p);
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  const src = o.ftBox ? [[o.ftBox[0], o.ftBox[1]], [o.ftBox[2], o.ftBox[3]], [o.ftBox[0], o.ftBox[3]], [o.ftBox[2], o.ftBox[1]]] : [...M.facets, ...M.lines, ...M.obLines, ...M.zones].flatMap((g) => g.xy);
  for (const p of src) { const q = T(p); if (q[0] < x0) x0 = q[0]; if (q[0] > x1) x1 = q[0]; if (q[1] < y0) y0 = q[1]; if (q[1] > y1) y1 = q[1]; }
  const pad = o.padFt == null ? 4 : o.padFt; const wFt = x1 - x0 + 2 * pad, hFt = y1 - y0 + 2 * pad;
  const need = Math.max(wFt / (box.w / 72), hFt / (box.h / 72)); const sc = RP_SCALES.find((s) => s.perIn >= need) || { perIn: Math.ceil(need / 50) * 50, label: `1" = ${Math.ceil(need / 50) * 50}'-0"` };
  const k = 72 / sc.perIn; const ox = box.x + (box.w - (x1 - x0) * k) / 2, oy = box.y + (box.h - (y1 - y0) * k) / 2;
  return { k, perIn: sc.perIn, label: sc.label, rot, T, P: (p) => { const q = T(p); return [ox + (q[0] - x0) * k, oy + (y1 - q[1]) * k]; }, box, ftBox: o.ftBox || null, extent: [x0, y0, x1, y1] };
}
// does rotating the plan to the roof's long axis save enough sheet? (the aerial beside it stays north up)
function rpChooseRotation(M, box) {
  const a = rpDominantAngle(M); if (Math.abs(a) < 3 || Math.abs(Math.abs(a) - 90) < 3) return 0;
  const area = (rot) => { const V = rpView(M, box, { rotDeg: rot }); return (V.extent[2] - V.extent[0]) * (V.extent[3] - V.extent[1]); };
  const base = area(0), r1 = area(a), r2 = area(a - 90 * Math.sign(a || 1));
  const best = r1 <= r2 ? a : a - 90 * Math.sign(a || 1); return area(best) < 0.86 * base ? best : 0;
}

// ------------------------------------------------------------------ the plan drawing (facets, zones, lines, keys, dimensions)
function rpFacetFill(M, F, i) { if (F.status === 'inferred') return 0.965; return RP.FACET[i % RP.FACET.length]; }
function rpDrawPlan(doc, M, V, o = {}) {
  const P = V.P; const k = o.k || 1; const inWin = (p) => !V.ftBox || (p[0] >= V.box.x + 4 && p[0] <= V.box.x + V.box.w - 4 && p[1] >= V.box.y + 4 && p[1] <= V.box.y + V.box.h - 4);
  if (V.ftBox) rpClip(doc, V.box.x, V.box.y, V.box.w, V.box.h);
  // facets: gray planes; an unresolved facet is hatched (its area is not supported); a cut-out is white with a dotted edge
  M.facets.forEach((F, i) => { const pts = F.xy.map(P);
    if (F.f.excluded) { rpPolyG(doc, pts, 1, 0.5, 0.5, [1.5, 1.5]); return; }
    if (F.status === 'unresolved') { rpPolyG(doc, pts, 0.985, null); rpHatch(doc, pts, 5.5 * k, 0.5, 0.35); return; }
    rpPolyG(doc, pts, rpFacetFill(M, F, i), null); });
  // review / hidden zones: hatched envelopes, in no total
  for (const Z of M.zones) rpHatch(doc, Z.xy.map(P), 5.5 * k, 0.48, 0.37);
  // facet outlines (thin), with a real gap where the visible roof stops at an obstruction boundary
  rpColor(doc, 'draw', GR(0.55)); doc.setLineWidth(0.4 * k); doc.setLineDashPattern([], 0);
  for (const F of M.facets) if (!F.f.excluded) rpRingGap(doc, F.xy, M.obLines, P);
  // lines, each in the style of its type and status; the lower line of a height break is offset a hair so both show
  for (const L of M.lines) { rpLineStyle(doc, L.type, L.status, k); let pts = L.xy.map(P);
    if (L.e.paired === 'lower' && pts.length >= 2) { const dx = pts[pts.length - 1][0] - pts[0][0], dy = pts[pts.length - 1][1] - pts[0][1], l = Math.hypot(dx, dy) || 1; pts = pts.map((p) => [p[0] - dy / l * 1.8, p[1] + dx / l * 1.8]); }
    rpPolyline(doc, pts); }
  doc.setLineDashPattern([], 0);
  // labels: facet IDs (solid tags) first, then one key tag per line (or per source reference), then zone tags
  const placed = []; const hit = (b) => placed.some((q) => !(b.x1 + 1 < q.x0 || b.x0 - 1 > q.x1 || b.y1 + 1 < q.y0 || b.y0 - 1 > q.y1)); const fits = (b) => inWin([b.x0, b.y0]) && inWin([b.x1, b.y1]);
  const tagBox = (x, y, s, size) => { const w = rpWidth(doc, s, size, true) + 7; return { x0: x - w / 2, y0: y - 6.6, x1: x + w / 2, y1: y + 5.4 }; };
  for (const F of M.facets) { if (F.f.excluded) continue; const lp = rpLabelPoint(F.xy); const c = P(lp.p); if (!inWin(c)) continue; const b = tagBox(c[0], c[1], F.id, 8.1); if (hit(b)) continue; rpTag(doc, c[0], c[1], F.id, 8.1, true); placed.push(b); }
  // review-zone tags next: inside the hatched envelope, sliding off the label point when a facet tag already sits there
  for (const Z of M.zones) { const xs = Z.xy.map((p) => p[0]), ys = Z.xy.map((p) => p[1]); const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
    const cands = [rpLabelPoint(Z.xy).p]; for (const fy of [0.5, 0.3, 0.7, 0.15, 0.85]) for (const fx of [0.5, 0.3, 0.7, 0.15, 0.85]) cands.push([x0 + (x1 - x0) * fx, y0 + (y1 - y0) * fy]);
    for (const q of cands) { if (!rpInside(q, Z.xy)) continue; const c = P(q); const b = tagBox(c[0], c[1], Z.id, 8.7); if (!fits(b) || hit(b)) continue; rpTag(doc, c[0], c[1], Z.id, 8.7); placed.push(b); break; } }
  // overall dimensions before the keys, so the keys move out of their way (dimension lines have one place to be)
  const dims = o.dims ? rpDrawDims(doc, M, V, placed) : 0;
  const missed = [], outside = [], placedKeys = [];
  // one tag per source reference (D1 ...) when the job carries them, else per line key
  const refMode = M.lines.some((L) => L.ref); const groups = new Map(); for (const L of M.lines) { if (refMode && !L.ref) continue; const g = L.ref || L.tag || L.key; if (!groups.has(g)) groups.set(g, []); groups.get(g).push(L); }
  const order = [...groups.entries()].sort((a, b) => b[1].reduce((s, L) => s + L.m.planFt, 0) - a[1].reduce((s, L) => s + L.m.planFt, 0));
  for (const [label, Ls] of order) {
    // the longest straight piece of the group carries the tag
    let bi = null, bl = -1; for (const L of Ls) for (let i = 1; i < L.xy.length; i++) { const d = Math.hypot(L.xy[i][0] - L.xy[i - 1][0], L.xy[i][1] - L.xy[i - 1][1]); if (d > bl) { bl = d; bi = [L.xy[i - 1], L.xy[i]]; } }
    if (!bi) continue; const a = P(bi[0]), b = P(bi[1]); const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1; const u = [(b[0] - a[0]) / len, (b[1] - a[1]) / len], n = [-u[1], u[0]]; const mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2;
    if (!inWin([mx, my])) { outside.push(label); continue; }
    if (o.noKeys) { missed.push(label); continue; }   // overview plan of a dense roof: keys live on the detail sheets
    const size = label.length > 2 ? 7.5 : 7.25; let done = false;
    // on the line first, then beside it, then further out on a leader (detail sheets allow longer leaders)
    const cands = [[0, 0], [0, 0.3], [0, -0.3]]; for (const d of (V.ftBox ? [9, 15, 21, 27, 33, 39, 45, 51] : [9, 15, 21, 27, 33])) for (const sh of [0, 0.28, -0.28, 0.45, -0.45]) cands.push([d, sh], [-d, sh]);
    for (const [d, sh] of cands) {
      const x = mx + n[0] * d + u[0] * sh * len, y = my + n[1] * d + u[1] * sh * len; const bx = tagBox(x, y, label, size); if (!fits(bx) || hit(bx)) continue;
      if (Math.abs(d) > 9.5) rpLn(doc, [mx + u[0] * sh * len, my + u[1] * sh * len], [x, y], 0.42, 0.44);
      rpTag(doc, x, y, label, size); placed.push(bx); placedKeys.push(label); done = true; break; }
    if (!done) missed.push(label);
  }
  if (V.ftBox) rpUnclip(doc);
  return { missed, outside, placed, placedKeys, keys: groups.size, dims };
}
// facet outline with a gap wherever it runs along an obstruction boundary
function rpRingGap(doc, ring, obLines, P) {
  const onOb = (p) => obLines.some((L) => { for (let i = 1; i < L.xy.length; i++) if (RM.pointSeg(p, L.xy[i - 1], L.xy[i]) < 0.9) return true; return false; });
  let run = []; const flush = () => { if (run.length > 1) rpPolyline(doc, run.map(P)); run = []; };
  for (let i = 0; i < ring.length; i++) { const a = ring[i], b = ring[(i + 1) % ring.length];
    if (obLines.length && onOb(a) && onOb(b) && onOb([(a[0] + b[0]) / 2, (a[1] + b[1]) / 2])) { flush(); continue; }
    if (!run.length) run.push(a); run.push(b); }
  flush();
}
// overall dimensions for a simple roof: each outline run of 10 ft or more gets a dimension line outside the roof
function rpDrawDims(doc, M, V, placed) {
  let count = 0; const done = new Set(); const axis = {};   // per structure: has a horizontal / vertical dimension yet
  const inside = (b) => !V.limit || (b.x0 >= V.limit.x0 && b.x1 <= V.limit.x1 && b.y0 >= V.limit.y0 && b.y1 <= V.limit.y1);
  const tryDim = (a, b, side, ft, structure, dk) => {
    if (dk && done.has(dk)) return false; const dx = b[0] - a[0], dy = b[1] - a[1], len = Math.hypot(dx, dy) || 1; const n = [-dy / len, dx / len], w = [dx / len, dy / len];
    // the label runs along the line, so its footprint is long along the line and shallow across it
    const txt = rpDimTxt(ft); const hw = rpWidth(doc, txt, 8.7, true) / 2 + 3, hh = 5.5;
    const off = 17 * side; const mid = [(a[0] + b[0]) / 2 + n[0] * off, (a[1] + b[1]) / 2 + n[1] * off]; const ex = Math.abs(w[0]) * hw + Math.abs(n[0]) * hh, ey = Math.abs(w[1]) * hw + Math.abs(n[1]) * hh;
    const bx = { x0: mid[0] - ex, y0: mid[1] - ey, x1: mid[0] + ex, y1: mid[1] + ey };
    // the strip between the roof edge and the dimension line is kept clear of key tags too
    const sg = Math.sign(off), corners = [a, b, [a[0] + n[0] * (off + 3 * sg), a[1] + n[1] * (off + 3 * sg)], [b[0] + n[0] * (off + 3 * sg), b[1] + n[1] * (off + 3 * sg)]];
    const strip = { x0: Math.min(...corners.map((p) => p[0])), y0: Math.min(...corners.map((p) => p[1])), x1: Math.max(...corners.map((p) => p[0])), y1: Math.max(...corners.map((p) => p[1])) };
    if (!inside(bx) || !inside(strip)) return false;
    if (placed.some((q) => !(bx.x1 < q.x0 || bx.x0 > q.x1 || bx.y1 < q.y0 || bx.y0 > q.y1))) return false;
    rpDim(doc, a, b, off, txt); placed.push(bx, strip); if (dk) done.add(dk); count++;
    (axis[structure] = axis[structure] || {})[Math.abs(dx) >= Math.abs(dy) ? 'h' : 'v'] = true; return true;
  };
  // outline runs of 10 ft or more on a simple roof (a busy plan carries its lengths in the keyed schedule)
  if (M.lines.length <= 16) {
    const outline = M.lines.filter((L) => ['eave', 'rake'].includes(L.type) && !L.e.paired && L.status === 'measured' && L.m.planFt >= 10);
    for (const L of outline) { const dk = [L.structure, Math.round(L.m.planFt * 10), Math.round(Math.abs(Math.atan2(L.xy[L.xy.length - 1][1] - L.xy[0][1], L.xy[L.xy.length - 1][0] - L.xy[0][0]) * 180 / Math.PI) % 180)].join('|'); if (done.has(dk)) continue; const a = V.P(L.xy[0]), b = V.P(L.xy[L.xy.length - 1]); const F = M.facets.find((q) => L.facets.includes(q.id)); if (!F) continue;
      const c = V.P(rpLabelPoint(F.xy).p); const dx = b[0] - a[0], dy = b[1] - a[1], len = Math.hypot(dx, dy) || 1; const n = [-dy / len, dx / len]; const side = (c[0] - a[0]) * n[0] + (c[1] - a[1]) * n[1] > 0 ? -1 : 1;   // away from the facet
      tryDim(a, b, side, L.m.planFt, L.structure, dk); }
  }
  // overall width and depth of each building whose outline is axis-aligned in this view and whose facets were all measured
  // (a sketch from a source document keeps that document's references; an estimated or unresolved plane gets no overall figure)
  if (!(M.src && M.src.kind === 'source')) for (const S of M.structs) {
    const Fs = M.facets.filter((F) => F.structure === S.index && !F.f.excluded); if (!Fs.length || Fs.some((F) => F.status !== 'measured')) continue;
    const pts = Fs.flatMap((F) => F.xy.map(V.P)); const x0 = Math.min(...pts.map((p) => p[0])), x1 = Math.max(...pts.map((p) => p[0])), y0 = Math.min(...pts.map((p) => p[1])), y1 = Math.max(...pts.map((p) => p[1]));
    let best = null; for (const L of M.lines) { if (L.structure !== S.index || !['eave', 'rake', 'ridge'].includes(L.type)) continue; const a = V.P(L.xy[0]), b = V.P(L.xy[L.xy.length - 1]); const len = Math.hypot(b[0] - a[0], b[1] - a[1]); if (!best || len > best.len) best = { len, ang: Math.abs(Math.atan2(b[1] - a[1], b[0] - a[0]) * 180 / Math.PI) % 180 }; }
    if (!best || !(best.ang < 3 || best.ang > 177 || Math.abs(best.ang - 90) < 3)) continue;
    const ax = axis[S.index] || {}; const wFt = (x1 - x0) / V.k, dFt = (y1 - y0) / V.k;
    if (!ax.h && wFt >= 6 && !tryDim([x0, y1], [x1, y1], 1, wFt, S.index, null)) tryDim([x1, y0], [x0, y0], 1, wFt, S.index, null);
    if (!ax.v && dFt >= 6 && !tryDim([x1, y1], [x1, y0], 1, dFt, S.index, null)) tryDim([x0, y0], [x0, y1], 1, dFt, S.index, null);
  }
  return count;
}

// ------------------------------------------------------------------ the axonometric sketch
// Faces are 3D polygons in feet (x east, y north, z up). Heights come from the fitted roof planes of the height model
// (walls drawn to the ground), from the pitch and down-slope direction of each facet (relative heights, no walls, labelled
// illustrative), or from a built-in illustrative model. Facets without any height are left out and the cut is hatched.
const RP_MODELS = {
  'hip-garage': { label: 'Generic hip roof with a detached gable garage', faces: [
    [[0, 0, 9], [44, 0, 9], [30, 14, 16], [14, 14, 16]], [[44, 0, 9], [44, 28, 9], [30, 14, 16]], [[44, 28, 9], [0, 28, 9], [14, 14, 16], [30, 14, 16]], [[0, 28, 9], [0, 0, 9], [14, 14, 16]],
    [[42, 39, 7], [62, 39, 7], [62, 47, 7 + 8 / 3], [42, 47, 7 + 8 / 3]], [[42, 47, 7 + 8 / 3], [62, 47, 7 + 8 / 3], [62, 55, 7], [42, 55, 7]]], walls: true },
  'cross-hip': { label: 'Generic cross-hip and gable study', faces: [
    [[0, 0, 8.5], [22, 0, 8.5], [31, 9, 13], [40, 0, 8.5], [52, 0, 8.5], [39, 13, 15], [13, 13, 15]], [[52, 0, 8.5], [52, 26, 8.5], [39, 13, 15]], [[52, 26, 8.5], [26, 26, 8.5], [18, 18, 12.5], [10, 26, 8.5], [0, 26, 8.5], [13, 13, 15], [39, 13, 15]], [[0, 26, 8.5], [0, 0, 8.5], [13, 13, 15]],
    [[22, -13, 8.5], [31, -13, 13], [31, 9, 13], [22, 0, 8.5]], [[31, -13, 13], [40, -13, 8.5], [40, 0, 8.5], [31, 9, 13]], [[10, 26, 8.5], [18, 18, 12.5], [18, 31, 12.5], [10, 39, 8.5]], [[18, 18, 12.5], [26, 26, 8.5], [26, 39, 8.5], [18, 31, 12.5]], [[10, 39, 8.5], [18, 31, 12.5], [26, 39, 8.5]]], walls: true },
};
function rpAxonModel(M) {
  const ill = M.src && M.src.illustration && RP_MODELS[M.src.illustration];
  if (ill) return { faces: ill.faces.map((pts) => ({ pts, label: null, status: 'measured' })), walls: ill.walls, basis: 'model', caption: 'Axonometric  /  illustrative model', note: [ill.label + '.', 'The property\'s reported geometry appears on sheet 2.'], illustrative: true };
  const ref = (M.tr && M.tr.ref) || (M.src && M.src.ref) || null; const faces = []; let omitted = 0, pitchDerived = 0;
  for (const F of M.facets) {
    if (F.f.excluded || F.status === 'unresolved') { if (!F.f.excluded) omitted++; continue; }
    let z = null;
    if (F.f.plane && ref) { const [a, b, c] = F.f.plane; z = F.m.path.map((v) => (a * (v.lng - ref.lng) * ref.kx + b * (v.lat - ref.lat) * ref.ky + c) * RM.FT); }
    else if ((F.f.slope != null && F.f.slope > 0) || (F.f.pitch != null && F.f.pitch > 0)) {
      // relative heights from the pitch: zero at the lowest edge, rising along the down-slope direction reversed
      const s = F.f.slope != null ? F.f.slope : F.f.pitch / 12; const dir = rpDownslope(M, F); if (dir) { const proj = F.xy.map((p) => p[0] * dir[0] + p[1] * dir[1]); const lo = Math.max(...proj); z = proj.map((v) => (lo - v) * s); pitchDerived++; } }
    else if (F.f.pitch === 0) z = F.xy.map(() => 0);
    if (!z) { omitted++; continue; }
    faces.push({ pts: F.xy.map((p, i) => [p[0], p[1], z[i]]), F, label: F.id, status: F.status });
  }
  if (!faces.length) return null;
  const absolute = faces.every((f) => f.F.f.plane) && !!ref;
  const partial = omitted > 0 || M.zones.length > 0; const sourceSketch = M.kind === 'source';
  const basis = sourceSketch ? 'sketch' : absolute ? 'planes' : 'pitch';
  const illustrativeJob = M.kind === 'illustrative';
  const caption = (partial ? 'Partial axonometric  /  ' : 'Axonometric  /  ') + (illustrativeJob ? 'illustrative model' : sourceSketch ? 'from the source sketch' : absolute ? 'measured height model' : 'pitch-derived heights, illustrative');
  const note = illustrativeJob ? [`${faces.length} roof planes with modelled elevations` + (M.structs.length > 1 ? ` across ${M.structs.length} buildings.` : '.'), 'Same model as sheet 2. All coordinates are illustrative.'] : sourceSketch ? [`${faces.map((f) => f.label).join(' and ')} only. ` + (partial ? 'Hatching marks the drawing cut.' : 'Heights follow the reported pitch.'), (M.src.axonNote) || 'Heights follow the reported pitch; other elevations remain open.'] : absolute ? [`${faces.length} roof plane${faces.length > 1 ? 's' : ''} on the heights measured in the 10 cm height model.`, 'Walls drawn to the ground. ' + (partial ? 'Planes without a supported height are left out; hatching marks the drawing cut.' : 'Same geometry as sheet 2.')]
    : [`${faces.length} plane${faces.length > 1 ? 's' : ''} drawn from the assigned pitch; heights are relative and illustrative.`, partial ? 'Planes without a supported pitch are left out. Hatching marks the drawing cut.' : 'No elevations were measured. Same outline as sheet 2.'];
  return { faces, walls: absolute && !(M.src && M.src.noWalls), basis, caption, note, illustrative: !absolute, partial };
}
// unit down-slope direction of a facet in plan feet: its own azimuth, else toward its eave line, else its longest unshared edge
function rpDownslope(M, F) {
  if (F.f.azimuth != null) { const a = F.f.azimuth * Math.PI / 180; return [Math.sin(a), Math.cos(a)]; }
  const c = rpLabelPoint(F.xy).p; const eaves = M.lines.filter((L) => L.type === 'eave' && L.facets.includes(F.id)); let best = null, bl = -1;
  const cands = eaves.length ? eaves.map((L) => [L.xy[0], L.xy[L.xy.length - 1]]) : F.xy.map((p, i) => [p, F.xy[(i + 1) % F.xy.length]]).filter(([a, b]) => !M.facets.some((G) => G !== F && !G.f.excluded && G.xy.some((p, i) => RM.pointSeg(a, p, G.xy[(i + 1) % G.xy.length]) < 0.5 && RM.pointSeg(b, p, G.xy[(i + 1) % G.xy.length]) < 0.5)));
  for (const [a, b] of cands) { const l = Math.hypot(b[0] - a[0], b[1] - a[1]); if (l > bl) { bl = l; best = [a, b]; } }
  if (!best) return null; const m = [(best[0][0] + best[1][0]) / 2, (best[0][1] + best[1][1]) / 2]; const d = [m[0] - c[0], m[1] - c[1]], L = Math.hypot(d[0], d[1]) || 1; return [d[0] / L, d[1] / L];
}
function rpDrawAxon(doc, M, AX, box, angle = -24, alt = 32) {
  const a = angle * Math.PI / 180, h = alt * Math.PI / 180; const sa = Math.sin(a), ca = Math.cos(a), sh = Math.sin(h), ch = Math.cos(h);
  const project = (p) => [ca * p[0] - sa * p[1], -sh * (sa * p[0] + ca * p[1]) - ch * p[2]]; const dist = (p) => sa * p[0] + ca * p[1] - p[2] * 0.04;
  // walls under the outline edges that face the viewer (only when heights are absolute)
  const walls = [];
  if (AX.walls) { const edgeCount = new Map(); const key = (p, q) => [p, q].map((v) => v.map((n) => n.toFixed(2)).join(',')).sort().join('|');
    for (const f of AX.faces) for (let i = 0; i < f.pts.length; i++) { const p = f.pts[i], q = f.pts[(i + 1) % f.pts.length]; const kk = key(p, q); edgeCount.set(kk, (edgeCount.get(kk) || 0) + 1); }
    for (const f of AX.faces) { const c = f.pts.reduce((s, p) => [s[0] + p[0] / f.pts.length, s[1] + p[1] / f.pts.length], [0, 0]);
      for (let i = 0; i < f.pts.length; i++) { const p = f.pts[i], q = f.pts[(i + 1) % f.pts.length]; if (edgeCount.get(key(p, q)) !== 1) continue;
        const dx = q[0] - p[0], dy = q[1] - p[1]; let n = [dy, -dx]; if ((c[0] - p[0]) * n[0] + (c[1] - p[1]) * n[1] > 0) n = [-n[0], -n[1]];
        if (n[0] * sa + n[1] * ca < 0) walls.push({ pts: [[p[0], p[1], p[2] - 0.35], [q[0], q[1], q[2] - 0.35], [q[0], q[1], 0], [p[0], p[1], 0]], tone: Math.abs(n[0]) < Math.abs(n[1]) ? 0.957 : 0.913 }); } } }
  const all = [...AX.faces.flatMap((f) => f.pts), ...walls.flatMap((w) => w.pts)].map(project);
  const mi = [Math.min(...all.map((p) => p[0])), Math.min(...all.map((p) => p[1]))], ma = [Math.max(...all.map((p) => p[0])), Math.max(...all.map((p) => p[1]))];
  const sc = Math.min(box.w / Math.max(1e-6, ma[0] - mi[0]), box.h / Math.max(1e-6, ma[1] - mi[1])); const shift = [box.x + box.w / 2 - sc * (mi[0] + ma[0]) / 2, box.y + box.h / 2 - sc * (mi[1] + ma[1]) / 2];
  const pr = (p) => { const q = project(p); return [shift[0] + sc * q[0], shift[1] + sc * q[1]]; };
  for (const w of walls.sort((p, q) => q.pts.reduce((s, v) => s + dist(v), 0) - p.pts.reduce((s, v) => s + dist(v), 0))) { rpPolyG(doc, w.pts.map(pr), w.tone, 0.55, 0.55); rpLn(doc, pr(w.pts[2]), pr(w.pts[3]), 0.65, 0.48); }
  // fascia under every silhouette edge, then the planes back to front, then the lines
  const key = (p, q) => [p, q].map((v) => v.map((n) => n.toFixed(2)).join(',')).sort().join('|'); const cnt = new Map(); const segs = [];
  for (const f of AX.faces) for (let i = 0; i < f.pts.length; i++) { const p = f.pts[i], q = f.pts[(i + 1) % f.pts.length]; const kk = key(p, q); if (!cnt.has(kk)) segs.push({ p, q, kk, f }); cnt.set(kk, (cnt.get(kk) || 0) + 1); }
  if (AX.walls) for (const s of segs) if (cnt.get(s.kk) === 1) rpPolyG(doc, [pr(s.p), pr(s.q), pr([s.q[0], s.q[1], s.q[2] - 0.35]), pr([s.p[0], s.p[1], s.p[2] - 0.35])], 0.85, 0.37, 0.5);
  const faces = AX.faces.slice().sort((p, q) => q.pts.reduce((s, v) => s + dist(v), 0) / q.pts.length - p.pts.reduce((s, v) => s + dist(v), 0) / p.pts.length);
  for (const f of faces) { const A = f.pts[0], B = f.pts[1], C = f.pts[f.pts.length - 1]; let n = [(B[1] - A[1]) * (C[2] - A[2]) - (B[2] - A[2]) * (C[1] - A[1]), (B[2] - A[2]) * (C[0] - A[0]) - (B[0] - A[0]) * (C[2] - A[2]), (B[0] - A[0]) * (C[1] - A[1]) - (B[1] - A[1]) * (C[0] - A[0])];
    const nl = Math.hypot(n[0], n[1], n[2]) || 1; n = n.map((v) => v / nl); if (n[2] < 0) n = n.map((v) => -v); const shade = Math.max(0.62, Math.min(0.95, 0.82 + 0.27 * n[0] + 0.29 * n[1]));
    rpPolyG(doc, f.pts.map(pr), f.status === 'inferred' ? Math.min(0.97, shade + 0.06) : shade, 0.23, 0.78, f.status === 'inferred' ? [3, 2] : []); }
  // edges: silhouette heaviest, level creases (ridges) next, sloped creases lightest; a cut against an omitted plane is dashed + hatched
  for (const s of segs) { const c = cnt.get(s.kk); const lw = c === 1 ? 1.08 : (Math.abs(s.p[2] - s.q[2]) < 0.05 ? 0.93 : 0.66);
    const cut = AX.partial && c === 1 && s.f.F && rpIsCutEdge(M, s.f.F, s.p, s.q);
    if (cut) { rpLn(doc, pr(s.p), pr(s.q), 0.75, 0.3, [3, 2]); const dir = [s.q[0] - s.p[0], s.q[1] - s.p[1]]; const L = Math.hypot(dir[0], dir[1]) || 1; const cx = s.f.pts.reduce((t, v) => t + v[0] / s.f.pts.length, 0), cy = s.f.pts.reduce((t, v) => t + v[1] / s.f.pts.length, 0); let nn = [dir[1] / L, -dir[0] / L]; if ((cx - s.p[0]) * nn[0] + (cy - s.p[1]) * nn[1] < 0) nn = [-nn[0], -nn[1]];
      const w = 2; const quad = [s.p, s.q, [s.q[0] + nn[0] * w, s.q[1] + nn[1] * w, s.q[2]], [s.p[0] + nn[0] * w, s.p[1] + nn[1] * w, s.p[2]]]; rpHatch(doc, quad.map(pr), 3, 0.34, 0.37); }
    else rpLn(doc, pr(s.p), pr(s.q), lw, 0.18); }
  // facet IDs: only where the label sits inside its plane and clear of the labels already placed (dense roofs keep the sketch clean)
  const boxes = []; const clash = (b) => boxes.some((q) => !(b.x1 + 1 < q.x0 || b.x0 - 1 > q.x1 || b.y1 + 1 < q.y0 || b.y0 - 1 > q.y1));
  for (const f of AX.faces) if (f.label) { const poly = f.pts.map(pr); const lp = rpLabelPoint(poly); const q = lp.p; const ext = Math.max(...poly.map((v) => Math.hypot(v[0] - q[0], v[1] - q[1])));
    const bw = rpWidth(doc, f.label, 7.6, true) + 4; const b = { x0: q[0] - bw / 2, y0: q[1] - 4, x1: q[0] + bw / 2, y1: q[1] + 4 };
    if (ext > 14 && lp.room * 0.9 > bw && rpInside(q, poly) && !clash(b)) { rpText(doc, f.label, q[0], q[1] + 2.5, { size: 7.6, bold: true, color: GR(0.32), align: 'center' }); boxes.push(b); } }
  return pr;
}
// a silhouette edge of the sketch that borders a facet left out of it (unresolved) or an obstruction boundary
function rpIsCutEdge(M, F, p, q) {
  const a = [p[0], p[1]], b = [q[0], q[1]]; const m = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  const near = (ring) => ring.some((v, i) => RM.pointSeg(m, v, ring[(i + 1) % ring.length]) < 0.5);
  return M.facets.some((G) => G !== F && !G.f.excluded && G.status === 'unresolved' && near(G.xy)) || M.obLines.some((L) => { for (let i = 1; i < L.xy.length; i++) if (RM.pointSeg(m, L.xy[i - 1], L.xy[i]) < 0.9) return true; return false; });
}
// a small plan key (outlines only) for the hero panel when there is no aerial
function rpPlanKey(doc, M, box) {
  const V = rpView(M, box, { padFt: 2 }); for (const F of M.facets) if (!F.f.excluded) rpPolyG(doc, F.xy.map(V.P), F.status === 'unresolved' ? 0.97 : 0.95, 0.22, 0.8);
  for (const L of M.lines) if (['ridge', 'hip', 'valley'].includes(L.type)) { rpLineStyle(doc, L.type, L.status, 0.9); rpPolyline(doc, L.xy.map(V.P)); } doc.setLineDashPattern([], 0);
}

// ------------------------------------------------------------------ sheet frame
function rpHeader(doc, M, sheet, title, eyebrow, n, total) {
  rpLogo(doc, RP.L, 21, 92, 45); rpLn(doc, [137, 24], [137, 64], 0.65, 0.65);
  rpCap(doc, 'Roof Measure', 149, 31, 7.8); rpText(doc, M.line1, 149, 48, { size: 14, bold: true }); rpText(doc, M.line2, 149, 62, { size: 9, color: RP.MUTE });
  const dark = M.statusLabel === 'REVIEW REQUIRED'; const sw = rpWidth(doc, M.statusLabel, 8.2, true) + 16;
  rpRect(doc, RP.R - sw, 25, sw, 18, dark ? 0.13 : 0.93, dark ? 0.13 : 0.43, 0.6); rpText(doc, M.statusLabel, RP.R - sw / 2, 37.4, { size: 8.2, bold: true, color: dark ? GR(1) : GR(0.13), align: 'center' });
  rpText(doc, 'Imagery  /  ' + M.imagery.label, RP.R, 59, { size: 8.4, color: GR(0.3), align: 'right' });
  rpRule(doc, 77); rpCap(doc, eyebrow, RP.L, 98, 8.4); rpText(doc, title, RP.L, 129, { size: 26, bold: true });
  rpLn(doc, [RP.L, RP.FOOT], [RP.R, RP.FOOT], 0.65, 0.29); rpCap(doc, 'Diversity Contracting  /  Roof Measure', RP.L, 766, 7.6);
  rpText(doc, `${sheet}     /     ${n} of ${total}`, RP.R, 766, { size: 8.2, bold: true, color: GR(0.24), align: 'right' });
}
const rpBand = (doc, y, items) => { rpRect(doc, RP.L, y, 548, 60, 0.943); let x = RP.L; items.forEach(([w, title, val, note], i) => { if (i) rpLn(doc, [x, y + 10], [x, y + 50], 0.5, 0.7); rpCap(doc, title, x + 11, y + 15, 7.7); rpText(doc, val, x + 11, y + 36, { size: 17.7, bold: true }); rpText(doc, note, x + 11, y + 51, { size: 8.4, color: GR(0.3) }); x += w; }); return y + 60; };
const rpTitleBar = (doc, y, t, right) => { rpText(doc, t, RP.L, y, { size: 14, bold: true }); if (right) rpText(doc, right, RP.R, y, { size: 8.5, color: GR(0.32), align: 'right' }); };
const rpFootnote = (doc, y, title, body) => { rpCap(doc, title, RP.L, y, 7.7); return rpText(doc, body, RP.L, y + 14, { size: 8.8, color: GR(0.23), maxWidth: 548, lh: 1.36 }); };

// ------------------------------------------------------------------ sheet 1: roof overview & takeoff
function rpSheetOverview(doc, M, hero, n, total) {
  rpHeader(doc, M, 'Overview & takeoff', rpTitle(M), 'Roof overview & takeoff', n, total);
  const t = M.t, R = M.area, src = M.src, est = src && src.estimate;
  // hero: the sketch (left) and the aerial or plan key (right)
  rpRect(doc, RP.L, 145, 548, 225, 0.982, 0.72); rpLn(doc, [410, 158], [410, 357], 0.55, 0.72);
  const AX = rpAxonModel(M);
  if (AX) { rpCap(doc, AX.caption, 44, 162, 7.8); rpDrawAxon(doc, M, AX, { x: 52, y: 178, w: 340, h: 146 });
    // the two note lines flow: a wrapped first line pushes the second down, both stay inside the hero box
    const l0 = doc.splitTextToSize(AX.note[0], 352).length, l1 = doc.splitTextToSize(AX.note[1], 352).length; const ny = Math.min(343, 366 - (l0 - 1) * 11.6 - (l1 - 1) * 11 - 14);
    const ny1 = rpText(doc, AX.note[0], 44, ny, { size: 8.9, bold: true, maxWidth: 352, lh: 1.3 }); rpText(doc, AX.note[1], 44, ny1 + 2.4, { size: 8.5, color: GR(0.32), maxWidth: 352, lh: 1.3 }); }
  else { rpCap(doc, 'Roof plan  /  no elevations', 44, 162, 7.8); rpPlanKey(doc, M, { x: 60, y: 178, w: 320, h: 150 }); rpText(doc, 'No plane heights are available for a sketch.', 44, 343, { size: 8.9, bold: true }); rpText(doc, 'The to-scale plan is on sheet 2.', 44, 357, { size: 8.5, color: GR(0.32) }); }
  if (hero) { rpCap(doc, 'Property aerial', 422, 162); const k = Math.min(149 / hero.w, 136 / hero.h), w = hero.w * k, h = hero.h * k; doc.addImage(hero.src, 'JPEG', 421 + (149 - w) / 2, 176 + (136 - h) / 2, w, h, 'heroAerial', 'FAST');
    rpText(doc, hero.caption, 422, 327, { size: 8, bold: true, maxWidth: 152 }); if (hero.credit) rpText(doc, hero.credit, 422, 340, { size: 7.8, color: GR(0.36), maxWidth: 152, lh: 1.35 }); }
  else { rpCap(doc, 'Roofline key', 422, 162); rpPlanKey(doc, M, { x: 426, y: 182, w: 140, h: 122 }); rpText(doc, M.structs.length > 1 ? M.structs[0].name + ' + ' + M.structs.slice(1).map((q) => q.name.toLowerCase()).join(' + ') : M.structs[0].name, 427, 328, { size: 8.5, bold: true, maxWidth: 150 }); rpText(doc, 'Same model as sheet 2', 427, 343, { size: 8.1, color: GR(0.35) }); }
  // the band: what the area is based on
  const sq = (v) => rpNum(v / 100, 2) + ' SQ'; const net = t.sloped; let y = 381;
  if (est) { const bal = est.netSqft - R.confirmed;
    y = rpBand(doc, y, [[190, 'Sketch-verified subtotal', rpNum(R.confirmed, 2) + ' ft²', (M.facets.filter((F) => F.status === 'measured' && !F.f.excluded).map((F) => F.id).join(', ') || 'none') + ' only · ' + sq(R.confirmed)], [185, est.label || 'Reported net estimate', rpNum(est.netSqft, 2) + ' ft²', (est.scope || 'Whole main roof') + ' · ' + sq(est.netSqft)], [173, 'Balance to review', rpNum(bal, 2) + ' ft²', 'Estimate less verified subtotal']]); }
  else if (M.kind === 'source' && src.totals && src.totals.netSqft != null) { const T0 = src.totals;
    y = rpBand(doc, y, [[196, 'Reported net sloped area', rpNum(T0.netSqft) + ' ft²', T0.areaNote || ('Main roof · ' + (src.document || 'source'))], [148, 'Net squares', sq(T0.netSqft), 'Calculated from ' + rpNum(T0.netSqft) + ' ft²'], [204, 'Predominant pitch', rpPitch(T0.pitch != null ? T0.pitch : t.predominant), `${T0.facets || t.facetCount} reported facets`]]); }
  else if (!R.fullKnown || R.estimate > 0.5) {
    y = rpBand(doc, y, [[196, 'Confirmed area', rpNum(R.confirmed, 2) + ' ft²', 'Seen and measured · ' + sq(R.confirmed)], [176, R.estimate > 0.5 ? 'Confirmed + estimate' : 'Net squares', R.estimate > 0.5 ? rpNum(net, 2) + ' ft²' : sq(net), R.estimate > 0.5 ? `+ ${rpNum(R.estimate)} ft² under canopy` + (R.ranged ? ` (range ${rpNum(R.confirmed + R.estLo)}-${rpNum(R.confirmed + R.estHi)})` : '') : '100 ft² per square'],
      [176, 'Unresolved', R.zoneCount ? (R.zoneUnknown ? `${R.zoneCount} zone${R.zoneCount > 1 ? 's' : ''}` : `0-${rpNum(R.zoneUpper)} ft²`) : (R.unresolvedTraced > 0.5 ? 'traced, unverified' : 'none'), R.zoneCount ? (R.zoneUnknown ? 'extent not measured; in no total' : 'hidden zones, in no total') : (R.unresolvedTraced > 0.5 ? `${rpNum(R.unresolvedTraced)} ft² not supported` : 'every plane was measured')]]); }
  else y = rpBand(doc, y, [[196, 'Net sloped area', rpNum(net, 2) + ' ft²', M.structs.length > 1 ? 'All buildings' : 'Main roof'], [148, 'Net squares', sq(net), '100 ft² per square'], [204, 'Main roof pitch', rpPitch(t.predominant), M.structs.length > 1 && M.structs[1].predominant != null ? `${M.structs[1].name} at ${rpPitch(M.structs[1].predominant)}` : (t.pitches.length > 1 ? `Facets range ${rpPitch(t.pitches[0])} to ${rpPitch(t.pitches[t.pitches.length - 1])}` : 'Predominant · all facets')]]);
  // building takeoff
  y += 25; const notes = [];
  if (est) { rpTitleBar(doc, y, 'Building takeoff', (M.facets.filter((F) => F.status === 'measured' && !F.f.excluded).map((F) => F.id).join(', ') || 'Verified part') + ' is included in the estimate'); y += 10;
    const rows = [[src.mainLabel || (M.structs[0] ? M.structs[0].name : 'Main house'), rpNum(R.confirmed, 2), rpNum(est.netSqft, 2), rpNum(est.netSqft / 100, 2), est.perimeterFt != null ? rpNum(est.perimeterFt, 2) + ' ft' : '', est.ridgeFt != null ? rpNum(est.ridgeFt, 2) + ' ft' : '']];
    for (const S of M.structs.slice(1)) rows.push([S.name, S.confirmed > 0.5 ? rpNum(S.confirmed, 2) : '', '', '', '', '']);
    if (M.structs.length === 1) rows.push([src.detachedLabel || 'Detached structures', '', '', '', '', '']);
    y = rpTableD(doc, RP.L, y, [136, 91, 85, 65, 84, 87], ['Building', 'Checked ft²', 'Est. net ft²', 'Est. SQ', 'Perimeter', 'Ridge'], rows, { rowh: 21, size: 9.35, num: [1, 2, 3, 4, 5] });
    if (src.checkedNote) notes.push([src.checkedNote, 9, 0.25]); notes.push(['Blank cells indicate quantities without a supported takeoff.' + (M.structs.length === 1 ? ' Detached scope is unconfirmed.' : ''), 8.8, 0.31]); }
  else {
    const T0 = M.kind === 'source' && src.totals ? src.totals : null; const li = T0 && T0.lines ? T0.lines : null; const lf = (v) => (v == null ? '' : li ? rpFtIn(v) : rpNum(v, 2));
    rpTitleBar(doc, y, 'Building takeoff', T0 ? (src.document || 'Source report') + (src.pages ? '  /  ' + src.pages : '') : 'Roof-surface quantities  /  before waste'); y += 10;
    const rows = M.structs.map((S) => { const one = M.structs.length === 1 && T0; const netS = one && T0.netSqft != null ? T0.netSqft : (S.unresolvedFacets && !S.confirmed && !S.estimate ? null : S.sloped);
      return [S.name, netS == null ? '' : rpNum(netS, one ? 0 : 2), netS == null ? '' : rpNum(netS / 100, 2), rpPitch(one && T0.pitch != null ? T0.pitch : S.predominant), lf(li ? li.eave : S.eave), lf(li ? li.rake : S.rake), lf(li ? li.hip : S.hip), lf(li ? li.ridge : S.ridge)]; });
    if (M.structs.length > 1) rows.push(['Total', rpNum(net, 2), rpNum(net / 100, 2), '', rpNum(t.byType.eave.true, 2), rpNum(t.byType.rake.true, 2), rpNum(t.byType.hip.true, 2), rpNum(t.byType.ridge.true, 2)]);
    y = rpTableD(doc, RP.L, y, [119, 74, 54, 55, 61, 66, 55, 64], ['Building', 'Net ft²', 'SQ', T0 ? 'Pitch¹' : 'Pitch', li ? 'Eave' : 'Eave ft', li ? 'Rake' : 'Rake ft', li ? 'Hip' : 'Hip ft', li ? 'Ridge' : 'Ridge ft'], rows, { rowh: 22, size: 9.2, num: [1, 2, 3, 4, 5, 6, 7], lastBold: M.structs.length > 1 });
    const other = li ? [['Valleys', li.valley], ['Step flashing', li.step], ['Wall flashing', li.wall], ['Transitions', li.transition]].filter(([, v]) => v != null && v > 0).map(([k, v]) => `${k}  ${rpFtIn(v)}`) : [['Valleys', t.byType.valley.true], ['Step flashing', t.byType.step.true], ['Wall flashing', t.byType.wall.true], ['Transitions', t.byType.transition.true], ['Parapet', t.byType.parapet.true]].filter(([, v]) => v > 0.05).map(([k, v]) => `${k}  ${rpNum(v, 2)} ft`);
    if (other.length) { y += 16; rpText(doc, other.join('      '), RP.L, y, { size: 9.6, bold: true }); y += 2; }
    if (T0) notes.push([`¹ Predominant pitch. Individual facets range from ${rpPitch(t.pitches[0])} to ${rpPitch(t.pitches[t.pitches.length - 1])}.` + (M.structs.length === 1 ? ' No detached roof is scheduled.' : ''), 8.7, 0.3]);
    else { const vt = t.byType.valley.true; notes.push([(vt < 0.05 ? (M.structs.length > 1 ? 'Each building has 0 ft of valley. ' : 'This roof has 0 ft of valley. ') : '') + 'Totals use unrounded geometry.' + (R.estimate > 0.5 ? ` Net ft² includes ${rpNum(R.estimate)} ft² estimated under canopy (dashed on the plan).` : '') + (R.unresolvedTraced > 0.5 ? ` ${M.facets.filter((F) => F.status === 'unresolved').map((F) => F.id).join(', ')}: area not supported, left out.` : ''), 8.8, 0.32]); }
  }
  for (const [txt, size, g] of notes) { y += 12; y = rpText(doc, txt, RP.L, y, { size, color: GR(g), maxWidth: 548 }) - size * 0.3 - 2; }
  // discrepancies the source carries (never silently reconciled)
  for (const dsc of (src && src.discrepancies) || []) { y += 8; rpRect(doc, RP.L, y, 548, 37, 0.94); rpRect(doc, RP.L, y, 2, 37, 0.22); rpText(doc, dsc.title, RP.L + 10, y + 15, { size: 9.3, bold: true }); rpText(doc, dsc.text, RP.L + 10, y + 28, { size: 8.7, maxWidth: 530 }); y += 37; }
  // The rest of the sheet shares one vertical budget: review items, the waste block and the measurement-basis footnote.
  // A crowded sheet compresses in stages (one-line waste block, then the shorter footnote wording) before any review
  // item is held back; a held-back item is counted on the sheet, never dropped silently.
  const basisFull = M.kind === 'illustrative' ? ['Model basis', (src.notes && src.notes[0]) || 'All coordinates, elevation profiles and quantities are illustrative. The order assumes three equal-coverage bundles per square and rounds up once across all buildings.']
    : M.kind === 'source' ? ['Measurement source', (src.notes && src.notes[0]) || `${src.document || 'The source report'} supplies the net area, pitches, line totals and waste scenario.`]
    : ['Measurement basis', `Traced on ${M.imagery.source}${M.imagery.date ? ', flown ' + rpDate(M.imagery.date) : ''}${M.imagery.quality ? ' (' + String(M.imagery.quality).toLowerCase() + ' quality)' : ''}. Facet areas are plan area times the slope factor of the fitted plane; line lengths are true (sloped) lengths. Nothing is rounded before it is summed.` + (M.alt ? ` ${rpNum(M.facets.reduce((a, F) => a + (F.f.altSqft || 0), 0))} ft² under canopy was taken from ${M.alt.label} after the roof configuration check.` : '')];
  const basisShort = M.kind === 'measured' || !M.src ? ['Measurement basis', `Traced on ${M.imagery.source}${M.imagery.date ? ' flown ' + rpDate(M.imagery.date) : ''}${M.imagery.quality ? ' (' + String(M.imagery.quality).toLowerCase() + ' quality)' : ''}. Facet area = plan area × the fitted plane's slope factor; line lengths are true (sloped) lengths; nothing is rounded before it is summed.` + (M.alt ? ` ${rpNum(M.facets.reduce((a, F) => a + (F.f.altSqft || 0), 0))} ft² under canopy came from ${M.alt.label}.` : '')] : basisFull;
  const footHeight = (b) => { doc.setFont('helvetica', 'normal'); doc.setFontSize(8.8); return 14 + doc.splitTextToSize(b[1], 548).length * 8.8 * 1.36; };
  const w = state.waste != null ? +state.waste : 10; const withWaste = net * (1 + w / 100); const bundles = Math.ceil(withWaste / 100 * 3);
  const hold = M.review && !est ? 'On hold until review items are closed' : null; const wastePending = est || (M.review && R.confirmed < 1);
  const fields = wastePending ? null : M.kind === 'source' && src.totals && src.totals.waste != null
    ? [[160, 'Source allowance', `${src.totals.waste}%`], [185, 'With waste · ' + (src.document || 'source'), src.totals.sqftWithWaste != null ? `${rpNum(src.totals.sqftWithWaste)} ft²  /  ${rpNum(src.totals.sqftWithWaste / 100, 1)} SQ` : `${rpNum(src.totals.netSqft * (1 + src.totals.waste / 100))} ft²`], [203, 'Order status', src.orderStatus || 'Ready to order']]
    : [[175, (M.kind === 'illustrative' ? 'Illustrative' : 'Job') + ' allowance', `${w}%  /  ${rpNum(net * w / 100, 2)} ft²`], [188, hold ? 'Provisional area with waste' : 'Area with waste', `${rpNum(withWaste, 2)} ft²  /  ${rpNum(withWaste / 100, 2)} SQ`], [185, hold ? 'Order status' : 'Example purchase', hold ? 'On hold' : `${bundles} bundles  /  ${rpNum(bundles / 3, bundles % 3 ? 2 : 0)} SQ`]];
  const items = rpReviewItems(M);
  // each review row is as tall as its wrapped text (measured in the fonts it is drawn with)
  const rowH = (it) => { doc.setFont('helvetica', 'normal'); doc.setFontSize(9.2); const a = doc.splitTextToSize(it.action, 333).length; doc.setFont('helvetica', 'bold'); doc.setFontSize(9.8); const tl = doc.splitTextToSize(`${it.key}   ${it.title}`, 210).length; return Math.max(a * 9.2 * 1.25, tl * 9.8 * 1.25) + 3; };
  const itemsH = items.length ? 44 + items.reduce((a, it) => a + rowH(it), 0) : 0;
  const wasteFull = wastePending ? 10 : 76 + (hold ? 14 : 0), wasteLine = wastePending ? 10 : 30; const gap = 18;
  let compact = false, basis = basisFull, footH = footHeight(basisFull);
  if (itemsH + wasteFull + gap + footH > RP.FOOT - 8 - y) { compact = !wastePending; if (itemsH + wasteLine + gap + footH > RP.FOOT - 8 - y) { basis = basisShort; footH = footHeight(basis); } }
  const wasteH = compact ? wasteLine : wasteFull; const limitY = RP.FOOT - 8 - footH - gap - wasteH;
  if (items.length) { y += 10; rpRule(doc, y); y += 18; rpTitleBar(doc, y, 'Items for field review'); y += 16;
    let shown = 0; for (const it of items) { const h = rowH(it); const last = shown === items.length - 1; if (y + h - 3 > limitY - (last ? 0 : 12)) break; rpText(doc, `${it.key}   ${it.title}`, RP.L, y, { size: 9.8, bold: true, maxWidth: 210, lh: 1.25 }); rpText(doc, it.action, RP.L + 215, y, { size: 9.2, maxWidth: 333, lh: 1.25 }); y += h; shown++; }
    if (shown < items.length) { rpText(doc, `+ ${items.length - shown} more review item${items.length - shown > 1 ? 's' : ''}: hatched or dashed on the plan and listed in the app's review panel.`, RP.L, y, { size: 8.5, color: GR(0.32), maxWidth: 548 }); y += 12; } }
  // waste & order quantities, separate from the net area
  if (wastePending) { y += 4; rpText(doc, 'Waste allowance   Pending', RP.L, y, { size: 9.4, bold: true }); rpText(doc, 'Order quantity   On hold', RP.L + 225, y, { size: 9.4, bold: true }); y += 6; }
  else if (compact) { y += 12; rpRule(doc, y); y += 18; const short = [['Allowance', fields[0][2]], ['With waste', fields[1][2]], [hold ? 'Order' : fields[2][1], hold ? 'On hold until review items are closed' : fields[2][2]]];
    let x = RP.L; for (const [kk, v] of short) { rpText(doc, kk, x, y, { size: 8.3, color: GR(0.35) }); x += rpWidth(doc, kk, 8.3) + 5; rpText(doc, v, x, y, { size: 9.2, bold: true }); x += rpWidth(doc, v, 9.2, true) + 18; } }
  else { y += 14; rpRule(doc, y); rpTitleBar(doc, y + 20, 'Waste & order quantities');
    let x = RP.L; for (const [fw, kk, v] of fields) { rpCap(doc, kk, x, y + 38, 7.6); rpText(doc, v, x, y + 54, { size: 12, bold: true }); x += fw; } y += 62;
    if (hold) { y += 10; rpText(doc, hold + '.', RP.L, y, { size: 8.5, color: GR(0.32) }); y += 4; } }
  // measurement basis: low on the sheet, below the content and clear of the footer
  y = Math.min(Math.max(y + gap, 684), RP.FOOT - 8 - footH);
  rpFootnote(doc, y, basis[0], basis[1]);
}
// what still needs a field check: review zones, unresolved items, verification marks, and the status reasons
function rpReviewItems(M) {
  const out = []; const seen = new Set();
  for (const Z of M.zones) { out.push({ key: Z.id, title: Z.label || `Hidden section${Z.facetName ? ' beside ' + Z.facetName : ''}`, action: Z.action || (Z.upperSqft != null ? `Up to ${rpNum(Z.upperSqft)} ft² of roof may continue under the canopy. Measure the edge on site or on an image without the canopy.` : 'Locate the edges and confirm the extent on site.') }); seen.add(Z.id); }
  const byNote = new Map(); if (!(M.src && M.src.zones && M.src.zones.length)) for (const F of M.facets) if (F.status === 'unresolved' && !F.f.excluded) { const k = F.f.missing || F.f.note || ''; if (!byNote.has(k)) byNote.set(k, []); byNote.get(k).push(F); }
  for (const [k, Fs] of byNote) out.push({ key: Fs.map((F) => F.id).join(', '), title: Fs[0].f.label || 'Roof plane not supported', action: k || 'Measure the footprint and pitch. Confirm inclusion in scope.' });
  if (M.rv) for (const v of M.rv.verify) out.push({ key: v.label.split(' ')[0], title: 'Marked for verification', action: v.note || `Seen on ${v.source}${v.date ? ' (' + v.date + ')' : ''}; confirm the measurement on site.` });
  for (const r of M.status.reasons) if (!['hidden', 'unresolved', 'verify', 'estimate'].includes(r.code)) out.push({ key: '•', title: r.text, action: r.needs });
  return out;
}

// ------------------------------------------------------------------ sheet 2: scaled measurement plan (+ detail and schedule sheets)
// plan keys: repeated equal edges of a simple roof share one letter key (E1, H1 ...); busy roofs get one two-digit
// number per line; a job imported from a source document keeps that document's references (D1 ...)
function rpKeys(M) {
  // letter keys only when the grouped schedule stays short (12 rows fit beside the facet table on the plan sheet)
  const refMode = M.lines.some((L) => L.ref); let grouped = !refMode && M.lines.length <= 16;
  if (grouped) { const LET = { eave: 'E', rake: 'K', ridge: 'R', hip: 'H', valley: 'V', step: 'S', wall: 'W', transition: 'T', parapet: 'P', unspecified: 'U' }; const counters = {}; const groups = new Map();
    for (const L of M.lines) { const gk = [L.type, L.structure, L.status, L.e.paired || '', Math.round(L.m.trueFt * 100)].join('|'); if (!groups.has(gk)) { const c = (counters[L.type] || 0) + 1; counters[L.type] = c; groups.set(gk, LET[L.type] + c); } L.tag = groups.get(gk); }
    if (groups.size > 12) grouped = false; }
  if (!grouped) for (const L of M.lines) L.tag = L.key;
  return { grouped, refMode };
}
function rpSchedules(M) {
  // edge rows: one per source reference when the job carries them, else one per line key
  const refs = new Map(); for (const L of M.lines) if (L.ref) { if (!refs.has(L.ref)) refs.set(L.ref, []); refs.get(L.ref).push(L); }
  let edgeRows, edgeHead, edgeNum, edgeWidths;
  if (refs.size) { edgeHead = ['Key', 'Reference', 'Source length', 'Current']; edgeWidths = [38, 111, 78, 63]; edgeNum = [2];
    edgeRows = [...refs.entries()].map(([ref, Ls]) => { const st = Ls.every((L) => L.status === 'measured') ? 'Visible' : Ls.every((L) => L.status === 'inferred') ? 'Inferred' : Ls.some((L) => L.status === 'unresolved') ? 'Unresolved' : 'Partial'; const d = Ls.find((L) => L.displayedFt != null);
      return [ref, Ls[0].e.label || EDGE_TYPES[Ls[0].type].label, d ? rpFtIn(d.displayedFt) : '', st]; });
    for (const Z of M.zones) edgeRows.push([Z.id, Z.label || 'Review zone', '', '']); }
  else if (M.keys.grouped) { edgeHead = ['Key', 'Edge', 'Qty', 'Each ft', 'Total ft']; edgeWidths = [40, 78, 35, 59, 64]; edgeNum = [2, 3, 4]; const seen = new Map();
    for (const L of M.lines) { if (!seen.has(L.tag)) seen.set(L.tag, []); seen.get(L.tag).push(L); }
    edgeRows = [...seen.entries()].map(([tag, Ls]) => { const S = M.structs.find((q) => q.index === Ls[0].structure); const name = (M.structs.length > 1 && S ? S.short + ' ' : '') + EDGE_TYPES[Ls[0].type].label.toLowerCase(); const un = Ls[0].status === 'unresolved';
      return [tag, name.charAt(0).toUpperCase() + name.slice(1), String(Ls.length), un ? '' : rpNum(Ls[0].m.trueFt, 2), un ? '' : rpNum(Ls.reduce((a, L) => a + L.m.trueFt, 0), 2) + (Ls[0].status === 'inferred' ? ' est.' : '')]; }); }
  else { const srcFt = M.lines.some((L) => L.displayedFt != null); edgeHead = ['Key', 'Edge', 'ft']; edgeWidths = [30, 102, 44]; edgeNum = [2];
    edgeRows = M.lines.map((L) => [L.key, EDGE_TYPES[L.type].label, L.status === 'unresolved' ? '' : srcFt ? (L.displayedFt == null ? '' : rpNum(L.displayedFt, Number.isInteger(L.displayedFt) ? 0 : 2)) : rpNum(L.m.trueFt, 2) + (L.status === 'inferred' ? ' est.' : '')]); }
  const bySt = (i) => M.structs.find((S) => S.index === i);
  const facetRows = M.facets.filter((F) => !F.f.excluded).map((F) => { const S = bySt(F.structure); const rep = F.f.reportedSqft; const noArea = F.status === 'unresolved' || F.f.areaUnsupported || F.f.pitchUnknown;
    return [F.id, F.f.label || (S ? S.short : ''), F.f.pitchUnknown ? '' : rpPitch(F.f.reportedPitch != null ? F.f.reportedPitch : (F.m.basis === 'fitted' ? Math.round(F.m.slope12 * 10) / 10 : F.f.pitch)), noArea ? '' : rep != null ? rpNum(rep, Number.isInteger(rep) ? 0 : 2) : rpNum(F.m.sloped, 2)]; });
  const est = M.src && M.src.estimate; const facetHead = est ? ['Facet', 'Roof plane', 'Net ft²', 'Pitch¹'] : ['Facet', 'Building', 'Pitch', 'Net ft²']; if (est) for (const r of facetRows) { const p = r[2]; r[2] = r[3]; r[3] = p; }
  if (est) { const merged = []; for (const r of facetRows) { const last = merged[merged.length - 1]; if (last && last[1] === r[1] && !r[2] && !r[3] && !last[2] && !last[3]) { last[0] = last[0].split('–')[0] + '–' + r[0].replace(/^F/, ''); last.n = (last.n || 1) + 1; } else merged.push(r); } facetRows.length = 0; facetRows.push(...merged); }
  const facetNum = est ? [2, 3] : [2, 3];
  return { edgeRows, edgeHead, edgeNum, edgeWidths, facetRows, facetHead, facetNum, refs: refs.size > 0, grouped: M.keys.grouped };
}
function rpLegendKey(doc, M, x, y) {
  const used = ROOF_LINE_TYPES.filter((k) => M.t.byType[k] && M.t.byType[k].count); const merged = []; const seen = new Set();
  for (const k of used) { const tag = k === 'wall' || k === 'step' ? 'flashing' : k; if (seen.has(tag)) continue; seen.add(tag); merged.push([k, tag === 'flashing' ? 'Flashing' : EDGE_TYPES[k].label]); }
  for (const [k, label] of merged) { rpLineStyle(doc, k, 'measured'); doc.line(x, y - 3, x + 23, y - 3); doc.setLineDashPattern([], 0); rpText(doc, label, x + 30, y, { size: 8.5, color: GR(0.22) }); y += 15; }
  if (M.lines.some((L) => L.status === 'inferred')) { rpLineStyle(doc, 'eave', 'inferred'); doc.line(x, y - 3, x + 23, y - 3); doc.setLineDashPattern([], 0); rpText(doc, 'Continuation (dashed)', x + 30, y, { size: 8.5, color: GR(0.22) }); y += 15; }
  if (M.lines.some((L) => L.status === 'unresolved')) { rpLineStyle(doc, 'eave', 'unresolved'); doc.line(x, y - 3, x + 23, y - 3); doc.setLineDashPattern([], 0); rpText(doc, 'Unresolved line', x + 30, y, { size: 8.5, color: GR(0.22) }); y += 15; }
  if (M.zones.length || M.facets.some((F) => F.status === 'unresolved')) { rpHatch(doc, [[x, y - 8], [x + 23, y - 8], [x + 23, y + 1], [x, y + 1]], 3.5, 0.48); rpText(doc, 'Unresolved zone (hatched)', x + 30, y, { size: 8.5, color: GR(0.22) }); y += 15; }
  rpTag(doc, x + 12, y - 3, 'F1', 8, true); rpText(doc, 'Sloped plane', x + 30, y, { size: 8.5 }); y += 15;
  return y;
}
function rpSheetPlan(doc, M, S, n, total, ctx) {
  const eyebrow = `${M.src && M.src.shortName ? M.src.shortName : M.line1}  /  ${M.kind === 'illustrative' ? 'Illustrative geometry' : M.kind === 'source' ? (M.review ? 'Evidence review' : 'Source geometry') : M.review ? 'Evidence review' : 'Measured geometry'}`;
  rpHeader(doc, M, 'Measurement plan', 'Scaled measurement plan', eyebrow, n, total);
  const nF = S.facetRows.length, nE = S.edgeRows.length;
  // three layouts: simple roofs (grouped keys; north, scale and key beside the plan; edge and facet tables side by side),
  // busy roofs (facet schedule and legend beside the plan, north and scale inside it, three schedule columns below),
  // and reference-keyed source sketches (full-width plan, keyed dimensions and facets below). Long schedules continue.
  const mode = S.refs ? 'refs' : S.grouped ? 'simple' : 'busy';
  const rowh = mode === 'refs' ? 21 : mode === 'simple' ? 20 : 13.5, headH = 19, titleH = 33, footH = 56;
  const facetsInPanel = mode === 'busy' && nF <= 12; const edgeCols = mode === 'busy' ? (facetsInPanel ? 3 : 2) : 1;
  const rowsBelow = (H) => Math.max(1, Math.floor((RP.FOOT - footH - (145 + H + titleH) - headH) / rowh));
  const needRows = mode === 'simple' ? Math.max(nE, nF) : mode === 'busy' && !facetsInPanel ? Math.max(Math.ceil(nE / 2), nF) : Math.ceil(nE / edgeCols);
  let H = mode === 'simple' ? 314 : mode === 'refs' ? 327 : 368;
  // a shorter plan only when that lets the whole schedule fit on this sheet; otherwise the plan keeps its size and the schedule continues
  if (needRows > rowsBelow(H)) { const fitH = RP.FOOT - footH - titleH - headH - rowh * needRows - 145; if (fitH >= 260) H = Math.min(H, fitH); }
  const box = { x: RP.L, y: 145, w: 548, h: H }; rpRect(doc, box.x, box.y, box.w, box.h, 0.993, 0.72);
  rpCap(doc, (M.src && M.src.planCaption) || (M.kind === 'source' ? 'Reported roof plan' : 'Roof plan'), 44, 162);
  const inner = mode === 'refs' ? { x: 44, y: 165, w: 524, h: H - 58 } : mode === 'busy' ? { x: 44, y: 160, w: 318, h: H - 28 } : { x: 48, y: 170, w: 318, h: H - 36 };
  const rot = M.src && !M.src.rotateToAxis ? 0 : rpChooseRotation(M, inner); const V = rpView(M, inner, { rotDeg: rot, padFt: mode === 'simple' ? 3 : 2 });
  // a dry run on a throwaway document decides whether the keys fit this plan; when most would collide, the overview plan
  // carries facet IDs and dimensions only and every key goes to the detail sheets (same fonts, so the same placement)
  V.limit = { x0: box.x + 5, y0: box.y + 24, x1: mode === 'refs' ? box.x + box.w - 5 : mode === 'busy' ? 359 : 372, y1: box.y + box.h - (mode === 'refs' ? 30 : 5) };   // dimensions stay inside the drawing area
  const dry = rpDrawPlan(rpDoc(), M, V, { dims: true }); const noKeys = dry.keys > 0 && dry.missed.length > 0.35 * dry.keys;
  const res = rpDrawPlan(doc, M, V, { noKeys, dims: true }); res.noKeys = noKeys;
  const step = V.k >= 4 ? 5 : V.k >= 2 ? 10 : 20; const rotNote = rot ? ` The plan is turned ${Math.round(Math.abs(rot))}° to the roof's long axis; the arrow is true north.` : '';
  const barIn = (2 * step * V.k / 72).toFixed(2).replace(/\.?0+$/, '');
  // layout self-check, reported to the caller: the longest straight measured piece must draw at exactly k points per foot
  let chk = null; for (const L of M.lines) for (let i = 1; i < L.xy.length; i++) { const ft = Math.hypot(L.xy[i][0] - L.xy[i - 1][0], L.xy[i][1] - L.xy[i - 1][1]); if (!chk || ft > chk.segmentFt) { const a = V.P(L.xy[i - 1]), b = V.P(L.xy[i]); chk = { key: L.tag || L.key, segmentFt: ft, segmentPt: Math.hypot(b[0] - a[0], b[1] - a[1]) }; } }
  if (chk) { chk.expectedPt = chk.segmentFt * V.k; chk.ok = Math.abs(chk.segmentPt - chk.expectedPt) < 1e-6 * Math.max(1, chk.expectedPt); }
  ctx.layout = { scale: V.label, perIn: V.perIn, ptPerFt: V.k, rotationDeg: rot, bar: { ft: 2 * step, pt: 2 * step * V.k, inches: +barIn }, dims: res.dims, keysOnOverview: !noKeys, keys: { total: res.keys, placed: res.placedKeys.slice(), missed: res.missed.slice() }, scaleCheck: chk };
  if (mode === 'simple') {
    rpLn(doc, [380, 158], [380, box.y + box.h - 12], 0.5, 0.72); let py = 206; rpNorth(doc, 408, py, rot); rpBar(doc, 444, py - 9, V.k, step); py += 26;
    rpCap(doc, 'Drawing scale', 393, py); py += 16; rpText(doc, V.label, 393, py, { size: 12, bold: true }); py += 17; py = rpText(doc, 'Print at 100% on US Letter; the scale bar measures ' + barIn + ' in.' + rotNote, 393, py, { size: 8.4, color: GR(0.32), maxWidth: 178 }) + 8;
    rpCap(doc, 'Line & facet key', 393, py); py += 20; py = rpLegendKey(doc, M, 393, py);
    if (py + 10 < box.y + box.h) rpText(doc, 'Repeated equal edges share one key. Counts appear below.', 393, py + 4, { size: 8.3, color: GR(0.3), maxWidth: 175 });
  } else if (mode === 'busy') {
    rpLn(doc, [367, 158], [367, box.y + box.h - 12], 0.5, 0.71); let py = 174;
    if (facetsInPanel && nF) { rpCap(doc, 'Facet schedule', 379, py - 12); py = rpTableD(doc, 377, py, [40, 60, 48, 55], S.facetHead, S.facetRows, { rowh: 15, size: 8.4, headsz: 7.8, num: S.facetNum }) + 18; }
    rpCap(doc, 'Plan legend', 379, py); py += 17; py = rpLegendKey(doc, M, 379, py) + 6;
    rpCap(doc, M.src && M.src.scaleNote ? 'Approximate scale' : 'Drawing scale', 379, py); py += 16; rpText(doc, V.label + ' at 100%', 379, py, { size: 10, bold: true }); py += 15;
    py = rpText(doc, (M.src && M.src.scaleNote ? M.src.scaleNote + ' ' : 'Print at 100% on US Letter. ') + 'Scale bar ' + barIn + ' in.' + rotNote, 379, py, { size: 7.9, color: GR(0.3), maxWidth: 190 });
    // north arrow and scale bar in a corner of the drawing the roof leaves free (bottom-left first, as on the reference sheet)
    const pts = [...M.facets, ...M.zones].flatMap((g) => g.xy.map(V.P)); const free = (x0, y0, x1, y1) => !pts.some((q) => q[0] > x0 && q[0] < x1 && q[1] > y0 && q[1] < y1) && !res.placed.some((b) => !(b.x1 < x0 || b.x0 > x1 || b.y1 < y0 || b.y0 > y1));
    const corner = free(44, box.y + box.h - 90, 150, box.y + box.h) ? 'bl' : free(260, box.y + box.h - 90, 366, box.y + box.h) ? 'br' : free(44, box.y + 28, 150, box.y + 112) ? 'tl' : 'tr';
    const nx = corner === 'bl' || corner === 'tl' ? 65 : 290, ny = corner === 'bl' || corner === 'br' ? box.y + box.h - 66 : box.y + 58;   // top corners sit below the caption
    rpNorth(doc, nx, ny, rot); rpBar(doc, nx - 5, ny + 28, V.k, step);
  } else {
    rpNorth(doc, box.x + box.w - 44, box.y + 60, rot); rpBar(doc, box.x + box.w - 150, box.y + box.h - 74, V.k, step); rpText(doc, V.label + ' at 100%', box.x + box.w - 150 + V.k * step, box.y + box.h - 44, { size: 8.5, bold: true, color: GR(0.25), align: 'center' }); rpText(doc, 'scale bar ' + barIn + ' in', box.x + box.w - 150 + V.k * step, box.y + box.h - 32, { size: 7.8, color: GR(0.35), align: 'center' });
    rpText(doc, 'Solid = visible edge     Dashed = documented continuation     Hatched = unresolved review zone', 44, box.y + box.h - 14, { size: 8.7, bold: true });
  }
  // schedules below the plan
  let y = box.y + box.h + 24; let yEnd = y + 9; const rowsAvail = Math.max(3, Math.floor((RP.FOOT - footH - (y + 9) - headH) / rowh));
  if (mode === 'refs') { rpTitleBar(doc, y, 'Keyed dimensions & facets', 'Blank cells await field confirmation'); y += 9;
    yEnd = rpTableD(doc, RP.L, y, S.edgeWidths, S.edgeHead, S.edgeRows.slice(0, rowsAvail), { rowh, size: 8.9, headsz: 8, num: S.edgeNum });
    if (nF) { const fe = rpTableD(doc, 341, y, [39, 86, 59, 55], S.facetHead, S.facetRows.slice(0, rowsAvail), { rowh: 20, size: 8.7, headsz: 8, num: S.facetNum }); yEnd = Math.max(yEnd, fe);
      if (M.src && M.src.pitchNote) { rpCap(doc, '¹ Derived pitch', 341, fe + 14); yEnd = Math.max(yEnd, rpText(doc, M.src.pitchNote, 341, fe + 27, { size: 8.5, color: GR(0.23), maxWidth: 235 }) - 4); } }
    if (nE > rowsAvail) ctx.spill.edges = S.edgeRows.slice(rowsAvail); if (nF > rowsAvail) ctx.spill.facets = S.facetRows.slice(rowsAvail); }
  else if (mode === 'simple') { rpTitleBar(doc, y, 'Edge lengths'); rpText(doc, 'Facet areas & pitches', 337, y, { size: 14, bold: true }); y += 9;
    yEnd = rpTableD(doc, RP.L, y, S.edgeWidths, S.edgeHead, S.edgeRows.slice(0, rowsAvail), { rowh, size: 8.9, headsz: 8, num: S.edgeNum });
    yEnd = Math.max(yEnd, rpTableD(doc, 330, y, [40, 65, 62, 83], S.facetHead, S.facetRows.slice(0, rowsAvail), { rowh, size: 8.9, headsz: 8, num: S.facetNum }));
    if (nE > rowsAvail) ctx.spill.edges = S.edgeRows.slice(rowsAvail); if (nF > rowsAvail) ctx.spill.facets = S.facetRows.slice(rowsAvail); }
  else { const edgeW = facetsInPanel ? 548 : 360; rpTitleBar(doc, y, 'Edge schedule', facetsInPanel ? 'Numbers on plan match keys below  /  ' + (M.lines.some((L) => L.displayedFt != null) ? 'displayed feet' : 'true length, feet') : null); if (!facetsInPanel) rpText(doc, 'Facet areas & pitches', RP.L + edgeW + 14, y, { size: 14, bold: true }); y += 9;
    const cw = 176, stride = (edgeW - cw * edgeCols) / (edgeCols - 1) + cw; const first = S.edgeRows.slice(0, rowsAvail * edgeCols);
    for (let c = 0; c < edgeCols; c++) { const chunk = first.slice(c * rowsAvail, (c + 1) * rowsAvail); if (!chunk.length) break; yEnd = Math.max(yEnd, rpTableD(doc, RP.L + c * stride, y, [30, 102, 44], S.edgeHead, chunk, { rowh, size: 8.4, headsz: 8, num: S.edgeNum })); }
    if (!facetsInPanel) { const frows = S.facetRows.slice(0, rowsAvail); yEnd = Math.max(yEnd, rpTableD(doc, RP.L + edgeW + 14, y, [34, 56, 44, 40], S.facetHead, frows, { rowh, size: 8.4, headsz: 8, num: S.facetNum })); if (nF > frows.length) ctx.spill.facets = S.facetRows.slice(frows.length); }
    if (nE > first.length) ctx.spill.edges = S.edgeRows.slice(first.length); }
  // evidence used (source sketches carry it on this sheet), else the geometry note
  y = yEnd + 20;
  if (M.src && M.src.evidence && M.src.evidence.length && y < RP.FOOT - 72) { rpTitleBar(doc, y, 'Evidence used'); y += 17; for (const ptxt of M.src.evidence) { if (y > RP.FOOT - 40) break; y = rpText(doc, ptxt, RP.L, y, { size: 8.65, color: GR(0.2), maxWidth: 548 }) + 6; } }
  else {
    const note = M.kind === 'source' ? ((M.src.notes && M.src.notes[1]) || `${M.src.document || 'Source report'}. Edge entries reproduce the displayed dimensions.`)
      : M.kind === 'illustrative' ? 'Plan dimensions are horizontal. Rakes and hips use their true sloped lengths. Facet areas include slope. Each schedule rounds for display after the model calculates its totals.'
      : 'Plan dimensions are horizontal. Rakes, hips and valleys use their true sloped lengths from the fitted plane. Facet areas include slope. Each schedule rounds for display after the totals are calculated.'
        + (res.noKeys ? ` Edge keys are placed on the plan detail sheets${ctx.detail ? ` (${ctx.detail})` : ''}.` : res.missed.length > 8 ? ` ${res.missed.length} keys are placed on the detail sheets${ctx.detail ? ` (${ctx.detail})` : ''}.` : res.missed.length ? ` Keys ${res.missed.join(', ')} are placed on the detail sheet${res.missed.length > 1 ? 's' : ''}.` : '')
        + (ctx.spill.edges ? ' The schedule continues on the next sheet.' : '');
    const fy = Math.min(RP.FOOT - 30, Math.max(y + 16, 704));
    if (M.kind === 'source') rpText(doc, note, RP.L, Math.min(fy, RP.FOOT - 30), { size: 8.45, color: GR(0.23), maxWidth: 548 });
    else { rpCap(doc, 'Geometry check', RP.L, fy - 14); rpText(doc, note, RP.L, fy, { size: 8.45, color: GR(0.23), maxWidth: 548 }); }
  }
  return res;
}
// detail sheets: enlarged windows of the plan so every key can be placed without overlap
function rpDetailWindows(M) {
  const [x0, y0, x1, y1] = M.box; const ov = 0.07, mx = x1 - x0, my = y1 - y0;
  if (M.lines.length > 110) return [[x0, y0 + my * (0.5 - ov), x0 + mx * (0.5 + ov), y1, 'north-west'], [x0 + mx * (0.5 - ov), y0 + my * (0.5 - ov), x1, y1, 'north-east'], [x0, y0, x0 + mx * (0.5 + ov), y0 + my * (0.5 + ov), 'south-west'], [x0 + mx * (0.5 - ov), y0, x1, y0 + my * (0.5 + ov), 'south-east']];
  return mx >= my * 0.78 ? [[x0, y0, x0 + mx * (0.5 + ov), y1, 'west half'], [x0 + mx * (0.5 - ov), y0, x1, y1, 'east half']] : [[x0, y0 + my * (0.5 - ov), x1, y1, 'north half'], [x0, y0, x1, y0 + my * (0.5 + ov), 'south half']];
}
function rpSheetDetail(doc, M, win, i, m, n, total, unplaced) {
  rpHeader(doc, M, 'Plan detail', `Plan detail ${i} of ${m}`, `${M.line1}  /  ${win[4]}`, n, total);
  const box = { x: RP.L, y: 145, w: 548, h: 540 }; rpRect(doc, box.x, box.y, box.w, box.h, 0.993, 0.72);
  const inner = { x: 46, y: 160, w: 520, h: 470 }; const V = rpView(M, inner, { ftBox: win.slice(0, 4), padFt: 1 }); V.box = box;
  const res = rpDrawPlan(doc, M, V);
  rpNorth(doc, 60, box.y + box.h - 40); const step = V.k >= 4 ? 5 : V.k >= 2 ? 10 : 20; rpBar(doc, 96, box.y + box.h - 48, V.k, step);
  // keys that fit on no sheet at all are named once (on the last detail sheet), so nothing is silently absent
  const gone = unplaced && unplaced.length && i === m ? ` Not placed on any sheet (no room next to the line): ${unplaced.join(', ')}; their lengths are in the schedule.` : '';
  const barIn = (2 * step * V.k / 72).toFixed(2).replace(/\.?0+$/, '');
  rpText(doc, `${V.label} at 100% on US Letter (scale bar ${barIn} in). Keys match the schedule on the measurement plan sheet.` + gone, RP.L, box.y + box.h + 22, { size: 8.5, color: GR(0.23), maxWidth: 548 });
  return res;
}
// continuation sheets take whatever table shape the plan sheet used (keyed, grouped or per-line), as many columns as fit
function rpSchedCols(S) { const tw = S.edgeWidths.reduce((a, b) => a + b, 0); const cols = Math.max(1, Math.floor((548 + 10) / (tw + 10))); return { tw, cols, stride: cols > 1 ? (548 - tw * cols) / (cols - 1) + tw : 0 }; }
function rpSheetSchedules(doc, M, S, spill, n, total) {
  rpHeader(doc, M, 'Schedules', 'Schedules (continued)', `${M.line1}  /  ${M.kind === 'source' ? 'Source geometry' : 'Measured geometry'}`, n, total);
  let y = 150; const rowh = 13.5; const rowsAvail = Math.floor((RP.FOOT - 40 - y - 19) / rowh);
  const FW = [40, 90, 60, 70];
  if (spill.edges && spill.edges.length) { const { cols, stride } = rpSchedCols(S); const willUse = Math.min(cols, Math.ceil(spill.edges.length / rowsAvail)); const beside = spill.facets && spill.facets.length && willUse < cols && RP.R - (RP.L + willUse * stride) >= 174;
    rpTitleBar(doc, y, S.refs ? 'Keyed dimensions (continued)' : S.grouped ? 'Edge lengths (continued)' : 'Edge schedule (continued)', beside ? null : 'Keys match the plan'); y += 11; let yEnd = y; let used = 0;
    for (let c = 0; c < cols; c++) { const chunk = spill.edges.slice(c * rowsAvail, (c + 1) * rowsAvail); if (!chunk.length) break; yEnd = Math.max(yEnd, rpTableD(doc, RP.L + c * stride, y, S.edgeWidths, S.edgeHead, chunk, { rowh, size: 8.4, headsz: 8, num: S.edgeNum })); used++; }
    spill.edges = spill.edges.slice(cols * rowsAvail);
    // leftover facet rows take the spare column beside the edges when one is free, else a block below
    const fx = RP.L + used * stride; if (spill.facets && spill.facets.length && used < cols && RP.R - fx >= 174) { const fw = RP.R - fx >= 262 ? FW : [34, 56, 44, 40]; rpText(doc, RP.R - fx >= 262 ? 'Facet areas & pitches (continued)' : 'Facets (continued)', fx, y - 11, { size: 11, bold: true }); rpTableD(doc, fx, y, fw, S.facetHead, spill.facets.slice(0, rowsAvail), { rowh, size: 8.4, headsz: 8, num: S.facetNum }); spill.facets = spill.facets.slice(rowsAvail); }
    y = yEnd + 24; }
  if (spill.facets && spill.facets.length && y < RP.FOOT - 120) { rpTitleBar(doc, y, 'Facet areas & pitches (continued)'); y += 11; const avail = Math.floor((RP.FOOT - 40 - y - 19) / rowh); rpTableD(doc, RP.L, y, FW, S.facetHead, spill.facets.slice(0, avail), { rowh, size: 8.4, headsz: 8, num: S.facetNum }); spill.facets = spill.facets.slice(avail); }
}
// evidence used: what was checked, how, and what each view resolved (only when a second view, a source or a review exists)
function rpSheetEvidence(doc, M, n, total) {
  rpHeader(doc, M, 'Evidence', 'Evidence used', `${M.line1}  /  Views and sources checked`, n, total); let y = 150;
  const rows = [[M.imagery.source, M.imagery.label || 'not reported', M.kind === 'source' ? 'Source document' : 'Measurement', M.alt ? 'Canopy over part of the roof; that part taken from the second image' : (M.zones.length ? 'Tree canopy over part of the roof' : 'Roof clear of canopy')]];
  for (const v of M.views) rows.push([v.label, v.dateText || v.date || 'not published', v.measurable ? 'Georeferenced; can place an edge' : v.georef ? 'Georeferenced; comparison only' : 'Viewing aid', v.result || (v.used ? 'used for the hidden part' : 'compared')]);
  y = rpTableD(doc, RP.L, y, [170, 80, 140, 158], ['Source', 'Image date', 'Type', 'Result'], rows.map((r) => r.map((c) => String(c).slice(0, 60))), { rowh: 18, size: 8.4, headsz: 8 }) + 18;
  if (M.alt && M.alt.check) { const c = M.alt.check; rpTitleBar(doc, y, 'Roof configuration check'); y += 11;
    y = rpTableD(doc, RP.L, y, [300, 110, 138], ['Check (where the first image sees the roof clearly)', 'Result', 'Needed'], [['Visible roof compared', rpNum(c.roofSqft) + ' ft²', 'at least 160 ft²'], ['Same height in both datasets', rpNum(c.heightAgreePct, 1) + '%', '80% or more'], ['Visible roof inside the second outline', rpNum(c.outlineAgreePct, 1) + '%', '85% or more'], ['Change in roof height', c.heightChangeM == null ? 'n/a' : rpNum(Math.abs(c.heightChangeM) * RM.FT, 1) + ' ft', '1.6 ft or less'], ['Horizontal offset (corrected)', rpNum(c.shiftM * RM.FT, 1) + ' ft', 'under 2 ft']], { rowh: 18, size: 8.4, headsz: 8, num: [1] }) + 18; }
  const paras = []; if (M.src && M.src.evidence) paras.push(...M.src.evidence);
  if (M.evidence.length) paras.push('Reviewer log: ' + M.evidence.slice(-8).map((e) => `${String(e.at || '').slice(0, 10)} ${e.target || ''}: ${e.action || ''}${e.source ? ' (' + e.source + (e.date ? ', ' + e.date : '') + ')' : ''}`).join('; ') + '.');
  if (paras.length) { rpTitleBar(doc, y, 'Notes'); y += 16; for (const p of paras) { y = rpText(doc, p, RP.L, y, { size: 8.65, color: GR(0.2), maxWidth: 548 }) + 6; if (y > RP.FOOT - 40) break; } }
}
// material order quantities (optional sheet): the catalog of report.js at the job's waste
function rpSheetMaterials(doc, M, n, total) {
  rpHeader(doc, M, 'Materials', 'Material order quantities', `${M.line1}  /  Estimates from the net measurements`, n, total);
  const t = M.t, bt = t.byType; let y = 150; const bases = { pitched: t.pitched, starter: bt.eave.true + bt.rake.true, iw: bt.eave.true + bt.valley.true + bt.wall.true + bt.step.true, cap: bt.hip.true + bt.ridge.true };
  const cols = typeof matColumns === 'function' ? matColumns(t.recWaste) : [0, 10, 12, 15]; const rows = [];
  for (const g of MATERIAL_CATALOG) { const base = bases[g.base]; rows.push([g.group, '', ...cols.map((w) => (g.baseUnit === 'sqft' ? rpNum(Math.ceil(base * (1 + w / 100))) + ' sqft' : Math.ceil(base * (1 + w / 100)) + ' ft'))]); for (const [name, cov] of g.items) rows.push(['   ' + name, g.unit, ...cols.map((w) => String(Math.ceil(base * (1 + w / 100) / cov - 1e-9)))]); }
  y = rpTableD(doc, RP.L, y, [230, 50, ...cols.map(() => (548 - 280) / cols.length)], ['Product', 'Unit', ...cols.map((w) => `Waste ${w}%`)], rows, { rowh: 13.5, size: 8, headsz: 7.8, num: cols.map((_, i) => i + 2) }) + 10;
  rpText(doc, `Order quantities are estimates from the net measurements plus the waste shown; they are not measurements. Based on the pitched area (flat area excluded). Suggested waste for this roof: ${t.recWaste}%.`, RP.L, y, { size: 8.4, color: GR(0.3), maxWidth: 548 });
}

// ------------------------------------------------------------------ build
async function rpBuild(opts = {}) {
  if (!window.jspdf) throw new Error('PDF library did not load; check the internet connection');
  const M = rpModel(); if (!M || !M.facets.length) { if (state.trace && state.trace.failed) return rpBuildNoRoof(); throw new Error('Trace the roof first'); }
  await rpLoadLogo(); const hero = await rpHeroAerial(M); const S = rpSchedules(M);
  const doc = rpDoc(); const ctx = { spill: {} };
  // first pass on sheet 2 decides whether detail sheets are needed; the sheets are then drawn in order with "n of N"
  const probe = rpDoc(); const pctx = { spill: {} }; const probeRes = rpSheetPlan(probe, M, S, 2, 2, pctx); const wins = probeRes.missed.length ? rpDetailWindows(M) : [];
  // detail sheets on the throwaway doc too: a key counts as unplaced only when no window had room for it
  const hadRoom = new Set(); const inSome = new Set(); for (const [i, w] of wins.entries()) { const r = rpSheetDetail(probe, M, w, i + 1, wins.length, 0, 0); for (const k of r.missed) inSome.add(k); for (const b of r.placedKeys || []) hadRoom.add(b); }
  const unplaced = [...inSome].filter((k) => !hadRoom.has(k)).sort();
  // continuation sheets: drawn on the throwaway doc until nothing is left over, so the count is exact
  let extraSched = 0; { const sp = { edges: pctx.spill.edges ? [...pctx.spill.edges] : null, facets: pctx.spill.facets ? [...pctx.spill.facets] : null };
    while (((sp.edges && sp.edges.length) || (sp.facets && sp.facets.length)) && extraSched < 8) { rpSheetSchedules(probe, M, S, sp, 0, 0); extraSched++; } }
  const hasEvidence = M.kind === 'source' ? false : (M.views.length > 0 || M.evidence.length > 0 || !!M.alt);
  const total = 2 + wins.length + extraSched + (hasEvidence ? 1 : 0) + (opts.materials ? 1 : 0);
  ctx.detail = wins.length === 1 ? 'sheet 3' : wins.length > 1 ? `sheets 3-${2 + wins.length}` : '';
  let n = 1; rpSheetOverview(doc, M, hero, n, total); doc.addPage('letter', 'portrait'); n++; rpSheetPlan(doc, M, S, n, total, ctx);
  wins.forEach((w, i) => { doc.addPage('letter', 'portrait'); n++; rpSheetDetail(doc, M, w, i + 1, wins.length, n, total, unplaced); });
  for (let i = 0; i < extraSched; i++) { doc.addPage('letter', 'portrait'); n++; rpSheetSchedules(doc, M, S, ctx.spill, n, total); }
  if (hasEvidence) { doc.addPage('letter', 'portrait'); n++; rpSheetEvidence(doc, M, n, total); }
  if (opts.materials) { doc.addPage('letter', 'portrait'); n++; rpSheetMaterials(doc, M, n, total); }
  doc.setProperties({ title: `${M.line1} - roof measurement`, author: 'Diversity Contracting | Roof Measure', subject: 'US Letter roof overview, takeoff and scaled measurement plan', creator: 'Roof Measure' });
  // layout self-check for the caller: every key is on the plan, on a detail sheet, or named as unplaced; the scale is exact
  const Lk = ctx.layout || null; let layout = null;
  if (Lk) { const accounted = new Set([...Lk.keys.placed, ...hadRoom, ...unplaced]); const unaccounted = [...Lk.keys.placed, ...Lk.keys.missed].filter((k) => !accounted.has(k));
    layout = { ...Lk, keys: { total: Lk.keys.total, overview: Lk.keys.placed.length, detail: hadRoom.size, unplaced, unaccounted }, sheets: { total, detail: wins.length, schedules: extraSched, evidence: hasEvidence, materials: !!opts.materials } }; }
  return { doc, M, pages: doc.getNumberOfPages(), layout };
}
// no roof could be measured from the imagery: a one-sheet REVIEW REQUIRED report with what was found and what is needed
function rpBuildNoRoof() {
  const tr = state.trace || {}; const st = typeof reviewReportStatus === 'function' ? reviewReportStatus() : { status: 'REVIEW REQUIRED', reasons: [{ text: tr.failed, needs: 'Imagery that shows the building.' }] };
  const addr = String(state.address || '').split(','); const d = tr.imageryDate;
  const M = { line1: addr[0] || 'Roof', line2: addr.slice(1).join(',').replace(/,?\s*USA\s*$/, '').trim(), statusLabel: 'REVIEW REQUIRED', imagery: { label: d ? rpDate(d) : 'not reported' } };
  const doc = rpDoc(); rpHeader(doc, M, 'Overview & takeoff', 'No roof measured', 'Roof overview & takeoff', 1, 1); let y = 160;
  rpRect(doc, RP.L, y, 548, 37, 0.94); rpRect(doc, RP.L, y, 2, 37, 0.22); rpText(doc, 'Review required', RP.L + 10, y + 15, { size: 9.3, bold: true }); rpText(doc, 'No roof area or length could be measured from the imagery. Nothing in this report is a measurement.', RP.L + 10, y + 28, { size: 8.7 }); y += 60;
  rpTitleBar(doc, y, 'What was found'); y += 18; for (const q of st.reasons) { y = rpText(doc, q.text, RP.L, y, { size: 9.2, maxWidth: 548 }) + 2; y = rpText(doc, 'Needed: ' + q.needs, RP.L + 10, y, { size: 8.8, color: GR(0.32), maxWidth: 538 }) + 8; }
  y += 10; rpTitleBar(doc, y, 'Property & imagery'); y += 18; const kv = (k, v) => { rpText(doc, k, RP.L, y, { size: 8.8, color: GR(0.32) }); y = rpText(doc, v, RP.L + 110, y, { size: 8.8, maxWidth: 438 }) + 2; };
  kv('Property', state.address || '-'); kv('Image date', d ? rpDate(d) : 'not reported by the source'); kv('Image source', 'Google Solar API (aerial photo, building mask and 10 cm height model)' + (tr.imageryQuality ? ' - ' + String(tr.imageryQuality).toLowerCase() + ' quality' : '')); kv('Building record', tr.buildingName || '-');
  doc.setProperties({ title: `${M.line1} - roof measurement (review required)`, author: 'Diversity Contracting | Roof Measure', creator: 'Roof Measure' });
  return { doc, M, pages: 1 };
}
