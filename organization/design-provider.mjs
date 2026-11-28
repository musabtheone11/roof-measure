import {createHash} from 'node:crypto';
import {inflateSync} from 'node:zlib';
import {validateTask} from './contracts.mjs';
import {DESIGN_CATALOG} from './design-catalog.mjs';
import {readProviderErrorDetails} from './provider-error.mjs';
import {verifySubscriptionAllowance,buildAllowanceReservation,allowanceUsage,AllowanceError} from './allowance.mjs';

const ENDPOINT='https://api.apinex.bond/v1/images/generations';
const MAX_RESPONSE=16*1024*1024,MAX_IMAGE=4*1024*1024,MAX_ENCODED=4*Math.ceil(MAX_IMAGE/3);
export class DesignProviderError extends Error {
  constructor(code,message,details={}){super(message);this.name='DesignProviderError';this.code=code;Object.assign(this,details);}
}
const fail=(code,message,details)=>{throw new DesignProviderError(code,message,details);};
function dimensions(width,height) {
  if(!Number.isInteger(width)||!Number.isInteger(height)||width<512||height<512||width>2048||height>2048||width*height>4194304)
    fail('INVALID_IMAGE_DIMENSIONS','Generated image dimensions are outside the bounded concept range');
  return {width,height};
}
const CRC_TABLE=Array.from({length:256},(_,n)=>{let c=n;for(let i=0;i<8;i++)c=(c&1)?0xedb88320^(c>>>1):c>>>1;return c>>>0;});
function crc32(bytes){let c=0xffffffff;for(const byte of bytes)c=CRC_TABLE[(c^byte)&255]^(c>>>8);return (c^0xffffffff)>>>0;}
export function inspectDesignImage(bytes) {
  if(!Buffer.isBuffer(bytes)||bytes.length<32||bytes.length>MAX_IMAGE)fail('IMAGE_TOO_LARGE_OR_INVALID','Generated image exceeds4MiB or is invalid');
  if(bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) {
    let pos=8,width,height,bitDepth,colorType,ended=false;const compressed=[];let chunks=0;
    while(pos<bytes.length) {
      if(++chunks>4096||pos+12>bytes.length)fail('INVALID_IMAGE_FORMAT','PNG chunk structure is invalid');
      const size=bytes.readUInt32BE(pos),type=bytes.toString('ascii',pos+4,pos+8),end=pos+12+size;
      if(end>bytes.length||crc32(bytes.subarray(pos+4,pos+8+size))!==bytes.readUInt32BE(pos+8+size))fail('INVALID_IMAGE_FORMAT','PNG checksum or length is invalid');
      if(chunks===1&&type!=='IHDR')fail('INVALID_IMAGE_FORMAT','PNG header is missing');
      if(type==='IHDR') {
        if(width!==undefined||size!==13)fail('INVALID_IMAGE_FORMAT','PNG header is invalid');
        width=bytes.readUInt32BE(pos+8);height=bytes.readUInt32BE(pos+12);bitDepth=bytes[pos+16];colorType=bytes[pos+17];dimensions(width,height);
        if(![8,16].includes(bitDepth)||![0,2,3,4,6].includes(colorType)||(colorType===3&&bitDepth!==8)||bytes[pos+18]!==0||bytes[pos+19]!==0||bytes[pos+20]!==0)
          fail('INVALID_IMAGE_FORMAT','Unsupported PNG encoding; retain for provider review');
      }else if(type==='IDAT')compressed.push(bytes.subarray(pos+8,pos+8+size));
      else if(type==='IEND'){if(size!==0||end!==bytes.length)fail('INVALID_IMAGE_FORMAT','PNG end marker is invalid');ended=true;break;}
      pos=end;
    }
    if(!ended||!compressed.length)fail('INVALID_IMAGE_FORMAT','PNG is incomplete');
    const channels={0:1,2:3,3:1,4:2,6:4}[colorType],stride=width*channels*(bitDepth/8),expected=(stride+1)*height;
    let raster;try{raster=inflateSync(Buffer.concat(compressed),{maxOutputLength:expected+1});}catch{fail('INVALID_IMAGE_FORMAT','PNG raster is invalid or exceeds its dimensions');}
    if(raster.length!==expected)fail('INVALID_IMAGE_FORMAT','PNG raster length does not match dimensions');
    for(let row=0;row<height;row++)if(raster[row*(stride+1)]>4)fail('INVALID_IMAGE_FORMAT','PNG scanline filter is invalid');
    return {extension:'png',mimeType:'image/png',...dimensions(width,height),formatValidation:'PNG structure, CRC, raster length and dimensions'};
  }
  if(bytes[0]===255&&bytes[1]===216&&bytes[bytes.length-2]===255&&bytes[bytes.length-1]===217) {
    let pos=2,width,height,sawScan=false;
    while(pos<bytes.length-2) {
      if(bytes[pos++]!==255)fail('INVALID_IMAGE_FORMAT','JPEG marker structure is invalid');
      while(bytes[pos]===255)pos++;
      const marker=bytes[pos++];
      if(marker===217)break;
      if(marker===1||(marker>=208&&marker<=215))continue;
      if(pos+2>bytes.length)fail('INVALID_IMAGE_FORMAT','JPEG segment is truncated');
      const length=bytes.readUInt16BE(pos);
      if(length<2||pos+length>bytes.length)fail('INVALID_IMAGE_FORMAT','JPEG segment length is invalid');
      if([192,193,194,195,197,198,199,201,202,203,205,206,207].includes(marker)) {
        if(length<8)fail('INVALID_IMAGE_FORMAT','JPEG frame is truncated');
        const h=bytes.readUInt16BE(pos+3),w=bytes.readUInt16BE(pos+5);dimensions(w,h);
        if(width!==undefined&&(width!==w||height!==h))fail('INVALID_IMAGE_FORMAT','JPEG frames disagree');width=w;height=h;
      }
      if(marker===218){if(pos+length>=bytes.length-2)fail('INVALID_IMAGE_FORMAT','JPEG scan data is missing');sawScan=true;break;}pos+=length;
    }
    if(!sawScan||width===undefined)fail('INVALID_IMAGE_FORMAT','JPEG frame/scan is missing');
    return {extension:'jpg',mimeType:'image/jpeg',...dimensions(width,height),formatValidation:'JPEG signature, bounded header segments and dimensions; raster requires independent visual inspection'};
  }
  fail('INVALID_IMAGE_FORMAT','Only bounded PNG/JPEG image responses are accepted');
}
async function readJSON(response,signal,maxBytes=MAX_RESPONSE) {
  if(Number(response.headers?.get('content-length'))>maxBytes){await response.body?.cancel();fail('RESPONSE_TOO_LARGE','Image service response exceeds its limit');}
  const reader=response.body?.getReader();if(!reader)fail('INVALID_IMAGE_RESPONSE','Image service returned no body');
  const cancel=()=>{void reader.cancel().catch(()=>{});};signal.addEventListener('abort',cancel,{once:true});
  let size=0;const parts=[];
  try {for(;;){if(signal.aborted)throw new Error('aborted');const {done,value}=await reader.read();if(signal.aborted)throw new Error('aborted');if(done)break;size+=value.byteLength;if(size>maxBytes){await reader.cancel();fail('RESPONSE_TOO_LARGE','Image service response exceeds its limit');}parts.push(value);}}
  finally{signal.removeEventListener('abort',cancel);reader.releaseLock();}
  try{return JSON.parse(Buffer.concat(parts).toString('utf8'));}catch{fail('INVALID_IMAGE_RESPONSE','Image service returned invalid JSON');}
}
export async function requestDesignConcept(task,{apiKey=process.env.APINEX_API_KEY,model,prompt,reserve,onDispatch,onUsage,onResponse,
  fetchImpl=fetch,signal,timeoutMs=120000,catalog=DESIGN_CATALOG}={}) {
  validateTask(task);
  const known=DESIGN_CATALOG.find(entry=>entry.id===model),entry=(Array.isArray(catalog)?catalog:catalog?.models)?.find(entry=>entry.id===model);
  if(!known||!entry||entry.pricingStatus!=='verified-published'||!Number.isFinite(entry.priceUsd)||entry.priceUsd<0||!Number.isFinite(known.priceUsd)||known.priceUsd<0)
    fail('DESIGN_MODEL_UNVERIFIED','Image model identity and flat pricing must be verified before dispatch');
  if([known.reserveUsd,entry.reserveUsd].some(value=>value!==undefined&&(!Number.isFinite(value)||value<0)))fail('DESIGN_MODEL_UNVERIFIED','Image reservation metadata is invalid');
  const priceUsd=Math.max(known.priceUsd,entry.priceUsd,known.reserveUsd??0,entry.reserveUsd??0);
  if(known.billingTier==='free-allowance'&&priceUsd!==0)fail('DESIGN_MODEL_UNVERIFIED','A free image route cannot acquire an unverified wallet charge');
  if(!entry.sizes?.includes('1024x1024')||!entry.responseFormats?.includes('b64_json')||entry.endpoints?.generation!==ENDPOINT)
    fail('DESIGN_MODEL_UNVERIFIED','The image model lacks the verified request format');
  if(typeof apiKey!=='string'||!apiKey.trim())fail('MISSING_API_KEY','Server API NEX credentials are not configured');
  if(typeof prompt!=='string'||!prompt.trim()||prompt.length>6000||Buffer.byteLength(prompt)>12000)fail('INVALID_DESIGN_PROMPT','Provide a bounded text-only design prompt');
  if(prompt.includes(apiKey))fail('INVALID_DESIGN_PROMPT','Credentials cannot be included in design prompts');
  if(!Number.isInteger(timeoutMs)||timeoutMs<1||timeoutMs>120000)fail('INVALID_LIMIT','Image timeout must be1–120000ms');
  if(task.constraints?.maxRuntimeMs===0||task.constraints?.maxAttempts===0)fail('BUDGET_DISABLED','An explicit zero task limit disables image processing');
  timeoutMs=Math.min(timeoutMs,task.constraints?.maxRuntimeMs??120000);
  if(![reserve,onDispatch,onUsage].every(callback=>typeof callback==='function'))fail('BUDGET_DISABLED','Durable reservation, dispatch and usage callbacks are required');
  if(signal?.aborted)fail('CANCELLED','Design task cancelled');
  const combined=AbortSignal.any([AbortSignal.timeout(timeoutMs),...(signal?[signal]:[])]);
  let reservation,dispatched=false,usageRecorded=false,allowance=null;
  const safeText=value=>typeof value==='string'&&value.length<=200&&!value.includes(apiKey)&&!/[\x00-\x1f]/.test(value)?value:null;
  async function request(url,body,maxBytes) {
    const response=await fetchImpl(url,{method:body?'POST':'GET',redirect:'error',signal:combined,
      headers:{Authorization:`Bearer ${apiKey}`,...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});
    if(!response.ok){
      const errorDetails=await readProviderErrorDetails(response,{apiKey,signal:combined});
      if(onResponse)await onResponse({errorDetails});
      fail('UPSTREAM_HTTP',`API NEX image service failed with HTTP ${response.status}`,
        {status:response.status,retryable:false,retryAfterMs:errorDetails?.retryAfterMs,errorDetails});
    }
    return readJSON(response,combined,maxBytes);
  }
  try {
    if(known.billingTier==='free-allowance') {
      const allowanceTokens=Math.max(known.allowanceTokens||0,entry.allowanceTokens||0);
      if(!Number.isSafeInteger(allowanceTokens)||allowanceTokens<1)fail('ALLOWANCE_UNVERIFIED','Free image allowance is unverified');
      let snapshot;
      try{snapshot=await verifySubscriptionAllowance({apiKey,fetchImpl,signal:combined,timeoutMs:Math.min(20000,timeoutMs)});}
      catch(error){if(onResponse&&error.errorDetails)await onResponse({errorDetails:error.errorDetails});throw error;}
      allowance=buildAllowanceReservation(snapshot,{reservedUnits:allowanceTokens,subscriptionRequired:entry.subscriptionRequired===true});
    }
    reservation=await reserve({usd:priceUsd,model,billingTier:known.billingTier,allowanceTokens:known.allowanceTokens||null,...(allowance?{allowance}:{})});
    if(reservation===null||reservation===undefined||reservation===false)fail('BUDGET_DISABLED','No durable image reservation was granted');
    if(combined.aborted)throw new Error('aborted');await onDispatch(reservation);dispatched=true;if(combined.aborted)throw new Error('aborted');
    const response=await request(ENDPOINT,{model,prompt:'Non-measurement visual design concept only. Use abstract placeholders, never customer imagery, numerical roof plans, roof segmentation or measurement certification. '+prompt,
      size:'1024x1024',aspect_ratio:'1:1',response_format:'b64_json',n:1});
    const cost=response?.usage?.cost_tokens??response?.cost_tokens;
    const reportedUsd=Number.isSafeInteger(cost)&&cost>=0?cost/1e6:null;
    const returnedModel=response.model===undefined?null:safeText(response.model);
    const execution={requestedModel:model,returnedModel,identityStatus:response.model===undefined?'not-reported':returnedModel===model?'exact-match':'mismatch',
      requestId:safeText(response.id),reportedUsd,billingStatus:reportedUsd===null?'unknown':'provider-reported',
      promptVersion:'design-concept-v1',settings:{size:'1024x1024',aspectRatio:'1:1',responseFormat:'b64_json',images:1},
      pricing:{reservedUsd:priceUsd,billingTier:known.billingTier,quotedAllowanceTokens:known.allowanceTokens||null,actualDebitStatus:'Only provider-reported cost is actual billing evidence'}};
    usageRecorded=true;await onUsage(reservation,{...execution,...(allowance?allowanceUsage(response.usage,{flatUnits:allowance.reservedUnits}):{})});
    const metadata={execution,dataCount:Array.isArray(response.data)?response.data.length:null,
      hasBase64:typeof response.data?.[0]?.b64_json==='string',hasImageURL:typeof response.data?.[0]?.url==='string'};
    if(onResponse)await onResponse(metadata);
    if(combined.aborted)throw new Error('aborted');
    if(execution.identityStatus==='mismatch')fail('MODEL_MISMATCH','Image service returned a different or invalid model identity');
    if(!Array.isArray(response.data)||response.data.length!==1||typeof response.data[0]?.b64_json!=='string')fail('INVALID_IMAGE_RESPONSE','Image service did not return exactly one direct base64 image; no asynchronous polling or URL fetching is assumed');
    const encoded=response.data[0].b64_json;
    if(encoded.length>MAX_ENCODED||encoded.length%4!==0||!/^[A-Za-z0-9+/]*={0,2}$/.test(encoded))fail('INVALID_IMAGE_RESPONSE','Image base64 is malformed or oversized');
    const imageBytes=Buffer.from(encoded,'base64');
    if(imageBytes.length>MAX_IMAGE||imageBytes.toString('base64')!==encoded)fail('IMAGE_TOO_LARGE_OR_INVALID','Decoded image is oversized or noncanonical');
    const inspected=inspectDesignImage(imageBytes),sha256=createHash('sha256').update(imageBytes).digest('hex');
    return {contributionKind:'design-concept',imageBytes,extension:inspected.extension,width:inspected.width,height:inspected.height,sha256,execution,
      artifactMetadata:{kind:'non-measurement-design-concept',mimeType:inspected.mimeType,bytes:imageBytes.length,sha256,
        width:inspected.width,height:inspected.height,formatValidation:inspected.formatValidation,sourceRevision:task.sourceRevision,
        customerImagerySubmitted:false,measurementEvidence:false,requiresVisualReview:true,productionReady:false}};
  }catch(error) {
    if(dispatched&&!usageRecorded){usageRecorded=true;await onUsage(reservation,{requestedModel:model,returnedModel:null,identityStatus:'unknown',reportedUsd:null,billingStatus:'unknown',...(allowance?allowanceUsage(null):{})});}
    if(signal?.aborted)fail('CANCELLED','Design task cancelled');
    if(combined.aborted)fail('TIMEOUT','Image request exceeded its bounded deadline');
    if(error instanceof DesignProviderError||error instanceof AllowanceError)throw error;
    if(['BUDGET_LIMIT','BUDGET_INCIDENT','STALE_LEASE','PAUSED','INVALID_LIMIT','UNKNOWN_BILLING','ATTEMPT_LIMIT','ALLOWANCE_EXHAUSTED','ALLOWANCE_UNVERIFIED','ALLOWANCE_STALE','ALLOWANCE_RECONCILIATION_REQUIRED',
      'ALLOWANCE_LIMIT','ALLOWANCE_INCIDENT','ALLOWANCE_SNAPSHOT_STALE','INVALID_ALLOWANCE','ALLOWANCE_RESERVATION_MISSING'].includes(error.code))throw error;
    fail('NETWORK_ERROR','Image service or durable image callback could not complete; ambiguous generations are never replayed automatically');
  }
}
