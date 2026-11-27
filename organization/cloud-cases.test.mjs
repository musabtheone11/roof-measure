import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {generateCloudFixtures,analyticOracle,verifyCloudCase,runCloudCases} from './cloud-cases.mjs';

test('bounded deterministic fixtures keep every rendition of one roof in the same split',()=>{
  const fixtures=generateCloudFixtures({seed:73421,count:12});
  assert.deepEqual(fixtures,generateCloudFixtures({seed:73421,count:12}));
  assert.deepEqual([...new Set(fixtures.map(f=>f.split))],['development','validation','holdout']);
  for(let index=0;index<fixtures.length;index+=3) {
    const family=fixtures.slice(index,index+3);
    assert.equal(new Set(family.map(f=>f.split)).size,1);
    assert.equal(new Set(family.map(f=>f.propertyGroup)).size,1);
    assert.equal(new Set(family.map(f=>f.widthM)).size,1);
  }
  assert.throws(()=>generateCloudFixtures({seed:1,count:49}));
  assert.throws(()=>generateCloudFixtures({seed:-1,count:1}));
});
test('independent oracle uses closed-form metric geometry with explicit physical basis',()=>{
  const fixture={kind:'hip',lengthM:20,widthM:10,riseIn12:6,rotationDeg:0,propertyGroup:'known'};
  const oracle=analyticOracle(fixture);
  assert.ok(Math.abs(oracle.projectedAreaSqFt-200/.3048**2)<1e-9);
  assert.ok(Math.abs(oracle.slopedAreaSqFt-200*Math.sqrt(1.25)/.3048**2)<1e-9);
  assert.equal(oracle.edges.length,9);assert.equal(oracle.expectedFacetCount,4);
  assert.ok(Math.abs(oracle.edges.find(e=>e.id==='XY').lengthFt-10/.3048)<1e-9);
});
function perfectEvaluation(fixture) {
  const oracle=analyticOracle(fixture);
  return {candidateAreaSqFt:oracle.slopedAreaSqFt,edgeMatches:oracle.edges.map((edge,index)=>({truthId:edge.id,
    predictedType:edge.type,predictedFt:edge.lengthFt,predictedLineM:edge.endsM,predictedIndex:index})),
    facetMatches:oracle.facetIds.map((truthId,index)=>({truthId,predictedIndex:index,iou:1})),
    missedEdges:[],extraEdges:[],missedFacets:[],extraFacets:[]};
}
test('wrong candidate area/edge/type/missing output fails even if expected fields are forged',()=>{
  const fixture=generateCloudFixtures({seed:174,count:1})[0],perfect=perfectEvaluation(fixture);
  assert.equal(verifyCloudCase(fixture,perfect).diagnosticPass,true);
  for(const corrupt of [
    r=>{r.candidateAreaSqFt*=1.2;r.expectedAreaSqFt=r.candidateAreaSqFt;r.absoluteAreaErrorPct=0;},
    r=>{r.edgeMatches[0].predictedFt*=1.2;r.edgeMatches[0].expectedFt=r.edgeMatches[0].predictedFt;r.edgeMatches[0].absoluteErrorFt=0;},
    r=>{r.edgeMatches[0].predictedType='valley';},
    r=>{r.edgeMatches.pop();},
    r=>{r.extraEdges.push({type:'ridge'});},
    r=>{r.facetMatches[1].predictedIndex=r.facetMatches[0].predictedIndex;},
    r=>{r.facetMatches[1].truthId=r.facetMatches[0].truthId;},
    r=>{r.edgeMatches[0].predictedIndex=-1;},
    r=>{r.error='Actual tracing failed';},
  ]) {
    const result=structuredClone(perfect);corrupt(result);assert.equal(verifyCloudCase(fixture,result).diagnosticPass,false);
  }
});
test('actual unchanged tracer generates traceable customer PDFs and retains diagnostic-only edges without fake trace errors', {timeout:120000},async t=>{
  const directory=mkdtempSync(path.join(tmpdir(),'roof-cloud-cases-'));
  t.after(()=>rmSync(directory,{recursive:true,force:true}));
  const report=await runCloudCases({outputDir:directory,seed:20261127,count:3,sourceRevision:'test-source'});
  assert.equal(report.metrics.attempted,3);assert.equal(report.metrics.excludedCases,0);
  assert.equal(report.metrics.diagnosticPasses+report.metrics.reviewRequired,3);
  assert.equal(report.metrics.generatedCustomerPDFs,3);assert.equal(report.fieldValidatedProperties,0);
  assert.ok(report.metrics.extraDiagnosticObstructionEdges>0);
  assert.equal(report.metrics.extraRoofEdges+report.metrics.extraDiagnosticObstructionEdges,report.metrics.extraEdges);
  const obstructed=JSON.parse(readFileSync(path.join(directory,report.cases[2].artifacts.case.path),'utf8'));
  assert.equal(obstructed.evaluation.error,undefined);
  assert.ok(obstructed.evaluation.extraEdges.some(edge=>edge.type==='obstruction'&&edge.estimatedFt===null));
  assert.equal(obstructed.verification.diagnosticPass,false);
  let obstructionSegments=0,roofSegments=0;
  for(const record of report.cases) {
    assert.match(record.inputHash,/^[a-f0-9]{64}$/);
    const pdf=readFileSync(path.join(directory,record.artifacts.customerPDF.path));assert.equal(pdf.subarray(0,4).toString(),'%PDF');
    const data=JSON.parse(readFileSync(path.join(directory,record.artifacts.customerData.path),'utf8'));
    const evidence=JSON.parse(readFileSync(path.join(directory,record.artifacts.case.path),'utf8'));
    obstructionSegments+=evidence.evaluation.extraEdges.filter(edge=>edge.type==='obstruction').length;
    roofSegments+=evidence.evaluation.extraEdges.filter(edge=>edge.type!=='obstruction').length;
    assert.equal(data.status,'REVIEW REQUIRED');assert.equal('actualTracerOutput' in data,false);assert.equal('oracle' in data,false);
    if(!evidence.evaluation.error) {
      assert.ok(evidence.actualTracerOutput.facets.length>0);
      assert.ok(Math.abs(data.quantities.find(q=>q.name==='Sloped roof surface area').value-evidence.evaluation.candidateAreaSqFt)<=.005001);
    } else assert.equal(data.quantities.find(q=>q.name==='Sloped roof surface area').value,null);
  }
  assert.equal(report.metrics.extraDiagnosticObstructionEdges,obstructionSegments);
  assert.equal(report.metrics.extraRoofEdges,roofSegments);
  assert.equal(JSON.parse(readFileSync(path.join(directory,'summary.json'),'utf8')).fixtureHash,report.fixtureHash);
});
