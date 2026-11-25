#!/usr/bin/env python3
"""Before/after roofline overlays for two regional benchmark runs.

    python3 -I tools/dev/overlay-compare.py --before base-dev --after new-dev [--out .devcache/regional/overlays-new-dev]

For every property present in both runs, puts the two `map-overlay.png` images (the traced roof over the aerial photo,
as the app draws it) side by side with the run labels and the report status of each run, and writes one contact sheet
of all pairs. Output goes to .devcache (git-ignored): the images show customer properties and stay private.
"""
import argparse, json, os, sys
from PIL import Image, ImageDraw, ImageFont

ap = argparse.ArgumentParser()
ap.add_argument('--before', required=True); ap.add_argument('--after', required=True)
ap.add_argument('--root', default='.devcache/regional'); ap.add_argument('--out', default=None)
ap.add_argument('--width', type=int, default=640, help='width of each panel in pixels')
a = ap.parse_args()
OUT = a.out or os.path.join(a.root, f'overlays-{a.after}'); os.makedirs(OUT, exist_ok=True)
B, A = os.path.join(a.root, a.before), os.path.join(a.root, a.after)
try: font = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf', 18); small = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf', 14)
except OSError: font = small = ImageFont.load_default()

def status(run_dir):
    """Report status as the scorer reads it: the audit's reportStatus in totals.json, else unknown."""
    try:
        with open(os.path.join(run_dir, 'totals.json')) as f: t = json.load(f)
        rs = (t.get('audit') or {}).get('reportStatus') or {}
        s = rs.get('status') or '?'; why = '; '.join(q.get('text', '') for q in rs.get('reasons', [])[:2])
        area = t.get('sloped') or (t.get('totals') or {}).get('sloped')
        return s, why, area
    except (OSError, ValueError): return '?', '', None

def panel(run_dir, label, w):
    p = os.path.join(run_dir, 'map-overlay.png')
    if not os.path.exists(p): return None
    im = Image.open(p).convert('RGB'); im = im.resize((w, round(im.height * w / im.width)))
    s, why, area = status(run_dir)
    bar = Image.new('RGB', (w, 58), (255, 255, 255)); d = ImageDraw.Draw(bar)
    d.text((8, 4), label, fill=(0, 0, 0), font=font)
    d.text((8, 28), f"{s}" + (f"  ·  {area:,.0f} sq ft" if isinstance(area, (int, float)) else '') + (f"  ·  {why[:70]}" if why else ''), fill=(60, 60, 60), font=small)
    out = Image.new('RGB', (w, im.height + 58), (255, 255, 255)); out.paste(bar, (0, 0)); out.paste(im, (0, 58)); return out

pairs = []
for slug in sorted(os.listdir(A)):
    if not os.path.isdir(os.path.join(A, slug)) or not os.path.isdir(os.path.join(B, slug)): continue
    pb, pa = panel(os.path.join(B, slug), f'before: {a.before}', a.width), panel(os.path.join(A, slug), f'after: {a.after}', a.width)
    if pb is None or pa is None: print('skip (no overlay):', slug, file=sys.stderr); continue
    h = max(pb.height, pa.height); im = Image.new('RGB', (2 * a.width + 12, h + 30), (255, 255, 255))
    ImageDraw.Draw(im).text((8, 6), slug, fill=(0, 0, 0), font=font)
    im.paste(pb, (0, 30)); im.paste(pa, (a.width + 12, 30)); im.save(os.path.join(OUT, f'{slug}.png')); pairs.append(im)
if not pairs: sys.exit('no pairs found')
# contact sheet: one pair per row, scaled to half size
cols = 2; tw = (2 * a.width + 12) // 2
rows = (len(pairs) + cols - 1) // cols; th = max(p.height for p in pairs) // 2
sheet = Image.new('RGB', (cols * (tw + 10), rows * (th + 10)), (235, 235, 235))
for i, p in enumerate(pairs):
    q = p.resize((tw, round(p.height / 2))); sheet.paste(q, ((i % cols) * (tw + 10), (i // cols) * (th + 10)))
sheet.save(os.path.join(OUT, 'contact-sheet.png'))
print(f'{len(pairs)} pairs -> {OUT} (contact-sheet.png)')
