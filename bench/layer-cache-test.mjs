// Actual source-cache functions with synthetic immutable assets. No network/API key.
import fs from 'node:fs';import vm from 'node:vm';import assert from 'node:assert/strict';import{webcrypto}from'node:crypto';
const files=new Map(),assetBytes=new Map();let assetFetches=0,layerCalls=0,flight;
const context={URL,TextEncoder,crypto:webcrypto,location:{hostname:'localhost'},state:{key:'runtime-fixture-secret'},Response,
 fetch:async(url,opts={})=>{
  if(url.startsWith('/reports/')){const data=files.get(decodeURIComponent(url.slice(9)));return new Response(data||null,{status:data?200:404});}
  if(url.startsWith('/save?')){const name=new URL(url,'https://local.invalid').searchParams.get('name');files.set(name,typeof opts.body==='string'?Buffer.from(opts.body):Buffer.from(opts.body));return new Response('{}');}
  const id=new URL(url).searchParams.get('id');assetFetches++;if(!assetBytes.has(id))return new Response(null,{status:404});return new Response(assetBytes.get(id));
 },GeoTIFF:{fromArrayBuffer:async(buf)=>({getImage:async()=>({readRasters:async()=>[new Uint8Array(buf),new Uint8Array(buf),new Uint8Array(buf)],getWidth:()=>2,getHeight:()=>2,getOrigin:()=>[0,0],getResolution:()=>[.001,-.001],getGeoKeys:()=>({GeographicTypeGeoKey:4326}),getFileDirectory:()=>({})})})}};
vm.createContext(context);vm.runInContext(fs.readFileSync(new URL('../autotrace.js',import.meta.url),'utf8'),context);context.solarDataLayers=async()=>{layerCalls++;return structuredClone(flight);};
const make=(label,year)=>{const obj={imageryDate:{year,month:2,day:11},imageryQuality:'HIGH'};for(const[k,i]of[['mask',1],['dsm',2],['rgb',3]]){obj[k+'Url']='https://source.invalid/asset?id='+label+'_'+k+'&key=must-not-persist';assetBytes.set(label+'_'+k,new Uint8Array(4).fill((label==='A'?0:10)+i));}return obj;};
const A=make('A',2014),B=make('B',2019),mainA={name:'buildings/synthetic',imageryDate:{year:2016,month:1,day:1},imageryQuality:'HIGH'},mainB={...mainA,imageryDate:{year:2020,month:1,day:1}};
flight=A;const a=await context.rmLoadLayerSet(mainA,30,-81,20,null);assert.equal(a.maskT.data[0],1);assert.equal(a.layers.imageryDate.year,2014,'actual flight date is retained instead of the record date');assert.equal(layerCalls,1);assert.equal(assetFetches,3);
const unchanged=await context.rmLoadLayerSet({...mainA},30,-81,20,null);assert.equal(assetFetches,3,'verified unchanged snapshot does not re-download');assert.equal(layerCalls,1);assert.deepEqual(Array.from(unchanged.dsmT.data),Array.from(a.dsmT.data));assert.equal(unchanged.layers.imageryDate.year,2014);
flight=B;const b=await context.rmLoadLayerSet(mainB,30,-81,20,null);assert.equal(b.maskT.data[0],11,'new record/source never reads the prior flight raster');assert.equal(b.layers.imageryDate.year,2019);assert.equal(assetFetches,6);assert.equal(layerCalls,2);
const requestB=context.rmLayerRequestIdentity(mainB,20,30,-81,null),namesB=await context.rmLayerCacheNames(context.rmLayerSourceRecord(B));
// Even correctly named B metadata cannot turn A bytes into B. A damaged/partial
// write must fail the byte digest check and force fresh assets.
files.set(namesB.mask,new Uint8Array(4).fill(1));assert.equal(await context.rmReadLayerCache(requestB),null,'A bytes plus B metadata is rejected');
const repaired=await context.rmLoadLayerSet(mainB,30,-81,20,null);assert.equal(repaired.maskT.data[0],11);assert.equal(assetFetches,9);
for(const name of [...files.keys()])if(name.startsWith('_cache_v2_request_'))files.delete(name);
files.set('_cache_buildings_synthetic_20_mask.tif',new Uint8Array(4).fill(1));
const noMetadata=await context.rmLoadLayerSet(mainB,30,-81,20,null);assert.equal(noMetadata.maskT.data[0],11,'missing metadata cannot relabel legacy A bytes');assert.equal(assetFetches,12,'missing metadata causes a fresh source download even if raster names exist');
assert.notEqual(context.rmLayerRequestIdentity(mainA,20,30,-81,null),requestB,'record date change invalidates session cache key');
const metadata=[...files].filter(([name])=>name.endsWith('.json')).map(([,data])=>data.toString()).join('\n');assert.ok(!metadata.includes('runtime-fixture-secret')&&!metadata.includes('must-not-persist'),'credentials do not enter metadata');
console.log('layer cache: dated source identity, immutable assets, digest mismatch, missing metadata and unchanged reuse pass');
