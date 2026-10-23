"""Prepare/check eight bounded Roman recipe witnesses; never run native code.

prepare writes fixtures only beneath this script's own blackboard directory.
check consumes plan_replay outputs after the parent authorizes catalogue emission
and a native build. No Rust, catalogue, admission export, service or Cargo writes.
"""
import argparse
import copy
import hashlib
import json
import struct
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = Path(__file__).resolve().parent / 'roman-native-proposed-fixtures'
DATA = ROOT / 'rust/crates/houses/data'
# This proof is tied to the corrected native-entry generation. These are
# compatibility assertions, never a migration or relabelling of an old result.
EXPECTED_HOUSE_GENERATOR = 'houses-3'
EXPECTED_PLAN_GENERATOR = 'architectural-plans-2'


def surface(x, y, width, depth):
    return [{'outer': [{'x': x, 'y': y}, {'x': x + width, 'y': y},
                       {'x': x + width, 'y': y + depth}, {'x': x, 'y': y + depth}],
             'holes': []}]


def request(name, ordinal, recipe, variant='default', floors=2, dims=(4.5, 7),
            site=(8, 12), mode='historical_inspired', function='mixed'):
    x = ordinal * 100.0
    cadastral = surface(x, 0, *site)
    config = dict(schema_version='2', seed=name, pack='MED-ANT', recipe=recipe,
                  mode=mode, era='A', allow_late=False, count=1, size=1,
                  variation=0, wealth=1, orientation_deg=0,
                  overrides=dict(variant=variant, floors=floors))
    return dict(
        id=name, parcel_id=name + '-parcel', cadastral=cadastral,
        buildable=copy.deepcopy(cadastral), roof_domain=copy.deepcopy(cadastral),
        reserves=[], party_boundaries=[], neighbors=[],
        accesses=[dict(id='street', segment=[{'x': x, 'y': site[1]},
                                           {'x': x + site[0], 'y': site[1]}],
                       kind='public', width_m=2)],
        culture=dict(culture='roman-core', pack='MED-ANT', mode=mode, borrowing=None),
        function=function, seed=name, config=config, parcel_fit=False,
        occupation=dict(coverage=dims[0] * dims[1] / (site[0] * site[1]),
                        frontage_m=dims[0], depth_m=dims[1]),
        programme=dict(role='dwelling.shop' if function == 'mixed' else 'dwelling.tenement',
                       composition='row', floors=[floors, floors],
                       built_area_m2=dims[0] * dims[1] if recipe.endswith('B12')
                       else (dims[0] - 1.25) * 0.75 * dims[1]),
        terrain=dict(origin={'x': x, 'y': 0}, ground_z_m=10, gradient=[0, 0],
                     water_z_m=None, max_foundation_step_m=0.75),
    )


def fixture_set():
    minimum = request('b12-minimum-two-levels', 0, 'MED-ANT-B12')
    narrow = request('b12-too-narrow', 1, 'MED-ANT-B12', site=(2, 12))
    # Keep occupation valid (0..1); a narrow lot must fail physical minima,
    # not an accidentally malformed occupation target.
    narrow['occupation']['coverage'] = 0.75
    strict = request('b12-strict-pin-refused', 2, 'MED-ANT-B12', mode='historical_strict')
    bad_floor = request('b12-hard-three-levels-refused', 3, 'MED-ANT-B12', floors=3)
    b12 = dict(schema_version='1', requests=[minimum, narrow, strict, bad_floor],
               settings=dict(parcel_fit=False), footprints={})

    exact = request('b12-exact-two-levels-soft-four', 4, 'MED-ANT-B12')
    exact['programme']['floors'] = [4, 4]
    b12_exact = dict(schema_version='1', requests=[exact],
                     settings=dict(parcel_fit=False, house_config=copy.deepcopy(exact['config'])),
                     footprints={})
    # 65 / 96 = .677083... exceeds the historical .66 infill threshold.
    # The three otherwise identical cases expose accidental burgage additions.
    b13_requests = [request('b13-minimum-' + str(floors) + '-levels', 5 + i,
                            'MED-ANT-B13', variant, floors, (6.5, 10),
                            function='domestic')
                    for i, (variant, floors) in enumerate([
                        ('default', 2), ('three_storeys', 3), ('four_storeys', 4)])]
    b13 = dict(schema_version='1', requests=b13_requests,
               settings=dict(parcel_fit=False), footprints={})
    batches = {'b12': b12, 'b12-exact': b12_exact, 'b13-later': b13}
    expected = {}
    for batch, data in batches.items():
        for req in data['requests']:
            is_b13 = req['config']['recipe'].endswith('B13')
            refused = req['id'] in {narrow['id'], strict['id'], bad_floor['id']}
            expected[req['id']] = dict(
                batch=batch, result='refused' if refused else 'accepted',
                recipe=req['config']['recipe'], variant=req['config']['overrides']['variant'],
                floors=req['config']['overrides']['floors'], bodies=1,
                expected_nominal_m=None if batch == 'b12-exact' or refused
                else [6.5, 10] if is_b13 else [4.5, 7],
                body_area_m2=None if batch == 'b12-exact' or refused
                else 39.375 if is_b13 else 31.5,
                courts='open_rear' if is_b13 else 'none',
                detail_checks=[] if refused else ['exterior', 'interior'],
                capacity='unknown',
            )
    return batches, expected


def read(path):
    return json.loads(path.read_text(encoding='utf-8-sig'))


def write(path, value):
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')


def decode_exact(value):
    if isinstance(value, dict):
        if set(value) == {'$f64'}:
            return struct.unpack('>d', bytes.fromhex(value['$f64']))[0]
        return {key: decode_exact(item) for key, item in value.items()}
    if isinstance(value, list):
        return [decode_exact(item) for item in value]
    return value


def ring_area(ring):
    return abs(sum(a['x'] * b['y'] - b['x'] * a['y']
                   for a, b in zip(ring, ring[1:] + ring[:1]))) * 0.5


def area(polygons):
    return sum(ring_area(p['outer']) - sum(map(ring_area, p['holes'])) for p in polygons)


def validate_output_versions(output, catalogue):
    catalogue_version = catalogue['catalogue_version']
    assert isinstance(catalogue_version, str) and catalogue_version
    assert output.get('schema_version') == '1', 'Expected plan request/result schema 1.'
    assert output.get('generator_version') == EXPECTED_PLAN_GENERATOR, (
        'Expected a genuine architectural-plans-2 result; no version conversion is permitted.')
    for building in output['buildings']:
        compact = building['resolved']
        assert compact.get('format') == 'compact-plan-1', building['id']
        assert compact.get('generator_version') == EXPECTED_HOUSE_GENERATOR, (
            building['id'], 'Retained plan must come from houses-3, without relabelling.')
        assert compact.get('catalogue_version') == catalogue_version, (
            building['id'], 'Retained plan does not match the currently emitted catalogue version.')


def prepare():
    batches, expected = fixture_set()
    assert sum(len(b['requests']) for b in batches.values()) == 8
    ids = [r['id'] for b in batches.values() for r in b['requests']]
    assert len(ids) == len(set(ids))
    assert all(0 <= r['occupation']['coverage'] <= 1
               for b in batches.values() for r in b['requests'])
    assert all(r['occupation']['coverage'] >= 0.66 for r in batches['b13-later']['requests'])
    OUT.mkdir(exist_ok=True)
    for name, batch in batches.items():
        write(OUT / (name + '-requests.json'), batch)
    nominal_min = {'B12': [4.5, 7], 'B13': [6.5, 10]}
    body_min = {'B12': [4.5, 7], 'B13': [5.25, 7.5]}
    lower_bound = [2 * 0.4 + 2 * 1.4, 2 * 0.4 + max(2.8 * 0.95, 2.6) + 1.4]
    assert all(all(actual >= minimum for actual, minimum in zip(body, lower_bound))
               for body in body_min.values())
    manifest = dict(
        status='proposed_not_run', schema='roman-native-proposed-fixtures-1',
        source='docs/sources/roman-compact-domestic-architecture.md',
        catalogue_sha256_at_preparation=hashlib.sha256((DATA / 'recipes.json').read_bytes()).hexdigest(),
        expected_native_contract=dict(plan_schema='1', house_config_schema='2',
                                      plan_generator=EXPECTED_PLAN_GENERATOR,
                                      house_generator=EXPECTED_HOUSE_GENERATOR,
                                      catalogue_version=read(DATA / 'recipes.json')['catalogue_version']),
        nominal_min_m=nominal_min, body_min_m=body_min,
        native_minimum_domain_lower_bound_m=lower_bound,
        lower_bound_is_not_a_native_interior_certificate=True,
        expected=expected,
        scope='Eight synthetic construction/guard witnesses, not an archaeological measurement, city acceptance rate or population certificate.',
        commands_after_export_and_parent_build=[
            f'rust/target/debug/examples/plan_replay.exe {OUT.relative_to(ROOT).as_posix()}/{name}-requests.json '
            f'{OUT.relative_to(ROOT).as_posix()}/{name}-plans.json --details '
            f'{OUT.relative_to(ROOT).as_posix()}/{name}-details.json'
            for name in batches],
    )
    write(OUT / 'manifest.json', manifest)
    return dict(status='prepared_not_run', folder=str(OUT.relative_to(ROOT)), requests=len(ids),
                expected_acceptance=5, expected_refusal=3, native_calls=0)


def check(selected):
    manifest = read(OUT / 'manifest.json')
    catalogue = read(DATA / 'recipes.json')
    recipes = {r['id']: r for r in catalogue['recipes']}
    reports = []
    for name in selected:
        wanted = {key: value for key, value in manifest['expected'].items() if value['batch'] == name}
        requests = {r['id']: r for r in read(OUT / (name + '-requests.json'))['requests']}
        output = read(OUT / (name + '-plans.json'))
        detail = read(OUT / (name + '-details.json'))
        validate_output_versions(output, catalogue)
        buildings = {b['id']: b for b in output['buildings']}
        refusals = {r['id']: r for r in output['refusals']}
        assert set(buildings).isdisjoint(refusals)
        assert set(buildings) | set(refusals) == set(wanted) and not output['open_spaces']
        assert len(buildings) == len(output['buildings']) and len(refusals) == len(output['refusals'])
        for key, e in wanted.items():
            assert e['recipe'] in recipes, f'{e["recipe"]} has not been emitted; validation is pending.'
            if e['result'] == 'refused':
                assert key in refusals, key
                reports.append(dict(id=key, status='refused_as_expected', reason=refusals[key]['message']))
                continue
            assert key in buildings, refusals.get(key)
            b = buildings[key]
            assert (b['recipe_id'], b['variant_id']) == (e['recipe'], e['variant'])
            assert b['domestic_units'] == 0, 'Native fixture must not invent certified capacity.'
            assert len(b['volumes']) == e['bodies']
            assert all(len(v['levels']) == e['floors'] for v in b['volumes'])
            assert all(v['roof_system'] == 'RF-GABLE' for v in b['volumes'])
            assert all(v['materials']['frame'] == 'MAT-BURNT-BRICK' for v in b['volumes'])
            assert not b['structural_features'], 'These envelopes declare no gallery, post or enclosure.'
            compact = decode_exact(b['resolved'])
            assert compact['recipe_id'] == e['recipe'] and compact['variant_id'] == e['variant']
            assert compact['config']['seed'] == requests[key]['seed']
            source = recipes[e['recipe']]
            base = source['parameters'] if e['variant'] == 'default' else next(
                v['parameters'] for v in source['variants'] if v['id'] == e['variant'])
            parameters = []
            for delta in compact['parameters']:
                p = copy.deepcopy(base)
                for remove in delta['remove']:
                    p.pop(remove, None)
                p.update(delta['set'])
                parameters.append(p)
            assert len(compact['bodies']) == 1
            body = compact['bodies'][0]
            p = parameters[body['parameters']]
            assert p['floors'] == [e['floors']] * 2 and len(body['levels']) == e['floors']
            assert p['bodies'] == [1, 1] and p['cells'] == [0, 0] and not body['cells']
            assert p['level_height_m'] == 2.8 and p['support']['kind'] == 'ground'
            assert not p['enclosures'] and p['court_program'] is None
            assert not p['gallery_cover']['enabled'] and 'side_corridor' not in p['details']
            assert 'multiple_households' not in p['details']
            main = p['components']
            assert len(main) == 1 and main[0]['id'] == 'main'
            assert main[0]['floors'] == p['floors'] and main[0]['level_height_m'] == p['level_height_m']
            for bundle in [p, main[0]]:
                routes = bundle['vertical_routes']
                assert all(any(r['from_level'] == level and r['to_level'] == level + 1
                               and r['kind'] == 'internal_stair' for r in routes)
                           for level in range(e['floors'] - 1))
            if e['expected_nominal_m'] is not None:
                assert all(abs(p[field][0] - value) < 1e-6 for field, value in
                           zip(('width_m', 'depth_m'), e['expected_nominal_m']))
                assert abs(area(b['footprint']) - e['body_area_m2']) < 1e-4
            courts = compact['surfaces'][compact['courts']]
            if e['courts'] == 'none':
                assert not courts and not b['courtyards']
            else:
                assert p.get('urban_frontage_infill', True) is False
                assert abs(area(courts) - 16.25) < 1e-6
                paths = compact['surfaces'][compact['paths']]
                assert abs(area(paths) - 12.5) < 1e-6
            rows = [d for d in detail['details'] if d['id'] == key]
            assert len(rows) == 2 and {d['interiors'] for d in rows} == {False, True}
            assert all(d['ok'] for d in rows), rows
            reports.append(dict(id=key, status='native_plan_and_both_details_passed',
                                body_area_m2=area(b['footprint']), levels=e['floors'], capacity='unknown'))
    result = dict(status='passed', fixtures=reports, capacity='unknown',
                  native_contract=dict(plan_generator=EXPECTED_PLAN_GENERATOR,
                                       house_generator=EXPECTED_HOUSE_GENERATOR,
                                       catalogue_version=catalogue['catalogue_version']),
                  native_catalogue_sha256=hashlib.sha256((DATA / 'recipes.json').read_bytes()).hexdigest())
    write(OUT / ('check-' + '-'.join(selected) + '.json'), result)
    return result


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action', choices=['prepare', 'check'])
    parser.add_argument('--batches', nargs='+', choices=['b12', 'b12-exact', 'b13-later'],
                        default=['b12', 'b12-exact'])
    options = parser.parse_args()
    print(json.dumps(prepare() if options.action == 'prepare' else check(options.batches), indent=2))
