import test from 'node:test';
import assert from 'node:assert/strict';
import {readProviderErrorDetails,sanitizeProviderErrorDetails} from './provider-error.mjs';

test('HTTP diagnostics preserve allowlisted JSON fields, request ID and Retry-After while redacting credentials',async()=>{
  const response=new Response(JSON.stringify({error:{code:'upstream_unavailable',type:'server_error',param:'model',message:'api_key=test-key Bearer hidden-token; retry later',debug:'must not persist'},request_id:'body-id',other:'must not persist'}),
    {status:503,headers:{'content-type':'application/json','x-request-id':'header-id','retry-after':'12'}});
  const details=await readProviderErrorDetails(response,{apiKey:'test-key'});
  assert.deepEqual(details,{httpStatus:503,requestId:'header-id',retryAfter:'12',code:'upstream_unavailable',type:'server_error',param:'model',message:'api_key=[REDACTED] Bearer [REDACTED]; retry later',retryAfterMs:12000,bodyStatus:'parsed'});
  assert.doesNotMatch(JSON.stringify(details),/test-key|hidden-token|must not persist/);
  const quoted=sanitizeProviderErrorDetails({message:'"api_key": "another-secret", authorization=Bearer unknown-secret'});
  assert.doesNotMatch(JSON.stringify(quoted),/another-secret|unknown-secret/);
});
test('HTML and malformed/array JSON bodies never become stored diagnostic messages',async()=>{
  for(const [body,headers]of [['<html>private debug</html>',{'content-type':'text/html'}],['not json',{}],['["private debug"]',{}]]) {
    const details=await readProviderErrorDetails(new Response(body,{status:502,headers}));
    assert.equal(details.httpStatus,502);assert.equal(details.bodyStatus,'not-json');assert.equal(details.message,undefined);assert.doesNotMatch(JSON.stringify(details),/private debug/);
  }
  const nested=await readProviderErrorDetails(new Response('{"error":{"message":"<html>private debug</html>"}}',{status:500}));assert.equal(nested.message,undefined);
});
test('error bodies are bounded to8KiB even without Content-Length and persisted details to2KiB',async()=>{
  for(const headers of [{},{'content-length':'9000'}]) {
    const details=await readProviderErrorDetails(new Response('x'.repeat(9000),{status:500,headers}));
    assert.equal(details.bodyStatus,'oversized');assert.equal(details.message,undefined);
  }
  const details=sanitizeProviderErrorDetails({httpStatus:400,code:'x'.repeat(5000),type:'y'.repeat(5000),param:'z'.repeat(5000),requestId:'i'.repeat(5000),message:'🛠'.repeat(5000),rawBody:'never',bodyStatus:'parsed'});
  assert.ok(Buffer.byteLength(JSON.stringify(details))<=2048);assert.equal(details.rawBody,undefined);
});
test('header date retry delay, JSON request ID fallback and malformed headers stay bounded',async()=>{
  const details=await readProviderErrorDetails(new Response('{"error":{"message":"retry"},"request_id":"json-id"}',{status:429,headers:{'retry-after':'Thu, 01 Jan 1970 00:00:05 GMT'}}),{now:()=>1000});
  assert.equal(details.requestId,'json-id');assert.equal(details.retryAfterMs,4000);
  const bad=await readProviderErrorDetails(new Response('{}',{status:429,headers:{'retry-after':'not-a-delay'}}));assert.equal(bad.retryAfterMs,undefined);
  const huge=await readProviderErrorDetails(new Response('{}',{status:429,headers:{'retry-after':'999999999999999999999'}}));assert.equal(huge.retryAfterMs,30*86400000);
});
test('aborting a stalled diagnostic stream cancels the read and stores only safe header metadata',async()=>{
  let cancelled=false;const controller=new AbortController();
  const body=new ReadableStream({start(){},cancel(){cancelled=true;}});
  const pending=readProviderErrorDetails(new Response(body,{status:504,headers:{'x-request-id':'timeout-id'}}),{signal:controller.signal});
  controller.abort();const details=await pending;assert.equal(cancelled,true);assert.equal(details.httpStatus,504);assert.equal(details.requestId,'timeout-id');assert.equal(details.bodyStatus,'unavailable');assert.equal(details.message,undefined);
});
test('a cancellation hook that never settles cannot hold an oversized diagnostic response open',async()=>{
  let cancelled=false;const body=new ReadableStream({start(){},cancel(){cancelled=true;return new Promise(()=>{});}});
  const details=await readProviderErrorDetails(new Response(body,{status:500,headers:{'content-length':'9000'}}));
  assert.equal(cancelled,true);assert.equal(details.bodyStatus,'oversized');
});
