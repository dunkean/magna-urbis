"""Extract exact archived Java requests; no native execution, city or server."""
from collections import Counter, defaultdict
from decimal import Decimal
import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "web/out/javanese-user-10-8791"
OUTPUT = ROOT / "web/out/java-row-selection-proof"
REFERENCE_CLI = ROOT / "web/out/native-entry-one-bend-cli-proof/plan_replay.exe"


def sha(data):
    return hashlib.sha256(data).hexdigest()


def relative(path):
    return path.relative_to(ROOT).as_posix()


def exact_objects(text):
    """Retain every original decimal token, rather than re-encoding floats."""
    decoder = json.JSONDecoder()
    cursor = text.index(':', text.index('"placementRequests"')) + 1
    while text[cursor].isspace():
        cursor += 1
    assert text[cursor] == '['
    cursor += 1
    while True:
        while text[cursor].isspace():
            cursor += 1
        if text[cursor] == ']':
            return
        value, end = decoder.raw_decode(text, cursor)
        assert isinstance(value, dict)
        yield value, text[cursor:end]
        cursor = end
        while text[cursor].isspace():
            cursor += 1
        if text[cursor] == ',':
            cursor += 1
        else:
            assert text[cursor] == ']'


def stratum(request):
    programme = request.get('programme') or {}
    config = request.get('config') or {}
    return (request['function'], programme.get('role'),
            programme.get('composition'), config.get('recipe'))


def quantiles(indices, count):
    count = min(len(indices), count)
    return [indices[(i * (len(indices) - 1)) // (count - 1)]
            for i in range(count)] if count > 1 else indices[:count]


def counts(rows):
    return {
        'functions': dict(sorted(Counter(r['function'] for r in rows).items())),
        'roles': dict(sorted(Counter((r.get('programme') or {}).get('role') for r in rows).items())),
        'compositions': dict(sorted(Counter((r.get('programme') or {}).get('composition') for r in rows).items())),
        'pinned': sum((r.get('config') or {}).get('recipe') is not None for r in rows),
        'rowHouseTenementAutomatic': sum(
            r['function'] in ('domestic', 'mixed')
            and (r.get('programme') or {}).get('role') in ('dwelling.house', 'dwelling.tenement')
            and (r.get('programme') or {}).get('composition') == 'row'
            and (r.get('config') or {}).get('recipe') is None for r in rows),
    }


def main():
    if OUTPUT.exists():
        raise FileExistsError(f"Refusing to overwrite proof directory: {OUTPUT}")
    source_files, records = [], []
    for page in sorted(SOURCE.glob('*-buildingSitesPage-response.json')):
        raw = page.read_bytes()
        full = json.loads(raw)
        objects = list(exact_objects(raw.decode('utf-8')))
        assert len(objects) == len(full['placementRequests'])
        assert full['offset'] == len(records)
        assert full['next'] == full['offset'] + len(objects)
        assert full['total'] == 1752
        source_files.append(dict(path=relative(page), sha256=sha(raw), bytes=len(raw),
                                 offset=full['offset'], count=len(objects), next=full['next']))
        for page_index, (value, original_json) in enumerate(objects):
            assert value == full['placementRequests'][page_index]
            records.append(dict(value=value, raw=original_json, page=relative(page),
                                page_index=page_index, index=len(records)))
    assert len(source_files) == 28 and len(records) == 1752
    assert len({r['value']['id'] for r in records}) == len(records)
    strata = defaultdict(list)
    for row in records:
        strata[stratum(row['value'])].append(row['index'])
    reasons = defaultdict(list)
    def select(index, reason):
        reasons[index].append(reason)
    for index in quantiles(list(range(len(records))), 96):
        select(index, '96 evenly spaced global indices, endpoints included')
    for key, indices in sorted(strata.items(), key=lambda kv: json.dumps(kv[0])):
        select(indices[(len(indices) - 1) // 2], 'median index of function/role/composition/source-pin stratum')
    houses = [r['index'] for r in records if (r['value'].get('programme') or {}).get('role') == 'dwelling.house']
    for index in quantiles(houses, 4):
        select(index, 'four index quantiles of the rarer dwelling.house role')
    assert len(reasons) <= 128
    while len(reasons) < 128:
        selected = sorted(reasons)
        # Maximise distance to the nearest selected global index. Lower index
        # wins ties. There is no random state and no architectural outcome input.
        candidate = max((i for i in range(len(records)) if i not in reasons),
                        key=lambda i: (min(abs(i - j) for j in selected), -i))
        select(candidate, 'largest remaining global-index gap, lower-index tie break')
    chosen = [records[i] for i in sorted(reasons)]
    payload = ('{"schema_version":"1","requests":[' +
               ','.join(r['raw'] for r in chosen) + ']}\n').encode('utf-8')
    # Decimal semantic equality complements exact per-object source-token hashes.
    reread = json.loads(payload, parse_float=Decimal)['requests']
    assert reread == [json.loads(r['raw'], parse_float=Decimal) for r in chosen]
    assert {stratum(r['value']) for r in chosen} == set(strata)
    assert {r['page'] for r in chosen} == {p['path'] for p in source_files}
    summary_path = SOURCE / 'summary.json'
    summary_raw = summary_path.read_bytes()
    runs = json.loads(summary_raw)['terminal']['probe']['runs']
    historical = next(r for r in runs.values() if r.get('accepted') == 484 and r.get('refused') == 1261)
    manifest = dict(
        schema_version='java-row-selection-proof-1',
        purpose='Compare frozen one-bend CLI and final CLI on exact archived sites; no population-capacity inference.',
        request_file='requests.json', request_sha256=sha(payload), request_bytes=len(payload),
        source_count=len(records), selected_count=len(chosen),
        source_files=source_files,
        historical_summary=dict(path=relative(summary_path), sha256=sha(summary_raw),
            accepted=historical['accepted'], refused=historical['refused'], open=historical['openSpaces']),
        reference_cli=dict(path=relative(REFERENCE_CLI), sha256=sha(REFERENCE_CLI.read_bytes())),
        extraction_script=dict(path=relative(Path(__file__)), sha256=sha(Path(__file__).read_bytes())),
        current_recipes_sha256=sha((ROOT / 'rust/crates/houses/data/recipes.json').read_bytes()),
        selection='96 global index quantiles + median of each exact function/role/composition/pin stratum + 4 house quantiles + largest index gaps to128; original global order retained.',
        source_counts=counts([r['value'] for r in records]),
        selected_counts=counts([r['value'] for r in chosen]),
        selected=[dict(global_index=r['index'], page=r['page'], page_index=r['page_index'],
                       id=r['value']['id'], stratum=stratum(r['value']),
                       source_object_sha256=sha(r['raw'].encode('utf-8')),
                       reasons=reasons[r['index']]) for r in chosen],
        limits=[
            'Requests are exact source objects: source pins, seeds, settings, geometry, neighbors and decimal tokens are unchanged.',
            'This is an intentionally stratified regression sample, not a representative estimator of city acceptance.',
            'Only neighbors embedded in each captured request are retained. Unselected prior houses and the original chunk-by-chunk accumulated occupation are absent.',
            'The historical484/1261/7 counts describe all1752 sites with an old catalogue/runtime, not this128 sample or either comparison CLI.',
            'The final native selection still enforces present cultural palettes and constraints. No role/pin/programme modernization is performed.',
            'No native process, city generation or server is invoked by this preparation.',
        ])
    OUTPUT.mkdir(parents=True, exist_ok=False)
    (OUTPUT / 'requests.json').write_bytes(payload)
    (OUTPUT / 'manifest.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    assert sha((OUTPUT / 'requests.json').read_bytes()) == manifest['request_sha256']
    for entry in source_files:
        assert sha((ROOT / entry['path']).read_bytes()) == entry['sha256']
    print(json.dumps({k:manifest[k] for k in ('request_sha256', 'request_bytes', 'source_count', 'selected_count', 'selected_counts')}, ensure_ascii=False))


if __name__ == '__main__':
    main()
