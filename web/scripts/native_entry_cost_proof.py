"""Five alternating small CLI replays, with identity checks and no server."""
import argparse
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import statistics
import subprocess

REPO = Path(__file__).resolve().parents[2]
REQUESTS = REPO / 'web/out/strip-initial-budget-proof/requests.json'
BEFORE = REPO / 'web/out/native-foundation-cli-proof/plan_replay.exe'


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--before', type=Path, default=BEFORE)
    parser.add_argument('--requests', type=Path, default=REQUESTS)
    parser.add_argument('--after', required=True, type=Path)
    parser.add_argument('--output', required=True, type=Path)
    args = parser.parse_args()
    args.output.mkdir(exist_ok=False, parents=True)
    executables = {'before': args.before.resolve(), 'after': args.after.resolve()}
    requests = args.requests.resolve()
    hashes = {name: digest(path) for name, path in executables.items()}
    reference_hashes, rows = {}, []
    request_hash = digest(requests)
    for run in range(5):
        for name in ('before', 'after'):
            output = args.output / f'{name}-plans.json'
            command = [str(executables[name]), str(requests), str(output)]
            result = subprocess.run(command, capture_output=True, text=True, encoding='utf-8', timeout=60)
            (args.output / f'{name}-{run}.stdout.log').write_text(result.stdout, encoding='utf-8')
            (args.output / f'{name}-{run}.stderr.log').write_text(result.stderr, encoding='utf-8')
            result.check_returncode()
            metric = json.loads(result.stdout.strip().splitlines()[-1])
            plan_hash = digest(output)
            reference_hashes.setdefault(name, plan_hash)
            if plan_hash != reference_hashes[name]:
                raise ValueError(f'{name}: replay identity changed on run {run}')
            rows.append(dict(phase=name, run=run, planSha256=plan_hash, native=metric))
    if digest(requests) != request_hash or any(digest(p) != hashes[k] for k, p in executables.items()):
        raise ValueError('Frozen executable or requests changed')
    times = {phase: [r['native']['ms'] for r in rows if r['phase'] == phase] for phase in executables}
    medians = {phase: statistics.median(values) for phase, values in times.items()}
    report = dict(version='native-entry-cost-proof-1', capturedUtc=datetime.now(timezone.utc).isoformat(),
                  requestPath=str(requests), requestSha256=request_hash, executableSha256=hashes,
                  executablePaths={k:str(v) for k,v in executables.items()},
                  nativeMs=times, medianMs=medians,
                  medianChangePercent=100*(medians['after']/medians['before']-1),
                  repeatedOutputIdentical=True, rows=rows,
                  scope='Five alternating executions per phase, same 128 frozen requests. Process startup and JSON serialization are outside the reported native calculation time. Entry preparation adds work; this is not a city, million-population or UI performance claim.')
    (args.output / 'report.json').write_text(json.dumps(report, ensure_ascii=False, indent=2)+'\n', encoding='utf-8')
    print(json.dumps({k:report[k] for k in ['nativeMs','medianMs','medianChangePercent','repeatedOutputIdentical']}, ensure_ascii=False))


if __name__ == '__main__':
    main()
