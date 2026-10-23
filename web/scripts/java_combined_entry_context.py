"""Exact prior-occupation broadphase evidence for entry/target regressions."""
from pathlib import Path
import argparse
from collections import Counter, defaultdict
from java_combined_capacity_audit import BASELINE, load, save, digest, sha, occupation, surface


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('after',type=Path)
    after=parser.parse_args().after.resolve()
    out=after/'independent-audit'
    findings=load(out/'findings.json')
    transitions=load(out/'entry-transitions.json')
    rows={r['id']:r for r in load(out/'sites.json')}
    selected={r['id'] for r in transitions if r['direction']=='lost'}
    selected.update(r['id'] for r in findings['largestRegressions'][:4])
    groups=defaultdict(list)
    for rid in selected:groups[rows[rid]['batch']].append(rid)
    evidence=[]
    for batch,ids in sorted(groups.items()):
        stem=f'{batch:03d}'
        roots={'before':BASELINE,'after':after}
        payloads={p:load(root/'after'/f'{stem}-request.json') for p,root in roots.items()}
        results={p:load(root/'after'/f'{stem}-plans.json') for p,root in roots.items()}
        records={}
        for p in roots:
            buildings={r['id']:r for r in results[p]['buildings']}
            prior=[]
            records[p]={}
            for request in payloads[p]['requests']:
                rid=request['id']
                if rid in ids:
                    b=surface(request['cadastral']).bounds
                    candidates=[item for item in prior if item['bounds'][0]<=b[2] and item['bounds'][2]>=b[0]
                                and item['bounds'][1]<=b[3] and item['bounds'][3]>=b[1]]
                    records[p][rid]=dict(candidates=[{k:v for k,v in item.items() if k!='geometry'} for item in candidates],
                                        plan=buildings[rid],neighbors=request['neighbors'])
                if rid in buildings:
                    plan=buildings[rid]
                    geometry=occupation(plan)
                    parts=[plan[k] for k in ['footprint','courtyards','circulation']]+[f['surface'] for f in plan['structural_features']]
                    prior.append(dict(id=rid,bounds=geometry.bounds,partsSha256=digest(parts),geometry=geometry))
        for rid in ids:
            row=rows[rid]
            a,b=records['before'][rid],records['after'][rid]
            evidence.append(dict(index=row['index'],id=rid,batch=batch,
                category='lost-retained-entry' if rid in {r['id'] for r in transitions if r['direction']=='lost'} else 'large-area-regression',
                source=row['after']['recipe'],targetM2=row['target_m2'],beforeAreaM2=row['before']['body_area_m2'],afterAreaM2=row['after']['body_area_m2'],
                priorNativeBBoxCandidatesExactlyEqual=a['candidates']==b['candidates'],
                enrichedNeighborsExactlyEqual=a['neighbors']==b['neighbors'],
                beforePriorCandidates=a['candidates'],afterPriorCandidates=b['candidates'],
                beforeDiagnostics=a['plan']['diagnostics'],afterDiagnostics=b['plan']['diagnostics'],
                beforeRequestPath=str(roots['before']/'after'/f'{stem}-request.json'),
                afterRequestPath=str(roots['after']/'after'/f'{stem}-request.json'),
                pathsSha256={p:dict(request=sha(root/'after'/f'{stem}-request.json'),plans=sha(root/'after'/f'{stem}-plans.json')) for p,root in roots.items()}))
    summary=dict(version='native-prior-occupation-bbox-context-1',
        source='placement.rs OccupationIndex::local: inclusive bbox intersection, input-order surfaces; no GEOS union is claimed bit-identical to native.',
        records=len(evidence),categories=dict(Counter(r['category'] for r in evidence)),
        changedLocalCandidateRecords=[r['id'] for r in evidence if not r['priorNativeBBoxCandidatesExactlyEqual']],
        changedEnrichedNeighborRecords=[r['id'] for r in evidence if not r['enrichedNeighborsExactlyEqual']],
        scriptSha256=sha(Path(__file__)),recordsDetail=evidence)
    save(out/'native-occupation-context.json',summary)
    print({k:v for k,v in summary.items() if k!='recordsDetail'})


if __name__=='__main__':main()
