// Phone matching from contact files the user supplies (CRM export, lead-provider lists). Nothing is looked up online.
// A phone is filled only on a parcel match, or an address match whose last name agrees with the owner of record,
// and only when the match yields exactly one valid number.
import fs from 'node:fs';
import { createRequire } from 'node:module';
const { parseCSV, normAddr } = createRequire(import.meta.url)('../../../leadscore.js');
const YES = /^(y|yes|true|1|x|opt.?out|dnc|do not (call|contact))$/i;

export function normPhone(s) {
  let d = String(s || '').replace(/\D/g, '');
  if (d.length === 11 && d[0] === '1') d = d.slice(1);
  return d.length === 10 ? `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}` : '';
}
const lastName = (owner) => String(owner || '').toUpperCase().replace(/[^A-Z &,-]/g, ' ').split(/[\s,&]+/).filter(Boolean)[0] || '';

export function loadContactSources(sources = []) {
  const byParcel = new Map(), byAddr = new Map();
  for (const src of sources) {
    const c = src.columns || {}; const rows = parseCSV(fs.readFileSync(src.file, 'utf8'));
    for (const r of rows) {
      const rec = { source: src.name || src.file, raw: r[c.phone] || '', phone: normPhone(r[c.phone]), last: String(r[c.last_name] || '').trim().toUpperCase(),
        optOut: c.opt_out ? YES.test(String(r[c.opt_out] || '').trim()) : false, consent: c.consent ? String(r[c.consent] || '').trim() : '',
        status: c.outreach_status ? String(r[c.outreach_status] || '').trim() : '' };
      const pid = c.parcel_id ? String(r[c.parcel_id] || '').trim() : '';
      if (pid) { if (!byParcel.has(pid)) byParcel.set(pid, []); byParcel.get(pid).push(rec); }
      const addr = c.address ? normAddr(r[c.address]) : '';
      if (addr) { const k = addr + '|' + String(r[c.zip] || '').slice(0, 5); if (!byAddr.has(k)) byAddr.set(k, []); byAddr.get(k).push(rec); }
    }
  }
  return { byParcel, byAddr, size: sources.length };
}

function decide(recs, confidence) {
  const notes = []; const valid = recs.filter((r) => r.phone);
  if (!valid.length) { notes.push('invalid_phone'); return { phone: '', phone_source: recs[0].source, match_confidence: confidence, notes, recs }; }
  const distinct = [...new Set(valid.map((r) => r.phone))];
  if (distinct.length > 1) { notes.push('ambiguous_phone'); return { phone: '', phone_source: '', match_confidence: confidence, notes, recs }; }
  return { phone: distinct[0], phone_source: [...new Set(valid.map((r) => r.source))].join('; '), match_confidence: confidence, notes, recs };
}
export function matchPhone(row, index) {
  const blank = { phone: '', phone_source: '', match_confidence: '', outreach_status: '', notes: [] };
  if (!index || !index.size) return blank;
  let out = null;
  const byP = index.byParcel.get(String(row.parcel_id));
  if (byP && byP.length) out = decide(byP, 'exact_parcel');
  else {
    const byA = index.byAddr.get(normAddr(row.property_address) + '|' + String(row.zip).slice(0, 5));
    if (byA && byA.length) {
      const ln = lastName(row.owner_of_record); const named = byA.filter((r) => r.last && r.last === ln);
      out = named.length ? decide(named, 'address_name') : { phone: '', phone_source: '', match_confidence: 'address_only', notes: [], recs: byA };
    }
  }
  if (!out) return blank;
  const recs = out.recs; delete out.recs;
  const status = recs.some((r) => r.optOut) ? 'do_not_contact' : (recs.find((r) => r.status) || {}).status || '';
  const consent = (recs.find((r) => r.consent) || {}).consent; if (consent) out.notes.push('consent:' + consent);
  return { ...out, outreach_status: status };
}
