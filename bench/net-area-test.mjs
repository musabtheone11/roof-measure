import assert from 'node:assert/strict';
import {createRequire}from'node:module';
const RM=createRequire(import.meta.url)('../roofmodel.js');const k=RM.scale(30);
const P=(x,y)=>({lat:30+y/RM.FT/k.ky,lng:-81+x/RM.FT/k.kx});
const rect=(x,y,w,h)=>[P(x,y),P(x+w,y),P(x+w,y+h),P(x,y+h)];
const flat={path:rect(0,0,10,10),plan:100,sloped:100,pitch:0,level:1,structure:1};
const steep={...flat,path:rect(10,0,10,10),sloped:100*Math.SQRT2,pitch:12,twoStory:true,twoLayer:true};
const cut={...flat,path:rect(12,2,5,5),excluded:true,plan:25,sloped:25*Math.SQRT2,pitch:12};
const source=[flat,steep,cut];const r=RM.netFacetAreas(source);
assert.ok(r.ok);assert.equal(r.rows[2].hostIndex,1);
assert.ok(Math.abs(r.rows.reduce((s,x)=>s+x.netSloped,0)-206.06601717798213)<1e-10,'net area matches hand-derived mixed-pitch roof');
for(const flag of ['twoStory','twoLayer'])assert.ok(Math.abs(r.rows.filter(x=>x[flag]).reduce((s,x)=>s+x.netSloped,0)-106.06601717798213)<1e-10,flag+' is net of host cutout');
assert.equal(r.rows.reduce((s,x)=>s+x.netPlan,0),175);assert.equal(source[1].sloped,100*Math.SQRT2,'inputs untouched');
for(const extra of [{structure:2},{level:2},{status:'unresolved'},{pitchUnknown:true},{plan:null},{path:rect(18,2,5,5)}]){
 const t=RM.netFacetAreas([flat,steep,{...cut,...extra}]);assert.equal(t.ok,false);assert.equal(t.rows[1].netSloped,steep.sloped,'unmatched cutout never subtracted');
}
assert.equal(RM.netFacetAreas([flat,steep,cut,{...cut}]).unmatchedCutouts.length,1,'duplicate cutout not subtracted twice');
assert.equal(RM.netFacetAreas([flat,steep,{...steep},cut]).unmatchedCutouts[0].reason,'Cutout has more than one possible host.');
// Every corner can be inside a concave polygon while a cutout edge crosses its open notch.
const concave={...flat,path:[[0,0],[10,0],[10,10],[6,10],[6,2],[4,2],[4,10],[0,10]].map(p=>P(...p)),plan:84,sloped:84};
const bridging={...cut,path:rect(2,8,6,1),plan:6,sloped:6};
assert.equal(RM.netFacetAreas([concave,bridging]).ok,false,'chord over narrow concave gap fails containment');
console.log('ok net areas, flag subtotals, unknown/ambiguous/overlapping cutouts, concave containment');
