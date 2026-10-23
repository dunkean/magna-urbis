"""Compare two completed C7921 proofs without another native/geometry run."""
import argparse
from pathlib import Path
from collections import Counter
import re
from java_combined_capacity_audit import load, save, sha, building_fragments
from native_source_aspect_proof import quality


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--before',required=True,type=Path)
    parser.add_argument('--after',required=True,type=Path)
    args=parser.parse_args()
    before,after=args.before.resolve(),args.after.resolve()
    old=load(before/'independent-audit/sites.json')
    new=load(after/'independent-audit/sites.json')
    assert [r['id'] for r in old]==[r['id'] for r in new]
    assert sha(before/'source-requests.json')==sha(after/'source-requests.json')
    rows=[]
    for a,b in zip(old,new):
        assert a['before']==b['before'],'These phases do not share the same B11 baseline'
        r={k:b[k] for k in ['index','batch','id','function','role','composition','target_m2']}
        r.update(before=a['after'],after=b['after'])
        if r['before']['state']==r['after']['state']=='accepted':
            r['areaDeltaM2']=r['after']['body_area_m2']-r['before']['body_area_m2']
            r['changedFields']=[k for k in ['recipe','variant','body_levels','seed','bodies','transform','geometry_hashes','entrance','access_id','retained_native_entrance'] if r['before'][k]!=r['after'][k]]
            if r['target_m2']:
                r['absoluteErrorDeltaM2']=r['after']['absolute_target_error_m2']-r['before']['absolute_target_error_m2']
        rows.append(r)
    current={r['id']:r['after'] for r in rows}
    common=[r for r in rows if r['before']['state']==r['after']['state']=='accepted']
    summaries={p:load(root/'after/summary.json') for p,root in [('before',before),('after',after)]}
    byte_equal=0;common_records=0;changed_records=[];phase_traces=[];selection_traces=[];batch_rows=[]
    for a,b in zip(summaries['before']['batches'],summaries['after']['batches']):
        assert (a['index'],a['start'],a['count'])==(b['index'],b['start'],b['count'])
        stem=f"{a['index']:03d}"
        paths={p:root/'after'/f'{stem}-plans.json' for p,root in [('before',before),('after',after)]}
        parts={p:building_fragments(path) for p,path in paths.items()}
        for rid in parts['before'].keys()&parts['after'].keys():
            common_records+=1
            if parts['before'][rid]==parts['after'][rid]:byte_equal+=1
            else:changed_records.append(rid)
        batch_rows.append(dict(index=a['index'],inputsByteIdentical=a['inputSha256']==b['inputSha256'],outputsByteIdentical=a['outputSha256']==b['outputSha256']))
        for building in load(paths['after'])['buildings']:
            p=current[building['id']]
            phases=[d for d in building['diagnostics'] if d.startswith('Adapted domestic budget phases:')]
            selections=[d for d in building['diagnostics'] if d.startswith('Adapted domestic budget selection:')]
            assert len(phases)<=1 and len(selections)<=1
            if phases:
                m=re.search(r'nominal first used (\d+)/8 dimensions, (\d+)/24 admissions, (\d+)/8 terrain-guide evaluations;',phases[0])
                assert m
                dimensions,admissions,terrain=map(int,m.groups())
                total=p['budget'];guide=p['terrain_guide']
                assert total and dimensions<8 and admissions<24
                assert dimensions<=total['pairs']<=8 and admissions<=total['poses']<=24
                assert terrain<=(guide['evaluations'] if guide else 0)<=8
                phase_traces.append(dict(id=building['id'],nominalDimensions=dimensions,nominalAdmissions=admissions,nominalTerrain=terrain,total=total,guide=guide))
            if selections:
                assert phases and p['source_layout']=='single'
                assert 'At most 1 additional final Single entry check; no new dimension, pose, door or source.' in selections[0]
                fallback='the best nominal plan and its certified existing-pose entrance were retained' in selections[0]
                if fallback:assert p['retained_native_entrance'] is not None
                selection_traces.append(dict(id=building['id'],recipe=p['recipe'],nominalPortalFallback=fallback,message=selections[0]))
    assert common_records==len(common)
    report=dict(version='java-C-phase-comparison-1',
        provenance=dict(before=str(before),after=str(after),beforeManifestSha256=sha(before/'manifest.json'),afterManifestSha256=sha(after/'manifest.json'),scriptSha256=sha(Path(__file__))),
        counts={p:dict(Counter(r[p]['state'] for r in rows)) for p in ['before','after']},
        gained=[r['id'] for r in rows if r['before']['state']!='accepted' and r['after']['state']=='accepted'],
        lost=[r['id'] for r in rows if r['before']['state']=='accepted' and r['after']['state']!='accepted'],
        common=len(common),commonByteIdentical=byte_equal,commonChangedObjects=changed_records,
        sourceVariantFloorChanges=[r['id'] for r in common if set(r['changedFields'])&{'recipe','variant','body_levels'}],
        changedBodyDimensions=[r['id'] for r in common if 'bodies' in r['changedFields']],
        changedAreaAboveTolerance=[r['id'] for r in common if abs(r['areaDeltaM2'])>1e-4],
        commonAreaDeltaM2=sum(r['areaDeltaM2'] for r in common),
        targetQualityChanges=dict(Counter('improved' if r['absoluteErrorDeltaM2'] < -1e-4 else 'worsened' if r['absoluteErrorDeltaM2'] >1e-4 else 'equal' for r in common if r.get('target_m2'))),
        entryGains=[r['id'] for r in common if r['before']['retained_native_entrance'] is None and r['after']['retained_native_entrance'] is not None],
        entryLosses=[r['id'] for r in common if r['before']['retained_native_entrance'] is not None and r['after']['retained_native_entrance'] is None],
        commonDomesticMixedQuality={p:quality([r for r in common if r['function'] in ['domestic','mixed']],p) for p in ['before','after']},
        fullDomesticMixedQuality={p:quality([r for r in rows if r['function'] in ['domestic','mixed']],p) for p in ['before','after']},
        budgets={p:dict(traces=sum(r[p]['state']=='accepted' and bool(r[p]['budget']) for r in rows),dimensions=sum(r[p]['budget']['pairs'] for r in rows if r[p]['state']=='accepted' and r[p]['budget']),admissions=sum(r[p]['budget']['poses'] for r in rows if r[p]['state']=='accepted' and r[p]['budget'])) for p in ['before','after']},
        phaseCount=len(phase_traces),additionalNominalFinalizerRequests=len(selection_traces),
        additionalFinalizerRecipeCounts=dict(Counter(r['recipe'] for r in selection_traces)),
        nominalPortalFallbacks=sum(r['nominalPortalFallback'] for r in selection_traces),
        limits=['Same archived C7921 inputs, separately regenerated cumulative occupation. Full geometry audit is kept separately, not rerun here.',
                'Finalizer requests include unsupported sources skipped by prefilter; they are not additional native admission counts.',
                'No interiors/capacity inference or timing benchmark.'])
    out=after/'independent-audit'
    save(out/'comparison-to-previous.json',report)
    save(out/'comparison-to-previous-sites.json',rows)
    save(out/'comparison-to-previous-batches.json',batch_rows)
    save(out/'nominal-phase-traces.json',phase_traces)
    save(out/'nominal-selection-traces.json',selection_traces)
    print({k:len(v) if isinstance(v,list) else v for k,v in report.items() if k not in ['commonDomesticMixedQuality','fullDomesticMixedQuality','limits']})


if __name__=='__main__':main()
