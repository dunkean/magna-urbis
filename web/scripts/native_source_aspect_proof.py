"""Bounded Java128 replay proof; no builds, servers, city generation or overwrite.

Prepare and run the frozen baseline:
  python web/scripts/native_source_aspect_proof.py --before
Run the separate three-site exterior/interior baseline:
  python web/scripts/native_source_aspect_proof.py --before-details
After root freezes the new CLI:
  python web/scripts/native_source_aspect_proof.py --after PATH --after-sha256 HASH
"""
import argparse
from collections import Counter
import hashlib
import json
import math
from pathlib import Path
import re
import shutil
import statistics
import subprocess
import time

from native_foundation_compare import audit_phase, float_bits, surface

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / 'web/out/java-source-aspect-proof'
PRIOR = ROOT / 'web/out/java-row-selection-proof'
CATALOGUE = ROOT / 'rust/crates/houses/data/recipes.json'
BEFORE = ROOT / 'web/out/native-entry-existing-door-cli-proof/plan_replay.exe'
BEFORE_SHA = '01148b07da054a8241feb063cea5fc17b8a52604531705438311ae210f6038f1'
REQUEST_SHA = '28e500f04b584fc122eaf36ac3fc232a4bc51fa4570eb7b6a54d2f18836f4852'
BUDGET = re.compile(r'; (\d+)/8 dimension pairs, (\d+)/24 rigid poses, (\d+) admitted;')
TERRAIN_GUIDE = re.compile(r'^Source aspect terrain guide: (\d+)/8 exact rectangle terrain evaluations; (\d+)/1 reduced dimension allocated')


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def read(path):
    return json.loads(path.read_bytes())


def save(path, value):
    with path.open('x', encoding='utf-8', newline='\n') as f:
        json.dump(value, f, ensure_ascii=False, indent=2, allow_nan=False)
        f.write('\n')


def prepare():
    assert sha(BEFORE) == BEFORE_SHA
    assert sha(PRIOR / 'requests.json') == REQUEST_SHA
    assert read(PRIOR / 'manifest.json')['request_sha256'] == REQUEST_SHA
    requests = read(PRIOR / 'requests.json')['requests']
    assert len(requests) == len({r['id'] for r in requests}) == 128
    OUT.mkdir(exist_ok=False)
    for source, name in [(PRIOR / 'requests.json', 'requests.json'),
                         (PRIOR / 'manifest.json', 'selection-manifest.json'),
                         (CATALOGUE, 'catalogue-snapshot.json')]:
        shutil.copyfile(source, OUT / name)
        assert sha(source) == sha(OUT / name)
    save(OUT / 'manifest.json', dict(schema_version='java-source-aspect-proof-1',
        request_sha256=REQUEST_SHA, count=128, baseline_cli_sha256=BEFORE_SHA,
        inputs={name:sha(OUT / name) for name in
                ['requests.json', 'selection-manifest.json', 'catalogue-snapshot.json']},
        runner_sha256_at_prepare=sha(Path(__file__)),
        purpose='Same exact archived Java128 requests and order; source-aspect projection comparison, not population capacity.',
        limitations=['Single runs retain timing for provenance only; no performance conclusion.',
                     'No interior realization or new city generation.',
                     'Keep all refusals, admission losses and budget regressions.']))


def verify_inputs():
    manifest = read(OUT / 'manifest.json')
    for name, expected in manifest['inputs'].items():
        assert sha(OUT / name) == expected, f'Changed frozen input: {name}'
    return manifest


def run_phase(phase, cli, expected):
    verify_inputs()
    cli = cli.resolve()
    assert sha(cli) == expected, 'CLI checksum mismatch'
    paths = {key:OUT / f'{phase}-{name}' for key, name in
             [('plans','plans.json'), ('stdout','stdout.log'), ('stderr','stderr.log'), ('metrics','metrics.json')]}
    assert all(not p.exists() for p in paths.values()), 'Refusing phase overwrite'
    command = [str(cli), str(OUT / 'requests.json'), str(paths['plans'])]
    started = time.perf_counter()
    try:
        result = subprocess.run(command, capture_output=True, timeout=120, check=False)
        stdout, stderr, code = result.stdout, result.stderr, result.returncode
    except subprocess.TimeoutExpired as error:
        stdout, stderr, code = error.stdout or b'', error.stderr or b'', None
    elapsed = time.perf_counter() - started
    # Write the actual UTF-8 streams as bytes, without PowerShell re-encoding.
    for key, data in [('stdout',stdout), ('stderr',stderr)]:
        data.decode('utf-8', errors='strict')
        with paths[key].open('xb') as f:
            f.write(data)
    native = json.loads(stdout) if code == 0 else None
    save(paths['metrics'], dict(schema_version='java-source-aspect-run-1', phase=phase,
        command=command, cli_sha256=expected, request_sha256=REQUEST_SHA,
        returncode=code, wall_seconds=elapsed, native=native,
        plans_sha256=sha(paths['plans']) if paths['plans'].exists() else None,
        runner_sha256=sha(Path(__file__)), performance_scope='One run, no timing inference.'))
    assert code == 0, f'{phase} native replay failed; raw streams retained'
    assert sha(cli) == expected and sha(OUT / 'requests.json') == REQUEST_SHA
    if phase == 'before':
        assert paths['plans'].read_bytes() == (PRIOR / 'after-plans.json').read_bytes(), \
            'Same frozen baseline CLI and requests unexpectedly changed output'
    print(json.dumps(dict(phase=phase, **{k:native[k] for k in ['accepted','refused','open']},
                          plans_sha256=sha(paths['plans'])), ensure_ascii=False))


def detail_input():
    """Keep exact fixture tokens and prove each occurs in the original sample."""
    target = OUT / 'three-requests.json'
    if target.exists():
        metadata = read(OUT / 'three-manifest.json')
        assert sha(target) == metadata['request_sha256']
        return target
    fixture = ROOT / 'rust/crates/houses/tests/fixtures/java-source-aspect-three.json'
    raw = fixture.read_bytes()
    text = raw.decode('utf-8')
    original = (OUT / 'requests.json').read_text(encoding='utf-8')
    decoder = json.JSONDecoder()
    cursor = text.index('[', text.index('"requests"')) + 1
    records = []
    while True:
        while text[cursor].isspace():
            cursor += 1
        if text[cursor] == ']':
            break
        value,end = decoder.raw_decode(text,cursor)
        fragment = text[cursor:end]
        assert fragment in original, 'Three-site fixture changed a source JSON token'
        records.append(dict(id=value['id'], raw_sha256=hashlib.sha256(fragment.encode('utf-8')).hexdigest()))
        cursor=end
        while text[cursor].isspace():
            cursor+=1
        if text[cursor] == ',':
            cursor+=1
    assert len(records)==3 and len({r['id'] for r in records})==3
    with target.open('xb') as f:
        f.write(raw)
    save(OUT / 'three-manifest.json',dict(schema_version='java-aspect-details-input-1',
        source=str(fixture.relative_to(ROOT)), request_sha256=sha(target),
        parent_requests_sha256=REQUEST_SHA, sites=records,
        purpose='Separate three actual sites, native exterior/interior realization; not128 interiors.'))
    return target


def run_details(phase, cli, expected):
    verify_inputs()
    cli=cli.resolve()
    assert sha(cli)==expected
    requests=detail_input()
    paths={k:OUT / f'{phase}-three-{v}' for k,v in [('plans','plans.json'),('report','details.json'),
        ('stdout','stdout.log'),('stderr','stderr.log'),('metrics','metrics.json')]}
    assert all(not p.exists() for p in paths.values()), 'Refusing detail phase overwrite'
    command=[str(cli),str(requests),str(paths['plans']),'--details',str(paths['report'])]
    started=time.perf_counter()
    try:
        result=subprocess.run(command,capture_output=True,timeout=120,check=False)
        stdout,stderr,code=result.stdout,result.stderr,result.returncode
    except subprocess.TimeoutExpired as error:
        stdout,stderr,code=error.stdout or b'',error.stderr or b'',None
    elapsed=time.perf_counter()-started
    for key,data in [('stdout',stdout),('stderr',stderr)]:
        data.decode('utf-8',errors='strict')
        with paths[key].open('xb') as f:
            f.write(data)
    save(paths['metrics'],dict(command=command,cli_sha256=expected,requests_sha256=sha(requests),
        returncode=code,wall_seconds=elapsed,runner_sha256=sha(Path(__file__)),
        performance_scope='Single targeted detail run; no timing inference.'))
    assert code==0, 'Targeted native details failed; raw streams retained'
    details=read(paths['report'])
    print(json.dumps(dict(phase=phase,three_site_details=details['details']),ensure_ascii=False))


def lookup(batch, requests):
    rows = [(b['id'], ('accepted', b)) for b in batch['buildings']]
    rows += [(b['id'], ('refused', b)) for b in batch['refusals']]
    rows += [(b['id'], ('open', b)) for b in batch['open_spaces']]
    assert len(rows) == len(dict(rows)) == len(requests)
    assert {k for k,_ in rows} == {r['id'] for r in requests}
    return dict(rows)


def bundle(catalogue, building):
    recipe = next(r for r in catalogue['recipes'] if r['id'] == building['recipe_id'])
    candidates = [recipe['parameters']] + [v['parameters'] for v in recipe['variants']]
    return next(p for p in candidates if p['variant_id'] == building['variant_id'])


def accepted(request, building, catalogue):
    p = bundle(catalogue, building)
    compact = float_bits(building['resolved'])
    assert compact['catalogue_version'] == catalogue['catalogue_version']
    w, d = p['width_m'], p['depth_m']
    size = compact['config']['size']
    ratio = [w[0]/d[1], w[1]/d[0]]
    simple = (p['layout'] == 'single' and p['footprint_family'] == 'FP-RECT'
              and p['bodies'] == [1,1] and len(compact['bodies']) == 1
              and (not p['components'] or (len(p['components']) == 1
                   and p['components'][0]['id'] == 'main'
                   and p['components'][0]['width_ratio'] == [1,1]
                   and p['components'][0]['depth_ratio'] == [1,1])))
    bodies = []
    for body in compact['bodies']:
        geometry = surface(compact['surfaces'][body['footprint']])
        xmin, ymin, xmax, ymax = geometry.bounds
        width, depth = xmax-xmin, ymax-ymin
        delta = compact['parameters'][body['parameters']]
        params = {k:v for k,v in p.items() if k not in delta['remove']}
        params.update(delta['set'])
        # The measured local body is primary; retained parameters can describe
        # a larger nominal envelope after a constrained native adaptation.
        grid = [math.floor(width*1000+.5)/1000, math.floor(depth*1000+.5)/1000]
        aspect_ok = lambda a,b: a*d[1] >= b*w[0] and a*d[0] <= b*w[1]
        rectangle = geometry.geom_type == 'Polygon' and not geometry.interiors \
            and abs(geometry.area-width*depth) <= 1e-8
        bodies.append(dict(role=body['role'], component=body['component'], levels=len(body['levels']),
            local_width_m=width, local_depth_m=depth, local_body_area_m2=geometry.area,
            local_bbox_ratio=width/depth, is_rectangle=rectangle,
            retained_nominal_width_m=params['width_m'], retained_nominal_depth_m=params['depth_m'],
            source_ratio_applicable=simple and rectangle,
            source_ratio_exact_ok=aspect_ok(width,depth) if simple and rectangle else None,
            source_ratio_at_mm_ok=aspect_ok(*grid) if simple and rectangle else None,
            measured_mm_dimensions=grid,
            nominal_source_minima_ok=(width >= w[0]*size and depth >= d[0]*size) if simple else None))
    trace = next((v for v in building['diagnostics'] if v.startswith('Domestic footprint budget:')), None)
    match = BUDGET.search(trace or '')
    budget = dict(zip(['pairs','poses','admitted'], map(int, match.groups()))) if match else None
    if budget:
        assert budget['pairs'] <= 8 and budget['poses'] <= 24
    guide_trace = next((v for v in building['diagnostics'] if v.startswith('Source aspect terrain guide:')), None)
    guide = None
    if guide_trace:
        match = TERRAIN_GUIDE.search(guide_trace)
        assert match, 'Unknown terrain-guide trace; update parser explicitly'
        guide = dict(zip(['evaluations','corrections'], map(int, match.groups())))
        assert guide['evaluations'] <= 8 and guide['corrections'] <= 1
        assert budget is not None, 'Terrain guide must share the counted ordinary budget'
    geometry_hashes = {key:hashlib.sha256(json.dumps(building[key], sort_keys=True,
        separators=(',',':'), allow_nan=False).encode('utf-8')).hexdigest() for key in
        ['footprint','roof_footprint','courtyards','circulation','structural_features']}
    area = surface(building['footprint']).area
    target = (request.get('programme') or {}).get('built_area_m2')
    return dict(state='accepted', recipe=building['recipe_id'], variant=building['variant_id'],
        source_layout=p['layout'], source_width_m=w, source_depth_m=d, source_ratio=ratio, size=size,
        seed=compact['config']['seed'], body_area_m2=area, useful_area_m2=building['useful_area_m2'],
        target_ratio=area/target if target else None,
        absolute_target_error_m2=abs(area-target) if target else None,
        log_target_error=abs(math.log(area/target)) if target else None,
        target_within_ten_percent=abs(area/target-1)<=.1 if target else None,
        body_levels=[len(v['levels']) for v in building['volumes']], bodies=bodies,
        roof_systems=[v['roof_system'] for v in building['volumes']],
        transform=building['transform'], budget=budget, budget_diagnostic=trace,
        terrain_guide=guide, terrain_guide_diagnostic=guide_trace,
        entrance=building['entrance'], access_id=building['access_id'],
        retained_native_entrance=compact['entrance'], geometry_hashes=geometry_hashes,
        native_entry_diagnostics=[d for d in building['diagnostics'] if
            'Native planning entrance' in d or 'Single native entrance' in d])


def distribution(values):
    return dict(min=min(values), median=statistics.median(values), max=max(values)) if values else None


def quality(rows, phase):
    valid = [r for r in rows if r.get('target_m2') and r[phase]['state'] == 'accepted']
    return dict(count=len(valid), target_sum_m2=sum(r['target_m2'] for r in valid),
        body_sum_m2=sum(r[phase]['body_area_m2'] for r in valid),
        absolute_error_sum_m2=sum(r[phase]['absolute_target_error_m2'] for r in valid),
        log_error_sum=sum(r[phase]['log_target_error'] for r in valid),
        body_distribution_m2=distribution([r[phase]['body_area_m2'] for r in valid]),
        body_target_ratio=distribution([r[phase]['target_ratio'] for r in valid]),
        within_ten_percent=sum(r[phase]['target_within_ten_percent'] for r in valid))


def compare():
    verify_inputs()
    requests = read(OUT / 'requests.json')['requests']
    catalogue = read(OUT / 'catalogue-snapshot.json')
    batches = {p:read(OUT / f'{p}-plans.json') for p in ['before','after']}
    values = {p:lookup(b,requests) for p,b in batches.items()}
    audits = {}
    for phase,batch in batches.items():
        audit = audit_phase(requests,batch)
        save(OUT / f'{phase}-rights-terrain-audit.json', audit)
        audits[phase] = {k:v for k,v in audit.items() if k != 'sites'}
    rows = []
    for request in requests:
        rid = request['id']; programme = request.get('programme') or {}
        row = dict(id=rid, function=request['function'], role=programme.get('role'),
                   composition=programme.get('composition'), target_m2=programme.get('built_area_m2'))
        for phase in batches:
            state, value = values[phase][rid]
            row[phase] = accepted(request,value,catalogue) if state == 'accepted' else dict(state=state, result=value)
        old,new = values['before'][rid],values['after'][rid]
        row['whole_result_changed'] = old != new
        if old[0] == new[0] == 'accepted':
            row['changed_fields'] = [k for k in ['recipe','variant','body_levels','seed','roof_systems','bodies','transform',
                                               'entrance','access_id','retained_native_entrance','geometry_hashes']
                                     if row['before'][k] != row['after'][k]]
            row['body_area_delta_m2'] = row['after']['body_area_m2']-row['before']['body_area_m2']
            if row['target_m2']:
                delta = row['after']['absolute_target_error_m2']-row['before']['absolute_target_error_m2']
                row['absolute_error_delta_m2'] = delta
                row['log_error_delta'] = row['after']['log_target_error']-row['before']['log_target_error']
                row['target_quality'] = 'improved' if delta < -1e-4 else 'worsened' if delta > 1e-4 else 'equal'
        rows.append(row)
    common = [r for r in rows if r['before']['state'] == r['after']['state'] == 'accepted']
    changed = [r for r in common if r['whole_result_changed']]
    budgets = {}
    terrain_guides = {}
    for phase in batches:
        counters = [r[phase]['budget'] for r in rows if r[phase]['state']=='accepted' and r[phase]['budget']]
        budgets[phase] = dict(traces=len(counters), pairs_total=sum(c['pairs'] for c in counters),
            poses_total=sum(c['poses'] for c in counters), pairs_max=max((c['pairs'] for c in counters),default=0),
            poses_max=max((c['poses'] for c in counters),default=0),
            native_ms_single_run=read(OUT / f'{phase}-metrics.json')['native']['ms'])
        guides = [r[phase]['terrain_guide'] for r in rows if r[phase]['state']=='accepted' and r[phase]['terrain_guide']]
        terrain_guides[phase] = dict(traces=len(guides), evaluations_total=sum(c['evaluations'] for c in guides),
            evaluations_max=max((c['evaluations'] for c in guides), default=0),
            corrections_total=sum(c['corrections'] for c in guides),
            corrections_max=max((c['corrections'] for c in guides), default=0))
    report = dict(schema_version='java-source-aspect-comparison-1',
        provenance={name:sha(OUT/name) for name in ['requests.json','manifest.json','catalogue-snapshot.json',
            'before-plans.json','after-plans.json','before-metrics.json','after-metrics.json']},
        scripts={str(p.relative_to(ROOT)):sha(p) for p in [Path(__file__),Path(__file__).with_name('native_foundation_compare.py')]},
        counts={p:dict(Counter(state for state,_ in v.values())) for p,v in values.items()},
        styles={p:dict(Counter(b['recipe_id']+'::'+b['variant_id'] for b in batch['buildings'])) for p,batch in batches.items()},
        lost=[r['id'] for r in rows if r['before']['state']=='accepted' and r['after']['state']!='accepted'],
        gained=[r['id'] for r in rows if r['before']['state']!='accepted' and r['after']['state']=='accepted'],
        changes=[r['id'] for r in rows if r['whole_result_changed']],
        source_variant_floor_changes=[r['id'] for r in common if set(r['changed_fields']) & {'recipe','variant','body_levels'}],
        entry_changes=[r['id'] for r in common if set(r['changed_fields']) & {'entrance','access_id','retained_native_entrance'}],
        native_entries={p:dict(
            retained=sum(r[p]['retained_native_entrance'] is not None for r in rows if r[p]['state']=='accepted'),
            upgraded=sum(any(d.startswith('Native planning entrance upgrade:') for d in r[p]['native_entry_diagnostics']) for r in rows if r[p]['state']=='accepted'),
            deferred=sum(any(d.startswith('Native planning entrance deferred:') for d in r[p]['native_entry_diagnostics']) for r in rows if r[p]['state']=='accepted')) for p in batches},
        target_quality=dict(Counter(r.get('target_quality','no_target') for r in common)),
        regressions=[r for r in common if r.get('target_quality')=='worsened'],
        quality={scope:{p:quality(selected,p) for p in batches} for scope,selected in [('all_common',common),('changed_common',changed)]},
        source_ratio_bad_at_mm={p:[r['id'] for r in rows if r[p]['state']=='accepted'
            and any(b['source_ratio_at_mm_ok'] is False for b in r[p]['bodies'])] for p in batches},
        budgets=budgets, terrain_guides=terrain_guides, rights=audits, sites=rows,
        separate_three_site_details={p:read(OUT / f'{p}-three-details.json') for p in batches},
        limits=['Exact archived sample128, not complete city or capacity evidence.',
                'Actual local body dimensions and nominal retained ranges are reported separately.',
                'Source aspect evaluated only for simple Single/RECT unit-axis body; all others Unknown.',
                'Exact and nearest-mm aspect flags are both reported; mm is diagnostic, not a geometry repair.',
                'Original admitted incumbents can remain outside new proposal rules; inspect changes rather than infer blanket certification.',
                'GEOS rights audit threshold0.0001m2; terrain helper checks explicitly prepared Strip and Single foundations. Legacy nativeFoundation totals remain Strip-only; allPreparedTerrainViolationBuildings covers both. Deferred plans are not terrain-certified by this helper.',
                'One native run per phase: milliseconds are provenance, not a performance claim.',
                'Only the separate3site report realizes exteriors/interiors; no128site detail or household-capacity certification.'])
    save(OUT / 'report.json',report)
    summary = {k:report[k] for k in ['counts','lost','gained','source_variant_floor_changes','target_quality','budgets','terrain_guides','native_entries','rights']}
    summary['changes']=len(report['changes']);summary['regressions']=len(report['regressions'])
    print(json.dumps(summary, ensure_ascii=False))
    # Keep the complete report even if a narrow-regression contract fails.
    assert not report['lost'], 'An originally admitted site was lost'
    assert not report['gained'], 'Admission set unexpectedly changed in this post-admission comparison'
    assert not report['source_variant_floor_changes'], 'Source/variant/floors unexpectedly changed'
    for phase,audit in audits.items():
        assert not audit['rightsViolationBuildings'], f'{phase}: independent GEOS rights violation'
        assert not audit['allPreparedTerrainViolationBuildings'], f'{phase}: prepared Strip/Single terrain violation'


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument('--before',action='store_true')
    mode.add_argument('--before-details',action='store_true')
    mode.add_argument('--after',type=Path)
    parser.add_argument('--after-sha256')
    args = parser.parse_args()
    if args.before:
        prepare()
        run_phase('before',BEFORE,BEFORE_SHA)
    elif args.before_details:
        run_details('before',BEFORE,BEFORE_SHA)
    else:
        if not args.after_sha256 or not re.fullmatch('[0-9a-f]{64}',args.after_sha256):
            parser.error('--after requires --after-sha256 with the frozen binary checksum')
        run_phase('after',args.after,args.after_sha256)
        run_details('after',args.after,args.after_sha256)
        compare()


if __name__ == '__main__':
    main()
