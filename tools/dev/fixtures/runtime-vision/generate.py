# Rebuild analytic synthetic fixtures. Requires Pillow. No external inputs.
import json,pathlib
from PIL import Image,ImageDraw
p=pathlib.Path(__file__).resolve().parent
for c in json.loads((p/'manifest.json').read_text())['cases']:
 im=Image.new('RGB',(640,480),(222,227,215));d=ImageDraw.Draw(im);poly=[tuple(q) for q in c['outline']];d.polygon(poly,fill=(115,115,125),outline=(35,35,40),width=3);d.line((poly[0][0]+40,225,poly[1][0]-30,225),fill=(30,30,35),width=3);d.rectangle((550,30,610,80),fill=(115,115,125),outline=(35,35,40),width=2)
 if c['id']=='simple-gable': d.polygon([(100,100),(500,100),(500,160),(100,220)],fill=(75,75,85))
 if c.get('obstructed'):
  d.ellipse((50,230,235,430),fill=(38,95,40));d.ellipse((130,280,260,420),fill=(32,88,35));im=im.resize((160,120)).resize((640,480))
 im.save(p/(c['id']+'.png'))
