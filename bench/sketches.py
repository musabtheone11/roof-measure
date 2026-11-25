# python3 sketches.py [slug ...]  -> private/results/<slug>.png : aerial + old trace | aerial + new trace (same scale, north up)
import json, sys, glob, os
import numpy as np
import matplotlib; matplotlib.use('Agg')
import matplotlib.pyplot as plt
COL = dict(eave='#2e9e44', valley='#e5533d', hip='#8e5bd6', ridge='#c8e03a', rake='#f5a623', wall='#3b8be6', step='#e0702a', transition='#e26ee6')
D = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'private', 'results')
names = sys.argv[1:] or [os.path.basename(f)[:-10] for f in sorted(glob.glob(os.path.join(D, '*.dump.json')))]
for slug in names:
    J = json.load(open(os.path.join(D, slug + '.dump.json'))); ext = J['ext']
    fig, ax = plt.subplots(1, 2, figsize=(18, 9.2))
    img = np.dstack([np.array(b) for b in J['rgb']]).astype(np.uint8) if J.get('rgb') else None
    for a, key, lab, area in ((ax[0], 'old', 'Old app (2026-11-23)', J['oldArea']), (ax[1], 'new', 'New app', J['newArea'])):
        if img is not None: a.imshow(img, extent=ext)
        G = J[key]
        for f in G['facets']:
            p = np.array(f['poly'] + [f['poly'][0]]); a.plot(p[:, 0], p[:, 1], color='white', lw=0.7)
        for e in G['edges']:
            p = np.array(e['line']); a.plot(p[:, 0], p[:, 1], color=COL.get(e['type'], 'c'), lw=2.0, ls=':' if e['status'] != 'measured' else '-')
        if key == 'new':
            for t in J.get('trees', []):
                p = np.array(t['poly'] + [t['poly'][0]]); a.fill(p[:, 0], p[:, 1], color='#ff7a00' if t['kind'] == 'overlap' else '#3ddc84', alpha=0.3)
        r = J['ref']; a.set_title(f"{lab}: {area:,.0f} sq ft, {len([f for f in G['facets'] if f.get('struct', 1) == 1])} facets (main)   |   reference ({r.get('vendor')}): {r.get('area')} sq ft, {r.get('facets')} facets", fontsize=10)
    P = np.array([q for k in ('old', 'new') for f in J[k]['facets'] for q in f['poly']])
    if len(P):
        for a in ax: a.set_xlim(P[:, 0].min() - 6, P[:, 0].max() + 6); a.set_ylim(P[:, 1].min() - 6, P[:, 1].max() + 6); a.set_aspect('equal'); a.tick_params(labelsize=7)
    fig.suptitle(J['address'] + '   (metres, north up)', fontsize=12); fig.tight_layout(); fig.savefig(os.path.join(D, slug + '.png'), dpi=62); plt.close(fig)
    print('wrote', slug + '.png')
