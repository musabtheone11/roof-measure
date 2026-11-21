// Clay County EnerGov: roofing permits are numbered ROOF<MM><YY>-nnnnn. The search returns at most 10,000 results
// (100 pages of 100), so the download runs one keyword search per month since January 2023 and merges the results.
// The permits are indexed by the county's short parcel number (the last three parts of the state parcel id).
import { createRequire } from 'node:module';
const { isoDate } = createRequire(import.meta.url)('../../../../leadscore.js');
const URL_ = 'https://claycountyfl-energovpub.tylerhost.net/apps/selfservice/api/energov/search/search';
const HEADERS = { 'Content-Type': 'application/json;charset=UTF-8', 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36',
  tenantId: '1', tenantName: 'ClayCountyFL', 'Tyler-TenantUrl': 'ClayCountyFL', 'Tyler-Tenant-Culture': 'en-US' };
const CAP = 10000;
const crit = { PageNumber: 0, PageSize: 0 };
const body = (keyword, page) => ({ Keyword: keyword, ExactMatch: true, SearchModule: 1, FilterModule: 2, SearchMainAddress: false, PlanCriteria: crit,
  PermitCriteria: { PermitTypeId: 'none', PermitWorkclassId: 'none', PermitStatusId: 'none', PageNumber: 0, PageSize: 0, SortAscending: false },
  InspectionCriteria: crit, CodeCaseCriteria: crit, RequestCriteria: crit, BusinessLicenseCriteria: crit, ProfessionalLicenseCriteria: crit, LicenseCriteria: crit, ProjectCriteria: crit,
  PlanSortList: [], PermitSortList: [], InspectionSortList: [], CodeCaseSortList: [], RequestSortList: [], LicenseSortList: [], ProjectSortList: [],
  PageNumber: page, PageSize: 100, SortBy: 'relevance', SortAscending: false });

export const shortParcel = (id) => String(id).split('-').slice(3).join('-');
const SITE = 'https://claycountyfl-energovpub.tylerhost.net/apps/selfservice#/permit/';

// ROOF0123 ... ROOF<this month>
export function monthKeywords(now = new Date()) {
  const out = [];
  for (let y = 2023, m = 1; y < now.getFullYear() || (y === now.getFullYear() && m <= now.getMonth() + 1); m === 12 ? (y++, m = 1) : m++)
    out.push(`ROOF${String(m).padStart(2, '0')}${String(y).slice(2)}`);
  return out;
}

async function page(fetchFn, keyword, n, retryMs, tries) {
  for (let k = 1; ; k++) {
    try {
      const r = await fetchFn(URL_, { method: 'POST', headers: HEADERS, body: JSON.stringify(body(keyword, n)) });
      if (!r.ok) throw new Error('Clay EnerGov HTTP ' + r.status);
      return (await r.json()).Result || {};
    } catch (e) { if (k >= tries) throw e; await new Promise((ok) => setTimeout(ok, retryMs * k)); }
  }
}

// returns { index: {shortParcel: Permit[]}, count, pages }
export async function harvest({ fetchFn = fetch, onPage, retryMs = 3000, tries = 4, keywords = monthKeywords() } = {}) {
  const index = {}; const seen = new Set(); let count = 0, totalPages = 0;
  for (const kw of keywords) {
    let pages = 1;
    for (let n = 1; n <= pages; n++) {
      let res;
      for (let k = 1; ; k++) {   // a later page can come back empty with TotalPages 0: retry it instead of ending early
        res = await page(fetchFn, kw, n, retryMs, tries);
        if (n === 1) {
          pages = res.TotalPages || 0;   // the page count comes from page 1 only
          if ((res.TotalFound || 0) >= CAP || pages >= CAP / 100) throw new Error(`Clay EnerGov search "${kw}" hit the 10,000-result cap; split it further`);
        }
        if ((res.EntityResults || []).length || n > pages) break;
        if (k >= tries) throw new Error(`Clay EnerGov "${kw}" page ${n} of ${pages} came back empty`);
        await new Promise((ok) => setTimeout(ok, retryMs * k));
      }
      for (const x of res.EntityResults || []) {
        if (!/^ROOF/i.test(x.CaseNumber || '') && !/roof/i.test(x.CaseType || '')) continue;
        const key = String(x.MainParcel || '').trim(); if (!key || seen.has(x.CaseNumber)) continue;
        seen.add(x.CaseNumber);
        (index[key] = index[key] || []).push({ number: x.CaseNumber, type: x.CaseType || '', work: String(x.Description || '').trim() || x.CaseWorkclass || '', structure: '', use: '',
          status: x.CaseStatus || '', issued: isoDate(x.IssueDate), finaled: isoDate(x.FinalDate || x.CompleteDate), link: x.CaseId ? SITE + x.CaseId : '', source: 'CLAY' });
        count++;
      }
      totalPages++;
      if (onPage) onPage({ keyword: kw, page: n, pages, count });
    }
  }
  if (!count) throw new Error('Clay EnerGov returned no roofing permits; nothing cached');
  return { index, count, pages: totalPages };
}
export function lookup(row, harvested) {
  const permits = harvested.index[shortParcel(row.parcel_id)] || [];
  return { permits, notes: [], source_link: permits[0] && permits[0].link ? permits[0].link : 'https://claycountyfl-energovpub.tylerhost.net/apps/selfservice' };
}
