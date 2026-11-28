import {createHash} from 'node:crypto';
import {MODEL_CATALOG} from './model-catalog.mjs';
import {DESIGN_CATALOG} from './design-catalog.mjs';

const hash=value=>createHash('sha256').update(value).digest('hex');
const fail=(code,message)=>{throw Object.assign(new Error(message),{code});};

// Old currency rows remain immutable. Import a separate conservative allowance
// hold before any new subscription-funded dispatch can use the shared store.
export function reconcileLegacyFreeAllowance(store,{catalog=MODEL_CATALOG,designCatalog=DESIGN_CATALOG}={}) {
  const entries=new Map([...catalog,...designCatalog].map(row=>[row.id,row]));
  const ledger=store.ledger(),native=new Set(store.allowanceLedger().attempts.map(row=>row.attempt_id));
  const events=store.events(),dispatched=new Set(events.filter(e=>e.kind==='dispatched').map(e=>e.detail?.attemptId));
  const models=new Map();
  for(const event of events) {
    if(!event.kind.endsWith('-dispatched')&&!event.kind.endsWith('-ambiguous-billing'))continue;
    const taskId=event.task_id||event.taskId||event.detail?.taskId,model=event.detail?.model;
    if(!taskId||typeof model!=='string')continue;
    if(!models.has(taskId))models.set(taskId,new Set());models.get(taskId).add(model);
  }
  const pending=[];
  for(const attempt of ledger.attempts) {
    if(native.has(attempt.id)||!dispatched.has(attempt.id))continue;
    const task=store.getTask(attempt.task_id),named=models.get(attempt.task_id);
    let model;
    if(named?.size===1)model=[...named][0];
    else if(named?.size>1)fail('ALLOWANCE_LEGACY_MAPPING_REQUIRED','Historic task has conflicting model dispatch identities');
    else {
      // Actor IDs are trusted queue metadata; this also covers a crash between
      // the generic dispatch marker and its model-specific audit event.
      const matches=[...entries.keys()].filter(id=>task?.actorId==='fleet-'+hash(id).slice(0,24)||task?.actorId==='design-'+hash(id).slice(0,24));
      if(matches.length===1)model=matches[0];
    }
    if(!model) {
      if(attempt.reserve_usd===0)fail('ALLOWANCE_LEGACY_MAPPING_REQUIRED','A zero-dollar historic dispatch lacks a verified model identity');
      continue;
    }
    const entry=entries.get(model);
    if(!entry) {
      if(model.startsWith('free/')||attempt.reserve_usd===0)fail('ALLOWANCE_LEGACY_MAPPING_REQUIRED','A historic zero-dollar model lacks verified allowance metadata');
      continue;
    }
    if(entry.billingTier!=='free-allowance')continue;
    if(!model.startsWith('free/'))fail('ALLOWANCE_LEGACY_MAPPING_REQUIRED','Free allowance requires an exact free-prefixed model');
    let units;
    if(entry.allowanceTokens)units=entry.allowanceTokens;
    else {
      let oldWeight=0,oldTokens=0,oldOutput=0;
      const resultHash=task?.result?.resultHash||task?.result?.rawResponseHash;
      if(resultHash) {
        const original=JSON.parse(store.readArtifact(resultHash)),execution=original.execution;
        if(execution?.requestedModel&&execution.requestedModel!==model)fail('ALLOWANCE_LEGACY_MAPPING_REQUIRED','Historic response identity conflicts with its dispatch');
        if(Number.isSafeInteger(execution?.allowanceWeight))oldWeight=execution.allowanceWeight;
        if(Number.isSafeInteger(execution?.usage?.totalTokens))oldTokens=execution.usage.totalTokens;
        oldOutput=Math.max(0,...['completionTokens','outputTokens'].map(key=>Number.isSafeInteger(execution?.usage?.[key])?execution.usage[key]:0));
      }
      const weight=Math.max(entry.allowanceWeight||0,oldWeight),output=Math.max(task?.constraints?.maxOutputTokens??2000,oldOutput);
      units=Math.max(entry.contextTokens+Math.max(entry.contextTokens,output),oldTokens)*weight;
      if(entry.inputPerMillion!==0||entry.outputPerMillion!==0||weight<1)fail('ALLOWANCE_LEGACY_MAPPING_REQUIRED','Historic free text pricing or weight is unverified');
    }
    if(!Number.isSafeInteger(units)||units<1)fail('ALLOWANCE_LEGACY_MAPPING_REQUIRED','Historic allowance hold is invalid');
    pending.push({attemptId:attempt.id,model,reservedUnits:units,evidence:{kind:'verified-catalog-and-durable-dispatch-v1',taskId:attempt.task_id}});
  }
  // Resolve every candidate first. A mapping error cannot silently import only
  // the easy rows and admit new work against an incomplete historic balance.
  for(const input of pending)store.backfillLegacyAllowance(input);
  return {backfilled:pending.length,source:'durable-dispatch-and-verified-catalog',ledger:store.allowanceLedger()};
}
