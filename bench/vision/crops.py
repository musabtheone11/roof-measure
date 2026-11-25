#!/usr/bin/env python3
"""Whole-building view plus overlapping detail crops of a georeferenced aerial image, for independent vision review.

    python3 -I bench/vision/crops.py --image naip.png --frame naip.json --out <dir> [--sketch roof.json] [--half 32]

Every output image carries a lettered/numbered grid and a scale bar; the manifest records, for each image, its box in the
parent image (pixels), its scale, and the parent's pixel -> lat/lng frame, so an observation given in the pixels of any
view maps back to the parent image and to the ground exactly. Nothing in the images or the manifest names the property.

Frame file: naip.json from bench/vision/naip.mjs ({bbox{w,s,e,n}, px, shift{lng,lat}}) or a generic
{"w":W,"h":H,"lng0":..,"dLngDx":..,"lat0":..,"dLatDy":..} (lng = lng0 + dLngDx*x, lat = lat0 + dLatDy*y).
Sketch: a saved job / roof.json with facets[{path:[{lat,lng}]}] and edges[{type, path}] drawn as the candidate sketch.
"""
import argparse, json, math, os
from PIL import Image, ImageDraw, ImageFont

ap = argparse.ArgumentParser()
ap.add_argument('--image', required=True); ap.add_argument('--frame', required=True); ap.add_argument('--out', required=True)
ap.add_argument('--sketch', default=None); ap.add_argument('--half', type=float, default=None, help='half-size (m) of the building window; default from the sketch, else 22')
ap.add_argument('--tiles', type=int, default=2, help='tiles per side for the detail crops'); ap.add_argument('--overlap', type=float, default=0.25)
ap.add_argument('--size', type=int, default=896, help='output size of each view (px)')
ap.add_argument('--marker', default=None, help='lat,lng of the address point to mark (helps the reviewers say which building is the one asked about)')
a = ap.parse_args()
os.makedirs(a.out, exist_ok=True)
F = json.load(open(a.frame))
if 'bbox' in F:   # naip.mjs frame
    b, px, sh = F['bbox'], F['px'], F.get('shift') or {'lng': 0, 'lat': 0}
    frame = {'w': px, 'h': px, 'lng0': b['w'] + sh['lng'], 'dLngDx': (b['e'] - b['w']) / px, 'lat0': b['n'] + sh['lat'], 'dLatDy': -(b['n'] - b['s']) / px}
else: frame = F
im = Image.open(a.image).convert('RGB'); W, H = im.size
assert (W, H) == (frame['w'], frame['h']), f'image {im.size} does not match frame {frame["w"]}x{frame["h"]}'
latC = frame['lat0'] + frame['dLatDy'] * H / 2
kx, ky = 111320 * math.cos(math.radians(latC)), 110540
mPerPxX, mPerPxY = abs(frame['dLngDx']) * kx, abs(frame['dLatDy']) * ky; mPerPx = (mPerPxX + mPerPxY) / 2
to_px = lambda lat, lng: ((lng - frame['lng0']) / frame['dLngDx'], (lat - frame['lat0']) / frame['dLatDy'])

# ---- candidate sketch (optional)
sketch = None
if a.sketch:
    J = json.load(open(a.sketch)); pt = lambda p: to_px(p['lat'], p['lng']) if isinstance(p, dict) else to_px(p[1], p[0])
    sketch = {'facets': [[pt(p) for p in f['path']] for f in J.get('facets', []) if f.get('path') and not f.get('excluded')],
              'cutouts': [[pt(p) for p in f['path']] for f in J.get('facets', []) if f.get('path') and f.get('excluded')],
              'edges': [{'type': e.get('type', 'unspecified'), 'px': [pt(p) for p in e['path']]} for e in J.get('edges', []) if e.get('path')]}
EDGE_RGB = {'eave': (60, 200, 60), 'rake': (250, 200, 40), 'ridge': (200, 230, 90), 'hip': (160, 90, 230), 'valley': (240, 70, 50), 'step': (240, 140, 30), 'wall': (60, 140, 240), 'transition': (230, 110, 240), 'parapet': (240, 160, 50), 'unspecified': (80, 200, 250), 'obstruction': (255, 40, 40)}

# ---- building window: from the sketch extents, else the image centre
if sketch and sketch['facets']:
    xs = [p[0] for f in sketch['facets'] for p in f]; ys = [p[1] for f in sketch['facets'] for p in f]
    cx, cy = (min(xs) + max(xs)) / 2, (min(ys) + max(ys)) / 2; halfPx = max(max(xs) - min(xs), max(ys) - min(ys)) / 2 / 0.8
else: cx, cy, halfPx = W / 2, H / 2, (a.half or 22) / mPerPx
if a.half: halfPx = a.half / mPerPx
halfPx = max(halfPx, 10 / mPerPx)
win = [max(0, cx - halfPx), max(0, cy - halfPx), min(W, cx + halfPx), min(H, cy + halfPx)]

try: font = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf', 16); small = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf', 13)
except OSError: font = small = ImageFont.load_default()

def render(box, name, with_sketch, label):
    """Crop `box` (parent px) to a square view of a.size px with grid, scale bar and optional sketch; return manifest entry."""
    x0, y0, x1, y1 = box; s = a.size / max(x1 - x0, y1 - y0)
    view = im.crop((int(round(x0)), int(round(y0)), int(round(x1)), int(round(y1)))).resize((int(round((x1 - x0) * s)), int(round((y1 - y0) * s))), Image.BICUBIC)
    d = ImageDraw.Draw(view, 'RGBA'); vw, vh = view.size
    P = lambda p: ((p[0] - x0) * s, (p[1] - y0) * s)
    if with_sketch and sketch:
        for f in sketch['facets']: d.polygon([P(p) for p in f], outline=(255, 255, 255, 230), width=2)
        for f in sketch['cutouts']: d.polygon([P(p) for p in f], outline=(255, 255, 255, 200), width=1)
        for e in sketch['edges']:
            c = EDGE_RGB.get(e['type'], EDGE_RGB['unspecified']); q = [P(p) for p in e['px']]
            d.line(q, fill=c + (235,), width=3)
    if a.marker:
        mlat, mlng = [float(v) for v in a.marker.split(',')]; mp = P(to_px(mlat, mlng))
        if -20 < mp[0] < vw + 20 and -20 < mp[1] < vh + 20:
            d.line([(mp[0] - 14, mp[1]), (mp[0] + 14, mp[1])], fill=(0, 255, 255, 255), width=3); d.line([(mp[0], mp[1] - 14), (mp[0], mp[1] + 14)], fill=(0, 255, 255, 255), width=3)
            d.ellipse([mp[0] - 9, mp[1] - 9, mp[0] + 9, mp[1] + 9], outline=(0, 255, 255, 255), width=2); d.text((mp[0] + 12, mp[1] + 6), 'address point', fill=(0, 255, 255, 255), font=font)
    # grid: letters across, numbers down, one cell = gridM metres
    gridM = 5 if (x1 - x0) * mPerPx > 30 else 2; step = gridM / mPerPx * s
    n = 0; x = 0.0
    while x < vw and n < 26:
        d.line([(x, 0), (x, vh)], fill=(255, 255, 255, 90), width=1); d.text((x + 3, 2), chr(65 + n), fill=(255, 255, 0, 255), font=font); x += step; n += 1
    m = 0; y = 0.0
    while y < vh and m < 40:
        d.line([(0, y), (vw, y)], fill=(255, 255, 255, 90), width=1); d.text((3, y + 3), str(m + 1), fill=(255, 255, 0, 255), font=font); y += step; m += 1
    # scale bar (10 m or 5 m)
    barM = 10 if (x1 - x0) * mPerPx > 40 else 5; bar = barM / mPerPx * s
    d.rectangle([vw - bar - 20, vh - 30, vw - 20, vh - 22], fill=(0, 0, 0, 255)); d.rectangle([vw - bar - 20, vh - 30, vw - bar / 2 - 20, vh - 22], fill=(255, 255, 255, 255))
    d.text((vw - bar - 20, vh - 52), f'{barM} m', fill=(255, 255, 0, 255), font=font)
    d.rectangle([0, vh - 20, vw, vh], fill=(0, 0, 0, 170)); d.text((6, vh - 18), f'{label}  (grid {gridM} m, north up)', fill=(255, 255, 255, 255), font=small)
    view.save(os.path.join(a.out, name + '.png'))
    return {'id': name, 'file': name + '.png', 'box': [x0, y0, x1, y1], 'scale': s, 'size': [vw, vh], 'gridM': gridM, 'gridStepPx': step, 'sketch': bool(with_sketch and sketch), 'label': label}

views = []
views.append(render([0, 0, W, H], 'whole', False, 'whole view'))
views.append(render(win, 'building', False, 'building window'))
if sketch: views.append(render(win, 'building-sketch', True, 'building window with the candidate sketch'))
# overlapping detail tiles over the building window
n = a.tiles; ww, wh = win[2] - win[0], win[3] - win[1]; tw, th = ww / n, wh / n; ox, oy = tw * a.overlap, th * a.overlap
for j in range(n):
    for i in range(n):
        x0 = max(0, win[0] + i * tw - ox); y0 = max(0, win[1] + j * th - oy); x1 = min(W, win[0] + (i + 1) * tw + ox); y1 = min(H, win[1] + (j + 1) * th + oy)
        tag = f'tile-{chr(65 + i)}{j + 1}'
        views.append(render([x0, y0, x1, y1], tag, False, f'detail {tag}'))
        if sketch: views.append(render([x0, y0, x1, y1], tag + '-sketch', True, f'detail {tag} with the candidate sketch'))
manifest = {'parent': {'file': os.path.basename(a.image), 'w': W, 'h': H, 'mPerPx': mPerPx, 'frame': frame, 'window': win, 'northUp': True},
            'views': views, 'edgeColours': EDGE_RGB, 'note': 'view px -> parent px: x = box[0] + vx / scale, y = box[1] + vy / scale; parent px -> lng = frame.lng0 + frame.dLngDx * x, lat = frame.lat0 + frame.dLatDy * y'}
json.dump(manifest, open(os.path.join(a.out, 'manifest.json'), 'w'), indent=1)
print(f'{len(views)} views -> {a.out} ({mPerPx:.3f} m/px parent, window {ww * mPerPx:.0f} x {wh * mPerPx:.0f} m)')
