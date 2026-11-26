'use strict';
/* autotrace.js - automatic roof tracing from Google Solar API data layers.
 * Downloads the building mask and digital surface model (DSM) GeoTIFFs for the building (0.1 m per pixel),
 * assigns every roof pixel to the Solar API roof plane whose height matches, vectorises the plane regions
 * into facets, and classifies every boundary as eave / rake / ridge / hip / valley / step / wall / transition.
 * Uses globals from app.js (state, fetchSolar, solarSummaryOf, addFacet, addEdge, degToPitch, recompute, toast, $).
 * Needs geotiff.js (global GeoTIFF) and proj4 (global proj4) loaded before this file.
 */

var AT = { v2: true, tolM: 0.75, minRegionM2: 3, dpEpsPx: 5, regularize: true, dropBlobM2: 10, maxOtherStructures: 3, minOtherM2: 4, maxOtherM2: 95, maxOtherDistM: 28 };

// ------------------------------------------------------------------ data access
async function solarDataLayers(lat, lng, radius, quality) {
  // quality given: that exact dataset (Google keeps one per quality tier, often flown in different years); otherwise the best one
  const url = `https://solar.googleapis.com/v1/dataLayers:get?location.latitude=${lat}&location.longitude=${lng}&radiusMeters=${radius}&view=IMAGERY_LAYERS&requiredQuality=${quality ? quality + '&exactQualityRequired=true' : 'LOW'}&pixelSizeMeters=0.1&key=${encodeURIComponent(state.key)}`;
  const r = await fetch(url);
  if (!r.ok) { let m = 'HTTP ' + r.status; try { const j = await r.json(); m = (j.error && j.error.message) || m; } catch (_) { /* ignore */ } throw new Error('Data layers: ' + m); }
  return r.json();
}
async function loadTiff(url, cacheName) {
  let buf = null;
  // local development only: keep downloaded rasters on disk so reloading the page does not re-buy the same data
  const devCache = cacheName && location.hostname === 'localhost';
  if (devCache) { try { const c = await fetch('/reports/' + encodeURIComponent(cacheName)); if (c.ok) buf = await c.arrayBuffer(); } catch (_) { /* not cached */ } }
  if (!buf) {
    const r = await fetch(url + '&key=' + encodeURIComponent(state.key));
    if (!r.ok) throw new Error('GeoTIFF download failed (' + r.status + ')');
    buf = await r.arrayBuffer();
    if (devCache) { try { await fetch('/save?name=' + encodeURIComponent(cacheName), { method: 'POST', body: buf }); } catch (_) { /* best effort */ } }
  }
  const tiff = await GeoTIFF.fromArrayBuffer(buf);
  const img = await tiff.getImage();
  const ras = await img.readRasters(); const data = ras[0];
  const w = img.getWidth(), h = img.getHeight();
  const [ox, oy] = img.getOrigin(); const [rx, ry] = img.getResolution();
  const keys = img.getGeoKeys ? (img.getGeoKeys() || {}) : {};
  const epsg = keys.ProjectedCSTypeGeoKey || keys.GeographicTypeGeoKey || 4326;
  const sy = ry > 0 ? -ry : ry;                               // rows run southward: model y decreases as the row index grows
  let toLL;
  if (epsg === 4326 || Math.abs(ox) <= 360) toLL = (x, y) => ({ lng: ox + x * rx, lat: oy + y * sy });
  else {
    let def = null;
    if (epsg >= 32601 && epsg <= 32660) def = `+proj=utm +zone=${epsg - 32600} +datum=WGS84 +units=m +no_defs`;
    else if (epsg >= 32701 && epsg <= 32760) def = `+proj=utm +zone=${epsg - 32700} +south +datum=WGS84 +units=m +no_defs`;
    else if (epsg === 3857) def = 'EPSG:3857';
    if (!def) throw new Error('Unsupported GeoTIFF projection EPSG:' + epsg);
    toLL = (x, y) => { const p = proj4(def, 'EPSG:4326', [ox + x * rx, oy + y * sy]); return { lng: p[0], lat: p[1] }; };
  }
  return { data, bands: ras.length >= 3 ? [ras[0], ras[1], ras[2]] : null, w, h, toLL, rx, ry, epsg };
}

// ------------------------------------------------------------------ raster helpers
function floodComponent(mask, w, h, sx, sy) {
  // connected component (4-neighbour) of mask pixels containing (sx,sy); returns Uint8Array membership and pixel count
  const out = new Uint8Array(w * h); const stack = [sy * w + sx]; let n = 0;
  if (!mask[sy * w + sx]) return { out, n: 0 };
  out[sy * w + sx] = 1;
  while (stack.length) {
    const i = stack.pop(); n++;
    const x = i % w, y = (i - x) / w;
    if (x > 0 && mask[i - 1] && !out[i - 1]) { out[i - 1] = 1; stack.push(i - 1); }
    if (x < w - 1 && mask[i + 1] && !out[i + 1]) { out[i + 1] = 1; stack.push(i + 1); }
    if (y > 0 && mask[i - w] && !out[i - w]) { out[i - w] = 1; stack.push(i - w); }
    if (y < h - 1 && mask[i + w] && !out[i + w]) { out[i + w] = 1; stack.push(i + w); }
  }
  return { out, n };
}
function allComponents(mask, w, h) {
  const seen = new Uint8Array(w * h); const comps = [];
  for (let i = 0; i < w * h; i++) {
    if (!mask[i] || seen[i]) continue;
    const x = i % w, y = (i - x) / w;
    const { out, n } = floodComponent(mask, w, h, x, y);
    let sx = 0, sy = 0, minx = w, maxx = 0, miny = h, maxy = 0;
    for (let j = 0; j < w * h; j++) if (out[j]) { seen[j] = 1; const px = j % w, py = (j - px) / w; sx += px; sy += py; if (px < minx) minx = px; if (px > maxx) maxx = px; if (py < miny) miny = py; if (py > maxy) maxy = py; }
    comps.push({ member: out, n, cx: sx / n, cy: sy / n, bbox: [minx, miny, maxx, maxy] });
  }
  return comps;
}
function majorityFilter(label, w, h, member, passes, rad = 2) {
  let cur = label;
  for (let p = 0; p < passes; p++) {
    const next = new Int16Array(cur);
    for (let y = rad; y < h - rad; y++) for (let x = rad; x < w - rad; x++) {
      const i = y * w + x; if (!member[i]) continue;
      const counts = new Map(); let best = cur[i], bestN = 0;
      for (let dy = -rad; dy <= rad; dy++) for (let dx = -rad; dx <= rad; dx++) { const j = i + dy * w + dx; if (!member[j]) continue; const v = cur[j]; const c = (counts.get(v) || 0) + 1; counts.set(v, c); if (c > bestN || (c === bestN && v === cur[i])) { bestN = c; best = v; } }
      next[i] = best;
    }
    cur = next;
  }
  return cur;
}
function fillUnassigned(label, w, h, member) {
  // iterative nearest-neighbour fill of -2 pixels from labelled neighbours
  for (let it = 0; it < 60; it++) {
    let changed = 0; const next = new Int16Array(label);
    for (let i = 0; i < w * h; i++) {
      if (!member[i] || label[i] !== -2) continue;
      const x = i % w, y = (i - x) / w; const c = new Map(); let best = -2, bestN = 0;
      const nb = [];
      if (x > 0) nb.push(i - 1); if (x < w - 1) nb.push(i + 1); if (y > 0) nb.push(i - w); if (y < h - 1) nb.push(i + w);
      for (const j of nb) { if (member[j] && label[j] >= 0) { const n = (c.get(label[j]) || 0) + 1; c.set(label[j], n); if (n > bestN) { bestN = n; best = label[j]; } } }
      if (best >= 0) { next[i] = best; changed++; }
    }
    label = next; if (!changed) break;
  }
  return label;
}
function regionize(label, w, h, member, pxM2, minM2) {
  // connected components of equal label -> region ids; tiny regions take their dominant neighbour's label
  for (let round = 0; round < 3; round++) {
    const region = new Int32Array(w * h).fill(-1); const regions = [];
    for (let i = 0; i < w * h; i++) {
      if (!member[i] || region[i] >= 0) continue;
      const id = regions.length; const lab = label[i]; const stack = [i]; region[i] = id; let n = 0;
      while (stack.length) {
        const k = stack.pop(); n++;
        const x = k % w, y = (k - x) / w;
        const nb = [];
        if (x > 0) nb.push(k - 1); if (x < w - 1) nb.push(k + 1); if (y > 0) nb.push(k - w); if (y < h - 1) nb.push(k + w);
        for (const j of nb) if (member[j] && region[j] < 0 && label[j] === lab) { region[j] = id; stack.push(j); }
      }
      regions.push({ id, label: lab, n });
    }
    let merged = 0;
    for (const r of regions) {
      if (r.n * pxM2 >= minM2) continue;
      const counts = new Map();
      for (let i = 0; i < w * h; i++) {
        if (region[i] !== r.id) continue;
        const x = i % w, y = (i - x) / w; const nb = [];
        if (x > 0) nb.push(i - 1); if (x < w - 1) nb.push(i + 1); if (y > 0) nb.push(i - w); if (y < h - 1) nb.push(i + w);
        for (const j of nb) if (member[j] && region[j] !== r.id) counts.set(label[j], (counts.get(label[j]) || 0) + 1);
      }
      let best = null, bestN = 0; for (const [k, v] of counts) if (v > bestN) { bestN = v; best = k; }
      if (best != null) { for (let i = 0; i < w * h; i++) if (region[i] === r.id) label[i] = best; merged++; }
    }
    if (!merged) return { region, regions };
  }
  // final pass
  const region = new Int32Array(w * h).fill(-1); const regions = [];
  for (let i = 0; i < w * h; i++) {
    if (!member[i] || region[i] >= 0) continue;
    const id = regions.length; const lab = label[i]; const stack = [i]; region[i] = id; let n = 0;
    while (stack.length) { const k = stack.pop(); n++; const x = k % w, y = (k - x) / w; const nb = []; if (x > 0) nb.push(k - 1); if (x < w - 1) nb.push(k + 1); if (y > 0) nb.push(k - w); if (y < h - 1) nb.push(k + w); for (const j of nb) if (member[j] && region[j] < 0 && label[j] === lab) { region[j] = id; stack.push(j); } }
    regions.push({ id, label: lab, n });
  }
  return { region, regions };
}

// ------------------------------------------------------------------ vectorising
function regionOuterLoop(region, w, h, id) {
  // directed crack edges with the region on the right (clockwise in image coordinates); returns the longest closed loop
  // each edge: {a:[x,y], b:[x,y], inside: pixelIndex, outside: pixelIndex|-1}
  const edges = new Map(); // key start point -> array of edges
  const key = (x, y) => y * (w + 1) + x;
  const add = (ax, ay, bx, by, inside, outside) => { const k = key(ax, ay); const e = { a: [ax, ay], b: [bx, by], inside, outside }; if (!edges.has(k)) edges.set(k, []); edges.get(k).push(e); };
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x; if (region[i] !== id) continue;
    const up = y > 0 ? i - w : -1, dn = y < h - 1 ? i + w : -1, lf = x > 0 ? i - 1 : -1, rt = x < w - 1 ? i + 1 : -1;
    if (up < 0 || region[up] !== id) add(x, y, x + 1, y, i, up);
    if (rt < 0 || region[rt] !== id) add(x + 1, y, x + 1, y + 1, i, rt);
    if (dn < 0 || region[dn] !== id) add(x + 1, y + 1, x, y + 1, i, dn);
    if (lf < 0 || region[lf] !== id) add(x, y + 1, x, y, i, lf);
  }
  const loops = []; const used = new Set();
  for (const [, arr] of edges) for (const e0 of arr) {
    if (used.has(e0)) continue;
    const loop = []; let e = e0; let guard = 0;
    while (e && !used.has(e) && guard++ < 1e6) {
      used.add(e); loop.push(e);
      const nexts = edges.get(key(e.b[0], e.b[1])) || [];
      // prefer the sharpest right turn to keep separate loops separate at diagonal touches
      const dirIn = [e.b[0] - e.a[0], e.b[1] - e.a[1]];
      let best = null, bestScore = -9;
      for (const c of nexts) { if (used.has(c)) continue; const d = [c.b[0] - c.a[0], c.b[1] - c.a[1]]; const cross = dirIn[0] * d[1] - dirIn[1] * d[0]; const dot = dirIn[0] * d[0] + dirIn[1] * d[1]; const score = cross > 0 ? 2 : dot > 0 ? 1 : 0; if (score > bestScore) { bestScore = score; best = c; } }
      e = best;
    }
    loops.push(loop);
  }
  loops.sort((a, b) => b.length - a.length);
  return loops[0] || [];
}
function dpSimplify(pts, eps) {
  if (pts.length <= 2) return pts;
  const [ax, ay] = pts[0], [bx, by] = pts[pts.length - 1];
  const L = Math.hypot(bx - ax, by - ay) || 1e-9;
  let maxD = -1, idx = -1;
  for (let i = 1; i < pts.length - 1; i++) { const d = Math.abs((bx - ax) * (ay - pts[i][1]) - (ax - pts[i][0]) * (by - ay)) / L; if (d > maxD) { maxD = d; idx = i; } }
  if (maxD > eps) { const l = dpSimplify(pts.slice(0, idx + 1), eps), r = dpSimplify(pts.slice(idx), eps); return l.slice(0, -1).concat(r); }
  return [pts[0], pts[pts.length - 1]];
}
function splitChains(loop, region) {
  // split the loop where the neighbouring region changes; returns chains [{pts:[[x,y]...], outside:regionId|-1, mid:edge}]
  const nbr = (e) => (e.outside < 0 ? -1 : region[e.outside]);
  if (!loop.length) return [];
  // rotate so the loop starts at a change point
  let start = 0;
  for (let i = 0; i < loop.length; i++) { const p = loop[(i - 1 + loop.length) % loop.length]; if (nbr(p) !== nbr(loop[i])) { start = i; break; } }
  const chains = []; let cur = null;
  for (let k = 0; k < loop.length; k++) {
    const e = loop[(start + k) % loop.length]; const nb = nbr(e);
    if (!cur || cur.outside !== nb) { cur = { pts: [e.a], outside: nb, edges: [] }; chains.push(cur); }
    cur.pts.push(e.b); cur.edges.push(e);
  }
  if (chains.length === 1) { // isolated region: split the ring in two at the farthest point
    const c = chains[0]; const half = Math.floor(c.pts.length / 2);
    return [{ pts: c.pts.slice(0, half + 1), outside: c.outside, edges: c.edges.slice(0, half) }, { pts: c.pts.slice(half), outside: c.outside, edges: c.edges.slice(half) }];
  }
  return chains;
}

// ------------------------------------------------------------------ regularisation (straight edges on the building axis and its 45-degree diagonals)
function dominantAngle(chainsPx) {
  // length-weighted direction histogram (mod 90 degrees) of the outside boundary segments
  const bins = new Float64Array(90);
  for (const pts of chainsPx) for (let i = 1; i < pts.length; i++) {
    const dx = pts[i][0] - pts[i - 1][0], dy = pts[i][1] - pts[i - 1][1]; const L = Math.hypot(dx, dy); if (L < 4) continue;
    let a = Math.atan2(dy, dx) * 180 / Math.PI; a = ((a % 90) + 90) % 90; bins[Math.floor(a)] += L;
  }
  const score = (i) => bins[i] + bins[(i + 1) % 90] + bins[(i + 89) % 90];
  let best = 0; for (let i = 0; i < 90; i++) if (score(i) > score(best)) best = i;
  let sx = 0, sy = 0;
  for (let d = -6; d <= 6; d++) { const i = (best + d + 90) % 90; const ang = (i + 0.5) * 4 * Math.PI / 180; sx += bins[i] * Math.cos(ang); sy += bins[i] * Math.sin(ang); }
  const refined = ((Math.atan2(sy, sx) * 180 / Math.PI) / 4 + 90) % 90;
  return Number.isFinite(refined) ? refined : best;
}
function regularizeChain(pts, theta) {
  // snap each segment to the nearest of theta + {0, 45, 90, 135}, merge consecutive segments of one direction into a fitted
  // line, and rebuild the vertices where consecutive lines intersect; chain end points stay fixed (shared with neighbours)
  if (pts.length < 3) return pts;
  const dirs = [0, 45, 90, 135].map((d) => { const a = (theta + d) * Math.PI / 180; return [Math.cos(a), Math.sin(a)]; });
  const classOf = (a, b) => { const dx = b[0] - a[0], dy = b[1] - a[1]; let best = 0, bestV = -1; for (let k = 0; k < 4; k++) { const v = Math.abs(dx * dirs[k][0] + dy * dirs[k][1]); if (v > bestV) { bestV = v; best = k; } } return best; };
  const runs = [];
  for (let i = 1; i < pts.length; i++) {
    const c = classOf(pts[i - 1], pts[i]); const L = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
    const last = runs[runs.length - 1];
    if (last && last.c === c) { last.pts.push(pts[i]); last.len += L; } else runs.push({ c, pts: [pts[i - 1], pts[i]], len: L });
  }
  // a short run squeezed between two runs of the same direction is jitter: merge the three
  for (let i = 1; i < runs.length - 1; i++) {
    if (runs[i].len < 6 && runs[i - 1].c === runs[i + 1].c) {
      runs[i - 1].pts = runs[i - 1].pts.concat(runs[i].pts.slice(1), runs[i + 1].pts.slice(1));
      runs[i - 1].len += runs[i].len + runs[i + 1].len;
      runs.splice(i, 2); i = Math.max(0, i - 2);
    }
  }
  if (runs.length === 1) return [pts[0], pts[pts.length - 1]];
  const lines = runs.map((r) => {
    const d = dirs[r.c]; const n = [-d[1], d[0]]; let s = 0, wsum = 0;
    for (let i = 0; i < r.pts.length; i++) { const wgt = (i === 0 || i === r.pts.length - 1) ? 0.5 : 1; s += wgt * (r.pts[i][0] * n[0] + r.pts[i][1] * n[1]); wsum += wgt; }
    return { d, n, c: s / wsum };
  });
  const intersect = (L1, L2) => { const det = L1.n[0] * L2.n[1] - L1.n[1] * L2.n[0]; if (Math.abs(det) < 1e-6) return null; return [(L1.c * L2.n[1] - L2.c * L1.n[1]) / det, (L1.n[0] * L2.c - L2.n[0] * L1.c) / det]; };
  const out = [pts[0]];
  for (let i = 0; i < lines.length - 1; i++) {
    const p = intersect(lines[i], lines[i + 1]); const orig = runs[i].pts[runs[i].pts.length - 1];
    out.push(p && Math.hypot(p[0] - orig[0], p[1] - orig[1]) <= 25 ? p : orig);
  }
  out.push(pts[pts.length - 1]);
  return out;
}

// ------------------------------------------------------------------ geometry / classification
function planeModel(seg, ref) {
  const az = seg.azimuthDegrees * Math.PI / 180, tanP = Math.tan(seg.pitchDegrees * Math.PI / 180);
  const e0 = (seg.center.longitude - ref.lng) * ref.kx, n0 = (seg.center.latitude - ref.lat) * ref.ky;
  const ux = Math.sin(az), uy = Math.cos(az);           // unit vector pointing down-slope (east, north)
  return { seg, z0: seg.planeHeightAtCenterMeters, tanP, ux, uy, e0, n0, pitch: Math.round(degToPitch(seg.pitchDegrees)), az: seg.azimuthDegrees,
    h(e, n) { return this.z0 - this.tanP * ((e - this.e0) * this.ux + (n - this.n0) * this.uy); } };
}
function classifyChain(chain, A, B, geo, insidePx, outsidePx) {
  // A: plane model of the region; B: plane model of the neighbour (null for outside the building)
  const p0 = chain.pts[0], p1 = chain.pts[chain.pts.length - 1];
  const e = [geo.E(p1[0]) - geo.E(p0[0]), geo.N(p1[1]) - geo.N(p0[1])]; const L = Math.hypot(e[0], e[1]) || 1e-9; e[0] /= L; e[1] /= L;
  const mid = chain.pts[Math.floor(chain.pts.length / 2)]; const me = geo.E(mid[0]), mn = geo.N(mid[1]);
  const cIn = geo.center(insidePx), cOut = outsidePx >= 0 ? geo.center(outsidePx) : null;
  if (!B) {
    if (A.pitch < 1) return 'eave';
    const c = Math.abs(e[0] * A.ux + e[1] * A.uy);
    if (c > 0.6) return 'rake';
    return A.h(me, mn) <= A.h(A.e0, A.n0) ? 'eave' : 'unspecified';
  }
  const gap = Math.abs(A.h(me, mn) - B.h(me, mn));
  if (gap > 0.6) { const low = A.h(me, mn) < B.h(me, mn) ? A : B; const c = Math.abs(e[0] * low.ux + e[1] * low.uy); return c > 0.6 ? 'step' : 'wall'; }
  const intoA = A.h(cIn.e, cIn.n) - A.h(cOut.e, cOut.n);      // height change moving from the edge into A
  const intoB = cOut ? B.h(cOut.e, cOut.n) - B.h(cIn.e, cIn.n) : 0;
  const descA = intoA < -1e-4, descB = intoB < -1e-4;
  let azDiff = Math.abs(A.az - B.az) % 360; if (azDiff > 180) azDiff = 360 - azDiff;
  if (A.pitch < 1 || B.pitch < 1) return 'transition';
  if (descA && descB) return azDiff > 150 ? 'ridge' : 'hip';
  if (!descA && !descB) return 'valley';
  return azDiff < 30 ? 'transition' : 'unspecified';
}

// ------------------------------------------------------------------ main
async function traceBuilding(resp, tif, mask, comp, geo, opts) {
  if (AT.v2 && typeof traceBuildingV2 === 'function' && !(opts && opts.v1)) {
    try { const r = traceBuildingV2(resp, tif, mask, comp, geo, opts); if (r && r.facets.length) return r; } catch (e) { console.warn('v2 trace failed, falling back to v1', e); }
  }
  return traceBuildingV1(resp, tif, mask, comp, geo, opts);
}
async function traceBuildingV1(resp, tif, mask, comp, geo, opts) {
  // resp: Solar buildingInsights for this component; returns {facets:[{path,pitch,azimuth}], edges:[{type,path}], unassignedPct}
  const { w, h } = tif;
  const segs = (resp && resp.solarPotential && resp.solarPotential.roofSegmentStats) || [];
  const planes = segs.map((s) => planeModel(s, geo.ref));
  const member = comp.member;
  const label = new Int16Array(w * h).fill(-1);
  let unassigned = 0, total = 0;
  let datum = 0;
  if (planes.length) {
    // plane bounding boxes (in metres, padded) limit which planes a pixel may join
    const boxes = segs.map((s) => ({ e0: (s.boundingBox.sw.longitude - geo.ref.lng) * geo.ref.kx - 1.2, e1: (s.boundingBox.ne.longitude - geo.ref.lng) * geo.ref.kx + 1.2, n0: (s.boundingBox.sw.latitude - geo.ref.lat) * geo.ref.ky - 1.2, n1: (s.boundingBox.ne.latitude - geo.ref.lat) * geo.ref.ky + 1.2 }));
    // the DSM and the plane heights can sit on different vertical datums (ellipsoid vs sea level): estimate the offset
    const perPlane = planes.map(() => []);
    for (let y = 0; y < h; y += 2) for (let x = 0; x < w; x += 2) {
      const i = y * w + x; if (!member[i]) continue; const z = tif.data[i]; if (!(z > -1000)) continue;
      const E = geo.E(x + 0.5), N = geo.N(y + 0.5);
      for (let k = 0; k < planes.length; k++) if (E >= boxes[k].e0 + 1.2 && E <= boxes[k].e1 - 1.2 && N >= boxes[k].n0 + 1.2 && N <= boxes[k].n1 - 1.2) perPlane[k].push(z - planes[k].h(E, N));
    }
    const med = (a) => { if (!a.length) return null; const s = a.slice().sort((p, q) => p - q); return s[Math.floor(s.length / 2)]; };
    const meds = perPlane.map(med).filter((v) => v != null);
    datum = meds.length ? med(meds) : 0;
    for (const p of planes) p.z0 += datum;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = y * w + x; if (!member[i]) continue; total++;
      const z = tif.data[i]; const E = geo.E(x + 0.5), N = geo.N(y + 0.5);
      if (!(z > -1000)) { label[i] = -2; unassigned++; continue; }
      let best = -1, bestD = AT.tolM, bestAny = -1, bestAnyD = Infinity;
      for (let k = 0; k < planes.length; k++) {
        const d = Math.abs(planes[k].h(E, N) - z);
        const inBox = E >= boxes[k].e0 && E <= boxes[k].e1 && N >= boxes[k].n0 && N <= boxes[k].n1;
        if (inBox && d < bestD) { bestD = d; best = k; }
        if (d < bestAnyD) { bestAnyD = d; bestAny = k; }
      }
      if (best < 0 && bestAnyD < AT.tolM) { const k = bestAny; if (E >= boxes[k].e0 - 2 && E <= boxes[k].e1 + 2 && N >= boxes[k].n0 - 2 && N <= boxes[k].n1 + 2) best = k; }
      if (best < 0) { label[i] = -2; unassigned++; } else label[i] = best;
    }
    // a plane may not claim much more ground than Google measured for it (row houses and duplexes share planes with the
    // unit next door): keep the pixels nearest the plane centre, release the rest
    for (let k = 0; k < planes.length; k++) {
      const gA = segs[k].stats && segs[k].stats.groundAreaMeters2; if (!gA) continue;
      const budget = Math.round(gA / geo.pxM2 * 1.2);
      const idx = []; for (let i = 0; i < w * h; i++) if (label[i] === k) idx.push(i);
      if (idx.length <= budget) continue;
      const d2 = (i) => { const x = i % w, y = (i - x) / w; const dE = geo.E(x + 0.5) - planes[k].e0, dN = geo.N(y + 0.5) - planes[k].n0; return dE * dE + dN * dN; };
      idx.sort((a, b) => d2(a) - d2(b));
      for (let j = budget; j < idx.length; j++) { label[idx[j]] = -2; unassigned++; }
    }
    // large blobs that match none of the roof planes are not this roof (an attached neighbour, a carport, a tree over the
    // mask): drop them from the building; small gaps are filled from their neighbours below
    const un = new Uint8Array(w * h); for (let i = 0; i < w * h; i++) un[i] = member[i] && label[i] === -2 ? 1 : 0;
    for (const blob of allComponents(un, w, h)) {
      if (blob.n * geo.pxM2 < AT.dropBlobM2) continue;
      for (let i = 0; i < w * h; i++) if (blob.member[i]) { member[i] = 0; label[i] = -1; }
    }
  } else {
    for (let i = 0; i < w * h; i++) if (member[i]) { label[i] = 0; total++; }
  }
  let lab = fillUnassigned(label, w, h, member);
  lab = majorityFilter(lab, w, h, member, 2, 2);
  lab = majorityFilter(lab, w, h, member, 1, 3);
  const { region, regions } = regionize(lab, w, h, member, geo.pxM2, AT.minRegionM2);
  const facets = [], edges = [];
  // dominant building axis from the outside boundary of the whole component
  const compRegion = new Int32Array(w * h).fill(-1); for (let i = 0; i < w * h; i++) if (member[i]) compRegion[i] = 0;
  const outerLoop = regionOuterLoop(compRegion, w, h, 0);
  const theta = dominantAngle([dpSimplify(outerLoop.map((e) => e.a), AT.dpEpsPx)]);
  for (const r of regions) {
    if (r.n * geo.pxM2 < AT.minRegionM2) continue;
    const loop = regionOuterLoop(region, w, h, r.id);
    if (loop.length < 4) continue;
    const chains = splitChains(loop, region);
    const poly = [];
    for (const ch of chains) {
      const simp = AT.regularize ? regularizeChain(dpSimplify(ch.pts, AT.dpEpsPx), theta) : dpSimplify(ch.pts, AT.dpEpsPx);
      for (let i = 0; i < simp.length - 1; i++) poly.push(simp[i]);
      const nbRegion = ch.outside;
      if (nbRegion >= 0 && nbRegion < r.id) continue;              // shared chain emitted once, by the lower region id
      const A = planes[r.label] || planeModel({ pitchDegrees: 0, azimuthDegrees: 0, center: { latitude: geo.ref.lat, longitude: geo.ref.lng }, planeHeightAtCenterMeters: 0 }, geo.ref);
      const B = nbRegion >= 0 ? (planes[regions[nbRegion].label] || null) : null;
      const midE = ch.edges[Math.floor(ch.edges.length / 2)];
      const type = classifyChain({ pts: simp }, A, nbRegion >= 0 && !B ? A : B, geo, midE.inside, midE.outside);
      edges.push({ type: nbRegion >= 0 && !B ? 'transition' : type, path: simp.map((p) => tif.toLL(p[0], p[1])) });
    }
    if (poly.length < 3) continue;
    const pl = planes[r.label];
    facets.push({ path: poly.map((p) => tif.toLL(p[0], p[1])), pitch: pl ? pl.pitch : (planes.length ? 0 : state.defaultPitch), azimuth: pl ? pl.az : null, areaM2: r.n * geo.pxM2, pitchAssumed: !pl && !planes.length });   // no plane for this region: the pitch is an assumption, flagged below
  }
  return { facets, edges, unassignedPct: total ? Math.round(unassigned / total * 1000) / 10 : 0, planes: planes.length, datum: Math.round(datum * 100) / 100 };
}

// ------------------------------------------------------------------ a second dated dataset of the same building (altview.js)
// The other Solar dataset is fetched for the same centre and radius, put on the current grid, checked against the roof the
// current dataset can see, and - only when the reviewer approved it - used for the pixels the current dataset has under canopy.
async function altLoadLayers(quality, lat, lng, radius) {
  const cache = (window.__altCache = window.__altCache || {}); const key = [quality, lat.toFixed(6), lng.toFixed(6), radius].join('|');
  if (cache[key]) return cache[key];
  const safe = 'alt_' + quality + '_' + String((state.solar && state.solar.name) || 'b').replace(/[^A-Za-z0-9]/g, '_') + '_' + radius;
  const nm = (k) => '_cache_' + safe + '_' + k; const local = location.hostname === 'localhost';
  let layers = null, mT = null, dT = null, rT = null;
  if (local) { try { const meta = await fetch('/reports/' + nm('meta.json')); if (meta.ok) { layers = await meta.json(); mT = await loadTiff('unused', nm('mask.tif')); dT = await loadTiff('unused', nm('dsm.tif')); rT = await loadTiff('unused', nm('rgb.tif')); } } catch (_) { mT = null; } }
  if (!mT || !dT) {
    const full = await solarDataLayers(lat, lng, radius, quality);
    if (!full.maskUrl || !full.dsmUrl) throw new Error('That dataset has no mask and height model');
    [mT, dT] = await Promise.all([loadTiff(full.maskUrl, nm('mask.tif')), loadTiff(full.dsmUrl, nm('dsm.tif'))]);
    try { rT = full.rgbUrl ? await loadTiff(full.rgbUrl, nm('rgb.tif')) : null; } catch (_) { rT = null; }
    layers = { imageryDate: full.imageryDate, imageryQuality: full.imageryQuality };
    if (local) { try { await fetch('/save?name=' + encodeURIComponent(nm('meta.json')), { method: 'POST', body: JSON.stringify(layers) }); } catch (_) { /* best effort */ } }
  }
  return (cache[key] = { layers, maskT: mT, dsmT: dT, rgbT: rT && rT.bands ? rT : null });
}
// nearest-pixel copy of another raster set onto the current grid (the two Solar datasets normally share one grid already)
function altResample(A, cur, w, h) {
  const src = A.dsmT; const o = src.toLL(0, 0), ex = src.toLL(src.w, 0), ey = src.toLL(0, src.h);
  const ax = (ex.lng - o.lng) / src.w, ay = (ex.lat - o.lat) / src.w, bx = (ey.lng - o.lng) / src.h, by = (ey.lat - o.lat) / src.h, det = ax * by - bx * ay;
  const dsm = new Float32Array(w * h).fill(-9999), mask = new Uint8Array(w * h), valid = new Uint8Array(w * h);
  const rgbOk = A.rgbT && A.rgbT.w === src.w && A.rgbT.h === src.h; const rgb = rgbOk ? [new Uint8Array(w * h), new Uint8Array(w * h), new Uint8Array(w * h)] : null;
  const mOk = A.maskT.w === src.w && A.maskT.h === src.h;
  // corners of the current grid in the source grid; rows and columns are then interpolated (both grids are affine in lat/lng here)
  const toSrc = (x, y) => { const v = cur.toLL(x, y); const dl = v.lng - o.lng, da = v.lat - o.lat; return [(dl * by - bx * da) / det, (ax * da - ay * dl) / det]; };
  const p00 = toSrc(0.5, 0.5), p10 = toSrc(w - 0.5, 0.5), p01 = toSrc(0.5, h - 0.5);
  const ux = (p10[0] - p00[0]) / (w - 1), uy = (p10[1] - p00[1]) / (w - 1), vx = (p01[0] - p00[0]) / (h - 1), vy = (p01[1] - p00[1]) / (h - 1);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const sx = Math.floor(p00[0] + ux * x + vx * y), sy = Math.floor(p00[1] + uy * x + vy * y); if (sx < 0 || sy < 0 || sx >= src.w || sy >= src.h) continue;
    const j = sy * src.w + sx, i = y * w + x; const z = src.data[j]; if (!(z > -1000)) continue;
    dsm[i] = z; valid[i] = 1; if (mOk) mask[i] = A.maskT.data[j] > 0 ? 1 : 0; if (rgb) { rgb[0][i] = A.rgbT.bands[0][j]; rgb[1][i] = A.rgbT.bands[1][j]; rgb[2][i] = A.rgbT.bands[2][j]; }
  }
  return { dsm, mask, rgb, valid };
}
function altDilate(m, w, h, r) {
  const t = new Uint8Array(w * h), o = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) { let run = -1e9; for (let x = 0; x < w; x++) { if (m[y * w + x]) run = x; if (x - run <= r) t[y * w + x] = 1; } run = 1e9; for (let x = w - 1; x >= 0; x--) { if (m[y * w + x]) run = x; if (run - x <= r) t[y * w + x] = 1; } }
  for (let x = 0; x < w; x++) { let run = -1e9; for (let y = 0; y < h; y++) { if (t[y * w + x]) run = y; if (y - run <= r) o[y * w + x] = 1; } run = 1e9; for (let y = h - 1; y >= 0; y--) { if (t[y * w + x]) run = y; if (run - y <= r) o[y * w + x] = 1; } }
  return o;
}
// Does the other dataset show the same roof? Compared where the current dataset sees roof: heights after removing the
// datum offset and tilt between the two models, the outline, the roof height above the ground beside it, and three
// "patch" tests that catch a part added, changed or removed between the two flights (a global share would average a
// rear extension away).
function altCheck(dsm, al, roofMask, treeMask, curMask, w, h, geo) {
  const N = w * h, px = Math.sqrt(geo.pxM2); const near = altDilate(roofMask, w, h, Math.round(4 / px)), treeD = altDilate(treeMask, w, h, Math.round(1.2 / px));
  const R = 6, MG = R + 2; const roof = [], gnd = [];
  for (let y = MG; y < h - MG; y++) for (let x = MG; x < w - MG; x++) { const i = y * w + x; if (!al.valid[i] || !(dsm[i] > -1000) || treeD[i]) continue; if (roofMask[i]) roof.push(i); else if (near[i] && !curMask[i] && !al.mask[i]) gnd.push(i); }
  const out = { ok: false, roofSqft: roof.length * geo.pxM2 * 10.7639104, reasons: [] };
  if (roof.length * geo.pxM2 < 15) { out.reasons.push('Too little clearly visible roof to compare the two datasets.'); return out; }
  const med = (a) => { const s = Float32Array.from(a).sort(); return s.length ? s[s.length >> 1] : 0; };
  const sub = (a, n) => { const st = Math.max(1, Math.floor(a.length / n)); const o = []; for (let k = 0; k < a.length; k += st) o.push(a[k]); return o; };
  const rs = sub(roof, 5000), gs = sub(gnd, 2500), hasG = gnd.length >= 200; const xc = w / 2, yc = h / 2;
  // heights are compared away from the roof's edges (0.8 m in): a softer dataset blurs every eave and ridge by design
  const inv = new Uint8Array(N); for (let i = 0; i < N; i++) inv[i] = roofMask[i] && !treeD[i] ? 0 : 1;
  let inner = []; for (const rr of [Math.round(0.8 / px), Math.round(0.4 / px)]) { const edge = altDilate(inv, w, h, rr); inner = roof.filter((i) => !edge[i]); if (inner.length * geo.pxM2 >= 10) break; }
  if (inner.length * geo.pxM2 < 5) inner = roof;
  const tiltAt = (T, i) => T[0] * ((i % w) - xc) + T[1] * (Math.floor(i / w) - yc);
  // shift search with the tilt taken out (a tilted pair with no displacement otherwise reads as a shift)
  const search = (T) => { const cost = (dx, dy) => { const sh = dy * w + dx; const d = []; for (const i of rs) { const v = dsm[i] - al.dsm[i + sh] - tiltAt(T, i); if (v > -500 && v < 500) d.push(v); } if (d.length < rs.length * 0.7) return null; const off = med(d); let c = 0, n = 0; for (const v of d) { c += Math.min(Math.abs(v - off), 0.8); n++; } for (const i of gs) { const v = dsm[i] - al.dsm[i + sh] - tiltAt(T, i); if (v > -500 && v < 500) { c += Math.min(Math.abs(v - off), 0.8); n++; } } return { c: c / n, off }; };
    const zero = cost(0, 0); let b = { dx: 0, dy: 0, ...(zero || { c: 9, off: 0 }) };
    for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) { if (!dx && !dy) continue; const q = cost(dx, dy); if (q && q.c < b.c) b = { dx, dy, ...q }; }
    if (zero && b.c > zero.c * 0.93) b = { dx: 0, dy: 0, ...zero };              // only shift when it clearly helps
    return b; };
  // offset (roof) | offset (ground) + tilt in x and y. Separate roof and ground offsets: a roof raised or lowered shows up as their difference
  const fit = (sh) => { const diff = (i) => { const v = dsm[i] - al.dsm[i + sh]; return v > -500 && v < 500 ? v : null; };
    const S = sub(inner, 5000).map((i) => [i, 0]).concat(hasG ? gs.map((i) => [i, 1]) : []);
    let P = [med(inner.map(diff).filter((v) => v != null)), 0, 0, 0]; P[1] = hasG ? med(gnd.map(diff).filter((v) => v != null)) : P[0];
    for (let pass = 0; pass < 5; pass++) { const thr = [0.9, 0.6, 0.45, 0.35, 0.35][pass]; const A = [0, 1, 2, 3].map(() => new Float64Array(5));
      for (const [i, g] of S) { const v = diff(i); if (v == null) continue; const x = (i % w) - xc, y = Math.floor(i / w) - yc; if (Math.abs(v - (P[g] + P[2] * x + P[3] * y)) > thr) continue; const row = [g ? 0 : 1, g ? 1 : 0, x, y], wt = g ? 0.5 : 1; for (let a = 0; a < 4; a++) { for (let b = 0; b < 4; b++) A[a][b] += wt * row[a] * row[b]; A[a][4] += wt * row[a] * v; } }
      if (!hasG) { A[1][0] -= 1e7; A[1][1] += 1e7; }                             // no usable ground: tie the ground offset to the roof offset
      for (let a = 0; a < 4; a++) A[a][a] += 1e-6;
      for (let c = 0; c < 4; c++) { let piv = c; for (let r = c + 1; r < 4; r++) if (Math.abs(A[r][c]) > Math.abs(A[piv][c])) piv = r; [A[c], A[piv]] = [A[piv], A[c]]; if (Math.abs(A[c][c]) < 1e-12) continue; for (let r = 0; r < 4; r++) { if (r === c) continue; const f = A[r][c] / A[c][c]; for (let k = c; k < 5; k++) A[r][k] -= f * A[c][k]; } }
      const Q = [0, 1, 2, 3].map((c) => (Math.abs(A[c][c]) < 1e-12 ? P[c] : A[c][4] / A[c][c])); if (Q.every(Number.isFinite)) P = Q; }
    return P; };
  let best = search([0, 0]), P = fit(best.dy * w + best.dx);
  for (let round = 0; round < 3; round++) { const nb = search([P[2], P[3]]); if (nb.dx === best.dx && nb.dy === best.dy) break; best = nb; P = fit(best.dy * w + best.dx); }
  const sh = best.dy * w + best.dx; const diff = (i) => { const v = dsm[i] - al.dsm[i + sh]; return v > -500 && v < 500 ? v : null; };
  const offAt = (i) => P[0] + tiltAt([P[2], P[3]], i);
  let agree = 0, se = 0, sn = 0, dn = 0; for (const i of inner) { const v = diff(i); if (v == null) continue; dn++; const r = Math.abs(v - offAt(i)); if (r <= 0.3) agree++; if (r <= 0.6) { se += r * r; sn++; } }
  let onMask = 0; for (const i of roof) if (al.mask[i + sh]) onMask++;
  const tilt10 = Math.hypot(P[2], P[3]) / px * 10;                                // metres of tilt per 10 m
  // patch tests: the largest connected piece of roof that exists in one dataset and not in the other, or stands at a different height
  const big = (m) => { let bestN = 0; const seen = new Uint8Array(N); for (let s0 = 0; s0 < N; s0++) { if (!m[s0] || seen[s0]) continue; let n = 0; const st = [s0]; seen[s0] = 1; while (st.length) { const i = st.pop(); n++; const x = i % w; for (const j of [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, i - w, i + w]) if (j >= 0 && j < N && m[j] && !seen[j]) { seen[j] = 1; st.push(j); } } if (n > bestN) bestN = n; } return bestN * geo.pxM2; };
  const am = new Uint8Array(N), altc = new Float32Array(N).fill(NaN); for (let y = MG; y < h - MG; y++) for (let x = MG; x < w - MG; x++) { const i = y * w + x, j = i + sh; if (!al.valid[j]) continue; am[i] = al.mask[j]; altc[i] = al.dsm[j] + offAt(i); }
  const r06 = Math.round(0.6 / px), amD = altDilate(am, w, h, r06), curD = altDilate(curMask, w, h, r06), near10 = altDilate(roofMask, w, h, Math.round(10 / px));
  const added = new Uint8Array(N), changed = new Uint8Array(N), removed = new Uint8Array(N);
  for (let i = 0; i < N; i++) { if (!(altc[i] === altc[i]) || !(dsm[i] > -1000)) continue; const d = dsm[i] - altc[i];
    if (roofMask[i] && !amD[i] && d > 1) added[i] = 1;                                        // roof now, open ground then
    if (roofMask[i] && !treeD[i] && am[i] && Math.abs(d) > 1) changed[i] = 1;                 // roof in both, at a different height
    if (am[i] && !treeD[i] && !treeMask[i] && !curD[i] && near10[i] && d < -1) removed[i] = 1; }   // roof then, open ground now
  const erode = (m, r) => { const q = new Uint8Array(N); for (let i = 0; i < N; i++) q[i] = m[i] ? 0 : 1; const dq = altDilate(q, w, h, r); const o = new Uint8Array(N); for (let i = 0; i < N; i++) o[i] = m[i] && !dq[i] ? 1 : 0; return o; };
  const patch = { addedM2: big(added), changedM2: big(erode(changed, Math.round(0.5 / px))), removedM2: big(removed) };
  Object.assign(out, { shiftPx: [best.dx, best.dy], shiftM: Math.hypot(best.dx, best.dy) * px, offsetM: P[0], tilt: [P[2], P[3]], tiltPer10m: tilt10, centre: [xc, yc], interiorSqft: inner.length * geo.pxM2 * 10.7639104, heightAgreePct: dn ? agree / dn * 100 : 0, rmsM: sn ? Math.sqrt(se / sn) : null, outlineAgreePct: onMask / roof.length * 100, heightChangeM: hasG ? P[0] - P[1] : null, patchSqft: { added: patch.addedM2 * 10.7639104, changed: patch.changedM2 * 10.7639104, removed: patch.removedM2 * 10.7639104 }, aligned: Math.max(Math.abs(best.dx), Math.abs(best.dy)) < R });
  if (!out.aligned) out.reasons.push(`The two datasets could not be lined up: they sit ${(R * px * 3.28084).toFixed(0)} ft or more apart.`);
  if (tilt10 > 1.2) out.reasons.push(`The two height models are tilted against each other by ${tilt10.toFixed(1)} m in 10 m: too much to carry heights across.`);
  if (out.heightAgreePct < 80) out.reasons.push(`Only ${out.heightAgreePct.toFixed(0)}% of the visible roof (away from its edges) has the same height in both datasets (80% needed).`);
  if (out.outlineAgreePct < 85) out.reasons.push(`Only ${out.outlineAgreePct.toFixed(0)}% of the visible roof lies inside the other dataset's building outline (85% needed).`);
  if (out.heightChangeM != null && Math.abs(out.heightChangeM) > 0.5) out.reasons.push(`The roof stands ${Math.abs(out.heightChangeM).toFixed(1)} m ${out.heightChangeM > 0 ? 'higher' : 'lower'} above the ground in the current dataset: the building may have changed.`);
  if (patch.addedM2 >= 1.5) out.reasons.push(`${Math.round(patch.addedM2 * 10.7639104)} sq ft of roof seen in the trace image is open ground in the other dataset: part of the roof was added or the other dataset is older than it.`);
  if (patch.changedM2 >= 1.5) out.reasons.push(`${Math.round(patch.changedM2 * 10.7639104)} sq ft of roof stands at a different height in the two datasets: that part was rebuilt.`);
  if (patch.removedM2 >= 1.5) out.reasons.push(`${Math.round(patch.removedM2 * 10.7639104)} sq ft of building in the other dataset is open ground in the trace image: part of the building was removed.`);
  out.ok = !out.reasons.length;
  return out;
}

// why no building could be traced: Google has a building record here but its image shows no building outline
// A low-slope section (4/12 or less) whose surface does not fit a plane well (rms 6 cm or more, 50 sq ft or more) is
// what a screen enclosure, a pergola or an open patio cover looks like in the height model: the model cannot tell them
// from roofing. Such a section stays in the sketch but is marked for verification, so the report asks for review.
function rmOpenCover(f) {
  if (!(f.slope != null && f.slope <= 0.34 && (f.rms || 0) >= 0.06 && (f.areaM2 || 0) * Math.sqrt(1 + f.slope * f.slope) >= 4.65)) return null;
  return { source: 'Height model', date: '', note: `Low-slope section with an uneven surface (${(f.rms * 100).toFixed(0)} cm from a flat plane): it may be a screen enclosure, a pergola or an open patio cover rather than roofing.` };
}
// Google keeps one dataset per quality tier, often flown years apart. When a NEWER tier of the same building shows a lot
// more roof than the image traced (25% or more), the building was probably extended or rebuilt after the traced flight
// (or more of it was under trees then). Only the tiers' own roof-area figures are compared: two small requests.
async function rmNewerRecords(main) {
  if (typeof fetchSolarTier !== 'function' || !main || !main.imageryDate) return null;
  const cur = String(main.imageryQuality || '').toUpperCase(), d0 = Date.UTC(main.imageryDate.year, main.imageryDate.month - 1, main.imageryDate.day || 1);
  const a0 = main.solarPotential && main.solarPotential.wholeRoofStats ? main.solarPotential.wholeRoofStats.areaMeters2 : null; if (!a0) return null;
  const out = [];
  for (const q of ['HIGH', 'MEDIUM', 'BASE']) { if (q === cur) continue; let r = null; try { r = await fetchSolarTier(main.center.latitude, main.center.longitude, q); } catch (_) { continue; }
    if (!r || r.name !== main.name || !r.imageryDate) continue; const d = Date.UTC(r.imageryDate.year, r.imageryDate.month - 1, r.imageryDate.day || 1); if (d - d0 < 365 * 864e5) continue;
    const a = r.solarPotential && r.solarPotential.wholeRoofStats ? r.solarPotential.wholeRoofStats.areaMeters2 : null; if (!a) continue;
    out.push({ quality: q, date: r.imageryDate, roofM2: a, tracedRoofM2: a0, ratio: a / a0 }); }
  return out;
}
async function fetchSolarTier(lat, lng, q) {
  if (typeof fetch !== 'function' || !state.key) return null;
  const r = await fetch(`https://solar.googleapis.com/v1/buildingInsights:findClosest?location.latitude=${lat}&location.longitude=${lng}&requiredQuality=${q}&exactQualityRequired=true&key=${encodeURIComponent(state.key)}`);
  return r.ok ? r.json() : null;
}
// how far the address point is from the building that was measured (Google picks the building nearest the point; a
// geocode on an empty lot or between houses can pick the neighbour's)
function rmAddressCheck(res, kx, ky, cLat, cLng) {
  const loc = state.location; if (!loc || !res || !res.facets) return null;
  const P = [(loc.lng - cLng) * kx, (loc.lat - cLat) * ky]; let best = Infinity, inside = false;
  for (const f of res.facets) { const r = f.path.map((v) => [(v.lng - cLng) * kx, (v.lat - cLat) * ky]); let c = false;
    for (let i = 0, j = r.length - 1; i < r.length; j = i++) { const a = r[i], b = r[j]; if ((a[1] > P[1]) !== (b[1] > P[1]) && P[0] < (b[0] - a[0]) * (P[1] - a[1]) / (b[1] - a[1]) + a[0]) c = !c;
      const dx = b[0] - a[0], dy = b[1] - a[1], l2 = dx * dx + dy * dy || 1e-9; const t = Math.max(0, Math.min(1, ((P[0] - a[0]) * dx + (P[1] - a[1]) * dy) / l2)); best = Math.min(best, Math.hypot(P[0] - a[0] - t * dx, P[1] - a[1] - t * dy)); }
    if (c) inside = true; }
  return { distM: inside ? 0 : best, precision: loc.precision || null, partial: !!loc.partial };
}
const fmtDate = (d) => (d ? `${d.year}-${String(d.month).padStart(2, '0')}-${String(d.day).padStart(2, '0')}` : 'an unknown date');
function rmNoBuilding(layers, main) {
  const d = (layers && layers.imageryDate) || main.imageryDate; const date = d ? `${d.year}-${String(d.month).padStart(2, '0')}-${String(d.day).padStart(2, '0')}` : 'an unknown date';
  return `Google's imagery of this location (flown ${date}) shows no building outline at the selected building. The building may be newer than the image, or hidden by trees.`;
}
async function autoTraceRoof(opts = {}) {
  if (!state.solar) throw new Error('Get roof data first');
  const main = state.solar;
  // a second dated dataset: opts.altProbe only checks it; state.altFusion (set after the reviewer approved it) uses it
  const opts0 = opts;
  // an approval belongs to one building: it never follows the user to the next address
  if (state.altFusion && state.altFusion.building && state.altFusion.building !== main.name) state.altFusion = null;
  const altReq = opts.altProbe || (!opts.noAlt && state.altFusion) || null;
  let bb = main.boundingBox;
  if (altReq && altReq.bbox) bb = { sw: { latitude: Math.min(bb.sw.latitude, altReq.bbox.sw.latitude), longitude: Math.min(bb.sw.longitude, altReq.bbox.sw.longitude) }, ne: { latitude: Math.max(bb.ne.latitude, altReq.bbox.ne.latitude), longitude: Math.max(bb.ne.longitude, altReq.bbox.ne.longitude) } };
  const cLat = main.center.latitude, cLng = main.center.longitude;
  // metres per degree on the WGS84 ellipsoid at this latitude (roofmodel.js); the old round numbers were 0.3% off north-south
  const { kx, ky } = typeof RM !== 'undefined' ? RM.scale(cLat) : { kx: 111320 * Math.cos(cLat * Math.PI / 180), ky: 110540 };
  const halfDiag = Math.hypot((bb.ne.longitude - bb.sw.longitude) * kx, (bb.ne.latitude - bb.sw.latitude) * ky) / 2;
  const radius = Math.min(100, Math.max(15, Math.ceil(halfDiag + 12)));
  if (!opts.quiet) toast('Downloading roof height model...');
  // cache the downloaded rasters per building in this session: re-tracing (or re-printing) the same roof costs nothing extra
  const cacheKey = main.name + '|' + radius;
  const cache = (window.__layerCache = window.__layerCache || {});
  let cached = cache[cacheKey];
  if (!cached) {
    const safe = String(main.name || 'b').replace(/[^A-Za-z0-9]/g, '_') + '_' + radius;
    const mName = '_cache_' + safe + '_mask.tif', dName = '_cache_' + safe + '_dsm.tif';
    let mT = null, dT = null, layers = null;
    if (location.hostname === 'localhost') {
      try { const ok = (await fetch('/reports/' + mName)).ok && (await fetch('/reports/' + dName)).ok && (await fetch('/reports/_cache_' + safe + '_rgb.tif')).ok; if (ok) { mT = await loadTiff('unused', mName); dT = await loadTiff('unused', dName); layers = { imageryDate: main.imageryDate, fromDiskCache: true }; } } catch (_) { mT = null; }
    }
    if (!mT) {
      layers = await solarDataLayers(cLat, cLng, radius);
      if (!layers.maskUrl || !layers.dsmUrl) throw new Error('Data layers did not include a mask and DSM');
      [mT, dT] = await Promise.all([loadTiff(layers.maskUrl, mName), loadTiff(layers.dsmUrl, dName)]);
    }
    // aerial colour layer of the same flight (same grid as the height model): vegetation test + the report's aerial view
    let rT = null; const rName = '_cache_' + safe + '_rgb.tif';
    try { rT = layers.rgbUrl ? await loadTiff(layers.rgbUrl, rName) : (location.hostname === 'localhost' && (await fetch('/reports/' + rName)).ok ? await loadTiff('unused', rName) : null); } catch (_) { rT = null; }
    cached = cache[cacheKey] = { layers, maskT: mT, dsmT: dT, rgbT: rT };
  }
  if (cached.rgbT === undefined && cached.layers && cached.layers.rgbUrl) { try { cached.rgbT = await loadTiff(cached.layers.rgbUrl, '_cache_' + String(main.name || 'b').replace(/[^A-Za-z0-9]/g, '_') + '_' + radius + '_rgb.tif'); } catch (_) { cached.rgbT = null; } }
  let { layers, maskT, dsmT } = cached; let rgbT = cached.rgbT && cached.rgbT.bands && cached.rgbT.w === dsmT.w && cached.rgbT.h === dsmT.h ? cached.rgbT : null;
  // Google's building record can come from a newer flight than the best (high quality) layers. When the selected building
  // has no outline in those layers (built after that flight), trace from the flight the record itself comes from. It is
  // usually medium quality: the report then says so and asks for review.
  let layerChoice = null;
  { const recQ = main.imageryQuality ? String(main.imageryQuality).toUpperCase() : null, layQ = layers && layers.imageryQuality ? String(layers.imageryQuality).toUpperCase() : null;
    const dOf = (d) => (d ? Date.UTC(d.year, d.month - 1, d.day) : null); const recD = dOf(main.imageryDate), layD = dOf(layers && layers.imageryDate);
    if (recQ && recD && layD && recD - layD > 180 * 864e5) {
      let inBox = 0; const pad = 3 / kx, padN = 3 / ky; const lo = { la: bb.sw.latitude - padN, ln: bb.sw.longitude - pad }, hi = { la: bb.ne.latitude + padN, ln: bb.ne.longitude + pad };
      for (let y = 0; y < maskT.h; y += 2) for (let x = 0; x < maskT.w; x += 2) { if (!(maskT.data[y * maskT.w + x] > 0)) continue; const q = maskT.toLL(x + 0.5, y + 0.5); if (q.lat >= lo.la && q.lat <= hi.la && q.lng >= lo.ln && q.lng <= hi.ln) inBox++; }
      const pxM2 = 0.01 * 4; layerChoice = { recordDate: main.imageryDate, recordQuality: recQ, layersDate: layers.imageryDate, layersQuality: layQ, buildingInLayers: inBox * pxM2 >= 15, used: 'layers' };
      if (!layerChoice.buildingInLayers && recQ !== layQ) {
        try { const A = await altLoadLayers(recQ, cLat, cLng, radius); if (A && A.maskT && A.dsmT) { layers = A.layers; maskT = A.maskT; dsmT = A.dsmT; rgbT = A.rgbT && A.rgbT.bands && A.rgbT.w === A.dsmT.w && A.rgbT.h === A.dsmT.h ? A.rgbT : null; layerChoice.used = 'record'; if (!opts.quiet) toast(`The best image (${fmtDate(layerChoice.layersDate)}) shows no building here; tracing from the newer ${recQ.toLowerCase()} quality image (${fmtDate(main.imageryDate)}).`, true); } }
        catch (e) { layerChoice.error = String(e.message || e); }
      }
    } }

  // hidden zones a reviewer confirmed from another source are passed to the tracer as points in its metre frame
  opts = { ...opts, rgb: rgbT ? rgbT.bands : null, acceptHidden: (state.acceptedHidden || []).map((p) => [(p.lng - cLng) * kx, (p.lat - cLat) * ky]) };
  if (maskT.w !== dsmT.w || maskT.h !== dsmT.h) throw new Error('Mask and DSM sizes differ');
  const w = maskT.w, h = maskT.h;
  let mask = new Uint8Array(w * h); for (let i = 0; i < w * h; i++) mask[i] = maskT.data[i] > 0 ? 1 : 0;
  let dsmUse = dsmT, altInfo = null;
  // metres frame relative to the building centre
  const ref = { lat: cLat, lng: cLng, kx, ky };
  const Ecol = new Float64Array(w + 1), Nrow = new Float64Array(h + 1);
  for (let x = 0; x <= w; x++) Ecol[x] = (maskT.toLL(x, 0).lng - cLng) * kx;
  for (let y = 0; y <= h; y++) Nrow[y] = (maskT.toLL(0, y).lat - cLat) * ky;
  const geo = {
    ref, E: (x) => { const i = Math.floor(x); const f = x - i; return i >= w ? Ecol[w] : Ecol[i] + f * (Ecol[Math.min(i + 1, w)] - Ecol[i]); }, N: (y) => { const i = Math.floor(y); const f = y - i; return i >= h ? Nrow[h] : Nrow[i] + f * (Nrow[Math.min(i + 1, h)] - Nrow[i]); },
    pxM2: Math.abs((Ecol[1] - Ecol[0]) * (Nrow[1] - Nrow[0])),
    center: (i) => { const x = i % w, y = (i - x) / w; return { e: (Ecol[x] + Ecol[x + 1]) / 2, n: (Nrow[y] + Nrow[y + 1]) / 2 }; },
    X: (E) => (E - Ecol[0]) / (Ecol[w] - Ecol[0]) * w, Y: (N) => (N - Nrow[0]) / (Nrow[h] - Nrow[0]) * h,
  };
  const pick = (mask) => {
  // keep only mask pixels inside the building's own bounding box (padded); attached neighbours and row houses otherwise merge in
  const padM = 2.5;
  const bE0 = (bb.sw.longitude - cLng) * kx - padM, bE1 = (bb.ne.longitude - cLng) * kx + padM, bN0 = (bb.sw.latitude - cLat) * ky - padM, bN1 = (bb.ne.latitude - cLat) * ky + padM;
  const clipped = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) { const N = geo.N(y + 0.5); if (N < bN0 || N > bN1) continue; for (let x = 0; x < w; x++) { const i = y * w + x; if (!mask[i]) continue; const E = geo.E(x + 0.5); if (E >= bE0 && E <= bE1) clipped[i] = 1; } }
  // the main building is the mask piece that fills Google's building box best (the box centre can fall outside an L-shaped house)
  let sx = -1, sy = -1;
  {
    let pieces = allComponents(clipped, w, h);
    const cx0 = (geo.X(0) || w / 2), cy0 = (geo.Y(0) || h / 2);
    if (!pieces.length) {
      // Google's building box missed the mask (box from older imagery): take the nearest roof piece instead
      const near = allComponents(mask, w, h).filter((pc) => pc.n * geo.pxM2 >= 20 && Math.hypot(pc.cx - cx0, pc.cy - cy0) * Math.sqrt(geo.pxM2) < 20);
      for (const pc of near) for (let i = 0; i < w * h; i++) if (pc.member[i]) clipped[i] = 1;
      pieces = near;
    }
    if (!pieces.length) throw new Error(rmNoBuilding(layers, main));
    let best = null, bestScore = -Infinity;
    for (const pc of pieces) { const d = Math.hypot(pc.cx - cx0, pc.cy - cy0) * Math.sqrt(geo.pxM2); const score = pc.n * geo.pxM2 - d * 2; if (score > bestScore) { bestScore = score; best = pc; } }
    for (let i = 0; i < w * h; i++) if (best.member[i]) { sx = i % w; sy = (i - sx) / w; break; }
  }
  const mainFlood = floodComponent(clipped, w, h, sx, sy);
  if (!mainFlood.n) throw new Error(rmNoBuilding(layers, main));
  let msx = 0, msy = 0, mminx = w, mmaxx = 0, mminy = h, mmaxy = 0;
  for (let j = 0; j < w * h; j++) if (mainFlood.out[j]) { const px = j % w, py = (j - px) / w; msx += px; msy += py; if (px < mminx) mminx = px; if (px > mmaxx) mmaxx = px; if (py < mminy) mminy = py; if (py > mmaxy) mmaxy = py; }
  const mainComp = { member: mainFlood.out, n: mainFlood.n, cx: msx / mainFlood.n, cy: msy / mainFlood.n, bbox: [mminx, mminy, mmaxx, mmaxy] };
  // everything else in the mask (minus the main building) is a candidate outbuilding
  const rest = new Uint8Array(w * h); for (let i = 0; i < w * h; i++) rest[i] = mask[i] && !mainComp.member[i] ? 1 : 0;
  const comps = allComponents(rest, w, h);
  return { mainComp, comps }; };
  if (altReq) {
    // pass 1, current dataset alone: where it sees canopy and where it sees roof it can measure
    const first = pick(mask); const r1 = await traceBuilding(main, dsmT, mask, first.mainComp, geo, { ...opts, wantTree: true, alt: null });
    if (!r1.treeMask) throw new Error('The current trace has no canopy layer to compare against');
    const A = await altLoadLayers(altReq.quality, cLat, cLng, radius); const al = altResample(A, maskT, w, h);
    const chk = altCheck(dsmT.data, al, r1.roofMask, r1.treeMask, mask, w, h, geo);
    const d = A.layers.imageryDate; const date = d ? `${d.year}-${String(d.month).padStart(2, '0')}-${String(d.day).padStart(2, '0')}` : null;
    const srcName = 'Google Solar API, ' + String(A.layers.imageryQuality || altReq.quality).toLowerCase() + ' quality';
    altInfo = { quality: A.layers.imageryQuality || altReq.quality, date, source: srcName, label: srcName + (date ? ', flown ' + date : ''), check: chk, used: false, soft: String(A.layers.imageryQuality || altReq.quality).toUpperCase() !== 'HIGH' };
    if (opts.altProbe) return { alt: altInfo, hiddenZones: (r1.obstruction && r1.obstruction.hiddenZones) || [] };
    if (chk.ok && altReq.approved) {
      // carry the other dataset in only where the current one has canopy (plus its blurred rim); everything else stays as flown
      const sh = chk.shiftPx[1] * w + chk.shiftPx[0]; const zone = altDilate(r1.treeMask, w, h, Math.round(1.2 / Math.sqrt(geo.pxM2))); const mg = Math.max(Math.abs(chk.shiftPx[0]), Math.abs(chk.shiftPx[1])) + 1;
      // what the other dataset supplies = copied pixels the trace image did not itself measure as roof (under canopy, or
      // roof only the other dataset's mask shows). Copied rim pixels that were measured roof already stay as measured.
      const unseen = new Uint8Array(w * h); for (let i = 0; i < w * h; i++) unseen[i] = r1.roofMask[i] ? 0 : 1;
      const d2 = Float32Array.from(dsmT.data), m2 = Uint8Array.from(mask), used = new Uint8Array(w * h); const rb = opts.rgb && al.rgb ? opts.rgb.map((b) => Uint8Array.from(b)) : opts.rgb; let n = 0;
      for (let y = mg; y < h - mg; y++) for (let x = mg; x < w - mg; x++) { const i = y * w + x; if (!zone[i]) continue; const j = i + sh; if (!al.valid[j]) continue; d2[i] = al.dsm[j] + chk.offsetM + chk.tilt[0] * (x - chk.centre[0]) + chk.tilt[1] * (y - chk.centre[1]); m2[i] = al.mask[j]; used[i] = 1; n++; if (rb && al.rgb) { rb[0][i] = al.rgb[0][j]; rb[1][i] = al.rgb[1][j]; rb[2][i] = al.rgb[2][j]; } }
      dsmUse = { ...dsmT, data: d2 }; mask = m2; opts = { ...opts, rgb: rb, alt: { used, hidden: unseen, label: altInfo.source, text: altInfo.label, soft: altInfo.soft } };
      altInfo.used = n > 0; altInfo.approved = altReq.approved; altInfo.cacheKey = [altReq.quality, cLat.toFixed(6), cLng.toFixed(6), radius].join('|');
    }
  }
  const { mainComp, comps } = pick(mask);
  const results = [];
  const mainRes = await traceBuilding(main, dsmUse, mask, mainComp, geo, opts);
  results.push({ comp: mainComp, res: mainRes, resp: main });
  // other structures in the frame (sheds, detached garages): nearest-building lookup gives their planes
  // candidate outbuildings: small, fully inside the frame, close to the main building (large components are neighbours)
  const mainDist = (c) => Math.hypot(geo.E(c.cx) - geo.E(mainComp.cx), geo.N(c.cy) - geo.N(mainComp.cy));
  const others = comps.filter((c) => c !== mainComp && c.n * geo.pxM2 >= AT.minOtherM2 && c.n * geo.pxM2 <= AT.maxOtherM2 && c.bbox[0] > 0 && c.bbox[1] > 0 && c.bbox[2] < w - 1 && c.bbox[3] < h - 1 && mainDist(c) <= AT.maxOtherDistM).sort((a, b) => b.n - a.n).slice(0, AT.maxOtherStructures);
  const mainRoofM2 = (main.solarPotential && main.solarPotential.wholeRoofStats && main.solarPotential.wholeRoofStats.areaMeters2) || 0;
  for (const c of others) {
    if (c.n > mainComp.n * 0.45) continue;                                   // too big for an outbuilding: a neighbour
    const ll = maskT.toLL(c.cx + 0.5, c.cy + 0.5);
    let resp = null;
    try {
      const r = await fetchSolar(ll.lat, ll.lng);
      if (r.name === main.name) continue;                                     // Google says this is part of the main building
      const area = r.solarPotential && r.solarPotential.wholeRoofStats ? r.solarPotential.wholeRoofStats.areaMeters2 : 0;
      if (mainRoofM2 && area > mainRoofM2 * 0.5) continue;                   // a neighbouring house, not a shed
      const inside = r.center && Math.abs((r.center.longitude - ll.lng) * kx) < 8 && Math.abs((r.center.latitude - ll.lat) * ky) < 8;
      resp = inside ? r : null;
    } catch (_) { /* no model for this component */ }
    try { const res = await traceBuilding(resp, dsmUse, mask, c, geo, opts); results.push({ comp: c, res, resp }); } catch (_) { /* skip */ }
  }
  // The other dataset was copied in around the canopy, but did it show any roof the trace image hides? If it resolved
  // less than 1 m2 (the same tree is over the same corner, say), the sketch must not be built on it: trace again without it.
  if (altInfo && altInfo.used) { const resolved = results.reduce((a, r) => a + (r.res.altResolvedPx || 0), 0) * geo.pxM2;
    if (resolved < 1) { const info2 = await autoTraceRoof({ ...opts0, noAlt: true }); const na = { ...altInfo, used: false, reasons: ['The other dataset shows none of the roof this one has under tree canopy, so nothing was carried in.'] }; info2.alt = na; if (state.trace) state.trace.alt = na; return info2; } }
  // load into the app
  for (const f of state.facets) f.shape.setMap(null); for (const e of state.edges) e.shape.setMap(null);
  state.facets = []; state.edges = []; state.selected = null;
  let fi = 0, mainSqft = 0;
  const hiddenZones = [];
  results.forEach(({ res }, idx) => {
    const base = fi;
    if (res.obstruction && res.obstruction.hiddenZones) for (const z of res.obstruction.hiddenZones) hiddenZones.push({ ...z, id: 'Z' + (hiddenZones.length + 1), structure: idx + 1, facetName: z.facet != null ? 'F' + (base + z.facet + 1) : null });
    for (const f of res.facets) {
      // engine evidence kept on the facet: exact fitted slope, fit quality, Measured / Inferred / Unresolved, raw outline
      const added = addFacet(f.path, f.pitch, `F${++fi}`, f.slope != null ? { azimuth: f.azimuth, slope: f.slope, rms: f.rms, status: f.status, auto: true, structure: idx + 1, plane: f.plane, repaired: f.repaired, evidenceKind: f.evidenceKind, rangeSqft: f.rangeSqft, evidence: f.evidence, missing: f.missing, rawPath: f.rawPath, inferredSqft: f.inferredSqft, altSqft: f.altSqft, confirmedBy: f.confirmedBy ? { source: f.confirmedBy, date: (altInfo && altInfo.date) || '' } : null, verify: rmOpenCover(f) } : { azimuth: f.azimuth, structure: idx + 1, verify: f.pitchAssumed ? { source: 'assumed', date: '', note: 'no roof plane could be fitted here: the pitch is the job default, not a measurement' } : null });
      if (idx === 0) mainSqft += facetMetrics(added).sloped;
    }
    for (const e of res.edges) addEdge(e.type, e.path, null, '', e.factor != null ? { factor: e.factor, basis: e.basis, status: e.status, autoType: e.type, obscuredFt: e.obscuredFt, structure: idx + 1, evidence: e.evidence, missing: e.missing, paired: e.paired, confirmedBy: e.confirmedBy ? { source: e.confirmedBy, date: (altInfo && altInfo.date) || '' } : null, altFt: e.altFt } : { structure: idx + 1 });
  });
  state.otherSolar = results.slice(1).map((r) => r.resp).filter(Boolean);
  if (typeof drawSolar === 'function') drawSolar();
  if (altInfo && altInfo.used) altInfo.usedSqft = results.reduce((a, r) => a + r.res.facets.reduce((q, f) => q + (f.altSqft || 0), 0), 0);
  const info = { structures: results.length, facets: fi, edges: state.edges.length, mainSqft: Math.round(mainSqft), unassignedPct: mainRes.unassignedPct, planes: mainRes.planes, datum: mainRes.datum, radius, imageryDate: layers.imageryDate, size: `${w}x${h}`, obstruction: mainRes.obstruction || null, hiddenZones, repairs: mainRes.repairs || [], plot: mainRes.plot || null, alt: altInfo };
  // what the trace was made from, for the review panel, the audit trail and the report
  state.trace = { engine: 'v2.1', tracedAt: new Date().toISOString(), imageryDate: (layers || {}).imageryDate || main.imageryDate || null, imageryQuality: (layers || {}).imageryQuality || main.imageryQuality || null, source: 'Google Solar API height model (DSM) and building mask, 0.1 m per pixel', hasRgb: !!rgbT, noiseSigmaM: mainRes.noiseSigma || null,
    layerChoice, newerRecords: await rmNewerRecords(layerChoice && layerChoice.used === 'record' ? null : main).catch(() => null), addressCheck: rmAddressCheck(results[0] && results[0].res, kx, ky, cLat, cLng), obstruction: mainRes.obstruction || null, hiddenZones, alt: altInfo, repairs: mainRes.repairs || [], structures: results.length, buildingName: main.name, radius, ref: { lat: cLat, lng: cLng, kx, ky }, selection: { method: 'largest mask piece inside the Google building box nearest its centre', planSqft: mainComp.n * geo.pxM2 * 10.7639104, otherPiecesInFrame: comps.length },
    raw: results.map(({ res }, idx) => ({ structure: idx + 1, facets: res.facets.map((f) => ({ pitch: f.pitch, slope: f.slope, status: f.status, path: f.path, rawPath: f.rawPath || null })), edges: res.edges.map((e) => ({ type: e.type, factor: e.factor, status: e.status, path: e.path })) })) };
  recompute();   // after state.trace is set: labels, hatching and the review panel read the hidden zones from it
  if (!opts.quiet) toast(`Auto-traced ${fi} facets, ${state.edges.length} lines, ${results.length} structure${results.length === 1 ? '' : 's'}`);
  return info;
}

// ------------------------------------------------------------------ batch test (run from the console: await batchTest(50))
async function batchTest(n = 50, box = { latMin: 30.17, latMax: 30.42, lngMin: -81.78, lngMax: -81.50 }, addresses = null) {
  const results = (window.__rows = []); const seen = new Set(); let tries = 0; window.__batchDone = false;
  const queue = addresses ? addresses.slice() : null;
  while (results.filter((r) => !r.skipped).length < (queue ? queue.length + 1e9 : n) && tries < (queue ? queue.length : n * 6)) {
    tries++;
    let lat, lng, address = '';
    if (queue) {
      address = queue[tries - 1];
      try { const g = await geocoder.geocode({ address }); const loc = g.results[0].geometry.location; lat = loc.lat(); lng = loc.lng(); } catch (e) { results.push({ skipped: true, reason: 'geocode failed: ' + address }); continue; }
    } else { lat = box.latMin + Math.random() * (box.latMax - box.latMin); lng = box.lngMin + Math.random() * (box.lngMax - box.lngMin); }
    let b = null;
    try { b = await fetchSolar(lat, lng); } catch (e) { results.push({ skipped: true, reason: 'no building: ' + e.message, lat, lng }); continue; }
    if (seen.has(b.name)) continue; seen.add(b.name);
    const sum = solarSummaryOf(b);
    if (!queue && (!sum || sum.total < 900 || sum.total > 7000)) { results.push({ skipped: true, reason: 'size ' + (sum ? Math.round(sum.total) : '?') }); continue; }
    if (!address) { try { const g = await geocoder.geocode({ location: { lat: b.center.latitude, lng: b.center.longitude } }); address = (g.results[0] && g.results[0].formatted_address) || ''; } catch (_) { /* ignore */ } }
    const t0 = performance.now();
    const row = { address, quality: b.imageryQuality, solarSqft: Math.round(sum.total), planes: sum.segs.length, solarPitch: Math.round(sum.predominant) };
    try {
      state.solar = b; state.otherSolar = []; state.location = { lat: b.center.latitude, lng: b.center.longitude }; state.address = address;
      const info = await autoTraceRoof({ quiet: true });
      const t = computeTotals();
      Object.assign(row, { tracedSqft: Math.round(t.sloped), mainSqft: info.mainSqft, ratio: +(info.mainSqft / sum.total).toFixed(3), facets: t.facetCount, structures: t.structures.length, pitch: t.predominant, center: [b.center.latitude, b.center.longitude],
        eaves: Math.round(t.byType.eave.true), ridges: Math.round(t.byType.ridge.true), hips: Math.round(t.byType.hip.true), valleys: Math.round(t.byType.valley.true), rakes: Math.round(t.byType.rake.true),
        step: Math.round(t.byType.step.true), wall: Math.round(t.byType.wall.true), transition: Math.round(t.byType.transition.true), unspecified: Math.round(t.byType.unspecified.true),
        unassignedPct: info.unassignedPct, recWaste: t.recWaste, ms: Math.round(performance.now() - t0) });
      const pitched = t.pitched > 0;
      row.full = t.facetCount > 0 && row.ratio > 0.85 && row.ratio < 1.2 && row.eaves > 0 && (!pitched || (row.ridges + row.hips) > 0);
    } catch (e) { row.error = e.message; row.full = false; }
    results.push(row);
  }
  window.__batchDone = true;
  return results;
}
