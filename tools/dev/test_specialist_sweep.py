"""Offline regression tests. No keys or network are used."""
import argparse
import contextlib
import io
import json
import os
import pathlib
import tempfile
import threading
import unittest
from unittest.mock import patch

import specialist_sweep as sweep


def meta(model):
    free = model.startswith('free/')
    return {'id':model, 'contextWindow':'1M', 'dollarsPer1M':0 if free else 0.5,
            'outputDollarsPer1M':0 if free else 0.5, 'weight':3 if free else None}


class SweepTests(unittest.TestCase):
    def setUp(self):
        revision=patch.object(sweep.subprocess,'check_output',return_value='a'*40+'\n')
        revision.start()
        self.addCleanup(revision.stop)

    def test_identity_pricing_and_schema_fail_closed(self):
        id_ = 'free/qwen-3.8-max'
        self.assertIn('blocker',sweep.plan_model(id_,meta(id_),False,{}))
        self.assertIn('blocker',sweep.plan_model(id_,dict(meta(id_),outputDollarsPer1M=.5),True,{}))
        self.assertIn('blocker',sweep.plan_model('unknown',meta('unknown'),True,{}))
        row = sweep.plan_model(id_,meta(id_),True,{})
        route, request = sweep.build_request(row,'assignment')
        self.assertNotIn('expected',request['messages'][0]['content'])
        obj={'projectedSqFt':108,'slopedSqFt':None,'test':'Translate a verified rectangle and compare areas.',
             'refs':['CAL-1','GEO-1'],'decision':'area_12'}
        def check(value):
            return sweep.validate(row,'assignment',route,{'choices':[{'message':{'content':json.dumps(value)}}]})[1]
        self.assertTrue(check(obj))
        self.assertFalse(check(dict(obj,slopedSqFt=108)))
        self.assertFalse(check(dict(obj,refs=['GEO-1','GEO-1'])))
        with self.assertRaises(ValueError):
            check(dict(obj,projectedSqFt=True))

    def test_deadline_bounds_whole_request(self):
        gate=threading.Event()
        try:
            with patch.object(sweep,'_fetch',side_effect=lambda *args:gate.wait(5)) as call:
                with self.assertRaises(TimeoutError):
                    sweep.fetch('https://fixture.invalid',timeout=.03)
                call.assert_called_once()
        finally:
            gate.set()

    def test_distinct_role_assignments_and_routes(self):
        self.assertEqual(len(sweep.ROLES),53)
        self.assertEqual(len({role for role,_ in sweep.ROLES.values()}),53)
        for model in sweep.ROLES:
            row = sweep.plan_model(model,meta(model),True,{})
            route, req = sweep.build_request(row,'assignment')
            self.assertLess(len(sweep.encode(req)),32768)
            if route=='decisions':
                self.assertEqual(set(req['questions']),{'area','slope','decision'})
        self.assertEqual(sweep.context_size('131K'),134144)

    def test_vision_and_tool_calls_must_match_frozen_oracles(self):
        model='free/qwen-3.8-max'
        row=sweep.plan_model(model,meta(model),True,{})
        def reply(message):
            return {'choices':[{'message':message}]}
        good={'content':'{"quadrant":"top-right"}'}
        self.assertTrue(sweep.validate(row,'vision','chat/completions',reply(good))[1])
        self.assertFalse(sweep.validate(row,'vision','chat/completions',reply({'content':'{"quadrant":"bottom-left"}'}))[1])
        self.assertRaises(ValueError,sweep.validate,row,'vision','chat/completions',reply({'content':'not JSON'}))
        self.assertRaises(ValueError,sweep.validate,row,'vision','chat/completions',reply({'content':'{"quadrant":"bottom-right","quadrant":"top-right"}'}))
        tool={'function':{'name':'record_issue','arguments':'{"issue":"missing_pitch"}'}}
        self.assertTrue(sweep.validate(row,'tools','chat/completions',reply({'tool_calls':[tool]}))[1])
        self.assertRaises(ValueError,sweep.validate,row,'tools','chat/completions',reply({'tool_calls':[tool,tool]}))

    def test_no_duplicate_after_quota_failure(self):
        model='free/gpt-6-luna'
        def discover(url,key=None):
            if url==sweep.CATALOG:
                return {'models':[meta(model)]},{}
            if url.endswith('/models'):
                return {'data':[{'id':model}]},{}
            if url.endswith('/subscription'):
                return {'allowed':True,'unlimited':False,'tokens_remaining':10_000_000},{}
            return {'rpm':30,'balance_usd':0,'reserved_usd':0},{}
        with tempfile.TemporaryDirectory() as directory, patch.dict(os.environ,{'APINEX_API_KEY':'synthetic'}), \
                patch.object(sweep,'get_json',side_effect=discover), patch.object(sweep,'fetch',return_value=(429,{'retry-after':'120'},b'{}')) as post, \
                contextlib.redirect_stdout(io.StringIO()):
            args=argparse.Namespace(phase='free',out=pathlib.Path(directory),usd=0,minutes=1)
            sweep.run(args)
            with self.assertRaisesRegex(ValueError,'Retry-After'):
                sweep.run(args)
            data=json.loads((args.out/'execution.json').read_text())
            self.assertGreater(data['notBefore'],sweep.time.time()+110)
            self.assertEqual(post.call_count,1)

    def test_resume_budgets_and_private_discovery(self):
        paid='gpt-6.2-astra'
        free='free/claude-opus-4.6'
        def discover(url,key=None):
            if url==sweep.CATALOG:
                return {'models':[meta(paid),meta(free)]},{}
            if url.endswith('/models'):
                return {'data':[{'id':paid},{'id':free}]},{'x-ratelimit-limit':'60'}
            if url.endswith('/subscription'):
                return {'mode':'subscription','allowed':True,'unlimited':False,'tokens_remaining':10_000_000},{}
            return {'rpm':30,'balance_usd':8,'reserved_usd':0,'api_key':'private-response-field'},{}
        with tempfile.TemporaryDirectory() as directory, patch.dict(os.environ,{'APINEX_API_KEY':'secret-placeholder'}), \
                patch.object(sweep,'get_json',side_effect=discover), patch.object(sweep.time,'sleep'), \
                patch.object(sweep,'fetch',side_effect=TimeoutError) as post, contextlib.redirect_stdout(io.StringIO()):
            args=argparse.Namespace(phase='free',out=pathlib.Path(directory),usd=0,minutes=1)
            sweep.run(args)
            sweep.run(args)
            self.assertEqual(post.call_count,1)
            data=json.loads((args.out/'execution.json').read_text())
            self.assertIsNone(data['tasks'][free+'/assignment']['costMicroUsd'])
            self.assertEqual(data['tasks'][free+'/assignment']['status'],'dispatch-outcome-unknown')
            args.phase='paid'
            args.usd=.05
            sweep.run(args)
            self.assertEqual(post.call_count,1)
            persisted=(args.out/'registry.json').read_text()+(args.out/'execution.json').read_text()
            self.assertNotIn('secret-placeholder',persisted)
            self.assertNotIn('private-response-field',persisted)


if __name__=='__main__':
    unittest.main()
