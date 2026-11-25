import test from 'node:test';import assert from'node:assert/strict';import{startRuntime}from'./http.mjs';
test('owner-bound jobs, CSRF, cancellation and private paths',async()=>{let signal;const s=await startRuntime({port:0,apiKey:'test-only-key',runAgents:async(x,o)=>{signal=o.signal;return await new Promise((r,j)=>o.signal.addEventListener('abort',()=>j(Error('cancelled'))));},measure:x=>({revision:x.revision})});try{const base='http://127.0.0.1:'+s.address().port;let r=await fetch(base+'/api/ai/config');const cookie=r.headers.get('set-cookie').split(';')[0],config=await r.json();assert(!JSON.stringify(config).includes('test-only-key'));assert.equal((await fetch(base+'/api/ai/trace',{method:'POST',body:'{}'})).status,403);const headers={cookie,'x-roof-csrf':config.csrfToken,'content-type':'application/json'};r=await fetch(base+'/api/ai/trace',{method:'POST',headers,body:JSON.stringify({revision:1,consentExternal:true})});const{jobId}=await r.json();assert.equal(r.status,202);assert.equal((await fetch(base+'/api/ai/jobs/'+jobId)).status,404);r=await fetch(base+'/api/ai/jobs/'+jobId,{method:'DELETE',headers});assert.equal(r.status,200);assert.equal(signal.aborted,true);assert.equal((await fetch(base+'/server/main.mjs')).status,403);assert.equal((await fetch(base+'/.env')).status,403);}finally{s.closeAllConnections();await new Promise(r=>s.close(r));}});

import http from 'node:http';
test('chunked simultaneous uploads cannot bypass owner/global admission',async()=>{
 async function cohort(owners,expected){
  let started=0;
  const s=await startRuntime({port:0,apiKey:'test-only-key',runAgents:async(x,o)=>{started++;return new Promise((resolve,reject)=>o.signal.addEventListener('abort',()=>reject(Error('cancelled'))));},measure:x=>x});
  try{
   const base='http://127.0.0.1:'+s.address().port,auth=[];
   for(let i=0;i<owners;i++){const r=await fetch(base+'/api/ai/config');auth.push({cookie:r.headers.get('set-cookie').split(';')[0],csrf:(await r.json()).csrfToken});}
   const pending=[];
   for(let i=0;i<4;i++){
    const a=auth[i%owners];let request;
    const response=new Promise((resolve,reject)=>{request=http.request(base+'/api/ai/trace',{method:'POST',headers:{cookie:a.cookie,'x-roof-csrf':a.csrf,'content-type':'application/json'}},r=>{r.resume();r.on('end',()=>resolve(r.statusCode));});request.on('error',reject);request.write('{');});
    pending.push({request,response});
   }
   // All handlers have entered their asynchronous body reads before completion.
   await new Promise(r=>setTimeout(r,50));
   for(const p of pending)p.request.end('"revision":"race","consentExternal":true}');
   const codes=await Promise.all(pending.map(p=>p.response));
   assert.equal(codes.filter(c=>c===202).length,expected);assert.equal(codes.filter(c=>c===429).length,4-expected);assert.equal(started,expected);
  }finally{s.closeAllConnections();await new Promise(r=>s.close(r));}
 }
 await cohort(1,1);await cohort(4,2);
});

test('malformed explicit HTTP budgets never start a provider job',async()=>{
 let calls=0;const s=await startRuntime({port:0,apiKey:'test-only-key',runAgents:async()=>{calls++;return{};},measure:x=>x});
 try{const base='http://127.0.0.1:'+s.address().port,r=await fetch(base+'/api/ai/config'),cookie=r.headers.get('set-cookie').split(';')[0],config=await r.json();
 const headers={cookie,'x-roof-csrf':config.csrfToken,'content-type':'application/json'};
 for(const budget of [null,{maxUsd:null},{maxUsd:'0'},{maxTokens:null},{maxTokens:'500'},{maxRequests:0.5},{maxUsd:1,maxCostUsd:2}]){
 const q=await fetch(base+'/api/ai/trace',{method:'POST',headers,body:JSON.stringify({revision:'budget',consentExternal:true,budget})});assert.equal(q.status,400);}
 assert.equal(calls,0);
 }finally{s.closeAllConnections();await new Promise(r=>s.close(r));}
});

test('valid dollar aliases clamp consistently and local PDF modules have executable MIME',async()=>{
 let captured;const s=await startRuntime({port:0,apiKey:'test-only-key',runAgents:async x=>{captured=x;return{};},measure:x=>x});
 try{const base='http://127.0.0.1:'+s.address().port,r=await fetch(base+'/api/ai/config'),cookie=r.headers.get('set-cookie').split(';')[0],c=await r.json();
 const q=await fetch(base+'/api/ai/trace',{method:'POST',headers:{cookie,'x-roof-csrf':c.csrfToken,'content-type':'application/json'},body:JSON.stringify({revision:'cap',consentExternal:true,budget:{maxCostUsd:3}})});assert.equal(q.status,202);assert.equal(captured.budget.maxUsd,2);assert.equal(Object.hasOwn(captured.budget,'maxCostUsd'),false);
 const module=await fetch(base+'/vendor/pdfjs/pdf.mjs',{method:'HEAD'});assert.equal(module.status,200);assert.match(module.headers.get('content-type'),/javascript/);
 }finally{s.closeAllConnections();await new Promise(r=>s.close(r));}
});
