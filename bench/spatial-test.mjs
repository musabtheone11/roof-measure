import assert from 'node:assert/strict';
import {spatialScore} from './spatial.mjs';
const square=[[0,0],[10,0],[10,10],[0,10],[0,0]];
const gt=[{poly:[square]}];
assert.equal(spatialScore(gt,[{poly:square}]).outlineIoU,1);
const wrong=[[20,0],[30,0],[30,10],[20,10]];
const score=spatialScore(gt,[{poly:wrong}]);
assert.equal(score.outlineIoU,0,'equal area wrong location must fail');
assert(score.missingPlanSqft>1000 && score.extraPlanSqft>1000);
const partial=[[5,0],[15,0],[15,10],[5,10]];
assert(Math.abs(spatialScore(gt,[{poly:partial}]).outlineIoU-1/3)<1e-12);
console.log('Spatial scorer: exact, equal-area wrong outline, and shifted overlap pass');
// Two right triangles overlap in a triangle with legs 5: 12.5 / (50+50-12.5).
const tri=[[0,0],[10,0],[0,10]],triShift=[[5,0],[15,0],[5,10]];
assert(Math.abs(spatialScore([{poly:[tri]}],[{poly:triShift}]).outlineIoU-1/7)<1e-12);
// Holes reduce union and intersection area; filling this 2x2 hole is extra roof.
const hole=[[4,4],[4,6],[6,6],[6,4],[4,4]];
const holed=spatialScore([{poly:[square,hole]}],[{poly:square}]);
assert(Math.abs(holed.outlineIoU-.96)<1e-12);
assert(Math.abs(holed.extraPlanSqft-4*10.7639104)<1e-9);
const identicalHole=spatialScore([{poly:[square,hole]}],[{poly:[[0,0],[4,0],[4,10],[0,10]]},{poly:[[6,0],[10,0],[10,10],[6,10]]},{poly:[[4,0],[6,0],[6,4],[4,4]]},{poly:[[4,6],[6,6],[6,10],[4,10]]}]);
assert(Math.abs(identicalHole.outlineIoU-1)<1e-12,'coincident rings with a hole are stable');
console.log('Spatial union identity: triangles, holes, coincident rings pass');
const preciseTruth=[{poly:[[[.123456789,.234567891],[10.123456789,.234567891],[.123456789,10.234567891]]]}];
const preciseEngine=[{poly:preciseTruth[0].poly[0].map(p=>[...p])}];
const before=JSON.stringify({preciseTruth,preciseEngine});
assert.equal(spatialScore(preciseTruth,preciseEngine).outlineIoU,1);
assert.equal(JSON.stringify({preciseTruth,preciseEngine}),before,'scoring precision never mutates source or traced geometry');
assert.equal(spatialScore(preciseTruth,preciseEngine).spatialPrecisionM,1e-6);
