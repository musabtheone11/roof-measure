// Turn independent vision observations into evidence-checked proposals and an edited roof model.
//   node bench/vision/fuse.mjs --slug <slug> --run <run dir with roof.json> --obs <observations.json> --out <dir> [--apply] [--min-support 0.6]
// Rules (from the brief): every observation is a candidate; it is validated against measurable data (the height model and
// building mask, read locally) before anything changes. Several models agreeing on one image count as ONE source; the
// height model is the second source and a correction needs it. A corner moves only when the two wall lines re-fitted
// through the new corner follow the height step / mask boundary better than the old ones and the roof surface continues to
// the new corner. Lines are renamed only when the height model supports the new name (an outer edge steps down, an interior
// line only bends). Anything the sources cannot settle stays open: the affected facet is marked unresolved with the
// evidence, never guessed. The core is exported for the CI fixture (synthetic scenes); the CLI reads the private cache.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const OUTLINE = new Set(['eave', 'rake', 'outline']), INTERIOR = new Set(['ridge', 'hip', 'valley', 'transition', 'step', 'wall']);
const segDist = (p, a, b) => { const L2 = (b[0] - a[0]) ** 2 + (b[1] - a[1]) ** 2; const t = L2 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * (b[0] - a[0]) + (p[1] - a[1]) * (b[1] - a[1])) / L2)) : 0; return Math.hypot(p[0] - a[0] - t * (b[0] - a[0]), p[1] - a[1] - t * (b[1] - a[1])); };
const angDiff = (a1, b1, a2, b2) => { let d = Math.abs(Math.atan2(b1[1] - a1[1], b1[0] - a1[0]) - Math.atan2(b2[1] - a2[1], b2[0] - a2[0])) % Math.PI; return Math.min(d, Math.PI - d) * 180 / Math.PI; };
const dist = (p, q) => Math.hypot(p[0] - q[0], p[1] - q[1]);

// rasters: { w, h, data, toLL(x, y) -> {lat, lng} } (GeoTIFF from the cache or a synthetic scene)
export function fuseModel({ job, obs, dsm, mask, minSupport = 0.6 }) {
  const all = job.facets.flatMap((f) => f.path); const c0 = { lat: all.reduce((s, p) => s + p.lat, 0) / all.length, lng: all.reduce((s, p) => s + p.lng, 0) / all.length };
  const kx = 111320 * Math.cos(c0.lat * Math.PI / 180), ky = 110540;
  const toM = (p) => [(p.lng - c0.lng) * kx, (p.lat - c0.lat) * ky], toLL = (q) => ({ lat: c0.lat + q[1] / ky, lng: c0.lng + q[0] / kx });
  const rasterIndex = (T) => { const o = T.toLL(0, 0), x1 = T.toLL(1, 0), y1 = T.toLL(0, 1); const dx = x1.lng - o.lng, dy = y1.lat - o.lat; return (q) => { const ll = toLL(q); return [(ll.lng - o.lng) / dx, (ll.lat - o.lat) / dy]; }; };
  const dIdx = rasterIndex(dsm), mIdx = rasterIndex(mask);
  const sample = (T, idx, q) => { const [x, y] = idx(q); const xi = Math.round(x), yi = Math.round(y); if (xi < 0 || yi < 0 || xi >= T.w || yi >= T.h) return null; const v = T.data[yi * T.w + xi]; return isFinite(v) ? v : null; };
  const hAt = (q) => sample(dsm, dIdx, q), mAt = (q) => sample(mask, mIdx, q);
  // evidence along a segment: outline step (one side far lower), crease (surface bends), mask boundary
  function segmentEvidence(a, b) {
    const L = dist(a, b); if (L < 0.3) return { len: L, n: 0, step: 0, crease: 0, maskEdge: 0 };
    const u = [(b[0] - a[0]) / L, (b[1] - a[1]) / L], nrm = [-u[1], u[0]]; const n = Math.max(3, Math.floor(L / 0.25)); let step = 0, crease = 0, maskEdge = 0, maskRoofSide = 0, cnt = 0;
    for (let i = 0; i <= n; i++) { const t = i / n; const q = [a[0] + u[0] * L * t, a[1] + u[1] * L * t];
      const hp = hAt([q[0] + nrm[0] * 0.6, q[1] + nrm[1] * 0.6]), hm = hAt([q[0] - nrm[0] * 0.6, q[1] - nrm[1] * 0.6]), h0 = hAt(q);
      const mp = mAt([q[0] + nrm[0] * 0.5, q[1] + nrm[1] * 0.5]), mm = mAt([q[0] - nrm[0] * 0.5, q[1] - nrm[1] * 0.5]);
      if (hp == null || hm == null || h0 == null) continue; cnt++;
      if (Math.abs(hp - hm) > 1.2) step++;
      if (Math.abs(hp + hm - 2 * h0) > 0.10 && Math.abs(hp - hm) < 1.2) crease++;
      if (mp != null && mm != null && mp !== mm) maskEdge++;
      if ((hp >= hm ? mp : mm) === 1) maskRoofSide++; }   // the building mask covers the higher (roof) side
    return { len: L, n: cnt, step: cnt ? step / cnt : 0, crease: cnt ? crease / cnt : 0, maskEdge: cnt ? maskEdge / cnt : 0, maskRoofSide: cnt ? maskRoofSide / cnt : 0 };
  }
  const outlineSupport = (a, b) => { const e = segmentEvidence(a, b); return Math.max(e.step, e.maskEdge); };
  // lumpiness of the height model along a run (mean absolute second difference at 0.3 m): roof planes ~0.03 m, tree crowns > 0.15 m
  // measured 0.8 m to either side of the run (on the run itself a blurred roof edge reads lumpy); a roof edge has a smooth
  // plane on at least one side, a tree crown is lumpy on both: the smaller of the two is used
  function roughness(a, b, outline = true) { const L = dist(a, b); if (L < 0.9) return null; const u = [(b[0] - a[0]) / L, (b[1] - a[1]) / L], nrm = [-u[1], u[0]];
    const side = (sg) => { const hs = []; for (let t = 0; t <= L; t += 0.3) hs.push(hAt([a[0] + u[0] * t + nrm[0] * 0.8 * sg, a[1] + u[1] * t + nrm[1] * 0.8 * sg])); let s = 0, n = 0, hm = 0, nh = 0; for (const h of hs) if (h != null) { hm += h; nh++; } for (let i = 1; i + 1 < hs.length; i++) if (hs[i - 1] != null && hs[i] != null && hs[i + 1] != null) { s += Math.abs(hs[i - 1] - 2 * hs[i] + hs[i + 1]); n++; } return n ? { rough: s / n, mean: hm / nh } : null; };
    const r1 = side(1), r2 = side(-1); if (!r1 || !r2) return (r1 || r2 || {}).rough ?? null;
    // an outline edge has ground on one side: judge the higher (roof or crown) side; an interior line has roof on both: the smoother side decides
    return outline ? (r1.mean >= r2.mean ? r1.rough : r2.rough) : Math.min(r1.rough, r2.rough); }
  // observations carry about a metre of positional noise: slide a run sideways (up to 1.2 m) to where the evidence is best
  function snapLine(a, b, wantOutline) {
    const L = dist(a, b); if (L < 0.3) return { a, b, off: 0, support: 0 }; const u = [(b[0] - a[0]) / L, (b[1] - a[1]) / L], nrm = [-u[1], u[0]];
    let best = null; for (let off = -1.2; off <= 1.2001; off += 0.1) { const a2 = [a[0] + nrm[0] * off, a[1] + nrm[1] * off], b2 = [b[0] + nrm[0] * off, b[1] + nrm[1] * off]; const e = segmentEvidence(a2, b2); const sup = wantOutline ? Math.max(e.step, e.maskEdge) : e.crease; const score = sup - Math.abs(off) * 0.05; if (!best || score > best.score) best = { a: a2, b: b2, off, support: sup, score }; }
    return best;
  }
  const facetsM = job.facets.map((f, i) => ({ i, f, pts: f.path.map(toM) }));
  const sketchEdges = job.edges.map((e, i) => ({ i, e, a: toM(e.path[0]), b: toM(e.path[e.path.length - 1]) }));
  // nearest sketch line to an observed run: perpendicular offset of the run's ends from the sketch line (not clamped to the
  // segment, so a run that overshoots a corner is still the same line) plus the angle, provided the two overlap along the line
  function nearestSketchEdge(a, b) {
    let best = null;
    for (const s of sketchEdges) {
      const L = dist(s.a, s.b); if (L < 0.3) continue; const u = [(s.b[0] - s.a[0]) / L, (s.b[1] - s.a[1]) / L], nrm = [-u[1], u[0]];
      const perp = (p) => Math.abs((p[0] - s.a[0]) * nrm[0] + (p[1] - s.a[1]) * nrm[1]), along = (p) => (p[0] - s.a[0]) * u[0] + (p[1] - s.a[1]) * u[1];
      const ta = along(a), tb = along(b); const lo = Math.max(0, Math.min(ta, tb)), hi = Math.min(L, Math.max(ta, tb)); const overlap = Math.max(0, hi - lo) / Math.max(0.3, Math.min(L, Math.abs(tb - ta)));
      // a run that does not overlap the sketch line along it is another line (a shed's eave in line with the house's), unless it only overshoots a corner a little
      const gap = Math.max(ta, tb) < 0 ? -Math.max(ta, tb) : Math.min(ta, tb) > L ? Math.min(ta, tb) - L : 0; if (overlap < 0.3 && gap > 1.5) continue;
      const dm = (perp(a) + perp(b)) / 2, ang = angDiff(a, b, s.a, s.b); const score = dm + ang / 30 + (overlap < 0.3 ? 1 : 0);
      if (!best || score < best.score) best = { s, dist: dm, ang, overlap, score };
    }
    return best;
  }
  function nearestVertex(p) { let best = null; for (const F of facetsM) F.pts.forEach((q, k) => { const d = dist(q, p); if (!best || d < best.d) best = { d, F, k, q }; }); return best; }
  // the wall lines meeting at a vertex: the two polygon segments of every facet that has a vertex there
  function wallsAt(v) { const W = []; for (const F of facetsM) F.pts.forEach((q, k) => { if (dist(q, v) < 0.3) { const n = F.pts.length; W.push(F.pts[(k + n - 1) % n]); W.push(F.pts[(k + 1) % n]); } }); return W.filter((q, i) => W.findIndex((r) => dist(r, q) < 0.3) === i); }
  // a corner may move from `old` to `np` when the walls re-fitted through np follow the height step / mask boundary better
  // and the roof surface continues to np (not ground, not a tree)
  function cornerMove(old, np) {
    const others = wallsAt(old).filter((q) => dist(q, old) > 0.5); if (!others.length) return { ok: false, why: 'no wall lines meet here' };
    const sOld = others.map((q) => outlineSupport(q, old)), sNew = others.map((q) => outlineSupport(q, np));
    const mOld = sOld.reduce((s, x) => s + x, 0) / sOld.length, mNew = sNew.reduce((s, x) => s + x, 0) / sNew.length;
    // the roof surface must run on to the new corner: heights along the way stay roof heights (a tree crown or the ground
    // breaks this) and the mask still covers the spot just inside the new corner (the corner pixel itself is blurred)
    const h0 = hAt(old), L = dist(old, np); let cont = 0, n = 0; for (let t = 0.1; t <= 0.9; t += 0.2) { if (t * L > L - 0.5 && L > 0.6) continue; const h = hAt([old[0] + (np[0] - old[0]) * t, old[1] + (np[1] - old[1]) * t]); if (h != null && h0 != null) { n++; if (Math.abs(h - h0) < 1.5) cont++; } }
    const inside = L > 0 ? [np[0] + (old[0] - np[0]) / L * 0.4, np[1] + (old[1] - np[1]) / L * 0.4] : np; const hIn = hAt(inside);
    const continuous = n > 0 && cont / n >= 0.8 && mAt(inside) === 1 && hIn != null && h0 != null && Math.abs(hIn - h0) < 1.5;
    const ok = mNew >= minSupport && mNew >= mOld + 0.1 && continuous;
    return { ok, why: `walls through the new corner: height/mask support ${mNew.toFixed(2)} vs ${mOld.toFixed(2)} now; roof surface continuous to it: ${continuous}`, sNew: mNew, sOld: mOld, continuous };
  }
  // ---- group the observations: one image source counts once however many models drew the same line
  const edgeObs = obs.filter((o) => (o.kind === 'edge' || o.kind === 'level') && o.ll && o.ll.length >= 2).map((o) => ({ o, a: toM({ lat: o.ll[0][0], lng: o.ll[0][1] }), b: toM({ lat: o.ll[o.ll.length - 1][0], lng: o.ll[o.ll.length - 1][1] }) }));
  const cornerObs = obs.filter((o) => o.kind === 'corner' && o.ll && o.ll.length >= 1).map((o) => ({ o, p: toM({ lat: o.ll[0][0], lng: o.ll[0][1] }) }));
  const regionObs = obs.filter((o) => o.kind === 'region' && o.ll && o.ll.length >= 3).map((o) => ({ o, pts: o.ll.map((q) => toM({ lat: q[0], lng: q[1] })) }));
  const groups = [];
  // members of a group lie on one line: same direction, both ends within 0.8 m of the group's line (perpendicular, not
  // clamped to the segment) and overlapping it along the line, so two parallel eaves 2.7 m apart never share a fit
  const sameLine = (e, G) => { const L = dist(G.a, G.b); if (L < 0.3) return false; const u = [(G.b[0] - G.a[0]) / L, (G.b[1] - G.a[1]) / L], nrm = [-u[1], u[0]];
    const perp = (p) => Math.abs((p[0] - G.a[0]) * nrm[0] + (p[1] - G.a[1]) * nrm[1]), along = (p) => (p[0] - G.a[0]) * u[0] + (p[1] - G.a[1]) * u[1];
    const ta = along(e.a), tb = along(e.b); const gap = Math.max(ta, tb) < 0 ? -Math.max(ta, tb) : Math.min(ta, tb) > L ? Math.min(ta, tb) - L : 0;
    return angDiff(e.a, e.b, G.a, G.b) < 12 && perp(e.a) < 0.8 && perp(e.b) < 0.8 && gap < 1.0; };
  for (const e of edgeObs) { const g = groups.find((G) => sameLine(e, G)); if (g) g.members.push(e); else groups.push({ a: e.a, b: e.b, members: [e] }); }
  const proposals = [];
  for (const G of groups) {
    const srcs = [...new Set(G.members.map((m) => m.o.source))], models = [...new Set(G.members.map((m) => m.o.model))]; const types = G.members.map((m) => m.o.type || 'outline');
    const type = [...types].sort((x, y) => types.filter((t) => t === y).length - types.filter((t) => t === x).length)[0]; const verdicts = G.members.map((m) => m.o.verdict).filter(Boolean);
    // one straight run fitted through the members' endpoints
    const pts = G.members.flatMap((m) => [m.a, m.b]); const cx = pts.reduce((s, p) => s + p[0], 0) / pts.length, cy = pts.reduce((s, p) => s + p[1], 0) / pts.length;
    let sxx = 0, sxy = 0, syy = 0; for (const p of pts) { sxx += (p[0] - cx) ** 2; sxy += (p[0] - cx) * (p[1] - cy); syy += (p[1] - cy) ** 2; }
    const th = 0.5 * Math.atan2(2 * sxy, sxx - syy); const u = [Math.cos(th), Math.sin(th)]; const ts = pts.map((p) => (p[0] - cx) * u[0] + (p[1] - cy) * u[1]); const t0 = Math.min(...ts), t1 = Math.max(...ts);
    let a = [cx + u[0] * t0, cy + u[1] * t0], b = [cx + u[0] * t1, cy + u[1] * t1];
    const wantOutline = OUTLINE.has(type) || type === 'level-break'; const raw = [a, b];
    const snapped = snapLine(a, b, wantOutline); a = snapped.a; b = snapped.b;
    const ev = segmentEvidence(a, b); const near = nearestSketchEdge(a, b); const support = wantOutline ? Math.max(ev.step, ev.maskEdge) : ev.crease;
    const strong = (models.length >= 2 || G.members.some((m) => (m.o.confidence || 0) >= 0.8)) && ev.len >= 3;
    let kind, decision, why, move = null;
    if (near && near.dist < 0.6 && near.ang < 10) { kind = 'confirms'; decision = 'no change'; why = `matches sketch ${near.s.e.type} #${near.s.i} within ${near.dist.toFixed(2)} m`; }
    else if (near && near.ang < 10 && near.dist < 3.0 && wantOutline) {
      // a parallel run beside a sketch wall: move both ends of that wall if the corner rule accepts each end
      const s = near.s; const nrm = [-u[1], u[0]]; const off = ((a[0] - s.a[0]) * nrm[0] + (a[1] - s.a[1]) * nrm[1] + (b[0] - s.b[0]) * nrm[0] + (b[1] - s.b[1]) * nrm[1]) / 2;
      const na = [s.a[0] + nrm[0] * off, s.a[1] + nrm[1] * off], nb = [s.b[0] + nrm[0] * off, s.b[1] + nrm[1] * off];
      const ca = cornerMove(s.a, na), cb = cornerMove(s.b, nb); kind = 'displaced';
      if (ca.ok && cb.ok) { decision = 'accept'; move = [{ from: s.a, to: na }, { from: s.b, to: nb }]; }
      else decision = support < 0.3 && outlineSupport(s.a, s.b) < 0.3 ? 'unresolved' : 'reject';
      why = `observed run ${near.dist.toFixed(2)} m from sketch ${s.e.type} #${s.i} (support observed ${support.toFixed(2)}, sketch ${outlineSupport(s.a, s.b).toFixed(2)}); end A: ${ca.why}; end B: ${cb.why}`;
    }
    else if (!near || near.dist >= 1.5) {
      // roof the sketch lacks: opened only when the height step is there, the building mask covers its higher side (the
      // Solar data call it building, so the trace dropped it) and the surface beside it is a roof plane, not a tree crown
      kind = 'missing'; const rough = wantOutline ? roughness(a, b, true) : null; const lumpy = rough != null && rough > 0.15; const inMask = ev.maskRoofSide >= 0.5;
      decision = support >= minSupport && strong && inMask && !lumpy ? 'accept-as-open' : (support < 0.25 ? 'reject' : 'unresolved');
      why = `no sketch line within ${near ? near.dist.toFixed(1) : '?'} m (after sliding ${snapped.off.toFixed(1)} m to the evidence); ${wantOutline ? 'step/mask' : 'crease'} support ${support.toFixed(2)}; building mask on the roof side ${(ev.maskRoofSide * 100).toFixed(0)}%${rough != null ? `; lumpiness ${rough.toFixed(2)} m` : ''}; ${models.length} model(s), ${ev.len.toFixed(1)} m${decision === 'unresolved' && support >= minSupport ? (!inMask ? ' (not in the building mask: possibly a neighbouring structure, noted)' : lumpy ? ' (lumpy: tree crown, noted)' : '') : ''}`; }
    else { kind = 'near'; decision = 'unresolved'; why = `near sketch ${near.s.e.type} #${near.s.i} (${near.dist.toFixed(2)} m, ${near.ang.toFixed(0)} deg) but not the same line`; }
    const challenged = verdicts.filter((v) => ['unsupported', 'follows-canopy', 'follows-shadow'].includes(v)).length;
    if (kind === 'confirms' && challenged && challenged >= verdicts.length / 2) {
      // a reviewer says this sketch line is not a roof edge: the height model decides (step / mask evidence and lumpiness)
      const sOut = outlineSupport(near.s.a, near.s.b), evS = segmentEvidence(near.s.a, near.s.b), rough = roughness(near.s.a, near.s.b, OUTLINE.has(near.s.e.type));
      const isOutline = OUTLINE.has(near.s.e.type); const supported = isOutline ? sOut >= 0.5 : evS.crease >= 0.4; const lumpy = rough != null && rough > 0.15;
      kind = 'challenged';
      if (!supported || lumpy) { decision = 'accept-as-open'; why = `reviewer verdict ${verdicts.join('/')} on sketch ${near.s.e.type} #${near.s.i}; height model: ${isOutline ? 'step/mask' : 'crease'} support ${(isOutline ? sOut : evS.crease).toFixed(2)}, lumpiness ${rough == null ? '?' : rough.toFixed(2)} m${lumpy ? ' (tree crown, not a roof plane)' : ''}`; }
      else { decision = 'reject'; why = `reviewer verdict ${verdicts.join('/')} on sketch ${near.s.e.type} #${near.s.i} rejected: the height model shows the edge (support ${(isOutline ? sOut : evS.crease).toFixed(2)}, lumpiness ${rough == null ? '?' : rough.toFixed(2)} m)`; }
    }
    else if (kind === 'confirms' && near.s.e.type !== type && (INTERIOR.has(type) || OUTLINE.has(type)) && type !== 'outline') {
      const evS = segmentEvidence(near.s.a, near.s.b); const outl = Math.max(evS.step, evS.maskEdge);
      const obsOK = OUTLINE.has(type) ? outl >= minSupport : evS.crease >= minSupport, skOK = OUTLINE.has(near.s.e.type) ? outl >= minSupport : evS.crease >= minSupport;
      if (obsOK && !skOK) { kind = 'misclassified'; decision = 'accept'; why += `; height model supports ${type}, not ${near.s.e.type} (step ${evS.step.toFixed(2)}, mask ${evS.maskEdge.toFixed(2)}, crease ${evS.crease.toFixed(2)})`; }
      else if (!obsOK && skOK) why += `; ${type} proposed but the height model supports the sketch's ${near.s.e.type}`;
      else { kind = 'misclassified'; decision = 'unresolved'; why += `; height model cannot tell ${type} from ${near.s.e.type}`; }
    }
    proposals.push({ kind, decision, type, sketchEdge: near ? near.s.i : null, sketchType: near ? near.s.e.type : null, a: toLL(a), b: toLL(b), raw: raw.map(toLL), snappedM: snapped.off, lengthM: ev.len, evidence: ev, support, sources: srcs, models, verdicts, why, move: move && move.map((m) => ({ from: toLL(m.from), to: toLL(m.to) })) });
  }
  for (const C of cornerObs) {
    const nv = nearestVertex(C.p); let kind, decision, why, move = null;
    if (!nv) { kind = 'corner'; decision = 'unresolved'; why = 'no sketch'; }
    else if (nv.d < 1.0) { kind = 'confirms'; decision = 'no change'; why = `matches sketch corner within ${nv.d.toFixed(2)} m`; }
    else if (nv.d < 3.0) { const r = cornerMove(nv.q, C.p); kind = 'corner-displaced'; decision = r.ok ? 'accept' : (r.sNew < 0.3 && r.sOld < 0.3 ? 'unresolved' : 'reject'); why = `observed corner ${nv.d.toFixed(2)} m from the sketch vertex; ${r.why}`; if (r.ok) move = [{ from: toLL(nv.q), to: toLL(C.p) }]; }
    else { let b = 0; const m0 = mAt(C.p); for (let k = 0; k < 8; k++) { const mv = mAt([C.p[0] + 0.5 * Math.cos(k * Math.PI / 4), C.p[1] + 0.5 * Math.sin(k * Math.PI / 4)]); if (mv != null && m0 != null && mv !== m0) b++; } kind = 'corner-missing'; decision = b >= 2 && b <= 5 ? 'accept-as-open' : 'reject'; why = `no sketch vertex within ${nv.d.toFixed(1)} m; on the mask boundary: ${b >= 2 && b <= 5} (${b}/8)`; }
    proposals.push({ kind, decision, type: C.o.type, p: toLL(C.p), from: nv ? toLL(nv.q) : null, sketchVertex: nv ? { facet: nv.F.i, k: nv.k, d: nv.d } : null, sources: [C.o.source], models: [C.o.model], verdicts: [C.o.verdict].filter(Boolean), why, move });
  }
  const inPoly = (p, poly) => { let k = false; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) if ((poly[i][1] > p[1]) !== (poly[j][1] > p[1]) && p[0] < (poly[j][0] - poly[i][0]) * (p[1] - poly[i][1]) / (poly[j][1] - poly[i][1]) + poly[i][0]) k = !k; return k; };
  for (const R of regionObs) { if (!['canopy', 'shadow', 'neighbour', 'not-roof', 'gap'].includes(R.o.type)) continue;
    const hit = sketchEdges.filter((s) => inPoly([(s.a[0] + s.b[0]) / 2, (s.a[1] + s.b[1]) / 2], R.pts)).map((s) => s.i);
    if (hit.length) proposals.push({ kind: 'region', decision: 'flag', type: R.o.type, sketchEdges: hit, sources: [R.o.source], models: [R.o.model], why: `${R.o.type} region (${R.o.model}) covers the midpoint of sketch lines ${hit.join(', ')}: ${(R.o.evidence || '').slice(0, 120)}` }); }
  // ---- apply: accepted moves and renames; open items marked unresolved with their evidence
  const edited = JSON.parse(JSON.stringify(job)); const marks = []; let moved = 0, retyped = 0, opened = 0; const movedPts = [];
  const movePoint = (from, to, note) => {
    const o = toM(from); if (movedPts.some((q) => dist(q, o) < 0.3)) return false; movedPts.push(o);
    for (const F of facetsM) F.pts.forEach((q, k) => { if (dist(q, o) < 0.3) { edited.facets[F.i].path[k] = { lat: to.lat, lng: to.lng }; edited.facets[F.i].edited = true; edited.facets[F.i].note = ((edited.facets[F.i].note || '') + ' ' + note).trim(); } });
    for (const s of sketchEdges) { const E = edited.edges[s.i]; if (dist(s.a, o) < 0.3) E.path[0] = { lat: to.lat, lng: to.lng }; if (dist(s.b, o) < 0.3) E.path[E.path.length - 1] = { lat: to.lat, lng: to.lng }; }
    moved++; marks.push({ kind: 'corner-moved', from, to }); return true;
  };
  for (const P of proposals) {
    if (P.move && P.decision === 'accept') for (const m of P.move) movePoint(m.from, m.to, `corner moved ${dist(toM(m.from), toM(m.to)).toFixed(2)} m on image + height-model evidence (${P.kind})`);
    else if (P.kind === 'misclassified' && P.decision === 'accept') { const e = edited.edges[P.sketchEdge]; e.note = ((e.note || '') + ` type ${e.type} -> ${P.type}: ${P.why}`).trim(); e.type = P.type; e.edited = true; retyped++; marks.push({ kind: 'retyped', a: P.a, b: P.b, type: P.type }); }
    else if (P.decision === 'accept-as-open') {
      const q = P.a ? toM(P.a) : toM(P.p); let best = null; for (const F of facetsM) { const d = Math.min(...F.pts.map((v) => dist(v, q))); if (!best || d < best.d) best = { d, F }; }
      if (best) { const f = edited.facets[best.F.i]; f.status = 'unresolved'; f.verify = { source: 'vision review', date: '', note: `${P.kind}: ${P.why}`.slice(0, 300) }; opened++; marks.push({ kind: 'open', a: P.a || P.p, b: P.b || P.p, why: P.why }); }
    } else if (P.kind === 'region') marks.push({ kind: 'flag', sketchEdges: P.sketchEdges, type: P.type });
  }
  edited.visionReview = { proposals: proposals.length, accepted: moved + retyped, opened, sources: [...new Set(obs.map((o) => o.source))], note: 'edits from the independent vision review, each validated against the height model and building mask' };
  const summary = { observations: obs.length, models: [...new Set(obs.map((o) => o.model))].length, proposals: proposals.length, byDecision: proposals.reduce((o, p) => { o[p.decision] = (o[p.decision] || 0) + 1; return o; }, {}), byKind: proposals.reduce((o, p) => { o[p.kind] = (o[p.kind] || 0) + 1; return o; }, {}), moved, retyped, opened };
  return { proposals, edited, marks, summary };
}

// ---- CLI
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
  const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; }, has = (k) => process.argv.includes('--' + k);
  const slug = arg('slug'), runDir = arg('run'), obsFile = arg('obs'), out = arg('out');
  if (!slug || !runDir || !obsFile || !out) { console.error('--slug --run --obs --out required'); process.exit(2); }
  const { fetchProperty } = await import('../appcore.mjs');
  const M = JSON.parse(fs.readFileSync(path.join(REPO, 'bench', 'private', 'regional', 'manifest.json'), 'utf8'));
  const prop = await fetchProperty(M.properties.find((q) => q.slug === slug).address, { slug });
  const job = JSON.parse(fs.readFileSync(path.join(runDir, 'roof.json'), 'utf8')); const obs = JSON.parse(fs.readFileSync(obsFile, 'utf8')).observations || [];
  const r = fuseModel({ job, obs, dsm: prop.dsmT, mask: prop.maskT, minSupport: +arg('min-support', 0.6) });
  fs.mkdirSync(out, { recursive: true });
  fs.writeFileSync(path.join(out, 'proposals.json'), JSON.stringify({ summary: r.summary, proposals: r.proposals }, null, 1)); fs.writeFileSync(path.join(out, 'marks.json'), JSON.stringify(r.marks, null, 1));
  if (has('apply')) fs.writeFileSync(path.join(out, 'job-c.json'), JSON.stringify(r.edited, null, 1));
  const S = r.proposals.reduce((o, p) => { o[p.kind + ':' + p.decision] = (o[p.kind + ':' + p.decision] || 0) + 1; return o; }, {});
  console.log(`${r.proposals.length} proposals from ${obs.length} observations (${r.summary.models} models): ${JSON.stringify(S)}; applied: ${r.summary.moved} corner moves, ${r.summary.retyped} retyped lines, ${r.summary.opened} items opened for review${has('apply') ? ' -> job-c.json' : ''}`);
}
