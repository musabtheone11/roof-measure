import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, mkdirSync, writeFileSync, symlinkSync, rmSync, readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {OrgStore} from './store.mjs';
import {DownloadsDiscovery, extractDocument} from './discovery.mjs';
import {extractIsolated} from './extract.mjs';
import {createWorkflow, nextTask, digest} from './workflow.mjs';
import {workOnce} from './worker.mjs';
import {propertySplit, buildReferenceManifest, resolveAgentArtifacts} from './references.mjs';
import {normalizeSourceClaims} from './normalize.mjs';
import {customerProjection, renderCustomerPDF} from './customer-report.mjs';
import {validateTask} from './contracts.mjs';
const actors = {extraction:'extractor',reference:'curator',engineering:'author',critique:'critic',verification:'verifier',ceo:'ceo',operations:'ops',reporting:'reporter'};
function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'roof-org-'));
  const store = new OrgStore(join(root, 'state'));
  t.after(() => { store.close(); rmSync(root, {recursive:true,force:true}); });
  return {root,store};
}
function initial(store, id = 'example') {
  const a = store.putArtifact(Buffer.from('Roof area 1,200.50 sq ft. Pitch 6/12. Roofr 2026-01-12'));
  return createWorkflow({id, sourceHash:a.hash,sourceRevision:'baseline',extension:'.txt',actors});
}
test('recursive discovery excludes uncertain personal files and symlinks, waits for stable source, deduplicates', async t => {
  const {root,store} = fixture(t); let now=0;
  const downloads=join(root,'downloads'); mkdirSync(join(downloads,'nested'),{recursive:true});
  writeFileSync(join(downloads,'roof.txt'),'Roof area 123 sqft');
  writeFileSync(join(downloads,'nested','roof-copy.txt'),'Roof area 123 sqft');
  writeFileSync(join(downloads,'personal.txt'),'personal unrelated');
  writeFileSync(join(root,'roof-secret.txt'),'not in downloads');
  symlinkSync(join(root,'roof-secret.txt'),join(downloads,'roof-link.txt'));
  const d=new DownloadsDiscovery(downloads,{now:()=>now});
  assert.equal((await d.scan(store)).length,0); now=2100;
  const found=await d.scan(store); assert.equal(found.length,1); assert.equal(d.inventory.duplicates,1); assert.equal(d.inventory.uncertain,1);
  assert.equal(d.inventory.uniqueProperties,null); assert.equal(store.readArtifact(found[0].hash).toString(),'Roof area 123 sqft');
  assert.throws(()=>store.readArtifact('../roof-secret.txt'));
});
test('local file runs through real extraction then blocks at unverified reference, survives restart', async t => {
  const {store}=fixture(t); const task=initial(store); store.enqueue(task); store.setControl('running');
  const result=await workOnce(store); assert.equal(result.status,'complete');
  const output=JSON.parse(store.readArtifact(store.getTask(task.id).result.outputHash));
  assert.equal(output.verifiedReference,false); assert.equal(output.normalized.candidates.find(c=>c.kind==='area').value,1200.5);
  assert.equal((await workOnce(store)).status,'needs-human');
  assert.equal(store.listTasks().length,2); store.enqueue(task); assert.equal(store.listTasks().length,2);
});
test('pause and stop never dispatch work', async t => {
  const {store}=fixture(t); store.enqueue(initial(store));
  assert.equal(await workOnce(store),null); store.setControl('stopped'); assert.equal(await workOnce(store),null);
  store.setControl('running'); assert.equal((await workOnce(store)).status,'complete');
});
test('CEO pass cannot enqueue staging without trusted release gate and bound evidence', async t => {
  const {store}=fixture(t); const task={...initial(store),id:'ceo-stage',stage:'ceo',role:'ceo',actorId:'ceo'};
  store.enqueue(task); store.setControl('running'); let stagingCalls=0;
  const output=store.putArtifact(Buffer.from('{}'));
  const result=await workOnce(store,{adapters:{ceo:async()=>({decision:'pass',outputHash:output.hash}),staging:async()=>{stagingCalls++;}}});
  assert.equal(result.code,'RELEASE_GATE_BLOCKED'); assert.equal(stagingCalls,0); assert.equal(store.listTasks().length,1);
  assert.equal(store.getTask(task.id).result.outputHash,output.hash);
});
test('CEO rejection remains rejected and cannot advance', async t => {
  const {store}=fixture(t); const task={...initial(store),id:'reject',stage:'ceo',role:'ceo',actorId:'ceo'};
  store.enqueue(task); store.setControl('running'); const a=store.putArtifact(Buffer.from('{}'));
  assert.equal((await workOnce(store,{adapters:{ceo:async()=>({decision:'reject',outputHash:a.hash})}})).status,'rejected');
  assert.equal(store.listTasks().length,1);
});
test('source authorization and role resolver are required before any model invocation',async t=>{
  const {store}=fixture(t); const task={...initial(store),id:'proposal',stage:'proposal',role:'engineering',actorId:'author'};
  store.enqueue(task); store.setControl('running'); let calls=0;
  const r=await workOnce(store,{provider:async()=>{calls++;}}); assert.equal(r.code,'SOURCE_AUTHORIZATION_REQUIRED'); assert.equal(calls,0);
});
test('improvement loops and actor assignment bounded, task definitions validate',t=>{
  const {store}=fixture(t); const task=initial(store); validateTask(task);
  assert.throws(()=>createWorkflow({id:'bad',sourceHash:'a'.repeat(64),sourceRevision:'x',extension:'.txt',actors:{...actors,verification:'author'}}));
  let current=task;
  for(let i=0;i<15;i++) {
    const next=nextTask(current,{decision:'pass',outputHash:'b'.repeat(64)}); if(!next)break; validateTask(next); current=next;
  }
  assert.equal(current.stage,'monitoring');
  assert.equal(nextTask({...task,stage:'critique',constraints:{...task.constraints,cycles:2}},{decision:'revise',outputHash:'b'.repeat(64)}),null);
});
test('10000 deterministic property checks keep aliases together and freeze splits',()=>{
  for(let i=0;i<10000;i++) assert.equal(propertySplit(` Property ${i} `,'frozen-v1'),propertySplit(`property ${i}`,'frozen-v1'));
  assert.throws(()=>propertySplit('','salt'));
  assert.throws(()=>buildReferenceManifest([{hash:'a'.repeat(64),propertyGroup:'A'},{hash:'a'.repeat(64),propertyGroup:'B'}],{salt:'s',datasetRevision:'1'}));
  assert.throws(()=>buildReferenceManifest([{hash:'a'.repeat(64),propertyGroup:'A',referenceTier:'independently-verified'}],{salt:'s',datasetRevision:'1'}));
});
test('holdout never resolves for author/critic or non-isolated verifier',()=>{
  const manifest={records:[{hash:'a'.repeat(64),split:'holdout'}]}; let reads=0;
  for(const role of ['engineering','critique','verification']) assert.throws(()=>resolveAgentArtifacts(manifest,role,['a'.repeat(64)],()=>{reads++;}));
  assert.equal(reads,0);
});
test('literal normalization preserves source page and flags image-only documents',async()=>{
  const result=await extractDocument(Buffer.from('Roofr Area 2,345.67 sqft, ridge 45.5 lf, pitch 7/12'),'.txt');
  const normalized=normalizeSourceClaims(result,'a'.repeat(64));
  assert.equal(normalized.candidates.find(c=>c.kind==='area').value,2345.67);
  assert.equal(normalized.candidates.find(c=>c.kind==='pitch').value,7);
  assert.equal(normalized.candidates[0].page,1); assert.equal(normalized.referenceTier,'source-claim');
  const square=normalizeSourceClaims({pages:[{page:1,observations:[{literal:'Total roof area 2,000 ft²'}]}]},'a'.repeat(64));
  assert.deepEqual(square.candidates.map(c=>c.kind),['area']);
  for(const literal of ['Area -20 sq ft','Area 1.234,56 m²']) {
    const unsupported=normalizeSourceClaims({pages:[{page:1,observations:[{literal}]}]},'a'.repeat(64));
    assert.equal(unsupported.candidates.filter(c=>c.kind==='area').length,0);
    assert.ok(unsupported.issues.some(i=>i.code==='UNSUPPORTED_SIGN_OR_NUMERIC_LOCALE'));
  }
  assert.equal(normalizeSourceClaims({pages:[]},'a'.repeat(64)).issues[0].code,'NO_LITERAL_MEASUREMENTS');
});
test('isolated parser enforces cancellation and produces real text PDF extraction',async()=>{
  const cancelled=new AbortController(); cancelled.abort(); await assert.rejects(extractIsolated(Buffer.from('x'),'.txt',{signal:cancelled.signal}));
  const input={schemaVersion:1,jobId:'Synthetic example',revision:'1',date:'2026-11-27',buildingScope:'Synthetic roof',status:'REVIEW REQUIRED',
    quantities:[{name:'Projected roof area',value:1200,unit:'ft²',status:'user-provided',source:'Analytic fixture'}],notes:['No field verification.']};
  const pdf=renderCustomerPDF(input); assert.equal(pdf.subarray(0,4).toString(),'%PDF');
  const extracted=await extractIsolated(pdf,'.pdf'); assert.ok(extracted.pages[0].observations.some(x=>x.literal.includes('Projected roof area')));
});
test('customer projection rejects geometry/images and unknown physical quantities stay unknown',()=>{
  const input={schemaVersion:1,jobId:'x',revision:'1',date:'2026-11-27',buildingScope:'Unknown',status:'REVIEW REQUIRED',quantities:[{name:'Sloped area',value:null,unit:'ft²',status:'unknown',source:'Pitch missing'}],notes:[]};
  assert.equal(customerProjection(input).quantities[0].value,null);
  for(const key of ['sourceImage','facets','vertices','segmentation']) assert.throws(()=>customerProjection({...input,[key]:[]}));
  assert.throws(()=>customerProjection({...input,quantities:[{...input.quantities[0],value:10}]}));
});
