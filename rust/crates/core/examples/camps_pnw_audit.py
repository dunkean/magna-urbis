"""Independent geometry audit and parcel diagnostic images of the exact camp replays."""
import json, pathlib
from PIL import Image, ImageDraw
from shapely.geometry import Polygon
from shapely.ops import unary_union

root = next(p for p in pathlib.Path(__file__).resolve().parents if (p / 'TODO.md').exists())
out = root / '.tmp/camps-pnw/current'
report = []
for folder in sorted(out.iterdir()):
    if not (folder / 'partitions.json').exists():
        continue
    layout = json.loads((folder / 'layouts.json').read_text(encoding='utf8'))[0]
    partition = json.loads((folder / 'partitions.json').read_text(encoding='utf8'))[0]
    requests = json.loads((folder / 'requests.json').read_text(encoding='utf8'))
    dwellings = sum(r.get('function') in ('domestic', 'mixed') for r in requests)
    def polygon(s):
        return Polygon([(p['x'], p['y']) for p in s['outer']], [[(p['x'], p['y']) for p in r] for r in s.get('holes', [])])
    parcels = [(p, polygon(p['shape'])) for p in partition['parcels']]
    invalid = [p['id'] for p, s in parcels if not s.is_valid]
    overlap = sum(a.intersection(b).area for i, (_, a) in enumerate(parcels) for _, b in parcels[:i] if a.is_valid and b.is_valid and a.intersects(b))
    outside = sum(s.difference(polygon(layout['blocks'][p['block']]['shape'])).area for p, s in parcels if s.is_valid)
    bounds = unary_union([s for _, s in parcels if s.is_valid]).bounds
    cx, cy = (bounds[0] + bounds[2]) / 2, (bounds[1] + bounds[3]) / 2
    scale = 920 / max(bounds[2] - bounds[0], bounds[3] - bounds[1])
    xy = lambda p: (500 + (p['x'] - cx) * scale, 500 + (p['y'] - cy) * scale)
    image = Image.new('RGB', (1000, 1000), '#f2ead7')
    draw = ImageDraw.Draw(image)
    for p, _ in parcels:
        color = {'plot': '#d8bf8d', 'compound': '#d8bf8d', 'place': '#e8d9b3', 'court': '#f7efd9'}.get(p['use'], '#c7ce9f')
        draw.polygon([xy(q) for q in p['shape']['outer']], fill=color, outline='#8a8066', width=1)
        for ring in p['shape'].get('holes', []):
            draw.polygon([xy(q) for q in ring], fill='#f2ead7', outline='#8a8066')
    for p, _ in parcels:
        if p.get('envelope') and p['use'] in ('plot', 'compound'):
            draw.polygon([xy(q) for q in p['envelope']['outer']], fill='#8a7958')
    for street in layout['streets']:
        draw.line([xy(q) for q in street['path']], fill='#ad5d39', width=max(2, round(street['widths'][0] * scale)))
    draw.text((20, 20), folder.name + ' - plots, admissible envelopes, paths, entrances', fill='#302d27')
    image.save(folder / 'diagnostic.png')
    report.append(dict(case=folder.name, invalid=invalid, overlapM2=overlap, outsideM2=outside,
                       parcels=len(parcels), dwellingCandidates=dwellings,
                       plots=sum(p['use'] in ('plot', 'compound') for p, _ in parcels)))
(out / 'independent-geometry.json').write_text(json.dumps(report, indent=2), encoding='utf8')
print(json.dumps(report, indent=2))
assert all(not r['invalid'] and r['overlapM2'] < .01 and r['outsideM2'] < .01 and r['dwellingCandidates'] > 0 for r in report)
