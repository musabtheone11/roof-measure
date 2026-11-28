const MAX_READ_BYTES=8192,MAX_STORED_BYTES=2048,MAX_RETRY_MS=30*86400000;
const BODY_STATES=new Set(['parsed','empty','not-json','oversized','unavailable']);

function safeText(value,maxBytes,apiKey) {
  if(typeof value!=='string')return null;
  if(/<\s*(?:!doctype|html|head|body|script|style)\b/i.test(value))return null;
  let text=value;
  if(typeof apiKey==='string'&&apiKey)text=text.split(apiKey).join('[REDACTED]');
  text=text.replace(/Bearer\s+[^\s,;"'<>]+/gi,'Bearer [REDACTED]')
    .replace(/\bsk-[A-Za-z0-9_-]{8,}\b/g,'[REDACTED]')
    .replace(/((?:api[_-]?key|authorization|access[_-]?token|secret)\s*["']?\s*[=:]\s*["']?)[^\s,;"'<>]+/gi,'$1[REDACTED]')
    .replace(/[\u0000-\u001f\u007f]/g,' ').trim();
  if(Buffer.byteLength(text)>maxBytes){const bytes=Buffer.from(text);let end=maxBytes;while((bytes[end]&0xc0)===0x80)end--;text=bytes.subarray(0,end).toString('utf8');}
  return text||null;
}

/** Allowlisted, redacted diagnostic fields only; never raw error bodies or HTML. */
export function sanitizeProviderErrorDetails(value,{apiKey}={}) {
  if(!value||typeof value!=='object'||Array.isArray(value))return null;
  const out={};
  if(Number.isInteger(value.httpStatus)&&value.httpStatus>=100&&value.httpStatus<=599)out.httpStatus=value.httpStatus;
  for(const [key,max]of [['requestId',192],['retryAfter',96],['code',96],['type',96],['param',96],['message',720]]) {
    const clean=safeText(value[key],max,apiKey);if(clean!==null)out[key]=clean;
  }
  if(Number.isFinite(value.retryAfterMs)&&value.retryAfterMs>=0)out.retryAfterMs=Math.min(MAX_RETRY_MS,Math.ceil(value.retryAfterMs));
  if(BODY_STATES.has(value.bodyStatus))out.bodyStatus=value.bodyStatus;
  // JSON escaping may expand bounded strings; cap the entire persisted object too.
  while(Buffer.byteLength(JSON.stringify(out))>MAX_STORED_BYTES) {
    const key=Object.keys(out).filter(k=>typeof out[k]==='string'&&k!=='bodyStatus').sort((a,b)=>out[b].length-out[a].length)[0];
    if(!key)break;out[key]=Array.from(out[key]).slice(0,-1).join('');if(!out[key])delete out[key];
  }
  return Object.keys(out).length?out:null;
}

export async function readProviderErrorDetails(response,{apiKey,signal,now=Date.now}={}) {
  const header=name=>response.headers?.get(name)||null;
  const retryAfter=header('retry-after');let retryAfterMs=null;
  if(retryAfter!==null) {
    if(/^\d+(?:\.\d+)?$/.test(retryAfter.trim()))retryAfterMs=Number(retryAfter)*1000;
    else {const date=Date.parse(retryAfter);if(Number.isFinite(date))retryAfterMs=Math.max(0,date-now());}
  }
  const details={httpStatus:response.status,requestId:header('x-request-id')||header('request-id')||header('x-apinex-request-id'),retryAfter,retryAfterMs,bodyStatus:'empty'};
  const cancelBody=()=>{try{void Promise.resolve(response.body?.cancel()).catch(()=>{});}catch{}};
  if(Number(header('content-length'))>MAX_READ_BYTES){details.bodyStatus='oversized';cancelBody();return sanitizeProviderErrorDetails(details,{apiKey});}
  if(/\btext\/html\b/i.test(header('content-type')||'')){details.bodyStatus='not-json';cancelBody();return sanitizeProviderErrorDetails(details,{apiKey});}
  const reader=response.body?.getReader();if(!reader)return sanitizeProviderErrorDetails(details,{apiKey});
  const cancel=()=>{void reader.cancel().catch(()=>{});};signal?.addEventListener('abort',cancel,{once:true});
  const chunks=[];let size=0;
  try {
    for(;;) {
      if(signal?.aborted){details.bodyStatus='unavailable';break;}
      const {done,value}=await reader.read();if(signal?.aborted){details.bodyStatus='unavailable';break;}if(done)break;
      size+=value.byteLength;if(size>MAX_READ_BYTES){details.bodyStatus='oversized';cancel();break;}
      chunks.push(value);
    }
    if(details.bodyStatus==='empty'&&size) {
      try {
        const parsed=JSON.parse(Buffer.concat(chunks).toString('utf8'));
        if(!parsed||typeof parsed!=='object'||Array.isArray(parsed))details.bodyStatus='not-json';
        else {
          const error=parsed.error&&typeof parsed.error==='object'&&!Array.isArray(parsed.error)?parsed.error:parsed;
          for(const key of ['code','type','param','message'])details[key]=error[key];
          details.requestId=details.requestId||parsed.request_id||error.request_id;
          details.bodyStatus='parsed';
        }
      }catch{details.bodyStatus='not-json';}
    }
  }catch{details.bodyStatus='unavailable';}
  finally{signal?.removeEventListener('abort',cancel);reader.releaseLock();}
  return sanitizeProviderErrorDetails(details,{apiKey});
}
