# python3 viz_obst.py dump.json out.png [title] -> aerial + trace with canopy / inferred / contact / hidden-zone pixels
import json, sys, numpy as np
import matplotlib; matplotlib.use('Agg'); import matplotlib.pyplot as plt
from matplotlib.colors import ListedColormap
J = json.load(open(sys.argv[1])); ext = J['ext']
COL = dict(eave='#2e9e44', valley='#e5533d', hip='#8e5bd6', ridge='#c8e03a', rake='#f5a623', wall='#3b8be6', step='#e0702a', transition='#e26ee6', obstruction='#ff0033')
fig, ax = plt.subplots(1, 2, figsize=(22, 11))
rgb = np.dstack([np.array(b) for b in J['rgb']]).astype(np.uint8)
for a in ax: a.imshow(rgb, extent=ext)
if J.get('extra') and J['extra'].get('tree'):
    t = np.array(J['extra']['tree'], dtype=float)
    ax[1].imshow(np.where(t > 0, t, np.nan), extent=ext, cmap=ListedColormap(['#00ff66', '#ffcc00', '#ff0033', '#ff66ff']), vmin=1, vmax=4, alpha=0.45)
for f in J['facets']:
    p = np.array(f['poly'] + [f['poly'][0]]); c = p[:-1].mean(0)
    ax[1].text(c[0], c[1], f"{f['name'][1:]}:{f['pitch']}{'' if f['status'] == 'measured' else '*' + f['status'][0]}", color='cyan', fontsize=10, ha='center', weight='bold')
for e in J['edges']:
    p = np.array(e['line'])
    for a in ax: a.plot(p[:, 0], p[:, 1], color=COL.get(e['type'], 'c'), lw=2.4, ls=':' if e['type'] == 'obstruction' else '--' if e['status'] != 'measured' else '-')
for z in (J.get('obstruction') or {}).get('hiddenZones', []) if 'zonesM' not in J else []: pass
for z in J.get('zonesM', []):
    p = np.array(z + [z[0]]); ax[0].fill(p[:, 0], p[:, 1], facecolor='none', edgecolor='#ff0033', hatch='///', lw=1)
P = np.array([q for f in J['facets'] for q in f['poly']])
for a in ax: a.set_xlim(P[:, 0].min() - 9, P[:, 0].max() + 9); a.set_ylim(P[:, 1].min() - 9, P[:, 1].max() + 9); a.set_aspect('equal')
ax[0].set_title('solid = measured, dashed = inferred, red dotted = obstruction boundary, hatched = hidden zone'); ax[1].set_title('green canopy, yellow inferred roof, red contact, magenta ghost (hidden zone pixels)')
fig.suptitle(sys.argv[3] if len(sys.argv) > 3 else '', fontsize=13); fig.tight_layout(); fig.savefig(sys.argv[2], dpi=58)
