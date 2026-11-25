#!/usr/bin/env python3
"""Targeted re-review of disputed proposals: one focused crop per dispute with the sketch line and the observed line drawn,
sent to the challenge models with the question which line (if either) is the roof edge and what evidence would settle it.

    python3 -I bench/vision/rereview.py --crops <crops dir> --fuse <fuse dir> --out <dir> [--models gemini-4-carbon,gpt-6.2-astra,free/claude-opus-4.6] [--max 6]

Only proposals with decision "unresolved" or "accept-as-open" are sent (the disputed ones). The answer never changes
geometry by itself: it is recorded next to the proposal (rereview.json) as the reviewers' reading and the evidence they
ask for, which the report's open items and the worst-case write-up quote.
"""
import argparse, base64, io, json, os, re, time, urllib.request
from PIL import Image, ImageDraw, ImageFont
ap = argparse.ArgumentParser(); ap.add_argument('--crops', required=True); ap.add_argument('--fuse', required=True); ap.add_argument('--out', required=True)
ap.add_argument('--models', default='gemini-4-carbon,gpt-6.2-astra,free/claude-opus-4.6'); ap.add_argument('--max', type=int, default=6); ap.add_argument('--rpm', type=int, default=20); ap.add_argument('--dry', action='store_true')
a = ap.parse_args(); os.makedirs(a.out, exist_ok=True)
M = json.load(open(os.path.join(a.crops, 'manifest.json'))); f = M['parent']['frame']; parent = Image.open(os.path.join(a.crops, '..', M['parent']['file'])).convert('RGB') if os.path.exists(os.path.join(a.crops, '..', M['parent']['file'])) else None
if parent is None: parent = Image.open(os.path.join(os.path.dirname(a.crops.rstrip('/')), M['parent']['file'])).convert('RGB')
P = json.load(open(os.path.join(a.fuse, 'proposals.json')))['proposals']
disputed = [p for p in P if p['decision'] in ('unresolved', 'accept-as-open') and 'a' in p][:a.max]
try: font = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf', 15)
except OSError: font = ImageFont.load_default()
ppx = lambda ll: ((ll['lng'] - f['lng0']) / f['dLngDx'], (ll['lat'] - f['lat0']) / f['dLatDy'])
mPerPx = M['parent']['mPerPx']
def crop_for(p, i):
    a0, b0 = ppx(p['a']), ppx(p['b']); cx, cy = (a0[0] + b0[0]) / 2, (a0[1] + b0[1]) / 2
    half = max(8 / mPerPx, max(abs(a0[0] - b0[0]), abs(a0[1] - b0[1])) / 2 + 4 / mPerPx)
    box = [cx - half, cy - half, cx + half, cy + half]; s = 640 / (2 * half)
    im = parent.crop(tuple(int(round(v)) for v in box)).resize((640, 640), Image.BICUBIC); d = ImageDraw.Draw(im, 'RGBA')
    T = lambda q: ((q[0] - box[0]) * s, (q[1] - box[1]) * s)
    d.line([T(a0), T(b0)], fill=(255, 230, 0, 240), width=4)                       # observed (yellow)
    sk = None
    if p.get('sketchEdge') is not None and os.path.exists(os.path.join(a.fuse, 'job-c.json')):
        pass
    # the sketch lines near the dispute, from the crops' own sketch overlay source is not stored; draw from marks: use the "-sketch" view instead
    bar = 5 / mPerPx * s; d.rectangle([640 - bar - 16, 640 - 26, 640 - 16, 640 - 18], fill=(0, 0, 0, 255)); d.rectangle([640 - bar - 16, 640 - 26, 640 - bar / 2 - 16, 640 - 18], fill=(255, 255, 255, 255)); d.text((640 - bar - 16, 640 - 46), '5 m', fill=(255, 255, 0, 255), font=font)
    d.rectangle([0, 0, 640, 22], fill=(0, 0, 0, 170)); d.text((6, 3), f'dispute {i}: yellow = a line a reviewer drew ({p.get("type")}); north up', fill=(255, 255, 255, 255), font=font)
    fn = os.path.join(a.out, f'dispute-{i}.png'); im.save(fn); return fn
def sketch_crop(p, i):
    """the same window from the candidate-sketch building view, so the reviewer sees the traced lines too"""
    V = next((v for v in M['views'] if v['id'] == 'building-sketch'), None)
    if not V: return None
    im = Image.open(os.path.join(a.crops, V['file'])).convert('RGB'); a0, b0 = ppx(p['a']), ppx(p['b']); cx, cy = (a0[0] + b0[0]) / 2, (a0[1] + b0[1]) / 2
    half = max(8 / mPerPx, max(abs(a0[0] - b0[0]), abs(a0[1] - b0[1])) / 2 + 4 / mPerPx)
    box = [(cx - half - V['box'][0]) * V['scale'], (cy - half - V['box'][1]) * V['scale'], (cx + half - V['box'][0]) * V['scale'], (cy + half - V['box'][1]) * V['scale']]
    box = [max(0, box[0]), max(0, box[1]), min(im.width, box[2]), min(im.height, box[3])]
    if box[2] - box[0] < 20 or box[3] - box[1] < 20: return None
    c = im.crop(tuple(int(round(v)) for v in box)).resize((640, 640), Image.BICUBIC); d = ImageDraw.Draw(c, 'RGBA')
    d.rectangle([0, 0, 640, 22], fill=(0, 0, 0, 170)); d.text((6, 3), f'dispute {i}: the candidate sketch over the photo (white = facets, coloured = traced lines)', fill=(255, 255, 255, 255), font=font)
    fn = os.path.join(a.out, f'dispute-{i}-sketch.png'); c.save(fn); return fn
def uri(fn):
    with open(fn, 'rb') as h: return 'data:image/png;base64,' + base64.b64encode(h.read()).decode()
Q = """Two views of the same spot on an aerial photo (north up, 5 m scale bar). View 1: a yellow line is where an independent reviewer
drew a roof edge of type "{type}". View 2: the candidate roof sketch over the same photo (white outline = traced facets; green eave,
yellow-orange rake, light-yellow ridge, purple hip, red valley, orange step, blue wall; bright red = obstruction boundary).
The sketch has {near}. Question: is the yellow line a real roof edge the sketch lacks, the same edge as a sketch line but drawn
off, a tree/shadow/ground line, or can the photo not tell? Answer JSON only:
{{"reading": "real-edge-missing-from-sketch|same-as-sketch-line|not-a-roof-edge|cannot-tell", "what_it_follows": "<what the yellow line runs along in the photo>",
 "evidence_needed": "<what would settle it: e.g. a leaf-off photo, an oblique view from the south, a height model, a tape measurement of which wall>", "confidence": <0-1>}}"""
results = []
jobs = []
for i, p in enumerate(disputed):
    fn = crop_for(p, i); sk = sketch_crop(p, i)
    near = f"a {p.get('sketchType')} line {p.get('why', '').split(';')[0]}" if p.get('sketchType') else 'no line within 1.5 m of it'
    content = [{'type': 'text', 'text': Q.format(type=p.get('type'), near=near)}, {'type': 'text', 'text': 'view 1'}, {'type': 'image_url', 'image_url': {'url': uri(fn)}}]
    if sk: content += [{'type': 'text', 'text': 'view 2'}, {'type': 'image_url', 'image_url': {'url': uri(sk)}}]
    for m in a.models.split(','): jobs.append((i, m, content))
print(f'{len(disputed)} disputed proposals, {len(jobs)} requests')
if a.dry: raise SystemExit
gap = 60.0 / a.rpm
for i, m, content in jobs:
    body = json.dumps({'model': m, 'max_tokens': 1500, 'temperature': 0, 'messages': [{'role': 'user', 'content': content}]}).encode()
    req = urllib.request.Request('https://api.apinex.bond/v1/chat/completions', data=body, headers={'Authorization': 'Bearer proxy-injected', 'Content-Type': 'application/json'})
    t0 = time.time(); raw, code = '', 0
    for attempt in range(3):
        try:
            with urllib.request.urlopen(req, timeout=180) as r: raw = r.read().decode(); code = 200
        except urllib.error.HTTPError as e: raw = e.read().decode(errors='replace'); code = e.code
        except Exception as e: raw = str(e); code = 0
        if code == 200: break
        time.sleep(15 * (attempt + 1))
    rec = {'dispute': i, 'model': m, 'http': code, 'proposal': {k: disputed[i].get(k) for k in ('kind', 'decision', 'type', 'sketchType', 'why')}}
    try:
        d = json.loads(raw); c = d['choices'][0]['message'].get('content') or ''; j = re.search(r'\{.*\}', c, re.S); rec['answer'] = json.loads(j.group(0)) if j else {'raw': c[:300]}
    except Exception: rec['error'] = raw[:200]
    results.append(rec); print(f"dispute {i} {m:24} http {code}: {json.dumps(rec.get('answer', rec.get('error')))[:150]}")
    el = time.time() - t0
    if el < gap: time.sleep(gap - el)
json.dump(results, open(os.path.join(a.out, 'rereview.json'), 'w'), indent=1); print('->', os.path.join(a.out, 'rereview.json'))
