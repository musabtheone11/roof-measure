// Synthetic roofs with exact ground truth, rendered as Google-Solar-style 10 cm DSM + building mask.
// Roof model: union of rectangular wings (hip / gable), surface = max over wings of (min of the wing's planes).
// Ground truth facets are exact polygons (polygon-clipping); edges classified from the exact planes; lengths are true 3D.
import pc from 'polygon-clipping';

export const FT = 3.28084, SQFT = 10.7639;

// ---------- deterministic RNG
export function rng(seed) {
  let s = seed >>> 0 || 1;
  const r = () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
  r.range = (a, b) => a + (b - a) * r();
  r.int = (a, b) => Math.floor(a + (b - a + 1) * r());
  r.pick = (arr) => arr[Math.floor(r() * arr.length)];
  r.gauss = () => { let u = 0, v = 0; while (!u) u = r(); while (!v) v = r(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
  return r;
}

// ---------- wings and planes
function wingPlanes(wg) {
  const { cx, cy, th, L, W, kind, s, sEnd, eaveZ } = wg;
  const U = [Math.cos(th), Math.sin(th)], V = [-Math.sin(th), Math.cos(th)];
  const mk = (d, dist, slope) => {
    // plane falling along d, eave line at centre + dist*d: z = eaveZ - slope * (d . (p - p0))
    const p0 = [cx + d[0] * dist, cy + d[1] * dist];
    return { a: -slope * d[0], b: -slope * d[1], c: eaveZ + slope * (d[0] * p0[0] + d[1] * p0[1]) };
  };
  const planes = [mk(V, W / 2, s), mk([-V[0], -V[1]], W / 2, s)];
  if (kind === 'hip') planes.push(mk(U, L / 2, sEnd), mk([-U[0], -U[1]], L / 2, sEnd));
  if (kind === 'shed') planes.splice(1, 1);
  const rect = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([a, b]) => [cx + U[0] * a * L / 2 + V[0] * b * W / 2, cy + U[1] * a * L / 2 + V[1] * b * W / 2]);
  return { planes, rect };
}
const zOf = (pl, p) => pl.a * p[0] + pl.b * p[1] + pl.c;
function inRect(rect, p) {
  let pos = 0, neg = 0;
  for (let i = 0; i < 4; i++) { const a = rect[i], b = rect[(i + 1) % 4]; const c = (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]); if (c > 0) pos++; else if (c < 0) neg++; }
  return !(pos && neg);
}
function wingZ(wp, p) { if (!inRect(wp.rect, p)) return -Infinity; let z = Infinity; for (const pl of wp.planes) z = Math.min(z, zOf(pl, p)); return z; }
export function surfaceZ(wps, p) { let z = -Infinity; for (const wp of wps) z = Math.max(z, wingZ(wp, p)); return z; }

// clip convex polygon by half-plane A x + B y + C >= 0
function clipHalf(poly, A, B, C) {
  const out = []; const f = (p) => A * p[0] + B * p[1] + C;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i], q = poly[(i + 1) % poly.length]; const fp = f(p), fq = f(q);
    if (fp >= 0) out.push(p);
    if ((fp >= 0) !== (fq >= 0)) { const t = fp / (fp - fq); out.push([p[0] + t * (q[0] - p[0]), p[1] + t * (q[1] - p[1])]); }
  }
  return out;
}
const ring = (poly) => (poly.length >= 3 ? [[...poly.map((p) => [p[0], p[1]]), [poly[0][0], poly[0][1]]]] : null);

// ---------- ground truth facets
export function groundTruth(wings) {
  const wps = wings.map(wingPlanes);
  const pieces = new Map(); // plane key -> {pl, geoms: []}
  wps.forEach((wp, i) => wp.planes.forEach((P, k) => {
    let poly = wp.rect.slice();
    wp.planes.forEach((Q, l) => { if (l !== k) poly = clipHalf(poly, Q.a - P.a, Q.b - P.b, Q.c - P.c); });
    if (poly.length < 3) return;
    let geom = [ring(poly)];
    const subs = [];
    wps.forEach((wj, j) => {
      if (j === i) return;
      let q = wj.rect.slice();
      for (const R of wj.planes) q = clipHalf(q, R.a - P.a, R.b - P.b, R.c - P.c - 1e-7); // wing j above P
      if (q.length >= 3) subs.push([ring(q)]);
    });
    if (subs.length) geom = pc.difference(geom, ...subs);
    if (!geom.length) return;
    const key = [P.a, P.b, P.c].map((v) => v.toFixed(5)).join(',');
    if (!pieces.has(key)) pieces.set(key, { pl: P, geoms: [] });
    pieces.get(key).geoms.push(geom);
  }));
  const facets = [];
  for (const { pl, geoms } of pieces.values()) {
    const u = geoms.length > 1 ? pc.union(...geoms) : geoms[0];
    for (const poly of u) {
      const area = polyArea(poly);
      if (area < 0.05) continue;
      facets.push({ pl, poly, planArea: area, slope: Math.hypot(pl.a, pl.b) });
    }
  }
  return { facets, wps };
}
function ringArea(r) { let s = 0; for (let i = 0; i < r.length - 1; i++) s += r[i][0] * r[i + 1][1] - r[i + 1][0] * r[i][1]; return s / 2; }
function polyArea(poly) { return Math.abs(ringArea(poly[0])) - poly.slice(1).reduce((s, r) => s + Math.abs(ringArea(r)), 0); }
function pointInPoly(poly, p) {
  let inside = false;
  for (const r of poly) for (let i = 0, j = r.length - 2; i < r.length - 1; j = i++) {
    const a = r[i], b = r[j];
    if ((a[1] > p[1]) !== (b[1] > p[1]) && p[0] < (b[0] - a[0]) * (p[1] - a[1]) / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  return inside;
}

// ---------- ground truth edges (true 3D length, metres)
export function gtEdges(facets, wps) {
  const segs = [];
  facets.forEach((f, fi) => { for (const r of f.poly) for (let i = 0; i < r.length - 1; i++) { const a = r[i], b = r[i + 1]; const L = Math.hypot(b[0] - a[0], b[1] - a[1]); if (L > 1e-6) segs.push({ fi, a, b, L, d: [(b[0] - a[0]) / L, (b[1] - a[1]) / L], cover: [] }); } });
  const out = [];
  const factor = (pl, d) => Math.sqrt(1 + (pl.a * d[0] + pl.b * d[1]) ** 2);
  const add = (type, planLen, pl, d, p0, p1) => out.push({ type, plan: planLen, len: planLen * factor(pl, d), p0, p1 });
  for (let i = 0; i < segs.length; i++) for (let j = i + 1; j < segs.length; j++) {
    const s = segs[i], t = segs[j]; if (s.fi === t.fi) continue;
    if (Math.abs(s.d[0] * t.d[1] - s.d[1] * t.d[0]) > 1e-6) continue;
    const off = Math.abs((t.a[0] - s.a[0]) * s.d[1] - (t.a[1] - s.a[1]) * s.d[0]); if (off > 1e-5) continue;
    const pr = (p) => (p[0] - s.a[0]) * s.d[0] + (p[1] - s.a[1]) * s.d[1];
    const lo = Math.max(0, Math.min(pr(t.a), pr(t.b))), hi = Math.min(s.L, Math.max(pr(t.a), pr(t.b)));
    if (hi - lo < 1e-4) continue;
    s.cover.push([lo, hi]);
    const prt = (p) => (p[0] - t.a[0]) * t.d[0] + (p[1] - t.a[1]) * t.d[1];
    const tA = prt([s.a[0] + s.d[0] * lo, s.a[1] + s.d[1] * lo]), tB = prt([s.a[0] + s.d[0] * hi, s.a[1] + s.d[1] * hi]);
    t.cover.push([Math.min(tA, tB), Math.max(tA, tB)]);
    const mid = [s.a[0] + s.d[0] * (lo + hi) / 2, s.a[1] + s.d[1] * (lo + hi) / 2];
    const A = facets[s.fi].pl, B = facets[t.fi].pl, planLen = hi - lo;
    const zA = zOf(A, mid), zB = zOf(B, mid);
    if (Math.abs(zA - zB) > 0.02) {
      const [Up, Lo] = zA > zB ? [A, B] : [B, A];
      const lvl = (pl) => Math.abs(pl.a * s.d[0] + pl.b * s.d[1]) < 0.03;
      const q0 = [s.a[0] + s.d[0] * lo, s.a[1] + s.d[1] * lo], q1 = [s.a[0] + s.d[0] * hi, s.a[1] + s.d[1] * hi];
      add(lvl(Up) ? 'eave' : 'rake', planLen, Up, s.d, q0, q1);
      add(lvl(Lo) ? 'wall' : 'step', planLen, Lo, s.d, q0, q1);
      continue;
    }
    const n = [-s.d[1], s.d[0]]; const eps = 0.05;
    const sideA = pointInPoly(facets[s.fi].poly, [mid[0] + n[0] * eps, mid[1] + n[1] * eps]) ? 1 : -1;
    const gA = (A.a * n[0] + A.b * n[1]) * sideA, gB = (B.a * n[0] + B.b * n[1]) * -sideA;
    const along = Math.abs(A.a * s.d[0] + A.b * s.d[1]);
    let type;
    if (gA < -1e-4 && gB < -1e-4) type = along < 0.03 ? 'ridge' : 'hip';
    else if (gA > 1e-4 && gB > 1e-4) type = 'valley';
    else type = 'transition';
    add(type, planLen, A, s.d, [s.a[0] + s.d[0] * lo, s.a[1] + s.d[1] * lo], [s.a[0] + s.d[0] * hi, s.a[1] + s.d[1] * hi]);
  }
  // outline remainder of each segment
  for (const s of segs) {
    const cov = s.cover.slice().sort((p, q) => p[0] - q[0]); let free = 0, cur = 0;
    for (const [lo, hi] of cov) { if (lo > cur) free += lo - cur; cur = Math.max(cur, hi); }
    if (s.L > cur) free += s.L - cur;
    if (free < 1e-4) continue;
    const pl = facets[s.fi].pl; const along = Math.abs(pl.a * s.d[0] + pl.b * s.d[1]);
    add(along < 0.03 ? 'eave' : 'rake', free, pl, s.d, s.a, s.b);
  }
  return out;
}

export function summarizeGT(wings) {
  const { facets, wps } = groundTruth(wings);
  const edges = gtEdges(facets, wps);
  const byType = {};
  for (const e of edges) byType[e.type] = (byType[e.type] || 0) + e.len * FT;
  const pitchAreas = {};
  let sloped = 0;
  for (const f of facets) { const a = f.planArea * Math.sqrt(1 + f.slope * f.slope) * SQFT; sloped += a; const p = Math.round(f.slope * 12 * 10) / 10; pitchAreas[p] = (pitchAreas[p] || 0) + a; }
  return { edges, facets, wps, sloped, facetCount: facets.length, byType, pitchAreas, minFacet: Math.min(...facets.map((f) => f.planArea)) };
}

// ---------- random houses
const PITCHES = [4, 5, 6, 6, 7, 8, 8, 9, 10, 12, 12, 12, 14];
export function randomHouse(r, complexity = r() < 0.25 ? r.int(6, 9) : r.int(0, 5)) {
  const th = r.range(0, Math.PI);
  const basePitch = r.pick(PITCHES) / 12;
  const hipStyle = r() < 0.7;
  const main = { cx: 0, cy: 0, th, L: r.range(12, 24), W: r.range(8, 12.5), kind: hipStyle ? 'hip' : 'gable', s: basePitch, sEnd: basePitch, eaveZ: 3 };
  const wings = [main];
  for (let k = 0; k < complexity; k++) {
    const par = r.pick(wings);
    const perp = r() < 0.7;
    const wth = par.th + (perp ? Math.PI / 2 : 0);
    const U = [Math.cos(par.th), Math.sin(par.th)], V = [-Math.sin(par.th), Math.cos(par.th)];
    const sideV = r() < 0.75; const sgn = r() < 0.5 ? -1 : 1;
    const W = r.range(4, Math.min(10, (perp ? par.L : par.W) * 0.9));
    const L = r.range(4, 11);
    const overlap = r.range(0.6, (sideV ? par.W : par.L) / 2);
    let cx, cy, th2, Lw, Ww;
    if (sideV) {
      // wing sticks out of a long side: its axis runs along V
      const t = r.range(-par.L / 2 + W / 2, par.L / 2 - W / 2);
      const dist = par.W / 2 - overlap + L / 2;
      cx = par.cx + U[0] * t + V[0] * dist * sgn; cy = par.cy + U[1] * t + V[1] * dist * sgn; th2 = par.th + Math.PI / 2; Lw = L; Ww = W;
    } else {
      const t = r.range(-par.W / 2 + W / 2, par.W / 2 - W / 2) * (r() < 0.5 ? 0 : 1);
      const dist = par.L / 2 - overlap + L / 2;
      cx = par.cx + U[0] * dist * sgn + V[0] * t; cy = par.cy + U[1] * dist * sgn + V[1] * t; th2 = par.th; Lw = L; Ww = W;
    }
    void wth;
    const pitch = r() < 0.75 ? basePitch : r.pick(PITCHES) / 12;
    const level = r();
    const eaveZ = level < 0.82 ? 3 : level < 0.92 ? 5.8 : 2.4;
    const kind = r() < (hipStyle ? 0.65 : 0.25) ? 'hip' : 'gable';
    wings.push({ cx, cy, th: th2, L: Lw, W: Ww, kind, s: pitch, sEnd: pitch, eaveZ });
  }
  // dormers / small cross gables on the main roof
  if (r() < 0.25) {
    const U = [Math.cos(th), Math.sin(th)], V = [-Math.sin(th), Math.cos(th)]; const sgn = r() < 0.5 ? -1 : 1;
    const t = r.range(-main.L / 3, main.L / 3); const dW = r.range(1.6, 2.6), dL = r.range(2, 3.5);
    const dist = main.W / 2 - dL / 2 - r.range(0.3, 1.2);
    const runIn = main.W / 2 - (dist + dL / 2);
    wings.push({ cx: U[0] * t + V[0] * dist * sgn, cy: U[1] * t + V[1] * dist * sgn, th: th + Math.PI / 2, L: dL, W: dW, kind: 'gable', s: r.pick([6, 8, 10, 12]) / 12, sEnd: 1, eaveZ: 3 + runIn * basePitch + r.range(0.4, 0.9) });
  }
  return wings;
}

// ---------- DSM rendering
function gaussBlur(a, w, h, sigma) {
  if (sigma <= 0) return a;
  const rad = Math.ceil(sigma * 2.5); const k = []; let ks = 0;
  for (let i = -rad; i <= rad; i++) { const v = Math.exp(-i * i / (2 * sigma * sigma)); k.push(v); ks += v; }
  for (let i = 0; i < k.length; i++) k[i] /= ks;
  const t = new Float32Array(w * h), o = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { let s = 0; for (let i = -rad; i <= rad; i++) s += k[i + rad] * a[y * w + Math.min(w - 1, Math.max(0, x + i))]; t[y * w + x] = s; }
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { let s = 0; for (let i = -rad; i <= rad; i++) s += k[i + rad] * t[Math.min(h - 1, Math.max(0, y + i)) * w + x]; o[y * w + x] = s; }
  return o;
}

export function render(wings, r, opt = {}) {
  const px = 0.1;
  const wps = wings.map(wingPlanes);
  let e0 = Infinity, e1 = -Infinity, n0 = Infinity, n1 = -Infinity;
  for (const wp of wps) for (const p of wp.rect) { e0 = Math.min(e0, p[0]); e1 = Math.max(e1, p[0]); n0 = Math.min(n0, p[1]); n1 = Math.max(n1, p[1]); }
  const pad = 5; const E0 = Math.floor(e0 - pad), N0 = Math.ceil(n1 + pad);
  const w = Math.ceil((e1 + pad - E0) / px), h = Math.ceil((N0 - (n0 - pad)) / px);
  const hard = opt.hard ?? r() < 0.4;
  const noise = opt.noise ?? (hard ? r.range(0.03, 0.07) : r.range(0.015, 0.045)), blur = opt.blur ?? (hard ? r.range(1.6, 3.0) : r.range(0.6, 1.8));
  const dsm = new Float32Array(w * h), mask = new Uint8Array(w * h);
  const ss = [[0.25, 0.25], [0.75, 0.25], [0.25, 0.75], [0.75, 0.75]];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let zs = 0, inside = 0;
    for (const [dx, dy] of ss) { const p = [E0 + (x + dx) * px, N0 - (y + dy) * px]; const z = surfaceZ(wps, p); if (z > -Infinity) { zs += z; inside++; } }
    const i = y * w + x;
    dsm[i] = (zs + (4 - inside) * 0) / 4;           // ground at 0
    mask[i] = inside >= 2 ? 1 : 0;
  }
  const clutter = [];
  // chimneys and vents
  const nCh = opt.clutter === false ? 0 : r.int(0, 2), nV = opt.clutter === false ? 0 : r.int(0, 6);
  const roofPx = []; for (let i = 0; i < w * h; i += 37) if (mask[i]) roofPx.push(i);
  const bump = (cx, cy, sx, sy, dz, flat) => { for (let y = Math.max(0, Math.floor(cy - sy)); y < Math.min(h, cy + sy); y++) for (let x = Math.max(0, Math.floor(cx - sx)); x < Math.min(w, cx + sx); x++) { const i = y * w + x; if (!mask[i]) continue; dsm[i] = flat ? Math.max(dsm[i], flat) : dsm[i] + dz; } };
  for (let k = 0; k < nCh && roofPx.length; k++) { const i = r.pick(roofPx); const x = i % w, y = (i - x) / w; bump(x, y, r.int(4, 8), r.int(4, 9), 0, dsm[i] + r.range(0.8, 1.5)); clutter.push('chimney'); }
  for (let k = 0; k < nV && roofPx.length; k++) { const i = r.pick(roofPx); const x = i % w, y = (i - x) / w; bump(x, y, 2, 2, r.range(0.15, 0.35)); }
  // tree canopy over part of the roof
  const treePx = new Uint8Array(w * h);
  const nT = opt.trees ?? (r() < 0.35 ? r.int(1, 2) : 0);
  const edgePx = []; for (let y = 1; y < h - 1; y += 3) for (let x = 1; x < w - 1; x += 3) { const i = y * w + x; if (mask[i] && (!mask[i - 1] || !mask[i + 1] || !mask[i - w] || !mask[i + w])) edgePx.push(i); }
  for (let k = 0; k < nT && edgePx.length; k++) {
    const i = r.pick(edgePx); const cx = i % w, cy = (i - cx) / w; const rad = r.range(15, 40); const top = 3 + r.range(3, 8); const dropMask = r() < 0.5;
    for (let y = Math.max(0, Math.floor(cy - rad)); y < Math.min(h, cy + rad); y++) for (let x = Math.max(0, Math.floor(cx - rad)); x < Math.min(w, cx + rad); x++) {
      const d = Math.hypot(x - cx, y - cy) / rad; if (d > 1) continue; const j = y * w + x;
      dsm[j] = Math.max(dsm[j], top - d * d * 2.5 + r.gauss() * 0.25); if (dropMask) mask[j] = 0; treePx[j] = 1;
    }
    clutter.push(dropMask ? 'tree-cut' : 'tree');
  }
  let out = gaussBlur(dsm, w, h, blur);
  // correlated low-frequency noise + white noise
  const lf = new Float32Array(w * h); for (let i = 0; i < w * h; i++) lf[i] = r.gauss();
  const lfb = gaussBlur(lf, w, h, 6); let sd = 0; for (let i = 0; i < w * h; i += 11) sd += lfb[i] * lfb[i]; sd = Math.sqrt(sd / (w * h / 11)) || 1;
  const lfAmp = hard ? r.range(0.03, 0.09) : r.range(0.0, 0.04);
  for (let i = 0; i < w * h; i++) out[i] += r.gauss() * noise + lfb[i] / sd * lfAmp;
  // mask edge raggedness: erode/dilate by a pixel in random spots
  const m2 = new Uint8Array(mask);
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) { const i = y * w + x; const edge = mask[i - 1] !== mask[i] || mask[i + 1] !== mask[i] || mask[i - w] !== mask[i] || mask[i + w] !== mask[i]; if (edge && r() < 0.25) m2[i] = 1 - mask[i]; }
  // aerial colour layer like Google's (same grid): grey shingles, green canopy and lawn, grey paving. Uses a hash, not the
  // scene RNG, so adding it did not change any house, tree or noise value of earlier benchmark runs.
  const hsh = (i, k) => { let v = Math.imul(i + 1, 2654435761) ^ Math.imul(k + 7, 40503); v ^= v >>> 15; v = Math.imul(v, 2246822519); v ^= v >>> 13; return (v >>> 0) / 4294967296; };
  const R = new Uint8Array(w * h), G = new Uint8Array(w * h), B = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) {
    const n = (hsh(i, 1) - 0.5) * 24; let c;
    if (treePx[i]) c = [40 + hsh(i, 2) * 30, 78 + hsh(i, 3) * 40, 34 + hsh(i, 4) * 24];
    else if (mask[i]) { const rc = opt.roofColor || [118, 116, 124]; c = [rc[0] + n, rc[1] + n, rc[2] + n]; }   // opt.roofColor: warm roofs (tan, olive, weathered wood) for colourtest.mjs
    else c = hsh(Math.floor((i % w) / 40) + 977 * Math.floor(i / w / 40), 5) < 0.6 ? [70 + n, 112 + n, 58 + n] : [150 + n, 148 + n, 144 + n];
    R[i] = Math.max(0, Math.min(255, c[0])); G[i] = Math.max(0, Math.min(255, c[1])); B[i] = Math.max(0, Math.min(255, c[2]));
  }
  return { w, h, px, dsm: out, mask: m2, rgb: [R, G, B], E0, N0, meta: { noise, blur, clutter, hard } };
}
