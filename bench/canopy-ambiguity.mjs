// Two roofs with identical available observations and independently known gable areas.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import roofModel from '../roofmodel.js';
import { loadEngine, trace } from './engine.mjs';
import { summarizeEngine } from './score.mjs';

const px = 0.1, w = 275, h = 190, E0 = -3, N0 = 9;
const width = 10, slope = 6 / 12;

function observe(length) {
  const dsm = new Float32Array(w*h);
  const mask = new Uint8Array(w*h);
  const rgb = Array.from({length: 3}, () => new Uint8Array(w*h));
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const east = E0 + (x + 0.5)*px, north = N0 - (y + 0.5)*px;
    const i = y*w + x;
    const roof = east >= 0 && east < length && Math.abs(north) < width / 2;
    const canopy = east >= 13 && east < 22 && Math.abs(north) < 6.5;
    // The surface model sees the treetop. The building mask has no roof return there.
    dsm[i] = canopy ? 9 + 0.4*Math.sin(x)*Math.cos(y) : roof ? 3 + slope*(width/2 - Math.abs(north)) : 0;
    mask[i] = roof && !canopy ? 1 : 0;
    const color = canopy ? [55, 144, 48] : roof ? [118, 116, 124] : [95, 92, 85];
    for (let c = 0; c < 3; c++) rgb[c][i] = color[c];
  }
  return { w, h, px, E0, N0, dsm, mask, rgb };
}

function inputHash(scene) {
  const hash = createHash('sha256');
  hash.update(JSON.stringify([scene.w, scene.h, scene.px, scene.E0, scene.N0]));
  for (const samples of [scene.dsm, scene.mask, ...scene.rgb]) {
    hash.update(Buffer.from(samples.buffer, samples.byteOffset, samples.byteLength));
  }
  return hash.digest('hex');
}

const results = [16, 20].map(length => {
  const observed = observe(length);
  const output = trace(loadEngine(), observed);
  const estimateSqFt = summarizeEngine(output, 6, true).sloped;
  const truthSqFt = length * width * Math.hypot(1, slope) / (0.3048 ** 2);
  const status = roofModel.reportStatus({
    facets: output.facets.length, hiddenZones: output.obstruction?.hiddenZones,
    inferredSqft: output.facets.reduce((sum, f) => sum + f.inferredSqft, 0),
    reconcileOk: true,
  });
  assert.equal(status.status, 'REVIEW REQUIRED');
  assert.ok(status.reasons.some(reason => reason.code === 'hidden'));
  return { lengthM: length, inputHash: inputHash(observed), truthSqFt, estimateSqFt,
    errorPct: 100*Math.abs(estimateSqFt - truthSqFt)/truthSqFt,
    reviewStatus: status.status,
    inferredFacets: output.facets.filter(f => f.status === 'inferred').length,
    hiddenZones: output.obstruction?.hiddenZones?.length ?? 0 };
});
assert.equal(results[0].inputHash, results[1].inputHash);
assert.equal(results[0].estimateSqFt, results[1].estimateSqFt);
assert.ok(results[0].truthSqFt*1.05 < results[1].truthSqFt*0.95);
assert.ok(results.some(result => result.errorPct > 5));
console.log(JSON.stringify({ scope: 'Analytic impossibility fixture. This pair is outside the random holdout.',
  smallestPossibleWorstRelativeErrorPct: 100*(20 - 16)/(20 + 16), results }, null, 2));
