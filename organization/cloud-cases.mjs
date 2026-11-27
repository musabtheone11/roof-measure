// Self-contained synthetic checks. Oracle formulas never read tracer output.
import {createHash} from 'node:crypto';
import {mkdirSync,readFileSync,writeFileSync,renameSync,lstatSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {loadEngine} from '../bench/engine.mjs';
import {evaluate,summary as summarizeEvaluations} from '../bench/edge-validation.mjs';
import {rng} from '../bench/synth.mjs';
import {summarizeEngine} from '../bench/score.mjs';
import {propertySplit} from './references.mjs';
import {renderCustomerPDF} from './customer-report.mjs';

const ROOT=fileURLToPath(new URL('../',import.meta.url));
const FT=1/0.3048, SQFT=FT*FT;
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
const clean=value=>JSON.parse(JSON.stringify(value));
export const CLOUD_CASE_POLICY=Object.freeze({id:'synthetic-diagnostic-v1',areaRelativeTolerance:.05,
  individualEdgeRelativeTolerance:.05,endpointCorrespondenceToleranceM:.40,minimumFacetIoU:.50,
  requireExactInventory:true,commercialAccuracyAcceptance:false,exclusions:0});

export function generateCloudFixtures({seed,count=12}={}) {
  if(!Number.isInteger(seed)||seed<0||seed>0xffffffff)throw new Error('Explicit unsigned 32-bit seed required');
  if(!Number.isInteger(count)||count<1||count>48)throw new Error('Cloud batch count must be 1..48');
  const fixtures=[];
  for(let i=0;i<count;i++) {
    const family=Math.floor(i/3),variant=i%3;
    const familySeed=Number.parseInt(digest(`roof-cloud-v1:${seed}:${family}`).slice(0,8),16);
    const random=rng(familySeed),widthM=random.range(7,11),lengthM=widthM+random.range(5,12);
    const propertyGroup=`synthetic-roof-v1:${seed}:${family}`;
    const options=variant===0?{noise:.015,blur:.6,hard:false,clutter:false,trees:0}:
      variant===1?{noise:.05,blur:2,hard:true,clutter:false,trees:0}:
        {noise:.035,blur:1,hard:false,clutter:true,trees:2};
    fixtures.push({id:`roof-${String(family).padStart(3,'0')}-${variant}`,propertyGroup,
      split:['development','development','validation','holdout'][family] || propertySplit(propertyGroup,'cloud-roof-property-split-v1'),family,variant,
      difficulty:['clear','noisy-blurred','obstructed-clutter'][variant],kind:family%2?'hip':'gable',
      widthM,lengthM,riseIn12:random.pick([4,6,8,10,12]),rotationDeg:random.range(0,180),
      seed:(familySeed+variant*104729)>>>0,options,sourceKind:'analytic-synthetic',scaleMPerPixel:.1});
  }
  return fixtures;
}

// Independently defined box geometry: no renderer masks, fitted planes, report
// output, benchmark expected fields, or model answers enter these formulas.
export function analyticOracle(fixture) {
  const {lengthM:L,widthM:W,riseIn12:p,rotationDeg:degrees}=fixture;
  if(!['gable','hip'].includes(fixture.kind)||![L,W,p,degrees].every(Number.isFinite)||L<=W||W<=0||p<=0)
    throw new Error('Unsupported analytic roof dimensions');
  const halfL=L/2,halfW=W/2,s=p/12,hip=fixture.kind==='hip',ridgeHalf=hip?halfL-halfW:halfL;
  const vertices={A:[-halfL,-halfW,0],B:[halfL,-halfW,0],C:[halfL,halfW,0],D:[-halfL,halfW,0],
    X:[-ridgeHalf,0,halfW*s],Y:[ridgeHalf,0,halfW*s]};
  const theta=degrees*Math.PI/180;
  const projected=key=>{const [x,y]=vertices[key];return [x*Math.cos(theta)-y*Math.sin(theta),x*Math.sin(theta)+y*Math.cos(theta)];};
  const types=hip?{eave:['AB','BC','CD','DA'],ridge:['XY'],hip:['AX','DX','BY','CY']}:
    {eave:['AB','CD'],ridge:['XY'],rake:['AX','DX','BY','CY']};
  const edges=Object.entries(types).flatMap(([type,ids])=>ids.map(id=>({id,type,
    lengthFt:Math.hypot(...vertices[id[0]].map((value,i)=>value-vertices[id[1]][i]))*FT,
    endsM:[projected(id[0]),projected(id[1])]})));
  return {schemaVersion:1,kind:'closed-form-synthetic-oracle',propertyGroup:fixture.propertyGroup,
    projectedAreaSqFt:L*W*SQFT,slopedAreaSqFt:L*W*Math.sqrt(1+s*s)*SQFT,
    expectedFacetCount:hip?4:2,facetIds:hip?['ABYX','DCYX','ADX','BCY']:['ABYX','DCYX'],edges,pitchRiseIn12:p,
    physicalBasis:'Generated metric DSM at exactly 0.1 m/pixel; no real property or imagery'};
}

function endpointError(expected,line) {
  if(!Array.isArray(line)||line.length<2||line.some(p=>!Array.isArray(p)||p.length!==2||!p.every(Number.isFinite)))return Infinity;
  const distance=(a,b)=>Math.hypot(a[0]-b[0],a[1]-b[1]);
  return Math.min(Math.max(distance(expected[0],line[0]),distance(expected[1],line.at(-1))),
    Math.max(distance(expected[0],line.at(-1)),distance(expected[1],line[0])));
}
export function verifyCloudCase(fixture,evaluation,policy=CLOUD_CASE_POLICY) {
  const oracle=analyticOracle(fixture),issues=[];
  const issue=(code,detail)=>issues.push({code,detail});
  if(!evaluation||typeof evaluation!=='object'||Array.isArray(evaluation)) { issue('INVALID_EVALUATION','Expected structured trace evaluation'); evaluation={}; }
  if(evaluation.error)issue('TRACE_ERROR',evaluation.error);
  const area=evaluation.candidateAreaSqFt;
  const areaErrorPct=Number.isFinite(area)?100*Math.abs(area-oracle.slopedAreaSqFt)/oracle.slopedAreaSqFt:null;
  if(areaErrorPct===null||areaErrorPct>100*policy.areaRelativeTolerance)issue('AREA_OUTSIDE_DIAGNOSTIC_TOLERANCE',{actualSqFt:area??null,expectedSqFt:oracle.slopedAreaSqFt});
  const matches=Array.isArray(evaluation.edgeMatches)?evaluation.edgeMatches.filter(m=>m&&typeof m==='object'&&!Array.isArray(m)):[],edgeErrors=[];
  if(!Array.isArray(evaluation.edgeMatches)||matches.length!==evaluation.edgeMatches.length)issue('INVALID_EDGE_MATCH_EVIDENCE','Malformed or missing edge matches');
  const seen=new Set();
  for(const edge of oracle.edges) {
    const matchesForEdge=matches.filter(m=>m.truthId===edge.id);
    if(matchesForEdge.length!==1){issue('MISSING_OR_DUPLICATE_EDGE',edge.id);continue;}
    const match=matchesForEdge[0];
    if(!Number.isInteger(match.predictedIndex)||match.predictedIndex<0)issue('INVALID_PREDICTED_EDGE_INDEX',edge.id);
    if(seen.has(match.predictedIndex))issue('REUSED_PREDICTED_EDGE',match.predictedIndex);
    seen.add(match.predictedIndex);
    if(match.predictedType!==edge.type)issue('EDGE_TYPE_MISMATCH',{edge:edge.id,expected:edge.type,actual:match.predictedType});
    const endpointM=endpointError(edge.endsM,match.predictedLineM);
    if(endpointM>policy.endpointCorrespondenceToleranceM)issue('EDGE_CORRESPONDENCE_OUTSIDE_TOLERANCE',{edge:edge.id,errorM:endpointM});
    const difference=Number.isFinite(match.predictedFt)?Math.abs(match.predictedFt-edge.lengthFt):null;
    edgeErrors.push({edgeId:edge.id,type:edge.type,actualFt:match.predictedFt??null,expectedFt:edge.lengthFt,
      absoluteErrorFt:difference,relativeErrorPct:difference===null?null:100*difference/edge.lengthFt});
    if(difference===null||difference>edge.lengthFt*policy.individualEdgeRelativeTolerance)issue('EDGE_LENGTH_OUTSIDE_DIAGNOSTIC_TOLERANCE',edge.id);
  }
  if(matches.some(m=>!oracle.edges.some(e=>e.id===m.truthId)))issue('UNKNOWN_EXPECTED_EDGE','Evaluation contains unsupported expected edge identity');
  for(const key of ['missedEdges','extraEdges','missedFacets','extraFacets']) {
    if(!Array.isArray(evaluation[key]))issue('MISSING_INVENTORY_EVIDENCE',key);
    else if(evaluation[key].length)issue(key.toUpperCase(),evaluation[key]);
  }
  const facetMatches=Array.isArray(evaluation.facetMatches)?evaluation.facetMatches.filter(m=>m&&typeof m==='object'&&!Array.isArray(m)):[];
  if(!Array.isArray(evaluation.facetMatches)||facetMatches.length!==evaluation.facetMatches.length)issue('INVALID_FACET_MATCH_EVIDENCE','Malformed or missing facet matches');
  if(facetMatches.length!==oracle.expectedFacetCount)
    issue('FACET_COUNT_MISMATCH',{expected:oracle.expectedFacetCount,matched:evaluation.facetMatches?.length??null});
  const facetIndices=new Set(),facetIds=new Set();
  for(const facet of facetMatches) {
    if(!Number.isInteger(facet.predictedIndex)||facet.predictedIndex<0)issue('INVALID_PREDICTED_FACET_INDEX',facet.predictedIndex);
    if(facetIndices.has(facet.predictedIndex))issue('REUSED_PREDICTED_FACET',facet.predictedIndex);
    facetIndices.add(facet.predictedIndex);
    if(!oracle.facetIds.includes(facet.truthId)||facetIds.has(facet.truthId))issue('INVALID_OR_DUPLICATE_FACET_IDENTITY',facet.truthId??null);
    facetIds.add(facet.truthId);
  }
  if(facetMatches.some(m=>!Number.isFinite(m.iou)||m.iou<=policy.minimumFacetIoU))issue('FACET_CORRESPONDENCE_OUTSIDE_TOLERANCE','Missing or insufficient facet IoU');
  return {schemaVersion:1,oracleVersion:'closed-form-roof-v1',policyVersion:policy.id,
    diagnosticPass:issues.length===0,commercialAccuracyAcceptance:false,areaAbsoluteErrorPct:areaErrorPct,
    individualEdges:edgeErrors,issues};
}

function projectedArea(output) {
  let area=0;
  for(const facet of output.facets) {
    const points=facet.poly;
    if(!Array.isArray(points)||points.length<3)return null;
    area+=Math.abs(points.reduce((sum,[x,y],i)=>sum+x*points[(i+1)%points.length][1]-y*points[(i+1)%points.length][0],0))/2;
  }
  return Number.isFinite(area)&&output.facets.length?area*SQFT:null;
}
function reportFromCandidate(fixture,evaluation,output,verification,sourceRevision) {
  const failed=!!evaluation.error||!output;
  const measured=failed?null:summarizeEngine(output,6,true);
  const quantity=(name,value,unit)=>({name,value:Number.isFinite(value)&&value>=0?Number(value.toFixed(2)):null,unit,
    status:Number.isFinite(value)&&value>=0?'inferred':'unknown',source:'Generated metric source / inferred roof geometry'});
  const typeFt=type=>!failed&&output.edges.some(e=>e.type===type)?measured.byType[type]:null;
  const sloped=measured?.sloped;
  return {schemaVersion:1,jobId:fixture.id,revision:sourceRevision,date:'Synthetic test / no field survey date',
    buildingScope:`Generated ${fixture.kind} roof; ${fixture.difficulty}; no real property`,status:'REVIEW REQUIRED',
    quantities:[quantity('Projected footprint area',failed?null:projectedArea(output),'ft²'),
      quantity('Sloped roof surface area',sloped,'ft²'),quantity('Roof squares (100 ft²)',Number.isFinite(sloped)?sloped/100:null,'squares'),
      quantity('Predominant fitted pitch',measured?.predominant,'rise / 12'),
      ...['eave','rake','ridge','hip','valley'].map(type=>quantity(type[0].toUpperCase()+type.slice(1)+' length',typeFt(type),'ft'))],
    notes:['Synthetic example only; no real property or field verification.',
      'Measurements are provisional and derived from the generated metric source and inferred roof geometry.',
      'Sloped area uses fitted pitch. Unavailable measurements remain unknown.',
      verification.diagnosticPass?'Independent checks are within this synthetic test\'s tolerances; review is still required.':'Independent checks found measurements requiring review.',
      'An unavailable edge measurement does not establish zero length.']};
}
function artifact(directory,name,bytes) {
  const destination=path.join(directory,name),data=Buffer.isBuffer(bytes)?bytes:Buffer.from(JSON.stringify(bytes,null,2)+'\n');
  const temporary=`${destination}.${process.pid}.tmp`;
  writeFileSync(temporary,data,{mode:0o600});renameSync(temporary,destination);
  return {path:name,sha256:digest(data),bytes:data.length};
}
function engineSourceHashes() {
  return Object.fromEntries(['autotrace.js','autotrace2.js','obstruction.js','bench/engine.mjs','bench/edge-validation.mjs','bench/score.mjs','bench/synth.mjs']
    .map(file=>[file,digest(readFileSync(path.join(ROOT,file)))]));
}
export async function runCloudCases({outputDir,seed,count=12,sourceRevision}={}) {
  if(typeof outputDir!=='string'||!outputDir||typeof sourceRevision!=='string'||!sourceRevision.trim()||sourceRevision.length>200)
    throw new Error('Explicit output directory and bounded source revision required');
  const fixtures=generateCloudFixtures({seed,count}),directory=path.resolve(outputDir);
  mkdirSync(directory,{recursive:true,mode:0o700});
  if(lstatSync(directory).isSymbolicLink())throw new Error('Artifact output directory cannot be a symlink');
  const context=loadEngine(),originalTrace=context.traceBuildingV2;
  let captured;
  context.traceBuildingV2=function(...args){captured=originalTrace.apply(this,args);return captured;};
  const records=[],evaluations=[];
  for(const fixture of fixtures) {
    captured=null;
    const evaluation=evaluate(fixture,context,fixture.options);
    const output=captured?clean({facets:captured.facets,edges:captured.edges}):null;
    const oracle=analyticOracle(fixture),verification=verifyCloudCase(fixture,evaluation);
    const report=reportFromCandidate(fixture,evaluation,output,verification,sourceRevision);
    const record={schemaVersion:1,sourceRevision,fixture,inputHash:evaluation.rasterSha256,
      propertyGroup:fixture.propertyGroup,split:fixture.split,evaluation,actualTracerOutput:output,verification};
    const candidateSummary=evaluation.error||!output?null:summarizeEngine(output,6,true);
    const artifacts={case:artifact(directory,fixture.id+'.case.json',record),
      oracle:artifact(directory,fixture.id+'.oracle.json',oracle),
      customerData:artifact(directory,fixture.id+'.report.json',report),
      customerPDF:artifact(directory,fixture.id+'.pdf',renderCustomerPDF(report))};
    evaluations.push(evaluation);
    records.push({id:fixture.id,propertyGroup:fixture.propertyGroup,split:fixture.split,difficulty:fixture.difficulty,kind:fixture.kind,
      inputHash:evaluation.rasterSha256,diagnosticPass:verification.diagnosticPass,issues:verification.issues,verification,
      actual:{slopedAreaSqFt:candidateSummary?.sloped??null,projectedAreaSqFt:output&&!evaluation.error?projectedArea(output):null,
        facetCount:candidateSummary?.facetCount??null,edgeTotalsFt:candidateSummary?.byType??null,predominantPitch:candidateSummary?.predominant??null},
      error:evaluation.error||null,artifacts});
  }
  const extraSegments=evaluations.flatMap(e=>e.extraEdges||[]);
  const summary={schemaVersion:1,sourceRevision,seed,count,fixtureHash:digest(JSON.stringify(fixtures)),
    policy:CLOUD_CASE_POLICY,sourceKind:'analytic-synthetic',engineSourceHashes:engineSourceHashes(),
    generatorVersion:'cloud-cases-v1',generatorSourceSha256:digest(readFileSync(fileURLToPath(import.meta.url))),
    splitMethod:'First four immutable property-family slots: development/development/validation/holdout (small cohort 50/25/25). Additional families use a frozen 70/15/15 hash. Every rendition remains with its property family.',
    holdoutStatus:'Generated diagnostic split, not independently field-verified or a claim of an untouched real-property holdout. Small batches have limited roof-type coverage.',
    scope:'Generated single-wing gable/hip roofs with clear, noisy/blurred and tree/clutter renditions; analytic test evidence only, not real-property accuracy.',
    execution:'Actual unchanged browser traceBuildingV2 in Node VM; deterministic app-rule report-number helper. Not full browser/UI execution.',
    oracle:'Independent closed-form box vertices, pitch surface area and individual 3D edge lengths; never generated report/model agreement.',
    extraEdgeAccounting:'extraEdges retains all unmatched emitted segments. extraDiagnosticObstructionEdges identifies diagnostic-only obstruction segments with no physical length; extraRoofEdges is the remaining partition. Diagnostic failures and tolerances are unchanged.',
    commercialAccuracyAcceptance:false,fieldValidatedProperties:0,referenceSource:'Generated local/cloud fixtures; no Windows Downloads or customer documents',
    metrics:{attempted:records.length,traceFailures:records.filter(r=>r.error).length,
      diagnosticPasses:records.filter(r=>r.diagnosticPass).length,reviewRequired:records.filter(r=>!r.diagnosticPass).length,
      generatedCustomerPDFs:records.length,excludedCases:0,propertyFamilies:new Set(records.map(r=>r.propertyGroup)).size,
      extraDiagnosticObstructionEdges:extraSegments.filter(edge=>edge.type==='obstruction').length,
      extraRoofEdges:extraSegments.filter(edge=>edge.type!=='obstruction').length,
      splits:Object.fromEntries(['development','validation','holdout'].map(split=>[split,{cases:records.filter(r=>r.split===split).length,
        propertyFamilies:new Set(records.filter(r=>r.split===split).map(r=>r.propertyGroup)).size}])),
      ...summarizeEvaluations(evaluations)},cases:records};
  artifact(directory,'summary.json',summary);
  return summary;
}
