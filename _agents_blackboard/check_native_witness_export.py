"""Bounded offline check of the two explicitly requested native descriptors."""
import hashlib
import json
import math
from pathlib import Path

root = Path(__file__).resolve().parent.parent
path = root / 'web/out/native-admission-witness-proof/descriptors.json'
data = json.loads(path.read_text(encoding='utf-8-sig'))
assert data['version'] == 'native-admission-witness-descriptors-1'
assert data['requested_styles'] == ['AS-ISL-B14::default', 'EUR-MED-B07::flat_stone']
assert not data['refusals'] and len(data['witnesses']) == 2
source_hash = hashlib.sha256((root / 'rust/crates/houses/data/recipes.json').read_bytes()).hexdigest()
assert data['source_sha256'] == source_hash

def check_keys(value):
    if isinstance(value, dict):
        assert not ({'resolved', 'structural_unit', 'packed', 'site_features'} & value.keys())
        for v in value.values(): check_keys(v)
    elif isinstance(value, list):
        for v in value: check_keys(v)
    elif isinstance(value, float):
        assert math.isfinite(value)

def ring_area(ring):
    return abs(math.fsum(a['x']*b['y']-a['y']*b['x'] for a,b in zip(ring,ring[1:]+ring[:1]))) / 2

def area(surface):
    return math.fsum(ring_area(p['outer'])-math.fsum(ring_area(h) for h in p['holes']) for p in surface)

check_keys(data)
report = {'file': str(path.relative_to(root)), 'bytes': path.stat().st_size,
          'source_sha256': source_hash, 'heavy_fields_absent': True, 'witnesses': []}
for w in data['witnesses']:
    assert w['identity']['source_sha256'] == source_hash
    assert w['identity']['version'] == data['witness_version']
    assert w['capacity'] is None and w['placement_certified'] is False
    assert abs(area(w['body_footprint'])-w['actual_body_footprint_area_m2']) < 1e-7
    floors = math.fsum(area(l['footprint']) for b in w['geometry']['bodies'] for l in b['levels'])
    assert abs(floors-w['actual_structural_floor_area_m2']) < 1e-7
    points = [p for s in w['geometry']['domains'] + w['site_entry']['passage'] for p in s['outer']]
    bounds = [min(p['x'] for p in points),min(p['y'] for p in points),max(p['x'] for p in points),max(p['y'] for p in points)]
    assert all(abs(a-b) < 1e-10 for a,b in zip(bounds,w['site_bounds_m']))
    counts = [len(b['levels']) for b in w['geometry']['bodies']]
    assert w['actual_primary_floors'] == 1
    assert counts == ([1] if w['identity']['recipe_id'] == 'AS-ISL-B14' else [1,3])
    report['witnesses'].append({
        'style_id': w['identity']['style_id'], 'bodies': len(counts), 'actual_levels': counts,
        'actual_primary_floors':w['actual_primary_floors'],
        'body_footprint_area_m2':w['actual_body_footprint_area_m2'],
        'structural_floor_area_m2':w['actual_structural_floor_area_m2'],
        'site_bounds_m':w['site_bounds_m'], 'site_entry_opening':w['site_entry']['opening'],
        'site_entry_width_m':w['site_entry']['width_m'],
        'roof_surfaces':len(w['geometry']['roof_projection']),
        'structural_features':len(w['geometry']['supports_and_features']),
    })
(path.parent/'report.json').write_text(json.dumps(report,indent=2)+'\n',encoding='utf-8')
print(json.dumps(report))
