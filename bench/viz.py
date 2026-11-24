# python3 viz.py base.jsonl final.jsonl ex_base.json ex_fixed.json out.png
import json, sys, matplotlib
matplotlib.use('Agg'); import matplotlib.pyplot as plt
from matplotlib.patches import Patch
base, fin, eb, ef, out = sys.argv[1:6]
L = lambda f: [r for r in map(json.loads, open(f)) if not r.get('skipped') and not r.get('error')]
B, F = L(base), L(fin)
def good(r, ks):
    g = sum(r['gt_'+k] for k in ks); e = sum(r['en_'+k] for k in ks); return abs(e-g) <= max(5, 0.1*g)
crit = [('Area within 3%', lambda r: abs(r['areaErrPct']) <= 3), ('Predominant pitch', lambda r: round(r['predGT']) == r['predEN']),
        ('Eaves ±10%', lambda r: good(r, ['eave'])), ('Ridge+hip ±10%', lambda r: good(r, ['ridge','hip'])),
        ('Drip edge ±10%', lambda r: good(r, ['eave','rake'])), ('Valleys ±10%', lambda r: good(r, ['valley'])),
        ('No phantom transitions', lambda r: r['en_transition']-r['gt_transition'] <= 5)]
pct = lambda rows, f: 100*sum(1 for r in rows if f(r))/len(rows)
C = {'eave':'#2e9e44','rake':'#e6b800','ridge':'#9acd32','hip':'#7b3fc4','valley':'#d9342b','step':'#e07b00','wall':'#1f6fd1','transition':'#e040e0','unspecified':'#00bcd4'}
fig = plt.figure(figsize=(16, 15)); gs = fig.add_gridspec(3, 3, height_ratios=[1.05, 1, 1])
ax = fig.add_subplot(gs[0, :2]); y = range(len(crit))
b = [pct(B, f) for _, f in crit]; f_ = [pct(F, f) for _, f in crit]
ax.barh([i+0.2 for i in y], b, 0.4, color='#c9c9c9', label='Original engine'); ax.barh([i-0.2 for i in y], f_, 0.4, color='#1f6fd1', label='Fixed engine')
for i,(u,v) in enumerate(zip(b,f_)): ax.text(u+1, i+0.2, f'{u:.0f}%', va='center', fontsize=9, color='#666'); ax.text(v+1, i-0.2, f'{v:.0f}%', va='center', fontsize=10, color='#1f6fd1', weight='bold')
ax.set_yticks(list(y)); ax.set_yticklabels([c for c,_ in crit]); ax.invert_yaxis(); ax.set_xlim(0, 110); ax.set_xlabel('% of houses passing')
ax.set_title(f'{len(F):,} synthetic houses with exact ground truth (same houses both engines)', loc='left'); ax.legend(loc='lower right'); ax.spines[['top','right']].set_visible(False)
ax2 = fig.add_subplot(gs[0, 2]); types = ['eave','rake','ridge','hip','valley','step','wall','transition','unspecified']
gt = {t: sum(r['gt_'+t] for r in F) for t in types}
rb = [sum(r['en_'+t] for r in B)/1000 for t in types]; rf = [sum(r['en_'+t] for r in F)/1000 for t in types]; rg = [gt[t]/1000 for t in types]
x = range(len(types)); ax2.bar([i-0.27 for i in x], rg, 0.27, color='#222', label='Truth'); ax2.bar(x, rb, 0.27, color='#c9c9c9', label='Original'); ax2.bar([i+0.27 for i in x], rf, 0.27, color='#1f6fd1', label='Fixed')
ax2.set_xticks(list(x)); ax2.set_xticklabels(types, rotation=45, ha='right'); ax2.set_ylabel('total feet (thousands)'); ax2.set_title('Line totals across all houses', loc='left'); ax2.legend(fontsize=8); ax2.spines[['top','right']].set_visible(False)
for row, (lab, f) in enumerate([('ORIGINAL ENGINE', eb), ('FIXED ENGINE', ef)]):
    d = json.load(open(f)); ext = d['ext']
    if row == 0:
        a = fig.add_subplot(gs[1, 0]); a.imshow(d['dsm'], extent=ext, cmap='terrain'); a.set_title('Google-style 10 cm height model (hard: heavy blur + noise)', fontsize=9, loc='left'); a.set_xticks([]); a.set_yticks([])
    s = d['en']; axx = fig.add_subplot(gs[1+row, 1:])
    for fc in s['facets']:
        p = fc['poly']; axx.fill([q[0] for q in p], [q[1] for q in p], alpha=.12, color='#4a7fd4'); axx.text(sum(q[0] for q in p)/len(p), sum(q[1] for q in p)/len(p), str(fc['pitch']), fontsize=8, ha='center')
    for e in s['edges']: axx.plot([q[0] for q in e['line']], [q[1] for q in e['line']], color=C.get(e['type'],'k'), lw=2.2)
    bt = s['byType']; g = d['gt']['byType']
    axx.set_title(f"{lab}: {s['sloped']:.0f} sqft (truth {d['gt']['sloped']:.0f})   " + '  '.join(f"{t} {bt.get(t,0):.0f}/{g.get(t,0):.0f}" for t in ['eave','rake','ridge','hip','valley','transition'] if bt.get(t,0)+g.get(t,0) > 0.5) + '  (engine/truth ft)', fontsize=9, loc='left')
    axx.set_aspect('equal'); axx.set_xticks([]); axx.set_yticks([])
ax3 = fig.add_subplot(gs[2, 0]); d = json.load(open(ef)); s = d['gt']
for fc in s['facets']:
    p = fc['poly']; ax3.fill([q[0] for q in p], [q[1] for q in p], alpha=.12, color='#4a7fd4'); ax3.text(sum(q[0] for q in p)/len(p), sum(q[1] for q in p)/len(p), str(fc['pitch']), fontsize=8, ha='center')
for e in s['edges']: ax3.plot([e['p0'][0], e['p1'][0]], [e['p0'][1], e['p1'][1]], color=C.get(e['type'],'k'), lw=2.2)
ax3.set_aspect('equal'); ax3.set_xticks([]); ax3.set_yticks([]); ax3.set_title('Ground truth (exact geometry)', fontsize=9, loc='left')
fig.legend(handles=[Patch(color=v, label=k) for k, v in C.items()], loc='lower center', ncol=9, fontsize=9, frameon=False)
plt.tight_layout(rect=[0, 0.03, 1, 1]); plt.savefig(out, dpi=80)
