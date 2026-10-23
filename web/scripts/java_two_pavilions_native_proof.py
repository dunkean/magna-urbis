"""One fixed parent/derived-compound proof; never selects a replacement lot."""
from hashlib import sha256
import json
from pathlib import Path
import subprocess
import time

ROOT = Path(__file__).resolve().parents[2]
SOURCE = ROOT / '_agents_blackboard/proposals/java_two_pavilions'
OUT = ROOT / 'web/out/java-two-pavilions-native-proof'
CLI = ROOT / 'web/out/houses-nominal-terrain-production-proof/plan_replay.exe'
EXPECTED = 'ad10d1f7f41dcf407d4832039da147586d460b1d4e8cf201b3379cfb35e23077'


def save(path, data):
    with path.open('xb') as f:
        f.write(data)


def main():
    assert sha256(CLI.read_bytes()).hexdigest() == EXPECTED
    OUT.mkdir(parents=True, exist_ok=False)
    parent = json.loads((SOURCE / 'parent-reference-request.json').read_bytes())
    # The independent bbox-context check found zero prior native local
    # occupations and zero original enriched neighbours for this exact site.
    assert parent['neighbors'] == []
    inputs = {
        'parent': (json.dumps({'schema_version': '1', 'requests': [parent]},
                              ensure_ascii=False, separators=(',', ':')) + '\n').encode('utf8'),
        'two-pavilions': (SOURCE / 'requests.json').read_bytes(),
    }
    phases = []
    for name, data in inputs.items():
        request = OUT / f'{name}-requests.json'
        plans = OUT / f'{name}-plans.json'
        detail = OUT / f'{name}-details.json'
        save(request, data)
        command = [str(CLI), str(request), str(plans), '--details', str(detail)]
        start = time.perf_counter()
        result = subprocess.run(command, cwd=ROOT, capture_output=True,
                                timeout=120, creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
        elapsed = (time.perf_counter() - start) * 1000
        save(OUT / f'{name}-stdout.log', result.stdout)
        save(OUT / f'{name}-stderr.log', result.stderr)
        assert result.returncode == 0, result.stderr.decode('utf8', errors='replace')
        output = json.loads(plans.read_bytes())
        phases.append({'name': name, 'command': command, 'exit_code': result.returncode,
                       'wall_ms_including_details': elapsed,
                       'input_sha256': sha256(data).hexdigest(),
                       'plans_sha256': sha256(plans.read_bytes()).hexdigest(),
                       'details_sha256': sha256(detail.read_bytes()).hexdigest(),
                       'accepted': len(output['buildings']), 'refused': len(output['refusals'])})
        print(json.dumps(phases[-1]), flush=True)
    manifest = {'version': 'two-pavilions-native-proof-1', 'cli': str(CLI.relative_to(ROOT)),
                'cli_sha256': EXPECTED, 'source_fixture': str(SOURCE.relative_to(ROOT)),
                'source_manifest_sha256': sha256((SOURCE / 'manifest.json').read_bytes()).hexdigest(),
                'runner_sha256': sha256(Path(__file__).read_bytes()).hexdigest(),
                'context': 'Parent native-local prior occupation is empty (bbox), matching archived batch074 position56. Derived children preserve all original prior occupied parts as explicit neighbours, and plan_batch accumulates part0 before part1.',
                'scope': 'Exactly one C lot, source index4792. Shared walk/court are derived proposals inside original rights, not existing source rights. No capacity claim.',
                'phases': phases}
    save(OUT / 'manifest.json', (json.dumps(manifest, indent=2, ensure_ascii=False) + '\n').encode('utf8'))


if __name__ == '__main__':
    main()
