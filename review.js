'use strict';
/* review.js - "Review before export": structure selection, geometry audit, measurement status, obstruction layer, hidden
 * zones, the evidence log and the export gate. Uses globals from app.js (state, map, computeTotals, select, setTool,
 * recompute, toast, fmt, esc, $), roofmodel.js (RM) and, when loaded, altview.js (AV: other angles / other dates).
 */
const RV = { shapes: [], timer: null, last: null, form: null };

function reviewPlain() {
  return {
    facets: state.facets.map((f) => ({ name: f.name, path: pathToLiteral(f.shape), excluded: f.excluded, level: f.level || 1, omit: f.omit, status: RM.statusOf(f), id: f.id })),
    lines: state.edges.map((e) => ({ type: e.type, path: pathToLiteral(e.shape), omit: e.omit, status: RM.statusOf(e), id: e.id })),
  };
}
// audit + status summary of what is on the map right now (also used by the PDF and by the test runner)
function reviewState() {
  const g = reviewPlain(); const a = RM.audit(g.facets, g.lines); const t = computeTotals();
  const unresolved = [];
  // hidden zones: possible roof under canopy that nothing seen supports. Reported as a range, never as a number.
  for (const z of t.hiddenZones) unresolved.push({ kind: 'zone', id: z.id, label: `${z.id} hidden section${z.facetName ? ' beside ' + z.facetName : ''}`, qty: `0 to ${fmt(z.upperSqft)} sq ft`, at: z.centre,
    missing: `Tree canopy hides this area. The ${z.pitch}/12 roof plane ${z.facetName ? 'of ' + z.facetName + ' ' : ''}could continue here for up to ${fmt(z.upperSqft)} sq ft, but nothing visible shows that it does. Not included in any total. An image without the canopy (another date, an oblique or 3D view, a drone photo) or a site measurement would resolve it.` });
  for (const x of t.facets) if (RM.statusOf(x.f) === 'unresolved') unresolved.push({ kind: 'facet', id: x.f.id, label: x.f.name, qty: `${fmt(x.m.sloped)} sq ft`, missing: x.f.missing || x.f.note || 'Marked unresolved' });
  t.edges.forEach((x, i) => { if (RM.statusOf(x.e) === 'unresolved' && !EDGE_TYPES[x.e.type].notRoof) unresolved.push({ kind: 'edge', id: x.e.id, label: `L${i + 1} ${EDGE_TYPES[x.e.type].label.toLowerCase()}`, qty: `${fmt(x.m.trueFt, 1)} ft`, missing: x.e.missing || x.e.note || 'Marked unresolved' }); });
  // items a reviewer saw in another view but could not measure there
  const verify = [];
  t.facets.forEach((x) => { if (x.f.verify) verify.push({ kind: 'facet', id: x.f.id, label: x.f.name, ...x.f.verify }); });
  t.edges.forEach((x, i) => { if (x.e.verify) verify.push({ kind: 'edge', id: x.e.id, label: `L${i + 1} ${EDGE_TYPES[x.e.type].label.toLowerCase()}`, ...x.e.verify }); });
  const rec = RM.reconcile(t.facetsAll.map((x) => ({ sloped: x.m.sloped, plan: x.m.plan, status: RM.statusOf(x.f), excluded: x.f.excluded })), t.edges.map((x) => ({ type: x.e.type, trueFt: x.m.trueFt })), t);
  // the confirmed / inferred split must add up to the facet total
  rec.checks.push({ name: 'Confirmed + inferred + unresolved facet area = net sloped area + cut-outs', a: t.areaByStatus.measured + t.areaByStatus.inferred + t.areaByStatus.unresolved, b: t.facets.reduce((s, x) => s + x.m.sloped, 0), unit: 'sq ft', ok: Math.abs(t.areaByStatus.measured + t.areaByStatus.inferred + t.areaByStatus.unresolved - t.facets.reduce((s, x) => s + x.m.sloped, 0)) < 1e-6 * Math.max(1, t.sloped) });
  rec.ok = rec.checks.every((c) => c.ok);
  return { audit: a, totals: t, unresolved, verify, reconcile: rec, errors: a.issues.filter((i) => i.severity === 'error').length, warnings: a.issues.filter((i) => i.severity === 'warn').length };
}
window.rmAudit = () => { const r = reviewState(); const t = r.totals; const strip = (o) => (o ? { ...o, trees: o.trees.map((x) => ({ ...x, path: undefined })), structures: o.structures.map((x) => ({ ...x, path: undefined })), hiddenZones: undefined } : null);
  return { reportStatus: reviewReportStatus(r), issues: r.audit.issues, unclassifiedFt: r.audit.unclassifiedFt, unresolved: r.unresolved, verify: r.verify, reconcile: r.reconcile, areaByStatus: t.areaByStatus, lineByStatus: t.lineByStatus, confirmedSloped: t.confirmedSloped, inferredSloped: t.inferredSloped, hiddenUpperSloped: t.hiddenUpperSloped, obstructionFt: t.obstructionFt,
    hiddenZones: t.hiddenZones.map((z) => ({ id: z.id, structure: z.structure, facetName: z.facetName, planSqft: z.planSqft, upperSqft: z.upperSqft, pitch: z.pitch })), evidence: state.evidence, acceptedHidden: state.acceptedHidden,
    structures: t.structures.map((g) => ({ index: g.index, facets: g.facetCount, confirmed: g.areaByStatus.measured, inferred: g.areaByStatus.inferred, byType: Object.fromEntries(Object.entries(g.byType).map(([k, v]) => [k, v.true])) })),
    trace: state.trace ? { imageryDate: state.trace.imageryDate, imageryQuality: state.trace.imageryQuality, repairs: state.trace.repairs, obstruction: strip(state.trace.obstruction), selection: state.trace.selection } : null }; };

function reviewZoom(at) { if (at && map) { map.panTo(at); if (map.getZoom() < 21) map.setZoom(21); } }
function reviewDrawOverlays() {
  for (const s of RV.shapes) s.setMap(null); RV.shapes = [];
  if (!map || !state.trace) return;
  const add = (s) => RV.shapes.push(s);
  const ob = state.trace.obstruction;
  if (state.showObstruction && ob) {
    for (const t of ob.trees) add(new google.maps.Polygon({ map, paths: t.path, clickable: false, zIndex: 5, fillColor: t.kind === 'overlap' ? '#ff7a00' : '#3ddc84', fillOpacity: t.kind === 'overlap' ? .18 : .1, strokeColor: t.kind === 'overlap' ? '#ff7a00' : '#3ddc84', strokeWeight: 1.5, strokeOpacity: .9 }));
    for (const b of ob.structures) add(new google.maps.Polygon({ map, paths: b.path, clickable: false, zIndex: 4, fillColor: '#9aa4b2', fillOpacity: .15, strokeColor: '#c7ced8', strokeWeight: 1.5, strokeOpacity: .9 }));
  }
  // hidden zones: hatched, with a dashed red outline. They are not roof: the roof outline has a gap where it meets them.
  const omitted = new Set(state.facets.filter((f) => f.omit).map((f) => f.structure || 1));
  for (const z of state.trace.hiddenZones || []) {
    if (omitted.has(z.structure || 1) || z.path.length < 3) continue;
    add(new google.maps.Polygon({ map, paths: z.path, clickable: false, zIndex: 6, fillColor: '#ff3b30', fillOpacity: .12, strokeOpacity: 0 }));
    add(new google.maps.Polyline({ map, path: [...z.path, z.path[0]], clickable: false, zIndex: 7, strokeOpacity: 0, icons: [{ icon: { path: 'M 0,-1 0,1', strokeOpacity: 1, strokeColor: '#ff3b30', strokeWeight: 2, scale: 2 }, offset: '0', repeat: '9px' }] }));
    const fr = RM.frame([z.path]); for (const sg of RM.hatch(z.path.map(fr.xy), 0.8, 45)) add(new google.maps.Polyline({ map, path: sg.map(fr.ll), clickable: false, zIndex: 6, strokeColor: '#ff3b30', strokeOpacity: .75, strokeWeight: 1 }));
  }
  if (state.showRaw && state.trace.raw) for (const st of state.trace.raw) for (const f of st.facets) if (f.rawPath) add(new google.maps.Polyline({ map, path: [...f.rawPath, f.rawPath[0]], clickable: false, zIndex: 30, strokeColor: '#ff3df2', strokeWeight: 1, strokeOpacity: .95 }));
}
function reviewApplyFix() {
  const g = reviewPlain(); const fx = RM.autoFix(g.facets, g.lines);
  if (!fx.log.length) { toast('Nothing to fix automatically'); return; }
  state.facets.forEach((f, i) => { if (fx.facets[i] && fx.facets[i].path.length >= 3) f.shape.setPath(fx.facets[i].path); });
  const drop = [];
  state.edges.forEach((e, i) => { if (!fx.lines[i]) drop.push(e); else e.shape.setPath(fx.lines[i].path); });
  for (const e of drop) { e.shape.setMap(null); state.edges.splice(state.edges.indexOf(e), 1); }
  // setPath replaces the path object: re-attach the edit listeners
  for (const it of [...state.facets, ...state.edges]) { const path = it.shape.getPath(); ['set_at', 'insert_at', 'remove_at'].forEach((ev) => path.addListener(ev, recompute)); }
  if (state.trace) (state.trace.edits = state.trace.edits || []).push({ at: new Date().toISOString(), action: 'automatic fix', log: fx.log });
  recompute(); toast(fx.log.length + ' fix' + (fx.log.length === 1 ? '' : 'es') + ' applied: ' + fx.log.slice(0, 3).join('; ') + (fx.log.length > 3 ? '; ...' : ''));
}
function reviewSetStructure(idx, on) {
  for (const f of state.facets) if ((f.structure || 1) === idx) { f.omit = !on; f.shape.setOptions(facetStyle(f, false)); }
  for (const e of state.edges) if ((e.structure || 1) === idx) { e.omit = !on; e.shape.setOptions(edgeStyle(e, false)); }
  recompute();
}
// ---- evidence: what another view or another date showed, and what was done about it
const REVIEW_SOURCES = ['Google 3D view (tilted)', 'Google satellite map (current)', 'Dated aerial imagery', 'Imported drone / oblique photo', 'Imported orthomosaic', 'Site measurement', 'Other report'];
function reviewSourceDefault() { if (typeof AV !== 'undefined' && AV.active && AV.active.id !== 'google') return { source: AV.active.label, date: AV.active.date || '' }; return { source: REVIEW_SOURCES[0], date: '' }; }
function reviewLog(entry) { state.evidence.push({ at: new Date().toISOString(), ...entry }); }
// a reviewer saw, in another source, that the roof continues in a hidden zone. Only carried into the sketch when the
// roof configuration in that source matches the traced one; then the zone is re-traced as inferred roof with that evidence.
async function reviewAcceptZone(zoneId, source, date, configMatches, note) {
  const z = (state.trace && state.trace.hiddenZones || []).find((q) => q.id === zoneId); if (!z) return false;
  if (!configMatches) { reviewLog({ target: zoneId, action: 'not carried into the sketch: roof configuration differs', source, date, note: note || '' }); toast('Not carried over: the roof in that image is not the same configuration. Trace the changed part by hand on that image.', true); recompute(); return false; }
  if (state.facets.some((f) => f.edited) && !window.__rmNoConfirm && !confirm('Re-tracing replaces hand edits to facets and lines. Continue?')) return false;
  state.acceptedHidden.push({ lat: z.centre.lat, lng: z.centre.lng, zone: zoneId, source, date, note: note || '' });
  reviewLog({ target: zoneId + (z.facetName ? ' (' + z.facetName + ')' : ''), action: 'roof confirmed to continue under the former canopy; edge positions from the continued roof plane (inferred)', source, date, configMatches: true, note: note || '', resolvedUpToSqft: z.upperSqft });
  toast('Re-tracing with the confirmed section...');
  try { await autoTraceRoof({ quiet: true }); } catch (e) { toast('Re-trace failed: ' + e.message, true); return false; }
  toast(`${zoneId} carried into the sketch as inferred roof (source: ${source}${date ? ', ' + date : ''})`); return true;
}
// an edge or facet seen in another view that cannot be measured there: flagged for verification, quantities unchanged
function reviewMarkVerify(kind, id, source, date, note) {
  const it = (kind === 'facet' ? state.facets : state.edges).find((x) => x.id === id); if (!it) return;
  it.verify = { source, date, note: note || '' };
  reviewLog({ target: kind === 'facet' ? it.name : `${EDGE_TYPES[it.type].label} line`, action: 'seen but not measurable in this view: marked for verification', source, date, note: note || '' });
  recompute();
}
// an inferred item checked against georeferenced overhead imagery of another date: becomes confirmed, with its source
function reviewConfirm(kind, id, source, date, note) {
  const it = (kind === 'facet' ? state.facets : state.edges).find((x) => x.id === id); if (!it) return;
  const was = RM.statusOf(it); it.status = 'measured'; it.confirmedBy = { source, date }; it.edited = kind === 'facet' ? true : it.edited; if (kind === 'facet') it.inferredSqft = 0;
  it.shape.setOptions(kind === 'facet' ? facetStyle(it, false) : edgeStyle(it, false));
  reviewLog({ target: kind === 'facet' ? it.name : `${EDGE_TYPES[it.type].label} line`, action: `${was} -> confirmed on georeferenced imagery`, source, date, note: note || '' });
  recompute();
}
window.rmReview = { acceptZone: reviewAcceptZone, markVerify: reviewMarkVerify, confirm: reviewConfirm, log: reviewLog };

function renderReview() { clearTimeout(RV.timer); RV.timer = setTimeout(renderReviewNow, 120); }
function renderReviewNow() {
  const out = $('#reviewOut'); if (!out) return;
  reviewDrawOverlays();
  if (!state.facets.length && !state.edges.length) { out.innerHTML = '<span class="muted">Trace a roof to see checks here.</span>'; return; }
  const r = reviewState(); RV.last = r; const t = r.totals, tr = state.trace;
  let h = '';
  if (tr) {
    const d = tr.imageryDate; const ds = d ? `${+d.year || 0}-${String(+d.month || 0).padStart(2, '0')}-${String(+d.day || 0).padStart(2, '0')}` : 'unknown date';
    const ageY = d ? (Date.now() - new Date(d.year, d.month - 1, d.day).getTime()) / 3.15576e10 : null;
    if (ageY != null && ageY > 3) h += `<div class="small" style="color:#ffb000;margin-bottom:4px"><b>Imagery is ${fmt(ageY, 1)} years old.</b> Additions, re-roofs, removed trees or removed sections since ${d.year} are not in this trace: compare with newer imagery (<b>Review roof from other angles</b>) before exporting.</div>`;
    h += `<div class="muted small">Auto-trace from ${esc(tr.source)}; imagery ${ds}${tr.imageryQuality ? ' (' + esc(String(tr.imageryQuality).toLowerCase()) + ' quality)' : ''}. Building chosen: ${esc(tr.selection.method)} (${fmt(tr.selection.planSqft)} sf footprint).</div>`;
  }
  // structures
  const ids = [...new Set(state.facets.map((f) => f.structure || 1))].sort((a, b) => a - b);
  if (ids.length > 1 || state.facets.some((f) => f.omit)) {
    h += `<h4>Structures in this report</h4><div class="list">${ids.map((id) => { const fs = state.facets.filter((f) => (f.structure || 1) === id); const on = !fs.every((f) => f.omit); const sf = fs.reduce((s, f) => s + facetMetrics(f).sloped, 0); return `<label class="item" style="cursor:default"><input type="checkbox" data-struct="${id}" ${on ? 'checked' : ''}> <span class="name">${id === 1 ? 'House' : 'Detached structure ' + (id - 1)}</span><span class="meta">${fs.length} facets &middot; ${fmt(sf)} sf</span><button data-zoomstruct="${id}">Zoom</button></label>`; }).join('')}</div>
      <div class="muted small" style="margin-top:4px">Each structure gets its own subtotals. Wrong building? Untick it here, or use <b>Pick on map</b> in panel 1 to choose the right one and trace again.</div>`;
  }
  // status: confirmed first
  h += `<h4>Measurement status</h4><div class="kpis">
      <div class="kpi"><div class="v">${fmt(t.confirmedSloped)}</div><div class="l">sf confirmed</div></div>
      <div class="kpi"><div class="v" style="color:${t.inferredSloped > 0.5 ? '#ffb000' : 'inherit'}">${fmt(t.inferredSloped)}</div><div class="l">sf inferred</div></div>
      <div class="kpi"><div class="v" style="color:${r.unresolved.length ? '#ff6b61' : 'inherit'}">${r.unresolved.length}</div><div class="l">unresolved items</div></div>
    </div>`;
  if (t.obstructionFt > 0.5) h += `<div class="small muted" style="margin-top:4px">${fmt(t.obstructionFt)} ft of the visible roof ends at tree canopy (obstruction boundary). It is drawn as a gap and is in no eave, rake, ridge, valley or flashing total.</div>`;
  if (r.unresolved.length) {
    h += `<div class="small" style="margin:6px 0;color:#ffb4ae"><b>The roof is not fully measured.</b> These are hatched or flagged on the sketch and listed in the report:</div><div class="list">${r.unresolved.map((u) => `<div class="item" data-sel="${u.kind}:${u.id}" title="${esc(u.missing)}" style="flex-wrap:wrap"><span class="sw" style="background:#ff3b30"></span><span class="name">${esc(u.label)}</span><span class="meta">${esc(u.qty)}</span>${u.kind === 'zone' ? `<span style="flex-basis:100%;display:flex;gap:6px;margin-top:4px"><button class="small" data-accept="${esc(u.id)}" title="You saw in another view or a newer image that the roof continues here">Roof continues here...</button><button class="small ghost" data-zoomzone="${esc(u.id)}">Zoom</button></span>` : ''}</div>`).join('')}</div>`;
    if (RV.form) { const d0 = reviewSourceDefault();
      h += `<div class="item" style="display:block;margin-top:6px;border:1px solid #ff7a00"><b>${esc(RV.form)}: roof continues here</b>
        <div class="grid2" style="margin-top:6px"><label>Seen in <select id="rvSrc">${[...new Set([d0.source, ...REVIEW_SOURCES])].map((s0) => `<option ${s0 === d0.source ? 'selected' : ''}>${esc(s0)}</option>`).join('')}</select></label><label>Image date <input id="rvDate" type="text" placeholder="YYYY-MM-DD or unknown" value="${esc(d0.date)}"></label></div>
        <label style="display:block;margin-top:6px">Note <input id="rvNote" type="text" placeholder="what you saw (e.g. tree removed, main gable continuous)"></label>
        <label class="chk" style="margin-top:6px"><input type="checkbox" id="rvCfg"> The roof in that image has the same configuration as this trace here (same ridge, no addition or removal)</label>
        <div class="row" style="margin-top:6px"><button id="rvOk" class="primary small">Carry into the sketch</button><button id="rvCancel" class="small ghost">Cancel</button></div>
        <div class="muted small" style="margin-top:4px">The section is added as <b>inferred</b> roof: its edges come from the continued roof plane, not from that image. To make it confirmed, check it against georeferenced overhead imagery and use Confirm on the facet or line.</div></div>`; }
  }
  if (r.verify.length) h += `<h4>Marked for verification</h4><div class="list">${r.verify.map((v) => `<div class="item" data-sel="${v.kind}:${v.id}"><span class="sw" style="background:#8fb8ff"></span><span class="name">${esc(v.label)}</span><span class="meta">${esc(v.source || '')}${v.date ? ' ' + esc(v.date) : ''}</span></div>`).join('')}</div>`;
  if (state.evidence.length) h += `<details class="help" open><summary>Evidence log (${state.evidence.length})</summary><div class="muted small">${state.evidence.map((e) => `<b>${esc(e.target || '')}</b>: ${esc(e.action || '')} &middot; ${esc(e.source || '')}${e.date ? ', ' + esc(e.date) : ''}${e.note ? ' &middot; ' + esc(e.note) : ''}`).join('<br>')}</div></details>`;
  // obstruction
  const ob = tr && tr.obstruction;
  if (ob) {
    const over = ob.trees.filter((x) => x.kind === 'overlap'), near = ob.trees.filter((x) => x.kind === 'near');
    h += `<h4>Trees &amp; nearby structures</h4><div class="muted small">${over.length ? `<b style="color:#ff9a3d">${over.length} canopy area${over.length > 1 ? 's' : ''} over the roof</b>: ${fmt(ob.inferredPlanSqft)} sf of footprint inferred under it (${fmt(ob.footprintObscuredPct, 1)}%).` : 'No tree canopy over the traced roof.'} ${near.length ? `${near.length} tree${near.length > 1 ? 's' : ''} within ${fmt(OB.nearM * 3.28084)} ft${ob.tallestNearTreeFt ? ', tallest about ' + fmt(ob.tallestNearTreeFt) + ' ft above the ground' : ''}.` : 'No trees close to the roof.'} ${ob.structures.length ? `${ob.structures.length} other structure${ob.structures.length > 1 ? 's' : ''} nearby (tallest about ${fmt(ob.tallestStructureFt)} ft).` : ''}</div>`;
  }
  h += `<div class="row wrap" style="margin-top:6px;gap:14px"><label class="chk"><input type="checkbox" id="chkObst" ${state.showObstruction ? 'checked' : ''} ${ob ? '' : 'disabled'}> Show tree / structure layer</label><label class="chk"><input type="checkbox" id="chkRaw" ${state.showRaw ? 'checked' : ''} ${tr && tr.raw ? '' : 'disabled'}> Show raw trace (audit)</label></div>`;
  // audit
  const sev = { error: '#ff6b61', warn: '#ffb000', info: '#8fb8ff' };
  h += `<h4>Geometry checks</h4>`;
  if (!r.audit.issues.length) h += '<div class="muted small">No self-intersections, overlaps, duplicate lines, artifacts or unclassified outline found.</div>';
  else h += `<div class="list">${r.audit.issues.map((i, k) => `<div class="item" data-issue="${k}"><span class="sw" style="background:${sev[i.severity] || '#8fb8ff'}"></span><span class="name" style="white-space:normal;font-weight:400">${esc(i.message)}</span></div>`).join('')}</div>${r.audit.issues.some((i) => i.fixable) ? '<div class="row" style="margin-top:6px"><button id="btnAutoFix" class="small">Fix what can be fixed safely</button></div>' : ''}`;
  if (tr && tr.repairs && tr.repairs.length) h += `<details class="help"><summary>${tr.repairs.length} automatic repair${tr.repairs.length > 1 ? 's' : ''} during tracing</summary><div class="muted small">${tr.repairs.map((x) => esc(`${x.reason}: ${x.action}`)).join('<br>')}</div></details>`;
  h += `<div class="muted small" style="margin-top:6px">Totals check: ${r.reconcile.ok ? 'all subtotals reconcile' : '<b style="color:#ff6b61">a subtotal does not reconcile</b>'}.</div>`;
  out.innerHTML = h;
  out.querySelectorAll('[data-struct]').forEach((el) => { el.onchange = () => reviewSetStructure(+el.dataset.struct, el.checked); });
  out.querySelectorAll('[data-zoomstruct]').forEach((el) => { el.onclick = (ev) => { ev.preventDefault(); const b = new google.maps.LatLngBounds(); state.facets.filter((f) => (f.structure || 1) === +el.dataset.zoomstruct).forEach((f) => f.shape.getPath().forEach((p) => b.extend(p))); map.fitBounds(b, 80); }; });
  out.querySelectorAll('[data-sel]').forEach((el) => { el.onclick = (ev) => { if (ev.target.tagName === 'BUTTON') return; const [kind, id] = el.dataset.sel.split(':'); if (kind === 'zone') { const u = r.unresolved.find((q) => q.kind === 'zone' && q.id === id); if (u) reviewZoom(u.at); return; } if (state.tool !== 'select') setTool('select'); select({ kind, id: +id }); const it = findSel(); if (it) reviewZoom(it.shape.getPath().getAt(0)); }; });
  out.querySelectorAll('[data-accept]').forEach((el) => { el.onclick = () => { RV.form = el.dataset.accept; renderReviewNow(); }; });
  out.querySelectorAll('[data-zoomzone]').forEach((el) => { el.onclick = () => { const u = r.unresolved.find((q) => q.kind === 'zone' && q.id === el.dataset.zoomzone); if (u) reviewZoom(u.at); }; });
  if (RV.form && $('#rvOk')) { $('#rvCancel').onclick = () => { RV.form = null; renderReviewNow(); };
    $('#rvOk').onclick = async () => { const id = RV.form; const src = $('#rvSrc').value, date = $('#rvDate').value.trim(), cfg = $('#rvCfg').checked, note = $('#rvNote').value.trim(); RV.form = null; await reviewAcceptZone(id, src, date, cfg, note); }; }
  out.querySelectorAll('[data-issue]').forEach((el) => { el.onclick = () => { const i = r.audit.issues[+el.dataset.issue]; reviewZoom(i.at); const f = i.facet && state.facets.find((x) => x.name === i.facet); if (f) { if (state.tool !== 'select') setTool('select'); select({ kind: 'facet', id: f.id }); } }; });
  const fx = $('#btnAutoFix'); if (fx) fx.onclick = reviewApplyFix;
  const co = $('#chkObst'); if (co) co.onchange = (e) => { state.showObstruction = e.target.checked; reviewDrawOverlays(); };
  const cr = $('#chkRaw'); if (cr) cr.onchange = (e) => { state.showRaw = e.target.checked; reviewDrawOverlays(); };
}
// The report's status, stated on the first page of every export: COMPLETE only when every reported value was measured
// on georeferenced imagery and nothing that affects the totals is open. Otherwise REVIEW REQUIRED, with each reason
// and the specific evidence that would settle it. Built from the same review state the totals come from.
function reviewReportStatus(r) {
  r = r || reviewState(); const t = r.totals, tr = state.trace || {};
  return RM.reportStatus({ failed: tr.failed, facets: state.facets.length, hiddenZones: r.unresolved.filter((u) => u.kind === 'zone'), hiddenUpperSqft: t.hiddenUpperSloped,
    inferredSqft: t.inferredSloped, unresolved: r.unresolved.filter((u) => u.kind !== 'zone'), verify: r.verify, geometryErrors: r.errors, reconcileOk: r.reconcile.ok,
    imageryQuality: tr.engine ? tr.imageryQuality : null, layerChoice: tr.layerChoice, addressCheck: tr.addressCheck, newerRecords: tr.newerRecords, extra: typeof reviewExtraReasons === 'function' ? reviewExtraReasons(r) : [] });
}
// asked before any export: incomplete totals and geometry errors must be acknowledged, never silently exported
function reviewGate() {
  if (!state.facets.length && !(state.trace && state.trace.failed)) return true;
  const st = reviewReportStatus(); if (st.status === 'COMPLETE') return true;
  return window.__rmNoConfirm ? true : confirm('REVIEW REQUIRED before you export:\n\n- ' + st.reasons.map((q) => q.text).join('\n- ') + '\n\nThe report states this on its first page with the evidence each item needs. Open "5. Review before export" (and "Review roof from other angles") to resolve them, or press OK to export a REVIEW REQUIRED report.');
}
