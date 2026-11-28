import test from 'node:test';
import assert from 'node:assert/strict';
import {buildDecisionRequest,validateDecisionResponse,expectedDecisionLabel,isDecisionModel} from './decision-provider.mjs';
const task={id:'typed-task',sourceRevision:'r',candidateHash:'a'.repeat(64)};
const context={metrics:{attempted:12,diagnosticPasses:4,missedEdges:2},pdfReview:{checked:12,failed:0}};
test('only verified paid decision models use documented Shape1 requests',()=>{
  assert.equal(isDecisionModel('drex-v2.0'),true);assert.equal(isDecisionModel('jev-1.13'),true);assert.equal(isDecisionModel('free/drex-v2.0'),false);
  const body=buildDecisionRequest(task,context,'drex-v2.0');
  assert.equal(body.model,'drex-v2.0');assert.equal(typeof body.state,'string');assert.equal(body.questions.review_queue.type,'choice');
  assert.equal(Object.hasOwn(body,'messages'),false);assert.equal(Object.hasOwn(body,'max_tokens'),false);
  assert.equal(expectedDecisionLabel(context),'geometry_review');
  assert.equal(expectedDecisionLabel({metrics:{attempted:12,diagnosticPasses:12},pdfReview:{checked:12,failed:1}}),'report_review');
  assert.equal(expectedDecisionLabel({metrics:{attempted:12,diagnosticPasses:12},pdfReview:{checked:12,failed:0}}),'source_review');
});
test('typed decisions remain typed, preserve original response and never fabricate metric claims or peer review',()=>{
  const raw={object:'decision',model:'drex-v2.0',answers:{review_queue:{type:'choice',choice:'geometry_review',confidence:.8}}};
  const output=validateDecisionResponse(raw,context);
  assert.equal(output.contributionKind,'typed-decision');assert.equal(output.validation.agreesWithExpected,true);
  assert.deepEqual(output.rawDecision,raw);assert.equal(Object.hasOwn(output,'result'),false);
  assert.equal(output.validation.metricClaimsApplicable,false);assert.equal(output.validation.peerReviewApplicable,false);assert.equal(output.validation.releaseAuthority,false);
  assert.throws(()=>validateDecisionResponse({...raw,answers:{review_queue:{type:'choice',choice:'certified',confidence:.8}}},context),{code:'INVALID_DECISION_OUTPUT'});
  assert.throws(()=>validateDecisionResponse({...raw,answers:{review_queue:{type:'choice',choice:'geometry_review',confidence:NaN}}},context),{code:'INVALID_DECISION_OUTPUT'});
});

test('missing advisory confidence stays explicitly unknown without inventing a score',()=>{
  const response={object:'decision',model:'jev-1.13',answers:{review_queue:{type:'choice',choice:'geometry_review'}}};
  const result=validateDecisionResponse(response,context);assert.equal(result.typedDecision.confidence,null);assert.equal(result.validation.agreesWithExpected,true);
});
