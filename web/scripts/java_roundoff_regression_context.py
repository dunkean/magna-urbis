"""Read-only context for the sole C7921 roundoff-vs38889 area regression."""
from pathlib import Path
from java_combined_capacity_audit import ROOT, load, save, sha, digest, occupation, surface

ROOTS={'before':ROOT/'web/out/java-c-nominal-first-terrain-v3-proof',
       'after':ROOT/'web/out/java-c-nominal-first-roundoff-proof'}
RID='layout-f9dab5910f08a8a2/block-6c727e9abd382d68/parcel-6c727e9abd382d68/building'
evidence={}
for phase,root in ROOTS.items():
    request_path=root/'after/023-request.json'
    plan_path=root/'after/023-plans.json'
    payload=load(request_path);plans=load(plan_path)
    buildings={b['id']:b for b in plans['buildings']}
    prior=[]
    for position,request in enumerate(payload['requests']):
        if request['id']==RID:break
        if request['id'] in buildings:
            building=buildings[request['id']]
            parts=[building[k] for k in ['footprint','courtyards','circulation']]+[f['surface'] for f in building['structural_features']]
            prior.append(dict(id=building['id'],bounds=list(occupation(building).bounds),partsSha256=digest(parts)))
    else:raise AssertionError('Missing exact site')
    assert position==33
    box=surface(request['cadastral']).bounds
    local=[p for p in prior if p['bounds'][0]<=box[2] and p['bounds'][2]>=box[0] and p['bounds'][1]<=box[3] and p['bounds'][3]>=box[1]]
    building=buildings[RID]
    evidence[phase]=dict(requestBatchSha256=sha(request_path),plansBatchSha256=sha(plan_path),
        requestSha256=digest(request),neighborsSha256=digest(request['neighbors']),neighborCount=len(request['neighbors']),
        priorAcceptedCount=len(prior),localBBoxCandidates=local,bodyAreaM2=surface(building['footprint']).area,
        transform=building['transform'],recipe=building['recipe_id'],variant=building['variant_id'],
        recoveryDiagnostics=[d for d in building['diagnostics'] if d.startswith('Initial source terrain recovery:')],
        entryDiagnostics=[d for d in building['diagnostics'] if d.startswith('Native planning entrance')])
same=(evidence['before']['requestSha256']==evidence['after']['requestSha256']
      and evidence['before']['localBBoxCandidates']==evidence['after']['localBBoxCandidates'])
report=dict(version='roundoff-one-recovery-regression-context-1',id=RID,index=1505,batch=23,position=33,
    requestAndNativeLocalContextExactlyUnchanged=same,phases=evidence,scriptSha256=sha(Path(__file__)),
    explanation='The eligible retained-witness pool changes from3 to4 and the selected observation from0 to3, with the same total8 terrain evaluations. Both choose B14 full7.5x11m; the reduced dimensions change4.874x7.15 to4.5x6.6. The traces do not expose the per-witness evaluation split; no exact bisection allocation is inferred.',
    limits='No new native run or corrective heuristic. B11 refused this site; retained native portal succeeds in both experimental phases. Native local context is established by matching input neighbors and ordered bbox-selected previous occupied parts.')
save(ROOTS['after']/'independent-audit/one-regression-context.json',report)
print({'contextExactlyUnchanged':same,'beforePrior':len(evidence['before']['localBBoxCandidates']),'afterPrior':len(evidence['after']['localBBoxCandidates'])})
