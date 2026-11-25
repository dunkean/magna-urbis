//! District connectivity and role assignment.

use super::*;

/// Districts with a quarter in the town's main body: the quarters linked
/// (within a street's width) to the quarter at the centre, transitively.
pub(super) fn attached_districts(layout: &Layout, groups: &[UrbanDistrict], center: Point) -> Vec<bool> {
    const TOUCH: f64 = 40.0;
    let q = layout.quarters.len();
    if q == 0 {
        return vec![true; groups.len()];
    }
    let rings: Vec<Vec<Point>> = layout
        .quarters
        .iter()
        .map(|x| {
            let r = &x.shape.outer;
            r.iter().step_by(r.len().div_ceil(160).max(1)).copied().collect()
        })
        .collect();
    let boxes: Vec<_> = layout.quarters.iter().map(|x| g::bbox(&x.shape)).collect();
    let touch = |a: usize, b: usize| {
        let (p, o) = (boxes[a], boxes[b]);
        if p.2 + TOUCH < o.0 || o.2 + TOUCH < p.0 || p.3 + TOUCH < o.1 || o.3 + TOUCH < p.1 {
            return false;
        }
        let near = |pts: &[Point], other: &[Point]| {
            pts.iter().any(|&v| (0..other.len()).any(|i| g::distance(v, other[i], other[(i + 1) % other.len()]).0 < TOUCH))
        };
        near(&rings[a], &rings[b]) || near(&rings[b], &rings[a])
    };
    let start = (0..q)
        .find(|&i| g::contains(&layout.quarters[i].shape, center))
        .or_else(|| (0..q).min_by(|&a, &b| dist(g::interior_point(&layout.quarters[a].shape), center).total_cmp(&dist(g::interior_point(&layout.quarters[b].shape), center))))
        .unwrap_or(0);
    let mut main = vec![false; q];
    main[start] = true;
    let mut stack = vec![start];
    while let Some(a) = stack.pop() {
        for b in 0..q {
            if !main[b] && touch(a, b) {
                main[b] = true;
                stack.push(b);
            }
        }
    }
    groups.iter().map(|d| d.quarters.is_empty() || d.quarters.iter().any(|&x| main.get(x).copied().unwrap_or(true))).collect()
}

/// Least landing (share of the town's quays, else of the district's land
/// along water) for a district to be the port: a strand of shore is no harbour.
const PORT_LANDING: f64 = 0.15;

/// Greedy role choice: the core district takes the nucleus role, then each
/// specialised role takes its best-scoring free district while keeping at least
/// half of a town residential; residual peripheral new districts become poor.
/// User-fixed roles are taken as given and count towards each role's quota.
pub(super) fn district_roles(
    layout: &Layout,
    population: u32,
    navigable: bool,
    feats: &[(SiteFacts, f64, f64, bool)],
    landing: &[f64],
    share: &[f64],
    attached: &[bool],
    fixed: &[Option<String>],
) -> Vec<String> {
    let n = feats.len();
    let pop = f64::from(population);
    let mut roles: Vec<String> = (0..n)
        .map(|i| fixed.get(i).cloned().flatten().unwrap_or_default())
        .collect();
    if n == 0 {
        return roles;
    }
    let core = (0..n)
        .min_by(|&a, &b| feats[a].0.core.total_cmp(&feats[b].0.core).then(a.cmp(&b)))
        .unwrap_or(0);
    let kind = super::super::catalogue()["cultures"][layout.culture.as_str()]["nucleus"]["kind"]
        .as_str()
        .unwrap_or("none");
    let auto_core = if pop < 300.0 {
        "commoner"
    } else {
        match kind {
            "market" | "maidan" => "market",
            "mosque" | "mud-mosque" | "temple" | "precinct" | "grove" | "mortuary" | "ushnu" => {
                "religious"
            }
            "castle" => "garrison",
            "none" => {
                if pop >= 1500.0 {
                    "market"
                } else {
                    "commoner"
                }
            }
            _ => "civic",
        }
    };
    // A specialised role names a part of the town, never most of it: a
    // district over this share of the land stays residential (its market,
    // church or hall stand in it as services). Small towns have few, large
    // districts, so the cap loosens with fewer districts.
    let cap = if n >= 6 { 0.15 } else if n >= 3 { 0.25 } else { 0.0 };
    // A detached patch (a satellite on another spur) is a hamlet of the town,
    // not where its elite, market or temples go.
    let fits = |i: usize| share.get(i).is_none_or(|&s| s <= cap) && attached.get(i).copied().unwrap_or(true);
    if roles[core].is_empty() {
        roles[core] = if fits(core) { auto_core } else { "commoner" }.into();
    }
    if n == 1 {
        return roles;
    }
    for i in 0..n {
        if i != core && feats[i].3 && roles[i].is_empty() {
            roles[i] = "foreign".into();
        }
    }
    let budget = n - n.div_ceil(2);
    let used = |roles: &[String]| roles.iter().filter(|r| !r.is_empty()).count();
    let extra = |per: f64| 1 + (pop / per) as usize;
    // (role, minimum population, count, cost: lower is better, admissible)
    type Cost = fn(&SiteFacts, f64, f64) -> Option<f64>;
    let specs: [(&str, f64, usize, Cost); 9] = [
        // The district with most landing (quay frontage, else shore) is the
        // harbour, however little of the town touches navigable water: a quay
        // needs one frontage, not a third. `water` is `landing` for this role.
        ("port", 800.0, extra(60_000.0), |f, water, _| {
            (water > PORT_LANDING).then(|| -water * 3.0 + f.core * 0.3)
        }),
        ("elite", 2500.0, extra(60_000.0), |f, water, _| {
            Some(-f.high * 1.5 + f.core * 1.2 + water * 0.5 - f.pressure * 0.2)
        }),
        // Below the town on its river: the lowest reach, out of the core.
        ("craft:tanners", 2000.0, extra(50_000.0), |f, water, _| {
            (water > 0.05 && f.core > 0.3)
                .then(|| f.downstream * 1.5 + f.high * 0.5 + (1.0 - f.core) - water)
        }),
        ("market", 4000.0, extra(40_000.0), |f, _, _| {
            Some(-f.pressure * 2.0 + f.core * 0.5 + f.gate * 0.5)
        }),
        ("religious", 6000.0, extra(80_000.0), |f, _, _| {
            Some(f.core - f.high * 0.5)
        }),
        ("craft:smiths", 6000.0, extra(60_000.0), |f, _, _| {
            Some(f.gate * 2.0 + (1.0 - f.core) * 0.3)
        }),
        ("civic", 10_000.0, 1, |f, _, _| Some(f.core)),
        ("garrison", 15_000.0, extra(150_000.0), |f, _, _| {
            Some(f.gate * 1.5 - f.high)
        }),
        ("craft:weavers", 20_000.0, extra(80_000.0), |f, _, phase| {
            Some(f.core * 0.5 - f.pressure + phase * 0.3)
        }),
    ];
    for (role, min_pop, count, cost) in specs {
        let mut count = count;
        if pop < min_pop || (role == "port" && (!navigable || layout.config.as_ref().is_some_and(super::super::macroplan::harbour::parameterized))) {
            continue;
        }
        count = count.saturating_sub(roles.iter().filter(|r| *r == role).count());
        for _ in 0..count {
            if used(&roles) >= budget.max(1) + 1 {
                break;
            }
            let best = (0..n)
                .filter(|&i| roles[i].is_empty() && (role == "port" || fits(i)))
                .filter_map(|i| {
                    let water = if role == "port" {
                        landing[i]
                    } else {
                        feats[i].1
                    };
                    cost(&feats[i].0, water, feats[i].2).map(|c| (i, c))
                })
                .min_by(|a, b| a.1.total_cmp(&b.1).then(a.0.cmp(&b.0)));
            let Some((i, _)) = best else { break };
            roles[i] = role.into();
        }
    }
    // Residential remainder: peripheral, recent quarters house the poor; the
    // outermost low-pressure district of a large town keeps gardens.
    let mut rest: Vec<usize> = (0..n).filter(|&i| roles[i].is_empty()).collect();
    rest.sort_by(|&a, &b| {
        let k = |i: usize| feats[i].0.core + feats[i].2 - feats[i].0.pressure * 0.5;
        k(b).total_cmp(&k(a)).then(a.cmp(&b))
    });
    if pop >= 8000.0 && rest.len() >= 3 {
        let i = rest.remove(0);
        roles[i] = "gardens".into();
    }
    let poor = if pop >= 2000.0 { rest.len() / 3 } else { 0 };
    for (k, &i) in rest.iter().enumerate() {
        roles[i] = if k < poor && (feats[i].2 > 0.0 || feats[i].0.core > 0.6) {
            "poor"
        } else {
            "commoner"
        }
        .into();
    }
    roles
}
