"""Offline audits of the complete sequential Java replay. Never invokes native."""
from pathlib import Path
import json
import hashlib
from collections import Counter
from shapely.strtree import STRtree
from shapely.ops import unary_union
from native_foundation_compare import audit_phase, surface, AREA_TOLERANCE
from native_source_aspect_proof import accepted, lookup, quality

ROOT = Path(__file__).resolve().parents[2]
import sys
OUT = (ROOT / sys.argv[1]).resolve()
PRIOR = ROOT / 'web/out/java-full-setback-proof'
def load(p): return json.loads(p.read_bytes())
def sha(p): return hashlib.sha256(p.read_bytes()).hexdigest()
def save(p, data):
    with p.open('x', encoding='utf8') as f:
        json.dump(data, f, ensure_ascii=False, indent=2, allow_nan=False)
        f.write('\n')

requests = load(OUT/'requests.json')['requests']
catalogue = load(OUT/'catalogue-snapshot.json')
batches = {'after':load(OUT/'after-plans.json')}
audits = {}
for phase in batches:
    summary = load(OUT/phase/'summary.json')
    sites = []
    for i, item in enumerate(summary['batches']):
        stem = f'{i:03d}'
        rp, bp = OUT/phase/f'{stem}-request.json', OUT/phase/f'{stem}-plans.json'
        assert sha(rp) == item['inputSha256'] and sha(bp) == item['outputSha256']
        # Each chunk already contains the exact earlier-chunk occupation. The
        # auditor additionally accumulates its own earlier buildings in this chunk.
        audit = audit_phase(load(rp)['requests'], load(bp))
        sites.extend(audit['sites'])
        if i % 7 == 0: print(json.dumps({'audit':phase, 'batch':i+1,'total':len(summary['batches'])}), flush=True)
    prepared = [s for s in sites if s['preparedFoundation']]
    # Independent global broad phase: certify that inter-chunk occupation
    # collisions cannot be hidden by a missing supplied neighbor.
    buildings = batches[phase]['buildings']
    occupied = [unary_union([surface(b[k]) for k in ['footprint','courtyards','circulation']]
                 + [surface(f['surface']) for f in b['structural_features']]) for b in buildings]
    tree = STRtree(occupied)
    pairs = []
    for i, geometry in enumerate(occupied):
        for j in tree.query(geometry):
            j = int(j)
            if j <= i: continue
            overlap = geometry.intersection(occupied[j]).area
            if overlap > AREA_TOLERANCE:
                pairs.append({'a':buildings[i]['id'],'b':buildings[j]['id'],'area_m2':overlap})
    audit = dict(checkedBuildings=len(sites), preparedFoundationBuildings=len(prepared),
        preparedFamilies=dict(Counter(s['nativeFoundationFamily'] for s in prepared)),
        rightsViolationBuildings=[s['id'] for s in sites if s['rightsAboveTolerance']],
        allPreparedTerrainViolationBuildings=[s['id'] for s in prepared if s['terrain']['violations']],
        groundMaxErrorM=max((abs(s['terrain']['groundZDifferenceM']) for s in prepared),default=0),
        occupiedOverlapPairs=pairs, sites=sites,
        scope='GEOS audits against exact enriched requests plus within-chunk prior occupation; independent STRtree collision check over all accepted occupation surfaces. Terrain only for explicitly prepared Strip/Single foundations; unprepared plans are not certified. Rights tolerance0.0001m2, terrain1e-6m/deg.')
    save(OUT/f'{phase}-rights-terrain-audit.json',audit)
    audits[phase]={k:v for k,v in audit.items() if k!='sites'}


current = lookup(batches['after'], requests)
prior = load(PRIOR/'comparison-to-c90c.json')
assert sha(OUT/'requests.json') == prior['provenance']['requests.json']
assert sha(OUT/'catalogue-snapshot.json') == sha(PRIOR/'catalogue-snapshot.json')
new = {}
for request in requests:
    state,value=current[request['id']]
    new[request['id']]=accepted(request,value,catalogue) if state=='accepted' else dict(state=state,result=value)

def counters(values):
    bs=[v for v in values if v['state']=='accepted']
    budget=[v['budget'] for v in bs if v['budget']]
    guide=[v['terrain_guide'] for v in bs if v['terrain_guide']]
    return dict(native_entries=dict(retained=sum(v['retained_native_entrance'] is not None for v in bs),
        upgraded=sum(any(d.startswith('Native planning entrance upgrade:') for d in v['native_entry_diagnostics']) for v in bs),
        deferred=sum(any(d.startswith('Native planning entrance deferred:') for d in v['native_entry_diagnostics']) for v in bs)),
        budgets=dict(traces=len(budget),pairs_total=sum(v['pairs'] for v in budget),poses_total=sum(v['poses'] for v in budget),pairs_max=max((v['pairs'] for v in budget),default=0),poses_max=max((v['poses'] for v in budget),default=0)),
        terrain_guides=dict(traces=len(guide),evaluations_total=sum(v['evaluations'] for v in guide),corrections_total=sum(v['corrections'] for v in guide),evaluations_max=max((v['evaluations'] for v in guide),default=0),corrections_max=max((v['corrections'] for v in guide),default=0)))

for ref,oldkey in [('44999','after')]:
    oldbatch=load(PRIOR/f'{oldkey}-plans.json')
    oldstates=lookup(oldbatch, requests)
    rows=[]
    for old in prior['sites']:
        rid=old['id']; row={k:old[k] for k in ['index','id','function','role','composition','target_m2']}
        a,b=old[oldkey],new[rid];row.update(before=a,after=b,whole_result_changed=oldstates[rid]!=current[rid])
        if a['state']==b['state']=='accepted':
            row['changed_fields']=[k for k in ['recipe','variant','body_levels','seed','bodies','transform','entrance','access_id','retained_native_entrance','geometry_hashes'] if a[k]!=b[k]]
            row['body_area_delta_m2']=b['body_area_m2']-a['body_area_m2']
            if row['target_m2']:
                delta=b['absolute_target_error_m2']-a['absolute_target_error_m2'];row['absolute_error_delta_m2']=delta
                row['target_quality']='improved' if delta < -1e-4 else 'worsened' if delta > 1e-4 else 'equal'
        rows.append(row)
    common=[r for r in rows if r['before']['state']==r['after']['state']=='accepted']
    report=dict(version='java-full-b11-comparison-1',reference=ref,count=len(requests),
        provenance={str(f.relative_to(OUT)):sha(f) for f in [OUT/'requests.json',OUT/'manifest.json',OUT/'replay-summary.json',OUT/'after-plans.json']},
        priorComparisonSha256=sha(PRIOR/'comparison-to-c90c.json'),
        counts={'before':dict(Counter(v[0] for v in oldstates.values())),'after':dict(Counter(v[0] for v in current.values()))},
        lost=[r for r in rows if r['before']['state']=='accepted' and r['after']['state']!='accepted'],
        gained=[r for r in rows if r['before']['state']!='accepted' and r['after']['state']=='accepted'],
        source_variant_floor_changes=[r for r in common if set(r['changed_fields']) & {'recipe','variant','body_levels'}],
        styles={'before':dict(Counter(b['recipe_id']+'::'+b['variant_id'] for b in oldbatch['buildings'])),'after':dict(Counter(b['recipe_id']+'::'+b['variant_id'] for b in batches['after']['buildings']))},
        target_quality=dict(Counter(r.get('target_quality','no_target') for r in common)),
        regressions=[r for r in common if r.get('target_quality')=='worsened'],
        improvements=[r for r in common if r.get('target_quality')=='improved'],
        quality={scope:{p:quality(selected,p) for p in ['before','after']} for scope,selected in [('all_accepted',rows),('common_accepted',common)]},
        source_ratio_bad_at_mm={p:[r['id'] for r in rows if r[p]['state']=='accepted' and any(b['source_ratio_at_mm_ok'] is False for b in r[p]['bodies'])] for p in ['before','after']},
        counts_and_budgets={p:counters([r[p] for r in rows]) for p in ['before','after']},
        rights={'before':prior['rights'][oldkey],'after':audits['after']},
        nativeMsSum={'before':prior['nativeMsSum'][oldkey],'after':load(OUT/'after/summary.json')['nativeMsSum']},
        refusals_identical=oldbatch['refusals']==batches['after']['refusals'],sites=rows,
        limits=['Same complete historic site corpus and production bridge with independent occupation. Not a newly generated R5 city or capacity certification.',
          'Native milliseconds are sums of a single sequential run of separate CLI processes; no speed claim.',
          'No detailed realization is performed in this proof. Exact plans/archives, entry transitions and all gains/regressions are compared.'])
    save(OUT/f'comparison-to-{ref}.json',report)
    print(json.dumps({'reference':ref,'counts':report['counts'],'lost':len(report['lost']),'gained':len(report['gained']),'sourceChanges':len(report['source_variant_floor_changes']),'targetQuality':report['target_quality'],'quality':report['quality']['all_accepted'],'newCounters':report['counts_and_budgets']['after']},ensure_ascii=False),flush=True)
for audit in audits.values():
    assert not audit['rightsViolationBuildings']
    assert not audit['allPreparedTerrainViolationBuildings']
    assert not audit['occupiedOverlapPairs']

# Exact-result proof, including diagnostics/retained compact plans/materials.
oldbatch=load(PRIOR/'after-plans.json')
newbatch=batches['after']
oldmap=lookup(oldbatch, requests); newmap=lookup(newbatch, requests)
changed=[rid for rid in oldmap if oldmap[rid]!=newmap[rid]]
def is_b11(value): return value[0]=='accepted' and value[1].get('recipe_id','').endswith('-B11')
b11=[rid for rid in oldmap if is_b11(oldmap[rid]) or is_b11(newmap[rid])]
non_b11_changes=[rid for rid in changed if rid not in set(b11)]
oldsummary=load(PRIOR/'after/summary.json');newsummary=load(OUT/'after/summary.json')
exact=dict(version='java-full-b11-exact-1',reference='44999',count=len(requests),
    b11AcceptedIdentities=b11,allResultObjectsIdentical=oldbatch==newbatch,
    aggregatePlanBytesIdentical=sha(PRIOR/'after-plans.json')==sha(OUT/'after-plans.json'),
    inputBytesIdentical=sha(PRIOR/'requests.json')==sha(OUT/'requests.json'),
    enrichedInputBytesIdentical=sha(PRIOR/'after-enriched-requests.json')==sha(OUT/'after-enriched-requests.json'),
    changedResultIds=changed,changedNonB11ResultIds=non_b11_changes,
    batchRequestHashesIdentical=[a['inputSha256']==b['inputSha256'] for a,b in zip(oldsummary['batches'],newsummary['batches'])],
    batchOutputHashesIdentical=[a['outputSha256']==b['outputSha256'] for a,b in zip(oldsummary['batches'],newsummary['batches'])],
    referencePlansSha256=sha(PRIOR/'after-plans.json'),newPlansSha256=sha(OUT/'after-plans.json'),
    newNativeEntryIds=[r['id'] for r in rows if r['before']['state']==r['after']['state']=='accepted' and r['before']['retained_native_entrance'] is None and r['after']['retained_native_entrance'] is not None],
    lostNativeEntryIds=[r['id'] for r in rows if r['before']['state']==r['after']['state']=='accepted' and r['before']['retained_native_entrance'] is not None and r['after']['retained_native_entrance'] is None])
assert len(oldsummary['batches'])==len(newsummary['batches'])==28
save(OUT/'exact-result-comparison.json',exact)
print(json.dumps({'exact':exact},ensure_ascii=False),flush=True)
