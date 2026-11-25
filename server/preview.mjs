// Single-process private preview. The job runtime stays alive between HTTP requests.
import http from 'node:http';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {serve} from './main.mjs';

export async function startPrivatePreview({port=3000,host='127.0.0.1',username=process.env.PREVIEW_AUTH_USERNAME,password=process.env.PREVIEW_AUTH_PASSWORD,publicOrigin=process.env.PUBLIC_ORIGIN,trustProxy=process.env.PREVIEW_TRUST_PROXY==='1',createRuntime=serve,runtimeOptions={}}={}) {
 if(typeof username!=='string'||!username||username.includes(':')||typeof password!=='string'||password.length<24)throw Error('Set a preview username and a password of at least 24 characters in runtime secrets.');
 if(!publicOrigin&&!['localhost','127.0.0.1','::1'].includes(host))throw Error('PUBLIC_ORIGIN is required when listening beyond loopback.');
 let origin=null;
 if(publicOrigin){origin=new URL(publicOrigin);if(origin.origin!==publicOrigin||!['https:','http:'].includes(origin.protocol))throw Error('PUBLIC_ORIGIN must be one exact HTTP(S) origin.');if(origin.protocol==='http:'&&!['localhost','127.0.0.1','[::1]'].includes(origin.hostname))throw Error('A public preview requires HTTPS.');}
 const credential=Buffer.from(username+':'+password);
 const runtime=await createRuntime({...runtimeOptions,port:0,host:'127.0.0.1'});
 const runtimePort=runtime.address().port;
 const gateway=http.createServer((req,res)=>{
  const send=(status,body,headers={})=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store','X-Content-Type-Options':'nosniff',...headers});res.end(JSON.stringify(body));};
  if(req.url==='/healthz'&&req.method==='GET')return send(200,{status:'ready',mode:'private-preview',storage:'transient-memory'});
  if(origin&&req.headers.host!==origin.host)return send(400,{error:'Preview host does not match PUBLIC_ORIGIN.'});
  const secure=!!req.socket.encrypted||(trustProxy&&String(req.headers['x-forwarded-proto']||'').split(',')[0].trim()==='https');
  if(origin?.protocol==='https:'&&!secure)return send(426,{error:'Use the HTTPS preview URL.'});
  const match=/^Basic ([A-Za-z0-9+/=]+)$/.exec(req.headers.authorization||'');
  const received=match?Buffer.from(match[1],'base64'):Buffer.alloc(0);
  if(received.length!==credential.length||!crypto.timingSafeEqual(received,credential))return send(401,{error:'Private preview authentication required.'},{'WWW-Authenticate':'Basic realm="Roof Measure private preview", charset="UTF-8"'});
  const headers={...req.headers};delete headers.authorization;delete headers['proxy-authorization'];delete headers['x-forwarded-host'];
  const upstream=http.request({host:'127.0.0.1',port:runtimePort,path:req.url,method:req.method,headers},response=>{
   const outgoing={...response.headers};if(secure&&outgoing['set-cookie'])outgoing['set-cookie']=outgoing['set-cookie'].map(c=>/;\s*secure\b/i.test(c)?c:c+'; Secure');
   res.writeHead(response.statusCode,outgoing);response.pipe(res);
  });
  upstream.on('error',()=>{if(!res.headersSent)send(502,{error:'Preview runtime is unavailable.'});else res.destroy();});
  req.on('aborted',()=>upstream.destroy());res.on('close',()=>{if(!res.writableEnded)upstream.destroy();});req.pipe(upstream);
 });
 const close=gateway.close.bind(gateway);gateway.close=(callback)=>close(error=>runtime.close(()=>callback?.(error)));
 try{await new Promise((resolve,reject)=>{gateway.once('error',reject);gateway.listen(port,host,resolve);});}catch(error){await new Promise(resolve=>runtime.close(resolve));throw error;}
 return gateway;
}
if(process.argv[1]===fileURLToPath(import.meta.url)){
 const port=Number(process.env.PORT||3000);await startPrivatePreview({port,host:process.env.HOST||'0.0.0.0'});console.log('Private roof preview listening on port '+port);
}
