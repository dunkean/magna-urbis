"""Preserve/audit the house golden fixture without running or installing a generator."""
import argparse
import collections
import hashlib
import importlib.util
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = Path(__file__).resolve().parent / 'house-contract-v3-proof'
FIXTURES = ROOT / 'rust/fixtures/houses'
spec = importlib.util.spec_from_file_location('exact_admission_diff',
    Path(__file__).with_name('check_roman_b12_admission_export.py'))
exact = importlib.util.module_from_spec(spec)
spec.loader.exec_module(exact)


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def summary(batch):
    return dict(schema=batch['schema_version'], catalogue=batch['catalogue_version'],
                generator=batch['generator_version'], settings=batch['settings'],
                units=[dict(id=u['id'], recipe=u['recipe_id'], variant=u['variant_id'],
                            bodies=len(u['bodies']), rooms=len(u['rooms']), walls=len(u['walls']),
                            features=len(u['features']), levels=len(u['levels']),
                            body_levels=[len(b['levels']) for b in u['bodies']],
                            portals=len(u['access']['portals']),
                            roof_vertices=len(u['roofs']['vertices']), roof_faces=len(u['roofs']['faces']))
                       for u in batch['units']])


def snapshot():
    OUT.mkdir(exist_ok=True)
    for source, name in [('batch-reference.json', 'before.json'), ('config-reference.json', 'config-reference.json')]:
        data = (FIXTURES / source).read_bytes()
        target = OUT / name
        if target.exists():
            assert target.read_bytes() == data, 'Refusing to replace a different golden baseline.'
        else:
            target.write_bytes(data)
    report = dict(status='baseline_saved_native_pending', batch_sha256=sha(OUT / 'before.json'),
                  config_sha256=sha(OUT / 'config-reference.json'),
                  before=summary(exact.checked_read(OUT / 'before.json')),
                  native_calls=0, canonical_written=False)
    exact.write(OUT / 'baseline.json', report)
    return report


def compare(candidate):
    baseline = OUT / 'before.json'
    assert (OUT / 'config-reference.json').read_bytes() == (FIXTURES / 'config-reference.json').read_bytes()
    before, after = exact.checked_read(baseline), exact.checked_read(candidate)
    changes = exact.differences(before, after)
    groups = collections.Counter()
    for change in changes:
        parts = change['path'].split('/')
        group = '/'.join(parts[:4]) if len(parts) >= 4 and parts[1] == 'units' else '/' + parts[1]
        groups[group] += 1
    stable = {}
    for a, b in zip(before['units'], after['units']):
        stable[a['id']] = {
            key: a.get(key) == b.get(key)
            for key in ['recipe_id', 'variant_id', 'role', 'transform', 'lot', 'partition',
                        'level_partitions', 'levels', 'bodies', 'rooms', 'features', 'walls',
                        'site_context', 'access', 'roofs', 'diagnostics']
        }
    report = dict(status='review_required' if changes else 'identical',
                  before_sha256=sha(baseline), after_sha256=sha(candidate),
                  candidate=str(candidate.resolve().relative_to(ROOT)),
                  before=summary(before), after=summary(after),
                  change_count=len(changes), groups=dict(sorted(groups.items())),
                  stable_unit_fields=stable, differences=changes,
                  native_calls=0, canonical_written=False)
    exact.write(OUT / 'comparison.json', report)
    return report


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    actions = parser.add_subparsers(dest='action', required=True)
    actions.add_parser('snapshot')
    command = actions.add_parser('compare')
    command.add_argument('candidate', type=Path)
    args = parser.parse_args()
    result = snapshot() if args.action == 'snapshot' else compare(args.candidate)
    print(json.dumps({k: v for k, v in result.items()
                      if k not in {'before', 'after', 'differences'}}, indent=2))
