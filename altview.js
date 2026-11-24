'use strict';
/* altview.js - "Review roof from other angles".
 *
 * A reviewer's second look at a roof the trace could not see completely:
 *   3D view        Google photorealistic 3D, centred on the building: overhead, from north / east / south / west, free orbit.
 *                  A viewing aid only. Nothing is measured in it; an edge seen there can be marked for verification.
 *   Dated imagery  Google keeps one Solar dataset per quality tier, often flown in different years. Each is listed with its
 *                  flight date and can be swiped against the image the trace was made from. A dataset with a height model
 *                  can be checked against the visible roof and, if it shows the same roof, used for the canopy-covered part.
 *                  USDA NAIP aerial photos (public domain, every 2-3 years, 0.3-1 m per pixel) are listed with their flight
 *                  dates too: enough to see whether a tree is gone and what the roof looks like, too coarse to measure on.
 *   Import         The company's own authorised imagery: a georeferenced GeoTIFF (orthomosaic) is compared like dated
 *                  imagery; a plain photo (oblique, drone) is a viewing aid.
 * Every source is shown with its name and date. Lengths and areas only ever come from georeferenced overhead data.
 * Uses globals from app.js (state, map, $, esc, toast, EDGE_TYPES, RM, recompute, select), autotrace.js (autoTraceRoof,
 * altLoadLayers) and review.js (reviewLog, reviewMarkVerify, reviewConfirm).
 */
const AV = {
  active: { id: 'solar', label: 'Image used for the trace', date: null, georef: true },   // what the reviewer is looking at now
  isOpen: false, open3d: false, tab: '3d',
  lib: null, map3d: null, ready3d: false, cov: null, over: [], marks: [], markMode: false, showLines: true, cam: { range: 55, tilt: 0, heading: 0 }, tgt: null, seen: new Set(),
  tiers: null, tiersFor: null, naip: null, naipFor: null, sel: null, src: {}, v: { cx: 0, cy: 0, s: 9, swipe: 0.5, lines: true }, pick: null, probe: null, busy: '', photo: null,
};
const AV_VIEWS = { top: { tilt: 0, heading: 0, name: 'overhead' }, n: { tilt: 45, heading: 180, name: 'from north' }, e: { tilt: 45, heading: 270, name: 'from east' }, s: { tilt: 45, heading: 0, name: 'from south' }, w: { tilt: 45, heading: 90, name: 'from west' } };
const AV_3D = { label: 'Google Maps photorealistic 3D', note: 'capture date not published by Google' };
const AV_ZONE = { canopy: 'tree canopy still covers it in the 3D view', surface: 'no canopy; a built surface shows across the zone', part: 'no canopy; a built surface shows over part of the zone, open ground over the rest', ground: 'no canopy; open ground shows' };
const avSleep = (ms) => new Promise((r) => setTimeout(r, ms));
const avYmd = (d) => (d ? `${d.year}-${String(d.month).padStart(2, '0')}-${String(d.day).padStart(2, '0')}` : null);
const avRef = () => (state.trace && state.trace.ref) || (state.solar ? (() => { const c = state.solar.center; const k = RM.scale(c.latitude); return { lat: c.latitude, lng: c.longitude, kx: k.kx, ky: k.ky }; })() : null);
const avEN = (v, r) => [(v.lng - r.lng) * r.kx, (v.lat - r.lat) * r.ky];
const avPath = (shape) => { const o = []; (shape.getPath ? shape.getPath() : shape).forEach((p) => o.push({ lat: p.lat(), lng: p.lng() })); return o; };
// key numbers match the PDF line schedule: roof lines only, in drawing order
function avLineKey(e) { let n = 0; for (const q of state.edges) { if (q.omit || EDGE_TYPES[q.type].notRoof) continue; n++; if (q === e) return 'L' + n; } return EDGE_TYPES[e.type].notRoof ? 'obstruction boundary' : 'line'; }

// ------------------------------------------------------------------ what the panel is centred on: the selected building
function avTarget() {
  const r = avRef(); let facets = state.facets.filter((f) => !f.omit && !f.excluded);
  const sel = state.selected && state.facets.find((f) => f.id === state.selected.id);
  const sid = sel ? (sel.structure || 1) : 1; const own = facets.filter((f) => (f.structure || 1) === sid); if (own.length) facets = own;
  const pts = []; for (const f of facets) for (const p of avPath(f.shape)) pts.push(p);
  for (const z of (state.trace && state.trace.hiddenZones) || []) if ((z.structure || 1) === sid) for (const p of z.path) pts.push(p);
  if (!pts.length) { const c = state.solar ? { lat: state.solar.center.latitude, lng: state.solar.center.longitude } : state.location; if (!c) return null; return { lat: c.lat, lng: c.lng, halfM: 12, structure: sid, pts: [] }; }
  const la = pts.map((p) => p.lat), lo = pts.map((p) => p.lng); const lat = (Math.min(...la) + Math.max(...la)) / 2, lng = (Math.min(...lo) + Math.max(...lo)) / 2; const k = r || RM.scale(lat);
  return { lat, lng, halfM: Math.max(8, Math.hypot((Math.max(...lo) - Math.min(...lo)) * k.kx, (Math.max(...la) - Math.min(...la)) * k.ky) / 2), structure: sid, pts, box: { s: Math.min(...la), n: Math.max(...la), w: Math.min(...lo), e: Math.max(...lo) } };
}
// one persisted record per source the reviewer opened (the report lists them)
function avNote(id, patch) {
  let v = state.altViews.find((q) => q.id === id); if (!v) { v = { id, at: new Date().toISOString() }; state.altViews.push(v); }
  Object.assign(v, patch); return v;
}

// ------------------------------------------------------------------ panel shell
function avOpen(tab) {
  if (!state.key) { toast('Add the Google Maps key first', true); return; }
  AV.tgt = avTarget(); if (!AV.tgt) { toast('Find the property first', true); return; }
  AV.isOpen = true; $('#avPanel').hidden = false; avTab(tab || AV.tab);
}
function avClose() { AV.isOpen = false; AV.open3d = false; $('#avPanel').hidden = true; AV.active = { id: 'solar', label: 'Image used for the trace', date: null, georef: true }; if (typeof renderSelection === 'function') renderSelection(); }
function avTab(tab) {
  AV.tab = tab; AV.open3d = tab === '3d'; AV.pick = null;
  document.querySelectorAll('#avPanel [data-av]').forEach((b) => b.classList.toggle('active', b.dataset.av === tab));
  const st = $('#avStage'); for (const c of [...st.children]) c.hidden = true;
  if (tab === '3d') { avShow3d(); AV.active = { id: 'google3d', label: AV_3D.label, date: null, georef: false }; }
  else if (tab === 'dated') avShowDated();
  else avShowImport();
  avSide(); if (typeof renderSelection === 'function') renderSelection();
}
function avBadge(txt) { $('#avBadge').textContent = txt; }
function avBusy(msg) { AV.busy = msg || ''; const v = $('#avVeil'); v.hidden = !msg; v.textContent = msg || ''; }

// ------------------------------------------------------------------ 3D view
async function avShow3d() {
  const host = $('#av3d'); host.hidden = false; avBadge(`Source: ${AV_3D.label} - ${AV_3D.note}. Viewing aid: nothing is measured in this view.`);
  if (AV.map3d) { avFly('top', 0); avDraw3d(); return; }
  if (!document.createElement('canvas').getContext('webgl2')) { AV.cov = { ok: false, why: 'This browser has no WebGL 2 (hardware acceleration is off). The 3D view cannot be shown; use the dated imagery.' }; avSide(); return; }
  try {
    avBusy('Loading the 3D view...');
    AV.lib = AV.lib || await google.maps.importLibrary('maps3d');
    const t = AV.tgt; AV.cam.range = Math.max(45, Math.min(160, t.halfM * 3.4));
    const m = new AV.lib.Map3DElement({ center: { lat: t.lat, lng: t.lng, altitude: 0 }, range: AV.cam.range, tilt: 0, heading: 0, mode: 'SATELLITE', defaultUIHidden: false });
    AV.map3d = m; let first = true;
    const fail = setTimeout(() => { if (!AV.ready3d) { AV.cov = { ok: false, why: 'The 3D view did not load (key, network or graphics). Use the dated imagery.' }; avBusy(''); avSide(); } }, 30000);
    m.addEventListener('gmp-error', () => { AV.cov = { ok: false, why: 'The 3D view failed to start.' }; avBusy(''); avSide(); });
    m.addEventListener('gmp-steadychange', async (ev) => {
      if (!ev.isSteady || !first) return; first = false; clearTimeout(fail); AV.ready3d = true;
      try { await avCoverage(); } catch (e) { console.warn('3D coverage check failed', e); AV.cov = AV.cov || { ok: null, why: 'Coverage could not be checked.' }; }
      avFly('top', 0); avDraw3d(); avBusy(''); avSide();
    });
    m.addEventListener('gmp-click', (ev) => { if (ev.position) avClick3d(ev.position); });
    host.append(m);
  } catch (e) { console.warn(e); AV.cov = { ok: false, why: 'The 3D view could not be loaded: ' + (e.message || e) }; avBusy(''); avSide(); }
}
// height of the 3D surface under a point: fly there with the centre snapped to the mesh, then read the centre altitude
async function avMeshAlt(p) {
  const m = AV.map3d; m.flyCameraTo({ endCamera: { center: { lat: p.lat, lng: p.lng, altitude: 0 }, altitudeMode: 'RELATIVE_TO_MESH', range: 60, tilt: 0, heading: 0 }, durationMillis: 0 });
  for (let i = 0; i < 40; i++) { await avSleep(50); const c = m.center; if (c && Math.abs(c.lat - p.lat) < 2e-7 && Math.abs(c.lng - p.lng) < 2e-7) break; }
  await avSleep(70); return m.center ? m.center.altitude : null;
}
// Is there a 3D building here at all, and does the 3D model still have canopy over the hidden parts? A visibility check
// (roof height against the ground beside it, to the nearest couple of metres) - not a measurement.
async function avCoverage() {
  const t = AV.tgt, r = avRef() || { ...RM.scale(t.lat), lat: t.lat, lng: t.lng }; avBusy('Checking the 3D view for this building...');
  const roofPts = []; const fs = state.facets.filter((f) => !f.omit && !f.excluded && (f.structure || 1) === t.structure).map((f) => ({ f, a: facetMetrics(f).plan })).sort((a, b) => b.a - a.a).slice(0, 3);
  for (const { f } of fs) { const p = avPath(f.shape); roofPts.push({ lat: p.reduce((s, q) => s + q.lat, 0) / p.length, lng: p.reduce((s, q) => s + q.lng, 0) / p.length }); }
  if (!roofPts.length) roofPts.push({ lat: t.lat, lng: t.lng });
  const b = t.box || { s: t.lat - 8 / r.ky, n: t.lat + 8 / r.ky, w: t.lng - 8 / r.kx, e: t.lng + 8 / r.kx }; const dy = 4 / r.ky, dx = 4 / r.kx;
  const out = [{ lat: b.n + dy, lng: (b.w + b.e) / 2 }, { lat: b.s - dy, lng: (b.w + b.e) / 2 }, { lat: (b.s + b.n) / 2, lng: b.e + dx }, { lat: (b.s + b.n) / 2, lng: b.w - dx }];
  const ra = [], oa = []; for (const p of roofPts) { const a = await avMeshAlt(p); if (a != null) ra.push(a); } for (const p of out) { const a = await avMeshAlt(p); if (a != null) oa.push(a); }
  ra.sort((p, q) => p - q); const roof = ra[ra.length >> 1], ground = Math.min(...oa); const rise = roof - ground;
  AV.cov = rise >= 2 ? { ok: true, roofAlt: roof, ground, why: 'Photorealistic 3D model found for this building.' } : { ok: false, roofAlt: roof, ground, why: 'No photorealistic 3D building here (the view is flat imagery). Use the dated imagery.' };
  AV.alt = roof != null ? roof : 0;
  // hidden zones: canopy still there, a surface at roof height, or open ground?
  AV.cov.zones = [];
  if (AV.cov.ok) for (const z of (state.trace && state.trace.hiddenZones) || []) { const c = z.centre || z.path[0]; const st = Math.max(1, Math.floor(z.path.length / 4)); const pts = [c]; for (let i = 0; i < z.path.length && pts.length < 5; i += st) pts.push({ lat: (c.lat + z.path[i].lat) / 2, lng: (c.lng + z.path[i].lng) / 2 });
    let can = 0, sur = 0, n = 0; for (const p of pts) { const a = await avMeshAlt(p); if (a == null) continue; n++; const h = a - ground; if (h > rise + 2) can++; else if (h >= 1.8) sur++; }
    if (n) AV.cov.zones.push({ id: z.id, state: can ? 'canopy' : sur === n ? 'surface' : sur ? 'part' : 'ground' }); }
  const zs = AV.cov.zones; const txt = !AV.cov.ok ? 'No 3D building model at this address.' : zs.length ? zs.map((q) => `${q.id}: ${AV_ZONE[q.state]}`).join('. ') + '.' : 'Roof visible; no hidden zones to check.';
  avNote('google3d', { kind: '3d', label: AV_3D.label, date: null, georef: false, measurable: false, coverage: AV.cov.ok, result: txt + ' Not used for measurement.' });
}
function avFly(k, ms) {
  const v = AV_VIEWS[k], t = AV.tgt, m = AV.map3d; if (!m || !v) return; AV.cam.tilt = v.tilt; AV.cam.heading = v.heading; AV.seen.add(v.name);
  m.flyCameraTo({ endCamera: { center: { lat: t.lat, lng: t.lng, altitude: AV.alt || 0 }, range: AV.cam.range, tilt: v.tilt, heading: v.heading }, durationMillis: ms == null ? 900 : ms });
  const rec = state.altViews.find((q) => q.id === 'google3d'); if (rec) rec.views = [...AV.seen];
  document.querySelectorAll('#avSide [data-view]').forEach((b) => b.classList.toggle('active', b.dataset.view === k));
}
function avNudge(dh, dt) {
  const m = AV.map3d, t = AV.tgt; if (!m) return; AV.cam.heading = (((m.heading || 0) + dh) % 360 + 360) % 360; AV.cam.tilt = Math.max(0, Math.min(75, (m.tilt || 0) + dt)); AV.seen.add('free orbit');
  m.flyCameraTo({ endCamera: { center: { lat: t.lat, lng: t.lng, altitude: AV.alt || 0 }, range: m.range || AV.cam.range, tilt: AV.cam.tilt, heading: AV.cam.heading }, durationMillis: 500 });
}
// the traced roofline on the 3D model (0.25 m above the surface), so the reviewer can see where the sketch stops
function avDraw3d() {
  for (const el of AV.over) el.remove(); AV.over = []; const m = AV.map3d, L = AV.lib; if (!m || !L || !AV.showLines) return;
  const add = (el) => { m.append(el); AV.over.push(el); }; const sid = AV.tgt.structure;
  for (const e of state.edges) { if (e.omit || (e.structure || 1) !== sid) continue; const st = RM.statusOf(e), not = EDGE_TYPES[e.type].notRoof;
    add(new L.Polyline3DElement({ path: avPath(e.shape).map((p) => ({ lat: p.lat, lng: p.lng, altitude: 0.25 })), strokeColor: not ? '#ff3b30' : st === 'inferred' ? '#ffb300' : e.verify ? '#ff7ad9' : '#00e5ff', strokeWidth: not ? 2 : 4, outerColor: '#000000', outerWidth: 0.25, altitudeMode: 'RELATIVE_TO_MESH', drawsOccludedSegments: true })); }
  for (const z of (state.trace && state.trace.hiddenZones) || []) if ((z.structure || 1) === sid) add(new L.Polygon3DElement({ path: z.path.map((p) => ({ lat: p.lat, lng: p.lng, altitude: 0.3 })), strokeColor: '#ff3b30', strokeWidth: 2, fillColor: 'rgba(255,59,48,0.28)', altitudeMode: 'RELATIVE_TO_MESH', drawsOccludedSegments: true }));
}
// "Mark edge for verification": the click picks the nearest sketch line; a point with no line near it is logged as an
// edge the sketch does not have. Either way the 3D position is not turned into a length.
function avClick3d(pos) {
  if (!AV.markMode) return; const r = avRef(); if (!r) return; const p = avEN(pos, r); let best = null, bd = 3.0;
  for (const e of state.edges) { if (e.omit) continue; const pl = avPath(e.shape).map((q) => avEN(q, r)); for (let i = 1; i < pl.length; i++) { const d = RM.pointSeg(p, pl[i - 1], pl[i]); if (d < bd) { bd = d; best = e; } } }
  const dir = Object.values(AV_VIEWS).find((v) => v.tilt === AV.cam.tilt && v.heading === AV.cam.heading); const where = dir ? dir.name : 'free orbit';
  let label;
  if (best) { reviewMarkVerify('edge', best.id, AV_3D.label, '', `seen ${where}; ${AV_3D.note}`); label = 'verify ' + avLineKey(best); }
  else { reviewLog({ target: 'point', action: 'edge seen in the 3D view where the sketch has no line: marked for verification', source: AV_3D.label, date: '', note: `${where}; near ${pos.lat.toFixed(6)}, ${pos.lng.toFixed(6)}` }); label = 'verify: edge not in sketch'; recompute(); }
  const mk = new AV.lib.Marker3DElement({ position: { lat: pos.lat, lng: pos.lng, altitude: pos.altitude }, altitudeMode: 'ABSOLUTE', extruded: true, label, drawsWhenOccluded: true }); AV.map3d.append(mk); AV.marks.push(mk);
  avDraw3d(); avSide();
}

// ------------------------------------------------------------------ dated imagery: Google Solar datasets by quality tier
async function avTiers() {
  const main = state.solar; if (!main) return [];
  if (AV.tiers && AV.tiersFor === main.name) return AV.tiers;
  const lat = main.center.latitude, lng = main.center.longitude; const out = [];
  for (const q of ['HIGH', 'MEDIUM', 'LOW', 'BASE']) {
    try { const r = await fetch(`https://solar.googleapis.com/v1/buildingInsights:findClosest?location.latitude=${lat}&location.longitude=${lng}&requiredQuality=${q}&exactQualityRequired=true&key=${encodeURIComponent(state.key)}`);
      if (!r.ok) continue; const j = await r.json(); if (String(j.imageryQuality) !== q) continue;
      out.push({ id: 'solar:' + q, quality: q, date: avYmd(j.imageryDate), roofSqft: j.solarPotential && j.solarPotential.wholeRoofStats ? j.solarPotential.wholeRoofStats.areaMeters2 * 10.7639104 : null, bbox: j.boundingBox, same: j.name === main.name });
    } catch (_) { /* tier not available */ }
  }
  const cur = state.trace && state.trace.imageryQuality ? String(state.trace.imageryQuality) : String(main.imageryQuality || '');
  for (const t of out) { t.current = t.quality === cur; t.source = 'Google Solar API, ' + t.quality.toLowerCase() + ' quality'; }
  out.sort((a, b) => String(b.date).localeCompare(String(a.date))); AV.tiers = out; AV.tiersFor = main.name; return out;
}
// a colour raster as an off-screen canvas plus its pixel -> metre (east, north) mapping in the trace frame
function avRaster(T, r) {
  const { w, h, bands } = T; let cv = T.canvas;
  if (!cv) { cv = document.createElement('canvas'); cv.width = w; cv.height = h; const g = cv.getContext('2d'); const im = g.createImageData(w, h);
    for (let i = 0, j = 0; i < w * h; i++, j += 4) { im.data[j] = bands[0][i]; im.data[j + 1] = bands[1][i]; im.data[j + 2] = bands[2][i]; im.data[j + 3] = 255; }
    g.putImageData(im, 0, 0); }
  const o = avEN(T.toLL(0, 0), r), ex = avEN(T.toLL(w, 0), r), ey = avEN(T.toLL(0, h), r);
  return { cv, w, h, o, ux: (ex[0] - o[0]) / w, uy: (ex[1] - o[1]) / w, vx: (ey[0] - o[0]) / h, vy: (ey[1] - o[1]) / h };
}
function avBaseRaster() {
  if (AV.src.base && AV.src.baseFor === (state.trace && state.trace.tracedAt)) return AV.src.base;
  const cache = window.__layerCache || {}; const keys = Object.keys(cache).filter((k) => state.solar && k.startsWith(state.solar.name + '|')); const T = keys.length ? cache[keys[keys.length - 1]].rgbT : null; const r = avRef();
  AV.src.base = T && T.bands && r ? avRaster(T, r) : null; AV.src.baseFor = state.trace && state.trace.tracedAt; return AV.src.base;
}
// USDA NAIP aerial photos of this spot, newest first (public domain; listed through the Planetary Computer catalogue)
async function avNaipList() {
  const t = AV.tgt, key = t.lat.toFixed(5) + ',' + t.lng.toFixed(5); if (AV.naip && AV.naipFor === key) return AV.naip;
  const r = await fetch('https://planetarycomputer.microsoft.com/api/stac/v1/search', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ collections: ['naip'], intersects: { type: 'Point', coordinates: [t.lng, t.lat] }, limit: 100 }) });
  if (!r.ok) throw new Error('NAIP catalogue ' + r.status); const by = new Map();
  for (const f of ((await r.json()).features || [])) { const date = String(f.properties.datetime || '').slice(0, 10); if (!/^\d{4}-\d\d-\d\d$/.test(date)) continue; const b = f.bbox || [];
    const edge = b.length === 4 ? Math.min(t.lng - b[0], b[2] - t.lng, t.lat - b[1], b[3] - t.lat) : 0; const cur = by.get(date);          // tiles overlap: keep the one the house sits deepest in
    if (!cur || edge > cur.edge) by.set(date, { id: 'naip:' + date, item: String(f.id), date, gsd: +f.properties.gsd || 1, edge }); }
  AV.naip = [...by.values()].sort((a, b) => b.date.localeCompare(a.date)); AV.naipFor = key; return AV.naip;
}
async function avNaipLoad(n) {
  const t = AV.tgt, r = avRef(); const half = Math.max(30, t.halfM + 22); const dLat = half / r.ky, dLng = half / r.kx; const b = { s: t.lat - dLat, n: t.lat + dLat, w: t.lng - dLng, e: t.lng + dLng };
  const px = Math.max(256, Math.min(1024, Math.round(2 * half / Math.max(0.15, n.gsd) * 1.5)));
  const url = 'https://planetarycomputer.microsoft.com/api/data/v1/item/bbox/' + [b.w, b.s, b.e, b.n].map((v) => v.toFixed(7)).join(',') + '/' + px + 'x' + px + '.png?collection=naip&item=' + encodeURIComponent(n.item) + '&assets=image&asset_bidx=' + encodeURIComponent('image|1,2,3') + '&dst_crs=' + encodeURIComponent('epsg:3857') + '&resampling=bilinear';
  const im = await new Promise((res, rej) => { const i = new Image(); i.crossOrigin = 'anonymous'; i.onload = () => res(i); i.onerror = () => rej(new Error('the NAIP photo did not load')); i.src = url; });
  const cv = document.createElement('canvas'); cv.width = px; cv.height = px; const g = cv.getContext('2d'); g.drawImage(im, 0, 0, px, px);
  const a = g.getImageData(0, 0, px, px).data; let clear = 0; for (let i = 3; i < a.length; i += 4 * 97) if (a[i] < 8) clear++; if (clear > a.length / (4 * 97) * 0.2) throw new Error('that NAIP tile does not cover the building');
  const T = { w: px, h: px, canvas: cv, toLL: (x, y) => ({ lng: b.w + (b.e - b.w) * x / px, lat: b.n - (b.n - b.s) * y / px }) };
  return { naip: true, kind: 'naip', ras: avRaster(T, r), label: 'USDA NAIP aerial photo (public domain)', date: n.date, georef: true, heights: false, gsdM: n.gsd, nudge: [0, 0] };
}
// lengths are confirmed only on a georeferenced image sharp enough to place an edge (a height model, or 20 cm per pixel or finer)
const avCanMeasure = (s) => !!(s && s.georef && !(s.tier && s.tier.current) && (s.heights || (s.gsdM != null && s.gsdM <= 0.2)));
async function avShowDated() {
  $('#av2d').hidden = false; avBadge('Loading the list of dated images...');
  try { await avTiers(); } catch (e) { console.warn(e); }
  try { await avNaipList(); } catch (e) { console.warn(e); AV.naip = AV.naip || []; }
  const d = state.trace && state.trace.imageryDate ? avYmd(state.trace.imageryDate) : null;
  avBadge(`Left of the slider: image used for the trace${d ? ', flown ' + d : ''}. Right: pick an image in the list.`);
  const t = AV.tgt, r = avRef(); if (r) { const c = avEN(t, r); AV.v.cx = c[0]; AV.v.cy = c[1]; const cv = $('#avCanvas'); AV.v.s = Math.max(4, Math.min(cv.clientWidth, cv.clientHeight) / (2 * (t.halfM + 9))); }
  if (AV.sel && AV.src[AV.sel]) avSelect(AV.sel); else { const other = (AV.tiers || []).find((q) => !q.current && q.date); if (other) avSelect(other.id); else { avPaint(); avSide(); } }
}
async function avSelect(id) {
  const tier = (AV.tiers || []).find((q) => q.id === id), imp = AV.src[id] && AV.src[id].imported ? AV.src[id] : null, nz = (AV.naip || []).find((q) => q.id === id); AV.sel = id; AV.pick = null; AV.probe = AV.probe && AV.probe.id === id ? AV.probe : null;
  try {
    if (tier && !AV.src[id]) { avBusy('Downloading ' + tier.source + (tier.date ? ', flown ' + tier.date : '') + '...'); const main = state.solar; const A = await altLoadLayers(tier.quality, main.center.latitude, main.center.longitude, avRadius());
      AV.src[id] = { ras: A.rgbT ? avRaster(A.rgbT, avRef()) : null, label: tier.source, date: tier.date, georef: true, heights: true, tier }; }
    if (nz && !AV.src[id]) { avBusy('Downloading the USDA NAIP aerial photo flown ' + nz.date + '...'); AV.src[id] = await avNaipLoad(nz); }
  } catch (e) { toast('Could not load that image: ' + (e.message || e), true); } finally { avBusy(''); }
  const s = AV.src[id];
  if (s) { AV.active = { id, label: s.label, date: s.date, georef: avCanMeasure(s) }; avBadge(`Left: image used for the trace. Right: ${s.label}${s.date ? ', ' + s.date : ', date not reported'}${s.georef ? (avCanMeasure(s) ? '' : ' (too coarse to measure on: for checking the roof configuration)') : ' (not georeferenced: viewing aid)'}.`);
    if (!(tier && tier.current)) avNote(id, { kind: tier ? 'solar' : imp ? imp.kind : nz ? 'naip' : 'ortho', label: s.label, date: s.date, georef: !!s.georef, measurable: avCanMeasure(s), result: (state.altViews.find((q) => q.id === id) || {}).result || 'Compared with the image used for the trace.' }); }
  avPaint(); avSide(); if (typeof renderSelection === 'function') renderSelection();
}
// same radius rule as autoTraceRoof, so both datasets come back on one grid
function avRadius() { if (state.trace && state.trace.radius) return state.trace.radius; const bb = state.solar.boundingBox, c = state.solar.center; const k = RM.scale(c.latitude); const half = Math.hypot((bb.ne.longitude - bb.sw.longitude) * k.kx, (bb.ne.latitude - bb.sw.latitude) * k.ky) / 2; return Math.min(100, Math.max(15, Math.ceil(half + 12))); }
function avPaint() {
  const cv = $('#avCanvas'); if (!cv || cv.hidden) return; const dpr = window.devicePixelRatio || 1; const W = cv.clientWidth, H = cv.clientHeight; if (!W || !H) return;
  if (cv.width !== Math.round(W * dpr)) { cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); }
  const g = cv.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0); g.fillStyle = '#10161f'; g.fillRect(0, 0, W, H); const V = AV.v, r = avRef();
  const S = (p) => [W / 2 + (p[0] - V.cx) * V.s, H / 2 - (p[1] - V.cy) * V.s];
  const img = (R, x0, x1, nd) => { if (!R) return; const nx = nd ? nd[0] : 0, ny = nd ? nd[1] : 0; g.save(); g.beginPath(); g.rect(x0, 0, x1 - x0, H); g.clip(); g.imageSmoothingEnabled = true;
    g.transform(R.ux * V.s, -R.uy * V.s, R.vx * V.s, -R.vy * V.s, W / 2 + (R.o[0] + nx - V.cx) * V.s, H / 2 - (R.o[1] + ny - V.cy) * V.s); g.drawImage(R.cv, 0, 0); g.restore(); };
  const base = avBaseRaster(), sel = AV.sel && AV.src[AV.sel]; const sx = sel && sel.ras ? Math.round(W * V.swipe) : W;
  img(base, 0, sx); if (sel && sel.ras) img(sel.ras, sx, W, sel.nudge);
  if (!base) { g.fillStyle = '#9fb0c3'; g.font = '13px system-ui'; g.fillText('Auto-trace the roof first to load its image.', 16, 28); }
  if (r && V.lines) {
    for (const z of (state.trace && state.trace.hiddenZones) || []) { const ring = z.path.map((p) => avEN(p, r)); g.strokeStyle = '#ff5a4d'; g.lineWidth = 1; g.setLineDash([]); g.beginPath(); for (const sg of RM.hatch(ring, 0.6, 45)) { const a = S(sg[0]), b = S(sg[1]); g.moveTo(a[0], a[1]); g.lineTo(b[0], b[1]); } g.stroke();
      const c = S(avEN(z.centre || z.path[0], r)); g.font = 'bold 12px system-ui'; const tw = g.measureText(z.id).width; g.fillStyle = AV.pick && AV.pick.kind === 'zone' && AV.pick.id === z.id ? '#ffe08a' : '#fff'; g.fillRect(c[0] - tw / 2 - 4, c[1] - 9, tw + 8, 17); g.fillStyle = '#b3261e'; g.fillText(z.id, c[0] - tw / 2, c[1] + 4); }
    for (const e of state.edges) { if (e.omit || EDGE_TYPES[e.type].notRoof) continue; const pl = avPath(e.shape).map((p) => S(avEN(p, r))); const st = RM.statusOf(e), on = AV.pick && AV.pick.kind === 'edge' && AV.pick.id === e.id;
      g.strokeStyle = on ? '#ffffff' : EDGE_TYPES[e.type].color; g.lineWidth = on ? 4 : 2.2; g.setLineDash(st === 'inferred' ? [8, 5] : st === 'unresolved' ? [2, 4] : []); g.beginPath(); pl.forEach((p, i) => (i ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1]))); g.stroke(); }
    g.setLineDash([]);
  }
  // swipe handle and the two source labels
  const tag = (txt, x, right) => { g.font = 'bold 12px system-ui'; const tw = g.measureText(txt).width; const tx = right ? Math.min(W - tw - 14, Math.max(x + 8, 8)) : Math.max(8, Math.min(x - tw - 14, W - tw - 14)); g.fillStyle = 'rgba(12,32,52,.88)'; g.fillRect(tx - 5, 8, tw + 10, 21); g.fillStyle = '#fff'; g.fillText(txt, tx, 23); };
  const d0 = state.trace && state.trace.imageryDate ? avYmd(state.trace.imageryDate) : null;
  if (sel && sel.ras) { g.fillStyle = '#c9a227'; g.fillRect(sx - 1.5, 0, 3, H); g.beginPath(); g.arc(sx, H / 2, 11, 0, 7); g.fill(); g.fillStyle = '#12304a'; g.font = 'bold 13px system-ui'; g.fillText('<>', sx - 8, H / 2 + 4.5);
    tag('Trace image' + (d0 ? '  ' + d0 : ''), sx, false); tag((sel.date || 'date not reported') + '  ' + sel.label, sx, true); }
  else if (base) tag('Trace image' + (d0 ? '  ' + d0 : ''), W, false);
  // scale bar
  const ft = [10, 20, 40, 50, 100].reduce((b, q) => (Math.abs(q / RM.FT * V.s - 90) < Math.abs(b / RM.FT * V.s - 90) ? q : b), 10); const bl = ft / RM.FT * V.s; g.fillStyle = 'rgba(255,255,255,.9)'; g.fillRect(10, H - 26, bl + 48, 18); g.fillStyle = '#12304a'; g.fillRect(16, H - 18, bl, 3); g.font = '11px system-ui'; g.fillText(ft + ' ft', bl + 22, H - 13);
  g.fillStyle = 'rgba(255,255,255,.9)'; g.beginPath(); g.arc(W - 22, H - 24, 14, 0, 7); g.fill(); g.fillStyle = '#12304a'; g.beginPath(); g.moveTo(W - 22, H - 36); g.lineTo(W - 27, H - 20); g.lineTo(W - 17, H - 20); g.fill(); g.font = 'bold 9px system-ui'; g.fillText('N', W - 25, H - 12);
}
function avCanvasWire() {
  const cv = $('#avCanvas'); let drag = null;
  const pos = (ev) => { const b = cv.getBoundingClientRect(); return [ev.clientX - b.left, ev.clientY - b.top]; };
  cv.addEventListener('pointerdown', (ev) => { const p = pos(ev), W = cv.clientWidth; const sx = W * AV.v.swipe; drag = { p, moved: false, swipe: AV.sel && AV.src[AV.sel] && AV.src[AV.sel].ras && Math.abs(p[0] - sx) < 14, cx: AV.v.cx, cy: AV.v.cy }; cv.setPointerCapture(ev.pointerId); });
  cv.addEventListener('pointermove', (ev) => { if (!drag) return; const p = pos(ev); if (Math.hypot(p[0] - drag.p[0], p[1] - drag.p[1]) > 3) drag.moved = true;
    if (drag.swipe) AV.v.swipe = Math.max(0.02, Math.min(0.98, p[0] / cv.clientWidth)); else if (drag.moved) { AV.v.cx = drag.cx - (p[0] - drag.p[0]) / AV.v.s; AV.v.cy = drag.cy + (p[1] - drag.p[1]) / AV.v.s; } avPaint(); });
  cv.addEventListener('pointerup', (ev) => { const d = drag; drag = null; if (!d || d.moved || d.swipe) return; avPick(pos(ev)); });
  cv.addEventListener('wheel', (ev) => { ev.preventDefault(); const p = pos(ev), W = cv.clientWidth, H = cv.clientHeight; const e0 = AV.v.cx + (p[0] - W / 2) / AV.v.s, n0 = AV.v.cy - (p[1] - H / 2) / AV.v.s; AV.v.s = Math.max(2, Math.min(80, AV.v.s * (ev.deltaY < 0 ? 1.2 : 1 / 1.2))); AV.v.cx = e0 - (p[0] - W / 2) / AV.v.s; AV.v.cy = n0 + (p[1] - H / 2) / AV.v.s; avPaint(); }, { passive: false });
  window.addEventListener('resize', () => { if (AV.isOpen && AV.tab !== '3d') avPaint(); });
}
function avPick(p) {
  const cv = $('#avCanvas'), r = avRef(); if (!r) return; const W = cv.clientWidth, H = cv.clientHeight; const q = [AV.v.cx + (p[0] - W / 2) / AV.v.s, AV.v.cy - (p[1] - H / 2) / AV.v.s];
  let best = null, bd = 9 / AV.v.s;
  for (const e of state.edges) { if (e.omit || EDGE_TYPES[e.type].notRoof) continue; const pl = avPath(e.shape).map((v) => avEN(v, r)); for (let i = 1; i < pl.length; i++) { const d = RM.pointSeg(q, pl[i - 1], pl[i]); if (d < bd) { bd = d; best = { kind: 'edge', id: e.id }; } } }
  if (!best) for (const z of (state.trace && state.trace.hiddenZones) || []) { const ring = z.path.map((v) => avEN(v, r)); let c = false; for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) if ((ring[i][1] > q[1]) !== (ring[j][1] > q[1]) && q[0] < (ring[j][0] - ring[i][0]) * (q[1] - ring[i][1]) / (ring[j][1] - ring[i][1]) + ring[i][0]) c = !c; if (c) best = { kind: 'zone', id: z.id }; }
  AV.pick = best; avPaint(); avSide();
}
// check the picked dataset against the roof the trace can see; nothing changes in the sketch
async function avProbe() {
  const s = AV.src[AV.sel]; if (!s || !s.tier) return;
  try { avBusy('Comparing the two datasets where the roof is clearly visible...'); const res = await autoTraceRoof({ altProbe: { quality: s.tier.quality, bbox: s.tier.bbox }, quiet: true });
    AV.probe = { id: AV.sel, ...res.alt, zones: res.hiddenZones.length }; const c = res.alt.check;
    reviewLog({ target: 'roof', action: c.ok ? 'roof configuration check passed' : 'roof configuration check failed: not carried into the sketch', source: s.label, date: s.date || '', note: c.ok ? `heights agree on ${c.heightAgreePct.toFixed(0)}% of the visible roof; outline ${c.outlineAgreePct.toFixed(0)}%` : c.reasons.join(' ') });
    if (!c.ok) avNote(AV.sel, { result: 'Configuration check failed: ' + c.reasons.join(' ') + ' Nothing carried into the sketch.' });
  } catch (e) { toast('Check failed: ' + (e.message || e), true); } finally { avBusy(''); avSide(); recompute(); }
}
// the reviewer confirmed the configuration: use the dataset for the canopy-covered part and re-trace
async function avCarry() {
  const s = AV.src[AV.sel], pr = AV.probe; if (!s || !pr || pr.id !== AV.sel || !pr.check.ok) return;
  if (!$('#avCfg').checked) { toast('Tick the box first: compare both images and confirm it is the same roof', true); return; }
  if (state.facets.some((f) => f.edited) && !window.__rmNoConfirm && !confirm('Re-tracing replaces hand edits to facets and lines. Continue?')) return;
  const note = $('#avNoteTxt').value.trim(); const before = { zones: ((state.trace && state.trace.hiddenZones) || []).length, t: computeTotals() };
  try { avBusy('Re-tracing with ' + s.label + ' for the canopy-covered part...');
    state.altFusion = { quality: s.tier.quality, bbox: s.tier.bbox, date: s.date, label: s.label, approved: { at: new Date().toISOString(), note } };
    const info = await autoTraceRoof({ quiet: true }); const a = info.alt; const t = computeTotals();
    if (!a || !a.used) { state.altFusion = null; await autoTraceRoof({ quiet: true }); toast('Not carried over: the configuration check did not pass on re-trace', true); return; }
    const src = { source: s.label, date: s.date || '' }; const el = state.edges.filter((e) => e.confirmedBy && e.confirmedBy.source === s.label), fl = state.facets.filter((f) => f.confirmedBy && f.confirmedBy.source === s.label);
    const res = `Same roof configuration (check passed, reviewer confirmed). Carried into the sketch: ${Math.round(fl.reduce((q, f) => q + (f.altSqft || 0), 0))} sq ft on ${fl.length} facet${fl.length === 1 ? '' : 's'} and ${el.length} line${el.length === 1 ? '' : 's'}. Hidden zones ${before.zones} -> ${t.hiddenZones.length}.`;
    avNote(AV.sel, { kind: 'solar', label: s.label, date: s.date, georef: true, measurable: true, used: true, result: res });
    reviewLog({ target: 'roof', action: 'edges under canopy carried into the sketch from a second dated dataset', ...src, note: note || res });
    AV.src.base = null; toast('Sketch updated from ' + s.label + (s.date ? ', ' + s.date : ''));
  } catch (e) { state.altFusion = null; toast('Could not use that dataset: ' + (e.message || e), true); } finally { avBusy(''); AV.tgt = avTarget(); avPaint(); avSide(); recompute(); }
}
async function avUncarry() { state.altFusion = null; try { avBusy('Re-tracing from the first image alone...'); await autoTraceRoof({ quiet: true }); const v = state.altViews.find((q) => q.used); if (v) { v.used = false; v.result = 'Compared; no longer used for the sketch.'; } reviewLog({ target: 'roof', action: 'second dataset removed from the sketch', source: '', date: '', note: '' }); } finally { avBusy(''); AV.src.base = null; avPaint(); avSide(); recompute(); } }

// ------------------------------------------------------------------ import: the company's own authorised imagery
async function avImport(file, name, date, authorised) {
  if (!file) return; if (!name) { toast('Name the source (who flew or supplied this image)', true); return; }
  if (!authorised) { toast('Only import imagery the company is authorised to use', true); return; }
  const id = 'import:' + (Object.keys(AV.src).filter((k) => k.startsWith('import:')).length + 1); const isTif = /\.tiff?$/i.test(file.name);
  try {
    avBusy('Reading ' + file.name + '...'); const buf = await file.arrayBuffer(); const r = avRef(), t = AV.tgt;
    if (isTif) {
      const tiff = await GeoTIFF.fromArrayBuffer(buf); const img = await tiff.getImage(); const W = img.getWidth(), H = img.getHeight(); const keys = img.getGeoKeys ? (img.getGeoKeys() || {}) : {};
      let ox, oy, rx, ry; try { [ox, oy] = img.getOrigin(); [rx, ry] = img.getResolution(); } catch (_) { throw new Error('This TIFF has no georeference. Export it as a GeoTIFF, or import it as a photo (JPG/PNG) to use it as a viewing aid.'); }
      const epsg = keys.ProjectedCSTypeGeoKey || keys.GeographicTypeGeoKey || 4326; const sy = ry > 0 ? -ry : ry; let def = null;
      if (!(epsg === 4326 || Math.abs(ox) <= 360)) { if (epsg >= 32601 && epsg <= 32660) def = `+proj=utm +zone=${epsg - 32600} +datum=WGS84 +units=m +no_defs`; else if (epsg >= 32701 && epsg <= 32760) def = `+proj=utm +zone=${epsg - 32700} +south +datum=WGS84 +units=m +no_defs`; else if (epsg >= 26901 && epsg <= 26923) def = `+proj=utm +zone=${epsg - 26900} +datum=NAD83 +units=m +no_defs`; else if (epsg === 3857) def = 'EPSG:3857'; else throw new Error('Unsupported projection EPSG:' + epsg + '. Export the image in WGS84, UTM or Web Mercator.'); }
      const fwd = (v) => (def ? proj4('EPSG:4326', def, [v.lng, v.lat]) : [v.lng, v.lat]); const inv = (X, Y) => { if (!def) return { lng: X, lat: Y }; const p = proj4(def, 'EPSG:4326', [X, Y]); return { lng: p[0], lat: p[1] }; };
      // read only the window around the building (orthomosaics are large), reduced to at most 2400 pixels a side
      const pad = (t.halfM + 30); const cs = [[-pad, -pad], [pad, -pad], [pad, pad], [-pad, pad]].map(([e, n]) => fwd({ lat: t.lat + n / r.ky, lng: t.lng + e / r.kx })).map(([X, Y]) => [(X - ox) / rx, (Y - oy) / sy]);
      const x0 = Math.max(0, Math.floor(Math.min(...cs.map((c) => c[0])))), x1 = Math.min(W, Math.ceil(Math.max(...cs.map((c) => c[0])))), y0 = Math.max(0, Math.floor(Math.min(...cs.map((c) => c[1])))), y1 = Math.min(H, Math.ceil(Math.max(...cs.map((c) => c[1]))));
      if (x1 - x0 < 8 || y1 - y0 < 8) throw new Error('This image does not cover the building.');
      const k = Math.max(1, Math.ceil(Math.max(x1 - x0, y1 - y0) / 2400)); const w = Math.floor((x1 - x0) / k), h = Math.floor((y1 - y0) / k);
      const ras = await img.readRasters({ window: [x0, y0, x1, y1], width: w, height: h }); const n = ras.length; const to8 = (b) => { if (b instanceof Uint8Array) return b; let mx = 1; for (let i = 0; i < b.length; i += 7) if (b[i] > mx) mx = b[i]; const o = new Uint8Array(b.length); for (let i = 0; i < b.length; i++) o[i] = Math.max(0, Math.min(255, b[i] / mx * 255)); return o; };
      const bands = n >= 3 ? [to8(ras[0]), to8(ras[1]), to8(ras[2])] : [to8(ras[0]), to8(ras[0]), to8(ras[0])];
      const T = { w, h, bands, toLL: (x, y) => inv(ox + (x0 + x * k) * rx, oy + (y0 + y * k) * sy) }; const fd = img.fileDirectory || {}; const tagDate = fd.DateTime ? String(fd.DateTime).slice(0, 10).replace(/:/g, '-') : '';
      AV.src[id] = { imported: true, kind: 'ortho', ras: avRaster(T, r), label: name, date: date || tagDate || null, georef: true, heights: false, gsdM: Math.abs(rx) * k * (def ? 1 : r.kx), nudge: [0, 0] };
      reviewLog({ target: 'source', action: 'georeferenced image imported (authorised by the reviewer)', source: name, date: date || tagDate || '', note: file.name });
      AV.tab = 'dated'; avTab('dated'); await avSelect(id);
    } else {
      const url = URL.createObjectURL(file); const exif = avExifDate(buf);
      AV.src[id] = { imported: true, kind: 'photo', url, label: name, date: date || exif || null, georef: false, heights: false }; AV.photo = id; AV.sel = id;
      AV.active = { id, label: name, date: date || exif || null, georef: false };
      avNote(id, { kind: 'photo', label: name, date: date || exif || null, georef: false, measurable: false, result: 'Photo without georeference: viewing aid only. Not used for measurement.' });
      reviewLog({ target: 'source', action: 'photo imported as a viewing aid (authorised by the reviewer)', source: name, date: date || exif || '', note: file.name });
      avShowImport(); avSide(); recompute();
    }
  } catch (e) { toast('Import failed: ' + (e.message || e), true); } finally { avBusy(''); }
}
// EXIF DateTimeOriginal (or DateTime) of a JPEG, as YYYY-MM-DD
function avExifDate(buf) {
  try { const b = new Uint8Array(buf.slice(0, 131072)); let s = ''; for (let i = 0; i < b.length; i++) s += b[i] > 31 && b[i] < 127 ? String.fromCharCode(b[i]) : ' '; const m = s.match(/(20\d\d|19\d\d):(\d\d):(\d\d) \d\d:\d\d:\d\d/); return m ? `${m[1]}-${m[2]}-${m[3]}` : null; } catch (_) { return null; }
}
function avShowImport() {
  const ph = $('#avPhoto'); const s = AV.photo && AV.src[AV.photo];
  if (s) { ph.hidden = false; ph.innerHTML = `<img src="${s.url}" alt="imported photo">`; avBadge(`Source: ${s.label}${s.date ? ', ' + s.date : ', date not reported'}. Not georeferenced: viewing aid only.`); }
  else { $('#av2d').hidden = false; avBadge('Import imagery the company is authorised to use. A georeferenced GeoTIFF can be compared and used to confirm edges; a plain photo is a viewing aid.'); avPaint(); }
}

// ------------------------------------------------------------------ side panel
function avSide() {
  const el = $('#avSide'); if (!el) return; let h = ''; const zones = (state.trace && state.trace.hiddenZones) || [];
  const open = () => { const ob = state.edges.filter((e) => !e.omit && EDGE_TYPES[e.type].notRoof).length, inf = state.edges.filter((e) => !e.omit && RM.statusOf(e) === 'inferred').length;
    return `<h4>Open items in the sketch</h4><div class="muted small">${zones.length ? zones.length + ' hidden zone' + (zones.length > 1 ? 's' : '') + ' (' + zones.map((z) => esc(z.id)).join(', ') + ')' : 'No hidden zones'}; ${ob} obstruction boundar${ob === 1 ? 'y' : 'ies'}; ${inf} inferred line${inf === 1 ? '' : 's'}; ${state.edges.filter((e) => e.verify).length} marked for verification.</div>`; };
  if (AV.tab === '3d') {
    const c = AV.cov; const dis = !AV.ready3d || (c && c.ok === false) ? 'disabled' : '';
    h += `<h4>Views</h4><div class="av-views">${Object.entries(AV_VIEWS).map(([k, v]) => `<button class="small" data-view="${k}" ${dis}>${k === 'top' ? 'Overhead' : 'From ' + v.name.split(' ')[1]}</button>`).join('')}</div>
      <div class="av-views"><button class="small ghost" data-nudge="-30,0" ${dis}>Rotate left</button><button class="small ghost" data-nudge="30,0" ${dis}>Rotate right</button><button class="small ghost" data-nudge="0,10" ${dis}>Tilt more</button><button class="small ghost" data-nudge="0,-10" ${dis}>Tilt less</button></div>
      <div class="muted small">Free orbit: drag to move, Shift + drag (or the on-map controls) to rotate and tilt, wheel to zoom.</div>
      <label class="chk"><input type="checkbox" id="avLines" ${AV.showLines ? 'checked' : ''}> Show the traced roofline on the model</label>
      <label class="chk"><input type="checkbox" id="avMark" ${AV.markMode ? 'checked' : ''} ${dis}> Mark edge for verification (click the edge in the view)</label>
      <h4>What this view is</h4><div class="small">${esc(AV_3D.label)}; ${esc(AV_3D.note)}. ${c ? esc(c.why) : 'Loading...'}</div>
      ${c && c.zones && c.zones.length ? `<div class="list" style="margin-top:6px">${c.zones.map((z) => `<div class="item"><span><b>${esc(z.id)}</b> ${AV_ZONE[z.state]}</span></div>`).join('')}</div>` : ''}
      <div class="muted small" style="margin-top:6px">Use the tilted views to look for hidden eaves, corners and roof levels. This model is too coarse to measure on and Google does not allow tracing from it: an edge you can see here but cannot measure is marked for verification, and lengths come from georeferenced overhead imagery (Dated imagery, Import).</div>`;
    const marks = state.edges.filter((e) => e.verify && e.verify.source === AV_3D.label);
    if (marks.length) h += `<h4>Marked in this view</h4><div class="list">${marks.map((e) => `<div class="item"><span><b>${esc(avLineKey(e))}</b> ${esc(EDGE_TYPES[e.type].label)}</span><span class="right"><button class="small ghost" data-unverify="${e.id}">Clear</button></span></div>`).join('')}</div>`;
    h += open();
  } else if (AV.tab === 'dated') {
    const d0 = state.trace && state.trace.imageryDate ? avYmd(state.trace.imageryDate) : null;
    h += '<h4>Dated images of this building</h4>';
    if (!AV.tiers) h += '<div class="muted small">Loading...</div>';
    else { const rows = AV.tiers.map((t) => { const newer = d0 && t.date && t.date > d0, older = d0 && t.date && t.date < d0; const yrs = d0 && t.date ? Math.abs((new Date(t.date) - new Date(d0)) / 3.15576e10) : null;
        return `<div class="item ${AV.sel === t.id ? 'sel' : ''}"><span><b>${esc(t.date || 'date not reported')}</b> ${esc(t.source)}<br><span class="muted small">${t.current ? 'used for the current trace' : (newer ? yrs.toFixed(1) + ' years newer' : older ? yrs.toFixed(1) + ' years older' : 'same date')}${t.same ? '' : '; Google lists it as a different building record'}${t.roofSqft ? '; Google roof estimate ' + Math.round(t.roofSqft).toLocaleString() + ' sq ft' : ''}</span></span><span class="right">${t.current ? '' : `<button class="small" data-src="${t.id}">${AV.sel === t.id ? 'Shown' : 'Compare'}</button>`}</span></div>`; });
      for (const [id, s] of Object.entries(AV.src)) if (s && s.imported && s.kind === 'ortho') rows.push(`<div class="item ${AV.sel === id ? 'sel' : ''}"><span><b>${esc(s.date || 'date not reported')}</b> ${esc(s.label)}<br><span class="muted small">imported, georeferenced${s.gsdM ? ', ' + (s.gsdM * 100).toFixed(0) + ' cm per pixel' : ''}</span></span><span class="right"><button class="small" data-src="${id}">${AV.sel === id ? 'Shown' : 'Compare'}</button></span></div>`);
      for (const n of AV.naip || []) { const newer = d0 && n.date > d0; const yrs = d0 ? Math.abs((new Date(n.date) - new Date(d0)) / 3.15576e10) : null;
        rows.push(`<div class="item ${AV.sel === n.id ? 'sel' : ''}"><span><b>${esc(n.date)}</b> USDA NAIP aerial photo<br><span class="muted small">${yrs == null ? '' : yrs.toFixed(1) + (newer ? ' years newer; ' : ' years older; ')}public domain; ${Math.round(n.gsd * 100)} cm per pixel: shows the roof and the trees, too coarse to measure on</span></span><span class="right"><button class="small" data-src="${n.id}">${AV.sel === n.id ? 'Shown' : 'Compare'}</button></span></div>`); }
      h += `<div class="list">${rows.join('')}</div>`;
      if (AV.tiers.filter((t) => !t.current).length === 0) h += '<div class="muted small" style="margin-top:4px">Google has no other dated dataset for this building. Import the company\'s own imagery if a newer or leaf-off image exists.</div>'; }
    h += `<label class="chk" style="margin-top:6px"><input type="checkbox" id="avLines2" ${AV.v.lines ? 'checked' : ''}> Show the traced roofline</label><div class="muted small">Drag the gold handle to swipe between the two images. Wheel to zoom, drag to move. Click a line or a hatched zone to act on it.</div>`;
    const s = AV.sel && AV.src[AV.sel];
    if (s && s.nudge) h += `<h4>Line up the right-hand image</h4><div class="small">Photos from another source can sit a few feet off. Move it until roof corners visible in both images meet (1 ft steps).</div><div class="av-views" style="margin-top:6px"><button class="small ghost" data-nudge2="-0.3048,0">Left</button><button class="small ghost" data-nudge2="0.3048,0">Right</button><button class="small ghost" data-nudge2="0,0.3048">Up</button><button class="small ghost" data-nudge2="0,-0.3048">Down</button><button class="small ghost" data-nudge2="reset">Reset</button></div><div class="muted small">Moved ${(Math.hypot(s.nudge[0], s.nudge[1]) * RM.FT).toFixed(0)} ft.</div>`;
    if (s && s.tier && !s.tier.current) {
      const used = state.altFusion && state.altFusion.quality === s.tier.quality && state.trace && state.trace.alt && state.trace.alt.used; const pr = AV.probe && AV.probe.id === AV.sel ? AV.probe : (used ? state.trace.alt : null);
      h += `<h4>Use this image for the hidden part</h4><div class="small">This dataset has its own height model. If it shows the same roof, the part the trace image has under tree canopy can be measured from it.</div>`;
      if (pr) { const c = pr.check; const row = (k, v, ok) => `<tr><td>${k}</td><td class="num" style="color:${ok ? 'inherit' : '#ff8a80'}">${v}</td></tr>`;
        h += `<table class="tbl small" style="margin-top:6px">${row('Visible roof compared', Math.round(c.roofSqft).toLocaleString() + ' sq ft', c.roofSqft >= 160)}${c.heightAgreePct != null ? row('Same height, away from edges', c.heightAgreePct.toFixed(0) + '%', c.heightAgreePct >= 80) + row('Inside the other outline', c.outlineAgreePct.toFixed(0) + '%', c.outlineAgreePct >= 85) + row('Roof height change', c.heightChangeM == null ? 'n/a' : (Math.abs(c.heightChangeM) * RM.FT).toFixed(1) + ' ft', c.heightChangeM == null || Math.abs(c.heightChangeM) <= 0.5) + row('Offset corrected', (c.shiftM * RM.FT).toFixed(1) + ' ft', true) + (c.tiltPer10m != null ? row('Tilt corrected', (c.tiltPer10m * 12).toFixed(1) + ' in. per 10 ft', c.tiltPer10m <= 1.2) : '') : ''}</table>
          <div class="small" style="margin-top:4px;color:${c.ok ? '#8fd694' : '#ff8a80'}"><b>${c.ok ? 'Same roof configuration where both can see it.' : 'Not the same roof: ' + esc(c.reasons.join(' '))}</b></div>`;
        if (used) h += `<div class="small" style="margin-top:6px">In use: ${Math.round(state.trace.alt.usedSqft || 0).toLocaleString()} sq ft of roof under the canopy was measured on this dataset.</div><div class="row" style="margin-top:6px"><button id="avUncarry" class="small ghost">Stop using this image</button></div>`;
        else if (c.ok) h += `<label class="chk" style="margin-top:6px"><input type="checkbox" id="avCfg"> I compared both images: it is the same roof (same ridges and levels, no addition or removal)</label><label style="display:block;margin-top:4px">Note <input id="avNoteTxt" type="text" placeholder="what changed between the dates (e.g. tree removed)"></label><div class="row" style="margin-top:6px"><button id="avCarry" class="primary small">Carry edges into the sketch</button></div>`;
        else h += '<div class="muted small" style="margin-top:4px">Nothing is carried over. If the roof was changed, trace the changed part by hand on this image.</div>';
      } else h += `<div class="row" style="margin-top:6px"><button id="avProbe" class="primary small">Check roof configuration</button></div>`;
    }
    if (AV.pick) h += avPickHtml(s);
    h += open();
  } else {
    h += `<h4>Import imagery</h4><div class="small">Drone orthomosaic, licensed provider export or public-record aerial that the company is authorised to use.</div>
      <label style="display:block;margin-top:6px">Source <input id="avImpName" type="text" placeholder="who flew or supplied it"></label>
      <label style="display:block;margin-top:4px">Image date <input id="avImpDate" type="text" placeholder="YYYY-MM-DD (read from the file when present)"></label>
      <label class="chk" style="margin-top:4px"><input type="checkbox" id="avImpOk"> We are authorised to use this imagery</label>
      <input id="avImpFile" type="file" accept=".tif,.tiff,.jpg,.jpeg,.png" style="margin-top:6px">
      <div class="muted small" style="margin-top:6px"><b>GeoTIFF with a georeference</b> (WGS84, UTM or Web Mercator): compared by swipe and usable to confirm an edge. <b>JPG / PNG photo</b> (oblique or drone): viewing aid; an edge it shows can be marked for verification, not measured.</div>`;
    const s = AV.photo && AV.src[AV.photo];
    if (s) { const items = [...zones.map((z) => ['zone:' + z.id, z.id + ' hidden zone']), ...state.edges.filter((e) => !e.omit && !EDGE_TYPES[e.type].notRoof && (RM.statusOf(e) !== 'measured')).map((e) => ['edge:' + e.id, avLineKey(e) + ' ' + EDGE_TYPES[e.type].label + ' (inferred)'])];
      h += `<h4>${esc(s.label)}${s.date ? ', ' + esc(s.date) : ''}</h4><div class="small">Not georeferenced. What does this photo show?</div><label style="display:block;margin-top:4px">Item <select id="avPhItem">${items.map(([v, t]) => `<option value="${v}">${esc(t)}</option>`).join('') || '<option value="">nothing open</option>'}</select></label><label style="display:block;margin-top:4px">Note <input id="avPhNote" type="text" placeholder="what the photo shows"></label><div class="row" style="margin-top:6px"><button id="avPhVerify" class="small">Mark for verification</button></div>`; }
    h += open();
  }
  el.innerHTML = h;
  el.querySelectorAll('[data-view]').forEach((b) => { b.onclick = () => avFly(b.dataset.view); });
  el.querySelectorAll('[data-nudge]').forEach((b) => { b.onclick = () => { const [a, c] = b.dataset.nudge.split(',').map(Number); avNudge(a, c); }; });
  el.querySelectorAll('[data-src]').forEach((b) => { b.onclick = () => avSelect(b.dataset.src); });
  el.querySelectorAll('[data-nudge2]').forEach((b) => { b.onclick = () => { const s2 = AV.src[AV.sel]; if (!s2 || !s2.nudge) return; if (b.dataset.nudge2 === 'reset') s2.nudge = [0, 0]; else { const [dx, dy] = b.dataset.nudge2.split(',').map(Number); s2.nudge = [s2.nudge[0] + dx, s2.nudge[1] + dy]; }
    const v = state.altViews.find((q) => q.id === AV.sel); if (v) v.aligned = `moved ${(Math.hypot(s2.nudge[0], s2.nudge[1]) * RM.FT).toFixed(0)} ft by the reviewer to line up with the trace image`; avPaint(); avSide(); }; });
  el.querySelectorAll('[data-unverify]').forEach((b) => { b.onclick = () => { const e = state.edges.find((q) => q.id === +b.dataset.unverify); if (e) { e.verify = null; recompute(); avDraw3d(); avSide(); } }; });
  const on = (id, ev, fn) => { const q = $(id); if (q) q[ev] = fn; };
  on('#avLines', 'onchange', (e) => { AV.showLines = e.target.checked; avDraw3d(); }); on('#avMark', 'onchange', (e) => { AV.markMode = e.target.checked; });
  on('#avLines2', 'onchange', (e) => { AV.v.lines = e.target.checked; avPaint(); });
  on('#avProbe', 'onclick', avProbe); on('#avCarry', 'onclick', avCarry); on('#avUncarry', 'onclick', avUncarry);
  on('#avImpFile', 'onchange', (e) => avImport(e.target.files[0], $('#avImpName').value.trim(), $('#avImpDate').value.trim(), $('#avImpOk').checked));
  on('#avPhVerify', 'onclick', () => { const v = $('#avPhItem').value, s = AV.src[AV.photo]; if (!v || !s) return; const [k, id] = v.split(':'); const note = $('#avPhNote').value.trim();
    if (k === 'edge') reviewMarkVerify('edge', +id, s.label, s.date || '', note); else { reviewLog({ target: id, action: 'seen in a photo that cannot be measured: marked for verification', source: s.label, date: s.date || '', note }); recompute(); } avSide(); });
  on('#avPkConfirm', 'onclick', () => { const s = AV.src[AV.sel]; if (AV.pick && s) { reviewConfirm('edge', AV.pick.id, s.label, s.date || '', ($('#avPkNote') || {}).value || ''); avPaint(); avSide(); } });
  on('#avPkVerify', 'onclick', () => { const s = AV.src[AV.sel] || { label: 'Image used for the trace', date: '' }; if (AV.pick) { reviewMarkVerify('edge', AV.pick.id, s.label, s.date || '', ($('#avPkNote') || {}).value || ''); avPaint(); avSide(); } });
  on('#avPkZone', 'onclick', async () => { const s = AV.src[AV.sel]; if (!AV.pick || !s) return; if (!$('#avPkCfg').checked) { toast('Tick the box first: the roof in that image must be the same configuration', true); return; } await reviewAcceptZone(AV.pick.id, s.label, s.date || '', true, ($('#avPkNote') || {}).value || ''); AV.pick = null; AV.src.base = null; avPaint(); avSide(); });
}
function avPickHtml(s) {
  if (AV.pick.kind === 'edge') { const e = state.edges.find((q) => q.id === AV.pick.id); if (!e) return ''; const m = edgeMetrics(e), st = RM.statusOf(e); const can = avCanMeasure(s);
    return `<h4>${esc(avLineKey(e))}: ${esc(EDGE_TYPES[e.type].label)}, ${m.trueFt.toFixed(1)} ft, ${st}</h4>${e.confirmedBy ? `<div class="small">Located on ${esc(e.confirmedBy.source || e.confirmedBy)}${e.confirmedBy.date ? ', ' + esc(e.confirmedBy.date) : ''}.</div>` : ''}${e.verify ? `<div class="small">Marked for verification (${esc(e.verify.source)}).</div>` : ''}
      <label style="display:block;margin-top:4px">Note <input id="avPkNote" type="text" placeholder="what you see"></label><div class="row wrap" style="margin-top:6px;gap:6px">${st !== 'measured' ? `<button id="avPkConfirm" class="small" ${can ? '' : 'disabled'} title="${can ? 'The line lies on the roof edge in the image on the right' : 'This image cannot place an edge: use a height-model dataset or an image of 20 cm per pixel or finer'}">Confirm on this image</button>` : ''}<button id="avPkVerify" class="small ghost">Mark for verification</button></div>`; }
  const z = ((state.trace && state.trace.hiddenZones) || []).find((q) => q.id === AV.pick.id); if (!z) return ''; const can = s && s.georef && !(s.tier && s.tier.current);
  return `<h4>${esc(z.id)}: hidden zone, 0 to ${Math.round(z.upperSqft).toLocaleString()} sq ft</h4><div class="small">Nothing in the trace image shows whether roof continues here.${s && s.heights ? ' For a dataset with a height model, use "Check roof configuration" above: it measures the hidden part instead of estimating it.' : ''}</div>
    ${can ? `<label class="chk" style="margin-top:4px"><input type="checkbox" id="avPkCfg"> The image on the right shows the same roof here (same ridge, no addition or removal)</label><label style="display:block;margin-top:4px">Note <input id="avPkNote" type="text" placeholder="what you see"></label><div class="row" style="margin-top:6px"><button id="avPkZone" class="small">Roof continues here: carry into the sketch as an estimate</button></div>` : '<div class="muted small">Pick a georeferenced image of another date to act on this zone.</div>'}`;
}

// ------------------------------------------------------------------ wiring
function avInit() {
  const p = $('#avPanel'); if (!p) return;
  for (const id of ['#btnAltView', '#btnAltViewTb']) { const b = $(id); if (b) b.addEventListener('click', () => avOpen()); }
  $('#avClose').addEventListener('click', avClose);
  p.querySelectorAll('[data-av]').forEach((b) => b.addEventListener('click', () => avTab(b.dataset.av)));
  avCanvasWire();
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', avInit); else avInit();
window.rmAltView = { open: avOpen, close: avClose, tab: avTab, fly: avFly, tiers: avTiers, naip: avNaipList, select: avSelect, probe: avProbe, carry: avCarry, state: AV };
