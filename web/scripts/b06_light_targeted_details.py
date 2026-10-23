"""Freeze twelve new B06 entries, then replay once each with same-lot context.

No build/server. Selection is frozen before any native result is inspected.
Raw JSON tokens are preserved for original requests and predecessor surfaces.
Every detail result is conditional on full PlanBuilding equality to C7921.
"""
import argparse
from collections import Counter
import hashlib
import json
import math
from pathlib import Path
import subprocess

from native_foundation_compare import surface, terrain_bounds

ROOT = Path(__file__).resolve().parents[2]
AFTER = ROOT / 'web/out/java-c-b06-light-proof'
BEFORE = ROOT / 'web/out/java-c-lintel-production-proof'
OUT = AFTER / 'C-targeted-details'
CLI = ROOT / 'web/out/b06-light-native-proof-full/plan_replay.exe'
CLI_SHA = '30be517bcd3c7649496c86e970b8792e19b91f97fe3cf9a69ad6ec991cc5eb0f'
DECODER = json.JSONDecoder()


def read(path): return json.loads(path.read_bytes())
def sha(data): return hashlib.sha256(data).hexdigest()
def save(path, value):
    with path.open('x', encoding='utf-8', newline='\n') as f:
        json.dump(value, f, ensure_ascii=False, indent=2, allow_nan=False)
        f.write('\n')


def fields(text):
    """Raw top-level field value spans, without re-encoding float literals."""
    i = text.index('{') + 1
    result = {}
    while True:
        while text[i].isspace(): i += 1
        if text[i] == '}': return result
        key, i = DECODER.raw_decode(text, i)
        while text[i].isspace(): i += 1
        assert text[i] == ':'
        i += 1
        while text[i].isspace(): i += 1
        start = i
        value, i = DECODER.raw_decode(text, i)
        result[key] = (start, i, value)
        while text[i].isspace(): i += 1
        if text[i] == ',': i += 1
        else: assert text[i] == '}'


def items(text):
    i = text.index('[') + 1
    result = []
    while True:
        while text[i].isspace(): i += 1
        if text[i] == ']': return result
        start = i
        value, i = DECODER.raw_decode(text, i)
        result.append((text[start:i], value))
        while text[i].isspace(): i += 1
        if text[i] == ',': i += 1
        else: assert text[i] == ']'


def raw_field(text, key):
    a, b, _ = fields(text)[key]
    return text[a:b]


def box(parts):
    points = [p for s in parts for polygon in s for p in polygon['outer']]
    return [min(p['x'] for p in points), min(p['y'] for p in points),
            max(p['x'] for p in points), max(p['y'] for p in points)]


def overlap(a, b):
    return a[0] <= b[2] and a[2] >= b[0] and a[1] <= b[3] and a[3] >= b[1]


def prepare():
    assert sha(CLI.read_bytes()) == CLI_SHA
    candidates = []
    counts = Counter()
    offset = 0
    for path in sorted((AFTER / 'after').glob('*-plans.json')):
        stem = path.name[:3]
        current, old = read(path), read(BEFORE / 'after' / path.name)
        before = {b['id']: b for b in old['buildings']}
        request_file = path.with_name(stem + '-request.json')
        requests = read(request_file)['requests']
        request_by_id = {r['id']: (i, r) for i, r in enumerate(requests)}
        counts.update({'requests': len(requests), 'accepted': len(current['buildings']),
                       'refused': len(current['refusals']), 'open': len(current['open_spaces'])})
        for b in current['buildings']:
            was = before.get(b['id'])
            entry = bool(b['resolved'].get('entrance'))
            old_entry = bool(was and was['resolved'].get('entrance'))
            counts['all_native_entries_after'] += entry
            counts['all_native_entries_before'] += old_entry
            counts['all_new_entries'] += entry and not old_entry
            counts['all_lost_entries'] += old_entry and not entry
            if b['recipe_id'] != 'AS-ISL-B06': continue
            counts['b06_accepted'] += 1
            counts['b06_native_entries_after'] += entry
            counts['b06_native_entries_before'] += old_entry
            if not entry or old_entry: continue
            assert was is not None
            index, r = request_by_id[b['id']]
            body = surface(b['footprint'])
            changed = b['footprint'] != was['footprint'] or b['roof_footprint'] != was['roof_footprint']
            target = r.get('programme', {}).get('built_area_m2')
            if target is None or target <= 0:
                target = None
                counts['b06_new_without_positive_target'] += 1
            kinds = Counter(f['kind'] for f in b['structural_features'])
            assert kinds['post'] == 4 and kinds['frame'] == 1
            # Exact raster measure is descriptive for selection, not admission.
            lo, hi, slope = terrain_bounds(r['terrain'], body)
            candidates.append(dict(id=b['id'], chunk=stem, withinChunk=index,
                sourceIndex=offset + index, geometryChanged=changed,
                areaM2=body.area, targetM2=target, ratio=body.area / target if target else None,
                foundationStepM=hi-lo, bodySlopeDeg=slope,
                featureCount=len(b['structural_features']), featureKinds=dict(kinds)))
        offset += len(requests)
    assert counts['requests'] == 7921
    counts['b06_new_entries'] = len(candidates)
    counts['b06_new_geometry_changed'] = sum(c['geometryChanged'] for c in candidates)
    choices = []
    selectors = [
        ('smallest_body', lambda c: c['areaM2']),
        ('largest_body', lambda c: -c['areaM2']),
        ('closest_target', lambda c: abs(c['ratio'] - 1) if c['ratio'] is not None else math.inf),
        ('furthest_below_target', lambda c: c['ratio'] if c['ratio'] is not None else math.inf),
        ('steepest_body_raster', lambda c: -c['bodySlopeDeg']),
        ('most_structural_features', lambda c: -c['featureCount']),
    ]
    for changed in [False, True]:
        pool = [c for c in candidates if c['geometryChanged'] == changed]
        for reason, key in selectors:
            selected = min(pool, key=lambda c: (key(c), c['sourceIndex'], c['id']))
            pool.remove(selected)
            choices.append(dict(selected, selectionReason=reason))
    choices.sort(key=lambda c: c['sourceIndex'])
    OUT.mkdir(exist_ok=False)
    for ordinal, row in enumerate(choices):
        folder = OUT / f'{ordinal:02d}-{row["sourceIndex"]}'
        folder.mkdir()
        row['folder'] = folder.name
        stem = row['chunk']
        rp, bp = [AFTER / 'after' / f'{stem}-{suffix}.json' for suffix in ['request', 'plans']]
        request_text, batch_text = rp.read_text(encoding='utf-8'), bp.read_text(encoding='utf-8')
        request_records = items(raw_field(request_text, 'requests'))
        raw_request, request = request_records[row['withinChunk']]
        assert request['id'] == row['id']
        plans = items(raw_field(batch_text, 'buildings'))
        plan_records = {b['id']: (raw, b) for raw, b in plans}
        raw_plan, reference = plan_records[row['id']]
        predecessor_ids = {r['id'] for _, r in request_records[:row['withinChunk']]}
        predecessors = [(raw, b) for raw, b in plans if b['id'] in predecessor_ids]
        neighborhood, neighbor_fragments = [], []
        query_box = box([request['cadastral']])
        for raw, b in predecessors:
            parts = [(name, raw_field(raw, name), b[name]) for name in ['footprint', 'courtyards', 'circulation']]
            parts.extend((f'structural_features/{i}', raw_field(fr, 'surface'), f['surface'])
                         for i, (fr, f) in enumerate(items(raw_field(raw, 'structural_features'))))
            if not overlap(query_box, box([s for _, _, s in parts if s])): continue
            height = max(0., *(v['z_m'] + v['wall_height_m'] + v['roof_height_m'] - b['ground_z_m'] for v in b['volumes']))
            for i, (label, raw_surface, s) in enumerate(parts):
                if not s: continue
                nid = f'{b["id"]}/same-batch-occupation/{i}'
                assert nid not in {n['id'] for n in request['neighbors']}
                neighbor_fragments.append('{"id":' + json.dumps(nid) + ',"footprint":' + raw_surface
                    + ',"height_m":' + json.dumps(height, allow_nan=False) + '}')
                neighborhood.append(dict(id=nid, predecessor=b['id'], part=label, surfaceSha256=sha(raw_surface.encode())))
        a, z, existing = fields(raw_request)['neighbors']
        raw_neighbors = raw_request[a:z]
        insertion = (',' if existing and neighbor_fragments else '') + ','.join(neighbor_fragments)
        replay_request = raw_request[:z-1] + insertion + raw_request[z-1:]
        parsed_replay = json.loads(replay_request)
        assert {**parsed_replay, 'neighbors': request['neighbors']} == request
        assert parsed_replay['neighbors'][:len(existing)] == existing
        header_a, header_b, _ = fields(request_text)['requests']
        payload = request_text[:header_a] + '[' + replay_request + ']' + request_text[header_b:]
        (folder / 'original-enriched-request.json').write_text(raw_request, encoding='utf-8', newline='')
        (folder / 'reference-plan.json').write_text(raw_plan, encoding='utf-8', newline='')
        (folder / 'predecessors.json').write_text('[' + ','.join(raw for raw, _ in predecessors) + ']', encoding='utf-8', newline='')
        (folder / 'request.json').write_text(payload, encoding='utf-8', newline='')
        save(folder / 'context.json', dict(sourceRequests=str(rp.relative_to(ROOT)), sourcePlans=str(bp.relative_to(ROOT)),
            sourceRequestsSha256=sha(rp.read_bytes()), sourcePlansSha256=sha(bp.read_bytes()),
            originalRequestSha256=sha(raw_request.encode()), replayRequestSha256=sha(payload.encode()),
            referencePlanSha256=sha(raw_plan.encode()), predecessorCount=len(predecessors),
            priorChunkNeighbors=len(existing), addedSameChunkParts=neighborhood,
            method='Original numeric tokens retained; append all exact native occupation parts of spatially relevant earlier accepted houses from this SAME chunk. No union, shape edit, seed or programme change. One request per CLI call prevents double occupation.'))
    save(OUT / 'selection.json', dict(version='b06-light-targeted-details-1', cliSha256=CLI_SHA,
        baseline=str(BEFORE.relative_to(ROOT)), after=str(AFTER.relative_to(ROOT)), counts=dict(counts),
        selection='Six stable-body/roof and six changed-body/roof new B06 entries; greedy deterministic extremes by area, target proximity, shortfall, raster slope and feature count, ties by original source index. No native outcome used to select or replace a witness.',
        candidates=candidates, selected=choices))
    print(json.dumps(dict(prepared=12, counts=dict(counts), selected=choices), ensure_ascii=False), flush=True)


def differences(a, b, path=''):
    if type(a) != type(b): return [path]
    if isinstance(a, dict):
        return [p for k in a.keys() | b.keys() for p in (differences(a.get(k), b.get(k), path+'/'+k))]
    if isinstance(a, list):
        if len(a) != len(b): return [path+'/length']
        return [p for i, (x,y) in enumerate(zip(a,b)) for p in differences(x,y,path+'/'+str(i))]
    return [] if a == b else [path]


def run():
    selection = read(OUT / 'selection.json')
    assert sha(CLI.read_bytes()) == CLI_SHA == selection['cliSha256']
    result_rows = []
    for row in selection['selected']:
        folder = OUT / row['folder']
        assert not (folder / 'plans.json').exists(), 'Each selected witness may run only once'
        command = [str(CLI), str(folder/'request.json'), str(folder/'plans.json'), '--details', str(folder/'details.json')]
        proc = subprocess.run(command, capture_output=True, timeout=60, cwd=ROOT)
        (folder/'stdout.log').write_bytes(proc.stdout)
        (folder/'stderr.log').write_bytes(proc.stderr)
        assert sha(CLI.read_bytes()) == CLI_SHA
        plans = read(folder/'plans.json') if proc.returncode == 0 else {}
        expected = read(folder/'reference-plan.json')
        actual = plans.get('buildings', [])
        diff = differences(expected, actual[0]) if len(actual) == 1 else ['accepted_count']
        details = read(folder/'details.json') if (folder/'details.json').exists() else None
        result = dict(id=row['id'], sourceIndex=row['sourceIndex'], folder=row['folder'],
            returncode=proc.returncode, exactPlanEqual=not diff, differingPaths=diff[:60],
            detailResultsConditional=bool(diff), details=details, command=command)
        save(folder/'verification.json', result)
        result_rows.append(result)
        print(json.dumps(dict(sourceIndex=row['sourceIndex'], exact=not diff,
            details=details and [(d['interiors'],d['ok'],d['error']) for d in details['details']], differences=diff[:6])), flush=True)
        if proc.returncode or diff:
            save(OUT/'report.json', dict(status='STOPPED_ON_DIVERGENCE', results=result_rows,
                selected=12, executed=len(result_rows), cliSha256=CLI_SHA))
            raise SystemExit('Plan/context drift: stopped; no witness substituted or result certified.')
    save(OUT/'report.json', dict(status='complete', cliSha256=CLI_SHA, selected=12,
        counts=selection['counts'], results=result_rows,
        exteriorPassed=sum(d['ok'] and not d['interiors'] for r in result_rows for d in r['details']['details']),
        interiorPassed=sum(d['ok'] and d['interiors'] for r in result_rows for d in r['details']['details']),
        scope='Twelve deterministically selected NEW B06 entrances, all replayed plans exactly equal to full C. Not an unbiased detailed-success rate, no household capacity certification.'))


if __name__ == '__main__':
    p=argparse.ArgumentParser();p.add_argument('action',choices=['prepare','run']);args=p.parse_args()
    prepare() if args.action=='prepare' else run()
