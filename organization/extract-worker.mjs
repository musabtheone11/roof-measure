import {parentPort, workerData} from 'node:worker_threads';
import {extractDocument} from './discovery.mjs';
try {
  const result = await extractDocument(Buffer.from(workerData.bytes), workerData.extension);
  parentPort.postMessage({ok: true, result});
} catch { parentPort.postMessage({ok: false, error: 'Document extraction failed or exceeded supported bounds; inspect locally'}); }
