import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {OrgStore} from './store.mjs';
import {pruneDesignImageCache} from './design-cache.mjs';

test('design cache prunes only previously archived tagged images while preserving current bytes and all billing evidence',t=>{
  const dir=mkdtempSync(join(tmpdir(),'roof-design-cache-')),store=new OrgStore(dir);
  t.after(()=>{store.close();rmSync(dir,{recursive:true,force:true});});
  const png=n=>Buffer.from([137,80,78,71,13,10,26,10,n]);
  const old=store.putArtifact(png(1)),current=store.putArtifact(png(2)),untagged=store.putArtifact(png(3)),metadata=store.putArtifact('{"billing":"preserved"}');
  const archiveRef='https://github.com/musabtheone11/roof-measure/actions/runs/123#artifacts';
  for(const item of [old,current,metadata])store.event(null,'design-image-cached',{hash:item.hash,archiveRef});
  const ledger=store.ledger();
  assert.equal(pruneDesignImageCache(store,{keepHashes:[current.hash]}).removed,0);
  assert.equal(pruneDesignImageCache(store,{keepHashes:[current.hash],verifiedPreviousCheckpoint:true}).removed,1);
  assert.throws(()=>store.readArtifact(old.hash));assert.deepEqual(store.readArtifact(current.hash),png(2));
  assert.deepEqual(store.readArtifact(untagged.hash),png(3));assert.ok(store.readArtifact(metadata.hash));assert.deepEqual(store.ledger(),ledger);
  assert.equal(pruneDesignImageCache(store,{keepHashes:[current.hash],verifiedPreviousCheckpoint:true}).removed,0);
});
