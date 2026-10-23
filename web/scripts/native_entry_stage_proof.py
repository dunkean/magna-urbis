"""Replay two frozen corpora and eight details with a frozen CLI, without a server.

The independent GEOS audit checks all exported rights and native bearing terrain.
This is not a city throughput, interior coverage or population-capacity benchmark.
"""
import argparse
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import subprocess
import sys

from native_foundation_compare import audit_phase

ROOT = Path(__file__).resolve().parents[2]
REQUESTS = {
    'primary': ROOT / 'web/out/strip-initial-budget-proof/requests.json',
    'secondary': ROOT / 'web/out/native-entry-secondary-proof/requests.json',
    'eight': ROOT / 'web/out/native-foundation-detail-proof/requests.json',
}


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def read(path):
    return json.loads(path.read_bytes())


def save(path, value):
    with path.open('x', encoding='utf-8') as stream:
        json.dump(value, stream, ensure_ascii=False, indent=2, allow_nan=False)
        stream.write('\n')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--cli', type=Path, required=True)
    parser.add_argument('--before', type=Path, required=True,
                        help='Existing primary-plans.json and secondary-plans.json directory')
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=False)
    binary = args.cli.resolve()
    executable_hash = sha(binary)
    rows = {}
    for label, requests in REQUESTS.items():
        request_hash = sha(requests)
        target = args.output / f'{label}-plans.json'
        command = [str(binary), str(requests), str(target)]
        if label == 'eight':
            command += ['--details', str(args.output / 'eight-details.json')]
        result = subprocess.run(command, capture_output=True, timeout=60)
        (args.output / f'{label}-stdout.log').write_bytes(result.stdout)
        (args.output / f'{label}-stderr.log').write_bytes(result.stderr)
        result.check_returncode()
        metric = json.loads(result.stdout.strip().splitlines()[-1])
        save(args.output / f'{label}-metrics.json', metric)
        assert sha(requests) == request_hash and sha(binary) == executable_hash
        row = dict(requestSha256=request_hash, planSha256=sha(target),
                   native={k: metric[k] for k in ('accepted', 'refused', 'open', 'ms')})
        if label != 'eight':
            comparison = args.output / f'{label}-entry-comparison.json'
            compared = subprocess.run([
                sys.executable, str(Path(__file__).with_name('native_entry_report.py')),
                str(args.before / f'{label}-plans.json'), str(target), str(comparison)
            ], capture_output=True, timeout=30)
            (args.output / f'{label}-comparison.log').write_bytes(compared.stdout + compared.stderr)
            compared.check_returncode()
            full_comparison = read(comparison)
            row['comparison'] = {k: v for k, v in full_comparison.items()
                                 if k not in ('sites', 'scope', 'inputs')}
            audit = audit_phase(read(requests)['requests'], read(target))
            save(args.output / f'{label}-rights-terrain-audit.json', audit)
            row['audit'] = {k: v for k, v in audit.items() if k != 'sites'}
            assert not audit['rightsViolationBuildings']
            assert not audit['nativeTerrainViolationBuildings']
            assert not audit.get('allPreparedTerrainViolationBuildings', [])
            assert not full_comparison['lost'], 'An admitted house was lost'
        else:
            details = read(args.output / 'eight-details.json')['details']
            row['details'] = {
                name: dict(total=sum(d['interiors'] == interiors for d in details),
                           accepted=sum(d['interiors'] == interiors and d['ok'] for d in details))
                for name, interiors in [('exterior', False), ('interior', True)]
            }
        rows[label] = row
        print(json.dumps({label: row}, ensure_ascii=False), flush=True)
    save(args.output / 'report.json', dict(
        version='native-entry-stage-proof-1', capturedUtc=datetime.now(timezone.utc).isoformat(),
        executable=str(binary), executableSha256=executable_hash,
        scriptSha256=sha(Path(__file__)), results=rows,
        scope='Frozen requests, local CLI only. Eight detail witnesses, not a city acceptance rate. '
              'Times are single runs; source, pose, area and refusal changes remain explicit.'))


if __name__ == '__main__':
    main()
