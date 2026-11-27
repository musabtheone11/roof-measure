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
  outlineMergeDeg: 20,
  junctionMerge: false,  // refit runs that meet at a junction onto one line (off: it squared a genuine short chamfer, D15)
  cornerZoneM: 0.6,
  straightenOutline: true, // final pass: outline runs joined only by shallow turns become one straight line (see reconstruct)
  straightenTolM: 0.35,  // ... when every vertex between the two real corners lies within this of that line (3.5 source pixels)     // blur rounds a corner over this distance: looser support there when merging outline runs  // outline runs meeting at a shallower turn than this share one line when their pixels support it
  runFitToleranceM: 0.20, // two 10 cm DSM pixels; direction constraints must fit every supporting point
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
  fpChamferMaxM: 0,    // disabled: canopy/shortness alone cannot prove that a diagonal corner is missing roof
  fpChamferInsideM: 2.4, // inside-corner chamfers shorter than this are squared too
  fpChamferFreeM: 2.2, // ... always when shorter than this, otherwise only if the corner is occluded (tree canopy)
  eaveBufferM: 0,      // outward offset of the footprint (benchmarked: 0.15 m made well-traced houses 4-5% too big)
  fpSquareJog: false,  // disabled: a slanted join may be a real asymmetric addition
  fpSquareJogMaxM: 5,  // ... when the slanted stretch is shorter than this (longer ones can be real angled walls)
  hipCornerEave: true,  // short sloped outline pieces at the low end of a hip are part of the eave round the corner
  edgeHalfHeight: false, // move each outline wall to the half-way point of the height drop. Benchmarked: synthetic 93.0% -> 93.7% within 3%, but real houses got worse (median area error 6.0% -> 8.4%), so it stays off
  regularizeFootprint: true,
  bendGapM: 0.15,      // a pitch break is continuous: one plane rising and one falling across a line with a bigger gap is a step
  pitchAnchorM2: 15,   // facets at least this big define the house's design pitches
  bandThickM: 0.9,     // crease bands thinner than this (2*area/perimeter, m) are candidates
  bandMaxM2: 14,       // ... and smaller than 2x this
  bandPitchTol: 1.6,   // a band whose pitch is within this (x/12) of a neighbour could be a real narrow facet: keep
  bandSteep: 20,       // steeper than 20/12: wall or eave drop-off, never a roof plane
  islandMaxM2: 8,      // enclosed regions smaller than this join the plane around them
  bandAspect: 3.5,     // ... and a band is a strip: length / width above this (hip-end triangles are compact)
  bumpMaxM2: 16,       // a small region raised by an object on the roof (vent stack, AC unit, debris, a DSM spike) ...
  bumpInlier: 0.5,     // ... is absorbed when a neighbouring plane explains at least this share of its pixels within bumpDist
  bumpDist: 0.15,      // (m) and its own plane disagrees with that neighbour (pitch or a poor fit): see absorbBumps()
  bumpPitchTol: 1.2,   // (x/12) a small region within this pitch of the neighbour and fitting well is a real facet: keep
  bumpRms: 0.045,      // (m) own-fit RMS above this counts as a poor fit
  bumpObjectRms: 0.08, // (m) a region this lumpy is not a roof plane: an object on the roof ...
  bumpObjectMaxM: 1.5, // ... when it stands on or above a bigger neighbour plane everywhere, less than this high on average
  bumpObjectRatio: 2.5, // ... and that neighbour is at least this many times its size (a porch roof beside a similar plane is kept)
  bumpObjectAng: 30,   // (deg) ... and its own plane turns no more than this from the neighbour's ...
  bumpObjectMed: 0.075, // (m) ... and its median own-fit residual is at least this: not flat inside (a blurred real facet is)
  bumpObjectLowM: 0.8, // (m) ... or it stands less than this above it (a small real facet turns away and rises higher)
  debugBumps: false,
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
function fillHoles(dsm, label, member, w, h, regions, lp) {
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
// Fit building outline runs only when the raw boundary supports them, then re-rasterise the footprint.
// A building axis is a candidate constraint, not evidence that a diagonal is an error.
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
    const candidate = cls >= 0 && lineWithDir(pts, ax[cls]);
    if (candidate && !runSupported(pts, candidate)) cls = -1;
    const line = cls >= 0 ? candidate : lineFromPts(pts);
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
      if (out.length && r.cls >= 0 && p.cls === r.cls && Math.abs(offset(p, r.line.m)) < AT2.fpJogM && runSupported(p.pts.concat(r.pts), joinR(p, r).line)) { out[out.length - 1] = joinR(p, r); changed = true; continue; }
      // short run between two parallel runs: a jog
      if (out.length && k + 1 < runs.length && r.len < AT2.fpShortM && p.cls >= 0 && p.cls === q.cls && Math.abs(offset(p, q.line.m)) < AT2.fpJogM * 1.8 && runSupported(p.pts.concat(r.pts, q.pts), joinR(p, q, r).line)) { out[out.length - 1] = joinR(p, q, r); k++; changed = true; continue; }
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
  // skewed jog: one or more short non-axis runs joining two parallel, offset wall lines. Walls step at right angles; a
  // slanted join is the building mask cutting the inside corner (a tree or its shadow beside it, or plain blur). Make it
  // one square step through the middle of the slanted stretch, which keeps the area the same.
  if (AT2.fpSquareJog) for (let pass = 0; pass < 12; pass++) {
    const n = runs.length; let hit = false; if (n < 4) break;
    for (let k = 0; k < n && !hit; k++) {
      const p = runs[(k - 1 + n) % n]; if (runs[k].cls >= 0 || p.cls < 0) continue;                 // k starts a non-axis stretch
      let m = 1; while (m < n - 2 && runs[(k + m) % n].cls < 0) m++;
      const q = runs[(k + m) % n]; if (q === p || q.cls !== p.cls) continue;
      let len = 0; const pts = []; for (let j = 0; j < m; j++) { const r = runs[(k + j) % n]; len += r.len; for (const t of r.pts) pts.push(t); }
      if (len >= AT2.fpSquareJogMaxM || Math.abs(offset(p, q.line.m)) < AT2.fpJogM) continue;
      const step = refit({ cls: 1 - p.cls, pts, len, a: runs[k].a, b: runs[(k + m - 1) % n].b });
      const out = []; for (let j = 0; j < n - m; j++) out.push(runs[(k + m + j) % n]); out.push(step); runs = out; hit = true;
    }
    if (!hit) break;
  }
  if (runs.length < 3) return label;
  // Put each wall line where the height model says the roof ends. Google's building mask, which the outline starts from,
  // runs up to a foot outside the shingle edge. The height model is blurred across every eave and rake, and the middle of
  // that blur (half-way down the drop from the roof to the ground beyond it) is where the edge is. Each straight run is
  // moved to the median half-way point measured along it, when the drop is clear and the measurements agree; a run with
  // a tree, a lower roof or another building beside it has no clear drop and is left where it was.
  if (AT2.edgeHalfHeight) {
    const px = (E, N) => { const x = Math.floor(geo.X(E)), y = Math.floor(geo.Y(N)); return x >= 0 && y >= 0 && x < w && y < h ? y * w + x : -1; };
    const med = (v) => { const q = v.slice().sort((p, q2) => p - q2); return q[q.length >> 1]; };
    for (const r of runs) {
      const L = Math.hypot(r.b[0] - r.a[0], r.b[1] - r.a[1]); if (!(L >= 2.4)) continue;
      const u = [(r.b[0] - r.a[0]) / L, (r.b[1] - r.a[1]) / L], n = r.line.n; const offs = []; let tried = 0, outVotes = 0;
      const foot = (p) => { const d = n[0] * p[0] + n[1] * p[1] - r.line.c; return [p[0] - n[0] * d, p[1] - n[1] * d]; };
      for (let sgn = 0, k = 0; k < 2; k++) {                                   // pass 0: which side is outside; pass 1: measure
        for (let sd = 0.7; sd <= L - 0.7; sd += 0.3) { const p = foot([r.a[0] + u[0] * sd, r.a[1] + u[1] * sd]);
          if (k === 0) { const a = px(p[0] + n[0] * 0.5, p[1] + n[1] * 0.5), b = px(p[0] - n[0] * 0.5, p[1] - n[1] * 0.5); if (a >= 0 && b >= 0 && M[a] !== M[b]) outVotes += M[a] ? -1 : 1; continue; }
          tried++; const z = []; for (let t = -1.6; t <= 1.2001; t += 0.1) { const i = px(p[0] + n[0] * sgn * t, p[1] + n[1] * sgn * t); z.push(i >= 0 && dsm[i] > -1000 ? dsm[i] : NaN); }
          if (z.some((v) => !(v === v))) continue;
          // the roof surface, as a line fitted well inside the edge (it slopes on an eave), carried out to each position
          let st = 0, sz = 0, stt = 0, stz = 0; for (let i = 0; i < 9; i++) { const t = -1.6 + i * 0.1; st += t; sz += z[i]; stt += t * t; stz += t * z[i]; } const sl = (9 * stz - st * sz) / (9 * stt - st * st), ic = (sz - sl * st) / 9;
          const zout = med(z.slice(23)); if (!(ic - zout >= 1.2) || Math.abs(sl) > 1.6) continue; const gap = (i) => z[i] - (ic + sl * (-1.6 + i * 0.1) + zout) / 2;
          for (let i = 8; i < z.length; i++) if (gap(i) < 0) { if (i > 8 && gap(i - 1) >= 0) offs.push(-1.6 + (i - 1) * 0.1 + gap(i - 1) / (gap(i - 1) - gap(i)) * 0.1); break; } }
        if (k === 0) { if (!outVotes) break; sgn = outVotes > 0 ? 1 : -1; }
        else if (offs.length >= Math.max(4, 0.5 * tried)) { const m0 = med(offs), mad = med(offs.map((v) => Math.abs(v - m0)));
          if (mad <= 0.25) { const d = Math.max(-0.9, Math.min(0.5, m0)) * sgn; r.line = { ...r.line, c: r.line.c + d }; r.a = [r.a[0] + n[0] * d, r.a[1] + n[1] * d]; r.b = [r.b[0] + n[0] * d, r.b[1] + n[1] * d]; } } }
    }
  }
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

function reconstruct(label, regions, w, h, geo, dominantDeg, obstTest) {
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
      const own = A || B; m.own = own; const simp = dpM(pts, AT2.dpEpsM);
      m.runs = splitRuns(simp, pts, own, dominantDeg);
    }
    return m;
  });
  // ---- one straight outline across a junction: two outline runs that meet at a shallow turn (a hip or valley foot on
  // one straight eave, two facets sharing one rake) are fitted separately from their own pixels, so their directions or
  // offsets differ slightly and the outline kinks where they meet. When every pixel of both runs supports one shared
  // line (the same tolerance as any run: two 10 cm source pixels), both take that line. A real corner (porch return,
  // bay) turns more than AT2.outlineMergeDeg or does not fit one line, and keeps its own runs.
  if (AT2.outlineMergeDeg > 0 && AT2.junctionMerge) {
    const ends = new Map(); const at = (j, ch, run) => { if (!ends.has(j)) ends.set(j, []); ends.get(j).push({ ch, run }); };
    for (const ch of chains) if (ch.kind === 'outline' && ch.runs && ch.runs.length) { at(ch.j0, ch, ch.runs[0]); at(ch.j1, ch, ch.runs[ch.runs.length - 1]); }
    const cosMax = Math.cos(AT2.outlineMergeDeg * Math.PI / 180);
    // union-find over runs linked through shallow junctions (several tiny chains can line up along one eave near a corner)
    const parent = new Map(); const find = (r) => { while (parent.get(r) !== r) { parent.set(r, parent.get(parent.get(r))); r = parent.get(r); } return r; };
    const add = (r) => { if (!parent.has(r)) parent.set(r, r); };
    for (const list of ends.values()) {
      if (list.length !== 2 || list[0].ch === list[1].ch) continue;
      const [A, B] = list; if (Math.abs(A.run.line.d[0] * B.run.line.d[0] + A.run.line.d[1] * B.run.line.d[1]) < cosMax) continue;
      add(A.run); add(B.run); parent.set(find(A.run), find(B.run));
    }
    const groups = new Map(); for (const r of parent.keys()) { const g = find(r); if (!groups.has(g)) groups.set(g, []); groups.get(g).push(r); }
    for (const runs of groups.values()) {
      if (runs.length < 2) continue;
      const long = runs.reduce((a, b) => (b.len > a.len ? b : a)); const pts = runs.flatMap((r) => r.pts); if (pts.length < 4) continue;
      // the longest run's snapped direction wins only when every run of the group is (nearly) along it
      const line = long.snap ? lineWithDir(pts, long.snap) : lineFromPts(pts);
      // every run of the group must run along the shared line (a blurred chamfer's pieces turn ~22 deg each and stay out)
      if (runs.some((r) => Math.abs(r.line.d[0] * line.d[0] + r.line.d[1] * line.d[1]) < Math.cos(AT2.outlineMergeDeg / 2 * Math.PI / 180))) continue;
      // blur rounds a building corner over a few pixels: within AT2.cornerZoneM of the group's two extreme ends a pixel
      // may sit up to two run tolerances off the line; everywhere else the ordinary run tolerance applies
      const ux = line.d, tt = pts.map((q) => q[0] * ux[0] + q[1] * ux[1]), t0 = Math.min(...tt), t1 = Math.max(...tt);
      const core = pts.filter((q, k) => tt[k] - t0 > AT2.cornerZoneM && t1 - tt[k] > AT2.cornerZoneM);
      const off = (q) => Math.abs(line.n[0] * q[0] + line.n[1] * q[1] - line.c);
      const ok = core.length >= 4 && runSupported(core, line) && pts.every((q) => off(q) <= 2 * AT2.runFitToleranceM);
      if (!ok) continue;
      for (const r of runs) { r.line = line; r.merged = true; }
    }
  }
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
  const buildGeoms = () => {
    for (const ch of chains) {
      const a = jFinal[ch.j0], b = jFinal[ch.j1];
      if (ch.rawGeom) { const mid = dpM(ch.pts, 0.3).slice(1, -1); ch.geom = [a, ...mid, b]; continue; }   // audited fallback: the raster outline itself
      if (ch.kind === 'intersect' || !ch.runs || ch.runs.length <= 1) { ch.geom = [a, b]; continue; }
      const g = [a];
      for (let i = 0; i < ch.runs.length - 1; i++) {
        const v = intersect2(ch.runs[i].line, ch.runs[i + 1].line); const orig = ch.runs[i].end;
        g.push(v && Math.hypot(v[0] - orig[0], v[1] - orig[1]) < 1.5 ? v : orig);
      }
      g.push(b); ch.geom = g;
    }
    if (obstTest) for (const ch of chains) if (ch.kind === 'outline') markObstruction(ch);
    if (AT2.straightenOutline) straightenOutline();
  };
  // Straight outline runs (the roof outline and height breaks: an upper eave over a lower roof). Where pieces meet only at shallow turns (AT2.outlineMergeDeg) between two real corners,
  // and every vertex between those corners lies within AT2.straightenTolM of the straight line joining them, the run is
  // one straight eave or rake that pixel noise, blur-rounded corners or a junction with an interior line bent: its vertices
  // move onto that line (shared junctions move for every facet and line that uses them). A sharper turn (a porch return,
  // any real corner) ends a run and is never moved.
  const turnDeg = (p, q, r) => { const u = [q[0] - p[0], q[1] - p[1]], v = [r[0] - q[0], r[1] - q[1]]; const l = Math.hypot(...u) * Math.hypot(...v); if (l < 1e-12) return 0; return Math.acos(Math.max(-1, Math.min(1, (u[0] * v[0] + u[1] * v[1]) / l))) * 180 / Math.PI; };
  function straightenOutline() {
    const inc = new Map(); for (const ch of chains) if ((ch.kind === 'outline' || ch.kind === 'fitted') && ch.geom && !ch.obstruction) for (const j of [ch.j0, ch.j1]) { if (!inc.has(j)) inc.set(j, []); inc.get(j).push(ch); }
    const along = (ch, j) => (ch.j0 === j ? ch.geom : ch.geom.slice().reverse());          // geometry leaving junction j
    // the two chains at junction j that continue each other most nearly straight (a T from a height break or a third
    // chain does not stop a straight eave); null when no pair turns by AT2.outlineMergeDeg or less
    const pairAt = (j) => { const cs = inc.get(j); if (!cs || cs.length < 2) return null; let best = null;
      for (let a = 0; a < cs.length; a++) for (let b = a + 1; b < cs.length; b++) { if (cs[a] === cs[b]) continue; const g0 = along(cs[a], j), g1 = along(cs[b], j); const t = turnDeg(g0[1], g0[0], g1[1]); if (t <= AT2.outlineMergeDeg && (!best || t < best.t)) best = { t, a: cs[a], b: cs[b] }; }
      return best; };
    const shallowJ = (j) => !!pairAt(j);
    const sharpInside = (g) => g.slice(1, -1).some((q, k) => turnDeg(g[k], q, g[k + 2]) > AT2.outlineMergeDeg);
    const seen = new Set(); let moved = 0;
    for (const [j0] of inc) {
      if (seen.has(j0) || !shallowJ(j0)) continue;
      // walk both ways from a shallow junction to the first real corner
      const walk = (j, from) => { const pts = [], js = []; let cur = j, ch = from; for (let guard = 0; guard < 200; guard++) { const g = along(ch, cur); if (sharpInside(g)) { const k = g.slice(1, -1).findIndex((q, i) => turnDeg(g[i], q, g[i + 2]) > AT2.outlineMergeDeg); pts.push(...g.slice(1, k + 1)); return { end: g[k + 1], pts, js }; } pts.push(...g.slice(1, -1)); const nj = ch.j0 === cur ? ch.j1 : ch.j0; if (!shallowJ(nj) || seen.has(nj)) return { end: g[g.length - 1], pts, js }; js.push(nj); const pr = pairAt(nj); const nx = pr && (pr.a === ch ? pr.b : pr.b === ch ? pr.a : null); if (!nx) return { end: g[g.length - 1], pts, js }; cur = nj; ch = nx; } return null; };
      const pr0 = pairAt(j0), c0 = pr0.a, c1 = pr0.b; const L = walk(j0, c0), R = walk(j0, c1); seen.add(j0); if (!L || !R) continue;
      for (const j of [...L.js, ...R.js]) seen.add(j);
      const P = L.end, Q = R.end, dx = Q[0] - P[0], dy = Q[1] - P[1], len = Math.hypot(dx, dy); if (len < 0.5) continue;
      const juncs = [j0, ...L.js, ...R.js].map((j) => jFinal[j]), all = [...juncs, ...L.pts, ...R.pts];
      const off = (q) => Math.abs((q[0] - P[0]) * dy - (q[1] - P[1]) * dx) / len;
      if (all.some((q) => off(q) > AT2.straightenTolM)) continue;
      // a straight run turns by ~0 overall: every piece of it (0.3 m or longer) must run along P->Q. A blurred chamfer drawn
      // as two shallow turns (22 + 22 deg) passes the per-vertex test but not this one
      { const seq = [P, ...[...L.pts].reverse(), jFinal[j0], ...R.pts, Q].filter((q, k, arr) => k === 0 || Math.hypot(q[0] - arr[k - 1][0], q[1] - arr[k - 1][1]) > 1e-9);
        let bad = false; const cosT = Math.cos(AT2.outlineMergeDeg / 2 * Math.PI / 180);
        for (let k = 1; k < seq.length && !bad; k++) { const ux = seq[k][0] - seq[k - 1][0], uy = seq[k][1] - seq[k - 1][1], l = Math.hypot(ux, uy); if (l >= 0.3 && Math.abs(ux * dx + uy * dy) / (l * len) < cosT) bad = true; }
        if (bad) continue; }
      const proj = (q) => { const t = ((q[0] - P[0]) * dx + (q[1] - P[1]) * dy) / (len * len); q[0] = P[0] + t * dx; q[1] = P[1] + t * dy; };
      for (const q of all) proj(q); moved++;
    }
    // shallow bends inside one chain (between two of its own runs) where its ends are real corners
    for (const ch of new Set([].concat(...inc.values()))) {
      const g = ch.geom; if (g.length < 3) continue;
      const sharp = g.map((q, i) => i === 0 || i === g.length - 1 || turnDeg(g[i - 1], q, g[i + 1]) > AT2.outlineMergeDeg);
      let a = 0;
      for (let b = 1; b < g.length; b++) { if (!sharp[b]) continue;
        if (b - a > 1) { const P = g[a], Q = g[b], dx = Q[0] - P[0], dy = Q[1] - P[1], len = Math.hypot(dx, dy);
          const mid = g.slice(a + 1, b); const off = (q) => Math.abs((q[0] - P[0]) * dy - (q[1] - P[1]) * dx) / len;
          const seq = g.slice(a, b + 1), cosT = Math.cos(AT2.outlineMergeDeg / 2 * Math.PI / 180);
          const along = seq.every((q, k) => { if (!k) return true; const ux = q[0] - seq[k - 1][0], uy = q[1] - seq[k - 1][1], l = Math.hypot(ux, uy); return l < 0.3 || Math.abs(ux * dx + uy * dy) / (l * len) >= cosT; });
          if (len >= 0.5 && along && mid.every((q) => off(q) <= AT2.straightenTolM)) { for (const q of mid) { const t = ((q[0] - P[0]) * dx + (q[1] - P[1]) * dy) / (len * len); q[0] = P[0] + t * dx; q[1] = P[1] + t * dy; } moved++; } }
        a = b; }
    }
    return moved;
  }
  // Outline segments that run along a hidden zone are not roof edges. Consecutive ones collapse into one straight chord
  // between the last confirmed points on either side (no canopy-following zigzag). Straightness and alignment
  // cannot establish that a canopy boundary is a roof edge; it stays unresolved until another source locates it.
  function markObstruction(ch) {
    const g = ch.geom; if (!g || g.length < 2) return; const flags = [];
    for (let k = 1; k < g.length; k++) {
      const a = g[k - 1], b = g[k]; const L = Math.hypot(b[0] - a[0], b[1] - a[1]); if (L < 0.05) { flags.push(0); continue; }
      const nx = -(b[1] - a[1]) / L, ny = (b[0] - a[0]) / L; const steps = Math.max(1, Math.round(L / 0.2)); let hit = 0;
      for (let s = 0; s < steps; s++) { const t = (s + 0.5) / steps; const p = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]; if (obstTest(p) || obstTest([p[0] + nx * 0.3, p[1] + ny * 0.3]) || obstTest([p[0] - nx * 0.3, p[1] - ny * 0.3])) hit++; }
      const f = hit / steps >= 0.5 ? 2 : 0;
      flags.push(f);
    }
    const ng = [g[0]], nf = [];
    for (let k = 0; k < flags.length; k++) { if (flags[k] === 2 && nf.length && nf[nf.length - 1] === 2) ng[ng.length - 1] = g[k + 1]; else { ng.push(g[k + 1]); nf.push(flags[k]); } }
    ch.geom = ng; ch.segFlag = nf;
  }
  buildGeoms();
  // a facet whose straightened outline crosses itself or no longer matches its raster area goes back to the raster
  // junction positions and outline (the fitted lines disagreed there); returns how many chains changed
  // stage 1: put that facet's junctions back on their raster corners (the least-squares junction jumped across a
  // neighbour); stage 2: also drop the straightened runs and use the simplified raster outline
  const revert = (badIds, stage) => {
    let n = 0;
    for (const ch of chains) {
      if (!ch.pair.some((l) => badIds.has(l))) continue;
      if (stage >= 2) { if (ch.rawGeom) continue; ch.rawGeom = true; n++; }
      else { if (ch.jReverted) continue; ch.jReverted = true; n++; }
      jFinal[ch.j0] = jPos[ch.j0]; jFinal[ch.j1] = jPos[ch.j1];
    }
    if (n) buildGeoms();
    return n;
  };
  return { chains, jFinal, topo, revert };
}

// split a simplified polyline into straight runs; snap run directions to the plane's contour/slope (or the building axis)
// The raw support is retained on each run, so every adopted constraint is auditable.
function runSupported(pts, line) {
  if (pts.length < 2) return false;
  const distances = pts.map(p => Math.abs(line.n[0] * p[0] + line.n[1] * p[1] - line.c));
  if (!distances.every(d => Number.isFinite(d) && d <= AT2.runFitToleranceM)) return false;
  // The 10 cm source grid permits a 5 cm RMS low-noise band and 2.5 cm
  // fit penalty. An absolute pixel bound alone can erase a short real diagonal:
  // in that band the constraint must fit nearly as well as unconstrained TLS.
  const free = lineFromPts(pts);
  const freeDistances = pts.map(p => Math.abs(free.n[0] * p[0] + free.n[1] * p[1] - free.c));
  const rms = values => Math.sqrt(values.reduce((sum, d) => sum + d * d, 0) / values.length);
  const freeRms = rms(freeDistances), constrainedRms = rms(distances);
  return Number.isFinite(freeRms) && Number.isFinite(constrainedRms)
    && !(freeRms <= 0.05 && constrainedRms > freeRms + 0.025);
}

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
    let snap = snapFor(du, L);
    const pts = seg.length > 1 ? seg : [a, b];
    const candidate = snap && lineWithDir(pts, snap);
    // Angle agreement alone can rotate a real diagonal through metres of supported roof.
    if (candidate && !runSupported(pts, candidate)) snap = null;
    const line = snap ? candidate : lineFromPts(pts);
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
      if (p && parallel(p, r) && Math.abs(p.line.n[0] * r.line.m[0] + p.line.n[1] * r.line.m[1] - p.line.c) < AT2.jogM && runSupported(p.pts.concat(r.pts), join(p, r).line)) { next[next.length - 1] = join(p, r); changed = true; continue; }
      // a short run squeezed between two parallel runs: remove the jog
      const q = out[i + 1];
      if (p && q && r.len < AT2.shortRunM && parallel(p, q) && Math.abs(p.line.n[0] * q.line.m[0] + p.line.n[1] * q.line.m[1] - p.line.c) < AT2.jogM * 1.6 && runSupported(p.pts.concat(r.pts, q.pts), join(p, q, r).line)) { next[next.length - 1] = join(p, q, r); i++; changed = true; continue; }
      // consecutive runs meeting at a shallow turn (blur rounds a building corner into a short angled run; a straight eave
      // split where its pixels wander): one line when every pixel of both supports it. The longer run's snapped
      // direction wins, so a short corner piece never tilts the eave
      if (p && AT2.outlineMergeDeg > 0 && Math.abs(p.line.d[0] * r.line.d[0] + p.line.d[1] * r.line.d[1]) >= Math.cos(AT2.outlineMergeDeg / 2 * Math.PI / 180)) {
        const long = p.len >= r.len ? p : r, pts = p.pts.concat(r.pts), line = long.snap ? lineWithDir(pts, long.snap) : lineFromPts(pts);
        if (runSupported(pts, line)) { next[next.length - 1] = { start: p.start, end: r.end, line, len: p.len + r.len, pts, snap: long.snap }; changed = true; continue; }
      }
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
  // two planes that face the same way (a 4/12 roof running onto a 2/12 porch roof) meet in a pitch break: never a ridge,
  // hip or valley, whatever the fitted planes' crossing line says (it is poorly located when the planes are near parallel)
  if ((A.a * B.a + A.b * B.b) / (pitchA * pitchB) > 0.82) return { type: gap > AT2.bendGapM ? 'step' : 'transition', gap, why: 'ci-same-aspect' };
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
    const bandIds = [];
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
      // steeper than 45 degrees, small, and no other plane of the roof has that pitch: the blurred step between two roof levels
      // a neighbour vouches for the pitch only if it is not itself a small steep region: two blurred drop-offs side by side
      // (an entry roof's front and side drop to the porch) must not keep each other as roof planes
      // (only above AT2.bandSteep: a real small plane blurred to 13-17/12 still vouches for a neighbour at that pitch)
      const steepSmall = (q) => slopeOf(q) * 12 > AT2.bandSteep && (area.get(q) || 0) * geo.pxM2 <= AT2.bandMaxM2 * 2;
      const shareableRoof = nbs.some(([q]) => !steepSmall(q) && Math.abs(slopeOf(q) - s) * 12 <= AT2.bandPitchTol) || big.some(([q]) => q !== l && !steepSmall(q) && Math.abs(slopeOf(q) - s) * 12 <= AT2.bandPitchTol * 0.6);
      const stepBlur = p12 > 12.5 && !shareableRoof && aM2 <= AT2.bandMaxM2;
      if ((steepWall && (thin || outsideShare > 0.3)) || (thin && (!shareable || flatOnPitched)) || island || stepBlur) bandIds.push(l);
    }
    if (!bandIds.length) break;
    const bandSet = new Set(bandIds);
    for (const l of bandIds) {
      const cands = [...(shared.get(l) || new Map()).keys()].filter((q) => q >= 0 && !bandSet.has(q));
      if (!cands.length) continue;
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

// small regions raised or tilted by an object on the roof: when a neighbouring plane already explains most of a small
// region's pixels and the region's own plane disagrees with it (another pitch, or a poor fit), the region is that plane
// with something on it. Its pixels join the neighbour; the object stays out of every fit (heights above the plane are
// outliers there). A real small facet (a bay's hip end, a dormer cheek) has its own orientation, so a neighbour explains
// only the pixels along the shared edge and it is kept.
function absorbBumps(dsm, label, regions, w, h, lp, geo) {
  const changedIds = new Set();
  for (let pass = 0; pass < 2; pass++) {
    const area = new Map(), shared = new Map();
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const i = y * w + x, l = label[i]; if (l < 0) continue; area.set(l, (area.get(l) || 0) + 1);
      const nb = [x > 0 ? label[i - 1] : -1, x < w - 1 ? label[i + 1] : -1, y > 0 ? label[i - w] : -1, y < h - 1 ? label[i + w] : -1];
      for (const q of nb) if (q !== l && q >= 0) { let m = shared.get(l); if (!m) shared.set(l, (m = new Map())); m.set(q, (m.get(q) || 0) + 1); } }
    let changed = 0;
    for (const [l, n] of area) {
      const aM2 = n * geo.pxM2; if (aM2 > AT2.bumpMaxM2) continue;
      const nbs = [...(shared.get(l) || new Map()).entries()].filter(([q]) => (area.get(q) || 0) * geo.pxM2 > aM2); if (!nbs.length) continue;
      const P = regions[l].plane; let ownSq = 0, ownN = 0;
      const pix = []; for (let i = 0; i < w * h; i++) if (label[i] === l && dsm[i] > -1000) { const x = i % w, y = (i - x) / w; pix.push(i); const r = dsm[i] - (P.a * lp.Ecol[x] + P.b * lp.Nrow[y] + P.c); ownSq += r * r; ownN++; }
      if (pix.length < 12) continue; const ownRms = Math.sqrt(ownSq / ownN);
      // median own-fit residual: blur spoils a real plane's fit only along its edges, an object is not flat inside either
      const ownMed = (() => { const rs = pix.map((i) => { const x = i % w, y = (i - x) / w; return Math.abs(dsm[i] - (P.a * lp.Ecol[x] + P.b * lp.Nrow[y] + P.c)); }).sort((u, v) => u - v); return rs[rs.length >> 1]; })();
      let best = null;
      for (const [q, sh] of nbs) { const Q = regions[q].plane; let inl = 0, above = 0, sumUp = 0;
        for (const i of pix) { const x = i % w, y = (i - x) / w; const r = dsm[i] - (Q.a * lp.Ecol[x] + Q.b * lp.Nrow[y] + Q.c); if (Math.abs(r) <= AT2.bumpDist) inl++; else if (r > 0) { above++; sumUp += r; } }
        const frac = inl / pix.length, upFrac = (inl + above) / pix.length, meanUp = above ? sumUp / above : 0, dPitch = Math.abs(Math.hypot(P.a, P.b) - Math.hypot(Q.a, Q.b)) * 12, ang = angleBetween(P.a, P.b, Q.a, Q.b);
        const bigger = (area.get(q) || 0) >= AT2.bumpObjectRatio * n;
        // (a) mostly the neighbour's plane, tilted by something on it; (b) an object standing on the neighbour: not a plane
        // (lumpy fit), on or above the neighbour everywhere, less than a storey high. A real raised roof (a dormer, an upper
        // level) fits its own plane well, so (b) never takes it.
        const a = frac >= AT2.bumpInlier && above >= (pix.length - inl) * 0.7 && (dPitch > AT2.bumpPitchTol || ownRms > AT2.bumpRms || ang > 12);
        // an object follows its host plane roughly or is low; a small real facet at a hip end, valley or dormer turns well away
        // from the neighbour and stands a storey-fraction above its extension (blur makes its fit lumpy too, so rms alone is not enough)
        const b = bigger && ownRms >= AT2.bumpObjectRms && upFrac >= 0.9 && meanUp < AT2.bumpObjectMaxM && (ang <= AT2.bumpObjectAng || meanUp < AT2.bumpObjectLowM) && ownMed >= AT2.bumpObjectMed;
        const ok = a || b;
        if (AT2.debugBumps) console.log(`bump? region ${l} ${aM2.toFixed(1)} m2 own ${(Math.hypot(P.a, P.b) * 12).toFixed(1)}/12 rms ${ownRms.toFixed(3)} med ${ownMed.toFixed(3)} vs ${q} (${((area.get(q) || 0) * geo.pxM2).toFixed(0)} m2, shared ${sh}): inliers ${(frac * 100).toFixed(0)}% on-or-above ${(upFrac * 100).toFixed(0)}% mean up ${meanUp.toFixed(2)} m dPitch ${dPitch.toFixed(1)} ang ${ang.toFixed(0)} -> ${ok ? (a ? 'tilted' : 'object') : 'keep'}`);
        if (ok && (!best || sh > best.sh)) best = { q, frac, sh }; }
      if (!best) continue;
      for (const i of pix) label[i] = best.q; for (let i = 0; i < w * h; i++) if (label[i] === l) label[i] = best.q;
      changedIds.add(best.q); changed++;
    }
    if (!changed) break;
  }
  return { label, changedIds };
}

// ------------------------------------------------------------------ polygon checks (metres)
var ringAreaM = (r) => { let s = 0; for (let i = 0; i < r.length; i++) { const a = r[i], b = r[(i + 1) % r.length]; s += a[0] * b[1] - b[0] * a[1]; } return s / 2; };
// drop points closer than 6 cm to the previous one and zero-width spikes (out and straight back within 4 cm)
var cleanRingM = (r) => {
  let out = r.slice(), changed = true, guard = 0;
  while (changed && out.length > 3 && guard++ < 6) {
    changed = false; const nx = [];
    for (let i = 0; i < out.length; i++) {
      const p = nx.length ? nx[nx.length - 1] : out[out.length - 1], c = out[i], q = out[(i + 1) % out.length];
      if (Math.hypot(c[0] - p[0], c[1] - p[1]) < 0.06 && nx.length) { changed = true; continue; }
      const d1 = [c[0] - p[0], c[1] - p[1]], d2 = [q[0] - c[0], q[1] - c[1]]; const l1 = Math.hypot(d1[0], d1[1]), l2 = Math.hypot(d2[0], d2[1]);
      if (l1 > 1e-6 && l2 > 1e-6 && (d1[0] * d2[0] + d1[1] * d2[1]) / (l1 * l2) < -0.9995 && Math.min(l1, l2) < 0.5) { changed = true; continue; }
      nx.push(c);
    }
    if (nx.length >= 3) out = nx; else break;
  }
  return out;
};
// number of proper crossings between non-adjacent sides (touching and keyhole bridges do not count)
var selfCrossings = (r) => {
  const n = r.length; let c = 0; if (n < 4) return 0;
  const o = (p, q, t) => (q[0] - p[0]) * (t[1] - p[1]) - (q[1] - p[1]) * (t[0] - p[0]);
  for (let i = 0; i < n; i++) { const a = r[i], b = r[(i + 1) % n];
    for (let j = i + 2; j < n; j++) { if (i === 0 && j === n - 1) continue; const p = r[j], q = r[(j + 1) % n];
      const d1 = o(a, b, p), d2 = o(a, b, q), d3 = o(p, q, a), d4 = o(p, q, b); const eps = 1e-7;
      if (((d1 > eps && d2 < -eps) || (d1 < -eps && d2 > eps)) && ((d3 > eps && d4 < -eps) || (d3 < -eps && d4 > eps))) c++; } }
  return c;
};
// regions that are really tree canopy (a smooth canopy top can fit a plane): tall, green, and a poor or steep fit
function obDropCanopyRegions(label, regions, w, h, geo, ob, rgb, dsm) {
  if (!rgb || rgb.length !== 3 || rgb[0].length !== w * h) return 0;
  const acc = new Map();
  for (let i = 0; i < w * h; i++) { const l = label[i]; if (l < 0) continue; let a = acc.get(l); if (!a) acc.set(l, (a = [0, 0, 0, 0])); a[0]++; a[1] += 2 * rgb[1][i] - rgb[0][i] - rgb[2][i]; if (ob.tree[i] === 1) a[2]++; a[3] += ob.rough[i]; }
  const drop = new Set();
  for (const [l, a] of acc) {
    const n = a[0], exg = a[1] / n, treeShare = a[2] / n, rough = a[3] / n; const pl = regions[l].plane; const p12 = Math.hypot(pl.a, pl.b) * 12;
    if (n * geo.pxM2 > 60) continue;                                    // a big planar surface is a roof whatever its colour
    // only the per-pixel canopy class decides: region-mean colour and edge-inflated roughness dropped real planes on warm roofs
    if (treeShare >= 0.5) drop.add(l);
  }
  if (drop.size) for (let i = 0; i < w * h; i++) if (drop.has(label[i])) { label[i] = -1; ob.tree[i] = 1; }
  return drop.size;
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
  try { return traceBuildingV2Core(tif, member, w, h, geo, lp, { mask, rgb: opts && opts.rgb ? opts.rgb : null, opts: opts || {} }); } finally { Object.assign(AT2, saved); }
}

function traceBuildingV2Core(tifIn, member, w, h, geo, lp, env) {
  const dsmRaw = tifIn.data; let tif = tifIn;
  let { label, regions } = growRegions(dsmRaw, member, w, h, lp, geo);
  label = mergeRegions(dsmRaw, label, regions, w, h, lp, geo);
  // ---- obstruction layer: classify canopy, take it off the footprint, continue the fitted planes under it (obstruction.js)
  let ob = null, st = null;
  if (typeof obClassify === 'function' && env && env.mask && !(env.opts && env.opts.noObstruction)) {
    ob = obClassify(dsmRaw, w, h, geo, env.mask, member, env.rgb);
    obDropCanopyRegions(label, regions, w, h, geo, ob, env.rgb, dsmRaw);
    const halo = obHalo(ob.tree, w, h, Math.max(1, Math.round(OB.haloM / Math.sqrt(geo.pxM2))));
    obRefitClean(dsmRaw, label, regions, w, h, lp, geo, ob, halo);
    st = obInferHidden(dsmRaw, label, regions, member, env.mask, w, h, geo, lp, ob, halo, env.opts);
    label = st.label; member = st.memberEff;
    // heights under canopy are tree heights and heights beside it are blurred upward: hide both from every later plane fit
    let any = false; for (let i = 0; i < w * h; i++) if (st.inferred[i] || (halo[i] && member[i])) { any = true; break; }
    if (any) { const d2 = Float32Array.from(dsmRaw); for (let i = 0; i < w * h; i++) if (st.inferred[i] || halo[i]) d2[i] = -9999; tif = { data: d2, w, h }; }
  }
  label = fillHoles(tif.data, label, member, w, h, regions, lp);
  label = absorbSlivers(tif.data, label, regions, w, h, lp, geo);
  // drop large blobs no plane could explain (trees over the roof)
  for (let i = 0; i < w * h; i++) if (!member[i] || label[i] < 0) label[i] = -1;
  // On visible roofs, anchor both fits to the preceding plane so a blurred
  // eave or a chimney cannot pull the first fit toward outlying heights.
  // Canopy reconstruction keeps its existing two-pass fit on the visible support.
  const visibleRoof = !st || (!st.inferred.some(Boolean) && !st.ghost.some(Boolean));
  const ids = [...new Set(label)].filter((l) => l >= 0);
  for (const id of ids) {
    for (let pass = 0; pass < 2; pass++) {
      const acc = new PlaneAcc(); const pl = regions[id].plane;
      for (let i = 0; i < w * h; i++) {
        if (label[i] !== id || !(tif.data[i] > -1000)) continue;
        const x = i % w, y = (i - x) / w;
        const e = lp.Ecol[x], n = lp.Nrow[y];
        const residual = Math.abs(tif.data[i] - (pl.a * e + pl.b * n + pl.c));
        if ((visibleRoof || pass > 0) && residual > 0.2) continue;
        acc.add(e, n, tif.data[i]);
      }
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
  // small regions raised by an object on the roof -> the plane under them, then refit the planes that grew
  { const r3 = absorbBumps(tif.data, label, regions, w, h, lp, geo); label = r3.label;
    for (const id of r3.changedIds) for (let pass = 0; pass < 2; pass++) { const acc = new PlaneAcc(); const pl = regions[id].plane;
      for (let i = 0; i < w * h; i++) { if (label[i] !== id || !(tif.data[i] > -1000)) continue; const x = i % w, y = (i - x) / w; const r = Math.abs(tif.data[i] - (pl.a * lp.Ecol[x] + pl.b * lp.Nrow[y] + pl.c)); if (r > 0.2) continue; acc.add(lp.Ecol[x], lp.Nrow[y], tif.data[i]); }
      const f = acc.solve(); if (f) regions[id].plane = f; }
    if (r3.changedIds.size) { ids.length = 0; for (const l of new Set(label)) if (l >= 0) ids.push(l); for (const id of ids) { let n = 0; for (let i = 0; i < w * h; i++) if (label[i] === id) n++; regions[id].n = n; } } }
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
    try {
      const before = label; label = regularizeFootprint(dsmRaw, label, w, h, geo, dominantDeg, ground);
      if (st) for (let i = 0; i < w * h; i++) { if (label[i] >= 0 && before[i] < 0 && ob.tree[i] === 1) { st.inferred[i] = 1; if (!st.ev[i]) st.ev[i] = 5; } if (label[i] >= 0) st.ghost[i] = 0; }
    } catch (e) { console.warn('footprint regularisation failed', e); }
  }
  // region centroids (for "which side of the edge is this plane on")
  const cent = new Map();
  { const acc = new Map(); for (let i = 0; i < w * h; i++) { const l = label[i]; if (l < 0) continue; const x = i % w, y = (i - x) / w; const a = acc.get(l) || [0, 0, 0]; a[0] += lp.Ecol[x]; a[1] += lp.Nrow[y]; a[2]++; acc.set(l, a); } for (const [l, a] of acc) cent.set(l, [a[0] / a[2], a[1] / a[2]]); }
  // where the visible roof stops against a hidden zone: an obstruction boundary, not a roof edge
  let obstTest = null;
  if (st) { st.unresolved = obContact(label, st.ghost, w, h); let anyC = false; const cd = new Uint8Array(w * h);
    for (let y = 3; y < h - 3; y++) for (let x = 3; x < w - 3; x++) if (st.unresolved[y * w + x]) { anyC = true; for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) cd[(y + dy) * w + x + dx] = 1; }
    if (anyC) obstTest = (p) => { const x = Math.floor(geo.X(p[0])), y = Math.floor(geo.Y(p[1])); return x >= 0 && y >= 0 && x < w && y < h && cd[y * w + x] === 1; }; }
  const rec = reconstruct(label, regions, w, h, geo, dominantDeg, obstTest);
  // ---- assemble facets: walk each region's chains into loops
  let facets = []; const edges = [];
  // ground beside the house (same datum as the obstruction layer): facet planes are stored relative to it for the 3D view
  const groundZ = ob ? ob.ground : (() => { const v = []; for (let i = 0; i < w * h; i += 7) if (!member[i] && dsmRaw[i] > -1000) v.push(dsmRaw[i]); v.sort((p, q) => p - q); return v.length ? v[Math.floor(v.length * 0.05)] : 0; })();
  const toLL = (p) => { const lat = geo.ref.lat + p[1] / geo.ref.ky, lng = geo.ref.lng + p[0] / geo.ref.kx; return { lat, lng }; };
  const byRegion = new Map();
  for (const ch of rec.chains) for (const l of ch.pair) if (l >= 0) { if (!byRegion.has(l)) byRegion.set(l, []); byRegion.get(l).push(ch); }
  const pxCount = new Map(); for (let i = 0; i < w * h; i++) { const l = label[i]; if (l >= 0) pxCount.set(l, (pxCount.get(l) || 0) + 1); }
  const repairs = [];
  const assemble = () => { facets = [];
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
    outer = cleanRingM(outer);
    const pl = regions[id].plane; const slope = Math.hypot(pl.a, pl.b);
    const pitch = Math.round(slope * 12);
    const az = slope > 0.03 ? ((Math.atan2(-pl.a, -pl.b) * 180 / Math.PI) + 360) % 360 : null;
    facets.push({ id, path: outer.map(toLL), m: outer, pitch, azimuth: az, slope, rms: pl.rms || 0, plane: [pl.a, pl.b, pl.c - groundZ], areaM2: (pxCount.get(id) || regions[id].n) * geo.pxM2, holes: loops.length - 1 });
  } };
  assemble();
  // ---- geometry validation: self-crossing outlines and outlines that drifted away from their raster area are rebuilt from
  // the raster (raw) geometry; what was changed is kept in `repairs` so the edit can be audited
  const stageOf = new Map();
  for (let pass = 0; pass < 4; pass++) {
    const bad = new Set(); let maxStage = 1;
    for (const f of facets) {
      const A = Math.abs(ringAreaM(f.m)), cross = selfCrossings(f.m);
      const drift = Math.abs(A - f.areaM2) > Math.max(1.5, 0.22 * f.areaM2) && !f.holes;
      if (!cross && !drift) continue;
      const stage = (stageOf.get(f.id) || 0) + 1; if (stage > 2) continue;      // already on the raster outline: nothing more to do
      stageOf.set(f.id, stage); bad.add(f.id); if (stage > maxStage) maxStage = stage;
      repairs.push({ facetRegion: f.id, stage, reason: cross ? 'straightened outline crossed itself (' + cross + ' crossing' + (cross > 1 ? 's' : '') + ')' : 'straightened outline area ' + (A * 10.7639).toFixed(0) + ' sq ft did not match the height-model region ' + (f.areaM2 * 10.7639).toFixed(0) + ' sq ft', action: stage === 1 ? 'corner points moved back to their height-model positions' : 'outline rebuilt from the height-model region' });
    }
    if (!bad.size) break;
    // facets on stage 2 need the raster outline; the rest only their junctions
    const s2 = new Set([...bad].filter((id) => stageOf.get(id) >= 2)), s1 = new Set([...bad].filter((id) => stageOf.get(id) < 2));
    let changed = 0; if (s1.size) changed += rec.revert(s1, 1); if (s2.size) changed += rec.revert(s2, 2);
    if (!changed) break;
    assemble();
  }
  for (const f of facets) { const st0 = stageOf.get(f.id); if (st0) f.repaired = st0; }
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
        if (uType) edges.push({ type: uType, path: g.map(toLL), g, pl: U, regions: [p, q], paired: 'upper' });
        if (lType) edges.push({ type: lType, path: g.map(toLL), g, pl: Lo, regions: [p, q], paired: 'lower' });
        return;
      }
      edges.push({ type, path: g.map(toLL), why, g, pl: A, regions: [p, q] });
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
        const flag = ch.segFlag ? ch.segFlag[i - 1] : 0;
        if (flag === 2) { edges.push({ type: 'obstruction', path: [toLL(a), toLL(b)], g: [a, b], pl: null, regions: [p >= 0 ? p : q] }); continue; }
        let type = 'eave';
        if (slope > 0.06) { const along = Math.abs((d[0] * own.a + d[1] * own.b) / (L * slope)); type = along >= 0.5 ? 'rake' : 'eave'; }
        edges.push({ type, path: [toLL(a), toLL(b)], g: [a, b], pl: own, regions: [p >= 0 ? p : q], underCanopy: flag === 1 });
      }
    }
  }
  function planeOf(id) { return id >= 0 && regions[id] ? regions[id].plane : null; }
  // ---- a hip that ends a little short of its outline corner leaves a short sloped piece of outline between the two eaves
  // there. It is part of the eave line round the corner (where the drip edge runs), not a rake: a rake runs from an eave up
  // to a ridge or a gable peak. Short outline pieces (< 2.5 m) touching the LOW end of a hip are counted as eave.
  if (AT2.hipCornerEave) {
    const lowEnds = []; for (const e of edges) { if (e.type !== 'hip' || !e.pl) continue; const z = (pt) => e.pl.a * pt[0] + e.pl.b * pt[1] + e.pl.c; const g0 = e.g[0], g1 = e.g[e.g.length - 1]; lowEnds.push(z(g0) <= z(g1) ? g0 : g1); }
    for (const e of edges) { if (e.type !== 'rake' || e.paired || (e.regions || []).length !== 1) continue; const g0 = e.g[0], g1 = e.g[e.g.length - 1]; const L = Math.hypot(g1[0] - g0[0], g1[1] - g0[1]); if (L >= 2.5) continue;
      if (lowEnds.some((q) => Math.min(Math.hypot(q[0] - g0[0], q[1] - g0[1]), Math.hypot(q[0] - g1[0], q[1] - g1[1])) < 0.3)) { e.type = 'eave'; e.why = 'hip-corner'; } }
  }
  // ---- line list clean-up: pieces of the same line (same type, same two planes) that meet end to end and run straight on
  // become one line; leftovers shorter than 6 in. are tracing crumbs, not roof features, and are dropped
  { const keyOf = (e) => e.type + '|' + (e.paired || '') + '|' + (e.regions || []).slice().sort().join(',');
    const dirOf = (g, atEnd) => { const a = atEnd ? g[g.length - 2] : g[0], b = atEnd ? g[g.length - 1] : g[1]; const L = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1e-9; return [(b[0] - a[0]) / L, (b[1] - a[1]) / L]; };
    let changed = true, guard = 0;
    while (changed && guard++ < 400) {
      changed = false;
      scan: for (let i = 0; i < edges.length; i++) for (let j = 0; j < edges.length; j++) {
        if (i === j) continue; const a = edges[i], b = edges[j]; if (keyOf(a) !== keyOf(b)) continue;
        for (const rev of [false, true]) {
          const bg = rev ? b.g.slice().reverse() : b.g; const ae = a.g[a.g.length - 1];
          if (Math.hypot(ae[0] - bg[0][0], ae[1] - bg[0][1]) > 0.04) continue;
          const d1 = dirOf(a.g, true), d2 = dirOf(bg, false); if (d1[0] * d2[0] + d1[1] * d2[1] < 0.9976) continue;   // within 4 degrees
          a.g = a.g.slice(0, -1).concat(bg.slice(1)); if (a.g.length < 2) a.g = [a.g[0], bg[bg.length - 1]];
          edges.splice(j, 1); changed = true; break scan;
        }
      }
    }
    for (let i = edges.length - 1; i >= 0; i--) { const g = edges[i].g; let L = 0; for (let k = 1; k < g.length; k++) L += Math.hypot(g[k][0] - g[k - 1][0], g[k][1] - g[k - 1][1]); edges[i].lenM = L; if (L < 0.15) edges.splice(i, 1); else edges[i].path = g.map(toLL); }
    // the same line traced twice (a boundary that doubles back around a sliver): one physical line is counted once.
    // A line whose whole length lies on a longer line of the same type is the duplicate.
    const dSeg = (p, a, b) => { const dx = b[0] - a[0], dy = b[1] - a[1]; const l2 = dx * dx + dy * dy || 1e-12; let t = ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2; t = Math.max(0, Math.min(1, t)); return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy); };
    const onLine = (p, g) => { for (let k = 1; k < g.length; k++) if (dSeg(p, g[k - 1], g[k]) < 0.25) return true; return false; };
    const dropDup = new Set();
    for (let i = 0; i < edges.length; i++) for (let j = 0; j < edges.length; j++) {
      if (i === j || dropDup.has(i) || dropDup.has(j)) continue; const a = edges[i], b = edges[j];
      if (a.type !== b.type || b.lenM > a.lenM || (b.lenM === a.lenM && j < i)) continue;   // an upper roof's edge is one line whether it was found as outline or as a height break
      let all = true; for (let k = 1; k < b.g.length && all; k++) { const p = b.g[k - 1], q = b.g[k]; for (const t of [0, 0.25, 0.5, 0.75, 1]) if (!onLine([p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t], a.g)) { all = false; break; } }
      if (all) dropDup.add(j);
    }
    if (dropDup.size) { for (const j of [...dropDup].sort((p, q) => q - p)) edges.splice(j, 1); repairs.push({ reason: dropDup.size + ' line' + (dropDup.size > 1 ? 's were' : ' was') + ' traced twice on the same stretch', action: 'the duplicate was removed so the length is counted once' }); } }
  // ---- true (sloped) length of every line from the plane it lies in: plan length x sqrt(1 + (grad . direction)^2)
  const FT = 3.28084, SQFT = 10.7639104, pxM = Math.sqrt(geo.pxM2);
  for (const e of edges) {
    let plan = 0, len3 = 0;
    for (let i = 1; i < e.g.length; i++) { const dx = e.g[i][0] - e.g[i - 1][0], dy = e.g[i][1] - e.g[i - 1][1]; const L = Math.hypot(dx, dy); if (L < 1e-6) continue; const rise = e.pl ? (e.pl.a * dx + e.pl.b * dy) : 0; plan += L; len3 += Math.hypot(L, rise); }
    e.planM = plan; e.factor = plan > 0 ? len3 / plan : 1; e.basis = e.pl ? 'plane' : 'assumed';
  }
  // ---- Measured / Inferred per facet and line; what stays unresolved becomes obstruction boundaries and hidden zones
  const idName = new Map(); facets.forEach((f, i) => idName.set(f.id, i));
  const obstSegs = []; for (const e of edges) if (e.type === 'obstruction') for (let i = 1; i < e.g.length; i++) obstSegs.push([e.g[i - 1], e.g[i]]);
  const fstat = new Map();
  if (st) for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x, l = label[i]; if (l < 0) continue; let q = fstat.get(l); if (!q) fstat.set(l, (q = { n: 0, inf: 0, ev: [0, 0, 0, 0, 0, 0], edgePx: 0, src: [0, 0, 0, 0] }));
    q.n++; if (!st.inferred[i]) continue; q.inf++; q.ev[st.ev[i] || 0]++; q.src[st.borrowed ? (st.borrowed[i] || 0) : 0]++;
    if (x === 0 || y === 0 || x === w - 1 || y === h - 1 || label[i - 1] < 0 || label[i + 1] < 0 || label[i - w] < 0 || label[i + w] < 0) q.edgePx++;
  }
  const EV = { 1: 'the same plane is visible up or down the slope from the hidden part', 2: 'the opposite face of the same ridge is visible beside the hidden part', 3: 'Google\'s building outline covers the hidden part', 4: 'a reviewer confirmed from another image that the roof continues here', 5: 'the wall lines on both sides of a hidden corner were extended until they meet' };
  // pixels whose heights were carried in from another dated, georeferenced source (reviewer-approved; see autotrace.js)
  const altUsed = env && env.opts && env.opts.alt && env.opts.alt.used && env.opts.alt.used.length === w * h ? env.opts.alt : null;
  // "resolved" = roof the trace image could not measure and the other dataset shows (not the copied rim of roof it had measured)
  const altN = altUsed ? new Map() : null, altRes = altUsed ? new Uint8Array(w * h) : null; let altResolvedPx = 0;
  if (altUsed) for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const i = y * w + x, l = label[i]; if (l < 0 || !altUsed.used[i] || (altUsed.hidden && !altUsed.hidden[i]) || (st && st.inferred[i])) continue; altRes[i] = 1; altResolvedPx++; let a = altN.get(l); if (!a) altN.set(l, (a = { n: 0, edge: 0 })); a.n++;
    if (x === 0 || y === 0 || x === w - 1 || y === h - 1 || label[i - 1] < 0 || label[i + 1] < 0 || label[i - w] < 0 || label[i + w] < 0) a.edge++; }
  for (const f of facets) {
    f.status = 'measured'; f.inferredSqft = 0; f.evidence = null;
    const sf = Math.sqrt(1 + f.slope * f.slope); const q = fstat.get(f.id);
    if (q && q.inf * geo.pxM2 >= Math.max(0.5, 0.03 * q.n * geo.pxM2)) {
      const infM2 = q.inf * geo.pxM2, full = q.n * geo.pxM2 * sf * SQFT; f.status = 'inferred'; f.inferredSqft = infM2 * sf * SQFT;
      // range: the hidden eave is where the plane reaches its eave height, which is known to about 0.2 m
      // (0.4 m when it had to be taken from neighbouring planes); that height error moves the eave by tol / slope
      const src = q.src.indexOf(Math.max(...q.src)); const tolZ = src === 0 ? 0.2 : src === 1 ? 0.3 : 0.45; const d = Math.min(q.edgePx * pxM * (tolZ / Math.max(f.slope, 0.08)) * sf * SQFT, f.inferredSqft);
      f.rangeSqft = [Math.max(full - f.inferredSqft, full - d), full + d];
      let top = 1, tn = -1; for (let k = 1; k <= 5; k++) if (q.ev[k] > tn) { tn = q.ev[k]; top = k; }
      f.evidenceKind = top;
      f.evidence = 'Tree canopy hides ' + Math.round(infM2 * SQFT) + ' sq ft (plan) of this plane. Evidence that the roof continues there: ' + EV[top] + '. The fitted plane was continued down to ' + ['its own measured eave height', 'the eave height measured on the opposite face of the same ridge', 'the lowest point of its visible outline (no level eave of this plane is visible, so this may be high)', 'the typical eave height of this building'][src] + '.'; f.eaveSource = src;
    }
    if (altN) { const a = altN.get(f.id); if (a && a.n * geo.pxM2 >= 0.5) { f.altSqft = a.n * geo.pxM2 * sf * SQFT; f.confirmedBy = altUsed.label;
      // A softer second dataset (anything below Google's HIGH quality) places an edge to about 0.4 m and its building outline
      // runs large. What it supplies is reported as an estimate with a range (dashed), never as a confirmed measurement.
      const nPx = pxCount.get(f.id) || regions[f.id].n; const full = nPx * geo.pxM2 * sf * SQFT;
      if (altUsed.soft && a.n >= Math.max(0.5 / geo.pxM2, 0.03 * nPx)) { const d0 = f.rangeSqft ? (f.rangeSqft[1] - f.rangeSqft[0]) / 2 : 0;
        f.status = 'inferred'; f.inferredSqft = Math.min(full, f.inferredSqft + f.altSqft); const d = Math.min(f.inferredSqft, d0 + a.edge * pxM * 0.4 * sf * SQFT); f.rangeSqft = [full - d, full + d]; f.evidenceKind = 6;
        f.evidence = (f.evidence ? f.evidence + ' ' : '') + Math.round(a.n * geo.pxM2 * SQFT) + ' sq ft (plan) of this plane is under tree canopy in the trace image and was taken from ' + (altUsed.text || altUsed.label) + ' after the roof configuration check. That dataset is softer: its edges are good to about 1.3 ft, so this part is an estimate.'; } } }
    // raw (unstraightened) outline of the height-model region, kept for audit
    try { const loop = regionOuterLoop(label, w, h, f.id); if (loop.length >= 8) { const P = loop.map((e) => [geo.E(e.a[0]), geo.N(e.a[1])]); const half = Math.floor(P.length / 2); f.rawPath = dpM(P.slice(0, half + 1), 0.12).slice(0, -1).concat(dpM(P.slice(half).concat([P[0]]), 0.12).slice(0, -1)).map(toLL); } } catch (_) { /* audit copy only */ }
    delete f.m;
  }
  for (const e of edges) {
    e.status = 'measured'; e.obscuredFt = 0;
    if (e.type === 'obstruction') { e.status = 'unresolved'; e.obscuredFt = e.planM * FT; e.missing = 'The visible roof stops at tree canopy here. This is not a roof edge and is not counted in any line total. An image without the canopy (another date, an oblique view, a drone photo) or a site measurement is needed to locate the real edge.'; }
    else if (st) {
      const q = obStatusOfLine(e.g, geo, w, h, st); e.obscuredFt = q.inferredM * e.factor * FT;
      if (e.underCanopy) { e.status = 'inferred'; e.evidence = 'A tree stands against this edge. The edge is straight and lies on the plane\'s own eave or rake direction, so it is taken as the roof edge.'; }
      else if (q.inferredM >= Math.max(0.6, 0.3 * q.lenM)) { e.status = 'inferred'; e.evidence = Math.round(q.inferredM * FT) + ' ft of this line is under tree canopy; its position comes from the continued roof plane and its eave height.'; }
    }
    // a line that runs through carried-in pixels was located on the other source, not on the current photo
    if (altUsed && e.type !== 'obstruction') { let n = 0, hit = 0;
      for (let i = 1; i < e.g.length; i++) { const a = e.g[i - 1], b = e.g[i]; const L = Math.hypot(b[0] - a[0], b[1] - a[1]); const steps = Math.max(1, Math.ceil(L / 0.2));
        for (let k = 0; k <= steps; k++) { const px = Math.floor(geo.X(a[0] + (b[0] - a[0]) * k / steps)), py = Math.floor(geo.Y(a[1] + (b[1] - a[1]) * k / steps)); n++; let any = false;
          for (let dy = -3; dy <= 3 && !any; dy++) for (let dx = -3; dx <= 3; dx++) { const xx = px + dx, yy = py + dy; if (xx >= 0 && yy >= 0 && xx < w && yy < h && altRes[yy * w + xx]) { any = true; break; } }
          if (any) hit++; } }
      if (n && hit / n >= 0.5) { e.confirmedBy = altUsed.label; e.altFt = hit / n * e.planM * e.factor * FT;
        if (altUsed.soft && e.status === 'measured') { e.status = 'inferred'; e.evidence = 'Located on ' + (altUsed.text || altUsed.label) + ' (softer image: position good to about 1.3 ft).'; } } }
    e.facets = (e.regions || []).filter((l) => l >= 0 && idName.has(l)).map((l) => idName.get(l));
    delete e.g; delete e.pl; delete e.regions; delete e.underCanopy;
  }
  let obstruction = null;
  if (ob && st) { try {
    obstruction = obSummarize(dsmRaw, w, h, geo, env.mask, label, regions, ob, st, toLL); obstruction.canopyOnMaskSqft = st.canopyOnMaskPx * geo.pxM2 * SQFT;
    // hidden zones: where a plane could continue under the canopy but nothing seen supports it. Not roof; an upper bound.
    obstruction.hiddenZones = obHiddenZones(st.ghost, label, w, h, geo, regions, obstSegs, toLL, st.maskGhost).map((z, i) => ({ id: 'Z' + (i + 1), path: z.path, centre: z.centre, planSqft: z.planSqft, upperSqft: z.upperSqft, pitch: z.pitch, facet: idName.has(z.region) ? idName.get(z.region) : null }));
    obstruction.obstructionBoundaryFt = edges.filter((e) => e.type === 'obstruction').reduce((a, e) => a + e.planM * FT, 0);
  } catch (e) { console.warn('obstruction summary failed', e); } }
  const plot = env && env.opts && env.opts.plot && ob ? { w, h, label: env.opts.plot === 'full' ? Array.from(label) : null, ids: env.opts.plot === 'full' ? facets.map((f) => f.id) : null, tree: (() => { const o = []; for (let y = 0; y < h; y++) { const r = []; for (let x = 0; x < w; x++) { const i = y * w + x; r.push(st.ghost[i] > 0 && label[i] < 0 ? 4 : st.unresolved[i] ? 3 : st.inferred[i] && label[i] >= 0 ? 2 : ob.tree[i] === 1 ? 1 : 0); } o.push(r); } return o; })() } : null;
  // for the alternate-source check: where this dataset sees canopy, and where it sees roof it could measure
  let treeMask = null, roofMask = null;
  if (env && env.opts && env.opts.wantTree && ob && st) { treeMask = new Uint8Array(w * h); roofMask = new Uint8Array(w * h); for (let i = 0; i < w * h; i++) { const tr = ob.tree[i] === 1 || st.inferred[i] || st.ghost[i]; treeMask[i] = tr ? 1 : 0; roofMask[i] = label[i] >= 0 && !tr ? 1 : 0; } }
  return { facets, edges, planes: facets.length, unassignedPct: 0, datum: 0, dominantDeg, v2: true, obstruction, repairs, noiseSigma: AT2.noiseSigma, plot, treeMask, roofMask, altResolvedPx };
}
