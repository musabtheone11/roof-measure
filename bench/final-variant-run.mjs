// Run a frozen final reconstruction variant once on every seed from an earlier manifest.
// Batches permit an explicitly coordinated worker budget without changing engine settings.
// node bench/final-variant-run.mjs .devcache/paired-3000
import fs from 'node:fs';import path from'node:path';import crypto from'node:crypto';import assert from'node:assert/strict';import{spawn}from'node:child_process';
const root=path.resolve(import.meta.dirname,'..'),dir=path.resolve(process.argv[2]||'.devcache/paired-3000');
const meta=JSON.parse(fs.readFileSync(path.join(dir,'final-variant.json'))),manifest=JSON.parse(fs.readFileSync(path.join(dir,'manifest.json')));
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
const verify=()=>{for(const[f,h]of Object.entries(meta.engineHashes))assert.equal(hash(fs.readFileSync(path.join(meta.sourceEngineDirectory,f))),h,'Frozen final engine changed: '+f);for(const[f,h]of Object.entries(meta.runnerHashes))assert.equal(hash(fs.readFileSync(path.join(root,f))),h,'Frozen runner changed: '+f);assert.equal(hash(fs.readFileSync(path.join(dir,'manifest.json'))),meta.originalManifestSHA256,'Original manifest changed');};
verify();assert.deepStrictEqual([...manifest.cases.map(c=>c.seed)].sort((a,b)=>a-b),[...meta.allSeeds].sort((a,b)=>a-b));
const batches=path.join(dir,'final-batches');fs.mkdirSync(batches,{recursive:true});
if(fs.readdirSync(batches).some(f=>f.endsWith('.jsonl')))throw new Error('Final batch results already exist; refusing to overwrite frozen measurements');
const record={startedAt:new Date().toISOString(),engineHashes:meta.engineHashes,runnerHashes:meta.runnerHashes,priorAggregateResultsKnown:true,notUntouchedBlindHoldout:true,batches:[]};
for(let at=0;at<meta.allSeeds.length;at+=500){
 verify();const seeds=meta.allSeeds.slice(at,at+500),tag=String(at/500+1).padStart(2,'0'),list=path.join(batches,tag+'-seeds.json'),output=path.join(batches,tag+'.jsonl');fs.writeFileSync(list,JSON.stringify(seeds));
 const budget=JSON.parse(fs.readFileSync(path.join(dir,'final-worker-budget.json')));const workers=Math.max(1,Math.min(8,Math.floor(+budget.workers)||1));
 console.log(`Final batch ${tag}: ${seeds.length} seeds, ${workers} workers`);const started=Date.now();
 await new Promise((resolve,reject)=>{const child=spawn(process.execPath,[path.join(root,'bench/run.mjs'),'--n',String(seeds.length),'--workers',String(workers),'--exact','--list',list,'--engine',meta.sourceEngineDirectory,'--out',output],{cwd:root,env:{...process.env,BENCH_SPATIAL_CACHE_DIR:path.join(dir,'final-spatial-inputs'),BENCH_SPATIAL_CACHE_LABEL:'final-current'}});child.stdout.on('data',b=>process.stdout.write(b));child.stderr.on('data',b=>process.stderr.write(b));child.on('error',reject);child.on('exit',code=>code===0?resolve():reject(new Error('Final batch '+tag+' failed: '+code)));});
 verify();const rows=fs.readFileSync(output,'utf8').trim().split('\n').map(JSON.parse);assert.equal(rows.length,seeds.length);assert.deepStrictEqual(rows.map(r=>r.seed).sort((a,b)=>a-b),[...seeds].sort((a,b)=>a-b));record.batches.push({tag,attempts:rows.length,workers,seconds:(Date.now()-started)/1000,sha256:hash(fs.readFileSync(output))});fs.writeFileSync(path.join(dir,'final-run-progress.json'),JSON.stringify(record,null,2));
}
const rows=record.batches.flatMap(b=>fs.readFileSync(path.join(batches,b.tag+'.jsonl'),'utf8').trim().split('\n').map(JSON.parse)),bySeed=new Map(rows.map(r=>[r.seed,r]));assert.equal(bySeed.size,meta.allSeeds.length);
fs.writeFileSync(path.join(dir,'final-current-all.jsonl'),rows.map(r=>JSON.stringify(r)).join('\n')+'\n');
for(const split of['development','holdout']){const subset=manifest.cases.filter(c=>c.split===split).map(c=>bySeed.get(c.seed));assert(subset.every(Boolean));fs.writeFileSync(path.join(dir,`final-current-${split}.jsonl`),subset.map(r=>JSON.stringify(r)).join('\n')+'\n');}
record.finishedAt=new Date().toISOString();record.attempts=rows.length;record.files=Object.fromEntries(['all','development','holdout'].map(s=>{const f=`final-current-${s}.jsonl`;return[f,hash(fs.readFileSync(path.join(dir,f)))];}));verify();record.frozenHashesUnchangedAtFinish=true;fs.writeFileSync(path.join(dir,'final-run.json'),JSON.stringify(record,null,2));console.log('Final variant complete: '+rows.length+' attempts, frozen hashes unchanged');
