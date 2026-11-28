import snapshot from './design-catalog.json' with {type:'json'};
import {createHash} from 'node:crypto';

const CATALOG_URL='https://apinex.bond/api/user/media/models';
const MAX_BODY=64*1024;
function freeze(value) {
  if(value&&typeof value==='object'){for(const child of Object.values(value))freeze(child);Object.freeze(value);}
  return value;
}
export class DesignCatalogError extends Error {
  constructor(code,message,details={}){super(message);this.name='DesignCatalogError';this.code=code;Object.assign(this,details);}
}
const fail=(code,message,details)=>{throw new DesignCatalogError(code,message,details);};
const validId=id=>typeof id==='string'&&/^[a-z0-9][a-z0-9./-]{0,119}$/.test(id);
if(snapshot.schemaVersion!==1||snapshot.modelCount!==6||snapshot.models.length!==snapshot.modelCount||
  !Number.isFinite(Date.parse(snapshot.checkedAt))||snapshot.sourceURLs.catalog!==CATALOG_URL)
  fail('INVALID_DESIGN_CATALOG','Image catalog snapshot failed its version and provenance contract');
const ids=new Set();
for(const model of snapshot.models){
  if(!validId(model.id)||ids.has(model.id)||model.pricingStatus!=='verified-published'||
    !Number.isFinite(model.priceUsd)||model.priceUsd<0||!Number.isFinite(model.reserveUsd)||model.reserveUsd<model.priceUsd||
    !Number.isSafeInteger(model.priceMicroUsd)||model.priceMicroUsd!==Math.round(model.priceUsd*1e6)||
    !Number.isSafeInteger(model.allowanceTokens)||model.allowanceTokens<0||typeof model.subscriptionRequired!=='boolean'||
    !['paid','free-allowance'].includes(model.billingTier)||
    (model.billingTier==='free-allowance'&&(!model.id.startsWith('free/')||model.priceUsd!==0||model.allowanceTokens<1))||
    (model.billingTier==='paid'&&(model.id.startsWith('free/')||model.priceUsd<=0||model.allowanceTokens!==0))||
    JSON.stringify(model.sizes)!=='["1024x1024"]'||JSON.stringify(model.responseFormats)!=='["b64_json"]')
    fail('INVALID_DESIGN_CATALOG','Invalid exact image model record');
  ids.add(model.id);
}
export const DESIGN_CATALOG=freeze(snapshot.models);
export const DESIGN_CATALOG_METADATA=freeze(Object.fromEntries(Object.entries(snapshot).filter(([key])=>key!=='models')));
const byId=Object.freeze(Object.fromEntries(DESIGN_CATALOG.map(model=>[model.id,model])));
export function getDesignModel(id){return Object.hasOwn(byId,id)?byId[id]:null;}

function parseCatalog(value){
  if(!value||!Array.isArray(value.models)||value.models.length<1||value.models.length>1000)
    fail('INVALID_DESIGN_CATALOG_RESPONSE','Media catalog must contain a bounded models array');
  const seen=new Set();
  for(const model of value.models){
    if(!model||!validId(model.id)||seen.has(model.id)||typeof model.category!=='string'||model.category.length>60||
      !Number.isSafeInteger(model.priceTokens)||model.priceTokens<0||
      !Number.isSafeInteger(model.baseTokens)||model.baseTokens<1||
      !Number.isFinite(model.tokenWeight)||model.tokenWeight<0||typeof model.allowFree!=='boolean'||
      typeof model.health!=='string'||model.health.length>40)
      fail('INVALID_DESIGN_CATALOG_RESPONSE','Media catalog contains invalid or duplicate model metadata');
    seen.add(model.id);
  }
  return value.models;
}
async function boundedBody(response,signal){
  const length=Number(response.headers?.get('content-length'));
  if(Number.isFinite(length)&&length>MAX_BODY){await response.body?.cancel();fail('DESIGN_CATALOG_TOO_LARGE','Media catalog exceeds64KiB');}
  const reader=response.body?.getReader();
  if(!reader)fail('INVALID_DESIGN_CATALOG_RESPONSE','Media catalog body is unavailable');
  let size=0;const chunks=[];
  const cancel=()=>{void reader.cancel().catch(()=>{});};
  signal.addEventListener('abort',cancel,{once:true});
  try{
    while(true){
      if(signal.aborted)fail('DESIGN_CATALOG_ABORTED','Media catalog read was cancelled');
      const {done,value}=await reader.read();
      if(signal.aborted)fail('DESIGN_CATALOG_ABORTED','Media catalog read was cancelled');
      if(done)break;
      size+=value.byteLength;
      if(size>MAX_BODY){await reader.cancel();fail('DESIGN_CATALOG_TOO_LARGE','Media catalog exceeds64KiB');}
      chunks.push(value);
    }
  }finally{signal.removeEventListener('abort',cancel);reader.releaseLock();}
  return Buffer.concat(chunks);
}

/** Public GET only. It never sends credentials, changes plans, or generates an image. */
export async function auditDesignCatalog({fetchImpl=fetch,signal,timeoutMs=20000}={}){
  if(!Number.isInteger(timeoutMs)||timeoutMs<1||timeoutMs>30000)
    fail('INVALID_DESIGN_CATALOG_LIMIT','Catalog timeout must be1..30000ms');
  const combined=signal?AbortSignal.any([signal,AbortSignal.timeout(timeoutMs)]):AbortSignal.timeout(timeoutMs);
  if(combined.aborted)fail('DESIGN_CATALOG_ABORTED','Media catalog audit was cancelled');
  let response;
  try{response=await fetchImpl(CATALOG_URL,{method:'GET',redirect:'error',headers:{Accept:'application/json'},signal:combined});}
  catch{fail(combined.aborted?'DESIGN_CATALOG_ABORTED':'DESIGN_CATALOG_UNAVAILABLE','Public image catalog could not be read');}
  if(!response.ok){await response.body?.cancel();fail('DESIGN_CATALOG_HTTP','Public image catalog returnedHTTP'+response.status,{status:response.status});}
  const raw=await boundedBody(response,combined);let value;
  try{value=JSON.parse(raw.toString('utf8'));}catch{fail('INVALID_DESIGN_CATALOG_RESPONSE','Media catalog returned invalidJSON');}
  const current=parseCatalog(value),entries=new Map(current.map(model=>[model.id,model]));
  const models=DESIGN_CATALOG.map(model=>{
    const live=entries.get(model.id);let code=null;
    if(!live)code='DESIGN_MODEL_MISSING';
    else if(live.category!==model.provider)code='DESIGN_MODEL_IDENTITY_CHANGED';
    else if(live.priceTokens>model.priceMicroUsd)code='DESIGN_PRICE_INCREASED';
    else if(model.billingTier==='free-allowance'&&(live.priceTokens!==0||live.baseTokens!==model.allowanceTokens||live.allowFree!==model.publishedMetadata.allowFree||live.tokenWeight!==model.publishedMetadata.tokenWeight))code='DESIGN_ALLOWANCE_CHANGED';
    else if(model.billingTier==='paid'&&(live.allowFree!==model.publishedMetadata.allowFree||live.tokenWeight!==model.publishedMetadata.tokenWeight||live.baseTokens!==model.publishedMetadata.baseTokens))code='DESIGN_BILLING_TERMS_CHANGED';
    else if(live.health!=='live')code='DESIGN_MODEL_NOT_LIVE';
    return {id:model.id,ready:code===null,code,priceUsd:live?live.priceTokens/1e6:null,
      reserveUsd:model.reserveUsd,allowanceTokens:model.allowanceTokens,subscriptionRequired:model.subscriptionRequired};
  });
  const blocked=models.filter(model=>!model.ready).map(({id,code})=>({id,code}));
  return {ok:blocked.length===0,checkedAt:new Date().toISOString(),sourceURL:CATALOG_URL,
    hash:createHash('sha256').update(raw).digest('hex'),models,
    readyIds:models.filter(model=>model.ready).map(model=>model.id),blocked,
    unknownIds:current.filter(model=>!ids.has(model.id)).map(model=>model.id)};
}
