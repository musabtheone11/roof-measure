import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
// Exercise the actual map handlers using pixel-equivalent coordinates.
const source=fs.readFileSync(new URL('../app.js',import.meta.url),'utf8');
const grab=(name,next)=>source.slice(source.indexOf(`function ${name}(`),source.indexOf(`function ${next}(`));
const point=(x,y)=>({x,y,equals(p){return this.x===p.x&&this.y===p.y;}});
const context={SNAP_PX:12,labels:{pixel:p=>p},state:{tool:'facet',facets:[],edges:[]},draft:{tool:'facet',points:[point(0,0)]},refreshDraft(){},finishDraft(){this.finished=true;}};
vm.createContext(context);vm.runInContext(grab('allVertices','startDraft')+grab('onMapClick','onMapMove'),context);
assert.equal(vm.runInContext('snap({x:8,y:0}).x',context),8,'last draft vertex cannot swallow a short edge');
context.state.facets=[{omit:true,shape:{getPath:()=>[point(8,0)]}}];assert.equal(vm.runInContext('snap({x:9,y:0}).x',context),9,'omitted structures do not attract the pen');
context.state.facets=[{shape:{getPath:()=>[point(20,0)]}}];assert.equal(vm.runInContext('snap({x:7.5,y:0}).x',context),7.5,'snap radius is exactly twelve pixels');
context.state.facets=[];context.event={latLng:point(3,0),domEvent:{detail:1}};vm.runInContext('onMapClick(event,false)',context);assert.equal(context.draft.points.length,2,'deliberate three pixel corner is retained');
context.event={latLng:point(4,0),domEvent:{detail:2}};vm.runInContext('onMapClick(event,false)',context);assert.equal(context.draft.points.length,2,'native double click second event is suppressed');
context.event={latLng:point(3,0),domEvent:{detail:1}};vm.runInContext('onMapClick(event,false)',context);assert.equal(context.draft.points.length,2,'exact duplicate remains suppressed');
