import test from'node:test';import assert from'node:assert/strict';import{canonicalResult}from'./main.mjs';import{analyzeRoofModel}from'./geometry.mjs';
test('quality perspective evidence blocks physical quantities across edits',()=>{
 const ring=[[0,0],[100,0],[100,100],[0,100]],input={revision:'r1',imageMetadata:{width:100,height:100,view:'orthographic',calibration:{verified:true,start:[0,0],end:[100,0],lengthFt:10,source:'Synthetic known scale',date:'2026-11-25'}}};
 const source={quality:{traceable:true,issues:[{kind:'perspective',reason:'Oblique source without orthorectification'}]},outline:{buildings:[{id:'B1',target:true,vertices:ring}]},structure:{planes:[{id:'F1',vertices:ring,status:'inferred'}],edges:[{id:'E1',type:'eave',points:[[0,0],[100,0]],status:'inferred'}]}};
 const first=canonicalResult(source,input);assert.equal(first.measurements.projectedAreaM2,null);assert.equal(first.measurements.edges[0].horizontalLengthM,null);
 const edited=structuredClone(first.model);edited.facets[0].pitch={rise:6,run:12,source:'Synthetic source',uncertainty:0,status:'user-provided'};
 const next=analyzeRoofModel(edited,input.imageMetadata,{revision:'r2'});assert.equal(next.measurements.projectedAreaM2,null);assert.equal(next.measurements.slopedAreaM2,null);assert.equal(next.model.measurementRestrictions.perspective,true);
});
test('canonical editable geometry does not duplicate raw provider output',()=>{
 const ring=[[0,0],[100,0],[100,100],[0,100]],raw={quality:{traceable:true,issues:[]},outline:{buildings:[{id:'B1',target:true,vertices:ring}]},structure:{planes:[{id:'F1',vertices:ring,status:'inferred'}],edges:[]},originalOutputHistory:{outline:[{content:'x'.repeat(200000)}]}};
 const result=canonicalResult(raw,{revision:'lean',imageMetadata:{width:100,height:100,view:'unknown'}});
 assert.equal(result.originalAI,raw);assert.equal(Object.hasOwn(result.model,'originalAI'),false);assert.equal(JSON.stringify(result.model).includes('x'.repeat(1000)),false);assert(JSON.stringify(result.model).length<5000);
});
test('a retry without a new perspective warning cannot clear source restrictions',()=>{
 const ring=[[0,0],[100,0],[100,100],[0,100]],raw={quality:{traceable:true,issues:[]},outline:{buildings:[{id:'B1',target:true,vertices:ring}]},structure:{planes:[{id:'F1',vertices:ring,status:'inferred'}],edges:[]}};
 const input={revision:'retry',imageMetadata:{width:100,height:100,view:'orthographic',sourceRestrictions:{perspective:true,reasons:['Earlier same-image perspective warning']},calibration:{verified:true,start:[0,0],end:[100,0],lengthFt:10,source:'Known horizontal reference',date:'2026-11-25'}}};
 raw.sourceRestrictions={perspective:false,reasons:[]};const result=canonicalResult(raw,input);assert.equal(result.model.measurementRestrictions.perspective,true);assert.equal(result.measurements.projectedAreaM2,null);assert.deepEqual(result.model.measurementRestrictions.reasons,input.imageMetadata.sourceRestrictions.reasons);
});
