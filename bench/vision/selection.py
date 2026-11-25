#!/usr/bin/env python3
"""Building-selection check: when the geocoded address point sits away from the traced building, ask the reviewers which
roofed structure the marked point belongs to and whether the sketch covers it.
    python3 -I bench/vision/selection.py --crops <crops dir with the marker drawn> --out <dir> [--models a,b,c]
Writes selection.json; the answers are evidence for the report's open items, never a change of geometry."""
import argparse, base64, json, os, re, time, urllib.request
ap = argparse.ArgumentParser(); ap.add_argument('--crops', required=True); ap.add_argument('--out', required=True)
ap.add_argument('--models', default='free/gemini-3.1-pro,free/claude-opus-4.6,gemini-4-carbon'); a = ap.parse_args(); os.makedirs(a.out, exist_ok=True)
def uri(fn):
    with open(fn, 'rb') as h: return 'data:image/png;base64,' + base64.b64encode(h.read()).decode()
Q = """Two views of an aerial photo (north up, grid and scale bar printed). View 1 is the whole view: a cyan cross labelled "address point"
marks the geocoded address. View 2 is the building window with the candidate roof sketch drawn (white outline = traced facets; coloured
lines = traced edges). Question: which roofed structure does the cyan address point sit on or nearest to, and does the sketch cover
that structure? Answer JSON only: {"address_point_on": "traced-building|other-roofed-structure|open-ground|cannot-tell",
 "structure_description": "<what the point sits on or nearest to, with its grid cell>", "distance_to_traced_building_m": <number or null>,
 "sketch_covers_it": true|false|null, "confidence": <0-1>}"""
content = [{'type': 'text', 'text': Q}, {'type': 'text', 'text': 'view 1 (whole)'}, {'type': 'image_url', 'image_url': {'url': uri(os.path.join(a.crops, 'whole.png'))}}, {'type': 'text', 'text': 'view 2 (building window with sketch)'}, {'type': 'image_url', 'image_url': {'url': uri(os.path.join(a.crops, 'building-sketch.png'))}}]
out = []
for m in a.models.split(','):
    body = json.dumps({'model': m, 'max_tokens': 1200, 'temperature': 0, 'messages': [{'role': 'user', 'content': content}]}).encode()
    req = urllib.request.Request('https://api.apinex.bond/v1/chat/completions', data=body, headers={'Authorization': 'Bearer proxy-injected', 'Content-Type': 'application/json'})
    raw, code = '', 0
    for attempt in range(3):
        try:
            with urllib.request.urlopen(req, timeout=180) as r: raw = r.read().decode(); code = 200
        except urllib.error.HTTPError as e: raw = e.read().decode(errors='replace'); code = e.code
        except Exception as e: raw = str(e); code = 0
        if code == 200: break
        time.sleep(15 * (attempt + 1))
    rec = {'model': m, 'http': code}
    try: d = json.loads(raw); c = d['choices'][0]['message'].get('content') or ''; j = re.search(r'\{.*\}', c, re.S); rec['answer'] = json.loads(j.group(0)) if j else {'raw': c[:300]}
    except Exception: rec['error'] = raw[:200]
    out.append(rec); print(m, code, json.dumps(rec.get('answer', rec.get('error')))[:220]); time.sleep(3)
json.dump(out, open(os.path.join(a.out, 'selection.json'), 'w'), indent=1)
