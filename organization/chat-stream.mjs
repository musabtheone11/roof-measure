import {createHash} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';

const MAX_TRANSPORT=2*1024*1024,MAX_CONTENT=64*1024;
const validFinish=value=>typeof value==='string'&&value.trim().length>0&&value.length<=80&&!/[\x00-\x1f]/.test(value);
export class ChatStreamError extends Error {
  constructor(code,message,evidence){super(message);this.name='ChatStreamError';this.code=code;this.streamEvidence=evidence;}
}

/** OpenAI-compatible SSE as documented in APINEX's sse-streaming-chat-completions-latency guides.
 * Never executes tools, fills in missing identity, retries, or treats absent usage as zero. */
export async function readChatStream(response,{signal,requestedModel}={}){
  let content='',contentBytes=0,transportBytes=0,eventCount=0,model=null,id=null,usage=null,finish=null,doneReceived=false;
  const transportHash=createHash('sha256'),decoder=new TextDecoder('utf-8',{fatal:true});
  const evidence=()=>({protocol:'openai-chat-sse-v1',model,id,usage,finishReason:finish,content,
    contentBytes,contentSha256:createHash('sha256').update(content).digest('hex'),transportBytes,
    transportSha256:transportHash.copy().digest('hex'),eventCount,doneReceived,complete:doneReceived&&finish!==null&&contentBytes>0&&model!==null});
  const fail=(code,message)=>{throw new ChatStreamError(code,message,{...evidence(),complete:false});};
  const cancelBody=()=>{try{void Promise.resolve(response.body?.cancel()).catch(()=>{});}catch{}};
  if(!/^text\/event-stream(?:\s*;|\s*$)/i.test(response.headers?.get('content-type')||'')){
    cancelBody();fail('STREAM_CONTENT_TYPE','Streaming chat did not return the documented event-stream format');
  }
  if(Number(response.headers?.get('content-length'))>MAX_TRANSPORT){cancelBody();fail('RESPONSE_TOO_LARGE','Streaming chat exceeds the transport bound');}
  const reader=response.body?.getReader();if(!reader)fail('INVALID_RESPONSE','Streaming chat has no response body');
  const cancel=()=>{void reader.cancel().catch(()=>{});};signal?.addEventListener('abort',cancel,{once:true});
  let pending='',data=[],eventType='';
  function identity(chunk){
    for(const key of ['model','id'])if(chunk[key]!==undefined){
      const value=chunk[key];if(typeof value!=='string'||!value||value.length>200||/[\x00-\x1f]/.test(value))fail('STREAM_IDENTITY_INVALID','Streaming response identity is invalid');
      const previous=key==='model'?model:id;
      if(previous!==null&&previous!==value)fail('STREAM_IDENTITY_CONFLICT','Streaming response identities contradict one another');
      if(key==='model'){model=value;if(requestedModel&&model!==requestedModel)fail('MODEL_MISMATCH','Streaming chat returned a different model identifier');}
      else id=value;
    }
  }
  function dispatch(){
    const payload=data.join('\n');data=[];const type=eventType;eventType='';
    if(!payload.trim())return;
    if(doneReceived)fail('STREAM_AFTER_DONE','Streaming chat contains data after its completion marker');
    eventCount++;
    if(payload.trim()==='[DONE]'){
      if(finish===null)fail('STREAM_INCOMPLETE','Streaming chat ended without a terminal finish reason');
      doneReceived=true;return;
    }
    let chunk;try{chunk=JSON.parse(payload);}catch{fail('STREAM_INVALID_EVENT','Streaming chat contains malformed event JSON');}
    if(!chunk||typeof chunk!=='object'||Array.isArray(chunk))fail('STREAM_INVALID_EVENT','Streaming chat event must be a JSON object');
    if(type==='error'||chunk.error)fail('STREAM_UPSTREAM_ERROR','Streaming chat returned an upstream error event');
    if(type&&type!=='message')fail('STREAM_UNSUPPORTED_EVENT','Streaming chat event type is unsupported');
    identity(chunk);
    if(chunk.usage!==undefined&&chunk.usage!==null){
      if(typeof chunk.usage!=='object'||Array.isArray(chunk.usage)||Buffer.byteLength(JSON.stringify(chunk.usage))>MAX_CONTENT)fail('STREAM_INVALID_USAGE','Streaming usage metadata is invalid');
      if(usage!==null&&!isDeepStrictEqual(usage,chunk.usage))fail('STREAM_USAGE_CONFLICT','Streaming usage records contradict one another');
      usage=chunk.usage;
    }
    if(!Array.isArray(chunk.choices)||chunk.choices.length>1)fail('STREAM_INVALID_EVENT','Streaming chat choices are missing or ambiguous');
    if(!chunk.choices.length)return;
    const choice=chunk.choices[0];
    if(!choice||typeof choice!=='object'||(choice.index!==undefined&&choice.index!==0)||finish!==null)fail('STREAM_INVALID_CHOICE','Streaming chat choice is invalid or follows its finish');
    const delta=choice.delta==null&&validFinish(choice.finish_reason)?{}:choice.delta;
    if(!delta||typeof delta!=='object'||Array.isArray(delta)||choice.message!==undefined)fail('STREAM_UNSUPPORTED_DELTA','Streaming chat delta format is unsupported');
    if((delta.role!==undefined&&delta.role!=='assistant')||delta.function_call!=null||(Array.isArray(delta.tool_calls)?delta.tool_calls.length>0:delta.tool_calls!=null)||delta.refusal)
      fail('STREAM_UNSUPPORTED_DELTA','Streaming chat requested an unsupported role, refusal or tool action');
    if(delta.content!==undefined&&delta.content!==null){
      if(typeof delta.content!=='string')fail('STREAM_UNSUPPORTED_DELTA','Streaming chat content must be text');
      const next=Buffer.byteLength(delta.content);if(contentBytes+next>MAX_CONTENT)fail('OUTPUT_TOO_LARGE','Streaming chat text exceeds the accepted output bound');
      content+=delta.content;contentBytes+=next;
    }
    if(choice.finish_reason!==undefined&&choice.finish_reason!==null){
      if(!validFinish(choice.finish_reason))fail('STREAM_INVALID_FINISH','Streaming chat finish reason is invalid');
      finish=choice.finish_reason;
    }
  }
  function line(value){
    if(value===''){dispatch();return;}
    if(value.startsWith(':'))return;
    const colon=value.indexOf(':'),field=colon<0?value:value.slice(0,colon);let valueText=colon<0?'':value.slice(colon+1);if(valueText.startsWith(' '))valueText=valueText.slice(1);
    if(field==='data')data.push(valueText);else if(field==='event')eventType=valueText;
    // Standard SSE id/retry fields affect reconnect clients; this adapter never reconnects.
  }
  function drain(final=false){
    for(;;){const match=/[\r\n]/.exec(pending);if(!match)break;const at=match.index;
      if(pending[at]==='\r'&&at===pending.length-1&&!final)break;
      const end=at+(pending[at]==='\r'&&pending[at+1]==='\n'?2:1),value=pending.slice(0,at);pending=pending.slice(end);line(value);
    }
    if(final){if(pending){line(pending);pending='';}dispatch();}
  }
  try{
    for(;;){
      if(signal?.aborted)fail('CANCELLED','Streaming chat cancelled');
      const {done,value}=await reader.read();if(signal?.aborted)fail('CANCELLED','Streaming chat cancelled');
      if(done){try{pending+=decoder.decode();}catch{fail('STREAM_INVALID_UTF8','Streaming chat contains incomplete UTF-8');}drain(true);break;}
      transportBytes+=value.byteLength;transportHash.update(value);
      if(transportBytes>MAX_TRANSPORT)fail('RESPONSE_TOO_LARGE','Streaming chat exceeds the transport bound');
      try{pending+=decoder.decode(value,{stream:true});}catch{fail('STREAM_INVALID_UTF8','Streaming chat contains invalid UTF-8');}
      drain();
      if(doneReceived){if(pending.trim()||data.length)fail('STREAM_AFTER_DONE','Streaming chat contains trailing event data');cancel();break;}
    }
    if(!doneReceived||finish===null||contentBytes===0)fail('STREAM_INCOMPLETE','Streaming chat lacks nonempty text, a terminal finish reason or its completion marker');
    if(model===null)fail('MODEL_MISMATCH','Streaming chat omitted its returned model identity');
    return {id,model,usage,choices:[{index:0,message:{role:'assistant',content},finish_reason:finish}],streamEvidence:evidence()};
  }catch(error){
    cancel();if(error instanceof ChatStreamError)throw error;
    fail(signal?.aborted?'CANCELLED':'STREAM_NETWORK_ERROR',signal?.aborted?'Streaming chat cancelled':'Streaming chat was interrupted; dispatch outcome remains unknown');
  }finally{signal?.removeEventListener('abort',cancel);reader.releaseLock();}
}
