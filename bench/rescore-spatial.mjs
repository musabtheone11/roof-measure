// Repeat only previously unscored spatial cases with the frozen engines. Raw results
// remain unchanged; every non-spatial measurement must reproduce exactly.
// node bench/rescore-spatial.mjs .devcache/paired-3000 --baseline /tmp/roof-public-baseline [--workers 4]
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
const root=path.resolve(import.meta.dirname,'..');
const dir=path.resolve(process.argv[2]||'.devcache/paired-3000');
const arg=(k,d)=>{const i=process.argv.indexOf('--'+k);return i<0?d:process.argv[i+1];};
const inputSuffix=arg('input-suffix',''),outputSuffix=arg('output-suffix','rescored');
for(const s of[inputSuffix,outputSuffix])if(!/^[a-zA-Z0-9_-]*$/.test(s))throw new Error('Invalid rescore suffix');
const inputFile=(v,s)=>`${v}-${s}${inputSuffix?'-'+inputSuffix:''}.jsonl`;
const auditName='spatial-rescore'+(outputSuffix==='rescored'?'':'-'+outputSuffix);
if(fs.existsSync(path.join(dir,auditName+'-start.json'))||['baseline','current'].some(v=>['development','holdout'].some(s=>fs.existsSync(path.join(dir,`${v}-${s}-${outputSuffix}.jsonl`)))))throw new Error('Rescore output already exists; choose a new output suffix to preserve the audit.');
const workers=Math.max(1,Math.min(4,Math.floor(+arg('workers',4))||1));
const manifest=JSON.parse(fs.readFileSync(path.join(dir,'manifest.json')));
const engines={baseline:path.resolve(arg('baseline','/tmp/roof-public-baseline')),current:path.resolve(arg('current',path.join(dir,'current-engine')))};
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
const parse=f=>fs.readFileSync(f,'utf8').trim().split('\n').filter(Boolean).map(s=>JSON.parse(s));
const spatialKeys=['spatialNotScored','outlineIoU','missingPlanSqft','extraPlanSqft','truthPlanSqft','engineUnionPlanSqft','spatialPrecisionM','spatialRescored'];
const numeric=r=>Object.fromEntries(Object.entries(r).filter(([k])=>k!=='ms'&&!spatialKeys.includes(k)));
const originals={},originalHashes={},groups={};
for(const v of['baseline','current']){
 for(const[f,h]of Object.entries(manifest.versions[v]))assert.equal(hash(fs.readFileSync(path.join(engines[v],f))),h,'Frozen engine changed: '+v+'/'+f);
 groups[v]=[];
 for(const split of['development','holdout']){
  const file=path.join(dir,inputFile(v,split)),rows=parse(file);
  assert.equal(rows.length,manifest.cases.filter(c=>c.split===split).length,'Partial original results');
  originals[v+'-'+split]=rows;originalHashes[path.basename(file)]=hash(fs.readFileSync(file));groups[v].push(...rows.filter(r=>r.spatialNotScored).map(r=>r.seed));
 }
 fs.writeFileSync(path.join(dir,v+'-spatial-retry-'+outputSuffix+'-seeds.json'),JSON.stringify(groups[v]));
}
const metadata={startedAt:new Date().toISOString(),method:'Intersection area = A + B - union(A,B); fixed 1 micrometre scoring precision on source and engine coordinates, no source trace mutation or alignment.',inputSuffix,outputSuffix,spatialPrecisionM:1e-6,precisionRationale:'Five orders below the 0.1 metre synthetic DSM pixel; selected before trial outcomes.',originalHashes,frozenEngineHashes:manifest.versions,repeatedByVersion:Object.fromEntries(Object.entries(groups).map(([v,seeds])=>[v,seeds.length])),workersPerVersion:workers};
fs.writeFileSync(path.join(dir,auditName+'-start.json'),JSON.stringify(metadata,null,2));
await Promise.all(['baseline','current'].map(v=>new Promise((resolve,reject)=>{
 if(!groups[v].length)return resolve();
 const output=path.join(dir,v+'-spatial-retry-'+outputSuffix+'.jsonl');
 const child=spawn(process.execPath,[path.join(root,'bench/run.mjs'),'--n',String(groups[v].length),'--workers',String(workers),'--exact','--list',path.join(dir,v+'-spatial-retry-'+outputSuffix+'-seeds.json'),'--engine',engines[v],'--out',output],{cwd:root,env:{...process.env,BENCH_SPATIAL_CACHE_DIR:path.join(dir,'spatial-inputs'),BENCH_SPATIAL_CACHE_LABEL:v}});
 child.stdout.on('data',b=>process.stdout.write(v+': '+b));child.stderr.on('data',b=>process.stderr.write(v+': '+b));
 child.on('error',reject);child.on('exit',code=>code===0?resolve():reject(new Error(v+' rescore exited '+code)));
})));
const results={};
for(const v of['baseline','current']){
 const retried=groups[v].length?parse(path.join(dir,v+'-spatial-retry-'+outputSuffix+'.jsonl')):[];
 assert.equal(retried.length,groups[v].length,'Incomplete retry');const bySeed=new Map(retried.map(r=>[r.seed,r]));assert.equal(bySeed.size,retried.length,'Duplicate retry seed');
 let recovered=0,stillUnscored=0;
 for(const split of['development','holdout']){
  const old=originals[v+'-'+split];
  const revised=old.map(r=>{
   if(!r.spatialNotScored)return r;
   const fresh=bySeed.get(r.seed);assert.ok(fresh,'Missing retry '+r.seed);assert.deepStrictEqual(numeric(fresh),numeric(r),'Nonspatial measurements changed seed '+r.seed);
   const out={...r};for(const k of spatialKeys)delete out[k];for(const k of spatialKeys)if(k in fresh)out[k]=fresh[k];out.spatialRescored=true;
   if(fresh.spatialNotScored)stillUnscored++;else recovered++;
   return out;
  });
  fs.writeFileSync(path.join(dir,`${v}-${split}-${outputSuffix}.jsonl`),revised.map(r=>JSON.stringify(r)).join('\n')+'\n');
 }
 results[v]={repeated:retried.length,recovered,stillUnscored,nonSpatialMeasurementsUnchanged:true};
}
for(const[f,h]of Object.entries(originalHashes))assert.equal(hash(fs.readFileSync(path.join(dir,f))),h,'Original output changed');
for(const v of['baseline','current'])for(const[f,h]of Object.entries(manifest.versions[v]))assert.equal(hash(fs.readFileSync(path.join(engines[v],f))),h,'Frozen engine changed during rescore');
metadata.frozenEngineHashesUnchangedAtFinish=true;metadata.cachedPolygonInputsDirectory=path.join(dir,'spatial-inputs');
metadata.finishedAt=new Date().toISOString();metadata.results=results;metadata.rescoredHashes=Object.fromEntries(['baseline','current'].flatMap(v=>['development','holdout'].map(s=>{const f=`${v}-${s}-${outputSuffix}.jsonl`;return[f,hash(fs.readFileSync(path.join(dir,f)))];})));
fs.writeFileSync(path.join(dir,auditName+'.json'),JSON.stringify(metadata,null,2));console.log(JSON.stringify(results,null,2));
