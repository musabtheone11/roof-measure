import {createHash} from 'node:crypto';
import {MODEL_CATALOG} from './model-catalog.mjs';

const URL='https://apinex.bond/api/public/models',MAX_BYTES=2*1024*1024;
export function contextTokensFromClaim(value) {
  if(typeof value!=='string')return null;
  const match=/^(\d+(?:\.\d+)?)([KM]?)$/.exec(value.trim());
  if(!match)return null;
  const tokens=Math.ceil(Number(match[1])*({'':1,K:1024,M:1048576}[match[2]]));
  return Number.isSafeInteger(tokens)&&tokens>=128&&tokens<=1073741824?tokens:null;
}
async function boundedJSON(response,signal) {
  if(Number(response.headers?.get('content-length'))>MAX_BYTES){await response.body?.cancel();throw new Error('oversized');}
  const reader=response.body?.getReader();if(!reader)throw new Error('body-unavailable');
  const abort=()=>{void reader.cancel().catch(()=>{});};signal.addEventListener('abort',abort,{once:true});
  let size=0;const chunks=[];
  try {
    for(;;) {
      if(signal.aborted)throw new Error('aborted');
      const {done,value}=await reader.read();
      if(signal.aborted)throw new Error('aborted');
      if(done)break;size+=value.byteLength;
      if(size>MAX_BYTES){await reader.cancel();throw new Error('oversized');}chunks.push(value);
    }
  }finally{signal.removeEventListener('abort',abort);reader.releaseLock();}
  const bytes=Buffer.concat(chunks);return {data:JSON.parse(bytes.toString('utf8')),hash:createHash('sha256').update(bytes).digest('hex')};
}
export async function auditModelCatalog({catalog=MODEL_CATALOG,fetchImpl=fetch,signal,timeoutMs=20000}={}) {
  const checkedAt=new Date().toISOString();
  const ids=Array.isArray(catalog)?catalog.map(m=>m?.id).filter(id=>typeof id==='string'):[];
  const unavailable=()=>({checkedAt,hash:null,status:'unavailable',issuesByModel:Object.fromEntries(ids.map(id=>[id,'CATALOG_UNVERIFIED']))});
  if(!Number.isInteger(timeoutMs)||timeoutMs<1||timeoutMs>20000||!Array.isArray(catalog)||signal?.aborted)return unavailable();
  try {
    const combined=AbortSignal.any([AbortSignal.timeout(timeoutMs),...(signal?[signal]:[])]);
    const response=await fetchImpl(URL,{method:'GET',headers:{Accept:'application/json'},redirect:'error',signal:combined});
    if(!response.ok){await response.body?.cancel();return unavailable();}
    const {data,hash}=await boundedJSON(response,combined);
    if(!Array.isArray(data?.models)||data.models.length>10000||data.models.some(m=>!m||typeof m.id!=='string'||!m.id||m.id.length>200))return unavailable();
    const entries=new Map(),duplicates=new Set();
    for(const model of data.models){if(entries.has(model.id))duplicates.add(model.id);entries.set(model.id,model);}
    const issuesByModel={};
    for(const expected of catalog) {
      const current=entries.get(expected.id);
      if(!current){issuesByModel[expected.id]='MODEL_ABSENT_PUBLIC_CATALOG';continue;}
      const contextTokens=contextTokensFromClaim(current.contextWindow);
      const rates=[current.dollarsPer1M,current.outputDollarsPer1M];
      const free=expected.billingTier==='free-allowance';
      if(duplicates.has(expected.id)||contextTokens===null||rates.some(rate=>!Number.isFinite(rate)||rate<0)||
        typeof current.allowFree!=='boolean'||typeof current.provider!=='string'||!current.provider||
        typeof current.supportsVision!=='boolean'||typeof current.supportsTools!=='boolean'||
        free!==expected.id.startsWith('free/')||free!==(current.provider==='Free')||
        (free&&(!Number.isInteger(current.weight)||current.weight<1||current.weight>expected.allowanceWeight))||
        (free&&expected.allowWithoutSubscription===true&&current.allowFree===false)) {
        issuesByModel[expected.id]='CATALOG_UNVERIFIED';continue;
      }
      // Base rates remain the safety bound. Sale/discount fields are never used
      // to lower reservations, and a free endpoint may not acquire a wallet fee.
      if(contextTokens>expected.contextTokens||rates[0]>expected.inputPerMillion||rates[1]>expected.outputPerMillion||
        (free&&rates.some(rate=>rate!==0)))issuesByModel[expected.id]='PRICING_CHANGED_REVERIFY';
    }
    return {checkedAt,hash,status:'verified',issuesByModel};
  }catch{return unavailable();}
}
