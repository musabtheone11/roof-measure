"""Offline oracle for a saved simple-gable trial. Requires PyMuPDF. Prints sanitized JSON."""
import collections
import hashlib
import json
import math
from pathlib import Path
import re
import sys
import pymupdf

ROOT = Path(__file__).resolve().parents[2]
FIXTURES = ROOT / "tools/dev/fixtures/runtime-vision"
run = Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT / ".devcache/live-review"
read = lambda path: json.loads(path.read_text(encoding="utf-8"))
digest = lambda path: hashlib.sha256(path.read_bytes()).hexdigest()
manifest = read(FIXTURES / "manifest.json")
truth = next(c["outline"] for c in manifest["cases"] if c["id"] == "simple-gable")
limits = manifest["thresholds"]


def rectangle(points):
    xs, ys = zip(*points)
    x0, x1, y0, y1 = min(xs), max(xs), min(ys), max(ys)
    assert set(map(tuple, points)) == {(x0,y0),(x0,y1),(x1,y0),(x1,y1)}
    assert all(a[0] == b[0] or a[1] == b[1] for a,b in zip(points, points[1:]+points[:1]))
    return x0,y0,x1,y1


def dist_to_rect(p, box):
    x,y = p
    a,b,c,d = box
    if a <= x <= c and b <= y <= d:
        return min(x-a,c-x,y-b,d-y)
    return math.hypot(max(a-x,0,x-c),max(b-y,0,y-d))


def outline_score(points):
    a,b,c,d = rectangle(truth)
    e,f,g,h = rectangle(points)
    truth_area, area = (c-a)*(d-b), (g-e)*(h-f)
    intersection = max(0,min(c,g)-max(a,e))*max(0,min(d,h)-max(b,f))
    iou = intersection / (truth_area+area-intersection)
    perimeters, distance_sum, maximum = 0,0,0
    for ring,target in [(truth,rectangle(points)), (points,rectangle(truth))]:
        for p,q in zip(ring,ring[1:]+ring[:1]):
            length=math.dist(p,q)
            n=math.ceil(length*4)
            for i in range(n):
                fraction=(i+.5)/n
                distance=dist_to_rect([p[0]+(q[0]-p[0])*fraction,p[1]+(q[1]-p[1])*fraction],target)
                distance_sum += distance*length/n
            maximum=max(maximum,dist_to_rect(p,target))
            perimeters+=length
    mean=distance_sum/perimeters
    return {"areaPx2":area,"signedAreaErrorPct":round(100*(area-truth_area)/truth_area,5),
            "intersectionPx2":intersection,"iou":round(iou,8),
            "symmetricMeanBoundaryPx":round(mean,5),"maxCornerDistancePx":round(maximum,5),
            "passesIoU":iou >= limits["outlineIoU"],"passesMeanBoundary":mean <= limits["meanBoundaryPixels"]}


s=read(run/"review.json")
t=read(run/"trial.json")
source_hash=digest(FIXTURES/"simple-gable.png")
assert t["sourceHash"]==source_hash
m=s["latestResult"]["measurements"]
assert s["status"]==m["status"]=="REVIEW REQUIRED" and s["measurementStatus"]=="current"
assert str(s["revision"])==str(s["measurementSnapshot"]["revision"])==str(s["latestResult"]["model"]["revision"])
assert s["model"]==s["measurementSnapshot"]["model"] and s["imageMetadata"]==s["measurementSnapshot"]["imageMetadata"]
assert all(s["model"][k]==s["latestResult"]["model"][k] for k in ("outline","facets","edges"))
assert m["projectedAreaM2"] is None and m["slopedAreaM2"] is None and m["measurementBasis"] is None
assert all(f[k] is None for f in m["facets"] for k in ("projectedAreaM2","slopedAreaM2"))
assert all(e[k] is None for e in m["edges"] for k in ("horizontalLengthM","trueSlopedLengthM"))
roles={}
for role,proposal in [("outline","proposal"),("independent","independentProposal")]:
    primary=[b for b in s["originalAI"][role]["buildings"] if b["target"]]
    assert len(primary)==1
    points=primary[0]["vertices"]
    assert points==s["originalAI"][proposal]["outline"]
    if role=="outline":
        assert points==s["model"]["outline"]
    rec=next(r for r in t["roles"] if r["role"]==role and r["valid"])
    roles[role]={"model":rec["returnedModel"],"boundsPx":list(rectangle(points)),**outline_score(points)}

with pymupdf.open(run/"review.pdf") as pdf:
    pages=[page.get_text() for page in pdf]
    assert len(pages)==3 and all(f"Revision {s['revision']}" in p and "REVIEW REQUIRED" in p for p in pages)
    assert s["imageMetadata"]["imageFingerprint"]["sha256"] in pages[2]
    assert "Physical quantities withheld:" in pages[2]
    assert f"{len(m['facets'])} / {len(m['edges'])}" in pages[0]
    assert all(f"F{i} / {f['id']}" in pages[1] for i,f in enumerate(m["facets"],1))
    assert all(re.search(r"^"+re.escape(e["id"])+r"$",pages[1],re.M) for e in m["edges"])
    # Standalone decimal cells in this schedule would contradict its blank measurements.
    assert not re.search(r"^[-+]?\d+(?:[,.]\d+)*\s*$", pages[1], re.M)

print(json.dumps({
    "fixture":"simple-gable", "split":"synthetic development", "sampleCount":1,
    "scope":"Saved local authenticated evaluation; no field measurement or inference during audit.",
    "sha256":{f.name:digest(f) for f in [FIXTURES/"simple-gable.png",FIXTURES/"manifest.json",run/"review.json",run/"review.pdf",run/"trial.json"]},
    "truth":{"boundsPx":list(rectangle(truth)),"areaPx2":100000,"perimeterPx":1300,"scale":None,"pitch":None},
    "thresholds":limits, "boundaryMethod":"Symmetric perimeter-weighted midpoint distances to the exact rectangle boundary, sampled every 0.25 px or less.",
    "independentComparisons":roles,"modelToModelIoUDiagnostic":t["comparison"],
    "provider":{"requests":t["ledger"]["requests"],"completedRoles":t["ledger"]["completed"],
                "billedUsd":t["ledger"]["billedUsd"],"unknownBillingRequests":t["ledger"]["unknownBillingRequests"],
                "invalidSchemaAttempts":sum(not r["valid"] for r in t["roles"])},
    "review":{"revision":s["revision"],"snapshotAndCanonicalGeometryAgree":True,"geometryValid":m["validation"]["ok"],
              "facetCount":len(m["facets"]),"edgeCount":len(m["edges"]),"outsideOutlinePx2":m["validation"]["topology"]["outsidePixels2"],
              "issueCounts":dict(collections.Counter(i["code"] for i in m["issues"])),
              "allPhysicalAreasAndLengthsWithheld":True,"status":s["status"]},
    "pdf":{"pages":len(pages),"eachPageMatchesRevisionAndReviewStatus":True,"sourceFingerprintMatches":True,
           "scheduleIdsMatch":True,"physicalScheduleCellsBlank":True},
    "limitations":["No verified field scale, roof pitch, or ground truth edge classifications.",
                   "The fixture includes a shadow. The adjudicator endorsed its diagonal tonal boundary as an interior roof edge; that classification lacks structural evidence.",
                   "The raw trial file was written at the provider stage. PDF and revision checks above come directly from the two saved browser downloads."],
},indent=2))
