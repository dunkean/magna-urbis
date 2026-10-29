"""Opt-in real CUDA job through the public connector API (no paid provider calls)."""
import argparse
import base64
import json
from pathlib import Path
import time
import urllib.request


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--server', default='http://127.0.0.1:8794')
    parser.add_argument('--mode', choices=['fast', 'quality'], default='fast')
    parser.add_argument('--variant', choices=['base', 'lightning', 'distilled'])
    parser.add_argument('--steps', type=int)
    parser.add_argument('--reference', choices=['source', 'source+edges', 'source+depth', 'edges'], default='source+edges')
    parser.add_argument('--source', default='web/out/work/illustration/source.png')
    parser.add_argument('--depth')
    parser.add_argument('--control', choices=['auto', 'edges', 'depth', 'both'], default='auto')
    parser.add_argument('--output', default='web/out/work/illustration')
    args = parser.parse_args()
    variant = args.variant or ('base' if args.mode == 'quality' else 'lightning')
    if (args.mode == 'fast' and variant == 'distilled') or (args.mode == 'quality' and variant == 'lightning'):
        parser.error('Variant incompatible with engine.')
    def request(path, body=None):
        req = urllib.request.Request(args.server + path, json.dumps(body).encode() if body is not None else None,
                                     {'Content-Type': 'application/json'})
        with urllib.request.urlopen(req, timeout=30) as response:
            return json.load(response)
    def encoded(path): return 'data:image/png;base64,' + base64.b64encode(Path(path).read_bytes()).decode()
    body = {'version': 1, 'image': encoded(args.source),
            'guides': {'depth': encoded(args.depth)} if args.depth else {},
            'context': {'application': 'magna-urbis', 'sourceStyle': 'parchment',
                        'projection': 'perspective' if args.depth else 'orthographic',
                        'environment': {'relief': 'hills', 'climate': 'warm temperate'}},
            'settings': {'mode': args.mode, 'steps': args.steps or (30 if variant == 'base' else 4), 'seed': 42,
                         'sdxlVariant' if args.mode == 'fast' else 'fluxVariant': variant, 'referenceMode': args.reference,
                         'style': 'auto', 'fidelity': 'strong', 'pixels': 786432, 'control': args.control}}
    job = request('/v1/illustrations/jobs', body)
    previous = None
    for _ in range(600):
        job = request('/v1/illustrations/jobs/' + job['id'])
        state = job['status'], job['progress']
        if state != previous:
            print(state, job['message'], flush=True); previous = state
        if job['status'] in ('succeeded', 'failed', 'cancelled'):
            break
        time.sleep(1)
    if job['status'] != 'succeeded':
        raise RuntimeError(job['message'])
    output = Path(args.output); output.mkdir(parents=True, exist_ok=True)
    (output / f'service-{args.mode}.json').write_text(json.dumps(job, indent=2, ensure_ascii=False), encoding='utf-8')
    with urllib.request.urlopen(args.server + f'/v1/illustrations/jobs/{job["id"]}/result.png', timeout=10) as response:
        (output / f'service-{args.mode}.png').write_bytes(response.read())
    assert job['provenance']['controls'], 'A structural guide must actually reach the model.'
    if args.control == 'both':
        assert job['provenance']['controls'] == ['edges', 'depth']
    print(json.dumps({'id': job['id'], 'seconds': job['totalSeconds'], 'size': job['outputSize']}), flush=True)


if __name__ == '__main__': main()
