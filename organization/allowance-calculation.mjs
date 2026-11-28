import {createHash} from 'node:crypto';
import {getModelCatalogEntry,textAllowanceReservationUnits} from './model-catalog.mjs';
import {contextTokensFromClaim} from './catalog-audit.mjs';
import {isDecisionModel} from './decision-provider.mjs';

export const POLICY='apinex-documented-chat-allowance-v1';
export const ALLOWANCE_CALCULATION_POLICY=POLICY;
export const ALLOWANCE_QUOTE_URL='https://apinex.bond/api/public/models';
export const ALLOWANCE_FORMULA_DOCUMENT=Object.freeze({url:'https://apinex.bond/developers/models/billing.md',
  sha256:'dc475aa8b904365aaf50afb7c812d8e7fc64740f31871f135de04b9097295dc9'});
const MAX_BYTES=2*1024*1024,FRESH_MS=60000,HASH=/^[a-f0-9]{64}$/;
const integer=n=>Number.isSafeInteger(n)&&n>=0;
const object=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const digest=v=>createHash('sha256').update(v).digest('hex');
const no=(reason,blockDispatch=false)=>({eligible:false,reason,...(blockDispatch?{blockDispatch:true}:{})});
const cancelBody=body=>{try{void Promise.resolve(body?.cancel()).catch(()=>{});}catch{}};
function entryFor(model){const e=getModelCatalogEntry(model);return e&&model.startsWith('free/')&&!isDecisionModel(model)&&
  e.billingTier==='free-allowance'&&e.inputPerMillion===0&&e.outputPerMillion===0&&integer(e.allowanceWeight)&&e.allowanceWeight>0?e:null;}
function quoteData(quoteArtifact,model,at){
  const expected=entryFor(model);
  if(!expected)return no('MODEL_INELIGIBLE');
  if(!object(quoteArtifact)||quoteArtifact.schemaVersion!==1||quoteArtifact.policy!==POLICY||quoteArtifact.sourceUrl!==ALLOWANCE_QUOTE_URL||
    !integer(quoteArtifact.observedAt)||typeof quoteArtifact.body!=='string'||Buffer.byteLength(quoteArtifact.body)>MAX_BYTES||
    !HASH.test(quoteArtifact.bodySha256||'')||digest(quoteArtifact.body)!==quoteArtifact.bodySha256)return no('QUOTE_INVALID');
  let data;try{data=JSON.parse(quoteArtifact.body);}catch{return no('QUOTE_INVALID');}
  if(!Array.isArray(data?.models)||data.models.length>10000)return no('QUOTE_INVALID');
  const rows=data.models.filter(row=>row?.id===model);
  // Affirmative adverse evidence blocks even if other fields are malformed or duplicated.
  if(rows.some(row=>[row.dollarsPer1M,row.outputDollarsPer1M].some(v=>typeof v==='number'&&Number.isFinite(v)&&v>0)||
    typeof row.weight==='number'&&Number.isFinite(row.weight)&&row.weight>expected.allowanceWeight||
    (contextTokensFromClaim(row.contextWindow)??0)>expected.contextTokens))return no('PRICING_CHANGED_REVERIFY',true);
  if(rows.length!==1)return no('QUOTE_MODEL_UNVERIFIED');
  const row=rows[0],contextTokens=contextTokensFromClaim(row.contextWindow);
  if(row.provider!=='Free'||typeof row.allowFree!=='boolean'||row.dollarsPer1M!==0||row.outputDollarsPer1M!==0||
    !integer(row.weight)||row.weight<1||row.weight>expected.allowanceWeight||contextTokens===null||contextTokens>expected.contextTokens)
    return no('QUOTE_MODEL_UNVERIFIED');
  if(!integer(at)||at<quoteArtifact.observedAt||at-quoteArtifact.observedAt>FRESH_MS)return no('QUOTE_STALE');
  return {eligible:true,model,weight:row.weight,contextTokens,publishedContextTokens:expected.contextTokens,publishedWeight:expected.allowanceWeight,
    minimumReservationUnits:textAllowanceReservationUnits(model),observedAt:quoteArtifact.observedAt};
}

export function inspectAllowanceCalculationQuote({model,quoteArtifact,at}={}){return quoteData(quoteArtifact,model,at);}

/** Public, unauthenticated, fixed-endpoint quote. An unavailable quote grants no calculation eligibility. */
export async function verifyAllowanceCalculationQuote({model,fetchImpl=fetch,signal,timeoutMs=20000,now=Date.now}={}){
  if(!entryFor(model))return no('MODEL_INELIGIBLE');
  if(!Number.isInteger(timeoutMs)||timeoutMs<1||timeoutMs>20000||signal?.aborted)return no('QUOTE_UNAVAILABLE');
  const combined=AbortSignal.any([AbortSignal.timeout(timeoutMs),...(signal?[signal]:[])]);
  try{
    const response=await fetchImpl(ALLOWANCE_QUOTE_URL,{method:'GET',headers:{Accept:'application/json'},redirect:'error',signal:combined});
    if(!response.ok||Number(response.headers?.get('content-length'))>MAX_BYTES){cancelBody(response.body);return no('QUOTE_UNAVAILABLE');}
    const reader=response.body?.getReader();if(!reader)return no('QUOTE_UNAVAILABLE');
    const abort=()=>{void reader.cancel().catch(()=>{});};combined.addEventListener('abort',abort,{once:true});
    let size=0;const chunks=[];
    try{for(;;){if(combined.aborted)return no('QUOTE_UNAVAILABLE');const {done,value}=await reader.read();if(combined.aborted)return no('QUOTE_UNAVAILABLE');if(done)break;
      size+=value.byteLength;if(size>MAX_BYTES){void reader.cancel().catch(()=>{});return no('QUOTE_UNAVAILABLE');}chunks.push(value);}}
    finally{combined.removeEventListener('abort',abort);reader.releaseLock();}
    const bytes=Buffer.concat(chunks);let body;try{body=new TextDecoder('utf-8',{fatal:true}).decode(bytes);}catch{return no('QUOTE_INVALID');}
    const artifact={schemaVersion:1,policy:POLICY,sourceUrl:ALLOWANCE_QUOTE_URL,observedAt:now(),body,bodySha256:digest(bytes)};
    return {...quoteData(artifact,model,now()),quoteArtifact:artifact};
  }catch{return no('QUOTE_UNAVAILABLE');}
}

/** Storage validates artifact bytes/hash separately; never recompute a parsed artifact's serialization hash. */
export function validateAllowanceCalculationReservation({authorization,quoteArtifact,at}={}){
  if(!object(authorization)||authorization.policy!==POLICY||!HASH.test(authorization.quoteArtifactHash||'')||
    !integer(authorization.weight)||authorization.weight<1)return no('AUTHORIZATION_INVALID');
  const result=quoteData(quoteArtifact,authorization.model,at);
  if(!result.eligible)return result;
  if(authorization.weight!==result.weight)return no('QUOTE_WEIGHT_MISMATCH');
  return {...result,quoteArtifactHash:authorization.quoteArtifactHash};
}

function usageCounts(usage){
  if(!object(usage)||!integer(usage.prompt_tokens)||!integer(usage.completion_tokens))return null;
  const p=usage.prompt_tokens,c=usage.completion_tokens,total=p+c;
  if(!integer(total)||!integer(usage.total_tokens)||usage.total_tokens!==total)return null;
  for(const [key,expected] of [['input_tokens',p],['output_tokens',c]])if(Object.hasOwn(usage,key)&&usage[key]!==expected)return null;
  // Details are subsets, never extra terms in the formula. Reject impossible or conflicting aliases.
  for(const [keys,bound] of [[['prompt_tokens_details','input_tokens_details'],p],[['completion_tokens_details','output_tokens_details'],c]]){
    const details=keys.filter(key=>Object.hasOwn(usage,key)).map(key=>usage[key]);
    if(details.some(value=>!object(value)))return null;
    for(const detail of details)for(const value of Object.values(detail))if(!integer(value)||value>bound)return null;
    if(details.length===2)for(const key of new Set(details.flatMap(value=>Object.keys(value))))
      if(Object.hasOwn(details[0],key)&&Object.hasOwn(details[1],key)&&details[0][key]!==details[1][key])return null;
  }
  return {promptTokens:p,completionTokens:c,totalTokens:total};
}

/** No caller-supplied charge is accepted. Failed eligibility always retains the original full hold. */
export function calculateDocumentedAllowance({authorization,quoteArtifact,responseArtifact,dispatchAt,attemptId,taskId}={}){
  const quote=validateAllowanceCalculationReservation({authorization,quoteArtifact,at:dispatchAt});
  if(!quote.eligible)return quote;
  const binding=responseArtifact?.attemptBinding,e=responseArtifact?.execution,raw=responseArtifact?.rawResponse;
  if(typeof attemptId!=='string'||!attemptId||typeof taskId!=='string'||!taskId||!object(binding)||binding.attemptId!==attemptId||
    binding.taskId!==taskId||binding.model!==authorization.model||binding.protocol!=='chat/completions')return no('ATTEMPT_BINDING_INVALID');
  if(!object(e)||!object(raw)||e.requestedModel!==authorization.model||e.returnedModel!==authorization.model||raw.model!==authorization.model||
    e.settings?.route!=='chat/completions'||e.transportComplete!==true||!['json','sse','json-response-to-stream-request'].includes(e.transport)||
    !['stop','length'].includes(e.finishReason)||responseArtifact.streamErrorCode||responseArtifact.failureCode)return no('RESPONSE_INCOMPLETE');
  if(!Array.isArray(raw.choices)||raw.choices.length!==1||raw.choices[0]?.finish_reason!==e.finishReason||
    (raw.choices[0].index!==undefined&&raw.choices[0].index!==0)||e.requestId!==(typeof raw.id==='string'?raw.id:null))return no('RESPONSE_IDENTITY_INVALID');
  if(e.transport==='sse'){
    const stream=e.streamEvidence;
    if(stream?.protocol!=='openai-chat-sse-v1'||stream.complete!==true||stream.doneReceived!==true||stream.model!==authorization.model||
      stream.finishReason!==e.finishReason||stream.id!==e.requestId||!integer(stream.transportBytes)||stream.transportBytes<1||
      !integer(stream.eventCount)||stream.eventCount<1||!HASH.test(stream.transportSha256||''))return no('RESPONSE_INCOMPLETE');
  }
  if((e.reportedUsd!==null&&e.reportedUsd!==0)||e.billingTier!=='free-allowance'||
    [raw,raw.usage].some(value=>object(value)&&Object.hasOwn(value,'cost_tokens')&&value.cost_tokens!==0))return no('BILLING_CONFLICT');
  const counts=usageCounts(raw.usage),retained=usageCounts(responseArtifact.usage);
  if(!counts||!retained||Object.keys(counts).some(key=>counts[key]!==retained[key]))return no('USAGE_UNVERIFIED');
  if(!object(e.usage)||[['promptTokens','prompt_tokens'],['completionTokens','completion_tokens'],['totalTokens','total_tokens']].some(([key,rawKey])=>e.usage[key]!==raw.usage[rawKey]))return no('USAGE_UNVERIFIED');
  if([['inputTokens','input_tokens'],['outputTokens','output_tokens']].some(([key,rawKey])=>e.usage[key]!==
    (Object.hasOwn(raw.usage,rawKey)?raw.usage[rawKey]:null)))return no('USAGE_UNVERIFIED');
  const units=Math.ceil(counts.totalTokens*quote.weight);
  if(!integer(units))return no('USAGE_OVERFLOW');
  return {eligible:true,units,proof:{policy:POLICY,formula:'ceil((prompt_tokens + completion_tokens) * weight)',
    formulaDocumentSha256:ALLOWANCE_FORMULA_DOCUMENT.sha256,formulaDocumentUrl:ALLOWANCE_FORMULA_DOCUMENT.url,
    quoteArtifactHash:authorization.quoteArtifactHash,...counts,weight:quote.weight}};
}
