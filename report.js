'use strict';
/* Roofr-format roof report for Roof Measure (no logo).
 * Pages: cover, Diagram, Length measurement report, Area measurement report, Pitch & direction measurement report,
 * Structure #n summary (when more than one structure), Report summary, Material calculations.
 * Uses globals from app.js: state, computeTotals, EDGE_TYPES, fmt, ftInR, esc, pitchLabel, segFt, centroid,
 * coveredByEdge, solarSummary, FT_PER_M, $, toast, download, fileBase.
 */

// ------------------------------------------------------------------ company details
const COMPANY_DEFAULT = {
  name: 'Diversity Roofing', phone: '(904) 979-0556',
  address: '6620 Southpoint Dr. S., Suite 600, Jacksonville, FL 32216',
  license: 'CCC1337520', email: '', website: 'diversity-roofing.com', rep: '',
};
const company = Object.assign({}, COMPANY_DEFAULT, JSON.parse(localStorage.getItem('rm.company') || '{}'));
const BLUE = '#2d9cdb';

// ------------------------------------------------------------------ material catalog (Roofr product list; coverage per unit)
// sqft per bundle/roll for shingles & synthetic, linear ft per bundle/roll for starter, ice & water and capping.
const MATERIAL_CATALOG = [
  { group: 'Shingle (total sqft)', base: 'pitched', baseUnit: 'sqft', unit: 'bundle', items: [['IKO - Cambridge', 33.3], ['CertainTeed - Landmark', 32.8], ['GAF - Timberline', 32.8], ['Owens Corning - Duration', 32.8], ['Atlas - Pristine', 33.0]] },
  { group: 'Starter (eaves + rakes)', base: 'starter', baseUnit: 'ft', unit: 'bundle', items: [['IKO - Leading Edge Plus', 120], ['CertainTeed - SwiftStart', 116.25], ['GAF - Pro-Start', 120.33], ['Owens Corning - Starter Strip', 105], ['Atlas - Pro-Cut', 137]] },
  { group: 'Ice and Water (eaves + valleys + flashings)', base: 'iw', baseUnit: 'ft', unit: 'roll', items: [['IKO - StormShield', 65.6], ['CertainTeed - WinterGuard', 65.6], ['GAF - WeatherWatch', 66.7], ['Owens Corning - WeatherLock', 75], ['Atlas - Weathermaster', 65.6]] },
  { group: 'Synthetic (total sqft; no laps)', base: 'pitched', baseUnit: 'sqft', unit: 'roll', items: [['IKO - Stormtite', 1000], ['CertainTeed - RoofRunner', 1000], ['GAF - Deck-Armor', 1000], ['Owens Corning - RhinoRoof', 1000], ['Atlas - Summit', 1000]] },
  { group: 'Capping (hips + ridges)', base: 'cap', baseUnit: 'ft', unit: 'bundle', items: [['IKO - Hip and Ridge', 40], ['CertainTeed - Shadow Ridge', 30], ['GAF - Seal-A-Ridge', 25], ['Owens Corning - DecoRidge', 20], ['Atlas - Pro-Cut H&R', 31]] },
];

// ------------------------------------------------------------------ numbers the Roofr way
const sqOf = (sf) => Math.ceil(sf / 100 * 10) / 10;           // squares to 0.1, rounded up
const sqftUp = (sf) => Math.ceil(sf - 1e-9);                   // whole sqft, rounded up
const ftUp = (ft) => Math.ceil(ft - 1e-9);
const sq1 = (sf) => sqOf(sf).toFixed(1);
// Roofr shows seven waste columns: 0, 10, 12, 15, 17, 20, 22 with the recommended value inserted and the farthest column dropped.
function wasteColumns(rec) {
  const std = [0, 10, 12, 15, 17, 20, 22];
  if (std.includes(rec)) return std;
  const cols = [...std, rec].sort((a, b) => a - b);
  let far = -1, idx = -1; cols.forEach((c, i) => { const d = Math.abs(c - rec); if (d >= far) { far = d; idx = i; } });
  cols.splice(idx, 1);
  return cols;
}
// Material page shows 0%, 10%, recommended and 15%.
function matColumns(rec) { const s = new Set([0, 10, 15, rec]); if (s.size < 4) s.add(12); return [...s].sort((a, b) => a - b); }

function reportData() {
  const t = computeTotals();
  const s = solarSummary();
  const hasTrace = state.facets.length > 0;
  const rec = t.recWaste;                                        // Roofr-method recommended waste (see roofrWaste in app.js)
  return { t, s, hasTrace, rec, wasteCols: wasteColumns(rec), matCols: matColumns(rec) };
}

// ------------------------------------------------------------------ diagram (Roofr style)
const FACET_SHADES = ['#eaf1fa', '#d9e6f5', '#c8daf0', '#b9cfeb', '#aac4e6'];
function facetDirection(x, scope) {
  if (x.f.azimuth != null) { const a = x.f.azimuth * Math.PI / 180; return { dx: Math.sin(a), dy: -Math.cos(a) }; }   // Solar API azimuth: compass direction the plane faces
  // down-slope direction: toward the facet edge that lies on an eave line; else toward the longest edge no other facet shares
  const path = x.m.path;
  const c = centroid(path);
  const eavePaths = scope.edges.filter((e) => e.e.type === 'eave').map((e) => e.m.path);
  let best = null, bestLen = -1, bestEave = false;
  for (let i = 0; i < path.length; i++) {
    const a = path[i], b = path[(i + 1) % path.length];
    const onEave = coveredByEdge(a, b, eavePaths) || eavePaths.some((ep) => ep.length > 1 && segOnPolyline(a, b, ep));
    const shared = scope.facets.some((y) => y !== x && coveredByEdge(a, b, [[...y.m.path, y.m.path[0]]]));
    const len = segFt(a, b);
    const score = onEave ? 2 : shared ? 0 : 1;
    const bestScore = bestEave ? 2 : best ? 1 : 0;
    if (score > bestScore || (score === bestScore && len > bestLen)) { best = { a, b }; bestLen = len; bestEave = onEave; }
  }
  if (!best) return null;
  const mid = { lat: (best.a.lat + best.b.lat) / 2, lng: (best.a.lng + best.b.lng) / 2 };
  const dx = (mid.lng - c.lng) * Math.cos(c.lat * Math.PI / 180), dy = (mid.lat - c.lat);
  const L = Math.hypot(dx, dy) || 1;
  return { dx: dx / L, dy: -dy / L };                            // screen space: y down
}
function segOnPolyline(a, b, poly) {
  // both endpoints within 0.4 m of the same polyline segment
  for (let i = 1; i < poly.length; i++) if (pointSegM(a, poly[i - 1], poly[i]) < 0.4 && pointSegM(b, poly[i - 1], poly[i]) < 0.4) return true;
  return false;
}
function roofrDiagram(scope, mode, W, H, allShades) {
  const facets = [...scope.facets, ...scope.cutouts];
  const all = [...facets.map((x) => x.m.path), ...scope.edges.map((x) => x.m.path)].flat();
  if (!all.length) return '';
  const o = all[0];
  const kx = 111320 * Math.cos(o.lat * Math.PI / 180) * FT_PER_M, ky = 110540 * FT_PER_M;
  const xy = (p) => ({ x: (p.lng - o.lng) * kx, y: -(p.lat - o.lat) * ky });
  const pts = all.map(xy);
  const minX = Math.min(...pts.map((p) => p.x)), maxX = Math.max(...pts.map((p) => p.x));
  const minY = Math.min(...pts.map((p) => p.y)), maxY = Math.max(...pts.map((p) => p.y));
  const pad = 50;
  const sc = Math.min((W - 2 * pad) / Math.max(maxX - minX, 1), (H - 2 * pad) / Math.max(maxY - minY, 1));
  const ox = pad + ((W - 2 * pad) - (maxX - minX) * sc) / 2, oy = pad + ((H - 2 * pad) - (maxY - minY) * sc) / 2;
  // snap corners that are within ~1 ft (2-10 px) of each other to one shared point, so facet outlines and
  // ridge/hip/valley lines meet exactly instead of leaving hairline gaps, kinks or overshoots at the joints
  const snapTol = Math.min(10, Math.max(2, 1.0 * sc)), snapPts = [];
  const P = (p) => {
    const q = xy(p), r = { x: ox + (q.x - minX) * sc, y: oy + (q.y - minY) * sc };
    for (const s of snapPts) if (Math.abs(s.x - r.x) <= snapTol && Math.abs(s.y - r.y) <= snapTol && Math.hypot(s.x - r.x, s.y - r.y) <= snapTol) return s;
    snapPts.push(r); return r;
  };
  const pitchRank = {}; (allShades || scope.pitches).forEach((p, i) => { pitchRank[p] = i; });
  const ptsStr = (path) => path.map(P).map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
  let s = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" font-family="Inter, Segoe UI, Arial, sans-serif"><rect width="${W}" height="${H}" fill="#fff"/>`;
  for (const x of scope.facets) {
    const fill = mode === 'lengths' ? 'none' : FACET_SHADES[(pitchRank[x.f.pitch] || 0) % FACET_SHADES.length];
    s += `<polygon points="${ptsStr(x.m.path)}" fill="${fill}" stroke="${mode === 'lengths' ? '#9fb3c8' : '#4a9bd9'}" stroke-width="${mode === 'lengths' ? 0.6 : 1}" stroke-linejoin="miter" stroke-miterlimit="4"/>`;
  }
  for (const x of scope.cutouts) s += `<polygon points="${ptsStr(x.m.path)}" fill="#fff" stroke="#4a9bd9" stroke-width="1" stroke-dasharray="4 3"/>`;
  const text = (x, y, str, size, fill, rot = 0, weight = 'normal') => `<text x="${x.toFixed(1)}" y="${y.toFixed(1)}" font-size="${size}" text-anchor="middle" dominant-baseline="middle" fill="${fill}" font-weight="${weight}" transform="rotate(${rot.toFixed(1)} ${x.toFixed(1)} ${y.toFixed(1)})">${esc(str)}</text>`;
  const cx = ox + (maxX - minX) * sc / 2, cy = oy + (maxY - minY) * sc / 2;
  if (mode === 'lengths') {
    // where two lines lie on the same stretch (wall flashing along a rake, a hip traced twice) draw it once:
    // the flashing (dashed) line wins, otherwise the first one traced
    const segKey = (A, B) => { const i = snapPts.indexOf(A), j = snapPts.indexOf(B); return i < j ? i + '-' + j : j + '-' + i; };
    const owner = new Map();
    scope.edges.forEach(({ e, m }, ei) => {
      if (EDGE_TYPES[e.type].notRoof) return;                 // obstruction boundary: a gap in the outline
      const dashed = !!EDGE_TYPES[e.type].dashed;
      for (let i = 1; i < m.path.length; i++) {
        const A = P(m.path[i - 1]), B = P(m.path[i]); if (A === B) continue;
        const k = segKey(A, B), cur = owner.get(k);
        if (!cur || (dashed && !cur.dashed)) owner.set(k, { ei, dashed });
      }
    });
    const owns = (ei, a, b) => { const A = P(a), B = P(b); if (A === B) return false; const o = owner.get(segKey(A, B)); return !!o && o.ei === ei; };
    scope.edges.forEach(({ e, m }, ei) => {
      const t = EDGE_TYPES[e.type]; if (t.notRoof) return;
      let run = [];
      const flush = () => { if (run.length > 1) s += `<polyline points="${run.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ')}" fill="none" stroke="${t.color}" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="miter" stroke-miterlimit="4" ${t.dashed ? 'stroke-dasharray="3 3"' : ''}/>`; run = []; };
      for (let i = 1; i < m.path.length; i++) {
        if (!owns(ei, m.path[i - 1], m.path[i])) { flush(); continue; }
        if (!run.length) run.push(P(m.path[i - 1]));
        run.push(P(m.path[i]));
      }
      flush();
    });
    const edgePaths = scope.edges.map((x) => x.m.path);
    const placed = [];                                   // label centres already used: never stack two numbers
    const label = (a, b, ft, fill) => {
      if (ft < 3) return '';
      const A = P(a), B = P(b);
      if (A === B) return '';
      const mx0 = (A.x + B.x) / 2, my0 = (A.y + B.y) / 2;
      if (placed.some((q) => Math.hypot(q.x - mx0, q.y - my0) < 9)) return '';
      placed.push({ x: mx0, y: my0 });
      let ang = Math.atan2(B.y - A.y, B.x - A.x) * 180 / Math.PI; if (ang > 90) ang -= 180; if (ang < -90) ang += 180;
      let nx = -(B.y - A.y), ny = B.x - A.x; const L = Math.hypot(nx, ny) || 1; nx /= L; ny /= L;
      const mx = (A.x + B.x) / 2, my = (A.y + B.y) / 2;
      if ((mx - cx) * nx + (my - cy) * ny < 0) { nx = -nx; ny = -ny; }
      return text(mx + nx * 8, my + ny * 8, String(ftUp(ft)), 8.5, fill, ang);
    };
    scope.edges.forEach(({ m }, ei) => { for (let i = 1; i < m.path.length; i++) if (owns(ei, m.path[i - 1], m.path[i])) s += label(m.path[i - 1], m.path[i], segFt(m.path[i - 1], m.path[i]) * m.factor, '#333'); });
    for (const x of scope.facets) for (let i = 0; i < x.m.path.length; i++) {
      const a = x.m.path[i], b = x.m.path[(i + 1) % x.m.path.length];
      if (coveredByEdge(a, b, edgePaths)) continue;
      s += label(a, b, segFt(a, b), '#888');
    }
  } else {
    for (const { e, m } of scope.edges) if (!EDGE_TYPES[e.type].notRoof) s += `<polyline points="${ptsStr(m.path)}" fill="none" stroke="#4a9bd9" stroke-width="1" stroke-linejoin="miter" stroke-miterlimit="4"/>`;
    for (const x of scope.facets) {
      const c = P(centroid(x.m.path));
      if (mode === 'areas') {
        if (x.f.pitch === 0) s += text(c.x, c.y - 7, 'Flat', 9, '#333') + text(c.x, c.y + 5, String(Math.round(x.m.sloped)), 9.5, '#333');
        else s += text(c.x, c.y, String(Math.round(x.m.sloped)), 9.5, '#333');
      } else if (mode === 'pitch') {
        s += text(c.x, c.y, x.f.pitch === 0 ? '0' : String(Number.isInteger(x.f.pitch) ? x.f.pitch : x.f.pitch.toFixed(1)), 10, '#333');
        const d = x.f.pitch === 0 ? null : facetDirection(x, scope);
        if (d) {
          const x1 = c.x + d.dx * 13, y1 = c.y + d.dy * 13, x2 = c.x + d.dx * 24, y2 = c.y + d.dy * 24;
          const ang = Math.atan2(d.dy, d.dx);
          const h1x = x2 - Math.cos(ang - 0.5) * 4, h1y = y2 - Math.sin(ang - 0.5) * 4, h2x = x2 - Math.cos(ang + 0.5) * 4, h2y = y2 - Math.sin(ang + 0.5) * 4;
          s += `<line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" stroke="#333" stroke-width="1"/><polyline points="${h1x.toFixed(1)},${h1y.toFixed(1)} ${x2.toFixed(1)},${y2.toFixed(1)} ${h2x.toFixed(1)},${h2y.toFixed(1)}" fill="none" stroke="#333" stroke-width="1"/>`;
        }
      }
    }
  }
  // compass rose (Roofr draws a thin cross with a north tick at the bottom right)
  const rx = W - 30, ry = H - 32;
  s += `<g stroke="#555" stroke-width="0.8" fill="none"><line x1="${rx}" y1="${ry - 16}" x2="${rx}" y2="${ry + 16}"/><line x1="${rx - 16}" y1="${ry}" x2="${rx + 16}" y2="${ry}"/><circle cx="${rx}" cy="${ry}" r="3"/></g><polygon points="${rx},${ry - 20} ${rx - 3},${ry - 13} ${rx + 3},${ry - 13}" fill="#555"/><text x="${rx}" y="${ry - 24}" font-size="7" text-anchor="middle" fill="#555">N</text>`;
  return s + '</svg>';
}

// ------------------------------------------------------------------ satellite cover photo (clean, no overlays, like Roofr)
function coverPhotoUrl(R) {
  if (!state.key || !state.location) return '';
  let lat = state.location.lat, lng = state.location.lng;
  if (R.hasTrace) {
    const pts = R.t.facetsAll.flatMap((x) => x.m.path);
    lat = (Math.min(...pts.map((p) => p.lat)) + Math.max(...pts.map((p) => p.lat))) / 2;
    lng = (Math.min(...pts.map((p) => p.lng)) + Math.max(...pts.map((p) => p.lng))) / 2;
  }
  return `https://maps.googleapis.com/maps/api/staticmap?center=${lat.toFixed(6)},${lng.toFixed(6)}&zoom=20&size=640x500&scale=2&maptype=satellite&key=${encodeURIComponent(state.key)}`;
}
function imageToDataURL(url, timeoutMs = 7000) {
  return new Promise((resolve) => {
    if (!url) { resolve(null); return; }
    const im = new Image(); im.crossOrigin = 'anonymous';
    const tm = setTimeout(() => resolve(null), timeoutMs);
    im.onload = () => { clearTimeout(tm); try { const c = document.createElement('canvas'); c.width = im.naturalWidth; c.height = im.naturalHeight; c.getContext('2d').drawImage(im, 0, 0); resolve(c.toDataURL('image/jpeg', .9)); } catch (e) { resolve(null); } };
    im.onerror = () => { clearTimeout(tm); resolve(null); };
    im.src = url;
  });
}

// ------------------------------------------------------------------ CSS
const REPORT_CSS = `
@page { size: letter; margin: 0; }
.rp { font-family: Inter, "Segoe UI", Arial, Helvetica, sans-serif; color: #222; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
.rp * { box-sizing: border-box; }
.rp-page { width: 8.5in; height: 11in; margin: 0 auto; padding: .55in .5in .45in; background: #fff; display: flex; flex-direction: column; position: relative; page-break-after: always; break-after: page; overflow: hidden; font-size: 11px; line-height: 1.4; }
.rp-page:last-child { page-break-after: auto; break-after: auto; }
.rp .prep { position: absolute; top: .3in; right: .5in; font-size: 9px; color: #777; }
.rp h1 { color: ${BLUE}; font-weight: 500; font-size: 34px; margin: 0; letter-spacing: -.3px; }
.rp h2 { color: ${BLUE}; font-weight: 500; font-size: 22px; margin: 0; letter-spacing: -.2px; }
.rp .addr { font-size: 12px; color: #333; margin-top: 4px; }
.rp .cover-row { display: flex; justify-content: space-between; align-items: flex-start; margin-top: 2px; }
.rp .cover-row .l { font-size: 12px; color: #333; }
.rp .cover-row .r { text-align: right; font-size: 12px; color: #333; line-height: 1.6; }
.rp .cover-img { display: block; width: 6.5in; max-height: 5.6in; object-fit: cover; margin: .5in auto 0; }
.rp .cap { width: 6.5in; margin: 6px auto 0; font-size: 11px; color: #333; }
.rp .diagram { flex: 1; min-height: 0; display: flex; align-items: center; justify-content: center; margin-top: 10px; }
.rp .diagram svg { width: 100%; height: 100%; display: block; }
.rp .legend { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px 16px; margin-top: 22px; font-size: 12px; color: #333; }
.rp .legend span::before { content: ""; display: inline-block; width: 18px; height: 4px; background: var(--c); margin-right: 12px; vertical-align: middle; border-radius: 2px; }
.rp .legend span.dashed::before { background: none; height: 0; border-top: 4px dashed var(--c); border-radius: 0; }
.rp .stats { display: grid; grid-template-columns: 1fr 1fr; gap: 4px 24px; margin-top: 22px; font-size: 12.5px; color: #333; }
.rp .note { font-size: 10px; color: #444; margin-top: 10px; line-height: 1.45; }
.rp .foot { display: flex; justify-content: space-between; font-size: 8.5px; color: #555; margin-top: 10px; }
.rp table { width: 100%; border-collapse: collapse; font-size: 11px; }
.rp th, .rp td { padding: 5px 8px; text-align: left; border-bottom: 1px solid #eee; }
.rp th { color: ${BLUE}; font-weight: 500; background: #f6f7f9; }
.rp td.num, .rp th.num { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
.rp tr.group td { background: #f6f7f9; color: #333; }
.rp .kv td:last-child { text-align: right; font-variant-numeric: tabular-nums; }
.rp .sec { color: ${BLUE}; font-weight: 500; font-size: 14px; margin: 16px 0 6px; }
.rp .two { display: grid; grid-template-columns: 1fr 1fr; gap: 24px; }
.rp .rec { font-size: 9px; color: #777; font-weight: 400; display: block; }
.rp .mat td, .rp .mat th { padding: 4px 8px; }
.rp .empty { padding: 30px; text-align: center; color: #777; border: 1px dashed #ccc; font-size: 11px; }
.rp table.tight td, .rp table.tight th { padding: 3px 6px; font-size: 10px; }
`;

// ------------------------------------------------------------------ pages
function head(R, title) {
  return `<div class="prep">Prepared by ${esc(company.name)}</div><h2>${title}</h2><div class="addr">${esc(state.address || '')}</div>`;
}
function foot(n) { return `<div class="foot"><span>This report was prepared by ${esc(company.name)}.${company.phone ? ' ' + esc(company.phone) + '.' : ''}</span><span>${n}</span></div>`; }
const page = (inner, n) => `<section class="rp-page">${inner}${foot(n)}</section>`;

const FONT_LINK = '<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&display=swap" rel="stylesheet">';

// ------------------------------------------------------------------ one PDF for preview, print and download
// The roof report is built once (roofpdf.js: vector sheets to the Diversity Contracting design) and the same bytes go
// to the on-screen preview, the print dialog and the saved file, so the three always agree. The estimate pages are
// appended (rendered as before) when "Add to end of roof report" is ticked or the Report + estimate button is used.
const RPT = { url: null, blob: null, name: '', hash: '', sig: '', rec: null };
window.__rmLastReport = null;
async function sha256Hex(blob) { try { const d = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer()); return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join(''); } catch (_) { return ''; } }
async function buildReportPDF(opts = {}) {
  if (typeof rpBuild !== 'function') throw new Error('The report module did not load');
  const wantEst = !!opts.both || (typeof xm !== 'undefined' && !!xm.appendToReport && state.facets.length > 0);
  // the same job state gives the same file: preview, print and download share one build (and the bytes are deterministic anyway)
  const sig = JSON.stringify({ j: { ...serialize(), savedAt: null }, est: wantEst, mat: !!($('#chkPdfMaterials') && $('#chkPdfMaterials').checked), co: company, w: state.waste });
  if (RPT.rec && RPT.sig === sig) return RPT.rec;
  if (wantEst && typeof xmEnsureRoof === 'function' && !await xmEnsureRoof()) return null;
  if (typeof permitEnsure === 'function') { try { await permitEnsure(); } catch (_) { /* optional */ } }
  const { doc, pages, layout } = await rpBuild({ materials: !!($('#chkPdfMaterials') && $('#chkPdfMaterials').checked) });
  // deterministic bytes: the file carries the report date, not the second it was built
  try { const d = new Date(); d.setHours(0, 0, 0, 0); doc.setCreationDate(d); doc.setFileId('00000000000000000000000000000000'); } catch (_) { /* older jsPDF */ }
  let extraPages = 0;
  if (wantEst && typeof xmBuildHTML === 'function') {
    // jsPDF cannot merge documents: render the estimate pages into this one the same way htmlToPDF does
    const host = document.createElement('div'); host.style.cssText = 'position:fixed;left:-10000px;top:0;width:8.5in;background:#fff;z-index:-1'; host.innerHTML = `<style>${REPORT_CSS} .rp-page, .xm-page { margin: 0 !important; box-shadow: none !important; }</style><div class="rp">${xmBuildHTML().html}</div>`; document.body.appendChild(host);
    try { for (const pg of host.querySelectorAll('.rp-page, .xm-page')) { const c = await window.html2canvas(pg, { scale: 2.5, backgroundColor: '#ffffff', useCORS: true, logging: false }); doc.addPage('letter', 'portrait'); doc.addImage(c.toDataURL('image/png'), 'PNG', 0, 0, 612, 792, undefined, 'MEDIUM'); extraPages++; } } finally { host.remove(); }
  }
  const blob = doc.output('blob'); const name = fileBase() + (extraPages ? '_Roof_Report_and_Estimate.pdf' : '_Roof_Report.pdf');
  RPT.sig = sig; RPT.rec = { blob, name, pages: pages + extraPages, hash: await sha256Hex(blob), layout: layout || null }; return RPT.rec;
}
// the preview panel (an iframe with the browser's PDF viewer) with Print and Save buttons that use the same bytes
function showReportPreview(rec) {
  const panel = $('#reportPreview'), frame = $('#reportFrame'); if (!panel || !frame) return;
  if (RPT.url) { try { URL.revokeObjectURL(RPT.url); } catch (_) { /* ignore */ } }
  RPT.blob = rec.blob; RPT.name = rec.name; RPT.hash = rec.hash; RPT.url = URL.createObjectURL(rec.blob);
  frame.src = RPT.url + '#toolbar=0&view=FitH'; panel.hidden = false;
  $('#reportPreviewName').textContent = `${rec.name}  -  ${rec.pages} US Letter sheet${rec.pages === 1 ? '' : 's'}; print at 100% (Actual size)`;
}
function printReportFrame() {
  const frame = $('#reportFrame'); let done = false;
  const viaTab = () => { if (done) return; done = true; try { window.open(RPT.url, '_blank'); } catch (_) { /* blocked */ } toast('The report opened in a new tab: press Ctrl+P (Cmd+P) and print at 100%.'); window.__rmLastReport = Object.assign(window.__rmLastReport || {}, { printed: 'tab' }); };
  try { if (!frame || !frame.contentWindow) throw new Error('no frame'); frame.contentWindow.focus(); frame.contentWindow.print(); done = true; window.__rmLastReport = Object.assign(window.__rmLastReport || {}, { printed: 'frame' }); }
  catch (e) { viaTab(); }
}
// action: 'preview' | 'print' | 'download' | 'both' (download with the estimate appended)
async function reportAction(action) {
  toast('Building report...');
  const rec = await buildReportPDF({ both: action === 'both' }); if (!rec) return null;
  showReportPreview(rec);
  window.__rmLastReport = { name: rec.name, pages: rec.pages, hash: rec.hash, layout: rec.layout || null, action, previewed: true, printed: null, downloaded: false };
  if (action === 'print') { await new Promise((r) => setTimeout(r, 900)); printReportFrame(); }
  if (action === 'download' || action === 'both') { const saved = await deliverFile(rec.blob, rec.name); window.__rmLastReport.downloaded = true; toast(`Ready: ${rec.name} (${rec.pages} sheets)${saved ? '; copy saved in the reports folder' : ''}`); }
  else if (action === 'preview') toast(`Preview ready: ${rec.pages} sheets. Print and Save use this same file.`);
  return rec;
}
async function printReport() { return reportAction('print'); }
async function downloadReport() { return reportAction('download'); }

// Each letter page: text, tables and photos are rendered to an image (html2canvas: PNG for crisp text, JPEG only on
// pages with a photo), then every roof diagram is drawn on top as true vector lines (svg2pdf), so edges stay sharp
// at any zoom and when printed.
function svgForPDF(svg) {
  const c = svg.cloneNode(true);
  c.setAttribute('font-family', 'helvetica');
  c.querySelectorAll('text').forEach((t) => {
    t.setAttribute('font-family', 'helvetica');
    if (t.getAttribute('dominant-baseline') === 'middle') {     // svg2pdf ignores dominant-baseline: shift to the baseline by hand
      t.removeAttribute('dominant-baseline');
      t.setAttribute('y', (parseFloat(t.getAttribute('y')) + 0.35 * parseFloat(t.getAttribute('font-size') || 10)).toFixed(2));
    }
  });
  return c;
}
async function pagesToPDF(pages) {
  const pdf = new window.jspdf.jsPDF({ unit: 'in', format: 'letter', orientation: 'portrait', compress: true });
  const vector = typeof pdf.svg === 'function';
  for (let i = 0; i < pages.length; i++) {
    toast(`Building PDF... page ${i + 1} of ${pages.length}`);
    const pg = pages[i], pr = pg.getBoundingClientRect(), k = 8.5 / pr.width;    // px -> inches
    const svgs = vector ? [...pg.querySelectorAll('.diagram svg, .sketch svg')] : [];
    const boxes = svgs.map((s) => { const r = s.getBoundingClientRect(); return { x: (r.left - pr.left) * k, y: (r.top - pr.top) * k, w: r.width * k, h: r.height * k }; });
    svgs.forEach((s) => { s.style.visibility = 'hidden'; });
    const c = await window.html2canvas(pg, { scale: 2.5, backgroundColor: '#ffffff', useCORS: true, logging: false });
    svgs.forEach((s) => { s.style.visibility = ''; });
    if (i) pdf.addPage('letter', 'portrait');
    const photo = !!pg.querySelector('img.cover-img');
    pdf.addImage(c.toDataURL(photo ? 'image/jpeg' : 'image/png', 0.95), photo ? 'JPEG' : 'PNG', 0, 0, 8.5, 11, undefined, photo ? 'FAST' : 'MEDIUM');
    for (let j = 0; j < svgs.length; j++) {
      const b = boxes[j];
      try { await pdf.svg(svgForPDF(svgs[j]), { x: b.x, y: b.y, width: b.w, height: b.h }); }
      catch (e) {  // vector drawing failed: fall back to a sharp bitmap of that diagram
        console.warn('vector diagram failed', e);
        const dc = await window.html2canvas(svgs[j], { scale: 4, backgroundColor: '#ffffff', logging: false });
        pdf.addImage(dc.toDataURL('image/png'), 'PNG', b.x, b.y, b.w, b.h);
      }
    }
  }
  return pdf;
}
// Save a file on the computer that has the portal open (browser download). On the local server a copy also goes
// into the reports folder, but the download always happens too.
async function deliverFile(blob, name) {
  let saved = false;
  if (location.hostname === "localhost") {
    try { const r = await fetch("/save?name=" + encodeURIComponent(name), { method: "POST", body: blob }).then((x) => x.json()); saved = !!r.saved; } catch (_) { /* download anyway */ }
  }
  const url = URL.createObjectURL(blob);
  // download it (lands in the browser's download folder and shows in its downloads list) and, for a PDF, also open it
  // in a new tab so it is on screen straight away
  const go = () => {
    const a = document.createElement("a"); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
    if (blob.type === "application/pdf") { try { window.open(url, "_blank"); } catch (_) { /* pop-up blocked: the download still happened */ } }
  };
  // Chrome only trusts a download that follows a click closely. A report takes several seconds to build, so when the
  // click has "expired" show a Save button: that fresh click is never blocked as an unwanted automatic download.
  if (navigator.userActivation && !navigator.userActivation.isActive) showReadyBar(name, go, () => URL.revokeObjectURL(url));
  else { go(); setTimeout(() => URL.revokeObjectURL(url), 60000); }
  return saved;
}
function showReadyBar(name, go, done) {
  const old = document.getElementById("dlReady"); if (old) old.remove();
  const bar = document.createElement("div");
  bar.id = "dlReady";
  bar.style.cssText = "position:fixed;left:50%;bottom:70px;transform:translateX(-50%);z-index:9999;display:flex;align-items:center;gap:12px;background:#1d2128;color:#e8eaed;border:1px solid #ff7a00;border-radius:10px;padding:10px 12px 10px 16px;box-shadow:0 8px 28px rgba(0,0,0,.5);font:14px 'Segoe UI',system-ui,sans-serif;max-width:calc(100vw - 32px)";
  bar.innerHTML = `<span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">&#10003; <b>${esc(name)}</b> is ready</span>`;
  const save = document.createElement("button");
  save.className = "primary"; save.textContent = "Save PDF"; save.id = "dlReadySave";
  if (!/\.pdf$/i.test(name)) save.textContent = "Save file";
  const close = document.createElement("button");
  close.textContent = "✕"; close.title = "Close"; close.style.padding = "6px 10px";
  const finish = () => { bar.remove(); setTimeout(done, 60000); };
  save.onclick = () => { go(); finish(); };
  close.onclick = finish;
  bar.append(save, close);
  document.body.appendChild(bar);
  save.focus();
}
// html -> multi-page PDF (roof report pages .rp-page and estimate pages .xm-page, in document order)
async function htmlToPDF(html, title) {
  if (!window.jspdf || !window.html2canvas) throw new Error("PDF library did not load; check the internet connection");
  const host = document.createElement("div");
  host.style.cssText = "position:fixed;left:-10000px;top:0;width:8.5in;background:#fff;z-index:-1";
  host.innerHTML = `<style>${REPORT_CSS} .rp-page, .xm-page { margin: 0 !important; box-shadow: none !important; }</style><div class="rp">${html}</div>`;
  document.body.appendChild(host);
  try {
    if (document.fonts && document.fonts.ready) { try { await document.fonts.ready; } catch (_) { /* ignore */ } }
    const imgs = [...host.querySelectorAll("img")].filter((i) => !i.complete);
    await Promise.race([Promise.all(imgs.map((i) => new Promise((r) => { i.onload = i.onerror = r; }))), new Promise((r) => setTimeout(r, 5000))]);
    const pdf = await pagesToPDF([...host.querySelectorAll(".rp-page, .xm-page")]);
    pdf.setProperties({ title, author: company.name, creator: "Roof Measure" });
    return pdf;
  } finally { host.remove(); }
}
// what: "report" (roof report; adds the estimate when "Add to end of roof report" is ticked), "both", or "estimate"
async function downloadPDF(what = "report") {
  const wantEst = what === "both" || what === "estimate";
  if (wantEst) {
    if (typeof xmEnsureRoof !== "function" || typeof xmBuildHTML !== "function") throw new Error("The estimate module is not loaded");
    if (!await xmEnsureRoof()) return;
  }
  toast("Building PDF...");
  let html, title, name;
  if (what === "estimate") {
    html = xmBuildHTML().html;
    title = "Estimate - " + (state.address || ""); name = fileBase() + "_Estimate.pdf";
  } else throw new Error("The roof report is built by reportAction(); only the estimate uses this path");
  const pdf = await htmlToPDF(html, title);
  const n = pdf.getNumberOfPages();
  const saved = await deliverFile(pdf.output("blob"), name);
  toast(`Ready: ${name} (${n} pages)${saved ? "; copy saved in the reports folder" : ""}`);
}

// ------------------------------------------------------------------ wiring (runs after app.js)
(function wireReport() {
  if (!document.querySelector('link[href*="fonts.googleapis.com/css2?family=Inter"]')) document.head.insertAdjacentHTML('beforeend', FONT_LINK);
  // the diagram, length, area, pitch and summary pages need a traced roof: trace it automatically when there is none yet
  const ensureTrace = async () => {
    if (state.facets.length || (state.trace && state.trace.failed)) return true;
    if (!state.solar && state.location && typeof runSolar === 'function') await runSolar();
    if (!state.solar) { if (!state.edges.length) { toast('Nothing to report yet. Enter an address and get roof data first.', true); return false; } return true; }
    if (typeof autoTraceRoof !== 'function') return true;
    toast('Tracing the roof for the diagram pages...');
    try { await autoTraceRoof(); } catch (e) { toast('Auto-trace failed (' + e.message + '). Trace the roof by hand to get the diagram pages.', true); }
    return true;
  };
  const gateOk = () => { if (typeof reviewGate !== 'function' || reviewGate()) return true; toast('Export cancelled: see "5. Review before export"'); const p = $('#panelReview'); if (p) { p.open = true; p.scrollIntoView({ block: 'start' }); } return false; };
  window.rmExportGate = gateOk;
  const run = (fn, btn, gate) => async () => { const b = $(btn); b.disabled = true; try { if (await ensureTrace() && (!gate || gateOk())) await fn(); } finally { b.disabled = false; } };
  const act = (id, action) => { if ($(id)) $(id).onclick = run(async () => { try { if (!gateOk()) return; await reportAction(action); } catch (e) { console.error(e); toast('Report failed: ' + e.message, true); } }, id); };
  act('#btnReportPreview', 'preview'); act('#btnReport', 'print'); act('#btnReportPDF', 'download'); act('#btnReportBoth', 'both'); act('#btnXmBoth', 'both');
  // the estimate-only PDF keeps its own layout (rendered pages); it passes the same review gate
  if ($('#btnXmPDF')) $('#btnXmPDF').onclick = run(async () => { try { if (!gateOk()) return; await downloadPDF('estimate'); } catch (e) { console.error(e); toast('PDF failed: ' + e.message, true); } }, '#btnXmPDF');
  // preview panel controls
  const pf = () => { if (!RPT.url) return; printReportFrame(); }; const ps = async () => { if (!RPT.blob) return; await deliverFile(RPT.blob, RPT.name); window.__rmLastReport = Object.assign(window.__rmLastReport || {}, { downloaded: true }); };
  if ($('#rpPrint')) $('#rpPrint').onclick = pf; if ($('#rpSave')) $('#rpSave').onclick = ps; if ($('#rpClose')) $('#rpClose').onclick = () => { $('#reportPreview').hidden = true; };
  for (const k of Object.keys(COMPANY_DEFAULT)) {
    const el = $('#co_' + k); if (!el) continue;
    el.value = company[k] || '';
    el.oninput = () => { company[k] = el.value.trim(); localStorage.setItem('rm.company', JSON.stringify(company)); };
  }
})();
