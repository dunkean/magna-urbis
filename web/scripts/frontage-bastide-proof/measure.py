"""Measure exact native output; every camera/input remains frozen between phases."""
import json, math, sys
from pathlib import Path
from shapely.geometry import Polygon, LineString
from shapely.ops import unary_union
root, phase = Path(sys.argv[1]), sys.argv[2]
load = lambda p: json.loads(p.read_text(encoding='utf-8'))
surface = lambda s: unary_union([Polygon([(p['x'], p['y']) for p in q['outer']], [[(p['x'], p['y']) for p in h] for h in q['holes']]) for q in s])
requests = load(root/'requests.json')['requests']; plans = load(root/phase/'plans.json')
buildings = {b['id']:b for b in plans['buildings']}; refusals = {b['id']:b for b in plans['refusals']}
sites=[]
for r in requests:
    b=buildings.get(r['id']); out={'id':r['id'],'status':'accepted' if b else 'refused','programme':r.get('programme')}
    if b:
        body,roof,court,lot,buildable,reserves=map(surface,[b['footprint'],b['roof_footprint'],b['courtyards'],r['cadastral'],r['buildable'],r['reserves']])
        selected=next((a for a in r['accesses'] if a['id']==b['access_id']),None)
        access=LineString([(p['x'],p['y']) for p in selected['segment']]) if selected else None
        turns=[]; lengths=[]
        for shape in b['footprint']:
            for ring in [shape['outer'],*shape['holes']]:
                points=[(p['x'],p['y']) for p in ring]
                if points[0]==points[-1]:points.pop()
                for i,p in enumerate(points):
                    a,c=points[i-1],points[(i+1)%len(points)];u=(a[0]-p[0],a[1]-p[1]);v=(c[0]-p[0],c[1]-p[1]);den=math.hypot(*u)*math.hypot(*v)
                    if den<1e-8:continue
                    lengths.append(math.hypot(*v))
                    angle=math.degrees(math.acos(max(-1,min(1,(u[0]*v[0]+u[1]*v[1])/den))))
                    turns.append(min(abs(angle-90),abs(angle-180)))
        out.update(recipe=b['recipe_id'],variant=b['variant_id'],accessId=b['access_id'],bodySetbackM=body.distance(access) if access else None,roofSetbackM=roof.distance(access) if access else None,bodyAreaM2=body.area,roofAreaM2=roof.area,courtAreaM2=court.area,courtComponents=len(b['courtyards']),courtRoofOverlapM2=court.intersection(roof).area,bodyOutsideBuildableM2=body.difference(buildable).area,roofOutsideRightsM2=roof.difference(surface(r.get('roof_domain',r['cadastral']))).area,reserveOverlapM2=body.union(roof).intersection(reserves).area,maxRightAngleErrorDeg=max(turns,default=0),nonRightAngleVertices=sum(t>.1 for t in turns),diagnostics=b.get('diagnostics',[]))
        out.update(uncoveredCourtAreaM2=court.difference(roof).area,minBodyEdgeM=min(lengths,default=0))
    else:out['refusal']=refusals.get(r['id'])
    sites.append(out)
report={'phase':phase,'counts':{'sites':len(requests),'accepted':len(buildings),'refusals':len(refusals),'openSpaces':len(plans['open_spaces'])},'sites':sites}
before_path=root/'before'/'metrics.json'
if phase!='before' and before_path.exists():
    before={b['id']:b for b in load(before_path)['sites']}
    report['comparison']=[{'id':b['id'],'beforeStatus':before[b['id']]['status'],'afterStatus':b['status'],'bodySetbackDeltaM':b['bodySetbackM']-before[b['id']]['bodySetbackM'],'bodyAreaDeltaM2':b['bodyAreaM2']-before[b['id']]['bodyAreaM2'],'courtAreaDeltaM2':b['courtAreaM2']-before[b['id']]['courtAreaM2'],'sameRecipeVariant':(b['recipe'],b['variant'])==(before[b['id']]['recipe'],before[b['id']]['variant'])} for b in sites if b['status']=='accepted' and before[b['id']]['status']=='accepted']
(root/phase/'metrics.json').write_text(json.dumps(report,indent=2),encoding='utf-8')
print(json.dumps(report['counts']))
