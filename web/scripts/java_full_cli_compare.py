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
OUT = ROOT / 'web/out/java-full-terrain-entry-proof'
def load(p): return json.loads(p.read_bytes())
def sha(p): return hashlib.sha256(p.read_bytes()).hexdigest()
def save(p, data):
    with p.open('x', encoding='utf8') as f:
        json.dump(data, f, ensure_ascii=False, indent=2, allow_nan=False)
        f.write('\n')

requests = load(OUT/'requests.json')['requests']
catalogue = load(OUT/'catalogue-snapshot.json')
batches = {p:load(OUT/f'{p}-plans.json') for p in ['before','after']}
states = {p:lookup(batch,requests) for p,batch in batches.items()}
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

rows=[]
for index,request in enumerate(requests):
    rid=request['id']; programme=request.get('programme') or {}
    row=dict(index=index,id=rid,function=request['function'],role=programme.get('role'),composition=programme.get('composition'),target_m2=programme.get('built_area_m2'))
    for phase in batches:
        state,value=states[phase][rid]
        row[phase]=accepted(request,value,catalogue) if state=='accepted' else dict(state=state,result=value)
    a,b=row['before'],row['after']
    row['whole_result_changed']=states['before'][rid]!=states['after'][rid]
    if a['state']==b['state']=='accepted':
        row['changed_fields']=[k for k in ['recipe','variant','body_levels','seed','bodies','transform','entrance','access_id','retained_native_entrance','geometry_hashes'] if a[k]!=b[k]]
        row['body_area_delta_m2']=b['body_area_m2']-a['body_area_m2']
        if row['target_m2']:
            delta=b['absolute_target_error_m2']-a['absolute_target_error_m2'];row['absolute_error_delta_m2']=delta
            row['target_quality']='improved' if delta < -1e-4 else 'worsened' if delta > 1e-4 else 'equal'
    rows.append(row)
common=[r for r in rows if r['before']['state']==r['after']['state']=='accepted']
counts={p:dict(Counter(s for s,_ in v.values())) for p,v in states.items()}
native_entries={}
budgets={};guides={}
for p in batches:
    buildings=[r[p] for r in rows if r[p]['state']=='accepted']
    native_entries[p]=dict(retained=sum(b['retained_native_entrance'] is not None for b in buildings),
        upgraded=sum(any(d.startswith('Native planning entrance upgrade:') for d in b['native_entry_diagnostics']) for b in buildings),
        deferred=sum(any(d.startswith('Native planning entrance deferred:') for d in b['native_entry_diagnostics']) for b in buildings))
    traces=[b['budget'] for b in buildings if b['budget']]
    budgets[p]=dict(traces=len(traces),pairs_total=sum(b['pairs'] for b in traces),poses_total=sum(b['poses'] for b in traces),pairs_max=max((b['pairs'] for b in traces),default=0),poses_max=max((b['poses'] for b in traces),default=0))
    traces=[b['terrain_guide'] for b in buildings if b['terrain_guide']]
    guides[p]=dict(traces=len(traces),evaluations_total=sum(b['evaluations'] for b in traces),corrections_total=sum(b['corrections'] for b in traces),evaluations_max=max((b['evaluations'] for b in traces),default=0),corrections_max=max((b['corrections'] for b in traces),default=0))
report=dict(version='java-full-sequential-comparison-1',count=len(requests),
    provenance={str(f.relative_to(OUT)):sha(f) for f in [OUT/'requests.json',OUT/'manifest.json',OUT/'replay-summary.json',OUT/'catalogue-snapshot.json',OUT/'before-plans.json',OUT/'after-plans.json']},
    scripts={str(f.relative_to(ROOT)):sha(f) for f in [Path(__file__), Path(__file__).with_name('native_foundation_compare.py'),Path(__file__).with_name('native_source_aspect_proof.py')]},
    counts=counts,
    lost=[r for r in rows if r['before']['state']=='accepted' and r['after']['state']!='accepted'],
    gained=[r for r in rows if r['before']['state']!='accepted' and r['after']['state']=='accepted'],
    source_variant_floor_changes=[r for r in common if set(r['changed_fields']) & {'recipe','variant','body_levels'}],
    styles={p:dict(Counter(b['recipe_id']+'::'+b['variant_id'] for b in batches[p]['buildings'])) for p in batches},
    native_entries=native_entries,entry_changes=[r['id'] for r in common if set(r['changed_fields']) & {'entrance','access_id','retained_native_entrance'}],
    target_quality=dict(Counter(r.get('target_quality','no_target') for r in common)),
    regressions=[r for r in common if r.get('target_quality')=='worsened'],
    improvements=[r for r in common if r.get('target_quality')=='improved'],
    quality={scope:{p:quality(selected,p) for p in batches} for scope,selected in [('all_accepted',rows),('common_accepted',common)]},
    source_ratio_bad_at_mm={p:[r['id'] for r in rows if r[p]['state']=='accepted' and any(b['source_ratio_at_mm_ok'] is False for b in r[p]['bodies'])] for p in batches},
    refusals={p:dict(Counter(b['message'] for b in batches[p]['refusals'])) for p in batches},
    nativeMsSum={p:load(OUT/p/'summary.json')['nativeMsSum'] for p in batches},budgets=budgets,terrain_guides=guides,rights=audits,sites=rows,
    limits=['Complete original historic site corpus, not a newly generated R5 city or replication of runtime8791.',
      'Fresh actual bridge occupation context per phase; native ms are a sum over separate per-batch CLI processes, not UI or persistent-server latency.',
      'No detail construction or residential capacity certification. Retained native portals are not proof that room subdivision succeeds.',
      'No monotonic-quality assumption: all gains, losses, changed source and worsened target ratios are preserved.'])
save(OUT/'comparison.json',report)
print(json.dumps({k:report[k] for k in ['counts','styles','native_entries','target_quality','nativeMsSum','budgets','terrain_guides','rights']},ensure_ascii=False),flush=True)
print(json.dumps({'lost':len(report['lost']),'gained':len(report['gained']),'sourceChanges':len(report['source_variant_floor_changes']),'regressions':len(report['regressions'])}),flush=True)
# Save evidence before surfacing failures; never erase inconvenient outputs.
for audit in audits.values():
    assert not audit['rightsViolationBuildings']
    assert not audit['allPreparedTerrainViolationBuildings']
    assert not audit['occupiedOverlapPairs']
