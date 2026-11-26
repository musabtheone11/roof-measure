"""Export a sanitized model registry, execution ledger and capability matrix."""
import argparse
import json
import math
import pathlib
import statistics


def export(run, destination):
    registry = json.loads((run / 'registry.json').read_text())
    ledger = json.loads((run / 'execution.json').read_text())
    if any(registry[k] != ledger[k] for k in ('sourceRevision','fixtureSha256')):
        raise ValueError('registry and dispatch state refer to different inputs')
    destination.mkdir(parents=True, exist_ok=True)
    tasks = ledger['tasks']
    columns = ['model','assignment','case','listed','blocker','inputRate','outputRate','capacity','weight',
               'visionClaim','toolsClaim','freePlanFlag','reserveMicroUsd','illustrativeMicroUsd','datasheet','rationale']
    registry_export = [{k:row[k] for k in columns if k in row} for row in registry['registry']]
    task_fields = ['mode','scope','model','returnedModel','requestId','sourceRevision','requestSha256','inputBytes','sourceRefs',
                   'case','route','timeoutSeconds','maxOutputTokens','reserveMicroUsd','reserveFreeUnits','dispatchUtc','latencyMs',
                   'http','status','usage','costMicroUsd','costField','estimatedFreeUnits','responseSha256','proposal','errorClass','identityStatus']
    exports = {k:{field:t[field] for field in task_fields if field in t} for k,t in tasks.items()}
    result = {k:registry[k] for k in ('sourceRevision','fixtureSha256','observedUtc','publicJsonCount','authenticatedCount',
                                      'balanceRead','positiveSpendableBalance','activeReservation','balanceRpm','headerRpm','freeAllowance','catalog') if k in registry}
    result.update(registry=registry_export, tasks=exports)
    (destination/'specialist-evidence.json').write_text(json.dumps(result,indent=2,ensure_ascii=True)+'\n',encoding='utf-8')
    known=[t['costMicroUsd'] for t in tasks.values() if t.get('costMicroUsd') is not None]
    totals={k:sum(t.get('usage',{}).get(k,0) for t in tasks.values()) for k in ('prompt_tokens','completion_tokens','total_tokens')}
    over=sum(t.get('usage',{}).get('completion_tokens',0)>(t.get('maxOutputTokens') or 2**63) for t in tasks.values())
    latencies=sorted(t['latencyMs'] for t in tasks.values() if 'latencyMs' in t)
    weights={r['model']:r.get('weight') for r in registry_export}
    weighted=sum(t['usage']['total_tokens']*weights[t['model']] for t in tasks.values()
                 if t['model'].startswith('free/') and type(t.get('usage',{}).get('total_tokens')) is int and type(weights[t['model']]) is int)
    timings=(f"Recorded latency across {len(latencies)} responses had median {statistics.median(latencies)/1000:.2f} s, "
             f"nearest-rank p95 {latencies[math.ceil(.95*len(latencies))-1]/1000:.2f} s and maximum {latencies[-1]/1000:.2f} s.") if latencies else 'No recorded latencies.'
    lines=['# API NEX engineering qualification', '',
           f"Source revision `{registry['sourceRevision']}`. Frozen assignment bank SHA-256 `{registry['fixtureSha256']}`.",'',
           f"{registry['authenticatedCount']} authenticated model IDs and {registry['publicJsonCount']} public JSON entries. "
           f"{len(tasks)} recorded dispatches. {len(known)} reported a billing debit totaling ${sum(known)/1e6:.6f}. "
           f"{len(tasks)-len(known)} dispatches have unknown billing.",'',
           f"Provider totals were {totals['prompt_tokens']:,} input, {totals['completion_tokens']:,} completion and "
           f"{totals['total_tokens']:,} total tokens. {over} responses reported more completion tokens than the requested output limit.",'',
           f"Weighted free allowance use estimated from reported total tokens and catalog weights was {weighted:,} units. {timings}",'',
           'Each role task receives CAL-1 plus its own frozen synthetic case. A pass requires schema-valid output, 108 projected square feet, an unknown sloped area, both evidence IDs, and the correct role decision. The typed Decisions route checks its three categorical answers. Text proposals remain advisory. Each vision probe checks the location of a detached gray rectangle in the committed synthetic source. Each tool probe requires one correctly typed inert function call. Repeated samples and real-property accuracy lie outside these screens.','',
           '| Authenticated or requested model | Engineering assignment | Role / JSON or Decisions | Vision | Tool call |',
           '| --- | --- | --- | --- | --- |']
    for row in registry_export:
        def state(mode):
            entry=tasks.get(row['model']+'/'+mode)
            if entry:
                if entry.get('identityStatus'):
                    return 'returned ID differs'
                if entry.get('http') and entry['http']!=200:
                    return f"HTTP {entry['http']}"
                return entry['status']
            if row.get('blocker'):
                return row['blocker'] if mode=='assignment' else '—'
            return 'unexercised'
        lines.append('| '+' | '.join(['`'+row['model']+'`',row['assignment'],state('assignment'),state('vision'),state('tools')])+' |')
    (destination/'specialist-matrix.md').write_text('\n'.join(lines)+'\n',encoding='utf-8')


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('run',type=pathlib.Path)
    parser.add_argument('destination',type=pathlib.Path)
    args=parser.parse_args()
    export(args.run,args.destination)
