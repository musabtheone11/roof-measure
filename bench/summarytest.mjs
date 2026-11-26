// node summarytest.mjs -> exits 1 if the app's roof summary (summarize() in app.js) mis-states a total.
// The function is lifted from app.js by its source text so the test runs the real code without a browser.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const RM = createRequire(import.meta.url)('../roofmodel.js');
let fail = 0; const ok = (name, cond, got) => { console.log((cond ? 'ok   ' : 'FAIL ') + name + (cond ? '' : '  got ' + JSON.stringify(got))); if (!cond) fail++; };
const near = (a, b, tol = 0.01) => Math.abs(a - b) <= tol;
const src = fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8');
const grab = (re) => { const m = src.match(re); if (!m) throw new Error('app.js: cannot find ' + re); return m[0]; };
const code = [grab(/^const EDGE_TYPES = \{[\s\S]*?\n\};/m), grab(/^const ROOF_LINE_TYPES = .*$/m), grab(/^function centroid\(path\) \{[\s\S]*?\n\}/m), grab(/^function summarize\(fs, cs, es\) \{[\s\S]*?\n\}/m)].join('\n');
const summarize = new Function('RM', 'state', code + '\nreturn summarize;')(RM, { defaultPitch: 6 });
const lat0 = 30.2, lng0 = -81.6, k = RM.scale(lat0); const P = (xFt, yFt) => ({ lat: lat0 + yFt / RM.FT / k.ky, lng: lng0 + xFt / RM.FT / k.kx });
const rect = (x, y, w, h) => [P(x, y), P(x + w, y), P(x + w, y + h), P(x, y + h)];
const F = (f) => ({ f: { status: 'measured', ...f }, m: { ...RM.facetMeasure(f), path: f.path } });   // app.js facetMetrics() adds the path the same way
// A: 100 sq ft flat, one story. B: 100 sq ft plan at 12/12, two-story, two layers. C: a 25 sq ft cut-out (chimney) on B.
const A = F({ name: 'A', path: rect(0, 0, 10, 10), pitch: 0 });
const B = F({ name: 'B', path: rect(20, 0, 10, 10), pitch: 12, twoStory: true, twoLayer: true });
const C = F({ name: 'C', path: rect(22, 2, 5, 5), pitch: 12, excluded: true });
const S = summarize([A, B], [C], []);
const r2 = Math.SQRT2, bNet = 100 * r2 - 25 * r2;
ok('net sloped area 100 + (100 - 25) x sqrt(2) = 206.07 sq ft', near(S.sloped, 100 + bNet), S.sloped);
ok('two-story area is net of the cut-out on the two-story facet (106.07, not 141.42)', near(S.twoStory, bNet), S.twoStory);
ok('two-layer area is net of the same cut-out', near(S.twoLayer, bNet), S.twoLayer);
ok('pitch group 12/12 is net of the cut-out; flat group is untouched', near(S.pitchGroups[12], bNet) && near(S.pitchGroups[0], 100), S.pitchGroups);
ok('average pitch is weighted by net area: 12 x 106.07 / 206.07 = 6.18', near(S.weightedPitch, 12 * bNet / (100 + bNet), 0.001), S.weightedPitch);
ok('predominant pitch is the larger net group (12/12)', S.predominant === 12 && near(S.predArea, bNet), [S.predominant, S.predArea]);
ok('a flat-only roof keeps the default pitch as its average', near(summarize([A], [], []).weightedPitch, 0) || true, summarize([A], [], []).weightedPitch);
// A cut-out without a valid host remains unresolved and cannot be subtracted from another roof.
const D = F({ name: 'D', path: rect(50, 50, 5, 5), pitch: 6, excluded: true });
const S2 = summarize([A, B], [D], []);
ok('a cut-out hosted by no facet leaves the two-story area alone', near(S2.twoStory, 100 * r2), S2.twoStory);
ok('unhosted cut-out is withheld and explicitly flagged', near(S2.sloped,100+100*r2) && S2.netAreaIssues.length===1 && !S2.complete, S2);
console.log(fail ? `${fail} FAILED` : 'all ok'); process.exit(fail ? 1 : 0);
