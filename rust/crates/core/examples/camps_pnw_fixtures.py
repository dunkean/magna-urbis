"""Reproduce tribes/dump2.mjs inputs exactly, using the archived requests and decor.
No live service, new road, new water, changed seed or reconstructed site radius.
"""
import gzip, hashlib, json, math, pathlib, struct, sys

root = next(p for p in pathlib.Path(__file__).resolve().parents if (p / 'TODO.md').exists())
out = pathlib.Path(sys.argv[1]) if len(sys.argv) > 1 else root / '.tmp/camps-pnw/fixtures'
out.mkdir(parents=True, exist_ok=True)
manifest = []
cases = [
    ('P01', 'city-11-monsoon-plain-s', 'kraal', 300),
    ('P03', 'city-01-river-plain-s', 'native-plains', 300),
    ('P05', 'city-08-cold-peaks-s', 'inuit-camp', 80),
    ('P06', 'city-06-desert-valley-s', 'mongol-ordu', 1500),
    ('P07', 'city-12-rainforest-ridges-s', 'guarani-village', 400),
]
for name, decor, culture, population in cases:
    source = root / 'web/out' / ('city-bench/a2' if name == 'P03' else 'planches/req') / f'{decor}-quarters-request.json'
    request = json.loads(source.read_text(encoding='utf8'))
    for site in request['sites']:
        site['culture'] = culture
        site['radius'] *= math.sqrt(population / site['population'])
        site['population'] = population
    raw = gzip.decompress((root / f'web/decors/{decor}.decor').read_bytes())
    header_size = struct.unpack_from('<I', raw, 8)[0]
    header = json.loads(raw[12:12 + header_size])
    count = header['n'] ** 2
    offset = 12 + header_size
    def floats(start):
        data = bytearray(4 * count)
        for byte in range(4):
            data[byte::4] = raw[start + byte * count:start + (byte + 1) * count]
        return list(struct.unpack('<' + str(count) + 'f', data))
    request.update(n=header['n'], width=header['width'], height=floats(offset),
                   water=list(raw[offset + 4 * count:offset + 5 * count]),
                   waterLevel=floats(offset + 5 * count))
    # dump2 uploads this raster only; it does not send the decor's vector geography.
    (out / f'{name}.json').write_text(json.dumps(request, separators=(',', ':')), encoding='utf8')
    digest = lambda p: hashlib.sha256(p.read_bytes()).hexdigest()
    manifest.append(dict(case=name, request=str(source.relative_to(root)), requestSha256=digest(source),
                         decorSha256=digest(root / f'web/decors/{decor}.decor'),
                         replaySha256=digest(out / f'{name}.json'),
                         overrides=dict(culture=culture, population=population),
                         transformation='exact tribes/dump2.mjs culture/population/radius transform; original roads and raster samples'))
    print(name, request['seed'], request['sites'], len(request['roads']), flush=True)
(out / 'manifest.json').write_text(json.dumps(manifest, indent=2), encoding='utf8')
