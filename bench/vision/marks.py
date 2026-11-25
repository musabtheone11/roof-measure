#!/usr/bin/env python3
"""Draw the fusion result over a georeferenced view: python3 -I bench/vision/marks.py --crops <crops dir> --fuse <fuse dir> --out marks.png [--view building-sketch]
Green: accepted corner moves (old -> new) and retyped lines. Yellow: items left open for review (the sketch may be wrong, the
sources cannot settle it). Red dashes: proposals rejected for lack of height-model evidence. Magenta: canopy/shadow flags."""
import argparse, json, os
from PIL import Image, ImageDraw, ImageFont
ap = argparse.ArgumentParser(); ap.add_argument('--crops', required=True); ap.add_argument('--fuse', required=True); ap.add_argument('--out', required=True); ap.add_argument('--view', default='building-sketch')
a = ap.parse_args()
M = json.load(open(os.path.join(a.crops, 'manifest.json'))); V = next(v for v in M['views'] if v['id'] == a.view); f = M['parent']['frame']
P = json.load(open(os.path.join(a.fuse, 'proposals.json')))['proposals']
im = Image.open(os.path.join(a.crops, V['file'])).convert('RGB'); d = ImageDraw.Draw(im, 'RGBA')
try: font = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf', 14)
except OSError: font = ImageFont.load_default()
def px(ll):
    x = (ll['lng'] - f['lng0']) / f['dLngDx']; y = (ll['lat'] - f['lat0']) / f['dLatDy']
    return ((x - V['box'][0]) * V['scale'], (y - V['box'][1]) * V['scale'])
def dashed(p, q, fill, w=2, dash=8):
    L = ((q[0] - p[0]) ** 2 + (q[1] - p[1]) ** 2) ** 0.5; n = max(1, int(L / dash))
    for i in range(0, n, 2): t0, t1 = i / n, min(1, (i + 1) / n); d.line([(p[0] + (q[0] - p[0]) * t0, p[1] + (q[1] - p[1]) * t0), (p[0] + (q[0] - p[0]) * t1, p[1] + (q[1] - p[1]) * t1)], fill=fill, width=w)
counts = {'accepted': 0, 'open': 0, 'notes': 0, 'rejected': 0, 'flag': 0}
for p in P:
    if p['kind'] in ('corner-displaced',) and p['decision'] == 'accept':
        old = px(p['from']) if 'from' in p else None; new = px(p['p']); counts['accepted'] += 1
        if old: d.line([old, new], fill=(40, 255, 40, 255), width=3)
        d.ellipse([new[0] - 7, new[1] - 7, new[0] + 7, new[1] + 7], outline=(40, 255, 40, 255), width=3)
    elif p['kind'] == 'misclassified' and p['decision'] == 'accept':
        d.line([px(p['a']), px(p['b'])], fill=(40, 255, 40, 255), width=4); counts['accepted'] += 1
    elif p['decision'] == 'accept-as-open' and 'a' in p:
        d.line([px(p['a']), px(p['b'])], fill=(255, 230, 0, 240), width=5); counts['open'] += 1
    elif p['decision'] == 'accept-as-open' and 'p' in p:
        q = px(p['p']); d.ellipse([q[0] - 8, q[1] - 8, q[0] + 8, q[1] + 8], outline=(255, 230, 0, 255), width=4); counts['open'] += 1
    elif p['decision'] == 'unresolved' and 'a' in p:
        d.line([px(p['a']), px(p['b'])], fill=(255, 230, 0, 110), width=1); counts['notes'] += 1
    elif p['decision'] == 'unresolved' and 'p' in p:
        q = px(p['p']); d.ellipse([q[0] - 5, q[1] - 5, q[0] + 5, q[1] + 5], outline=(255, 230, 0, 150), width=1); counts['notes'] += 1
    elif p['decision'] == 'reject' and 'a' in p:
        dashed(px(p['a']), px(p['b']), (255, 60, 60, 200)); counts['rejected'] += 1
    elif p['decision'] == 'flag': counts['flag'] += 1
w, h = im.size; d.rectangle([0, h - 20, w, h], fill=(0, 0, 0, 190))
d.text((6, h - 18), f"green accepted ({counts['accepted']})  thick yellow opened for review ({counts['open']})  thin yellow notes ({counts['notes']})  red dashed rejected ({counts['rejected']})  canopy/shadow flags ({counts['flag']})", fill=(255, 255, 255, 255), font=font)
im.save(a.out); print(a.out, counts)
