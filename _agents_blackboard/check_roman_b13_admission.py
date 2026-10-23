"""Read-only B13 admission comparison: preserve all 224/418 previous records.

Only B13's default minimum and three authored bundles may be added. A native
witness is not an interior/placement/capacity certificate. This checker never
generates, copies or publishes an export; root must validate native B13 first.
"""
import argparse
import importlib.util
import json
from pathlib import Path

spec = importlib.util.spec_from_file_location('b13_data_proof',
    Path(__file__).with_name('check_roman_b13_emission.py'))
data = importlib.util.module_from_spec(spec)
spec.loader.exec_module(data)
exact = data.exact
ROOT, OUT, DATA = data.ROOT, data.OUT, data.DATA


def same(before, after, label):
    changes = exact.differences(before, after)
    assert not changes, f'{label} changed: {changes}'


def check_native_witness(value):
    assert value['status'] in ('supported', 'refused')
    if value['status'] == 'supported':
        assert len(value['envelope_m']) == 2 and all(v > 0 for v in value['envelope_m'])
        assert value['access_width_m'] > 0 and value['refusal'] is None
    else:
        assert value['envelope_m'] is None and value['access_width_m'] is None
        assert isinstance(value['refusal'], str) and value['refusal']


def compare(candidate, report_path):
    data.check_saved_baseline()
    baseline_root = OUT / 'before'
    catalogue = data.read_at(ROOT, 'recipes.json')
    old_catalogue = data.read_at(baseline_root, 'recipes.json')
    assert data.source_count(catalogue) == (266, 421)
    data.preserved_rows(old_catalogue['recipes'], catalogue['recipes'], 'id', [data.IDENTIFIER])
    recipe = exact.indexed(catalogue['recipes'], 'id')[data.IDENTIFIER]
    before_path = baseline_root / DATA / 'urban-admission.json'
    before, after = exact.checked_read(before_path), exact.checked_read(candidate)
    assert len(before['profiles']) == 224 and len(before['feasibility']['profiles']) == 418
    assert len(after['profiles']) == 225 and len(after['feasibility']['profiles']) == 421
    assert before['source_sha256'] == data.sha((baseline_root / DATA / 'recipes.json').read_bytes())
    assert after['source_sha256'] == data.sha((ROOT / DATA / 'recipes.json').read_bytes())
    assert before['generator_version'] == after['generator_version'] == 'houses-3'
    omitted = {'profiles', 'feasibility', 'source_sha256'}
    same({k: v for k, v in before.items() if k not in omitted},
         {k: v for k, v in after.items() if k not in omitted}, 'Global metadata/registries')
    same({k: v for k, v in before['feasibility'].items() if k != 'profiles'},
         {k: v for k, v in after['feasibility'].items() if k != 'profiles'}, 'Feasibility metadata')
    data.preserved_rows(before['profiles'], after['profiles'], 'recipe_id', [data.IDENTIFIER])
    data.preserved_rows(before['feasibility']['profiles'], after['feasibility']['profiles'],
                        'style_id', data.NEW_STYLES)
    minimum = exact.indexed(after['profiles'], 'recipe_id')[data.IDENTIFIER]
    assert minimum['pack'] == 'MED-ANT' and minimum['layout'] == 'strip'
    assert minimum['floors'] == [2, 2] and minimum['eras'] == ['A']
    assert minimum['inspired_only'] is True and minimum['tradition_id'] == 'roman_urban'
    assert 'urban-admission-v1:MED-ANT-B13' in minimum['provenance']
    profiles = exact.indexed(after['feasibility']['profiles'], 'style_id')
    parameters = {'default': recipe['parameters'],
                  **{v['id']: v['parameters'] for v in recipe['variants']}}
    statuses = {}
    for variant, floors in [('default', 2), ('three_storeys', 3), ('four_storeys', 4)]:
        style = profiles[data.IDENTIFIER + '::' + variant]
        p = parameters[variant]
        assert style['recipe_id'] == data.IDENTIFIER and style['variant_id'] == variant
        assert style['pack'] == 'MED-ANT' and style['role'] == 'communal_dwelling'
        assert style['inspired_only'] is True and style['tradition_id'] == 'roman_urban'
        assert style['household_range'] is None and style['placement_certified'] is False
        same(style['temporal'], recipe['temporal'], 'B13 temporal')
        for field in ('layout', 'footprint_family', 'roof_system'):
            same(style[field], p[field], f'B13 {variant} {field}')
        assert style['primary_floors'] == p['floors'] == [floors, floors]
        assert style['nominal_width_m'] == p['width_m'] and style['nominal_depth_m'] == p['depth_m']
        assert p['urban_frontage_infill'] is False
        constraints = style['source_constraints']
        for field in ('floors', 'bodies', 'cells', 'allowed_footprints', 'allowed_roofs',
                      'courtyard_ratio', 'overhang_m', 'roof_pitch_deg', 'wall_thickness_m'):
            same(constraints[field], p[field], f'B13 {variant} source {field}')
        assert len(constraints['components']) == len(p['components']) == 1
        for field, value in constraints['components'][0].items():
            # ComponentConstraint.optional is derived from the authored count
            # minimum by style_index.rs; it is not a raw Component field.
            expected = (p['components'][0]['count'][0] == 0) if field == 'optional' else p['components'][0][field]
            same(value, expected, f'B13 {variant} main.{field}')
        witness = style['minimum_native']
        expected_seed = ('urban-admission-v1:MED-ANT-B13' if variant == 'default'
                         else 'urban-feasibility-v1:MED-ANT-B13::' + variant)
        assert witness['seed'] == expected_seed
        check_native_witness(witness)
        statuses[style['style_id']] = witness['status']
        if variant == 'default':
            assert minimum['status'] == witness['status'] and minimum['refusal'] == witness['refusal']
            if witness['status'] == 'supported':
                same(minimum['min_envelope_m'], witness['envelope_m'], 'B13 minimum envelope')
                same(minimum['min_access_width_m'], witness['access_width_m'], 'B13 minimum access')
            else:
                assert minimum['min_envelope_m'] == [0, 0] and minimum['min_access_width_m'] == 0
    report = dict(status='comparison_passed_native_validation_required',
        baseline_sha256=data.sha(before_path.read_bytes()), candidate_sha256=data.sha(candidate.read_bytes()),
        source_sha256=after['source_sha256'], preserved_minimum_profiles=224,
        preserved_feasibility_profiles=418, minimum_profiles=225, feasibility_profiles=421,
        added_profiles=[data.IDENTIFIER], added_styles=data.NEW_STYLES,
        added_witness_statuses=statuses, changed_existing_records=[], metadata_and_registries_unchanged=True,
        placement_certified=False, household_capacity=None, native_calls=0, canonical_written=False)
    exact.write(report_path, report)
    return report


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('candidate', type=Path)
    parser.add_argument('--report', type=Path, default=OUT / 'admission-comparison.json')
    args = parser.parse_args()
    print(json.dumps(compare(args.candidate.resolve(), args.report), ensure_ascii=False, indent=2))
