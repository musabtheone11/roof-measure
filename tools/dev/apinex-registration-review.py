#!/usr/bin/env python3
"""Bounded synthetic registration/selection adversarial review. Never submits customer imagery."""
import os,json,pathlib,urllib.request,concurrent.futures
out=pathlib.Path(os.environ.get('ROOF_API_OUTPUT','/workspace/roof-delivery/api'));prior=json.loads((out/'apinex-summary.json').read_text());passing={r['model'] for r in prior['trials'] if r['accepted']}
models=['free/deepseek-v4.1-flash','free/gemini-3.1-pro','free/glm-5.3-flashx','free/mimo-v2.6-flash'];assert all(m in passing for m in models)
prefix='Public-code/synthetic-fixture review only. No actual property, screenshot, address, contact, or customer imagery supplied. Deliver ONE concrete counterexample with expected output and targeted patch proposal, not broad advice. Be precise, under240words. '
prompts=[
prefix+'''Registration code: if(maskT.w!==dsmT.w||maskT.h!==dsmT.h)throw; then for i use maskT.data[i],dsmT.data[i]; geo E,N derived exclusively from maskT.toLL. Fixture mask and DSM both100x100 at0.1m/px. Mask origin(1000,2000), DSM origin(1000,1990), same CRS, north-up. Mask roof occupies cols20..39 rows20..39; DSM roof occupies cols20..39 rows? Same real roof. Calculate row displacement and whether index pairing valid, identify correct rejection or calibrated resampling acceptance test.''',
prefix+'''TIFF decoder: const [ox,oy]=getOrigin(); const [rx,ry]=getResolution(); const sy=ry>0?-ry:ry; if(epsg===4326||Math.abs(ox)<=360)toLL=(x,y)=>({lng:ox+x*rx,lat:oy+y*sy}); else project EPSG. Fixtures: A EPSG3857 origin(100,200),rx0.1,ry-0.1; B explicitly south-up EPSG4326 origin(10,20),rx0.001,ry0.001. Show one exact wrong coordinate per fixture, how to use authoritative affine/raster type, and reject unsupported orientation safely. Do not assume all geotiffs north-up.''',
prefix+'''Selection: clipped components scored areaM2 - 2*distanceFromBuildingCenterM. If clipped empty, fallback all roof pieces with area>=20 and distance<20m. cx0=(geo.X(0)||w/2). Fixture A target100m2 at distance1m, neighbor200m2 at distance8m both intersect padded box; B target absent and neighbor100m2 at12m; C geo.X(0)===0,w100. Compute chosen outcomes and give safe selection behavior plus tests. Distinguish absent evidence from confirmed target. Area agreement is not shape evidence.''',
prefix+'''Georeference grid uses Ecol[x]=(mask.toLL(x,0).lng-cLng)*kx and Nrow[y]=(mask.toLL(0,y).lat-cLat)*ky, then E(x) and N(y) independently. True local affine fixture E=100+0.1x+0.03y, N=200+0.02x-0.1y at raster point(40,50). Derive true coordinate, separable approximation coordinate and error meters. Give roundtrip/regression test and metadata gate proposal. Explain why orbit camera/DSM altitude correction cannot fix a horizontal affine error.'''
]
def run(i):
 body={'model':models[i],'messages':[{'role':'user','content':prompts[i]}],'max_tokens':750}
 try:
  d=json.load(urllib.request.urlopen(urllib.request.Request('https://api.apinex.bond/v1/chat/completions',data=json.dumps(body).encode(),headers={'Authorization':'Bearer '+os.environ['APINEX_API_KEY'],'Content-Type':'application/json'}),timeout=35));return {'model':models[i],'status':'responded','assignment':prompts[i],'response':d.get('choices',[{}])[0].get('message',{}).get('content','')}
 except Exception as e:return {'model':models[i],'status':'failed','assignment':prompts[i],'error_type':type(e).__name__,'http_status':getattr(e,'code',None)}
with concurrent.futures.ThreadPoolExecutor(max_workers=4) as p: result=list(p.map(run,range(4)))
(out/'apinex-registration-review.json').write_text(json.dumps(result,indent=2));print(json.dumps(result))
