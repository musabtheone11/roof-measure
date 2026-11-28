import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {OrgStore} from './store.mjs';
import {reconcileLegacyFreeAllowance} from './allowance-legacy.mjs';
const binding={schemaVersion:1,role:'engineering',actorId:'operator',sourceRevision:'legacy',datasetRevision:'legacy',candidateHash:'a'.repeat(64),policyVersion:'legacy',inputHashes:['b'.repeat(64)]};
function fixture(t){const dir=mkdtempSync(join(tmpdir(),'roof-legacy-')),store=new OrgStore(dir);store.setControl('running');t.after(()=>{store.close();rmSync(dir,{recursive:true,force:true});});return store;}
function sent(store,id,model,{reportedUsd=null,source}={}){
 store.enqueue({...binding,id,workflowId:id});const lease=store.claim('worker');
 const attemptId=store.reserve(id,'worker',lease.fence,{usd:model?.startsWith('free/')?0:.01,requestLimit:2,maxUsd:3,hourUsd:3,dayUsd:3,weekUsd:20,monthUsd:80});
 store.dispatch(attemptId,'worker',lease.fence);if(model)store.event(id,'fleet-dispatched',{model});store.settle(attemptId,'worker',lease.fence,{reportedUsd});
 const resultHash=source?store.putArtifact(Buffer.from(JSON.stringify(source))).hash:null;
 store.finish(id,'worker',lease.fence,{status:reportedUsd===null?'failed':'complete',result:resultHash?{resultHash}:{}});return attemptId;
}
test('legacy free successes and unknowns receive conservative holds without changing any USD row',t=>{
 const store=fixture(t);sent(store,'known','free/gpt-6-luna',{reportedUsd:0});sent(store,'unknown','free/gpt-6-luna');sent(store,'paid-zero','gpt-6.2-astra',{reportedUsd:0});
 const before=JSON.stringify(store.ledger()),first=reconcileLegacyFreeAllowance(store),second=reconcileLegacyFreeAllowance(store);
 assert.equal(first.backfilled,2);assert.equal(second.backfilled,0);assert.equal(first.ledger.reservedUnits,2*2*1048576*3);
 assert.equal(first.ledger.unknownAllowanceRequests,2);assert.equal(JSON.stringify(store.ledger()),before);
});
test('historic larger observed weight and output are preserved conservatively',t=>{
 const store=fixture(t);sent(store,'larger','free/gpt-6-luna',{reportedUsd:0,source:{execution:{requestedModel:'free/gpt-6-luna',allowanceWeight:5,usage:{totalTokens:6000,completionTokens:4096}}}});
 const result=reconcileLegacyFreeAllowance(store);assert.equal(result.ledger.reservedUnits,2*1048576*5);
});
test('conflicting or unattributed zero-dollar legacy dispatches block before partial backfill',t=>{
 const store=fixture(t);sent(store,'valid','free/gpt-6-luna');sent(store,'conflict','free/gpt-6-luna');store.event('conflict','fleet-dispatched',{model:'free/qwen-3.8-max'});
 assert.throws(()=>reconcileLegacyFreeAllowance(store),{code:'ALLOWANCE_LEGACY_MAPPING_REQUIRED'});assert.equal(store.allowanceLedger().requests,0);
});
