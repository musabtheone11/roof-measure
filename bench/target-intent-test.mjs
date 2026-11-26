import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {test} from 'node:test';

const source = name => fs.readFileSync(new URL('../' + name, import.meta.url), 'utf8');
function fn(script, name) {
  return script.match(new RegExp('^(?:async )?function ' + name + '\\([^]*?^\\}', 'm'))[0];
}

test('slower address suggestion cannot replace a newly locked house', async () => {
  const state = {locationEpoch: 1, addressRequestEpoch: 0};
  const input = {value: ''};
  let resolveDetails;
  const place = {location: {lat: () => 40, lng: () => -80},
    fetchFields: () => new Promise(resolve => { resolveDetails = resolve; })};
  const ac = {items: [{src: 'google', text: 'First house', pred: {toPlace: () => place}}]};
  const calls = [];
  const c = vm.createContext({ac, state, $: () => input, acClose() {},
    locationGeneration: () => state.locationEpoch,
    setLocation: (...args) => calls.push(args), goToAddress: () => calls.push('fallback')});
  vm.runInContext(fn(source('autocomplete.js'), 'acChoose'), c);
  const pending = c.acChoose(0);
  state.locationEpoch++;
  state.addressRequestEpoch++;
  resolveDetails();
  await pending;
  assert.deepEqual(calls, []);
});

test('a roof with the provider centre cannot substitute for an unsupported explicit pin', () => {
  const c = vm.createContext({});
  vm.runInContext(fn(source('autotrace.js'), 'rmChooseMaskComponent'), c);
  const member = new Uint8Array(20 * 10);
  for (let y = 2; y < 8; y++) for (let x = 7; x < 15; x++) member[y * 20 + x] = 1;
  assert.throws(() => c.rmChooseMaskComponent([{member,n:48}], 20, 10,
    {E:x => x, N:y => -y}, [5,5], [10,5], [[9,4]], true), /pin/i);
});

test('alternate aerial fetch finishing after relocation cannot register a source on the new job', async () => {
  let epoch = 1, release;
  const AV = {tiers: [{id:'spring',source:'Synthetic flight',quality:'HIGH'}],src:{}};
  const c = vm.createContext({AV,state:{solar:{center:{latitude:30,longitude:-81}}},
    locationGeneration:()=>epoch,avBusy(){},avRadius:()=>20,
    altLoadLayers:()=>new Promise(resolve=>{release=resolve;})});
  vm.runInContext(fn(source('altview.js'), 'avSelect'), c);
  const request = c.avSelect('spring');
  epoch++;
  release({rgbT:null});
  await request;
  assert.deepEqual(AV.src,{});
  assert.equal(AV.active,undefined);
});

test('review background resolves the original flight and refuses an unrelated cached asset', () => {
  const key = JSON.stringify({building:'synthetic/main',quality:'MEDIUM',radius:42});
  const rgbT = {bands:[1,2,3]};
  const c = vm.createContext({AV:{src:{}}, state:{solar:{name:'synthetic/main'},
    trace:{sourceLayerRequest:key,buildingName:'synthetic/main',tracedAt:'v1'}},
    window:{__altCache:{[key]:{rgbT, requestIdentity:key}}},avRef:()=>({}),avRaster:t=>t});
  vm.runInContext(fn(source('altview.js'), 'avBaseRaster'), c);
  assert.equal(c.avBaseRaster(),rgbT);
  c.state.trace.tracedAt='v2';c.state.trace.sourceLayerRequest='missing';
  assert.equal(c.avBaseRaster(),null);
});

test('an imported rotated, point-sampled ortho uses the inverse pixel grid to crop the chosen roof', async () => {
  const x=3000, y=2800, metresPerDegree=100000, step=.000001;
  // Quarter turn: longitude increases down the image, latitude increases across.
  const ll=(i,j)=>({lng:-81+(j-.5)*step,lat:30+(i-.5)*step});
  const matrix=[0,step,0,-81, step,0,0,30, 0,0,1,0, 0,0,0,1];
  const target=ll(x,y);
  let crop, image, err;
  const tiff={getWidth:()=>6000,getHeight:()=>6000,getSamplesPerPixel:()=>1,getOrigin:()=>[-81,30],getResolution:()=>[step,-step],
    getGeoKeys:()=>({GeographicTypeGeoKey:4326,GTRasterTypeGeoKey:2}),getFileDirectory:()=>({ModelTransformation:matrix}),
    readRasters:async options=>{crop=options;return [new Uint8Array(options.width*options.height)];}};
  const AV={src:{},tgt:{...target,halfM:2}};
  const c=vm.createContext({AV,locationGeneration:()=>1,GeoTIFF:{fromBlob:async()=>({getImage:async()=>tiff})},
    avRef:()=>({...target,kx:metresPerDegree,ky:metresPerDegree}),Uint8Array,
    avRaster:r=>{image=r;return {ux:0,uy:.1,vx:.1,vy:0};},avBusy(){},avTab(){},avSelect(){},reviewLog(){},
    toast:m=>{err=m;},avSide(){},avPaint(){}});
  vm.runInContext(fn(source('autotrace.js'),'rmRasterTransform')+'\n'+fn(source('altview.js'),'avImport'),c);
  await c.avImport({name:'synthetic.tif',arrayBuffer:async()=>new ArrayBuffer(16)},'synthetic','2026-11-25',true,true);
  assert(crop,err);assert(image,err);
  const [x0,y0,x1,y1]=crop.window;
  assert(x0<x && x<x1 && y0<y && y<y1);
  for (const [i,j,expected] of [[0,0,ll(x0,y0)],[image.w,image.h,ll(x1,y1)]]) {
    const p=image.toLL(i,j);
    assert(Math.hypot(p.lng-expected.lng,p.lat-expected.lat)<1e-11);
  }
});
