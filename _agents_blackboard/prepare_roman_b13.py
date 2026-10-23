"""Prepare B13 bundles in memory; never emit catalogue/source/admission data.

The normal generator must still reproduce all 265 existing recipes exactly.
Only this script's blackboard output contains the proposed parameter bundles.
"""
import copy
import hashlib
import importlib.util
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = Path(__file__).resolve().parent / 'roman-b13-proposed'
DATA = ROOT / 'rust/crates/houses/data'
IDENTIFIER = 'MED-ANT-B13'
SOURCE = 'docs/sources/roman-compact-domestic-architecture.md'
MAPPER_ROW = ('| P1 | `MED-ANT-B13` — **Petit immeuble romain de rue — enveloppe inspirée** | '
              'Un corps fermé, 2 niveaux par défaut, variantes 3/4 ; cour arrière et passage latéral ; '
              'dimensions artistiques, capacité inconnue | Brique enduite, charpente bois ; '
              'distribution collective générique sans appartements certifiés | '
              'Deux pans de tuiles proposés ; aucun remplissage burgage automatique |')
METADATA = dict(
    source=SOURCE, level_height_m=2.8,
    parameter_note='Inspired compact Roman street block: all dimensional ranges, 2/3/4 storeys, '
                   '2.8m storey height, room count, roof, rear court and lateral passage proportions '
                   'are artistic/native construction defaults, not archaeological measurements. '
                   'Generic communal rooms and internal stairs do not certify apartments, '
                   'independent tenancy, households or inhabitants. No automatic burgage infill, '
                   'shopfront, gallery or multiple_households programme is declared. See ' + SOURCE + '.',
    temporal=dict(eras=['A'], tradition_long=False, late_only=False, from_year=None, to_year=None),
    chronology_note='Imperial Roman multi-storey street dwellings are documented, including '
                    'facade-lit and court-lit examples; this generated block has no exact '
                    'archaeological date or measured dimensional range. Inspired interpretation '
                    'only; see ' + SOURCE,
    chronology_confidence='broad_tradition', roof_confidence='uncertain',
)


def load_generator():
    spec = importlib.util.spec_from_file_location('house_recipes_b13_preparation',
                                                ROOT / 'rust/scripts/house-recipes.py')
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def encoded(value):
    return json.dumps(value, ensure_ascii=False, indent=2).encode('utf-8')


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def prepare():
    tracked = [DATA / name for name in ('recipes.json', 'source-inventory.json', 'urban-admission.json')]
    before = {str(path.relative_to(ROOT)): digest(path) for path in tracked}
    generator_version = re.search(r'GENERATOR_VERSION: &str = "([^"]+)"',
        (ROOT / 'rust/crates/houses/src/lib.rs').read_text(encoding='utf-8')).group(1)
    plan_version = re.search(r'PLAN_VERSION: &str = "([^"]+)"',
        (ROOT / 'rust/crates/houses/src/plans.rs').read_text(encoding='utf-8')).group(1)
    bridge_version = re.search(r"HOUSE_GENERATOR = '([^']+)'",
        (ROOT / 'rust/bridge/housesContract.ts').read_text(encoding='utf-8')).group(1)
    assert generator_version == bridge_version == 'houses-3'
    assert plan_version == 'architectural-plans-2'
    baseline = json.loads(tracked[0].read_text(encoding='utf-8'))
    g = load_generator()
    unchanged = g.build()
    old = {r['id']: r for r in baseline['recipes']}
    rebuilt = {r['id']: r for r in unchanged['recipes']}
    assert len(old) == 265 and 'MED-ANT-B12' in old and IDENTIFIER not in old
    assert encoded(unchanged) == encoded(baseline), 'Normal generation changed before B13 emission.'
    assert all(encoded(recipe) == encoded(rebuilt[key]) for key, recipe in old.items())

    # Proposed tables are installed only in this freshly imported Python module.
    # No mapper row, executable assignment or source-inventory entry is written.
    g.INSPIRED_ONLY_RECIPES[IDENTIFIER] = copy.deepcopy(METADATA)
    g.V['three_storeys'] = g.variant('Trois niveaux — variante inspirée', floors=[3, 3])
    g.V['four_storeys'] = g.variant('Quatre niveaux — variante inspirée', floors=[4, 4])
    g.VARIANT_ASSIGNMENTS[IDENTIFIER] = 'three_storeys four_storeys'
    p = g.complete_parameters(IDENTIFIER, copy.deepcopy(g.PROFILES['roman_street_block']),
                              'communal_dwelling')
    variants = g.variants_for(IDENTIFIER, p, 'communal_dwelling')
    bundles = [('default', p), *((v['id'], v['parameters']) for v in variants)]
    checks = []
    for (variant, parameters), floors in zip(bundles, (2, 3, 4), strict=True):
        assert parameters['variant_id'] == variant
        assert parameters['layout'] == 'strip' and parameters['footprint_family'] == 'FP-RECT'
        assert parameters['urban_frontage_infill'] is False
        assert parameters['floors'] == [floors, floors] and parameters['level_height_m'] == 2.8
        assert parameters['bodies'] == [1, 1] and parameters['cells'] == [0, 0]
        assert parameters['enclosures'] == [] and not parameters['gallery_cover']['enabled']
        assert parameters['court_program'] is None and parameters['structural_spec'] is None
        assert parameters['vertical_access'] == 'internal_stair'
        assert not {'multiple_households', 'side_corridor', 'shopfront'} & set(parameters['details'])
        routes = parameters['vertical_routes']
        assert [(r['from_level'], r['to_level']) for r in routes] == [(i, i + 1) for i in range(floors - 1)]
        assert all(r['kind'] == 'internal_stair' and r['min_width_m'] == 0.9 for r in routes)
        assert len(parameters['components']) == 1
        component = parameters['components'][0]
        assert component['id'] == 'main' and component['role'] == 'communal_dwelling'
        assert component['count'] == [1, 1]
        for field in ('floors', 'level_height_m', 'vertical_access', 'vertical_routes',
                      'materials', 'roof_spec', 'rooms_per_body'):
            assert component[field] == parameters[field], (variant, field)
        checks.append(dict(variant=variant, floors=floors, level_height_m=2.8,
                           adjacent_level_routes=len(routes), component_matches=True))
    assert all(v['confidence'] == 'stylized' for v in variants)
    proposal = dict(
        status='proposed_not_emitted_not_native_validated', id=IDENTIFIER,
        mapper_row=MAPPER_ROW, profile='roman_street_block', role='communal_dwelling',
        assignment_token='roman_street_block', role_token='C', context_token='03:GRID',
        tradition_id='roman_urban', inspired_only=True, metadata=METADATA,
        source_reference=g.inspired_source_reference(IDENTIFIER),
        parameters=p, variants=variants, household_capacity=None,
    )
    fixture_spec = importlib.util.spec_from_file_location(
        'roman_native_proposed_requests', Path(__file__).with_name('prepare_roman_native_validation.py'))
    fixtures = importlib.util.module_from_spec(fixture_spec)
    fixture_spec.loader.exec_module(fixtures)
    batch = fixtures.fixture_set()[0]['b13-later']
    report = dict(status='data_preparation_passed_native_pending', existing_recipes=len(old),
                  existing_styles=sum(1 + len(r['variants']) for r in old.values()),
                  all_existing_recipes_unchanged=True, b12_unchanged=True,
                  proposed_recipes=266, proposed_styles=421, variants=checks,
                  expected_native_generator=generator_version, expected_plan_generator=plan_version,
                  plan_request_schema='1', house_config_schema='2',
                  urban_entry_certified=False,
                  urban_entry_limits=['pinned recipe/variant/floors and parcel_fit=false bypass the automatic entry upgrade',
                                      'masonry_joints is outside the current native foundation-entry parameter whitelist'],
                  native_calls=0, data_files_written=False, data_sha256_unchanged=before)
    assert all(digest(path) == before[str(path.relative_to(ROOT))] for path in tracked)
    OUT.mkdir(exist_ok=True)
    for name, value in [('proposal.json', proposal), ('preparation-report.json', report),
                        ('native-requests.json', batch)]:
        (OUT / name).write_bytes(encoded(value) + b'\n')
    return report


if __name__ == '__main__':
    print(json.dumps(prepare(), ensure_ascii=False, indent=2))
