"""Bounded API NEX engineering evaluation of synthetic inputs. Python 3.11+."""

import argparse
import base64
import contextlib
import datetime
import email.utils
import hashlib
import json
import math
import os
import pathlib
import re
import subprocess
import threading
import time
import urllib.error
import urllib.parse
import urllib.request

from specialist_cases import COMMON, CASES, ROLES

ROOT = pathlib.Path(__file__).resolve().parents[2]
CATALOG = 'https://apinex.bond/api/public/models'
VISION = ROOT / 'tools/dev/fixtures/runtime-vision/simple-gable.png'
MAX_OUTPUT = 900
TIMEOUT = 45
MAX_BODY = 1024 * 1024


def digest(data):
    return hashlib.sha256(data).hexdigest()


def encode(value):
    return json.dumps(value, ensure_ascii=True, sort_keys=True, separators=(',', ':')).encode()


def strict_object(text):
    def pairs(items):
        obj=dict(items)
        if len(obj)!=len(items):
            raise ValueError('duplicate JSON keys')
        return obj
    def invalid_constant(token):
        raise ValueError('invalid JSON constant')
    value=json.loads(text,object_pairs_hook=pairs,parse_constant=invalid_constant)
    if not isinstance(value,dict):
        raise ValueError('expected a JSON object')
    return value


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args):
        return None


def _fetch(url, key, body, timeout):
    headers = {'User-Agent': 'RoofMeasure-SpecialistReview/1', 'Accept': 'application/json'}
    if key:
        headers['Authorization'] = 'Bearer ' + key
    if body is not None:
        headers['Content-Type'] = 'application/json'
    req = urllib.request.Request(url, headers=headers, data=encode(body) if body is not None else None)
    try:
        response = urllib.request.build_opener(NoRedirect).open(req, timeout=timeout)
    except urllib.error.HTTPError as exc:
        response = exc
    with response:
        data = response.read(MAX_BODY + 1)
        if len(data) > MAX_BODY:
            raise ValueError('oversize response')
        return response.status, response.headers, data


def fetch(url, key=None, body=None, timeout=TIMEOUT):
    # urllib's socket timeout covers individual operations. Bound the whole
    # operation as well, including connection setup and a slow streaming body.
    result = []
    errors = []
    def request():
        try:
            result.append(_fetch(url,key,body,timeout))
        except Exception as exc:
            errors.append(exc)
    worker = threading.Thread(target=request,daemon=True)
    worker.start()
    worker.join(timeout)
    if worker.is_alive():
        raise TimeoutError('evaluation request deadline exceeded')
    if errors:
        raise errors[0]
    return result[0]


def get_json(url, key=None):
    code, headers, raw = fetch(url, key)
    if code != 200:
        raise ValueError('discovery HTTP ' + str(code))
    return json.loads(raw), headers


def atomic(path, data):
    tmp = path.with_suffix('.tmp')
    with tmp.open('wb') as stream:
        stream.write(json.dumps(data, ensure_ascii=True, indent=2, allow_nan=False).encode() + b'\n')
        stream.flush()
        os.fsync(stream.fileno())
    os.replace(tmp, path)


@contextlib.contextmanager
def exclusive(path):
    # OS releases this lock on process death. The durable dispatch record then
    # prevents replay of a request whose provider outcome is unknown.
    with path.open('a+b') as lock:
        if lock.tell() == 0:
            lock.write(b'1')
            lock.flush()
        lock.seek(0)
        if os.name == 'nt':
            import msvcrt
            msvcrt.locking(lock.fileno(), msvcrt.LK_NBLCK, 1)
        else:
            import fcntl
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        yield


def context_size(label):
    match = re.fullmatch(r'(\d+(?:\.\d+)?)([KM]?)', str(label))
    if not match:
        raise ValueError('unrecognized context capacity')
    return math.ceil(float(match[1]) * {'': 1, 'K': 1024, 'M': 1048576}[match[2]])


def plan_model(model, meta, returned, sheets):
    role, group = ROLES.get(model, ('Independent cross-stage evidence check', 'schema'))
    row = dict(model=model, assignment=role, case=CASES[group][0], group=group, listed=returned)
    if model not in ROLES:
        row.update(datasheet=sheets.get(model), rationale='Independent challenge for a newly discovered endpoint')
        if not row['datasheet']:
            return dict(row, blocker='new model lacks a verified datasheet')
    if not returned:
        return dict(row, blocker='absent from authenticated GET /models')
    if not meta:
        return dict(row, blocker='missing public pricing')
    price, out = meta.get('dollarsPer1M'), meta.get('outputDollarsPer1M')
    if not all(type(x) in (float, int) and math.isfinite(x) and x >= 0 for x in (price, out)):
        return dict(row, blocker='unknown rate')
    if model.startswith('free/') != (price == 0 and out == 0):
        return dict(row, blocker='free routing/rates disagree')
    try:
        capacity = context_size(meta.get('contextWindow'))
    except ValueError:
        return dict(row, blocker='unknown input capacity')
    row.update(inputRate=price, outputRate=out, capacity=capacity, weight=meta.get('weight'),
               visionClaim=meta.get('supportsVision'), toolsClaim=meta.get('supportsTools'),
               freePlanFlag=meta.get('allowFree'), reserveMicroUsd=math.ceil(capacity * max(price, out) + MAX_OUTPUT * out),
               illustrativeMicroUsd=math.ceil(8000 * price + MAX_OUTPUT * out))
    return row


def build_request(row, mode):
    model, role = row['model'], row['assignment']
    case_id, source, _ = CASES[row['group']]
    if mode == 'vision':
        content = [{'type':'text', 'text':'Inspect the supplied synthetic drawing. The small detached gray rectangle is in which quadrant? Return only a JSON object with quadrant (top-left, top-right, bottom-left, bottom-right).'},
                   {'type':'image_url', 'image_url':{'url':'data:image/png;base64,' + base64.b64encode(VISION.read_bytes()).decode()}}]
    elif mode == 'tools':
        return 'chat/completions', {'model':model, 'messages':[{'role':'user','content':'Call record_issue for fixture TOOL-1 using issue=missing_pitch. This is an inert schema probe.'}],
                'max_tokens':MAX_OUTPUT,'tools':[{'type':'function','function':{'name':'record_issue','description':'Record an advisory issue','parameters':{'type':'object','properties':{'issue':{'type':'string','enum':['missing_pitch']}},'required':['issue'],'additionalProperties':False}}}],
                'tool_choice':{'type':'function','function':{'name':'record_issue'}}}
    elif model in ('jev-1.13','drex-v2.0','free/jev-1.13','gpt-6-luna-decisions','subq-snap-preview'):
        options = re.findall(r'Choose ([a-z0-9_]+) or ([a-z0-9_]+)', source)[0]
        state = {'common':COMMON, 'case':{'id':case_id,'source':source}, 'assignment':role}
        return 'decisions', {'model':model,'state':state, 'questions':{
            'area':{'type':'choice','instructions':'Which projected area does CAL-1 establish in square feet?','criteria':{'area108':'108','area21':'21','unknown':'unknown'}},
            'slope':{'type':'choice','instructions':'Is the complete sloped area known?','criteria':{'known':'Known','unknown':'Unknown'}},
            'decision':{'type':'choice','instructions':'Select the justified action for the assigned case.','criteria':{k:k.replace('_',' ') for k in options}}}}
    else:
        content = ('Return exactly one JSON object with projectedSqFt (number), slopedSqFt (number or null), '
                   'decision (one of two supplied action codes), refs (both IDs), and test (one concrete engineering '
                   'regression test or patch proposal, 10 to 360 characters). Common quantities refer only to CAL-1. '
                   'No outside evidence or claims of having executed tests. Common input: ' + json.dumps(COMMON) +
                   '. Independent assignment: ' + role + '. ' + case_id + ': ' + source)
    return 'chat/completions', {'model':model,'messages':[{'role':'user','content':content}],
            'max_tokens':MAX_OUTPUT,'response_format':{'type':'json_object'},'stream':False}


def validate(row, mode, route, reply):
    case_id, _, expected = CASES[row['group']]
    if route == 'decisions':
        answers = reply['answers']
        if any(answers[k]['type'] != 'choice' for k in ('area','slope','decision')):
            raise ValueError('invalid typed choice')
        result = {k:answers[k]['choice'] for k in ('area','slope','decision')}
        if any(not isinstance(v,str) or len(v)>64 for v in result.values()):
            raise ValueError('invalid choice value')
        return result, result == {'area':'area108','slope':'unknown','decision':expected}
    message = reply['choices'][0]
    if message.get('finish_reason') == 'length':
        raise ValueError('truncated')
    if mode == 'tools':
        calls = message['message']['tool_calls']
        if len(calls) != 1 or calls[0]['function']['name'] != 'record_issue':
            raise ValueError('missing tool call')
        args = strict_object(calls[0]['function']['arguments'])
        return {'matched':args == {'issue':'missing_pitch'}}, args == {'issue':'missing_pitch'}
    obj = strict_object(message['message']['content'])
    if mode == 'vision':
        if set(obj) != {'quadrant'} or obj['quadrant'] not in ('top-left','top-right','bottom-left','bottom-right'):
            raise ValueError('invalid quadrant')
        return obj, obj['quadrant'] == 'top-right'
    if set(obj) != {'projectedSqFt','slopedSqFt','decision','refs','test'}:
        raise ValueError('incorrect result keys')
    if type(obj['projectedSqFt']) not in (int,float) or not math.isfinite(obj['projectedSqFt']):
        raise ValueError('invalid projected area')
    slope = obj['slopedSqFt']
    if slope is not None and (type(slope) not in (int,float) or not math.isfinite(slope)):
        raise ValueError('invalid sloped area')
    if not isinstance(obj['decision'],str) or not re.fullmatch(r'[a-z_0-9]{1,64}',obj['decision']):
        raise ValueError('invalid decision')
    if not isinstance(obj['refs'],list) or len(obj['refs'])!=2 or not all(isinstance(s,str) and len(s)<32 for s in obj['refs']):
        raise ValueError('invalid evidence refs')
    if not isinstance(obj['test'],str) or not 10 <= len(obj['test']) <= 360:
        raise ValueError('invalid proposal')
    # Save advisory text from this synthetic-only job. Remove URLs, apparent
    # credentials and control characters even when a provider misbehaves.
    obj['test'] = re.sub(r'https?://\S+|(?:bearer\s+|sk[-_])[\w.\-]+|[\x00-\x1f]', '[redacted]', obj['test'], flags=re.I)
    return obj, obj['projectedSqFt']==108 and slope is None and obj['decision']==expected and set(obj['refs'])=={COMMON['id'],case_id}


def retry_after(value):
    try:
        if value.isdigit():
            return time.time() + int(value)
        return email.utils.parsedate_to_datetime(value).timestamp()
    except (ValueError, TypeError, OverflowError, AttributeError):
        return time.time()+60


def usage_fields(reply):
    usage = reply.get('usage') or {}
    if not isinstance(usage,dict):
        return {}
    return {field:value for field,value in usage.items()
            if field in ('prompt_tokens','completion_tokens','total_tokens','input_tokens','output_tokens','cost_tokens','allowance_tokens')
            and type(value) in (int,float) and math.isfinite(value) and value>=0}


def public_sheets(unknown):
    if not unknown:
        return {}
    code, _, raw = fetch('https://apinex.bond/llms-full.txt')
    if code != 200:
        return {}
    out = {}
    for model in unknown:
        for line in raw.decode().splitlines():
            if not line.startswith('- `'+model+'`'):
                continue
            match = re.search(r'https://apinex\.bond/models/[a-z0-9-]+/llms\.txt',line)
            if match:
                code, _, data = fetch(match[0])
                if code == 200:
                    out[model] = {'url':match[0], 'sha256':digest(data)}
                break
    return out


def run(args):
    key = os.environ.get('APINEX_API_KEY')
    if not key:
        raise ValueError('APINEX_API_KEY is required')
    base = os.environ.get('APINEX_BASE_URL','https://api.apinex.bond/v1').rstrip('/')
    endpoint = urllib.parse.urlsplit(base)
    if endpoint.scheme!='https' or not endpoint.hostname or endpoint.username or endpoint.password or endpoint.query or endpoint.fragment:
        raise ValueError('configured endpoint requires HTTPS without embedded credentials or query')
    roster, headers = get_json(base+'/models',key)
    balance, _ = get_json(base+'/balance',key)
    subscription, _ = get_json(base+'/subscription',key)
    catalog, _ = get_json(CATALOG)
    ids = {m['id'] for m in roster['data']}
    metas = {m['id']:m for m in catalog['models']}
    sheets = public_sheets(ids - ROLES.keys())
    registry = [plan_model(i,metas.get(i),i in ids,sheets) for i in sorted(set(ROLES)|ids|metas.keys())]
    revision = subprocess.check_output(['git','rev-parse','HEAD'],cwd=ROOT,text=True).strip()
    case_sha = digest(pathlib.Path(__file__).with_name('specialist_cases.py').read_bytes().replace(b'\r\n',b'\n'))
    limits = [int(v) for v in (balance.get('rpm'),headers.get('x-ratelimit-limit')) if str(v).isdigit() and int(v)>0]
    evidence = dict(sourceRevision=revision, fixtureSha256=case_sha, observedUtc=datetime.datetime.now(datetime.timezone.utc).isoformat(),
                    publicJsonCount=len(metas), authenticatedCount=len(ids), balanceRead=True,
                    positiveSpendableBalance=balance.get('balance_usd',0)>0, activeReservation=balance.get('reserved_usd',0)>0,
                    balanceRpm=balance.get('rpm'), headerRpm=headers.get('x-ratelimit-limit'),
                    freeAllowance={'mode':subscription.get('mode'),'allowed':subscription.get('allowed'),
                                   'unlimited':subscription.get('unlimited'),'remainingReported':type(subscription.get('tokens_remaining')) is int},
                    catalog=CATALOG, registry=registry)
    args.out.mkdir(parents=True,exist_ok=True)
    with exclusive(args.out/'dispatch.lock'):
        path = args.out/'execution.json'
        ledger = json.loads(path.read_text()) if path.exists() else {'tasks':{},'notBefore':0,'sourceRevision':revision,'fixtureSha256':case_sha}
        if (ledger['sourceRevision'],ledger['fixtureSha256']) != (revision,case_sha):
            raise ValueError('run directory belongs to another source or fixture revision')
        atomic(args.out/'registry.json',evidence)
        if args.phase=='plan':
            return
        cap = math.floor(args.usd*1e6)
        if args.phase=='paid':
            if cap<=0:
                raise ValueError('positive owner-authorized --usd is required')
            if ledger.setdefault('authorizedMicroUsd',cap)!=cap:
                raise ValueError('existing run has a different spending ceiling')
            atomic(path,ledger)
        if time.time()<ledger.get('notBefore',0):
            raise ValueError('provider Retry-After interval is still active')
        if any(t['model'].startswith('free/') and (t.get('costMicroUsd') or 0)>0 for t in ledger['tasks'].values()):
            raise ValueError('a zero-dollar route reported a wallet debit; review billing before another dispatch')
        if not limits:
            raise ValueError('account RPM could not be established')
        if args.phase=='free' and subscription.get('allowed') is not True:
            raise ValueError('free allowance is currently unavailable')
        free_remaining=subscription.get('tokens_remaining')
        lifetime_limit=ledger.setdefault('requestLimit',sum(1+int(bool(r.get('visionClaim')))+int(bool(r.get('toolsClaim')))
                                                           for r in registry if not r.get('blocker')))
        spent=sum(max(t.get('latencyMs',TIMEOUT*1000)/1000,60/min(limits)) for t in ledger['tasks'].values())
        deadline = time.monotonic()+min(args.minutes*60,max(0,3600-spent))
        for row in registry:
            free = row['model'].startswith('free/')
            if free != (args.phase=='free') or row.get('blocker'):
                continue
            # Default two capability observations. The optional broader screen
            # adds requests to the same durable job under the same budget.
            modes = ['assignment']
            for mode, claim in [('vision','visionClaim'),('tools','toolsClaim')]:
                if row['model']=='free/qwen-3.8-max' or (getattr(args,'all_probes',False) and row.get(claim) is True):
                    modes.append(mode)
            for mode in modes:
                if time.monotonic()+TIMEOUT>deadline or len(ledger['tasks'])>=lifetime_limit:
                    return
                task_id = row['model'] + '/' + mode
                if task_id in ledger['tasks']:
                    continue
                if mode!='assignment' and ledger['tasks'][row['model']+'/assignment'].get('http')!=200:
                    continue
                route, body = build_request(row,mode)
                request_bytes = encode(body)
                if len(request_bytes)>32768:
                    raise ValueError('fixed input exceeds 32 KiB')
                reserved = sum(t.get('costMicroUsd') if t.get('costMicroUsd') is not None else t['reserveMicroUsd'] for t in ledger['tasks'].values())
                if not free and reserved+row['reserveMicroUsd']>cap:
                    continue
                if not free and row['reserveMicroUsd']>balance.get('balance_usd',0)*1e6:
                    continue
                free_reserve=0
                if free:
                    if type(row['weight']) is not int or row['weight']<1:
                        continue
                    free_reserve=(row['capacity']+MAX_OUTPUT)*row['weight']
                    if subscription.get('unlimited') is not True:
                        if type(free_remaining) is not int or free_reserve>free_remaining:
                            continue
                        free_remaining-=free_reserve
                remaining = 60/min(limits)-(time.time()-ledger.get('lastDispatch',0))
                if remaining>0:
                    time.sleep(remaining)
                start=time.time()
                elapsed_start=time.monotonic()
                entry=dict(status='dispatch-outcome-unknown',model=row['model'],mode=mode,route=route,sourceRevision=revision,
                           requestSha256=digest(request_bytes),inputBytes=len(request_bytes),case=row['case'],scope=row['assignment'],
                           reserveMicroUsd=row['reserveMicroUsd'],maxOutputTokens=MAX_OUTPUT if route!='decisions' else None,
                           sourceRefs=([COMMON['id'],row['case']] if mode=='assignment' else [digest(VISION.read_bytes()) if mode=='vision' else 'TOOL-1']),
                           timeoutSeconds=TIMEOUT,costMicroUsd=None,reserveFreeUnits=free_reserve,
                           dispatchUtc=datetime.datetime.now(datetime.timezone.utc).isoformat())
                ledger['tasks'][task_id]=entry
                ledger['lastDispatch']=start
                atomic(path,ledger)
                try:
                    status, response_headers, raw = fetch(base+'/'+route,key,body)
                    entry.update(http=status,responseSha256=digest(raw))
                    try:
                        reply=json.loads(raw)
                    except (ValueError,UnicodeDecodeError):
                        reply={}
                    if not isinstance(reply,dict):
                        reply={}
                    entry['usage']=usage_fields(reply)
                    entry['costMicroUsd']=entry['usage'].get('cost_tokens')
                    if entry['costMicroUsd'] is None:
                        top_cost=reply.get('cost_tokens')
                        if type(top_cost) is int and top_cost>=0:
                            entry['costMicroUsd']=top_cost
                            entry['costField']='cost_tokens'
                    else:
                        entry['costField']='usage.cost_tokens'
                    if free and type(free_remaining) is int:
                        tokens=entry['usage'].get('total_tokens')
                        if type(tokens) is int:
                            entry['estimatedFreeUnits']=tokens*row['weight']
                            free_remaining+=free_reserve-entry['estimatedFreeUnits']
                    for name,val in (('requestId',response_headers.get('x-request-id') or reply.get('id')),('returnedModel',reply.get('model'))):
                        if isinstance(val,str) and re.fullmatch(r'[\w./:-]{1,180}',val):
                            entry[name]=val
                    if status==200:
                        entry['status']='invalid-output'
                        result, passed=validate(row,mode,route,reply)
                        entry.update(proposal=result,status='oracle-pass' if passed else 'oracle-fail')
                        # A provider may legitimately return its canonical alias.
                        # Retain that observation, but do not credit another ID
                        # with qualifying until the alias has been verified.
                        if entry.get('returnedModel',row['model'])!=row['model']:
                            entry['identityStatus']='returned identifier differs; verify alias'
                    else:
                        entry['status']='http-error'
                        if status==429:
                            ledger['notBefore']=max(time.time()+60/min(limits),retry_after(response_headers.get('retry-after')))
                except (OSError, TimeoutError, ValueError, KeyError, IndexError, TypeError) as exc:
                    entry['errorClass']=type(exc).__name__
                finally:
                    entry['latencyMs']=round((time.monotonic()-elapsed_start)*1000)
                    atomic(path,ledger)
                print(task_id,entry['status'],entry.get('http','unknown'),flush=True)
                if entry['status']=='dispatch-outcome-unknown' or entry.get('http') in (401,429) or (free and (entry['costMicroUsd'] or 0)>0) or (not free and entry.get('http')==402):
                    return


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('phase',choices=('plan','free','paid'))
    parser.add_argument('out',type=pathlib.Path,help='Persistent private state directory, reuse on resume')
    parser.add_argument('--usd',type=float,default=0,help='Explicit total authorized paid USD for this run')
    parser.add_argument('--minutes',type=int,default=20,choices=range(1,61),metavar='1..60')
    parser.add_argument('--all-probes',action='store_true',help='Probe advertised vision and tool support for each eligible endpoint')
    args=parser.parse_args()
    if not math.isfinite(args.usd) or args.usd<0:
        parser.error('invalid spending ceiling')
    try:
        run(args)
    except (ValueError,OSError,KeyError) as exc:
        # Never print provider bodies or URLs containing user data.
        raise SystemExit('Sweep stopped: '+ (str(exc) if isinstance(exc,ValueError) else type(exc).__name__)) from None
