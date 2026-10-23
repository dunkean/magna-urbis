"""Explain retained-area pose changes from frozen artifacts, no native calls."""
import json
from pathlib import Path
from b06_light_physical_audit import occupation
from native_foundation_compare import float_bits,surface

PRIOR=Path('web/out/portal-lintel-production-proof/java-full')
AFTER=Path('web/out/b06-light-v2-native-proof/java-full')
OUT=AFTER/'independent-audit'
load=lambda p:json.loads(p.read_bytes())
reports=[]
for index in [529,1412]:
    chunk,position=divmod(index,64)
    phases=[]
    for folder in [PRIOR,AFTER]:
        requests=load(folder/f'after/{chunk:03d}-request.json')['requests']
        plans=load(folder/f'after/{chunk:03d}-plans.json')
        request=requests[position];by_id={b['id']:b for b in plans['buildings']}
        b=by_id[request['id']];compact=float_bits(b['resolved'])
        cadastral=surface(request['cadastral']);prior=[]
        for earlier in requests[:position]:
            if earlier['id'] not in by_id:continue
            x=by_id[earlier['id']];used=occupation(x)
            if used.envelope.intersects(cadastral.envelope):
                prior.append(dict(id=x['id'],occupation=used.wkb_hex))
        phases.append(dict(id=b['id'],recipe=b['recipe_id'],variant=b['variant_id'],
            transform=b['transform'],entrance=b['entrance'],retainedEntry=compact['entrance'],
            footprint=b['footprint'],roof=b['roof_footprint'],
            localBodyFootprints=[compact['surfaces'][body['footprint']] for body in compact['bodies']],
            diagnostics=b['diagnostics'],neighbors=request['neighbors'],prior=prior))
    reports.append(dict(index=index,id=phases[0]['id'],before=phases[0],after=phases[1],
        localBodiesIdentical=phases[0]['localBodyFootprints']==phases[1]['localBodyFootprints'],
        neighborsIdentical=phases[0]['neighbors']==phases[1]['neighbors'],
        priorLocalIdentical=phases[0]['prior']==phases[1]['prior']))
with (OUT/'remaining-pose-changes.json').open('x',encoding='utf8') as f:
    json.dump(reports,f,indent=2,ensure_ascii=False,allow_nan=False);f.write('\n')
for r in reports:
    summary={k:r[k] for k in ['index','id','localBodiesIdentical','neighborsIdentical','priorLocalIdentical']}
    for phase in ['before','after']:
        p=r[phase]
        summary[phase]=dict(recipe=p['recipe'],transform=p['transform'],entry=p['retainedEntry'] is not None,
            localBounds=[surface(s).bounds for s in p['localBodyFootprints']],
            diagnostics=[s for s in p['diagnostics'] if s.startswith(('Adapted domestic','Native planning entrance','Domestic footprint budget'))])
    print(json.dumps(summary,ensure_ascii=False,indent=2))
