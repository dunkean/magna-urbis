"""Derived proposal only: split one frozen C lot into two private native sites.
No native execution, source mutation, capacity assertion or historical template.
"""
from copy import deepcopy
from hashlib import sha256
import json
from pathlib import Path
from shapely.geometry import box, LineString
from shapely.ops import unary_union
from native_foundation_compare import surface, terrain_bounds

ROOT = Path(__file__).resolve().parents[2]
PROOF = ROOT / 'web/out/java-c-nominal-first-roundoff-proof'
OUT = ROOT / 'web/out/work/proposals/java_two_pavilions'
INDEX, BATCH, POSITION = 4792, 74, 56
WALK_WIDTH, COURT_WIDTH = 1.2, 3.0  # Explicit pilot choices, not source minima.


def encoded(value):
    return (json.dumps(value, ensure_ascii=False, indent=2) + '\n').encode('utf8')


def as_surface(poly):
    assert poly.geom_type == 'Polygon' and poly.is_valid and not poly.interiors
    return [{'outer': [{'x': x, 'y': y} for x, y in list(poly.exterior.coords)[:-1]], 'holes': []}]


def save(name, value):
    path = OUT / name
    with path.open('xb') as f:
        f.write(encoded(value))
    return {'path': str(path.relative_to(ROOT)), 'sha256': sha256(path.read_bytes()).hexdigest()}


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    request_path = PROOF / 'after/074-request.json'
    plans_path = PROOF / 'after/074-plans.json'
    header = json.loads(request_path.read_bytes())
    plans = json.loads(plans_path.read_bytes())
    parent = header['requests'][POSITION]
    assert parent['id'].endswith('/parcel-f4efd28eef8589b6/building')
    assert parent['function'] == 'domestic' and not parent['config'].get('recipe')
    assert all(v is None for v in parent['config']['overrides'].values())
    assert parent['culture']['mode'] == 'historical_inspired'
    assert not parent['reserves'] and len(parent['accesses']) == 1
    land = surface(parent['cadastral'])
    xmin, ymin, xmax, ymax = land.bounds
    assert land.symmetric_difference(box(xmin, ymin, xmax, ymax)).area == 0
    assert land.difference(surface(parent['buildable'])).area == 0
    assert land.difference(surface(parent['roof_domain'])).area == 0
    public = parent['accesses'][0]
    assert public['kind'] == 'public'
    frontage = LineString([(p['x'], p['y']) for p in public['segment']])
    assert frontage.equals(LineString([(xmin, ymin), (xmin, ymax)]))
    preview_areas = [surface([p]).area for p in parent['preview']]
    assert len(preview_areas) == 2
    target = parent['programme']['built_area_m2']
    budgets = [round(target * preview_areas[0] / sum(preview_areas), 1)]
    budgets.append(round(target - budgets[0], 1))
    assert abs(sum(budgets) - target) < 1e-10
    split = xmin + (xmax - xmin - COURT_WIDTH) * budgets[0] / target
    walk = box(xmin, ymin, xmax, ymin + WALK_WIDTH)
    court = box(split, ymin + WALK_WIDTH, split + COURT_WIDTH, ymax)
    cells = [box(xmin, ymin + WALK_WIDTH, split, ymax),
             box(split + COURT_WIDTH, ymin + WALK_WIDTH, xmax, ymax)]
    pieces = [*cells, walk, court]
    assert unary_union(pieces).symmetric_difference(land).area < 1e-8
    assert all(a.intersection(b).area == 0 for i, a in enumerate(pieces) for b in pieces[i+1:])
    assert abs(walk.intersection(frontage).length - WALK_WIDTH) < 1e-8

    # Exact earlier within-batch occupied surfaces become explicit neighbours
    # for this small standalone fixture; parent itself is never an obstacle.
    by_id = {b['id']: b for b in plans['buildings']}
    prior = []
    for r in header['requests'][:POSITION]:
        b = by_id.get(r['id'])
        if b is None:
            continue
        parts = [b['footprint'], b['courtyards'], b['circulation'],
                 *[f['surface'] for f in b['structural_features']]]
        height = max([0.0] + [v['z_m'] + v['wall_height_m'] + v['roof_height_m'] - b['ground_z_m']
                             for v in b['volumes']])
        prior.append({'id': b['id'], 'parts': parts, 'height_m': height})
    context = deepcopy(parent['neighbors'])
    for item in prior:
        for i, part in enumerate(item['parts']):
            if part:
                context.append({'id': f"{item['id']}/compound-proof-occupation/{i}",
                                'footprint': part, 'height_m': item['height_m']})
    occupied = unary_union([surface(n['footprint']) for n in context])
    assert occupied.intersection(land).area < 1e-4

    children, descriptions = [], []
    for i, (cell, budget) in enumerate(zip(cells, budgets)):
        r = deepcopy(parent)
        r['id'] = parent['id'] if i == 0 else parent['id'] + '/pavilion-1'
        r['seed'] = parent['seed'] + f'/pavilion-{i}'
        r['config']['seed'] = r['seed']
        r['cadastral'] = as_surface(cell)
        r['buildable'] = as_surface(cell.intersection(surface(parent['buildable'])))
        r['roof_domain'] = as_surface(cell.intersection(surface(parent['roof_domain'])))
        r['neighbors'] = deepcopy(context)
        for field in ['placement_hint', 'native_minimum_candidates', 'occupation', 'preview', 'preview_parts']:
            r.pop(field, None)
        r['party_boundaries'] = []
        r['typology'] = 'detached'
        r['programme'].update({'composition': 'detached', 'built_area_m2': budget,
                               'frontage_continuity': 0.0, 'party_walls': False})
        r['programme'].pop('households', None)
        ax, _, bx, _ = cell.bounds
        segment = [{'x': ax + 0.4, 'y': ymin + WALK_WIDTH},
                   {'x': bx - 0.4, 'y': ymin + WALK_WIDTH}]
        access_id = parent['parcel_id'] + f'/proposed-common-walk/terminal-{i}'
        r['accesses'] = [{'id': access_id, 'segment': segment,
                          'kind': 'collective', 'width_m': WALK_WIDTH}]
        assert LineString([(p['x'], p['y']) for p in segment]).difference(walk.boundary).length < 1e-8
        children.append(r)
        descriptions.append({'id': r['id'], 'parcel_id': r['parcel_id'], 'order': i,
                             'target_footprint_m2': budget, 'terminal_access_id': access_id})
    payload = {k: deepcopy(v) for k, v in header.items() if k != 'requests'}
    payload['requests'] = children
    low, high, slope = terrain_bounds(parent['terrain'], walk)
    proposal = {'version': 'compound-site-proposal-1', 'status': 'derived_not_native_admitted',
        'parent_request_id': parent['id'], 'parcel_id': parent['parcel_id'],
        'parent_programme': parent['programme'], 'parts': descriptions,
        'common': {'court': as_surface(court), 'walk': as_surface(walk), 'source_access': public,
                   'terminal_accesses': [r['accesses'][0] for r in children]},
        'choices': {'walk_width_m': WALK_WIDTH, 'court_width_m': COURT_WIDTH,
                    'budget_basis': 'parent target split proportionally to its two original preview areas, rounded to 0.1m2 without duplication',
                    'rights_basis': 'strict disjoint subsets of original cadastral/buildable/roof domains',
                    'access_basis': 'proposed private common circulation inside existing lot; no new public right'},
        'pending': ['native plans for both parts', 'actual roofs and body foundations',
                    'native retained portal and exterior/interior realization separately',
                    'common walk surface/grade policy and vertical connection at each actual portal',
                    'urban persistence/render/edit grouping of two parts and common surfaces'],
        'capacity_persons': None, 'households_per_pavilion': None}
    checks = {'source_index': INDEX, 'batch': BATCH, 'position': POSITION,
        'parent_area_m2': land.area, 'private_areas_m2': [p.area for p in cells],
        'court_area_m2': court.area, 'walk_area_m2': walk.area,
        'partition_difference_m2': unary_union(pieces).symmetric_difference(land).area,
        'shared_private_overlap_m2': 0, 'known_occupation_overlap_m2': occupied.intersection(land).area,
        'public_contact_length_m': walk.intersection(frontage).length,
        'walk_terrain_informational': {'low_m': low, 'high_m': high, 'max_slope_deg': slope,
            'meaning': 'raster bound only; no native public-walk or portal-height certificate'},
        'prior_native_occupations': len(prior), 'original_enriched_neighbors': len(parent['neighbors']),
        'targets_m2': budgets, 'target_sum_m2': sum(budgets), 'native_executed': False}
    files = [save('requests.json', payload), save('compound-site-proposal.json', proposal),
             save('checks.json', checks), save('parent-reference-request.json', parent),
             save('parent-reference-plan.json', by_id[parent['id']]),
             save('prior-within-batch-occupation.json', prior)]
    manifest = {'version': 'derived-compound-fixture-provenance-1',
        'source_index': INDEX, 'native_execution': False,
        'source_request_batch': str(request_path.relative_to(ROOT)),
        'source_request_batch_sha256': sha256(request_path.read_bytes()).hexdigest(),
        'source_plan_batch': str(plans_path.relative_to(ROOT)),
        'source_plan_batch_sha256': sha256(plans_path.read_bytes()).hexdigest(),
        'source_manifest_sha256': sha256((PROOF / 'manifest.json').read_bytes()).hexdigest(),
        'script_sha256': sha256(Path(__file__).read_bytes()).hexdigest(), 'files': files}
    save('manifest.json', manifest)
    print(json.dumps(checks, indent=2))


if __name__ == '__main__':
    main()
