// The actual async autoTraceRoof may not publish into a changed pin/job/request.
import assert from 'node:assert/strict';import {createRequire}from'node:module';import{runApp}from'./appcore.mjs';
const RM=createRequire(import.meta.url)('../roofmodel.js');const loc={lat:30,lng:-81},k=RM.scale(loc.lat),w=120,h=100,px=.1,E0=-6,N0=5;
const ll=(x,y)=>({lng:loc.lng+(E0+x*px)/k.kx,lat:loc.lat+(N0-y*px)/k.ky});const mask=new Uint8Array(w*h),dsm=new Float32Array(w*h);
for(let y=0;y<h;y++)for(let x=0;x<w;x++){if(x>=15&&x<105&&y>=15&&y<85)mask[y*w+x]=1;dsm[y*w+x]=mask[y*w+x]?4+.4*(E0+(x+.5)*px):0;}
const sw=ll(15,85),ne=ll(105,15),tif=data=>({w,h,data,toLL:ll,rx:px,ry:-px});
const main={name:'buildings/synthetic-race',center:{latitude:loc.lat,longitude:loc.lng},boundingBox:{sw:{latitude:sw.lat,longitude:sw.lng},ne:{latitude:ne.lat,longitude:ne.lng}},imageryDate:{year:2026,month:1,day:1},imageryQuality:'HIGH',solarPotential:{roofSegmentStats:[],wholeRoofStats:{areaMeters2:63}}};
const prop={main,loc,address:'Synthetic fixture',radius:18,layers:{imageryDate:main.imageryDate,imageryQuality:'HIGH'},maskT:tif(mask),dsmT:tif(dsm),rgbT:null,solarNear:async()=>main};
for(const mode of ['location','solar','request']){
 let c,removed=0;const sentinel={name:'saved geometry',shape:{setMap(){removed++;}}};
 await assert.rejects(runApp(prop,undefined,{quiet:true,hook:ctx=>{c=ctx;ctx.state.facets=[sentinel];ctx.rmNewerRecords=async()=>{if(mode==='location')ctx.state.locationEpoch=7;else if(mode==='solar')ctx.state.solar={...main};else ctx.__rmTraceRequest++;return[];};}}),/selected location changed/);
 assert.equal(removed,0,'old geometry is not cleared for '+mode);assert.equal(c.state.facets[0],sentinel);
}
console.log('trace race: changed location, changed Solar record and superseded trace preserve geometry');
