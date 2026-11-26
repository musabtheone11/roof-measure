// Frozen synthetic validation. Each case has a distinct seed and an analytic
// or behavioral oracle. Count fixtures once, regardless of assertions per row.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import RM from '../roofmodel.js';
import trace from '../autotrace.js';
import proj4 from 'proj4';
import {measureProposal, validatePolygon} from '../server/geometry.mjs';

const root = name => fs.readFileSync(new URL('../' + name, import.meta.url), 'utf8');
const rect = (x,y,w,h) => [[x,y],[x+w,y],[x+w,y+h],[x,y+h]];
const near = (actual, expected, tolerance = 1e-8) => {
  assert(Number.isFinite(actual) && Math.abs(actual-expected) <= tolerance * Math.max(1,Math.abs(expected)),
    'expected ' + expected + ', received ' + actual);
};
function generator(seed) {
  return () => {
    seed = (Math.imul(1664525, seed) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
}
function quantityFixture(rng, variant) {
  const w = 20 + rng()*80, h = 10 + rng()*60, cut = w * (.2 + rng()*.6);
  const ox = 150 + rng()*30, oy = 150 + rng()*20, quarter = Math.floor(rng()*4);
  const turn = (x,y) => [[x,y],[-y,x],[-x,-y],[y,-x]][quarter];
  const ring = pts => (variant % 2 ? pts.reverse() : pts).map(([x,y]) => {
    const [a,b] = turn(variant % 3 ? x : -x,y);
    return [ox+a,oy+b];
  });
  const factor = .05 + rng()*.8, unit = variant % 2 ? 'ft' : 'm';
  const pitch = rise => ({rise,run:12,status:'user-provided',source:'synthetic',uncertainty:0});
  const p1=variant % 7 ? rng()*20 : 0, p2=variant % 9 ? rng()*25 : 60;
  const meta={width:320,height:320,view:'orthographic',
    calibration:{verified:true,source:'synthetic',date:'2026-11-25',a:[0,0],b:[100,0],distance:100*factor,unit}};
  const m=unit==='ft' ? factor*.3048 : factor;
  const model={outline:ring(rect(0,0,w,h)),facets:[
    {id:'a',polygon:ring(rect(0,0,cut,h)),pitch:pitch(p1)},
    {id:'b',polygon:ring([[cut,0],[w,0],[w,h],[cut,h]]),pitch:pitch(p2)}],
    edges:[{id:'ridge',type:'ridge',points:ring([[cut,0],[cut,h]])}]};
  if (variant % 6===0) delete model.facets[1].pitch;
  const result=measureProposal(model,meta);
  assert.equal(result.validation.ok,true,JSON.stringify(result.issues));
  near(result.projectedAreaM2,w*h*m*m);
  near(result.edges[0].horizontalLengthM,h*m);
  near(result.validation.topology.sharedBoundaries[0].lengthPixels,h);
  if (variant % 6===0) assert.equal(result.slopedAreaM2,null);
  else near(result.slopedAreaM2,h*m*m*(cut*Math.hypot(1,p1/12)+(w-cut)*Math.hypot(1,p2/12)));
}
function topologyFixture(rng,variant) {
  const x=30+rng()*10,y=30+rng()*10,w=10+rng()*25,h=6+rng()*16;
  const outer=rect(x,y,w,h), a={id:'a',polygon:outer};
  const meta={width:100,height:100,view:'orthographic',
    calibration:{verified:true,source:'synthetic',date:'2026-11-25',start:[0,0],end:[5,0],lengthFt:5}};
  if (variant % 4 < 2) {
    const bad=variant%4===0 ? [outer[0],outer[2],outer[1],outer[3]] :
      [[x,y],[x+w/2,y+h/2],[x+w,y+h+1e-10]];
    assert.equal(validatePolygon(bad,meta).ok,false);
  } else {
    const overlap=variant%4===2;
    const b={id:'b',polygon:rect(overlap?x+w/2:x+w+1,y,w/3,h)};
    const m=measureProposal({outline:outer,facets:[a,b]},meta);
    assert(m.issues.some(row=>row.code===(overlap?'overlap':'outside-outline')));
    assert.equal(m.projectedAreaM2,null);
  }
}
function cutoutFixture(rng,variant) {
  const lat=25+rng()*20,lng=-110+rng()*30,k=RM.scale(lat);
  const w=30+rng()*50,h=25+rng()*40,cw=2+rng()*7,ch=2+rng()*8,pitch=rng()*30;
  const slope=Math.hypot(1,pitch/12), shape=(x,y,width,height)=>({
    level:1,structure:1,pitch,plan:width*height,sloped:width*height*slope,
    path:rect(x,y,width,height).map(([a,b])=>({lng:lng+a/RM.FT/k.kx,lat:lat+b/RM.FT/k.ky}))});
  const opening={...shape(4,5,cw,ch),excluded:true,structure:variant%2 ? 1 : 2};
  const net=RM.netFacetAreas([shape(0,0,w,h),opening]);
  assert.equal(net.ok,variant%2===1);
  near(net.rows[0].netSloped,(w*h-(net.ok?cw*ch:0))*slope);
}
function rasterFixture(rng,variant) {
  const theta=rng()*Math.PI*2, dx=.1+rng(), dy=.1+rng(), shear=(rng()-.5)*.3;
  const c0=100+rng()*100,n0=200+rng()*100, sign=variant%2 ? 1 : -1;
  const ax=dx*Math.cos(theta), ay=dx*Math.sin(theta);
  const bx=dy*(shear*Math.cos(theta)-sign*Math.sin(theta));
  const by=dy*(shear*Math.sin(theta)+sign*Math.cos(theta));
  const px=30+rng()*90,py=20+rng()*70,offset=variant%3===0?-.5:0;
  const img={getOrigin:()=>[c0,n0],getResolution:()=>[dx,dy],
    getGeoKeys:()=>({ProjectedCSTypeGeoKey:3857,GTRasterTypeGeoKey:offset?2:1}),
    getFileDirectory:()=>({ModelTransformation:[ax,bx,0,c0,ay,by,0,n0,0,0,1,0,0,0,0,1]})};
  const t=trace.rmRasterTransform(img,proj4);
  // Independent EPSG:3857 spherical Mercator definition, radians to degrees.
  const east=c0+ax*(px+offset)+bx*(py+offset), north=n0+ay*(px+offset)+by*(py+offset);
  const ll={lng:east/6378137*180/Math.PI,lat:Math.atan(Math.sinh(north/6378137))*180/Math.PI};
  const p=t.fromLL(ll), forward=t.toLL(px,py);
  near(p[0],px); near(p[1],py); near(forward.lat,ll.lat,1e-12); near(forward.lng,ll.lng,1e-12);
}

const ui=root('ai-trace.js');
const pointerCode=ui.slice(ui.indexOf('  function imagePoint('),ui.indexOf('  async function rotateImage('));
const canvas={setPointerCapture() {}}, S={}, fields={aiShape:{value:'outline'},aiTool:{value:'move'},aiResults:{},aiPickTarget:{}};
const c=vm.createContext({canvas,S,$:id=>fields[id],clone:structuredClone,selected:()=>S.vertices,
  edit(){S.commits++;},draw(){},cancel(){},clearTimeout(){},setTimeout(){},measure(){}});
vm.runInContext(pointerCode,c);
function pointerFixture(rng,variant) {
  const width=100+Math.floor(rng()*300),height=100+Math.floor(rng()*200);
  const zoom=.15+rng()*2,dpr=[1,1.5,2,3][variant%4],left=(rng()-.5)*200,top=(rng()-.5)*100;
  const padX=variant%2 ? 0 : 50*rng(),padY=variant%2 ? 40*rng() : 0;
  Object.assign(canvas,{width,height,getBoundingClientRect:()=>({left,top,width:width*zoom+2*padX,height:height*zoom+2*padY})});
  const x=width/2,y=height/3;
  // Browsers expose CSS px independent of physical screen density. Convert
  // a simulated physical contact into the pointer API's client coordinates.
  const contact=(id,u,v)=>({button:0,pointerId:id,isPrimary:id===1,
    clientX:((left+padX+u*zoom)*dpr)/dpr,clientY:((top+padY+v*zoom)*dpr)/dpr});
  Object.assign(S,{vertices:[[x-2/zoom,y],[x,y],[x,y+25]],commits:0,drag:null,revision:0});
  canvas.onpointerdown(contact(1,x,y));
  assert.equal(S.drag.index,1);
  canvas.onpointermove(contact(2,x+7,y+7));canvas.onpointerup(contact(2,x+7,y+7));
  near(S.vertices[1][0],x);assert(S.drag);assert.equal(S.commits,0);
  canvas.onpointermove(contact(1,x+4,y+9));
  if (variant%3===0) {canvas.onpointercancel(contact(1,x+4,y+9));near(S.vertices[1][0],x);assert.equal(S.commits,0);}
  else {canvas.onpointerup(contact(1,x+4,y+9));near(S.vertices[1][0],x+4);near(S.vertices[1][1],y+9);assert.equal(S.commits,1);}
}

const families=[quantityFixture,topologyFixture,cutoutFixture,rasterFixture,pointerFixture];
const failures=[],summary={};
for (const [index, family] of families.entries()) {
  const stats=summary[family.name]={attempted:0,passed:0};
  for (let i=0;i<2000;i++) {
    const seed=680001+2000*index+i;
    stats.attempted++;
    try { family(generator(seed),i);stats.passed++; }
    catch(e) { if(failures.length<10)failures.push({seed,family:family.name,error:e.message}); }
  }
}
console.log(JSON.stringify({firstSeed:680001,lastSeed:690000,summary,firstFailures:failures},null,2));
if(failures.length)process.exitCode=1;
