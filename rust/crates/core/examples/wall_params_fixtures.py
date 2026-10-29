"""Extract the reviewed decor/site pairs; never uses the running engine."""
import gzip, json, pathlib, struct
root = next(p for p in pathlib.Path(__file__).resolve().parents if (p/'TODO.md').exists())
out = root/'web/out/fix-v7/wall-params/fixtures'
out.mkdir(parents=True, exist_ok=True)
for series, culture in [('ville-10k','hanseatic'), ('ville-10k-riviere','european-organic'), ('ville-10k-riviere','al-andalus'), ('ville-10k','caucasian-highland')]:
    r = next(x for x in json.loads((root/f'web/out/planches-styles-v7/{series}/report.json').read_text(encoding='utf-8')) if x['style']==culture)
    raw = gzip.decompress((root/f"web/decors/{r['map']}.decor").read_bytes())
    k = struct.unpack_from('<I',raw,8)[0]; h=json.loads(raw[12:12+k]); n=h['n']; size=n*n; off=12+k
    b=raw[off:off+4*size]; data=bytearray(4*size)
    for i in range(4): data[i::4]=b[i*size:(i+1)*size]
    height=list(struct.unpack('<'+str(size)+'f',data)); water=list(raw[off+4*size:off+5*size])
    cfg=h['meta']['pipeline']['urban']['layoutConfig']; cfg['siteArchetype']=r['site']['siteType']; cfg['culture']=culture
    cfg.update(fortification='wall',wallStiffness=None,wallTerrain=None,wallTowerSpacing=None,ditchWetness=None,riverControlMode='',portEnclosure='')
    site=dict(key='city',name=culture,population=10000,culture=culture,center=dict(x=float(r['site']['x']),y=float(r['site']['y'])),radius=r.get('radius') or 735)
    if culture=='caucasian-highland':cfg['siteArchetype']='hilltop'
    roads=[dict(path=s['path'],widths=[s['width']]*len(s['path']),rank=1,role='regional') for s in (h['meta'].get('roads') or {}).get('segments',[])]
    fixture=dict(seed=h['meta']['seed'],n=n,width=h['width'],height=height,water=water,geometry=h.get('geometry'),sites=[site],roads=roads,layoutConfig=cfg)
    (out/f'{culture}.json').write_text(json.dumps(fixture,separators=(',',':')),encoding='utf-8')
    print(culture,r['map'],site['center'])
