// Input conditions of each benchmark property, read from the raw Google Solar layers only (the trace engine is NOT run,
// so properties held back for blind validation are not looked at through the code being tuned).
//   Key=<google key> node bench/regional/conditions.mjs      -> bench/private/regional/conditions.json (PRIVATE)
// Per property: imagery source / date / quality / age, selected building (Google's record) and its distance from the
// geocoded address, roof height above ground (stories), other buildings within 30 m (detached structures, near
// neighbours), canopy over and around the roof, dark (shadowed) share of the roof.
import fs from 'node:fs';
import path from 'node:path';
import { fetchProperty, BENCH } from '../appcore.mjs';

const MAN = path.join(BENCH, 'private', 'regional', 'manifest.json');
const M = JSON.parse(fs.readFileSync(MAN, 'utf8'));
const out = {}; const OUTF = path.join(BENCH, 'private', 'regional', 'conditions.json');
const prev = fs.existsSync(OUTF) ? JSON.parse(fs.readFileSync(OUTF, 'utf8')) : {};
const med = (v) => { const q = v.slice().sort((a, b) => a - b); return q.length ? q[q.length >> 1] : NaN; };
for (const p of M.properties) {
  if (prev[p.slug] && !process.argv.includes('--fresh')) { out[p.slug] = prev[p.slug]; continue; }
  try {
    const P = await fetchProperty(p.address, { slug: p.slug });
    const { w, h } = P.maskT; const mask = P.maskT.data, dsm = P.dsmT.data, rgb = P.rgbT ? P.rgbT.bands : null; const N = w * h;
    const px = Math.abs(P.dsmT.rx); const a1 = px * px;
    // building components (4-connected) in Google's mask
    const lab = new Int32Array(N).fill(-1); const comps = [];
    for (let s = 0; s < N; s++) { if (!(mask[s] > 0) || lab[s] >= 0) continue; const id = comps.length; const st = [s]; lab[s] = id; let n = 0, sx = 0, sy = 0; const pix = [];
      while (st.length) { const i = st.pop(); n++; const x = i % w, y = (i - x) / w; sx += x; sy += y; pix.push(i); for (const j of [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, y > 0 ? i - w : -1, y < h - 1 ? i + w : -1]) if (j >= 0 && mask[j] > 0 && lab[j] < 0) { lab[j] = id; st.push(j); } }
      comps.push({ id, n, cx: sx / n, cy: sy / n, pix }); }
    // the building Google selected = component at / nearest the building record's centre
    const c = P.main.center; let best = null, bd = 1e9;
    const toXY = (lat, lng) => { let lo = 0; // invert toLL by local linearisation
      const o = P.maskT.toLL(0, 0), ex = P.maskT.toLL(1, 0), ey = P.maskT.toLL(0, 1); const ax = ex.lng - o.lng, bx = ey.lng - o.lng, ay = ex.lat - o.lat, by = ey.lat - o.lat; const det = ax * by - bx * ay; void lo;
      return [((lng - o.lng) * by - (lat - o.lat) * bx) / det, (ax * (lat - o.lat) - ay * (lng - o.lng)) / det]; };
    const [mx, my] = toXY(c.latitude, c.longitude);
    for (const k of comps) { if (k.n * a1 < 15) continue; const d = Math.hypot(k.cx - mx, k.cy - my); if (d < bd) { bd = d; best = k; } }
    const [gx, gy] = toXY(P.loc.lat, P.loc.lng);
    const geoDistM = Math.hypot(gx - mx, gy - my) * px;
    const inMain = best && lab[Math.round(gy) * w + Math.round(gx)] === best.id;
    // ground: low percentile of non-building pixels; roof height: high percentile on the main building
    const gnd = []; for (let i = 0; i < N; i += 7) if (!(mask[i] > 0) && dsm[i] > -1000) gnd.push(dsm[i]); gnd.sort((a, b) => a - b); const ground = gnd[Math.floor(gnd.length * 0.1)];
    const roofZ = best ? best.pix.map((i) => dsm[i]).filter((v) => v > -1000).sort((a, b) => a - b) : []; const top = roofZ.length ? roofZ[Math.floor(roofZ.length * 0.98)] - ground : null;
    const eave = roofZ.length ? roofZ[Math.floor(roofZ.length * 0.05)] - ground : null;
    // distance from the main building to every other building (edge to edge, metres)
    const mainMask = new Uint8Array(N); if (best) for (const i of best.pix) mainMask[i] = 1;
    const dist = new Float32Array(N).fill(1e9); const q = []; if (best) for (const i of best.pix) { dist[i] = 0; q.push(i); }
    for (let qi = 0; qi < q.length; qi++) { const i = q[qi]; const x = i % w, y = (i - x) / w; const d = dist[i] + 1; if (d * px > 30) continue; for (const j of [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, y > 0 ? i - w : -1, y < h - 1 ? i + w : -1]) if (j >= 0 && dist[j] > d) { dist[j] = d; q.push(j); } }
    const others = comps.filter((k) => k !== best && k.n * a1 >= 6).map((k) => ({ areaM2: +(k.n * a1).toFixed(1), gapM: +(Math.min(...k.pix.map((i) => dist[i])) * px).toFixed(1), heightM: +(med(k.pix.map((i) => dsm[i]).filter((v) => v > -1000)) - ground).toFixed(1) })).filter((o) => o.gapM <= 30).sort((a, b) => a.gapM - b.gapM);
    // canopy: tall (>2 m), rough or green pixels not on any building, within 3 m of the main roof; and on the main mask
    let near = 0, nearTall = 0, onRoofGreen = 0, dark = 0, roofN = 0; const lum = [];
    for (let i = 0; i < N; i++) {
      const green = rgb ? (2 * rgb[1][i] - rgb[0][i] - rgb[2][i]) : 0;
      if (mainMask[i]) { roofN++; if (rgb) { const L = (rgb[0][i] + rgb[1][i] + rgb[2][i]) / 3; lum.push(L); if (green > 25) onRoofGreen++; } continue; }
      if (dist[i] * px <= 3) { near++; if (!(mask[i] > 0) && dsm[i] - ground > 2.5) nearTall++; }
    }
    const lmed = med(lum); if (rgb && best) for (const i of best.pix) { const L = (rgb[0][i] + rgb[1][i] + rgb[2][i]) / 3; if (L < 0.45 * lmed) dark++; }
    const d = P.layers.imageryDate; const date = d ? `${d.year}-${String(d.month).padStart(2, '0')}-${String(d.day).padStart(2, '0')}` : null;
    const ageY = d ? +((Date.UTC(2026, 10, 25) - Date.UTC(d.year, d.month - 1, d.day)) / 3.15576e10).toFixed(1) : null;
    out[p.slug] = {
      imagery: { source: 'Google Solar API (dataLayers, 10 cm)', date, quality: P.layers.imageryQuality, ageYears: ageY },
      selected: { googleBuilding: P.main.name, footprintM2: best ? +(best.n * a1).toFixed(0) : null, centreToAddressM: +geoDistM.toFixed(1), addressPointOnSelectedRoof: !!inMain, solarRoofM2: P.main.solarPotential && P.main.solarPotential.wholeRoofStats ? +P.main.solarPotential.wholeRoofStats.areaMeters2.toFixed(0) : null },
      heights: { ridgeAboveGroundM: top != null ? +top.toFixed(1) : null, eaveAboveGroundM: eave != null ? +eave.toFixed(1) : null, storiesEstimate: top == null ? null : top > 8 ? 2 : 1 },
      otherBuildingsWithin30m: others,
      nearestNeighbourGapM: others.filter((o) => o.areaM2 >= 60).length ? others.filter((o) => o.areaM2 >= 60)[0].gapM : null,
      smallStructuresWithin30m: others.filter((o) => o.areaM2 < 60).length,
      canopy: { tallBesideRoofPct: near ? +(100 * nearTall / near).toFixed(1) : null, greenOnRoofPct: roofN ? +(100 * onRoofGreen / roofN).toFixed(1) : null },
      shadowOnRoofPct: roofN && rgb ? +(100 * dark / roofN).toFixed(1) : null,
    };
    console.log('ok', p.slug, JSON.stringify(out[p.slug].imagery), 'stories', out[p.slug].heights.storiesEstimate, 'canopy', JSON.stringify(out[p.slug].canopy));
  } catch (e) { out[p.slug] = { error: String(e.message || e) }; console.log('FAIL', p.slug, e.message); }
}
fs.writeFileSync(OUTF, JSON.stringify(out, null, 1));
