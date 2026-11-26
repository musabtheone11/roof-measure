import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { startRuntime } from './http.mjs';

test('restart recovers completed and interrupted jobs only for the submitting session', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'roof-jobs-'));
  const stateFile = path.join(directory, 'jobs.sqlite');
  let dispatches = 0;
  const launch = () => startRuntime({
    port: 0, stateFile, apiKey: 'synthetic-test-only',
    runAgents: async (input, {signal}) => {
      dispatches++;
      if (input.revision === 'complete') return {status: 'REVIEW REQUIRED', revision: input.revision};
      return new Promise((_, reject) => signal.addEventListener('abort', () => reject(Error('stopped'))));
    }
  });
  let server = await launch();
  const close = () => new Promise(resolve => server.close(resolve));
  const url = route => 'http://127.0.0.1:' + server.address().port + '/api/ai/' + route;
  try {
    const config = await fetch(url('config'));
    const headers = {cookie: config.headers.get('set-cookie').split(';')[0], 'x-roof-csrf': (await config.json()).csrfToken};
    const submit = async (nonce, revision) => {
      const response = await fetch(url('trace'), {method: 'POST', headers: {...headers, 'x-roof-request-id': nonce},
        body: JSON.stringify({revision, consentExternal:true,image:'data:image/png;base64,YWJj',
          imageMetadata:{view:'orthographic',sourcePage:2,targetPixel:[1,2],imageFingerprint:{sha256:'untrusted-client-value'}}})});
      assert.equal(response.status,202);
      return (await response.json()).jobId;
    };
    const original = await submit('aaaaaaaaaaaaaaaa','complete');
    const pending = await submit('bbbbbbbbbbbbbbbb','pending');
    const tombstone = 'cccccccccccccccc';
    assert.equal((await fetch(url('requests/' + tombstone), {method:'DELETE',headers})).status,200);
    await close();
    server = await launch();
    const recovered = await (await fetch(url('jobs/'+original),{headers})).json();
    assert.equal(recovered.result.revision,'complete');
    const receipt=await (await fetch(url('requests/aaaaaaaaaaaaaaaa'),{headers})).json();
    assert.equal(receipt.sourceHash,createHash('sha256').update('abc').digest('hex'));
    assert.deepEqual(receipt.sourceSettings,{targetPixel:[1,2],sourcePage:2,rotation:0,purpose:'photo',view:'orthographic'});
    const interrupted = await (await fetch(url('jobs/'+pending),{headers})).json();
    assert.equal(interrupted.status,'failed');
    assert.equal(interrupted.error.code,'INTERRUPTED');
    assert.equal((await fetch(url('jobs/'+original))).status,404);
    assert.equal(await submit('bbbbbbbbbbbbbbbb','pending'),pending);
    assert.equal(await submit('aaaaaaaaaaaaaaaa','complete'),original);
    const priorCancel = await (await fetch(url('requests/'+tombstone),{headers})).json();
    assert.equal(priorCancel.status,'cancelled');
    assert.equal(dispatches,2);
  } finally {
    await close();
    await rm(directory,{recursive:true,force:true});
  }
});
