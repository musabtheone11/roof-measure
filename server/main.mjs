import {fileURLToPath}from'node:url';
import{startRuntime}from'./http.mjs';
import{runRoofAgents,proposalFromAgents}from'./agents.mjs';
import{analyzeRoofModel,compareProposals}from'./geometry.mjs';
export function canonicalResult(result,input){
 const perspectiveIssues=(result.quality?.issues||[]).filter(issue=>issue.kind==='perspective');
 const model={measurementRestrictions:{perspective:perspectiveIssues.length>0,reasons:perspectiveIssues.map(issue=>issue.reason)},revision:input.revision,...proposalFromAgents(result.outline,result.structure),corrections:[]};
 const measured=analyzeRoofModel(model,input.imageMetadata,{revision:input.revision,provenance:result.provenance});
 return {...result,...measured,originalAI:result,status:'REVIEW REQUIRED'};
}
export async function serve(options={}){return startRuntime({...options,runAgents:async(input,opts)=>canonicalResult(await runRoofAgents(input,opts),input),compareTraces:compareProposals,measure:input=>analyzeRoofModel(input.model,input.imageMetadata,{revision:input.revision,provenance:input.model?.provenance})});}
if(process.argv[1]===fileURLToPath(import.meta.url)){const port=Number(process.env.PORT||3000);await serve({port,host:process.env.HOST||'127.0.0.1'});console.log('Roof runtime listening on port '+port);}
