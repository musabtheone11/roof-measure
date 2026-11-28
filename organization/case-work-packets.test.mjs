import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,writeFileSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {OrgStore} from './store.mjs';
import {runCloudCases} from './cloud-cases.mjs';
import {verifyCloudPDF} from './cloud-pdf.mjs';
import {buildCaseWorkPlan} from './case-work-queue.mjs';
import {buildCloudCaseWorkPackets} from './case-work-packets.mjs';

async function setup(t,count=12){const outputDir=mkdtempSync(join(tmpdir(),'case-packets-'));t.after(()=>rmSync(outputDir,{recursive:true,force:true}));const generated=await runCloudCases({outputDir,seed:101,count,sourceRevision:'a'.repeat(40)});const pdfResults=generated.cases.map(c=>({id:c.id,ok:true,quantityRowsChecked:9}));const store=new OrgStore(join(outputDir,'state'));t.after(()=>store.close());return{outputDir,generated,pdfResults,store};}
test('case work packets admit only artifact-bound development properties, preserving real defects',async t=>{
 const opts=await setup(t),packets=buildCloudCaseWorkPackets(opts);
 assert.equal(packets.length,6);assert.ok(packets.every(p=>p.split==='development'&&p.metrics.attempted===1&&p.caseHash===p.inputHashes[0]));
 assert.ok(packets.some(p=>p.verification.issues.length));assert.ok(packets.every(p=>p.reportObservation.status==='REVIEW REQUIRED'));
 assert.ok(!packets.some(p=>opts.generated.cases.filter(c=>c.split!=='development').some(c=>c.propertyGroup===p.propertyGroup)));
});
test('tampered case bytes and mislabeled heldout membership cannot reach models',async t=>{
 const opts=await setup(t),item=opts.generated.cases[0],file=join(opts.outputDir,item.artifacts.case.path),original=readFileSync(file);
 writeFileSync(file,Buffer.concat([original,Buffer.from(' ')]));assert.throws(()=>buildCloudCaseWorkPackets(opts),/HASH_MISMATCH/);writeFileSync(file,original);
 item.split='holdout';opts.generated.cases[6].split='development';assert.throws(()=>buildCloudCaseWorkPackets(opts),/BINDING_INVALID/);
});
test('operator-only revision does not alter stable question evidence',async t=>{
 const opts=await setup(t),first=buildCloudCaseWorkPackets(opts);const secondGenerated=await runCloudCases({outputDir:opts.outputDir,seed:101,count:12,sourceRevision:'b'.repeat(40)});
 const second=buildCloudCaseWorkPackets({...opts,generated:secondGenerated});
 assert.deepEqual(second.map(p=>p.caseHash),first.map(p=>p.caseHash));assert.deepEqual(second.map(p=>p.inputHashes),first.map(p=>p.inputHashes));
 assert.deepEqual(second.map(({measurementSourceRevision,packetHash,...p})=>p),first.map(({measurementSourceRevision,packetHash,...p})=>p));
});

test('real PDF metadata changes preserve existing work assignments and original evidence',async t=>{
 const opts=await setup(t,3);
 async function actualPDFs(generated){return Promise.all(generated.cases.map(async c=>({id:c.id,...await verifyCloudPDF({pdfPath:join(opts.outputDir,c.artifacts.customerPDF.path),dataPath:join(opts.outputDir,c.artifacts.customerData.path)})})));}
 const firstPDFs=await actualPDFs(opts.generated),identity={engineSourceHashes:opts.generated.engineSourceHashes,generatorSourceSha256:opts.generated.generatorSourceSha256};
 const first=buildCaseWorkPlan({store:opts.store,measurementIdentity:identity,casePackets:buildCloudCaseWorkPackets({...opts,pdfResults:firstPDFs})});assert.ok(first.items.length>0);
 const generated=await runCloudCases({outputDir:opts.outputDir,seed:101,count:3,sourceRevision:'b'.repeat(40)}),secondPDFs=await actualPDFs(generated);
 assert.notEqual(firstPDFs[0].pdfSha256,secondPDFs[0].pdfSha256);assert.notEqual(firstPDFs[0].dataSha256,secondPDFs[0].dataSha256);
 const second=buildCaseWorkPlan({store:opts.store,measurementIdentity:identity,casePackets:buildCloudCaseWorkPackets({...opts,generated,pdfResults:secondPDFs})});
 assert.deepEqual(second,first);assert.ok(second.items.every(i=>i.measurementSourceRevision==='a'.repeat(40)));assert.equal(opts.store.ledger().requests,0);
});
test('expanding a batch validates fresh membership without recreating existing case questions',async t=>{
 const opts=await setup(t,3),identity={engineSourceHashes:opts.generated.engineSourceHashes,generatorSourceSha256:opts.generated.generatorSourceSha256};
 const firstPackets=buildCloudCaseWorkPackets(opts),first=buildCaseWorkPlan({store:opts.store,measurementIdentity:identity,casePackets:firstPackets,maxItems:2});assert.equal(first.items.length,2);
 const generated=await runCloudCases({outputDir:opts.outputDir,seed:101,count:6,sourceRevision:'a'.repeat(40)}),pdfResults=generated.cases.map(c=>({id:c.id,ok:true,quantityRowsChecked:9}));
 const secondPackets=buildCloudCaseWorkPackets({...opts,generated,pdfResults});assert.notEqual(firstPackets[0].sourceManifestHash,secondPackets[0].sourceManifestHash);
 const second=buildCaseWorkPlan({store:opts.store,measurementIdentity:identity,casePackets:secondPackets,maxItems:2});assert.deepEqual(second,first);assert.equal(opts.store.ledger().requests,0);
});
