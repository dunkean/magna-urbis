"""Exact source-only Roman04 A/B and full-batch admission gate (no server)."""
from pathlib import Path
import json,sys,hashlib
out=Path(sys.argv[1]);read=lambda p:json.loads(p.read_text(encoding='utf-8'))
after=sys.argv[3] if len(sys.argv)>3 else 'after'
a,b=[{k:read(out/side/(k+'.json')) for k in ['input-identity','generated-identity','layouts','partitions','requests','metrics','native-port-facts']} for side in ['before',after]]
issues=[]
def check(ok,message):
 if not ok:issues.append(message)
for x in [a,b]:check(x['input-identity']['matchesReplayContract'] and x['generated-identity']['matchesAppliedInput'],'input/output identity')
for f in ['dispatchCenterBits','actualLayoutConfig','actualParcelConfig','actualSeed','width','n']:
 check(a['input-identity'].get(f)==b['input-identity'].get(f),'input drift: '+f)
for f in ['key','culture','center','quarters','streets','config']:
 check(a['layouts'][0].get(f)==b['layouts'][0].get(f),'layout drift: '+f)
pa,pb=[x['partitions'][0]['programme'] for x in [a,b]]
contract=['role','function','requested','sites','site','unit','targetArea','targetFrontage','requires','landmark','placement']
da,db=[{d['id']:d for d in p['demands'] if d['role']!='open.garden'} for p in [pa,pb]]
check(da.keys()==db.keys(),'demand IDs changed')
for key in da:
 check(all(da[key].get(f)==db[key].get(f) for f in contract),'demand changed: '+key)
ha,hb=[next(d for d in p['demands'] if d['role']=='storage.horreum') for p in [pa,pb]]
check(any('source_absente' in s for s in ha['reasons']),'baseline must expose missing source')
check(ha['deficit']==ha['requested'] and ha['builtCapacity']==ha.get('openCapacity',0)==0,'baseline missing demand was credited')
check(not any('source_absente' in s for s in hb['reasons']),'source not recognized')
ra,rb=[{r['demandId']:r for r in x['layouts'][0]['programme']['reservations']} for x in [a,b]]
changed=[k for k in ra.keys()|rb.keys() if ra.get(k)!=rb.get(k)]
check(all(k==hb['id'] for k in changed),'other reservations moved: '+repr(changed))
check(hb['id'] in rb,'no horreum reservation')
new_blocks={rb[hb['id']]['block']} if hb['id'] in rb else set()
for i,(x,y) in enumerate(zip(a['layouts'][0]['blocks'],b['layouts'][0]['blocks'])):
 check(x==y or (i in new_blocks and {k:v for k,v in x.items() if k!='kind'}=={k:v for k,v in y.items() if k!='kind'}),'unexplained block change '+str(i))
requests=[r for r in b['requests'] if r['programme']['role']=='storage.horreum']
check(len(requests)==1,'horreum request count')
if requests:
 r=requests[0];check(r['function']=='warehouse' and r['config']['recipe']=='MED-ANT-H01' and not r['programme'].get('deficit'),'horreum is not a native warehouse request')
 check(bool(r['accesses']),'no public access')
if new_blocks:
 facts=b['native-port-facts'][0]['blocks'];fact=next(f for f in facts if f['block'] in new_blocks)
 check(fact['nativeQuayEligible'],'horreum block has no actual quay frontage')
else:fact=None
report={'issues':issues,'beforeDirectory':'before','afterDirectory':after,'before':a['metrics'],'after':b['metrics'],'horreumDemandBefore':ha,'horreumDemandAfter':hb,
 'changedReservations':changed,'horreumQuayFacts':fact,'requestIds':[r['id'] for r in requests],
 'sourceOnlyFrozenBaseline':True,'housesPassed':False}
if len(sys.argv)>2:
 house=Path(sys.argv[2]);completion=read(house/'completion.json');targets=read(house/'target-results.json')
 check(completion['status']=='complete','incomplete Houses pass')
 target=[t for t in targets if t['id'] in report['requestIds']]
 check(len(target)==1 and target[0]['kind']=='building','horreum not admitted as a building')
 if target and target[0]['kind']=='building':
  building=target[0]['result'];check(building['recipe_id']=='MED-ANT-H01' and len(building['volumes'])==3 and bool(building['access_id']),'wrong retained building/access')
  report['horreumBuilding']={k:building[k] for k in ['id','recipe_id','function','access_id','entrance','useful_area_m2','domestic_units']}
 report['housesCompletion']=completion;report['housesPassed']=not issues
 baseline=out/'houses-before-final'
 if baseline.exists():
  def outcomes(folder):
   done=read(folder/'completion.json');check(done['status']=='complete' and done['chunks']==done['nativeAttempts'],'partial/retried native batches')
   result={}
   for i in range(done['chunks']):
    batch=read(folder/f'attempt-{i:02}-output.json')
    for kind in ['buildings','refusals','open_spaces']:
     for item in batch[kind]:result[item['id']]=(kind,item)
   return result
  old,new=outcomes(baseline),outcomes(house)
  added_refusals=[key for key,(kind,_) in new.items() if kind=='refusals' and (key not in old or old[key][0]!='refusals')]
  check(not added_refusals,'new native refusal IDs: '+repr(added_refusals))
  changed_kinds=[{'id':key,'before':old[key][0],'after':new[key][0]} for key in old.keys()&new.keys() if old[key][0]!=new[key][0]]
  report['fullBatchComparison']={'commonOutcomes':len(old.keys()&new.keys()),'changedKinds':changed_kinds,
   'removedOutcomeIds':sorted(old.keys()-new.keys()),'addedOutcomeIds':sorted(new.keys()-old.keys()),'newRefusalIds':added_refusals}
  report['housesPassed']=not issues
report['issues']=issues
(out/('verification-final.json' if after!='after' else 'verification.json')).write_text(json.dumps(report,indent=2),encoding='utf-8')
print(json.dumps({'issues':issues,'housesPassed':report['housesPassed'],'changedReservations':changed}))
assert not issues,issues
