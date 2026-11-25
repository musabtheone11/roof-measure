// node modeltest.mjs -> exits 1 if a measurement or audit rule in roofmodel.js regresses
import { createRequire } from 'node:module';
const RM = createRequire(import.meta.url)('../roofmodel.js');
let fail = 0; const ok = (name, cond, got) => { console.log((cond ? 'ok   ' : 'FAIL ') + name + (cond ? '' : '  got ' + JSON.stringify(got))); if (!cond) fail++; };
const lat0 = 30.2, lng0 = -81.6, k = RM.scale(lat0); const P = (xFt, yFt) => ({ lat: lat0 + yFt / RM.FT / k.ky, lng: lng0 + xFt / RM.FT / k.kx });
const rect = (x, y, w, h) => [P(x, y), P(x + w, y), P(x + w, y + h), P(x, y + h)];
// areas: a 40 x 25 ft plane is 1,000 sq ft in plan; at 6/12 the surface is 1,000 x sqrt(1.25)
const f = { name: 'F1', path: rect(0, 0, 40, 25), pitch: 6 };
ok('plan area of a 40 x 25 ft facet', Math.abs(RM.planSqft(f.path) - 1000) < 0.05, RM.planSqft(f.path));
ok('assigned 6/12 pitch -> sloped area', Math.abs(RM.facetMeasure(f).sloped - 1000 * Math.sqrt(1.25)) < 0.1, RM.facetMeasure(f).sloped);
ok('fitted slope wins over the rounded pitch', Math.abs(RM.facetMeasure({ ...f, slope: 0.46 }).sloped - 1000 * Math.sqrt(1 + 0.46 ** 2)) < 0.1 && RM.facetMeasure({ ...f, slope: 0.46 }).basis === 'fitted');
// lines: level line x1, rake x rafter factor, hip x hip factor; a plane factor overrides; a hand-set pitch overrides everything
const line = (type, extra) => RM.lineMeasure({ type, path: [P(0, 0), P(30, 0)], ...extra }, 6, 6);
ok('eave is horizontal', Math.abs(line('eave').trueFt - 30) < 0.01 && line('eave').lengthKind === 'horizontal', line('eave'));
ok('rake at 6/12', Math.abs(line('rake').trueFt - 30 * Math.sqrt(1.25)) < 0.01, line('rake').trueFt);
ok('hip at 6/12 (90 degree corner)', Math.abs(line('hip').trueFt - 30 * Math.sqrt(1 + 36 / 288)) < 0.01, line('hip').trueFt);
ok('plane factor used for an auto-traced line', Math.abs(line('hip', { factor: 1.1, autoType: 'hip' }).trueFt - 33) < 0.01 && line('hip', { factor: 1.1, autoType: 'hip' }).basis === 'plane');
ok('plane factor dropped when the type was changed by hand', line('rake', { factor: 1.1, autoType: 'hip' }).basis !== 'plane');
ok('hand-set pitch overrides the plane factor', Math.abs(line('rake', { factor: 1.1, autoType: 'rake', pitch: 12 }).trueFt - 30 * Math.SQRT2) < 0.01);
// audit
const A = (facets, lines) => RM.audit(facets, lines).issues.map((i) => i.code);
const two = [{ name: 'F1', path: rect(0, 0, 40, 25), level: 1 }, { name: 'F2', path: rect(40, 0, 40, 25), level: 1 }];
const outline = [{ type: 'eave', path: [P(0, 0), P(80, 0)] }, { type: 'eave', path: [P(0, 25), P(80, 25)] }, { type: 'rake', path: [P(0, 0), P(0, 25)] }, { type: 'rake', path: [P(80, 0), P(80, 25)] }, { type: 'ridge', path: [P(40, 0), P(40, 25)] }];
ok('clean two-facet roof has no issues', A(two, outline).length === 0, A(two, outline));
ok('overlap on the same level is an error', A([two[0], { name: 'F2', path: rect(30, 0, 40, 25), level: 1 }], []).includes('overlap'));
ok('overlap on different levels is allowed', !A([two[0], { name: 'F2', path: rect(30, 0, 40, 25), level: 2 }], []).includes('overlap'));
ok('bow-tie outline is a self-intersection', A([{ name: 'F1', path: [P(0, 0), P(40, 25), P(40, 0), P(0, 25)], level: 1 }], []).includes('self-intersection'));
ok('same-type lines on one stretch are a duplicate', A(two, [...outline, { type: 'eave', path: [P(10, 0), P(50, 0)] }]).includes('duplicate-line'));
ok('eave + wall flashing on one stretch are two categories, not a duplicate', !A(two, [...outline, { type: 'wall', path: [P(10, 0), P(50, 0)] }]).includes('duplicate-line'));
ok('outline with no line type is reported as unclassified, not zero', A(two, outline.slice(0, 3)).includes('unclassified-boundary'));
ok('3 sq ft sliver is flagged as an artifact', A([...two, { name: 'F3', path: rect(100, 0, 3, 1), level: 1 }], []).includes('artifact'));
const fx = RM.autoFix([{ name: 'F1', path: [P(0, 0), P(40, 0), P(40, 0.02), P(40, 25), P(0, 25)] }], [{ type: 'eave', path: [P(0, 0), P(40, 0)] }, { type: 'eave', path: [P(5, 0), P(20, 0)] }]);
ok('auto-fix removes a doubled corner and a duplicate line', fx.facets[0].path.length === 4 && fx.lines[1] === null, fx.log);
// reconciliation
const rec = RM.reconcile([{ sloped: 600, plan: 500, status: 'measured' }, { sloped: 400, plan: 350, status: 'inferred' }, { sloped: 20, plan: 20, excluded: true }], [{ type: 'eave', trueFt: 80 }], { sloped: 980, plan: 830, pitchGroups: { 6: 980 }, byType: { eave: { true: 80 } } });
ok('subtotals reconcile', rec.ok, rec.checks.filter((c) => !c.ok));
ok('a wrong total is caught', !RM.reconcile([{ sloped: 600, plan: 500 }], [], { sloped: 601, plan: 500, pitchGroups: { 6: 600 }, byType: {} }).ok);
// ellipsoid: one degree of latitude at 30.2 N is about 110,857 m (the sphere formula gives 111,319 m)
ok('WGS84 metres per degree', Math.abs(k.ky - 110857) < 25 && Math.abs(k.kx - 111319.5 * Math.cos(lat0 * Math.PI / 180) * 1.00085) < 25, k);
process.exit(fail ? 1 : 0);
