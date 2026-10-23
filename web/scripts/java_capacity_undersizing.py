"""Derived diagnostics for admitted domestic/mixed plans; never generates a house."""
from pathlib import Path
from collections import Counter, defaultdict
import hashlib, json, math, re

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT/'web/out/java-r5-capacity-houses-proof'
def load(p): return json.loads(p.read_bytes())
def sha(p): return hashlib.sha256(p.read_bytes()).hexdigest()
def save(p, data):
    with p.open('x', encoding='utf8') as f:
        json.dump(data, f, ensure_ascii=False, indent=2, allow_nan=False); f.write('\n')
source = load(OUT/'catalogue-snapshot.json')
recipes = {r['id']: r for r in source['recipes']}
rows = {r['id']: r for r in load(OUT/'sites-evidence.json')}
summary = load(OUT/'after/summary.json')
analysed, services = [], []

def source_bounds(p, config, fit):
    # Match the conservative Single/RECT descriptor in style_index.rs, then
    # narrow further to the three actual source geometries in this frozen proof.
    # It is an upper bound before site/roof/terrain/access; never a fit certificate.
    c = p['components']
    simple = (p['layout']=='single' and p['footprint_family']=='FP-RECT'
        and p['support']['kind']=='ground' and p['envelope']=='walled'
        and p['bodies']==[1,1] and p['cells'][1]==0 and not p['gallery_cover']['enabled']
        and not p['enclosures'] and p['court_program'] is None and p['structural_spec'] is None
        and p['shell'] is None and not p['roof_spec'].get('shell') and not p['roof_spec'].get('corbel')
        and not any(d in ['arcade','jetty','jetties','street_jetty'] for d in p['details'])
        and (not c or len(c)==1 and c[0]['id']=='main' and c[0]['width_ratio']==[1,1] and c[0]['depth_ratio']==[1,1])
        and not any(v is not None for v in config.get('overrides',{}).values()))
    if not simple: return None
    size=config['size']; allowance=2 if fit and config['mode']!='historical_strict' else 1
    nominal=[p['width_m'][i]*p['depth_m'][i]*size*size for i in [0,1]]
    upper=math.prod(math.ceil(p[k][1]*size*allowance/.001)*.001 for k in ['width_m','depth_m'])
    return dict(nominal_area_m2=nominal, upper_body_area_m2=upper, dimension_allowance=allowance,
        meaning='Source dimension upper bound only; no site feasibility or attainable capacity.')

for batch in summary['batches']:
    stem=f"{batch['index']:03d}"
    rp,bp=OUT/'after'/f'{stem}-request.json',OUT/'after'/f'{stem}-plans.json'
    assert sha(rp)==batch['inputSha256'] and sha(bp)==batch['outputSha256']
    payload,plans=load(rp),load(bp)
    requests={r['id']:r for r in payload['requests']}
    for b in plans['buildings']:
        r=requests[b['id']]; prior=rows[b['id']]; v=prior['after']
        if prior['role'] in ['worship.shrine','civic.hall','civic.bathhouse']:
            services.append(dict(index=prior['index'], id=b['id'], function=r['function'], role=prior['role'],
                requested_recipe=(r.get('config') or {}).get('recipe'), selected_recipe=b['recipe_id'], selected_variant=b['variant_id'],
                body_area_m2=v['body_area_m2'], target_m2=prior['target_m2'], diagnostics=b['diagnostics'],
                request_path=str(rp.relative_to(ROOT)), request_sha256=sha(rp), plans_path=str(bp.relative_to(ROOT)), plans_sha256=sha(bp)))
        if r['function'] not in ['domestic','mixed']: continue
        row={k:prior[k] for k in ['index','id','function','role','composition','target_m2']}
        target=row['target_m2']
        recipe=recipes[b['recipe_id']]
        p=next(p for p in [recipe['parameters']]+[x['parameters'] for x in recipe['variants']] if p['variant_id']==b['variant_id'])
        bounds=source_bounds(p,r['config'],r.get('parcel_fit',payload.get('settings',{}).get('parcel_fit',True)))
        trace=next((d for d in b['diagnostics'] if d.startswith('Domestic footprint budget:')),None)
        initial=re.search(r'; initial=([0-9.]+)m2;',trace or '')
        initial=float(initial.group(1)) if initial else None
        budget=v['budget']
        row.update(recipe=b['recipe_id'],variant=b['variant_id'],source_topology=p['layout']+'/'+p['footprint_family'],
            source_elevation=p['elevation_family'], actual_body_m2=v['body_area_m2'], ratio=v['target_ratio'], source_bounds=bounds,
            target_above_nominal_max=target>bounds['nominal_area_m2'][1] if target and bounds else None,
            target_above_theoretical_max=target>bounds['upper_body_area_m2']+1e-6 if target and bounds else None,
            target_unreachable_within_ten_percent=target*.9>bounds['upper_body_area_m2']+1e-6 if target and bounds else None,
            budget=budget, budget_trace=trace, initial_body_m2=initial,
            measured_budget_improvement=(abs(v['body_area_m2']/target-1)<abs(initial/target-1)-1e-4) if initial and target else None,
            area_increase_m2=v['body_area_m2']-initial if initial is not None else None,
            target_met_trace='target_met=true' in trace if trace and budget else None,
            budget_unsupported=trace is not None and 'unsupported:' in trace,
            dimension_limit_reached=budget['pairs']==8 if budget else False,
            admission_limit_reached=budget['poses']==24 if budget else False,
            initial_sizing_trace=any(d.startswith('Initial native footprint budget:') for d in b['diagnostics']),
            terrain_guide=v['terrain_guide'], setback_trace=next((d for d in b['diagnostics'] if d.startswith('Source aspect setback:')),None),
            bodies=v['bodies'])
        analysed.append(row)

def quantile(v,q):
    if not v:return None
    v=sorted(v);at=(len(v)-1)*q;lo=math.floor(at);hi=math.ceil(at)
    return v[lo]+(v[hi]-v[lo])*(at-lo)
def stats(rows):
    known=[r for r in rows if r['target_m2'] and r['target_m2']>0]
    ratios=[r['ratio'] for r in known]
    return dict(admitted=len(rows),target_known=len(known),target_unknown=len(rows)-len(known),
        body_area_m2=sum(r['actual_body_m2'] for r in rows),target_m2=sum(r['target_m2'] for r in known),
        ratio={k:quantile(ratios,q) for k,q in [('min',0),('p10',.1),('median',.5),('p90',.9),('max',1)]},
        under_half=sum(r<.5 for r in ratios),under_90pct=sum(r<.9 for r in ratios),within_10pct=sum(.9<=r<=1.1 for r in ratios),over_110pct=sum(r>1.1 for r in ratios),
        absolute_area_error_m2=sum(abs(r['actual_body_m2']-r['target_m2']) for r in known),
        target_above_nominal_max=sum(r['target_above_nominal_max'] is True for r in known),
        target_above_theoretical_max=sum(r['target_above_theoretical_max'] is True for r in known),
        target_unreachable_within_ten_percent=sum(r['target_unreachable_within_ten_percent'] is True for r in known),
        source_bound_unknown=sum(r['source_bounds'] is None for r in known),
        budget_traces=sum(r['budget_trace'] is not None for r in rows),budget_search_traces=sum(r['budget'] is not None for r in rows),
        budget_unsupported=sum(r['budget_unsupported'] for r in rows),budget_measured_improvement=sum(r['measured_budget_improvement'] is True for r in rows),
        budget_target_not_met=sum(r['target_met_trace'] is False for r in rows),
        dimension_limit_reached=sum(r['dimension_limit_reached'] for r in rows),admission_limit_reached=sum(r['admission_limit_reached'] for r in rows),
        unmet_with_limit_reached=sum(r['target_met_trace'] is False and (r['dimension_limit_reached'] or r['admission_limit_reached']) for r in rows),
        initial_sizing_traces=sum(r['initial_sizing_trace'] for r in rows),
        terrain_guides=sum(r['terrain_guide'] is not None for r in rows),
        terrain_reductions=sum((r['terrain_guide'] or {}).get('corrections',0) for r in rows),setback_traces=sum(r['setback_trace'] is not None for r in rows))
def grouped(key):
    groups=defaultdict(list)
    for row in analysed:groups[key(row)].append(row)
    return {k:stats(v) for k,v in groups.items()}
report=dict(version='intermediate-java-capacity-undersizing-1',count=len(analysed),
    provenance=dict(manifestSha256=sha(OUT/'manifest.json'),sitesEvidenceSha256=sha(OUT/'sites-evidence.json'),scriptSha256=sha(Path(__file__))),
    total=stats(analysed),by_recipe=grouped(lambda r:r['recipe']+'::'+r['variant']),by_role=grouped(lambda r:r['role']),
    by_topology=grouped(lambda r:r['source_topology']),by_recipe_and_role=grouped(lambda r:r['recipe']+' / '+r['role']),
    source_bounds={r['recipe']:r['source_bounds'] for r in analysed},
    limits=['Admitted domestic/mixed only; refusals are a separate cohort and are never assigned an automatic recipe.',
        'Body footprint ratio is a geometric target comparison, not a household/population or net residential floor-area measure.',
        'Nominal ranges are source dimensions, not hard historical claims. The theoretical bound includes the native inspired x2 dimension allowance, rounded outward; below it does not prove fit.',
        'Budget limit counters show a bounded search ending without target, not proof that more attempts would improve it. Initial areas in diagnostic are rounded to 0.001m2; improvement detection uses a relative 1e-4 threshold.',
        'No native rerun, interiors, core regeneration, or parameter changes.'])
save(OUT/'undersizing-summary.json',report)
save(OUT/'undersizing-sites.json',analysed)
save(OUT/'legacy-service-pins.json',dict(version='intermediate-C-legacy-service-pins-1',
    count=len(services),by_role=dict(Counter(s['role'] for s in services)),
    scope='Admitted envelopes only, not functional architecture certification. Exact inherited pin, resulting source, diagnostics and per-batch proof.',sites=services))
print(json.dumps({k:v for k,v in report.items() if k not in ['by_recipe_and_role','limits','provenance']},ensure_ascii=False),flush=True)
