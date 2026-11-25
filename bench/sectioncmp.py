#!/usr/bin/env python3
"""Compare several traces of one house by roof section and by measurement type.

  python3 -I bench/sectioncmp.py sections.json label=roof.json [label=roof.json ...] [--out report.md] [--png overlay.png]

roof.json is the app's own export (Export JSON, or roof.json from tools/dev/run-app.mjs).
sections.json (kept private with the customer's reference documents) names the roof sections and, optionally, what an
independent reference gives for each. The sections are drawn from ONE of the traces, named in "geometryFrom":

  { "geometryFrom": "after",                               # label of the trace whose facets define the sections
    "sections": [ { "name": "Main roof", "facets": ["F2", "F4"], "refs": { "adjuster": 1210.0, "report": 1126 } }, ... ],
    "lines": { "adjuster": { "ridge": 81.95 }, "report": { "eave": 144, "rake": 118, ... } },
    "notes": { "adjuster": "...", "report": "..." } }

Every other trace is cut against those section outlines (5 cm raster), so a facet that straddles two sections is split
between them and whatever lies outside every section is reported on its own line ("outside every section"). Nothing here
feeds back into the app: the references are read only to print the difference.
"""
import json, math, sys

FT = 3.28084
SQFT = 10.7639104


def scale(lat):
    r = math.radians(lat)
    ky = 111132.92 - 559.82 * math.cos(2 * r) + 1.175 * math.cos(4 * r) - 0.0023 * math.cos(6 * r)
    kx = 111412.84 * math.cos(r) - 93.5 * math.cos(3 * r) + 0.118 * math.cos(5 * r)
    return kx, ky


def pitch_factor(p):
    return math.sqrt(1 + (p / 12.0) ** 2)


def ring_area(r):
    return abs(sum(r[i][0] * r[(i + 1) % len(r)][1] - r[(i + 1) % len(r)][0] * r[i][1] for i in range(len(r)))) / 2


def load(path, ref):
    j = json.load(open(path))
    lat0, lng0, kx, ky = ref
    xy = lambda v: ((v['lng'] - lng0) * kx, (v['lat'] - lat0) * ky)
    facets, edges = [], []
    for f in j['facets']:
        if f.get('omit'):
            continue
        ring = [xy(v) for v in f['path']]
        fac = math.sqrt(1 + f['slope'] ** 2) if f.get('slope') is not None else pitch_factor(f.get('pitch') or 0)
        facets.append(dict(name=f['name'], ring=ring, plan=ring_area(ring) * SQFT, factor=fac, structure=f.get('structure') or 1, excluded=bool(f.get('excluded')),
                           status=f.get('status') or 'measured', inferred=f.get('inferredSqft') or 0, alt=f.get('altSqft') or 0, pitch=f.get('pitch')))
    for e in j['edges']:
        if e.get('omit'):
            continue
        pl = [xy(v) for v in e['path']]
        plan = sum(math.hypot(pl[i][0] - pl[i - 1][0], pl[i][1] - pl[i - 1][1]) for i in range(1, len(pl))) * FT
        fac = e.get('factor')
        if fac is None:
            fac = 1.0 if e['type'] in ('eave', 'ridge', 'wall', 'transition', 'parapet', 'unspecified', 'obstruction') else pitch_factor(e.get('pitch') or j.get('defaultPitch') or 0)
        src = e.get('confirmedBy')
        edges.append(dict(type=e['type'], line=pl, plan=plan, true=plan * fac, structure=e.get('structure') or 1, status=e.get('status') or 'measured',
                          source=(src.get('source') if isinstance(src, dict) else src) if src else None, verify=bool(e.get('verify'))))
    zones = [dict(id=z['id'], ring=[xy(v) for v in z['path']], upper=z.get('upperSqft') or 0, structure=z.get('structure') or 1) for z in ((j.get('trace') or {}).get('hiddenZones') or [])]
    return dict(facets=facets, edges=edges, zones=zones, raw=j)


class Raster:
    """5 cm label raster of the section outlines; overlap(ring) -> {section index or -1: plan sq ft}"""

    def __init__(self, sections, pad=6.0, px=0.05):
        import numpy as np
        from PIL import Image, ImageDraw
        self.np, self.Image, self.ImageDraw = np, Image, ImageDraw
        pts = [p for s in sections for r in s for p in r]
        self.x0, self.y1 = min(p[0] for p in pts) - pad, max(p[1] for p in pts) + pad
        self.px = px
        self.w = int((max(p[0] for p in pts) + pad - self.x0) / px) + 1
        self.h = int((self.y1 - (min(p[1] for p in pts) - pad)) / px) + 1
        im = Image.new('I', (self.w, self.h), 0)
        d = ImageDraw.Draw(im)
        for k, rings in enumerate(sections):
            for r in rings:
                d.polygon([self.to(p) for p in r], fill=k + 1)
        self.lab = np.asarray(im)

    def to(self, p):
        return ((p[0] - self.x0) / self.px, (self.y1 - p[1]) / self.px)

    def overlap(self, ring):
        im = self.Image.new('1', (self.w, self.h), 0)
        self.ImageDraw.Draw(im).polygon([self.to(p) for p in ring], fill=1)
        m = self.np.asarray(im)
        out = {}
        vals, counts = self.np.unique(self.lab[m], return_counts=True)
        for v, c in zip(vals, counts):
            out[int(v) - 1] = float(c) * self.px * self.px * SQFT
        return out


def main():
    args = sys.argv[1:]
    out_md = args[args.index('--out') + 1] if '--out' in args else None
    out_png = args[args.index('--png') + 1] if '--png' in args else None
    pos = [a for i, a in enumerate(args) if not a.startswith('--') and (i == 0 or args[i - 1] not in ('--out', '--png'))]
    spec = json.load(open(pos[0]))
    runs = [a.split('=', 1) for a in pos[1:]]
    first = json.load(open(dict(runs)[spec['geometryFrom']]))
    v0 = first['facets'][0]['path'][0]
    ref = (v0['lat'], v0['lng'], *scale(v0['lat']))
    T = {lab: load(p, ref) for lab, p in runs}
    geo = T[spec['geometryFrom']]
    by_name = {f['name']: f for f in geo['facets']}
    S = spec['sections']
    ras = Raster([[by_name[n]['ring'] for n in s['facets']] for s in S])
    ref_names = sorted({k for s in S for k in (s.get('refs') or {})})
    L = []
    w = L.append
    w('### Sloped area by roof section, sq ft\n')
    w('| Section | ' + ' | '.join(lab for lab, _ in runs) + ' | ' + ' | '.join(ref_names) + ' |')
    w('|---|' + '---:|' * (len(runs) + len(ref_names)))
    tot = {lab: 0.0 for lab, _ in runs}
    cell = {}
    for lab, _ in runs:
        acc = {}
        for f in T[lab]['facets']:
            sign = -1 if f['excluded'] else 1
            ov = ras.overlap(f['ring'])
            whole = sum(ov.values()) or 1.0
            for k, a in ov.items():                                    # split the facet's own plan area in proportion to the raster overlap
                acc[k] = acc.get(k, 0.0) + sign * f['plan'] * f['factor'] * a / whole
        cell[lab] = acc
        tot[lab] = sum(acc.values())
    for k, s in enumerate(S):
        refs = s.get('refs') or {}
        w(f"| {s['name']} | " + ' | '.join(f"{cell[lab].get(k, 0):,.0f}" for lab, _ in runs) + ' | ' + ' | '.join((f"{refs[r]:,.0f}" if isinstance(refs.get(r), (int, float)) else (refs.get(r) or 'not in this reference')) for r in ref_names) + ' |')
    w('| Outside every section | ' + ' | '.join(f"{cell[lab].get(-1, 0):,.0f}" for lab, _ in runs) + ' | ' + ' | '.join('-' for _ in ref_names) + ' |')
    w('| **Traced total** | ' + ' | '.join(f"**{tot[lab]:,.0f}**" for lab, _ in runs) + ' | ' + ' | '.join((f"**{spec['totals'][r]:,.0f}**" if r in spec.get('totals', {}) else '-') for r in ref_names) + ' |')
    w('| Hidden zones (in no total) | ' + ' | '.join((f"0 to {sum(z['upper'] for z in T[lab]['zones']):,.0f}" if T[lab]['zones'] else 'none') for lab, _ in runs) + ' | ' + ' | '.join('-' for _ in ref_names) + ' |')
    w('')
    # differences against each reference, section by section
    for r in ref_names:
        w(f"### Difference from {r}, by section\n")
        if (spec.get('notes') or {}).get(r):
            w(spec['notes'][r] + '\n')
        w('| Section | ' + r + ' | ' + ' | '.join(lab for lab, _ in runs) + ' |')
        w('|---|---:|' + '---:|' * len(runs))
        st, sr = {lab: 0.0 for lab, _ in runs}, 0.0
        for k, s in enumerate(S):
            v = (s.get('refs') or {}).get(r)
            if not isinstance(v, (int, float)):
                continue
            sr += v
            row = []
            for lab, _ in runs:
                a = cell[lab].get(k, 0)
                st[lab] += a
                row.append(f"{a - v:+,.0f} ({(a - v) / v * 100:+.1f}%)")
            w(f"| {s['name']} | {v:,.0f} | " + ' | '.join(row) + ' |')
        if sr:
            w(f"| **Sections this reference covers** | **{sr:,.0f}** | " + ' | '.join(f"**{st[lab] - sr:+,.0f} ({(st[lab] - sr) / sr * 100:+.1f}%)**" for lab, _ in runs) + ' |')
        w('')
    # lines by measurement type, for the structure the sections belong to
    sid = by_name[S[0]['facets'][0]]['structure']
    types = ['eave', 'rake', 'ridge', 'hip', 'valley', 'step', 'wall', 'transition', 'obstruction']
    names = dict(eave='Eaves', rake='Rakes', ridge='Ridges', hip='Hips', valley='Valleys', step='Step flashing', wall='Wall flashing', transition='Transitions (pitch breaks)', obstruction='Obstruction boundary (not a roof edge, in no total)')
    lref = spec.get('lines') or {}
    lr = sorted(lref)
    w('### Line lengths by measurement type, ft (same structure as the sections)\n')
    w('| Type | ' + ' | '.join(lab for lab, _ in runs) + ' | ' + ' | '.join(lr) + ' |')
    w('|---|' + '---:|' * (len(runs) + len(lr)))
    for t in types:
        vals = [sum(e['true'] for e in T[lab]['edges'] if e['type'] == t and e['structure'] == sid) for lab, _ in runs]
        if not any(v > 0.05 for v in vals) and not any(t in lref[r] for r in lr):
            continue
        w(f"| {names[t]} | " + ' | '.join(f"{v:,.1f}" for v in vals) + ' | ' + ' | '.join((f"{lref[r][t]:,.1f}" if isinstance(lref[r].get(t), (int, float)) else ('not printed' if t != 'obstruction' else '-')) for r in lr) + ' |')
    combos = []
    for r in lr:
        for key in lref[r]:
            if key not in types and all(p in types for p in key.split('+')) and key not in combos:
                combos.append(key)
    for key in combos:                                                   # e.g. "eave+rake": drip edge / perimeter in an estimate
        parts = key.split('+')
        vals = [sum(e['true'] for e in T[lab]['edges'] if e['type'] in parts and e['structure'] == sid) for lab, _ in runs]
        w(f"| {' + '.join(names[p] for p in parts)} | " + ' | '.join(f"{v:,.1f}" for v in vals) + ' | ' + ' | '.join((f"{lref[q][key]:,.1f}" if isinstance(lref[q].get(key), (int, float)) else 'not printed') for q in lr) + ' |')
    w('')
    # what each source resolved in each trace
    w('### Lines by status and by the source that located them (same structure)\n')
    w('| Trace | Confirmed on the trace image | Located on another source | Inferred (dashed) | Marked for verification | Obstruction boundary |')
    w('|---|---:|---:|---:|---:|---:|')
    for lab, _ in runs:
        E = [e for e in T[lab]['edges'] if e['structure'] == sid]
        roof = [e for e in E if e['type'] != 'obstruction']
        alt = {}
        for e in roof:
            if e['source']:
                alt[e['source']] = alt.get(e['source'], 0) + e['true']
        w(f"| {lab} | {sum(e['true'] for e in roof if e['status'] == 'measured' and not e['source']):,.1f} | " + ('; '.join(f"{v:,.1f} ({k})" for k, v in alt.items()) or '0.0') +
          f" | {sum(e['true'] for e in roof if e['status'] == 'inferred'):,.1f} | {sum(1 for e in roof if e['verify'])} lines | {sum(e['plan'] for e in E if e['type'] == 'obstruction'):,.1f} |")
    w('')
    text = '\n'.join(L)
    if out_md:
        open(out_md, 'w').write(text)
    print(text)
    if out_png:
        import matplotlib
        matplotlib.use('Agg')
        import matplotlib.pyplot as plt
        col = dict(eave='#2e8b47', rake='#e09614', ridge='#789614', hip='#7a4ec8', valley='#d63c2d', step='#d2691e', wall='#2d78dc', transition='#c850c8', obstruction='#ff3b30')
        fig, axs = plt.subplots(1, len(runs), figsize=(6.2 * len(runs), 6.4), squeeze=False)
        allp = [p for lab, _ in runs for f in T[lab]['facets'] for p in f['ring']] + [p for lab, _ in runs for z in T[lab]['zones'] for p in z['ring']]
        xs, ys = [p[0] for p in allp], [p[1] for p in allp]
        for ax, (lab, _) in zip(axs[0], runs):
            for k, s in enumerate(S):
                for n in s['facets']:
                    r = by_name[n]['ring']
                    ax.fill([p[0] for p in r], [p[1] for p in r], color='#dfe7f1', zorder=0)
            for f in T[lab]['facets']:
                r = f['ring'] + [f['ring'][0]]
                ax.fill([p[0] for p in r], [p[1] for p in r], facecolor='#fff3c4' if f['status'] == 'inferred' else '#cfe0f5', edgecolor='none', alpha=0.75, zorder=1)
                cx, cy = sum(p[0] for p in f['ring']) / len(f['ring']), sum(p[1] for p in f['ring']) / len(f['ring'])
                ax.text(cx, cy, f['name'], ha='center', va='center', fontsize=7, color='#12304a', weight='bold', zorder=5)
            for z in T[lab]['zones']:
                r = z['ring'] + [z['ring'][0]]
                ax.fill([p[0] for p in r], [p[1] for p in r], facecolor='none', edgecolor='#cd3228', hatch='////', linewidth=0, zorder=2)
                ax.text(sum(p[0] for p in z['ring']) / len(z['ring']), sum(p[1] for p in z['ring']) / len(z['ring']), z['id'], ha='center', va='center', fontsize=7, color='#b3261e', weight='bold', zorder=6, bbox=dict(boxstyle='round,pad=0.15', fc='white', ec='#cd3228', lw=0.6))
            for e in T[lab]['edges']:
                if e['type'] == 'obstruction':
                    continue
                ax.plot([p[0] for p in e['line']], [p[1] for p in e['line']], color=col.get(e['type'], '#444'), lw=1.8, ls='--' if e['status'] == 'inferred' else '-', zorder=3)
            ax.set_title(f"{lab}: {tot[lab]:,.0f} sq ft traced" + (f", hidden 0-{sum(z['upper'] for z in T[lab]['zones']):,.0f}" if T[lab]['zones'] else ''), fontsize=9)
            ax.set_xlim(min(xs) - 2, max(xs) + 2); ax.set_ylim(min(ys) - 2, max(ys) + 2); ax.set_aspect('equal'); ax.set_xticks([]); ax.set_yticks([])
        fig.suptitle('Grey = section outlines (from "' + spec['geometryFrom'] + '"). Yellow = facet with an estimated part. Dashed = inferred line. Hatched = hidden zone. North up.', fontsize=8)
        fig.tight_layout(); fig.savefig(out_png, dpi=150)


if __name__ == '__main__':
    main()
