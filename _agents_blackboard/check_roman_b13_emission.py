"""Snapshot and audit the B13 data-only addition; never emit native/catalogue data.

The snapshot is immutable. Comparison preserves every old recipe/source entry,
its order and exact numeric values, including the B12/Java records. Admission
must remain byte-identical until a separately approved native export.
"""
import argparse
import hashlib
import importlib.util
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = Path(__file__).resolve().parent / 'roman-b13-emission-proof'
DATA = Path('rust/crates/houses/data')
IDENTIFIER = 'MED-ANT-B13'
NEW_STYLES = [IDENTIFIER + '::' + variant
              for variant in ('default', 'three_storeys', 'four_storeys')]
SOURCES_ALLOWED = {
    'docs/styles_architecturaux_mondiaux_city_mapper.md',
    'docs/sources/roman-compact-domestic-architecture.md',
}
TRACKED = [
    *(DATA / name for name in ('recipes.json', 'source-inventory.json', 'urban-admission.json')),
    Path('rust/scripts/house-source.py'), Path('rust/scripts/house-recipes.py'),
    Path('docs/styles_architecturaux_mondiaux_city_mapper.md'),
    Path('docs/catalogue_settlements_antiquite_moyen_age_rpg.md'),
    Path('docs/sources/javanese-domestic-architecture.md'),
    Path('docs/sources/roman-compact-domestic-architecture.md'),
    Path('rust/crates/houses/tests/catalogue.rs'),
]
spec = importlib.util.spec_from_file_location('exact_b13_values',
    Path(__file__).with_name('check_roman_b12_admission_export.py'))
exact = importlib.util.module_from_spec(spec)
spec.loader.exec_module(exact)


def sha(data):
    return hashlib.sha256(data).hexdigest()


def read_at(root, name):
    return exact.checked_read(root / DATA / name)


def source_count(catalogue):
    return len(catalogue['recipes']), sum(1 + len(r['variants']) for r in catalogue['recipes'])


def snapshot():
    catalogue, admission = read_at(ROOT, 'recipes.json'), read_at(ROOT, 'urban-admission.json')
    assert source_count(catalogue) == (265, 418)
    assert IDENTIFIER not in exact.indexed(catalogue['recipes'], 'id')
    assert catalogue['catalogue_version'] == 'atlas-houses-3'
    assert len(catalogue['coverage']) == 348
    assert admission['generator_version'] == 'houses-3'
    assert len(admission['profiles']) == 224 and len(admission['feasibility']['profiles']) == 418
    assert admission['source_sha256'] == sha((ROOT / DATA / 'recipes.json').read_bytes())
    files = {}
    for relative in TRACKED:
        data = (ROOT / relative).read_bytes()
        target = OUT / 'before' / relative
        if target.exists():
            assert target.read_bytes() == data, f'Refusing to replace baseline: {relative}'
        else:
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(data)
        files[relative.as_posix()] = dict(sha256=sha(data), bytes=len(data))
    # These fingerprints preserve exact Decimal spellings for inspection;
    # comparison below independently checks typed values without epsilon.
    fingerprints = {r['id']: sha(json.dumps(r, ensure_ascii=False, sort_keys=True,
        separators=(',', ':'), default=str).encode('utf-8')) for r in catalogue['recipes']}
    report = dict(status='baseline_saved_no_emission', recipes=265, styles=418,
        coverage=348, minimum_profiles=224, feasibility_profiles=418,
        files=files, exact_value_recipe_sha256=fingerprints,
        expected_added_recipe=IDENTIFIER, expected_added_styles=NEW_STYLES,
        native_calls=0, canonical_files_written=False)
    manifest = OUT / 'baseline.json'
    if manifest.exists():
        assert exact.checked_read(manifest) == report, 'Baseline manifest differs.'
    else:
        exact.write(manifest, report)
    return {k: v for k, v in report.items() if k not in ('files', 'exact_value_recipe_sha256')}


def check_saved_baseline():
    manifest = exact.checked_read(OUT / 'baseline.json')
    for relative, expected in manifest['files'].items():
        path = OUT / 'before' / relative
        assert sha(path.read_bytes()) == expected['sha256'], f'Corrupt baseline: {relative}'
    return manifest


def preserved_rows(before, after, key, allowed_new):
    old, new = exact.indexed(before, key), exact.indexed(after, key)
    assert set(old) <= set(new), f'Removed {key}: {set(old) - set(new)}'
    assert set(new) - set(old) == set(allowed_new), f'Unexpected additions indexed by {key}'
    assert [r[key] for r in after if r[key] in old] == [r[key] for r in before], 'Old order changed.'
    changes = {identifier: exact.differences(row, new[identifier])
               for identifier, row in old.items()}
    changes = {identifier: value for identifier, value in changes.items() if value}
    assert not changes, f'Existing {key} objects changed: {changes}'


def compare(candidate_root):
    manifest = check_saved_baseline()
    baseline = OUT / 'before'
    old, new = read_at(baseline, 'recipes.json'), read_at(candidate_root, 'recipes.json')
    source_old = read_at(baseline, 'source-inventory.json')
    source_new = read_at(candidate_root, 'source-inventory.json')
    assert source_count(new) == (266, 421)
    preserved_rows(old['recipes'], new['recipes'], 'id', [IDENTIFIER])
    preserved_rows(old['coverage'], new['coverage'], 'id', [IDENTIFIER])
    preserved_rows(source_old['entries'], source_new['entries'], 'id', [IDENTIFIER])
    assert len(new['coverage']) == 349
    assert len(source_new['entries']) == len(source_old['entries']) + 1
    for left, right, omitted in [(old, new, {'sources', 'recipes', 'coverage'}),
                                (source_old, source_new, {'sources', 'entries'})]:
        assert not exact.differences({k: v for k, v in left.items() if k not in omitted},
                                     {k: v for k, v in right.items() if k not in omitted}), 'Other catalogue metadata changed.'
    assert new['sources'] == source_new['sources']
    before_sources = exact.indexed(old['sources'], 'path')
    after_sources = exact.indexed(new['sources'], 'path')
    assert list(before_sources) == list(after_sources)
    changed_sources = []
    for relative, entry in after_sources.items():
        normalized = (candidate_root / relative).read_text(encoding='utf-8-sig').replace('\r\n', '\n')
        assert entry['sha256'] == sha(normalized.encode('utf-8')), f'Invalid source hash: {relative}'
        if entry != before_sources[relative]:
            assert relative in SOURCES_ALLOWED, f'Unrelated source changed: {relative}'
            assert set(entry) == {'path', 'sha256'}
            changed_sources.append(relative)
    recipe = exact.indexed(new['recipes'], 'id')[IDENTIFIER]
    styles = [IDENTIFIER + '::default', *(IDENTIFIER + '::' + v['id'] for v in recipe['variants'])]
    assert styles == NEW_STYLES
    assert recipe['inspired_only'] is True and recipe['tradition_id'] == 'roman_urban'
    assert recipe['role'] == 'communal_dwelling' and recipe['confidence'] == 'stylized'
    for parameters, floors in zip([recipe['parameters'], *(v['parameters'] for v in recipe['variants'])], (2, 3, 4), strict=True):
        assert parameters['layout'] == 'strip' and parameters['footprint_family'] == 'FP-RECT'
        assert parameters['urban_frontage_infill'] is False
        assert parameters['floors'] == [floors, floors]
        assert len(parameters['components']) == 1 and parameters['bodies'] == [1, 1]
        assert 'multiple_households' not in parameters['details']
    admission_path = candidate_root / DATA / 'urban-admission.json'
    assert sha(admission_path.read_bytes()) == manifest['files'][(DATA / 'urban-admission.json').as_posix()]['sha256'], 'Admission export changed before separate native validation.'
    report = dict(status='passed', preserved_recipe_objects=265, previous_styles=418,
        recipes=266, styles=421, coverage=349, added_recipes=[IDENTIFIER], added_styles=styles,
        changed_existing_recipes=[], changed_source_hashes=changed_sources,
        admission_unchanged=True, native_calls=0, canonical_files_written=False,
        candidate_recipe_sha256=sha((candidate_root / DATA / 'recipes.json').read_bytes()))
    exact.write(OUT / 'comparison.json', report)
    return report


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action', choices=['snapshot', 'verify-baseline', 'compare'])
    parser.add_argument('--candidate-root', type=Path, default=ROOT)
    args = parser.parse_args()
    if args.action == 'snapshot':
        report = snapshot()
    elif args.action == 'verify-baseline':
        check_saved_baseline()
        report = dict(status='baseline_hashes_verified', canonical_files_written=False)
    else:
        report = compare(args.candidate_root.resolve())
    print(json.dumps(report, ensure_ascii=False, indent=2))
