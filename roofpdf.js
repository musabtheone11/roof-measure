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
    return { index: g.index, name: names[g.index] || (g.index === 1 ? 'Main house' : t.structures.length > 2 ? `Detached building ${g.index - 1}` : 'Detached building'), short: (() => { const nm = names[g.index] ? names[g.index].replace(/^(Main|Detached)\s+/i, '') : (g.index === 1 ? 'House' : `Bldg ${g.index}`); return nm.charAt(0).toUpperCase() + nm.slice(1); })(), facets: g.facetCount,
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
  // the report consumes the same evidence audit as the export gate: a quantity without provenance (or with stale
  // provenance) is never printed as a measurement; one recorded as inferred prints as an estimate
  if (kind !== 'illustrative' && RM.auditEvidence) {
    const job = typeof serialize === 'function' ? serialize() : state;
    const audit = RM.auditEvidence(job, typeof reviewEvidenceContext === 'function' ? reviewEvidenceContext(job) : { selectionVerified: false, scaleVerified: false });
    // building selection and scale are scope checks for the whole report (status REVIEW REQUIRED, order quantities withheld,
    // listed for review); they do not erase the measured quantities a reviewer needs to check the selection against
    const global = audit.issues.some((q) => q.id === 'roof' && !['selection-evidence', 'scale-evidence'].includes(q.code));
    const bad = (item, fb, qty) => global || audit.issues.some((q) => q.code !== 'inferred-quantity' && q.id === (item.modelId || item.name || fb) && (q.quantity === qty || q.quantity === 'geometry'));
    const inf = (item, fb) => audit.quantities.some((q) => q.id === (item.modelId || fb) && q.status === 'inferred');
    for (const F of facets) { F.pitchUnsupported = bad(F.f, F.id, 'pitch'); F.areaUnsupported = F.pitchUnsupported || bad(F.f, F.id, 'area');
      if (F.areaUnsupported) F.status = 'unresolved'; else if (F.status === 'measured' && inf(F.f, F.id)) F.status = 'inferred'; }
    for (const [i, L] of lines.entries()) { if (bad(L.e, 'L' + (i + 1), 'length') || bad(L.e, 'L' + (i + 1), 'type')) L.status = 'unresolved'; else if (L.status === 'measured' && inf(L.e, 'L' + (i + 1))) L.status = 'inferred'; }
    area.confirmed = 0; area.estimate = 0; area.unresolvedTraced = 0;
    for (const F of facets.filter((q) => !q.f.excluded)) { const pp = rpAreaParts(F); area.confirmed += pp.measured; area.estimate += pp.inferred; area.unresolvedTraced += pp.unresolved; }
    area.fullKnown = !zones.length && area.unresolvedTraced < 0.5;
    for (const B of structs) { const fs = facets.filter((F) => F.structure === B.index && !F.f.excluded); B.confirmed = fs.reduce((a, F) => a + rpAreaParts(F).measured, 0); B.estimate = fs.reduce((a, F) => a + rpAreaParts(F).inferred, 0); B.unresolved = fs.reduce((a, F) => a + rpAreaParts(F).unresolved, 0); if (fs.some((F) => F.pitchUnsupported)) B.predominant = null; }
    M.evidenceAudit = audit;
  }
  M.selectedWaste = +state.waste; M.keys = rpKeys(M); return M;
}
// a descriptive sheet title from the geometry (the handoff examples carry their own)
// ------------------------------------------------------------------ drawing primitives (gray levels 0 = black, 1 = white)
function rpDoc() {
  const doc = new window.jspdf.jsPDF({ unit: 'pt', format: 'letter', orientation: 'portrait', compress: true });
  doc.setFont('helvetica', 'normal'); doc.setLineJoin('round'); doc.setLineCap('butt');
  return doc;
}
const rpColor = (doc, kind, c) => (kind === 'fill' ? doc.setFillColor(c[0], c[1], c[2]) : kind === 'draw' ? doc.setDrawColor(c[0], c[1], c[2]) : doc.setTextColor(c[0], c[1], c[2]));
function rpText(doc, s, x, y, o = {}) {
  doc.setFont(o.font || 'helvetica', o.bold ? 'bold' : o.italic ? 'italic' : 'normal'); doc.setFontSize(o.size || 9); rpColor(doc, 'text', o.color || RP.INK);
  const size = o.size || 9, lh = o.lh || 1.3, align = o.align || 'left'; const ls = o.maxWidth ? doc.splitTextToSize(String(s), o.maxWidth) : [String(s)];
  if (o.maxWidth) doc.text(ls, x, y, { align, lineHeightFactor: lh }); else doc.text(ls[0], x, y, { align });
  rpLogText(doc, ls, x, y, size, lh, align);
  return y + ls.length * size * lh;
}
// the self-check keeps every text box of the real document (page, string, bounds) so overlapping text can be reported
function rpLogText(doc, lines, x, y, size, lh, align) {
  if (!doc.__rpText) return; let pg = 1; try { pg = doc.internal.getCurrentPageInfo().pageNumber; } catch (_) { /* older jsPDF */ }
  lines.forEach((line, i) => { if (!String(line).trim()) return; const w = doc.getTextWidth(String(line)); const yy = y + i * size * lh; const x0 = align === 'right' ? x - w : align === 'center' ? x - w / 2 : x; doc.__rpText.push({ pg, s: String(line), x0, y0: yy - size * 0.72, x1: x0 + w, y1: yy + size * 0.2 }); });
}
const rpLines = (doc, s, w, size, bold) => { doc.setFont('helvetica', bold ? 'bold' : 'normal'); doc.setFontSize(size); return doc.splitTextToSize(String(s), w).length; };
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
  doc.text(s, x - ca * w / 2 + sa * up, y + sa * w / 2 + ca * up, { angle: deg });
  if (doc.__rpText) { let pg = 1; try { pg = doc.internal.getCurrentPageInfo().pageNumber; } catch (_) { /* older jsPDF */ } const q = [[-w / 2, -size * 0.5], [w / 2, -size * 0.5], [w / 2, size * 0.5], [-w / 2, size * 0.5]].map(([u, v]) => [x + u * ca + v * sa, y - u * sa + v * ca]); doc.__rpText.push({ pg, s, q, x0: Math.min(...q.map((p) => p[0])), y0: Math.min(...q.map((p) => p[1])), x1: Math.max(...q.map((p) => p[0])), y1: Math.max(...q.map((p) => p[1])) }); }
  return w;
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
function rpRingGap(doc, ring, obLines, P) {
  const onOb = (p) => obLines.some((L) => { for (let i = 1; i < L.xy.length; i++) if (RM.pointSeg(p, L.xy[i - 1], L.xy[i]) < 0.9) return true; return false; });
  let run = []; const flush = () => { if (run.length > 1) rpPolyline(doc, run.map(P)); run = []; };
  for (let i = 0; i < ring.length; i++) { const a = ring[i], b = ring[(i + 1) % ring.length];
    if (obLines.length && onOb(a) && onOb(b) && onOb([(a[0] + b[0]) / 2, (a[1] + b[1]) / 2])) { flush(); continue; }
    if (!run.length) run.push(a); run.push(b); }
  flush();
}
// overall dimensions for a simple roof: each outline run of 10 ft or more gets a dimension line outside the roof
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
function rpCompactIds(values) {
  const ids = [...new Set(values.map(String))]; const groups = new Map(); const plain = [];
  for (const id of ids) { const m = /^(.*?)(\d+)$/.exec(id); if (!m) { plain.push(id); continue; } const prefix = m[1]; if (!groups.has(prefix)) groups.set(prefix, []); groups.get(prefix).push({ id, n: +m[2] }); }
  const out = [...plain];
  for (const list of groups.values()) { list.sort((a, b) => a.n - b.n); for (let i = 0; i < list.length;) { let j = i; while (j + 1 < list.length && list[j + 1].n === list[j].n + 1) j++; out.push(j - i > 1 ? list[i].id + '-' + list[j].id : list.slice(i, j + 1).map(x => x.id).join(', ')); i = j + 1; } }
  return out.join(', ');
}
function rpReviewItems(M) {
  const out = []; const seen = new Set();
  for (const Z of M.zones) { out.push({ key: Z.id, title: Z.label || `Hidden section${Z.facetName ? ' beside ' + Z.facetName : ''}`, action: Z.action || (Z.upperSqft != null ? `Up to ${rpNum(Z.upperSqft)} ft² of roof may continue under the canopy. Measure the edge on site or on an image without the canopy.` : 'Locate the edges and confirm the extent on site.') }); seen.add(Z.id); }
  const byNote = new Map(); if (!(M.src && M.src.zones && M.src.zones.length)) for (const F of M.facets) if (F.status === 'unresolved' && !F.f.excluded) { const k = F.f.missing || F.f.note || ''; if (!byNote.has(k)) byNote.set(k, []); byNote.get(k).push(F); }
  for (const [k, Fs] of byNote) out.push({ key: Fs.map((F) => F.id).join(', '), title: Fs[0].f.label || 'Roof plane not supported', action: k || 'Measure the footprint and pitch. Confirm inclusion in scope.' });
  if (M.rv) for (const v of M.rv.verify) out.push({ key: v.label.split(' ')[0], title: 'Marked for verification', action: v.note || `Seen on ${v.source}${v.date ? ' (' + v.date + ')' : ''}; confirm the measurement on site.` });
  const groups = new Map();
  for (const r of M.status.reasons) if (!['hidden', 'unresolved', 'verify', 'estimate'].includes(r.code)) {
    if (r.id && r.id !== 'roof' && r.quantity) { const key = r.code + ':' + r.quantity; if (!groups.has(key)) groups.set(key, []); groups.get(key).push(r); continue; }
    const SHORT = { 'imagery-change': 'Newer imagery', 'imagery-quality': 'Image quality', selection: 'Building selection', geometry: 'Geometry check', reconcile: 'Sketch reconciliation', 'no-roof': 'No roof traced' };
    const k = r.code + ':' + (r.text || ''); if (seen.has(k)) continue; seen.add(k);
    out.push({ key: '•', title: SHORT[r.code] || 'Review', action: r.text + (r.needs ? ' Needed: ' + r.needs : '') });
  }
  for (const rows of groups.values()) {
    const first = rows[0]; const ids = rows.map(r => r.id);
    const planKeys = M.lines.filter(L => ids.includes(L.e.modelId)).map(L => L.key);
    const facetKeys = M.facets.filter(F => ids.includes(F.f.modelId)).map(F => F.id);
    const lookup = [planKeys.length ? 'plan keys ' + rpCompactIds(planKeys) : '', facetKeys.length ? 'facets ' + rpCompactIds(facetKeys) : ''].filter(Boolean).join('; ');
    const labels = { 'quantity-evidence': 'Missing or unresolved evidence', 'stale-evidence': 'Evidence needs rechecking after an edit', 'inferred-quantity': 'Evidence-backed estimate', 'unsupported-quantity': 'Unsupported quantity', 'non-roof-boundary': 'Canopy or shadow is not a roof boundary' };
    out.push({ key: first.quantity, title: (labels[first.code] || first.code) + ': ' + rpCompactIds(ids), action: 'Affected ' + (lookup || 'model items') + '. ' + first.needs.replace(/and the affected .* quantity\./, 'and each affected quantity.') });
  }
  return out;
}

function rpDetailWindows(M) {
  const [x0, y0, x1, y1] = M.box; const ov = 0.07, mx = x1 - x0, my = y1 - y0;
  if (M.lines.length > 110) return [[x0, y0 + my * (0.5 - ov), x0 + mx * (0.5 + ov), y1, 'north-west'], [x0 + mx * (0.5 - ov), y0 + my * (0.5 - ov), x1, y1, 'north-east'], [x0, y0, x0 + mx * (0.5 + ov), y0 + my * (0.5 + ov), 'south-west'], [x0 + mx * (0.5 - ov), y0, x1, y0 + my * (0.5 + ov), 'south-east']];
  return mx >= my * 0.78 ? [[x0, y0, x0 + mx * (0.5 + ov), y1, 'west half'], [x0 + mx * (0.5 - ov), y0, x1, y1, 'east half']] : [[x0, y0 + my * (0.5 - ov), x1, y1, 'north half'], [x0, y0, x1, y0 + my * (0.5 + ov), 'south half']];
}
// evidence used: what was checked, how, and what each view resolved (only when a second view, a source or a review exists)
function rpSheetEvidence(doc, M, n, total) {
  rpHeader(doc, M, 'Evidence', n, total); rpTitleBar(doc, 82, 'Evidence used', 'Views and sources checked'); let y = 92;
  const rows = [[M.imagery.source, M.imagery.label || 'not reported', M.kind === 'source' ? 'Source document' : 'Measurement', M.alt ? 'Canopy over part of the roof; that part taken from the second image' : (M.zones.length ? 'Tree canopy over part of the roof' : 'Roof clear of canopy')]];
  for (const v of M.views) rows.push([v.label, v.dateText || v.date || 'not published', v.measurable ? 'Georeferenced; can place an edge' : v.georef ? 'Georeferenced; comparison only' : 'Viewing aid', v.result || (v.used ? 'used for the hidden part' : 'compared')]);
  y = rpTableD(doc, RP.L, y, [170, 80, 140, 158], ['Source', 'Image date', 'Type', 'Result'], rows.map((r) => r.map((c) => String(c).slice(0, 60))), { rowh: 18, size: 8.4, headsz: 8 }) + 18;
  if (M.alt && M.alt.check) { const c = M.alt.check; rpTitleBar(doc, y, 'Roof configuration check'); y += 11;
    y = rpTableD(doc, RP.L, y, [300, 110, 138], ['Check (where the first image sees the roof clearly)', 'Result', 'Needed'], [['Visible roof compared', rpNum(c.roofSqft) + ' ft²', 'at least 160 ft²'], ['Same height in both datasets', rpNum(c.heightAgreePct, 1) + '%', '80% or more'], ['Visible roof inside the second outline', rpNum(c.outlineAgreePct, 1) + '%', '85% or more'], ['Change in roof height', c.heightChangeM == null ? 'n/a' : rpNum(Math.abs(c.heightChangeM) * RM.FT, 1) + ' ft', '1.6 ft or less'], ['Horizontal offset (corrected)', rpNum(c.shiftM * RM.FT, 1) + ' ft', 'under 2 ft']], { rowh: 18, size: 8.4, headsz: 8, num: [1] }) + 18; }
  const paras = []; if (M.src && M.src.evidence) paras.push(...M.src.evidence);
  if (M.evidence.length) paras.push('Reviewer log: ' + M.evidence.slice(-8).map((e) => `${String(e.at || '').slice(0, 10)} ${e.target || ''}: ${e.action || ''}${e.source ? ' (' + e.source + (e.date ? ', ' + e.date : '') + ')' : ''}`).join('; ') + '.');
  if (paras.length) { rpTitleBar(doc, y, 'Notes'); y += 16; for (const p of paras) { y = rpText(doc, p, RP.L, y, { size: 8.65, color: GR(0.2), maxWidth: 548 }) + 6; if (y > RP.FOOT - 40) break; } }
}
// material order quantities (optional sheet) at purchase rounding: net measurements stay unrounded
function rpPurchaseUnits(base, coverage = 1, waste = 0) {
  return Math.max(0, Math.ceil((base * (1 + waste / 100) - 0.0001) / coverage));
}
function rpSheetMaterials(doc, M, n, total) {
  rpHeader(doc, M, 'Materials', n, total); rpTitleBar(doc, 82, 'Material order quantities', 'Estimates from the net measurements');
  const t = M.t, bt = t.byType; let y = 92; const bases = { pitched: t.pitched, starter: bt.eave.true + bt.rake.true, otherDrip: bt.eave.true + bt.rake.true, otherValley: bt.valley.true, iw: bt.eave.true + bt.valley.true + bt.wall.true + bt.step.true, cap: bt.hip.true + bt.ridge.true };
  const cols = typeof matColumns === 'function' ? matColumns(t.recWaste) : [0, 10, 12, 15]; const rows = [];
  for (const g of MATERIAL_CATALOG) { const base = bases[g.base]; rows.push([g.group, '', ...cols.map((w) => (g.baseUnit === 'sqft' ? rpNum(rpPurchaseUnits(base, 1, w)) + ' sqft' : rpPurchaseUnits(base, 1, w) + ' ft'))]); for (const [name, cov] of g.items) rows.push(['   ' + name, g.unit, ...cols.map((w) => String(rpPurchaseUnits(base, cov, w)))]); }
  rows.push(['Other materials', '', ...cols.map(() => '')]);
  rows.push(['   Drip edge / nominal 10 ft stick', 'sticks', ...cols.map((w) => String(rpPurchaseUnits(bases.otherDrip, 10, w)))]);
  rows.push(['   Valley metal / nominal 8 ft piece', 'pieces', ...cols.map((w) => String(rpPurchaseUnits(bases.otherValley, 8, w)))]);
  y = rpTableD(doc, RP.L, y, [230, 50, ...cols.map(() => (548 - 280) / cols.length)], ['Product', 'Unit', ...cols.map((w) => `Waste ${w}%`)], rows, { rowh: 13.5, size: 8, headsz: 7.8, num: cols.map((_, i) => i + 2) }) + 10;
  rpText(doc, `Nominal coverage; confirm manufacturer coverage, laps and installation requirements before ordering. Order quantities are estimates from the net measurements plus the waste shown; they are not measurements. Based on the pitched area (flat area excluded). Suggested waste for this roof: ${t.recWaste}%.`, RP.L, y, { size: 8.4, color: GR(0.3), maxWidth: 548 });
}

// measurement summary (Roofr-equivalent coverage): area classes, linear totals, pitch distribution, facet
// orientation and waste scenarios. Unknown values stay blank; waste is an allowance, never a measurement.
function rpAreaParts(F) {
  const amount = F.m.sloped;
  if (F.status === 'measured') return { measured: amount, inferred: 0, unresolved: 0 };
  if (F.status === 'inferred') {
    const part = F.f.inferredSqft > 0 && !F.f.edited ? Math.min(amount, F.f.inferredSqft) : amount;
    return { measured: amount - part, inferred: part, unresolved: 0 };
  }
  return { measured: 0, inferred: 0, unresolved: amount };
}
function rpInformation(M) {
  const facets = M.facets.filter((F) => !F.f.excluded);
  const usable = facets.filter((F) => F.status !== 'unresolved' && !F.areaUnsupported && !F.f.areaUnsupported && !F.f.pitchUnknown);
  const complete = usable.length === facets.length && !M.zones.length;
  const groups = new Map();
  let measured = 0, inferred = 0, net = 0, projected = 0, twoStory = 0, twoLayer = 0, unspecifiedProjected = 0;
  for (const F of facets) {
    if (F.f.pitchUnknown || F.pitchUnsupported) unspecifiedProjected += F.m.plan;
    if (!usable.includes(F)) continue;
    // distribution by the nominal x/12 pitch (the takeoff's pitch groups); the fitted slope is in the orientation table
    const pitch = Number.isFinite(F.f.pitch) ? F.f.pitch : F.m.basis === 'fitted' ? Math.round(F.m.slope12) : null;
    const parts = rpAreaParts(F); measured += parts.measured; inferred += parts.inferred;
    net += F.m.sloped; projected += F.m.plan;
    if (F.f.twoStory) twoStory += F.m.sloped;
    if (F.f.twoLayer) twoLayer += F.m.sloped;
    if (Number.isFinite(pitch)) groups.set(pitch, (groups.get(pitch) || 0) + F.m.sloped);
  }
  const pitches = [...groups].sort((a, b) => a[0] - b[0]);
  const dominant = pitches.slice().sort((a, b) => b[1] - a[1])[0] || [null, null];
  const types = ['eave', 'valley', 'hip', 'ridge', 'rake', 'wall', 'step', 'transition', 'parapet', 'unspecified'];
  const lines = Object.fromEntries(types.map((type) => { const ls = M.lines.filter((L) => L.type === type); return [type, { value: ls.some((L) => L.status === 'unresolved') || (!ls.length && (M.review || !complete)) ? null : ls.reduce((a, L) => a + L.m.trueFt, 0), inferred: ls.some((L) => L.status === 'inferred') }]; }));
  const combine = (a, b) => ({ value: lines[a].value == null || lines[b].value == null ? null : lines[a].value + lines[b].value, inferred: lines[a].inferred || lines[b].inferred });
  const directions = facets.map((F) => {
    const supported = F.status !== 'unresolved' && !F.f.pitchUnknown && !F.pitchUnsupported && !F.areaUnsupported;
    const p = F.f.plane; const a = Number.isFinite(F.f.azimuth) ? F.f.azimuth : p && Math.hypot(p[0], p[1]) >= 0.03 ? Math.atan2(-p[0], -p[1]) * 180 / Math.PI : null;
    const flat = F.f.pitch === 0 || p && Math.hypot(p[0], p[1]) < 0.03;
    const azimuth = supported && !flat && a != null ? (a % 360 + 360) % 360 : null;
    return { id: F.id, pitch: F.pitchUnsupported || F.f.pitchUnknown ? null : F.m.basis === 'fitted' ? F.m.slope12 : F.f.pitch, azimuth, facing: azimuth == null ? (supported && flat ? 'Flat / no direction' : '') : ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'][Math.round(azimuth / 45) % 8] };
  });
  const chosen = Number.isFinite(M.selectedWaste) ? M.selectedWaste : 10;
  const recommended = Number.isFinite(M.t.recWaste) ? M.t.recWaste : null;
  const waste = [...new Set([0, 10, 12, 15, 17, 20, chosen, recommended].filter((x) => x != null))].sort((a, b) => a - b).map((percent) => ({ percent, selected: percent === chosen, recommended: percent === recommended, area: M.review || !complete ? null : net * (1 + percent / 100), squares: M.review || !complete ? null : net * (1 + percent / 100) / 100 }));
  return { complete, measured: usable.length ? measured : null, inferred: usable.length ? inferred : null, estimated: usable.some((F) => F.status === 'inferred'), directions, net: usable.length ? net : null, projected: usable.length ? projected : null, flat: usable.length && complete ? groups.get(0) || 0 : usable.length && groups.get(0) ? groups.get(0) : null, pitched: usable.length ? net - (groups.get(0) || 0) : null, facetCount: facets.length, supportedFacetCount: usable.length, predominant: dominant[0], predominantArea: dominant[1], unspecifiedProjected: M.kind !== 'illustrative' && facets.some((F) => F.areaUnsupported) ? null : unspecifiedProjected, twoStory: complete ? twoStory : null, twoLayer: complete ? twoLayer : null, pitches, lines, combined: { hipRidge: combine('hip', 'ridge'), eaveRake: combine('eave', 'rake') }, waste };
}
function rpSheetInformation(doc, M, n, total) {
  const I = rpInformation(M); let added = 0, y = 104;
  const header = () => { rpHeader(doc, M, 'Measurement summary', n + added, total); rpTitleBar(doc, 82, 'Measurement summary' + (added ? ' (continued)' : ''), M.kind === 'illustrative' ? 'Illustrative quantities  ·  no property measurement' : I.complete ? 'Net measurements  ·  allowances separate' : 'Supported subtotals  ·  incomplete scope'); };
  const room = (height) => { if (y + height > RP.FOOT - 24) { doc.addPage('letter', 'portrait'); added++; header(); y = 104; } };
  const table = (title, widths, head, rows, num) => { room(rows.length <= 10 ? 44 + rows.length * 13 : 44); rpTitleBar(doc, y, title); y += 11;
    let rest = rows.slice(); do { const cap = Math.max(1, Math.floor((RP.FOOT - 30 - y - 19) / 13)); const chunk = rest.slice(0, cap); y = rpTableD(doc, RP.L, y, widths, head, chunk, { rowh: 13, size: 8.1, headsz: 7.6, num }); rest = rest.slice(cap); if (rest.length) { y = RP.FOOT; room(52); rpTitleBar(doc, y, title + ' (continued)'); y += 11; } } while (rest.length); y += 18; };
  const val = (x) => x == null ? '' : rpNum(x, 2);
  header();
  table('Area summary' + (I.complete ? '' : ' / supported subtotal'), [157, 104, 183, 104], ['Quantity', 'ft²', 'Quantity', 'Value'], [
    [I.estimated ? 'Subtotal incl. estimates' : I.complete ? 'Net sloped area' : 'Supported sloped subtotal', val(I.net), 'Projected horizontal area', val(I.projected)],
    ['Measured/modelled subtotal', val(I.measured), 'Inferred estimate area', val(I.inferred)],
    ['Pitched roof area', val(I.pitched), 'Flat roof area', val(I.flat)],
    ['Predominant pitch area', val(I.predominantArea), 'Predominant pitch', rpPitch(I.predominant)],
    ['Two-story net area', val(I.twoStory), 'Two-layer net area', val(I.twoLayer)],
    ['Unspecified pitch (projected)', val(I.unspecifiedProjected), 'Facets / supported', I.facetCount + ' / ' + I.supportedFacetCount],
  ], [1, 3]);
  const edge = (x) => x.value == null ? '' : rpFtIn(x.value) + (x.inferred ? ' est.' : '');
  const ls = Object.entries(I.lines); const rows = [];
  for (let k = 0; k < ls.length; k += 2) rows.push([EDGE_TYPES[ls[k][0]].label, edge(ls[k][1]), EDGE_TYPES[ls[k + 1][0]].label, edge(ls[k + 1][1])]);
  rows.push(['Hips + ridges', edge(I.combined.hipRidge), 'Eaves + rakes', edge(I.combined.eaveRake)]);
  table('Linear measurement totals', [157, 104, 183, 104], ['Edge category', 'True length', 'Edge category', 'True length'], rows, [1, 3]);
  table('Pitch distribution / net area', [124, 142, 142, 140], ['Pitch', 'Area ft²', 'Squares', 'Scope'], I.pitches.map(([pitch, area]) => [rpPitch(pitch), val(area), rpNum(area / 100, 2), I.estimated ? 'Includes estimates' : I.complete ? 'Net scope' : 'Supported subtotal']), [1, 2]);
  table('Facet orientation / downhill bearing from true north (fitted or modelled plane, not a field compass reading)', [78, 126, 172, 172], ['Facet', 'Pitch', 'Azimuth', 'Facing'], I.directions.map((D) => [D.id, rpPitch(D.pitch), D.azimuth == null ? '' : rpNum(D.azimuth, 1) + '°', D.facing]), [1, 2]);
  table('Waste scenarios / separate from net measurements', [78, 160, 155, 155], ['Waste', 'Scenario', 'Area with waste ft²', 'Squares with waste'], I.waste.map((W) => [W.percent + '%', [W.selected ? 'Selected' : '', W.recommended ? 'Recommended' : '', M.review ? 'On hold' : M.kind === 'illustrative' ? 'Illustrative' : 'Allowance'].filter(Boolean).join(' / '), val(W.area), val(W.squares)]), [0, 2, 3]);
  y -= 6; room(26); rpText(doc, (I.estimated ? 'Area subtotals include inferred estimates; see keyed facet schedule. ' : '') + 'Unknown values stay blank. Unspecified-pitch area is projected, not a supported sloped area. Two-story and two-layer values follow recorded facet flags. Waste scenarios are allowances, never net measurements.' + (M.review ? ' Order-ready quantities withheld until evidence review closes.' : ''), RP.L, y, { size: 8, maxWidth: 548 });
  return 1 + added;
}

// ------------------------------------------------------------------ sheet frame: slim header and footer
// Logo, document title, address and status on one band; imagery and report dates under the address. No sheet titles.
function rpHeader(doc, M, sheet, n, total) {
  rpLogo(doc, RP.L, 16, 70, 34); rpLn(doc, [111, 19], [111, 50], 0.6, 0.7);
  const dark = M.statusLabel === 'REVIEW REQUIRED'; const sw = rpWidth(doc, M.statusLabel, 7.8, true) + 14;
  rpRect(doc, RP.R - sw, 18, sw, 16, dark ? 0.13 : 0.94, dark ? 0.13 : 0.43, 0.6); rpText(doc, M.statusLabel, RP.R - sw / 2, 29, { size: 7.8, bold: true, color: dark ? GR(1) : GR(0.13), align: 'center' });
  rpText(doc, 'Roof Measurement Report', 121, 29, { size: 12.5, bold: true });
  const room = RP.R - sw - 14 - 121; let addr = [M.line1, M.line2].filter(Boolean).join(', '); while (addr.length > 8 && rpWidth(doc, addr, 9.2) > room) addr = addr.slice(0, -2).trim() + '…';
  rpText(doc, addr, 121, 42, { size: 9.2, color: GR(0.18) });
  const meta = [M.imagery.label ? 'Imagery ' + M.imagery.label : null, M.job ? M.job : null, 'Report ' + M.date].filter(Boolean).join('   ·   ');
  rpText(doc, meta, 121, 53, { size: 7.3, color: GR(0.36) });
  rpLn(doc, [RP.L, 62], [RP.R, 62], 0.75, 0.2);
  rpLn(doc, [RP.L, 756], [RP.R, 756], 0.5, 0.45); rpCap(doc, 'Diversity Contracting  /  Roof Measure', RP.L, 768, 6.6);
  rpText(doc, `${sheet}   ·   ${n} of ${total}`, RP.R, 768, { size: 7.3, bold: true, color: GR(0.28), align: 'right' });
}
const rpTitleBar = (doc, y, t, right) => { rpText(doc, t, RP.L, y, { size: 10.5, bold: true }); if (right) rpText(doc, right, RP.R, y, { size: 7.6, color: GR(0.36), align: 'right' }); };

// ------------------------------------------------------------------ keys: one ID per line, by type (E1 eave, K1 rake ...)
// A job imported from a source document keeps that document's references (D1 ...). Facets keep their names (F1 ...).
const RP_LET = { eave: 'E', rake: 'K', ridge: 'R', hip: 'H', valley: 'V', step: 'S', wall: 'W', transition: 'T', parapet: 'P', unspecified: 'X' };
const RP_ORDER = ['eave', 'rake', 'ridge', 'hip', 'valley', 'step', 'wall', 'transition', 'parapet', 'unspecified'];
function rpKeys(M) {
  const refMode = M.lines.some((L) => L.ref); const cnt = {};
  // reading order within a type: building, then north to south, west to east (so E1 is the north-west eave)
  const mid = (L) => { const a = L.xy[0], b = L.xy[L.xy.length - 1]; return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]; };
  const order = M.lines.slice().sort((p, q) => RP_ORDER.indexOf(p.type) - RP_ORDER.indexOf(q.type) || p.structure - q.structure || Math.round(mid(q)[1] / 3) - Math.round(mid(p)[1] / 3) || mid(p)[0] - mid(q)[0]);
  // a source sketch keeps its own references: those lines carry the reference, the rest of the drawing carries no key
  for (const L of order) { if (refMode) { L.tag = L.ref || null; continue; } const c = (cnt[L.type] = (cnt[L.type] || 0) + 1); L.tag = (RP_LET[L.type] || 'X') + c; }
  M.lines.sort((p, q) => order.indexOf(p) - order.indexOf(q));
  return { grouped: false, refMode };
}
// table rows for both schedules: every row ID appears on the plan (label, callout, or the detail sheet)
function rpSchedules(M) {
  const multi = M.structs.length > 1; const bName = (i) => String(i);   // the building's number in the Buildings table
  const refs = new Map(); for (const L of M.lines) if (L.ref) { if (!refs.has(L.ref)) refs.set(L.ref, []); refs.get(L.ref).push(L); }
  let edgeRows, edgeHead, edgeNum, edgeWidths;
  if (refs.size) { edgeHead = ['Key', 'Reference', 'Source length', 'Current']; edgeWidths = [34, 104, 70, 58]; edgeNum = [2];
    edgeRows = [...refs.entries()].map(([ref, Ls]) => { const st = Ls.every((L) => L.status === 'measured') ? 'Visible' : Ls.every((L) => L.status === 'inferred') ? 'Inferred' : Ls.some((L) => L.status === 'unresolved') ? 'Unresolved' : 'Partial'; const d = Ls.find((L) => L.displayedFt != null);
      return [ref, Ls[0].e.label || EDGE_TYPES[Ls[0].type].label, d ? rpFtIn(d.displayedFt) : '', st]; });
    for (const Z of M.zones) edgeRows.push([Z.id, Z.label || 'Review zone', '', '']); }
  else { const srcFt = M.lines.some((L) => L.displayedFt != null); edgeHead = multi ? ['Key', 'Type', 'Length', 'ft', 'Bldg'] : ['Key', 'Type', 'Length', 'ft']; edgeWidths = multi ? [22, 54, 50, 28, 22] : [26, 58, 46, 38]; edgeNum = [2, 3];
    edgeRows = M.lines.map((L) => { const un = L.status === 'unresolved'; const ft = srcFt ? L.displayedFt : L.m.trueFt;
      const row = [L.tag, EDGE_TYPES[L.type].label, un || ft == null ? '' : rpFtIn(ft) + (L.status === 'inferred' ? ' est.' : ''), un ? 'not measured' : ft == null ? '' : rpNum(ft, 2)];
      if (multi) row.push(bName(L.structure)); return row; }); }
  const facetRows = M.facets.filter((F) => !F.f.excluded).map((F) => { const rep = F.f.reportedSqft; const noArea = F.status === 'unresolved' || F.f.areaUnsupported || F.f.pitchUnknown;
    const assigned = M.kind === 'measured' && F.m.basis !== 'fitted' && F.f.reportedPitch == null && !F.f.pitchUnknown;   // a pitch set by hand or by default, not fitted from the height model
    const st = F.status === 'unresolved' ? 'not supported' : F.status === 'inferred' ? (F.f.inferredSqft > 0 && F.f.inferredSqft < F.m.sloped ? 'part est.' : 'estimate') : (M.kind === 'source' ? 'source' : 'measured');
    return [F.id, F.f.label || (multi ? bName(F.structure) : 'Main'), F.f.pitchUnknown ? '' : rpPitch(F.f.reportedPitch != null ? F.f.reportedPitch : (F.m.basis === 'fitted' ? Math.round(F.m.slope12 * 10) / 10 : F.f.pitch)) + (assigned ? '*' : ''), noArea ? '' : rep != null ? rpNum(rep, Number.isInteger(rep) ? 0 : 2) : rpNum(F.m.sloped, 2), noArea ? '' : rpNum(F.m.plan, 1), st]; });
  return { edgeRows, edgeHead, edgeNum, edgeWidths, facetRows, facetHead: ['Facet', multi ? 'Bldg' : 'Building', 'Pitch', 'Area ft²', 'Plan ft²', 'Basis'], facetNum: [2, 3, 4], facetWidths: [34, 62, 46, 58, 50, 58], refs: refs.size > 0 };
}

// ------------------------------------------------------------------ plan drawing (page 1 and detail sheets)
// Exterior edges (eaves, rakes) heavy, interior lines lighter; one grayscale style per type. Estimated continuations are
// dashed and lighter; an unsupported line is stippled. No facet shading: unresolved planes and hidden zones are hatched.
const RP_PLAN = {
  eave: { w: 1.7, g: 0.04 }, rake: { w: 1.7, g: 0.04, dash: [7, 1.7] }, ridge: { w: 1.05, g: 0.12 }, hip: { w: 0.8, g: 0.2, dash: [3.4, 1.7] },
  valley: { w: 0.95, g: 0.16, dash: [0.9, 1.6] }, step: { w: 0.75, g: 0.28, dash: [4, 1.4, 0.9, 1.4] }, wall: { w: 0.75, g: 0.28, dash: [1.8, 1.5] },
  transition: { w: 0.8, g: 0.28, dash: [6, 1.5, 1.2, 1.5, 1.2, 1.5] }, parapet: { w: 1.3, g: 0.2 }, unspecified: { w: 0.6, g: 0.5, dash: [2, 2] },
};
function rpPlanStyle(doc, type, status, k = 1) {
  const s = RP_PLAN[type] || RP_PLAN.unspecified;
  if (status === 'unresolved') { rpColor(doc, 'draw', GR(0.4)); doc.setLineWidth(1.3 * k); doc.setLineDashPattern([0.6, 2.2], 0); return; }
  const w = s.w * k * (status === 'inferred' ? 0.75 : 1); rpColor(doc, 'draw', GR(status === 'inferred' ? Math.max(0.42, s.g) : s.g)); doc.setLineWidth(w);
  doc.setLineDashPattern(status === 'inferred' ? [5, 2.6] : (s.dash || []), 0);
}
// separating-axis overlap of two convex quads, and a segment against a quad (both in page points)
const rpQuadHit = (A, B) => { for (const P of [A, B]) for (let i = 0; i < P.length; i++) { const a = P[i], b = P[(i + 1) % P.length]; const n = [b[1] - a[1], a[0] - b[0]];
  const pa = A.map((p) => p[0] * n[0] + p[1] * n[1]), pb = B.map((p) => p[0] * n[0] + p[1] * n[1]); if (Math.max(...pa) < Math.min(...pb) || Math.max(...pb) < Math.min(...pa)) return false; } return true; };
const rpSegHit = (s, Q) => { if (rpInside(s[0], Q) || rpInside(s[1], Q)) return true; const o = (p, q, r) => (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]);
  for (let i = 0; i < Q.length; i++) { const a = Q[i], b = Q[(i + 1) % Q.length]; if (o(s[0], s[1], a) * o(s[0], s[1], b) < 0 && o(a, b, s[0]) * o(a, b, s[1]) < 0) return true; } return false; };
const rpQuad = (c, u, hw, hh) => { const n = [-u[1], u[0]]; return [[-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh]].map(([a, b]) => [c[0] + u[0] * a + n[0] * b, c[1] + u[1] * a + n[1] * b]); };
const rpBoxQuad = (b) => [[b.x0, b.y0], [b.x1, b.y0], [b.x1, b.y1], [b.x0, b.y1]];
const rpShrink = (Q, d) => { const c = Q.reduce((a, p) => [a[0] + p[0] / Q.length, a[1] + p[1] / Q.length], [0, 0]); return Q.map((p) => { const v = [p[0] - c[0], p[1] - c[1]], l = Math.hypot(v[0], v[1]) || 1; return [p[0] - v[0] / l * d, p[1] - v[1] / l * d]; }); };

// draws the plan in view V and places every label; returns what was placed and what was not
// o.win: limit the drawing to V.box (detail sheets); o.only: place labels only for these keys (detail sheets)
function rpPlanDraw(doc, M, V, o = {}) {
  const P = V.P; const k = o.k || 1; const area = o.area || V.box; const clip = !!o.win;
  if (clip) rpClip(doc, area.x, area.y, area.w, area.h);
  // planes: no shading; an unresolved plane and every hidden zone hatched; a cut-out drawn dotted
  for (const F of M.facets) { const pts = F.xy.map(P); if (F.f.excluded) { rpPolyG(doc, pts, 1, 0.5, 0.5, [1.5, 1.5]); continue; } if (F.status === 'unresolved') rpHatch(doc, pts, 5 * k, 0.6, 0.3); }
  for (const Z of M.zones) rpHatch(doc, Z.xy.map(P), 5 * k, 0.55, 0.32);
  // facet outlines (hairline) with a gap where the visible roof stops at a canopy edge
  rpColor(doc, 'draw', GR(0.62)); doc.setLineWidth(0.3 * k); doc.setLineDashPattern([], 0);
  for (const F of M.facets) if (!F.f.excluded) rpRingGap(doc, F.xy, M.obLines, P);
  // canopy edges: where the visible roof stops at tree cover. Drawn faint and dotted: never a roof edge, never closes an outline
  rpColor(doc, 'draw', GR(0.55)); doc.setLineWidth(0.5 * k); doc.setLineDashPattern([0.4, 1.8], 0); for (const L of M.obLines) rpPolyline(doc, L.xy.map(P)); doc.setLineDashPattern([], 0);
  // roof lines: interior first, exterior on top
  const ext = (t) => t === 'eave' || t === 'rake';
  for (const L of [...M.lines.filter((q) => !ext(q.type)), ...M.lines.filter((q) => ext(q.type))]) { rpPlanStyle(doc, L.type, L.status, k); let pts = L.xy.map(P);
    if (L.e.paired === 'lower' && pts.length >= 2) { const dx = pts[pts.length - 1][0] - pts[0][0], dy = pts[pts.length - 1][1] - pts[0][1], l = Math.hypot(dx, dy) || 1; pts = pts.map((p) => [p[0] - dy / l * 1.8, p[1] + dx / l * 1.8]); }
    rpPolyline(doc, pts); }
  doc.setLineDashPattern([], 0);
  // ---- labels. Obstacles: every drawn segment (sampled as segments), every label placed, the reserved boxes
  const segs = []; const addRing = (ring, closed, owner) => { const Q = ring.map(P); for (let i = 0; i < Q.length - (closed ? 0 : 1); i++) segs.push({ s: [Q[i], Q[(i + 1) % Q.length]], owner }); };
  for (const F of M.facets) if (!F.f.excluded) addRing(F.xy, true, F.id); for (const Z of M.zones) addRing(Z.xy, true, Z.id); for (const L of M.lines) addRing(L.xy, false, L.tag); for (const L of M.obLines) addRing(L.xy, false, L.id);
  const placed = (o.reserve || []).map(rpBoxQuad); const limit = { x0: area.x + 3, y0: area.y + 3, x1: area.x + area.w - 3, y1: area.y + area.h - 3 };
  const inLimit = (Q) => Q.every((p) => p[0] >= limit.x0 && p[0] <= limit.x1 && p[1] >= limit.y0 && p[1] <= limit.y1);
  const free = (Q, own) => inLimit(Q) && !placed.some((R) => rpQuadHit(Q, R)) && !segs.some((g) => g.owner !== own && rpSegHit(g.s, Q));
  const out = { labels: [], callouts: [], facets: [], missed: [], facetMissed: [] };
  const want = o.only ? new Set(o.only) : null;
  const SZ = 7, SZK = 6.5;   // at 100% on US Letter: 7 pt length labels, 6.5 pt bold keys
  // edges: the longest straight piece of each line carries "KEY  length" beside it, parallel to it, outside the roof first
  const seenTag = new Set(); const lines = M.lines.filter((L) => L.tag && (!want || want.has(L.tag))).slice().sort((p, q) => q.m.trueFt - p.m.trueFt).filter((L) => { if (seenTag.has(L.tag)) return false; seenTag.add(L.tag); return true; });
  const callout = (anchor, key, own, size = 6) => {
    const w = rpWidth(doc, key, size, true) + 5, h = size + 3.4; const dirs = []; for (let a = 0; a < 24; a++) dirs.push([Math.cos(a * Math.PI / 12), Math.sin(a * Math.PI / 12)]);
    for (const d of [11, 16, 22, 29, 37, 46, 58, 72, 90]) for (const u of dirs) { const c = [anchor[0] + u[0] * d, anchor[1] + u[1] * d]; const Q = rpBoxQuad({ x0: c[0] - w / 2, y0: c[1] - h / 2, x1: c[0] + w / 2, y1: c[1] + h / 2 });
      if (!free(Q, own)) continue; const lead = [anchor, [c[0] - u[0] * (Math.min(w, h) / 2), c[1] - u[1] * (Math.min(w, h) / 2)]]; if (placed.some((R) => rpSegHit(lead, R))) continue;
      rpLn(doc, lead[0], lead[1], 0.35, 0.35); doc.setLineDashPattern([], 0); rpColor(doc, 'fill', GR(1)); rpColor(doc, 'draw', GR(0.25)); doc.setLineWidth(0.45); doc.roundedRect(c[0] - w / 2, c[1] - h / 2, w, h, h / 2, h / 2, 'FD');
      rpText(doc, key, c[0], c[1] + size * 0.35, { size, bold: true, color: GR(0.1), align: 'center' }); placed.push(Q); return true; }
    return false; };
  for (const L of lines) {
    let bi = null, bl = -1; for (let i = 1; i < L.xy.length; i++) { const d = Math.hypot(L.xy[i][0] - L.xy[i - 1][0], L.xy[i][1] - L.xy[i - 1][1]); if (d > bl) { bl = d; bi = [L.xy[i - 1], L.xy[i]]; } }
    if (!bi) continue; const a = P(bi[0]), b = P(bi[1]); const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1; let u = [(b[0] - a[0]) / len, (b[1] - a[1]) / len]; if (u[0] < -1e-9 || (Math.abs(u[0]) < 1e-9 && u[1] > 0)) u = [-u[0], -u[1]];
    const n = [-u[1], u[0]]; const mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    if (clip && !(mid[0] > area.x && mid[0] < area.x + area.w && mid[1] > area.y && mid[1] < area.y + area.h)) continue;
    const un = L.status === 'unresolved'; const grp = L.ref ? M.lines.filter((q) => q.ref === L.ref) : [L]; const shown = grp.find((q) => q.displayedFt != null); const ftv = L.ref ? (shown ? shown.displayedFt : null) : L.displayedFt != null ? L.displayedFt : L.m.trueFt;
    const lenTxt = L.ref ? (ftv == null ? 'source: no length' : rpDimTxt(ftv)) : un ? 'unsupported' : rpDimTxt(ftv) + (L.status === 'inferred' ? ' est.' : '');
    const kw = rpWidth(doc, L.tag, SZK, true), lw = rpWidth(doc, lenTxt, SZ, false); const tw = kw + 3 + lw; const hh = SZ * 0.62;
    // outside first for exterior edges: the side away from the plane it bounds
    let side = 1; if (L.facets.length) { const F = M.facets.find((q) => q.id === L.facets[0]); if (F) { const c = P(rpLabelPoint(F.xy).p); side = (c[0] - mid[0]) * n[0] + (c[1] - mid[1]) * n[1] > 0 ? -1 : 1; } }
    let done = false;
    if (tw <= len + 14) for (const dd of [hh + 2.6, hh + 6]) { for (const sg of [side, -side]) { for (const sh of [0, 0.22, -0.22, 0.38, -0.38]) {
      const c = [mid[0] + n[0] * dd * sg + u[0] * sh * len, mid[1] + n[1] * dd * sg + u[1] * sh * len]; const Q = rpQuad(c, u, tw / 2 + 1.5, hh + 0.8);
      if (!free(Q, L.tag)) continue;
      // text runs along the edge, reading left to right; key bold, then the length
      const ang = Math.atan2(-u[1], u[0]) * 180 / Math.PI; const k0 = [c[0] - u[0] * (tw / 2 - kw / 2), c[1] - u[1] * (tw / 2 - kw / 2)], l0 = [c[0] + u[0] * (tw / 2 - lw / 2), c[1] + u[1] * (tw / 2 - lw / 2)];
      rpRotText(doc, L.tag, k0[0], k0[1], ang, SZK, GR(0.35), true); rpRotText(doc, lenTxt, l0[0], l0[1], ang, SZ, GR(0.08), false);
      placed.push(Q); out.labels.push(L.tag); done = true; break; } if (done) break; } if (done) break; }
    if (!done && callout(mid, L.tag, L.tag)) { out.callouts.push(L.tag); done = true; }
    if (!done) out.missed.push(L.tag);
  }
  // facet IDs: small, inside the plane; a plane too small for its ID gets a callout
  if (!o.noFacets) for (const F of M.facets) { if (F.f.excluded || (want && !want.has(F.id))) continue; const lp = rpLabelPoint(F.xy); const c0 = P(lp.p); if (clip && !(c0[0] > area.x && c0[0] < area.x + area.w && c0[1] > area.y && c0[1] < area.y + area.h)) continue;
    const poly = F.xy.map(P); const w = rpWidth(doc, F.id, 6.4, true) / 2 + 1, h = 3.6; let done = false;
    const cands = [c0]; for (const d of [6, 11, 16, 22]) for (let a2 = 0; a2 < 8; a2++) cands.push([c0[0] + Math.cos(a2 * Math.PI / 4) * d, c0[1] + Math.sin(a2 * Math.PI / 4) * d]);
    for (const c of cands) { if (!rpInside(c, poly)) continue; const Q = rpBoxQuad({ x0: c[0] - w, y0: c[1] - h, x1: c[0] + w, y1: c[1] + h }); if (!Q.every((p) => rpInside(p, poly)) || !free(Q, F.id)) continue;
      rpText(doc, F.id, c[0], c[1] + 2.3, { size: 6.4, bold: true, color: GR(0.42), align: 'center' }); placed.push(Q); out.facets.push(F.id); done = true; break; }
    if (!done && callout(c0, F.id, F.id, 5.8)) { out.facets.push(F.id); done = true; }
    if (!done) out.facetMissed.push(F.id); }
  for (const Z of M.zones) { if (want && !want.has(Z.id)) continue; const poly = Z.xy.map(P); const c0 = P(rpLabelPoint(Z.xy).p); const w = rpWidth(doc, Z.id, 6.6, true) / 2 + 1.5, h = 3.8; let done = false;
    const cands = [c0]; for (const d of [6, 12, 18]) for (let a2 = 0; a2 < 8; a2++) cands.push([c0[0] + Math.cos(a2 * Math.PI / 4) * d, c0[1] + Math.sin(a2 * Math.PI / 4) * d]);
    for (const c of cands) { const Q = rpBoxQuad({ x0: c[0] - w, y0: c[1] - h, x1: c[0] + w, y1: c[1] + h }); if (!Q.every((p) => rpInside(p, poly)) || !inLimit(Q) || placed.some((R) => rpQuadHit(Q, R))) continue;
      rpRect(doc, c[0] - w, c[1] - h, 2 * w, 2 * h, 1, null); rpText(doc, Z.id, c[0], c[1] + 2.4, { size: 6.6, bold: true, color: GR(0.15), align: 'center' }); placed.push(Q); out.facets.push(Z.id); done = true; break; }
    if (!done && callout(c0, Z.id, Z.id, 6)) { out.facets.push(Z.id); done = true; }
    if (!done) out.facetMissed.push(Z.id); }
  if (clip) rpUnclip(doc);
  out.placed = placed; out.segs = segs; return out;
}
// legend row items for the line types and states the plan uses
function rpLegendItems(M) {
  const it = []; const used = new Set(M.lines.map((L) => L.type)); for (const t of RP_ORDER) if (used.has(t)) it.push({ type: t, status: 'measured', label: EDGE_TYPES[t].label });
  if (M.lines.some((L) => L.status === 'inferred')) it.push({ type: 'eave', status: 'inferred', label: 'Estimated' });
  if (M.lines.some((L) => L.status === 'unresolved')) it.push({ type: 'eave', status: 'unresolved', label: 'Unsupported' });
  if (M.obLines.length) it.push({ canopy: true, label: 'Canopy edge' });
  if (M.zones.length || M.facets.some((F) => F.status === 'unresolved')) it.push({ hatch: true, label: 'Not measured' });
  return it;
}
function rpLegendDraw(doc, items, x, y, maxW) {
  let cx = x, cy = y; for (const L of items) { const w = 22 + 4 + rpWidth(doc, L.label, 6.8) + 11; if (cx + w > x + maxW) { cx = x; cy += 11; }
    if (L.hatch) rpHatch(doc, [[cx, cy - 6], [cx + 20, cy - 6], [cx + 20, cy + 1], [cx, cy + 1]], 3, 0.5);
    else if (L.canopy) { rpColor(doc, 'draw', GR(0.55)); doc.setLineWidth(0.5); doc.setLineDashPattern([0.4, 1.8], 0); doc.line(cx, cy - 2.5, cx + 20, cy - 2.5); doc.setLineDashPattern([], 0); }
    else { rpPlanStyle(doc, L.type, L.status); doc.line(cx, cy - 2.5, cx + 20, cy - 2.5); doc.setLineDashPattern([], 0); }
    rpText(doc, L.label, cx + 25, cy, { size: 6.8, color: GR(0.22) }); cx += w; }
  return cy;
}

// ------------------------------------------------------------------ sheet 1: measurement summary and roof plan
function rpSummaryCells(M) {
  const t = M.t, R = M.area, src = M.src, est = src && src.estimate, sq = (v) => rpNum(v / 100, 2) + ' SQ', net = t.sloped; const cells = [];
  if (est) cells.push(['SKETCH-VERIFIED SUBTOTAL', rpNum(R.confirmed, 2) + ' ft²'], [String(est.label || 'Reported net estimate').toUpperCase(), rpNum(est.netSqft, 2) + ' ft²'], ['BALANCE TO REVIEW', rpNum(est.netSqft - R.confirmed, 2) + ' ft²']);
  else if (M.kind === 'source' && src.totals && src.totals.netSqft != null) cells.push(['REPORTED NET SLOPED AREA', rpNum(src.totals.netSqft) + ' ft²'], ['NET SQUARES', sq(src.totals.netSqft)], ['PREDOMINANT PITCH', rpPitch(src.totals.pitch != null ? src.totals.pitch : t.predominant)]);
  else if (!R.fullKnown || R.estimate > 0.5) { cells.push(['CONFIRMED AREA', rpNum(R.confirmed, 2) + ' ft²']); if (R.estimate > 0.5) cells.push(['CONFIRMED + ESTIMATE', rpNum(net, 2) + ' ft²']); cells.push(['NET SQUARES', sq(net)], ['PREDOMINANT PITCH', rpPitch(t.predominant)]); }
  else cells.push(['NET SLOPED AREA', rpNum(net, 2) + ' ft²'], ['NET SQUARES', sq(net)], ['PREDOMINANT PITCH', rpPitch(t.predominant)]);
  const li = M.kind === 'source' && src.totals && src.totals.lines ? src.totals.lines : null; const v = (k) => (li ? li[k] : t.byType[k].true);
  const verified = M.kind !== 'measured' || (R.fullKnown && R.estimate < 0.5);   // a zero is a measured absence only when no roof is hidden or estimated
  for (const [cap, kk] of [['EAVES', 'eave'], ['RAKES', 'rake'], ['RIDGES', 'ridge'], ['HIPS', 'hip'], ['VALLEYS', 'valley']]) { const x = v(kk); cells.push([cap, x == null ? '' : x < 0.05 && !verified ? 'none seen' : rpFtIn(x)]); }
  const fl = li ? (li.step || 0) + (li.wall || 0) : t.byType.step.true + t.byType.wall.true; if (fl > 0.05) cells.push(['FLASHING', rpFtIn(fl)]);
  return cells;
}
function rpSheetPlanFirst(doc, M, S, hero, n, total, ctx, opts = {}) {
  rpHeader(doc, M, 'Roof plan', n, total);
  // compact summary strip
  const cells = rpSummaryCells(M); const y0 = 70, hS = 34; rpRect(doc, RP.L, y0, 548, hS, 0.955);
  const need = cells.map(([cap, val]) => Math.max(rpWidth(doc, cap, 6.2, true), rpWidth(doc, val, 10.2, true)) + 12); const extra = Math.max(0, (548 - need.reduce((a, b) => a + b, 0)) / cells.length);
  let x = RP.L; const scale = Math.min(1, 548 / need.reduce((a, b) => a + b, 0)); cells.forEach(([cap, val], i) => { const w = need[i] * scale + extra; if (i) rpLn(doc, [x, y0 + 6], [x, y0 + hS - 6], 0.45, 0.72);
    rpText(doc, cap, x + 6, y0 + 12, { size: 6.2 * Math.min(1, scale + 0.08), bold: true, color: GR(0.34) }); rpText(doc, val, x + 6, y0 + 26.5, { size: 10.2 * Math.min(1, scale + 0.08), bold: true }); x += w; });
  let top = y0 + hS + 8;
  // one status line: why the report needs review, or what the numbers are based on
  const why = M.review ? 'Review required: ' + (M.status.reasons.slice(0, 2).map((r) => r.text.replace(/\.$/, '')).join('; ') || 'see sheet 2') + '. Estimated and unsupported parts are marked on the plan; sheet 2 lists them.'
    : M.kind === 'source' ? `Source takeoff: ${(M.src.document || 'source report')}${M.src.pages ? ', ' + M.src.pages : ''}. The plan reproduces the reported geometry.`
      : M.kind === 'illustrative' ? 'Illustrative model: all coordinates and quantities are examples, not measurements.' : null;
  if (why) { top = rpText(doc, why, RP.L, top + 6, { size: 7.4, color: GR(0.25), maxWidth: 548, lh: 1.25 }) + 1; }
  // the plan: everything else on the sheet
  const box = { x: RP.L, y: top, w: 548, h: 724 - top }; rpRect(doc, box.x, box.y, box.w, box.h, 1, 0.72, 0.5);
  const legend = rpLegendItems(M); const legendRows = (() => { let cx = 0, r = 1; for (const L of legend) { const w = 37 + rpWidth(doc, L.label, 6.8); if (cx + w > 350) { cx = 0; r++; } cx += w; } return r; })(); const bandH = Math.max(30, 12 + 11 * legendRows); const area = { x: box.x + 6, y: box.y + 6, w: box.w - 12, h: box.h - bandH - 10 };
  const inner = { x: area.x + 10, y: area.y + 10, w: area.w - 20, h: area.h - 20 };
  let V = rpView(M, inner, { padFt: 2 }); { const V2 = rpView(M, inner, { padFt: Math.max(2, 20 / V.k) }); if (V2.perIn === V.perIn) V = V2; } V.box = box;
  // aerial inset: only into a corner the drawing leaves empty (checked against the geometry before anything is placed)
  let inset = null;
  if (hero && opts.inset !== false) { const iw = 118, ih = Math.round(118 * hero.h / hero.w); const pts = []; const add = (ring, closed) => { const Q = ring.map(V.P); for (let i = 0; i < Q.length - (closed ? 0 : 1); i++) { const a = Q[i], b = Q[(i + 1) % Q.length]; const m = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / 6)); for (let j = 0; j <= m; j++) pts.push([a[0] + (b[0] - a[0]) * j / m, a[1] + (b[1] - a[1]) * j / m]); } };
    for (const F of M.facets) add(F.xy, true); for (const L of M.lines) add(L.xy, false); for (const Z of M.zones) add(Z.xy, true);
    for (const c of ['tr', 'tl', 'br', 'bl']) { const bx = c[1] === 'r' ? area.x + area.w - iw - 4 : area.x + 4, by = c[0] === 't' ? area.y + 4 : area.y + area.h - ih - 16; const r = { x0: bx - 30, y0: by - 26, x1: bx + iw + 30, y1: by + ih + 38 };
      if (!pts.some((p) => p[0] > r.x0 && p[0] < r.x1 && p[1] > r.y0 && p[1] < r.y1)) { inset = { x0: bx, y0: by, x1: bx + iw, y1: by + ih + 12, iw, ih }; break; } } }
  const res = rpPlanDraw(doc, M, V, { area, reserve: inset ? [inset] : [] });
  if (inset) { doc.addImage(hero.src, 'JPEG', inset.x0, inset.y0, inset.iw, inset.ih, 'planInset', 'FAST'); rpRect(doc, inset.x0, inset.y0, inset.iw, inset.ih, null, 0.4, 0.5); rpText(doc, 'Aerial reference, not to scale' + (M.imagery.date ? ' · ' + rpDate(M.imagery.date) : ''), inset.x0, inset.y0 + inset.ih + 8, { size: 5.9, color: GR(0.36) }); }
  // legend, scale bar and north arrow in a band at the foot of the plan
  const by = box.y + box.h - bandH + 4; rpLn(doc, [box.x + 6, by - 4], [box.x + box.w - 6, by - 4], 0.4, 0.78);
  rpLegendDraw(doc, legend, box.x + 10, by + 8, 350);
  const step = V.k >= 4 ? 5 : V.k >= 2 ? 10 : 20; const barIn = (2 * step * V.k / 72).toFixed(2).replace(/\.?0+$/, '');
  rpNorth(doc, box.x + box.w - 18, by + 12, 0); rpBar(doc, box.x + box.w - 48 - 2 * step * V.k, by + 2, V.k, step); rpText(doc, V.label, box.x + box.w - 54 - 2 * step * V.k, by + 6, { size: 6.8, bold: true, color: GR(0.22), align: 'right' });
  rpText(doc, `Scale ${V.label} at 100% on US Letter (bar ${barIn} in). North up. Labels give true (sloped) lengths in feet and inches; the drawing is a horizontal projection.` + (res.missed.length || res.facetMissed.length ? ` ${res.missed.length + res.facetMissed.length} key${res.missed.length + res.facetMissed.length > 1 ? 's' : ''} on the plan detail sheet.` : ''), RP.L, 737, { size: 6.9, color: GR(0.3), maxWidth: 548 });
  // layout self-check: scale exactness, every key accounted for, the plan's share of the printable sheet
  let chk = null; for (const L of M.lines) for (let i = 1; i < L.xy.length; i++) { const ft = Math.hypot(L.xy[i][0] - L.xy[i - 1][0], L.xy[i][1] - L.xy[i - 1][1]); if (!chk || ft > chk.segmentFt) { const a = V.P(L.xy[i - 1]), b = V.P(L.xy[i]); chk = { key: L.tag, segmentFt: ft, segmentPt: Math.hypot(b[0] - a[0], b[1] - a[1]) }; } }
  if (chk) { chk.expectedPt = chk.segmentFt * V.k; chk.ok = Math.abs(chk.segmentPt - chk.expectedPt) < 1e-6 * Math.max(1, chk.expectedPt); }
  ctx.layout = { scale: V.label, perIn: V.perIn, ptPerFt: V.k, rotationDeg: 0, bar: { ft: 2 * step, pt: 2 * step * V.k, inches: +barIn }, dims: res.labels.length, keysOnOverview: true, inset: !!inset,
    keys: { total: new Set(M.lines.map((L) => L.tag).filter(Boolean)).size, placed: [...res.labels, ...res.callouts], missed: res.missed.slice(), labels: res.labels.length, callouts: res.callouts.length }, facetIds: { placed: res.facets.slice(), missed: res.facetMissed.slice() },
    planShare: Math.round(box.w * box.h / (548 * (724 - 70)) * 100) / 100, scaleCheck: chk };
  ctx.missedAll = [...res.missed, ...res.facetMissed];
  return res;
}

// ------------------------------------------------------------------ 3D illustration: only when the elevations support it
// The same faces as the plan, heights from the fitted roof planes. Omitted (with the reason) when the heights are only
// pitch-derived, planes are missing, neighbouring planes disagree at a shared corner, a face folds over in the view, or
// the roof is too simple for a 3D view to add anything.
function rpAxonCheck(M, AX, angle = -24, alt = 32) {
  if (!AX) return { ok: false, why: 'no roof plane has a measured height' };
  if (AX.illustrative && M.kind !== 'illustrative') return { ok: false, why: 'heights would come from the pitch alone (no measured elevations)' };
  if (AX.partial) return { ok: false, why: 'some planes have no supported height' };
  if (AX.faces.length < 3) return { ok: false, why: 'the plan shows this roof completely' };
  const brk = M.lines.filter((L) => ['step', 'wall', 'parapet', 'transition'].includes(L.type) || L.e.paired).map((L) => L.xy); const onBreak = (q) => brk.some((L) => { for (let i = 1; i < L.length; i++) if (RM.pointSeg(q, L[i - 1], L[i]) < 1.2) return true; return false; });
  const at = new Map(); for (const f of AX.faces) for (const p of f.pts) { if (onBreak([p[0], p[1]])) continue; const kk = Math.round(p[0] * 2) + ',' + Math.round(p[1] * 2); if (!at.has(kk)) at.set(kk, []); at.get(kk).push({ z: p[2], id: f.label }); }
  let worst = null; for (const arr of at.values()) if (arr.length > 1) { const zs = arr.map((q) => q.z); const sp = Math.max(...zs) - Math.min(...zs); if (!worst || sp > worst.sp) worst = { sp, ids: [...new Set(arr.map((q) => q.id))] }; }
  if (worst && worst.sp > 1.0) return { ok: false, why: `elevations conflict: ${worst.ids.join(' and ')} disagree by ${rpNum(worst.sp, 1)} ft at a shared corner` };
  const a = angle * Math.PI / 180, h = alt * Math.PI / 180; const pr = (p) => [Math.cos(a) * p[0] - Math.sin(a) * p[1], -Math.sin(h) * (Math.sin(a) * p[0] + Math.cos(a) * p[1]) - Math.cos(h) * p[2]];
  const crosses = (r) => { const n = r.length; const o = (p, q, t) => (q[0] - p[0]) * (t[1] - p[1]) - (q[1] - p[1]) * (t[0] - p[0]); for (let i = 0; i < n; i++) for (let j = i + 2; j < n; j++) { if (i === 0 && j === n - 1) continue; const A = r[i], B = r[(i + 1) % n], C = r[j], D = r[(j + 1) % n]; if (o(A, B, C) * o(A, B, D) < -1e-9 && o(C, D, A) * o(C, D, B) < -1e-9) return true; } return false; };
  for (const f of AX.faces) { const q = f.pts.map(pr); if (crosses(q)) return { ok: false, why: `${f.label || 'a plane'} folds over in the 3D view` }; }
  return { ok: true, why: worst ? `shared corners agree within ${rpNum(worst.sp, 1)} ft` : 'elevations agree' };
}

// ------------------------------------------------------------------ sheet 2: detailed takeoff
function rpTakeoffBlocks(doc, M, S) {
  // the tables as blocks of rows so they can flow across columns and onto a continuation sheet
  return [
    { title: S.refs ? 'Keyed dimensions' : 'Edge lengths by type', head: S.edgeHead, widths: S.edgeWidths, num: S.edgeNum, rows: S.edgeRows },
    { title: 'Facet areas and pitch', head: S.facetHead, widths: S.facetWidths, num: S.facetNum, rows: S.facetRows },
  ];
}
function rpSheetTakeoff(doc, M, S, n, total, ctx, opts = {}) {
  rpHeader(doc, M, 'Takeoff', n, total);
  const t = M.t, R = M.area, src = M.src, est = src && src.estimate; let y = 82;
  // buildings: one row each (detached buildings never merged), net before waste
  const T0 = M.kind === 'source' && src.totals ? src.totals : null; const li = T0 && T0.lines ? T0.lines : null; const lf = (v) => (v == null ? '' : li ? rpFtIn(v) : rpNum(v, 2)); const net = t.sloped;
  rpTitleBar(doc, y, 'Buildings', T0 ? (src.document || 'Source report') + (src.pages ? '  /  ' + src.pages : '') : 'Net roof-surface quantities, before waste'); y += 6;
  let rows;
  if (est) { rows = [[src.mainLabel || (M.structs[0] ? M.structs[0].name : 'Main house'), rpNum(R.confirmed, 2), rpNum(est.netSqft, 2), rpNum(est.netSqft / 100, 2), est.perimeterFt != null ? rpNum(est.perimeterFt, 2) : '', est.ridgeFt != null ? rpNum(est.ridgeFt, 2) : '']];
    for (const B of M.structs.slice(1)) rows.push([B.name, B.confirmed > 0.5 ? rpNum(B.confirmed, 2) : '', '', '', '', '']); if (M.structs.length === 1) rows.push([src.detachedLabel || 'Detached structures', '', '', '', '', '']);
    y = rpTableD(doc, RP.L, y, [150, 84, 84, 64, 84, 82], ['Building', 'Checked ft²', 'Est. net ft²', 'Est. SQ', 'Perimeter ft', 'Ridge ft'], rows, { rowh: 15, size: 8.2, headsz: 7.3, num: [1, 2, 3, 4, 5] }); }
  else { rows = M.structs.map((B) => { const one = M.structs.length === 1 && T0; const netS = one && T0.netSqft != null ? T0.netSqft : (B.unresolvedFacets && !B.confirmed && !B.estimate ? null : B.sloped);
      return [(M.structs.length > 1 ? B.index + '  ' : '') + B.name, netS == null ? '' : rpNum(netS, one ? 0 : 2), netS == null ? '' : rpNum(netS / 100, 2), rpPitch(one && T0.pitch != null ? T0.pitch : B.predominant), lf(li ? li.eave : B.eave), lf(li ? li.rake : B.rake), lf(li ? li.hip : B.hip), lf(li ? li.ridge : B.ridge)]; });
    if (M.structs.length > 1) rows.push(['Total', rpNum(net, 2), rpNum(net / 100, 2), '', rpNum(t.byType.eave.true, 2), rpNum(t.byType.rake.true, 2), rpNum(t.byType.hip.true, 2), rpNum(t.byType.ridge.true, 2)]);
    y = rpTableD(doc, RP.L, y, [128, 74, 52, 56, 60, 60, 58, 60], ['Building', 'Net ft²', 'SQ', 'Pitch', li ? 'Eave' : 'Eave ft', li ? 'Rake' : 'Rake ft', li ? 'Hip' : 'Hip ft', li ? 'Ridge' : 'Ridge ft'], rows, { rowh: 15, size: 8.2, headsz: 7.3, num: [1, 2, 3, 4, 5, 6, 7], lastBold: M.structs.length > 1 });
    const other = li ? [['Valleys', li.valley], ['Step flashing', li.step], ['Wall flashing', li.wall], ['Transitions', li.transition]].filter(([, v]) => v != null && v > 0).map(([k2, v]) => `${k2}  ${rpFtIn(v)}`) : [['Valleys', t.byType.valley.true], ['Step flashing', t.byType.step.true], ['Wall flashing', t.byType.wall.true], ['Transitions', t.byType.transition.true], ['Parapet', t.byType.parapet.true]].filter(([, v]) => v > 0.05).map(([k2, v]) => `${k2}  ${rpNum(v, 2)} ft`);
    if (other.length) { y += 11; rpText(doc, other.join('      '), RP.L, y, { size: 8.2, bold: true }); y += 2; } }
  // three columns: net measurements before waste, ordering quantities, and the 3D illustration (or why it is left out)
  y += 16; const yBlock = y; const w = state.waste != null ? +state.waste : 10; const withWaste = net * (1 + w / 100); const bt = t.byType;
  // order quantities are withheld while the report needs review or part of the roof is unseen (the summary sheet's waste
  // scenarios follow the same rule), so no purchasing figure rests on an unconfirmed building or an unmeasured part
  const hold = false; const pending = !!est || M.review || !R.fullKnown; const cw = [118, 56], cx = [RP.L, RP.L + 188, RP.L + 376];
  rpCap(doc, 'Net, before waste', cx[0], y, 6.6);
  const netRows = est ? [['Sketch-verified subtotal', rpNum(R.confirmed, 2) + ' ft²'], [est.label || 'Reported net estimate', rpNum(est.netSqft, 2) + ' ft²']]
    : [[R.fullKnown && R.estimate < 0.5 ? 'Net sloped area' : 'Confirmed area', rpNum(R.fullKnown && R.estimate < 0.5 ? net : R.confirmed, 2) + ' ft²'], ...(R.estimate > 0.5 ? [['Estimate under canopy', rpNum(R.estimate, 2) + ' ft²']] : []), ...(R.zoneCount ? [['Hidden zones (no total)', R.zoneUnknown ? 'not measured' : `0-${rpNum(R.zoneUpper)} ft²`]] : []), ['Plan (horizontal) area', rpNum(t.plan, 2) + ' ft²'], ['Squares', rpNum(net / 100, 2) + ' SQ'], ['Facets', String(M.facets.filter((F) => !F.f.excluded).length)]];
  let y1 = rpTableD(doc, cx[0], y + 4, cw, ['Quantity', 'Value'], netRows, { rowh: 12.6, size: 7.5, headsz: 6.8, num: [1] });
  rpCap(doc, `Ordering, ${w}% waste` + (hold && !pending ? ' (provisional)' : ''), cx[1], y, 6.6);
  const ordRows = pending ? [['Waste allowance', 'withheld'], ['Order quantities', 'after review']]
    : [['Area with waste', `${rpNum(withWaste, 2)} ft²`], ['Squares with waste', `${rpNum(withWaste / 100, 2)} SQ`], ['Bundles (3 per SQ)', String(Math.ceil(withWaste / 100 * 3))], ['Starter / drip edge', `${rpNum((bt.eave.true + bt.rake.true) * (1 + w / 100), 0)} ft`], ['Hip & ridge cap', `${rpNum((bt.hip.true + bt.ridge.true) * (1 + w / 100), 0)} ft`], ['Valley lining', `${rpNum(bt.valley.true * (1 + w / 100), 0)} ft`]];
  const y2 = rpTableD(doc, cx[1], y + 4, cw, ['Item', 'Quantity'], ordRows, { rowh: 12.6, size: 7.5, headsz: 6.8, num: [1] });
  const AX = opts.axon === false ? null : rpAxonModel(M); const okAX = opts.axon === false ? { ok: false, why: 'turned off for this report' } : rpAxonCheck(M, AX);
  rpCap(doc, '3D illustration', cx[2], y, 6.6); const hBox = Math.max(96, Math.max(y1, y2) - y - 4);
  if (okAX.ok) { rpRect(doc, cx[2], y + 4, 172, hBox, 0.99, 0.8, 0.45); rpDrawAxon(doc, M, AX, { x: cx[2] + 8, y: y + 10, w: 156, h: hBox - 30 }); rpText(doc, 'Same planes as the plan; ' + (M.kind === 'illustrative' ? 'modelled heights' : 'heights from the height model') + '. Not to scale.', cx[2] + 5, y + hBox - 7, { size: 5.9, color: GR(0.35), maxWidth: 164, lh: 1.2 }); }
  else rpText(doc, `Not drawn: ${okAX.why}. The scaled plan on sheet 1 is the drawing of record.`, cx[2], y + 14, { size: 7.2, color: GR(0.3), maxWidth: 172, lh: 1.3 });
  ctx.axon = okAX; y = Math.max(y1, y2, okAX.ok ? y + 4 + hBox + 8 : y) + 4;
  if (hold && !pending) y = rpText(doc, 'Provisional: the review items below can change these quantities.', RP.L, y + 8, { size: 7, color: GR(0.35) }) - 4;
  y += 18;
  return rpTakeoffFlow(doc, M, S, y, ctx, true);
}
// edge and facet tables (columns side by side, rows continued on the next sheet), then review items and the source note
function rpTakeoffFlow(doc, M, S, y, ctx, first) {
  const bottom = 744; const rowh = 11, headH = 19; const blocks = ctx.flow || (ctx.flow = rpTakeoffBlocks(doc, M, S).map((b) => ({ ...b, at: 0 })));
  for (const B of blocks) { if (B.at >= B.rows.length) continue; const tw = B.widths.reduce((a, b) => a + b, 0); const cols = Math.max(1, Math.floor((548 + 10) / (tw + 10))); const stride = cols > 1 ? (548 - tw * cols) / (cols - 1) + tw : 0;
    if (y + 12 + headH + rowh * 2 > bottom) return { more: true };
    rpTitleBar(doc, y, B.title + (B.at ? ' (continued)' : ''), B === blocks[0] && !S.refs ? 'Keys match the plan  ·  true (sloped) length' : B === blocks[1] ? 'Area includes slope' : null); y += 6;
    const per = Math.max(1, Math.floor((bottom - y - headH) / rowh)); let yEnd = y;
    const remaining = B.rows.length - B.at; const perCol = Math.min(per, Math.ceil(remaining / cols));
    for (let c = 0; c < cols && B.at < B.rows.length; c++) { const chunk = B.rows.slice(B.at, B.at + perCol); yEnd = Math.max(yEnd, rpTableD(doc, RP.L + c * stride, y, B.widths, B.head, chunk, { rowh, size: 7.6, headsz: 7, num: B.num })); B.at += chunk.length; }
    y = yEnd + 14; if (B.at < B.rows.length) return { more: true }; }
  // review items and notes
  const items = rpReviewItems(M); const notes = [];
  if (S.facetRows.some((r) => /\*$/.test(r[2]))) notes.push('* Pitch assigned by hand or by default, not fitted from the height model.');
  if (M.kind === 'measured') notes.push(`Source: ${M.imagery.source}${M.imagery.date ? ', flown ' + rpDate(M.imagery.date) : ''}${M.imagery.quality ? ' (' + String(M.imagery.quality).toLowerCase() + ' quality)' : ''}. Facet area = plan area × the fitted plane's slope factor; lengths are true (sloped) lengths; nothing is rounded before it is summed.` + (M.alt ? ` Part of the roof under canopy came from ${M.alt.label}.` : ''));
  else if (M.kind === 'source') notes.push((M.src.notes && M.src.notes[0]) || `${M.src.document || 'The source report'} supplies the net area, pitches and line totals.`);
  else notes.push((M.src && M.src.notes && M.src.notes[0]) || 'All coordinates and quantities are illustrative.');
  const itemH = (it) => Math.max(rpLines(doc, `${it.key}  ${it.title}`, 150, 7.8, true), rpLines(doc, it.action, 390, 7.6)) * 7.8 * 1.25 + 3;
  const noteH = notes.reduce((a, q) => a + rpLines(doc, q, 548, 7.2) * 7.2 * 1.3 + 4, 0);
  if (items.length) { if (!ctx.itemsAt) ctx.itemsAt = 0; if (y + 13 + itemH(items[ctx.itemsAt]) > bottom - noteH - 6) return { more: true };   // never a heading without its first item
    rpTitleBar(doc, y, ctx.itemsAt ? 'Items for field review (continued)' : 'Items for field review', 'Marked on the plan; in no total until measured'); y += 13;
    while (ctx.itemsAt < items.length) { const it = items[ctx.itemsAt]; const hh = itemH(it); if (y + hh > bottom - noteH - 6) return { more: true };
      rpText(doc, `${it.key}  ${it.title}`, RP.L, y, { size: 7.8, bold: true, maxWidth: 150, lh: 1.25 }); rpText(doc, it.action, RP.L + 158, y, { size: 7.6, maxWidth: 390, lh: 1.25 }); y += hh; ctx.itemsAt++; } y += 6; }
  y = Math.max(y + 4, bottom - noteH); for (const q of notes) y = rpText(doc, q, RP.L, y, { size: 7.2, color: GR(0.3), maxWidth: 548, lh: 1.3 }) + 4;
  return { more: false };
}
function rpSheetTakeoffCont(doc, M, S, n, total, ctx) { rpHeader(doc, M, 'Takeoff (continued)', n, total); return rpTakeoffFlow(doc, M, S, 82, ctx, false); }

// plan detail (only when a key found no room on sheet 1): an enlarged window of the same plan with those keys placed
function rpSheetDetail(doc, M, win, i, m, n, total, keys) {
  rpHeader(doc, M, 'Plan detail', n, total); rpTitleBar(doc, 82, `Plan detail ${i} of ${m}  ·  ${win[4]}`, 'Same plan, enlarged; keys match the takeoff');
  const box = { x: RP.L, y: 92, w: 548, h: 600 }; rpRect(doc, box.x, box.y, box.w, box.h, 1, 0.72, 0.5);
  const inner = { x: box.x + 12, y: box.y + 12, w: box.w - 24, h: box.h - 24 }; const V = rpView(M, inner, { ftBox: win.slice(0, 4), padFt: 1 }); V.box = box;
  const res = rpPlanDraw(doc, M, V, { area: { x: box.x + 2, y: box.y + 2, w: box.w - 4, h: box.h - 4 }, win: true, only: keys });
  const step = V.k >= 4 ? 5 : V.k >= 2 ? 10 : 20; rpNorth(doc, box.x + box.w - 20, box.y + box.h - 40); rpBar(doc, box.x + 14, box.y + box.h - 22, V.k, step);
  rpText(doc, `${V.label} at 100% on US Letter. North up. Keys match the takeoff tables on sheet 2.`, RP.L, box.y + box.h + 14, { size: 7.2, color: GR(0.3), maxWidth: 548 });
  return res;
}

// ------------------------------------------------------------------ in-app 3D preview of the same model (canvas)
// Draws the faces rpAxonModel() builds, from any heading, so the user can look before choosing to print it.
function rpAxonPreview(canvas, heading = -24) {
  const g = canvas.getContext('2d'); const W = canvas.width, H = canvas.height; g.fillStyle = '#fff'; g.fillRect(0, 0, W, H);
  const M = rpModel(); if (!M) return { ok: false, why: 'trace the roof first' }; rpKeys(M); const AX = rpAxonModel(M); const chk = rpAxonCheck(M, AX, heading);
  if (!AX) { g.fillStyle = '#555'; g.font = '13px sans-serif'; g.fillText('No measured heights for a 3D view.', 12, 24); return chk; }
  const a = heading * Math.PI / 180, h = 32 * Math.PI / 180; const pr = (p) => [Math.cos(a) * p[0] - Math.sin(a) * p[1], -Math.sin(h) * (Math.sin(a) * p[0] + Math.cos(a) * p[1]) - Math.cos(h) * p[2]];
  const all = AX.faces.flatMap((f) => f.pts.map(pr)); const x0 = Math.min(...all.map((p) => p[0])), x1 = Math.max(...all.map((p) => p[0])), y0 = Math.min(...all.map((p) => p[1])), y1 = Math.max(...all.map((p) => p[1]));
  const s = Math.min((W - 30) / (x1 - x0 || 1), (H - 30) / (y1 - y0 || 1)); const T = (p) => { const q = pr(p); return [15 + (q[0] - x0) * s + ((W - 30) - (x1 - x0) * s) / 2, 15 + (q[1] - y0) * s + ((H - 30) - (y1 - y0) * s) / 2]; };
  const depth = (f) => f.pts.reduce((acc, p) => acc + Math.sin(a) * p[0] + Math.cos(a) * p[1] - p[2] * 0.04, 0) / f.pts.length;
  for (const f of AX.faces.slice().sort((p, q) => depth(q) - depth(p))) { const A = f.pts[0], B = f.pts[1], C = f.pts[f.pts.length - 1]; let nn = [(B[1] - A[1]) * (C[2] - A[2]) - (B[2] - A[2]) * (C[1] - A[1]), (B[2] - A[2]) * (C[0] - A[0]) - (B[0] - A[0]) * (C[2] - A[2]), (B[0] - A[0]) * (C[1] - A[1]) - (B[1] - A[1]) * (C[0] - A[0])];
    const nl = Math.hypot(...nn) || 1; nn = nn.map((v) => v / nl); if (nn[2] < 0) nn = nn.map((v) => -v); const v = Math.round(255 * Math.max(0.55, Math.min(0.95, 0.8 + 0.25 * nn[0] + 0.25 * nn[1])));
    g.beginPath(); f.pts.map(T).forEach((p, i) => (i ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1]))); g.closePath(); g.fillStyle = `rgb(${v},${v},${v})`; g.fill(); g.strokeStyle = '#222'; g.lineWidth = 1; g.stroke();
    if (f.label) { const c = f.pts.map(T).reduce((acc, p) => [acc[0] + p[0] / f.pts.length, acc[1] + p[1] / f.pts.length], [0, 0]); g.fillStyle = '#333'; g.font = 'bold 10px sans-serif'; g.textAlign = 'center'; g.fillText(f.label, c[0], c[1] + 3); } }
  return chk;
}

// ------------------------------------------------------------------ build
// Sheet 1 roof plan, sheet 2 takeoff; a plan detail sheet only when a key found no room on sheet 1, a continuation only
// when the tables run long; the evidence and materials sheets when they apply. One model (rpModel) feeds every sheet.
async function rpBuild(opts = {}) {
  if (!window.jspdf) throw new Error('PDF library did not load; check the internet connection');
  const M = rpModel(); if (!M || !M.facets.length) { if (state.trace && state.trace.failed) return rpBuildNoRoof(); throw new Error('Trace the roof first'); }
  await rpLoadLogo(); const hero = await rpHeroAerial(M); const S = rpSchedules(M); const axon = opts.axon == null ? (state.report3d !== false) : !!opts.axon;
  // dry run on throwaway documents: which keys need a detail sheet, how many continuation sheets the tables take
  const probe = rpDoc(); const pctx = {}; rpSheetPlanFirst(probe, M, S, hero, 1, 2, pctx); const missed = pctx.missedAll || [];
  const wins = missed.length ? rpDetailWindows(M) : []; const placedOnDetail = new Set();
  for (const [i, w] of wins.entries()) { const r = rpSheetDetail(probe, M, w, i + 1, wins.length, 0, 0, missed); for (const kk of [...r.labels, ...r.callouts, ...r.facets]) placedOnDetail.add(kk); }
  const unplaced = missed.filter((kk) => !placedOnDetail.has(kk));
  const tctx = {}; probe.addPage('letter', 'portrait'); let more = rpSheetTakeoff(probe, M, S, 2, 2, tctx, { axon }).more; let cont = 0; while (more && cont < 8) { probe.addPage('letter', 'portrait'); more = rpSheetTakeoffCont(probe, M, S, 0, 0, tctx).more; cont++; }
  const hasEvidence = M.kind === 'source' ? false : (M.views.length > 0 || M.evidence.length > 0 || !!M.alt);
  probe.addPage('letter', 'portrait'); const infoPages = rpSheetInformation(probe, M, 0, 0); const mats = !!opts.materials && !M.review;
  const total = 2 + cont + wins.length + infoPages + (hasEvidence ? 1 : 0) + (mats ? 1 : 0);
  const doc = rpDoc(); doc.__rpText = []; const ctx = {}; let n = 1;
  rpSheetPlanFirst(doc, M, S, hero, n, total, ctx); doc.addPage('letter', 'portrait'); n++;
  const kctx = {}; let mo = rpSheetTakeoff(doc, M, S, n, total, kctx, { axon }).more; for (let i = 0; i < cont && mo; i++) { doc.addPage('letter', 'portrait'); n++; mo = rpSheetTakeoffCont(doc, M, S, n, total, kctx).more; }
  wins.forEach((w, i) => { doc.addPage('letter', 'portrait'); n++; rpSheetDetail(doc, M, w, i + 1, wins.length, n, total, missed); });
  doc.addPage('letter', 'portrait'); n++; n += rpSheetInformation(doc, M, n, total) - 1;
  if (hasEvidence) { doc.addPage('letter', 'portrait'); n++; rpSheetEvidence(doc, M, n, total); }
  if (mats) { doc.addPage('letter', 'portrait'); n++; rpSheetMaterials(doc, M, n, total); }
  doc.setProperties({ title: `${M.line1} - Roof Measurement Report`, author: 'Diversity Contracting | Roof Measure', subject: 'US Letter roof measurement report: scaled roof plan and takeoff', creator: 'Roof Measure' });
  // layout self-check for the caller: every key and facet ID is on the plan, on a detail sheet, or named as unplaced; every
  // ID on the plan is a row of the takeoff and every row is on the plan; the scale is exact; no text sits on other text
  const Lk = ctx.layout; let layout = null;
  if (Lk) { const onPlan = new Set([...Lk.keys.placed, ...Lk.facetIds.placed]); const rowKeys = new Set([...S.edgeRows.map((r) => r[0]), ...S.facetRows.map((r) => r[0]), ...rpReviewItems(M).map((it) => it.key).filter((kk) => /^Z\d+$/.test(kk))]);
    const shown = new Set([...onPlan, ...placedOnDetail]); const refMode = S.refs;
    const notInSchedule = [...onPlan].filter((kk) => !rowKeys.has(kk)); const notOnPlan = [...rowKeys].filter((kk) => !shown.has(kk) && !unplaced.includes(kk));
    layout = { ...Lk, keys: { ...Lk.keys, total: Lk.keys.total, overview: Lk.keys.placed.length, detail: placedOnDetail.size, unplaced, unaccounted: notOnPlan }, callouts: { onPlan: onPlan.size, rows: rowKeys.size, notInSchedule, notOnPlan, ok: !notInSchedule.length && !notOnPlan.length },
      axon: kctx.axon || null, sheets: { total, detail: wins.length, schedules: cont, information: infoPages, evidence: hasEvidence, materials: mats } }; }
  if (layout) { const byPage = new Map(); for (const t of doc.__rpText) { if (!byPage.has(t.pg)) byPage.set(t.pg, []); byPage.get(t.pg).push(t); } const hits = [];
    for (const [pg, arr] of byPage) for (let i = 0; i < arr.length; i++) for (let j = i + 1; j < arr.length; j++) { const a = arr[i], b = arr[j]; const ow = Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0), oh = Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0); if (ow > 0.75 && oh > 0.75 && (!(a.q || b.q) || rpQuadHit(rpShrink(a.q || rpBoxQuad(a), 0.4), rpShrink(b.q || rpBoxQuad(b), 0.4)))) hits.push({ page: pg, a: a.s, b: b.s, at: [Math.round(a.x0), Math.round(a.y0)] }); }
    layout.textOverlaps = { count: hits.length, first: hits.slice(0, 12) }; }
  doc.__rpText = null;
  return { doc, M, pages: doc.getNumberOfPages(), layout };
}

// no roof could be measured from the imagery: a one-sheet REVIEW REQUIRED report with what was found and what is needed
function rpBuildNoRoof() {
  const tr = state.trace || {}; const st = typeof reviewReportStatus === 'function' ? reviewReportStatus() : { status: 'REVIEW REQUIRED', reasons: [{ text: tr.failed, needs: 'Imagery that shows the building.' }] };
  const addr = String(state.address || '').split(','); const d = tr.imageryDate;
  const M = { line1: addr[0] || 'Roof', line2: addr.slice(1).join(',').replace(/,?\s*USA\s*$/, '').trim(), statusLabel: 'REVIEW REQUIRED', imagery: { label: d ? rpDate(d) : 'not reported' } };
  const doc = rpDoc(); M.date = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' }); rpHeader(doc, M, 'No roof measured', 1, 1); rpTitleBar(doc, 82, 'No roof measured'); let y = 96;
  rpRect(doc, RP.L, y, 548, 37, 0.94); rpRect(doc, RP.L, y, 2, 37, 0.22); rpText(doc, 'Review required', RP.L + 10, y + 15, { size: 9.3, bold: true }); rpText(doc, 'No roof area or length could be measured from the imagery. Nothing in this report is a measurement.', RP.L + 10, y + 28, { size: 8.7 }); y += 60;
  rpTitleBar(doc, y, 'What was found'); y += 18; for (const q of st.reasons) { y = rpText(doc, q.text, RP.L, y, { size: 9.2, maxWidth: 548 }) + 2; y = rpText(doc, 'Needed: ' + q.needs, RP.L + 10, y, { size: 8.8, color: GR(0.32), maxWidth: 538 }) + 8; }
  y += 10; rpTitleBar(doc, y, 'Property & imagery'); y += 18; const kv = (k, v) => { rpText(doc, k, RP.L, y, { size: 8.8, color: GR(0.32) }); y = rpText(doc, v, RP.L + 110, y, { size: 8.8, maxWidth: 438 }) + 2; };
  kv('Property', state.address || '-'); kv('Image date', d ? rpDate(d) : 'not reported by the source'); kv('Image source', 'Google Solar API (aerial photo, building mask and 10 cm height model)' + (tr.imageryQuality ? ' - ' + String(tr.imageryQuality).toLowerCase() + ' quality' : '')); kv('Building record', tr.buildingName || '-');
  doc.setProperties({ title: `${M.line1} - roof measurement (review required)`, author: 'Diversity Contracting | Roof Measure', creator: 'Roof Measure' });
  return { doc, M, pages: 1 };
}
