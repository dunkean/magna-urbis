"""Fixture for wall_probe: map culture population x y out.json [layoutConfig JSON overrides]. Reads web/decors only."""
import gzip, json, pathlib, struct, sys
root = next(p for p in pathlib.Path(__file__).resolve().parents if (p/'TODO.md').exists())
m, culture, pop, x, y, out = sys.argv[1:7]
over = json.loads(sys.argv[7]) if len(sys.argv) > 7 else {}
raw = gzip.decompress((root/f'web/decors/{m}.decor').read_bytes())
k = struct.unpack_from('<I', raw, 8)[0]; h = json.loads(raw[12:12+k]); n = h['n']; size = n*n; off = 12+k
b = raw[off:off+4*size]; data = bytearray(4*size)
for i in range(4): data[i::4] = b[i*size:(i+1)*size]
height = list(struct.unpack('<'+str(size)+'f', data)); water = list(raw[off+4*size:off+5*size])
cfg = h['meta']['pipeline']['urban']['layoutConfig']; cfg['culture'] = culture; cfg['siteArchetype'] = over.pop('siteArchetype', 'bridge')
radius = float(over.pop('radius', 735)); fp = over.pop('footprint', None)
if fp: cfg.setdefault('footprint', {}).update(fp)
cfg.update(over)
site = dict(key='city', name=culture, population=int(pop), culture=culture, center=dict(x=float(x), y=float(y)), radius=radius)
roads = [dict(path=s['path'], widths=[s['width']]*len(s['path']), rank=1, role='regional') for s in (h['meta'].get('roads') or {}).get('segments', [])]
fixture = dict(seed=h['meta']['seed'], n=n, width=h['width'], height=height, water=water, geometry=h.get('geometry'), sites=[site], roads=roads, layoutConfig=cfg)
pathlib.Path(out).write_text(json.dumps(fixture, separators=(',', ':')), encoding='utf-8')
print(m, culture, pop, (x, y), 'footprint' in cfg and cfg['footprint'])
