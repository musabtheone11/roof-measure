import {Worker} from 'node:worker_threads';
export function extractIsolated(bytes, extension, {signal, timeoutMs = 120000} = {}) {
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 120000) throw new Error('Extraction deadline limit');
  return new Promise((resolve, reject) => {
    if (signal?.aborted) { reject(new Error('Extraction cancelled')); return; }
    const worker = new Worker(new URL('./extract-worker.mjs', import.meta.url), {
      workerData: {bytes, extension}, resourceLimits: {maxOldGenerationSizeMb: 256, maxYoungGenerationSizeMb: 32}});
    let done = false;
    const finish = (error, value) => {
      if (done) return; done = true; clearTimeout(timer); signal?.removeEventListener('abort', abort);
      void worker.terminate(); error ? reject(error) : resolve(value);
    };
    const abort = () => finish(new Error('Extraction cancelled'));
    const timer = setTimeout(() => finish(new Error('Extraction deadline exceeded')), timeoutMs);
    signal?.addEventListener('abort', abort, {once: true});
    worker.once('message', value => value.ok ? finish(null, value.result) : finish(new Error(value.error)));
    worker.once('error', () => finish(new Error('Extraction worker failed')));
    worker.once('exit', code => { if (!done) finish(new Error(`Extraction worker exited (${code})`)); });
  });
}
