#!/usr/bin/env python3
"""Synthetic multimodal compatibility trial and authorized illustrative PDF review; local tooling only."""
import os,json,urllib.request,base64,concurrent.futures,pathlib
from PIL import Image,ImageDraw
out=pathlib.Path(os.environ.get('ROOF_API_OUTPUT','/workspace/roof-delivery/api')); key=os.environ['APINEX_API_KEY']
models=json.loads((out/'apinex-models.json').read_text())['model_ids']
selected=[m for m in ['gpt-6.1-terra','gemini-4-carbon','claude-opus-5.5','gpt-6.2-astra'] if m in models]
im=Image.new('RGB',(640,480),'white');d=ImageDraw.Draw(im);d.rectangle((100,120,500,360),outline='black',width=5);d.line((100,240,500,240),fill='black',width=3);d.rectangle((530,60,610,100),outline='black',width=3);im.save(out/'synthetic-vision-full.png')
for name,box in [('left',(0,60,380,420)),('right',(260,60,640,420))]: im.crop(box).save(out/f'synthetic-vision-{name}.png')
def url(p): return 'data:image/png;base64,'+base64.b64encode(pathlib.Path(p).read_bytes()).decode()
def req(model,text,paths):
 body={'model':model,'messages':[{'role':'user','content':[{'type':'text','text':text}]+[{'type':'image_url','image_url':{'url':url(p)}} for p in paths]}],'max_tokens':700}
 try:
  r=json.load(urllib.request.urlopen(urllib.request.Request('https://api.apinex.bond/v1/chat/completions',data=json.dumps(body).encode(),headers={'Authorization':'Bearer '+key,'Content-Type':'application/json'}),timeout=35))
  return {'model':model,'status':'responded','response':r.get('choices',[{}])[0].get('message',{}).get('content','')}
 except Exception as e: return {'model':model,'status':'failed','error_type':type(e).__name__,'http_status':getattr(e,'code',None)}
prompt='Known-answer synthetic vision trial. First image full640x480 pixels. Next overlapping crops: left origin(0,60),right origin(260,60), both unscaled380x360. Distinguish main roof rectangle, interior ridge, detached neighbor. Deliver JSON with main_corners_full:[[x,y],...] and one disputed_segment. Acceptance main corners within8px of ground truth, no ridge or detached rectangle as perimeter. Use pixel observations only, no measurement claims. Under180words.'
def run(m):
 r=req(m,prompt,[out/f'synthetic-vision-{v}.png' for v in ['full','left','right']]);r['assignment']=prompt
 # Adoption remains manual: returned values retained for independently checking each trial.
 r['known_answer']=[[100,120],[500,120],[500,360],[100,360]]
 if r['status']=='responded':
  r['pdf_review']=req(m,'Review this authorized synthetic US Letter roof report render. Deliver one concrete visual finding with pixel location, inspect hierarchy, print-size legibility, clipping, roof-plan dominance, and any misleading status. State limitations from single page. Under200words.', [os.environ.get('ROOF_SYNTHETIC_PDF_RENDER','/workspace/roof-delivery/complex/page-1.png')])
 print(json.dumps({'model':m,'status':r['status']}),flush=True);return r
with concurrent.futures.ThreadPoolExecutor(max_workers=4) as p: results=list(p.map(run,selected))
(out/'apinex-vision-reviews.json').write_text(json.dumps(results,indent=2))
