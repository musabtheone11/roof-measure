import json, sys, matplotlib
matplotlib.use('Agg'); import matplotlib.pyplot as plt
C={'eave':'#2e9e44','rake':'#e6b800','ridge':'#9acd32','hip':'#7b3fc4','valley':'#d9342b','step':'#e07b00','wall':'#1f6fd1','transition':'#e040e0','unspecified':'#00bcd4'}
files=sys.argv[2:]; out=sys.argv[1]
fig,axs=plt.subplots(len(files),3,figsize=(15,5*len(files)),squeeze=False)
for row,f in zip(axs,files):
  d=json.load(open(f)); ext=d['ext']
  row[0].imshow(d['dsm'],extent=ext,cmap='terrain'); row[0].set_title(f"seed {d['seed']} DSM {d['meta']['clutter']}")
  for k,(ax,src) in enumerate(zip(row[1:],['gt','en'])):
    s=d[src]
    for fc in s['facets']:
      p=fc['poly']; xs=[q[0] for q in p]; ys=[q[1] for q in p]; ax.fill(xs,ys,alpha=.12,color='#4a7fd4')
      cx=sum(xs)/len(xs); cy=sum(ys)/len(ys); ax.text(cx,cy,str(fc['pitch']),fontsize=7,ha='center')
    for e in s['edges']:
      pts=[e['p0'],e['p1']] if 'p0' in e else e['line']
      ax.plot([q[0] for q in pts],[q[1] for q in pts],color=C.get(e['type'],'k'),lw=2)
    ax.set_aspect('equal'); ax.set_xlim(ext[0],ext[1]); ax.set_ylim(ext[2],ext[3])
    bt=s['byType']; ax.set_title(('GROUND TRUTH ' if src=='gt' else 'ENGINE ')+f"{s['sloped']:.0f} sqft\n"+' '.join(f"{t[:4]}:{bt.get(t,0):.0f}" for t in C if bt.get(t,0)>0.5),fontsize=8)
plt.tight_layout(); plt.savefig(out,dpi=70)
