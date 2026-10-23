"""Snapshot/compare the bounded B12 admission export; never generate or merge it.

snapshot copies the current old artifact beneath the blackboard.
compare reads a separate candidate export and fails on every unapproved drift.
The default strict-b12 mode allows only the verified source_sha256 transition.
The separately reviewed access-v3 migration is pinned to two exact file hashes;
it permits only its recorded envelope reductions and houses-2 -> houses-3.
It is not a general permission to change native minima or admission statuses.
"""
import argparse
import hashlib
import json
import math
from decimal import Decimal
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / 'rust/crates/houses/data'
OUT = Path(__file__).resolve().parent / 'roman-b12-admission-check'
SOURCE_PROOF = Path(__file__).resolve().parent / 'roman-b12-export-before.json'
RECIPE_ID = 'MED-ANT-B12'
STYLE_ID = RECIPE_ID + '::default'
ACCESS_V3_MIGRATION = dict(
    id='native-opposed-asymmetric-access-houses-3',
    before_sha256='4027e31b2f574d4a71020c4401755f7d96b08f0d7ebc4cf19f19424d16c11108',
    after_sha256='5d9e96fd6a6d5b91adabde61d073c60f0ac36df8259372f41322126e6eea25cc',
    before_generator='houses-2', after_generator='houses-3',
    changed_profiles=122, changed_styles=223,
)


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def read(path, exact=True):
    return json.loads(path.read_text(encoding='utf-8-sig'),
                      parse_float=Decimal if exact else float)


def reject_constant(value):
    raise ValueError('Non-JSON numeric constant: ' + value)


def checked_read(path):
    # Repeated object keys must not disappear before structural comparison.
    def unique(pairs):
        value = {}
        for key, item in pairs:
            if key in value:
                raise ValueError('Duplicate JSON object key: ' + key)
            value[key] = item
        return value
    return json.loads(path.read_text(encoding='utf-8-sig'), parse_float=Decimal,
                      parse_constant=reject_constant, object_pairs_hook=unique)


def write(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    # Decimal strings in diagnostics retain exact differing wire numbers.
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2, default=str) + '\n',
                    encoding='utf-8')


def verify_source_change():
    proof = read(SOURCE_PROOF, exact=False)
    current = read(DATA / 'recipes.json', exact=False)
    recipes = {r['id']: r for r in current['recipes']}
    old_hashes = proof['recipe_sha256']
    changed = [key for key, expected in old_hashes.items()
               if key not in recipes or hashlib.sha256(json.dumps(
                   recipes[key], ensure_ascii=False, indent=2).encode('utf-8')).hexdigest() != expected]
    assert not changed, f'Existing source recipes changed: {changed}'
    assert set(recipes) - set(old_hashes) == {RECIPE_ID}, 'Expected B12 as the sole source addition.'
    assert len(recipes) == 265 and sum(1 + len(r['variants']) for r in recipes.values()) == 418
    return proof['files']['recipes.json'], digest(DATA / 'recipes.json'), recipes[RECIPE_ID]


def indexed(rows, key):
    if not isinstance(rows, list):
        raise ValueError(f'Expected list indexed by {key}.')
    result = {}
    for row in rows:
        identifier = row[key]
        if identifier in result:
            raise ValueError(f'Duplicate {key}: {identifier}')
        result[identifier] = row
    return result


def differences(before, after, path=''):
    def pointer(key):
        return path + '/' + str(key).replace('~', '~0').replace('/', '~1')
    if isinstance(before, dict) and isinstance(after, dict):
        result = []
        for key in sorted(before.keys() | after.keys()):
            if key not in before:
                result.append(dict(path=pointer(key), change='added', after=after[key]))
            elif key not in after:
                result.append(dict(path=pointer(key), change='removed', before=before[key]))
            else:
                result.extend(differences(before[key], after[key], pointer(key)))
        return result
    if isinstance(before, list) and isinstance(after, list):
        result = []
        for i in range(max(len(before), len(after))):
            if i >= len(before):
                result.append(dict(path=pointer(i), change='added', after=after[i]))
            elif i >= len(after):
                result.append(dict(path=pointer(i), change='removed', before=before[i]))
            else:
                result.extend(differences(before[i], after[i], pointer(i)))
        return result
    # JSON numbers are compared exactly, without floating-point epsilon. Bool
    # is deliberately distinct from the numerically equal Python int 0 or 1.
    equal = before == after and (isinstance(before, bool) == isinstance(after, bool))
    return [] if equal else [dict(path=path, change='changed', before=before, after=after)]


def snapshot():
    old_hash, current_hash, _ = verify_source_change()
    path = DATA / 'urban-admission.json'
    old = checked_read(path)
    assert old['source_sha256'] == old_hash
    assert len(indexed(old['profiles'], 'recipe_id')) == 223
    assert len(indexed(old['feasibility']['profiles'], 'style_id')) == 417
    assert RECIPE_ID not in indexed(old['profiles'], 'recipe_id')
    assert STYLE_ID not in indexed(old['feasibility']['profiles'], 'style_id')
    OUT.mkdir(exist_ok=True)
    destination = OUT / 'before.json'
    if destination.exists():
        assert destination.read_bytes() == path.read_bytes(), 'Refusing to replace a different baseline.'
    else:
        destination.write_bytes(path.read_bytes())
    report = dict(status='baseline_saved_candidate_not_generated', before=str(destination.relative_to(ROOT)),
                  before_sha256=digest(destination), source_sha256_before=old_hash,
                  source_sha256_expected=current_hash, minimum_profiles=223, feasibility_profiles=417,
                  expected_added_profiles=[RECIPE_ID], expected_added_styles=[STYLE_ID],
                  export_calls=0, canonical_files_written=False)
    write(OUT / 'baseline.json', report)
    return report


def compare(before_path, after_path, report_path, mode='strict-b12'):
    assert mode in {'strict-b12', 'access-v3'}
    old_hash, new_hash, recipe = verify_source_change()
    before, after = checked_read(before_path), checked_read(after_path)
    failures = []
    before_digest, after_digest = digest(before_path), digest(after_path)
    access_migration = mode == 'access-v3'
    exact_migration = access_migration and (
        before_digest == ACCESS_V3_MIGRATION['before_sha256']
        and after_digest == ACCESS_V3_MIGRATION['after_sha256'])
    if access_migration and not exact_migration:
        failures.append(dict(path='/', reason='Access migration permits only the exact reviewed baseline and candidate checksums.'))
    if before.get('source_sha256') != old_hash:
        failures.append(dict(path='/source_sha256', reason='Baseline does not match the 264-recipe source proof.'))
    if after.get('source_sha256') != new_hash:
        failures.append(dict(path='/source_sha256', reason='Candidate does not match exact current recipes.json bytes.'))
    profiles_before = indexed(before['profiles'], 'recipe_id')
    profiles_after = indexed(after['profiles'], 'recipe_id')
    styles_before = indexed(before['feasibility']['profiles'], 'style_id')
    styles_after = indexed(after['feasibility']['profiles'], 'style_id')
    summaries = {}
    for name, old, new, expected in [
        ('profiles', profiles_before, profiles_after, {RECIPE_ID}),
        ('feasibility/profiles', styles_before, styles_after, {STYLE_ID}),
    ]:
        added, removed = sorted(new.keys() - old.keys()), sorted(old.keys() - new.keys())
        changed = {}
        for key in sorted(old.keys() & new.keys()):
            diff = differences(old[key], new[key], '/' + name + '/' + key)
            if diff:
                changed[key] = diff
        summaries[name] = dict(before=len(old), after=len(new), added=added, removed=removed,
                               unchanged=len(old) - len(removed) - len(changed), changed=changed)
        if set(added) != expected or removed or (changed and not access_migration):
            failures.append(dict(path='/' + name, reason='Unexpected profile additions/removals/changes.'))
        if access_migration:
            expected_count = ACCESS_V3_MIGRATION['changed_profiles' if name == 'profiles' else 'changed_styles']
            if len(changed) != expected_count:
                failures.append(dict(path='/' + name, reason='Reviewed access-migration change count differs.'))
            for key, changes in changed.items():
                envelope = '/min_envelope_m/' if name == 'profiles' else '/minimum_native/envelope_m/'
                allowed_paths = {'/' + name + '/' + key + envelope + str(axis) for axis in (0, 1)}
                # Even the hash-pinned candidate must contain only a single
                # positive, strictly reduced native envelope coordinate per
                # changed profile. No epsilon, status or access-width waiver.
                valid = len(changes) == 1 and all(
                    change['change'] == 'changed' and change['path'] in allowed_paths
                    and all(isinstance(change[side], (int, Decimal))
                            and not isinstance(change[side], bool)
                            and math.isfinite(change[side]) and change[side] > 0
                            for side in ('before', 'after'))
                    and change['after'] < change['before']
                    for change in changes)
                if not valid:
                    failures.append(dict(path='/' + name + '/' + key,
                                         reason='Change is outside the reviewed native-envelope reduction.'))
        old_order = list(old)
        new_existing_order = [key for key in new if key in old]
        if old_order != new_existing_order:
            failures.append(dict(path='/' + name, reason='Previous profile order changed.'))

    # Everything outside the two keyed tables is compared, except the one
    # source digest whose exact transition was independently verified above.
    def metadata(table):
        result = {k: v for k, v in table.items() if k not in {'profiles', 'source_sha256'}}
        result['feasibility'] = {k: v for k, v in table['feasibility'].items() if k != 'profiles'}
        return result
    metadata_changes = differences(metadata(before), metadata(after))
    expected_metadata = [dict(path='/generator_version', change='changed',
                             before=ACCESS_V3_MIGRATION['before_generator'],
                             after=ACCESS_V3_MIGRATION['after_generator'])]
    if metadata_changes and (not access_migration or metadata_changes != expected_metadata):
        failures.append(dict(path='/', reason='Global versions or registries changed.', differences=metadata_changes))
    if access_migration and metadata_changes != expected_metadata:
        failures.append(dict(path='/generator_version', reason='Expected exact houses-2 -> houses-3 migration.'))

    # Validate the added records against the declared recipe and shared frozen
    # default witness. This does not turn the witness into placement capacity.
    added_checks = []
    if RECIPE_ID in profiles_after and STYLE_ID in styles_after:
        minimum, feasibility = profiles_after[RECIPE_ID], styles_after[STYLE_ID]
        expected = dict(recipe_id=RECIPE_ID, pack='MED-ANT', tradition_id='roman_urban',
                        inspired_only=True, layout='single')
        for record in (minimum, feasibility):
            for key, value in expected.items():
                if record.get(key) != value:
                    added_checks.append(f'{key} differs from B12 source declaration')
        if minimum.get('floors') != [2, 2] or minimum.get('eras') != ['A']:
            added_checks.append('minimum floors/eras differ')
        if feasibility.get('primary_floors') != [2, 2] or feasibility.get('variant_id') != 'default':
            added_checks.append('primary floors/default variant differ')
        for key in ('width_m', 'depth_m'):
            if feasibility.get('nominal_' + key) != recipe['parameters'][key]:
                added_checks.append('nominal_' + key + ' differs')
        if feasibility.get('household_range') is not None or feasibility.get('placement_certified') is not False:
            added_checks.append('unknown capacity or mandatory placement check was lost')
        witness = feasibility.get('minimum_native', {})
        if minimum.get('status') != 'supported' or witness.get('status') != 'supported':
            added_checks.append('B12 minimum native witness did not succeed')
        if minimum.get('refusal') is not None or witness.get('refusal') is not None:
            added_checks.append('supported B12 still carries refusal')
        if minimum.get('min_envelope_m') != witness.get('envelope_m'):
            added_checks.append('legacy and feasibility minimum envelope differ')
        if minimum.get('min_access_width_m') != witness.get('access_width_m'):
            added_checks.append('legacy and feasibility access widths differ')
        values = minimum.get('min_envelope_m', []) + [minimum.get('min_access_width_m')]
        if len(values) != 3 or not all(isinstance(v, (int, Decimal)) and not isinstance(v, bool)
                                       and math.isfinite(v) and v > 0 for v in values):
            added_checks.append('non-positive/invalid native geometry bounds')
        if witness.get('seed') != 'urban-admission-v1:' + RECIPE_ID:
            added_checks.append('default witness seed changed')
    if added_checks:
        failures.append(dict(path='/' + RECIPE_ID, reason='Added profile checks failed.', details=added_checks))
    report = dict(status='passed' if not failures else 'failed', mode=mode,
                  before_sha256=before_digest, after_sha256=after_digest,
                  allowed_global_change=dict(path='/source_sha256', before=old_hash, after=new_hash,
                                             justification='B12 sole source addition; 264 previous recipes identical'),
                  tables=summaries, failures=failures, native_generation_by_checker=False,
                  canonical_files_written=False)
    if access_migration:
        report['access_migration'] = dict(**ACCESS_V3_MIGRATION, exact_checksums_verified=exact_migration,
                                        metadata_changes=metadata_changes)
    write(report_path, report)
    return report


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest='action', required=True)
    sub.add_parser('snapshot')
    check = sub.add_parser('compare')
    check.add_argument('candidate', type=Path)
    check.add_argument('--before', type=Path, default=OUT / 'before.json')
    check.add_argument('--report', type=Path, default=OUT / 'comparison.json')
    check.add_argument('--mode', choices=['strict-b12', 'access-v3'], default='strict-b12')
    args = parser.parse_args()
    result = snapshot() if args.action == 'snapshot' else compare(args.before, args.candidate, args.report, args.mode)
    print(json.dumps({k: v for k, v in result.items() if k != 'tables'}, ensure_ascii=False, indent=2))
    if result['status'] == 'failed':
        raise SystemExit(1)
