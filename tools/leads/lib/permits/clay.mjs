// Clay County EnerGov: one keyword search for "ROOF" returns every roofing permit on line (January 2023 on).
// Harvest them all once and index by the county's short parcel number (the last three parts of the state parcel id).
import { createRequire } from 'node:module';
const { isoDate } = createRequire(import.meta.url)('../../../../leadscore.js');
const URL_ = 'https://claycountyfl-energovpub.tylerhost.net/apps/selfservice/api/energov/search/search';
const HEADERS = { 'Content-Type': 'application/json;charset=UTF-8', 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36',
  tenantId: '1', tenantName: 'ClayCountyFL', 'Tyler-TenantUrl': 'ClayCountyFL', 'Tyler-Tenant-Culture': 'en-US' };
const crit = { PageNumber: 0, PageSize: 0 };
const body = (page) => ({ Keyword: 'ROOF', ExactMatch: true, SearchModule: 1, FilterModule: 2, SearchMainAddress: false, PlanCriteria: crit,
  PermitCriteria: { PermitTypeId: 'none', PermitWorkclassId: 'none', PermitStatusId: 'none', PageNumber: 0, PageSize: 0, SortAscending: false },
  InspectionCriteria: crit, CodeCaseCriteria: crit, RequestCriteria: crit, BusinessLicenseCriteria: crit, ProfessionalLicenseCriteria: crit, LicenseCriteria: crit, ProjectCriteria: crit,
  PlanSortList: [], PermitSortList: [], InspectionSortList: [], CodeCaseSortList: [], RequestSortList: [], LicenseSortList: [], ProjectSortList: [],
  PageNumber: page, PageSize: 100, SortBy: 'relevance', SortAscending: false });

export const shortParcel = (id) => String(id).split('-').slice(3).join('-');
const SITE = 'https://claycountyfl-energovpub.tylerhost.net/apps/selfservice#/permit/';

// returns { index: {shortParcel: Permit[]}, count, pages }
export async function harvest({ fetchFn = fetch, onPage } = {}) {
  const index = {}; let pages = 1, count = 0;
  for (let page = 1; page <= pages; page++) {
    const r = await fetchFn(URL_, { method: 'POST', headers: HEADERS, body: JSON.stringify(body(page)) });
    if (!r.ok) throw new Error('Clay EnerGov HTTP ' + r.status);
    const j = await r.json(); const res = j.Result || {}; pages = res.TotalPages || 0;
    for (const x of res.EntityResults || []) {
      if (!/^ROOF/i.test(x.CaseNumber || '') && !/roof/i.test(x.CaseType || '')) continue;
      const key = String(x.MainParcel || '').trim(); if (!key) continue;
      (index[key] = index[key] || []).push({ number: x.CaseNumber, type: x.CaseType || '', work: String(x.Description || '').trim() || x.CaseWorkclass || '', structure: '', use: '',
        status: x.CaseStatus || '', issued: isoDate(x.IssueDate), finaled: isoDate(x.FinalDate || x.CompleteDate), link: x.CaseId ? SITE + x.CaseId : '', source: 'CLAY' });
      count++;
    }
    if (onPage) onPage({ page, pages, count });
  }
  return { index, count, pages };
}
export function lookup(row, harvested) {
  const permits = harvested.index[shortParcel(row.parcel_id)] || [];
  return { permits, notes: [], source_link: permits[0] && permits[0].link ? permits[0].link : 'https://claycountyfl-energovpub.tylerhost.net/apps/selfservice' };
}
