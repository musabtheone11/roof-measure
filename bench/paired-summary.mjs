// Aggregate a frozen paired synthetic benchmark. Refuses partial or unpaired inputs.
// node bench/paired-summary.mjs .devcache/paired-3000
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
const dir=path.resolve(process.argv[2]||'.devcache/paired-3000');
const arg=(k,d)=>{const i=process.argv.indexOf('--'+k);return i<0?d:process.argv[i+1];};
const rescored=process.argv.includes('--rescored'),precision=process.argv.includes('--precision');
const scoreSuffix=precision?'precision':rescored?'rescored':'';
const labels={baseline:arg('baseline-label','baseline'),current:arg('current-label','current')};
const suffixes={baseline:arg('baseline-suffix',scoreSuffix),current:arg('current-suffix',scoreSuffix)};
for(const[k,v]of Object.entries(suffixes))if(v==='none')suffixes[k]='';
for(const v of [...Object.values(labels),...Object.values(suffixes)])if(!/^[a-zA-Z0-9_-]*$/.test(v))throw new Error('Invalid result label/suffix');
const manifest=JSON.parse(fs.readFileSync(path.join(dir,'manifest.json')));
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
const thresholds={areaAbsPct:3,outlineIoU:.9,missingPlanPct:5,extraPlanPct:5,lineAbsoluteFt:5,lineRelativePct:10};
const median=a=>{const b=a.filter(Number.isFinite).sort((x,y)=>x-y);return b.length?(b[Math.floor((b.length-1)/2)]+b[Math.ceil((b.length-1)/2)])/2:null;};
const percentile=(a,p)=>{const b=a.filter(Number.isFinite).sort((x,y)=>x-y);return b.length?b[Math.min(b.length-1,Math.floor((b.length-1)*p))]:null;};
const types=['eave','rake','ridge','hip','valley','step','wall','transition','unspecified'];
const qualified=r=>!r.error&&!r.skipped;
const lineOK=(r,t)=>Number.isFinite(r['en_'+t])&&Number.isFinite(r['gt_'+t])&&Math.abs((r['en_'+t]||0)-(r['gt_'+t]||0))<=Math.max(thresholds.lineAbsoluteFt,thresholds.lineRelativePct/100*(r['gt_'+t]||0));
const missingPct=r=>r.truthPlanSqft>0?r.missingPlanSqft/r.truthPlanSqft*100:NaN;
const extraPct=r=>r.truthPlanSqft>0?r.extraPlanSqft/r.truthPlanSqft*100:NaN;
const spatialOK=r=>r.outlineIoU>=thresholds.outlineIoU&&missingPct(r)<=thresholds.missingPlanPct&&extraPct(r)<=thresholds.extraPlanPct;
const inventory={};
const sourceHashes=label=>label==='baseline'?manifest.versions.baseline:label==='current'?manifest.versions.current:label==='final-current'?JSON.parse(fs.readFileSync(path.join(dir,'final-variant.json'))).engineHashes:null;
const strata={singleWing:r=>r.wings===1,twoOrThreeWings:r=>r.wings>=2&&r.wings<=3,fourPlusWings:r=>r.wings>=4,multipleEaveLevels:r=>r.levels>1,hardImagery:r=>r.meta?.hard===true,easierImagery:r=>r.meta?.hard===false};
function read(version,split) {
 const file=path.join(dir,`${labels[version]}-${split}${suffixes[version]?'-'+suffixes[version]:''}.jsonl`),data=fs.readFileSync(file),rows=data.toString().trim().split('\n').filter(Boolean).map(s=>JSON.parse(s));
 const expected=manifest.cases.filter(c=>c.split===split).map(c=>c.seed),expectedSet=new Set(expected),seen=new Set();
 for(const row of rows){if(!expectedSet.has(row.seed)||seen.has(row.seed))throw new Error('Unexpected or duplicate seed in '+file+': '+row.seed);seen.add(row.seed);if(qualified(row)){const required=['gtSloped','enSloped','areaErrPct','facetsGT','facetsEN','pitchMatchPct',...types.flatMap(t=>['gt_'+t,'en_'+t])];if(required.some(k=>!Number.isFinite(row[k])))throw new Error('Unknown numeric quantity for seed '+row.seed+' in '+file);}}
 if(seen.size!==expected.length)throw new Error(`Incomplete ${file}: ${seen.size}/${expected.length}`);
 inventory[path.basename(file)]={attempts:rows.length,sha256:hash(data)};
 return new Map(rows.map(r=>[r.seed,r]));
}
function metrics(rows){
 const ok=rows.filter(qualified),spatial=ok.filter(r=>Number.isFinite(r.outlineIoU));
 const skipReasons={};for(const r of rows)if(r.skipped)skipReasons[r.skipped]=(skipReasons[r.skipped]||0)+1;
 return {attempts:rows.length,qualified:ok.length,skipped:rows.filter(r=>r.skipped).length,skipReasons,engineErrors:rows.filter(r=>r.error).length,spatialScored:spatial.length,spatialUnscored:ok.length-spatial.length,
  medianAbsoluteAreaErrorPct:median(ok.map(r=>Math.abs(r.areaErrPct))),p90AbsoluteAreaErrorPct:percentile(ok.map(r=>Math.abs(r.areaErrPct)),.9),medianSignedAreaErrorPct:median(ok.map(r=>r.areaErrPct)),areaWithin3Pct:ok.filter(r=>Math.abs(r.areaErrPct)<=3).length,
  medianOutlineIoU:median(spatial.map(r=>r.outlineIoU)),p10OutlineIoU:percentile(spatial.map(r=>r.outlineIoU),.1),medianMissingPlanPct:median(spatial.map(missingPct)),p90MissingPlanPct:percentile(spatial.map(missingPct),.9),medianExtraPlanPct:median(spatial.map(extraPct)),p90ExtraPlanPct:percentile(spatial.map(extraPct),.9),spatialWithinThresholds:spatial.filter(spatialOK).length,
  medianFacetCountAbsoluteError:median(ok.map(r=>Math.abs(r.facetsEN-r.facetsGT))),exactFacetCount:ok.filter(r=>r.facetsEN===r.facetsGT).length,medianPredominantPitchAbsoluteError:median(ok.map(r=>Math.abs(r.predEN-r.predGT))),medianPitchAreaMatchPct:median(ok.map(r=>r.pitchMatchPct)),
  roofsWithInferredFacets:ok.filter(r=>r.inferred>0).length,roofsWithUnresolvedFacets:ok.filter(r=>r.unresolved>0).length,roofsWithObstructionBoundary:ok.filter(r=>r.obstFt>.01).length,roofsWithHiddenZones:ok.filter(r=>r.zones>0).length,
  allLineTypesWithinThresholds:ok.filter(r=>types.every(t=>lineOK(r,t))).length,numericSpatialAndLineTypesWithinThresholds:spatial.filter(r=>Math.abs(r.areaErrPct)<=3&&spatialOK(r)&&types.every(t=>lineOK(r,t))).length,
  byLineType:Object.fromEntries(types.map(t=>{const positive=ok.filter(r=>r['gt_'+t]>0),zero=ok.filter(r=>!(r['gt_'+t]>0));return[t,{scored:ok.length,positiveReference:positive.length,zeroReference:zero.length,medianAbsoluteErrorFt:median(ok.map(r=>Math.abs((r['en_'+t]||0)-(r['gt_'+t]||0)))),medianAbsoluteErrorPctPositiveReference:median(positive.map(r=>Math.abs(r['en_'+t]-r['gt_'+t])/r['gt_'+t]*100)),withinThreshold:ok.filter(r=>lineOK(r,t)).length,spuriousWhenReferenceZero:zero.filter(r=>(r['en_'+t]||0)>5).length}]}))};
}
const splits={};const all={baseline:[],current:[]};
for(const split of['development','holdout']){
 const baseline=read('baseline',split),current=read('current',split);const paired=[];
 for(const[seed,b]of baseline){const c=current.get(seed);if(qualified(b)!==qualified(c)&&!b.error&&!c.error)throw new Error('Eligibility differs seed '+seed);if(qualified(b)&&qualified(c)){if(b.gtSloped!==c.gtSloped||b.facetsGT!==c.facetsGT)throw new Error('Ground truth differs seed '+seed);paired.push([b,c]);}}
 all.baseline.push(...baseline.values());all.current.push(...current.values());
 const commonSpatial=paired.filter(([b,c])=>Number.isFinite(b.outlineIoU)&&Number.isFinite(c.outlineIoU));
 splits[split]={baseline:metrics([...baseline.values()]),current:metrics([...current.values()]),pairedQualified:paired.length,pairedSpatialScored:commonSpatial.length,pairedSpatial:{baseline:metrics(commonSpatial.map(([b])=>b)),current:metrics(commonSpatial.map(([,c])=>c))},pairedAreaBetter:paired.filter(([b,c])=>Math.abs(c.areaErrPct)<Math.abs(b.areaErrPct)-1e-9).length,pairedAreaWorse:paired.filter(([b,c])=>Math.abs(c.areaErrPct)>Math.abs(b.areaErrPct)+1e-9).length,pairedOutlineBetter:paired.filter(([b,c])=>c.outlineIoU>b.outlineIoU+1e-9).length,pairedOutlineWorse:paired.filter(([b,c])=>c.outlineIoU<b.outlineIoU-1e-9).length};
}
const result={resultLabels:labels,resultSuffixes:suffixes,spatialRescored:rescored||precision,spatialPrecisionRecovery:precision,generatedAt:new Date().toISOString(),manifestSHA256:hash(fs.readFileSync(path.join(dir,'manifest.json'))),frozenEngineHashes:{baseline:sourceHashes(labels.baseline),current:sourceHashes(labels.current)},thresholds,settings:{exactFittedSlopeAndPlaneFactors:true,defaultPitch:6},scope:'Synthetic DSM reconstruction through the same traceBuildingV2 caller and settings for both versions. Not the address-selection, georeferencing, browser or PDF-export pipeline.',falseCompleteExports:null,falseCompleteNote:'Not evaluated: this benchmark generates no PDFs and does not execute the actual export gate. No claim of zero false COMPLETE exports.',accuracyNote:'Ground truth is analytic synthetic geometry. These results cannot establish real-property numerical accuracy. Numerical within-threshold counts include automatic estimates and are not measurement acceptance or export passes; unresolved measurements remain unresolved. Skips/errors/unscored values never count as passes.',splitDesign:manifest.familyRule,coverageNote:'Generator combines hip/gable rectangular wings, mixed pitches, eave levels, dormers, rotated roofs, DSM noise/blur and clutter. Arbitrary diagonal additions, parcel/address selection, alternate imagery registration and real property evidence require separate fixtures or real runs.',splits,all:{baseline:metrics(all.baseline),current:metrics(all.current)},strata:Object.fromEntries(Object.entries(strata).map(([name,test])=>[name,{baseline:metrics(all.baseline.filter(test)),current:metrics(all.current.filter(test))}])),inventory};
const out=arg('out',precision?'summary-precision.json':rescored?'summary-rescored.json':'summary.json');
if(path.basename(out)!==out)throw new Error('--out must be a basename within the result directory');
fs.writeFileSync(path.join(dir,out),JSON.stringify(result,null,2));console.log(JSON.stringify({all:result.all,splits:result.splits},null,2));
