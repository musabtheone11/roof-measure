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
  tallM: 2.0,          // objects lower than this above the ground are not obstructions (shrubs, cars, fences)
  roughM: 0.08,        // mean local plane-fit residual (m) over roughWinPx above this = canopy texture, not a roof plane
  roughWinPx: 5,       // half window for the mean (11 px = 1.1 m)
  exgMin: 4,           // excess green (2G - R - B, 0..255 scale) at or above this counts as vegetation colour
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
  const tree = new Uint8Array(N);
  for (let i = 0; i < N; i++) {
    if (!(dsm[i] > -1000) || dsm[i] - ground < OB.tallM || rough[i] < OB.roughM) continue;
    // off every building: a tall rough object is vegetation unless its colour says otherwise is unknowable, so call it canopy;
    // on a building: it must also look like vegetation (green), or be very rough when there is no colour layer
    if (!mask[i]) tree[i] = 1;
    else if (hasRgb) tree[i] = (2 * rgb[1][i] - rgb[0][i] - rgb[2][i]) >= OB.exgMin ? 1 : 2;
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

// ---- 2. continue roof planes under canopy
// label: region id per pixel (>= 0) after region growing / merging, before hole filling. Returns the effective roof mask,
// the label raster with inferred pixels added, and the Inferred / Unresolved rasters.
function obInferHidden(dsm, label, regions, member, mask, w, h, geo, lp, ob) {
  const N = w * h, px = Math.sqrt(geo.pxM2);
  const inferred = new Uint8Array(N), unresolved = new Uint8Array(N), memberEff = new Uint8Array(member);
  const zOf = (pl, x, y) => pl.a * lp.Ecol[x] + pl.b * lp.Nrow[y] + pl.c;
  // candidates: canopy pixels that carry no roof plane (on the mask or beside it), not on another building
  const cand = new Uint8Array(N); let nCand = 0;
  for (let i = 0; i < N; i++) if (label[i] < 0 && ob.tree[i] === 1 && (member[i] || !mask[i])) { cand[i] = 1; nCand++; }
  if (!nCand) return { label, memberEff, inferred, unresolved, canopyOnMaskPx: 0 };
  let canopyOnMask = 0; for (let i = 0; i < N; i++) if (cand[i] && member[i]) canopyOnMask++;
  // Around every canopy there is a ring of roof pixels that carry no plane yet (blurred canopy edge, creases). Give those
  // their neighbour's plane first, otherwise the continuation below can never start and the covered roof would be lost.
  { const m2 = new Uint8Array(N); for (let i = 0; i < N; i++) m2[i] = member[i] && !cand[i] ? 1 : 0; label = fillHoles(dsm, label, m2, w, h, regions, lp); }
  // eave height of each plane: low percentile of the plane's height along its visible outline (outside = not roof, not canopy)
  const edgeZ = new Map(), uRange = new Map();
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x, l = label[i]; if (l < 0) continue;
    const pl = regions[l].plane; const s = Math.hypot(pl.a, pl.b);
    if (s > 0.06) { const u = (-pl.b * lp.Ecol[x] + pl.a * lp.Nrow[y]) / s; const r = uRange.get(l); if (!r) uRange.set(l, [u, u]); else { if (u < r[0]) r[0] = u; if (u > r[1]) r[1] = u; } }
    const nb = [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, y > 0 ? i - w : -1, y < h - 1 ? i + w : -1];
    for (const j of nb) { if (j < 0 || (label[j] < 0 && !member[j] && !cand[j])) { let a = edgeZ.get(l); if (!a) edgeZ.set(l, (a = [])); a.push(zOf(pl, x, y)); break; } }
  }
  const eaveZ = new Map();
  for (const [l, a] of edgeZ) if (a.length >= OB.minEavePx) { a.sort((p, q) => p - q); eaveZ.set(l, a[Math.floor(a.length * 0.1)]); }
  // planes with no visible eave borrow the eave height of the building (median of the measured ones, weighted by size)
  let fallbackEave = null;
  { const zs = [...eaveZ.entries()].map(([l, z]) => ({ z, n: regions[l].n })).sort((p, q) => p.z - q.z); let tot = zs.reduce((s, v) => s + v.n, 0), acc = 0; for (const v of zs) { acc += v.n; if (acc >= tot / 2) { fallbackEave = v.z; break; } } }
  // multi-source growth from the labelled roof into the candidates, one pixel ring at a time
  const out = new Int32Array(label); const maxRings = Math.round(OB.fillMaxM / px);
  let frontier = [];
  for (let i = 0; i < N; i++) if (cand[i]) { const x = i % w, y = (i - x) / w; if ((x > 0 && out[i - 1] >= 0) || (x < w - 1 && out[i + 1] >= 0) || (y > 0 && out[i - w] >= 0) || (y < h - 1 && out[i + w] >= 0)) frontier.push(i); }
  const borrowed = new Uint8Array(N), notCanopy = new Uint8Array(N);
  const queued = new Uint16Array(N);    // ring number a pixel was last queued in: each pixel enters a ring once
  { const seen = new Uint8Array(N); frontier = frontier.filter((i) => (seen[i] ? false : (seen[i] = 1))); }
  for (let ring = 0; ring < maxRings && frontier.length; ring++) {
    const assign = [];
    for (const i of frontier) {
      if (out[i] >= 0) continue; const x = i % w, y = (i - x) / w;
      let best = -1, bz = Infinity;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const xx = x + dx, yy = y + dy; if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue; const l = out[yy * w + xx]; if (l < 0) continue; const z = zOf(regions[l].plane, x, y); if (z < bz) { bz = z; best = l; } }
      if (best < 0) continue;
      const pl = regions[best].plane; const own = eaveZ.get(best); const ez = own != null ? own : fallbackEave;
      if (ez == null) { if (member[i]) unresolved[i] = 1; continue; }
      if (bz < ez - OB.eaveTolM) continue;                               // below the eave line: the roof has ended
      if (dsm[i] > -1000 && dsm[i] < bz + OB.aboveM) { if (dsm[i] >= bz - OB.belowTolM && member[i]) notCanopy[i] = 1; continue; }   // not above the roof plane: this is roof surface or open air, not canopy over roof
      if (!member[i]) {                                                  // beyond Google's mask: only straight up / down slope of the seen plane
        const s = Math.hypot(pl.a, pl.b); if (s <= 0.06) continue;
        const r = uRange.get(best); const u = (-pl.b * lp.Ecol[x] + pl.a * lp.Nrow[y]) / s;
        if (!r || u < r[0] - OB.sideTolM || u > r[1] + OB.sideTolM) continue;
      }
      assign.push(i, best, own == null ? 1 : 0);
    }
    const next = [];
    for (let k = 0; k < assign.length; k += 3) { const i = assign[k]; if (out[i] >= 0) continue; out[i] = assign[k + 1]; inferred[i] = 1; if (assign[k + 2]) borrowed[i] = 1; }
    for (let k = 0; k < assign.length; k += 3) {
      const i = assign[k]; const x = i % w, y = (i - x) / w;
      for (const j of [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, y > 0 ? i - w : -1, y < h - 1 ? i + w : -1]) if (j >= 0 && cand[j] && out[j] < 0 && queued[j] !== ring + 2) { queued[j] = ring + 2; next.push(j); }
    }
    frontier = next;
  }
  // effective roof mask: inferred pixels are roof; canopy on the mask that no plane reaches is not (the mask followed the tree)
  for (let i = 0; i < N; i++) {
    if (inferred[i]) memberEff[i] = 1;
    else if (cand[i] && member[i] && !unresolved[i] && !notCanopy[i]) memberEff[i] = 0;
  }
  // unresolved contact: visible roof that stops at canopy which stands ABOVE the roof there (an overhang hides the edge)
  // while the plane is still well above its eave height. Canopy lower than the roof edge does not hide it: seen from
  // above, the roof covers the tree, so that edge is measured.
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
    const i = y * w + x, l = out[i]; if (l < 0 || inferred[i]) continue;
    const zr = zOf(regions[l].plane, x, y); let over = false;
    for (const j of [i - 1, i + 1, i - w, i + w]) if (cand[j] && out[j] < 0 && dsm[j] > zr + OB.overhangM) { over = true; break; }
    if (!over) continue;
    const ez = eaveZ.has(l) ? eaveZ.get(l) : fallbackEave; if (ez == null) { unresolved[i] = 1; continue; }
    if (zr > ez + 0.45) unresolved[i] = 1;
  }
  // A continued plane must end at its eave line. Where the filled area instead ends because the canopy ends (open air or
  // more canopy beside it while the plane is still well above its eave height), the true roof edge is somewhere under the
  // tree and was not located: that edge is Unresolved, never a measured or inferred roof edge.
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
    const i = y * w + x; if (!inferred[i]) continue; const l = out[i];
    if (out[i - 1] >= 0 && out[i + 1] >= 0 && out[i - w] >= 0 && out[i + w] >= 0) continue;
    const ez = eaveZ.has(l) ? eaveZ.get(l) : fallbackEave; if (ez == null) { unresolved[i] = 1; continue; }
    if (zOf(regions[l].plane, x, y) > ez + 0.3) unresolved[i] = 1;
  }
  return { label: out, memberEff, inferred, unresolved, borrowed, canopyOnMaskPx: canopyOnMask, eaveZ, fallbackEave };
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
      tot += L / steps; if (fu) unr += L / steps; else if (fi) inf += L / steps;
    }
  }
  return { lenM: tot, inferredM: inf, unresolvedM: unr };
}

// ---- 4. summary for the report: canopy polygons near the roof, other buildings, heights with their reference
function obSummarize(dsm, w, h, geo, mask, label, regions, ob, st, toLL) {
  const N = w * h, px = Math.sqrt(geo.pxM2), FT = 3.28084, SQFT = 10.7639104;
  const roof = new Uint8Array(N); let roofPx = 0, infPx = 0, unrPx = 0, ridgeZ = -Infinity;
  for (let i = 0; i < N; i++) if (label[i] >= 0) { roof[i] = 1; roofPx++; if (st.inferred[i]) infPx++; else if (dsm[i] > ridgeZ && !ob.tree[i]) ridgeZ = dsm[i]; if (st.unresolved[i]) unrPx++; }
  // distance to the roof (chamfer, capped) for "nearby"
  const cap = Math.round(Math.max(OB.nearM, OB.structM) / px) + 2; const dist = new Uint16Array(N).fill(65535);
  let fr = []; for (let i = 0; i < N; i++) if (roof[i]) { dist[i] = 0; fr.push(i); }
  for (let d = 1; d <= cap && fr.length; d++) { const nx = []; for (const i of fr) { const x = i % w, y = (i - x) / w; for (const j of [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, y > 0 ? i - w : -1, y < h - 1 ? i + w : -1]) if (j >= 0 && dist[j] === 65535) { dist[j] = d; nx.push(j); } } fr = nx; }
  // canopy blobs: canopy pixels (plus the inferred roof they hide) within reach of the roof
  const isCanopy = (i) => ob.tree[i] === 1 && (dist[i] <= OB.nearM / px || st.inferred[i]);
  const blobId = new Int32Array(N).fill(-1); const blobs = [];
  for (let s = 0; s < N; s++) {
    if (blobId[s] !== -1 || !isCanopy(s)) continue;
    const id = blobs.length; const b = { id, n: 0, overlapPx: 0, top: -Infinity, minDist: 65535, sx: 0, sy: 0 }; const stack = [s]; blobId[s] = id;
    while (stack.length) { const i = stack.pop(); const x = i % w, y = (i - x) / w; b.n++; b.sx += x; b.sy += y; if (st.inferred[i] || (roof[i])) b.overlapPx++; if (dsm[i] > b.top) b.top = dsm[i]; if (dist[i] < b.minDist) b.minDist = dist[i];
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
