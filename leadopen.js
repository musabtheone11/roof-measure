'use strict';
/* leadopen.js - open a lead's roof report from a link in the lead list.
 * URL: ?lead=<parcel id>&lat=<lat>&lng=<lng>&addr=<address>&ev=<Stage 1 permit evidence (LeadsCore.encodeEvidence)>
 * Locks the house, runs Get roof data and Auto-trace, and shows the Stage 1 permit evidence on the report's permit page.
 * Without ?lead= this file does nothing. The link never carries the API key: it uses the key saved in this browser. */
window.leadContext = (function () {
  const q = new URLSearchParams(location.search);
  if (!q.get('lead')) return null;
  const lat = parseFloat(q.get('lat')), lng = parseFloat(q.get('lng'));
  if (!isFinite(lat) || !isFinite(lng)) return null;
  return { parcel: q.get('lead'), addr: q.get('addr') || '', lat, lng, evidence: window.LeadsCore ? LeadsCore.decodeEvidence(q.get('ev') || '') : null };
})();

// permit data for the report, built from the evidence in the link (the public page cannot query Clay or St. Johns live)
function leadPermitData(address) {
  const ev = leadContext.evidence || {};
  const permits = [];
  if (ev.n) permits.push({ number: ev.n, type: 'Roofing Permit', use: '', structure: '', work: ev.b === 'completed_permit' ? 'Full roof replacement (completed)' : 'Roof permit',
    status: ev.s || '', submitted: null, issued: ev.b === 'completed_permit' ? (ev.c || ev.i) : (ev.i || null), finaled: ev.c || null, link: ev.src || '', roof: true });
  const notes = [`Permit evidence from the lead list, checked ${ev.on || 'during list building'}.`];
  if (ev.i && ev.c && ev.i > ev.c) notes.push(`A newer roof permit was issued ${ev.i} without a verified completion.`);
  if (ev.cov === 'since_2023') notes.push('Online permit records for this county start in January 2023.');
  if (ev.cov === 'none') notes.push(`${ev.j || 'This city'} issues its own permits; no online records were checked.`);
  return { checked: new Date().toISOString(), address, county: null, jurisdiction: ev.j || null, parcel: { id: leadContext.parcel }, yearBuilt: ev.yb || null, effYear: null,
    roofCover: null, roofStruct: null, permits, searched: ev.cov === 'full_history' || ev.cov === 'since_2023', recordsFrom: ev.cov === 'since_2023' ? 2023 : ev.cov === 'full_history' ? 1970 : null,
    source: 'Lead list (public permit records)', portal: ev.src ? { name: 'Permit record', url: ev.src } : null, notes, errors: [] };
}
function leadCoverLine() {
  if (!window.leadContext) return '';
  const today = new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  return `<div class="addr" style="margin-top:4px">Parcel ${esc(leadContext.parcel)} &middot; Measured ${today}</div>`;
}

(function wireLead() {
  if (!window.leadContext) return;
  if (typeof permitLookup === 'function') {
    const orig = permitLookup;
    permitLookup = async function (loc, address) { return window.leadContext && leadContext.evidence ? leadPermitData(address) : orig(loc, address); };
  }
  const banner = document.createElement('div');
  banner.className = 'lead-banner';
  banner.textContent = `Lead report for ${leadContext.addr || 'this property'} (parcel ${leadContext.parcel}). Loading the roof...`;
  document.body.appendChild(banner);
  const start = () => {
    (async () => {
      try {
        if (typeof setMode === 'function') setMode('res');
        setLocation({ lat: leadContext.lat, lng: leadContext.lng }, leadContext.addr);
        await runSolar();
        if (!state.solar) { banner.textContent = 'Google has no roof model for this house. Trace the roof by hand, or check the address.'; banner.classList.add('err'); return; }
        await autoTraceRoof();
        banner.textContent = `Lead report for ${leadContext.addr} (parcel ${leadContext.parcel}). Press Download PDF for the report.`;
      } catch (e) { banner.textContent = 'Could not build this report: ' + (e.message || e); banner.classList.add('err'); }
    })();
  };
  if (!state.key) { banner.textContent = 'Save your Google Maps API key in this browser first (Settings panel), then open the link again.'; banner.classList.add('err'); return; }
  if (window.map) { start(); return; }   // Maps already loaded before this script ran
  const origInit = window.initMap;
  window.initMap = function () { origInit.apply(this, arguments); start(); };
})();
