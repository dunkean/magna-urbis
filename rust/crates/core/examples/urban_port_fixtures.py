import gzip, json, struct, pathlib
root = next(p for p in pathlib.Path(__file__).resolve().parents if (p/'TODO.md').exists())
out = root / 'web/out/port5/fixtures'
out.mkdir(parents=True, exist_ok=True)
cases = []
for series, styles in [('ville-10k', ['hanseatic','swahili-stone-town','venetian-lagoon']), ('ville-10k-riviere',['hanseatic'])]:
    for r in json.loads((root/f'web/out/planches-styles-v7/{series}/report.json').read_text(encoding='utf8')):
        if r['style'] in styles:
            cases.append((r['style'] + ('-river' if 'riviere' in series else ''),r,10000))
cases.append(('hanseatic-500',next(c[1] for c in cases if c[0]=='hanseatic'),500))
arid=next(r for r in json.loads((root/'web/out/planches-styles-v7/ville-10k/report.json').read_text(encoding='utf8')) if r['map']=='city-07-arid-shore-s' and r.get('site'))
cases.append(('swahili-arid',dict(arid,style='swahili-stone-town'),10000))
for name,r,pop in cases:
    raw=gzip.decompress((root/f"web/decors/{r['map']}.decor").read_bytes())
    k=struct.unpack_from('<I',raw,8)[0]; h=json.loads(raw[12:12+k]); n=h['n']; size=n*n; off=12+k
    def floats(off):
        b=raw[off:off+4*size]; data=bytearray(4*size)
        for i in range(4): data[i::4]=b[i*size:(i+1)*size]
        return list(struct.unpack('<'+str(size)+'f',data))
    height=floats(off); water=list(raw[off+4*size:off+5*size]); levels=floats(off+5*size)
    cfg=h['meta']['pipeline']['urban']['layoutConfig']; cfg['siteArchetype']=r['site']['siteType']; cfg['culture']=r['style']
    site={'key':'city','name':name,'population':pop,'culture':r['style'],'center':{'x':float(r['site']['x']),'y':float(r['site']['y'])},'radius':(r.get('radius') or 735)*(pop/10000)**0.5}
    roads=[{'path':s['path'],'widths':[s['width']]*len(s['path']),'rank':1,'role':'regional'} for s in (h['meta'].get('roads') or {}).get('segments',[])]
    fixture=dict(seed=h['meta']['seed'],n=n,width=h['width'],height=height,water=water,waterLevel=levels,geometry=h.get('geometry'),sites=[site],roads=roads,layoutConfig=cfg)
    (out/f'{name}.json').write_text(json.dumps(fixture,separators=(',',':')),encoding='utf8')
    print(name,r['map'],site['center'])
