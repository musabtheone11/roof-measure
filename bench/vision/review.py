#!/usr/bin/env python3
"""Independent vision review of one property's views through APInex (external models) or a local bundle.

    python3 -I bench/vision/review.py --crops <dir with manifest.json> --out <dir> --roles outline,planes,obstruction,challenge
        [--models '{"outline":["free/gemini-3.1-pro"],...}'] [--rpm 24] [--local]

External: one request per (role, model) with the role prompt and the views as data-URI images; the key is injected by the
network proxy (the request carries no key, no address, no coordinates). Paced under the plan's 30 requests/minute.
Local (--local): writes bundle-<role>.md listing the images and the prompt for a Claude Code subagent, which answers in the
same JSON; its answer is read from observations-local-<role>.json if present.
Output: observations.json: every observation with view px converted to parent-image px and to lat/lng via the manifest.
"""
import argparse, base64, json, os, re, sys, time, threading, urllib.request
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from prompts import ROLES

ap = argparse.ArgumentParser()
ap.add_argument('--crops', required=True); ap.add_argument('--out', required=True)
ap.add_argument('--roles', default='outline,planes,obstruction,challenge'); ap.add_argument('--models', default=None)
ap.add_argument('--rpm', type=int, default=24); ap.add_argument('--workers', type=int, default=3); ap.add_argument('--max-tokens', type=int, default=4000); ap.add_argument('--timeout', type=int, default=240)
ap.add_argument('--local', action='store_true'); ap.add_argument('--dry', action='store_true')
a = ap.parse_args()
M = json.load(open(os.path.join(a.crops, 'manifest.json'))); views = {v['id']: v for v in M['views']}
os.makedirs(a.out, exist_ok=True)
DEFAULT_MODELS = {   # free models for the broad passes; the paid challenge models are added for disputed cases by the caller
  'outline': ['free/gemini-3.1-pro', 'free/qwen-3.8-max', 'free/kimi-k3'],
  'planes': ['free/gemini-4-hydrogen', 'free/mimo-v2.6-pro', 'free/hy4'],
  'obstruction': ['free/gemini-3.8-flash', 'free/minimax-m3'],
  'challenge': ['free/claude-opus-4.6', 'free/claude-sonnet-4.6', 'free/mimo-v2.6-flash'],
}
models = json.loads(a.models) if a.models else DEFAULT_MODELS
VIEW_SETS = {'outline': ['whole', 'building', 'tile-A1', 'tile-B1', 'tile-A2', 'tile-B2'], 'planes': ['building', 'tile-A1', 'tile-B1', 'tile-A2', 'tile-B2'],
             'obstruction': ['whole', 'building'], 'challenge': ['building-sketch', 'tile-A1-sketch', 'tile-B1-sketch', 'tile-A2-sketch', 'tile-B2-sketch']}

def data_uri(fn):
    with open(os.path.join(a.crops, fn), 'rb') as f: return 'data:image/png;base64,' + base64.b64encode(f.read()).decode()

def build(role):
    ids = [v for v in VIEW_SETS[role] if v in views]
    text = ROLES[role] + '\n\nViews attached, in order: ' + ', '.join(f'"{v}" ({views[v]["label"]}, {views[v]["size"][0]}x{views[v]["size"][1]} px, grid {views[v]["gridM"]} m)' for v in ids)
    content = [{'type': 'text', 'text': text}]
    for v in ids: content.append({'type': 'text', 'text': f'view id: {v}'}); content.append({'type': 'image_url', 'image_url': {'url': data_uri(views[v]['file'])}})
    return ids, content, text

def to_parent(view_id, p):
    v = views[view_id]; return [v['box'][0] + p[0] / v['scale'], v['box'][1] + p[1] / v['scale']]
def to_ll(pp):
    f = M['parent']['frame']; return [f['lat0'] + f['dLatDy'] * pp[1], f['lng0'] + f['dLngDx'] * pp[0]]

def parse(text):
    m = re.search(r'\{.*\}', text, re.S)
    if not m: return None
    try: return json.loads(m.group(0))
    except json.JSONDecodeError:
        try: return json.loads(re.sub(r',\s*([}\]])', r'\1', m.group(0)))
        except json.JSONDecodeError: return None

results, lock = [], threading.Lock()
def call(role, model, content):
    body = json.dumps({'model': model, 'max_tokens': a.max_tokens, 'temperature': 0, 'messages': [{'role': 'user', 'content': content}]}).encode()
    req = urllib.request.Request('https://api.apinex.bond/v1/chat/completions', data=body, headers={'Authorization': 'Bearer proxy-injected', 'Content-Type': 'application/json'})
    t0 = time.time(); tag = f'{role}_{model.replace("/", "_")}'
    for attempt in range(3):   # upstream 502s are frequent for image requests: retry twice with a pause
        try:
            with urllib.request.urlopen(req, timeout=a.timeout) as r: raw = r.read().decode()
            code = 200
        except urllib.error.HTTPError as e: raw = e.read().decode(errors='replace'); code = e.code
        except Exception as e: raw = str(e); code = 0
        if code == 200 or code == 400 or code == 401: break
        time.sleep(15 * (attempt + 1))
    open(os.path.join(a.out, tag + '.resp.json'), 'w').write(raw)
    rec = {'role': role, 'model': model, 'http': code, 'seconds': round(time.time() - t0, 1), 'observations': None, 'finish': None}
    try:
        d = json.loads(raw); ch = d['choices'][0]; rec['finish'] = ch.get('finish_reason'); rec['usage'] = d.get('usage')
        rec['observations'] = parse(ch['message'].get('content') or '')
    except Exception: rec['error'] = raw[:200]
    with lock: results.append(rec)

roles = [r for r in a.roles.split(',') if r]
if a.local:
    for role in roles:
        ids, content, text = build(role)
        with open(os.path.join(a.out, f'bundle-{role}.md'), 'w') as f:
            f.write(f'# Local vision review bundle: role {role}\n\nImages (view ids in order):\n' + ''.join(f'- {v}: {os.path.abspath(os.path.join(a.crops, views[v]["file"]))}\n' for v in ids) + '\n## Prompt\n\n' + text + f'\n\nWrite the JSON answer to: {os.path.abspath(os.path.join(a.out, f"observations-local-{role}.json"))}\n')
    print('local bundles written:', ', '.join(f'bundle-{r}.md' for r in roles))
else:
    jobs = [(role, m) for role in roles for m in models.get(role, [])]
    if a.dry: print('would send', [(r, m) for r, m in jobs]); sys.exit(0)
    built = {role: build(role) for role in roles}
    # a few requests in flight at a time, started a few seconds apart (twelve parallel image requests made the free models fail)
    import queue; q = queue.Queue(); [q.put(j) for j in jobs]
    def worker():
        while True:
            try: role, m = q.get_nowait()
            except queue.Empty: return
            call(role, m, built[role][1]); q.task_done()
    ws = []
    for w in range(a.workers):
        t = threading.Thread(target=worker); t.start(); ws.append(t); time.sleep(4)
    for t in ws: t.join()

# ---- collect (external results now, local answers if present) into observations.json
obs = []
def ingest(role, model, payload, source):
    if not isinstance(payload, dict): return 0
    n = 0
    for o in payload.get('observations') or []:
        if not isinstance(o, dict) or o.get('view') not in views or not isinstance(o.get('px'), list): continue
        pts = [p for p in o['px'] if isinstance(p, list) and len(p) == 2 and all(isinstance(c, (int, float)) for c in p)]
        if not pts: continue
        pp = [to_parent(o['view'], p) for p in pts]
        obs.append({'source': source, 'role': role, 'model': model, 'view': o['view'], 'kind': o.get('kind'), 'type': o.get('type'), 'verdict': o.get('verdict'), 'sketch_type': o.get('sketch_type'),
                    'px_view': pts, 'px_parent': pp, 'll': [to_ll(p) for p in pp], 'grid': o.get('grid'), 'evidence': o.get('evidence'), 'confidence': o.get('confidence')}); n += 1
    for u in payload.get('unresolved') or []:
        if isinstance(u, dict): obs.append({'source': source, 'role': role, 'model': model, 'view': u.get('view'), 'kind': 'unresolved', 'grid': u.get('grid'), 'question': u.get('question')})
    return n
summary = []
for rec in results:
    n = ingest(rec['role'], rec['model'], rec.get('observations'), 'apinex'); rec['n'] = n; summary.append(rec)
for role in roles:
    fn = os.path.join(a.out, f'observations-local-{role}.json')
    if os.path.exists(fn):
        try: n = ingest(role, 'claude-code-subagent', json.load(open(fn)), 'local'); summary.append({'role': role, 'model': 'claude-code-subagent', 'n': n, 'http': 'local'})
        except json.JSONDecodeError: summary.append({'role': role, 'model': 'claude-code-subagent', 'error': 'bad json'})
prev = os.path.join(a.out, 'observations.json'); prevRuns = []
if os.path.exists(prev):   # keep earlier observations from (role, model) pairs not run this time (retries, local passes)
    try:
        old = json.load(open(prev)); redone = {(r['role'], r['model']) for r in summary}
        obs = [o for o in old.get('observations', []) if (o.get('role'), o.get('model')) not in redone] + obs
        prevRuns = [r for r in old.get('runs', []) if (r.get('role'), r.get('model')) not in redone]
    except (json.JSONDecodeError, KeyError): pass
json.dump({'crops': os.path.abspath(a.crops), 'parent': M['parent'], 'runs': prevRuns + summary, 'observations': obs}, open(prev, 'w'), indent=1)
for r in summary: print(f"{r['role']:12} {r['model']:28} http {r.get('http')} finish {r.get('finish')} observations {r.get('n')} {('ERR ' + r['error']) if r.get('error') else ''}")
print(f'{len(obs)} observations -> {prev}')
