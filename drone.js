/* drone.js - DJI Mini 5 Pro roof inspection flight planned from the traced roof.
 *
 * Uses the facets traced in Roof Measure (or Google's building box) as the roof outline and
 * Google's roof height model (Solar API DSM, the same download Auto-trace uses) for the gutter,
 * ridge and tree heights. Plans two passes:
 *   - top-down grid over the roof (gimbal -90, overlap for stitching)
 *   - oblique loop outside the eaves, each photo aimed at the nearest roof edge
 * Exports a DJI Fly waypoint KMZ (rewrites a placeholder route saved in DJI Fly), a generic WPML KMZ
 * and a Litchi CSV. On the local server (serve.ps1) it can pull and push the placeholder route over
 * USB (adb) so no files need to be copied by hand.
 */
(function () {
  'use strict';
  const FT = 0.3048, MPH = 0.44704;
  const DFOV = 84 * Math.PI / 180;                          // Mini 5 Pro: 24 mm equiv, 84 deg diagonal, 4:3
  const HFOV = 2 * Math.atan(Math.tan(DFOV / 2) * 0.8);
  const VFOV = 2 * Math.atan(Math.tan(DFOV / 2) * 0.6);
  const MAX_WP = 200, STOP_S = 4;
  const DEF = { orbitOn: true, orbitOffsetFt: 25, orbitAboveFt: 20, orbitSpacingFt: 13, gridOn: true, gridAboveFt: 50, frontOv: 70, sideOv: 60, speedMph: 7, finish: 'goHome' };
  const D = { overlays: [], plan: null, heights: null, heightsFor: '' };
  const el = (id) => document.getElementById(id);

  // ---------------------------------------------------------------- settings
  function cfg() {
    let c; try { c = Object.assign({}, DEF, JSON.parse(localStorage.getItem('rm.drone') || '{}')); } catch (_) { c = Object.assign({}, DEF); }
    return c;
  }
  function readUi() {
    const n = (id, d) => { const v = parseFloat(el(id).value); return Number.isFinite(v) ? v : d; };
    const c = {
      orbitOn: el('dr_orbitOn').checked, orbitOffsetFt: Math.max(10, n('dr_orbitOffset', DEF.orbitOffsetFt)), orbitAboveFt: Math.max(10, n('dr_orbitAbove', DEF.orbitAboveFt)),
      orbitSpacingFt: Math.max(5, n('dr_orbitSpacing', DEF.orbitSpacingFt)), gridOn: el('dr_gridOn').checked, gridAboveFt: Math.max(15, n('dr_gridAbove', DEF.gridAboveFt)),
      frontOv: Math.min(90, Math.max(0, n('dr_frontOv', DEF.frontOv))), sideOv: Math.min(90, Math.max(0, n('dr_sideOv', DEF.sideOv))),
      speedMph: Math.min(20, Math.max(2, n('dr_speed', DEF.speedMph))), finish: el('dr_finish').value,
    };
    try { localStorage.setItem('rm.drone', JSON.stringify(c)); } catch (_) { /* ignore */ }
    c.eaveFt = parseFloat(el('dr_eave').value); c.ridgeFt = parseFloat(el('dr_ridge').value); c.obstFt = parseFloat(el('dr_obst').value);
    return c;
  }
  function fillUi() {
    const c = cfg();
    el('dr_orbitOn').checked = c.orbitOn; el('dr_orbitOffset').value = c.orbitOffsetFt; el('dr_orbitAbove').value = c.orbitAboveFt; el('dr_orbitSpacing').value = c.orbitSpacingFt;
    el('dr_gridOn').checked = c.gridOn; el('dr_gridAbove').value = c.gridAboveFt; el('dr_frontOv').value = c.frontOv; el('dr_sideOv').value = c.sideOv;
    el('dr_speed').value = c.speedMph; el('dr_finish').value = c.finish;
  }

  // ---------------------------------------------------------------- geometry (metres, x east, y north)
  function makeProj(lat0, lon0) {
    const ky = 111132, kx = 111320 * Math.cos(lat0 * Math.PI / 180);
    return { fwd: (lat, lon) => ({ x: (lon - lon0) * kx, y: (lat - lat0) * ky }), inv: (x, y) => ({ lat: lat0 + y / ky, lng: lon0 + x / kx }) };
  }
  function hull(pts) {
    const p = pts.slice().sort((a, b) => a.x - b.x || a.y - b.y);
    if (p.length < 3) return p;
    const cr = (o, a, b) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
    const lo = [], up = [];
    for (const q of p) { while (lo.length >= 2 && cr(lo[lo.length - 2], lo[lo.length - 1], q) <= 0) lo.pop(); lo.push(q); }
    for (let i = p.length - 1; i >= 0; i--) { const q = p[i]; while (up.length >= 2 && cr(up[up.length - 2], up[up.length - 1], q) <= 0) up.pop(); up.push(q); }
    return lo.slice(0, -1).concat(up.slice(0, -1));          // counter-clockwise
  }
  function edgeNormal(a, b) { const dx = b.x - a.x, dy = b.y - a.y, l = Math.hypot(dx, dy) || 1; return { x: dy / l, y: -dx / l }; }
  function offsetPoly(p, d) {
    const n = p.length, out = [];
    for (let i = 0; i < n; i++) {
      const a = p[(i - 1 + n) % n], b = p[i], c = p[(i + 1) % n];
      const n1 = edgeNormal(a, b), n2 = edgeNormal(b, c);
      let bx = n1.x + n2.x, by = n1.y + n2.y, bl = Math.hypot(bx, by);
      if (bl < 1e-9) { bx = n1.x; by = n1.y; bl = 1; }
      bx /= bl; by /= bl;
      const m = d / Math.max(bx * n1.x + by * n1.y, 0.5);
      out.push({ x: b.x + bx * m, y: b.y + by * m });
    }
    return out;
  }
  function samplePath(poly, spacing) {
    const pts = [];
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i], b = poly[(i + 1) % poly.length], len = Math.hypot(b.x - a.x, b.y - a.y), k = Math.max(1, Math.round(len / spacing));
      for (let j = 0; j < k; j++) pts.push({ x: a.x + (b.x - a.x) * j / k, y: a.y + (b.y - a.y) * j / k });
    }
    return pts;
  }
  function nearestOn(p, polys) {
    let best = null, bd = Infinity;
    for (const poly of polys) for (let i = 0; i < poly.length; i++) {
      const a = poly[i], b = poly[(i + 1) % poly.length], dx = b.x - a.x, dy = b.y - a.y, l2 = dx * dx + dy * dy || 1;
      const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2)), q = { x: a.x + dx * t, y: a.y + dy * t }, d = Math.hypot(q.x - p.x, q.y - p.y);
      if (d < bd) { bd = d; best = q; }
    }
    return { q: best, d: bd };
  }
  function inside(p, poly) {
    let c = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const a = poly[i], b = poly[j];
      if ((a.y > p.y) !== (b.y > p.y) && p.x < (b.x - a.x) * (p.y - a.y) / (b.y - a.y) + a.x) c = !c;
    }
    return c;
  }
  const bearing = (dx, dy) => { let b = Math.atan2(dx, dy) * 180 / Math.PI; if (b > 180) b -= 360; if (b <= -180) b += 360; return b; };

  // roof outline: the main traced structure, or Google's building box when nothing is traced yet
  function roofGeometry() {
    let paths = [];
    const facets = state.facets.filter((f) => !f.excluded);
    if (facets.length) {
      const items = facets.map((f) => ({ f, m: { path: pathToLiteral(f.shape) } }));
      let groups;
      try { groups = groupStructures(items, []); } catch (_) { groups = [{ facets: items }]; }
      const area = (g) => g.facets.reduce((a, x) => a + Math.abs(google.maps.geometry.spherical.computeArea(x.m.path)), 0);
      groups.sort((a, b) => area(b) - area(a));
      paths = groups[0].facets.map((x) => x.m.path);
    } else if (state.solar && state.solar.boundingBox) {
      const b = state.solar.boundingBox;
      paths = [[{ lat: b.sw.latitude, lng: b.sw.longitude }, { lat: b.sw.latitude, lng: b.ne.longitude }, { lat: b.ne.latitude, lng: b.ne.longitude }, { lat: b.ne.latitude, lng: b.sw.longitude }]];
    }
    if (!paths.length) return null;
    const all = paths.flat();
    const proj = makeProj(all.reduce((a, p) => a + p.lat, 0) / all.length, all.reduce((a, p) => a + p.lng, 0) / all.length);
    const polys = paths.map((pa) => pa.map((p) => proj.fwd(p.lat, p.lng)));
    return { proj, polys, hull: hull(polys.flat()), traced: facets.length > 0 };
  }

  // ---------------------------------------------------------------- heights from Google's roof height model
  async function getLayers(download) {
    const main = state.solar; if (!main) return null;
    const cache = (window.__layerCache = window.__layerCache || {});
    const hit = Object.keys(cache).find((k) => k.startsWith(main.name + '|'));
    if (hit) return cache[hit];
    if (!download || typeof solarDataLayers !== 'function' || typeof loadTiff !== 'function') return null;
    const bb = main.boundingBox, cLat = main.center.latitude, cLng = main.center.longitude;
    const kx = 111320 * Math.cos(cLat * Math.PI / 180), ky = 110540;
    const radius = Math.min(100, Math.max(15, Math.ceil(Math.hypot((bb.ne.longitude - bb.sw.longitude) * kx, (bb.ne.latitude - bb.sw.latitude) * ky) / 2 + 12)));
    const safe = String(main.name || 'b').replace(/[^A-Za-z0-9]/g, '_') + '_' + radius;
    const layers = await solarDataLayers(cLat, cLng, radius);
    if (!layers.maskUrl || !layers.dsmUrl) throw new Error('Google returned no height model for this building');
    const [maskT, dsmT] = await Promise.all([loadTiff(layers.maskUrl, '_cache_' + safe + '_mask.tif'), loadTiff(layers.dsmUrl, '_cache_' + safe + '_dsm.tif')]);
    return (cache[main.name + '|' + radius] = { layers, maskT, dsmT });
  }
  function pct(a, q) { if (!a.length) return NaN; a.sort((x, y) => x - y); return a[Math.min(a.length - 1, Math.max(0, Math.floor(a.length * q)))]; }
  // heights in metres above the ground next to the house
  function measure(layers, geom, orbitOffsetM) {
    const { maskT, dsmT } = layers, w = dsmT.w, h = dsmT.h, P = geom.proj;
    const X = new Float64Array(w), Y = new Float64Array(h);
    for (let x = 0; x < w; x++) { const ll = dsmT.toLL(x + 0.5, h / 2); X[x] = P.fwd(ll.lat, ll.lng).x; }
    for (let y = 0; y < h; y++) { const ll = dsmT.toLL(w / 2, y + 0.5); Y[y] = P.fwd(ll.lat, ll.lng).y; }
    const H = geom.hull, xs = H.map((p) => p.x), ys = H.map((p) => p.y), pad = orbitOffsetM + 6;
    const x0 = Math.min(...xs) - pad, x1 = Math.max(...xs) + pad, y0 = Math.min(...ys) - pad, y1 = Math.max(...ys) + pad;
    const step = Math.max(1, Math.round(0.3 / Math.abs(X[1] - X[0] || 0.1)));
    const roof = [], ground = [], ring = [], near = [];
    for (let y = 0; y < h; y += step) {
      if (Y[y] < y0 || Y[y] > y1) continue;
      for (let x = 0; x < w; x += step) {
        if (X[x] < x0 || X[x] > x1) continue;
        const i = y * w + x, z = dsmT.data[i];
        if (!(z > -1000)) continue;
        const p = { x: X[x], y: Y[y] }, onMask = maskT.data[i] > 0;
        if (inside(p, H)) { if (onMask) roof.push(z); continue; }
        const d = nearestOn(p, [H]).d;
        if (!onMask && d >= 3 && d <= 15) ground.push(z);
        if (Math.abs(d - orbitOffsetM) <= 4) ring.push(z);    // corridor the loop flies through
        if (d <= 6) near.push(z);                             // trees overhanging the roof edge
      }
    }
    if (roof.length < 30 || ground.length < 30) return null;
    const g = pct(ground, 0.10);
    return { eave: pct(roof, 0.05) - g, ridge: pct(roof, 0.99) - g, ringObst: Math.max(0, pct(ring, 0.995) - g), nearObst: Math.max(0, pct(near, 0.995) - g) };
  }
  async function measureHeights(download) {
    const geom = roofGeometry(); if (!geom) throw new Error('Trace the roof or get roof data first');
    const layers = await getLayers(download); if (!layers) return null;
    const c = readUi();
    const m = measure(layers, geom, c.orbitOffsetFt * FT); if (!m) throw new Error('Not enough height data around this roof');
    D.heights = m; D.heightsFor = locKey();
    el('dr_eave').value = (m.eave / FT).toFixed(0); el('dr_ridge').value = (m.ridge / FT).toFixed(0);
    el('dr_obst').value = (Math.max(m.ringObst, m.nearObst) / FT).toFixed(0);
    return m;
  }
  const locKey = () => (state.location ? state.location.lat.toFixed(5) + ',' + state.location.lng.toFixed(5) : '');

  // ---------------------------------------------------------------- mission
  function computePlan() {
    const geom = roofGeometry(); if (!geom) return null;
    const c = readUi(), warn = [], info = [];
    const polys = geom.polys, H = geom.hull;
    // heights (m above take-off): typed values win, then the measured model, then a one-story guess
    let eave = Number.isFinite(c.eaveFt) ? c.eaveFt * FT : null, ridge = Number.isFinite(c.ridgeFt) ? c.ridgeFt * FT : null;
    if (eave == null || ridge == null) {
      eave = eave == null ? 3 : eave;
      const xs = H.map((p) => p.x), ys = H.map((p) => p.y);
      ridge = ridge == null ? eave + Math.min(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)) / 2 * (state.defaultPitch || 6) / 12 : ridge;
      warn.push('Heights are estimated. Click <b>Measure heights</b> (or Auto-trace first) for real gutter, ridge and tree heights.');
    }
    if (ridge < eave) warn.push('The ridge is lower than the gutter. Check the heights.');
    const obst = Number.isFinite(c.obstFt) ? c.obstFt * FT : 0;
    const wps = [];
    let ring = null;
    const orbitAlt = Math.max(ridge + c.orbitAboveFt * FT, obst ? obst + 4 : 0);
    let gridAlt = Math.max(ridge + c.gridAboveFt * FT, obst ? obst + 5 : 0, c.orbitOn ? orbitAlt : 0);
    if (obst && orbitAlt > ridge + c.orbitAboveFt * FT + 0.5) info.push(`Trees or buildings up to ${(obst / FT).toFixed(0)} ft are near the loop, so the loop was raised to ${(orbitAlt / FT).toFixed(0)} ft.`);

    if (c.gridOn) {
      const hAbove = gridAlt - ridge, W = 2 * hAbove * Math.tan(HFOV / 2), Hh = 2 * hAbove * Math.tan(VFOV / 2);
      let best = 0, th = 0;
      for (let i = 0; i < H.length; i++) { const a = H[i], b = H[(i + 1) % H.length], l = Math.hypot(b.x - a.x, b.y - a.y); if (l > best) { best = l; th = Math.atan2(b.y - a.y, b.x - a.x); } }
      const u = { x: Math.cos(th), y: Math.sin(th) }, v = { x: -u.y, y: u.x };
      const S = H.map((p) => p.x * u.x + p.y * u.y), T = H.map((p) => p.x * v.x + p.y * v.y);
      const sMin = Math.min(...S) - 1, sMax = Math.max(...S) + 1, tMin = Math.min(...T) - 1, tMax = Math.max(...T) + 1;
      const lineSp = W * (1 - c.sideOv / 100), shotSp = Hh * (1 - c.frontOv / 100);
      const nL = (tMax - tMin) <= W ? 1 : Math.ceil((tMax - tMin - W) / lineSp) + 1;
      const nS = Math.max(2, (sMax - sMin) <= Hh ? 2 : Math.ceil((sMax - sMin - Hh) / shotSp) + 1);
      const sStep = Math.min(shotSp, (sMax - sMin) / (nS - 1));
      const tc = (tMin + tMax) / 2, sc = (sMin + sMax) / 2;
      for (let li = 0; li < nL; li++) {
        const t = tc + (li - (nL - 1) / 2) * lineSp, fwd = li % 2 === 0, hd = bearing(fwd ? u.x : -u.x, fwd ? u.y : -u.y);
        for (let k = 0; k < nS; k++) { const kk = fwd ? k : nS - 1 - k, s = sc + (kk - (nS - 1) / 2) * sStep; wps.push({ x: s * u.x + t * v.x, y: s * u.y + t * v.y, alt: gridAlt, heading: hd, pitch: -90, kind: 'nadir' }); }
      }
    }
    if (c.orbitOn) {
      ring = offsetPoly(H, c.orbitOffsetFt * FT);
      const target = (eave + ridge) / 2;
      let pts = samplePath(ring, c.orbitSpacingFt * FT);
      if (wps.length) { const l = wps[wps.length - 1]; let bi = 0, bd = Infinity; pts.forEach((p, i) => { const d = Math.hypot(p.x - l.x, p.y - l.y); if (d < bd) { bd = d; bi = i; } }); pts = pts.slice(bi).concat(pts.slice(0, bi)); }
      for (const p of pts) {
        const n = nearestOn(p, polys), dx = n.q.x - p.x, dy = n.q.y - p.y, d = Math.hypot(dx, dy) || 1;
        wps.push({ x: p.x, y: p.y, alt: orbitAlt, heading: bearing(dx / d, dy / d), pitch: Math.max(-90, Math.min(0, -Math.atan2(orbitAlt - target, d + 2) * 180 / Math.PI)), kind: 'oblique' });
      }
    }
    const speed = c.speedMph * MPH;
    wps.forEach((w) => { const g = geom.proj.inv(w.x, w.y); w.lat = g.lat; w.lng = g.lng; w.speed = +speed.toFixed(1); });
    let dist = 0; for (let i = 1; i < wps.length; i++) dist += Math.hypot(wps[i].x - wps[i - 1].x, wps[i].y - wps[i - 1].y, wps[i].alt - wps[i - 1].alt);
    const secs = dist / speed + wps.length * STOP_S + 60;
    if (!geom.traced) warn.push("The roof isn't traced yet, so this plan uses Google's building box. Auto-trace gives a tighter loop.");
    if (!wps.length) warn.push('Turn on at least one pass.');
    if (wps.length > MAX_WP) warn.push(`${wps.length} waypoints is more than DJI Fly takes (about ${MAX_WP}). Increase photo spacing, lower the overlap, or fly higher.`);
    if (secs > 20 * 60) warn.push('The flight is longer than 20 minutes. Start with a full battery, or fly the passes separately.');
    if (Math.max(0, ...wps.map((w) => w.alt)) > 120) warn.push('Some waypoints are above 400 ft.');
    return { wps, ring, geom, warn, info, dist, secs, c, eave, ridge, orbitAlt, gridAlt, finish: c.finish, speed };
  }

  // ---------------------------------------------------------------- map + panel
  function clearMap() { D.overlays.forEach((o) => o.setMap(null)); D.overlays = []; }
  function draw(p) {
    clearMap();
    if (!p || !p.wps.length) return;
    const P = p.geom.proj;
    if (p.ring) D.overlays.push(new google.maps.Polyline({ map, path: p.ring.concat([p.ring[0]]).map((q) => P.inv(q.x, q.y)), strokeColor: '#ff7043', strokeOpacity: 0, clickable: false, zIndex: 5, icons: [{ icon: { path: 'M 0,-1 0,1', strokeOpacity: 1, strokeColor: '#ff7043', scale: 2 }, offset: '0', repeat: '10px' }] }));
    D.overlays.push(new google.maps.Polyline({ map, path: p.wps.map((w) => ({ lat: w.lat, lng: w.lng })), strokeColor: '#4dd0e1', strokeWeight: 2, clickable: false, zIndex: 6 }));
    p.wps.forEach((w, i) => {
      const r = w.heading * Math.PI / 180;
      D.overlays.push(new google.maps.Polyline({ map, path: [{ lat: w.lat, lng: w.lng }, P.inv(w.x + Math.sin(r) * 2.5, w.y + Math.cos(r) * 2.5)], strokeColor: '#ffffff', strokeWeight: 2, clickable: false, zIndex: 7 }));
      D.overlays.push(new google.maps.Marker({ map, position: { lat: w.lat, lng: w.lng }, zIndex: 8,
        title: `#${i + 1} ${w.kind === 'nadir' ? 'top-down' : 'oblique'} · ${(w.alt / FT).toFixed(0)} ft · heading ${w.heading.toFixed(0)}° · gimbal ${w.pitch.toFixed(0)}°`,
        icon: { path: google.maps.SymbolPath.CIRCLE, scale: 6, fillColor: w.kind === 'nadir' ? '#1e88e5' : '#e64a19', fillOpacity: 1, strokeColor: '#fff', strokeWeight: 1 } }));
    });
  }
  function render() {
    const out = el('dr_out'), p = D.plan;
    const ok = !!(p && p.wps.length);
    ['dr_send', 'dr_kmz', 'dr_raw', 'dr_csv'].forEach((id) => { const b = el(id); if (b) b.disabled = !ok; });
    if (!p) { out.innerHTML = '<span class="muted">Find the address and get roof data (or trace the roof) first.</span>'; return; }
    const m = Math.floor(p.secs / 60), s = Math.round(p.secs % 60);
    const nN = p.wps.filter((w) => w.kind === 'nadir').length;
    out.innerHTML = `<div class="kpis">
        <div class="kpi"><div class="v">${p.wps.length}</div><div class="l">photos</div></div>
        <div class="kpi"><div class="v">${m}:${String(s).padStart(2, '0')}</div><div class="l">est. flight</div></div>
        <div class="kpi"><div class="v">${(p.dist / FT).toFixed(0)}</div><div class="l">ft flown</div></div>
      </div>
      <div class="muted small">${nN} top-down at ${(p.gridAlt / FT).toFixed(0)} ft · ${p.wps.length - nN} oblique at ${(p.orbitAlt / FT).toFixed(0)} ft · gutter ${(p.eave / FT).toFixed(0)} ft, ridge ${(p.ridge / FT).toFixed(0)} ft (heights above take-off)</div>
      ${p.info.map((t) => `<div class="small" style="margin-top:6px">${t}</div>`).join('')}
      ${p.warn.map((t) => `<div class="small err" style="margin-top:6px">${t}</div>`).join('')}`;
    const ph = placeholder();
    el('dr_phName').textContent = ph ? ph.name : 'none chosen';
  }
  function replan() { D.plan = computePlan(); draw(D.plan); render(); }

  // ---------------------------------------------------------------- WPML / KMZ
  const kids = (e, ln) => Array.from(e.children).filter((c) => c.localName === ln);
  const kid = (e, ln) => kids(e, ln)[0] || null;
  function wpmlNS(doc) {
    for (const a of Array.from(doc.documentElement.attributes)) if (a.name === 'xmlns:wpml') return a.value;
    const any = Array.from(doc.getElementsByTagName('*')).find((e) => e.prefix === 'wpml');
    return any ? any.namespaceURI : 'http://www.dji.com/wpmz/1.0.6';
  }
  function rewriteDoc(doc, p, isWaylines) {
    const ns = wpmlNS(doc);
    const E = (name, text) => { const e = doc.createElementNS(ns, 'wpml:' + name); if (text !== undefined) e.textContent = String(text); return e; };
    const setKid = (e, ln, val, create) => { let c = kid(e, ln); if (!c && create) { c = E(ln); e.appendChild(c); } if (c) c.textContent = String(val); return c; };
    const setAll = (ln, val) => Array.from(doc.getElementsByTagNameNS('*', ln)).forEach((e) => { e.textContent = String(val); });
    const pms = Array.from(doc.getElementsByTagNameNS('*', 'Placemark'));
    if (!pms.length) throw new Error('The placeholder route has no waypoints. Save one with at least 2 waypoints in DJI Fly.');
    const proto = pms[0], parent = proto.parentNode, anchor = pms[pms.length - 1].nextSibling;
    pms.forEach((pm) => pm.parentNode.removeChild(pm));
    p.wps.forEach((w, i) => {
      const pm = proto.cloneNode(true);
      kids(pm, 'actionGroup').forEach((n) => pm.removeChild(n));
      const co = pm.getElementsByTagNameNS('*', 'coordinates')[0];
      if (co) co.textContent = `${w.lng.toFixed(8)},${w.lat.toFixed(8)}`;
      setKid(pm, 'index', i, true);
      if (isWaylines) setKid(pm, 'executeHeight', w.alt.toFixed(2), true);
      else { setKid(pm, 'height', w.alt.toFixed(2), true); setKid(pm, 'ellipsoidHeight', w.alt.toFixed(2), false); }
      setKid(pm, 'useGlobalHeight', 0, false); setKid(pm, 'useGlobalSpeed', 0, false); setKid(pm, 'useGlobalHeadingParam', 0, false);
      setKid(pm, 'waypointSpeed', w.speed, true);
      let hp = kid(pm, 'waypointHeadingParam'); if (!hp) { hp = E('waypointHeadingParam'); pm.appendChild(hp); }
      setKid(hp, 'waypointHeadingMode', 'smoothTransition', true);
      setKid(hp, 'waypointHeadingAngle', w.heading.toFixed(1), true);
      setKid(hp, 'waypointHeadingAngleEnable', 1, true);
      setKid(pm, 'gimbalPitchAngle', w.pitch.toFixed(1), false);
      const gh = kid(pm, 'waypointGimbalHeadingParam'); if (gh) setKid(gh, 'waypointGimbalPitchAngle', w.pitch.toFixed(1), false);
      const g = E('actionGroup');
      g.append(E('actionGroupId', i), E('actionGroupStartIndex', i), E('actionGroupEndIndex', i), E('actionGroupMode', 'sequence'));
      const tr = E('actionTrigger'); tr.append(E('actionTriggerType', 'reachPoint')); g.append(tr);
      const rot = E('action'); rot.append(E('actionId', 0), E('actionActuatorFunc', 'gimbalRotate'));
      const rp = E('actionActuatorFuncParam');
      rp.append(E('gimbalHeadingYawBase', 'aircraft'), E('gimbalRotateMode', 'absoluteAngle'), E('gimbalPitchRotateEnable', 1), E('gimbalPitchRotateAngle', w.pitch.toFixed(1)),
        E('gimbalRollRotateEnable', 0), E('gimbalRollRotateAngle', 0), E('gimbalYawRotateEnable', 0), E('gimbalYawRotateAngle', 0), E('gimbalRotateTimeEnable', 0), E('gimbalRotateTime', 0), E('payloadPositionIndex', 0));
      rot.append(rp); g.append(rot);
      const ph = E('action'); ph.append(E('actionId', 1), E('actionActuatorFunc', 'takePhoto'));
      const pp = E('actionActuatorFuncParam'); pp.append(E('payloadPositionIndex', 0), E('useGlobalPayloadLensIndex', 0)); ph.append(pp); g.append(ph);
      pm.appendChild(g);
      parent.insertBefore(pm, anchor);
    });
    setAll('finishAction', p.finish); setAll('autoFlightSpeed', p.speed.toFixed(1)); setAll('updateTime', Date.now());
    if (isWaylines) { setAll('distance', p.dist.toFixed(1)); setAll('duration', p.secs.toFixed(1)); }
  }
  function ser(doc) { let o = new XMLSerializer().serializeToString(doc); if (!o.startsWith('<?xml')) o = '<?xml version="1.0" encoding="UTF-8"?>\n' + o; return o; }
  function parse(txt, name) { const d = new DOMParser().parseFromString(txt, 'application/xml'); if (d.getElementsByTagName('parsererror').length) throw new Error('Could not read ' + name); return d; }
  async function kmzFromPlaceholder(data, p, opts) {
    const zip = await JSZip.loadAsync(data, opts);
    const names = Object.keys(zip.files);
    const tg = [[names.find((n) => /template\.kml$/i.test(n)), false], [names.find((n) => /waylines\.wpml$/i.test(n)), true]].filter((t) => t[0]);
    if (!tg.length) throw new Error('That file is not a DJI Fly waypoint route (no template.kml or waylines.wpml inside).');
    for (const [n, isW] of tg) { const d = parse(await zip.file(n).async('string'), n); rewriteDoc(d, p, isW); zip.file(n, ser(d)); }
    return zip.generateAsync({ type: 'blob', compression: 'DEFLATE', mimeType: 'application/vnd.google-earth.kmz' });
  }
  const MC = '<wpml:missionConfig><wpml:flyToWaylineMode>safely</wpml:flyToWaylineMode><wpml:finishAction>goHome</wpml:finishAction><wpml:exitOnRCLost>executeLostAction</wpml:exitOnRCLost><wpml:executeRCLostAction>goBack</wpml:executeRCLostAction><wpml:globalTransitionalSpeed>5</wpml:globalTransitionalSpeed></wpml:missionConfig>';
  const HEAD = '<wpml:waypointHeadingParam><wpml:waypointHeadingMode>smoothTransition</wpml:waypointHeadingMode><wpml:waypointHeadingAngle>0</wpml:waypointHeadingAngle><wpml:waypointPoiPoint>0.000000,0.000000,0.000000</wpml:waypointPoiPoint><wpml:waypointHeadingAngleEnable>1</wpml:waypointHeadingAngleEnable><wpml:waypointHeadingPathMode>followBadArc</wpml:waypointHeadingPathMode></wpml:waypointHeadingParam>';
  const TURN = '<wpml:waypointTurnParam><wpml:waypointTurnMode>toPointAndStopWithDiscontinuityCurvature</wpml:waypointTurnMode><wpml:waypointTurnDampingDist>0</wpml:waypointTurnDampingDist></wpml:waypointTurnParam><wpml:useStraightLine>1</wpml:useStraightLine>';
  const K = '<?xml version="1.0" encoding="UTF-8"?><kml xmlns="http://www.opengis.net/kml/2.2" xmlns:wpml="http://www.dji.com/wpmz/1.0.6"><Document>';
  const TEMPLATE = K + '<wpml:author>roof-measure</wpml:author><wpml:createTime>0</wpml:createTime><wpml:updateTime>0</wpml:updateTime>' + MC +
    '<Folder><wpml:templateType>waypoint</wpml:templateType><wpml:templateId>0</wpml:templateId><wpml:waylineCoordinateSysParam><wpml:coordinateMode>WGS84</wpml:coordinateMode><wpml:heightMode>relativeToStartPoint</wpml:heightMode></wpml:waylineCoordinateSysParam><wpml:autoFlightSpeed>3</wpml:autoFlightSpeed>' +
    '<Placemark><Point><coordinates>0,0</coordinates></Point><wpml:index>0</wpml:index><wpml:height>30</wpml:height><wpml:ellipsoidHeight>30</wpml:ellipsoidHeight><wpml:useGlobalHeight>0</wpml:useGlobalHeight><wpml:useGlobalSpeed>0</wpml:useGlobalSpeed><wpml:waypointSpeed>3</wpml:waypointSpeed><wpml:useGlobalHeadingParam>0</wpml:useGlobalHeadingParam>' + HEAD + '<wpml:useGlobalTurnParam>0</wpml:useGlobalTurnParam>' + TURN + '</Placemark></Folder></Document></kml>';
  const WAYLINES = K + MC + '<Folder><wpml:templateId>0</wpml:templateId><wpml:executeHeightMode>relativeToStartPoint</wpml:executeHeightMode><wpml:waylineId>0</wpml:waylineId><wpml:distance>0</wpml:distance><wpml:duration>0</wpml:duration><wpml:autoFlightSpeed>3</wpml:autoFlightSpeed>' +
    '<Placemark><Point><coordinates>0,0</coordinates></Point><wpml:index>0</wpml:index><wpml:executeHeight>30</wpml:executeHeight><wpml:waypointSpeed>3</wpml:waypointSpeed>' + HEAD + TURN +
    '<wpml:waypointGimbalHeadingParam><wpml:waypointGimbalPitchAngle>0</wpml:waypointGimbalPitchAngle><wpml:waypointGimbalYawAngle>0</wpml:waypointGimbalYawAngle></wpml:waypointGimbalHeadingParam></Placemark></Folder></Document></kml>';
  async function kmzGeneric(p) {
    const zip = new JSZip();
    for (const [n, s, isW] of [['wpmz/template.kml', TEMPLATE, false], ['wpmz/waylines.wpml', WAYLINES, true]]) {
      const d = parse(s, n); rewriteDoc(d, p, isW);
      Array.from(d.getElementsByTagNameNS('*', 'createTime')).forEach((e) => { e.textContent = String(Date.now()); });
      zip.file(n, ser(d));
    }
    return zip.generateAsync({ type: 'blob', compression: 'DEFLATE', mimeType: 'application/vnd.google-earth.kmz' });
  }
  function litchiCsv(p) {
    const head = ['latitude', 'longitude', 'altitude(m)', 'heading(deg)', 'curvesize(m)', 'rotationdir', 'gimbalmode', 'gimbalpitchangle'];
    for (let i = 1; i <= 15; i++) head.push('actiontype' + i, 'actionparam' + i);
    head.push('altitudemode', 'speed(m/s)', 'poi_latitude', 'poi_longitude', 'poi_altitude(m)', 'poi_altitudemode', 'photo_timeinterval', 'photo_distinterval');
    const rows = p.wps.map((w) => { const r = [w.lat.toFixed(8), w.lng.toFixed(8), w.alt.toFixed(1), ((w.heading + 360) % 360).toFixed(1), 0, 0, 2, w.pitch.toFixed(1), 1, 0]; for (let i = 2; i <= 15; i++) r.push(-1, 0); r.push(0, w.speed, 0, 0, 0, 0, -1, -1); return r.join(','); });
    return new Blob([head.join(',') + '\n' + rows.join('\n') + '\n'], { type: 'text/csv' });
  }
  function saveBlob(blob, name) { const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000); }
  const base = () => (typeof fileBase === 'function' ? fileBase() : 'roof') + '_drone';
  function placeholder() { try { return JSON.parse(localStorage.getItem('rm.dronePlaceholder') || 'null'); } catch (_) { return null; } }

  // ---------------------------------------------------------------- phone over USB (local server only)
  async function sendToPhone() {
    const st = await (await fetch('/drone/status')).json();
    if (!st.adb) throw new Error(st.error || 'adb is not available');
    if (!st.device) throw new Error(st.error || 'No phone found. Plug it in with USB debugging on, and tap Allow on the phone.');
    if (!st.routes || !st.routes.length) throw new Error('No DJI Fly waypoint routes on the phone. In DJI Fly, save a route with 2 waypoints first.');
    let id = ''; try { id = localStorage.getItem('rm.droneRouteId') || ''; } catch (_) { /* ignore */ }
    if (!st.routes.includes(id)) id = st.routes[0];
    const r = await fetch('/drone/placeholder?id=' + encodeURIComponent(id));
    if (!r.ok) throw new Error('Could not read the route from the phone');
    const out = await kmzFromPlaceholder(await r.arrayBuffer(), D.plan);
    const pr = await fetch('/drone/push?id=' + encodeURIComponent(id), { method: 'POST', body: out });
    const pj = await pr.json().catch(() => ({}));
    if (!pr.ok) throw new Error(pj.error || 'Push failed');
    try { localStorage.setItem('rm.droneRouteId', id); } catch (_) { /* ignore */ }
    return id;
  }

  // ---------------------------------------------------------------- wiring
  function busy(btn, label, fn) {
    return async () => { const t = btn.textContent; btn.disabled = true; btn.textContent = label; try { await fn(); } catch (e) { toast(e.message || String(e), true); } btn.textContent = t; btn.disabled = false; };
  }
  function init() {
    if (!el('panelDrone')) return;
    fillUi();
    if (location.hostname !== 'localhost') { el('dr_send').style.display = 'none'; el('dr_sendHelp').style.display = 'none'; }
    el('panelDrone').addEventListener('toggle', () => { if (el('panelDrone').open) replan(); else clearMap(); });
    el('panelDrone').querySelectorAll('input:not([type=file]),select').forEach((i) => i.addEventListener('change', () => { if (el('panelDrone').open) replan(); }));
    el('dr_measure').onclick = busy(el('dr_measure'), 'Measuring...', async () => { const m = await measureHeights(true); if (!m) throw new Error('Get roof data first'); replan(); toast('Heights measured from Google\'s roof height model'); });
    el('dr_plan').onclick = busy(el('dr_plan'), 'Planning...', async () => {
      if (D.heightsFor !== locKey()) { ['dr_eave', 'dr_ridge', 'dr_obst'].forEach((id) => { el(id).value = ''; }); D.heights = null; }
      if (!el('dr_eave').value && state.solar) { try { await measureHeights(false); } catch (_) { /* fall back to estimate */ } }
      replan(); if (D.plan && D.plan.wps.length) { const b = new google.maps.LatLngBounds(); D.plan.wps.forEach((w) => b.extend(w)); map.fitBounds(b, 40); }
    });
    el('dr_ph').onchange = async (e) => {
      const f = e.target.files[0]; if (!f) return;
      const buf = new Uint8Array(await f.arrayBuffer()); let bin = ''; for (let i = 0; i < buf.length; i++) bin += String.fromCharCode(buf[i]);
      try { localStorage.setItem('rm.dronePlaceholder', JSON.stringify({ name: f.name, b64: btoa(bin) })); } catch (_) { toast('Could not remember the file; pick it again next time', true); }
      render(); toast('Placeholder route saved. You will not need to pick it again on this computer.');
    };
    el('dr_kmz').onclick = busy(el('dr_kmz'), 'Building...', async () => {
      const ph = placeholder(); if (!ph) throw new Error('Pick your DJI Fly placeholder route (.kmz) first');
      saveBlob(await kmzFromPlaceholder(ph.b64, D.plan, { base64: true }), ph.name);
      toast('Downloaded with the placeholder\'s name. Copy it over the original, then restart DJI Fly.');
    });
    el('dr_raw').onclick = busy(el('dr_raw'), 'Building...', async () => saveBlob(await kmzGeneric(D.plan), base() + '.kmz'));
    el('dr_csv').onclick = () => saveBlob(litchiCsv(D.plan), base() + '_litchi.csv');
    el('dr_send').onclick = busy(el('dr_send'), 'Sending...', async () => { await sendToPhone(); toast('Route sent. In DJI Fly open Waypoints and pick the route you saved as the placeholder.'); });
    render();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
  // for the roof report: measured heights (metres above the ground next to the house) and the current flight plan
  async function reportInfo() {
    let h = D.heightsFor === locKey() ? D.heights : null;
    if (!h && state.solar) { try { h = await measureHeights(false); } catch (_) { h = null; } }
    const p = D.plan && D.heightsFor === locKey() ? D.plan : null;
    return { heights: h, plan: p ? { photos: p.wps.length, nadir: p.wps.filter((w) => w.kind === 'nadir').length, orbitAlt: p.orbitAlt, gridAlt: p.gridAlt, secs: p.secs } : null };
  }
  window.__drone = { computePlan, measureHeights, kmzGeneric, litchiCsv, replan, reportInfo };
})();
