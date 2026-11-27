// Legacy customer preview/export must never enter a roof drawing or imagery path.
import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
const source = fs.readFileSync(new URL('../roofpdf.js', import.meta.url), 'utf8');
const calls = [];
const M = {facets:[{}],review:true,line1:'Synthetic report'};
const context = vm.createContext({
  window:{jspdf:{}}, state:{}, RM:{modelRevision:()=> 'revision'}, serialize:()=> ({}),
  rpModel:()=> structuredClone(M), rpLoadLogo:async()=>{},
  rpHeroAerial:async()=> { throw new Error('Internal imagery path'); },
  rpSchedules:()=> ({}),
  rpDoc:()=> ({pages:1,addPage(){this.pages++;},getNumberOfPages(){return this.pages;},setProperties(){}}),
  rpSheetInformation:()=>{calls.push('information');return 1;},
  rpSheetMeasurementSchedules:(_doc,_model,_schedule,spill)=>{calls.push('schedules');spill.edges=[];spill.facets=[];},
  rpSheetEvidence:()=>{calls.push('evidence');return 1;},
});
vm.runInContext(source.slice(source.indexOf('async function rpBuild('),source.indexOf('// no roof could be measured from the imagery:')),context);
const report = await context.rpBuild();
assert.equal(report.pages,3);
assert.equal(report.layout.segmentationImagery,false);
assert.equal(report.layout.internalReview,false);
assert.equal(report.M.customerReport,true);
assert.deepEqual(calls,['information','schedules','evidence','information','schedules','evidence']);
await assert.rejects(context.rpBuild({internalReview:true}),/Internal imagery path/);
const previewSource = fs.readFileSync(new URL('../report.js',import.meta.url),'utf8');
assert.match(previewSource,/rpBuild\(\{ internalReview: false,/);
console.log('Customer report default uses measurement/evidence sheets only; internal imagery requires explicit opt-in.');
