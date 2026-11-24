'use strict';
/* obstruction.js - vegetation / nearby-structure layer for the auto-trace, and inference of roof hidden under canopy.
 *
 * Google's building mask is a guess wherever a tree hangs over the roof: the mask edge follows the canopy, so tracing it
 * turns the canopy into a ragged "rake". This module
 *   1. classifies every pixel of the height model (DSM): tree canopy (tall, rough, green when the aerial RGB is
 *      available), other tall object, other building;
 *   2. removes canopy from the roof footprint and continues each fitted roof plane under the canopy down to that plane's
 *      own measured eave height (plane continuation: the hidden roof is where the plane is still above its eave line);
 *   3. records which pixels are Measured, Inferred (plane continuation) or Unresolved (hidden, no evidence), so facets
 *      and edges can be tagged and the report can say what is missing;
 *   4. summarises the obstruction for the report (canopy polygons, overlap, heights with their reference).
 *
 * Uses globals from autotrace.js / autotrace2.js: localPlanes, regionOuterLoop, dpM.
 */

var OB = {
  tallTreeM: 7.0,      // off the building mask, anything this tall is tree canopy (smooth tree tops fail the roughness test)
  tallM: 2.0,          // objects lower than this above the ground are not obstructions (shrubs, cars, fences)
  roughM: 0.08,        // mean local plane-fit residual (m) over roughWinPx above this = canopy texture, not a roof plane
  roughWinPx: 5,       // half window for the mean (11 px = 1.1 m)
  exgMin: 12,          // excess green (2G - R - B, 0..255 scale): floor of the vegetation-colour test (see exgRoofMargin)
  exgRoofMargin: 10,   // ... and it must be this much greener than this roof's own median colour (tan and olive roofs score +5 to +15)
  fillMaxM: 9,         // never continue a plane further than this under a canopy
  eaveTolM: 0.08,      // a continued plane ends where it drops this far below its eave height
  belowTolM: 0.4,      // the canopy (DSM) may be at most this far below the continued plane (DSM blur at canopy edges)
  minEavePx: 12,       // a plane needs this many visible outline pixels to define its own eave height
  sideTolM: 0.3,       // outside the mask a plane may only continue up / down slope of where it was seen, plus this margin
  nearM: 6,            // canopy within this distance of the roof is reported as "nearby"
  structM: 15,         // other buildings within this distance are reported as nearby structures
  minBlobM2: 1.5,      // smaller canopy specks are ignored
  openM: 0.6,          // canopy must be a blob at least twice this wide (roof edges and walls are thin rough bands)
  overhangM: 0.6,      // canopy at least this far above the roof edge it touches may be hanging over it
  ridgeBandM: 3.0,     // a face visible within this distance of its ridge line shows that the ridge, and so its other side, exists there
  haloM: 1.2,          // roof pixels this close to canopy are blurred upward by the height model: not used for plane fits
  aboveM: 0.2,         // canopy hiding a roof plane is at least this far above the continued plane
};

// ---- 1. classify the whole tile
// returns { ground, hag(i), tree: Uint8Array (1 = canopy, 2 = other tall rough object), rough: Float32Array }
function obClassify(dsm, w, h, geo, mask, member, rgb) {
  const N = w * h;
  // ground: low percentile of everything that is not a building (flat-lot assumption, same datum the app already uses)
  const vals = []; for (let i = 0; i < N; i += 7) if (!mask[i] && dsm[i] > -1000) vals.push(dsm[i]);
  vals.sort((p, q) => p - q); const ground = vals.length ? vals[Math.floor(vals.length * 0.05)] : 0;
  // roughness: local plane residual with every pixel as a member, then a box mean so thin creases (ridges, eaves) stay low
  const all = new Uint8Array(N).fill(1);
  const lpAll = localPlanes(dsm, all, w, h, geo);
  const W1 = w + 1; const I = new Float64Array(W1 * (h + 1));
  for (let y = 0; y < h; y++) { let r = 0; for (let x = 0; x < w; x++) { const v = lpAll.R[y * w + x]; r += v < 9 ? Math.min(v, 0.6) : 0.3; I[(y + 1) * W1 + x + 1] = I[y * W1 + x + 1] + r; } }
  const rough = new Float32Array(N); const k = OB.roughWinPx;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const x0 = Math.max(0, x - k), y0 = Math.max(0, y - k), x1 = Math.min(w, x + k + 1), y1 = Math.min(h, y + k + 1);
    rough[y * w + x] = (I[y1 * W1 + x1] - I[y0 * W1 + x1] - I[y1 * W1 + x0] + I[y0 * W1 + x0]) / ((x1 - x0) * (y1 - y0));
  }
  const hasRgb = !!(rgb && rgb.length === 3 && rgb[0].length === N);
  // vegetation colour is judged against this roof's own colour: its median excess green over the raised pixels of the
  // building (canopy is a minority of them) plus a margin. A tan or olive roof scores +12 to +15 on its own.
  let exgThr = OB.exgMin;
  if (hasRgb) { const v = []; for (let i = 0; i < N; i += 3) if (member[i] && dsm[i] > -1000 && dsm[i] - ground >= OB.tallM) v.push(2 * rgb[1][i] - rgb[0][i] - rgb[2][i]); if (v.length >= 200) { v.sort((p, q) => p - q); exgThr = Math.max(OB.exgMin, v[v.length >> 1] + OB.exgRoofMargin); } }
  const tree = new Uint8Array(N);
  for (let i = 0; i < N; i++) {
    if (!(dsm[i] > -1000) || dsm[i] - ground < OB.tallM) continue;
    // well above any single-storey roof and not on a building: a tree, even where its top is too smooth to look rough
    if (!mask[i] && dsm[i] - ground >= OB.tallTreeM) { tree[i] = 1; continue; }
    if (rough[i] < OB.roughM) continue;
    // off every building: a tall rough object is vegetation unless its colour says otherwise is unknowable, so call it canopy;
    // on a building: it must also look like vegetation (green), or be very rough when there is no colour layer
    if (!mask[i]) tree[i] = 1;
    else if (hasRgb) tree[i] = (2 * rgb[1][i] - rgb[0][i] - rgb[2][i]) >= exgThr ? 1 : 2;
    else tree[i] = rough[i] >= OB.roughM * 2 ? 1 : 2;
  }
  // close pin-holes inside canopy (sunlit / shadowed leaves fail the colour test pixel by pixel): majority of a 5x5 window
  if (hasRgb) {
    const out = new Uint8Array(tree);
    for (let y = 2; y < h - 2; y++) for (let x = 2; x < w - 2; x++) { const i = y * w + x; if (tree[i] !== 2) continue; let g = 0; for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) if (tree[i + dy * w + dx] === 1) g++; if (g >= 10) out[i] = 1; }
    tree.set(out);
  }
  // opening (erode then dilate by OB.openM): the blurred drop at every roof edge and wall is tall and rough too, but it is a
  // thin band; canopy is a blob. Only blobs survive.
  { const r = Math.max(1, Math.round(OB.openM / Math.sqrt(geo.pxM2)));
    const distTo = (src) => { const d = new Uint16Array(N).fill(65535); let fr = []; for (let i = 0; i < N; i++) if (src(i)) { d[i] = 0; fr.push(i); }
      for (let k = 1; k <= r + 1 && fr.length; k++) { const nx = []; for (const i of fr) { const x = i % w, y = (i - x) / w; for (const j of [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, y > 0 ? i - w : -1, y < h - 1 ? i + w : -1]) if (j >= 0 && d[j] === 65535) { d[j] = k; nx.push(j); } } fr = nx; } return d; };
    const dOut = distTo((i) => tree[i] !== 1);                 // distance to the nearest non-canopy pixel
    const dCore = distTo((i) => tree[i] === 1 && dOut[i] > r); // distance to the eroded core
    for (let i = 0; i < N; i++) if (tree[i] === 1 && dCore[i] > r) tree[i] = 2; }
  return { ground, tree, rough, hasRgb, lpAll };
}

// ---- 2a. canopy halo, clean plane fits, coplanar merge
// The height model blurs every canopy edge into the roof beside it: roof pixels within about 0.8 m of canopy read too
// high and tilt the fitted plane (a 4/12 face came out 7/12 and 14/12 next to a tree). Those pixels are kept as roof but
// are never used to fit a plane.
function obHalo(tree, w, h, rPx) {
  const N = w * h, halo = new Uint8Array(N); let fr = [];
  for (let i = 0; i < N; i++) if (tree[i] === 1) { halo[i] = 1; fr.push(i); }
  for (let k = 0; k < rPx && fr.length; k++) { const nx = []; for (const i of fr) { const x = i % w, y = (i - x) / w; for (const j of [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, y > 0 ? i - w : -1, y < h - 1 ? i + w : -1]) if (j >= 0 && !halo[j]) { halo[j] = 1; nx.push(j); } } fr = nx; }
  return halo;
}
// merge neighbouring regions that are the same plane (fits from clean pixels only). Returns the number of merges.
function obMergeCoplanar(dsm, label, regions, w, h, lp, geo, halo) {
  const N = w * h; const acc = new Map(), cen = new Map();
  for (let i = 0; i < N; i++) { const l = label[i]; if (l < 0) continue; const x = i % w, y = (i - x) / w; let c = cen.get(l); if (!c) cen.set(l, (c = [0, 0, 0])); c[0] += lp.Ecol[x]; c[1] += lp.Nrow[y]; c[2]++;
    if (halo[i] || !(dsm[i] > -1000)) continue; let a = acc.get(l); if (!a) acc.set(l, (a = new PlaneAcc())); a.add(lp.Ecol[x], lp.Nrow[y], dsm[i]); }
  const parent = new Map(); const find = (i) => { let r = i; while (parent.has(r) && parent.get(r) !== r) r = parent.get(r); return r; };
  const pairs = [...adjacency(label, w, h).entries()].filter(([k]) => !k.includes('-')).map(([k, v]) => { const [p, q] = k.split(',').map(Number); return { p, q, shared: v }; }).sort((s, t) => t.shared - s.shared);
  let merged = 0;
  for (const { p, q, shared } of pairs) {
    const P = find(p), Q = find(q); if (P === Q || shared < 6) continue; const a = regions[P].plane, b = regions[Q].plane;
    if (angleBetween(a.a, a.b, b.a, b.b) > AT2.mergeAngle * 1.3) continue;
    const ca = cen.get(P), cb = cen.get(Q); const mid = [(ca[0] / ca[2] + cb[0] / cb[2]) / 2, (ca[1] / ca[2] + cb[1] / cb[2]) / 2];
    if (Math.abs((a.a * mid[0] + a.b * mid[1] + a.c) - (b.a * mid[0] + b.b * mid[1] + b.c)) > AT2.mergeDist * 2) continue;
    parent.set(Q, P); ca[0] += cb[0]; ca[1] += cb[1]; ca[2] += cb[2];
    const aP = acc.get(P), aQ = acc.get(Q); if (aP && aQ) aP.merge(aQ); else if (aQ) acc.set(P, aQ);
    const f = acc.get(P) && acc.get(P).s[0] >= 30 ? acc.get(P).solve() : null; if (f) regions[P].plane = f; regions[P].n = ca[2]; merged++;
  }
  if (merged) for (let i = 0; i < N; i++) if (label[i] >= 0) label[i] = find(label[i]);
  return merged;
}
// refit every region from pixels clear of the canopy halo; drop regions that are mostly halo and fit an implausible plane
function obRefitClean(dsm, label, regions, w, h, lp, geo, ob, halo) {
  const N = w * h; const st = new Map();
  for (let i = 0; i < N; i++) { const l = label[i]; if (l < 0) continue; let s = st.get(l); if (!s) st.set(l, (s = { n: 0, acc: new PlaneAcc(), rough: 0 })); s.n++; s.rough += ob.rough[i];
    if (!halo[i] && dsm[i] > -1000) { const x = i % w, y = (i - x) / w; s.acc.add(lp.Ecol[x], lp.Nrow[y], dsm[i]); } }
  const drop = new Set();
  for (const [l, s] of st) {
    const clean = s.acc.s[0];
    if (clean >= Math.max(80, 0.25 * s.n)) { const f = s.acc.solve(); if (f) regions[l].plane = f; continue; }
    if ((s.n - clean) / s.n < 0.5) continue;                              // small region away from trees: leave it alone
    const pl = regions[l].plane; const p12 = Math.hypot(pl.a, pl.b) * 12;
    if (p12 > 12 || (s.rough / s.n >= 0.15 && (pl.rms || 0) >= 0.1)) drop.add(l);
  }
  // a small region steeper than 45 degrees whose pitch no other sizeable plane shares is the blurred step between two
  // roof levels or the blurred side of a canopy, not a facet
  { const pitches = [...st.entries()].filter(([l, s]) => !drop.has(l) && s.n * geo.pxM2 >= 3).map(([l]) => [l, Math.hypot(regions[l].plane.a, regions[l].plane.b) * 12]);
    for (const [l, s] of st) { if (drop.has(l)) continue; const p12 = Math.hypot(regions[l].plane.a, regions[l].plane.b) * 12; if (p12 <= 12.5 || s.n * geo.pxM2 > 14) continue;
      if (!pitches.some(([m, q]) => m !== l && Math.abs(q - p12) <= 1.6)) drop.add(l); } }
  if (drop.size) for (let i = 0; i < N; i++) if (drop.has(label[i])) label[i] = -1;
  obMergeCoplanar(dsm, label, regions, w, h, lp, geo, halo);
  return drop.size;
}

// ---- 2b. roof hidden under canopy: what the evidence supports, and what it does not
// A roof plane fitted to its visible part is continued under canopy pixel by pixel. A hidden pixel becomes INFERRED roof
// only when all of these hold:
//   1. the plane there is still at or above its eave height (the roof has not ended) and the canopy is above the plane;
//   2. the place is backed sideways by something seen: the same plane is visible up / down slope of it (own range), or the
//      opposite face of the same ridge is visible beside it (a ridge has two sides), or Google's building mask covers it;
//   3. going down the slope from it, the roof ends at the eave line or runs into visible roof - not at the edge of the tree
//      with open ground beyond while the plane is still high (then the real edge is somewhere under the tree).
// Hidden pixels that pass 1 but not 2 and 3 are GHOST pixels: the roof may continue there, nothing shows that it does.
// They are not roof in the sketch. They become hatched "hidden zones" with an upper bound, and the visible roof next to
// them ends at an obstruction boundary, not at a roof edge.
// opts.acceptHidden: [[E, N], ...] points (metres) inside hidden zones a reviewer confirmed from another source.
function obInferHidden(dsm, label, regions, member, mask, w, h, geo, lp, ob, halo, opts) {
  const N = w * h, px = Math.sqrt(geo.pxM2);
  const inferred = new Uint8Array(N), unresolved = new Uint8Array(N), memberEff = new Uint8Array(member), ghost = new Int32Array(N), ev = new Uint8Array(N);
  const zOf = (pl, x, y) => pl.a * lp.Ecol[x] + pl.b * lp.Nrow[y] + pl.c;
  // hidden candidates: canopy pixels with no roof plane (on the mask or beside it, never on another building), plus the
  // tall pixels in and right around the canopy that the colour / roughness test missed (holes in the canopy class would
  // otherwise cut a hidden roof column in two). Rule 1 below still requires something standing above the roof plane.
  const cand = new Uint8Array(N); let nCand = 0;
  for (let i = 0; i < N; i++) { if (label[i] >= 0) continue;
    if ((ob.tree[i] === 1 && (member[i] || !mask[i])) || (!mask[i] && halo && halo[i] && dsm[i] - ob.ground >= OB.tallM)) { cand[i] = 1; if (ob.tree[i] === 1) nCand++; } }
  if (!nCand) return { label, memberEff, inferred, unresolved, ghost, ev, canopyOnMaskPx: 0, eaveZ: new Map(), fallbackEave: null };
  let canopyOnMask = 0; for (let i = 0; i < N; i++) if (cand[i] && member[i]) canopyOnMask++;
  // roof pixels around the canopy that carry no plane yet take their neighbour's plane; planes that now touch may be one
  { const m2 = new Uint8Array(N); for (let i = 0; i < N; i++) m2[i] = member[i] && !cand[i] ? 1 : 0; label = fillHoles(dsm, label, m2, w, h, regions, lp); }
  if (halo) obMergeCoplanar(dsm, label, regions, w, h, lp, geo, halo);
  // per plane: unit up-slope direction g, along-contour direction c (u = c . p), eave height
  const BIN = 0.2; const frame = new Map();
  const frameOf = (l) => { let f = frame.get(l); if (f !== undefined) return f; const pl = regions[l].plane, s = Math.hypot(pl.a, pl.b); f = s > 0.06 ? { s, gx: pl.a / s, gy: pl.b / s, cx: -pl.b / s, cy: pl.a / s } : null; frame.set(l, f); return f; };
  const edgeZ = new Map(), own = new Map(), size = new Map(), zTop = new Map();
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x, l = label[i]; if (l < 0) continue; size.set(l, (size.get(l) || 0) + 1);
    { const z = zOf(regions[l].plane, x, y); if (!(zTop.get(l) >= z)) zTop.set(l, z); }
    const f = frameOf(l); if (f) { let b = own.get(l); if (!b) own.set(l, (b = new Set())); b.add(Math.round((f.cx * lp.Ecol[x] + f.cy * lp.Nrow[y]) / BIN)); }
    for (const j of [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, y > 0 ? i - w : -1, y < h - 1 ? i + w : -1]) { if (j < 0 || (label[j] < 0 && !member[j] && !cand[j])) { let a = edgeZ.get(l); if (!a) edgeZ.set(l, (a = [])); a.push(zOf(regions[l].plane, x, y)); break; } }
  }
  // eave height of a plane = low percentile of its height along its visible outline. It is RELIABLE only when a level
  // stretch of outline (a real eave, at least 2.5 m) is visible; a plane seen only along a rake reads too high.
  const eaveZ = new Map(), eaveOk = new Map();
  for (const [l, a] of edgeZ) { if (a.length < OB.minEavePx) continue; a.sort((p, q) => p - q);
    // an eave is a level stretch of outline: the 0.3 m band of height holding the most outline pixels. (A low
    // percentile is dragged down by a few stray pixels and up when only a rake is visible.)
    let best = 0, bi = 0, j = 0; for (let i = 0; i < a.length; i++) { while (a[i] - a[j] > 0.3) j++; if (i - j + 1 > best) { best = i - j + 1; bi = j; } }
    let sum = 0; for (let i = bi; i < bi + best; i++) sum += a[i];
    eaveZ.set(l, sum / best); eaveOk.set(l, best >= 25 && best >= 0.3 * a.length); }
  let fallbackEave = null;
  { const src = [...eaveZ.entries()].filter(([l]) => eaveOk.get(l)); const use = src.length ? src : [...eaveZ.entries()];
    const zs = use.map(([l, z]) => ({ z, n: size.get(l) || 1 })).sort((p, q) => p.z - q.z); const tot = zs.reduce((s, v) => s + v.n, 0); let acc = 0; for (const v of zs) { acc += v.n; if (acc >= tot / 2) { fallbackEave = v.z; break; } } }
  // ridge partners: two planes sloping away from each other that meet on a line both are seen beside
  const part = new Map(); const pairsOf = new Map(); const partnerOf = new Map(); const widthFrom = new Map(), runLimit = new Map();
  { const ids = [...size.keys()].filter((l) => frameOf(l) && size.get(l) >= 100); const adj = adjacency(label, w, h);
    for (let a = 0; a < ids.length; a++) for (let b = a + 1; b < ids.length; b++) {
      const l = ids[a], m = ids[b], fl = frameOf(l), fm = frameOf(m); if (fl.gx * fm.gx + fl.gy * fm.gy > -0.5) continue;
      // the two faces must actually be seen meeting (1.5 m of shared visible ridge): two parallel gables side by side are not partners
      if ((adj.get(l < m ? l + ',' + m : m + ',' + l) || 0) < 15) continue;
      const ln = planeIntersectionLine(regions[l].plane, regions[m].plane); if (!ln) continue;
      const pr = { l, m, ln, nearL: 0, nearM: 0, binsL: new Set(), binsM: new Set(), dL: [], dM: [] };
      for (const k of [l, m]) { let q = pairsOf.get(k); if (!q) pairsOf.set(k, (q = [])); q.push(pr); }
    }
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const k = label[y * w + x]; if (k < 0) continue; const prs = pairsOf.get(k); if (!prs) continue; const E = lp.Ecol[x], Nn = lp.Nrow[y];
      for (const pr of prs) { const d = Math.abs(pr.ln.n[0] * E + pr.ln.n[1] * Nn - pr.ln.c); if (d <= 20 && ((x + y) & 3) === 0) (k === pr.l ? pr.dL : pr.dM).push(d); if (d > OB.ridgeBandM) continue;
        const o = k === pr.l ? pr.m : pr.l; if (zOf(regions[k].plane, x, y) > zOf(regions[o].plane, x, y) + 0.1) continue;   // a ridge: each face lies below the other face's plane
        if (d <= 1.5) { if (k === pr.l) pr.nearL++; else pr.nearM++; }
        if (d <= OB.ridgeBandM) { const fo = frameOf(o); (k === pr.l ? pr.binsM : pr.binsL).add(Math.round((fo.cx * E + fo.cy * Nn) / BIN)); } }
    }
    const seen = new Set();
    for (const prs of pairsOf.values()) for (const pr of prs) { if (seen.has(pr) || pr.nearL < 10 || pr.nearM < 10) continue; seen.add(pr);
      // binsL = positions (in l's frame) where m is visible at the ridge: the ridge, and so l's side of it, exists there
      for (const [k, bins] of [[pr.l, pr.binsL], [pr.m, pr.binsM]]) { let q = part.get(k); if (!q) part.set(k, (q = new Set())); for (const v of bins) q.add(v); }
      for (const [k, o] of [[pr.l, pr.m], [pr.m, pr.l]]) { let q = partnerOf.get(k); if (!q) partnerOf.set(k, (q = [])); q.push(o); }
      // visible width of each face, ridge to eave (95th percentile of its pixels' distance from the ridge line)
      const p95 = (a) => { if (a.length < 20) return null; a.sort((p, q) => p - q); return a[Math.floor(a.length * 0.95)]; };
      widthFrom.set(pr.l + ',' + pr.m, { ln: pr.ln, w: p95(pr.dL) }); widthFrom.set(pr.m + ',' + pr.l, { ln: pr.ln, w: p95(pr.dM) }); }
  }
  // which eave height to use for a plane, and where it came from: 0 = its own level eave, 1 = the opposite face of its
  // ridge (the two eaves of a gable sit at the same height), 2 = its own outline without a level stretch, 3 = the building's typical eave
  const ezCache = new Map();
  const ezOf = (l) => { let r = ezCache.get(l); if (r) return r;
    if (eaveOk.get(l)) r = { z: eaveZ.get(l), src: 0 };
    else { const ps = (partnerOf.get(l) || []).filter((m) => eaveOk.get(m)).sort((p, q) => (size.get(q) || 0) - (size.get(p) || 0));
      if (ps.length) { r = { z: eaveZ.get(ps[0]), src: 1 };
        // a face whose own eave is not visible is taken to be as wide as the visible face on the other side of its ridge
        // (the fitted slope of a face seen only in a small patch is too uncertain to place its eave by height alone)
        const wv = widthFrom.get(ps[0] + ',' + l); if (wv && wv.w) runLimit.set(l, { ln: wv.ln, w: wv.w + 0.3 }); }
      else if (eaveZ.has(l)) r = { z: eaveZ.get(l), src: 2 }; else r = { z: fallbackEave, src: 3 }; }
    ezCache.set(l, r); return r; };
  const has = (set, k) => !!set && (set.has(k) || set.has(k - 1) || set.has(k + 1) || set.has(k - 2) || set.has(k + 2));
  const supportAt = (l, x, y, i) => { const f = frameOf(l); if (f) { const k = Math.round((f.cx * lp.Ecol[x] + f.cy * lp.Nrow[y]) / BIN); if (has(own.get(l), k)) return 1; if (has(part.get(l), k)) return 2; } return member[i] ? 3 : 0; };
  // growth from the labelled roof into the canopy, one pixel ring at a time
  const out = new Int32Array(label); const maxRings = Math.round(OB.fillMaxM / px);
  const borrowed = new Uint8Array(N), notCanopy = new Uint8Array(N), queued = new Uint16Array(N);
  const nb4 = (i) => { const x = i % w, y = (i - x) / w; return [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, y > 0 ? i - w : -1, y < h - 1 ? i + w : -1]; };
  // planes that could own a hidden pixel: the planes around it, plus the other face of any ridge those planes end at
  // (the hidden face of a gable is reached from the visible face across the ridge)
  const neighbours = (i, useGhost) => { const x = i % w, y = (i - x) / w; const ls = [];
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const xx = x + dx, yy = y + dy; if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue; const j = yy * w + xx; const l = out[j] >= 0 ? out[j] : (useGhost && ghost[j] > 0 ? ghost[j] - 1 : -1); if (l >= 0 && !ls.includes(l)) ls.push(l); }
    for (const l of ls.slice()) for (const m of partnerOf.get(l) || []) if (!ls.includes(m)) ls.push(m);
    return { ls, x, y }; };
  // a plane is never continued past its own ridge: beyond the ridge line the other face is the lower one
  const beyondRidge = (l, x, y, z) => { for (const m of partnerOf.get(l) || []) if (zOf(regions[m].plane, x, y) < z - 0.05) return true; return false; };
  // rule 1 for plane l at pixel i: 1 = may continue, 0 = no (below its eave, or nothing above the plane), -1 = no eave height at all
  // ... and, off the building mask, never above the highest point where it was seen (a tree beside the high wall of a
  // mono-pitch roof would otherwise become roof)
  const passes = (i, l, z) => { const ez = ezOf(l).z; if (ez == null) return -1; if (z < ez - OB.eaveTolM) return 0;
    if (!member[i] && z > (zTop.get(l) || -Infinity) + 0.15) return 0;
    const lim = runLimit.get(l); if (lim) { const x = i % w, y = (i - x) / w; if (Math.abs(lim.ln.n[0] * lp.Ecol[x] + lim.ln.n[1] * lp.Nrow[y] - lim.ln.c) > lim.w) return 0; }
    if (dsm[i] > -1000 && dsm[i] < z + OB.aboveM) { if (dsm[i] >= z - OB.belowTolM && member[i]) notCanopy[i] = 1; return 0; } return 1; };
  let frontier = []; { const seen = new Uint8Array(N); for (let i = 0; i < N; i++) if (cand[i] && !seen[i] && nb4(i).some((j) => j >= 0 && out[j] >= 0)) { seen[i] = 1; frontier.push(i); } }
  for (let ring = 0; ring < maxRings && frontier.length; ring++) {
    const assign = [];
    for (const i of frontier) { if (out[i] >= 0) continue; const { ls, x, y } = neighbours(i, false); if (!ls.length) continue;
      // the lowest of the neighbouring planes that may continue here AND is backed by something seen (a low porch plane
      // with no support must not block the main roof's continuation)
      let best = -1, bz = Infinity, bs = 0, noEave = false;
      for (const l of ls) { const z = zOf(regions[l].plane, x, y); if (beyondRidge(l, x, y, z)) continue; const ok = passes(i, l, z); if (ok < 0) { noEave = true; continue; } if (!ok) continue; const sup = supportAt(l, x, y, i); if (!sup) continue; if (z < bz) { bz = z; best = l; bs = sup; } }
      if (best < 0) { if (noEave && member[i]) unresolved[i] = 1; continue; }
      assign.push(i, best, bs, ezOf(best).src); }
    const next = [];
    for (let k = 0; k < assign.length; k += 4) { const i = assign[k]; if (out[i] >= 0) continue; out[i] = assign[k + 1]; inferred[i] = 1; ev[i] = assign[k + 2]; borrowed[i] = assign[k + 3]; }
    for (let k = 0; k < assign.length; k += 4) for (const j of nb4(assign[k])) if (j >= 0 && cand[j] && out[j] < 0 && queued[j] !== ring + 2) { queued[j] = ring + 2; next.push(j); }
    frontier = next;
  }
  // inside the hidden area the line between two faces of a ridge is their exact intersection, not the order the growth
  // happened to arrive in: move each inferred pixel to its ridge partner when the partner is the lower plane there
  for (let pass = 0; pass < 2; pass++) for (let i = 0; i < N; i++) { if (!inferred[i]) continue; const l = out[i]; const ps = partnerOf.get(l); if (!ps) continue; const x = i % w, y = (i - x) / w; const z = zOf(regions[l].plane, x, y);
    for (const m of ps) { const zm = zOf(regions[m].plane, x, y); if (zm < z - 0.02 && passes(i, m, zm) === 1 && supportAt(m, x, y, i)) { out[i] = m; borrowed[i] = ezOf(m).src; break; } } }
  // rule 3: walk down the slope from every inferred pixel (mask-backed ones excepted)
  { const demote = [];
    for (let i = 0; i < N; i++) { if (!inferred[i] || ev[i] === 3) continue; const l = out[i], f = frameOf(l); if (!f) continue;
      const ez = ezOf(l).z; let x = i % w, y = (i - x) / w, fx = x, fy = y, ok = true, lastX = x, lastY = y;
      for (let k = 0; k < 600; k++) { fx -= f.gx * 0.7; fy += f.gy * 0.7; const xi = Math.round(fx), yi = Math.round(fy);
        if (xi < 0 || yi < 0 || xi >= w || yi >= h) { ok = false; break; } const j = yi * w + xi;
        if (out[j] < 0) { const lim = runLimit.get(l); ok = zOf(regions[l].plane, lastX, lastY) <= ez + 0.35 || (!!lim && Math.abs(lim.ln.n[0] * lp.Ecol[lastX] + lim.ln.n[1] * lp.Nrow[lastY] - lim.ln.c) >= lim.w - 0.4); break; }
        if (!inferred[j]) break;                                           // reached visible roof below: bounded
        lastX = xi; lastY = yi; }
      if (!ok) demote.push(i); }
    for (const i of demote) { ghost[i] = out[i] + 1; out[i] = -1; inferred[i] = 0; ev[i] = 0; } }
  // ghost growth: everywhere else the planes could continue under the canopy (rule 1 only). Not roof; an upper bound.
  { let fr = []; const seen = new Uint8Array(N);
    for (let i = 0; i < N; i++) if (cand[i] && out[i] < 0 && !ghost[i] && nb4(i).some((j) => j >= 0 && (out[j] >= 0 || ghost[j] > 0))) { seen[i] = 1; fr.push(i); }
    for (let ring = 0; ring < maxRings && fr.length; ring++) { const add = [];
      for (const i of fr) { if (out[i] >= 0 || ghost[i]) continue; const { ls, x, y } = neighbours(i, true); let best = -1, bz = Infinity; for (const l of ls) { const z = zOf(regions[l].plane, x, y); if (beyondRidge(l, x, y, z)) continue; if (passes(i, l, z) === 1 && z < bz) { bz = z; best = l; } } if (best < 0) continue; add.push(i, best); }
      const nx = []; for (let k = 0; k < add.length; k += 2) ghost[add[k]] = add[k + 1] + 1;
      for (let k = 0; k < add.length; k += 2) for (const j of nb4(add[k])) if (j >= 0 && cand[j] && out[j] < 0 && !ghost[j] && !seen[j]) { seen[j] = 1; nx.push(j); }
      fr = nx; } }
  // a reviewer confirmed, from another source, that the roof continues in a hidden zone: that zone becomes inferred roof
  const accept = opts && opts.acceptHidden ? opts.acceptHidden : null;
  if (accept && accept.length) { const comp = new Int32Array(N).fill(-1); let nc = 0; const take = new Set();
    for (let s0 = 0; s0 < N; s0++) { if (!ghost[s0] || comp[s0] >= 0) continue; const id = nc++; const stack = [s0]; comp[s0] = id; while (stack.length) { const i = stack.pop(); for (const j of nb4(i)) if (j >= 0 && ghost[j] && comp[j] < 0) { comp[j] = id; stack.push(j); } } }
    for (const p of accept) { const cx = Math.round(geo.X(p[0])), cy = Math.round(geo.Y(p[1])); let found = -1;
      for (let r = 0; r <= 15 && found < 0; r++) for (let dy = -r; dy <= r && found < 0; dy++) for (let dx = -r; dx <= r; dx++) { const x = cx + dx, y = cy + dy; if (x < 0 || y < 0 || x >= w || y >= h) continue; if (comp[y * w + x] >= 0) { found = comp[y * w + x]; break; } }
      if (found >= 0) take.add(found); }
    if (take.size) for (let i = 0; i < N; i++) if (comp[i] >= 0 && take.has(comp[i])) { out[i] = ghost[i] - 1; ghost[i] = 0; inferred[i] = 1; ev[i] = 4; } }
  // effective roof mask: inferred pixels are roof; canopy on the mask that nothing supports is not (the mask followed the tree)
  for (let i = 0; i < N; i++) { if (inferred[i]) memberEff[i] = 1; else if (cand[i] && member[i] && !unresolved[i] && !notCanopy[i]) memberEff[i] = 0; }
  const dbg = { pairs: [...new Set([...pairsOf.values()].flat())].map((pr) => ({ l: pr.l, m: pr.m, nearL: pr.nearL, nearM: pr.nearM, binsL: pr.binsL.size, binsM: pr.binsM.size })), ez: [...size.keys()].map((l) => ({ l, own: eaveZ.get(l), ok: !!eaveOk.get(l), use: ezOf(l) })) };
  return { label: out, memberEff, inferred, unresolved, ghost, ev, borrowed, canopyOnMaskPx: canopyOnMask, eaveZ, fallbackEave, dbg };
}
// roof pixels on the footprint boundary that touch a ghost pixel: there the visible roof ends at an obstruction
function obContact(label, ghost, w, h) {
  const c = new Uint8Array(w * h);
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) { const i = y * w + x; if (label[i] < 0) continue; if ((ghost[i - 1] > 0 && label[i - 1] < 0) || (ghost[i + 1] > 0 && label[i + 1] < 0) || (ghost[i - w] > 0 && label[i - w] < 0) || (ghost[i + w] > 0 && label[i + w] < 0)) c[i] = 1; }
  return c;
}
// hidden zones for the report: connected ghost areas that lie against an obstruction boundary
// obstSegs: [[a, b], ...] obstruction boundary segments in metres. Returns [{ path, planSqft, upperSqft, region, pitch }]
function obHiddenZones(ghost, label, w, h, geo, regions, obstSegs, toLL) {
  const N = w * h, SQFT = 10.7639104; const comp = new Int32Array(N).fill(-1); const zones = [];
  const dSeg = (p, a, b) => { const dx = b[0] - a[0], dy = b[1] - a[1]; const l2 = dx * dx + dy * dy || 1e-12; let t = ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2; t = Math.max(0, Math.min(1, t)); return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy); };
  for (let s0 = 0; s0 < N; s0++) {
    if (!(ghost[s0] > 0) || label[s0] >= 0 || comp[s0] >= 0) continue; const id = zones.length; const stack = [s0]; comp[s0] = id; let n = 0, up = 0, near = false; const byPlane = new Map();
    while (stack.length) { const i = stack.pop(); n++; const l = ghost[i] - 1; const pl = regions[l].plane; up += Math.sqrt(1 + pl.a * pl.a + pl.b * pl.b); byPlane.set(l, (byPlane.get(l) || 0) + 1);
      const x = i % w, y = (i - x) / w;
      if (!near && n % 7 === 1) { const p = [geo.E(x + 0.5), geo.N(y + 0.5)]; for (const sg of obstSegs) if (dSeg(p, sg[0], sg[1]) < 1.0) { near = true; break; } }
      for (const j of [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, y > 0 ? i - w : -1, y < h - 1 ? i + w : -1]) if (j >= 0 && ghost[j] > 0 && label[j] < 0 && comp[j] < 0) { comp[j] = id; stack.push(j); } }
    let region = -1, bn = 0; for (const [l, c] of byPlane) if (c > bn) { bn = c; region = l; }
    zones.push({ n, near, planSqft: n * geo.pxM2 * SQFT, upperSqft: up * geo.pxM2 * SQFT, region, pitch: Math.round(Math.hypot(regions[region].plane.a, regions[region].plane.b) * 12) });
  }
  const out = [];
  zones.forEach((z, id) => { if (!z.near || z.n * geo.pxM2 < 1.0) return;
    const loop = regionOuterLoop(comp, w, h, id); if (loop.length < 8) return; const P = loop.map((e) => [geo.E(e.a[0]), geo.N(e.a[1])]); const half = Math.floor(P.length / 2);
    const o = dpM(P.slice(0, half + 1), 0.4).slice(0, -1).concat(dpM(P.slice(half).concat([P[0]]), 0.4).slice(0, -1)); if (o.length < 3) return;
    out.push({ path: o.map(toLL), planSqft: z.planSqft, upperSqft: z.upperSqft, region: z.region, pitch: z.pitch, centre: toLL([P.reduce((s, q) => s + q[0], 0) / P.length, P.reduce((s, q) => s + q[1], 0) / P.length]) }); });
  return out;
}

// ---- 3. tag facets and edges (called with the final label raster and the final vector geometry, metres)
function obStatusOfFacet(id, label, w, h, st) {
  let n = 0, inf = 0, unr = 0;
  for (let i = 0; i < w * h; i++) if (label[i] === id) { n++; if (st.inferred[i]) inf++; if (st.unresolved[i]) unr++; }
  return { n, inferredPx: inf, unresolvedPx: unr };
}
// share of a line (metres, [E,N] points) that runs beside inferred / unresolved pixels
function obStatusOfLine(g, geo, w, h, st) {
  let tot = 0, inf = 0, unr = 0;
  const at = (p) => { const x = Math.floor(geo.X(p[0])), y = Math.floor(geo.Y(p[1])); return x >= 0 && y >= 0 && x < w && y < h ? y * w + x : -1; };
  for (let k = 1; k < g.length; k++) {
    const a = g[k - 1], b = g[k]; const d = [b[0] - a[0], b[1] - a[1]]; const L = Math.hypot(d[0], d[1]); if (L < 0.05) continue;
    const n = [-d[1] / L, d[0] / L]; const steps = Math.max(1, Math.round(L / 0.2));
    for (let s = 0; s < steps; s++) {
      const t = (s + 0.5) / steps; const p = [a[0] + d[0] * t, a[1] + d[1] * t]; let fi = false, fu = false;
      for (const off of [-0.45, -0.2, 0.2, 0.45]) { const i = at([p[0] + n[0] * off, p[1] + n[1] * off]); if (i < 0) continue; if (st.inferred[i]) fi = true; if (st.unresolved[i]) fu = true; }
      tot += L / steps; if (fu) unr += L / steps; if (fi) inf += L / steps;
    }
  }
  return { lenM: tot, inferredM: inf, unresolvedM: unr };
}

// ---- 4. summary for the report: canopy polygons near the roof, other buildings, heights with their reference
function obSummarize(dsm, w, h, geo, mask, label, regions, ob, st, toLL) {
  const N = w * h, px = Math.sqrt(geo.pxM2), FT = 3.28084, SQFT = 10.7639104;
  const roof = new Uint8Array(N); let roofPx = 0, infPx = 0, unrPx = 0, ridgeZ = -Infinity; const tops = [];
  // ridge height: a high percentile of the measured roof, each height capped at its fitted plane + 0.3 m (the raw maximum picks up canopy tops and chimneys)
  for (let i = 0; i < N; i++) if (label[i] >= 0) { roof[i] = 1; roofPx++; if (st.inferred[i]) infPx++; else if (!ob.tree[i] && dsm[i] > -1000) { const x = i % w, y = (i - x) / w, pl = regions[label[i]] && regions[label[i]].plane; tops.push(pl ? Math.min(dsm[i], pl.a * geo.E(x + 0.5) + pl.b * geo.N(y + 0.5) + pl.c + 0.3) : dsm[i]); } if (st.unresolved[i]) unrPx++; }
  if (tops.length) { tops.sort((p, q) => p - q); ridgeZ = tops[Math.min(tops.length - 1, Math.floor(tops.length * 0.99))]; }
  // distance to the roof (chamfer, capped) for "nearby"
  const cap = Math.round(Math.max(OB.nearM, OB.structM) / px) + 2; const dist = new Uint16Array(N).fill(65535);
  let fr = []; for (let i = 0; i < N; i++) if (roof[i]) { dist[i] = 0; fr.push(i); }
  for (let d = 1; d <= cap && fr.length; d++) { const nx = []; for (const i of fr) { const x = i % w, y = (i - x) / w; for (const j of [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, y > 0 ? i - w : -1, y < h - 1 ? i + w : -1]) if (j >= 0 && dist[j] === 65535) { dist[j] = d; nx.push(j); } } fr = nx; }
  // canopy blobs: canopy pixels (plus the inferred roof they hide) within reach of the roof
  const isCanopy = (i) => ob.tree[i] === 1 && (dist[i] <= OB.nearM / px || st.inferred[i] || (st.ghost && st.ghost[i] > 0));
  const blobId = new Int32Array(N).fill(-1); const blobs = [];
  for (let s = 0; s < N; s++) {
    if (blobId[s] !== -1 || !isCanopy(s)) continue;
    const id = blobs.length; const b = { id, n: 0, overlapPx: 0, top: -Infinity, minDist: 65535, sx: 0, sy: 0 }; const stack = [s]; blobId[s] = id;
    while (stack.length) { const i = stack.pop(); const x = i % w, y = (i - x) / w; b.n++; b.sx += x; b.sy += y; if (st.inferred[i] || roof[i] || (st.ghost && st.ghost[i] > 0)) b.overlapPx++; if (dsm[i] > b.top) b.top = dsm[i]; if (dist[i] < b.minDist) b.minDist = dist[i];
      for (const j of [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, y > 0 ? i - w : -1, y < h - 1 ? i + w : -1]) if (j >= 0 && blobId[j] === -1 && isCanopy(j)) { blobId[j] = id; stack.push(j); } }
    blobs.push(b);
  }
  const keep = blobs.filter((b) => b.n * geo.pxM2 >= OB.minBlobM2).sort((p, q) => q.overlapPx - p.overlapPx || q.n - p.n).slice(0, 14);
  const outline = (raster, id) => { const loop = regionOuterLoop(raster, w, h, id); if (loop.length < 8) return null; const P = loop.map((e) => [geo.E(e.a[0]), geo.N(e.a[1])]); const half = Math.floor(P.length / 2); const s = dpM(P.slice(0, half + 1), 0.45).slice(0, -1).concat(dpM(P.slice(half).concat([P[0]]), 0.45).slice(0, -1)); return s.length >= 3 ? s : null; };
  const trees = [];
  for (const b of keep) {
    const o = outline(blobId, b.id); if (!o) continue;
    const over = b.overlapPx * geo.pxM2 >= 1.0;
    if (!over && (b.n * geo.pxM2 < 4 || b.top - ob.ground < 3)) continue;      // small low shrubs beside the house are not reported
    trees.push({ kind: over ? 'overlap' : 'near', path: o.map(toLL), areaSqft: b.n * geo.pxM2 * SQFT, overlapSqft: b.overlapPx * geo.pxM2 * SQFT, topFt: (b.top - ob.ground) * FT, distFt: b.minDist * px * FT });
  }
  // other buildings in the frame near the roof
  const structures = [];
  { const other = new Int32Array(N).fill(-1); let nid = 0;
    for (let s = 0; s < N; s++) { if (other[s] !== -1 || !mask[s] || roof[s] || ob.tree[s] === 1) continue; const id = nid++; const stack = [s]; other[s] = id; let n = 0, top = -Infinity, md = 65535;
      while (stack.length) { const i = stack.pop(); n++; const x = i % w, y = (i - x) / w; if (dsm[i] > top) top = dsm[i]; if (dist[i] < md) md = dist[i]; for (const j of [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, y > 0 ? i - w : -1, y < h - 1 ? i + w : -1]) if (j >= 0 && other[j] === -1 && mask[j] && !roof[j] && ob.tree[j] !== 1) { other[j] = id; stack.push(j); } }
      // a strip of mask left beside the traced roof (trimmed overhang, regularised wall line) is not another building
      if (n * geo.pxM2 < 6 || md * px > OB.structM || md <= 1) continue;
      const o = outline(other, id); if (o) structures.push({ path: o.map(toLL), areaSqft: n * geo.pxM2 * SQFT, topFt: (top - ob.ground) * FT, distFt: md * px * FT }); } }
  const nearTrees = trees.filter((t) => t.kind === 'near'), overTrees = trees.filter((t) => t.kind === 'overlap');
  const tallest = (a) => (a.length ? Math.max(...a.map((t) => t.topFt)) : null);
  return {
    source: ob.hasRgb ? 'Google Solar height model (10 cm) + aerial RGB colour' : 'Google Solar height model (10 cm); no aerial colour layer',
    heightReference: 'ground beside the house (5th percentile of the height model outside all buildings)',
    roofPlanSqft: roofPx * geo.pxM2 * SQFT, inferredPlanSqft: infPx * geo.pxM2 * SQFT, unresolvedContactFt: unrPx * px * FT,
    footprintObscuredPct: roofPx ? infPx / roofPx * 100 : 0,
    trees, structures,
    tallestOverlapTreeFt: tallest(overTrees), tallestNearTreeFt: tallest(nearTrees), tallestStructureFt: tallest(structures),
    ridgeFt: ridgeZ > -Infinity ? (ridgeZ - ob.ground) * FT : null,
  };
}
