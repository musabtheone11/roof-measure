import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const code = fs.readFileSync(new URL('../report.js', import.meta.url), 'utf8');
const start = code.indexOf('function reportSignature('), end = code.indexOf('// the preview panel', start);
let revision = 1, release;
const delayed = new Promise(r => release = r);
const context = { state: { facets: [], waste: 10 }, company: {}, serialize: () => ({ revision, savedAt: 'now' }),
  $: () => null, RPT: {}, window: {}, fileBase: () => 'fixture', sha256Hex: async () => 'hash',
  rpBuild: async () => { await delayed; return { doc: { setCreationDate(){}, setFileId(){}, output: () => new Blob(['pdf']) }, pages: 2 }; }, Blob };
vm.createContext(context); vm.runInContext(code.slice(start,end),context);
const pending = context.buildReportPDF(); revision = 2; release();
await assert.rejects(pending, /roof changed/);
assert.equal(context.RPT.rec, undefined, 'stale asynchronous build must not enter cache');
await context.buildReportPDF();
assert.ok(context.RPT.rec);
revision = 3;
assert.throws(() => context.assertReportCurrent(context.RPT.sig), /roof changed/);
console.log('stale report: asynchronous edit and cached preview invalidation pass');
