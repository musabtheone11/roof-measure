# python3 viz_real.py dump.json out.png [title]   -> aerial + roofline | height model hillshade + typed edges | mask / obstruction
import json, sys
import numpy as np
import matplotlib; matplotlib.use('Agg')
import matplotlib.pyplot as plt
J = json.load(open(sys.argv[1])); out = sys.argv[2]; title = sys.argv[3] if len(sys.argv) > 3 else J.get('address', '')
COL = dict(eave='#2e9e44', valley='#e5533d', hip='#8e5bd6', ridge='#9ab82f', rake='#f5a623', wall='#3b8be6', step='#e0702a', transition='#e26ee6', parapet='#f0a030', unspecified='#4fc3f7')
ext = J['ext']; dsm = np.array(J['dsm'], dtype=float); mask = np.array(J['mask'])
fig, ax = plt.subplots(1, 3, figsize=(27, 9.4))
if J.get('rgb'): ax[0].imshow(np.dstack([np.array(b) for b in J['rgb']]).astype(np.uint8), extent=ext)
gy, gx = np.gradient(dsm, 0.1); shade = np.clip(0.5 + 0.35 * (gx - gy), 0, 1)
ax[1].imshow(shade, extent=ext, cmap='gray'); ax[1].imshow(np.where(mask > 0, np.nan, 1.0), extent=ext, cmap='Blues', alpha=0.35, vmin=0, vmax=1)
g = np.percentile(dsm[mask == 0], 5); ax[2].imshow(np.clip(dsm - g, 0, 14), extent=ext, cmap='terrain'); ax[2].contour(np.linspace(ext[0], ext[1], mask.shape[1]), np.linspace(ext[3], ext[2], mask.shape[0]), mask, levels=[0.5], colors='k', linewidths=0.6)
for a in ax[:2]:
    for f in J['facets']:
        p = np.array(f['poly'] + [f['poly'][0]]); st = f.get('status')
        a.plot(p[:, 0], p[:, 1], color='white' if a is ax[0] else '#333', lw=0.8, ls='--' if st and st != 'measured' else '-')
    for e in J['edges']:
        p = np.array(e['line']); a.plot(p[:, 0], p[:, 1], color=COL.get(e['type'], 'c'), lw=2.2, ls=':' if e.get('status') and e['status'] != 'measured' else '-')
for f in J['facets']:
    p = np.array(f['poly']); c = p.mean(0); ax[1].text(c[0], c[1], f"{f['name']}\n{f['pitch']}", ha='center', va='center', fontsize=6.5, color='#003')
ex = J.get('extra')
if ex and ex.get('tree'):
    t = np.array(ex['tree'], dtype=float); ax[2].imshow(np.where(t > 0, t, np.nan), extent=ext, cmap='autumn', alpha=0.55, vmin=0, vmax=3)
P = np.array([q for f in J['facets'] for q in f['poly']]); pad = 9
for a in ax: a.set_xlim(P[:, 0].min() - pad, P[:, 0].max() + pad); a.set_ylim(P[:, 1].min() - pad, P[:, 1].max() + pad); a.set_aspect('equal'); a.tick_params(labelsize=7)
ax[0].set_title('Aerial (Google Solar RGB) + traced roofline'); ax[1].set_title('Height model hillshade + typed edges (blue tint = outside Google mask)'); ax[2].set_title('Height above ground (m), Google mask outline' + (', obstruction overlay' if ex else ''))
fig.suptitle(title, fontsize=13); fig.tight_layout(); fig.savefig(out, dpi=70)
