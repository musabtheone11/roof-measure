#!/usr/bin/env python3
"""Local-only APInex roster trials on synthetic geometry; never accepts property inputs.
API key is read at runtime, never logged. Results contain only synthetic assignments.
"""
import concurrent.futures, json, math, os, pathlib, time, urllib.request, urllib.error
OUT = pathlib.Path(os.environ.get('ROOF_API_OUTPUT', '/workspace/roof-delivery/api'))
OUT.mkdir(parents=True, exist_ok=True)
KEY = os.environ.get('APINEX_API_KEY')
if not KEY:
    raise SystemExit('APINEX_API_KEY missing')
BASE = 'https://api.apinex.bond/v1'
def request(route, body=None):
    data = None if body is None else json.dumps(body).encode()
    req = urllib.request.Request(BASE+route, data=data, headers={'Authorization':'Bearer '+KEY, 'Content-Type':'application/json'})
    with urllib.request.urlopen(req, timeout=35) as response:
        return json.load(response)
def chat(model, prompt):
    start=time.monotonic()
    try:
        result=request('/chat/completions', {'model':model,'messages':[{'role':'user','content':prompt}],'max_tokens':700})
        content=result.get('choices',[{}])[0].get('message',{}).get('content','')
        if not isinstance(content,str): content=json.dumps(content)
        return {'model':model,'status':'responded' if content else 'empty','seconds':round(time.monotonic()-start,2),'response':content[:12000]}
    except Exception as e:
        # No raw URL/headers or key-bearing exception text is retained.
        return {'model':model,'status':'failed','error_type':type(e).__name__,'http_status':getattr(e,'code',None),'seconds':round(time.monotonic()-start,2)}
roster=request('/models')
models=[x['id'] for x in roster.get('data',[]) if isinstance(x.get('id'),str)]
(OUT/'apinex-models.json').write_text(json.dumps({'endpoint':'GET /v1/models','status':200,'model_ids':models},indent=2))
def trial(args):
    i,model=args; w=20+i; h=15+i%7; pitch=4+i%6
    # Distinct dimensions provide a distinct reproducible oracle for every model.
    expected=w*h*math.sqrt(1+(pitch/12)**2)
    prompt=f'''Synthetic roof fixture {i+1}. One rectangular roof plane has horizontal dimensions {w} by {h} feet and pitch {pitch}/12. Deliver one JSON object with keys sloped_area_sqft (two decimals), horizontal_area_sqft, and acceptance_test (one short sentence). Acceptance: use projected area times sqrt(1+(pitch/12)^2), round only final display. No imagery or property inputs. Budget: under 150 words.'''
    r=chat(model,prompt); r.update({'assignment':prompt,'expected_area_sqft':round(expected,2),'role_trial':'roof-math'})
    text=r.get('response',''); import re
    numbers=[float(x) for x in re.findall(r'-?\d+(?:\.\d+)?',text.replace(',',''))]
    r['accepted']=r['status']=='responded' and any(abs(x-expected)<.015 for x in numbers)
    (OUT/f'trial-{i+1:02}.json').write_text(json.dumps(r,indent=2))
    print(json.dumps({'model':model,'status':r['status'],'accepted':r['accepted']}),flush=True)
    return r
with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
    trials=list(pool.map(trial,enumerate(models)))
# A new substantive case after the trial: surviving evidence across edits and default pitch dependencies.
reviews=[]
capable=[x for x in trials if x['accepted']][:4]
prompts=[
'''Review a synthetic export gate. Evidence revision for edge length binds {path,type,pitch,factor,autoType}, but calculation can obtain pitch from an adjoining facet or job default when edge.pitch is absent. Deliver one concrete counterexample edit that preserves the evidence revision but changes calculated length, and a regression acceptance check. No code execution claimed. Under 200 words.''',
'''Geometry adversarial fixture: two outlines have the same area and pitch. Gate compares area totals and schedules only. Deliver a tiny integer-coordinate pair of different polygons with equal area, and required rejection test using canonical geometry revision. Under 200 words.''',
'''Synthetic PDF review from specifications only (no rendered visual available): plan is 6.5 inches wide, footer at y=760pt, schedule text 7pt. Roof 65x40ft. Deliver a print-size readability and scale-bar acceptance checklist, and clearly state no actual render was inspected. Under 200 words.''',
'''Review evidence gate: a measured edge record uses basis "canopy boundary"; outline closed from tree contour. All numeric totals reconcile. Deliver precise gate rejection and evidence needed to resolve. Distinguish consensus on same image from independent evidence. Under 200 words.''']
with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
    futures=[pool.submit(chat,r['model'],prompts[i]) for i,r in enumerate(capable)]
    for i,f in enumerate(futures):
        r=f.result();r['assignment']=prompts[i];reviews.append(r)
(OUT/'apinex-reviews.json').write_text(json.dumps(reviews,indent=2))
summary={'roster_count':len(models),'trial_count':len(trials),'responded':sum(x['status']=='responded' for x in trials),'accepted_known_answer':sum(x['accepted'] for x in trials),'trials':trials,'followup_reviews':reviews,'privacy':'Synthetic numeric fixtures and public implementation concepts only. No property files, imagery, customer data, or secrets sent. Vision capability not established; no vision assignment.'}
(OUT/'apinex-summary.json').write_text(json.dumps(summary,indent=2))
print(json.dumps({k:v for k,v in summary.items() if k not in ['trials','followup_reviews']}),flush=True)
