import assert from 'node:assert/strict';
import test from 'node:test';
import{validatePolygon,validateProposal,measureProposal,compareProposals,transformPoint,invertAffine,cropToSource,analyzeRoofModel}from'./geometry.mjs';
const rect=(x,y,w,h)=>[[x,y],[x+w,y],[x+w,y+h],[x,y+h]];
const meta={width:100,height:100,view:'orthographic',calibration:{verified:true,start:[0,0],end:[10,0],lengthFt:10,source:'Field tape',date:'2026-11-25'}};
const pitch={rise:6,run:12,source:'Field pitch gauge',uncertainty:.2,status:'user-provided'};
const model={outline:rect(0,0,20,10),facets:[{id:'F1',polygon:rect(0,0,10,10),pitch},{id:'F2',polygon:rect(10,0,10,10),pitch}],edges:[{id:'E1',type:'eave',points:[[0,0],[20,0]]}]};
assert.equal(validateProposal(model,meta).ok,true);
assert.equal(validateProposal(model,meta).topology.sharedBoundaries[0].lengthPixels,10);
assert.equal(validatePolygon([[0,0],[10,10],[0,10],[10,0]]).ok,false);
assert.equal(validatePolygon([[0,0],[10,0],[0,0],[0,10]]).ok,false);
assert.equal(validatePolygon(rect(0,0,10,10)).polygon.length,5);
const gap=structuredClone(model);gap.facets[1].polygon=rect(11,0,9,10);assert(validateProposal(gap,meta).issues.some(i=>i.code==='gap'));
const overlap=structuredClone(model);overlap.facets[1].polygon=rect(9,0,11,10);assert(validateProposal(overlap,meta).issues.some(i=>i.code==='overlap'));
const measured=measureProposal(model,meta);assert(Math.abs(measured.projectedAreaM2-200*.3048**2)<1e-9);assert(Math.abs(measured.slopedAreaM2-200*.3048**2*Math.sqrt(1.25))<1e-9);assert.equal(measured.status,'REVIEW REQUIRED');
const unknown=structuredClone(model);delete unknown.facets[0].pitch;assert.equal(measureProposal(unknown,meta).slopedAreaM2,null);assert.equal(measureProposal(model,{...meta,view:'oblique'}).projectedAreaM2,null);assert.equal(measureProposal(model,{...meta,view:'unknown'}).projectedAreaM2,null);assert.equal(measureProposal(model,{width:100,height:100}).projectedAreaM2,null);
const same=compareProposals(model,model,meta);assert.equal(same.iou,1);assert.equal(same.boundaryDistancePixels.max,0);assert.equal(same.agreementIsNotIndependentEvidence,true);
const wrong={...model,outline:rect(40,0,20,10)};assert.equal(compareProposals(model,wrong,meta).iou,0);
const a=[2,.1,10,.2,-3,20],p=[7,9];const round=transformPoint(transformPoint(p,a),invertAffine(a));assert(Math.hypot(round[0]-p[0],round[1]-p[1])<1e-10);assert.deepEqual(cropToSource([20,30],{x:100,y:200,scaleX:2,scaleY:2}),[110,215]);
assert.throws(()=>invertAffine([1,2,0,2,4,0]),/Singular/);
const geographic=measureProposal(model,{...meta,calibration:null,georef:{verified:true,source:'Survey orthomosaic',date:'2026-11-25',crs:'EPSG:4326',affine:[.000001,0,-81,0,-.000001,30]}});assert(geographic.projectedAreaM2>0);
const canonical=analyzeRoofModel(model,meta,{revision:'r1'});assert.equal(canonical.model.revision,'r1');assert.deepEqual(canonical.model.originalProposal,model);
console.log('Runtime geometry: topology, independent comparison, calibration, projection, crop transforms, pitch and uncertainty checks pass');

assert(validateProposal(model,{...meta,targetPixel:[50,50]}).issues.some(x=>x.code==='target-mismatch'));
assert.equal(validateProposal(model,{...meta,targetPixel:[10,5]}).ok,true);
assert.equal(validateProposal(model,{...meta,targetPixel:[0,0]}).ok,true);
assert.equal(measureProposal(model,{...meta,calibration:{...meta.calibration,end:[Infinity,0]}}).projectedAreaM2,null);
assert.equal(measureProposal(model,{...meta,calibration:{...meta.calibration,end:[200,0]}}).projectedAreaM2,null);
assert.equal(measureProposal(model,{...meta,calibration:{...meta.calibration,lengthFt:Infinity}}).projectedAreaM2,null);

assert.equal(measureProposal(model,{...meta,calibration:null,georef:{verified:true,source:'Invalid',date:'2026-11-25',crs:'EPSG:4326',affine:[1,0,NaN,0,1,30]}}).projectedAreaM2,null);
assert.equal(measureProposal(model,{...meta,calibration:null,georef:{verified:true,source:'Invalid',date:'2026-11-25',crs:'EPSG:4326',affine:[1,0,-81,0,1,89]}}).projectedAreaM2,null);

assert.equal(measureProposal(null,meta).projectedAreaM2,null);
assert.equal(validateProposal({outline:rect(0,0,20,10),facets:[null]},meta).ok,false);
assert.equal(measureProposal({...model,edges:[null]},meta).edges[0].horizontalLengthM,null);
assert(validateProposal({...model,facets:Array.from({length:301},()=>model.facets[0])},meta).issues.some(x=>x.code==='geometry-budget'));

assert.deepEqual(cropToSource([20,30],{origin:[100,200],scale:2}),[110,215]);
assert.throws(()=>cropToSource([20,30],{origin:[100,200],scale:0}),/positive/);

const far=measureProposal(model,{...meta,calibration:null,georef:{verified:true,source:'Local survey',date:'2026-11-25',crs:'LOCAL_EN_METERS',affine:[1,0,1000000000,0,1,1000000000]}});assert.equal(far.projectedAreaM2,200,'large coordinate offsets do not cancel small roof areas');

const outOfBounds={...model,edges:[{id:'outside',type:'eave',points:[[1000,1000],[2000,1000]]}]};
assert.equal(validateProposal(outOfBounds,meta).ok,false);
assert.equal(measureProposal(outOfBounds,meta).edges[0].horizontalLengthM,null,'out-of-image line has no physical quantity');
assert.equal(measureProposal(outOfBounds,meta).projectedAreaM2,null,'invalid edge cannot leave overall validation approved');
const interiorEave={...model,edges:[{id:'not-eave',type:'eave',points:[[2,5],[8,5]]}]};assert(validateProposal(interiorEave,meta).issues.some(i=>i.code==='edge-boundary'));
const sharedRidge={...model,edges:[{id:'shared',type:'ridge',points:[[10,0],[10,10]]}]};assert.equal(validateProposal(sharedRidge,meta).ok,true);assert(Math.abs(measureProposal(sharedRidge,meta).edges[0].horizontalLengthM-3.048)<1e-10);
const exteriorRidge={...model,edges:[{id:'bad-ridge',type:'ridge',points:[[0,0],[20,0]]}]};assert(validateProposal(exteriorRidge,meta).issues.some(i=>i.code==='edge-shared-boundary'));
const duplicateIDs={...model,edges:[{id:'E1',type:'eave',points:[[0,0],[10,0]]},{id:'E1',type:'eave',points:[[10,0],[20,0]]}]};assert(validateProposal(duplicateIDs,meta).issues.some(i=>i.code==='duplicate-id'));
const duplicateLines={...model,edges:[{id:'E1',type:'eave',points:[[0,0],[20,0]]},{id:'E2',type:'eave',points:[[20,0],[0,0]]}]};assert(validateProposal(duplicateLines,meta).issues.some(i=>i.code==='duplicate-edge'));
const concave={outline:[[0,0],[10,0],[10,10],[6,10],[6,2],[4,2],[4,10],[0,10]],facets:[],edges:[{id:'chord',type:'unspecified',points:[[2,8],[8,8]]}]};assert(validateProposal(concave,meta).issues.some(i=>i.code==='edge-outside-roof'),'endpoints inside a concave roof do not validate an exterior chord');
const bent={outline:rect(0,0,20,10),facets:[{id:'F1',polygon:rect(0,0,20,10),pitch}],edges:[{id:'poly',type:'eave',points:[[0,0],[20,0],[20,10]]}]};assert.equal(validateProposal(bent,meta).ok,true);assert(Math.abs(measureProposal(bent,meta).edges[0].horizontalLengthM-30*.3048)<1e-9,'bent boundary length is its path, not its chord');
console.log('Runtime edge guards: image/roof bounds, shared topology, duplicate IDs/lines, concave escape and true path length pass');
const partialOverlap={...model,edges:[{id:'EA',type:'eave',points:[[0,0],[20,0]]},{id:'EB',type:'eave',points:[[10,0],[20,0]]}]};assert.equal(measureProposal(partialOverlap,meta).edges[0].horizontalLengthM,null);assert(validateProposal(partialOverlap,meta).issues.some(i=>i.code==='duplicate-edge'));
const retrace={...model,edges:[{id:'EA',type:'eave',points:[[0,0],[20,0],[10,0]]}]};assert(validateProposal(retrace,meta).issues.some(i=>i.code==='duplicate-edge'));
const endpointOnly={...model,edges:[{id:'EA',type:'eave',points:[[0,0],[10,0]]},{id:'EB',type:'eave',points:[[10,0],[20,0]]}]};assert.equal(validateProposal(endpointOnly,meta).ok,true);
const noFacets={outline:model.outline,facets:[],edges:[{id:'EA',type:'eave',points:[[0,0],[20,0]]}]};assert.equal(measureProposal(noFacets,meta).status,'REVIEW REQUIRED');assert(measureProposal(noFacets,meta).edges[0].horizontalLengthM>0);assert.equal(measureProposal({...noFacets,edges:[{id:'R',type:'ridge',points:[[10,0],[10,10]]}]},meta).edges[0].horizontalLengthM,null);
assert(validateProposal({...model,edges:[{id:model.facets[0].id,type:'eave',points:[[0,0],[20,0]]}]},meta).issues.some(i=>i.code==='duplicate-id'),'facets and edges use a shared ID namespace');
const perspective={...sharedRidge,measurementRestrictions:{perspective:true,reasons:['oblique roof']}};for(const p of[perspective,{...structuredClone(perspective),revision:'edited'}]){const m=measureProposal(p,meta);assert.equal(m.projectedAreaM2,null);assert.equal(m.slopedAreaM2,null);assert.equal(m.edges[0].horizontalLengthM,null);assert(m.issues.some(i=>i.code==='perspective-restriction'));}
// Independent WGS84 ECEF chord reference verifies the small Florida frame.
const ecef=([lon,lat])=>{const rad=Math.PI/180,p=lat*rad,l=lon*rad,e2=.00669437999014,n=6378137/Math.sqrt(1-e2*Math.sin(p)**2);return[n*Math.cos(p)*Math.cos(l),n*Math.cos(p)*Math.sin(l),n*(1-e2)*Math.sin(p)];};
const d3=(a,b)=>Math.hypot(...a.map((v,i)=>v-b[i]));
const floridaMeta={...meta,calibration:null,georef:{verified:true,source:'Survey orthomosaic',date:'2026-11-25',crs:'EPSG:4326',affine:[.000001,0,-81,0,-.000001,30]}};
const floridaEdge=measureProposal(model,floridaMeta).edges[0].horizontalLengthM;
const reference=d3(ecef([-81,30]),ecef([-81+.00002,30]));assert(Math.abs(floridaEdge/reference-1)<1e-6,'ordinary Florida roof agrees with independent ECEF distance');
const wideMeta={...floridaMeta,georef:{...floridaMeta.georef,affine:[.001,0,-81,0,-.2,30]}};
assert(Math.abs(Math.cos(30*Math.PI/180)/Math.cos(10*Math.PI/180)-1)>.1,'old unbounded top-latitude frame distorts remote rows by over ten percent');
assert.equal(measureProposal(model,wideMeta).projectedAreaM2,null,'regional geographic frames withhold physical quantities');
for(const latitude of[76,89,-80]){const polar={...floridaMeta,georef:{...floridaMeta.georef,affine:[.000001,0,-81,0,-.000001,latitude]}};assert.equal(measureProposal(model,polar).edges[0].horizontalLengthM,null,'unsupported polar projection cannot yield physical lengths');}
const largeLocal={...meta,calibration:null,georef:{verified:true,source:'Local survey',date:'2026-11-25',crs:'LOCAL_EN_METERS',affine:[30,0,0,0,30,0]}};assert.equal(measureProposal(model,largeLocal).projectedAreaM2,null,'local metric frame must also remain roof scale');
assert.equal(measureProposal(model,{...floridaMeta,width:undefined}).projectedAreaM2,null,'georeference validation needs the complete source extent');
const sourceRestrictedMeta={...meta,sourceRestrictions:{perspective:true,reasons:['Source perspective detected on earlier run']}};
const sourceRestricted=measureProposal(sharedRidge,sourceRestrictedMeta);assert.equal(sourceRestricted.projectedAreaM2,null);assert.equal(sourceRestricted.slopedAreaM2,null);assert.equal(sourceRestricted.edges[0].horizontalLengthM,null);assert(sourceRestricted.issues.some(i=>i.code==='perspective-restriction'));
const sourceCompare=compareProposals(model,model,sourceRestrictedMeta);assert.equal(sourceCompare.iou,1);assert.equal(sourceCompare.boundaryDistancePixels.max,0);assert.equal(sourceCompare.boundaryDistancePhysical,null,'source-level restriction survives a new model with no restriction flag');
for(const [a,b] of[[perspective,model],[model,perspective]])assert.equal(compareProposals(a,b,meta).boundaryDistancePhysical,null,'either proposal perspective flag prevents metric disagreement claims');
const unresolvedFacet=structuredClone(model);unresolvedFacet.facets[0].status='unresolved';unresolvedFacet.facets[1].status='user-provided';const unresolvedArea=measureProposal(unresolvedFacet,meta);assert.equal(unresolvedArea.facets[0].projectedAreaM2,null);assert.equal(unresolvedArea.facets[0].slopedAreaM2,null);assert(unresolvedArea.facets[0].pixels2>0);assert.equal(unresolvedArea.facets[0].status,'unresolved');assert.equal(unresolvedArea.facets[1].status,'user-provided');assert(unresolvedArea.facets[1].projectedAreaM2>0);assert.equal(unresolvedArea.projectedAreaM2,null);assert.equal(unresolvedArea.slopedAreaM2,null);assert(unresolvedArea.issues.some(i=>i.code==='facet-unresolved'));
for(const status of['inferred','user-provided','unresolved']){const proposal={...model,edges:[{id:'EA',type:'eave',status,points:[[0,0],[20,0]]}]};const m=measureProposal(proposal,meta);assert.equal(m.edges[0].status,status);assert(m.edges[0].lengthPixels>0);if(status==='unresolved'){assert.equal(m.edges[0].horizontalLengthM,null);assert(m.issues.some(i=>i.code==='edge-unresolved'));}else assert(m.edges[0].horizontalLengthM>0);}
const unknownLine=measureProposal({...model,edges:[{id:'unknown',type:'unspecified',status:'inferred',points:[[2,5],[8,5]]}]},meta);assert.equal(unknownLine.edges[0].horizontalLengthM,null);assert(unknownLine.edges[0].lengthPixels>0);assert(unknownLine.issues.some(i=>i.code==='edge-classification-unresolved'));
const obstructionLine=measureProposal({...model,edges:[{id:'obstacle',type:'obstruction',status:'user-provided',points:[[2,5],[8,5]]}]},meta);assert.equal(obstructionLine.edges[0].horizontalLengthM,null,'obstruction paths never supply physical roof-edge length');assert.equal(obstructionLine.edges[0].trueSlopedLengthM,null);assert.equal(obstructionLine.edges[0].lengthPixels,6);assert(obstructionLine.issues.some(i=>i.code==='edge-classification-unresolved'));
test('explicit unsupported openings and missing source extent cannot become physical measurements',()=>{
 const ring=[[2,2],[10,2],[10,10],[2,10]],hole=[[4,4],[6,4],[6,6],[4,6]];
 const meta={view:'orthographic',width:40,height:40,calibration:{verified:true,source:'Synthetic control',date:'2026-11-25',a:ring[0],b:ring[1],distance:8,unit:'ft'}};
 const facet={id:'F1',polygon:ring},roof={outline:ring,facets:[facet]};
 assert(Math.abs(measureProposal(roof,meta).projectedAreaM2-64*0.3048**2)<1e-10);
 for(const candidate of [{...roof,cutouts:[hole]},{...roof,facets:[{...facet,holes:[hole]}]},{...roof,facets:[{...facet,excluded:true}]}]){
   const result=measureProposal(candidate,meta);
   assert.equal(result.projectedAreaM2,null);
   assert(result.issues.some(issue=>issue.code==='unresolved-cutout'));
 }
 assert.equal(measureProposal(roof,{...meta,width:undefined}).projectedAreaM2,null);
});
