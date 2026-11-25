import http from 'node:http';
import {validateBudget} from './contracts.mjs';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const TYPES={'.html':'text/html; charset=utf-8','.js':'application/javascript','.css':'text/css','.png':'image/png','.svg':'image/svg+xml','.jpg':'image/jpeg','.json':'application/json'};
export async function startRuntime({port=3000,host='127.0.0.1',runAgents,measure,compareTraces,apiKey=process.env.APINEX_API_KEY,root=ROOT}={}) {
 const jobs=new Map(),sessions=new Map();
 const server=http.createServer(async(req,res)=>{
  const url=new URL(req.url,'http://'+req.headers.host);
  const send=(status,data)=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(data));};
  const now=Date.now();for(const[id,j]of jobs)if(now-j.created>900000){j.controller.abort();jobs.delete(id);}for(const[id,s]of sessions)if(now-s.created>3600000)sessions.delete(id);
  let sid=/roof_session=([a-f0-9]+)/.exec(req.headers.cookie||'')?.[1],session=sessions.get(sid);
  if(!session){if(sessions.size>=200)return send(503,{error:'Preview session capacity reached. Try again later.'});sid=crypto.randomBytes(24).toString('hex');session={created:now,csrf:crypto.randomBytes(24).toString('hex')};sessions.set(sid,session);res.setHeader('Set-Cookie',`roof_session=${sid}; HttpOnly; SameSite=Strict; Path=/`);}
  if(url.pathname.startsWith('/api/')) {
   if(['POST','DELETE'].includes(req.method)){
    if(req.headers['x-roof-csrf']!==session.csrf)return send(403,{error:'Reload the page before processing this image.'});
    const origin=req.headers.origin;if(origin&&origin!==process.env.PUBLIC_ORIGIN&&origin!=='http://'+req.headers.host&&origin!=='https://'+req.headers.host)return send(403,{error:'Request origin is not allowed.'});
   }
   try{
    if(req.method==='GET'&&url.pathname==='/api/ai/config')return send(200,{available:!!apiKey,csrfToken:session.csrf,models:{quality:'claude-opus-5.5',outline:'claude-opus-5.5',structure:'gpt-6.2-astra',independent:'gpt-6.2-astra',adjudication:'claude-opus-5.5'},pricing:{'claude-opus-5.5':{inputPerMillion:0.5,outputPerMillion:0.5},'gpt-6.2-astra':{inputPerMillion:0.5,outputPerMillion:0.5}},limits:{maxRequests:8,maxTokens:6000000,maxCostUsd:2,maxUsd:2},pricingSource:'https://apinex.bond/pricing.md'});
    const read=async()=>{const chunks=[];let size=0;for await(const b of req){size+=b.length;if(size>12*1024*1024)throw Object.assign(Error('Image request exceeds 12 MB.'),{status:413});chunks.push(b);}try{return JSON.parse(Buffer.concat(chunks));}catch{throw Object.assign(Error('Request must be valid JSON.'),{status:400});}};
    if(req.method==='POST'&&url.pathname==='/api/ai/measure'){const x=await read();return send(200,await measure(x));}
    if(req.method==='POST'&&url.pathname==='/api/ai/trace'){
     if(!apiKey)return send(503,{error:'APINEX is not configured on this server.'});
     if([...jobs.values()].filter(j=>j.status==='running').length>=2||[...jobs.values()].some(j=>j.owner===sid&&j.status==='running'))return send(429,{error:'A roof is already processing. Wait or cancel it before starting another.'});
     if(jobs.size>=30)return send(429,{error:'Processing history is full. Try again after older jobs expire.'});
     const input=await read();if(input.consentExternal!==true)return send(400,{error:'Confirm authorization to send this image for external processing.'});
     // Recheck after awaiting the body, immediately before synchronous insertion.
     if([...jobs.values()].filter(j=>j.status==='running').length>=2||[...jobs.values()].some(j=>j.owner===sid&&j.status==='running'))return send(429,{error:'A roof is already processing. Wait or cancel it before starting another.'});
     if(jobs.size>=30)return send(429,{error:'Processing history is full. Try again after older jobs expire.'});
     if(input.budget!==undefined)validateBudget(input.budget);
     input.budget={...input.budget,maxRequests:Math.min(8,input.budget?.maxRequests??8),maxTokens:Math.min(6000000,input.budget?.maxTokens??6000000),maxUsd:Math.min(2,input.budget?.maxUsd??input.budget?.maxCostUsd??2)};
     const id=crypto.randomUUID(),controller=new AbortController(),job={id,owner:sid,created:now,status:'running',progress:[],revision:input.revision,controller};jobs.set(id,job);
     Promise.resolve().then(()=>runAgents(input,{apiKey,signal:controller.signal,compareTraces,onProgress:event=>job.progress.push(event),isCurrent:revision=>job.status==='running'&&job.revision===revision})).then(async result=>{if(controller.signal.aborted)return;job.result=result;job.status='completed';}).catch(err=>{if(controller.signal.aborted){job.status='cancelled';return;}job.status='failed';job.error={code:err.code||'PROCESSING_FAILED',message:String(err.message||'Roof processing failed.').split(apiKey).join('[redacted]')};});
     return send(202,{jobId:id});
    }
    const match=/^\/api\/ai\/jobs\/([a-f0-9-]+)$/.exec(url.pathname);if(match){const j=jobs.get(match[1]);if(!j||j.owner!==sid)return send(404,{error:'Processing job not found.'});if(req.method==='DELETE'){j.controller.abort();j.status='cancelled';return send(200,{status:j.status});}if(req.method==='GET')return send(200,{jobId:j.id,status:j.status,revision:j.revision,progress:j.progress,result:j.result,error:j.error});}
    return send(404,{error:'API route not found.'});
   }catch(e){return send(e.status||400,{error:String(e.message||'Invalid request.').split(apiKey||'NO_KEY').join('[redacted]')});}
  }
  if(!['GET','HEAD'].includes(req.method))return send(405,{error:'Method not allowed.'});
  let relative;try{relative=decodeURIComponent(url.pathname);}catch{return send(400,{error:'Invalid path.'});}
  const parts=relative.split(/[\\/]+/);if(parts.some(p=>p.startsWith('.')||['server','tools','bench','attachments','node_modules'].includes(p.toLowerCase())))return send(403,{error:'Private path.'});
  const file=path.resolve(root,'.'+(relative==='/'?'/index.html':relative));if(!file.startsWith(root+path.sep))return send(403,{error:'Private path.'});
  if(!fs.existsSync(file)||!fs.statSync(file).isFile())return send(404,{error:'File not found.'});
  res.writeHead(200,{'Content-Type':TYPES[path.extname(file)]||'application/octet-stream','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});if(req.method==='HEAD')return res.end();fs.createReadStream(file).pipe(res);
 });
 await new Promise(r=>server.listen(port,host,r));return server;
}
