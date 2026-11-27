import {fileURLToPath}from'node:url';
import{startRuntime}from'./http.mjs';
import{runRoofAgents,proposalFromAgents}from'./agents.mjs';
import{analyzeRoofModel,compareProposals}from'./geometry.mjs';
export function canonicalResult(result,input){
 const perspectiveIssues=(result.quality?.issues||[]).filter(issue=>issue.kind==='perspective');
 const priors=[result.sourceRestrictions,input.imageMetadata?.sourceRestrictions];
 const reasons=[...new Set([...priors.flatMap(prior=>Array.isArray(prior?.reasons)?prior.reasons:[]),...perspectiveIssues.map(issue=>issue.reason)])].slice(0,100);
 const model={measurementRestrictions:{perspective:priors.some(prior=>prior?.perspective===true)||perspectiveIssues.length>0,reasons},revision:input.revision,...proposalFromAgents(result.outline,result.structure),corrections:[]};
 const measured=analyzeRoofModel(model,input.imageMetadata,{revision:input.revision,provenance:result.provenance});
 return {...result,...measured,originalAI:result,status:'REVIEW REQUIRED'};
}
export async function serve(options={}){return startRuntime({stateFile:process.env.ROOF_STATE_DB||fileURLToPath(new URL('../.devcache/runtime/jobs.sqlite',import.meta.url)),...options,runAgents:async(input,opts)=>canonicalResult(await runRoofAgents(input,opts),input),compareTraces:compareProposals,measure:input=>analyzeRoofModel(input.model,input.imageMetadata,{revision:input.revision,provenance:input.model?.provenance})});}
if(process.argv[1]===fileURLToPath(import.meta.url)){
 const port=Number(process.env.PORT||3000),host=process.env.HOST||'127.0.0.1';
 if(!['localhost','127.0.0.1','::1'].includes(host))throw Error('Use start:private-preview with authentication for a network listener.');
 await serve({port,host});console.log('Roof runtime listening on port '+port);
}
