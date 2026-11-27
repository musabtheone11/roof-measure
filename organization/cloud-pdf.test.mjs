import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createRequire} from 'node:module';
import {renderCustomerPDF} from './customer-report.mjs';
import {verifyCloudPDF} from './cloud-pdf.mjs';
const {jsPDF}=createRequire(import.meta.url)('../vendor/jspdf/jspdf.umd.min.js');
const source=()=>({schemaVersion:1,jobId:'Generated test case',revision:'test-source',date:'Synthetic test / no field survey date',
  buildingScope:'Generated gable roof',status:'REVIEW REQUIRED',quantities:[
    {name:'Projected footprint area',value:1200.25,unit:'ft²',status:'inferred',source:'Synthetic DSM / inferred roof geometry'},
    {name:'Sloped roof surface area',value:1341.64,unit:'ft²',status:'inferred',source:'Synthetic DSM / inferred roof geometry'},
    {name:'Valley length',value:null,unit:'ft',status:'unknown',source:'Unsupported boundary'}],
  notes:['Generated analytic test case, not a customer property or field-verified measurement.','Unknown quantities require review.']});
function fixture(t,data=source(),pdf=renderCustomerPDF(data)) {
  const directory=mkdtempSync(join(tmpdir(),'roof-cloud-pdf-'));t.after(()=>rmSync(directory,{recursive:true,force:true}));
  const pdfPath=join(directory,'report.pdf'),dataPath=join(directory,'report.json');writeFileSync(pdfPath,pdf);writeFileSync(dataPath,JSON.stringify(data));
  return {pdfPath,dataPath};
}
test('real generated customer PDF has matching quantities, Letter bounds and no imagery/drawing',async t=>{
  const paths=fixture(t),result=await verifyCloudPDF(paths);
  assert.equal(result.ok,true,JSON.stringify(result.issues));assert.equal(result.pages,1);
  assert.equal(result.imageryCount,0);assert.equal(result.vectorOperationCount,0);assert.equal(result.quantityRowsChecked,3);
  assert.match(result.pdfSha256,/^[a-f0-9]{64}$/);assert.match(result.scope,/not physical measurement/);
});
test('altered numeric values, units, statuses, metadata and missing notes fail independent readback',async t=>{
  const data=source(),pdf=renderCustomerPDF(data);
  for(const change of [
    d=>{d.quantities[0].value=1201.25;},d=>{d.quantities[0].unit='m²';},d=>{d.quantities[0].status='measured';},
    d=>{d.quantities[2].value=0;d.quantities[2].status='inferred';},d=>{d.revision='another';},d=>{d.notes.push('Missing source evidence.');}
  ]) {
    const altered=structuredClone(data);change(altered);const paths=fixture(t,altered,pdf),result=await verifyCloudPDF(paths);
    assert.equal(result.ok,false);assert.ok(result.issues.some(i=>/MISMATCH/.test(i.code)));
  }
});
test('added vector roof-like drawing and image are rejected by text-only artifact contract',async t=>{
  const data=source();
  // jsPDF cannot reopen a PDF, so emit a fresh valid text report and an explicit
  // drawing/image. Missing row findings are independent of the operator checks.
  for(const type of ['vector','image']) {
    const doc=new jsPDF({unit:'pt',format:'letter'});doc.text('REVIEW REQUIRED',54,54);
    if(type==='vector')doc.lines([[30,0],[0,30],[-30,-30]],54,100,[1,1],'S',true);
    else doc.addImage('data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZbWQAAAAASUVORK5CYII=','PNG',54,100,20,20);
    const paths=fixture(t,data,Buffer.from(doc.output('arraybuffer'))),result=await verifyCloudPDF(paths);
    assert.equal(result.ok,false);assert.ok(result.issues.some(i=>i.code===(type==='vector'?'VECTOR_DRAWING_IN_TEXT_ONLY_REPORT':'IMAGERY_IN_TEXT_ONLY_REPORT')));
  }
});
test('off-page text, undersized font and wrong page dimensions fail layout checks',async t=>{
  const data=source(),doc=new jsPDF({unit:'pt',format:'a4'});doc.setFontSize(5);doc.text('Small text',54,54);doc.text('REVIEW REQUIRED',610,790);
  const result=await verifyCloudPDF(fixture(t,data,Buffer.from(doc.output('arraybuffer'))));
  assert.equal(result.ok,false);assert.ok(result.issues.some(i=>i.code==='PAGE_NOT_PORTRAIT_LETTER'));
  assert.ok(result.issues.some(i=>i.code==='TEXT_TOO_SMALL'));assert.ok(result.issues.some(i=>i.code==='CLIPPED_TEXT'));
});
test('invisible rendering and white-on-white text fail readable-report checks',async t=>{
  for(const kind of ['white','invisible']) {
    const doc=new jsPDF({unit:'pt',format:'letter'});
    if(kind==='white')doc.setTextColor(255);
    doc.text('REVIEW REQUIRED',54,54,kind==='invisible'?{renderingMode:'invisible'}:{});
    const result=await verifyCloudPDF(fixture(t,source(),Buffer.from(doc.output('arraybuffer'))));
    assert.equal(result.ok,false);assert.ok(result.issues.some(i=>i.code===(kind==='white'?'LOW_TEXT_CONTRAST':'UNSUPPORTED_TEXT_RENDERING_MODE')));
  }
});
test('parser cancellation, malformed PDF, data type and deadline limits fail visibly',async t=>{
  const paths=fixture(t),abort=new AbortController();abort.abort();
  assert.equal((await verifyCloudPDF({...paths,signal:abort.signal})).issues[0].code,'CANCELLED');
  await assert.rejects(verifyCloudPDF({...paths,timeoutMs:45001}));
  assert.equal((await verifyCloudPDF({...paths,timeoutMs:1})).issues[0].code,'PDF_VERIFICATION_TIMEOUT');
  writeFileSync(paths.pdfPath,'not a PDF');assert.equal((await verifyCloudPDF(paths)).ok,false);
  writeFileSync(paths.dataPath,JSON.stringify({...source(),quantities:[{...source().quantities[0],value:-1}]}));
  assert.equal((await verifyCloudPDF(paths)).issues[0].code,'INVALID_CUSTOMER_DATA');
});
