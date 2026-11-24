# python gaf2truth.py "<GAF QuickMeasure report>.pdf" [...]  -> writes truth/<address-slug>.json (same format as the Kelliwood file)
# Reads the Summary page: area, facets, predominant pitch, pitch table, eaves/rakes/ridges/hips/valleys, Step, Flash (wall), Bends (transition).
import sys, re, json, os, pypdf
def num(s): return float(s.replace(',', ''))
for f in sys.argv[1:]:
    r = pypdf.PdfReader(f)
    pages = [(p.extract_text() or '') for p in r.pages]
    first = ' '.join(pages[0].split())
    summ = next((t for t in pages if t.lstrip().startswith('Summary')), None)
    if not summ or 'Prepared For' not in first: print('not a GAF QuickMeasure report:', f); continue
    addr = re.match(r'(.+?\b\d{5})\b', first).group(1)
    rep = re.search(r'\d{5}\s+([A-Z][a-z]+ \d{1,2}, \d{4})', first); img = re.search(r'(\d{4}-\d{2}-\d{2})', ' '.join(' '.join(pages[:2]).split()))
    L = [l.strip() for l in summ.split('\n')]
    row = lambda k: next((l[len(k):].split() for l in L if l.startswith(k + ' ')), [])
    pitches = [int(x) for x in row('Pitch') if x.isdigit()]; areas = [num(x) for x in next(l for l in L if l.startswith('Area ')).split()[1:]]
    g = lambda k: (lambda m: num(m.group(1)) if m else 0)(re.search(r'^' + k + r' ([\d,]+)', summ, re.M))
    t = {'address': addr, 'source': f'GAF QuickMeasure report dated {rep.group(1) if rep else "?"} (imagery {img.group(1) if img else "?"})',
         'areaSqft': g('Roof Area'), 'facets': int(g('Roof Facets')), 'predominantPitch': int(re.search(r'^Pitch (\d+) / 12', summ, re.M).group(1)),
         'pitchAreas': {str(p): a for p, a in zip(pitches, areas)},
         'ft': {'eave': g('Eaves'), 'rake': g('Rakes'), 'ridge': g('Ridges'), 'hip': g('Hips'), 'valley': g('Valleys'), 'step': g('Step'), 'wall': g('Flash'), 'transition': g('Bends')}}
    slug = re.sub(r'[^a-z0-9]+', '-', addr.split(',')[0].lower()).strip('-')
    out = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'truth', slug + '.json')
    json.dump(t, open(out, 'w'), indent=1); print(slug, json.dumps(t['ft']), t['areaSqft'], t['facets'], t['pitchAreas'])
