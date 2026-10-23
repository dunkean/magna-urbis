"""Replay the twelve frozen V1 witnesses in V2's own exact batch context.

No reselection, build, server or modification of V1 evidence. Every native
detail result requires exact equality with the corresponding full V2 plan.
"""
import argparse
import json
import subprocess

import b06_light_targeted_details as common

ROOT = common.ROOT
V1 = ROOT / 'web/out/java-c-b06-light-proof/C-targeted-details'
AFTER = ROOT / 'web/out/java-c-b06-light-v2-proof'
OUT = AFTER / 'C-targeted-details'
CLI = ROOT / 'web/out/b06-light-v2-native-proof/plan_replay.exe'
CLI_SHA = 'da619c6695287c562db6b18c69bf471ad92ffe0a6d1ebddc745b9fc6384bcf09'


def prepare():
    assert common.sha(CLI.read_bytes()) == CLI_SHA
    frozen = common.read(V1 / 'selection.json')
    assert len(frozen['selected']) == 12
    OUT.mkdir(exist_ok=False)
    rows = []
    for selected in frozen['selected']:
        row = dict(selected)
        folder = OUT / row['folder']
        folder.mkdir()
        stem = row['chunk']
        rp, bp = [AFTER / 'after' / f'{stem}-{suffix}.json' for suffix in ['request', 'plans']]
        request_text, batch_text = rp.read_text(encoding='utf-8'), bp.read_text(encoding='utf-8')
        records = common.items(common.raw_field(request_text, 'requests'))
        raw_request, request = records[row['withinChunk']]
        assert request['id'] == row['id']
        plans = common.items(common.raw_field(batch_text, 'buildings'))
        matches = [(raw, b) for raw, b in plans if b['id'] == row['id']]
        assert len(matches) == 1, 'Fixed witness admission changed; stop without substitution'
        raw_plan, reference = matches[0]
        predecessor_ids = {r['id'] for _, r in records[:row['withinChunk']]}
        predecessors = [(raw, b) for raw, b in plans if b['id'] in predecessor_ids]
        query_box = common.box([request['cadastral']])
        neighbor_fragments, neighborhood = [], []
        for raw, b in predecessors:
            parts = [(name, common.raw_field(raw, name), b[name])
                     for name in ['footprint', 'courtyards', 'circulation']]
            parts.extend((f'structural_features/{i}', common.raw_field(fr, 'surface'), f['surface'])
                         for i, (fr, f) in enumerate(common.items(common.raw_field(raw, 'structural_features'))))
            if not common.overlap(query_box, common.box([s for _, _, s in parts if s])):
                continue
            height = max(0., *(v['z_m'] + v['wall_height_m'] + v['roof_height_m'] - b['ground_z_m']
                              for v in b['volumes']))
            for i, (label, raw_surface, part) in enumerate(parts):
                if not part:
                    continue
                nid = f'{b["id"]}/same-batch-occupation/{i}'
                assert nid not in {n['id'] for n in request['neighbors']}
                neighbor_fragments.append('{"id":' + json.dumps(nid) + ',"footprint":' + raw_surface
                    + ',"height_m":' + json.dumps(height, allow_nan=False) + '}')
                neighborhood.append(dict(id=nid, predecessor=b['id'], part=label,
                    surfaceSha256=common.sha(raw_surface.encode())))
        _, z, existing = common.fields(raw_request)['neighbors']
        insertion = (',' if existing and neighbor_fragments else '') + ','.join(neighbor_fragments)
        replay_request = raw_request[:z-1] + insertion + raw_request[z-1:]
        parsed_replay = json.loads(replay_request)
        assert {**parsed_replay, 'neighbors': request['neighbors']} == request
        assert parsed_replay['neighbors'][:len(existing)] == existing
        a, b, _ = common.fields(request_text)['requests']
        payload = request_text[:a] + '[' + replay_request + ']' + request_text[b:]
        texts = {'original-enriched-request.json': raw_request, 'reference-plan.json': raw_plan,
                 'predecessors.json': '[' + ','.join(raw for raw, _ in predecessors) + ']',
                 'request.json': payload}
        for name, text in texts.items():
            (folder / name).write_text(text, encoding='utf-8', newline='')
        v1plan = common.read(V1 / row['folder'] / 'reference-plan.json')
        row.update(v1RetainedEntrance=bool(v1plan['resolved'].get('entrance')),
            v2RetainedEntrance=bool(reference['resolved'].get('entrance')),
            v1AreaM2=common.surface(v1plan['footprint']).area,
            v2AreaM2=common.surface(reference['footprint']).area,
            v1ToV2ChangedFields=common.differences(v1plan, reference),
            v2Diagnostics=reference['diagnostics'])
        common.save(folder / 'context.json', dict(sourceRequests=str(rp.relative_to(ROOT)),
            sourcePlans=str(bp.relative_to(ROOT)), sourceRequestsSha256=common.sha(rp.read_bytes()),
            sourcePlansSha256=common.sha(bp.read_bytes()),
            originalRequestSha256=common.sha(raw_request.encode()), replayRequestSha256=common.sha(payload.encode()),
            referencePlanSha256=common.sha(raw_plan.encode()), predecessorCount=len(predecessors),
            priorChunkNeighbors=len(existing), addedSameChunkParts=neighborhood,
            method='Exact V2 request tokens plus V2 same-chunk predecessor occupation parts. No V1 neighbors or geometry reused. Fixed witness identity; no outcome-based substitution.'))
        rows.append(row)
    common.save(OUT / 'selection.json', dict(version='b06-light-fixed-targeted-details-2',
        cliSha256=CLI_SHA, frozenSelection=str((V1/'selection.json').relative_to(ROOT)),
        frozenSelectionSha256=common.sha((V1/'selection.json').read_bytes()),
        sourceManifestSha256=common.sha((AFTER/'manifest.json').read_bytes()), selected=rows,
        selection='Exactly the twelve V1 IDs and order; own V2 requests and predecessor context; no substitution.'))
    print(json.dumps({'prepared': len(rows), 'retainedEntriesV2': sum(r['v2RetainedEntrance'] for r in rows),
        'indices': [r['sourceIndex'] for r in rows]}), flush=True)


def run():
    selection = common.read(OUT / 'selection.json')
    assert common.sha(CLI.read_bytes()) == CLI_SHA == selection['cliSha256']
    results = []
    for row in selection['selected']:
        folder = OUT / row['folder']
        assert not (folder / 'plans.json').exists(), 'Only one replay per fixed witness'
        command = [str(CLI), str(folder/'request.json'), str(folder/'plans.json'), '--details', str(folder/'details.json')]
        proc = subprocess.run(command, capture_output=True, timeout=60, cwd=ROOT)
        (folder/'stdout.log').write_bytes(proc.stdout)
        (folder/'stderr.log').write_bytes(proc.stderr)
        assert common.sha(CLI.read_bytes()) == CLI_SHA
        plans = common.read(folder/'plans.json') if proc.returncode == 0 else {}
        expected = common.read(folder/'reference-plan.json')
        actual = plans.get('buildings', [])
        diff = common.differences(expected, actual[0]) if len(actual) == 1 else ['accepted_count']
        details = common.read(folder/'details.json') if (folder/'details.json').exists() else None
        result = dict(id=row['id'], sourceIndex=row['sourceIndex'], folder=row['folder'],
            returncode=proc.returncode, exactPlanEqual=not diff, differingPaths=diff[:60],
            detailResultsConditional=bool(diff), details=details, command=command,
            retainedEntranceV2=row['v2RetainedEntrance'], v1AreaM2=row['v1AreaM2'], v2AreaM2=row['v2AreaM2'])
        common.save(folder/'verification.json', result)
        results.append(result)
        print(json.dumps(dict(sourceIndex=row['sourceIndex'], exact=not diff,
            retainedEntrance=row['v2RetainedEntrance'], details=details and
            [(d['interiors'], d['ok'], d['error']) for d in details['details']], differences=diff[:6])), flush=True)
        if proc.returncode or diff:
            common.save(OUT/'report.json', dict(status='STOPPED_ON_DIVERGENCE', results=results,
                selected=12, executed=len(results), cliSha256=CLI_SHA))
            raise SystemExit('Context or plan drift: stop; no substitution or certified details.')
    common.save(OUT/'report.json', dict(status='complete', cliSha256=CLI_SHA, selected=12, results=results,
        retainedEntries=sum(r['retainedEntranceV2'] for r in results),
        exteriorPassed=sum(d['ok'] and not d['interiors'] for r in results for d in r['details']['details']),
        interiorPassed=sum(d['ok'] and d['interiors'] for r in results for d in r['details']['details']),
        scope='Fixed twelve V1 witnesses, own V2 occupation, exact full-C PlanBuilding identity required. Proxy negatives retained; no selection by detail outcome, no capacity or city-wide success-rate claim.'))


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('action', choices=['prepare', 'run'])
    args = parser.parse_args()
    prepare() if args.action == 'prepare' else run()
