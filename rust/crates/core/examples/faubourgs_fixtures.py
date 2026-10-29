"""Extract the reviewed 10k sites for offline replay; no running service."""
import gzip, json, pathlib, struct
root = pathlib.Path(__file__).resolve().parents[4]
out = root / 'web/out/fix-v7/faubourgs/fixtures'
out.mkdir(parents=True, exist_ok=True)
for series, style in [('ville-10k-riviere', 'european-organic'), ('ville-10k-riviere', 'hanseatic'), ('ville-10k', 'bastide')]:
    r = next(r for r in json.loads((root/f'web/out/planches-styles-v7/{series}/report.json').read_text(encoding='utf8')) if r['style'] == style)
    raw = gzip.decompress((root/f"web/decors/{r['map']}.decor").read_bytes())
    k = struct.unpack_from('<I', raw, 8)[0]; h = json.loads(raw[12:12+k]); n = h['n']; size = n*n; off = 12+k
    def floats(offset):
        b = raw[offset:offset+4*size]; data = bytearray(4*size)
        for i in range(4): data[i::4] = b[i*size:(i+1)*size]
        return list(struct.unpack('<'+str(size)+'f', data))
    cfg = h['meta']['pipeline']['urban']['layoutConfig']; cfg['siteArchetype'] = r['site']['siteType']; cfg['culture'] = style
    cfg.pop('gateVillages', None); cfg.pop('gateVillage', None)
    site = dict(key='city', name=style, population=10000, culture=style, center=dict(x=float(r['site']['x']), y=float(r['site']['y'])), radius=r.get('radius') or 735)
    roads = [dict(path=s['path'], widths=[s['width']]*len(s['path']), rank=1, role='regional') for s in (h['meta'].get('roads') or {}).get('segments', [])]
    fixture = dict(seed=h['meta']['seed'], n=n, width=h['width'], height=floats(off), water=list(raw[off+4*size:off+5*size]), waterLevel=floats(off+5*size), geometry=h.get('geometry'), sites=[site], roads=roads, layoutConfig=cfg)
    (out/f'{style}.json').write_text(json.dumps(fixture, separators=(',', ':')), encoding='utf8')
    print(style, r['map'], site['center'])
