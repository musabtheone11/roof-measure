// Deterministic roof proposal checks. AI confidence is never a measurement scale.
import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
const require=createRequire(new URL('../bench/package.json',import.meta.url));
const pc=require('polygon-clipping'), proj4=require('proj4');
const RM=createRequire(import.meta.url)('../roofmodel.js');
const EPS=1e-7;
export const polygonOf=x=>Array.isArray(x)?x:(x?.polygon||x?.points||x?.path||[]);
const areaRing=r=>{const o=r[0]||[0,0];return Math.abs(r.reduce((s,p,i)=>{const q=r[(i+1)%r.length];return s+(p[0]-o[0])*(q[1]-o[1])-(q[0]-o[0])*(p[1]-o[1]);},0)/2);};
const mpArea=m=>m.reduce((s,p)=>s+areaRing(p[0])-p.slice(1).reduce((a,r)=>a+areaRing(r),0),0);
const dist=(a,b)=>Math.hypot(a[0]-b[0],a[1]-b[1]);
const cross=(a,b,c)=>(b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]);
const clean=r=>r.length>1&&dist(r[0],r.at(-1))<EPS?r.slice(0,-1):r.slice();
function pointSegment(p,a,b){const x=b[0]-a[0],y=b[1]-a[1],n=x*x+y*y,t=n?Math.max(0,Math.min(1,((p[0]-a[0])*x+(p[1]-a[1])*y)/n)):0;return Math.hypot(p[0]-a[0]-t*x,p[1]-a[1]-t*y);}
function crosses(a,b,c,d){return (cross(a,b,c)*cross(a,b,d)<-EPS&&cross(c,d,a)*cross(c,d,b)<-EPS)||Math.min(pointSegment(a,c,d),pointSegment(b,c,d),pointSegment(c,a,b),pointSegment(d,a,b))<=EPS;}
function issue(code,text,ids=[]){return{code,text,ids,status:'unresolved'};}
export function validatePolygon(input,metadata={},id='outline'){
 const issues=[],r=polygonOf(input);
 if(!Array.isArray(r)||r.length<3)return{ok:false,issues:[issue('vertices','Polygon requires at least three vertices',[id])],polygon:[]};
 if(r.length>512||r.some(p=>!Array.isArray(p)||p.length!==2||!p.every(Number.isFinite)))return{ok:false,issues:[issue('coordinates','Coordinates must be finite pixel pairs',[id])],polygon:[]};
 const p=clean(r);if(p.length<3||areaRing(p)<=EPS)issues.push(issue('degenerate','Polygon has no usable area',[id]));
 for(let i=0;i<p.length;i++){
  for(let j=i+1;j<p.length;j++)if(dist(p[i],p[j])<EPS)issues.push(issue('duplicate-vertex','Repeated polygon vertex',[id]));
  if(metadata.width&&metadata.height&&(p[i][0]<0||p[i][1]<0||p[i][0]>metadata.width||p[i][1]>metadata.height))issues.push(issue('bounds','Vertex lies outside the source image',[id]));
  for(let j=i+2;j<p.length;j++)if(!(i===0&&j===p.length-1)&&crosses(p[i],p[(i+1)%p.length],p[j],p[(j+1)%p.length]))issues.push(issue('self-intersection','Polygon crosses itself',[id]));
 }
 // Rings are implicitly closed by contract; return an explicit, auditable closure.
 return{ok:!issues.length,issues,polygon:p.length?[...p,p[0]]:[]};
}
function containsPoint(point,ring){
 if(!Array.isArray(point)||point.length!==2||!point.every(Number.isFinite))return false;
 if(ring.some((p,i)=>pointSegment(point,p,ring[(i+1)%ring.length])<=EPS))return true;
 let inside=false;for(let i=0,j=ring.length-1;i<ring.length;j=i++)if((ring[i][1]>point[1])!==(ring[j][1]>point[1])&&point[0]<(ring[j][0]-ring[i][0])*(point[1]-ring[i][1])/(ring[j][1]-ring[i][1])+ring[i][0])inside=!inside;return inside;
}
const EDGE_TYPES=new Set(['eave','rake','ridge','hip','valley','step','wall','transition','parapet','unspecified','obstruction']);
function segmentIntervals(a,b,ring) {
 const dx=b[0]-a[0],dy=b[1]-a[1],len2=dx*dx+dy*dy,ts=[0,1];
 for(let i=0;i<ring.length;i++){const c=ring[i],d=ring[(i+1)%ring.length],ex=d[0]-c[0],ey=d[1]-c[1],den=dx*ey-dy*ex;
  if(Math.abs(den)>EPS){const t=((c[0]-a[0])*ey-(c[1]-a[1])*ex)/den,u=((c[0]-a[0])*dy-(c[1]-a[1])*dx)/den;if(t>0&&t<1&&u>=-EPS&&u<=1+EPS)ts.push(t);}
  else if(Math.abs(cross(a,b,c))<=EPS&&len2>EPS)for(const p of[c,d]){const t=((p[0]-a[0])*dx+(p[1]-a[1])*dy)/len2;if(t>0&&t<1)ts.push(t);}
 }
 return [...new Set(ts)].sort((x,y)=>x-y);
}
function segmentInside(a,b,ring){if(!containsPoint(a,ring)||!containsPoint(b,ring))return false;const ts=segmentIntervals(a,b,ring);return ts.slice(1).every((t,i)=>containsPoint([a[0]+(b[0]-a[0])*(t+ts[i])/2,a[1]+(b[1]-a[1])*(t+ts[i])/2],ring));}
function coverage(a,b,rings){
 const dx=b[0]-a[0],dy=b[1]-a[1],len2=dx*dx+dy*dy,intervals=[];
 if(len2<=EPS)return [];
 for(let r=0;r<rings.length;r++)for(let i=0;i<rings[r].length;i++){const c=rings[r][i],d=rings[r][(i+1)%rings[r].length];if(Math.abs(cross(a,b,c))>EPS||Math.abs(cross(a,b,d))>EPS)continue;const values=[c,d].map(p=>((p[0]-a[0])*dx+(p[1]-a[1])*dy)/len2).sort((x,y)=>x-y),lo=Math.max(0,values[0]),hi=Math.min(1,values[1]);if(hi-lo>EPS)intervals.push({lo,hi,ring:r});}
 return intervals;
}
function boundarySupported(a,b,rings,minimum=1){const intervals=coverage(a,b,rings),ts=[...new Set([0,1,...intervals.flatMap(i=>[i.lo,i.hi])])].sort((x,y)=>x-y);return ts.slice(1).every((t,i)=>{if(t-ts[i]<=EPS)return true;const mid=(t+ts[i])/2;return new Set(intervals.filter(v=>v.lo<=mid+EPS&&v.hi>=mid-EPS).map(v=>v.ring)).size>=minimum;});}
function validateEdges(proposal,metadata,outline,facets){
 const issues=[],edges=[],source=proposal.edges||[];
 if(!Array.isArray(source)||source.length>1000||source.reduce((n,e)=>n+(Array.isArray(polygonOf(e))?polygonOf(e).length:8193),0)>8192)return{edges,issues:[issue('edge-budget','Edge geometry exceeds the bounded validation budget')]};
 const ids=new Set(facets.map(f=>f.id)),outer=clean(outline),rings=facets.map(f=>clean(f.polygon)).filter(r=>r.length>=3);
 for(let i=0;i<source.length;i++){
  const e=source[i]&&typeof source[i]==='object'?source[i]:{},id=e.id||`E${i+1}`,points=polygonOf(e),start=issues.length;
  if(typeof id!=='string'||!id.length||ids.has(id))issues.push(issue('duplicate-id','Edge and facet IDs must be unique nonempty strings',[id]));ids.add(id);
  if(!EDGE_TYPES.has(e.type))issues.push(issue('edge-type','Edge classification is missing or unknown',[id]));
  if(!Array.isArray(points)||points.length<2||points.length>512||points.some(p=>!Array.isArray(p)||p.length!==2||!p.every(Number.isFinite))){issues.push(issue('edge-coordinates','Edge requires finite pixel coordinates',[id]));edges.push({...e,id,points:[],valid:false});continue;}
  if(points.some(p=>p[0]<0||p[1]<0||(metadata.width&&p[0]>metadata.width)||(metadata.height&&p[1]>metadata.height)))issues.push(issue('edge-bounds','Edge lies outside the source image',[id]));
  for(let j=1;j<points.length;j++){
   const a=points[j-1],b=points[j];if(dist(a,b)<=EPS){issues.push(issue('duplicate-edge-vertex','Consecutive edge vertices coincide',[id]));continue;}
   if(outer.length<3||!segmentInside(a,b,outer)){issues.push(issue('edge-outside-roof','An edge segment is not contained by the target roof',[id]));continue;}
   if(['eave','rake','parapet'].includes(e.type)&&!boundarySupported(a,b,[outer]))issues.push(issue('edge-boundary','Exterior edge classification requires the exterior roof boundary',[id]));
   if(['ridge','hip','valley'].includes(e.type)&&(!boundarySupported(a,b,rings,2)||coverage(a,b,[outer]).length))issues.push(issue('edge-shared-boundary','Ridges, hips and valleys require a supported interior boundary shared by two facets',[id]));
   if(['step','wall','transition'].includes(e.type)&&!boundarySupported(a,b,rings))issues.push(issue('edge-facet-boundary','Flashing or transition requires a roof facet boundary',[id]));
  }
  // IDs share one namespace across facets and edges; physical paths must not overlap.
  const segments=points.slice(1).map((b,j)=>[points[j],b]);
  if(segments.some(([a,b],j)=>coverage(a,b,segments.slice(0,j)).length)||edges.some(other=>other.type===e.type&&segments.some(([a,b])=>coverage(a,b,other.points.slice(1).map((q,k)=>[other.points[k],q])).length)))issues.push(issue('duplicate-edge','Overlapping or retraced physical line in the same category',[id]));
  edges.push({...e,id,points:points.map(p=>p.slice()),valid:issues.length===start});
 }
 return{edges,issues};
}
export function validateProposal(proposal,metadata={}){
 proposal=proposal&&typeof proposal==='object'?proposal:{};
 const outline=validatePolygon(proposal.outline,metadata),issues=[...outline.issues],facets=[];
 if(metadata.targetPixel!=null&&outline.ok&&!containsPoint(metadata.targetPixel,clean(outline.polygon)))issues.push(issue('target-mismatch','The proposed roof does not contain the selected target point',['outline']));
 const sourceFacets=proposal.facets||[]; if(!Array.isArray(sourceFacets)||sourceFacets.length>300||sourceFacets.reduce((n,f)=>n+polygonOf(f).length,0)>4096)return{ok:false,issues:[...issues,issue('geometry-budget','Roof geometry exceeds the bounded validation budget')],outline:outline.polygon,facets:[],topology:{overlapPixels2:null,gapPixels2:null,outsidePixels2:null,sharedBoundaries:[]}};
 const ids=new Set();for(const[f,i]of(sourceFacets.map((f,i)=>[f&&typeof f==='object'?f:{},i]))){const id=f.id||`F${i+1}`;if(typeof id!=='string'||!id.length||ids.has(id))issues.push(issue('duplicate-id','Facet IDs must be unique nonempty strings',[id]));ids.add(id);const v=validatePolygon(f,metadata,id);facets.push({...f,id,polygon:v.polygon});issues.push(...v.issues);}
 const topology={overlapPixels2:null,gapPixels2:null,outsidePixels2:null,sharedBoundaries:[]};
 if(outline.ok&&facets.length&&facets.every(f=>f.polygon.length>=4)&&!issues.length){try{
  const union=pc.union(...facets.map(f=>[f.polygon]));
  const sum=facets.reduce((s,f)=>s+areaRing(f.polygon),0),un=mpArea(union);
  topology.overlapPixels2=Math.max(0,sum-un);topology.gapPixels2=mpArea(pc.difference([outline.polygon],union));topology.outsidePixels2=mpArea(pc.difference(union,[outline.polygon]));
  for(const[k,label]of[['overlapPixels2','overlap'],['gapPixels2','gap'],['outsidePixels2','outside-outline']])if(topology[k]>EPS)issues.push(issue(label,`${topology[k]} square pixels of ${label} require review`,facets.map(f=>f.id)));
  for(let i=0;i<facets.length;i++)for(let j=i+1;j<facets.length;j++){let length=0;const a=facets[i].polygon,b=facets[j].polygon;for(let x=1;x<a.length;x++)for(let y=1;y<b.length;y++){if(Math.abs(cross(a[x-1],a[x],b[y-1]))>EPS||Math.abs(cross(a[x-1],a[x],b[y]))>EPS)continue;const d=dist(a[x-1],a[x]);if(!d)continue;const ux=(a[x][0]-a[x-1][0])/d,uy=(a[x][1]-a[x-1][1])/d;const ts=[b[y-1],b[y]].map(p=>(p[0]-a[x-1][0])*ux+(p[1]-a[x-1][1])*uy).sort((m,n)=>m-n);length+=Math.max(0,Math.min(d,ts[1])-Math.max(0,ts[0]));}if(length>EPS)topology.sharedBoundaries.push({facets:[facets[i].id,facets[j].id],lengthPixels:length});}
 }catch{issues.push(issue('topology-unresolved','Polygon topology could not be reliably evaluated'));}}
 const checkedEdges=validateEdges(proposal,metadata,outline.polygon,facets);issues.push(...checkedEdges.issues);
 return{ok:!issues.length,issues,outline:outline.polygon,facets,edges:checkedEdges.edges,topology};
}
export function transformPoint(point,affine){if(!Array.isArray(point)||point.length!==2||!point.every(Number.isFinite))throw Error('A finite pixel point is required');if(!Array.isArray(affine)||affine.length!==6||!affine.every(Number.isFinite))throw Error('A six-value affine transform is required');const[x,y]=point;return[affine[0]*x+affine[1]*y+affine[2],affine[3]*x+affine[4]*y+affine[5]];}
export function invertAffine(a){const det=a[0]*a[4]-a[1]*a[3];if(!Number.isFinite(det)||Math.abs(det)<1e-14)throw Error('Singular transform');return[a[4]/det,-a[1]/det,(a[1]*a[5]-a[4]*a[2])/det,-a[3]/det,a[0]/det,(a[3]*a[2]-a[0]*a[5])/det];}
export function cropToSource(point,crop){const sx=crop.scaleX??crop.scale??1,sy=crop.scaleY??crop.scale??1;if(!Number.isFinite(sx)||!Number.isFinite(sy)||sx<=0||sy<=0)throw Error('Crop scale must be positive');const origin=crop.origin||[crop.x||0,crop.y||0];return transformPoint(point,crop.transform||[1/sx,0,origin[0],0,1/sy,origin[1]]);}
export function sourceToDisplay(point,transform){return transformPoint(point,transform.matrix||transform);}
const dated=x=>typeof x==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(x)&&Number.isFinite(Date.parse(x))&&new Date(x+'T00:00:00Z').toISOString().slice(0,10)===x;
export function measurementTransform(metadata={}){
 if(metadata.view!=='orthographic'||metadata.perspective==='oblique')return{ok:false,reason:'Oblique imagery requires a verified orthorectification; pixel measurements only.'};
 const g=metadata.georef;
 if(g?.verified===true&&g.source&&dated(g.date)&&Array.isArray(g.affine)&&g.affine.length===6&&g.affine.every(Number.isFinite)){
  invertAffine(g.affine);
  const unsupported=reason=>({ok:false,reason});
  if(!Number.isFinite(metadata.width)||!Number.isFinite(metadata.height)||metadata.width<=0||metadata.height<=0)return unsupported('Georeferencing requires finite source image dimensions.');
  const corners=[[0,0],[metadata.width,0],[0,metadata.height],[metadata.width,metadata.height]];
  const extent=points=>Math.max(...points.flatMap(a=>points.map(b=>dist(a,b))));
  // This roof-scale local frame is intentionally bounded; it is not a regional GIS projection.
  if(g.crs==='LOCAL_EN_METERS'){const point=p=>transformPoint(p,g.affine);if(extent(corners.map(point))>2000)return unsupported('Georeferenced image exceeds the supported 2 km roof-scale frame.');return{ok:true,basis:g,point};}

  if(['EPSG:4326','EPSG:3857'].includes(g.crs)||/^EPSG:32[67]\d\d$/.test(g.crs||'')){
   const crs=g.crs;let def=crs;if(/^EPSG:32[67]\d\d$/.test(crs)){const n=+crs.slice(5);if(n%100<1||n%100>60)return unsupported('UTM zone must be between 1 and 60.');def=`+proj=utm +zone=${n%100} ${n>=32700?'+south':''} +datum=WGS84 +units=m +no_defs`;}
   const ll=p=>{const q=proj4(def,'EPSG:4326',transformPoint(p,g.affine));if(!q.every(Number.isFinite)||Math.abs(q[0])>180||Math.abs(q[1])>90)throw Error('Georeference outside geographic bounds');return q;};
   const geographicCorners=corners.map(ll);
   if(geographicCorners.some(q=>Math.abs(q[1])>75))return unsupported('Polar georeferencing requires a separately validated projection; pixel measurements only.');
   const o=ll([metadata.width/2,metadata.height/2]),k=RM.scale(o[1]);
   const point=p=>{const q=ll(p);return[(q[0]-o[0])*k.kx,(q[1]-o[1])*k.ky];};
   if(extent(corners.map(point))>2000)return unsupported('Georeferenced image exceeds the supported 2 km roof-scale frame.');
   if(geographicCorners.some(q=>{const v=RM.scale(q[1]);return Math.abs(v.kx/k.kx-1)>.001||Math.abs(v.ky/k.ky-1)>.001;}))return unsupported('Geographic scale variation exceeds the supported local frame.');
   return{ok:true,basis:g,point,geographic:ll};
  }
 }
 const raw=metadata.calibration; const c=raw&&{...raw,a:raw.a||raw.start,b:raw.b||raw.end,distance:raw.distance??raw.lengthFt,unit:raw.unit||(raw.lengthFt!=null?'ft':null)};
 const validEndpoint=p=>Array.isArray(p)&&p.length===2&&p.every(Number.isFinite)&&p[0]>=0&&p[1]>=0&&(!metadata.width||p[0]<=metadata.width)&&(!metadata.height||p[1]<=metadata.height);
 if(c?.verified===true&&c.source&&dated(c.date)&&validEndpoint(c.a)&&validEndpoint(c.b)&&Number.isFinite(c.distance)&&c.distance>0&&['m','ft'].includes(c.unit)){const pixels=dist(c.a,c.b);if(pixels>0){const factor=c.distance*(c.unit==='ft'?.3048:1)/pixels;return{ok:true,basis:c,point:p=>[p[0]*factor,p[1]*factor]};}}
 return{ok:false,reason:'No verified spatial metadata or independent user calibration; physical quantities withheld.'};
}
export function measureProposal(proposal,metadata={}){
 proposal=proposal&&typeof proposal==='object'?proposal:{};
 const validation=validateProposal(proposal,metadata);let t;try{t=measurementTransform(metadata);}catch{t={ok:false,reason:'Invalid spatial metadata; physical quantities withheld.'};}if(proposal.measurementRestrictions?.perspective===true)t={ok:false,reason:'Perspective imagery cannot establish physical quantities from a planar scale.'};const issues=[...validation.issues];if(proposal.measurementRestrictions?.perspective===true)issues.push(issue('perspective-restriction','Perspective quality restriction persists through geometry edits'));if(!t.ok)issues.push(issue('scale-unresolved',t.reason));
 const rows=validation.facets.map(f=>{const pixels2=areaRing(f.polygon),planM2=t.ok&&validation.ok?areaRing(f.polygon.map(t.point)):null,p=f.pitch;const supported=p&&p.source&&Number.isFinite(p.uncertainty)&&p.uncertainty>=0&&['measured','user-provided'].includes(p.status)&&Number.isFinite(p.rise)&&Number.isFinite(p.run)&&p.rise>=0&&p.run>0;
  if(!supported)issues.push(issue('pitch-unresolved','Sloped surface area requires a sourced pitch and stated uncertainty',[f.id]));
  return{id:f.id,pixels2,projectedAreaM2:planM2,projectedAreaSqft:planM2==null?null:planM2*RM.SQFT,slopedAreaM2:planM2!=null&&supported?planM2*Math.hypot(p.run,p.rise)/p.run:null,pitch:supported?p:null,status:'inferred'};});
 const edges=(validation.edges||[]).map(e=>{let pixels=0,meters=0;if(e.valid)for(let j=1;j<e.points.length;j++){pixels+=dist(e.points[j-1],e.points[j]);if(t.ok)meters+=dist(t.point(e.points[j-1]),t.point(e.points[j]));}return{...e,lengthPixels:e.valid?pixels:null,horizontalLengthM:e.valid&&t.ok&&validation.ok?meters:null,trueSlopedLengthM:null,status:e.status||'unresolved'};});
 return{status:'REVIEW REQUIRED',issues,validation,measurementBasis:t.ok?t.basis:null,facets:rows,edges,projectedAreaM2:rows.length&&rows.every(r=>r.projectedAreaM2!=null)?rows.reduce((s,r)=>s+r.projectedAreaM2,0):null,slopedAreaM2:rows.length&&rows.every(r=>r.slopedAreaM2!=null)?rows.reduce((s,r)=>s+r.slopedAreaM2,0):null};
}
export function compareProposals(a,b,metadata={}){
 const A=validatePolygon(a.outline,metadata),B=validatePolygon(b.outline,metadata);if(!A.ok||!B.ok)return{status:'REVIEW REQUIRED',iou:null,boundaryDistancePixels:null,issues:[...A.issues,...B.issues]};
 let iou=null;try{const aa=areaRing(A.polygon),bb=areaRing(B.polygon),u=mpArea(pc.union([A.polygon],[B.polygon]));iou=u?(aa+bb-u)/u:null;}catch{}
 const samples=r=>r.slice(1).flatMap((p,i)=>{const q=r[i],n=Math.max(1,Math.min(Math.max(1,Math.floor(4096/r.length)),Math.ceil(dist(p,q))));return Array.from({length:n},(_,j)=>[q[0]+(p[0]-q[0])*j/n,q[1]+(p[1]-q[1])*j/n]);});
 const distances=(r,s)=>samples(r).map(p=>Math.min(...s.slice(1).map((q,i)=>pointSegment(p,s[i],q))));const values=[...distances(A.polygon,B.polygon),...distances(B.polygon,A.polygon)];const mean=values.reduce((s,x)=>s+x,0)/values.length,max=Math.max(...values),t=measurementTransform(metadata);
 let physical=null;if(t.ok){const X=A.polygon.map(t.point),Y=B.polygon.map(t.point);const physicalDistances=(source,target)=>samples(source).map(t.point).map(p=>Math.min(...target.slice(1).map((q,i)=>pointSegment(p,target[i],q))));const d=[...physicalDistances(A.polygon,Y),...physicalDistances(B.polygon,X)];physical={meanMeters:d.reduce((sum,x)=>sum+x,0)/d.length,maxMeters:Math.max(...d),basis:'symmetric sampled boundary distance in the verified horizontal coordinate frame'};}

 return{status:'REVIEW REQUIRED',iou,boundaryDistancePixels:{mean,max},boundaryDistancePhysical:physical,disputed:iou==null||iou<.95||max>3,agreementIsNotIndependentEvidence:true};
}
export function buildRoofModel(proposal,metadata={},options={}){const canonical=JSON.stringify({proposal,metadata,revision:options.revision});return{version:1,revision:options.revision||createHash('sha256').update(canonical).digest('hex'),originalProposal:structuredClone(proposal),imagery:structuredClone(metadata),provenance:options.provenance||{},measurements:measureProposal(proposal,metadata),corrections:[],status:'REVIEW REQUIRED'};}

export function analyzeRoofModel(model,imageMetadata={},options={}) { const canonical=buildRoofModel(model,imageMetadata,options); return {model:{...structuredClone(model),version:canonical.version,revision:canonical.revision,originalProposal:canonical.originalProposal,provenance:canonical.provenance},measurements:canonical.measurements,issues:canonical.measurements.issues,status:'REVIEW REQUIRED'}; }
