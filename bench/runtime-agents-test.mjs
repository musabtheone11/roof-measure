import assert from 'node:assert/strict';import http from 'node:http';
import { parseAgentJSON, normalizeAgentJSON, validateInput, validateBudget, validateResponse, imageHeaderDimensions } from '../server/contracts.mjs';
import { runRoofAgents, VERIFIED_MODELS } from '../server/agents.mjs';
assert.deepEqual(parseAgentJSON('```json\n{"ok":true}\n```'),{ok:true});
assert.equal(normalizeAgentJSON('```json\n{}\n```').normalization,'single-json-code-fence');
for(const invalid of ['Here is JSON: ```json\n{}\n```','```json\n{}\n``` trailing','```json\n{}\n```\n```json\n{}\n```','```json\n{} {}\n```','```json\n[]\n```'])assert.throws(()=>parseAgentJSON(invalid));
const image='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAGQAAABkCAIAAAD/gAIDAAAA5UlEQVR4nO3QQQ0AIAzAwPk3DRbWFyG5U9B0DmvzOuAnZgVmBWYFZgVmBWYFZgVmBWYFZgVmBWYFZgVmBWYFZgVmBWYFZgVmBWYFZgVmBWYFZgVmBWYFZgVmBWYFZgVmBWYFZgVmBWYFZgVmBWYFZgVmBWYFZgVmBWYFZgVmBWYFZgVmBWYFZgVmBWYFZgVmBWYFZgVmBWYFZgVmBWYFZgVmBWYFZgVmBWYFZgVmBWYFZgVmBWYFZgVmBWYFZgVmBWYFZgVmBWYFZgVmBWYFZgVmBWYFZgVmBWYFZgVmBWYFZgVmBRctw8GdrTzzwQAAAABJRU5ErkJggg==';
const input=()=>({revision:'fixture-1',image,imageMetadata:{width:100,height:100,view:'orthographic'},consentExternal:true,budget:{maxRequests:12,maxTokens:20000000,maxUsd:20,maxOutputTokens:800}});
assert.deepEqual(imageHeaderDimensions(image),{width:100,height:100,mime:'image/png'});assert.throws(()=>validateInput({...input(),imageMetadata:{width:99,height:100,view:'orthographic'}}),/dimensions/);assert.throws(()=>imageHeaderDimensions('data:image/png;base64,iVBORw0KGgo='),/encoding/);
const square=[[10,10],[90,10],[90,90],[10,90]];
const outline={buildings:[{id:'target',target:true,vertices:square,status:'inferred',evidence:'Synthetic visible boundary'}],notes:[]};
const outputs={quality:{traceable:true,target:[50,50],issues:[],evidence:'Synthetic clear view'},outline,independent:outline,structure:{planes:[{id:'F1',vertices:square,status:'inferred',evidence:'Visible synthetic plane'}],edges:[],notes:[]},adjudication:{decisions:[],notes:['Agreement is not independent measurement evidence']}};
const sketchMeta={...input().imageMetadata,purpose:'roof-sketch',sourcePage:2,rotation:90};
validateInput({...input(),imageMetadata:sketchMeta});
for(const invalid of [{sourcePage:0},{rotation:45},{purpose:'unknown'}])assert.throws(()=>validateInput({...input(),imageMetadata:{...sketchMeta,...invalid}}));
const annotations=[{id:'D1',kind:'dimension',text:'12 feet (printed)',region:square,status:'source-reported'},{id:'C1',kind:'contradiction',text:'Printed labels disagree',region:square,status:'unresolved'}];
assert.deepEqual(validateResponse('structure',{...outputs.structure,annotations},sketchMeta).annotations,annotations);
for(const bad of [{...annotations[0],value:12},{...annotations[0],status:'measured'}])assert.throws(()=>validateResponse('structure',{...outputs.structure,annotations:[bad]},sketchMeta));
assert.throws(()=>validateBudget({maxTokens:null}));assert.equal(validateBudget({maxUsd:0}).maxUsd,0);
let behavior='ok',requests=[],active=0,peak=0,outlineAttempts=0;
const server=http.createServer(async(req,res)=>{if(req.url==='/v1/models'){res.setHeader('Content-Type','application/json');res.end(JSON.stringify({data:[...new Set(Object.values(VERIFIED_MODELS))].map(id=>({id}))}));return;}let raw='';for await(const part of req)raw+=part;const body=JSON.parse(raw);const role=body.messages[0].content.match(/You are the (\w+) /)[1];requests.push({role,body});active++;peak=Math.max(peak,active);await new Promise(r=>setTimeout(r,behavior==='slow'?100:5));active--;
 if(behavior==='long-retry'&&role==='outline'){res.statusCode=429;res.setHeader('Retry-After','120');res.end('{}');return;}
 if(behavior==='retry'&&role==='outline'&&++outlineAttempts===1){res.statusCode=429;res.end('{}');return;}
 let value=outputs[role];if(behavior==='sketch'&&role==='structure')value={...value,annotations};if(behavior==='disagree'&&role==='independent')value={...outline,buildings:[{...outline.buildings[0],vertices:[[20,10],[95,10],[95,90],[20,90]]}]};if(behavior==='gap'&&role==='structure')value={...value,planes:[{...value.planes[0],vertices:[[10,10],[50,10],[50,90],[10,90]]}]};if(behavior==='malformed'&&role==='structure')value={...value,pitch:7};
 res.setHeader('Content-Type','application/json');res.end(JSON.stringify({choices:[{finish_reason:'stop',message:{content:behavior==='fenced'?'```json\n'+JSON.stringify(value)+'\n```':JSON.stringify(value)}}],usage:{prompt_tokens:100,completion_tokens:100,cost_tokens:100}}));});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const address='http://127.0.0.1:'+server.address().port;
const options={apiKey:'test-only-not-a-credential',fetchImpl:(url,opts)=>fetch(address+new URL(url).pathname,opts),retryDelayMs:0,compareTraces:()=>({disputes:[{id:'synthetic-dispute'}]})};
try{
 const result=await runRoofAgents(input(),options);assert.equal(result.ledger.completed,5);assert.equal(result.status,'REVIEW REQUIRED');assert.equal(peak,2);assert.equal(result.ledger.billedUsd,0.0005);assert(!JSON.stringify(result).includes('base64'));
 assert.equal(requests[0].body.response_format.type,'json_object');assert.equal(result.originalOutputs.outline.content,JSON.stringify(outline));
 const independent=requests.find(r=>r.role==='independent').body;assert.equal(independent.messages[1].content[0].text.includes('buildings'),false,'independent agent never sees first outline');
 behavior='sketch';requests=[];const sketch=await runRoofAgents({...input(),imageMetadata:sketchMeta},options);assert.deepEqual(sketch.proposal.annotations,annotations);assert.deepEqual(sketch.proposal.outline,square);assert.equal(sketch.provenance.sourceImage.rotation,90);assert(requests.find(r=>r.role==='independent').body.messages[1].content[0].text.includes('roof-sketch'));
 behavior='fenced';const fenced=await runRoofAgents(input(),options);assert.equal(fenced.ledger.completed,5);assert.equal(fenced.originalOutputs.outline.normalization,'single-json-code-fence');assert(fenced.originalOutputs.outline.content.startsWith('```json'));
 behavior='disagree';const disagreed=await runRoofAgents(input(),{...options,compareTraces:undefined});assert(disagreed.adjudication);assert(disagreed.comparison.needsReview);assert.equal(disagreed.comparison.reviewThresholds.accuracyAcceptance,false);
 behavior='gap';const gap=await runRoofAgents(input(),{...options,compareTraces:undefined});assert.equal(gap.comparison.iou,1);assert(gap.disputes.some(d=>d.id==='structure-gap'));assert(gap.adjudication);assert.equal(gap.geometryValidation.ok,false);
 behavior='retry';outlineAttempts=0;const retried=await runRoofAgents(input(),options);assert.equal(retried.ledger.completed,5);assert.equal(retried.ledger.requests,6);
 behavior='long-retry';const long=await runRoofAgents(input(),options);assert.equal(long.ledger.requests,4);assert(long.failures.some(x=>x.code==='RATE_LIMIT'&&x.message.includes('120')));
 behavior='malformed';const partial=await runRoofAgents(input(),options);assert(partial.failures.some(x=>x.role==='structure'&&x.code==='INVALID_AGENT_OUTPUT'));assert(partial.outline);assert(!partial.structure);
 behavior='ok';const low=input();low.budget.maxUsd=0.01;const limited=await runRoofAgents(low,options);assert.equal(limited.ledger.requests,0);assert(limited.failures.some(x=>x.code==='BUDGET_LIMIT'));
 for(const cap of [{maxUsd:0},{maxCostUsd:0},{maxTokens:500},{maxTokens:0},{maxRequests:0},{maxOutputTokens:0}]) {
   const zero=input(); if('maxCostUsd' in cap)delete zero.budget.maxUsd;
   Object.assign(zero.budget,cap);const before=requests.length;
   const blocked=await runRoofAgents(zero,options);
   assert.equal(blocked.ledger.requests,0,JSON.stringify(cap)+' cannot be enlarged');
   assert.equal(requests.length,before,'no billable chat request for '+JSON.stringify(cap));
   assert(blocked.failures.some(f=>f.code==='BUDGET_LIMIT'));
 }
 for(const bad of [{maxCost:0},{maxRequests:-1},{maxRequests:0.5},{maxTokens:500.5},{maxUsd:-0.1},{maxTokens:null},{maxUsd:'0'},{maxRequests:21},{maxUsd:1,maxCostUsd:2}]) {
   const invalid=input();Object.assign(invalid.budget,bad);const before=requests.length;
   await assert.rejects(runRoofAgents(invalid,options),/budget/i);assert.equal(requests.length,before);
 }
 await assert.rejects(runRoofAgents({...input(),consentExternal:false},options),/authorization/);
 await assert.rejects(runRoofAgents(input(),{...options,isCurrent:()=>false}),/roof changed/);
 behavior='slow';const controller=new AbortController();setTimeout(()=>controller.abort(),20);await assert.rejects(runRoofAgents(input(),{...options,signal:controller.signal}),/abort|cancel/i);
 console.log('Runtime agents: real HTTP contract, independent trace isolation, concurrency, usage, retry, schema failure, budget, consent, stale revision and cancellation pass');
}finally{server.closeAllConnections();await new Promise(r=>server.close(r));}
