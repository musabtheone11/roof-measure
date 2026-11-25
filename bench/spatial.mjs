// Spatial accuracy in the fixed source coordinate frame. Equal area alone is insufficient.
import pc from 'polygon-clipping';
import fs from 'node:fs';
import path from 'node:path';
const ringArea = ring => Math.abs(ring.reduce((a,p,i)=>{const q=ring[(i+1)%ring.length];return a+p[0]*q[1]-q[0]*p[1];},0)/2);
const area = multi => multi.reduce((s,poly)=>s+ringArea(poly[0])-poly.slice(1).reduce((a,r)=>a+ringArea(r),0),0);
export function spatialScore(gtFacets, engineFacets, options = {}) {
 const rawTruth=gtFacets.map(f=>f.poly),rawEngine=engineFacets.map(f=>f.poly);
 if(process.env.BENCH_SPATIAL_CACHE_DIR && options.seed != null){
   const dir=path.resolve(process.env.BENCH_SPATIAL_CACHE_DIR);fs.mkdirSync(dir,{recursive:true});
   const label=String(process.env.BENCH_SPATIAL_CACHE_LABEL||'case').replace(/[^a-zA-Z0-9_-]/g,'_');
   const file=path.join(dir,`${label}-${options.seed}.json`);
   if(!fs.existsSync(file))fs.writeFileSync(file,JSON.stringify({seed:options.seed,units:'metres',truthPolygons:rawTruth,enginePolygons:rawEngine}));
 }
 // Synthetic coordinates are metres. One micrometre is five orders below the
 // 10 cm DSM pixel; this fixed scoring precision suppresses floating point sliver
 // rings without changing saved traces, fitting or source registration.
 const precision=options.precision == null?1e-6:options.precision;
 if(!(Number.isFinite(precision)&&precision>0))throw new Error('Invalid spatial scoring precision');
 const point=p=>p.map(v=>Math.round(v/precision)*precision);
 const truth=pc.union(...rawTruth.map(poly=>poly.map(r=>r.map(point))));
 const found=rawEngine.length?pc.union(...rawEngine.map(r=>[r.map(point)])):[];
 const ga=area(truth),ea=area(found);
 // Inclusion/exclusion is the same intersection-area metric. polygon-clipping's
 // intersection operation can recurse indefinitely on coincident output rings.
 // The identity also avoids its intersection-specific failure; no alignment is applied.
 const union=area(found.length?pc.union(truth,found):truth);
 let overlap=ga+ea-union;
 const tolerance=1e-8*Math.max(ga,ea,1),maximum=Math.min(ga,ea);
 if (![ga,ea,union,overlap].every(Number.isFinite)||ga<0||ea<0||overlap < -tolerance||overlap>maximum+tolerance)
   throw new Error('Spatial area identity produced an invalid intersection area');
 overlap=Math.max(0,Math.min(maximum,overlap));
 return {spatialPrecisionM:precision,outlineIoU:union?overlap/union:null,missingPlanSqft:Math.max(0,ga-overlap)*10.7639104,extraPlanSqft:Math.max(0,ea-overlap)*10.7639104,truthPlanSqft:ga*10.7639104,engineUnionPlanSqft:ea*10.7639104};
}
