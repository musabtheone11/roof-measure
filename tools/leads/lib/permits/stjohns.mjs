// St. Johns County WATS permit search. Search by street address (the parcel field returns nothing for these parcels),
// keep exact address matches, then open the detail page of each reroof permit (use code 435) for its description and completion date.
import { createRequire } from 'node:module';
const { isoDate, normAddr } = createRequire(import.meta.url)('../../../../leadscore.js');
const BASE = 'https://webapp.sjcfl.us/WATSWebX/Permit/';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36';
const ROOF_CODES = /^435/;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const text = (h) => h.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();

export function parseResults(html) {
  const out = [];
  for (const m of html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)) {
    const cells = [...m[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((c) => text(c[1]));
    if (cells.length >= 4 && /^\d{6,}$/.test(cells[0]) && /\d{1,2}\/\d{1,2}\/\d{4}/.test(cells[3]))
      out.push({ number: cells[0], address: normAddr(cells[1]), code: cells[2], issued: isoDate(cells[3]) });
  }
  return out;
}
export function parseDetail(html) {
  const f = {};
  for (const m of html.matchAll(/<(input|span)\b[^>]*>([^<]*)/g)) {
    const id = (m[0].match(/id="cphBody_([^"]*)"/) || [])[1]; if (!id) continue;
    const v = ((m[0].match(/value="([^"]*)"/) || [])[1] ?? m[2]).trim(); if (v) f[id] = v.replace(/&amp;/g, '&');
  }
  const st = f.LabelStatus || '';
  const status = /cert compl|cert occ/i.test(st) ? 'Completed' : /void/i.test(st) ? 'Void' : /expired/i.test(st) ? 'Expired' : (st.split(' - ')[0] || '');
  return { work: f.txtPropUse || '', issued: isoDate(f.txtIssueDt), finaled: isoDate(f.txtComplDt), status };
}
const cookiesOf = (r) => ((r.headers && r.headers.getSetCookie && r.headers.getSetCookie()) || []).map((c) => c.split(';')[0]);

export async function lookup(row, { fetchFn = fetch, delayMs = 300 } = {}) {
  const url = BASE + 'SearchPermit.aspx';
  const r1 = await fetchFn(url, { headers: { 'User-Agent': UA } }); if (!r1.ok) throw new Error('WATS HTTP ' + r1.status);
  const html = await r1.text(); let jar = cookiesOf(r1);
  const form = new URLSearchParams();
  for (const m of html.matchAll(/<input[^>]*type="hidden"[^>]*>/g)) { const n = (m[0].match(/name="([^"]*)"/) || [])[1]; if (n) form.set(n, ((m[0].match(/value="([^"]*)"/) || [])[1] || '').replace(/&amp;/g, '&')); }
  form.set('ctl00$cphBody$txtAddr', row.property_address); form.set('ctl00$cphBody$btnSearch', 'Search');
  await sleep(delayMs);
  const r2 = await fetchFn(url, { method: 'POST', redirect: 'manual', body: form, headers: { 'User-Agent': UA, 'Content-Type': 'application/x-www-form-urlencoded', Cookie: jar.join('; '), Referer: url } });
  jar = jar.concat(cookiesOf(r2));
  const loc = r2.headers.get('location'); if (!loc) throw new Error('WATS search did not redirect (status ' + r2.status + ')');
  await sleep(delayMs);
  const r3 = await fetchFn(new URL(loc, url).href, { headers: { 'User-Agent': UA, Cookie: jar.join('; '), Referer: url } });
  if (!r3.ok) throw new Error('WATS results HTTP ' + r3.status);
  const all = parseResults(await r3.text()).filter((x) => x.address === normAddr(row.property_address));
  const years = all.map((x) => +String(x.issued).slice(0, 4)).filter(Boolean);
  const permits = [];
  for (const x of all.filter((y) => ROOF_CODES.test(y.code))) {
    await sleep(delayMs);
    const r = await fetchFn(`${BASE}BLPermit.aspx?PermitNo=${x.number}&PopUp=1`, { headers: { 'User-Agent': UA } }); if (!r.ok) throw new Error('WATS permit HTTP ' + r.status);
    const d = parseDetail(await r.text());
    permits.push({ number: x.number, type: 'Building Permit', work: d.work, structure: '', use: x.code, status: d.status, issued: d.issued || x.issued, finaled: d.finaled,
      link: `${BASE}BLPermit.aspx?PermitNo=${x.number}&PopUp=1`, source: 'SJC_WATS' });
  }
  return { permits, notes: [], earliestYear: years.length ? Math.min(...years) : null, source_link: `${BASE}SearchPermit.aspx` };
}
