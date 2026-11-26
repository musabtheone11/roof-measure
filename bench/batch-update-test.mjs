import fs from 'node:fs';import vm from 'node:vm';import assert from 'node:assert/strict';
const src=fs.readFileSync(new URL('../app.js',import.meta.url),'utf8'),grab=n=>src.match(new RegExp('^function '+n+'\\([^]*?^\\}','m'))[0];
let draws=0;const state={facets:[],edges:[],mat:{}};const c={state,labels:{setItems(){draws++;}},baseLabels:()=>[],renderLists(){},renderSummary(){},renderSelection(){},renderReview(){}};vm.createContext(c);vm.runInContext(grab('recompute'),c);
c.recompute();assert.equal(draws,1);state.deferRecompute=1;for(let i=0;i<200;i++)c.recompute();assert.equal(draws,1,'shape additions cannot redraw partial batches');state.deferRecompute=0;c.recompute();assert.equal(draws,2,'completed transaction redraws once');
Object.assign(c,{map:{},toast(){},$:()=>({value:''}),clearAll(){state.facets=[];},setLocation(){},setDefaultPitch(){},addFacet(){throw Error('fixture import failure');},addEdge(){},drawSolar(){},renderSolar(){}});vm.runInContext(grab('restore'),c);
assert.throws(()=>c.restore({facets:[{}]}),/fixture import failure/);assert.equal(state.deferRecompute,0,'failed restore releases batching');assert.equal(draws,3,'failed restore refreshes the visible state');
console.log('Batch updates: partial geometry redraws deferred; final and failed imports refresh once');
