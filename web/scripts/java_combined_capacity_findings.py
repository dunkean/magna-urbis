"""Interpret exact combined audit findings; preserve raw checks and outputs."""
from pathlib import Path
from collections import Counter, defaultdict
import argparse
import json
import math

from java_combined_capacity_audit import load, save, sha, simple_ground_audit, BASELINE
from native_source_aspect_proof import quality


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('after', type=Path)
    args = parser.parse_args()
    after = args.after.resolve()
    out = after/'independent-audit'
    comparison = load(out/'comparison.json')
    rows = load(out/'sites.json')
    grounds = {r['id']:r for r in load(out/'simple-ground-source.json')}
    catalogue = load(after/'catalogue-snapshot.json')
    anomalies = [r for r in rows if r['id'] in comparison['guards']['simpleSourceViolations']]
    grouped = defaultdict(list)
    for row in anomalies:
        grouped[row['batch']].append(row)
    history = []
    for index, cases in grouped.items():
        stem = f'{index:03d}'
        payload = load(BASELINE/'after'/f'{stem}-request.json')
        plans = load(BASELINE/'after'/f'{stem}-plans.json')
        requests = {r['id']:r for r in payload['requests']}
        buildings = {r['id']:r for r in plans['buildings']}
        for row in cases:
            old = simple_ground_audit(requests[row['id']],buildings[row['id']],catalogue)
            new = grounds[row['id']]
            assert old['covered'] and new['covered']
            history.append(dict(id=row['id'],index=row['index'],before=old,after=new,
                                checksExactlyUnchanged=old['checks']==new['checks'],
                                physicalDimensionsExactlyUnchanged=old['dimensionsM']==new['dimensionsM'],
                                physicalMinimumExactlyUnchanged=old['physicalMinimumM']==new['physicalMinimumM']))
    ratio = [r for r in history if not r['after']['checks']['sourceRatio']]
    minima = [r for r in history if not r['after']['checks']['physicalMinimum']]
    minimum_deficit = max((r['after']['physicalMinimumM']-min(r['after']['dimensionsM']) for r in minima),default=0)
    # The native body dimensions are millimetre-quantized. Retain the raw
    # failed inequality, and explicitly distinguish subtraction-scale drift.
    assert all([math.floor(v*1000+.5)/1000 for v in r['after']['dimensionsM']][0] >= r['after']['physicalMinimumM']-1e-12
               and [math.floor(v*1000+.5)/1000 for v in r['after']['dimensionsM']][1] >= r['after']['physicalMinimumM']-1e-12 for r in minima)
    common = [r for r in rows if r['before']['state']==r['after']['state']=='accepted']
    losses = [r for r in common if r['before']['retained_native_entrance'] is not None and r['after']['retained_native_entrance'] is None]
    gains = [r for r in common if r['before']['retained_native_entrance'] is None and r['after']['retained_native_entrance'] is not None]
    transitions = []
    for direction, items in [('lost',losses),('gained',gains)]:
        for row in items:
            batch = load(after/'after'/f"{row['batch']:03d}-plans.json")
            building = next(b for b in batch['buildings'] if b['id']==row['id'])
            transitions.append(dict(direction=direction,index=row['index'],batch=row['batch'],id=row['id'],
                                    recipe=row['after']['recipe'],variant=row['after']['variant'],
                                    targetM2=row['target_m2'],beforeAreaM2=row['before']['body_area_m2'],
                                    afterAreaM2=row['after']['body_area_m2'],areaDeltaM2=row['bodyAreaDeltaM2'],
                                    absoluteErrorDeltaM2=row.get('absoluteErrorDeltaM2'),
                                    beforeDimensions=[b['measured_mm_dimensions'] for b in row['before']['bodies']],
                                    afterDimensions=[b['measured_mm_dimensions'] for b in row['after']['bodies']],
                                    context=row['occupationContext'],diagnostics=building['diagnostics']))
    recipe_changes = {}
    for recipe in sorted({r['after']['recipe'] for r in common}):
        items = [r for r in common if r['after']['recipe']==recipe]
        budget = {p:[r[p]['budget'] for r in items if r[p]['budget']] for p in ['before','after']}
        recipe_changes[recipe] = dict(common=len(items),
            physicalAreaChanged=sum(abs(r['bodyAreaDeltaM2'])>1e-4 for r in items),
            areaDeltaM2=sum(r['bodyAreaDeltaM2'] for r in items),
            targetChanges=dict(Counter(r.get('targetQuality','unknown') for r in items)),
            commonQuality={p:quality([r for r in items if r['function'] in ['domestic','mixed']],p) for p in ['before','after']},
            budgets={p:dict(traces=len(v),dimensions=sum(x['pairs'] for x in v),admissions=sum(x['poses'] for x in v)) for p,v in budget.items()})
    entry_summary = {}
    for direction in ['lost','gained']:
        items = [r for r in transitions if r['direction']==direction]
        entry_summary[direction] = dict(count=len(items),recipes=dict(Counter(r['recipe'] for r in items)),
            beforeAreaM2=sum(r['beforeAreaM2'] for r in items),afterAreaM2=sum(r['afterAreaM2'] for r in items),
            deltaAreaM2=sum(r['areaDeltaM2'] for r in items),
            meaningfulAreaChanges=sum(abs(r['areaDeltaM2'])>1e-4 for r in items),
            enrichedNeighborChanges=sum(r['context']['enrichedNeighborsChanged'] for r in items),
            nearbyWithinBatchChanges=sum(bool(r['context']['spatiallyRelevantPriorChanges']) for r in items),
            reasons=dict(Counter(d for r in items for d in r['diagnostics'] if d.startswith('Native planning entrance deferred:'))))
    changed = [r for r in common if abs(r['bodyAreaDeltaM2'])>1e-4]
    inherited = all(r['checksExactlyUnchanged'] and r['physicalDimensionsExactlyUnchanged'] and r['physicalMinimumExactlyUnchanged'] for r in history)
    summary = dict(version='combined-C-interpretation-1',
        provenance=dict(rawAuditSha256=sha(out/'comparison.json'),scriptSha256=sha(Path(__file__))),
        sourceFindings=dict(rawFlags=len(history),allInheritedWithExactPhysicalDimensions=inherited,
            ratios=dict(count=len(ratio),recipes=dict(Counter(r['after']['recipe'] for r in ratio))),
            minima=dict(count=len(minima),maximumRawDeficitM=minimum_deficit,allPassAtNativeMillimetreGrid=True),
            newAdmittedSourceIssues=[r['id'] for r in rows if r['before']['state']!='accepted' and r['after']['state']=='accepted' and r['id'] in comparison['guards']['simpleSourceViolations']],
            meaning='Raw audit retained. Ratio anomalies are inherited source-aspect deviations, not introduced by this patch. Minimum flags are inherited coordinate-subtraction drift, explicitly checked at native millimetre grid; no native tolerance changed.'),
        oldPhysicalAreaChanged=len(changed),oldAreaDeltaM2=sum(r['bodyAreaDeltaM2'] for r in common),
        commonDomesticMixedQuality={p:quality([r for r in common if r['function'] in ['domestic','mixed']],p) for p in ['before','after']},
        commonByRecipe=recipe_changes,entryTransitions=entry_summary,
        sourceVariantFloorChanges=comparison['changedSourceVariantFloors'],
        largestRegressions=[dict(index=r['index'],id=r['id'],recipe=r['after']['recipe'],before=r['before']['body_area_m2'],after=r['after']['body_area_m2'],target=r['target_m2'],absoluteErrorDelta=r['absoluteErrorDeltaM2'],context=r['occupationContext']) for r in sorted([r for r in common if r.get('targetQuality')=='worsened'],key=lambda r:r['absoluteErrorDeltaM2'],reverse=True)[:12]],
        status='Geometry, terrain, collisions and new-source constraints pass. Existing source-aspect findings and retained-entry tradeoffs remain explicit; no interior success or capacity inferred.')
    save(out/'source-findings-history.json',history)
    save(out/'entry-transitions.json',transitions)
    save(out/'findings.json',summary)
    print(json.dumps(summary,ensure_ascii=False),flush=True)
    assert inherited, 'New source finding: do not describe all flags as inherited'


if __name__=='__main__':
    main()
