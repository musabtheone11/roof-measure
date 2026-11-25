// node reporttest.mjs -> exits 1 if the report's acceptance example or its status rules regress.
// The residential example (examples/residential-study.json) must measure 1,714.73 ft² with the app's own measurement
// model, and the REVIEW REQUIRED rules must never turn a missing value into a zero.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const RM = createRequire(import.meta.url)('../roofmodel.js');
let fail = 0; const ok = (name, cond, got) => { console.log((cond ? 'ok   ' : 'FAIL ') + name + (cond ? '' : '  got ' + JSON.stringify(got))); if (!cond) fail++; };
const near = (a, b, tol = 0.006) => Math.abs(a - b) <= tol;

// ---- the illustrative residential example: main house (hip, 6/12) + detached garage (gable, 4/12)
const job = JSON.parse(fs.readFileSync(path.join(ROOT, 'examples', 'residential-study.json'), 'utf8'));
ok('example is marked illustrative (never a measurement)', job.source && job.source.kind === 'illustrative', job.source && job.source.kind);
ok('example carries no customer address (labels only, no street number)', !/\d/.test(job.address || '') && !/\d/.test(job.source.addressLine1 || ''), [job.address, job.source.addressLine1]);
const F = job.facets.map((f) => ({ f, m: RM.facetMeasure(f) }));
const sloped = F.reduce((a, x) => a + x.m.sloped, 0);
ok('six facets across two buildings', job.facets.length === 6 && new Set(job.facets.map((f) => f.structure)).size === 2, job.facets.map((f) => f.structure));
ok('net sloped area 1,714.73 ft²', near(sloped, 1714.73), sloped);
ok('17.15 squares', near(Math.round(sloped / 100 * 100) / 100, 17.15, 0.0001), sloped / 100);
const house = F.filter((x) => x.f.structure === 1).reduce((a, x) => a + x.m.sloped, 0), garage = F.filter((x) => x.f.structure === 2).reduce((a, x) => a + x.m.sloped, 0);
ok('main house 1,377.42 ft² and garage 337.31 ft² (own rows in the takeoff)', near(house, 1377.42) && near(garage, 337.31), [house, garage]);
// line lengths: the adjoining facet's pitch sets the slope factor, as in computeTotals()
const pitchOf = (s) => job.facets.find((f) => f.structure === s).pitch;
const byType = {}; for (const e of job.edges) { const m = RM.lineMeasure(e, pitchOf(e.structure), job.defaultPitch); byType[e.type] = (byType[e.type] || 0) + m.trueFt; }
ok('eave 184.00 ft, hip 84.00 ft, ridge 36.00 ft, rake 33.73 ft', near(byType.eave, 184) && near(byType.hip, 84) && near(byType.ridge, 36) && near(byType.rake, 33.73), byType);
ok('a hip roof has 0 ft of valley by geometry (verified absence, not a missing value)', !byType.valley, byType.valley);
const waste = job.waste != null ? +job.waste : 10, withWaste = sloped * (1 + waste / 100), bundles = Math.ceil(withWaste / 100 * 3);
ok('10% waste -> 1,886.20 ft² and 57 bundles, kept apart from the net area', near(withWaste, 1886.20) && bundles === 57, [withWaste, bundles]);

// ---- status rules shared by the app, the PDF and the review panel
const base = { facets: true, reconcileOk: true, imageryQuality: 'HIGH' };
ok('a fully measured roof is COMPLETE', RM.reportStatus(base).status === 'COMPLETE', RM.reportStatus(base));
const hidden = RM.reportStatus({ ...base, hiddenZones: [{ id: 'U1' }, { id: 'U2' }], hiddenUpperSqft: null });
ok('hidden zones of unknown extent -> REVIEW REQUIRED, extent "not measured", never 0', hidden.status === 'REVIEW REQUIRED' && hidden.reasons.some((r) => r.code === 'hidden' && /extent not measured/.test(r.text) && !/0 to 0/.test(r.text)), hidden.reasons);
const bounded = RM.reportStatus({ ...base, hiddenZones: [{ id: 'H1' }], hiddenUpperSqft: 649 });
ok('a bounded hidden zone states its range and stays out of the totals', bounded.reasons.some((r) => r.code === 'hidden' && /0 to 649 sq ft, in no total/.test(r.text)), bounded.reasons);
const est = RM.reportStatus({ ...base, inferredSqft: 1290.18 });
ok('an estimate under canopy is a REVIEW REQUIRED reason, not a measurement', est.status === 'REVIEW REQUIRED' && est.reasons.some((r) => r.code === 'estimate' && /1,290 sq ft is an estimate/.test(r.text)), est.reasons);
const none = RM.reportStatus({ facets: false, failed: 'No building outline in the imagery.' });
ok('no traced roof -> REVIEW REQUIRED with what is needed', none.status === 'REVIEW REQUIRED' && none.reasons[0].code === 'no-roof' && /needs|Imagery/i.test(none.reasons[0].needs), none.reasons);
ok('low-quality trace imagery is a reason on its own', RM.reportStatus({ ...base, imageryQuality: 'MEDIUM' }).reasons.some((r) => r.code === 'imagery-quality'));

// ---- the report code itself: parses, grayscale only, US Letter, and the three delivery buttons share one build
const pdfSrc = fs.readFileSync(path.join(ROOT, 'roofpdf.js'), 'utf8'), rep = fs.readFileSync(path.join(ROOT, 'report.js'), 'utf8'), html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
ok('roofpdf.js draws on US Letter', /format: 'letter'/.test(pdfSrc));
ok('report colours are gray levels only (no RGB triplets in roofpdf.js)', !/set(Fill|Draw|Text)Color\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*\)/.test(pdfSrc.replace(/GR\([^)]*\)/g, '')), 'rgb call found');
ok('verified black-and-white logo is used', /logo-black\.png/.test(pdfSrc) && fs.existsSync(path.join(ROOT, 'assets', 'logo-black.png')));
ok('Preview, Print and Download all go through one buildReportPDF()', /act\('#btnReportPreview', 'preview'\)/.test(rep) && /act\('#btnReport', 'print'\)/.test(rep) && /act\('#btnReportPDF', 'download'\)/.test(rep) && (rep.match(/await buildReportPDF\(/g) || []).length >= 1);
ok('index.html has the three report buttons and the preview frame', ['btnReportPreview', 'btnReport"', 'btnReportPDF', 'reportFrame'].every((id) => html.includes(id)));
ok('unsupported values stay blank in the schedules (no zero fill)', /noArea \? ''/.test(pdfSrc) && /pitchUnknown \? ''/.test(pdfSrc));
process.exit(fail ? 1 : 0);
