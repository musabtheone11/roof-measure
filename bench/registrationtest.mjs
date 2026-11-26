// Actual decoder / raster registration / selection regressions. Synthetic only.
import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import proj4 from 'proj4';
const RM = createRequire(import.meta.url)('../roofmodel.js');
const source = fs.readFileSync(new URL('../autotrace.js', import.meta.url), 'utf8');
let image;
const ctx = { RM, proj4, location:{hostname:'synthetic.invalid'}, state:{key:''}, fetch:async()=>({ok:true,arrayBuffer:async()=>new ArrayBuffer(1)}), GeoTIFF:{fromArrayBuffer:async()=>({getImage:async()=>image})} };
vm.createContext(ctx);vm.runInContext(source,ctx);
const load = async(epsg,origin,resolution,extra={})=>{image={readRasters:async()=>[new Float32Array(10000)],getWidth:()=>100,getHeight:()=>100,getOrigin:()=>origin,getResolution:()=>resolution,getGeoKeys:()=>({ProjectedCSTypeGeoKey:epsg,...extra.keys}),getFileDirectory:()=>extra.dir||{}};return ctx.loadTiff('https://synthetic.invalid');};
let t=await load(3857,[100,200],[.1,-.1]);let q=t.toLL(0,10),expect=proj4('EPSG:3857','EPSG:4326',[100,199]);assert.ok(Math.hypot(q.lng-expect[0],q.lat-expect[1])<1e-12,'projected near-zero origin stays projected');
t=await load(4326,[10,20],[.001,.001]);assert.equal(t.toLL(0,10).lat,20.01,'south-up signed row step retained');
t=await load(4326,[10,20],[.001,-.001],{dir:{ModelTransformation:[.001,.0003,0,10,.0002,-.001,0,20,0,0,1,0,0,0,0,1]}});q=t.toLL(40,50);assert.ok(Math.hypot(q.lng-10.055,q.lat-19.958)<1e-10,'affine cross terms retained');
t=await load(4326,[10,20],[.001,-.001],{keys:{GTRasterTypeGeoKey:2}});assert.equal(t.toLL(.5,.5).lat,20,'pixel-is-point centre stays on tiepoint');
t=await load(4326,[10,20],[.001,-.001],{dir:{ModelTiepoint:[10,20,0,10,20,0]}});assert.ok(Math.abs(t.toLL(10,20).lng-10)<1e-12&&Math.abs(t.toLL(10,20).lat-20)<1e-12,'nonzero raster tiepoint coordinates retained');
const ref={lat:30,lng:-81,...RM.scale(30)},w=100,h=100;
const grid=(ax,ay,bx,by,offset=0)=>({w,h,toLL:(x,y)=>({lng:ref.lng+(-5+ax*x+bx*y+offset)/ref.kx,lat:ref.lat+(5+ay*x+by*y)/ref.ky})});
const identity=grid(.1,0,0,-.1),mask={...identity,data:new Uint8Array(w*h).fill(1)},dsm={...identity,data:new Float32Array(w*h).fill(4)};
assert.throws(()=>ctx.rmAssertSameGrid(mask,{...grid(.1,0,0,-.1,10),data:dsm.data},'fixture'),/not georeferenced/,'same size shifted source rejected');
let prepared=ctx.rmPrepareTraceLayers(mask,dsm,null,ref);assert.equal(prepared.maskT,mask);assert.equal(prepared.dsmT,dsm);assert.equal(prepared.registration.resampled,false,'identity fast path preserves arrays');
const shear=grid(.1,.02,.03,-.1),m={...shear,data:new Uint8Array(w*h)},z={...shear,data:new Float32Array(w*h)};
for(let y=0;y<h;y++)for(let x=0;x<w;x++){const i=y*w+x,p=shear.toLL(x+.5,y+.5),E=(p.lng-ref.lng)*ref.kx,N=(p.lat-ref.lat)*ref.ky;m.data[i]=x>=20&&x<80&&y>=20&&y<80?1:0;z.data[i]=3+.5*E+.2*N;}
prepared=ctx.rmPrepareTraceLayers(m,z,null,ref);assert.equal(prepared.registration.resampled,true);let error=0,n=0;
for(let y=2;y<prepared.dsmT.h-2;y++)for(let x=2;x<prepared.dsmT.w-2;x++){const i=y*prepared.dsmT.w+x;if(!prepared.maskT.data[i])continue;const p=prepared.maskT.toLL(x+.5,y+.5),E=(p.lng-ref.lng)*ref.kx,N=(p.lat-ref.lat)*ref.ky;error=Math.max(error,Math.abs(prepared.dsmT.data[i]-(3+.5*E+.2*N)));n++;}
assert.ok(n>3000&&error<1e-5,'sheared plane remains registered after one explicit resample');
const bad={...identity,toLL:(x,y)=>{const p=identity.toLL(x,y);p.lat+=x*y/10000/ref.ky;return p;},data:mask.data};assert.throws(()=>ctx.rmPrepareTraceLayers(bad,{...bad,data:dsm.data},null,ref),/not affine/);
const ww=40,hh=20,geo={E:x=>x,N:y=>-y};const piece=(x0,y0,x1,y1)=>{const member=new Uint8Array(ww*hh);let n=0;for(let y=y0;y<y1;y++)for(let x=x0;x<x1;x++){member[y*ww+x]=1;n++;}return{member,n,cx:(x0+x1)/2,cy:(y0+y1)/2};};
const small=piece(2,2,12,12),large=piece(17,2,37,12);assert.equal(ctx.rmChooseMaskComponent([large,small],ww,hh,geo,[5,5],[13,6],[]).component,small,'selected pin beats larger neighbouring roof');
assert.equal(ctx.rmChooseMaskComponent([large,small],ww,hh,geo,null,[13,6],[]).component,small,'nearest supported boundary beats area score');
assert.throws(()=>ctx.rmChooseMaskComponent([large],ww,hh,geo,null,[0,0],[]),/does not support/,'empty-box nearby neighbour not silently selected');
assert.equal(ctx.rmChooseMaskComponent([small],ww,hh,geo,[0,0],[0,0],[[5,5]]).component,small,'valid pixel zero is retained and witnesses support concave-centre case');
console.log('registration: decoder, full affine, source grid, identity, resampling, neighbours and zero coordinates pass');
