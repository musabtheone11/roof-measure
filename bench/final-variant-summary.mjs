// Three-column comparison using one shared metrics implementation and the original frozen split.
// node bench/final-variant-summary.mjs .devcache/paired-3000
import fs from'node:fs';import path from'node:path';import crypto from'node:crypto';import assert from'node:assert/strict';import{spawnSync}from'node:child_process';
const root=path.resolve(import.meta.dirname,'..'),dir=path.resolve(process.argv[2]||'.devcache/paired-3000');
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
const finalMeta=JSON.parse(fs.readFileSync(path.join(dir,'final-variant.json'))),run=JSON.parse(fs.readFileSync(path.join(dir,'final-run.json')));
assert.equal(run.attempts,3000);assert.equal(run.frozenHashesUnchangedAtFinish,true);
for(const[f,h]of Object.entries(run.files))assert.equal(hash(fs.readFileSync(path.join(dir,f))),h,'Final output hash changed');
for(const [label,baseline]of[['baseline','baseline'],['prior','current']]){
 const out=`summary-final-vs-${label}.json`;
 const res=spawnSync(process.execPath,[path.join(root,'bench/paired-summary.mjs'),dir,'--baseline-label',baseline,'--baseline-suffix','precision','--current-label','final-current','--current-suffix','none','--out',out],{cwd:root,encoding:'utf8',maxBuffer:8*1024*1024});
 if(res.status!==0)throw new Error(res.stderr||res.stdout||'Final comparison failed');
}
const original=JSON.parse(fs.readFileSync(path.join(dir,'summary-precision.json'))),baseline=JSON.parse(fs.readFileSync(path.join(dir,'summary-final-vs-baseline.json'))),prior=JSON.parse(fs.readFileSync(path.join(dir,'summary-final-vs-prior.json')));
assert.deepStrictEqual(baseline.all.current,prior.all.current,'Final metrics differ between paired comparisons');
const columns=(old,now)=>({baseline:old.baseline,priorGuard:old.current,finalGuard:now.current});
const report={generatedAt:new Date().toISOString(),validationStatus:finalMeta.validationStatus,notUntouchedBlindHoldout:true,manifestSHA256:original.manifestSHA256,thresholds:baseline.thresholds,scope:baseline.scope,accuracyNote:baseline.accuracyNote,falseCompleteExports:null,falseCompleteNote:baseline.falseCompleteNote,finalEngineHashes:finalMeta.engineHashes,priorEngineHashes:original.frozenEngineHashes,finalRun:run,all:columns(original.all,baseline.all),splits:Object.fromEntries(['development','holdout'].map(s=>[s,columns(original.splits[s],baseline.splits[s])])),pairedComparisons:{baselineVsFinal:baseline.splits,priorGuardVsFinal:prior.splits},inventory:{prior:original.inventory,final:baseline.inventory},originalMeasurementsPreserved:true};
fs.writeFileSync(path.join(dir,'summary-three-variants.json'),JSON.stringify(report,null,2));
console.log(JSON.stringify({all:report.all,splits:report.splits},null,2));
