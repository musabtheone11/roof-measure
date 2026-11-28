import test from 'node:test';
import assert from 'node:assert/strict';
import {MODEL_CATALOG,MODEL_BY_ID,CATALOG_METADATA,getModelCatalogEntry,getVerifiedModelPrice,textAllowanceReservationUnits} from './model-catalog.mjs';
test('catalog represents every exact verified active model with conservative published pricing',()=>{
  assert.equal(MODEL_CATALOG.length,45);assert.equal(new Set(MODEL_CATALOG.map(m=>m.id)).size,45);
  assert.equal(MODEL_CATALOG.filter(m=>m.billingTier==='paid').length,22);
  assert.equal(MODEL_CATALOG.filter(m=>m.billingTier==='free-allowance').length,23);
  for(const m of MODEL_CATALOG) {
    const p=getVerifiedModelPrice(m.id);assert.equal(MODEL_BY_ID[m.id],m);assert.ok(p.contextTokens>=128);
    assert.equal(p.maxRate,Math.max(m.publishedRates.publicInputPerMillion,m.publishedRates.publicOutputPerMillion,m.publishedRates.datasheetInputPerMillion,m.publishedRates.datasheetOutputPerMillion));
    assert.match(m.sources.datasheetSha256,/^[a-f0-9]{64}$/);assert.ok(m.sources.datasheetURL.startsWith('https://apinex.bond/models/'));
  }
  assert.equal(getModelCatalogEntry('nonexistent'),null);assert.equal(getVerifiedModelPrice('nonexistent'),null);
  assert.throws(()=>MODEL_CATALOG.push({}));assert.throws(()=>{MODEL_BY_ID['gpt-6.2-astra'].inputPerMillion=0;});
  assert.ok(Date.parse(CATALOG_METADATA.checkedAt));
});
test('free allowance, subscription flags, alias and modality limitations remain explicit',()=>{
  const free=getModelCatalogEntry('free/glm-5.3');assert.equal(free.capabilities.visionClaim,false);assert.equal(free.allowanceWeight,4);
  assert.equal(getModelCatalogEntry('free/claude-opus-4.6').requiresSubscription,true);
  assert.ok(getModelCatalogEntry('free/hy4-flash').tags.includes('fallback-alias'));
  assert.equal(getModelCatalogEntry('free/minimax-m3').health,'partial');
  assert.equal(getVerifiedModelPrice('free/gpt-6-luna').maxRate,0);
  assert.equal(getVerifiedModelPrice('gpt-6-luna').maxRate,.075);
  assert.equal(getVerifiedModelPrice('gpt-6.2-astra').maxRate,.5); // discount does not reduce conservative hold
  assert.equal(getModelCatalogEntry('drex-v2.0').routeClaim,'decisions');
  assert.equal(getModelCatalogEntry('free/drex-v2.0').routeClaim,'chat-completions');
});
test('weighted reservation covers complete input and output windows when providers exceed requested output',()=>{
  assert.equal(textAllowanceReservationUnits('free/gpt-6-luna',2000),2*1048576*3);
  assert.equal(textAllowanceReservationUnits('free/gpt-6-luna',4096),textAllowanceReservationUnits('free/gpt-6-luna',2000));
  assert.equal(textAllowanceReservationUnits('free/gpt-6-luna',2*1048576),3*1048576*3);
  for(const id of ['gpt-6.2-astra','unknown'])assert.throws(()=>textAllowanceReservationUnits(id),{code:'ALLOWANCE_MODEL_UNVERIFIED'});
});
