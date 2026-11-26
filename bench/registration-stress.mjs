// Thousands of deterministic registration invariance cases, no network/property data.
// The independent oracle is an analytic EN plane and polygon edge distances.
import fs from 'node:fs';import vm from 'node:vm';import assert from 'node:assert/strict';import {createRequire}from'node:module';import proj4 from'proj4';
const RM=createRequire(import.meta.url)('../roofmodel.js');const c={RM,proj4};vm.createContext(c);vm.runInContext(fs.readFileSync(new URL('../autotrace.js',import.meta.url),'utf8'),c);
const count=Number(process.argv[2]||4000);let seed=91274;const rng=()=>((seed=(Math.imul(seed,1664525)+1013904223)>>>0)/4294967296);let maxHeightErrorM=0,maxResidualM=0,checked=0,identities=0,rejectedOffsets=0;
const seg=(p,a,b)=>{const dx=b[0]-a[0],dy=b[1]-a[1],t=Math.max(0,Math.min(1,((p[0]-a[0])*dx+(p[1]-a[1])*dy)/(dx*dx+dy*dy)));return Math.hypot(p[0]-a[0]-t*dx,p[1]-a[1]-t*dy);};
for(let k=0;k<count;k++){
 const ref={lat:20+rng()*35,lng:-120+rng()*60};Object.assign(ref,RM.scale(ref.lat));const w=12,h=13,px=.08+rng()*.04,th=k%20===0?0:(rng()-.5)*Math.PI*.8,shear=k%20===0?0:(rng()-.5)*.35;
 const co=Math.cos(th),si=Math.sin(th),ax=px*co,ay=px*si,bx=px*(si+shear*co),by=px*(-co+shear*si),E0=(rng()-.5)*1000,N0=(rng()-.5)*1000;
 const pos=(x,y)=>[E0+ax*x+bx*y,N0+ay*x+by*y];const ll=(x,y)=>{const p=pos(x,y);return{lng:ref.lng+p[0]/ref.kx,lat:ref.lat+p[1]/ref.ky};};
 const base={w,h,toLL:ll},mask={...base,data:new Uint8Array(w*h).fill(1)},dsm={...base,data:new Float32Array(w*h)};const A=.1+rng()*.15,B=.1+rng()*.15,C=4;
 for(let y=0;y<h;y++)for(let x=0;x<w;x++){const p=pos(x+.5,y+.5);dsm.data[y*w+x]=C+A*(p[0]-E0)+B*(p[1]-N0);}
 const out=c.rmPrepareTraceLayers(mask,dsm,null,ref);maxResidualM=Math.max(maxResidualM,out.registration.residualM);assert.ok(out.registration.residualM<.05);
 if(k%20===0){identities++;assert.equal(out.maskT,mask);assert.equal(out.dsmT,dsm);}
 const corners=[[0,0],[w,0],[w,h],[0,h]].map(p=>pos(...p));let local=0;
 for(let y=0;y<out.maskT.h;y++)for(let x=0;x<out.maskT.w;x++){const i=y*out.maskT.w+x;if(!out.maskT.data[i])continue;const q=out.maskT.toLL(x+.5,y+.5),p=[(q.lng-ref.lng)*ref.kx,(q.lat-ref.lat)*ref.ky];if(Math.min(...corners.map((a,j)=>seg(p,a,corners[(j+1)%4])))<px*2)continue;const err=Math.abs(out.dsmT.data[i]-(C+A*(p[0]-E0)+B*(p[1]-N0)));maxHeightErrorM=Math.max(maxHeightErrorM,err);assert.ok(err<.00001,`plane interpolation case ${k}: ${err}`);checked++;local++;}
 assert.ok(local>10,'each fixture checks interior plane samples');
 const shifted={...base,data:dsm.data,toLL:(x,y)=>{const p=ll(x,y);return{...p,lng:p.lng+.1/ref.kx};}};assert.throws(()=>c.rmAssertSameGrid(mask,shifted,'stress'),/not georeferenced/);rejectedOffsets++;
}
console.log(JSON.stringify({seed:91274,cases:count,interiorPlaneSamples:checked,identityArraysUnchanged:identities,misregisteredPairsRejected:rejectedOffsets,maxHeightErrorM,maxAffineResidualM:maxResidualM,toleranceM:.05}));
let selectedTargets=0,absentRefused=0,zeroPixels=0;
for(let k=0;k<1000;k++){
 const w=60,h=40,px=.5+rng(),geo={E:x=>x*px+2000,N:y=>5000-y*px};
 const rect=(x0,y0,x1,y1)=>{const member=new Uint8Array(w*h);let n=0;for(let y=y0;y<y1;y++)for(let x=x0;x<x1;x++){member[y*w+x]=1;n++;}return{member,n,cx:(x0+x1)/2,cy:(y0+y1)/2};};
 const tw=3+Math.floor(rng()*5),th=3+Math.floor(rng()*5),ty=Math.floor(rng()*8),small=rect(0,ty,tw,ty+th),large=rect(20,2,55,35),pin=[k%10===0?0:tw/2,k%10===0?ty:ty+th/2];
 const choice=c.rmChooseMaskComponent([large,small],w,h,geo,pin,[35,20],[]);assert.equal(choice.component,small);assert.equal(choice.evidence.method,'mask contains selected pin');selectedTargets++;if(pin[0]===0)zeroPixels++;
 assert.throws(()=>c.rmChooseMaskComponent([large],w,h,geo,null,pin,[]),/does not support/);absentRefused++;
 assert.throws(()=>c.rmChooseMaskComponent([],w,h,geo,pin,pin,[]),/No supported/);
}
console.log(JSON.stringify({selectionCases:1000,largerNeighboursRefused:selectedTargets,absentTargetRefused:absentRefused,zeroPixelAnchorsPreserved:zeroPixels}));
