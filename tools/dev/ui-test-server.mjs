// Fresh deterministic backend for fixture UI tests; API key explicitly absent.
import {serve} from '../../server/main.mjs';
export async function testServer(override){
  if(override)return{baseURL:override,close:async()=>{}};
  const server=await serve({port:0,host:'127.0.0.1',apiKey:''});
  return{baseURL:'http://127.0.0.1:'+server.address().port,close:()=>new Promise(resolve=>server.close(resolve))};
}
