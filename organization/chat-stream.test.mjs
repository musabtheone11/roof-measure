import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readChatStream} from './chat-stream.mjs';

const model='free/gpt-6-luna';
const event=value=>'data: '+(typeof value==='string'?value:JSON.stringify(value))+'\n\n';
const chunk=(delta,extra={})=>({id:'stream-request',model,choices:[{index:0,delta,finish_reason:null}],...extra});
function response(wire,{step,headers={}}={}){
  const bytes=Buffer.isBuffer(wire)?wire:Buffer.from(wire),parts=[];for(let i=0;i<bytes.length;i+=step||bytes.length)parts.push(bytes.subarray(i,i+(step||bytes.length)));
  return new Response(new ReadableStream({start(controller){for(const b of parts)controller.enqueue(b);controller.close();}}),{headers:{'content-type':'text/event-stream',...headers}});
}
function complete(content='{"text":"🛠 déjà"}',usage={cost_tokens:0,total_tokens:20}){
  return event(chunk({role:'assistant',content}))+event(chunk({},{choices:[{index:0,delta:{},finish_reason:'stop'}]}))+
    (usage===null?'':event({id:'stream-request',model,choices:[],usage}))+event('[DONE]');
}
test('SSE preserves exact UTF-8 content, original usage, finish, identity and wire/content hashes across every byte boundary',async()=>{
  const wire=complete(),r=await readChatStream(response(wire,{step:1}),{requestedModel:model});
  assert.equal(r.choices[0].message.content,'{"text":"🛠 déjà"}');assert.equal(r.choices[0].finish_reason,'stop');assert.equal(r.model,model);assert.equal(r.id,'stream-request');
  assert.deepEqual(r.usage,{cost_tokens:0,total_tokens:20});assert.equal(r.streamEvidence.transportSha256,createHash('sha256').update(wire).digest('hex'));
  assert.equal(r.streamEvidence.contentSha256,createHash('sha256').update(r.choices[0].message.content).digest('hex'));assert.equal(r.streamEvidence.complete,true);
});
test('CRLF boundaries, comments and multiline data events decode without changing content',async()=>{
  const first=': keepalive\r\nevent: message\r\ndata: {"id":"stream-request",\r\ndata: "model":"'+model+'","choices":[{"index":0,"delta":{"content":"abc"},"finish_reason":"stop"}]}\r\n\r\ndata: [DONE]\r\n\r\n';
  const r=await readChatStream(response(first,{step:2}),{requestedModel:model});assert.equal(r.choices[0].message.content,'abc');assert.equal(r.usage,null);
});
test('terminal finish and DONE are both required; partial text and hashes remain available on failure',async()=>{
  for(const wire of [event(chunk({content:'partial'})),event(chunk({content:'partial'}))+event('[DONE]'),event(chunk({content:'partial'},{choices:[{index:0,delta:{content:'partial'},finish_reason:'stop'}]}))]){
    await assert.rejects(readChatStream(response(wire),{requestedModel:model}),e=>{assert.equal(e.code,'STREAM_INCOMPLETE');assert.equal(e.streamEvidence.content,'partial');assert.equal(e.streamEvidence.complete,false);return true;});
  }
});
test('returned model must be observed and exact; conflicting model or request identities reject',async()=>{
  const noModel=complete().replaceAll('"model":"'+model+'",','');await assert.rejects(readChatStream(response(noModel),{requestedModel:model}),{code:'MODEL_MISMATCH'});
  await assert.rejects(readChatStream(response(complete().replaceAll(model,'other-model')),{requestedModel:model}),{code:'MODEL_MISMATCH'});
  const modelConflict=event(chunk({content:'a'}))+event(chunk({},{model:'other-model'}));await assert.rejects(readChatStream(response(modelConflict)),{code:'STREAM_IDENTITY_CONFLICT'});
  const idConflict=event(chunk({content:'a'}))+event(chunk({},{id:'other-request'}));await assert.rejects(readChatStream(response(idConflict),{requestedModel:model}),{code:'STREAM_IDENTITY_CONFLICT'});
});
test('absent usage stays null and contradictory repeated usage fails closed',async()=>{
  const r=await readChatStream(response(complete('ok',null)),{requestedModel:model});assert.equal(r.usage,null);
  const wire=event(chunk({content:'x'}))+event({model,choices:[],usage:{total_tokens:2}})+event({model,choices:[],usage:{total_tokens:3}});
  await assert.rejects(readChatStream(response(wire),{requestedModel:model}),{code:'STREAM_USAGE_CONFLICT'});
});
test('tool calls, ambiguous choices, malformed events and data after finish/DONE are rejected without execution',async()=>{
  for(const [wire,code]of [
    [event(chunk({tool_calls:[{function:{name:'run',arguments:'{}'}}]})),'STREAM_UNSUPPORTED_DELTA'],
    [event(chunk({},{choices:[{index:1,delta:{content:'x'}}]})),'STREAM_INVALID_CHOICE'],
    ['data: invalid JSON\n\n','STREAM_INVALID_EVENT'],
    [event({error:{message:'secret upstream debug'}}),'STREAM_UPSTREAM_ERROR'],
    [complete()+event(chunk({content:'after done'})),'STREAM_AFTER_DONE'],
    [event(chunk({content:'x'},{choices:[{index:0,delta:{content:'x'},finish_reason:'stop'}]}))+event(chunk({content:'later'})),'STREAM_INVALID_CHOICE']])
    await assert.rejects(readChatStream(response(wire),{requestedModel:model}),e=>e.code===code&&!e.message.includes('secret'));
});
test('64KiB output,2MiB transport and UTF-8 limits are enforced',async()=>{
  await assert.rejects(readChatStream(response(complete('x'.repeat(65537)))),{code:'OUTPUT_TOO_LARGE'});
  await assert.rejects(readChatStream(response(':'+ 'x'.repeat(2*1024*1024)+'\n\n')),{code:'RESPONSE_TOO_LARGE'});
  await assert.rejects(readChatStream(response(Buffer.from([0xff]))),{code:'STREAM_INVALID_UTF8'});
  await assert.rejects(readChatStream(new Response('{}',{headers:{'content-type':'application/json'}})),{code:'STREAM_CONTENT_TYPE'});
});
test('cancellation unblocks stalled readers and preserves safe partial evidence',async()=>{
  const controller=new AbortController();let cancelled=false;
  const body=new ReadableStream({start(c){c.enqueue(Buffer.from(event(chunk({content:'partial'}))));},cancel(){cancelled=true;}});
  const pending=readChatStream(new Response(body,{headers:{'content-type':'text/event-stream'}}),{signal:controller.signal,requestedModel:model});
  await new Promise(resolve=>setImmediate(resolve));controller.abort();await assert.rejects(pending,e=>e.code==='CANCELLED'&&e.streamEvidence.content==='partial');assert.equal(cancelled,true);
});
test('empty metadata frames and null or omitted terminal deltas preserve an otherwise complete response',async()=>{
  for(const delta of [null,undefined]){
    const terminal={index:0,finish_reason:'stop',...(delta===undefined?{}:{delta})};
    const wire=event({id:'stream-request',model,choices:[],usage:null})+event(chunk({content:'{"ok":true}'}))+
      event({id:'stream-request',model,choices:[terminal]})+event({id:'stream-request',model,choices:[]})+event('[DONE]');
    const r=await readChatStream(response(wire,{step:1}),{requestedModel:model});assert.equal(r.choices[0].message.content,'{"ok":true}');assert.equal(r.choices[0].finish_reason,'stop');assert.equal(r.usage,null);
  }
});
test('compatibility frames cannot invent text, finish or tools and do not admit full-message guesses',async()=>{
  for(const wire of [event({model,choices:[],usage:null})+event('[DONE]'),event({model,choices:[{index:0,delta:null,finish_reason:'stop'}]})+event('[DONE]')])
    await assert.rejects(readChatStream(response(wire),{requestedModel:model}),{code:'STREAM_INCOMPLETE'});
  for(const terminal of [{index:0,delta:null,finish_reason:null},{index:0,finish_reason:''},{index:0,message:{content:'invented'},finish_reason:'stop'}])
    await assert.rejects(readChatStream(response(event(chunk({content:'x'}))+event({model,choices:[terminal]})),{requestedModel:model}),{code:'STREAM_UNSUPPORTED_DELTA'});
});
