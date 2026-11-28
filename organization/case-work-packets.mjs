// Trusted adapter: models receive only verified development artifacts. Original
// byte hashes are checked before stable measurement evidence is normalized.
import {readFileSync,lstatSync,realpathSync} from 'node:fs';
import {resolve,relative,isAbsolute} from 'node:path';
import {digest} from './workflow.mjs';
import {hashCaseWorkPacket} from './case-work-queue.mjs';

function artifactJSON(directory,entry) {
  if(!entry||typeof entry.path!=='string'||!Number.isSafeInteger(entry.bytes)||entry.bytes<1||entry.bytes>8*1024*1024||!(/^[a-f0-9]{64}$/).test(entry.sha256||''))throw new Error('CASE_WORK_ARTIFACT_MANIFEST_INVALID');
  const root=realpathSync(directory),file=resolve(root,entry.path),rel=relative(root,file);
  if(!rel||rel.startsWith('..')||isAbsolute(rel)||realpathSync(file)!==file||!lstatSync(file).isFile())throw new Error('CASE_WORK_ARTIFACT_PATH_INVALID');
  const bytes=readFileSync(file);
  if(bytes.length!==entry.bytes||digest(bytes)!==entry.sha256)throw new Error('CASE_WORK_ARTIFACT_HASH_MISMATCH');
  return JSON.parse(bytes);
}

export function buildCloudCaseWorkPackets({generated,outputDir,pdfResults,store}) {
  if(!generated||!Array.isArray(generated.cases)||!Array.isArray(pdfResults))throw new Error('CASE_WORK_CASE_EVIDENCE_REQUIRED');
  if(!store)throw new Error('CASE_WORK_RESTORED_STORE_REQUIRED');
  const manifest={schemaVersion:1,protocol:'cloud-case-work-membership-v1',measurementIdentity:{engineSourceHashes:generated.engineSourceHashes,generatorSourceSha256:generated.generatorSourceSha256},cases:generated.cases.map(c=>({caseId:c.id,propertyGroup:c.propertyGroup,split:c.split,inputHash:c.inputHash}))};
  const sourceManifestHash=store.putArtifact(Buffer.from(JSON.stringify(manifest))).hash;
  const seen=new Set();
  return generated.cases.filter(c=>c.split==='development').map(c=>{
    if(seen.has(c.id))throw new Error('CASE_WORK_DUPLICATE_CASE');seen.add(c.id);
    const record=artifactJSON(outputDir,c.artifacts?.case),report=artifactJSON(outputDir,c.artifacts?.customerData);
    if(record.split!=='development'||record.fixture?.id!==c.id||record.fixture?.propertyGroup!==c.propertyGroup||record.propertyGroup!==c.propertyGroup||record.fixture?.split!=='development'||record.inputHash!==c.inputHash||digest(JSON.stringify(record.verification))!==digest(JSON.stringify(c.verification)))throw new Error('CASE_WORK_CASE_BINDING_INVALID');
    if(!/^[a-f0-9]{64}$/.test(record.inputHash||'')||report.jobId!==c.id||report.status!=='REVIEW REQUIRED')throw new Error('CASE_WORK_SOURCE_EVIDENCE_INVALID');
    const matches=pdfResults.filter(p=>p.id===c.id);
    if(matches.length!==1)throw new Error('CASE_WORK_PDF_EVIDENCE_REQUIRED');
    const {id:pdfId,pdfSha256,dataSha256,textCharacters,...pdfReview}=matches[0];
    // Per-run pdf-verification.json retains original PDF/data hashes and text
    // counts. They vary with operator revision metadata, so only semantic
    // readback evidence participates in this measurement-work identity.
    // Source revision appears in generated JSON/PDF metadata, but changing the
    // operator must not turn the same measurement question into another charge.
    const caseHash=digest(JSON.stringify({fixture:record.fixture,inputHash:record.inputHash}));
    const stableRecord={...record};delete stableRecord.sourceRevision;
    const reportObservation={source:'Generated report output under test; not reference truth',status:report.status,quantities:report.quantities,notes:report.notes};
    const packet={schemaVersion:1,split:'development',caseId:c.id,propertyGroup:c.propertyGroup,caseHash,
      measurementSourceRevision:record.sourceRevision,sourceManifestHash,metrics:{scope:'development-only',attempted:1,diagnosticPasses:c.verification?.diagnosticPass?1:0,reviewRequired:c.verification?.diagnosticPass?0:1,traceFailures:record.evaluation?.error?1:0},
      pdfReview:{checked:1,failed:pdfReview.ok?0:1,...pdfReview},verification:c.verification,actual:c.actual,reportObservation,
      inputHashes:[caseHash,record.inputHash,sourceManifestHash,digest(JSON.stringify(stableRecord)),digest(JSON.stringify(reportObservation))]};
    return JSON.parse(JSON.stringify({...packet,packetHash:hashCaseWorkPacket(packet)}));
  });
}
