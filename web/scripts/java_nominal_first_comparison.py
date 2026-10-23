"""Scalar/trace comparison only; geometry is audited once by the main audit."""
from pathlib import Path
from collections import Counter
import argparse
import re
from java_combined_capacity_audit import ROOT, load, save, sha
from native_source_aspect_proof import quality


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('after',type=Path)
    args=parser.parse_args()
    current=args.after.resolve()
    prior=ROOT/'web/out/java-c-b06-v2-terrain-v3-proof'
    old_rows=load(prior/'independent-audit/sites.json')
    new_rows=load(current/'independent-audit/sites.json')
    assert [r['id'] for r in old_rows]==[r['id'] for r in new_rows]
    rows=[]
    for old,new in zip(old_rows,new_rows):
        assert old['before']==new['before']
        row={k:new[k] for k in ['index','batch','id','function','role','composition','target_m2']}
        row.update(before=old['after'],after=new['after'])
        if row['before']['state']==row['after']['state']=='accepted':
            row['areaDeltaM2']=row['after']['body_area_m2']-row['before']['body_area_m2']
            row['sourceFloorChanged']=any(row['before'][k]!=row['after'][k] for k in ['recipe','variant','body_levels'])
            if row['target_m2']:
                row['absoluteErrorDeltaM2']=row['after']['absolute_target_error_m2']-row['before']['absolute_target_error_m2']
        rows.append(row)
    common=[r for r in rows if r['before']['state']==r['after']['state']=='accepted']
    former_entry_losses=set(load(prior/'independent-audit/comparison.json')['retainedEntryLosses'])
    current_map={r['id']:r for r in new_rows}
    phase_traces=[];selection_traces=[]
    summary=load(current/'after/summary.json')
    for batch in summary['batches']:
        plans=load(current/'after'/f"{batch['index']:03d}-plans.json")
        for building in plans['buildings']:
            parsed=current_map[building['id']]['after']
            phase=[d for d in building['diagnostics'] if d.startswith('Adapted domestic budget phases:')]
            selection=[d for d in building['diagnostics'] if d.startswith('Adapted domestic budget selection:')]
            assert len(phase)<=1 and len(selection)<=1
            if phase:
                match=re.search(r'nominal first used (\d+)/8 dimensions, (\d+)/24 admissions, (\d+)/8 terrain-guide evaluations;',phase[0])
                assert match,'Unknown phase trace'
                dimensions,admissions,terrain=map(int,match.groups())
                total=parsed['budget'];guide=parsed['terrain_guide']
                assert total and dimensions<8 and admissions<24
                assert dimensions<=total['pairs']<=8 and admissions<=total['poses']<=24
                assert terrain <= (guide['evaluations'] if guide else 0) <=8
                phase_traces.append(dict(id=building['id'],nominalDimensions=dimensions,nominalAdmissions=admissions,
                                         nominalTerrainEvaluations=terrain,total=total,terrain=guide,message=phase[0]))
            if selection:
                assert phase,'Final nominal selection must have an adapted phase'
                assert parsed['source_layout']=='single'
                assert 'At most 1 additional final Single entry check; no new dimension, pose, door or source.' in selection[0]
                fallback='the best nominal plan and its certified existing-pose entrance were retained' in selection[0]
                if fallback:assert parsed['retained_native_entrance'] is not None
                selection_traces.append(dict(id=building['id'],nominalPortalFallback=fallback,message=selection[0]))
    report=dict(version='nominal-first-vs-combined-scalar-comparison-1',
        provenance=dict(priorManifestSha256=sha(prior/'manifest.json'),currentManifestSha256=sha(current/'manifest.json'),
                        scriptSha256=sha(Path(__file__))),
        counts={p:dict(Counter(r[p]['state'] for r in rows)) for p in ['before','after']},
        lost=[r['id'] for r in rows if r['before']['state']=='accepted' and r['after']['state']!='accepted'],
        gained=[r['id'] for r in rows if r['before']['state']!='accepted' and r['after']['state']=='accepted'],
        sourceVariantFloorChanges=[r['id'] for r in common if r['sourceFloorChanged']],
        commonAreaDeltaM2=sum(r['areaDeltaM2'] for r in common),
        entryGains=[r['id'] for r in common if r['before']['retained_native_entrance'] is None and r['after']['retained_native_entrance'] is not None],
        entryLosses=[r['id'] for r in common if r['before']['retained_native_entrance'] is not None and r['after']['retained_native_entrance'] is None],
        former36EntryLosses=dict(recovered=[rid for rid in sorted(former_entry_losses) if current_map[rid]['after']['state']=='accepted' and current_map[rid]['after']['retained_native_entrance'] is not None],
                                stillMissing=[rid for rid in sorted(former_entry_losses) if current_map[rid]['after']['state']!='accepted' or current_map[rid]['after']['retained_native_entrance'] is None]),
        commonDomesticMixedQuality={p:quality([r for r in common if r['function'] in ['domestic','mixed']],p) for p in ['before','after']},
        sourceQuality={p:{recipe:quality([r for r in rows if r['function'] in ['domestic','mixed'] and r[p]['state']=='accepted' and r[p]['recipe']==recipe],p) for recipe in ['AS-ISL-B06','AS-ISL-B14','AS-ISL-B15']} for p in ['before','after']},
        nominalPhaseTraces=len(phase_traces),finalAdditionalEntryChecks=len(selection_traces),
        nominalPortalFallbacks=sum(r['nominalPortalFallback'] for r in selection_traces),
        witnesses=[dict(index=r['index'],id=r['id'],baselineAreaM2=current_map[r['id']]['before']['body_area_m2'],
                        experimentalAreaM2=r['before']['body_area_m2'],nominalFirstAreaM2=r['after']['body_area_m2'],
                        baselineEntry=current_map[r['id']]['before']['retained_native_entrance'] is not None,
                        nominalFirstEntry=r['after']['retained_native_entrance'] is not None,
                        targetM2=r['target_m2']) for r in rows if r['index'] in [6495,6577,1409]],
        limits=['Same complete C7921 source, separately regenerated cumulative occupation; this is a scalar/trace comparison, not a second geometry audit.',
                'No interiors, native rerun, population inference or timing benchmark. Phase counts are parsed diagnostics and bounded jointly with final ordinary budget.'])
    save(current/'independent-audit/comparison-to-525e.json',report)
    save(current/'independent-audit/nominal-phase-traces.json',phase_traces)
    save(current/'independent-audit/nominal-selection-traces.json',selection_traces)
    print({k:(len(v) if isinstance(v,list) else v) for k,v in report.items() if k not in ['sourceQuality','commonDomesticMixedQuality','limits','former36EntryLosses']})


if __name__=='__main__':main()
