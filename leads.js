'use strict';
/* leads.js - Leads tab (Stage 2 of the lead workflow).
 * Loads leads-data/stage1.csv from the Stage 1 script, checks each age-band home against Google's Solar building
 * (the building must sit on the listed parcel), records report_status, and exports the CRM CSVs with on-demand report links.
 * Progress is saved per row in IndexedDB (database rm-leads), so a reload or restart resumes without repeating finished rows.
 * Uses the API key saved in this browser (state.key via fetchSolar). No Solar values are stored: only status, imagery date and
 * the matched building's centre for the link. */
const LeadsTab = (function () {
  const LINK_BASE = 'https://musabtheone11.github.io/roof-measure/';
  const MAX_DIST_M = 30;
  const GAP_MS = 200;
  const bandsFor = (min) => ['15+', '10-15', `${min}-10`];

  function pointInRing([x, y], ring) {
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i], [xj, yj] = ring[j];
      if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  }
  const distM = (lat1, lng1, lat2, lng2) => Math.hypot((lat2 - lat1) * 110540, (lng2 - lng1) * 111320 * Math.cos(((lat1 + lat2) / 2) * Math.PI / 180));
  const isoOf = (d) => (d && d.year ? `${d.year}-${String(d.month || 1).padStart(2, '0')}-${String(d.day || 1).padStart(2, '0')}` : '');

  // one row -> { report_status, imagery_date, match_lat, match_lng, notes }; rejects with err.fatal for key / quota problems
  async function checkLeadRow(row, { solar = (lat, lng) => fetchSolar(lat, lng) } = {}) {
    const lat = parseFloat(row.lat), lng = parseFloat(row.lng);
    let ring = []; try { ring = JSON.parse(row.ring_json || '[]'); } catch (_) { /* no ring */ }
    if (!isFinite(lat) || !isFinite(lng)) return { report_status: 'api_error: no coordinates', imagery_date: '', match_lat: null, match_lng: null, notes: '' };
    let b;
    try { b = await solar(lat, lng); }
    catch (e) {
      // stop the run (don't burn through every row) for key, quota or connection problems; Google reports a bad key as HTTP 400
      const keyProblem = e.status === 400 && /api key|permission|billing|not authorized|disabled/i.test(e.message || '');
      if (e.status === 401 || e.status === 403 || e.status === 429 || keyProblem || e instanceof TypeError) {
        const f = new Error(e instanceof TypeError ? 'No connection to Google (' + e.message + ')' : (e.message || 'Google refused the request')); f.fatal = true; f.status = e.status; throw f;
      }
      if (e.status === 404) return { report_status: 'no_imagery', imagery_date: '', match_lat: null, match_lng: null, notes: '' };
      return { report_status: 'api_error: ' + String(e.message || e).slice(0, 120), imagery_date: '', match_lat: null, match_lng: null, notes: '' };
    }
    const c = b && b.center; if (!c) return { report_status: 'no_imagery', imagery_date: '', match_lat: null, match_lng: null, notes: '' };
    const notes = [];
    if (b.imageryQuality === 'LOW') notes.push('low_quality_imagery');
    const inside = ring.length >= 4 ? pointInRing([c.longitude, c.latitude], ring) : false;
    const d = distM(lat, lng, c.latitude, c.longitude);
    const okMatch = inside && d <= MAX_DIST_M;
    if (!okMatch) notes.push(`building ${Math.round(d)} m from parcel centre${inside ? '' : ', outside the parcel'}`);
    // several buildings on the parcel: Google's closest building may be a garage or shed, so no link until someone confirms it
    const multi = /multi_building/.test(row.notes || '');
    if (okMatch && multi) notes.push('several buildings on this parcel: open the house in the Residential tab to confirm');
    return { report_status: okMatch ? (multi ? 'check_building' : 'ok') : 'wrong_building', imagery_date: isoOf(b.imageryDate), match_lat: +c.latitude.toFixed(6), match_lng: +c.longitude.toFixed(6), notes: notes.join('; ') };
  }

  function leadLink(row, match) {
    const q = new URLSearchParams({ lead: row.parcel_id, lat: String(match.match_lat), lng: String(match.match_lng), addr: `${row.property_address}, FL ${row.zip}`, ev: row.evidence || '' });
    return LINK_BASE + '?' + q.toString();
  }

  // ------------------------------------------------------------ progress store
  function memoryStore() { const m = new Map(); return { get: async (k) => m.get(k) || null, put: async (v) => { m.set(v.parcel_id, v); }, clear: async () => m.clear() }; }
  function idbStore() {
    const open = () => new Promise((res, rej) => { const r = indexedDB.open('rm-leads', 1); r.onupgradeneeded = () => r.result.createObjectStore('rows', { keyPath: 'parcel_id' }); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
    let dbp = null; const db = () => (dbp = dbp || open());
    const tx = async (mode, fn) => { const d = await db(); return new Promise((res, rej) => { const t = d.transaction('rows', mode); const st = t.objectStore('rows'); const req = fn(st); t.oncomplete = () => res(req && req.result); t.onerror = () => rej(t.error); }); };
    return { get: (k) => tx('readonly', (s) => s.get(k)).then((v) => v || null), put: (v) => tx('readwrite', (s) => s.put(v)), clear: () => tx('readwrite', (s) => s.clear()) };
  }

  // ------------------------------------------------------------ batch run
  async function runLeadBatch(rows, { store, check = checkLeadRow, min = 8, batch = 25, shouldStop = () => false, onProgress = () => {}, gapMs = 0 } = {}) {
    const elig = rows.filter((r) => bandsFor(min).includes(r.age_band));
    const sum = { total: elig.length, ok: 0, failed: 0, pending: 0, stopped: false, error: null };
    const todo = [];
    for (const r of elig) { const s = await store.get(r.parcel_id); if (s && s.report_status === 'ok') sum.ok++; else todo.push(r); }
    for (let i = 0; i < todo.length; i++) {
      if (shouldStop()) { sum.stopped = true; break; }
      let res;
      try { res = await check(todo[i]); }
      catch (e) { if (e.fatal) { sum.stopped = true; sum.error = e.message; break; } res = { report_status: 'api_error: ' + e.message, imagery_date: '', match_lat: null, match_lng: null, notes: '' }; }
      await store.put({ parcel_id: todo[i].parcel_id, ...res, checked_at: new Date().toISOString() });
      if (res.report_status === 'ok') sum.ok++; else sum.failed++;
      if ((i + 1) % batch === 0 || i === todo.length - 1) onProgress({ ...sum, done: sum.ok + sum.failed });
      if (gapMs) await new Promise((r) => setTimeout(r, gapMs));
    }
    sum.failed = 0; sum.ok = 0;
    for (const r of elig) { const s = await store.get(r.parcel_id); if (!s) continue; if (s.report_status === 'ok') sum.ok++; else sum.failed++; }
    sum.pending = sum.total - sum.ok - sum.failed;
    onProgress({ ...sum, done: sum.ok + sum.failed });
    return sum;
  }

  async function exportLeadCSVs(rows, store, min = 8) {
    const out = [];
    for (const r of rows) {
      const o = {}; for (const c of LeadsCore.COLUMNS) o[c] = r[c] == null ? '' : r[c];
      if (bandsFor(min).includes(r.age_band)) {
        const s = await store.get(r.parcel_id);
        o.report_status = s ? s.report_status : 'pending'; o.imagery_date = s ? s.imagery_date || '' : '';
        o.roof_report_link = s && s.report_status === 'ok' ? leadLink(r, s) : '';
        if (s && s.notes) o.notes = [o.notes, s.notes].filter(Boolean).join('; ');
      } else { o.report_status = 'not_eligible'; o.roof_report_link = ''; }
      out.push(o);
    }
    const pick = (b) => out.filter((r) => r.age_band === b);
    return { 'leads_all.csv': LeadsCore.toCSV(out, LeadsCore.COLUMNS), 'leads_15plus.csv': LeadsCore.toCSV(pick('15+'), LeadsCore.COLUMNS),
      'leads_10to15.csv': LeadsCore.toCSV(pick('10-15'), LeadsCore.COLUMNS), [`leads_${min}to10.csv`]: LeadsCore.toCSV(pick(`${min}-10`), LeadsCore.COLUMNS),
      'leads_needs_review.csv': LeadsCore.toCSV(pick('needs_review'), LeadsCore.COLUMNS) };
  }

  // ------------------------------------------------------------ panel
  function wire() {
    const panel = $('#panelLeads'); if (!panel) return;
    const ui = { rows: [], running: false, stop: false, store: idbStore() };
    const keyPanel = $('#apiKey') && $('#apiKey').closest('details');
    const setLeadMode = (on) => {
      document.body.classList.toggle('mode-lead', on);
      $('#modeLead').classList.toggle('on', on);
      if (on) { $('#modeRes').classList.remove('on'); $('#modeCom').classList.remove('on'); if (keyPanel) keyPanel.classList.add('lead-keep'); }
    };
    $('#modeLead').onclick = () => setLeadMode(true);
    for (const id of ['#modeRes', '#modeCom']) $(id).addEventListener('click', () => setLeadMode(false));
    const min = () => (+$('#leadMin').value === 7 ? 7 : 8);
    const render = (p) => {
      if (p) $('#leadProgress').textContent = `${p.done} of ${p.total} checked: ${p.ok} ok, ${p.failed} failed, ${p.pending != null ? p.pending : p.total - p.done} pending${p.error ? '. Stopped: ' + p.error : ''}`;
      const head = '<tr><th>Band</th><th>Address</th><th>Owner</th><th>Phone</th></tr>';
      $('#leadTable').innerHTML = head + ui.rows.slice(0, 50).map((r) => `<tr><td>${esc(r.age_band)}</td><td>${esc(r.property_address)}</td><td>${esc(r.owner_of_record)}</td><td>${esc(r.phone || '')}</td></tr>`).join('');
    };
    $('#leadFile').onchange = async (e) => {
      const f = e.target.files[0]; if (!f) return;
      ui.rows = LeadsCore.parseCSV(await f.text());
      const counts = {}; for (const r of ui.rows) counts[r.age_band] = (counts[r.age_band] || 0) + 1;
      $('#leadProgress').textContent = `${ui.rows.length} rows loaded: ` + Object.entries(counts).map(([k, v]) => `${k} ${v}`).join(', ');
      render();
    };
    $('#leadStart').onclick = async () => {
      if (!ui.rows.length) { toast('Load stage1.csv first', true); return; }
      if (!state.key) { toast('Save your Google API key first', true); return; }
      if (ui.running) return; ui.running = true; ui.stop = false; $('#leadStart').disabled = true;
      try { await runLeadBatch(ui.rows, { store: ui.store, min: min(), batch: Math.max(1, +$('#leadBatch').value || 25), gapMs: GAP_MS, shouldStop: () => ui.stop, onProgress: render }); }
      finally { ui.running = false; $('#leadStart').disabled = false; }
    };
    $('#leadPause').onclick = () => { ui.stop = true; };
    $('#leadExport').onclick = async () => {
      if (!ui.rows.length) { toast('Load stage1.csv first', true); return; }
      const files = await exportLeadCSVs(ui.rows, ui.store, min());
      for (const [name, text] of Object.entries(files)) {
        const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob(['﻿' + text], { type: 'text/csv;charset=utf-8' })); a.download = name;
        document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
      }
    };
  }
  if (typeof document !== 'undefined') { if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', wire); else wire(); }
  return { pointInRing, checkLeadRow, leadLink, runLeadBatch, exportLeadCSVs, memoryStore, idbStore };
})();
