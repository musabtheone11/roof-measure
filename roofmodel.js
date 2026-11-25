'use strict';
/* roofmodel.js - one place for the roof's coordinate math, measurement rules and geometry audit.
 * Pure functions (no DOM, no Google Maps): the browser app, the PDF report and the Node benchmark all call these, so the
 * numbers on screen, in the PDF and in the benchmark are the same numbers.
 *
 * Coordinates: facets and lines are stored as {lat, lng} paths. Lengths and areas are computed on a local plane tangent to
 * the WGS84 ellipsoid at the roof (metres per degree from the meridian and prime-vertical radii at that latitude). At roof
 * scale this is exact to well under a millimetre; the spherical formulas used before read north-south distances 0.4% long.
 *
 * Measurement rules (the counting rules printed in the report):
 *  - Projected (plan) area and sloped (surface) area are separate numbers. Sloped = plan x sqrt(1 + slope^2).
 *    The slope is the plane fitted to the height model when the facet was auto-traced ("fitted"), or the pitch a person
 *    assigned ("assigned"). Totals are sums of unrounded values; rounding happens only when a number is printed.
 *  - A line's true length = plan length x a slope factor. For an auto-traced line the factor comes from the roof plane the
 *    line lies in ("plane"). For a hand-drawn line it comes from the adjoining facet's pitch and the line type ("pitch":
 *    level types x1, rakes / step flashing x rafter factor, hips / valleys x hip factor for a 90-degree corner).
 *  - Each physical line is counted once in its own category. A height break is two physical lines on one plan line (the
 *    upper roof's eave or rake, and the flashing where the lower roof meets the wall); both are real and both are counted,
 *    each in its own category, never twice in the same one. Duplicate lines of the same category on the same stretch are
 *    reported by the audit as an error (they are counted twice until removed: the export gate asks first).
 *  - Every facet and line carries a status: measured, inferred (with evidence and, when known, a range) or unresolved
 *    (with what is missing). Unresolved quantities are never reported as zero: they are listed and the totals are flagged.
 *  - A category with no lines reads 0 only when every facet boundary is classified; outline left unclassified is reported
 *    as "unclassified boundary" so "none" and "not classified" cannot be confused.
 */
var RM = (function () {
  const SQFT = 10.7639104, FT = 3.28084;
  const A = 6378137, E2 = 0.00669437999014;
  // metres per degree of longitude (kx) and latitude (ky) on the WGS84 ellipsoid at this latitude
  function scale(lat) {
    const s = Math.sin(lat * Math.PI / 180), c = Math.cos(lat * Math.PI / 180), q = 1 - E2 * s * s;
    return { kx: (A / Math.sqrt(q)) * c * Math.PI / 180, ky: (A * (1 - E2) / Math.pow(q, 1.5)) * Math.PI / 180 };
  }
  function frame(paths) {
    let lat = 0, lng = 0, n = 0; for (const p of paths) for (const v of p) { lat += v.lat; lng += v.lng; n++; }
    if (!n) return null; lat /= n; lng /= n; const k = scale(lat);
    return { lat, lng, kx: k.kx, ky: k.ky, xy: (v) => [(v.lng - lng) * k.kx, (v.lat - lat) * k.ky], ll: (p) => ({ lat: lat + p[1] / k.ky, lng: lng + p[0] / k.kx }) };
  }
  const local = (path, o) => { const k = o || scale(path[0].lat); const kx = k.kx, ky = k.ky, b = path[0]; return path.map((v) => [(v.lng - b.lng) * kx, (v.lat - b.lat) * ky]); };
  const ringArea = (r) => { let s = 0; for (let i = 0; i < r.length; i++) { const a = r[i], b = r[(i + 1) % r.length]; s += a[0] * b[1] - b[0] * a[1]; } return s / 2; };
  const lineLen = (r) => { let s = 0; for (let i = 1; i < r.length; i++) s += Math.hypot(r[i][0] - r[i - 1][0], r[i][1] - r[i - 1][1]); return s; };
  const planSqft = (path) => (path.length < 3 ? 0 : Math.abs(ringArea(local(path))) * SQFT);
  const planFt = (path) => (path.length < 2 ? 0 : lineLen(local(path)) * FT);
  const perimeterFt = (path) => (path.length < 2 ? 0 : lineLen(local([...path, path[0]])) * FT);
  const pitchFactor = (p) => Math.sqrt(144 + p * p) / 12;
  const hipFactor = (p) => Math.sqrt(1 + (p * p) / 288);
  const SLOPE_KIND = { eave: 'flat', valley: 'hip', hip: 'hip', ridge: 'flat', rake: 'rake', wall: 'flat', step: 'rake', transition: 'flat', parapet: 'flat', unspecified: 'flat' };
  const typeFactor = (type, pitch) => { const k = SLOPE_KIND[type] || 'flat'; return k === 'flat' ? 1 : k === 'rake' ? pitchFactor(pitch) : hipFactor(pitch); };
  const pointSeg = (p, a, b) => { const dx = b[0] - a[0], dy = b[1] - a[1]; const l2 = dx * dx + dy * dy || 1e-12; let t = ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2; t = Math.max(0, Math.min(1, t)); return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy); };
  const STATUS = ['measured', 'inferred', 'unresolved'];
  const statusOf = (x) => (STATUS.includes(x && x.status) ? x.status : 'measured');

  // ---- facet and line measurements
  // facet: {path, pitch, slope?(rise/run, fitted), excluded?}   line: {type, path, pitch?(override), factor?(plane), autoType?}
  function facetMeasure(f) {
    const plan = planSqft(f.path);
    const fitted = f.slope != null && isFinite(f.slope);
    const factor = fitted ? Math.sqrt(1 + f.slope * f.slope) : pitchFactor(f.pitch || 0);
    return { plan, factor, sloped: plan * factor, basis: fitted ? 'fitted' : 'assigned', slope12: fitted ? f.slope * 12 : (f.pitch || 0), perimeterFt: perimeterFt(f.path) };
  }
  function lineMeasure(e, adjoiningPitch, defaultPitch) {
    const plan = planFt(e.path);
    let factor, basis, pitch = null;
    if (e.pitch != null) { pitch = e.pitch; factor = typeFactor(e.type, pitch); basis = 'pitch (set by hand)'; }
    else if (e.factor != null && isFinite(e.factor) && (!e.autoType || e.autoType === e.type)) { factor = e.factor; basis = 'plane'; }
    else { pitch = adjoiningPitch != null ? adjoiningPitch : defaultPitch; factor = typeFactor(e.type, pitch); basis = adjoiningPitch != null ? 'pitch (adjoining facet)' : 'pitch (default: assumed)'; }
    return { planFt: plan, factor, trueFt: plan * factor, basis, pitch, lengthKind: factor < 1.002 ? 'horizontal' : (basis === 'plane' ? 'sloped (measured plane)' : 'sloped (' + basis + ')') };
  }

  // ---- geometry audit. facets: [{name, path, excluded, level, omit}], lines: [{type, path, omit}]
  // returns { issues: [{severity:'error'|'warn'|'info', code, message, facet?, line?, at:{lat,lng}}], unclassifiedFt, ok }
  function audit(facets, lines, opt) {
    const o = Object.assign({ gapM: 0.6, joinM: 0.05, artifactSqft: 4, artifactWidthFt: 0.5, overlapSqft: 6, dupFt: 1.5, coverM: 0.45 }, opt || {});
    const F = facets.filter((f) => !f.omit), L = lines.filter((e) => !e.omit); const issues = [];
    const fr = frame([...F.map((f) => f.path), ...L.map((e) => e.path)]);
    if (!fr) return { issues, unclassifiedFt: 0, ok: true };
    const P = F.map((f) => f.path.map(fr.xy)), Q = L.map((e) => e.path.map(fr.xy));
    const push = (severity, code, message, extra) => issues.push(Object.assign({ severity, code, message }, extra));
    const cross = (r) => { const n = r.length; let c = 0; if (n < 4) return 0; const od = (p, q, t) => (q[0] - p[0]) * (t[1] - p[1]) - (q[1] - p[1]) * (t[0] - p[0]);
      for (let i = 0; i < n; i++) { const a = r[i], b = r[(i + 1) % n]; for (let j = i + 2; j < n; j++) { if (i === 0 && j === n - 1) continue; const p = r[j], q = r[(j + 1) % n]; const d1 = od(a, b, p), d2 = od(a, b, q), d3 = od(p, q, a), d4 = od(p, q, b), e = 1e-7; if (((d1 > e && d2 < -e) || (d1 < -e && d2 > e)) && ((d3 > e && d4 < -e) || (d3 < -e && d4 > e))) c++; } } return c; };
    F.forEach((f, i) => {
      const r = P[i], at = f.path[0]; const a = Math.abs(ringArea(r)) * SQFT, per = lineLen([...r, r[0]]) * FT;
      if (r.length < 3) { push('error', 'degenerate', `${f.name}: fewer than 3 corners`, { facet: f.name, at }); return; }
      const c = cross(r); if (c) push('error', 'self-intersection', `${f.name}: outline crosses itself (${c} place${c > 1 ? 's' : ''})`, { facet: f.name, at });
      let dup = 0; for (let k = 0; k < r.length; k++) if (Math.hypot(r[k][0] - r[(k + 1) % r.length][0], r[k][1] - r[(k + 1) % r.length][1]) < 0.03) dup++;
      if (dup) push('warn', 'duplicate-vertex', `${f.name}: ${dup} doubled corner${dup > 1 ? 's' : ''}`, { facet: f.name, at, fixable: true });
      const width = per > 0 ? 2 * a / per : 0;
      if (!f.excluded && (a < o.artifactSqft || width < o.artifactWidthFt)) push('warn', 'artifact', `${f.name}: ${a.toFixed(1)} sq ft, ${width.toFixed(1)} ft wide - likely a tracing artifact (kept; delete it if it is not a real facet)`, { facet: f.name, at });
    });
    // overlaps between facets of the same roof level (rasterised at 0.15 m)
    { const cell = 0.15; let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity; for (const r of P) for (const p of r) { if (p[0] < x0) x0 = p[0]; if (p[0] > x1) x1 = p[0]; if (p[1] < y0) y0 = p[1]; if (p[1] > y1) y1 = p[1]; }
      const w = Math.min(4000, Math.ceil((x1 - x0) / cell) + 2), h = Math.min(4000, Math.ceil((y1 - y0) / cell) + 2);
      if (w > 1 && h > 1 && w * h <= 9e6) {
        const own = new Int16Array(w * h).fill(-1); const pair = new Map();
        F.forEach((f, i) => { if (f.excluded) return; const r = P[i];
          let ry0 = Infinity, ry1 = -Infinity; for (const p of r) { if (p[1] < ry0) ry0 = p[1]; if (p[1] > ry1) ry1 = p[1]; }
          for (let gy = Math.max(0, Math.floor((ry0 - y0) / cell)); gy <= Math.min(h - 1, Math.ceil((ry1 - y0) / cell)); gy++) {
            const y = y0 + (gy + 0.5) * cell; const xs = [];
            for (let k = 0; k < r.length; k++) { const a = r[k], b = r[(k + 1) % r.length]; if ((a[1] > y) !== (b[1] > y)) xs.push(a[0] + (y - a[1]) * (b[0] - a[0]) / (b[1] - a[1])); }
            xs.sort((p, q) => p - q);
            for (let k = 0; k + 1 < xs.length; k += 2) for (let gx = Math.max(0, Math.ceil((xs[k] - x0) / cell - 0.5)); gx <= Math.min(w - 1, Math.floor((xs[k + 1] - x0) / cell - 0.5)); gx++) {
              const j = gy * w + gx, prev = own[j];
              if (prev >= 0 && prev !== i && (F[prev].level || 1) === (f.level || 1)) { const key = prev + ',' + i; const v = pair.get(key) || { n: 0, sx: 0, sy: 0 }; v.n++; v.sx += gx; v.sy += gy; pair.set(key, v); }
              own[j] = i;
            } } });
        for (const [key, v] of pair) { const [i, j] = key.split(',').map(Number); const sq = v.n * cell * cell * SQFT; const small = Math.min(Math.abs(ringArea(P[i])), Math.abs(ringArea(P[j]))) * SQFT;
          if (sq >= o.overlapSqft && sq >= 0.03 * small) push('error', 'overlap', `${F[i].name} and ${F[j].name} overlap by ${sq.toFixed(0)} sq ft on the same roof level (that area is counted twice)`, { facet: F[i].name, facet2: F[j].name, overlapSqft: sq, at: fr.ll([x0 + (v.sx / v.n + 0.5) * cell, y0 + (v.sy / v.n + 0.5) * cell]) }); }
      } }
    // near-miss joins: a corner that sits 5-60 cm from another facet's corner or side without touching it
    { let gaps = 0, first = null;
      F.forEach((f, i) => { for (const v of P[i]) { let best = Infinity; F.forEach((g, j) => { if (j === i) return; const r = P[j]; for (let k = 0; k < r.length; k++) { const d = pointSeg(v, r[k], r[(k + 1) % r.length]); if (d < best) best = d; } }); if (best > o.joinM && best < o.gapM) { gaps++; if (!first) first = { facet: f.name, at: fr.ll(v), d: best }; } } });
      if (gaps) push('warn', 'join-gap', `${gaps} corner${gaps > 1 ? 's' : ''} sit close to a neighbouring facet without meeting it (first: ${first.facet}, ${(first.d * FT * 12).toFixed(0)} in. off)`, { facet: first.facet, at: first.at, fixable: true }); }
    // duplicate lines: same category on the same stretch
    { const seg = []; L.forEach((e, i) => { const r = Q[i]; for (let k = 1; k < r.length; k++) seg.push({ i, type: e.type, a: r[k - 1], b: r[k] }); });
      const seen = new Set();
      const len = (g) => Math.hypot(g.b[0] - g.a[0], g.b[1] - g.a[1]);
      for (let p = 0; p < seg.length; p++) for (let q = p + 1; q < seg.length; q++) { if (seg[p].i === seg[q].i || seg[p].type !== seg[q].type) continue;
        // the longer piece is the base, so the result does not depend on drawing order; the overlap is the shared interval
        // of the two pieces along it (a partial overlap counts, not only one piece lying wholly on the other)
        const s = len(seg[p]) >= len(seg[q]) ? seg[p] : seg[q], t = s === seg[p] ? seg[q] : seg[p];
        const d = [s.b[0] - s.a[0], s.b[1] - s.a[1]]; const Ls = Math.hypot(d[0], d[1]); if (Ls < 0.05) continue;
        const off = (pt) => Math.abs((pt[0] - s.a[0]) * d[1] - (pt[1] - s.a[1]) * d[0]) / Ls; if (off(t.a) > 0.25 || off(t.b) > 0.25) continue;
        const u0 = ((t.a[0] - s.a[0]) * d[0] + (t.a[1] - s.a[1]) * d[1]) / Ls, u1 = ((t.b[0] - s.a[0]) * d[0] + (t.b[1] - s.a[1]) * d[1]) / Ls; const ov = Math.min(Ls, Math.max(u0, u1)) - Math.max(0, Math.min(u0, u1));
        if (ov * FT >= o.dupFt) { const key = Math.min(s.i, t.i) + ',' + Math.max(s.i, t.i); if (seen.has(key)) continue; seen.add(key); push('error', 'duplicate-line', `Two ${s.type} lines lie on the same ${(ov * FT).toFixed(0)} ft stretch (counted twice)`, { line: s.i, line2: t.i, dupFt: ov * FT, at: fr.ll([(s.a[0] + s.b[0]) / 2, (s.a[1] + s.b[1]) / 2]), fixable: true }); } } }
    // lines that are not on any facet boundary, and facet outline that no line classifies
    let unclassified = 0;
    if (F.length) {
      L.forEach((e, i) => { const r = Q[i]; const mid = [(r[0][0] + r[r.length - 1][0]) / 2, (r[0][1] + r[r.length - 1][1]) / 2]; let best = Infinity; for (const fr2 of P) for (let k = 0; k < fr2.length; k++) { const d = pointSeg(mid, fr2[k], fr2[(k + 1) % fr2.length]); if (d < best) best = d; } if (best > 1.2 && lineLen(r) * FT > 3) push('info', 'floating-line', `A ${e.type} line (${(lineLen(r) * FT).toFixed(0)} ft) is not on any facet edge`, { line: i, at: e.path[0] }); });
      F.forEach((f, i) => { if (f.excluded) return; const r = P[i]; for (let k = 0; k < r.length; k++) { const a = r[k], b = r[(k + 1) % r.length]; const Ls = Math.hypot(b[0] - a[0], b[1] - a[1]); const n = Math.max(1, Math.round(Ls / 0.3));
        for (let s = 0; s < n; s++) { const p = [a[0] + (b[0] - a[0]) * (s + 0.5) / n, a[1] + (b[1] - a[1]) * (s + 0.5) / n]; let cov = false; for (const q of Q) { for (let m = 1; m < q.length && !cov; m++) if (pointSeg(p, q[m - 1], q[m]) < o.coverM) cov = true; if (cov) break; }
          // a stretch shared with an earlier facet was already counted when that facet was walked
          if (!cov) for (let j = 0; j < i && !cov; j++) { if (F[j].excluded) continue; const r2 = P[j]; for (let m = 0; m < r2.length && !cov; m++) if (pointSeg(p, r2[m], r2[(m + 1) % r2.length]) < 0.05) cov = true; }
          if (!cov) unclassified += Ls / n; } } });
      if (unclassified * FT > 2) push('warn', 'unclassified-boundary', `${(unclassified * FT).toFixed(0)} ft of facet outline has no line type (not counted in any category; this is "not classified", not "none")`, { unclassifiedFt: unclassified * FT });
    }
    return { issues, unclassifiedFt: unclassified * FT, ok: !issues.some((x) => x.severity === 'error') };
  }

  // ---- safe automatic fixes on plain paths. Returns { facets: [{path}], lines: [{path}|null], log: [..] } (null = drop the line)
  function autoFix(facets, lines) {
    const log = []; const fr = frame([...facets.map((f) => f.path), ...lines.map((e) => e.path)]); if (!fr) return { facets: [], lines: [], log };
    let P = facets.map((f) => f.path.map(fr.xy)); const Q = lines.map((e) => e.path.map(fr.xy));
    // 1. doubled corners
    P = P.map((r, i) => { const o = []; for (const p of r) { const q = o[o.length - 1]; if (q && Math.hypot(p[0] - q[0], p[1] - q[1]) < 0.03) continue; o.push(p); } while (o.length > 3 && Math.hypot(o[0][0] - o[o.length - 1][0], o[0][1] - o[o.length - 1][1]) < 0.03) o.pop(); if (o.length !== r.length) log.push(`${facets[i].name}: removed ${r.length - o.length} doubled corner(s)`); return o; });
    // 2. corners within 30 cm of each other become one shared corner (cluster to the first one seen)
    { const pts = []; let moved = 0; const snap = (p) => { for (const s of pts) if (Math.hypot(s[0] - p[0], s[1] - p[1]) < 0.3) { if (s[0] !== p[0] || s[1] !== p[1]) moved++; return s; } pts.push(p); return p; };
      const ring = (r) => { const used = new Set(); return r.map((p) => { const s = snap(p); if (s !== p && used.has(s)) return p; used.add(s); return s; }); };   // never two corners of one shape onto one point
      P = P.map(ring); for (let i = 0; i < Q.length; i++) Q[i] = ring(Q[i]);
      if (moved) log.push(`Joined ${moved} near-miss corner(s) to their neighbour (moved less than 12 in.)`); }
    // 3. duplicate lines of the same type on the same stretch: keep the longer one
    const drop = new Set();
    for (let i = 0; i < Q.length; i++) for (let j = i + 1; j < Q.length; j++) {
      if (drop.has(i) || drop.has(j) || lines[i].type !== lines[j].type) continue; const a = Q[i], b = Q[j];
      // every part of r, not only its corner points, must lie on s (a line across a V of two others touches them only at its ends)
      const on = (p, s) => { for (let k = 1; k < s.length; k++) if (pointSeg(p, s[k - 1], s[k]) < 0.25) return true; return false; };
      const inside = (r, s) => { for (let k = 1; k < r.length; k++) for (const t of [0, 0.25, 0.5, 0.75, 1]) if (!on([r[k - 1][0] + (r[k][0] - r[k - 1][0]) * t, r[k - 1][1] + (r[k][1] - r[k - 1][1]) * t], s)) return false; return r.length > 1; };
      if (inside(b, a)) { drop.add(j); log.push(`Removed a duplicate ${lines[j].type} line (${(lineLen(b) * FT).toFixed(0)} ft) lying on another one`); } else if (inside(a, b)) { drop.add(i); log.push(`Removed a duplicate ${lines[i].type} line (${(lineLen(a) * FT).toFixed(0)} ft) lying on another one`); }
    }
    return { facets: P.map((r) => ({ path: r.map(fr.ll) })), lines: Q.map((r, i) => (drop.has(i) ? null : { path: r.map(fr.ll) })), log };
  }

  // ---- reconciliation: every printed subtotal must be a sum of the same unrounded parts
  // facets: [{sloped, plan, pitch, status, excluded}]   lines: [{type, trueFt, status}]   totals: what the app is about to print
  function reconcile(facetRows, lineRows, totals) {
    const checks = []; const near = (a, b) => Math.abs(a - b) <= 1e-6 * Math.max(1, Math.abs(a), Math.abs(b));
    const add = (name, a, b, unit) => checks.push({ name, a, b, unit, ok: near(a, b) });
    const inc = facetRows.filter((f) => !f.excluded), exc = facetRows.filter((f) => f.excluded);
    const net = inc.reduce((s, f) => s + f.sloped, 0) - exc.reduce((s, f) => s + f.sloped, 0);
    add('Net sloped area = sum of facets - excluded cut-outs', totals.sloped, net, 'sq ft');
    add('Net plan area = sum of facet plan areas - cut-outs', totals.plan, inc.reduce((s, f) => s + f.plan, 0) - exc.reduce((s, f) => s + f.plan, 0), 'sq ft');
    add('Pitch table adds up to the net sloped area', Object.values(totals.pitchGroups || {}).reduce((s, v) => s + v, 0), net, 'sq ft');
    const by = (st) => inc.filter((f) => (f.status || 'measured') === st).reduce((s, f) => s + f.sloped, 0);
    add('Measured + inferred + unresolved area = gross facet area', by('measured') + by('inferred') + by('unresolved'), inc.reduce((s, f) => s + f.sloped, 0), 'sq ft');
    const tl = lineRows.reduce((s, e) => s + e.trueFt, 0), tt = Object.values(totals.byType || {}).reduce((s, v) => s + (v.true || 0), 0);
    add('Line totals by type = sum of the line schedule', tt, tl, 'ft');
    return { checks, ok: checks.every((c) => c.ok) };
  }

  // hatch lines for a polygon (unresolved zones): segments of parallel lines at `angleDeg`, `spacing` apart, clipped to the ring
  function hatch(ring, spacing, angleDeg) {
    const a = (angleDeg == null ? 45 : angleDeg) * Math.PI / 180, ca = Math.cos(a), sa = Math.sin(a); const out = [];
    const R = ring.map((p) => [p[0] * ca + p[1] * sa, -p[0] * sa + p[1] * ca]);           // rotate so hatch lines are horizontal
    let y0 = Infinity, y1 = -Infinity; for (const p of R) { if (p[1] < y0) y0 = p[1]; if (p[1] > y1) y1 = p[1]; }
    for (let y = y0 + spacing / 2; y < y1; y += spacing) { const xs = [];
      for (let i = 0; i < R.length; i++) { const p = R[i], q = R[(i + 1) % R.length]; if ((p[1] > y) !== (q[1] > y)) xs.push(p[0] + (y - p[1]) * (q[0] - p[0]) / (q[1] - p[1])); }
      xs.sort((p, q) => p - q);
      for (let i = 0; i + 1 < xs.length; i += 2) out.push([[xs[i] * ca - y * sa, xs[i] * sa + y * ca], [xs[i + 1] * ca - y * sa, xs[i + 1] * sa + y * ca]]); }
    return out;
  }
  // The report's status from plain facts about the sketch and the imagery (shared by the app, the PDF and the tests).
  // COMPLETE only when every reported value was measured on georeferenced imagery and nothing affecting the totals is
  // open; otherwise REVIEW REQUIRED, each reason with the evidence that would settle it. f = {
  //   failed, facets, hiddenZones: [{id}], hiddenUpperSqft, inferredSqft, unresolved: [{label, missing}], verify: [{label}],
  //   geometryErrors, reconcileOk, imageryQuality, layerChoice: {used, recordDate, recordQuality, layersDate, buildingInLayers}, extra: [{code,text,needs}] }
  function reportStatus(f) {
    const why = []; const add = (code, text, needs) => why.push({ code, text, needs }); const n0 = (v) => Math.round(v).toLocaleString('en-US');
    const fd = (d) => (!d ? '?' : typeof d === 'string' ? d : `${d.year}-${String(d.month).padStart(2, '0')}-${String(d.day).padStart(2, '0')}`);
    if (!f.facets) add('no-roof', f.failed || 'No roof was traced.', 'Imagery that shows the building, or a hand trace / site measurement.');
    const z = f.hiddenZones || []; if (z.length) add('hidden', `Roof under tree canopy that no image shows: ${z.map((q) => q.id).join(', ')} (0 to ${n0(f.hiddenUpperSqft || 0)} sq ft, in no total).`, 'An image without the canopy (another date, an oblique or drone photo) or a site measurement of those sections.');
    if ((f.inferredSqft || 0) > 0.5) add('estimate', `${n0(f.inferredSqft)} sq ft is an estimate placed from evidence under canopy, not a measurement.`, 'Confirm on imagery of another date or on site.');
    const u = f.unresolved || []; if (u.length) add('unresolved', `${u.length} item${u.length > 1 ? 's' : ''} marked unresolved: ${u.slice(0, 4).map((q) => q.label).join(', ')}.`, u[0].missing || 'Resolve before ordering.');
    const v = f.verify || []; if (v.length) add('verify', `${v.length} item${v.length > 1 ? 's' : ''} marked for verification: ${v.slice(0, 4).map((q) => q.label).join(', ')}.`, 'Check on site or on a view that can measure them.');
    if (f.geometryErrors) add('geometry', `${f.geometryErrors} geometry error${f.geometryErrors > 1 ? 's' : ''} that can change the totals.`, 'Fix in "5. Review before export".');
    if (f.facets && f.reconcileOk === false) add('reconcile', 'A subtotal does not reconcile with the sketch.', 'Fix the sketch before ordering.');
    const q = String(f.imageryQuality || '').toUpperCase(); if (f.facets && q && q !== 'HIGH') add('imagery-quality', `The trace image is ${q.toLowerCase()} quality: edges are good to about 1.3 ft, not 0.3 ft.`, 'High-quality or newer imagery, or a site check of the eaves and rakes.');
    const lc = f.layerChoice;
    if (lc && lc.used === 'record') add('imagery-change', `The best image (${fd(lc.layersDate)}) shows no building here; the roof was traced from Google's newer ${String(lc.recordQuality).toLowerCase()} quality image (${fd(lc.recordDate)}).`, 'Confirm the outline on newer imagery or on site.');
    else if (lc && lc.buildingInLayers) add('imagery-change', `Google's building record comes from a newer image (${fd(lc.recordDate)}) than the image traced (${fd(lc.layersDate)}): the roof may have changed since the traced image.`, 'Compare the dated imagery (Review roof from other angles) or check on site.');
    for (const x of f.extra || []) why.push(x);
    return { status: why.length ? 'REVIEW REQUIRED' : 'COMPLETE', reasons: why };
  }
  return { reportStatus, hatch, SQFT, FT, scale, frame, local, ringArea, planSqft, planFt, perimeterFt, pitchFactor, hipFactor, typeFactor, SLOPE_KIND, facetMeasure, lineMeasure, audit, autoFix, reconcile, statusOf, pointSeg };
})();
if (typeof module !== 'undefined' && module.exports) module.exports = RM;
