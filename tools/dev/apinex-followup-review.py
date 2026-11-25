#!/usr/bin/env python3
"""Bounded follow-up challenges using IDs established by the saved roster and prior trials."""
import json,urllib.request,os,concurrent.futures,pathlib,base64
out=pathlib.Path(os.environ.get('ROOF_API_OUTPUT','/workspace/roof-delivery/api')); models=['free/glm-5.3','free/gemini-3.1-pro','free/gpt-6-luna','free/hy4']
known_ids=json.loads((out/'apinex-models.json').read_text())['model_ids']
if any(m not in known_ids for m in models): raise SystemExit('Follow-up model missing from authenticated roster')
prompts=[
'Code review of synthetic export gate: edge length revision binds own path,type,pitch,factor but calculated rake length falls back to adjoining facet pitch or job default. Give concrete changed pitch example with unchanged edge revision, expected change in length, regression check. Under200 words.',
'Give two integer-coordinate roof outlines having equal area but different shape. Derive both areas and a test demonstrating numerical area reconciliation cannot validate the roof outline. Under200 words.',
'Review synthetic tree obstruction: canopy boundary is labeled measured eave; five vision models agree on same photo. Give export status and precise independent evidence required. Under200 words.',
'Review authorized synthetic US Letter PDF render. Locate one possible clipping/legibility issue in pixels; assess plan dominance and print-size text. Do not claim page2 inspection. Under200 words.']
def run(i):
 m=models[i];content=prompts[i]
 if i==3: content=[{'type':'text','text':content},{'type':'image_url','image_url':{'url':'data:image/png;base64,'+base64.b64encode(pathlib.Path(os.environ.get('ROOF_SYNTHETIC_PDF_RENDER','/workspace/roof-delivery/complex/page-1.png')).read_bytes()).decode()}}]
 body={'model':m,'messages':[{'role':'user','content':content}],'max_tokens':700}
 try:
  r=json.load(urllib.request.urlopen(urllib.request.Request('https://api.apinex.bond/v1/chat/completions',data=json.dumps(body).encode(),headers={'Authorization':'Bearer '+os.environ['APINEX_API_KEY'],'Content-Type':'application/json'}),timeout=35));return {'model':m,'assignment':prompts[i],'status':'responded','response':r.get('choices',[{}])[0].get('message',{}).get('content','')}
 except Exception as e:return {'model':m,'assignment':prompts[i],'status':'failed','error_type':type(e).__name__,'http_status':getattr(e,'code',None)}
with concurrent.futures.ThreadPoolExecutor(max_workers=4) as p: result=list(p.map(run,range(4)))
(out/'apinex-followup-retry.json').write_text(json.dumps(result,indent=2));print(json.dumps(result))
