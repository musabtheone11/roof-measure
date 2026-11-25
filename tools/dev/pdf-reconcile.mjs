// Independent reconciliation of a report PDF against the model it was drawn from. The PDF's text (pdftotext -layout) is
// parsed back into numbers and compared with the app's own totals (totals.json from run-app.mjs) and the saved job
// (roof.json). It never reads roofpdf.js, so a drawing bug, a stale value or a rounding slip shows up as a mismatch.
//   node tools/dev/pdf-reconcile.mjs <run dir>          -> prints every check, exits 1 on any mismatch
//   import { parseReportText, modelFromRun, reconcile } from './pdf-reconcile.mjs'   (bench/reconciletest.mjs uses these)
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
const RM = createRequire(import.meta.url)('../../roofmodel.js');

const num = (s) => (s == null ? null : +String(s).replace(/,/g, ''));
const r2 = (v) => Math.round(v * 100) / 100;
const TYPES = { Eave: 'eave', Rake: 'rake', Hip: 'hip', Ridge: 'ridge', Valley: 'valley', 'Step flashing': 'step', 'Wall flashing': 'wall', Transition: 'transition', Parapet: 'parapet', 'Parapet wall': 'parapet', Unspecified: 'unspecified' };
const ftIn = (s) => { const m = String(s).match(/(\d+)' (\d+)"/); return m ? +m[1] + +m[2] / 12 : null; };

// ---- the PDF text -> numbers
export function parseReportText(text) {
  const pages = text.split('\f'); const p1 = pages[0] || ''; const lines = text.split('\n'); const out = { status: null, band: {}, takeoff: [], buildings: [], blankBuildings: [], other: {}, facets: [], facetPitches: {}, edges: [], blankFacets: [], blankEdges: [], refs: [] };
  const st = p1.match(/\b(REVIEW REQUIRED|SOURCE TAKEOFF|ILLUSTRATIVE|COMPLETE)\b/); out.status = st ? st[1] : null;
  const p1l = p1.split('\n');
  const bandAfter = (cap, re) => { const i = p1l.findIndex((l) => l.includes(cap)); if (i < 0) return null; for (let k = i + 1; k < Math.min(p1l.length, i + 5); k++) { const m = p1l[k].match(re); if (m) return m; } return null; };
  const m1 = bandAfter(p1.includes('ILLUSTRATIVE SLOPED AREA') ? 'ILLUSTRATIVE SLOPED AREA' : p1.includes('NET SLOPED AREA') ? 'NET SLOPED AREA' : 'Net sloped area', /([\d,]+\.\d{2}) ft²/); if (m1) out.band.net = num(m1[1]);
  const m2 = bandAfter('NET SQUARES', /([\d,]+\.\d{2}) SQ/); if (m2) out.band.squares = num(m2[1]);
  const m3 = bandAfter(p1.includes('ILLUSTRATIVE SUBTOTAL') ? 'ILLUSTRATIVE SUBTOTAL' : p1.includes('VERIFIED SUBTOTAL') ? 'VERIFIED SUBTOTAL' : 'CONFIRMED AREA', /([\d,]+\.\d{2}) ft²(?:\s+([\d,]+\.\d{2}) ft²)?/); if (m3) { out.band.confirmed = num(m3[1]); if (m3[2]) out.band.confirmedPlusEstimate = num(m3[2]); }
  const m4 = bandAfter('REPORTED NET SLOPED AREA', /([\d,]+) ft²/); if (m4) out.band.reportedNet = num(m4[1]);
  const m5 = bandAfter('SKETCH-VERIFIED SUBTOTAL', /([\d,]+\.\d{2}) ft²\s+([\d,]+\.\d{2}) ft²\s+([\d,]+\.\d{2}) ft²/); if (m5) { out.band.subtotal = num(m5[1]); out.band.estimate = num(m5[2]); out.band.balance = num(m5[3]); }
  // takeoff rows (one per building, plus Total): name, net, SQ, [pitch], eave, rake, hip, ridge
  for (const l of p1l) { const m = l.match(/^\s*([A-Za-z][A-Za-z0-9 +\-']*?)\s{2,}([\d,]+\.\d{2})\s+([\d,]+\.\d{2})\s+(?:([\d.]+ \/ 12)\s+)?([\d,]+\.\d{2})\s+([\d,]+\.\d{2})\s+([\d,]+\.\d{2})\s+([\d,]+\.\d{2})\s*$/); if (m) out.takeoff.push({ name: m[1].trim(), net: num(m[2]), sq: num(m[3]), pitch: m[4] || null, eave: num(m[5]), rake: num(m[6]), hip: num(m[7]), ridge: num(m[8]) }); }
  for (const m of p1.matchAll(/(Valleys|Step flashing|Wall flashing|Transitions|Parapet)\s+([\d,]+\.\d{2}) ft/g)) out.other[m[1]] = num(m[2]);
  // Read the actual building columns, including a blank verified column or pitch.
  // Right-aligned cell ends in pdftotext remain tied to the corresponding header.
  const buildingPage = pages[1] || '';
  const buildingHead = /^\s*Building\s{2,}[^\n]*$/m.exec(buildingPage);
  if (buildingHead) {
    const header = buildingHead[0];
    const endOf = label => header.indexOf(label) + label.length;
    const verifiedEnd = endOf(header.includes('Illustrative ft²') ? 'Illustrative ft²' : 'Verified ft²');
    const inferredEnd = endOf('Inferred ft²');
    const block = buildingPage.slice(buildingHead.index + header.length).split('Edge schedule')[0];
    for (const line of block.split('\n')) {
      const name = /^\s*([A-Za-z][A-Za-z0-9 +\-']*?)(?:\s{2,}|$)/.exec(line)?.[1]?.trim();
      if (!name) continue;
      const row = { name, verified: null, inferred: null, pitch: line.match(/(?:Flat|\d+(?:\.\d)? \/ 12)\s*$/)?.[0]?.trim() || null };
      for (const m of line.matchAll(/[\d,]+\.\d{2}/g)) {
        const end = m.index + m[0].length;
        row[Math.abs(end - verifiedEnd) <= Math.abs(end - inferredEnd) ? 'verified' : 'inferred'] = num(m[0]);
      }
      out.buildings.push(row);
      if (row.verified == null && row.inferred == null) out.blankBuildings.push(name);
    }
  }
  // schedules on the later sheets (several tables can share a line in -layout output)
  for (const l of lines.slice(p1l.length)) {
    for (const m of l.matchAll(/\b(F\d+)\s{2,}([A-Za-z][A-Za-z ,+\-]*?)\s{2,}((?:\d+(?:\.\d)? \/ 12|Flat))\*?\s+([\d,]+(?:\.\d{2})?)(?=\s|$)/g)) out.facets.push({ id: m[1], pitch: m[3], assigned: /\/ 12\*/.test(m[0]), area: num(m[4]) });
    for (const m of l.matchAll(/\b(F\d+)\s{2,}([A-Za-z][A-Za-z ,+\-]*?)\s{2,}([\d,]+\.\d{2})\s{2,}((?:\d+(?:\.\d)? \/ 12|Flat))/g)) out.facets.push({ id: m[1], pitch: m[4], area: num(m[3]) });
    for (const m of l.matchAll(/\b(F\d+(?:–\d+)?)\s{2,}([A-Za-z][A-Za-z ,+\-]*?)\s*(?:\s{2,}|$)/g)) if (!/(?:\d \/ 12|Flat)/.test(l.slice(m.index, m.index + m[0].length + 40))) out.blankFacets.push(m[1]);
    for (const m of l.matchAll(/\b(\d{2,3})\s{2,}(Eave|Rake|Hip|Ridge|Valley|Step flashing|Wall flashing|Transition|Parapet wall|Parapet|Unspecified)(?:\s{2,}([\d,]+\.\d{2})( est\.)?)?(?=\s{2,}|\s*$)/g)) { if (m[3] != null) out.edges.push({ key: m[1], type: TYPES[m[2]], ft: num(m[3]), est: !!m[4] }); else out.blankEdges.push(m[1]); }
    for (const m of l.matchAll(/\b([EKRHVSWTPU]\d+)\s{2,}([A-Za-z][A-Za-z ]*?)\s{2,}(\d+)\s{2,}([\d,]+\.\d{2})(?: est\.)?\s{2,}([\d,]+\.\d{2})/g)) { const t = Object.entries(TYPES).find(([lab]) => m[2].toLowerCase().endsWith(lab.toLowerCase())); for (let q = 0; q < +m[3]; q++) out.edges.push({ key: m[1], type: t ? t[1] : null, ft: num(m[4]), est: / est\./.test(m[0]) }); }
    for (const m of l.matchAll(/\b(D\d+)\s{2,}(.+?)\s{2,}(\d+' \d+")\s{2,}(Visible|Inferred|Unresolved|Partial)/g)) out.refs.push({ key: m[1], ftIn: ftIn(m[3]), state: m[4] });
  }
  // Pitch and area are separate quantities: a supported pitch may remain on a row
  // whose area is blank. Restrict these matches to schedules before the summary.
  const schedules = text.split('Measurement summary')[0].split('\f').slice(1).join('\n');
  for (const line of schedules.split('\n')) {
    for (const m of line.matchAll(/\b(F\d+)\s{2,}([A-Za-z][A-Za-z ,+\-]*?)\s{2,}(Flat|\d+(?:\.\d)? \/ 12)\*?/g)) out.facetPitches[m[1]] = m[3];
    const m = line.match(/\b(F\d+)\s{2,}([A-Za-z][A-Za-z ,+\-]*?)\s{2,}(?:Flat|\d+(?:\.\d)? \/ 12)\*?\s*$/);
    if (m && !out.blankFacets.includes(m[1])) out.blankFacets.push(m[1]);
  }
  const summary = text.slice(text.indexOf('Measurement summary'));
  if (text.includes('Measurement summary')) {
    out.information = { lines: {} };
    const area = summary.match(/(?:Net sloped area|Subtotal incl\. estimates|Supported sloped subtotal)\s{2,}([\d,]+\.\d{2})/);
    const parts = summary.match(/Measured\/modelled subtotal\s{2,}([\d,]+\.\d{2})\s{2,}Inferred estimate area\s{2,}([\d,]+\.\d{2})/);
    if (area) out.information.area = num(area[1]);
    if (parts) { out.information.measured = num(parts[1]); out.information.inferred = num(parts[2]); }
    const linear = summary.split('Linear measurement totals')[1]?.split('Pitch distribution')[0] || '';
    for (const m of linear.matchAll(/\b(Eave|Valley|Hip|Ridge|Rake|Wall flashing|Step flashing|Transition|Parapet wall|Unspecified)\s{2,}(\d+' \d+")/g)) {
      const type = m[1] === 'Parapet wall' ? 'parapet' : TYPES[m[1]];
      out.information.lines[type] = ftIn(m[2]);
    }
  }
  return out;
}
// ---- the model: the app's own numbers (totals.json from the runner) plus the saved job (source document values)
// Independently validate scope provenance against the saved snapshot. Do not trust
// legacy booleans or the PDF renderer's own supported/unsupported output.
export function evidenceContextFromJob(job) {
  const e = job.trace && job.trace.scopeEvidence;
  if (!e || !['source', 'basis'].every(k => typeof e[k] === 'string' && e[k].trim())) return { selectionVerified: false, scaleVerified: false };
  const d = /^\d{4}-\d{2}-\d{2}$/.test(e.date || '') ? new Date(e.date + 'T00:00:00Z') : null;
  if (!d || !Number.isFinite(d.getTime()) || d.toISOString().slice(0, 10) !== e.date) return { selectionVerified: false, scaleVerified: false };
  const pick = x => ({ modelId: x.modelId, path: x.path, structure: x.structure || 1, level: x.level || 1, omit: !!x.omit, excluded: !!x.excluded });
  const revision = RM.modelRevision({ address: job.address, location: job.location, facets: (job.facets || []).map(pick), edges: (job.edges || []).map(pick) });
  return { selectionVerified: e.revision === revision && e.selectionVerified === true, scaleVerified: e.revision === revision && e.scaleVerified === true };
}
export function modelFromRun(totals, roof) {
  const src = roof?.source?.kind === 'source' ? roof.source : null;
  const kind = src ? 'source' : roof?.source?.kind === 'illustrative' ? 'illustrative' : 'measured';
  const raw = (roof?.facets || totals.facets || []).filter(f => !f.omit);
  const input = raw.map((f, i) => { const t = (totals.facets || []).find(t => t.name === f.name) || totals.facets?.[i] || {};
    const m = f.path ? RM.facetMeasure(f) : { plan: t.plan, sloped: t.sloped, basis: t.basis, slope12: t.slope12 };
    return { ...f, ...m, _auditId: f.modelId || f.id || f.name || 'F' + (i + 1), structure: f.structure || t.structure || 1, rawStatus: f.status || t.status || 'measured' }; });
  const netAreas = roof ? RM.netFacetAreas(input) : { rows: input.map(f => ({ ...f, netSloped: f.sloped, netPlan: f.plan, cutoutIndices: [] })), ok: true };
  const audit = roof && kind !== 'illustrative' ? RM.auditEvidence(roof, evidenceContextFromJob(roof)) : null;
  const globalUnsupported = !netAreas.ok || !!audit?.issues.some(q => q.id === 'roof');
  const issueFor = (f, i, q) => globalUnsupported || !!audit?.issues.some(x => x.code !== 'inferred-quantity' && x.id === (f._auditId || f.modelId || f.id || f.name || 'L' + (i + 1)) && (x.quantity === q || x.quantity === 'geometry'));
  const inferred = (f, i) => audit?.quantities.some(q => q.id === (f._auditId || f.modelId || f.id || f.name || 'L' + (i + 1)) && q.status === 'inferred');
  const allFacets = input.map((f, i) => { const m = netAreas.rows[i];
    const pitchUnsupported = !!f.pitchUnknown || issueFor(f, i, 'pitch');
    const cutUnsupported = m.cutoutIndices.some(ci => ['geometry', 'pitch', 'area'].some(q => issueFor(input[ci], ci, q)));
    const unsupported = !!f.areaUnsupported || pitchUnsupported || cutUnsupported || issueFor(f, i, 'area');
    const status = unsupported ? 'unresolved' : inferred(f, i) ? 'inferred' : f.rawStatus;
    return { id: f.name || 'F' + (i + 1), modelId: f.modelId, sloped: m.netSloped, plan: m.netPlan, status, rawStatus: f.rawStatus,
      structure: f.structure, excluded: !!f.excluded, pitchUnsupported, unsupported, inferredSqft: f.inferredSqft || 0, edited: !!f.edited,
      pitchText: pitchUnsupported ? null : f.basis === 'fitted' && f.slope12 != null ? (Math.round(f.slope12 * 10) === 0 ? 'Flat' : String(Math.round(f.slope12 * 10) / 10) + ' / 12') : f.pitch != null ? (f.pitch === 0 ? 'Flat' : String(f.pitch) + ' / 12') : null,
      reported: f.reportedSqft ?? null }; });
  const facets = allFacets.filter(f => !f.excluded);
  const rawEdges = (roof?.edges || totals.edges || []).filter(e => !e.omit);
  let auditEdgeIndex = 0;
  const edges = rawEdges.map((original, i) => {
    if (original.type !== 'obstruction') auditEdgeIndex++;
    const e = { ...original, _auditId: original.modelId || original.id || original.ref || 'L' + auditEdgeIndex };
    const t = totals.edges?.[i] || {}; let trueFt = t.trueFt;
    if (e.path) {
      const mid = { lat: (e.path[0].lat + e.path[1].lat) / 2, lng: (e.path[0].lng + e.path[1].lng) / 2 };
      let adjacent = null, distance = 0.6;
      for (const f of raw.filter(f => !f.excluded)) { const fr = RM.frame([f.path, [mid]]); const p = fr.xy(mid), ring = f.path.map(fr.xy);
        for (let j = 0; j < ring.length; j++) { const d = RM.pointSeg(p, ring[j], ring[(j + 1) % ring.length]); if (d < distance) { distance = d; adjacent = f; } } }
      const planeOK = e.factor != null && e.autoType === e.type && !(adjacent?.auto && adjacent.slope == null);
      trueFt = RM.lineMeasure({ ...e, factor: planeOK ? e.factor : null }, e.pitch == null && !planeOK ? adjacent?.pitch : null, roof.defaultPitch).trueFt;
    }
    const unsupported = issueFor(e, i, 'length') || issueFor(e, i, 'type');
    return { type: e.type, trueFt, status: unsupported ? 'unresolved' : inferred(e, i) ? 'inferred' : e.status || t.status || 'measured', displayedFt: e.displayedFt ?? null, ref: e.ref || null };
  }).filter(e => e.type && e.type !== 'obstruction');
  const parts = (key) => { let measured = 0, inferred = 0, unresolved = 0;
    for (const f of facets) { const status = f[key]; const part = status !== 'measured' && f.inferredSqft > 0 && f.inferredSqft < f.sloped && !f.edited ? f.inferredSqft : f.sloped;
      if (status === 'measured') measured += f.sloped;
      else if (status === 'inferred') { inferred += part; measured += f.sloped - part; }
      else { unresolved += key === 'rawStatus' ? part : f.sloped; if (key === 'rawStatus') measured += f.sloped - part; }
    } return { measured, inferred, unresolved }; };
  const supported = parts('status'), inputParts = parts('rawStatus');
  const net = facets.reduce((a, f) => a + f.sloped, 0);
  return { kind, status: !netAreas.ok || audit && !audit.ok ? 'REVIEW REQUIRED' : totals.status || null, net, reportedModelNet: totals.slopedSqft,
    measured: supported.measured, estimated: supported.inferred, unresolved: supported.unresolved, inputParts,
    areaByStatus: totals.areaByStatus || null, byType: totals.byType || {}, structures: (totals.structures || []).map(S => ({ ...S, name: roof?.source?.buildingNames?.[S.index] || (S.index === 1 ? 'Main house' : 'Detached building ' + (S.index - 1)) })), facets, edges,
    allUnsupported: facets.length > 0 && facets.every(f => f.status === 'unresolved'), audit,
    src, estimate: src?.estimate || null };
}
// ---- compare: every printed number must equal the model's value at the printed precision; unsupported values must be blank
export function reconcile(P, M) {
  const C = []; const chk = (name, ok, expected, printed, note = '') => C.push({ name, ok: !!ok, expected, printed, note });
  const eq2 = (a, b) => a != null && b != null && Math.abs(a - b) < 0.006;
  if (M.areaByStatus) chk('model: input status totals reconcile independently of evidence support', Math.abs(M.areaByStatus.measured - M.inputParts.measured) < 0.01 && Math.abs((M.areaByStatus.inferred || 0) - M.inputParts.inferred) < 0.01 && Math.abs((M.areaByStatus.unresolved || 0) - M.inputParts.unresolved) < 0.01, [r2(M.inputParts.measured), r2(M.inputParts.inferred), r2(M.inputParts.unresolved)], [r2(M.areaByStatus.measured), r2(M.areaByStatus.inferred || 0), r2(M.areaByStatus.unresolved || 0)]);
  if (M.reportedModelNet != null) chk('saved model net area matches independent recomputation', eq2(M.reportedModelNet, M.net), M.net, M.reportedModelNet);
  if (M.status) chk('status label', P.status === (M.kind === 'source' && M.status !== 'REVIEW REQUIRED' ? 'SOURCE TAKEOFF' : M.kind === 'illustrative' && M.status !== 'REVIEW REQUIRED' ? 'ILLUSTRATIVE' : M.status), M.status, P.status);
  if (M.allUnsupported && M.status === 'REVIEW REQUIRED') chk('unsupported takeoff subtotal and squares stay blank', P.band.net == null && P.band.confirmed == null && P.band.squares == null, 'blank', P.band);
  else if (M.kind === 'source' && M.src.totals && M.src.totals.netSqft != null && !M.estimate) chk('reported net area (source)', P.band.reportedNet === Math.round(M.src.totals.netSqft), M.src.totals.netSqft, P.band.reportedNet);
  else if (M.estimate) { chk('sketch-verified subtotal', eq2(P.band.subtotal, r2(M.measured)), r2(M.measured), P.band.subtotal); chk('reported estimate kept apart', eq2(P.band.estimate, r2(M.estimate.netSqft)) && eq2(P.band.balance, r2(M.estimate.netSqft - M.measured)), [r2(M.estimate.netSqft), r2(M.estimate.netSqft - M.measured)], [P.band.estimate, P.band.balance]); }
  else if (P.band.confirmed != null) { chk('supported subtotal squares', eq2(P.band.squares, r2(M.measured / 100)), r2(M.measured / 100), P.band.squares); chk('confirmed area (measured planes only)', eq2(P.band.confirmed, r2(M.measured)), r2(M.measured), P.band.confirmed); if (P.band.confirmedPlusEstimate != null) chk('confirmed + estimate = net', eq2(P.band.confirmedPlusEstimate, r2(M.net)), r2(M.net), P.band.confirmedPlusEstimate); }
  else { chk('net sloped area', eq2(P.band.net, r2(M.net)), r2(M.net), P.band.net); chk('net squares', eq2(P.band.squares, r2(M.net / 100)), r2(M.net / 100), P.band.squares); }
  if (M.kind !== 'source') {
    if (P.information) {
      const eligible = M.facets.filter(f => f.status !== 'unresolved' && !f.unsupported);
      const expectedArea = !eligible.length ? null : eligible.length === M.facets.length ? M.net : eligible.reduce((a, f) => a + f.sloped, 0);
      const equalOrBlank = (got, want) => want == null ? got == null : eq2(got, r2(want));
      chk('summary eligible sloped area', equalOrBlank(P.information.area, expectedArea), r2(expectedArea), P.information.area);
      chk('summary measured subtotal', equalOrBlank(P.information.measured, eligible.length ? M.measured : null), r2(M.measured), P.information.measured);
      chk('summary inferred subtotal', equalOrBlank(P.information.inferred, eligible.length ? M.estimated : null), r2(M.estimated), P.information.inferred);
      for (const type of ['eave', 'valley', 'hip', 'ridge', 'rake', 'wall', 'step', 'transition', 'parapet', 'unspecified']) {
        const edges = M.edges.filter(e => e.type === type);
        if (!edges.length && M.status === 'REVIEW REQUIRED') chk('summary absent ' + type + ' scope stays blank', P.information.lines[type] == null, 'blank', P.information.lines[type]);
        else if (edges.some(e => e.status === 'unresolved')) chk('summary unresolved ' + type + ' stays blank', P.information.lines[type] == null, 'blank', P.information.lines[type]);
        else { const expected = edges.reduce((a, e) => a + e.trueFt, 0); chk('summary ' + type + ' feet/inches', P.information.lines[type] != null && Math.abs(P.information.lines[type] - expected) <= 1 / 24 + 1e-6, expected, P.information.lines[type]); }
      }
    }
    const tot = P.takeoff.find((r) => r.name === 'Total') || (P.takeoff.length === 1 ? P.takeoff[0] : null);
    if (M.allUnsupported) chk('unsupported building subtotals stay blank', M.structures.every(S => P.blankBuildings.includes(S.name)) && P.buildings.length === M.structures.length, M.structures.length + ' blank building rows', P.blankBuildings.length);
    else if (P.buildings?.length) { for (const S of M.structures) { const fs = M.facets.filter(f => f.structure === S.index); const inferred = fs.filter(f=>f.status==='inferred').reduce((a,f)=>a+(f.inferredSqft > 0 && !f.edited ? Math.min(f.sloped, f.inferredSqft) : f.sloped),0); const measured = fs.filter(f=>f.status==='measured'||f.status==='inferred').reduce((a,f)=>a+f.sloped,0) - inferred; const expectedMeasured = M.kind === 'illustrative' || measured > 0 ? r2(measured) : null, expectedInferred = inferred > 0 ? r2(inferred) : null; const matches = (v, expected) => expected == null ? v == null : eq2(v, expected); chk(`building ${S.index} supported subtotals`, P.buildings.some(b=>b.name === S.name && matches(b.verified, expectedMeasured) && matches(b.inferred, expectedInferred)), [expectedMeasured, expectedInferred], P.buildings); } }
    else if (tot) for (const t of ['eave', 'rake', 'hip', 'ridge']) chk(`takeoff ${t} ft`, eq2(tot[t], r2(M.byType[t] ? M.byType[t].trueFt : 0)), r2(M.byType[t] ? M.byType[t].trueFt : 0), tot[t]); else chk('takeoff row found', false, 'a Total row or one building row', P.takeoff.length + ' rows');
    if (!P.buildings?.length && !M.allUnsupported) for (const [lab, t] of [['Valleys', 'valley'], ['Step flashing', 'step'], ['Wall flashing', 'wall'], ['Transitions', 'transition'], ['Parapet', 'parapet']]) { const v = M.byType[t] ? M.byType[t].trueFt : 0; if (v > 0.05) chk(`${lab} ft`, eq2(P.other[lab], r2(v)), r2(v), P.other[lab]); else chk(`${lab} absent when zero`, P.other[lab] == null, 'not printed', P.other[lab]); }
    for (const S of M.structures) if (M.structures.length > 1 && !P.buildings?.length && !M.allUnsupported) { const row = P.takeoff.find((r) => r.name !== 'Total' && eq2(r.net, r2(S.sloped))); chk(`building ${S.index} own row (${r2(S.sloped)} ft²)`, !!row, r2(S.sloped), row ? row.net : 'no row'); }
    // facet schedule: areas at 2 decimals; unsupported planes blank
    const byId = new Map(M.facets.map((f) => [f.id, f]));
    chk('facet schedule present', P.facets.length + P.blankFacets.length >= Math.min(M.facets.length, 1), M.facets.length + ' facets', P.facets.length + ' rows'); chk('edge schedule present', P.edges.length + P.blankEdges.length >= Math.min(M.edges.length, 1), M.edges.length + ' lines', P.edges.length + ' rows');
    for (const pf of P.facets) { const f = byId.get(pf.id); if (!f) { chk(`facet ${pf.id} exists in the model`, false, 'a model facet', pf.id); continue; } chk(`facet ${pf.id} area`, f.status !== 'unresolved' && !f.unsupported && eq2(pf.area, r2(f.sloped)), f.status === 'unresolved' || f.unsupported ? 'blank' : r2(f.sloped), pf.area); if (f.pitchText) chk(`facet ${pf.id} pitch`, pf.pitch === f.pitchText, f.pitchText, pf.pitch); }
    for (const f of M.facets) { const printed = P.facets.find((q) => q.id === f.id); if (f.status === 'unresolved' || f.unsupported) chk(`facet ${f.id} unsupported -> blank`, !printed && P.blankFacets.includes(f.id), 'blank', printed ? printed.area : 'blank'); else if (!printed) chk(`facet ${f.id} printed`, false, r2(f.sloped), 'missing'); }
    for (const f of M.facets) {
      if (f.pitchUnsupported) chk(`facet ${f.id} unsupported pitch -> blank`, P.facetPitches[f.id] == null, 'blank', P.facetPitches[f.id]);
      else if (P.facetPitches[f.id] != null && f.pitchText) chk(`facet ${f.id} independently supported pitch`, P.facetPitches[f.id] === f.pitchText, f.pitchText, P.facetPitches[f.id]);
    }
    if (P.facets.length) { const sum = M.facets.reduce((a, f) => a + f.sloped, 0); chk('facet areas including unresolved reconcile with gross model area', Math.abs(sum - M.net) < 0.01, r2(M.net), r2(sum)); }
    // edge schedule: multiset of (type, ft) at 2 decimals; unresolved lines blank; estimates marked
    { const want = M.edges.filter((e) => e.status !== 'unresolved').map((e) => `${e.type}|${r2(e.trueFt).toFixed(2)}`).sort(); const got = P.edges.map((e) => `${e.type}|${(e.ft || 0).toFixed(2)}`).sort();
      const miss = want.filter((w) => { const i = got.indexOf(w); if (i >= 0) { got.splice(i, 1); return false; } return true; }); chk('edge schedule matches the model lines', !miss.length && !got.length, `${want.length} lines`, `${P.edges.length} printed; unmatched model: ${miss.slice(0, 6).join(', ') || 'none'}; unmatched printed: ${got.slice(0, 6).join(', ') || 'none'}`);
      chk('unresolved lines blank in the schedule', P.blankEdges.length === M.edges.filter((e) => e.status === 'unresolved').length, M.edges.filter((e) => e.status === 'unresolved').length, P.blankEdges.length);
      chk('estimated lines marked est.', P.edges.filter((e) => e.est).length === M.edges.filter((e) => e.status === 'inferred').length, M.edges.filter((e) => e.status === 'inferred').length, P.edges.filter((e) => e.est).length); }
  } else {
    for (const pf of P.facets) { const f = M.facets.find((q) => q.id === pf.id); const want = f ? (f.reported != null ? f.reported : r2(f.sloped)) : null; chk(`facet ${pf.id} area (reported, else sketch-derived)`, want != null && Math.abs(pf.area - want) < 0.006, want, pf.area); }
    for (const f of M.facets) if (f.unsupported) chk(`facet ${f.id} unsupported -> blank`, !P.facets.some((q) => q.id === f.id), 'blank', 'see schedule');
    if (P.edges.length) { const want = M.edges.filter((e) => e.displayedFt != null).map((e) => +e.displayedFt.toFixed(2)).sort((a, b) => a - b), got = P.edges.map((e) => e.ft).sort((a, b) => a - b); chk('edge schedule reproduces the displayed dimensions', JSON.stringify(want) === JSON.stringify(got), want.length + ' lines', got.length + ' printed'); }
    for (const r of P.refs) { const e = M.edges.find((q) => q.ref === r.key && q.displayedFt != null); chk(`reference ${r.key} source length`, e && Math.abs(e.displayedFt - r.ftIn) < 0.05, e ? e.displayedFt : 'model ref', r.ftIn); }
  }
  return { checks: C, ok: C.every((c) => c.ok) };
}
export function reconcileRun(dir) {
  const pdf = path.join(dir, 'report.pdf'); const tot = JSON.parse(fs.readFileSync(path.join(dir, 'totals.json'), 'utf8')); const roofFile = path.join(dir, 'roof.json'); const roof = fs.existsSync(roofFile) ? JSON.parse(fs.readFileSync(roofFile, 'utf8')) : null;
  const r = spawnSync('pdftotext', ['-layout', pdf, '-'], { encoding: 'utf8', maxBuffer: 64 << 20 }); if (r.status !== 0) throw new Error('pdftotext failed: ' + (r.stderr || r.error));
  return reconcile(parseReportText(r.stdout), modelFromRun(tot, roof));
}
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)) {
  const dir = process.argv[2]; if (!dir) { console.error('usage: node tools/dev/pdf-reconcile.mjs <run dir>'); process.exit(2); }
  const res = reconcileRun(dir); for (const c of res.checks) console.log(`${c.ok ? 'ok  ' : 'FAIL'} ${c.name}: printed ${JSON.stringify(c.printed)} vs model ${JSON.stringify(c.expected)}${c.note ? ' ' + c.note : ''}`);
  console.log(`${res.ok ? 'RECONCILED' : 'MISMATCH'}: ${res.checks.filter((c) => c.ok).length} of ${res.checks.length} checks agree`); process.exit(res.ok ? 0 : 1);
}
