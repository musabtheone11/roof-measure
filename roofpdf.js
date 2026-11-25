'use strict';
/* roofpdf.js - Diversity Roofing roof measurement report, drawn straight into the PDF (jsPDF).
 * Every plan is vector line work and every word is real PDF text (selectable, searchable, sharp when printed).
 * The same geometry, orientation (north up) and facet / line IDs are used on every page:
 *   1 Summary - 2 Aerial with roofline - 3 Roof plan - 4 Lengths - 5 Areas - 6 Pitches - 7 Facet schedule -
 *   8 Line schedule - 9 Trees & obstructions (when present) - 10 Totals, counting rules, waste - optional 3D view and materials.
 * Uses globals from app.js (state, computeTotals, EDGE_TYPES, fmt, pitchLabel, solarSummary, fileBase), report.js (company,
 * MATERIAL_CATALOG, wasteColumns, matColumns, deliverFile), review.js (reviewState) and roofmodel.js (RM).
 */
const RP = {
  NAVY: [18, 48, 74], GOLD: [201, 162, 39], INK: [26, 32, 44], MUTE: [104, 113, 128], RULE: [214, 220, 228], PALE: [243, 246, 250],
  W: 612, H: 792, M: 36, BAND: 62,
  // one line style per roof feature, used on the map legend, the plans and the schedules. dash = [on, off] in points.
  LINE: {
    eave: { c: [36, 140, 70], w: 1.5 }, rake: { c: [224, 150, 20], w: 1.5 }, ridge: { c: [120, 150, 20], w: 1.8 }, hip: { c: [122, 78, 200], w: 1.5 },
    valley: { c: [214, 60, 45], w: 1.5 }, step: { c: [210, 105, 30], w: 1.5, dash: [4, 2] }, wall: { c: [45, 120, 220], w: 1.5, dash: [4, 2] },
    transition: { c: [200, 80, 200], w: 1.3, dash: [6, 2, 1, 2] }, parapet: { c: [150, 110, 40], w: 1.5, dash: [1, 1.5] }, unspecified: { c: [80, 170, 220], w: 1.2, dash: [2, 2] },
  },
  STATUS_FILL: { measured: [232, 238, 247], inferred: [252, 240, 200], unresolved: [252, 222, 218] },
  HATCH: [205, 50, 40], EST: [176, 120, 0], WARN: [190, 30, 20],
};
const rpFtIn = (ft) => { let f = Math.floor(ft + 1e-9), i = Math.round((ft - f) * 12); if (i === 12) { f += 1; i = 0; } return `${f}' ${i}"`; };
const rpNum = (v, d = 0) => (Math.round(v * 10 ** d) / 10 ** d).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
const rpCap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

// ------------------------------------------------------------------ model: everything the pages draw, computed once
function rpModel() {
  const t = computeTotals(); const rv = typeof reviewState === 'function' ? reviewState() : null; const tr = state.trace; const status = rv && typeof reviewReportStatus === 'function' ? reviewReportStatus(rv) : null;
  const paths = [...t.facetsAll.map((x) => x.m.path), ...t.edges.map((x) => x.m.path), ...(t.hiddenZones || []).map((z) => z.path)];
  const fr = RM.frame(paths); if (!fr) return null;
  const ft = (v) => { const p = fr.xy(v); return [p[0] * RM.FT, p[1] * RM.FT]; };
  const facets = t.facetsAll.map((x) => ({ id: x.f.name, f: x.f, m: x.m, xy: x.m.path.map(ft), status: RM.statusOf(x.f), structure: structureOf(t, x.f.id) }));
  // roof lines carry key numbers and are counted; an obstruction boundary (visible roof stops at tree canopy) is neither
  const lines = t.edges.filter((x) => !EDGE_TYPES[x.e.type].notRoof).map((x, i) => ({ id: 'L' + (i + 1), n: i + 1, e: x.e, m: x.m, xy: x.m.path.map(ft), status: RM.statusOf(x.e), type: x.e.type }));
  const obLines = t.edges.filter((x) => EDGE_TYPES[x.e.type].notRoof).map((x, i) => ({ id: 'OB' + (i + 1), e: x.e, m: x.m, xy: x.m.path.map(ft) }));
  // hidden zones: possible roof under canopy that nothing seen supports. Hatched, labelled H1.., never in a total
  const zones = (t.hiddenZones || []).map((z) => { const F = facets.find((q) => q.id === z.facetName); return { ...z, xy: z.path.map(ft), group: F ? F.structure : null }; });
  // which facets each line borders (for the schedule)
  for (const L of [...lines, ...obLines]) { const mid = [(L.xy[0][0] + L.xy[L.xy.length - 1][0]) / 2, (L.xy[0][1] + L.xy[L.xy.length - 1][1]) / 2]; const a = L.xy[0], b = L.xy[1]; const m2 = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    L.facets = facets.filter((F) => !F.f.excluded && F.xy.some((p, k) => RM.pointSeg(m2, p, F.xy[(k + 1) % F.xy.length]) < 1.6 || RM.pointSeg(mid, p, F.xy[(k + 1) % F.xy.length]) < 1.6)).map((F) => F.id).slice(0, 3); }
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const g of [...facets, ...lines, ...obLines, ...zones]) for (const p of g.xy) { if (p[0] < x0) x0 = p[0]; if (p[0] > x1) x1 = p[0]; if (p[1] < y0) y0 = p[1]; if (p[1] > y1) y1 = p[1]; }
  const ob = tr && tr.obstruction ? { ...tr.obstruction, trees: tr.obstruction.trees.map((o) => ({ ...o, xy: o.path.map(ft) })), structures: tr.obstruction.structures.map((o) => ({ ...o, xy: o.path.map(ft) })) } : null;
  const d = tr && tr.imageryDate ? tr.imageryDate : (state.solar && state.solar.imageryDate) || null;
  const imagery = { date: d ? `${d.year}-${String(d.month).padStart(2, '0')}-${String(d.day).padStart(2, '0')}` : null, quality: (tr && tr.imageryQuality) || (state.solar && state.solar.imageryQuality) || null, source: tr ? 'Google Solar API (aerial photo, building mask and 10 cm height model)' : 'Google satellite imagery (traced by hand)' };
  // area, in the order the report states it: confirmed first, then the supported estimate for hidden roof, then what is unresolved
  const ab = t.areaByStatus; let estLo = 0, estHi = 0, ranged = true;
  for (const F of facets) { if (F.f.excluded || F.status !== 'inferred') continue; const full = F.m.sloped; const inf = F.f.inferredSqft > 0 && F.f.inferredSqft < full && !F.f.edited ? F.f.inferredSqft : full; const r = F.f.rangeSqft;
    // the range is stated around the area this report prints for the facet (its outline), never around another figure
    if (r && !F.f.edited) { const dd = Math.min(inf, (r[1] - r[0]) / 2); estLo += inf - dd; estHi += inf + dd; F.range = [full - dd, full + dd]; } else { estLo += inf; estHi += inf; ranged = false; } }
  const area = { confirmed: ab.measured, estimate: ab.inferred, estLo, estHi, ranged, unresolvedTraced: ab.unresolved, zoneUpper: t.hiddenUpperSloped || 0, zoneCount: zones.length, altSqft: facets.reduce((a, F) => a + (F.f.excluded ? 0 : (F.f.altSqft || 0)), 0), obstructionFt: t.obstructionFt || 0 };
  area.fullKnown = !zones.length && ab.unresolved < 0.5;
  // outline located on the softer second image: about 1 ft of uncertainty per foot of eave or rake taken from it
  area.altEdgeFt = lines.filter((L) => L.e.confirmedBy && (L.type === 'eave' || L.type === 'rake') && !L.e.paired).reduce((a, L) => a + L.m.planFt, 0); area.altRange = area.altEdgeFt * 1.0 * 1.05;
  // subtotals by structure: the house and each detached structure are never merged silently
  const structs = t.structures.map((g) => { const b = g.byType, zs = zones.filter((z) => z.group === g.index);
    return { index: g.index, name: g.index === 1 ? 'House' : 'Detached structure ' + (g.index - 1), facets: g.facetCount, confirmed: g.confirmedSloped, estimate: g.inferredSloped, unresolved: g.areaByStatus.unresolved, zones: zs.length, zoneUpper: zs.reduce((a, z) => a + z.upperSqft, 0), eave: b.eave.true, rake: b.rake.true, ridge: b.ridge.true, hip: b.hip.true, valley: b.valley.true, flashing: b.step.true + b.wall.true, obstruction: b.obstruction ? b.obstruction.true : 0, pitch: g.predominant }; });
  const alt = tr && tr.alt && tr.alt.used ? tr.alt : null;
  return { status, t, rv, tr, fr, ft, facets, lines, obLines, zones, area, structs, alt, views: (state.altViews || []).slice(), evidence: (state.evidence || []).slice(), box: [x0, y0, x1, y1], ob, imagery, address: state.address || '', job: state.jobName || '', auto: !!tr, date: new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' }) };
}

// ------------------------------------------------------------------ aerial photo, north up, with a known lat/lng -> pixel mapping
function rpAerialFrom(M, rgb, credit) {
  const padFt = 22; const [x0, y0, x1, y1] = M.box;
  if (!rgb || !rgb.bands) return null;
  const { w, h } = rgb; const o = rgb.toLL(0, 0), ex = rgb.toLL(w, 0), ey = rgb.toLL(0, h);
  const ax = (ex.lng - o.lng) / w, ay = (ex.lat - o.lat) / w, bx = (ey.lng - o.lng) / h, by = (ey.lat - o.lat) / h, det = ax * by - bx * ay;
  const toPx = (v) => { const dl = v.lng - o.lng, da = v.lat - o.lat; return [(dl * by - bx * da) / det, (ax * da - ay * dl) / det]; };
  const pxPerFt = 1 / (Math.abs(rgb.rx) * RM.FT);
  const cs = [[x0 - padFt, y0 - padFt], [x1 + padFt, y1 + padFt], [x0 - padFt, y1 + padFt], [x1 + padFt, y0 - padFt]].map((p) => toPx(M.fr.ll([p[0] / RM.FT, p[1] / RM.FT])));
  const cx0 = Math.max(0, Math.floor(Math.min(...cs.map((p) => p[0])))), cx1 = Math.min(w, Math.ceil(Math.max(...cs.map((p) => p[0])))), cy0 = Math.max(0, Math.floor(Math.min(...cs.map((p) => p[1])))), cy1 = Math.min(h, Math.ceil(Math.max(...cs.map((p) => p[1]))));
  const cw = cx1 - cx0, ch = cy1 - cy0; if (cw <= 20 || ch <= 20) return null;
  const cv = document.createElement('canvas'); cv.width = cw; cv.height = ch; const g = cv.getContext('2d'); const im = g.createImageData(cw, ch);
  for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) { const i = (cy0 + y) * w + cx0 + x, j = (y * cw + x) * 4; im.data[j] = rgb.bands[0][i]; im.data[j + 1] = rgb.bands[1][i]; im.data[j + 2] = rgb.bands[2][i]; im.data[j + 3] = 255; }
  g.putImageData(im, 0, 0);
  // each photo needs its own name in the PDF: jsPDF reuses the first picture stored under a name
  rpAerialFrom.n = (rpAerialFrom.n || 0) + 1;
  return { src: cv.toDataURL('image/jpeg', 0.9), alias: 'aerial' + rpAerialFrom.n, w: cw, h: ch, toPx: (v) => { const p = toPx(v); return [p[0] - cx0, p[1] - cy0]; }, pxPerFt, credit };
}
// the second dated photo, when the reviewer used one: same grid family, so the same roofline can be drawn on it
function rpAerialAlt(M) {
  try { if (!M.alt) return null; const cache = window.__altCache || {}; const key = M.alt.cacheKey && cache[M.alt.cacheKey] ? M.alt.cacheKey : null; const rgb = key && cache[key].rgbT;        // the exact dataset the trace used, never another building's
    return rpAerialFrom(M, rgb, 'Aerial photo: ' + M.alt.label + '. North up.'); } catch (e) { console.warn('alternate aerial unavailable', e); return null; }
}
async function rpAerial(M) {
  const [x0, y0, x1, y1] = M.box; const c = M.fr.ll([((x0 + x1) / 2) / RM.FT, ((y0 + y1) / 2) / RM.FT]);
  // 1. the Solar aerial layer of the same flight as the height model (exactly registered to the trace)
  try {
    const cache = window.__layerCache || {}; const keys = Object.keys(cache).filter((k) => state.solar && k.startsWith(state.solar.name + '|')); const key = keys[keys.length - 1]; const rgb = key && cache[key].rgbT;
    const A = rpAerialFrom(M, rgb, 'Aerial photo: Google Solar API' + (M.imagery.date ? ', flown ' + M.imagery.date : '') + '. North up.'); if (A) return A;
  } catch (e) { console.warn('aerial layer unavailable', e); }
  // 2. Google Static Maps (Web Mercator, north up)
  if (!state.key) return null;
  const z = 20, sc = 2, W = 640, H = 640;
  const url = `https://maps.googleapis.com/maps/api/staticmap?center=${c.lat.toFixed(7)},${c.lng.toFixed(7)}&zoom=${z}&size=${W}x${H}&scale=${sc}&maptype=satellite&key=${encodeURIComponent(state.key)}`;
  const src = typeof imageToDataURL === 'function' ? await imageToDataURL(url, 9000) : null; if (!src) return null;
  const world = 256 * 2 ** z; const mx = (lng) => (lng + 180) / 360 * world, my = (lat) => { const s = Math.sin(lat * Math.PI / 180); return (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * world; };
  const cx = mx(c.lng), cy = my(c.lat);
  return { src, w: W * sc, h: H * sc, toPx: (v) => [(mx(v.lng) - cx + W / 2) * sc, (my(v.lat) - cy + H / 2) * sc], pxPerFt: sc * world / (360 * RM.scale(c.lat).kx * RM.FT), credit: 'Aerial photo: Google Maps satellite. North up.' };
}

// ------------------------------------------------------------------ drawing helpers
function rpDoc() {
  const doc = new window.jspdf.jsPDF({ unit: 'pt', format: 'letter', orientation: 'portrait', compress: true });
  doc.setFont('helvetica', 'normal'); doc.setLineJoin('round'); doc.setLineCap('butt');
  return doc;
}
const rpColor = (doc, kind, c) => (kind === 'fill' ? doc.setFillColor(c[0], c[1], c[2]) : kind === 'draw' ? doc.setDrawColor(c[0], c[1], c[2]) : doc.setTextColor(c[0], c[1], c[2]));
function rpText(doc, s, x, y, o = {}) {
  doc.setFont('helvetica', o.bold ? 'bold' : o.italic ? 'italic' : 'normal'); doc.setFontSize(o.size || 9); rpColor(doc, 'text', o.color || RP.INK);
  if (o.maxWidth) { const ls = doc.splitTextToSize(String(s), o.maxWidth); doc.text(ls, x, y, { align: o.align || 'left', lineHeightFactor: o.lh || 1.25 }); return y + ls.length * (o.size || 9) * (o.lh || 1.25); }
  doc.text(String(s), x, y, { align: o.align || 'left' }); return y + (o.size || 9) * 1.25;
}
// text centred on (x, y), rotated by deg (counter-clockwise), drawn left-aligned from a computed start so every viewer agrees
function rpRotText(doc, s, x, y, deg, size, color, bold) {
  doc.setFont('helvetica', bold ? 'bold' : 'normal'); doc.setFontSize(size); rpColor(doc, 'text', color);
  const w = doc.getTextWidth(s), a = deg * Math.PI / 180, ca = Math.cos(a), sa = Math.sin(a), up = size * 0.34;
  doc.text(s, x - ca * w / 2 + sa * up, y + sa * w / 2 + ca * up, { angle: deg });
  return w;
}
function rpPoly(doc, pts, style) { if (pts.length < 2) return; const d = []; for (let i = 1; i < pts.length; i++) d.push([pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]]); doc.lines(d, pts[0][0], pts[0][1], [1, 1], style, true); }   // a polygon: always closed (open lines use rpPolyline)
function rpPolyline(doc, pts) { const d = []; for (let i = 1; i < pts.length; i++) d.push([pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]]); doc.lines(d, pts[0][0], pts[0][1], [1, 1], 'S', false); }
function rpLineStyle(doc, type, status, k = 1) {
  const s = RP.LINE[type] || RP.LINE.unspecified;
  if (status === 'unresolved') { rpColor(doc, 'draw', [220, 40, 30]); doc.setLineWidth(1.8 * k); doc.setLineDashPattern([1.2, 2.2], 0); return; }
  rpColor(doc, 'draw', s.c); doc.setLineWidth(s.w * k);
  doc.setLineDashPattern(status === 'inferred' ? [7, 3] : (s.dash || []), 0);
}
function rpFrame(doc, M, title, n, total) {
  // navy band, gold rule, Diversity Contracting logo; footer with the company line and page number
  const bh = RP.BAND; rpColor(doc, 'fill', RP.NAVY); doc.rect(0, 0, RP.W, bh, 'F'); rpColor(doc, 'fill', RP.GOLD); doc.rect(0, bh, RP.W, 3, 'F');
  const lw = rpLogo(doc, RP.M, 7, bh - 14, [255, 255, 255], true); const tx = RP.M + lw + 16;
  rpText(doc, title, tx, 30, { size: 15, bold: true, color: [255, 255, 255] });
  rpText(doc, M.address, tx, 45, { size: 8.5, color: [214, 224, 236] });
  rpText(doc, 'ROOF MEASUREMENT REPORT', RP.W - RP.M, 24, { size: 8, bold: true, color: RP.GOLD, align: 'right' });
  rpText(doc, M.date, RP.W - RP.M, 38, { size: 8, color: [214, 224, 236], align: 'right' });
  rpColor(doc, 'draw', RP.RULE); doc.setLineWidth(0.6); doc.setLineDashPattern([], 0); doc.line(RP.M, RP.H - 34, RP.W - RP.M, RP.H - 34);
  const c = typeof company !== 'undefined' ? company : { name: 'Diversity Roofing' };
  rpText(doc, [c.name, c.phone, c.website, c.license ? 'Lic. ' + c.license : ''].filter(Boolean).join('  |  '), RP.M, RP.H - 22, { size: 7.5, color: RP.MUTE });
  rpText(doc, `Page ${n} of ${total}`, RP.W - RP.M, RP.H - 22, { size: 7.5, color: RP.MUTE, align: 'right' });
}
function rpSection(doc, s, x, y, w) { rpText(doc, s.toUpperCase(), x, y, { size: 8, bold: true, color: RP.NAVY }); rpColor(doc, 'draw', RP.GOLD); doc.setLineWidth(1); doc.setLineDashPattern([], 0); doc.line(x, y + 4, x + w, y + 4); return y + 16; }
// simple table: cols [{t, w, a:'l'|'r'|'c'}], rows [[..]|{cells, fill, bold}]; returns y after the table; calls onBreak() for a new page
function rpTable(doc, x, y, cols, rows, o = {}) {
  const size = o.size || 7.5, rh = o.rh || 13, bottom = o.bottom || RP.H - 46; const W = cols.reduce((s, c) => s + c.w, 0);
  const head = () => { rpColor(doc, 'fill', RP.NAVY); doc.rect(x, y, W, rh + 1, 'F'); let cx = x; for (const c of cols) { rpText(doc, c.t, c.a === 'r' ? cx + c.w - 4 : c.a === 'c' ? cx + c.w / 2 : cx + 4, y + rh - 3.5, { size: size - 0.3, bold: true, color: [255, 255, 255], align: c.a === 'r' ? 'right' : c.a === 'c' ? 'center' : 'left' }); cx += c.w; } y += rh + 1; };
  head();
  rows.forEach((r, i) => {
    const cells = Array.isArray(r) ? r : r.cells; const opt = Array.isArray(r) ? {} : r;
    // wrap the widest text cell if needed
    let lines = 1; const wrapped = cells.map((v, k) => { const s = String(v == null ? '' : v); doc.setFont('helvetica', opt.bold ? 'bold' : 'normal'); doc.setFontSize(size); if (cols[k].wrap && doc.getTextWidth(s) > cols[k].w - 8) { const ls = doc.splitTextToSize(s, cols[k].w - 8); lines = Math.max(lines, ls.length); return ls; } return [s]; });
    const hgt = rh + (lines - 1) * (size + 1.5);
    if (y + hgt > bottom && o.onBreak) { y = o.onBreak(); head(); }
    if (opt.fill) { rpColor(doc, 'fill', opt.fill); doc.rect(x, y, W, hgt, 'F'); } else if (i % 2 === 1) { rpColor(doc, 'fill', RP.PALE); doc.rect(x, y, W, hgt, 'F'); }
    let cx = x; wrapped.forEach((ls, k) => { const c = cols[k]; ls.forEach((s, li) => rpText(doc, s, c.a === 'r' ? cx + c.w - 4 : c.a === 'c' ? cx + c.w / 2 : cx + 4, y + rh - 3.5 + li * (size + 1.5), { size, bold: opt.bold, color: opt.color || RP.INK, align: c.a === 'r' ? 'right' : c.a === 'c' ? 'center' : 'left' })); cx += c.w; });
    y += hgt;
  });
  rpColor(doc, 'draw', RP.RULE); doc.setLineWidth(0.5); doc.setLineDashPattern([], 0); doc.line(x, y, x + W, y);
  return y;
}
const rpInside = (p, r) => { let c = false; for (let i = 0, j = r.length - 1; i < r.length; j = i++) if ((r[i][1] > p[1]) !== (r[j][1] > p[1]) && p[0] < (r[j][0] - r[i][0]) * (p[1] - r[i][1]) / (r[j][1] - r[i][1]) + r[i][0]) c = !c; return c; };
// a point well inside the polygon for its label: the centroid when it is inside, else the middle of the widest horizontal chord
function rpLabelPoint(r) {
  let a = 0, cx = 0, cy = 0; for (let i = 0; i < r.length; i++) { const p = r[i], q = r[(i + 1) % r.length]; const k = p[0] * q[1] - q[0] * p[1]; a += k; cx += (p[0] + q[0]) * k; cy += (p[1] + q[1]) * k; }
  const c = Math.abs(a) > 1e-9 ? [cx / (3 * a), cy / (3 * a)] : r[0];
  let best = null, bw = -1; const ys = r.map((p) => p[1]), lo = Math.min(...ys), hi = Math.max(...ys);
  for (const t of [0.5, 0.35, 0.65, 0.2, 0.8]) { const y = lo + (hi - lo) * t; const xs = []; for (let i = 0; i < r.length; i++) { const p = r[i], q = r[(i + 1) % r.length]; if ((p[1] > y) !== (q[1] > y)) xs.push(p[0] + (y - p[1]) * (q[0] - p[0]) / (q[1] - p[1])); } xs.sort((p, q) => p - q); for (let i = 0; i + 1 < xs.length; i += 2) if (xs[i + 1] - xs[i] > bw) { bw = xs[i + 1] - xs[i]; best = [(xs[i] + xs[i + 1]) / 2, y]; } }
  if (rpInside(c, r)) { // prefer the centroid unless the chord point is in a much roomier spot
    return { p: c, room: Math.max(bw, 0) }; }
  return { p: best || c, room: Math.max(bw, 0) };
}

function rpClip(doc, x, y, w, h) { doc.saveGraphicsState(); doc.rect(x, y, w, h, null); doc.clip(); doc.discardPath(); }
function rpUnclip(doc) { doc.restoreGraphicsState(); }
// ------------------------------------------------------------------ the plan: one mapping from feet to the page, shared by every diagram on that page
function rpView(M, box, o = {}) {
  const [x0, y0, x1, y1] = o.ftBox || M.box; const pad = o.padFt == null ? 4 : o.padFt; const wFt = x1 - x0 + 2 * pad, hFt = y1 - y0 + 2 * pad;
  // engineering scale: the largest "1 inch = N feet" that fits the box (so the drawing can be scaled with a ruler)
  const nice = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 28, 30, 32, 35, 40, 45, 50, 60, 80, 100, 120, 150, 200];
  const need = Math.max(wFt / (box.w / 72), hFt / (box.h / 72)); const perIn = nice.find((n) => n >= need) || Math.ceil(need / 50) * 50;
  const k = 72 / perIn; const ox = box.x + (box.w - (x1 - x0) * k) / 2, oy = box.y + (box.h - (y1 - y0) * k) / 2;
  return { k, perIn, P: (p) => [ox + (p[0] - x0) * k, oy + (y1 - p[1]) * k], box, ftBox: o.ftBox || null };
}
function rpNorthScale(doc, V, x, y) {
  // north arrow
  rpColor(doc, 'fill', RP.NAVY); rpColor(doc, 'draw', RP.NAVY); doc.setLineWidth(0.8); doc.setLineDashPattern([], 0);
  doc.triangle(x, y - 16, x - 5, y, x, y - 4, 'F'); doc.triangle(x, y - 16, x + 5, y, x, y - 4, 'S');
  rpText(doc, 'N', x, y - 19, { size: 8, bold: true, color: RP.NAVY, align: 'center' });
  // scale bar: a round number of feet about 1.2 in long
  const target = 1.2 * V.perIn; const steps = [5, 10, 20, 25, 30, 40, 50, 60, 80, 100, 150, 200]; const ft = steps.reduce((b, s) => (Math.abs(s - target) < Math.abs(b - target) ? s : b), steps[0]); const len = ft * V.k;
  const bx = x + 22, by = y - 4; doc.setLineWidth(0.7); doc.rect(bx, by - 4, len, 4, 'S'); doc.rect(bx, by - 4, len / 2, 4, 'F');
  rpText(doc, '0', bx, by + 8, { size: 6.5, color: RP.MUTE, align: 'center' }); rpText(doc, String(ft / 2), bx + len / 2, by + 8, { size: 6.5, color: RP.MUTE, align: 'center' }); rpText(doc, ft + ' ft', bx + len, by + 8, { size: 6.5, color: RP.MUTE, align: 'center' });
  rpText(doc, `Scale 1 in = ${V.perIn} ft (printed at 100% on US Letter)`, bx, by - 8, { size: 6.5, color: RP.MUTE });
}
function rpLegend(doc, M, x, y, w, withStatus) {
  const used = Object.keys(RP.LINE).filter((k) => M.t.byType[k] && M.t.byType[k].count); let cx = x, cy = y; const colW = 96;
  for (const k of used) { if (cx + colW > x + w + 1) { cx = x; cy += 11; } rpLineStyle(doc, k, 'measured'); doc.line(cx, cy - 2.5, cx + 20, cy - 2.5); rpText(doc, EDGE_TYPES[k].plural, cx + 24, cy, { size: 7, color: RP.INK }); cx += colW; }
  if (withStatus) { cy += 11; cx = x;
    doc.setLineDashPattern([7, 3], 0); rpColor(doc, 'draw', RP.MUTE); doc.setLineWidth(1.4); doc.line(cx, cy - 2.5, cx + 20, cy - 2.5); rpText(doc, 'Dashed = inferred (hidden; placed from stated evidence)', cx + 24, cy, { size: 7 }); if (w < 440) { cy += 11; } else cx += 232;
    rpLineStyle(doc, 'eave', 'unresolved'); doc.line(cx, cy - 2.5, cx + 20, cy - 2.5); rpText(doc, 'Dotted red = marked unresolved', cx + 24, cy, { size: 7 });
    if (M.zones.length || M.obLines.length) { cy += 11; cx = x; doc.setLineDashPattern([], 0); rpColor(doc, 'draw', RP.HATCH); doc.setLineWidth(0.55); for (let k = 0; k < 5; k++) doc.line(cx + k * 4, cy, cx + k * 4 + 5, cy - 6);
      rpText(doc, 'Hatched = hidden zone under tree canopy: not in any total. Gap in the outline = visible roof stops at the canopy (not a roof edge).', cx + 28, cy, { size: 7, maxWidth: w - 28 }); if (w < 440) cy += 9; } }
  doc.setLineDashPattern([], 0); return cy + 6;
}
// draw the roof on a page. mode: 'plan' | 'lengths' | 'areas' | 'pitch' | 'trees'
function rpDrawRoof(doc, M, V, mode) {
  const P = V.P; doc.setLineDashPattern([], 0);
  const inWin = (p) => !V.ftBox || (p[0] >= V.box.x + 6 && p[0] <= V.box.x + V.box.w - 6 && p[1] >= V.box.y + 6 && p[1] <= V.box.y + V.box.h - 6);
  if (V.ftBox) rpClip(doc, V.box.x, V.box.y, V.box.w, V.box.h);
  const rank = {}; M.t.pitches.forEach((p, i) => { rank[p] = i; }); const shades = [[236, 242, 250], [218, 229, 244], [198, 214, 236], [178, 198, 228], [158, 182, 220], [138, 166, 210]];
  // facets
  for (const F of M.facets) {
    const pts = F.xy.map(P);
    if (F.f.excluded) { rpColor(doc, 'fill', [255, 255, 255]); rpColor(doc, 'draw', RP.MUTE); doc.setLineWidth(0.6); doc.setLineDashPattern([2, 2], 0); rpPoly(doc, pts, 'FD'); doc.setLineDashPattern([], 0); continue; }
    const fill = mode === 'pitch' ? shades[(rank[F.f.pitch] || 0) % shades.length] : mode === 'lengths' ? [250, 251, 253] : RP.STATUS_FILL[F.status];
    rpColor(doc, 'fill', fill); rpPoly(doc, pts, 'F'); rpColor(doc, 'draw', [150, 165, 185]); doc.setLineWidth(0.5); doc.setLineDashPattern([], 0); rpRingGap(doc, F.xy, M.obLines, P);
  }
  rpDrawZones(doc, M, P, { spacingFt: Math.max(1.6, 4.2 / V.k) });
  // lines: on every page the same colours and dash patterns; thinner where the page is about areas or pitches
  const k = mode === 'lengths' || mode === 'plan' ? 1 : 0.6;
  // a height break is two lines on one plan line: offset the lower (flashing) one a hair so both stay visible
  for (const L of M.lines) { rpLineStyle(doc, L.type, L.status, k); let pts = L.xy.map(P);
    if (L.e.paired === 'lower' && pts.length >= 2) { const dx = pts[pts.length - 1][0] - pts[0][0], dy = pts[pts.length - 1][1] - pts[0][1], l = Math.hypot(dx, dy) || 1; pts = pts.map((p) => [p[0] - dy / l * 1.8, p[1] + dx / l * 1.8]); }
    rpPolyline(doc, pts); }
  doc.setLineDashPattern([], 0);
  const placed = []; const free = (x, y, r) => !placed.some((q) => Math.hypot(q[0] - x, q[1] - y) < q[2] + r);
  if (mode === 'lengths') {
    // long lines carry "n  24' 7"" along the line; short or crowded ones carry only their key number in a circle (the
    // line schedule lists every key with its length), so no measurement is dropped to avoid crowding
    const order = M.lines.slice().sort((a, b) => b.m.planFt - a.m.planFt);
    for (const L of order) {
      let bi = 1, bl = -1; for (let i = 1; i < L.xy.length; i++) { const d = Math.hypot(L.xy[i][0] - L.xy[i - 1][0], L.xy[i][1] - L.xy[i - 1][1]); if (d > bl) { bl = d; bi = i; } }
      const a = P(L.xy[bi - 1]), b = P(L.xy[bi]); const len = Math.hypot(b[0] - a[0], b[1] - a[1]); const mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2;
      if (!inWin([mx, my])) continue;
      let ang = Math.atan2(-(b[1] - a[1]), b[0] - a[0]) * 180 / Math.PI; if (ang > 90) ang -= 180; if (ang <= -90) ang += 180;
      let nx = -(b[1] - a[1]) / (len || 1), ny = (b[0] - a[0]) / (len || 1);
      const txt = `${L.n}  ${rpFtIn(L.m.trueFt)}`; doc.setFont('helvetica', 'normal'); doc.setFontSize(6.3); const tw = doc.getTextWidth(txt);
      let done = false;
      if (len >= tw + 8) for (const sgn of [1, -1]) { const x = mx + nx * 5.2 * sgn, y = my + ny * 5.2 * sgn; if (free(x, y, tw / 2)) { const col = L.status === 'unresolved' ? [200, 30, 20] : RP.INK; rpRotText(doc, txt, x, y, ang, 6.3, col, false); for (let s = -1; s <= 1; s++) placed.push([x + (b[0] - a[0]) / len * s * tw / 3, y + (b[1] - a[1]) / len * s * tw / 3, tw / 5 + 2.5]); done = true; break; } }
      if (!done) { const tries = [[1, 0], [-1, 0], [1, 0.3], [-1, 0.3], [1, -0.3], [-1, -0.3], [1.9, 0], [-1.9, 0], [2.8, 0], [-2.8, 0], [3.8, 0.2], [-3.8, -0.2]]; const r = L.n > 99 ? 4.9 : 4.1;
        for (const [sgn, sh] of tries) { const x = mx + nx * 6.4 * sgn + (b[0] - a[0]) * sh, y = my + ny * 7 * sgn + (b[1] - a[1]) * sh; if (!free(x, y, r)) continue;
          rpColor(doc, 'draw', (RP.LINE[L.type] || RP.LINE.unspecified).c); doc.setLineWidth(0.5); if (Math.abs(sgn) > 1.5 || sh) doc.line(mx, my, x, y);
          rpColor(doc, 'fill', [255, 255, 255]); doc.setLineWidth(0.7); doc.circle(x, y, r, 'FD'); rpText(doc, String(L.n), x, y + 1.8, { size: L.n > 99 ? 4.4 : 5.2, bold: true, align: 'center' }); placed.push([x, y, r + 0.5]); done = true; break; } }
      L.shown = done;
    }
  } else {
    for (const F of M.facets) {
      if (F.f.excluded) continue; const lp = rpLabelPoint(F.xy); const c = P(lp.p); const room = lp.room * V.k; if (!inWin(c)) continue;
      const idSize = room > 26 ? 7.5 : 6;
      if (mode === 'plan' || mode === 'trees') { rpText(doc, F.id, c[0], c[1] + 2.5, { size: idSize, bold: true, color: RP.NAVY, align: 'center' }); continue; }
      const val = mode === 'areas' ? rpNum(F.m.sloped) : (F.f.pitch === 0 ? 'Flat' : F.f.pitch + '/12');
      doc.setFont('helvetica', 'normal'); doc.setFontSize(6.6); const vw = doc.getTextWidth(val + (mode === 'areas' ? ' sf' : ''));
      if (room > vw + 6) { rpText(doc, F.id, c[0], c[1] - 1, { size: 6.4, bold: true, color: RP.NAVY, align: 'center' }); rpText(doc, val + (mode === 'areas' ? ' sf' : ''), c[0], c[1] + 6.5, { size: 6.6, color: F.status === 'unresolved' ? [200, 30, 20] : RP.INK, align: 'center' }); }
      else rpText(doc, F.id, c[0], c[1] + 2.5, { size: 6, bold: true, color: RP.NAVY, align: 'center' });   // value is in the facet schedule
      if (mode === 'pitch' && F.f.pitch > 0 && F.f.azimuth != null && room > 30) { const a = F.f.azimuth * Math.PI / 180, dx = Math.sin(a), dy = -Math.cos(a); const x1 = c[0] + dx * 11, y1 = c[1] + 3 + dy * 11, x2 = c[0] + dx * 21, y2 = c[1] + 3 + dy * 21; rpColor(doc, 'draw', RP.NAVY); rpColor(doc, 'fill', RP.NAVY); doc.setLineWidth(0.8); doc.line(x1, y1, x2, y2); const an = Math.atan2(dy, dx); doc.triangle(x2 + Math.cos(an) * 3, y2 + Math.sin(an) * 3, x2 + Math.cos(an + 2.5) * 3.5, y2 + Math.sin(an + 2.5) * 3.5, x2 + Math.cos(an - 2.5) * 3.5, y2 + Math.sin(an - 2.5) * 3.5, 'F'); }
    }
  }
  rpZoneLabels(doc, M, P, mode === 'lengths' ? 'id' : 'range', inWin);
  if (V.ftBox) rpUnclip(doc);
  return mode === 'lengths' ? M.lines.filter((L) => L.shown === false).map((L) => L.n) : [];
}
// facet outline with a real gap wherever it runs along an obstruction boundary (ring and lines in feet; P maps to the page)
function rpRingGap(doc, ring, obLines, P) {
  const onOb = (p) => obLines.some((L) => { for (let i = 1; i < L.xy.length; i++) if (RM.pointSeg(p, L.xy[i - 1], L.xy[i]) < 0.9) return true; return false; });
  let run = []; const flush = () => { if (run.length > 1) rpPolyline(doc, run.map(P)); run = []; };
  for (let i = 0; i < ring.length; i++) { const a = ring[i], b = ring[(i + 1) % ring.length];
    if (obLines.length && onOb(a) && onOb(b) && onOb([(a[0] + b[0]) / 2, (a[1] + b[1]) / 2])) { flush(); continue; }
    if (!run.length) run.push(a); run.push(b); }
  flush();
}
function rpDrawZones(doc, M, P, o = {}) {
  if (!M.zones.length) return; rpColor(doc, 'draw', o.color || RP.HATCH); doc.setLineWidth(o.w || 0.55); doc.setLineDashPattern([], 0);
  for (const Z of M.zones) for (const s of RM.hatch(Z.xy, o.spacingFt || 2.2, 45)) { const a = P(s[0]), b = P(s[1]); doc.line(a[0], a[1], b[0], b[1]); }
}
function rpZoneLabels(doc, M, P, kind, inWin) {
  for (const Z of M.zones) { const c = P(rpLabelPoint(Z.xy).p); if (inWin && !inWin(c)) continue; const txt = kind === 'id' ? Z.id : `${Z.id}: 0-${rpNum(Z.upperSqft)} sf?`;
    doc.setFont('helvetica', 'bold'); doc.setFontSize(6.2); const tw = doc.getTextWidth(txt); rpColor(doc, 'fill', [255, 255, 255]); rpColor(doc, 'draw', RP.HATCH); doc.setLineWidth(0.6); doc.setLineDashPattern([], 0); doc.roundedRect(c[0] - tw / 2 - 3, c[1] - 5.2, tw + 6, 9, 2, 2, 'FD'); rpText(doc, txt, c[0], c[1] + 1.4, { size: 6.2, bold: true, color: RP.WARN, align: 'center' }); }
}
function rpDrawObstruction(doc, M, mapPt, withLabels) {
  if (!M.ob) return;
  const G = doc.GState ? (o) => doc.setGState(new doc.GState(o)) : () => {};
  M.ob.structures.forEach((s, i) => { const pts = (s.px || s.xy).map(mapPt); G({ opacity: 0.35 }); rpColor(doc, 'fill', [150, 160, 175]); rpPoly(doc, pts, 'F'); G({ opacity: 1 }); rpColor(doc, 'draw', [90, 100, 115]); doc.setLineWidth(0.8); doc.setLineDashPattern([3, 2], 0); rpPoly(doc, pts, 'S'); doc.setLineDashPattern([], 0);
    if (withLabels) { const c = rpLabelPoint(pts).p; rpText(doc, 'S' + (i + 1), c[0], c[1] + 2, { size: 7, bold: true, color: [60, 70, 85], align: 'center' }); } });
  M.ob.trees.forEach((t, i) => { const pts = (t.px || t.xy).map(mapPt); const over = t.kind === 'overlap'; G({ opacity: over ? 0.42 : 0.22 }); rpColor(doc, 'fill', over ? [235, 120, 20] : [40, 160, 80]); rpPoly(doc, pts, 'F'); G({ opacity: 1 }); rpColor(doc, 'draw', over ? [200, 90, 0] : [25, 120, 55]); doc.setLineWidth(0.9); rpPoly(doc, pts, 'S');
    if (withLabels) { const c = rpLabelPoint(pts).p; rpText(doc, 'T' + (i + 1), c[0], c[1] + 2, { size: 7, bold: true, color: over ? [140, 60, 0] : [15, 90, 40], align: 'center' }); } });
}
// aerial photo in a box with the roofline (and optionally the obstruction layer) drawn on top in vector
function rpDrawAerial(doc, M, A, box, o = {}) {
  if (!A) { rpColor(doc, 'fill', RP.PALE); doc.rect(box.x, box.y, box.w, box.h, 'F'); rpText(doc, 'Aerial photo unavailable', box.x + box.w / 2, box.y + box.h / 2, { size: 9, color: RP.MUTE, align: 'center' }); return null; }
  const k = Math.min(box.w / A.w, box.h / A.h); const w = A.w * k, h = A.h * k, x = box.x + (box.w - w) / 2, y = box.y + (box.h - h) / 2;
  doc.addImage(A.src, 'JPEG', x, y, w, h, A.alias || 'aerial', 'FAST');
  const mp = (v) => { const p = A.toPx(v); return [x + p[0] * k, y + p[1] * k]; }; const fromFt = (p) => mp(M.fr.ll([p[0] / RM.FT, p[1] / RM.FT]));
  rpClip(doc, x, y, w, h);
  if (o.obstruction) rpDrawObstruction(doc, M, fromFt, o.labels);
  for (const F of M.facets) { if (F.f.excluded) continue; rpColor(doc, 'draw', [255, 255, 255]); doc.setLineWidth(0.5); doc.setLineDashPattern([], 0); rpRingGap(doc, F.xy, M.obLines, fromFt); }
  rpDrawZones(doc, M, fromFt, { spacingFt: Math.max(1.6, 4.2 / (A.pxPerFt * k)), color: [255, 70, 50], w: 0.7 });
  for (const L of M.lines) { rpLineStyle(doc, L.type, L.status, o.thin ? 0.75 : 1.05); rpPolyline(doc, L.m.path.map(mp)); }
  doc.setLineDashPattern([], 0); rpUnclip(doc);
  if (o.ids) for (const F of M.facets) { if (F.f.excluded) continue; const c = fromFt(rpLabelPoint(F.xy).p); doc.setFont('helvetica', 'bold'); doc.setFontSize(6.2); const tw = doc.getTextWidth(F.id); rpColor(doc, 'fill', RP.NAVY); doc.roundedRect(c[0] - tw / 2 - 2, c[1] - 4.2, tw + 4, 8, 1.5, 1.5, 'F'); rpText(doc, F.id, c[0], c[1] + 2.1, { size: 6.2, bold: true, color: [255, 255, 255], align: 'center' }); }
  if (o.ids || o.zones) rpZoneLabels(doc, M, fromFt, o.ids ? 'range' : 'id');
  if (o.caption) { doc.setFont('helvetica', 'bold'); doc.setFontSize(7); const cw2 = doc.getTextWidth(o.caption); rpColor(doc, 'fill', RP.NAVY); doc.rect(x, y, cw2 + 10, 12, 'F'); rpText(doc, o.caption, x + 5, y + 8.6, { size: 7, bold: true, color: [255, 255, 255] }); }
  rpColor(doc, 'draw', RP.NAVY); doc.setLineWidth(0.8); doc.setLineDashPattern([], 0); doc.rect(x, y, w, h, 'S');
  // north arrow + scale bar on the photo
  const ftLen = [10, 20, 25, 40, 50, 100].reduce((b, s) => (Math.abs(s * A.pxPerFt * k - 70) < Math.abs(b * A.pxPerFt * k - 70) ? s : b), 10); const bl = ftLen * A.pxPerFt * k;
  rpColor(doc, 'fill', [255, 255, 255]); doc.roundedRect(x + 6, y + h - 22, bl + 46, 16, 2, 2, 'F'); rpColor(doc, 'fill', RP.NAVY); doc.rect(x + 12, y + h - 13, bl, 2.5, 'F'); rpText(doc, ftLen + ' ft', x + 16 + bl, y + h - 10, { size: 6.5, color: RP.NAVY });
  rpColor(doc, 'fill', [255, 255, 255]); doc.circle(x + w - 16, y + 18, 11, 'F'); rpColor(doc, 'fill', RP.NAVY); doc.triangle(x + w - 16, y + 9, x + w - 20, y + 21, x + w - 12, y + 21, 'F'); rpText(doc, 'N', x + w - 16, y + 27.5, { size: 6, bold: true, color: RP.NAVY, align: 'center' });
  return { x, y, w, h };
}

// ------------------------------------------------------------------ Diversity Contracting logo, drawn as vectors
// Geometry follows the supplied artwork (1568 x 783 units): house mark, boxed wordmark, tagline.
// full = false draws the house mark only. (x, y) = top-left, h = height in points. Returns the width used.
function rpLogo(doc, x, y, h, color, full) {
  const U = full ? 783 : 317, k = h / U, oy = full ? 0 : -38, ox = full ? 0 : -583;
  const X = (v) => x + (v + ox) * k, Y = (v) => y + (v + oy) * k;
  rpColor(doc, 'fill', color); rpColor(doc, 'draw', color); doc.setLineDashPattern([], 0);
  const house = [[783, 38], [984, 218], [984, 355], [890, 355], [890, 260], [783, 163], [730, 211], [730, 197], [709, 197], [709, 230], [676, 260], [676, 355], [583, 355], [583, 218]];
  rpPoly(doc, house.map((p) => [X(p[0]), Y(p[1])]), 'F');
  for (const [wx, wy] of [[760, 221], [786, 221], [760, 248], [786, 248]]) doc.rect(X(wx), Y(wy), 21 * k, 21 * k, 'F');
  if (!full) return 401 * k;
  doc.setLineWidth(15 * k); doc.rect(X(46), Y(439), 1475 * k, 172 * k, 'S');
  // wordmark: heavy caps, fitted to the box width
  doc.setFont('helvetica', 'bold'); let fs = 100 * k; doc.setFontSize(fs); const word = 'DIVERSITY CONTRACTING'; const target = 1280 * k;
  const cs = Math.max(0, (target - doc.getTextWidth(word)) / (word.length - 1)); rpColor(doc, 'text', color);
  doc.text(word, X(104), Y(561), { charSpace: cs });
  doc.setFontSize(36 * k); const tag = 'PROTECTING HOMES. RESPECTING PEOPLE'; const tsp = Math.max(0, (1090 * k - doc.getTextWidth(tag)) / (tag.length - 1));
  doc.text(tag, X(240), Y(724), { charSpace: tsp });
  return 1568 * k;
}

// ------------------------------------------------------------------ pages
function rpKpi(doc, x, y, w, h, value, label, warn, accent) { rpColor(doc, 'fill', RP.PALE); doc.roundedRect(x, y, w, h, 3, 3, 'F'); rpColor(doc, 'fill', warn ? [220, 40, 30] : (accent || RP.GOLD)); doc.rect(x, y, 3, h, 'F'); rpText(doc, value, x + 11, y + h / 2 + 2, { size: h < 40 ? 13 : 15, bold: true, color: warn ? [190, 30, 20] : (accent || RP.NAVY) }); rpText(doc, label, x + 11, y + h - 7, { size: 7, color: RP.MUTE }); }
const rpSrc = (c) => (!c ? '' : typeof c === 'string' ? c : [c.source, c.date].filter(Boolean).join(', '));
function rpStructTable(doc, M, x, y, W, o = {}) {
  const S = M.structs; const tot = (k) => S.reduce((a, q) => a + q[k], 0); const n1 = (v) => rpNum(v, 1);
  const row = (q, bold) => ({ cells: [q.name, q.facets, rpNum(q.confirmed), q.estimate > 0.5 ? '+ ' + rpNum(q.estimate) : '-', q.zones ? '0-' + rpNum(q.zoneUpper) : '-', n1(q.eave), n1(q.rake), n1(q.ridge), n1(q.hip), n1(q.valley), n1(q.flashing)], bold });
  const rows = S.map((q) => row(q, false)); if (S.length > 1) rows.push(row({ name: 'All structures', facets: tot('facets'), confirmed: tot('confirmed'), estimate: tot('estimate'), zones: tot('zones'), zoneUpper: tot('zoneUpper'), eave: tot('eave'), rake: tot('rake'), ridge: tot('ridge'), hip: tot('hip'), valley: tot('valley'), flashing: tot('flashing') }, true));
  const cw = (W - 118 - 36) / 9;
  return rpTable(doc, x, y, [{ t: 'Structure', w: 118 }, { t: 'Facets', w: 36, a: 'r' }, { t: 'Confirmed sf', w: cw, a: 'r' }, { t: 'Estimate sf', w: cw, a: 'r' }, { t: 'Hidden sf', w: cw, a: 'r' }, { t: 'Eaves ft', w: cw, a: 'r' }, { t: 'Rakes ft', w: cw, a: 'r' }, { t: 'Ridges ft', w: cw, a: 'r' }, { t: 'Hips ft', w: cw, a: 'r' }, { t: 'Valleys ft', w: cw, a: 'r' }, { t: 'Flashing ft', w: cw, a: 'r' }], rows, { size: o.size || 7.2 });
}
function rpPageSummary(doc, M, A) {
  const t = M.t, R = M.area, x = RP.M, W = RP.W - 2 * RP.M; let y = 80;
  // the report's status first: COMPLETE, or REVIEW REQUIRED with what is missing (details further down this page)
  if (M.status) { const ok = M.status.status === 'COMPLETE', col = ok ? [40, 120, 70] : [190, 30, 20];
    const first = M.status.reasons.slice(0, 2).map((q) => q.text).join(' ') + (M.status.reasons.length > 2 ? ` (+${M.status.reasons.length - 2} more below)` : '');
    rpColor(doc, 'fill', ok ? [228, 243, 233] : [252, 228, 224]); doc.rect(x, y - 6, W, 24, 'F'); rpColor(doc, 'fill', col); doc.rect(x, y - 6, 4, 24, 'F');
    rpText(doc, M.status.status, x + 10, y + 4, { size: 10.5, bold: true, color: col });
    rpText(doc, ok ? 'Every reported value was measured on georeferenced imagery; nothing that affects the totals is open.' : first, x + 120, y + 1.5, { size: 7, color: RP.INK, maxWidth: W - 126 });
    y += 26; }
  // left: aerial with the roofline. right: the area, confirmed first
  const ph = { x, y, w: 322, h: 262 }; rpDrawAerial(doc, M, A, ph, { thin: true, zones: true });
  rpText(doc, A ? A.credit : '', x, y + ph.h + 10, { size: 6.5, color: RP.MUTE });
  const rx = x + 336, rw = W - 336, half = (rw - 6) / 2; let ky = y;
  const kh = (R.estimate > 0.5 ? 1 : 0) + (R.fullKnown ? 0 : 1) === 2 ? 38 : 44, k2 = 36;
  rpKpi(doc, rx, ky, rw, kh, rpNum(R.confirmed) + ' sq ft', 'Confirmed roof area (sloped, measured, no waste)'); ky += kh + 5;
  if (R.estimate > 0.5) { rpKpi(doc, rx, ky, rw, kh, '+ ' + rpNum(R.estimate) + ' sq ft', 'Estimate for hidden roof' + (R.ranged ? `, range ${rpNum(R.estLo)}-${rpNum(R.estHi)}` : ' (no range available)'), false, RP.EST); ky += kh + 5; }
  if (!R.fullKnown) { rpKpi(doc, rx, ky, rw, kh, 'Unresolved', R.zoneCount ? `Full roof area: ${R.zoneCount} hidden zone${R.zoneCount > 1 ? 's' : ''}, 0-${rpNum(R.zoneUpper)} sq ft` : `Full roof area: ${rpNum(R.unresolvedTraced)} sq ft not confirmed`, true); ky += kh + 5; }
  rpKpi(doc, rx, ky, half, k2, t.predominant == null ? '-' : t.predominant === 0 ? 'Flat' : t.predominant + '/12', 'Predominant pitch');
  rpKpi(doc, rx + half + 6, ky, half, k2, String(t.facetCount), 'Roof facets'); ky += k2 + 5;
  rpKpi(doc, rx, ky, half, k2, rpNum(t.sloped / 100, 2), R.estimate > 0.5 ? 'Squares (confirmed + est.)' : 'Squares (net)');
  rpKpi(doc, rx + half + 6, ky, half, k2, rpNum(t.plan), 'Plan area, sq ft'); ky += k2 + 5;
  let yy = ky + 8; yy = rpSection(doc, 'Property & imagery', rx, yy, rw);
  const kv = (k, v) => { rpText(doc, k, rx, yy, { size: 7.5, color: RP.MUTE }); yy = rpText(doc, v, rx + 62, yy, { size: 7.5, maxWidth: rw - 62 }); yy += 1; };
  kv('Property', M.address || '-'); if (M.job) kv('Job', M.job);
  const ageY = M.imagery.date ? (Date.now() - new Date(M.imagery.date + 'T00:00:00').getTime()) / 3.15576e10 : null;
  kv('Image date', M.imagery.date ? M.imagery.date + (ageY > 3 ? ` (${rpNum(ageY, 1)} years old: later changes to the roof are not shown)` : '') : 'not reported by the source'); kv('Image source', M.imagery.source + (M.imagery.quality ? ' - ' + String(M.imagery.quality).toLowerCase() + ' quality' : ''));
  if (M.alt) kv('Also used', `${M.alt.label}: ${rpNum(R.altSqft)} sq ft that the first image has under tree canopy` + (M.alt.soft ? ' (softer image: reported as an estimate)' : ''));
  kv('Structures', M.structs.map((q) => q.name).join(', '));
  kv('Method', M.auto ? 'Automatic trace of the height model' + (M.facets.some((F) => F.f.edited) ? ', edited by hand' : '') + (M.views.length ? '; other views checked (see Other views & evidence)' : '') : 'Hand trace on the satellite photo');
  y = Math.max(y + ph.h + 24, yy + 6);
  // what the area is based on
  y = rpSection(doc, 'What the area is based on', x, y, W);
  const gross = R.confirmed + R.estimate + R.unresolvedTraced + R.zoneUpper || 1; let bx = x;
  for (const [v, col] of [[R.confirmed, [70, 120, 180]], [R.estimate, [230, 180, 40]], [R.unresolvedTraced, [220, 60, 50]], [R.zoneUpper, null]]) { const bw = W * v / gross; if (bw > 0.3) { if (col) { rpColor(doc, 'fill', col); doc.rect(bx, y, bw, 9, 'F'); } else { rpClip(doc, bx, y, bw, 9); rpColor(doc, 'draw', RP.HATCH); doc.setLineWidth(0.5); doc.setLineDashPattern([], 0); for (let q = bx - 10; q < bx + bw; q += 4) doc.line(q, y + 9, q + 9, y); rpUnclip(doc); rpColor(doc, 'draw', RP.HATCH); doc.rect(bx, y, bw, 9, 'S'); } } bx += bw; }
  y += 20; const col3 = W / 3;
  const c3 = [['Confirmed: ' + rpNum(R.confirmed) + ' sq ft', 'seen and measured on the imagery' + (R.altSqft > 0.5 && !M.alt.soft ? `; ${rpNum(R.altSqft)} sq ft of it on the second image` : ''), RP.INK],
    [R.estimate > 0.5 ? 'Estimate: + ' + rpNum(R.estimate) + ' sq ft' : 'Estimate for hidden roof: none', R.estimate > 0.5 ? 'hidden by canopy; ' + (M.alt && M.alt.soft ? 'from the softer second image and the evidence below' : 'evidence listed below') + (R.ranged ? `; range ${rpNum(R.estLo)}-${rpNum(R.estHi)}` : '') : 'no roof area was placed from evidence alone', R.estimate > 0.5 ? RP.EST : RP.INK],
    [R.fullKnown ? 'Unresolved: none' : R.zoneCount ? `Unresolved: 0 to ${rpNum(R.zoneUpper)} sq ft` : `Unresolved: ${rpNum(R.unresolvedTraced)} sq ft`, R.fullKnown ? 'no hidden zones' : R.zoneCount ? 'hidden zones (hatched): no evidence; in no total' : 'traced but not confirmed', R.fullKnown ? RP.INK : RP.WARN]];
  c3.forEach(([k, d, col], i) => { rpText(doc, k, x + i * col3, y, { size: 8.5, bold: true, color: col }); rpText(doc, d, x + i * col3, y + 10, { size: 6.8, color: RP.MUTE, maxWidth: col3 - 8 }); });
  y += 30;
  const ids = M.zones.map((z) => z.id).join(', ');
  const verdict = R.fullKnown ? (R.estimate > 0.5 ? `Confirmed + estimate: ${rpNum(R.confirmed + R.estimate)} sq ft` + (R.ranged ? ` (range ${rpNum(R.confirmed + R.estLo)}-${rpNum(R.confirmed + R.estHi)})` : '') + '. The estimate rests on the evidence listed below.' : `Full roof area: ${rpNum(R.confirmed)} sq ft. Every facet was measured on the imagery.`)
    : `The full roof area is unresolved. Confirmed: ${rpNum(R.confirmed)} sq ft` + (R.estimate > 0.5 ? `, plus an estimated ${rpNum(R.estimate)} sq ft` : '') + '. ' + (R.zoneCount ? `Hidden zone${R.zoneCount > 1 ? 's' : ''} ${ids} could add anything from 0 to ${rpNum(R.zoneUpper)} sq ft; nothing seen supports a figure. Another view or a site measurement is needed.` : 'Part of the trace is marked unresolved by the reviewer.');
  y = rpText(doc, verdict, x, y, { size: 8.2, bold: true, color: R.fullKnown ? RP.NAVY : RP.WARN, maxWidth: W }) + 6;
  // unresolved / inferred items that affect the totals
  y = rpSection(doc, 'Items that affect the totals', x, y, W);
  const items = [];
  if (M.rv) for (const u of M.rv.unresolved) items.push({ cells: [u.label, 'Unresolved', u.qty, u.missing], color: [150, 25, 15] });
  if (M.obLines.length) items.push({ cells: [M.obLines.length + ' boundar' + (M.obLines.length > 1 ? 'ies' : 'y'), 'Not a roof edge', rpNum(R.obstructionFt, 1) + ' ft', 'Where the visible roof stops at tree canopy. Left open in the outline; counted in no eave, rake, ridge, valley or flashing total.'], color: [150, 25, 15] });
  for (const F of M.facets) if (F.status === 'inferred') items.push([F.id, 'Inferred', rpNum(F.f.inferredSqft > 0 && F.f.inferredSqft < F.m.sloped ? F.f.inferredSqft : F.m.sloped) + ' of ' + rpNum(F.m.sloped) + ' sq ft' + (F.range ? ` (facet ${rpNum(F.range[0])}-${rpNum(F.range[1])})` : ''), F.f.evidence || F.f.note || 'Marked inferred']);
  const infL = M.lines.filter((L) => L.status === 'inferred'); if (infL.length) items.push([infL.length + ' line' + (infL.length > 1 ? 's' : ''), 'Inferred', rpNum(infL.reduce((a, L) => a + L.m.trueFt, 0), 1) + ' ft', 'Lines under tree canopy (dashed); positions follow the continued roof planes. Keys: ' + infL.map((L) => L.n).slice(0, 14).join(', ') + (infL.length > 14 ? ', ...' : '') + '.']);
  if (M.rv && M.rv.errors) items.push({ cells: ['Geometry', 'Check', M.rv.errors + ' error' + (M.rv.errors > 1 ? 's' : ''), M.rv.audit.issues.filter((i) => i.severity === 'error').slice(0, 3).map((i) => i.message).join('; ')], color: [150, 25, 15] });
  const LBL = { 'no-roof': 'No roof', verify: 'To verify', reconcile: 'Totals', 'imagery-quality': 'Imagery', selection: 'Building', 'imagery-change': 'Imagery date', outline: 'Outline', mask: 'Outline' };
  if (M.status) for (const q of M.status.reasons) if (LBL[q.code]) items.push({ cells: [LBL[q.code], 'Review required', '-', q.text + ' Needs: ' + q.needs], color: [150, 25, 15] });
  if (M.rv && M.rv.audit.unclassifiedFt > 2) items.push(['Outline', 'Not classified', rpNum(M.rv.audit.unclassifiedFt) + ' ft', 'Facet outline without a line type. It is not counted in any category and is not a confirmed zero.']);
  if (!items.length) { rpText(doc, M.auto ? 'None found. No tree canopy was detected over the traced roof and nothing was estimated. Roof hidden by something the trace did not recognise as canopy would not be listed here: compare the roofline with the photo.' : 'None. No facet or line is marked inferred or unresolved.', x, y, { size: 8.2, maxWidth: W }); y += 24; }
  else { /* rows with evidence text wrap to four or five lines */ const room = Math.max(2, Math.min(8, Math.floor((RP.H - 64 - y) / 42))); y = rpTable(doc, x, y - 4, [{ t: 'Item', w: 84, wrap: true }, { t: 'Status', w: 66 }, { t: 'Quantity', w: 118 }, { t: 'Evidence / what is missing', w: W - 268, wrap: true }], items.slice(0, room), { size: 7 }) + 4;
    if (items.length > room) { rpText(doc, `+ ${items.length - room} more: see the facet and line schedules.`, x, y + 6, { size: 7, color: RP.MUTE }); y += 12; } }
  // subtotals by structure, then line totals, when the page has room (both are repeated in full on the totals page)
  if (M.structs.length > 1 && y < RP.H - 150) { y += 8; y = rpSection(doc, 'Subtotals by structure', x, y, W); y = rpStructTable(doc, M, x, y - 4, W, { size: 6.8 }) + 4; }
  y += 8; if (y < RP.H - 120) { y = rpSection(doc, 'Line totals (true length)', x, y, W);
    const keys = ROOF_LINE_TYPES.filter((k) => !['parapet', 'unspecified'].includes(k) || t.byType[k].count); const cw = W / 4; let i = 0;
    for (const k of keys) { const cx = x + (i % 4) * cw, cy = y + Math.floor(i / 4) * 24; rpLineStyle(doc, k, 'measured'); doc.line(cx, cy - 3, cx + 16, cy - 3); doc.setLineDashPattern([], 0); rpText(doc, EDGE_TYPES[k].plural, cx + 20, cy, { size: 7.5, color: RP.MUTE }); rpText(doc, rpFtIn(t.byType[k].true) + (t.byType[k].unresolved > 0 ? ' *' : ''), cx + 20, cy + 10, { size: 9, bold: true }); i++; }
    y += Math.ceil(keys.length / 4) * 24;
    if (keys.some((k) => t.byType[k].unresolved > 0)) { rpText(doc, '* includes unresolved length (not confirmed)', x, y + 2, { size: 6.8, color: RP.WARN }); y += 9; }
    if (M.obLines.length) rpText(doc, `Not included above: ${rpNum(R.obstructionFt, 1)} ft of obstruction boundary (visible roof stops at tree canopy; not a roof edge).`, x, y + 2, { size: 6.8, color: RP.WARN }); }
}
function rpPageAerial(doc, M, A) {
  const box = { x: RP.M, y: 78, w: RP.W - 2 * RP.M, h: 580 }; const r = rpDrawAerial(doc, M, A, box, { ids: true });
  let y = (r ? r.y + r.h : box.y + box.h) + 14; rpText(doc, (A ? A.credit + ' ' : '') + 'Roofline and facet IDs are the same geometry used on every plan in this report.', RP.M, y, { size: 7, color: RP.MUTE }); y += 12;
  rpLegend(doc, M, RP.M, y, RP.W - 2 * RP.M, true);
}
function rpPagePlan(doc, M, mode, note, win) {
  const box = { x: RP.M, y: 100, w: RP.W - 2 * RP.M, h: 566 }; const V = rpView(M, box, win ? { ftBox: win, padFt: 1 } : {});
  let y = 80;
  if (mode === 'lengths') { const t = M.t; const keys = ROOF_LINE_TYPES.filter((k) => t.byType[k].count); rpText(doc, keys.map((k) => `${EDGE_TYPES[k].plural} ${rpFtIn(t.byType[k].true)}`).join('   |   ') + (M.obLines.length ? `   |   obstruction boundary ${rpNum(M.area.obstructionFt, 1)} ft (not counted, drawn as a gap)` : ''), RP.M, y, { size: 7.6, maxWidth: RP.W - 2 * RP.M }); }
  else if (mode === 'areas') rpText(doc, `Confirmed ${rpNum(M.area.confirmed)} sq ft` + (M.area.estimate > 0.5 ? `   |   estimate for hidden roof + ${rpNum(M.area.estimate)} sq ft` : '') + (M.area.zoneCount ? `   |   hidden zones 0-${rpNum(M.area.zoneUpper)} sq ft (in no total)` : '') + `   |   plan area ${rpNum(M.t.plan)} sq ft   |   ${M.t.facetCount} facets   |   fill = status`, RP.M, y, { size: 7.6, maxWidth: RP.W - 2 * RP.M });
  else if (mode === 'pitch') rpText(doc, 'Pitch per facet (rise per 12 in. of run), arrow = down-slope direction. ' + M.t.pitches.map((p) => `${p}/12: ${rpNum(M.t.pitchGroups[p])} sq ft`).join('   |   '), RP.M, y, { size: 7.6, maxWidth: RP.W - 2 * RP.M });
  else rpText(doc, 'To-scale roof plan, north up. Facet IDs (F1, F2, ...) and line colours are the same on every page.', RP.M, y, { size: 7.6 });
  const missed = rpDrawRoof(doc, M, V, mode);
  if (missed && missed.length && !win) rpText(doc, `Keys with no room on this diagram (lengths are in the line schedule): ${missed.join(', ')}`, RP.M, 92, { size: 6.6, color: RP.WARN, maxWidth: RP.W - 2 * RP.M });
  rpNorthScale(doc, V, RP.M + 14, RP.H - 60);
  let ly = 684; if (mode === 'areas') { let cx = RP.M + 250; for (const [k, lab] of [['measured', 'Measured'], ['inferred', 'Inferred'], ['unresolved', 'Unresolved']]) { rpColor(doc, 'fill', RP.STATUS_FILL[k]); rpColor(doc, 'draw', [150, 165, 185]); doc.setLineWidth(0.5); doc.rect(cx, ly - 7, 12, 8, 'FD'); rpText(doc, lab, cx + 16, ly, { size: 7 }); cx += 70; }
    if (M.zones.length) { rpClip(doc, cx, ly - 7, 12, 8); rpColor(doc, 'draw', RP.HATCH); doc.setLineWidth(0.5); for (let q = cx - 8; q < cx + 12; q += 3.5) doc.line(q, ly + 1, q + 8, ly - 7); rpUnclip(doc); rpText(doc, 'Hidden zone (in no total)', cx + 16, ly, { size: 7 }); } }
  else rpLegend(doc, M, RP.M + 250, ly, RP.W - 2 * RP.M - 250, mode !== 'pitch');
  if (note) rpText(doc, note, RP.M + 250, RP.H - 50, { size: 6.4, color: RP.MUTE, maxWidth: RP.W - 2 * RP.M - 250 });
}
function rpPageTrees(doc, M, A) {
  const ob = M.ob, x = RP.M, W = RP.W - 2 * RP.M; let y = 74;
  const box = { x, y: y + 6, w: W, h: 300 }; const r = rpDrawAerial(doc, M, A, box, { obstruction: true, labels: true, thin: true });
  if (!r) { const V = rpView(M, box, { padFt: 26 }); rpClip(doc, box.x, box.y, box.w, box.h); rpDrawRoof(doc, M, V, 'trees'); rpDrawObstruction(doc, M, V.P, true); rpUnclip(doc); }
  y = box.y + box.h + 12;
  // legend
  const G = doc.GState ? (o) => doc.setGState(new doc.GState(o)) : () => {};
  let cx = x; for (const [col, lab, op] of [[[235, 120, 20], 'Tree canopy over the roof (T)', 0.5], [[40, 160, 80], 'Tree canopy near the roof (T)', 0.3], [[150, 160, 175], 'Other structure nearby (S)', 0.45]]) { G({ opacity: op }); rpColor(doc, 'fill', col); doc.rect(cx, y - 7, 14, 9, 'F'); G({ opacity: 1 }); rpText(doc, lab, cx + 18, y, { size: 7.2 }); cx += 150; }
  y += 14; y = rpSection(doc, 'Effect on the measurements', x, y, W);
  const affected = M.lines.filter((L) => (L.e.obscuredFt || 0) > 0.5 || L.status !== 'measured'); const obsFt = affected.reduce((s, L) => s + (L.e.obscuredFt || 0), 0);
  const infF = M.facets.filter((F) => F.status === 'inferred');
  const rows = [
    ['Roof footprint hidden by canopy', `${rpNum(ob.inferredPlanSqft)} sq ft plan (${rpNum(ob.footprintObscuredPct, 1)}% of the footprint)`],
    ['Roof lines under canopy', affected.length ? `${affected.map((L) => L.id).slice(0, 18).join(', ')}${affected.length > 18 ? ', ...' : ''}  -  ${rpNum(obsFt, 1)} ft hidden (dashed on the plans)` : 'None'],
    ['Obstruction boundaries', M.obLines.length ? `${M.obLines.map((L) => L.id).join(', ')}  -  ${rpNum(M.area.obstructionFt, 1)} ft where the visible roof stops at the canopy. Not roof edges: left open in the outline and counted in no line total.` : 'None'],
    ['Facets with an estimated part', infF.length ? infF.map((F) => `${F.id} (${rpNum(F.f.inferredSqft > 0 && F.f.inferredSqft < F.m.sloped ? F.f.inferredSqft : F.m.sloped)} sf)`).join(', ') : 'None'],
    ['Hidden zones (hatched)', M.zones.length ? M.zones.map((z) => `${z.id}: 0 to ${rpNum(z.upperSqft)} sq ft${z.facetName ? ' beside ' + z.facetName : ''}`).join('; ') + '. In no total.' : 'None'],
    ['How hidden roof was handled', 'The canopy is never traced as the roof edge. Where the visible roof stops at the canopy the outline is left open and the ground under the canopy beyond it is hatched as a hidden zone. A roof plane is continued under the canopy only where something seen supports it (the same plane visible beyond the canopy, the opposite face of the same ridge, or the building outline), down to a measured eave height; that part is an estimate with a range. Everything else stays out of the totals until another view or a site measurement confirms it.'],
  ];
  y = rpTable(doc, x, y - 4, [{ t: 'Item', w: 150 }, { t: 'Finding', w: W - 150, wrap: true }], rows, { size: 7.4 }) + 12;
  y = rpSection(doc, 'Canopy and structures (heights above the ground beside the house)', x, y, W);
  const list = [...ob.trees.map((o, i) => ['T' + (i + 1), o.kind === 'overlap' ? 'Tree over roof' : 'Tree near roof', rpNum(o.overlapSqft) + ' sq ft', rpNum(o.distFt) + ' ft', rpNum(o.topFt) + ' ft', ob.ridgeFt != null && o.topFt > ob.ridgeFt + 1 ? rpNum(o.topFt - ob.ridgeFt) + ' ft above the ridge' : 'below the ridge']),
    ...ob.structures.map((o, i) => ['S' + (i + 1), 'Other structure', '-', rpNum(o.distFt) + ' ft', rpNum(o.topFt) + ' ft', rpNum(o.areaSqft) + ' sq ft footprint in view'])];
  { const nT = ob.trees.length, keep = Math.max(3, 9 - ob.structures.length - 1); if (nT > keep + 1) list.splice(keep, nT - keep, ['...', `${nT - keep} more canopy areas`, '', '', '', 'smaller ones; all are drawn on the photo']); }
  if (list.length) y = rpTable(doc, x, y - 4, [{ t: 'ID', w: 34 }, { t: 'Type', w: 96 }, { t: 'Over the roof', w: 80, a: 'r' }, { t: 'Distance', w: 62, a: 'r' }, { t: 'Top height', w: 68, a: 'r' }, { t: 'Note', w: W - 340 }], list.slice(0, 10), { size: 7.4 }) + 8;
  else { rpText(doc, 'No tree canopy or other structures were found close to the roof.', x, y, { size: 8 }); y += 12; }
  rpText(doc, `Heights come from the same 10 cm height model as the roof trace (${ob.source}). Reference: ${ob.heightReference}. Roof ridge: ${ob.ridgeFt != null ? rpNum(ob.ridgeFt) + ' ft' : 'n/a'}. Typical error about 1-2 ft; canopy heights are tops of canopy, not trunk or limb clearances - clearance under a limb is not measurable from above and is not reported.`, x, y + 2, { size: 6.8, color: RP.MUTE, maxWidth: W });
}
// which views were checked, what each one resolved, and what is still open
function rpPageEvidence(doc, M, A, ctx) {
  const x = RP.M, W = RP.W - 2 * RP.M; let y = 78; const title = 'Other views & evidence';
  const brk = () => { ctx.newPage(title + ' (continued)'); return 80; }; const need = (hh) => { if (y + hh > RP.H - 50) y = brk(); };
  const A2 = rpAerialAlt(M);
  if (A2 && A) { const bw = (W - 10) / 2, bh = 196;
    rpDrawAerial(doc, M, A, { x, y, w: bw, h: bh }, { thin: true, zones: true, caption: 'Image used for the trace' + (M.imagery.date ? ': ' + M.imagery.date : '') });
    rpDrawAerial(doc, M, A2, { x: x + bw + 10, y, w: bw, h: bh }, { thin: true, zones: true, caption: 'Second image' + (M.alt.date ? ': ' + M.alt.date : '') });
    y += bh + 9; y = rpText(doc, 'The same roofline and facet IDs on both georeferenced photos. Where the first image has tree canopy over the roof, heights and edges were taken from the second image after the configuration check below' + (M.alt.soft ? '; that image is softer, so those parts are dashed and reported as an estimate.' : '.'), x, y, { size: 6.8, color: RP.MUTE, maxWidth: W }) + 6; }
  y = rpSection(doc, 'Views and sources checked', x, y, W);
  const vrows = [[M.imagery.source, M.imagery.date || 'not reported', 'Georeferenced, overhead', 'Measurement', M.alt ? 'Tree canopy over part of the roof; that part was measured on the second image' : (M.ob && M.ob.inferredPlanSqft > 1 || M.zones.length ? 'Tree canopy over part of the roof' : 'Roof clear of canopy')]];
  for (const v of M.views) vrows.push([v.label, v.dateText || v.date || 'not published', v.georef ? (v.kind === 'solar' ? 'Georeferenced, overhead, with height model' : v.kind === 'naip' ? 'Georeferenced, overhead, public domain' : v.kind === 'county' ? 'Georeferenced, overhead, public record (ground-rectified)' : 'Georeferenced, overhead') : (v.kind === '3d' ? 'Tilted 3D view' : 'Photo, not georeferenced'), v.used ? (M.alt && M.alt.soft ? 'Estimate for the hidden part' : 'Measurement (hidden part)') : v.measurable ? 'Comparison' : (v.georef ? 'Comparison only' : 'Viewing aid only'), (v.result || '') + (v.aligned ? ' Image ' + v.aligned + '.' : '')]);
  y = rpTable(doc, x, y - 4, [{ t: 'Source', w: 132, wrap: true }, { t: 'Image date', w: 58, wrap: true }, { t: 'Type', w: 104, wrap: true }, { t: 'Used for', w: 92, wrap: true }, { t: 'Result', w: W - 386, wrap: true }], vrows, { size: 7, onBreak: brk }) + 12;
  // what each view resolved, by line type
  need(70); y = rpSection(doc, 'What each view resolved', x, y, W);
  const by = new Map(); const add = (src, key, v) => { if (!by.has(src)) by.set(src, { lines: {}, facets: [], sqft: 0, verify: [] }); const q = by.get(src); if (key === 'facet') { q.facets.push(v.id); q.sqft += v.sqft; } else if (key === 'verify') q.verify.push(v); else { (q.lines[key] = q.lines[key] || []).push(v); } };
  for (const L of M.lines) { if (L.e.confirmedBy) add(rpSrc(L.e.confirmedBy), L.type, L); if (L.e.verify) add(rpSrc(L.e.verify), 'verify', L.id); }
  for (const F of M.facets) { if (F.f.excluded) continue; if (F.f.confirmedBy) add(rpSrc(F.f.confirmedBy), 'facet', { id: F.id, sqft: F.f.altSqft || F.m.sloped }); if (F.f.verify) add(rpSrc(F.f.verify), 'verify', F.id); }
  const rrows = [];
  for (const [src, q] of by) { let first = true; const lab = () => { const v = first ? src : ''; first = false; return v; };
    if (q.facets.length) rrows.push([lab(), 'Roof area', q.facets.join(', '), rpNum(q.sqft) + ' sq ft']);
    for (const k of ROOF_LINE_TYPES) if (q.lines[k]) rrows.push([lab(), EDGE_TYPES[k].plural, q.lines[k].map((L) => L.n).join(', '), rpNum(q.lines[k].reduce((a, L) => a + L.m.trueFt, 0), 1) + ' ft']);
    if (q.verify.length) rrows.push({ cells: [lab(), 'Seen, not measurable', q.verify.join(', '), 'marked for verification'], color: RP.WARN }); }
  for (const v of M.views) if (![...by.keys()].some((k) => k.startsWith(v.label))) rrows.push([v.label, '-', '-', v.measurable ? 'nothing carried into the sketch' : (v.georef ? 'compared; cannot place an edge' : 'no edge marked; viewing aid')]);
  if (rrows.length) y = rpTable(doc, x, y - 4, [{ t: 'Source', w: 170, wrap: true }, { t: 'Measurement type', w: 100 }, { t: 'Facets / line keys', w: W - 420, wrap: true }, { t: 'Quantity', w: 150, a: 'r' }], rrows, { size: 7, onBreak: brk }) + 12;
  else { y = rpText(doc, 'No other view was used: every figure in this report comes from the image named on the summary page.', x, y, { size: 7.6, maxWidth: W }) + 10; }
  if (M.alt && M.alt.check) { const c = M.alt.check; need(170); y = rpSection(doc, 'Roof configuration check before anything was carried in', x, y, W);
    y = rpTable(doc, x, y - 4, [{ t: 'Check (only where the first image sees the roof clearly)', w: 270 }, { t: 'Result', w: 110, a: 'r' }, { t: 'Needed', w: W - 380 }], [
      ['Visible roof compared', rpNum(c.roofSqft) + ' sq ft', 'at least 160 sq ft'],
      ['Same height in both datasets (within 1 ft; roof interior, 2.6 ft in from its edges)', rpNum(c.heightAgreePct, 1) + '%', '80% or more'],
      ['Visible roof inside the second building outline', rpNum(c.outlineAgreePct, 1) + '%', '85% or more'],
      ['Change in roof height above the ground', c.heightChangeM == null ? 'not measurable' : rpNum(Math.abs(c.heightChangeM) * RM.FT, 1) + ' ft', '1.6 ft or less'],
      ['Horizontal offset between the datasets (corrected)', rpNum(c.shiftM * RM.FT, 1) + ' ft', 'under 2 ft'],
      ...(c.patchSqft ? [['Largest patch of roof added / rebuilt / removed between the two', [c.patchSqft.added, c.patchSqft.changed, c.patchSqft.removed].map((v) => rpNum(v)).join(' / ') + ' sq ft', 'under 16 sq ft each']] : []),
      ['Tilt between the two height models (corrected)', c.tiltPer10m == null ? '-' : rpNum(c.tiltPer10m * 12, 1) + ' in. per 10 ft', '14 in. per 10 ft or less'],
    ], { size: 7 }) + 4;
    y = rpText(doc, 'Result: same roof configuration' + (M.alt.approved ? `; confirmed by the reviewer${M.alt.approved.at ? ' on ' + String(M.alt.approved.at).slice(0, 10) : ''}${M.alt.approved.note ? ' ("' + M.alt.approved.note + '")' : ''}` : '') + (M.alt.soft ? '. The second dataset is softer than the first (edges good to about 1.3 ft, building outline runs large), so what it supplied is an estimate with a range, not a confirmed measurement.' : '.'), x, y + 6, { size: 7, color: RP.MUTE, maxWidth: W }) + 10; }
  need(60); y = rpSection(doc, 'Still unresolved', x, y, W);
  const open = [...M.zones.map((z) => [z.id, 'Hidden zone', '0 to ' + rpNum(z.upperSqft) + ' sq ft', 'Under tree canopy; no view checked so far shows this part of the roof.']), ...M.obLines.map((L) => [L.id, 'Obstruction boundary', rpNum(L.m.planFt, 1) + ' ft', 'Visible roof stops at the canopy; the real edge and its type are not located.']), ...M.lines.filter((L) => L.e.verify).map((L) => ['L' + L.n, EDGE_TYPES[L.type].label, rpFtIn(L.m.trueFt), 'Marked for verification: ' + (L.e.verify.note || rpSrc(L.e.verify))])];
  if (open.length) y = rpTable(doc, x, y - 4, [{ t: 'Item', w: 50 }, { t: 'What', w: 110 }, { t: 'Quantity', w: 90, a: 'r' }, { t: 'Why', w: W - 250, wrap: true }], open, { size: 7, onBreak: brk }) + 12;
  else { y = rpText(doc, 'Nothing. No hidden zone, obstruction boundary or verification mark remains.', x, y, { size: 7.6 }) + 8; }
  if (M.evidence.length) { need(60); y = rpSection(doc, 'Reviewer log', x, y, W);
    y = rpTable(doc, x, y - 4, [{ t: 'When', w: 84 }, { t: 'Item', w: 70 }, { t: 'Action', w: 170, wrap: true }, { t: 'Source', w: 110, wrap: true }, { t: 'Image date', w: 56 }, { t: 'Note', w: W - 490, wrap: true }], M.evidence.slice(-24).map((e) => [String(e.at || '').slice(0, 16).replace('T', ' '), e.target || '', e.action || '', e.source || '', e.date || '', e.note || '']), { size: 6.6, onBreak: brk }) + 6; }
}
function rpPageTotals(doc, M, ctx) {
  const t = M.t, x = RP.M, W = RP.W - 2 * RP.M; let y = 84;
  y = rpSection(doc, 'Area', x, y, W);
  const ab = t.areaByStatus;
  const R = M.area;
  y = rpTable(doc, x, y - 4, [{ t: 'Quantity', w: 220 }, { t: 'Value', w: 110, a: 'r' }, { t: 'How it is calculated', w: W - 330, wrap: true }], [
    { cells: ['Confirmed sloped area', rpNum(R.confirmed, 1) + ' sq ft', 'Seen and measured on georeferenced imagery. Each facet: plan area x sqrt(1 + slope^2); unrounded facets summed' + (R.altSqft > 0.5 && !M.alt.soft ? `. ${rpNum(R.altSqft, 1)} sq ft of it was measured on the second image (${M.alt.label})` : '')], bold: true },
    ['Estimate for hidden roof', R.estimate > 0.5 ? '+ ' + rpNum(R.estimate, 1) + ' sq ft' : 'none', R.estimate > 0.5 ? 'Under tree canopy, placed from the evidence in the facet schedule' + (M.alt && M.alt.soft ? `; ${rpNum(R.altSqft, 1)} sq ft of it taken from the softer second image (${M.alt.label})` : '') + (R.ranged ? `. Range ${rpNum(R.estLo)} to ${rpNum(R.estHi)} sq ft` : '') : 'No area was placed from evidence alone'],
    ...(R.unresolvedTraced > 0.5 ? [{ cells: ['Traced but not confirmed', rpNum(R.unresolvedTraced, 1) + ' sq ft', 'Marked unresolved by the reviewer. NOT CONFIRMED - verify before ordering'], color: RP.WARN }] : []),
    { cells: ['Net sloped area used below', rpNum(t.sloped, 1) + ' sq ft', 'Confirmed + estimate. Basis for squares, waste and materials'], bold: true },
    ...(M.zones.length ? [{ cells: ['Hidden zones (in no total)', '0 to ' + rpNum(R.zoneUpper) + ' sq ft', `${M.zones.map((z) => z.id).join(', ')}: under tree canopy with no evidence either way. The full roof area is unresolved until these are checked`], color: RP.WARN }] : []),
    ['Projected (plan) area', rpNum(t.plan, 1) + ' sq ft', 'Facet outlines on the horizontal plane (cut-outs subtracted)'],
    ['Net squares', rpNum(t.sloped / 100, 2) + ' sq', 'Net sloped area / 100. No waste included'],
  ], { size: 7.4 }) + 12;
  if (M.structs.length > 1) { y = rpSection(doc, 'Subtotals by structure', x, y, W); y = rpStructTable(doc, M, x, y - 4, W) + 12; }
  y = rpSection(doc, 'Pitch', x, y, W);
  y = rpTable(doc, x, y - 4, [{ t: 'Pitch', w: 80 }, { t: 'Sloped area', w: 110, a: 'r' }, { t: 'Share', w: 70, a: 'r' }, { t: 'Squares', w: 70, a: 'r' }, { t: '', w: W - 330 }], t.pitches.map((p) => [p === 0 ? 'Flat' : p + '/12' + (p === t.predominant ? '  (predominant)' : ''), rpNum(t.pitchGroups[p], 1) + ' sq ft', rpNum(t.pitchGroups[p] / (t.sloped || 1) * 100, 1) + '%', rpNum(t.pitchGroups[p] / 100, 2), '']), { size: 7.4 }) + 12;
  y = rpSection(doc, 'Lines', x, y, W);
  const kinds = { eave: 'horizontal', ridge: 'horizontal', wall: 'horizontal', transition: 'horizontal', parapet: 'horizontal', unspecified: 'horizontal', rake: 'sloped', step: 'sloped', hip: 'sloped', valley: 'sloped' };
  const rows = ROOF_LINE_TYPES.map((k) => { const b = t.byType[k]; const none = !b.count; return [EDGE_TYPES[k].plural, b.count, none ? '-' : rpNum(b.plan, 1), none ? (M.rv && M.rv.audit.unclassifiedFt > 2 ? 'none traced' : '0.0') : rpNum(b.true, 1), none ? '-' : rpFtIn(b.true), none ? '-' : kinds[k], none ? '-' : `${rpNum(b.measured, 1)} / ${rpNum(b.inferred, 1)} / ${rpNum(b.unresolved, 1)}`]; });
  rows.push({ cells: ['Hips + ridges (cap)', '', '', rpNum(t.byType.hip.true + t.byType.ridge.true, 1), rpFtIn(t.byType.hip.true + t.byType.ridge.true), '', ''], bold: true }, { cells: ['Eaves + rakes (drip edge / starter)', '', '', rpNum(t.byType.eave.true + t.byType.rake.true, 1), rpFtIn(t.byType.eave.true + t.byType.rake.true), '', ''], bold: true });
  if (M.obLines.length) rows.push({ cells: ['Obstruction boundary', M.obLines.length, rpNum(M.obLines.reduce((a, L) => a + L.m.planFt, 0), 1), 'not counted', '', 'not a roof edge', 'excluded from every category above'], color: RP.WARN });
  y = rpTable(doc, x, y - 4, [{ t: 'Category', w: 136 }, { t: 'Lines', w: 34, a: 'r' }, { t: 'Plan ft', w: 52, a: 'r' }, { t: 'True ft', w: 52, a: 'r' }, { t: 'ft-in', w: 58, a: 'r' }, { t: 'Kind', w: 56 }, { t: 'Measured / inferred / unresolved, ft', w: W - 388, a: 'r' }], rows, { size: 7.4 }) + 6;
  if (M.rv && M.rv.audit.unclassifiedFt > 2) { rpText(doc, `${rpNum(M.rv.audit.unclassifiedFt)} ft of facet outline has no line type. Categories shown as "none traced" are therefore not confirmed zeros.`, x, y + 4, { size: 7, color: [190, 30, 20] }); y += 12; }
  y += 8; y = rpSection(doc, 'Waste and order quantity (separate from the net area)', x, y, W);
  const rec = t.recWaste, cols = typeof wasteColumns === 'function' ? wasteColumns(rec) : [0, 10, 12, 15, 17, 20, 22];
  y = rpTable(doc, x, y - 4, [{ t: 'Waste', w: 110 }, ...cols.map((w) => ({ t: w + '%' + (w === rec ? ' *' : ''), w: (W - 110) / cols.length, a: 'r' }))], [['Area with waste, sq ft', ...cols.map((w) => rpNum(t.sloped * (1 + w / 100)))], ['Order squares', ...cols.map((w) => (Math.ceil(t.sloped * (1 + w / 100) / 100 * 10) / 10).toFixed(1))]], { size: 7.4 }) + 4;
  rpText(doc, `* suggested waste for this roof (${rec}%), from its cut edges (hips, valleys, rakes, step flashing) per square. Order squares are rounded up to 0.1; the net area above is never rounded before it is summed.`, x, y + 6, { size: 6.8, color: RP.MUTE, maxWidth: W }); y += 26;
  ctx.newPage('Counting rules & reconciliation'); y = 84;
  y = rpSection(doc, 'Counting rules', x, y, W);
  const rules = ['Each facet is counted once. Cut-outs (skylights, chimneys) are subtracted. Facets on the same roof level may not overlap; the review step blocks silent double counting and lists any overlap.',
    'Each line is counted once, in one category. Where an upper roof ends above a lower roof, two physical lines exist on one plan line: the upper roof\'s eave or rake, and the wall or step flashing on the lower roof. Both are counted, each in its own category.',
    'True length = plan length x slope factor. Auto-traced lines take the factor from the fitted roof plane they lie in; hand-drawn lines from the adjoining facet\'s pitch. Eaves, ridges and wall flashing are level; rakes, hips, valleys and step flashing are sloped.',
    'Status: Measured (confirmed) = seen on georeferenced imagery. Inferred (estimate) = hidden, placed from stated evidence, with a range; drawn dashed. Unresolved = hidden with no evidence; listed, flagged, never shown as zero.',
    'An obstruction boundary is where the visible roof stops at tree canopy. It is not an eave, rake, ridge, valley or flashing line and is counted in none of them. The canopy-covered ground beyond it is a hidden zone: hatched, reported as a range starting at zero, and left out of every total until another source verifies the edge and its type.',
    'A tilted or 3D view can show that an edge exists, but it is not used to measure. Lengths and areas come only from georeferenced overhead imagery or a height model; an edge seen only in a tilted view is marked for verification.'];
  for (const r of rules) { rpText(doc, '-', x, y, { size: 7.2 }); y = rpText(doc, r, x + 8, y, { size: 7.2, maxWidth: W - 8 }) + 2; }
  if (M.rv) { y += 6; y = rpSection(doc, 'Reconciliation', x, y, W); for (const c of M.rv.reconcile.checks) { rpText(doc, (c.ok ? 'OK   ' : 'FAIL ') + c.name + `: ${rpNum(c.a, 2)} = ${rpNum(c.b, 2)} ${c.unit}`, x, y, { size: 7.2, color: c.ok ? RP.INK : [190, 30, 20] }); y += 10; } }
}
function rpPageMaterials(doc, M) {
  const t = M.t, bt = t.byType, x = RP.M, W = RP.W - 2 * RP.M; let y = 82;
  const bases = { pitched: t.pitched, starter: bt.eave.true + bt.rake.true, iw: bt.eave.true + bt.valley.true + bt.wall.true + bt.step.true, cap: bt.hip.true + bt.ridge.true };
  const cols = typeof matColumns === 'function' ? matColumns(t.recWaste) : [0, 10, 12, 15]; const rows = [];
  for (const g of MATERIAL_CATALOG) { const base = bases[g.base]; rows.push({ cells: [g.group, '', ...cols.map((w) => (g.baseUnit === 'sqft' ? rpNum(Math.ceil(base * (1 + w / 100))) + ' sqft' : Math.ceil(base * (1 + w / 100)) + ' ft'))], bold: true, fill: [232, 238, 247] }); for (const [name, cov] of g.items) rows.push(['   ' + name, g.unit, ...cols.map((w) => (base > 0 ? Math.ceil(base * (1 + w / 100) / cov - 1e-9) : 0))]); }
  rows.push({ cells: ['Other', '', ...cols.map(() => '')], bold: true, fill: [232, 238, 247] }, ["   8' valley metal (no laps)", 'sheet', ...cols.map(() => Math.ceil(bt.valley.true / 8 - 1e-9))], ["   10' drip edge (eaves + rakes; no laps)", 'sheet', ...cols.map(() => Math.ceil((bt.eave.true + bt.rake.true) / 10 - 1e-9))]);
  y = rpTable(doc, x, y, [{ t: 'Product', w: 230 }, { t: 'Unit', w: 50 }, ...cols.map((w) => ({ t: `Waste ${w}%`, w: (W - 280) / cols.length, a: 'r' }))], rows, { size: 7.6 }) + 8;
  rpText(doc, 'Order quantities are estimates from the net measurements on the previous pages plus the waste shown; they are not measurements. Based on the pitched area (flat area excluded). Check before ordering.' + (t.unresolvedItems ? ' This roof has unresolved measurements: quantities may be low.' : ''), x, y + 4, { size: 7, color: RP.MUTE, maxWidth: W });
}
// optional 3D view: facets lifted onto their fitted planes, seen from the south-west (only for auto-traced roofs)
function rpPage3D(doc, M) {
  const ref = M.tr && M.tr.ref; const box = { x: RP.M, y: 104, w: RP.W - 2 * RP.M, h: 550 };
  const F3 = M.facets.filter((F) => !F.f.excluded && F.f.plane && ref).map((F) => ({ F, pts: F.m.path.map((v) => { const e = (v.lng - ref.lng) * ref.kx, n = (v.lat - ref.lat) * ref.ky; return [e * RM.FT, n * RM.FT, Math.max(0, F.f.plane[0] * e + F.f.plane[1] * n + F.f.plane[2]) * RM.FT]; }) }));
  if (F3.length < M.facets.filter((F) => !F.f.excluded).length || !F3.length) { rpText(doc, 'A 3D view needs the fitted plane of every facet. This roof has hand-drawn or edited facets without one, so no 3D view is drawn.', RP.M, 120, { size: 9, maxWidth: RP.W - 2 * RP.M }); return; }
  const th = 35 * Math.PI / 180, el = 32 * Math.PI / 180;   // camera to the south-west, looking north-east
  const pr = (p) => { const xr = p[0] * Math.cos(th) - p[1] * Math.sin(th), yr = p[0] * Math.sin(th) + p[1] * Math.cos(th); return [xr, yr * Math.sin(el) + p[2] * Math.cos(el), yr]; };
  const all = []; for (const f of F3) { f.s = f.pts.map(pr); f.g = f.pts.map((p) => pr([p[0], p[1], 0])); for (const q of [...f.s, ...f.g]) all.push(q); f.depth = f.s.reduce((s, q) => s + q[2], 0) / f.s.length; }
  const x0 = Math.min(...all.map((q) => q[0])), x1 = Math.max(...all.map((q) => q[0])), y0 = Math.min(...all.map((q) => q[1])), y1 = Math.max(...all.map((q) => q[1]));
  const k = Math.min(box.w / (x1 - x0), box.h / (y1 - y0)) * 0.94, ox = box.x + (box.w - (x1 - x0) * k) / 2, oy = box.y + (box.h - (y1 - y0) * k) / 2; const S = (q) => [ox + (q[0] - x0) * k, oy + (y1 - q[1]) * k];
  rpText(doc, 'Facets lifted onto their fitted planes, viewed from the south-west. Heights are relative to the ground beside the house; walls are drawn straight down from the roof edge. Not to scale.', RP.M, 84, { size: 7.6, maxWidth: RP.W - 2 * RP.M });
  // walls under outline lines (far to near), then the roof planes (far to near)
  const walls = []; for (const L of M.lines) { if (!['eave', 'rake'].includes(L.type) || L.e.paired) continue; const F = F3.find((f) => L.facets.includes(f.F.id)); if (!F) continue; for (let i = 1; i < L.m.path.length; i++) { const cv = (v) => { const e = (v.lng - ref.lng) * ref.kx, n = (v.lat - ref.lat) * ref.ky; return [e * RM.FT, n * RM.FT, Math.max(0, F.F.f.plane[0] * e + F.F.f.plane[1] * n + F.F.f.plane[2]) * RM.FT]; }; const a = cv(L.m.path[i - 1]), b = cv(L.m.path[i]); const q = [pr(a), pr(b), pr([b[0], b[1], 0]), pr([a[0], a[1], 0])]; walls.push({ q, depth: (q[0][2] + q[1][2]) / 2 }); } }
  walls.sort((a, b) => b.depth - a.depth); for (const wl of walls) { rpColor(doc, 'fill', [238, 236, 230]); rpColor(doc, 'draw', [190, 188, 180]); doc.setLineWidth(0.4); rpPoly(doc, wl.q.map(S), 'FD'); }
  F3.sort((a, b) => b.depth - a.depth); const rank = {}; M.t.pitches.forEach((p, i) => { rank[p] = i; });
  for (const f of F3) { const az = f.F.f.azimuth == null ? 180 : f.F.f.azimuth; const lit = 0.72 + 0.28 * Math.cos((az - 225) * Math.PI / 180); const c = [Math.round(150 * lit + 40), Math.round(165 * lit + 40), Math.round(195 * lit + 40)]; rpColor(doc, 'fill', c); rpColor(doc, 'draw', RP.NAVY); doc.setLineWidth(0.6); rpPoly(doc, f.s.map(S), 'FD'); const cc = f.s.reduce((s, q) => [s[0] + q[0] / f.s.length, s[1] + q[1] / f.s.length], [0, 0]); const p = S(cc); rpText(doc, f.F.id, p[0], p[1] + 2, { size: 5.8, bold: true, color: RP.NAVY, align: 'center' }); }
}

// ------------------------------------------------------------------ build
async function rpBuild(opts = {}) {
  if (!window.jspdf) throw new Error('PDF library did not load; check the internet connection');
  const M = rpModel(); if (!M || !M.facets.length) { if (state.trace && state.trace.failed) return rpBuildNoRoof(); throw new Error('Trace the roof first'); }
  const A = await rpAerial(M);
  const pages = [['Summary', (d) => rpPageSummary(d, M, A)], ['Aerial view with roofline', (d) => rpPageAerial(d, M, A)], ['Roof plan', (d) => rpPagePlan(d, M, 'plan')],
    ['Length diagram', (d) => rpPagePlan(d, M, 'lengths', 'Each line shows its key number and true length (feet and inches). Short or crowded lines show the key number only; every key is listed with its length in the line schedule.')],
    ...(() => { if (M.lines.length <= 70) return []; const [x0, y0, x1, y1] = M.box; const ov = 0.07, mx = (x1 - x0), my = (y1 - y0);
      // crowded roof: enlarged windows (halves, or quarters for very busy roofs) so every key number is readable in print
      let wins;
      if (M.lines.length > 110) wins = [[x0, y0 + my * (0.5 - ov), x0 + mx * (0.5 + ov), y1, 'north-west'], [x0 + mx * (0.5 - ov), y0 + my * (0.5 - ov), x1, y1, 'north-east'], [x0, y0, x0 + mx * (0.5 + ov), y0 + my * (0.5 + ov), 'south-west'], [x0 + mx * (0.5 - ov), y0, x1, y0 + my * (0.5 + ov), 'south-east']];
      else wins = mx >= my * 0.78 ? [[x0, y0, x0 + mx * (0.5 + ov), y1, 'west half'], [x0 + mx * (0.5 - ov), y0, x1, y1, 'east half']] : [[x0, y0 + my * (0.5 - ov), x1, y1, 'north half'], [x0, y0, x1, y0 + my * (0.5 + ov), 'south half']];
      return wins.map((wn, i) => [`Length diagram - detail ${i + 1} of ${wins.length} (${wn[4]})`, (d) => rpPagePlan(d, M, 'lengths', 'Enlarged window of the length diagram. Key numbers match the line schedule.', wn.slice(0, 4))]); })(),
    ['Area diagram', (d) => rpPagePlan(d, M, 'areas', 'Sloped area per facet, sq ft. Small facets show the ID only; their areas are in the facet schedule.')], ['Pitch diagram', (d) => rpPagePlan(d, M, 'pitch')]];
  const doc = rpDoc(); const W = RP.W - 2 * RP.M;
  // schedules can run over several pages: render them in a first pass to count pages, then stamp frames with "n of total"
  const facetRows = () => M.facets.map((F) => ({ cells: [F.id, M.t.structures.length > 1 ? 'S' + (F.structure || 1) : '', F.f.excluded ? 'cut-out' : 'L' + (F.f.level || 1), F.f.pitch === 0 ? 'Flat' : F.f.pitch + '/12', F.m.basis === 'fitted' ? rpNum(F.m.slope12, 2) + '/12 fitted' : 'assigned', rpNum(F.m.plan, 1), rpNum(F.m.factor, 4), (F.f.excluded ? '-' : '') + rpNum(F.m.sloped, 1), F.f.excluded ? 'excluded' : rpCap(F.status), F.status === 'inferred' ? `${rpNum(F.f.inferredSqft > 0 && F.f.inferredSqft < F.m.sloped ? F.f.inferredSqft : F.m.sloped)} sf estimated` + (F.range ? `; facet range ${rpNum(F.range[0])}-${rpNum(F.range[1])} sf` : '') + '. ' + (F.f.evidence || F.f.note || '') : F.status === 'unresolved' ? (F.f.missing || F.f.note || '') : ((F.f.altSqft > 0.5 ? `${rpNum(F.f.altSqft)} sf measured on ${rpSrc(F.f.confirmedBy)}. ` : F.f.confirmedBy ? `confirmed on ${rpSrc(F.f.confirmedBy)}. ` : '') + (F.f.verify ? `VERIFY (${rpSrc(F.f.verify)}). ` : '') + (F.f.note || (F.f.repaired ? 'outline rebuilt from the height model' : '')))], fill: F.status === 'unresolved' ? RP.STATUS_FILL.unresolved : F.status === 'inferred' ? RP.STATUS_FILL.inferred : null }))
    .concat(M.zones.map((Z) => ({ cells: [Z.id, '', '-', Z.pitch != null ? Z.pitch + '/12 if roof' : '-', 'not measured', '-', '-', '0 to ' + rpNum(Z.upperSqft), 'Hidden zone', `Under tree canopy${Z.facetName ? ' beside ' + Z.facetName : ''}. Nothing seen shows whether roof continues here. In no total.`], fill: RP.STATUS_FILL.unresolved })));
  const lineRows = () => M.lines.map((L) => ({ cells: [L.n, EDGE_TYPES[L.type].label, L.facets.join(', '), rpNum(L.m.planFt, 2), rpNum(L.m.factor, 4), rpNum(L.m.trueFt, 2), rpFtIn(L.m.trueFt), L.m.factor < 1.002 ? 'horizontal' : (L.m.basis === 'plane' ? 'sloped: plane' : 'sloped: pitch'), rpCap(L.status), (L.e.verify ? `VERIFY (${rpSrc(L.e.verify)}). ` : '') + (L.e.confirmedBy ? `located on ${rpSrc(L.e.confirmedBy)}` : (L.e.obscuredFt || 0) > 0.5 ? rpNum(L.e.obscuredFt, 1) + ' ft hidden' : (L.e.note || ''))], fill: L.status === 'unresolved' ? RP.STATUS_FILL.unresolved : L.status === 'inferred' ? RP.STATUS_FILL.inferred : null }))
    .concat(M.obLines.map((L) => ({ cells: [L.id, 'Obstruction', L.facets.join(', '), rpNum(L.m.planFt, 2), '-', 'not counted', '-', 'not a roof edge', 'Unresolved', 'Visible roof stops at tree canopy here; the real edge is not located.'], fill: RP.STATUS_FILL.unresolved })));
  const fCols = [{ t: 'ID', w: 30 }, { t: 'Str.', w: 26 }, { t: 'Level', w: 36 }, { t: 'Pitch', w: 38 }, { t: 'Slope basis', w: 72 }, { t: 'Plan sq ft', w: 56, a: 'r' }, { t: 'Factor', w: 44, a: 'r' }, { t: 'Sloped sq ft', w: 62, a: 'r' }, { t: 'Status', w: 56 }, { t: 'Note', w: W - 420, wrap: true }];
  const lCols = [{ t: 'Key', w: 28 }, { t: 'Type', w: 72 }, { t: 'Facets', w: 66 }, { t: 'Plan ft', w: 46, a: 'r' }, { t: 'Factor', w: 44, a: 'r' }, { t: 'True ft', w: 46, a: 'r' }, { t: 'ft-in', w: 46, a: 'r' }, { t: 'Length kind', w: 66 }, { t: 'Status', w: 54 }, { t: 'Note', w: W - 468, wrap: true }];
  const queue = [...pages];
  const sched = (title, cols, rowsFn, footer) => queue.push([title, (d, ctx) => { let y = 80; const end = rpTable(d, RP.M, y, cols, rowsFn(), { size: 7.2, rh: 12.5, onBreak: () => { ctx.newPage(title + ' (continued)'); return 80; } }); if (footer) footer(d, end + 10); }]);
  sched('Facet schedule', fCols, facetRows, (d, y) => { const t = M.t; rpText(d, `Totals: plan ${rpNum(t.plan, 1)} sq ft, net sloped ${rpNum(t.sloped, 1)} sq ft = confirmed ${rpNum(M.area.confirmed, 1)} + estimate ${rpNum(M.area.estimate, 1)}${M.area.unresolvedTraced > 0.5 ? ' + not confirmed ' + rpNum(M.area.unresolvedTraced, 1) : ''} (${M.facets.filter((F) => !F.f.excluded).length} facets${M.t.cutouts.length ? ', ' + M.t.cutouts.length + ' cut-out(s) subtracted' : ''}). "Fitted" slope is the plane fitted to the height model; the pitch column is that slope rounded to the framing pitch.`, RP.M, y, { size: 7, color: RP.MUTE, maxWidth: W }); });
  sched('Line schedule', lCols, lineRows, (d, y) => { rpText(d, 'Key numbers match the length diagram. True ft = plan ft x factor. "sloped: plane" factors come from the fitted roof plane; "sloped: pitch" from the adjoining facet pitch.', RP.M, y, { size: 7, color: RP.MUTE, maxWidth: W }); });
  const hasOb = M.ob && (M.ob.trees.length || M.ob.structures.length || M.ob.inferredPlanSqft > 1);
  if (hasOb) queue.push(['Trees & obstructions', (d) => rpPageTrees(d, M, A)]);
  if (M.views.length || M.evidence.length || M.alt || M.zones.length || M.obLines.length) queue.push(['Other views & evidence', (d, ctx) => rpPageEvidence(d, M, A, ctx)]);
  queue.push(['Totals & waste', (d, ctx) => rpPageTotals(d, M, ctx)]);
  if (opts.view3d) queue.push(['3D view', (d) => rpPage3D(d, M)]);
  if (opts.materials !== false && typeof MATERIAL_CATALOG !== 'undefined') queue.push(['Material order quantities', (d) => rpPageMaterials(d, M)]);
  const titles = []; let first = true;
  const ctx = { newPage: (title) => { doc.addPage('letter', 'portrait'); titles.push(title); } };
  for (const [title, fn] of queue) { if (!first) doc.addPage('letter', 'portrait'); first = false; titles.push(title); fn(doc, ctx); }
  const total = doc.getNumberOfPages();
  for (let i = 1; i <= total; i++) { doc.setPage(i); rpFrame(doc, M, titles[i - 1], i, total + (opts.extraPages || 0)); }
  doc.setProperties({ title: 'Roof Measurement Report - ' + M.address, author: typeof company !== 'undefined' ? company.name : 'Diversity Roofing', subject: 'Roof measurements', creator: 'Roof Measure' });
  return { doc, M, pages: total };
}
// No roof could be measured from the imagery (for example the building is newer than the image): a one-page REVIEW
// REQUIRED report that says what was looked at, what was found and what evidence would allow a measurement. No number
// is given for anything that was not measured.
function rpBuildNoRoof() {
  const doc = rpDoc(); const tr = state.trace || {}; const st = typeof reviewReportStatus === 'function' ? reviewReportStatus() : { status: 'REVIEW REQUIRED', reasons: [{ text: tr.failed, needs: 'Imagery that shows the building.' }] };
  const M = { address: state.address || '', date: new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' }) };
  const x = RP.M, W = RP.W - 2 * RP.M; let y = 80;
  rpColor(doc, 'fill', [252, 228, 224]); doc.rect(x, y - 6, W, 24, 'F'); rpColor(doc, 'fill', [190, 30, 20]); doc.rect(x, y - 6, 4, 24, 'F');
  rpText(doc, 'REVIEW REQUIRED', x + 10, y + 4, { size: 10.5, bold: true, color: [190, 30, 20] }); rpText(doc, 'No roof area or length could be measured from the imagery. Nothing in this report is a measurement.', x + 120, y + 4, { size: 7.5, maxWidth: W - 126 }); y += 34;
  y = rpSection(doc, 'What was found', x, y, W);
  for (const q of st.reasons) { y = rpText(doc, q.text, x, y, { size: 8.5, maxWidth: W }) + 4; y = rpText(doc, 'Needed: ' + q.needs, x + 10, y, { size: 8, color: RP.MUTE, maxWidth: W - 10 }) + 10; }
  y = rpSection(doc, 'Property & imagery', x, y + 4, W);
  const kv = (k, v) => { rpText(doc, k, x, y, { size: 8, color: RP.MUTE }); y = rpText(doc, v, x + 90, y, { size: 8, maxWidth: W - 90 }) + 3; };
  kv('Property', M.address || '-'); kv('Image date', tr.imageryDate || 'not reported by the source'); kv('Image source', 'Google Solar API (aerial photo, building mask and 10 cm height model)' + (tr.imageryQuality ? ' - ' + String(tr.imageryQuality).toLowerCase() + ' quality' : ''));
  kv('Building record', tr.buildingName || '-');
  rpFrame(doc, M, 'Summary', 1, 1);
  doc.setProperties({ title: 'Roof Measurement Report - ' + M.address + ' (review required)', author: typeof company !== 'undefined' ? company.name : 'Diversity Roofing', subject: 'Roof measurements', creator: 'Roof Measure' });
  return { doc, M, pages: 1 };
}
// the "Download PDF report" button: vector report; "both" appends the insurance estimate pages (rendered as before)
async function rpDownload(what = 'report') {
  const wantEst = what === 'both' || (typeof xm !== 'undefined' && !!xm.appendToReport);
  if (wantEst && typeof xmEnsureRoof === 'function' && !await xmEnsureRoof()) return;
  toast('Building PDF...');
  if (typeof permitEnsure === 'function') { try { await permitEnsure(); } catch (_) { /* optional */ } }
  let extra = null;
  if (wantEst && typeof xmBuildHTML === 'function') extra = xmBuildHTML().html;
  const { doc, pages } = await rpBuild({ view3d: $('#chkPdf3d') && $('#chkPdf3d').checked, materials: !$('#chkPdfMaterials') || $('#chkPdfMaterials').checked });
  if (extra) {
    // jsPDF cannot merge documents: render the estimate pages into this one the same way htmlToPDF does
    const host = document.createElement('div'); host.style.cssText = 'position:fixed;left:-10000px;top:0;width:8.5in;background:#fff;z-index:-1'; host.innerHTML = `<style>${REPORT_CSS} .rp-page, .xm-page { margin: 0 !important; box-shadow: none !important; }</style><div class="rp">${extra}</div>`; document.body.appendChild(host);
    try { for (const pg of host.querySelectorAll('.rp-page, .xm-page')) { const c = await window.html2canvas(pg, { scale: 2.5, backgroundColor: '#ffffff', useCORS: true, logging: false }); doc.addPage('letter', 'portrait'); doc.addImage(c.toDataURL('image/png'), 'PNG', 0, 0, RP.W, RP.H, undefined, 'MEDIUM'); } } finally { host.remove(); } }
  const name = fileBase() + (extra ? '_Roof_Report_and_Estimate.pdf' : '_Roof_Report.pdf');
  const saved = await deliverFile(doc.output('blob'), name);
  toast(`Ready: ${name} (${doc.getNumberOfPages()} pages)${saved ? '; copy saved in the reports folder' : ''}`);
  return pages;
}
