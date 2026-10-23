"""One-time, pre-export comparison. Never writes catalogue or admission files."""
import hashlib
import importlib.util
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def load(name, relative):
    spec = importlib.util.spec_from_file_location(name, ROOT / relative)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def serialized(recipe):
    return json.dumps(recipe, ensure_ascii=False, indent=2).encode('utf-8')


def check():
    data = ROOT / 'rust/crates/houses/data'
    tracked = [data / name for name in
               ('recipes.json', 'source-inventory.json', 'urban-admission.json')]
    before = {str(path.relative_to(ROOT)): digest(path) for path in tracked}
    baseline = json.loads(tracked[0].read_text(encoding='utf-8'))
    source = load('house_source_preparation', 'rust/scripts/house-source.py')
    generator = load('house_recipes_preparation', 'rust/scripts/house-recipes.py')
    inventory = json.loads(source.extract())
    preview = generator.build(inventory)
    old = {recipe['id']: recipe for recipe in baseline['recipes']}
    new = {recipe['id']: recipe for recipe in preview['recipes']}
    changed = [key for key in old
               if key not in new or serialized(old[key]) != serialized(new[key])]
    assert not changed, changed
    assert set(new) - set(old) == {'MED-ANT-B12'}, 'This check belongs before B12 export.'
    for key in ('AS-ISL-B14', 'AS-ISL-B15'):
        assert serialized(old[key]) == serialized(new[key])
    roman = new['MED-ANT-B12']
    assert roman['inspired_only'] and roman['tradition_id'] == 'roman_urban'
    assert roman['temporal']['eras'] == ['A'] and not roman['temporal']['late_only']
    assert roman['sources'][-1]['path'] == generator.ROMAN_SOURCE
    assert 'javanese' not in json.dumps(roman).lower()
    p = roman['parameters']
    assert (p['layout'], p['footprint_family'], p['roof_system']) == ('single', 'FP-RECT', 'RF-GABLE')
    assert p['floors'] == [2, 2] and p['level_height_m'] == 2.8
    assert p['bodies'] == [1, 1] and p['enclosures'] == [] and p['cells'] == [0, 0]
    assert p['court_program'] is None and not p['gallery_cover']['enabled']
    assert p['components'][0]['floors'] == p['floors']
    assert p['components'][0]['level_height_m'] == p['level_height_m']
    assert p['vertical_routes'][0]['to_level'] == 1
    assert 'MED-ANT-B13' not in new
    pending = generator.PROFILES['roman_street_block']
    assert pending['urban_frontage_infill'] is False
    assert pending['layout'] == 'strip' and 'side_corridor' not in pending['details']
    assert all(digest(path) == before[str(path.relative_to(ROOT))] for path in tracked)
    return {
        'status': 'passed', 'native_generation': False, 'catalogue_files_written': False,
        'existing_recipes': len(old), 'preview_recipes': len(new),
        'existing_styles': sum(1 + len(r['variants']) for r in old.values()),
        'preview_styles': sum(1 + len(r['variants']) for r in new.values()),
        'added_recipe_ids': sorted(set(new) - set(old)), 'changed_existing_recipe_ids': changed,
        'java_serialized_sha256': {key: hashlib.sha256(serialized(new[key])).hexdigest()
                                  for key in ('AS-ISL-B14', 'AS-ISL-B15')},
        'B13': 'profile and source prepared; not mapped or emitted',
        'data_sha256_unchanged': before,
    }


if __name__ == '__main__':
    print(json.dumps(check(), ensure_ascii=False, indent=2))
