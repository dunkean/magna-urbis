"""Re-export the existing explicit native pose IDs; refuse geometry drift."""
from pathlib import Path
import json, subprocess, sys, math
root=Path(__file__).resolve().parents[1]
binary=Path(sys.argv[1]).resolve();out=Path(sys.argv[2]);out.mkdir(exist_ok=False,parents=True)
p=root/'rust/crates/core/src/urban/native_witnesses.json'
source_text=p.read_text(encoding='utf-8');old=json.loads(source_text);rows=[]
for offset in range(0,len(old['witnesses']),16):
 selected=old['witnesses'][offset:offset+16];dest=out/f'descriptors-{offset:03}.json'
 args=[str(binary)]
 for r in selected:args+=['--style',r['identity']['style_id']]
 subprocess.run(args+['--out',str(dest.resolve())],check=True)
 data=json.loads(dest.read_text(encoding='utf-8'));assert not data['refusals']
 for a,w in zip(selected,data['witnesses']):
  body=w['geometry']['bodies'][0]['footprint'];points=[q for poly in body for q in poly['outer']]
  opening=w['site_entry']['opening']
  b=dict(identity=w['identity'],body=[min(q['x'] for q in points),min(q['y'] for q in points),max(q['x'] for q in points),max(q['y'] for q in points)],
   bounds=w['site_bounds_m'],entry=[sum(q['x'] for q in opening)/2,sum(q['y'] for q in opening)/2],
   access_width_m=w['site_entry']['width_m'],body_area_m2=w['actual_body_footprint_area_m2'],primary_floors=w['actual_primary_floors'])
  def equal(x,y):
   if isinstance(x,dict):return x.keys()==y.keys() and all(equal(x[k],y[k]) for k in x)
   if isinstance(x,list):return len(x)==len(y) and all(equal(i,j) for i,j in zip(x,y))
   if isinstance(x,(float,int)) and isinstance(y,(float,int)):return abs(x-y)<1e-8
   return x==y
  aa=json.loads(json.dumps(a));aa['identity']['source_sha256']=data['source_sha256']
  assert equal(aa,b),(a['identity']['style_id'],a,b)
  # Retain exact old numeric spellings after proving unchanged native geometry.
  rows.append(aa)
new={**old,'source_sha256':data['source_sha256'],'witnesses':rows}
(out/'native_witnesses.json').write_text(json.dumps(new,indent=2)+'\n',encoding='utf-8')
p.write_text(source_text.replace(old['source_sha256'],data['source_sha256']),encoding='utf-8',newline='\n')
(out/'verification.json').write_text(json.dumps({'checked':len(rows),'geometryDrifts':0,'source_sha256':data['source_sha256']},indent=2))
