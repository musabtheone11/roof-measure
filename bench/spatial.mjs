// Spatial accuracy in the fixed source coordinate frame. Equal area alone is insufficient.
import pc from 'polygon-clipping';
const ringArea = ring => Math.abs(ring.reduce((a,p,i)=>{const q=ring[(i+1)%ring.length];return a+p[0]*q[1]-q[0]*p[1];},0)/2);
const area = multi => multi.reduce((s,poly)=>s+ringArea(poly[0])-poly.slice(1).reduce((a,r)=>a+ringArea(r),0),0);
export function spatialScore(gtFacets, engineFacets) {
 const truth=pc.union(...gtFacets.map(f=>f.poly));
 const found=engineFacets.length?pc.union(...engineFacets.map(f=>[f.poly])):[];
 const ga=area(truth),ea=area(found),overlap=found.length?area(pc.intersection(truth,found)):0;
 const union=ga+ea-overlap;
 return {outlineIoU:union?overlap/union:null,missingPlanSqft:Math.max(0,ga-overlap)*10.7639104,extraPlanSqft:Math.max(0,ea-overlap)*10.7639104,truthPlanSqft:ga*10.7639104,engineUnionPlanSqft:ea*10.7639104};
}
