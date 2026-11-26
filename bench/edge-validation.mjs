// Frozen synthetic edge identities. Run: node bench/edge-validation.mjs [output.json]
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import clipping from 'polygon-clipping';
import { loadEngine, trace } from './engine.mjs';
import { render, rng } from './synth.mjs';
import { summarizeEngine } from './score.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const baseline = '4806a129bea3fe6aa18d20a613f2cad494485082';
const engineFiles = ['autotrace.js', 'autotrace2.js', 'obstruction.js'];
const fixtures = [
  ['G1', 'gable', 14, 8, 4, 0, 73101],
  ['G2', 'gable', 21, 11, 6, 17, 73102],
  ['G3', 'gable', 18, 9, 8, 49, 73103],
  ['G4', 'gable', 24, 12, 12, 83, 73104],
  ['H1', 'hip', 16, 8, 4, 7, 73105],
  ['H2', 'hip', 22, 12, 6, 31, 73106],
  ['H3', 'hip', 19, 10, 8, 59, 73107],
  ['H4', 'hip', 25, 13, 12, 88, 73108],
].map(([id, kind, lengthM, widthM, riseIn12, rotationDeg, seed]) =>
  ({ id, kind, lengthM, widthM, riseIn12, rotationDeg, seed }));

const renderOptions = { noise: 0.02, blur: 1, hard: false, clutter: false, trees: 0 };
const endpointToleranceM = 0.40;
const minimumFacetIou = 0.50;
const ftPerM = 1 / 0.3048;
const hash = data => createHash('sha256').update(data).digest('hex');
const rounded = value => Number(value.toFixed(6));
const distance = (a, b) => Math.hypot(...a.map((value, i) => value - b[i]));
const git = args => execFileSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: 4*1024*1024 });

function engine(revision) {
  const context = loadEngine([]);
  const sources = {};
  for (const file of engineFiles) {
    const source = revision ? git(['show', revision + ':' + file]) : fs.readFileSync(path.join(root,file), 'utf8');
    sources[file] = hash(source.replaceAll('\r\n','\n'));
    vm.runInContext(source, context, { filename: file });
  }
  return {context, sources};
}

// Derive 3D vertices and faces from the box dimensions without consulting the
// trace engine, its edge classifier, the raster or the existing polygon oracle.
function truth(f) {
  const isHip = f.kind === 'hip';
  const l = f.lengthM/2, w = f.widthM/2, r = isHip ? l-w : l;
  const z = w*f.riseIn12/12, th = f.rotationDeg*Math.PI/180;
  const vertices = {
    A: [-l,-w,0], B: [l,-w,0], C: [l,w,0], D: [-l,w,0], X: [-r,0,z], Y: [r,0,z],
  };
  const xy = key => {
    const [u,v] = vertices[key];
    return [u*Math.cos(th)-v*Math.sin(th), u*Math.sin(th)+v*Math.cos(th)];
  };
  const specs = isHip ? {eave:['AB','BC','CD','DA'],ridge:['XY'],hip:['AX','DX','BY','CY']} :
    {eave:['AB','CD'],ridge:['XY'],rake:['AX','DX','BY','CY']};
  const edges = Object.entries(specs).flatMap(([type, pairs]) => pairs.map(id => ({
    id, type, ends:[xy(id[0]),xy(id[1])], ft:distance(vertices[id[0]],vertices[id[1]])*ftPerM,
  })));
  const faces = (isHip ? ['ABYX','DCYX','ADX','BCY'] : ['ABYX','DCYX']).map(keys =>
    ({id:keys, polygon:[Array.from(keys,xy)]}));
  return { edges, faces, areaSqFt:f.lengthM*f.widthM*Math.hypot(1,f.riseIn12/12)*ftPerM**2 };
}

function ringArea(ring) {
  return Math.abs(ring.reduce((s,[x,y],i) => {
    const q = ring[(i+1)%ring.length];
    return s+x*q[1]-y*q[0];
  },0))/2;
}
const polygonArea = rings => ringArea(rings[0]) - rings.slice(1).reduce((s,r) => s+ringArea(r),0);
function overlap(a,b) {
  const common = clipping.intersection(a,b).reduce((s,p) => s+polygonArea(p),0);
  return common/(polygonArea(a)+polygonArea(b)-common);
}

// Deterministic best admissible pair first. A prediction cannot explain two
// true lines or faces. Length and edge type never determine correspondence.
function match(expected, predicted, score, limit) {
  const pairs = [];
  for (let i=0;i<expected.length;i++) for (let j=0;j<predicted.length;j++) {
    const cost=score(expected[i],predicted[j]);
    if (limit(cost)) pairs.push({i,j,cost});
  }
  pairs.sort((a,b) => a.cost-b.cost || a.i-b.i || a.j-b.j);
  const usedExpected = new Set(), usedPredicted = new Set(), selected = [];
  for (const pair of pairs) if (!usedExpected.has(pair.i) && !usedPredicted.has(pair.j)) {
    usedExpected.add(pair.i); usedPredicted.add(pair.j); selected.push(pair);
  }
  return {
    selected,
    missed:expected.flatMap((item,i) => usedExpected.has(i)?[]:[item.id]),
    extra:predicted.flatMap((item,j) => usedPredicted.has(j)?[]:[j]),
  };
}

function endpointError(a, b) {
  const [start,end] = a.ends;
  const first=b.line[0], last=b.line.at(-1);
  return Math.min(Math.max(distance(start,first),distance(end,last)),
    Math.max(distance(start,last),distance(end,first)));
}

function evaluate(f, context) {
  const th=f.rotationDeg*Math.PI/180, pitch=f.riseIn12/12;
  const wing={cx:0,cy:0,th,L:f.lengthM,W:f.widthM,kind:f.kind,s:pitch,sEnd:pitch,eaveZ:3};
  const scene=render([wing],rng(f.seed),renderOptions);
  const bytes=createHash('sha256');
  for (const data of [scene.dsm,scene.mask,...scene.rgb]) bytes.update(Buffer.from(data.buffer,data.byteOffset,data.byteLength));
  const rasterSha256=bytes.digest('hex');
  const ref=truth(f);
  try {
    const output=trace(context,scene);
    const lines=match(ref.edges,output.edges,endpointError, cost => cost<=endpointToleranceM);
    const faces=match(ref.faces,output.facets,(a,b) => 1-overlap(a.polygon,[b.poly]), cost => 1-cost>minimumFacetIou);
    const measurements=lines.selected.map(({i,j,cost}) => {
      const expected=ref.edges[i], actual=output.edges[j];
      const score=summarizeEngine({facets:output.facets,edges:[actual]},6,true);
      const measured=score.byType[actual.type];
      return {truthId:expected.id,expectedType:expected.type,predictedIndex:j,predictedType:actual.type,
        expectedEndsM:expected.ends.map(p=>p.map(rounded)),predictedLineM:actual.line.map(p=>p.map(rounded)),
        evidenceStatus:actual.status??null,expectedFt:rounded(expected.ft),predictedFt:Number.isFinite(measured)?rounded(measured):null,
        absoluteErrorFt:Number.isFinite(measured)?rounded(Math.abs(measured-expected.ft)):null,endpointErrorM:rounded(cost)};
    });
    const area=summarizeEngine(output,6,true).sloped;
    return {id:f.id,rasterSha256,expectedAreaSqFt:rounded(ref.areaSqFt),candidateAreaSqFt:rounded(area),
      absoluteAreaErrorPct:rounded(100*Math.abs(area-ref.areaSqFt)/ref.areaSqFt),
      edgeMatches:measurements,missedEdges:lines.missed,extraEdges:lines.extra.map(i=>{
        const edge=output.edges[i];
        return {index:i,type:edge.type,lineM:edge.line.map(p=>p.map(rounded)),
          estimatedFt:rounded(summarizeEngine({facets:output.facets,edges:[edge]},6,true).byType[edge.type])};
      }),
      facetMatches:faces.selected.map(({i,j,cost})=>({truthId:ref.faces[i].id,predictedIndex:j,iou:rounded(1-cost)})),
      missedFacets:faces.missed,extraFacets:faces.extra};
  } catch (error) {
    return {id:f.id,rasterSha256,error:String(error.message),edgeMatches:[],facetMatches:[],
      missedEdges:ref.edges.map(e=>e.id),missedFacets:ref.faces.map(f=>f.id),extraEdges:[],extraFacets:[]};
  }
}

function distribution(values) {
  const sorted=values.filter(Number.isFinite).sort((a,b)=>a-b), n=sorted.length;
  if (!n) return {n,median:null,p95:null,worst:null};
  return {n,median:rounded((sorted[Math.floor((n-1)/2)]+sorted[Math.floor(n/2)])/2),
    p95:sorted[Math.ceil(.95*n)-1],worst:sorted.at(-1)};
}
function summary(scenes) {
  const matches=scenes.flatMap(s=>s.edgeMatches);
  const count=key=>scenes.reduce((sum,s)=>sum+s[key].length,0);
  return {scenes:scenes.length,traceErrors:scenes.filter(s=>s.error).length,matchedEdges:matches.length,
    missedEdges:count('missedEdges'),extraEdges:count('extraEdges'),misclassifiedEdges:matches.filter(m=>m.expectedType!==m.predictedType).length,
    missingLengths:matches.filter(m=>m.absoluteErrorFt===null).length,
    matchedFacets:count('facetMatches'),missedFacets:count('missedFacets'),extraFacets:count('extraFacets'),
    absoluteEdgeErrorFt:distribution(matches.map(m=>m.absoluteErrorFt)),absoluteAreaErrorPct:distribution(scenes.map(s=>s.absoluteAreaErrorPct)),
    perEdgeType:Object.fromEntries(['eave','ridge','hip','rake'].map(t=>[t,distribution(matches.filter(m=>m.expectedType===t).map(m=>m.absoluteErrorFt))]))};
}

const baselineEngine=engine(baseline), currentEngine=engine();
const reports={};
for (const [name,version] of Object.entries({baseline:baselineEngine,integrated:currentEngine})) {
  const scenes=fixtures.map(f => evaluate(f,version.context));
  reports[name]={sourceSha256:version.sources,summary:summary(scenes),scenes};
}
assert.deepEqual(reports.baseline.scenes.map(s=>s.rasterSha256), reports.integrated.scenes.map(s=>s.rasterSha256));
const report={schema:1,scope:'Eight fixed synthetic, single-structure, unobstructed gable/hip roofs. No field accuracy, typing of valleys, wrong-building selection or untouched real holdout tested.',
  provenance:'Independent closed-form 3D vertices and source-local edges, seeded repository renderer, 0.1 m pixels; no customer data.',
  baseline,integratedHead:git(['rev-parse','HEAD']).trim(),fixtures,renderOptions,
  fixtureSha256:hash(JSON.stringify({fixtures,renderOptions,endpointToleranceM,minimumFacetIou})),
  method:{endpointToleranceM,minimumFacetIou,matching:'One-to-one greedy minimum of the worse of two reversible endpoint distances. Four raster pixels distinguish correspondences; type is scored after assignment. Facets maximize planar polygon IoU above 0.50.',
    length:'Sum emitted polyline segment lengths using the exact fitted edge factor via summarizeEngine(...,true). Includes matched, finite lines regardless of type; misses and extra lines are listed separately.',
    quantiles:'Median midpoint, nearest-rank p95, maximum. Absolute feet for individual edges and absolute percentage for whole-roof sloped area. Internal diagnostics only.'},reports};
const output=process.argv[2] || path.join(root,'docs/evaluation/edge-validation.json');
fs.writeFileSync(output,JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(Object.fromEntries(Object.entries(reports).map(([k,v])=>[k,v.summary])),null,2));
