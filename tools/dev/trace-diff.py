#!/usr/bin/env python3
"""Annotated before/after overlay of two traces of one roof over a georeferenced image.

    python3 -I tools/dev/trace-diff.py --before a/roof.json --after b/roof.json --image img.png --frame img.json --out diff.png
        [--note "1=evidence text" --note "2=..."] [--half 18]

Lines present in only one trace (no line of the same type within 0.5 m along its whole length in the other) are the
corrected segments: removed ones dashed red, added ones green; unchanged lines thin gray. Changes are numbered by area
(clusters within 4 m) and listed beside the image with the evidence given by --note. Output is private (customer imagery).
"""
import argparse, json, math
from PIL import Image, ImageDraw, ImageFont

ap = argparse.ArgumentParser()
for k in ('before', 'after', 'image', 'frame', 'out'): ap.add_argument('--' + k, required=True)
ap.add_argument('--note', action='append', default=[]); ap.add_argument('--half', type=float, default=None); ap.add_argument('--size', type=int, default=900)
ap.add_argument('--title', default='Trace before and after')
a = ap.parse_args()
F = json.load(open(a.frame)); im0 = Image.open(a.image).convert('RGB')
if 'bbox' in F: b, px, sh = F['bbox'], F['px'], F.get('shift') or {'lng': 0, 'lat': 0}; F = {'w': px, 'h': px, 'lng0': b['w'] + sh['lng'], 'dLngDx': (b['e'] - b['w']) / px, 'lat0': b['n'] + sh['lat'], 'dLatDy': -(b['n'] - b['s']) / px}
B, A = json.load(open(a.before)), json.load(open(a.after))
lat0 = A['facets'][0]['path'][0]['lat']; kx, ky = 111320 * math.cos(math.radians(lat0)), 110540
M = lambda p: ((p['lng'] - F['lng0']) * kx, (p['lat'] - F['lat0']) * ky)            # metres from the image origin
toPx = lambda p: ((p['lng'] - F['lng0']) / F['dLngDx'], (p['lat'] - F['lat0']) / F['dLatDy'])
def segd(p, a2, b2):
    dx, dy = b2[0] - a2[0], b2[1] - a2[1]; L2 = dx * dx + dy * dy; t = 0 if not L2 else max(0, min(1, ((p[0] - a2[0]) * dx + (p[1] - a2[1]) * dy) / L2)); return math.hypot(p[0] - a2[0] - t * dx, p[1] - a2[1] - t * dy)
def covered(e, others):
    pts = [M(p) for p in e['path']]; samples = []
    for i in range(1, len(pts)):
        n = max(1, int(math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]) / 0.25))
        samples += [(pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * j / n, pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * j / n) for j in range(n + 1)]
    for o in others:
        if o['type'] != e['type']: continue
    segs = [(o['type'], [M(p) for p in o['path']]) for o in others]
    ok = sum(1 for s in samples if any(t == e['type'] and any(segd(s, q[i - 1], q[i]) < 0.5 for i in range(1, len(q))) for t, q in segs))
    return ok / max(1, len(samples)) > 0.85
removed = [e for e in B['edges'] if e.get('type') != 'obstruction' and not covered(e, A['edges'])]
added = [e for e in A['edges'] if e.get('type') != 'obstruction' and not covered(e, B['edges'])]
same = [e for e in A['edges'] if e not in added]
# window around the roof
xs, ys = [], []
for f in A['facets'] + B['facets']:
    for p in f['path']: x, y = toPx(p); xs.append(x); ys.append(y)
mpp = abs(F['dLngDx']) * kx; cx, cy = (min(xs) + max(xs)) / 2, (min(ys) + max(ys)) / 2; half = (a.half / mpp) if a.half else max(max(xs) - min(xs), max(ys) - min(ys)) / 2 + 3 / mpp
box = (int(cx - half), int(cy - half), int(cx + half), int(cy + half)); s = a.size / (2 * half)
view = im0.crop(box).resize((a.size, a.size), Image.BICUBIC).convert('L').convert('RGB')
d = ImageDraw.Draw(view, 'RGBA'); P = lambda p: ((toPx(p)[0] - box[0]) * s, (toPx(p)[1] - box[1]) * s)
try: font = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf', 17); small = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf', 15)
except OSError: font = small = ImageFont.load_default()
def dashed(pts, col, w):
    for i in range(1, len(pts)):
        (x0, y0), (x1, y1) = pts[i - 1], pts[i]; L = math.hypot(x1 - x0, y1 - y0); n = max(1, int(L / 9))
        for j in range(0, n, 2): t0, t1 = j / n, min(1, (j + 1) / n); d.line([(x0 + (x1 - x0) * t0, y0 + (y1 - y0) * t0), (x0 + (x1 - x0) * t1, y0 + (y1 - y0) * t1)], fill=col, width=w)
for e in same: d.line([P(p) for p in e['path']], fill=(255, 255, 255, 200), width=2)
for e in removed: dashed([P(p) for p in e['path']], (230, 30, 30, 255), 5)
for e in added: d.line([P(p) for p in e['path']], fill=(30, 210, 60, 255), width=5)
# number the changes by area
clusters = []
for kind, E in (('removed', removed), ('added', added)):
    for e in E:
        c = [sum(M(p)[0] for p in e['path']) / len(e['path']), sum(M(p)[1] for p in e['path']) / len(e['path'])]
        cl = next((k for k in clusters if math.hypot(k['c'][0] - c[0], k['c'][1] - c[1]) < 4), None)
        if cl: cl['items'].append((kind, e))
        else: clusters.append({'c': c, 'items': [(kind, e)], 'px': P(e['path'][len(e['path']) // 2])})
for i, k in enumerate(clusters):
    x, y = k['px']; d.ellipse([x + 10, y - 26, x + 38, y + 2], fill=(255, 255, 255, 235), outline=(0, 0, 0, 255), width=2); d.text((x + 24, y - 12), str(i + 1), fill=(0, 0, 0, 255), font=font, anchor='mm')
# side panel with the list of changes and the evidence
notes = dict(n.split('=', 1) for n in a.note if '=' in n)
panel = Image.new('RGB', (520, a.size), (255, 255, 255)); pd = ImageDraw.Draw(panel); y = 16
pd.text((16, y), a.title, fill=(0, 0, 0), font=font); y += 30
pd.text((16, y), 'red dashed = removed   green = added   white = unchanged', fill=(60, 60, 60), font=small); y += 30
def wrap(t, w=58):
    out, line = [], ''
    for word in t.split():
        if len(line) + len(word) + 1 > w: out.append(line); line = word
        else: line = (line + ' ' + word).strip()
    return out + ([line] if line else [])
fmt = lambda e: f"{e['type']} {math.hypot(*[M(e['path'][-1])[j] - M(e['path'][0])[j] for j in (0, 1)]) * 3.28084:.1f} ft"
for i, k in enumerate(clusters):
    rem = [fmt(e) for kind, e in k['items'] if kind == 'removed']; add = [fmt(e) for kind, e in k['items'] if kind == 'added']
    pd.text((16, y), f'{i + 1}.', fill=(0, 0, 0), font=font)
    for t in ([('removed: ' + ', '.join(rem))] if rem else []) + ([('added: ' + ', '.join(add))] if add else []):
        for l in wrap(t): pd.text((44, y), l, fill=(30, 30, 30), font=small); y += 20
    for l in wrap('Evidence: ' + notes.get(str(i + 1), 'see the report notes')): pd.text((44, y), l, fill=(70, 70, 70), font=small); y += 20
    y += 10
pd.text((16, a.size - 60), f"before: {len(B['facets'])} facets, {len(B['edges'])} lines", fill=(60, 60, 60), font=small)
pd.text((16, a.size - 38), f"after: {len(A['facets'])} facets, {len(A['edges'])} lines", fill=(60, 60, 60), font=small)
out = Image.new('RGB', (a.size + 520, a.size), (255, 255, 255)); out.paste(view, (0, 0)); out.paste(panel, (a.size, 0)); out.save(a.out)
print(a.out, f'{len(removed)} removed, {len(added)} added, {len(clusters)} change areas')
for i, k in enumerate(clusters): print(f'  {i + 1}:', [(kind, e['type']) for kind, e in k['items']], 'at', [round(v, 1) for v in k['c']])
