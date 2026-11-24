'use strict';
/* review.js - "Review before export": structure selection, geometry audit, measurement status, obstruction layer and the
 * export gate. Uses globals from app.js (state, map, computeTotals, select, setTool, recompute, toast, fmt, esc, $) and
 * roofmodel.js (RM).
 */
const RV = { shapes: [], timer: null, last: null };

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
  for (const x of t.facets) if (RM.statusOf(x.f) === 'unresolved') unresolved.push({ kind: 'facet', id: x.f.id, label: x.f.name, qty: `${fmt(x.m.sloped)} sq ft`, missing: x.f.missing || x.f.note || 'Marked unresolved' });
  t.edges.forEach((x, i) => { if (RM.statusOf(x.e) === 'unresolved') unresolved.push({ kind: 'edge', id: x.e.id, label: `L${i + 1} ${EDGE_TYPES[x.e.type].label.toLowerCase()}`, qty: `${fmt(x.m.trueFt, 1)} ft`, missing: x.e.missing || x.e.note || 'Marked unresolved' }); });
  const rec = RM.reconcile(t.facetsAll.map((x) => ({ sloped: x.m.sloped, plan: x.m.plan, status: RM.statusOf(x.f), excluded: x.f.excluded })), t.edges.map((x) => ({ type: x.e.type, trueFt: x.m.trueFt })), t);
  return { audit: a, totals: t, unresolved, reconcile: rec, errors: a.issues.filter((i) => i.severity === 'error').length, warnings: a.issues.filter((i) => i.severity === 'warn').length };
}
window.rmAudit = () => { const r = reviewState(); return { issues: r.audit.issues, unclassifiedFt: r.audit.unclassifiedFt, unresolved: r.unresolved, reconcile: r.reconcile, areaByStatus: r.totals.areaByStatus, lineByStatus: r.totals.lineByStatus, trace: state.trace ? { imageryDate: state.trace.imageryDate, imageryQuality: state.trace.imageryQuality, repairs: state.trace.repairs, obstruction: state.trace.obstruction ? { ...state.trace.obstruction, trees: state.trace.obstruction.trees.map((x) => ({ ...x, path: undefined })), structures: state.trace.obstruction.structures.map((x) => ({ ...x, path: undefined })) } : null, selection: state.trace.selection } : null }; };

function reviewZoom(at) { if (at && map) { map.panTo(at); if (map.getZoom() < 21) map.setZoom(21); } }
function reviewDrawOverlays() {
  for (const s of RV.shapes) s.setMap(null); RV.shapes = [];
  if (!map || !state.trace) return;
  const add = (s) => RV.shapes.push(s);
  const ob = state.trace.obstruction;
  if (state.showObstruction && ob) {
    for (const t of ob.trees) add(new google.maps.Polygon({ map, paths: t.path, clickable: false, zIndex: 5, fillColor: t.kind === 'overlap' ? '#ff7a00' : '#3ddc84', fillOpacity: t.kind === 'overlap' ? .28 : .12, strokeColor: t.kind === 'overlap' ? '#ff7a00' : '#3ddc84', strokeWeight: 1.5, strokeOpacity: .9 }));
    for (const b of ob.structures) add(new google.maps.Polygon({ map, paths: b.path, clickable: false, zIndex: 4, fillColor: '#9aa4b2', fillOpacity: .15, strokeColor: '#c7ced8', strokeWeight: 1.5, strokeOpacity: .9 }));
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
  recompute(); toast(fx.log.length + ' fix' + (fx.log.length === 1 ? '' : 'es') + ' applied');
}
function reviewSetStructure(idx, on) {
  for (const f of state.facets) if ((f.structure || 1) === idx) { f.omit = !on; f.shape.setOptions(facetStyle(f, false)); }
  for (const e of state.edges) if ((e.structure || 1) === idx) { e.omit = !on; e.shape.setOptions(edgeStyle(e, false)); }
  recompute();
}
function renderReview() { clearTimeout(RV.timer); RV.timer = setTimeout(renderReviewNow, 120); }
function renderReviewNow() {
  const out = $('#reviewOut'); if (!out) return;
  reviewDrawOverlays();
  if (!state.facets.length && !state.edges.length) { out.innerHTML = '<span class="muted">Trace a roof to see checks here.</span>'; return; }
  const r = reviewState(); RV.last = r; const t = r.totals, tr = state.trace;
  const pct = (v) => (t.sloped > 0 ? fmt(v / (t.areaByStatus.measured + t.areaByStatus.inferred + t.areaByStatus.unresolved || 1) * 100) : 0);
  let h = '';
  if (tr) {
    const d = tr.imageryDate; const ds = d ? `${d.year}-${String(d.month).padStart(2, '0')}-${String(d.day).padStart(2, '0')}` : 'unknown date';
    const ageY = d ? (Date.now() - new Date(d.year, d.month - 1, d.day).getTime()) / 3.15576e10 : null;
    if (ageY != null && ageY > 3) h += `<div class="small" style="color:#ffb000;margin-bottom:4px"><b>Imagery is ${fmt(ageY, 1)} years old.</b> Additions, re-roofs or removed sections since ${d.year} are not in this trace: compare with the current satellite photo before exporting.</div>`;
    h += `<div class="muted small">Auto-trace from ${esc(tr.source)}; imagery ${ds}${tr.imageryQuality ? ' (' + String(tr.imageryQuality).toLowerCase() + ' quality)' : ''}. Building chosen: ${esc(tr.selection.method)} (${fmt(tr.selection.planSqft)} sf footprint).</div>`;
  }
  // structures
  const ids = [...new Set(state.facets.map((f) => f.structure || 1))].sort((a, b) => a - b);
  if (ids.length > 1 || state.facets.some((f) => f.omit)) {
    h += `<h4>Structures in this report</h4><div class="list">${ids.map((id) => { const fs = state.facets.filter((f) => (f.structure || 1) === id); const on = !fs.every((f) => f.omit); const sf = fs.reduce((s, f) => s + facetMetrics(f).sloped, 0); return `<label class="item" style="cursor:default"><input type="checkbox" data-struct="${id}" ${on ? 'checked' : ''}> <span class="name">Structure ${id}${id === 1 ? ' (main)' : ''}</span><span class="meta">${fs.length} facets &middot; ${fmt(sf)} sf</span><button data-zoomstruct="${id}">Zoom</button></label>`; }).join('')}</div>
      <div class="muted small" style="margin-top:4px">Wrong building? Untick it here, or use <b>Pick on map</b> in panel 1 to choose the right one and trace again.</div>`;
  }
  // status
  h += `<h4>Measurement status</h4><div class="kpis">
      <div class="kpi"><div class="v">${pct(t.areaByStatus.measured)}%</div><div class="l">area measured</div></div>
      <div class="kpi"><div class="v" style="color:${t.areaByStatus.inferred ? '#ffb000' : 'inherit'}">${fmt(t.areaByStatus.inferred)}</div><div class="l">sf inferred</div></div>
      <div class="kpi"><div class="v" style="color:${r.unresolved.length ? '#ff6b61' : 'inherit'}">${r.unresolved.length}</div><div class="l">unresolved items</div></div>
    </div>`;
  if (r.unresolved.length) h += `<div class="small" style="margin:6px 0;color:#ffb4ae"><b>Totals are incomplete.</b> These items are flagged on the sketch and in the tables:</div><div class="list">${r.unresolved.map((u) => `<div class="item" data-sel="${u.kind}:${u.id}" title="${esc(u.missing)}"><span class="sw" style="background:#ff3b30"></span><span class="name">${esc(u.label)}</span><span class="meta">${u.qty}</span></div>`).join('')}</div>`;
  // obstruction
  const ob = tr && tr.obstruction;
  if (ob) {
    const over = ob.trees.filter((x) => x.kind === 'overlap'), near = ob.trees.filter((x) => x.kind === 'near');
    h += `<h4>Trees &amp; nearby structures</h4><div class="muted small">${over.length ? `<b style="color:#ff9a3d">${over.length} canopy area${over.length > 1 ? 's' : ''} over the roof</b>: ${fmt(ob.inferredPlanSqft)} sf of footprint hidden (${fmt(ob.footprintObscuredPct, 1)}%).` : 'No tree canopy over the traced roof.'} ${near.length ? `${near.length} tree${near.length > 1 ? 's' : ''} within ${fmt(OB.nearM * 3.28084)} ft${ob.tallestNearTreeFt ? ', tallest about ' + fmt(ob.tallestNearTreeFt) + ' ft above the ground' : ''}.` : 'No trees close to the roof.'} ${ob.structures.length ? `${ob.structures.length} other structure${ob.structures.length > 1 ? 's' : ''} nearby (tallest about ${fmt(ob.tallestStructureFt)} ft).` : ''}</div>`;
  }
  h += `<div class="row wrap" style="margin-top:6px;gap:14px"><label class="chk"><input type="checkbox" id="chkObst" ${state.showObstruction ? 'checked' : ''} ${ob ? '' : 'disabled'}> Show tree / structure layer</label><label class="chk"><input type="checkbox" id="chkRaw" ${state.showRaw ? 'checked' : ''} ${tr && tr.raw ? '' : 'disabled'}> Show raw trace (audit)</label></div>`;
  // audit
  const sev = { error: '#ff6b61', warn: '#ffb000', info: '#8fb8ff' };
  h += `<h4>Geometry checks</h4>`;
  if (!r.audit.issues.length) h += '<div class="muted small">No self-intersections, overlaps, duplicate lines, artifacts or unclassified outline found.</div>';
  else h += `<div class="list">${r.audit.issues.map((i, k) => `<div class="item" data-issue="${k}"><span class="sw" style="background:${sev[i.severity]}"></span><span class="name" style="white-space:normal;font-weight:400">${esc(i.message)}</span></div>`).join('')}</div>${r.audit.issues.some((i) => i.fixable) ? '<div class="row" style="margin-top:6px"><button id="btnAutoFix" class="small">Fix what can be fixed safely</button></div>' : ''}`;
  if (tr && tr.repairs && tr.repairs.length) h += `<details class="help"><summary>${tr.repairs.length} automatic repair${tr.repairs.length > 1 ? 's' : ''} during tracing</summary><div class="muted small">${tr.repairs.map((x) => esc(`${x.reason}: ${x.action}`)).join('<br>')}</div></details>`;
  h += `<div class="muted small" style="margin-top:6px">Totals check: ${r.reconcile.ok ? 'all subtotals reconcile' : '<b style="color:#ff6b61">a subtotal does not reconcile</b>'}.</div>`;
  out.innerHTML = h;
  out.querySelectorAll('[data-struct]').forEach((el) => { el.onchange = () => reviewSetStructure(+el.dataset.struct, el.checked); });
  out.querySelectorAll('[data-zoomstruct]').forEach((el) => { el.onclick = (ev) => { ev.preventDefault(); const b = new google.maps.LatLngBounds(); state.facets.filter((f) => (f.structure || 1) === +el.dataset.zoomstruct).forEach((f) => f.shape.getPath().forEach((p) => b.extend(p))); map.fitBounds(b, 80); }; });
  out.querySelectorAll('[data-sel]').forEach((el) => { el.onclick = () => { const [kind, id] = el.dataset.sel.split(':'); if (state.tool !== 'select') setTool('select'); select({ kind, id: +id }); const it = findSel(); if (it) reviewZoom(it.shape.getPath().getAt(0)); }; });
  out.querySelectorAll('[data-issue]').forEach((el) => { el.onclick = () => { const i = r.audit.issues[+el.dataset.issue]; reviewZoom(i.at); const f = i.facet && state.facets.find((x) => x.name === i.facet); if (f) { if (state.tool !== 'select') setTool('select'); select({ kind: 'facet', id: f.id }); } }; });
  const fx = $('#btnAutoFix'); if (fx) fx.onclick = reviewApplyFix;
  const co = $('#chkObst'); if (co) co.onchange = (e) => { state.showObstruction = e.target.checked; reviewDrawOverlays(); };
  const cr = $('#chkRaw'); if (cr) cr.onchange = (e) => { state.showRaw = e.target.checked; reviewDrawOverlays(); };
}
// asked before any export: incomplete totals and geometry errors must be acknowledged, never silently exported
function reviewGate() {
  if (!state.facets.length) return true;
  const r = reviewState(); const msgs = [];
  if (r.unresolved.length) msgs.push(`${r.unresolved.length} unresolved item${r.unresolved.length > 1 ? 's' : ''}: totals are incomplete (they will be flagged on the sketch and in the tables).`);
  if (r.errors) msgs.push(`${r.errors} geometry error${r.errors > 1 ? 's' : ''} (overlap, self-intersection or duplicate line) that can change the totals.`);
  if (!r.reconcile.ok) msgs.push('A subtotal does not reconcile.');
  if (!msgs.length) return true;
  return window.__rmNoConfirm ? true : confirm('Before you export:\n\n- ' + msgs.join('\n- ') + '\n\nOpen "5. Review before export" to fix them, or press OK to export with these flags shown in the report.');
}
