import {lstatSync,unlinkSync} from 'node:fs';
import {join} from 'node:path';

// Billing, task records and JSON evidence are never deleted. Previous hosted
// checkpoints/report artifacts retain old images; this cache keeps current bytes.
export function pruneDesignImageCache(store,{keepHashes=[],verifiedPreviousCheckpoint=false}={}) {
  if(!verifiedPreviousCheckpoint)return {removed:0,reason:'PRIOR_CHECKPOINT_NOT_VERIFIED'};
  const keep=new Set(keepHashes),seen=new Set();let removed=0;
  for(const event of store.events()) {
    if(event.kind!=='design-image-cached')continue;
    const {hash}=event.detail||{};
    const rawRef=event.detail?.archiveRef;
    const archiveRef=rawRef&&typeof rawRef==='object'&&rawRef.repository==='musabtheone11/roof-measure'&&/^\d+$/.test(String(rawRef.runId||''))
      ?`https://github.com/${rawRef.repository}/actions/runs/${rawRef.runId}#artifacts`:rawRef;
    if(!/^[a-f0-9]{64}$/.test(hash||'')||keep.has(hash)||seen.has(hash))continue;
    seen.add(hash);
    if(typeof archiveRef!=='string'||!/^https:\/\/github\.com\/musabtheone11\/roof-measure\/actions\/runs\/\d+(?:#artifacts)?$/.test(archiveRef))continue;
    const path=join(store.blobDirectory,hash);
    let stat;
    try { stat=lstatSync(path); } catch(error) {if(error.code==='ENOENT')continue;throw error;}
    if(!stat.isFile()||stat.isSymbolicLink())throw new Error('Image cache contains an unsafe file');
    const bytes=store.readArtifact(hash);
    const png=bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]));
    const jpeg=bytes[0]===255&&bytes[1]===216&&bytes[2]===255;
    if(!png&&!jpeg)continue;
    unlinkSync(path);removed++;
    store.event(null,'design-image-cache-pruned',{hash,archiveRef,reason:'Image retained in the previous hosted artifact; ledger and metadata preserved'});
  }
  return {removed,kept:keep.size};
}
