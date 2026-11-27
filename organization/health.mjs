import {writeFileSync,readFileSync,renameSync,rmSync} from 'node:fs';
import {join} from 'node:path';
export function writeHealth(directory,record) {
  const temporary=join(directory,`.health-${process.pid}.tmp`);
  try { writeFileSync(temporary,JSON.stringify({schemaVersion:1,pid:process.pid,updatedAt:Date.now(),...record}),{mode:0o600});renameSync(temporary,join(directory,'health.json')); }
  finally { rmSync(temporary,{force:true}); }
}
export function readHealth(directory,{now=Date.now()}={}) {
  try {
    const value=JSON.parse(readFileSync(join(directory,'health.json'),'utf8'));
    return {...value,processHealthy:value.schemaVersion===1&&Number.isFinite(value.updatedAt)&&now-value.updatedAt>=0&&now-value.updatedAt<=15000&&value.control!=='stopped',
      releaseReady:false,readinessReason:'Reference/isolated verification/deployment adapters and local installation still require verification'};
  } catch { return {processHealthy:false,releaseReady:false,readinessReason:'No fresh worker heartbeat'}; }
}
