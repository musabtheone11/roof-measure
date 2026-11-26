"""Score two complete trace runs against the frozen five-percent protocol."""
import argparse
import json
import math
from collections import Counter
from pathlib import Path


DOCS = Path(__file__).resolve().parents[1] / "docs" / "evaluation"
EDGE_TYPES = ("eave", "rake", "ridge", "hip", "valley", "step", "wall", "transition", "unspecified")


def read_run(path, cohort):
    rows = {}
    for line in path.read_text(encoding="utf-8").splitlines():
        row = json.loads(line)
        seed = row["seed"]
        if seed in rows:
            raise ValueError(f"Duplicate seed {seed} in {path}")
        rows[seed] = row
    expected = set(range(cohort["first"], cohort["first"] + cohort["count"]))
    if rows.keys() != expected:
        raise ValueError(f"Incomplete or unexpected seed inventory in {path}")
    return rows


def upper_bound(failures, n):
    """One-sided 95% Clopper-Pearson upper bound for a binomial probability."""
    if n == 0:
        return None
    if failures == n:
        return 1.0
    low, high = 0.0, 1.0
    coefficients = [math.lgamma(n+1) - math.lgamma(k+1) - math.lgamma(n-k+1)
                    for k in range(failures+1)]
    for _ in range(58):
        p = (low + high) / 2
        cdf = sum(math.exp(c + k * math.log(p) + (n-k) * math.log1p(-p))
                  for k, c in enumerate(coefficients))
        if cdf > 0.05:
            low = p
        else:
            high = p
    return high


def finite(row, key):
    value = row.get(key)
    return type(value) in (int, float) and math.isfinite(value)


def score(row):
    if row.get("error"):
        return {"engineError": True, "areaErrorPct": None, "failed": ["engine", "area", "facets", "spatial", "edges"]}
    area_error = None
    if finite(row, "gtSloped") and row["gtSloped"] > 0 and finite(row, "enSloped"):
        area_error = 100 * abs(row["enSloped"] - row["gtSloped"]) / row["gtSloped"]
    failed = []
    if area_error is None or area_error > 5:
        failed.append("area")
    if not all(finite(row, f) for f in ("facetsGT", "facetsEN")) or row["facetsGT"] != row["facetsEN"]:
        failed.append("facets")
    spatial = all(finite(row, f) for f in ("truthPlanSqft", "missingPlanSqft", "extraPlanSqft", "outlineIoU"))
    if not (spatial and row["truthPlanSqft"] > 0 and 0.9 <= row["outlineIoU"] <= 1
            and all(0 <= row[f] <= 0.05 * row["truthPlanSqft"] for f in ("missingPlanSqft", "extraPlanSqft"))):
        failed.append("spatial")
    for edge in EDGE_TYPES:
        actual, expected = "en_" + edge, "gt_" + edge
        if (not finite(row, actual) or not finite(row, expected)
                or abs(row[actual] - row[expected]) > max(5, row[expected] * 0.10)):
            failed.append("edges")
            break
    return {"areaErrorPct": area_error, "failed": failed}


def percentiles(values):
    if not values:
        return None
    values = sorted(values)
    def quantile(q):
        index = q * (len(values) - 1)
        left = math.floor(index)
        return round(values[left] + (values[math.ceil(index)] - values[left]) * (index-left), 5)
    return {"median": quantile(0.5), "p95": quantile(0.95), "worst": quantile(1.0)}


def failure_rate(count, n):
    bound = upper_bound(count, n)
    return {"failed": count, "eligible": n, "percent": round(100 * count/n, 4) if n else None,
            "upper95Pct": round(100 * bound, 4) if bound is not None else None}


def summarize(rows):
    n = len(rows)
    failures = Counter(kind for _, result in rows for kind in result["failed"])
    area = failure_rate(failures["area"], n)
    whole_roof = failure_rate(sum(bool(result["failed"]) for _, result in rows), n)
    errors = [result["areaErrorPct"] for _, result in rows if result["areaErrorPct"] is not None]
    return {"areaErrorPct": percentiles(errors), "areaOutside5": area, "wholeRoofWrong": whole_roof,
            "componentFailures": {name: failures[name] for name in ("engine", "area", "facets", "spatial", "edges")},
            "everyAreaWithin5": bool(n) and failures["area"] == 0,
            "areaFailureRateAtMost5": bool(n) and failures["area"] * 100 <= 5*n,
            "wholeRoofFailureRateAtMost5": bool(n) and whole_roof["failed"] * 100 <= 5*n,
            "outsideAreaToleranceSeeds": [s for s, r in rows if "area" in r["failed"]]}


def compare(before, after):
    excluded = Counter()
    rows = {"baseline": [], "candidate": []}
    groups = {}
    for seed in sorted(before):
        old, new = before[seed], after[seed]
        if old.get("skipped") != new.get("skipped"):
            raise ValueError(f"Eligibility changed on seed {seed}")
        if old.get("skipped"):
            if old["skipped"] not in ("degenerate", "gt-clip"):
                raise ValueError(f"Unrecognized exclusion on seed {seed}")
            excluded[old["skipped"]] += 1
            continue
        if not old.get("error") and not new.get("error"):
            for field in ("gtSloped", "facetsGT", "meta", "wings", *("gt_" + e for e in EDGE_TYPES)):
                if old.get(field) != new.get(field):
                    raise ValueError(f"Fixture mismatch on seed {seed} for {field}")
        truth = new if not new.get("error") else old
        clutter = truth.get("meta", {}).get("clutter", [])
        groups[seed] = ("unknown" if not truth.get("meta") else
                        "canopy" if any(item.startswith("tree") for item in clutter) else "noCanopy")
        for key, row in (("baseline", old), ("candidate", new)):
            rows[key].append((seed, score(row)))
    return {"attempted": len(before), "excludedBeforeTrace": dict(excluded),
            "summary": {k: summarize(v) for k, v in rows.items()},
            "candidateByImagery": {g: summarize([(s, r) for s, r in rows["candidate"] if groups[s] == g])
                                   for g in sorted(set(groups.values()))}}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("cohort", choices=("development", "holdout", "integratedHoldout"))
    parser.add_argument("baseline", type=Path)
    parser.add_argument("candidate", type=Path)
    args = parser.parse_args()
    protocol = json.loads((DOCS / "five-percent-protocol.json").read_text(encoding="utf-8"))
    split = protocol[args.cohort]
    print(json.dumps(compare(read_run(args.baseline, split), read_run(args.candidate, split)), indent=2))
