import {readProviderErrorDetails} from './provider-error.mjs';

// Reference: https://apinex.bond/developers/balance.md. Subscription quota uses
// its expiry; resets_at_utc describes the daily free tier, not subscriptions.
const ENDPOINT='https://api.apinex.bond/v1/subscription',MAX_BODY=65536,FRESH_MS=60000;
const units=value=>Number.isSafeInteger(value)&&value>=0;
export class AllowanceError extends Error {
  constructor(code,message,details={}){super(message);this.name='AllowanceError';this.code=code;Object.assign(this,details);}
}
const fail=(code,message,details)=>{throw new AllowanceError(code,message,details);};
const periodKey=(mode,end)=>`apinex-allowance-v1:${mode}:${end}`;
function timestamp(value){
  if(typeof value!=='string'||value.length>64||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/.test(value))return null;
  const [year,month,day]=value.slice(0,10).split('-').map(Number);
  if(month<1||month>12||day<1||day>new Date(Date.UTC(year,month,0)).getUTCDate())return null;
  const time=Date.parse(value);return units(time)?time:null;
}
function currentTime(now){const value=now();if(!units(value))fail('ALLOWANCE_UNVERIFIED','Allowance verification requires a valid clock');return value;}
function normalize(value,observedAt){
  if(!value||typeof value!=='object'||Array.isArray(value)||value.allowed!==true)fail('SUBSCRIPTION_REQUIRED','Free-model allowance access is unavailable');
  if(!['subscription','free'].includes(value.mode)||typeof value.unlimited!=='boolean')fail('ALLOWANCE_UNVERIFIED','Allowance mode and capacity are unverified');
  const remaining=value.tokens_remaining;
  if(!(units(remaining)||(value.unlimited&&remaining===null)))fail('ALLOWANCE_UNVERIFIED','Allowance remaining units are invalid');
  if(value.token_limit!==undefined&&value.token_limit!==null&&!units(value.token_limit))fail('ALLOWANCE_UNVERIFIED','Allowance limit is invalid');
  if(value.tokens_used!==undefined&&!units(value.tokens_used))fail('ALLOWANCE_UNVERIFIED','Allowance usage is invalid');
  if(units(value.token_limit)&&units(remaining)&&remaining>value.token_limit)fail('ALLOWANCE_UNVERIFIED','Allowance remaining units exceed its limit');
  if(units(value.token_limit)&&units(value.tokens_used)&&(value.tokens_used>value.token_limit||units(remaining)&&value.tokens_used>value.token_limit-remaining))
    fail('ALLOWANCE_UNVERIFIED','Allowance usage and remaining units contradict its limit');
  const resetsAt=value.resets_at_utc==null?null:timestamp(value.resets_at_utc);
  if(value.resets_at_utc!=null&&resetsAt===null)fail('ALLOWANCE_UNVERIFIED','Allowance reset timestamp is invalid');
  const subscriptionExpiry=value.expires_at_utc==null?null:timestamp(value.expires_at_utc);
  if(value.expires_at_utc!=null&&subscriptionExpiry===null)fail('ALLOWANCE_UNVERIFIED','Subscription expiry timestamp is invalid');
  const expiresAt=value.mode==='subscription'?subscriptionExpiry:resetsAt;
  if(expiresAt===null||expiresAt<=observedAt)fail('ALLOWANCE_UNVERIFIED','Allowance period is missing or expired');
  return {remainingUnits:remaining,observedAt,expiresAt,periodKey:periodKey(value.mode,expiresAt),
    unlimited:value.unlimited,mode:value.mode,allowed:true,resetsAt};
}
async function boundedJSON(response,signal){
  const cancelBody=()=>{try{void Promise.resolve(response.body?.cancel()).catch(()=>{});}catch{}};
  if(Number(response.headers?.get('content-length'))>MAX_BODY){cancelBody();fail('ALLOWANCE_RESPONSE_TOO_LARGE','Allowance response exceeds its size bound');}
  const reader=response.body?.getReader();if(!reader)fail('ALLOWANCE_UNVERIFIED','Allowance response is empty');
  const cancel=()=>{void reader.cancel().catch(()=>{});};signal.addEventListener('abort',cancel,{once:true});
  const parts=[];let size=0;
  try{for(;;){if(signal.aborted)throw new Error('aborted');const {done,value}=await reader.read();if(signal.aborted)throw new Error('aborted');if(done)break;
    size+=value.byteLength;if(size>MAX_BODY){cancel();fail('ALLOWANCE_RESPONSE_TOO_LARGE','Allowance response exceeds its size bound');}parts.push(value);}}
  finally{signal.removeEventListener('abort',cancel);reader.releaseLock();}
  try{return JSON.parse(Buffer.concat(parts).toString('utf8'));}catch{fail('ALLOWANCE_UNVERIFIED','Allowance service returned invalid JSON');}
}

/** Private admission snapshot. Never attach the return value to model context or public logs. */
export async function verifySubscriptionAllowance({apiKey,fetchImpl=fetch,signal,timeoutMs=20000,now=Date.now}={}){
  if(typeof apiKey!=='string'||!apiKey.trim())fail('MISSING_API_KEY','Server API NEX credentials are not configured');
  if(!Number.isSafeInteger(timeoutMs)||timeoutMs<1||timeoutMs>20000)fail('INVALID_LIMIT','Allowance timeout must be1–20000ms');
  if(signal?.aborted)fail('CANCELLED','Allowance verification cancelled');
  const combined=AbortSignal.any([AbortSignal.timeout(timeoutMs),...(signal?[signal]:[])]);
  try{
    const response=await fetchImpl(ENDPOINT,{method:'GET',redirect:'error',signal:combined,headers:{Authorization:`Bearer ${apiKey}`}});
    if(!response.ok){const errorDetails=await readProviderErrorDetails(response,{apiKey,signal:combined,now});
      fail('UPSTREAM_HTTP',`API NEX allowance service failed with HTTP ${response.status}`,{status:response.status,retryable:false,retryAfterMs:errorDetails?.retryAfterMs,errorDetails});}
    const body=await boundedJSON(response,combined);return normalize(body,currentTime(now));
  }catch(error){
    if(signal?.aborted)fail('CANCELLED','Allowance verification cancelled');
    if(combined.aborted)fail('TIMEOUT','Allowance verification exceeded its deadline');
    if(error instanceof AllowanceError)throw error;
    fail('NETWORK_ERROR','Allowance verification could not complete; free-model dispatch remains blocked');
  }
}

export function buildAllowanceReservation(snapshot,{reservedUnits,subscriptionRequired=false,now=Date.now}={}){
  const time=currentTime(now);
  if(!snapshot||snapshot.allowed!==true||!['subscription','free'].includes(snapshot.mode)||typeof snapshot.unlimited!=='boolean'||
    !units(snapshot.observedAt)||!units(snapshot.expiresAt)||!units(reservedUnits)||reservedUnits===0||
    !(units(snapshot.remainingUnits)||(snapshot.unlimited&&snapshot.remainingUnits===null))||
    snapshot.periodKey!==periodKey(snapshot.mode,snapshot.expiresAt))fail('ALLOWANCE_UNVERIFIED','A verified allowance snapshot and unit reservation are required');
  if(subscriptionRequired&&snapshot.mode!=='subscription')fail('SUBSCRIPTION_REQUIRED','This free model requires subscription access');
  if(snapshot.observedAt>time||time-snapshot.observedAt>FRESH_MS)fail('ALLOWANCE_STALE','Allowance snapshot is stale; refresh before dispatch');
  if(snapshot.expiresAt<=time)fail('ALLOWANCE_UNVERIFIED','Allowance period has expired');
  if(!snapshot.unlimited&&reservedUnits>snapshot.remainingUnits)fail('ALLOWANCE_EXHAUSTED','Insufficient verified allowance for this reservation');
  return {reservedUnits,remainingUnits:snapshot.remainingUnits,observedAt:snapshot.observedAt,
    expiresAt:snapshot.expiresAt,periodKey:snapshot.periodKey,unlimited:snapshot.unlimited};
}

/** Published billing formula gives estimates, not a documented exact debit field.
 * usage.allowance_tokens is currently undocumented, so it cannot release a hold. */
export function allowanceUsage(usage,{weight,flatUnits}={}){
  let estimate=null;
  if(units(flatUnits))estimate=flatUnits;
  else if(units(usage?.total_tokens)&&Number.isFinite(weight)&&weight>0){const product=Math.ceil(usage.total_tokens*weight);if(units(product))estimate=product;}
  return {reportedAllowanceUnits:null,estimatedAllowanceUnits:estimate};
}
