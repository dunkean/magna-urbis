"""Copy three exact JSON-token witnesses and their prior in-batch occupations."""
from pathlib import Path
import json
from java_combined_capacity_audit import BASELINE, load, save, sha

ROOT=Path(__file__).resolve().parents[2]
AFTER=ROOT/'web/out/java-c-b06-v2-terrain-v3-proof'
OUT=AFTER/'regression-witnesses'
DEC=json.JSONDecoder()


def fields(text):
    cursor=1;out={}
    while True:
        while text[cursor].isspace() or text[cursor]==',':cursor+=1
        if text[cursor]=='}':return out
        name,cursor=DEC.raw_decode(text,cursor)
        while text[cursor].isspace() or text[cursor]==':':cursor+=1
        _,end=DEC.raw_decode(text,cursor);out[name]=text[cursor:end];cursor=end


def records(text):
    cursor=1;out=[]
    while True:
        while text[cursor].isspace() or text[cursor]==',':cursor+=1
        if text[cursor]==']':return out
        value,end=DEC.raw_decode(text,cursor);out.append((value,text[cursor:end]));cursor=end


def raw_save(path,text):
    with path.open('xb') as stream:stream.write((text+'\n').encode('utf8'))


OUT.mkdir()
sites={r['index']:r for r in load(AFTER/'independent-audit/sites.json')}
contexts={r['index']:r for r in load(AFTER/'independent-audit/native-occupation-context.json')['recordsDetail']}
manifest=[]
for index,label in [(6495,'6495-budget'),(6577,'6577-b14-entry'),(1409,'1409-b15-entry')]:
    row=sites[index];context=contexts[index]
    assert context['priorNativeBBoxCandidatesExactlyEqual'] and context['enrichedNeighborsExactlyEqual']
    folder=OUT/label;folder.mkdir();stem=f"{row['batch']:03d}"
    meta=dict(index=index,batch=row['batch'],position=index-row['batch']*64,id=row['id'],
              targetM2=row['target_m2'],beforeAreaM2=row['before']['body_area_m2'],
              afterAreaM2=row['after']['body_area_m2'],nativeLocalContextExactlyUnchanged=True,phases={})
    for phase,root in [('before',BASELINE),('after',AFTER)]:
        rp=root/'after'/f'{stem}-request.json';bp=root/'after'/f'{stem}-plans.json'
        payload=fields(rp.read_text(encoding='utf8'))
        plan=fields(bp.read_text(encoding='utf8'))
        requests=records(payload['requests'])
        buildings={v['id']:(v,raw) for v,raw in records(plan['buildings'])}
        prior=[]
        for request,raw in requests:
            if request['id']==row['id']:
                raw_save(folder/f'{phase}-request.json',raw)
                raw_save(folder/f'{phase}-plan.json',buildings[request['id']][1])
                break
            if request['id'] in buildings:
                _,building_raw=buildings[request['id']]
                f=fields(building_raw)
                parts=[f[k] for k in ['footprint','courtyards','circulation']]
                parts += [fields(feature_raw)['surface'] for _,feature_raw in records(f['structural_features'])]
                prior.append('{"id":'+f['id']+',"parts":['+','.join(parts)+']}')
        else:raise AssertionError('Missing witness')
        raw_save(folder/f'{phase}-prior-occupation.json','['+','.join(prior)+']')
        raw_save(folder/f'{phase}-header.json','{'+','.join(json.dumps(k)+':'+v for k,v in payload.items() if k!='requests')+'}')
        meta['phases'][phase]=dict(requestBatchPath=str(rp.relative_to(ROOT)),requestBatchSha256=sha(rp),
                                  planBatchPath=str(bp.relative_to(ROOT)),planBatchSha256=sha(bp),
                                  priorAccepted=len(prior),files={p.name:sha(p) for p in folder.glob(f'{phase}-*.json')})
    meta['scope']='Raw request, plan and surface tokens copied verbatim; all earlier admitted occupations retained in original order. No native execution. Rebuild native OccupationIndex from prior parts; the singleton request alone omits that context.'
    save(folder/'manifest.json',meta);manifest.append(meta)
save(OUT/'manifest.json',dict(version='combined-regression-witnesses-1',scriptSha256=sha(Path(__file__)),cases=manifest))
print(json.dumps([dict(index=r['index'],id=r['id'],before=r['beforeAreaM2'],after=r['afterAreaM2'],prior={p:v['priorAccepted'] for p,v in r['phases'].items()}) for r in manifest],indent=2))
