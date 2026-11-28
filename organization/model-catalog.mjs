import snapshot from './model-catalog.json' with {type:'json'};

function freeze(value) {
  if(value&&typeof value==='object') {for(const item of Object.values(value))freeze(item);Object.freeze(value);}
  return value;
}
if(snapshot.schemaVersion!==1||!Array.isArray(snapshot.models)||snapshot.models.length!==snapshot.modelCount)
  throw new Error('Verified model catalog failed its version/count contract');
const seen=new Set();
for(const record of snapshot.models) {
  if(typeof record.id!=='string'||!record.id||seen.has(record.id)||!Number.isInteger(record.contextTokens)||record.contextTokens<128||
    ![record.inputPerMillion,record.outputPerMillion].every(v=>Number.isFinite(v)&&v>=0)||
    record.pricingStatus!=='verified-published'||!['paid','free-allowance'].includes(record.billingTier)||
    (record.billingTier==='free-allowance'&&(!Number.isInteger(record.allowanceWeight)||record.allowanceWeight<1||record.inputPerMillion!==0||record.outputPerMillion!==0)))
    throw new Error('Invalid verified catalog entry');
  seen.add(record.id);
}
export const MODEL_CATALOG=freeze(snapshot.models);
export const MODEL_BY_ID=Object.freeze(Object.fromEntries(MODEL_CATALOG.map(record=>[record.id,record])));
export const CATALOG_METADATA=freeze(Object.fromEntries(Object.entries(snapshot).filter(([key])=>key!=='models')));
export function getModelCatalogEntry(id) {return Object.hasOwn(MODEL_BY_ID,id)?MODEL_BY_ID[id]:null;}
export function getVerifiedModelPrice(id) {
  const model=getModelCatalogEntry(id);
  if(!model)return null;
  return Object.freeze({contextTokens:model.contextTokens,inputPerMillion:model.inputPerMillion,outputPerMillion:model.outputPerMillion,
    maxRate:Math.max(model.inputPerMillion,model.outputPerMillion),billingTier:model.billingTier,allowanceWeight:model.allowanceWeight,
    checkedAt:CATALOG_METADATA.checkedAt,sources:model.sources});
}
