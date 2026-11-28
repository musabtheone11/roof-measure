import http from 'node:http';
import {validateBudget} from './contracts.mjs';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {openJobStore} from './job-store.mjs';
const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const TYPES={'.mjs':'application/javascript','.wasm':'application/wasm','.html':'text/html; charset=utf-8','.js':'application/javascript','.css':'text/css','.png':'image/png','.svg':'image/svg+xml','.jpg':'image/jpeg','.json':'application/json'};
function sourceReceipt(input) {
 const m=input.imageMetadata;
 if(!m || typeof input.image!=='string' || !/^data:image\/(png|jpeg|webp);base64,/.test(input.image))return {};
 const data=Buffer.from(input.image.slice(input.image.indexOf(',')+1),'base64');
 const target=m.targetPixel;
 if(target!=null && (!Array.isArray(target)||target.length!==2||!target.every(Number.isFinite)))return {};
 if(!['orthographic','oblique','unknown'].includes(m.view) ||
    !['photo','roof-sketch','document'].includes(m.purpose??'photo') ||
    ![0,90,180,270].includes(m.rotation??0) || !Number.isInteger(m.sourcePage??1))return {};
 return {sourceHash:crypto.createHash('sha256').update(data).digest('hex'),sourceSettings:{
   targetPixel:target??null,sourcePage:m.sourcePage??1,rotation:m.rotation??0,purpose:m.purpose??'photo',view:m.view
 }};
}
export async function startRuntime({port=3000,host='127.0.0.1',runAgents,measure,compareTraces,apiKey=process.env.APINEX_API_KEY,root=ROOT,stateFile,modelConfig}={}) {
 const store=stateFile ? openJobStore(stateFile,root) : null;
 let lastPrune=Date.now();
 store?.prune(lastPrune);
 const jobs=store?.load('job') ?? new Map(),sessions=store?.load('session') ?? new Map();
 const requests=store?.load('request') ?? new Map(),uploads=new Map();
 for (const job of jobs.values()) {
   job.controller=new AbortController();
   if (job.status==='running') {
     job.status='failed';
     job.error={code:'INTERRUPTED',message:'The server restarted during analysis. Previously dispatched requests may be billed. Review this job before starting another analysis.'};
     store.save('job',job.id,job);
   }
 }
 const nonceOK=value=>typeof value==='string'&&/^[a-f0-9-]{16,80}$/i.test(value);
 const recordFor=(owner,nonce,create=false)=>{const key=owner+':'+nonce;let record=requests.get(key);if(!record&&create){if(requests.size>=5000)throw Object.assign(Error('Request history is full. Retry after older requests expire.'),{status:429});record={created:Date.now(),cancelled:false};requests.set(key,record);}return record;};
 const server=http.createServer(async(req,res)=>{
  let url;try{url=new URL(req.url,'http://'+req.headers.host);}catch{res.writeHead(400,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify({error:'Invalid request URL.'}));req.resume();return;}
  let uploadToken=null,creationRecord=null;
  const send=(status,data)=>{if(status>=400&&uploadToken&&creationRecord&&!creationRecord.jobId&&!creationRecord.cancelled)creationRecord.failed=true;res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(data));};
  const now=Date.now();if(store&&now-lastPrune>=60000){store.prune(now);lastPrune=now;}
  for(const[id,j]of jobs)if(now-j.created>900000){j.controller.abort();jobs.delete(id);}for(const[id,s]of sessions)if(now-s.created>3600000)sessions.delete(id);
  for(const[key,r]of requests)if(now-r.created>900000)requests.delete(key);
  let sid=/roof_session=([a-f0-9]+)/.exec(req.headers.cookie||'')?.[1],session=sessions.get(sid);
  if(!session){if(sessions.size>=200)return send(503,{error:'Preview session capacity reached. Try again later.'});sid=crypto.randomBytes(24).toString('hex');session={created:now,csrf:crypto.randomBytes(24).toString('hex')};sessions.set(sid,session);res.setHeader('Set-Cookie',`roof_session=${sid}; HttpOnly; SameSite=Strict; Path=/`);}
  if(url.pathname.startsWith('/api/')) {
   if(['POST','DELETE'].includes(req.method)){
    if(req.headers['x-roof-csrf']!==session.csrf)return send(403,{error:'Reload the page before processing this image.'});
    const origin=req.headers.origin;if(origin&&origin!==process.env.PUBLIC_ORIGIN&&origin!=='http://'+req.headers.host&&origin!=='https://'+req.headers.host)return send(403,{error:'Request origin is not allowed.'});
   }
   try{
    const requestMatch=/^\/api\/ai\/requests\/([a-f0-9-]{16,80})$/i.exec(url.pathname);
    if(requestMatch&&['GET','DELETE'].includes(req.method)){
     const record=recordFor(sid,requestMatch[1],req.method==='DELETE');if(!record)return send(404,{error:'Processing request not found.'});
     const job=record.jobId?jobs.get(record.jobId):null;
     if(req.method==='DELETE'){record.cancelled=true;if(job?.status==='running'){job.controller.abort();job.status='cancelled';store?.save('job',job.id,job);}store?.save('session',sid,session);store?.save('request',sid+':'+requestMatch[1],record);return send(200,{status:job?.status||'cancelled',cancellationRequested:true,jobId:record.jobId});}
     return send(200,{status:job?.status||(record.cancelled?'cancelled':record.failed?'failed':record.jobId?'expired':'creating'),jobId:record.jobId,revision:job?.revision,sourceHash:job?.sourceHash,sourceSettings:job?.sourceSettings});
    }
    if(req.method==='GET'&&url.pathname==='/api/ai/config')return send(200,{available:!!apiKey,csrfToken:session.csrf,models:{quality:'claude-opus-5.5',outline:'claude-opus-5.5',structure:'gpt-6.2-astra',independent:'gpt-6.2-astra',adjudication:'claude-opus-5.5'},pricing:{'claude-opus-5.5':{inputPerMillion:0.5,outputPerMillion:0.5},'gpt-6.2-astra':{inputPerMillion:0.5,outputPerMillion:0.5}},limits:{maxRequests:8,maxTokens:6000000,maxCostUsd:2,maxUsd:2},...modelConfig,pricingSource:'https://apinex.bond/pricing.md'});
    const read=async()=>{const chunks=[];let size=0;for await(const b of req){size+=b.length;if(size>12*1024*1024)throw Object.assign(Error('Image request exceeds 12 MB.'),{status:413});chunks.push(b);}try{return JSON.parse(Buffer.concat(chunks));}catch{throw Object.assign(Error('Request must be valid JSON.'),{status:400});}};
    if(req.method==='POST'&&url.pathname==='/api/ai/measure'){const x=await read();return send(200,await measure(x));}
    if(req.method==='POST'&&url.pathname==='/api/ai/trace'){
     if(!apiKey)return send(503,{error:'APINEX is not configured on this server.'});
     const nonce=req.headers['x-roof-request-id'];if(nonce!==undefined&&!nonceOK(nonce))return send(400,{error:'Invalid processing request ID.'});
     if(nonce){creationRecord=recordFor(sid,nonce);if(creationRecord?.cancelled){req.resume();return send(409,{error:'This request was cancelled. Start a new analysis.',code:'CANCELLED'});}}
     const recovering=!!creationRecord?.jobId;
     if(!recovering&&([...jobs.values()].filter(j=>j.status==='running').length>=2||[...jobs.values()].some(j=>j.owner===sid&&j.status==='running'))){req.resume();return send(429,{error:'A roof is already processing. Wait or cancel it before starting another.'});}
     if(!recovering&&jobs.size>=30){req.resume();return send(429,{error:'Processing history is full. Try again after older jobs expire.'});}
     if(uploads.size>=2||[...uploads.values()].includes(sid)){req.resume();return send(429,{error:'An image upload is already being received. Wait or cancel it before starting another.'});}
     uploadToken=crypto.randomUUID();uploads.set(uploadToken,sid);if(nonce){creationRecord=recordFor(sid,nonce,true);creationRecord.failed=false;}
     const input=await read();if(input.consentExternal!==true)return send(400,{error:'Confirm authorization to send this image for external processing.'});
     if(input.budget!==undefined)validateBudget(input.budget);
     if(creationRecord?.cancelled)return send(409,{error:'This request was cancelled. Start a new analysis.',code:'CANCELLED'});
     const fingerprint=crypto.createHash('sha256').update(JSON.stringify(input)).digest('hex');
     if(creationRecord?.bodyHash&&creationRecord.bodyHash!==fingerprint)return send(409,{error:'This request ID belongs to a different image or revision. Start a new analysis.'});
     if(creationRecord?.jobId){if(!jobs.has(creationRecord.jobId))return send(410,{error:'This processing request expired. Start a new analysis.'});return send(202,{jobId:creationRecord.jobId});}
     // Recheck after awaiting the body, immediately before synchronous insertion.
     if([...jobs.values()].filter(j=>j.status==='running').length>=2||[...jobs.values()].some(j=>j.owner===sid&&j.status==='running'))return send(429,{error:'A roof is already processing. Wait or cancel it before starting another.'});
     if(jobs.size>=30)return send(429,{error:'Processing history is full. Try again after older jobs expire.'});
     input.budget={...input.budget,maxRequests:Math.min(8,input.budget?.maxRequests??8),maxTokens:Math.min(6000000,input.budget?.maxTokens??6000000),maxUsd:Math.min(2,input.budget?.maxUsd??input.budget?.maxCostUsd??2)};
     delete input.budget.maxCostUsd;
     const id=crypto.randomUUID(),controller=new AbortController(),job={id,owner:sid,created:now,status:'running',progress:[],revision:input.revision,controller};jobs.set(id,job);if(creationRecord){creationRecord.bodyHash=fingerprint;creationRecord.jobId=id;creationRecord.failed=false;job.requestKey=sid+':'+nonce;}
     if(creationRecord)Object.assign(job,sourceReceipt(input));
     try { store?.admit(job,session,creationRecord); }
     catch { jobs.delete(id); if(creationRecord)delete creationRecord.jobId; return send(503,{error:'Could not save this job. No analysis was started.'}); }
     Promise.resolve().then(()=>runAgents(input,{apiKey,signal:controller.signal,compareTraces,onProgress:event=>job.progress.push(event),isCurrent:revision=>job.status==='running'&&job.revision===revision})).then(result=>{
       if(controller.signal.aborted)return;
       job.result=result;job.status='completed';
       store?.save('job',id,job);
     }).catch(err=>{
       if(controller.signal.aborted)return;
       delete job.result;job.status='failed';job.error={code:err.code||'PROCESSING_FAILED',message:String(err.message||'Roof processing failed.').split(apiKey).join('[redacted]')};
       try{store?.save('job',id,job);}catch{job.error={code:'STORAGE_FAILED',message:'Job storage is unavailable. Billing for dispatched requests is unknown.'};}
     });
     return send(202,{jobId:id});
    }
    const match=/^\/api\/ai\/jobs\/([a-f0-9-]+)$/.exec(url.pathname);if(match){const j=jobs.get(match[1]);if(!j||j.owner!==sid)return send(404,{error:'Processing job not found.'});if(req.method==='DELETE'){if(j.status==='running'){j.controller.abort();j.status='cancelled';store?.save('job',j.id,j);}if(j.requestKey&&requests.has(j.requestKey)){const record=requests.get(j.requestKey);record.cancelled=true;store?.save('request',j.requestKey,record);}return send(200,{status:j.status});}if(req.method==='GET')return send(200,{jobId:j.id,status:j.status,revision:j.revision,progress:j.progress,result:j.result,error:j.error});}
    return send(404,{error:'API route not found.'});
   }catch(e){if(creationRecord&&!creationRecord.jobId&&!creationRecord.cancelled)creationRecord.failed=true;return send(e.status||400,{error:String(e.message||'Invalid request.').split(apiKey||'NO_KEY').join('[redacted]')});}finally{if(uploadToken)uploads.delete(uploadToken);}
  }
  if(!['GET','HEAD'].includes(req.method))return send(405,{error:'Method not allowed.'});
  let relative;try{relative=decodeURIComponent(url.pathname);}catch{return send(400,{error:'Invalid path.'});}
  const parts=relative.split(/[\\/]+/);if(parts.some(p=>p.startsWith('.')||['server','tools','bench','attachments','node_modules'].includes(p.toLowerCase())))return send(403,{error:'Private path.'});
  const segments=parts.filter(Boolean);
  const publicFolders=['assets','vendor','cash','permits','examples'];
  if(segments.length && !(segments.length===1 && /^(?:(?:index|agents)\.html|pdf-import\.mjs|[\w-]+\.(?:js|css))$/.test(segments[0]))
       && !publicFolders.includes(segments[0]))return send(403,{error:'Private path.'});
  const file=path.resolve(root,'.'+(relative==='/'?'/index.html':relative));if(!file.startsWith(root+path.sep))return send(403,{error:'Private path.'});
  if(!fs.existsSync(file)||!fs.statSync(file).isFile())return send(404,{error:'File not found.'});
  res.writeHead(200,{'Content-Type':TYPES[path.extname(file)]||'application/octet-stream','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});if(req.method==='HEAD')return res.end();fs.createReadStream(file).pipe(res);
 });
 server.on('close',()=>{for(const job of jobs.values()){if(job.status==='running'){job.controller.abort();job.status='cancelled';}}jobs.clear();requests.clear();uploads.clear();sessions.clear();store?.close();});
 server.storageMode=store?'sqlite':'transient-memory';
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,host,resolve);}).catch(error=>{store?.close();throw error;});return server;
}
