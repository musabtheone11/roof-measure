'use strict';
/* autotrace2.js - roof reconstruction from Google's 10 cm digital surface model (DSM).
 *
 *  1. Fit a local plane at every roof pixel (integral images) -> slope, normal, fit residual.
 *  2. Grow planar regions from the flattest seeds; merge near-identical neighbours; absorb slivers.
 *  3. Extract the region topology from the label raster: junction vertices and boundary chains.
 *  4. Rebuild the geometry: every ridge / hip / valley is the exact plan-view intersection line of the two fitted
 *     planes; eaves and rakes are straight runs snapped to the plane's contour or slope direction; junction vertices
 *     are the least-squares intersection of all incident lines, so facets share vertices exactly.
 *  5. Classify each edge from the plane geometry (convex / concave, level / sloped, height gap).
 *
 * Uses globals from app.js / autotrace.js: AT, allComponents, floodComponent, degToPitch.
 */

var AT2 = {
  win: 3,              // half window (px) for local plane fits -> 7x7 = 0.7 m
  seedResid: 0.035,    // max local fit RMS (m) for a seed pixel
  goodResid: 0.06,     // local normal considered reliable below this RMS
  growDist: 0.13,      // max height distance (m) to the region plane for reliable pixels
  growDistWeak: 0.07,  // ... for pixels whose local normal is unreliable (ridges, edges)
  growAngle: 9,        // max angle (deg) between local normal and region normal
  mergeAngle: 4.5,       // merge neighbouring regions whose planes differ less than this (deg)
  mergeDist: 0.09,     // ... and whose heights agree along the shared boundary (m)
  minRegionM2: 1.2,    // smaller regions are absorbed by a neighbour
  dpEpsM: 0.38,        // outline simplification tolerance (m)
  snapDeg: 20,
  diagMinM: 2.2,       // outline runs shorter than this never snap to the 45-degree diagonals
  jogM: 0.4,           // parallel outline runs closer than this are one straight line
  shortRunM: 0.7,      // short runs between parallel runs are jogs to remove         // snap outline runs to the plane's contour / slope direction within this angle
  maxJunctionMoveM: 1.3,
  sliverM: 0.4,        // regions thinner than this (2*area/perimeter, m) are absorbed
  sliverMaxM2: 25,
  fpEpsM: 0.35,        // footprint simplification tolerance (m)
  fpSnapDeg: 18,       // footprint runs within this angle of a building axis snap to it
  fpJogM: 0.45,        // parallel footprint runs closer than this are one wall line
  fpShortM: 0.9,       // shorter runs between parallel runs are jogs
  fpChamferMaxM: 9,    // diagonal corner cuts up to this long can be squared off
  fpChamferInsideM: 2.4, // inside-corner chamfers shorter than this are squared too
  fpChamferFreeM: 2.2, // ... always when shorter than this, otherwise only if the corner is occluded (tree canopy)
  eaveBufferM: 0,      // outward offset of the footprint (benchmarked: 0.15 m made well-traced houses 4-5% too big)
  regularizeFootprint: true,
  bendGapM: 0.15,      // a pitch break is continuous: one plane rising and one falling across a line with a bigger gap is a step
  pitchAnchorM2: 15,   // facets at least this big define the house's design pitches
  bandThickM: 0.9,     // crease bands thinner than this (2*area/perimeter, m) are candidates
  bandMaxM2: 14,       // ... and smaller than 2x this
  bandPitchTol: 1.6,   // a band whose pitch is within this (x/12) of a neighbour could be a real narrow facet: keep
  bandSteep: 20,       // steeper than 20/12: wall or eave drop-off, never a roof plane
  islandMaxM2: 8,      // enclosed regions smaller than this join the plane around them
  refitGateM: 0.5,     // first refit pass ignores pixels this far off the grown plane (canopy and chimney pixels filled into the region)
  occludedAboveM: 0.5, // a roof pixel this far above the nearest plane is canopy or a chimney, not roof surface
  occludedMinM2: 1.0,  // ... handled as an occluded blob when the blob is at least this big
  eaveDropMinPitch: 13, eaveDropSteeperBy: 6, eaveDropMaxWidthM: 1.5, // eave drop-off strips: at least this steep, this much steeper than the roof behind, and no wider
  bandAspect: 3.5,     // ... and a band is a strip: length / width above this (hip-end triangles are compact)
};

// ------------------------------------------------------------------ 1. local planes
function localPlanes(dsm, member, w, h, geo) {
  const W1 = w + 1, N = W1 * (h + 1);
  const I = Array.from({ length: 10 }, () => new Float64Array(N));
  const Ecol = new Float64Array(w), Nrow = new Float64Array(h);
  for (let x = 0; x < w; x++) Ecol[x] = geo.E(x + 0.5);
  for (let y = 0; y < h; y++) Nrow[y] = geo.N(y + 0.5);
  for (let y = 0; y < h; y++) {
    const r = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
    for (let x = 0; x < w; x++) {
      const i = y * w + x, z = dsm[i];
      if (member[i] && z > -1000) { const e = Ecol[x], n = Nrow[y]; r[0] += 1; r[1] += e; r[2] += n; r[3] += z; r[4] += e * e; r[5] += e * n; r[6] += n * n; r[7] += e * z; r[8] += n * z; r[9] += z * z; }
      const k = (y + 1) * W1 + (x + 1), ku = y * W1 + (x + 1);
      for (let c = 0; c < 10; c++) I[c][k] = I[c][ku] + r[c];
    }
  }
  const box = (c, x0, y0, x1, y1) => I[c][y1 * W1 + x1] - I[c][y0 * W1 + x1] - I[c][y1 * W1 + x0] + I[c][y0 * W1 + x0];
  const A = new Float32Array(w * h), B = new Float32Array(w * h), C = new Float32Array(w * h), R = new Float32Array(w * h).fill(9);
  const r = AT2.win, full = (2 * r + 1) * (2 * r + 1);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x; if (!member[i]) continue;
    const x0 = Math.max(0, x - r), y0 = Math.max(0, y - r), x1 = Math.min(w, x + r + 1), y1 = Math.min(h, y + r + 1);
    const n = box(0, x0, y0, x1, y1); if (n < full * 0.55) continue;
    const se = box(1, x0, y0, x1, y1), sn = box(2, x0, y0, x1, y1), sz = box(3, x0, y0, x1, y1);
    const cee = box(4, x0, y0, x1, y1) - se * se / n, cen = box(5, x0, y0, x1, y1) - se * sn / n, cnn = box(6, x0, y0, x1, y1) - sn * sn / n;
    const cez = box(7, x0, y0, x1, y1) - se * sz / n, cnz = box(8, x0, y0, x1, y1) - sn * sz / n, czz = box(9, x0, y0, x1, y1) - sz * sz / n;
    const det = cee * cnn - cen * cen; if (Math.abs(det) < 1e-12) continue;
    const a = (cez * cnn - cnz * cen) / det, b = (cnz * cee - cez * cen) / det;
    const c = (sz - a * se - b * sn) / n;
    const v = Math.max(0, (czz - a * cez - b * cnz) / n);
    A[i] = a; B[i] = b; C[i] = c; R[i] = Math.sqrt(v);
  }
  return { A, B, C, R, Ecol, Nrow };
}
var angleBetween = (a1, b1, a2, b2) => { const n1 = Math.hypot(a1, b1, 1), n2 = Math.hypot(a2, b2, 1); const d = (a1 * a2 + b1 * b2 + 1) / (n1 * n2); return Math.acos(Math.min(1, Math.max(-1, d))) * 180 / Math.PI; };

// incremental least-squares plane z = aE + bN + c
var PlaneAcc = class {
  constructor() { this.s = new Float64Array(10); }
  add(e, n, z, wgt = 1) { const s = this.s; s[0] += wgt; s[1] += wgt * e; s[2] += wgt * n; s[3] += wgt * z; s[4] += wgt * e * e; s[5] += wgt * e * n; s[6] += wgt * n * n; s[7] += wgt * e * z; s[8] += wgt * n * z; s[9] += wgt * z * z; }
  merge(o) { for (let k = 0; k < 10; k++) this.s[k] += o.s[k]; }
  solve() {
    const s = this.s, n = s[0]; if (n < 3) return null;
    const cee = s[4] - s[1] * s[1] / n, cen = s[5] - s[1] * s[2] / n, cnn = s[6] - s[2] * s[2] / n, cez = s[7] - s[1] * s[3] / n, cnz = s[8] - s[2] * s[3] / n, czz = s[9] - s[3] * s[3] / n;
    const det = cee * cnn - cen * cen; if (Math.abs(det) < 1e-10) return null;
    const a = (cez * cnn - cnz * cen) / det, b = (cnz * cee - cez * cen) / det;
    return { a, b, c: (s[3] - a * s[1] - b * s[2]) / n, rms: Math.sqrt(Math.max(0, (czz - a * cez - b * cnz) / n)), n };
  }
}

// ------------------------------------------------------------------ 2. region growing
function growRegions(dsm, member, w, h, lp, geo) {
  const label = new Int32Array(w * h).fill(-1);
  const seeds = [];
  for (let i = 0; i < w * h; i++) if (member[i] && dsm[i] > -1000 && lp.R[i] < AT2.seedResid) seeds.push(i);
  seeds.sort((p, q) => lp.R[p] - lp.R[q]);
  const regions = [];
  const queue = new Int32Array(w * h);
  for (const s of seeds) {
    if (label[s] !== -1) continue;
    const id = regions.length; const acc = new PlaneAcc();
    let pl = { a: lp.A[s], b: lp.B[s], c: lp.C[s] };
    let head = 0, tail = 0; queue[tail++] = s; label[s] = id; let count = 0, nextFit = 40;
    const sx = s % w, sy = (s - sx) / w; acc.add(lp.Ecol[sx], lp.Nrow[sy], dsm[s]);
    while (head < tail) {
      const i = queue[head++]; count++;
      const x = i % w, y = (i - x) / w;
      const nb = [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, y > 0 ? i - w : -1, y < h - 1 ? i + w : -1];
      for (const j of nb) {
        if (j < 0 || label[j] !== -1 || !member[j]) continue;
        const z = dsm[j]; if (!(z > -1000)) continue;
        const jx = j % w, jy = (j - jx) / w; const e = lp.Ecol[jx], n = lp.Nrow[jy];
        const d = Math.abs(z - (pl.a * e + pl.b * n + pl.c));
        const reliable = lp.R[j] < AT2.goodResid;
        if (reliable ? (d < AT2.growDist && angleBetween(lp.A[j], lp.B[j], pl.a, pl.b) < AT2.growAngle) : d < AT2.growDistWeak) {
          label[j] = id; queue[tail++] = j; acc.add(e, n, z);
          if (tail >= nextFit) { const f = acc.solve(); if (f) pl = f; nextFit = Math.ceil(tail * 1.6) + 20; }
        }
      }
    }
    const f = acc.solve(); if (f) pl = f;
    regions.push({ id, n: tail, plane: pl, acc });
  }
  return { label, regions };
}

// adjacency (shared crack-edge counts) between labels; -1 = outside
function adjacency(label, w, h) {
  const adj = new Map();
  const add = (p, q) => { if (p === q) return; const k = p < q ? p + ',' + q : q + ',' + p; adj.set(k, (adj.get(k) || 0) + 1); };
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x; const l = label[i];
    add(l, x < w - 1 ? label[i + 1] : -1); add(l, y < h - 1 ? label[i + w] : -1);
    if (x === 0) add(l, -1); if (y === 0) add(l, -1);
  }
  return adj;
}

function mergeRegions(dsm, label, regions, w, h, lp, geo) {
  // union-find over regions; merge near-coplanar neighbours, then absorb small regions
  const parent = regions.map((r) => r.id);
  const find = (i) => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  const pxM2 = geo.pxM2;
  for (let pass = 0; pass < 3; pass++) {
    const adj = adjacency(label.map((l) => (l >= 0 ? find(l) : l)), w, h);
    let merged = 0;
    const pairs = [...adj.entries()].filter(([k]) => !k.includes('-')).map(([k, v]) => { const [p, q] = k.split(',').map(Number); return { p, q, shared: v }; }).sort((s, t) => t.shared - s.shared);
    for (const { p, q, shared } of pairs) {
      const P = find(p), Q = find(q); if (P === Q || shared < 6) continue;
      const a = regions[P].plane, b = regions[Q].plane;
      if (angleBetween(a.a, a.b, b.a, b.b) > AT2.mergeAngle) continue;
      // heights agree at both region centroids (planes really coincide, not parallel at different heights)
      const ca = regions[P].acc.s, cb = regions[Q].acc.s;
      const pa = [ca[1] / ca[0], ca[2] / ca[0]], pb = [cb[1] / cb[0], cb[2] / cb[0]];
      const mid = [(pa[0] + pb[0]) / 2, (pa[1] + pb[1]) / 2];
      const dz = Math.abs((a.a * mid[0] + a.b * mid[1] + a.c) - (b.a * mid[0] + b.b * mid[1] + b.c));
      if (dz > AT2.mergeDist * 2) continue;
      parent[Q] = P; regions[P].acc.merge(regions[Q].acc); regions[P].n += regions[Q].n; const f = regions[P].acc.solve(); if (f) regions[P].plane = f; merged++;
    }
    if (!merged) break;
  }
  for (let i = 0; i < label.length; i++) if (label[i] >= 0) label[i] = find(label[i]);
  // absorb small regions into the neighbour whose plane fits their pixels best
  for (let pass = 0; pass < 3; pass++) {
    const sizes = new Map(); for (const l of label) if (l >= 0) sizes.set(l, (sizes.get(l) || 0) + 1);
    const small = [...sizes.entries()].filter(([, n]) => n * pxM2 < AT2.minRegionM2).map(([l]) => l);
    if (!small.length) break;
    const adj = adjacency(label, w, h);
    const smallSet = new Set(small);
    for (const s of small) {
      let best = null, bestErr = Infinity;
      for (const [k, v] of adj) { const [p, q] = k.split(',').map(Number); const o = p === s ? q : q === s ? p : null; if (o == null || o < 0 || smallSet.has(o)) continue;
        // mean height misfit of the small region's pixels against the neighbour plane
        const pl = regions[o].plane; let err = 0, n = 0;
        for (let i = 0; i < label.length; i += 1) if (label[i] === s) { const x = i % w, y = (i - x) / w; err += Math.abs(dsm[i] - (pl.a * lp.Ecol[x] + pl.b * lp.Nrow[y] + pl.c)); n++; if (n > 400) break; }
        err = n ? err / n : Infinity; const score = err - v * 0.0005;
        if (score < bestErr) { bestErr = score; best = o; } }
      if (best != null) { for (let i = 0; i < label.length; i++) if (label[i] === s) label[i] = best; regions[best].n += sizes.get(s); }
      else { for (let i = 0; i < label.length; i++) if (label[i] === s) label[i] = -2; }
    }
  }
  return label;
}

// fill unlabelled roof pixels (-1 inside member, -2) from the neighbouring region whose plane fits best
// Tree canopy and chimneys sit above the roof: the heights there say nothing about the planes underneath, and "the
// plane closest in height" is simply the highest one, so a hip or ridge under a tree ended up far from the real line
// (and was then typed as a step). Under an occluded blob each plane continues to its intersection with the others
// instead: a plane may grow into an occluded pixel only while it stays on its own side of the intersection line with
// every other plane around that blob. Whatever is left is filled by fillHoles as before.
function fillOccluded(dsm, label, member, w, h, regions, lp) {
  const N = w * h; const near = new Int32Array(label); const out = new Int32Array(label);
  // nearest labelled region for every unlabelled roof pixel
  { let frontier = []; for (let i = 0; i < N; i++) if (member[i] && label[i] < 0) frontier.push(i);
    for (let it = 0; it < 400 && frontier.length; it++) {
      const set = [], rest = [];
      for (const i of frontier) { const x = i % w; let q = -1; for (const j of [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, i - w, i + w]) if (j >= 0 && j < N && near[j] >= 0) { q = near[j]; break; } if (q >= 0) set.push([i, q]); else rest.push(i); }
      if (!set.length) break; for (const [i, q] of set) near[i] = q; frontier = rest;
    } }
  const zOf = (id, i) => { const x = i % w, y = (i - x) / w; const pl = regions[id].plane; return pl.a * lp.Ecol[x] + pl.b * lp.Nrow[y] + pl.c; };
  const occ = new Uint8Array(N); let any = false;
  for (let i = 0; i < N; i++) if (member[i] && label[i] < 0 && near[i] >= 0 && dsm[i] > -1000 && dsm[i] - zOf(near[i], i) > AT2.occludedAboveM) { occ[i] = 1; any = true; }
  if (!any) return label;
  // region centroids (which side of a line a plane's visible part lies on)
  const cen = new Map(); for (let i = 0; i < N; i++) { const l = label[i]; if (l < 0) continue; const x = i % w, y = (i - x) / w; let c = cen.get(l); if (!c) cen.set(l, (c = [0, 0, 0])); c[0] += lp.Ecol[x]; c[1] += lp.Nrow[y]; c[2]++; }
  const seen = new Uint8Array(N);
  for (let s0 = 0; s0 < N; s0++) {
    if (!occ[s0] || seen[s0]) continue;
    const comp = [s0]; seen[s0] = 1; const cands = new Set();
    for (let k = 0; k < comp.length; k++) { const i = comp[k], x = i % w; cands.add(near[i]);
      for (const j of [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, i - w, i + w]) { if (j < 0 || j >= N) continue; if (occ[j] && !seen[j]) { seen[j] = 1; comp.push(j); } else if (label[j] >= 0) cands.add(label[j]); } }
    if (comp.length * Math.abs((lp.Ecol[1] - lp.Ecol[0]) * (lp.Nrow[1] - lp.Nrow[0])) < AT2.occludedMinM2 || cands.size < 2) continue;
    const C = [...cands];
    // pairwise "own side" tests: D(x) = zR(x) - zQ(x) keeps the sign it has at R's centroid
    const tests = new Map();
    for (const R of C) { const pr = regions[R].plane, cr = cen.get(R); const list = []; if (!cr) { tests.set(R, null); continue; }
      for (const Q of C) { if (Q === R) continue; const pq = regions[Q].plane; const da = pr.a - pq.a, db = pr.b - pq.b, dc = pr.c - pq.c; if (Math.hypot(da, db) < 0.08) continue;
        const d0 = da * cr[0] / cr[2] + db * cr[1] / cr[2] + dc; if (Math.abs(d0) < 0.12) continue; list.push([da, db, dc, Math.sign(d0)]); }
      tests.set(R, list); }
    const ok = (R, i) => { const t = tests.get(R); if (!t) return false; const x = i % w, y = (i - x) / w; const e = lp.Ecol[x], n = lp.Nrow[y]; for (const [da, db, dc, sg] of t) if ((da * e + db * n + dc) * sg < -0.05) return false; return true; };
    let todo = comp;
    for (let it = 0; it < 600 && todo.length; it++) {
      const set = [], rest = [];
      for (const i of todo) { const x = i % w; let q = -1;
        for (const j of [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, i - w, i + w]) { if (j < 0 || j >= N) continue; const l = out[j]; if (l >= 0 && cands.has(l) && ok(l, i)) { q = l; break; } }
        if (q >= 0) set.push([i, q]); else rest.push(i); }
      if (!set.length) break; for (const [i, q] of set) out[i] = q; todo = rest;
    }
  }
  return out;
}

function fillHoles(dsm, label, member, w, h, regions, lp) {
  label = fillOccluded(dsm, label, member, w, h, regions, lp);
  for (let it = 0; it < 80; it++) {
    let changed = 0; const next = new Int32Array(label);
    for (let i = 0; i < w * h; i++) {
      if (!member[i] || label[i] >= 0) continue;
      const x = i % w, y = (i - x) / w; const nb = [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, y > 0 ? i - w : -1, y < h - 1 ? i + w : -1];
      let best = -1, bestD = Infinity;
      for (const j of nb) { if (j < 0 || label[j] < 0) continue; const pl = regions[label[j]].plane; const d = dsm[i] > -1000 ? Math.abs(dsm[i] - (pl.a * lp.Ecol[x] + pl.b * lp.Nrow[y] + pl.c)) : 0; if (d < bestD) { bestD = d; best = label[j]; } }
      if (best >= 0) { next[i] = best; changed++; }
    }
    label = next; if (!changed) break;
  }
  return label;
}

// absorb thin strip regions (gutters, fascia, ridge-cap bands): thickness = 2*area/perimeter below AT2.sliverM
function absorbSlivers(dsm, label, regions, w, h, lp, geo) {
  const px = Math.sqrt(geo.pxM2);
  for (let pass = 0; pass < 3; pass++) {
    const area = new Map(), perim = new Map(), shared = new Map();
    const addShared = (p, q) => { if (p < 0) return; const m = shared.get(p) || new Map(); m.set(q, (m.get(q) || 0) + 1); shared.set(p, m); };
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = y * w + x, l = label[i]; if (l < 0) continue; area.set(l, (area.get(l) || 0) + 1);
      const nb = [x > 0 ? label[i - 1] : -1, x < w - 1 ? label[i + 1] : -1, y > 0 ? label[i - w] : -1, y < h - 1 ? label[i + w] : -1];
      for (const q of nb) if (q !== l) { perim.set(l, (perim.get(l) || 0) + 1); addShared(l, q); }
    }
    let changed = 0;
    for (const [l, n] of area) {
      const t = 2 * n / Math.max(1, perim.get(l) || 1) * px;
      if (t >= AT2.sliverM || n * geo.pxM2 > AT2.sliverMaxM2) continue;
      const nbs = [...(shared.get(l) || new Map()).entries()].filter(([q]) => q >= 0 && q !== l);
      if (!nbs.length) continue;
      // neighbour whose plane explains the strip best, weighted by shared boundary length
      let best = null, bestScore = Infinity;
      for (const [q, len] of nbs) {
        const pl = regions[q].plane; let err = 0, k = 0;
        for (let i = 0; i < label.length && k < 300; i++) if (label[i] === l && dsm[i] > -1000) { const x = i % w, y = (i - x) / w; err += Math.abs(dsm[i] - (pl.a * lp.Ecol[x] + pl.b * lp.Nrow[y] + pl.c)); k++; }
        const score = (k ? err / k : 1) - len * 0.0004;
        if (score < bestScore) { bestScore = score; best = q; }
      }
      for (let i = 0; i < label.length; i++) if (label[i] === l) label[i] = best;
      changed++;
    }
    if (!changed) break;
  }
  return label;
}

// ------------------------------------------------------------------ footprint regularisation
// Fit the building outline as straight runs on the building's two axes (Roofr outlines are rectilinear), remove small
// jogs, restore corners cut off by tree canopy, then re-rasterise the footprint so every later step follows it.
function regularizeFootprint(dsm, label, w, h, geo, dominantDeg, ground) {
  const M = new Uint8Array(w * h); for (let i = 0; i < w * h; i++) M[i] = label[i] >= 0 ? 1 : 0;
  const reg = new Int32Array(w * h).fill(-1); for (let i = 0; i < w * h; i++) if (M[i]) reg[i] = 0;
  const loop = regionOuterLoop(reg, w, h, 0);
  if (loop.length < 8) return label;
  const P = loop.map((e) => [geo.E(e.a[0]), geo.N(e.a[1])]);
  const th = dominantDeg * Math.PI / 180;
  const ax = [[Math.cos(th), Math.sin(th)], [-Math.sin(th), Math.cos(th)]];
  // DP on the closed ring: split at the two farthest-apart points
  let i0 = 0, i1 = 0, far = -1; for (let i = 0; i < P.length; i += 4) { const d = Math.hypot(P[i][0] - P[0][0], P[i][1] - P[0][1]); if (d > far) { far = d; i1 = i; } }
  const ringA = P.slice(i0, i1 + 1), ringB = P.slice(i1).concat([P[0]]);
  const simp = dpM(ringA, AT2.fpEpsM).slice(0, -1).concat(dpM(ringB, AT2.fpEpsM).slice(0, -1));
  // raw points per simplified segment (for line fitting)
  const idxOf = (p) => P.findIndex((q) => q[0] === p[0] && q[1] === p[1]);
  const sIdx = simp.map(idxOf);
  let runs = [];
  for (let k = 0; k < simp.length; k++) {
    const a = simp[k], b = simp[(k + 1) % simp.length]; const ia = sIdx[k], ib = sIdx[(k + 1) % simp.length];
    const pts = []; for (let i = ia; ; i = (i + 1) % P.length) { pts.push(P[i]); if (i === ib) break; if (pts.length > P.length) break; }
    const d = [b[0] - a[0], b[1] - a[1]]; const L = Math.hypot(d[0], d[1]) || 1e-9; const du = [d[0] / L, d[1] / L];
    let cls = -1, best = Math.cos(AT2.fpSnapDeg * Math.PI / 180);
    for (let c = 0; c < 2; c++) { const cs = Math.abs(du[0] * ax[c][0] + du[1] * ax[c][1]); if (cs > best) { best = cs; cls = c; } }
    const line = cls >= 0 ? lineWithDir(pts, ax[cls]) : lineFromPts(pts);
    runs.push({ cls, line, pts, len: L, a, b });
  }
  const offset = (r, p) => r.line.n[0] * p[0] + r.line.n[1] * p[1] - r.line.c;
  const refit = (r) => { r.line = r.cls >= 0 ? lineWithDir(r.pts, ax[r.cls]) : lineFromPts(r.pts); return r; };
  const joinR = (p, q, mid) => refit({ cls: p.cls, pts: p.pts.concat(mid ? mid.pts : [], q.pts), len: p.len + q.len + (mid ? mid.len : 0), a: p.a, b: q.b });
  // ground height near the building for the "is this cut corner really missing roof?" test
  const triangleIsOccluded = (A, B, C) => {
    const xs = [A, B, C].map((p) => geo.X(p[0])), ys = [A, B, C].map((p) => geo.Y(p[1]));
    let hi = 0, n = 0;
    for (let y = Math.max(0, Math.floor(Math.min(...ys))); y <= Math.min(h - 1, Math.ceil(Math.max(...ys))); y++) for (let x = Math.max(0, Math.floor(Math.min(...xs))); x <= Math.min(w - 1, Math.ceil(Math.max(...xs))); x++) {
      const p = [geo.E(x + 0.5), geo.N(y + 0.5)];
      const s1 = (B[0] - A[0]) * (p[1] - A[1]) - (B[1] - A[1]) * (p[0] - A[0]), s2 = (C[0] - B[0]) * (p[1] - B[1]) - (C[1] - B[1]) * (p[0] - B[0]), s3 = (A[0] - C[0]) * (p[1] - C[1]) - (A[1] - C[1]) * (p[0] - C[0]);
      if (!((s1 >= 0 && s2 >= 0 && s3 >= 0) || (s1 <= 0 && s2 <= 0 && s3 <= 0))) continue;
      const i = y * w + x; if (M[i]) continue; n++; if (dsm[i] > ground + 2.0) hi++;
    }
    return n > 0 && hi / n > 0.6;
  };
  let ringSign = 0; { let s = 0; for (let i = 0; i < simp.length; i++) { const a = simp[i], b = simp[(i + 1) % simp.length]; s += a[0] * b[1] - b[0] * a[1]; } ringSign = Math.sign(s); }
  for (let it = 0; it < 8; it++) {
    let changed = false; const n = runs.length; if (n < 4) break;
    const out = [];
    for (let k = 0; k < runs.length; k++) {
      const r = runs[k], p = out.length ? out[out.length - 1] : runs[runs.length - 1], q = runs[(k + 1) % runs.length];
      // same axis + small offset: one wall line
      if (out.length && r.cls >= 0 && p.cls === r.cls && Math.abs(offset(p, r.line.m)) < AT2.fpJogM) { out[out.length - 1] = joinR(p, r); changed = true; continue; }
      // short run between two parallel runs: a jog
      if (out.length && k + 1 < runs.length && r.len < AT2.fpShortM && p.cls >= 0 && p.cls === q.cls && Math.abs(offset(p, q.line.m)) < AT2.fpJogM * 1.8) { out[out.length - 1] = joinR(p, q, r); k++; changed = true; continue; }
      // chamfer: a non-axis run between two perpendicular axis runs -> extend them to a square corner (if the corner is occluded)
      if (out.length && k + 1 < runs.length && r.cls < 0 && p.cls >= 0 && q.cls >= 0 && p.cls !== q.cls && r.len < AT2.fpChamferMaxM) {
        const c = intersect2(p.line, q.line);
        // only convex corners (an inside corner "squared off" would add area that is not roof)
        const turn = (p.b[0] - p.a[0]) * (q.b[1] - q.a[1]) - (p.b[1] - p.a[1]) * (q.b[0] - q.a[0]);
        const convex = Math.sign(turn) === ringSign;
        // convex: square it if short or hidden by canopy; concave (inside corner at the foot of a valley): the blur cut roof away, square it when short
        if (c && (convex ? (r.len < AT2.fpChamferFreeM || triangleIsOccluded(r.a, r.b, c)) : r.len < AT2.fpChamferInsideM)) { out[out.length - 1].b = c; out.push(q); q.a = c; k++; changed = true; continue; }
      }
      out.push(r);
    }
    runs = out; if (!changed) break;
  }
  if (runs.length < 3) return label;
  // rebuild polygon from consecutive run intersections
  const poly = [];
  for (let k = 0; k < runs.length; k++) { const a = runs[k], b = runs[(k + 1) % runs.length]; const c = intersect2(a.line, b.line); poly.push(c && Math.hypot(c[0] - a.b[0], c[1] - a.b[1]) < Math.max(3, AT2.fpChamferMaxM) ? c : a.b); }
  // outward buffer (Google's mask runs slightly inside the drip edge)
  if (AT2.eaveBufferM) {
    let s = 0; for (let k = 0; k < poly.length; k++) { const a = poly[k], b = poly[(k + 1) % poly.length]; s += a[0] * b[1] - b[0] * a[1]; }
    const sgn = s > 0 ? 1 : -1; const lines = runs.map((r) => ({ ...r.line, c: r.line.c }));
    for (let k = 0; k < runs.length; k++) { const r = runs[k]; const mid = [(poly[(k - 1 + poly.length) % poly.length][0] + poly[k][0]) / 2, (poly[(k - 1 + poly.length) % poly.length][1] + poly[k][1]) / 2]; void mid; }
    const off = []; for (let k = 0; k < runs.length; k++) { const a = poly[(k - 1 + poly.length) % poly.length], b = poly[k]; const d = [b[0] - a[0], b[1] - a[1]]; const L = Math.hypot(d[0], d[1]) || 1; const outward = sgn > 0 ? [d[1] / L, -d[0] / L] : [-d[1] / L, d[0] / L]; off.push(outward); }
    for (let k = 0; k < poly.length; k++) { const o1 = off[k], o2 = off[(k + 1) % poly.length]; poly[k] = [poly[k][0] + (o1[0] + o2[0]) * AT2.eaveBufferM * 0.5 / Math.max(0.5, (1 + o1[0] * o2[0] + o1[1] * o2[1]) / 2), poly[k][1] + (o1[1] + o2[1]) * AT2.eaveBufferM * 0.5 / Math.max(0.5, (1 + o1[0] * o2[0] + o1[1] * o2[1]) / 2)]; }
    void lines;
  }
  // rasterise the regularised footprint
  const xs = poly.map((p) => geo.X(p[0])), ys = poly.map((p) => geo.Y(p[1]));
  const inPoly = (px, py) => { let c = false; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) { const yi = ys[i], yj = ys[j]; if ((yi > py) !== (yj > py) && px < (xs[j] - xs[i]) * (py - yi) / (yj - yi) + xs[i]) c = !c; } return c; };
  const out = new Int32Array(label);
  const x0 = Math.max(0, Math.floor(Math.min(...xs)) - 1), x1 = Math.min(w - 1, Math.ceil(Math.max(...xs)) + 1), y0 = Math.max(0, Math.floor(Math.min(...ys)) - 1), y1 = Math.min(h - 1, Math.ceil(Math.max(...ys)) + 1);
  const add = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x; const inside = x >= x0 && x <= x1 && y >= y0 && y <= y1 && inPoly(x + 0.5, y + 0.5);
    if (!inside && out[i] >= 0) out[i] = -1;          // trimmed bump
    else if (inside && out[i] < 0) { out[i] = -3; add[i] = 1; } // restored roof, label below
  }
  // label restored pixels from the nearest labelled pixel (grow outward)
  for (let it = 0; it < 400; it++) {
    let changed = 0; const next = new Int32Array(out);
    for (let i = 0; i < w * h; i++) { if (out[i] !== -3) continue; const x = i % w, y = (i - x) / w; const nb = [x > 0 ? out[i - 1] : -1, x < w - 1 ? out[i + 1] : -1, y > 0 ? out[i - w] : -1, y < h - 1 ? out[i + w] : -1]; for (const l of nb) if (l >= 0) { next[i] = l; changed++; break; } }
    for (let i = 0; i < w * h; i++) if (next[i] !== out[i]) out[i] = next[i];
    if (!changed) break;
  }
  for (let i = 0; i < w * h; i++) if (out[i] === -3) out[i] = -1;
  return out;
}

// ------------------------------------------------------------------ 3. topology
function topology(label, w, h) {
  const W1 = w + 1;
  const L = (x, y) => (x < 0 || y < 0 || x >= w || y >= h ? -1 : label[y * w + x]);
  // crack edges: key by corner pair; store the label on each side
  const cornerEdges = new Map(); // corner -> array of {to, l, r}
  const addEdge = (c0, c1, lA, lB) => { if (!cornerEdges.has(c0)) cornerEdges.set(c0, []); if (!cornerEdges.has(c1)) cornerEdges.set(c1, []); const e = { a: c0, b: c1, lA, lB, used: false }; cornerEdges.get(c0).push(e); cornerEdges.get(c1).push(e); };
  for (let y = 0; y <= h; y++) for (let x = 0; x <= w; x++) {
    if (x < w) { const up = L(x, y - 1), dn = L(x, y); if (up !== dn) addEdge(y * W1 + x, y * W1 + x + 1, up, dn); }
    if (y < h) { const lf = L(x - 1, y), rt = L(x, y); if (lf !== rt) addEdge(y * W1 + x, (y + 1) * W1 + x, lf, rt); }
  }
  const pairKey = (e) => (e.lA < e.lB ? e.lA + ',' + e.lB : e.lB + ',' + e.lA);
  const isJunction = (c) => { const es = cornerEdges.get(c); if (!es) return false; if (es.length !== 2) return true; return pairKey(es[0]) !== pairKey(es[1]); };
  const junctions = new Map(); // corner -> junction id
  for (const c of cornerEdges.keys()) if (isJunction(c)) junctions.set(c, junctions.size);
  const chains = [];
  const walk = (start, e0) => {
    const pts = [start]; let c = start, e = e0; const pk = pairKey(e0);
    while (true) {
      e.used = true; const nxt = e.a === c ? e.b : e.a; pts.push(nxt); c = nxt;
      if (junctions.has(c)) break;
      const cand = cornerEdges.get(c).find((q) => !q.used && pairKey(q) === pk); if (!cand) break; e = cand;
    }
    return { corners: pts, pair: pk.split(',').map(Number), j0: junctions.get(start), j1: junctions.get(c) };
  };
  for (const [c] of junctions) for (const e of cornerEdges.get(c)) if (!e.used) chains.push(walk(c, e));
  // closed loops without junctions: cut them into two chains with two artificial junctions
  for (const [c, es] of cornerEdges) for (const e of es) {
    if (e.used) continue;
    const loop = walk(c, e); // returns to c
    const pts = loop.corners; const half = Math.floor(pts.length / 2);
    const jA = junctions.size; junctions.set(pts[0], jA); const jB = junctions.size; junctions.set(pts[half], jB);
    chains.push({ corners: pts.slice(0, half + 1), pair: loop.pair, j0: jA, j1: jB });
    chains.push({ corners: pts.slice(half), pair: loop.pair, j0: jB, j1: jA });
  }
  const jCorner = []; for (const [c, id] of junctions) jCorner[id] = c;
  return { chains, jCorner, W1 };
}

// ------------------------------------------------------------------ 4. geometry
var lineFromPts = (pts) => {
  // total least squares line through points: returns {n:[nx,ny], c} with n.p = c, plus direction d
  let mx = 0, my = 0; for (const p of pts) { mx += p[0]; my += p[1]; } mx /= pts.length; my /= pts.length;
  let sxx = 0, sxy = 0, syy = 0; for (const p of pts) { const dx = p[0] - mx, dy = p[1] - my; sxx += dx * dx; sxy += dx * dy; syy += dy * dy; }
  const th = 0.5 * Math.atan2(2 * sxy, sxx - syy); const d = [Math.cos(th), Math.sin(th)]; const n = [-d[1], d[0]];
  return { n, c: n[0] * mx + n[1] * my, d, m: [mx, my] };
};
var lineWithDir = (pts, d) => { const n = [-d[1], d[0]]; let c = 0; for (const p of pts) c += n[0] * p[0] + n[1] * p[1]; return { n, c: c / pts.length, d, m: pts[Math.floor(pts.length / 2)] }; };
var intersect2 = (L1, L2) => { const det = L1.n[0] * L2.n[1] - L1.n[1] * L2.n[0]; if (Math.abs(det) < 0.08) return null; return [(L1.c * L2.n[1] - L2.c * L1.n[1]) / det, (L1.n[0] * L2.c - L2.n[0] * L1.c) / det]; };
var dpM = (pts, eps) => { if (pts.length <= 2) return pts; const [ax, ay] = pts[0], [bx, by] = pts[pts.length - 1]; const L = Math.hypot(bx - ax, by - ay) || 1e-9; let md = -1, mi = -1; for (let i = 1; i < pts.length - 1; i++) { const d = Math.abs((bx - ax) * (ay - pts[i][1]) - (ax - pts[i][0]) * (by - ay)) / L; if (d > md) { md = d; mi = i; } } if (md > eps) { const l = dpM(pts.slice(0, mi + 1), eps), r = dpM(pts.slice(mi), eps); return l.slice(0, -1).concat(r); } return [pts[0], pts[pts.length - 1]]; };

function planeIntersectionLine(pA, pB) {
  // plan-view line where z_A = z_B :  (aA-aB) E + (bA-bB) N = cB - cA
  const ga = pA.a - pB.a, gb = pA.b - pB.b; const L = Math.hypot(ga, gb);
  if (L < 0.06) return null; // near-parallel planes: no reliable intersection
  return { n: [ga / L, gb / L], c: (pB.c - pA.c) / L, d: [-gb / L, ga / L] };
}

function reconstruct(label, regions, w, h, geo, dominantDeg) {
  const topo = topology(label, w, h);
  const cornerXY = (c) => { const x = c % topo.W1, y = (c - x) / topo.W1; return [geo.E(x), geo.N(y)]; };
  const planeOf = (id) => (id >= 0 && regions[id] ? regions[id].plane : null);
  const pitchOf = (pl) => Math.hypot(pl.a, pl.b);
  // ---- chain models
  const chains = topo.chains.map((ch, idx) => {
    const pts = ch.corners.map(cornerXY);
    const [p, q] = ch.pair; const A = planeOf(p), B = planeOf(q);
    const m = { idx, pair: ch.pair, j0: ch.j0, j1: ch.j1, pts, runs: null, line: null, kind: null };
    if (p >= 0 && q >= 0) {
      const ln = planeIntersectionLine(A, B);
      let ok = false;
      if (ln) { let dmax = 0, dsum = 0; for (const t of pts) { const d = Math.abs(ln.n[0] * t[0] + ln.n[1] * t[1] - ln.c); dsum += d; if (d > dmax) dmax = d; } ok = dsum / pts.length < 0.45 && dmax < 1.2; }
      if (ok) { m.kind = 'intersect'; m.line = ln; }
      else { m.kind = 'fitted'; const simp = dpM(pts, AT2.dpEpsM); m.runs = splitRuns(simp, pts, null, dominantDeg); }
    } else {
      m.kind = 'outline';
      const own = A || B; const simp = dpM(pts, AT2.dpEpsM);
      m.runs = splitRuns(simp, pts, own, dominantDeg);
    }
    return m;
  });
  // ---- junction placement: least squares over incident end lines, regularised to the raster position
  const jPos = topo.jCorner.map(cornerXY);
  const jLines = jPos.map(() => []);
  for (const ch of chains) {
    const startLine = ch.line || (ch.runs && ch.runs.length ? ch.runs[0].line : null);
    const endLine = ch.line || (ch.runs && ch.runs.length ? ch.runs[ch.runs.length - 1].line : null);
    if (startLine) jLines[ch.j0].push({ ...startLine, w: ch.kind === 'intersect' ? 2 : 1 });
    if (endLine) jLines[ch.j1].push({ ...endLine, w: ch.kind === 'intersect' ? 2 : 1 });
  }
  const jFinal = jPos.map((p0, j) => {
    const ls = jLines[j]; if (!ls.length) return p0;
    const lam = 0.04; let a11 = lam, a12 = 0, a22 = lam, b1 = lam * p0[0], b2 = lam * p0[1];
    for (const l of ls) { const wgt = l.w; a11 += wgt * l.n[0] * l.n[0]; a12 += wgt * l.n[0] * l.n[1]; a22 += wgt * l.n[1] * l.n[1]; b1 += wgt * l.n[0] * l.c; b2 += wgt * l.n[1] * l.c; }
    const det = a11 * a22 - a12 * a12; if (Math.abs(det) < 1e-9) return p0;
    const p = [(b1 * a22 - b2 * a12) / det, (a11 * b2 - a12 * b1) / det];
    if (Math.hypot(p[0] - p0[0], p[1] - p0[1]) > AT2.maxJunctionMoveM) {
      // project onto the strongest line instead of jumping far away
      const l = ls.sort((s, t) => t.w - s.w)[0]; const d = l.n[0] * p0[0] + l.n[1] * p0[1] - l.c; return [p0[0] - d * l.n[0], p0[1] - d * l.n[1]];
    }
    return p;
  });
  // ---- final chain geometry
  for (const ch of chains) {
    const a = jFinal[ch.j0], b = jFinal[ch.j1];
    if (ch.kind === 'intersect' || !ch.runs || ch.runs.length <= 1) { ch.geom = [a, b]; continue; }
    const g = [a];
    for (let i = 0; i < ch.runs.length - 1; i++) {
      const v = intersect2(ch.runs[i].line, ch.runs[i + 1].line); const orig = ch.runs[i].end;
      g.push(v && Math.hypot(v[0] - orig[0], v[1] - orig[1]) < 1.5 ? v : orig);
    }
    g.push(b); ch.geom = g;
  }
  return { chains, jFinal, topo };
}

// split a simplified polyline into straight runs; snap run directions to the plane's contour/slope (or the building axis)
function splitRuns(simp, raw, plane, dominantDeg) {
  const runs = [];
  let dirs = [];
  if (plane && Math.hypot(plane.a, plane.b) > 0.06) { const g = [plane.a, plane.b]; const L = Math.hypot(g[0], g[1]); dirs = [[g[0] / L, g[1] / L], [-g[1] / L, g[0] / L]]; }
  const th = (dominantDeg || 0) * Math.PI / 180;
  const axis = [[Math.cos(th), Math.sin(th)], [-Math.sin(th), Math.cos(th)], [Math.cos(th + Math.PI / 4), Math.sin(th + Math.PI / 4)], [Math.cos(th - Math.PI / 4), Math.sin(th - Math.PI / 4)]];
  // assign raw points to segments of the simplified polyline
  let k = 0;
  const snapFor = (du, L) => {
    // plane contour / slope directions and the two building axes are always candidates; diagonals only for long runs
    const cands = dirs.concat(axis.slice(0, 2), L >= AT2.diagMinM ? axis.slice(2) : []);
    let snap = null, bestCos = Math.cos(AT2.snapDeg * Math.PI / 180);
    for (const cand of cands) { const cs = Math.abs(du[0] * cand[0] + du[1] * cand[1]); if (cs > bestCos) { bestCos = cs; snap = cand; } }
    return snap;
  };
  for (let i = 1; i < simp.length; i++) {
    const a = simp[i - 1], b = simp[i]; const seg = [];
    while (k < raw.length) { seg.push(raw[k]); if (raw[k][0] === b[0] && raw[k][1] === b[1]) break; k++; }
    const d0 = [b[0] - a[0], b[1] - a[1]]; const L = Math.hypot(d0[0], d0[1]) || 1e-9; const du = [d0[0] / L, d0[1] / L];
    const snap = snapFor(du, L);
    const pts = seg.length ? seg : [a, b];
    const line = snap ? lineWithDir(pts, snap) : lineFromPts(pts.length > 1 ? pts : [a, b]);
    runs.push({ start: a, end: b, line, len: L, pts, snap });
  }
  const parallel = (p, q) => Math.abs(p.line.d[0] * q.line.d[1] - p.line.d[1] * q.line.d[0]) < 0.05;
  const join = (p, q, extra) => { const pts = p.pts.concat(extra ? extra.pts : [], q.pts); const line = p.snap ? lineWithDir(pts, p.snap) : lineFromPts(pts); return { start: p.start, end: q.end, line, len: p.len + q.len + (extra ? extra.len : 0), pts, snap: p.snap }; };
  let out = runs;
  for (let it = 0; it < 6; it++) {
    let changed = false; const next = [];
    for (let i = 0; i < out.length; i++) {
      const r = out[i], p = next[next.length - 1];
      // consecutive parallel runs whose offsets differ by less than a jog: one straight line
      if (p && parallel(p, r) && Math.abs(p.line.n[0] * r.line.m[0] + p.line.n[1] * r.line.m[1] - p.line.c) < AT2.jogM) { next[next.length - 1] = join(p, r); changed = true; continue; }
      // a short run squeezed between two parallel runs: remove the jog
      const q = out[i + 1];
      if (p && q && r.len < AT2.shortRunM && parallel(p, q) && Math.abs(p.line.n[0] * q.line.m[0] + p.line.n[1] * q.line.m[1] - p.line.c) < AT2.jogM * 1.6) { next[next.length - 1] = join(p, q, r); i++; changed = true; continue; }
      next.push(r);
    }
    out = next; if (!changed) break;
  }
  return out;
}

// ------------------------------------------------------------------ 5. classification
function classifyInternal(A, B, segA, segB) {
  // A, B planes; segA/segB: a point inside each region near the edge; returns edge type
  const pitchA = Math.hypot(A.a, A.b), pitchB = Math.hypot(B.a, B.b);
  const ln = planeIntersectionLine(A, B);
  const mid = [(segA[0] + segB[0]) / 2, (segA[1] + segB[1]) / 2];
  const zA = (p) => A.a * p[0] + A.b * p[1] + A.c, zB = (p) => B.a * p[0] + B.b * p[1] + B.c;
  const gap = Math.abs(zA(mid) - zB(mid));
  if (gap > 0.45 || !ln) return { type: gap > 0.45 ? 'step' : 'transition', gap, why: 'ci-noline' };
  if (pitchA < 0.08 || pitchB < 0.08) return { type: 'transition', gap, why: 'ci-flat' };
  // project the inside points onto the line to get "at the edge" heights
  const foot = (p) => { const d = ln.n[0] * p[0] + ln.n[1] * p[1] - ln.c; return [p[0] - d * ln.n[0], p[1] - d * ln.n[1]]; };
  const dA = zA(segA) - zA(foot(segA)), dB = zB(segB) - zB(foot(segB));
  // slope of the 3D line: rise per run along the edge direction
  const slope = Math.abs(A.a * ln.d[0] + A.b * ln.d[1]);
  if (dA < -0.02 && dB < -0.02) return { type: slope < 0.06 ? 'ridge' : 'hip', gap };
  if (dA > 0.02 && dB > 0.02) return { type: 'valley', gap };
  return { type: gap > AT2.bendGapM ? 'step' : 'transition', gap, why: 'ci-mixed' };
}


// ------------------------------------------------------------------ crease bands
// Google's DSM rounds every crease. A rounded ridge becomes a thin near-flat strip between the two roof planes, a
// blurred eave becomes a thin very steep strip along the outline, and dormer cheek walls become steep strips too.
// Left alone they turn into fake facets (1/12, 0/12, 20+/12) with "transition" lines on both sides and steal ridge and
// eave length. A region is a band if it is thin and its pitch is not one its neighbours could share; its pixels go to
// whichever neighbouring plane explains each pixel best (for a rounded ridge that is the plane on that pixel's side).
function absorbBands(dsm, label, regions, w, h, lp, geo) {
  const px = Math.sqrt(geo.pxM2);
  const slopeOf = (id) => Math.hypot(regions[id].plane.a, regions[id].plane.b);
  const changedIds = new Set();
  for (let pass = 0; pass < 4; pass++) {
    const area = new Map(), perim = new Map(), shared = new Map(), mom = new Map();
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = y * w + x, l = label[i]; if (l < 0) continue; area.set(l, (area.get(l) || 0) + 1);
      let mm = mom.get(l); if (!mm) mom.set(l, (mm = [0, 0, 0, 0, 0])); mm[0] += x; mm[1] += y; mm[2] += x * x; mm[3] += y * y; mm[4] += x * y;
      const nb = [x > 0 ? label[i - 1] : -1, x < w - 1 ? label[i + 1] : -1, y > 0 ? label[i - w] : -1, y < h - 1 ? label[i + w] : -1];
      for (const q of nb) if (q !== l) { perim.set(l, (perim.get(l) || 0) + 1); let m = shared.get(l); if (!m) shared.set(l, (m = new Map())); m.set(q, (m.get(q) || 0) + 1); }
    }
    // area-weighted typical slopes of the roof (main planes only)
    const big = [...area.entries()].filter(([, n]) => n * geo.pxM2 >= AT2.bandMaxM2);
    const bandIds = [], eaveBand = new Set();
    for (const [l, n] of area) {
      const aM2 = n * geo.pxM2; if (aM2 > AT2.bandMaxM2 * 2) continue;
      const t = 2 * n / Math.max(1, perim.get(l) || 1) * px; // thickness (m)
      const nbs = [...(shared.get(l) || new Map()).entries()].filter(([q]) => q >= 0 && q !== l);
      if (!nbs.length) continue;
      const s = slopeOf(l); const p12 = s * 12;
      const nbSlopes = nbs.map(([q]) => slopeOf(q));
      const shareable = nbSlopes.some((q) => Math.abs(q - s) * 12 <= AT2.bandPitchTol) || big.some(([q]) => q !== l && Math.abs(slopeOf(q) - s) * 12 <= AT2.bandPitchTol * 0.6);
      const outsideShare = ((shared.get(l) || new Map()).get(-1) || 0) / Math.max(1, perim.get(l) || 1);
      const steepWall = p12 > AT2.bandSteep;                       // walls and eave drop-offs, never shingles
      const flatOnPitched = p12 < 1.5 && nbSlopes.every((q) => q * 12 >= 3);
      // strip shape from second moments: width and length of the equivalent rectangle (m)
      const mm = mom.get(l); const mx = mm[0] / n, my = mm[1] / n; const cxx = mm[2] / n - mx * mx, cyy = mm[3] / n - my * my, cxy = mm[4] / n - mx * my;
      const tr = cxx + cyy, dt = Math.sqrt(Math.max(0, (cxx - cyy) ** 2 / 4 + cxy * cxy)); const l1 = tr / 2 + dt, l2 = Math.max(1e-9, tr / 2 - dt);
      const widthM = Math.sqrt(12 * l2) * px, lengthM = Math.sqrt(12 * l1) * px;
      const strip = widthM < AT2.bandThickM && lengthM / widthM > AT2.bandAspect;
      const thin = strip || (t < AT2.bandThickM * 0.5 && aM2 < 3);
      // island: small and almost fully enclosed by one roof plane (DSM warp, a chimney top, debris) -> part of that plane
      const shTot = perim.get(l) || 1; let island = false;
      if (aM2 < AT2.islandMaxM2) {
        // enclosure counted against the big neighbours only, so a cluster of small bumps inside one plane goes too
        const isSmall = (q) => (area.get(q) || 0) * geo.pxM2 < AT2.islandMaxM2;
        const bigShare = nbs.filter(([q]) => !isSmall(q)); const outC = (shared.get(l) || new Map()).get(-1) || 0;
        const tot = bigShare.reduce((a, [, c]) => a + c, 0) + outC;
        const P = regions[l].plane;
        for (const [q, c] of bigShare) { if (c / shTot >= 0.8) island = true; else if (tot && c / tot >= 0.8 && angleBetween(P.a, P.b, regions[q].plane.a, regions[q].plane.b) < 10) island = true; }
      }
      // blurred eave drop-off that is not quite wall-steep: a strip on the outline, much steeper than the roof plane
      // behind it and facing the same way (a real lower roof would face its own way or be wider than a strip)
      const Pl = regions[l].plane;
      const eaveDrop = outsideShare > 0.3 && p12 >= AT2.eaveDropMinPitch && widthM < AT2.eaveDropMaxWidthM && lengthM / widthM > AT2.bandAspect &&
        nbs.some(([q]) => { const Q = regions[q].plane, sq = slopeOf(q); return sq > 0.06 && (s - sq) * 12 >= AT2.eaveDropSteeperBy && (Pl.a * Q.a + Pl.b * Q.b) / (s * sq) > 0.9; });
      if ((steepWall && (thin || outsideShare > 0.3)) || (thin && (!shareable || flatOnPitched)) || island || eaveDrop) { bandIds.push(l); if ((eaveDrop || (steepWall && outsideShare > 0.25)) && !island) eaveBand.add(l); }
    }
    if (!bandIds.length) break;
    const bandSet = new Set(bandIds);
    for (const l of bandIds) {
      const cands = [...(shared.get(l) || new Map()).keys()].filter((q) => q >= 0 && !bandSet.has(q));
      if (!cands.length) continue;
      if (eaveBand.has(l)) {
        // The blurred drop-off along the outline fits no roof plane, so "which plane explains the height best" picks at
        // random (often the plane round the corner, which then owns a strip along this eave: a fake rake + step).
        // Each pixel joins the roof plane right behind it instead: grow inward from the band's roof-side boundary.
        const candSet = new Set(cands); let todo = []; for (let i = 0; i < label.length; i++) if (label[i] === l) todo.push(i);
        while (todo.length) {
          const set = [], rest = [];
          for (const i of todo) { const x = i % w; let q = -1;
            for (const j of [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, i - w, i + w]) if (j >= 0 && j < label.length && candSet.has(label[j])) { q = label[j]; break; }
            if (q >= 0) set.push([i, q]); else rest.push(i); }
          if (!set.length) break;
          for (const [i, q] of set) { label[i] = q; changedIds.add(q); }
          todo = rest;
        }
      }
      for (let i = 0; i < label.length; i++) {
        if (label[i] !== l) continue; const x = i % w, y = (i - x) / w; const z = dsm[i];
        let best = cands[0], bd = Infinity;
        for (const q of cands) { const pl = regions[q].plane; const d = z > -1000 ? Math.abs(z - (pl.a * lp.Ecol[x] + pl.b * lp.Nrow[y] + pl.c)) : 0; if (d < bd) { bd = d; best = q; } }
        label[i] = best; changedIds.add(best);
      }
    }
    // pixels of a band whose best neighbour is far away stay attached; clean single pixels with a majority pass
  }
  return { label, changedIds };
}

// ------------------------------------------------------------------ driver
function traceBuildingV2(resp, tif, mask, comp, geo, opts) {
  const { w, h } = tif;
  const member = comp.member;
  const lp = localPlanes(tif.data, member, w, h, geo);
  // DSM noise varies a lot between tiles: measure it (25th percentile of the local plane-fit residual is ~0.94 sigma)
  // and widen the fit tolerances on noisy tiles so they still trace instead of returning no facets
  const saved = { ...AT2 };
  { const R = []; for (let i = 0; i < w * h; i += 3) if (member[i] && lp.R[i] < 9) R.push(lp.R[i]); R.sort((p, q) => p - q);
    const sigma = R.length ? R[Math.floor(R.length * 0.25)] / 0.94 : 0.02;
    AT2.noiseSigma = sigma;
    AT2.seedResid = Math.max(saved.seedResid, 1.6 * sigma); AT2.goodResid = Math.max(saved.goodResid, 2.6 * sigma);
    AT2.growDist = Math.max(saved.growDist, 4.5 * sigma); AT2.growDistWeak = Math.max(saved.growDistWeak, 3 * sigma);
    AT2.mergeDist = Math.max(saved.mergeDist, 3 * sigma); AT2.growAngle = Math.max(saved.growAngle, 9 * Math.sqrt(sigma / 0.025)); }
  try { return traceBuildingV2Core(tif, member, w, h, geo, lp); } finally { Object.assign(AT2, saved); }
}

function traceBuildingV2Core(tif, member, w, h, geo, lp) {
  let { label, regions } = growRegions(tif.data, member, w, h, lp, geo);
  label = mergeRegions(tif.data, label, regions, w, h, lp, geo);
  label = fillHoles(tif.data, label, member, w, h, regions, lp);
  label = absorbSlivers(tif.data, label, regions, w, h, lp, geo);
  // drop large blobs no plane could explain (trees over the roof)
  for (let i = 0; i < w * h; i++) if (!member[i] || label[i] < 0) label[i] = -1;
  // refit every surviving region on its final pixels, robustly (two passes, drop >0.2 m outliers)
  const ids = [...new Set(label)].filter((l) => l >= 0);
  for (const id of ids) {
    for (let pass = 0; pass < 2; pass++) {
      const acc = new PlaneAcc(); const pl = regions[id].plane;
      for (let i = 0; i < w * h; i++) { if (label[i] !== id || !(tif.data[i] > -1000)) continue; const x = i % w, y = (i - x) / w; const e = lp.Ecol[x], n = lp.Nrow[y]; const r = Math.abs(tif.data[i] - (pl.a * e + pl.b * n + pl.c)); if (r > (pass ? 0.2 : AT2.refitGateM)) continue; acc.add(e, n, tif.data[i]); }
      const f = acc.solve(); if (f) regions[id].plane = f;
    }
    let n = 0; for (let i = 0; i < w * h; i++) if (label[i] === id) n++; regions[id].n = n;
  }
  // crease bands -> neighbouring planes, then refit the planes that grew
  { const r2 = absorbBands(tif.data, label, regions, w, h, lp, geo); label = r2.label;
    for (const id of r2.changedIds) { const acc = new PlaneAcc(); const pl = regions[id].plane;
      for (let i = 0; i < w * h; i++) { if (label[i] !== id || !(tif.data[i] > -1000)) continue; const x = i % w, y = (i - x) / w; const r = Math.abs(tif.data[i] - (pl.a * lp.Ecol[x] + pl.b * lp.Nrow[y] + pl.c)); if (r > 0.2) continue; acc.add(lp.Ecol[x], lp.Nrow[y], tif.data[i]); }
      const f = acc.solve(); if (f) regions[id].plane = f; }
    ids.length = 0; for (const l of new Set(label)) if (l >= 0) ids.push(l);
    for (const id of ids) { let n = 0; for (let i = 0; i < w * h; i++) if (label[i] === id) n++; regions[id].n = n; } }
  // dominant building axis
  const dominantDeg = (() => { const bins = new Float64Array(90); for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) { const i = y * w + x; if (label[i] < 0) continue; const outside = label[i - 1] < 0 || label[i + 1] < 0 || label[i - w] < 0 || label[i + w] < 0; if (!outside) continue; } let best = 0;
    // use plane gradient directions weighted by area: roof planes face the building axes
    for (const id of ids) { const p = regions[id].plane; if (Math.hypot(p.a, p.b) < 0.06) continue; let a = Math.atan2(p.b, p.a) * 180 / Math.PI; a = ((a % 90) + 90) % 90; bins[Math.floor(a)] += regions[id].n; }
    for (let i = 0; i < 90; i++) if (bins[i] + bins[(i + 1) % 90] + bins[(i + 89) % 90] > bins[best] + bins[(best + 1) % 90] + bins[(best + 89) % 90]) best = i;
    // refine: area- and fit-weighted circular mean (period 90 deg) of the plane directions near the peak
    let sc = 0, ss = 0; const mode = best + 0.5;
    for (const id of ids) { const p = regions[id].plane; if (Math.hypot(p.a, p.b) < 0.06) continue; const a = Math.atan2(p.b, p.a) * 180 / Math.PI; let dd = ((a - mode) % 90 + 135) % 90 - 45; if (Math.abs(dd) > 6) continue; const wgt = regions[id].n / (1 + (p.rms || 0) / 0.03); sc += wgt * Math.cos(4 * a * Math.PI / 180); ss += wgt * Math.sin(4 * a * Math.PI / 180); }
    if (!sc && !ss) return mode; let m = Math.atan2(ss, sc) * 180 / Math.PI / 4; m = ((m % 90) + 90) % 90; return m; })();
  // regularise the footprint (rectilinear walls, restored occluded corners); planes keep their pre-regularisation fits
  if (AT2.regularizeFootprint) {
    const vals = []; for (let i = 0; i < w * h; i += 7) if (!member[i] && tif.data[i] > -1000) vals.push(tif.data[i]);
    vals.sort((p, q) => p - q); const ground = vals.length ? vals[Math.floor(vals.length * 0.05)] : -1e9;
    try { label = regularizeFootprint(tif.data, label, w, h, geo, dominantDeg, ground); } catch (e) { console.warn('footprint regularisation failed', e); }
  }
  // region centroids (for "which side of the edge is this plane on")
  const cent = new Map();
  { const acc = new Map(); for (let i = 0; i < w * h; i++) { const l = label[i]; if (l < 0) continue; const x = i % w, y = (i - x) / w; const a = acc.get(l) || [0, 0, 0]; a[0] += lp.Ecol[x]; a[1] += lp.Nrow[y]; a[2]++; acc.set(l, a); } for (const [l, a] of acc) cent.set(l, [a[0] / a[2], a[1] / a[2]]); }
  const rec = reconstruct(label, regions, w, h, geo, dominantDeg);
  // ---- assemble facets: walk each region's chains into loops
  const facets = [], edges = [];
  const toLL = (p) => { const lat = geo.ref.lat + p[1] / geo.ref.ky, lng = geo.ref.lng + p[0] / geo.ref.kx; return { lat, lng }; };
  const byRegion = new Map();
  for (const ch of rec.chains) for (const l of ch.pair) if (l >= 0) { if (!byRegion.has(l)) byRegion.set(l, []); byRegion.get(l).push(ch); }
  for (const id of ids) {
    const list = byRegion.get(id) || []; if (!list.length) continue;
    // build loops by junction connectivity
    const unused = new Set(list); const loops = [];
    while (unused.size) {
      const first = unused.values().next().value; unused.delete(first);
      const loop = [{ ch: first, fwd: true }]; let end = first.j1; const start = first.j0; let guard = 0;
      while (end !== start && guard++ < 500) {
        let nxt = null, fwd = true;
        for (const c of unused) { if (c.j0 === end) { nxt = c; fwd = true; break; } if (c.j1 === end) { nxt = c; fwd = false; break; } }
        if (!nxt) break; unused.delete(nxt); loop.push({ ch: nxt, fwd }); end = fwd ? nxt.j1 : nxt.j0;
      }
      const pts = []; for (const { ch, fwd } of loop) { const g = fwd ? ch.geom : ch.geom.slice().reverse(); for (let i = 0; i < g.length - 1; i++) pts.push(g[i]); }
      let s = 0; for (let i = 0; i < pts.length; i++) { const a = pts[i], b = pts[(i + 1) % pts.length]; s += a[0] * b[1] - b[0] * a[1]; }
      if (pts.length >= 3) loops.push({ pts, area: s / 2 });
    }
    if (!loops.length) continue;
    loops.sort((p, q) => Math.abs(q.area) - Math.abs(p.area));
    let outer = loops[0].pts.slice();
    // holes: keyhole-join each inner loop to the outer ring so the facet stays one simple polygon with the hole removed
    for (const hole of loops.slice(1)) {
      if (Math.abs(hole.area) < 0.3) continue;
      let hp = hole.pts.slice(); if (Math.sign(hole.area) === Math.sign(loops[0].area)) hp.reverse();
      let bi = 0, bj = 0, bd = Infinity; for (let i = 0; i < outer.length; i++) for (let j = 0; j < hp.length; j++) { const d = Math.hypot(outer[i][0] - hp[j][0], outer[i][1] - hp[j][1]); if (d < bd) { bd = d; bi = i; bj = j; } }
      const ring = hp.slice(bj).concat(hp.slice(0, bj + 1));
      outer = outer.slice(0, bi + 1).concat(ring, [outer[bi]], outer.slice(bi + 1));
    }
    const pl = regions[id].plane; const slope = Math.hypot(pl.a, pl.b);
    const pitch = Math.round(slope * 12);
    const az = slope > 0.03 ? ((Math.atan2(-pl.a, -pl.b) * 180 / Math.PI) + 360) % 360 : null;
    facets.push({ id, path: outer.map(toLL), pitch, azimuth: az, slope, areaM2: regions[id].n * geo.pxM2 });
  }
  // ---- pitch snapping: a house is framed with a few design pitches. Large facets fix them; small facets, whose fitted
  // slope is noisy (Google's DSM rounds every crease), take the nearest design pitch when it is close enough.
  { const big = facets.filter((f) => f.areaM2 >= AT2.pitchAnchorM2 && f.slope > 0.06).sort((a, b) => b.areaM2 - a.areaM2);
    const centers = [];
    for (const f of big) { const p = f.slope * 12; const c = centers.find((c) => Math.abs(c.sum / c.w - p) <= 0.8); if (c) { c.sum += p * f.areaM2; c.w += f.areaM2; } else centers.push({ sum: p * f.areaM2, w: f.areaM2 }); }
    const design = centers.map((c) => Math.round(c.sum / c.w));
    for (const f of facets) {
      if (f.slope <= 0.06 || !design.length) continue;
      const p = f.slope * 12; const tol = f.areaM2 >= AT2.pitchAnchorM2 ? 0.8 : f.areaM2 >= 5 ? 1.3 : 2.0;
      let best = null, bd = tol; for (const c of design) { const d = Math.abs(c - p); if (d <= bd) { bd = d; best = c; } }
      if (best != null) f.pitch = best;
    } }
  // ---- edges
  const regionCentre = new Map(); for (const id of ids) { const s = regions[id].acc ? regions[id].acc.s : null; }
    function classifySpan(ch, A, B, p, q, g, rawPts) {
      // sample a point 0.6 m into each region from the chain midpoint
      const a = g[0], b = g[g.length - 1]; const mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
      const d = [b[0] - a[0], b[1] - a[1]]; const L = Math.hypot(d[0], d[1]) || 1e-9; const nrm = [-d[1] / L, d[0] / L];
      const side = (pt) => { const x = Math.floor(geo.X(pt[0])), y = Math.floor(geo.Y(pt[1])); return x >= 0 && y >= 0 && x < w && y < h ? label[y * w + x] : -9; };
      // which side of the edge each plane lies on: from the region centroids (robust for thin or bent regions)
      const sgnOf = (c, dflt) => { if (!c) return dflt; const s = (c[0] - mid[0]) * nrm[0] + (c[1] - mid[1]) * nrm[1]; return Math.abs(s) < 1e-6 ? dflt : Math.sign(s); };
      // vote with label probes on both sides of the raw boundary (centroids fail for bent or L-shaped facets)
      let vote = 0; { const P = rawPts; const step = Math.max(1, Math.floor(P.length / 10)); for (let i = 0; i < P.length; i += step) for (const off of [0.35, 0.7]) { const l1 = side([P[i][0] + nrm[0] * off, P[i][1] + nrm[1] * off]), l2 = side([P[i][0] - nrm[0] * off, P[i][1] - nrm[1] * off]); if (l1 === p) vote++; if (l2 === p) vote--; if (l1 === q) vote--; if (l2 === q) vote++; } }
      let sA = vote > 0 ? 1 : vote < 0 ? -1 : sgnOf(cent.get(p), side([mid[0] + nrm[0] * 0.6, mid[1] + nrm[1] * 0.6]) === p ? 1 : -1); const sB = -sA;
      const pa = [mid[0] + nrm[0] * 0.8 * sA, mid[1] + nrm[1] * 0.8 * sA], pb = [mid[0] + nrm[0] * 0.8 * sB, mid[1] + nrm[1] * 0.8 * sB];
      let type, why = null;
      if (ch.kind === 'intersect') {
        // the planes meet on this line: convex (ridge/hip) or concave (valley) from how each plane slopes away from it
        const rA = (A.a * nrm[0] + A.b * nrm[1]) * sA, rB = (B.a * nrm[0] + B.b * nrm[1]) * sB;
        const along = Math.abs(A.a * ch.line.d[0] + A.b * ch.line.d[1]);
        if (Math.hypot(A.a, A.b) < 0.08 || Math.hypot(B.a, B.b) < 0.08) { type = 'transition'; why = 'ix-flat'; }
        else if (rA < -0.03 && rB < -0.03) type = along < 0.07 ? 'ridge' : 'hip';
        else if (rA > 0.03 && rB > 0.03) type = 'valley';
        else { const gz = Math.abs((A.a - B.a) * mid[0] + (A.b - B.b) * mid[1] + (A.c - B.c)); type = gz > AT2.bendGapM ? 'step' : 'transition'; why = 'ix-mixed'; }
      } else { const c = classifyInternal(A, B, pa, pb); type = c.type; why = c.why; }
      if (type === 'step') {
        // a height break: the upper roof's edge (eave over the lower roof, or a rake) and the lower roof meeting the wall
        // below it are both real lines; Roofr counts both, so emit both on the same plan line
        const zA = (pt) => A.a * pt[0] + A.b * pt[1] + A.c, zB = (pt) => B.a * pt[0] + B.b * pt[1] + B.c;
        const aUpper = zA(mid) > zB(mid);
        const U = aUpper ? A : B, Lo = aUpper ? B : A, pU = aUpper ? pa : pb, pL = aUpper ? pb : pa;
        const zU = aUpper ? zA : zB, zL = aUpper ? zB : zA;
        const dirAlong = (pl) => { const gl = Math.hypot(pl.a, pl.b); return gl > 0.06 ? Math.abs((d[0] / L) * pl.a / gl + (d[1] / L) * pl.b / gl) : 0; };
        const uAlong = dirAlong(U), lAlong = dirAlong(Lo);
        let uType = null;
        if (Math.hypot(U.a, U.b) <= 0.06) uType = 'eave';
        else uType = uAlong >= 0.5 ? 'rake' : 'eave';
        let lType = null;
        if (Math.hypot(Lo.a, Lo.b) <= 0.06) lType = 'wall';
        else lType = lAlong >= 0.5 ? 'step' : 'wall';          // level line on the lower roof: headwall / apron flashing
        if (uType) edges.push({ type: uType, path: g.map(toLL) });
        if (lType) edges.push({ type: lType, path: g.map(toLL) });
        return;
      }
      edges.push({ type, path: g.map(toLL), why });
    }
  for (const ch of rec.chains) {
    const [p, q] = ch.pair; const A = planeOf(p), B = planeOf(q);
    if (p >= 0 && q >= 0) {
      // A fitted chain can change character along its length (valley -> exposed gable end -> valley where a cross gable
      // meets the main roof): classify each straight run on its own. Plane-intersection chains are one straight line.
      const G = ch.geom;
      if (ch.kind === 'intersect' || G.length <= 2) classifySpan(ch, A, B, p, q, G, ch.pts || []);
      else for (let i = 1; i < G.length; i++) {
        const a = G[i - 1], b = G[i]; const dd = [b[0] - a[0], b[1] - a[1]]; const LL = Math.hypot(dd[0], dd[1]); if (LL < 0.05) continue;
        const raw = (ch.pts || []).filter((t) => { const u = ((t[0] - a[0]) * dd[0] + (t[1] - a[1]) * dd[1]) / (LL * LL); return u >= -0.05 && u <= 1.05 && Math.abs((t[0] - a[0]) * dd[1] - (t[1] - a[1]) * dd[0]) / LL < 1.0; });
        classifySpan(ch, A, B, p, q, [a, b], raw.length >= 2 ? raw : [a, b]);
      }
    } else {
      const own = A || B; const slope = own ? Math.hypot(own.a, own.b) : 0;
      // one edge per straight run so a gable corner splits into eave + rake
      const g = ch.geom;
      for (let i = 1; i < g.length; i++) {
        const a = g[i - 1], b = g[i]; const d = [b[0] - a[0], b[1] - a[1]]; const L = Math.hypot(d[0], d[1]); if (L < 0.05) continue;
        let type = 'eave';
        if (slope > 0.06) { const along = Math.abs((d[0] * own.a + d[1] * own.b) / (L * slope)); type = along >= 0.5 ? 'rake' : 'eave'; }
        edges.push({ type, path: [toLL(a), toLL(b)] });
      }
    }
  }
  function planeOf(id) { return id >= 0 && regions[id] ? regions[id].plane : null; }
  // merge consecutive collinear outline edges of the same type for a cleaner line list
  return { facets, edges, planes: facets.length, unassignedPct: 0, datum: 0, dominantDeg, v2: true };
}
