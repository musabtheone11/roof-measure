'use strict';
/* leadscore.js - shared lead-list logic: permit scope, roof-age bands, evidence links, CSV.
 * Loaded by the app as a plain script (window.LeadsCore) and by tools/leads (Node) with require().
 * Pure functions only: no network, no DOM. */
(function (root) {
  const COLUMNS = ['age_band', 'property_address', 'zip', 'parcel_id', 'owner_of_record', 'mailing_address', 'phone', 'phone_source', 'match_confidence',
    'outreach_status', 'roof_report_link', 'report_status', 'estimated_roof_age', 'age_basis', 'latest_permit_issue_date', 'latest_completed_replacement_date',
    'permit_number', 'permit_status', 'permit_source', 'permit_coverage', 'review_reason', 'year_built', 'jurisdiction', 'imagery_date', 'notes'];

  // ------------------------------------------------------------ dates and addresses
  function isoDate(s) {
    if (!s) return null;
    const t = String(s).trim();
    let m = t.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (m) return valid(+m[1], +m[2], +m[3]);
    m = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
    if (m) return valid(+m[3], +m[1], +m[2]);
    return null;
  }
  function valid(y, mo, d) {
    const dt = new Date(y, mo - 1, d);
    if (dt.getFullYear() !== y || dt.getMonth() !== mo - 1 || dt.getDate() !== d) return null;
    return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  }
  const localDate = (iso) => { const [y, m, d] = iso.split('-').map(Number); return new Date(y, m - 1, d); };
  const SUFFIX = { DRIVE: 'DR', STREET: 'ST', ROAD: 'RD', AVENUE: 'AVE', COURT: 'CT', CIRCLE: 'CIR', LANE: 'LN', BOULEVARD: 'BLVD', PLACE: 'PL',
    TERRACE: 'TER', TRAIL: 'TRL', PARKWAY: 'PKWY' };
  function normAddr(s) {
    return String(s || '').toUpperCase().replace(/[.,#]/g, ' ').split(/\s+/).filter(Boolean).map((w) => SUFFIX[w] || w).join(' ');
  }

  // ------------------------------------------------------------ permit scope
  const VOID = /void|withdr|cancel|denied|reject/i;
  const EXCLUDED = /shed|detached|garage|carport|pool|screen|enclosure|accessory|barn|gazebo|pergola/i;
  const PARTIAL = /repair|patch|partial|leak|replace (\d+ )?sq|\d+ ?sq\b|section|soffit|fascia|gutter|skylight/i;
  const AMBIGUOUS = /repair\s*\/\s*replace/i;   // Clay's work class "Residential Roof Repair/Replacement" covers both
  const FULL = /re[- ]?roof|roof over existing|tear ?off|replace(ment)?|new roof|recover/i;
  const NOT_DONE = /expired|stopped|active|review|pending|correction|issued|open|incomplete|not final/i;
  const DONE = /^\s*(final(ed|ized)?|complete(d)?|closed)\b/i;   // anchored: "Incomplete" and "Not Final" are not completions
  function permitScope(p) {
    const work = p.work || '', type = p.type || '', structure = p.structure || '';
    if (EXCLUDED.test(structure) || EXCLUDED.test(work)) return 'excluded';
    if (AMBIGUOUS.test(work)) return 'unknown';
    if (PARTIAL.test(work)) return 'partial';
    // the permit type only counts when it names a replacement on its own (Clay's "Repair/Replacement" type covers both)
    if (FULL.test(work) || (FULL.test(type) && !AMBIGUOUS.test(type) && !/^roof(ing)? permit$/i.test(type.trim()))) return 'full';
    // older City of Jacksonville roofing permits carry no work type; roofing permits then were for replacements
    if (!work.trim() && /roof/i.test(type) && p.source === 'COJ_INDEX') { const d = isoDate(p.issued); if (d && d < '2007-01-01') return 'full'; }
    return 'unknown';
  }
  function completion(p) {
    if (permitScope(p) !== 'full' || VOID.test(p.status || '')) return null;
    const fin = isoDate(p.finaled), iss = isoDate(p.issued);
    if (DONE.test(p.status || '')) return fin ? { date: fin } : (iss ? { date: iss, note: 'completion_date_from_issue' } : null);
    if (fin && !NOT_DONE.test(p.status || '')) return { date: fin };
    return null;
  }
  function summarizePermits(permits) {
    const live = (permits || []).filter((p) => !VOID.test(p.status || ''));
    const byIssued = live.filter((p) => isoDate(p.issued)).sort((a, b) => (isoDate(b.issued) < isoDate(a.issued) ? -1 : 1));
    const latestIssued = byIssued[0] || null;
    let latestCompleted = null, completedDate = null, completedNote = null;
    for (const p of live) { const c = completion(p); if (c && (!completedDate || c.date > completedDate)) { latestCompleted = p; completedDate = c.date; completedNote = c.note || null; } }
    const newerUnverified = live.some((p) => {
      const s = permitScope(p); if (s !== 'full' && s !== 'unknown') return false;
      if (completion(p)) return false;
      const iss = isoDate(p.issued); return !!iss && (!completedDate || iss > completedDate);
    });
    return { latestIssued, latestCompleted, completedDate, completedNote, newerUnverified };
  }

  // ------------------------------------------------------------ classification
  function wholeYears(fromIso, now) {
    const a = localDate(fromIso); const n = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    let y = n.getFullYear() - a.getFullYear();
    if (n.getMonth() < a.getMonth() || (n.getMonth() === a.getMonth() && n.getDate() < a.getDate())) y--;
    return y;
  }
  function bandOf(age, min) {
    if (age >= 15) return '15+';
    if (age >= 10) return '10-15';
    if (age >= min) return `${min}-10`;
    return 'screened_out_recent';
  }
  function classify(input, cfg) {
    const now = cfg.now || new Date(); const min = cfg.minYears === 7 ? 7 : 8;
    const S = summarizePermits(input.permits);
    const out = { age_band: 'needs_review', estimated_roof_age: null, age_basis: 'none', review_reason: null,
      latest_permit_issue_date: S.latestIssued ? isoDate(S.latestIssued.issued) : null, latest_completed_replacement_date: S.completedDate,
      permit_number: (S.latestCompleted || S.latestIssued || {}).number || null, permit_status: (S.latestCompleted || S.latestIssued || {}).status || null,
      notes: S.completedNote ? [S.completedNote] : [] };
    if (S.latestCompleted) {
      out.age_basis = 'completed_permit'; out.estimated_roof_age = wholeYears(S.completedDate, now);
      if (S.newerUnverified) { out.review_reason = 'newer_permit_unverified'; out.permit_number = S.latestIssued.number; out.permit_status = S.latestIssued.status; return out; }
      out.age_band = bandOf(out.estimated_roof_age, min); return out;
    }
    if (input.coverage === 'error') { out.review_reason = 'permit_lookup_error'; return out; }
    if (S.newerUnverified) { out.review_reason = 'newer_permit_unverified'; return out; }
    if (input.coverage === 'none') { out.review_reason = 'no_permit_coverage'; if (input.yearBuilt) { out.age_basis = 'year_built'; out.estimated_roof_age = now.getFullYear() - input.yearBuilt; } return out; }
    if (!input.yearBuilt) { out.review_reason = 'no_year_built'; return out; }
    out.age_basis = 'year_built'; out.estimated_roof_age = now.getFullYear() - input.yearBuilt; out.review_reason = 'possibly_original';
    return out;
  }

  // ------------------------------------------------------------ evidence (base64url JSON) for report links
  const b64 = typeof btoa === 'function' ? btoa : (s) => Buffer.from(s, 'binary').toString('base64');
  const unb64 = typeof atob === 'function' ? atob : (s) => Buffer.from(s, 'base64').toString('binary');
  function encodeEvidence(ev) {
    const bin = unescape(encodeURIComponent(JSON.stringify(ev)));
    return b64(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }
  function decodeEvidence(s) {
    try {
      if (!/^[A-Za-z0-9_-]+$/.test(s || '')) return null;
      const t = s.replace(/-/g, '+').replace(/_/g, '/'); const pad = t + '==='.slice((t.length + 3) % 4);
      return JSON.parse(decodeURIComponent(escape(unb64(pad))));
    } catch (_) { return null; }
  }

  // ------------------------------------------------------------ CSV (RFC 4180)
  const cell = (v) => { const s = v == null ? '' : String(v); return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  function toCSV(rows, columns) {
    return [columns.map(cell).join(','), ...rows.map((r) => columns.map((c) => cell(r[c])).join(','))].join('\r\n') + '\r\n';
  }
  function parseCSV(text) {
    const recs = []; let rec = [], f = '', q = false;
    const s = String(text).replace(/^﻿/, '');
    for (let i = 0; i < s.length; i++) {
      const ch = s[i];
      if (q) { if (ch === '"') { if (s[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += ch; continue; }
      if (ch === '"') q = true;
      else if (ch === ',') { rec.push(f); f = ''; }
      else if (ch === '\n' || ch === '\r') { if (ch === '\r' && s[i + 1] === '\n') i++; rec.push(f); f = ''; recs.push(rec); rec = []; }
      else f += ch;
    }
    if (f !== '' || rec.length) { rec.push(f); recs.push(rec); }
    const head = recs.shift() || [];
    return recs.filter((r) => r.length > 1 || r[0] !== '').map((r) => Object.fromEntries(head.map((h, i) => [h, r[i] == null ? '' : r[i]])));
  }

  // only plain web links go into report pages (a crafted link must not carry javascript: or data: URLs)
  const safeUrl = (u) => (/^https?:\/\//i.test(String(u || '').trim()) ? String(u).trim() : '');

  const api = { safeUrl, COLUMNS, isoDate, normAddr, permitScope, summarizePermits, classify, encodeEvidence, decodeEvidence, toCSV, parseCSV };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.LeadsCore = api;
})(typeof window !== 'undefined' ? window : globalThis);
