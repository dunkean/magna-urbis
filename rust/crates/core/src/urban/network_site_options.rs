use super::*;
use super::super::{Enclosure, LayoutConfig, Surface, geometry as g, routing};

pub(super) fn different_level(surface: Surface<'_>, a: Point, b: Point) -> bool {
    (surface.height_at(a) - surface.height_at(b)).abs() >= 1.5
        || !routing::segment_clear(surface, a, b, 0.3)
}

/// Share of the sustained parallel runs collapsed (`parallelMerge`, the old toggle forcing all).
fn merge_share(cfg: &LayoutConfig) -> f64 {
    if cfg.merge_parallel_streets { 1.0 } else { cfg.parallel_merge.clamp(0.0, 1.0) }
}

pub(in crate::urban) fn clean_options(streets: &mut Vec<Street>, center: Point, radius: f64,
    fortified: bool, centers: &[Point], cfg: &LayoutConfig, surface: Surface<'_>) -> Vec<String> {
    clean_terrain(streets, center, radius, fortified, centers, (merge_share(cfg) > 0.0).then_some(surface))
}

pub(in crate::urban) fn narrow_options(streets: &mut Vec<Street>, enclosures: &[Enclosure], radius: f64,
    cfg: &LayoutConfig, surface: Surface<'_>) -> bool {
    if merge_share(cfg) <= 0.0 { return drop_narrow_doubles(streets, enclosures, radius); }
    let walls: Vec<_> = enclosures.iter().flat_map(|e| e.path.windows(2).map(|w| (w[0], w[1]))).collect();
    let moved = merge_partial(streets, &walls, surface, cfg);
    if moved { planarize(streets, radius); }
    let before = streets.len();
    drop_shadowed_within(streets, MIN_LAND, &walls, Some(surface));
    if streets.len() != before { planarize(streets, radius); }
    moved || streets.len() != before
}

/// Collapse only sustained parallel runs; the independent tails and every
/// existing junction follow the survivor. Projected geometry must stay dry
/// and within its original grade class. A curtain or a terrace keeps both.
fn merge_partial(streets: &mut [Street], walls: &[(Point, Point)], surface: Surface<'_>, cfg: &LayoutConfig) -> bool {
    const CELL: f64 = 32.0;
    let original = streets.to_vec();
    let priority = |i: usize| (original[i].rank, std::cmp::Reverse((original[i].widths.iter().copied().fold(0.0, f64::max) * 1000.0) as i64), i);
    // Dosage: a street's runs are collapsed when its own draw falls under the share,
    // so the same street keeps or loses its doubles whatever else changes.
    let share = merge_share(cfg);
    let drawn = |s: &Street| share >= 1.0 || s.path.first().is_some_and(|p| crate::rng::Rng::new(&format!("parallel:{:.1},{:.1}", p.x, p.y)).float() < share);
    let mut buckets: BTreeMap<(i64, i64), Vec<(usize, usize)>> = BTreeMap::new();
    let mut joints: BTreeMap<Key, Vec<usize>> = BTreeMap::new();
    for (i, s) in original.iter().enumerate() {
        for &p in &s.path { joints.entry(key(p)).or_default().push(i); }
        for (k, w) in s.path.windows(2).enumerate() {
            let pad = width(s, k).max(width(s, k + 1)) + MIN_LAND + 8.0;
            for x in ((w[0].x.min(w[1].x) - pad) / CELL).floor() as i64..=((w[0].x.max(w[1].x) + pad) / CELL).floor() as i64 {
                for y in ((w[0].y.min(w[1].y) - pad) / CELL).floor() as i64..=((w[0].y.max(w[1].y) + pad) / CELL).floor() as i64 {
                    buckets.entry((x, y)).or_default().push((i, k));
                }
            }
        }
    }
    let grade = |s: &Street| if s.role == "stairs" { cfg.max_stair_grade } else if s.rank >= 3 { cfg.max_lane_grade } else { cfg.max_street_grade };
    let mut order: Vec<_> = (0..streets.len()).collect();
    order.sort_by_key(|&i| std::cmp::Reverse(priority(i)));
    let mut changed = false;
    let mut altered = BTreeSet::new();
    for i in order {
        let s = &original[i];
        if protected(s) || private(s) || matches!(s.role.as_str(), "quay" | "stairs") || altered.contains(&i) || !drawn(s) { continue; }
        // (position, width, original vertex, projected point, survivor).
        let mut samples = vec![];
        for (k, w) in s.path.windows(2).enumerate() {
            let length = distance(w[0], w[1]);
            if length < EPS { continue; }
            let n = (length / 2.0).ceil().max(1.0) as usize;
            for t in 0..=n {
                if k > 0 && t == 0 { continue; }
                let p = lerp(w[0], w[1], t as f64 / n as f64);
                let own = width(s, k) + (width(s, k + 1) - width(s, k)) * t as f64 / n as f64;
                let cell = ((p.x / CELL).floor() as i64, (p.y / CELL).floor() as i64);
                let mut best = None;
                for &(j, seg) in buckets.get(&cell).into_iter().flatten() {
                    if j == i || altered.contains(&j) || priority(j) >= priority(i) { continue; }
                    let other = &original[j];
                    if matches!(other.role.as_str(), "bridge" | "ford" | "causeway" | "quay" | "stairs") { continue; }
                    let (a, b) = (other.path[seg], other.path[seg + 1]);
                    let run = distance(a, b);
                    if run < EPS || ((w[1].x - w[0].x) * (b.x - a.x) + (w[1].y - w[0].y) * (b.y - a.y)).abs() < 0.94 * length * run { continue; }
                    let (d, _, q) = g::distance(p, a, b);
                    let gap = d - 0.5 * (own + width(other, seg).max(width(other, seg + 1)));
                    if gap >= MIN_LAND || different_level(surface, p, q)
                        || walls.iter().any(|&(a, b)| g::segment_hit(p, q, a, b).is_some()) { continue; }
                    if best.is_none_or(|(old, _, _)| priority(j) < priority(old)) { best = Some((j, q, d)); }
                }
                samples.push((p, own, t == 0 || t == n, best));
            }
        }
        if samples.len() < 2 { continue; }
        let mut result: Vec<_> = samples.iter().map(|p| p.0).collect();
        let mut begin = 0;
        while begin < samples.len() {
            let Some((j, _, _)) = samples[begin].3 else { begin += 1; continue };
            let mut end = begin + 1;
            while end < samples.len() && samples[end].3.is_some_and(|b| b.0 == j) { end += 1; }
            let length: f64 = samples[begin..end].windows(2).map(|w| distance(w[0].0, w[1].0)).sum();
            let blocked = samples[begin..end].iter().any(|p| joints.get(&key(p.0)).into_iter().flatten()
                .any(|&u| u != j && protected(&original[u])));
            if !blocked && length >= 12.0_f64.max(samples[begin].1 * 2.0) {
                for k in begin..end { result[k] = samples[k].3.unwrap().1; }
            }
            begin = end;
        }
        let mapping: BTreeMap<_, _> = samples.iter().zip(&result).filter(|(a, b)| a.2 && distance(a.0, **b) > EPS)
            .map(|(a, &b)| (key(a.0), b)).collect();
        if result.iter().zip(&samples).all(|(&a, b)| distance(a, b.0) < EPS) { continue; }
        let affected: BTreeSet<_> = mapping.keys().flat_map(|k| joints.get(k).into_iter().flatten().copied()).filter(|&u| u != i).collect();
        if !routing::path_clear(surface, &result, grade(s)) || affected.iter().any(|&u| {
            let path: Vec<_> = streets[u].path.iter().map(|&p| mapping.get(&key(p)).copied().unwrap_or(p)).collect();
            !routing::path_clear(surface, &path, grade(&streets[u]))
        }) { continue; }
        let mut path = vec![result[0]];
        let mut widths = vec![samples[0].1];
        for k in 1..result.len() - 1 {
            let (a, b, c) = (*path.last().unwrap(), result[k], result[k + 1]);
            let cross = ((b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x)).abs();
            if samples[k].2 || cross > 1e-6 { path.push(b); widths.push(samples[k].1); }
        }
        path.push(*result.last().unwrap()); widths.push(samples.last().unwrap().1);
        streets[i].path = path; streets[i].widths = widths;
        for u in affected {
            for p in &mut streets[u].path { if let Some(&q) = mapping.get(&key(*p)) { *p = q; } }
            altered.insert(u);
        }
        altered.insert(i);
        changed = true;
    }
    changed
}

#[cfg(test)]
mod tests {
    use super::*;
    fn street(points: &[(f64, f64)], rank: usize) -> Street {
        Street { path: points.iter().map(|&(x, y)| Point { x, y }).collect(), widths: vec![4.0; points.len()], rank, role: "street".into() }
    }
    fn fixture() -> Vec<Street> {
        vec![street(&[(20., 50.), (160., 50.)], 1),
            street(&[(20., 90.), (50., 56.), (90., 56.), (125., 56.), (165., 90.)], 2),
            street(&[(90., 56.), (90., 110.)], 3)]
    }
    #[test]
    fn partial_parallel_runs_merge_but_keep_tails_and_junctions() {
        let h = vec![20.; 100 * 100]; let water = vec![0; h.len()];
        let surface = Surface { geometry: None, width: 200., n: 100, height: &h, water: &water };
        let cfg = LayoutConfig { merge_parallel_streets: true, ..Default::default() };
        let mut roads = fixture();
        let old = roads.clone();
        assert!(narrow_options(&mut roads, &[], 200., &cfg, surface));
        assert!(roads.iter().flat_map(|s| &s.path).any(|p| distance(*p, Point {x:90.,y:50.}) < 1e-5));
        assert!(roads.iter().any(|s| s.path.contains(&Point {x:20.,y:90.})));
        assert!(roads.iter().any(|s| s.path.contains(&Point {x:165.,y:90.})));
        assert!(!roads.iter().any(|s| s.path.windows(2).any(|w| (w[0].y-56.).abs()<1e-5 && (w[1].y-56.).abs()<1e-5 && distance(w[0], w[1])>10.)));
        let graph = Graph::new(&roads);
        assert!(graph.degree(Point {x:90.,y:50.}) >= 3);
        assert!(roads.iter().all(|s| routing::path_clear(surface, &s.path, cfg.max_street_grade)));
        witness("parallel-off", &old, &[]);
        witness("parallel-on", &roads, &[]);
    }
    #[test]
    fn terraces_walls_crossings_and_real_lots_keep_their_roads() {
        let h: Vec<f32> = (0..10000).map(|i| if i / 100 >= 27 {24.} else {20.}).collect();
        let water = vec![0; h.len()];
        let surface = Surface { geometry: None, width: 200., n: 100, height: &h, water: &water };
        let cfg = LayoutConfig { merge_parallel_streets: true, ..Default::default() };
        let mut roads = vec![street(&[(20.,50.),(160.,50.)],1), street(&[(20.,56.),(160.,56.)],2)];
        let old = serde_json::to_string(&roads).unwrap();
        assert!(!narrow_options(&mut roads,&[],200.,&cfg,surface));
        assert_eq!(old,serde_json::to_string(&roads).unwrap());
        witness("terraces-on", &roads, &[]);
        let flat = vec![20.; h.len()]; let surface = Surface {height:&flat,..surface};
        let wall = Enclosure {path:vec![Point{x:0.,y:53.},Point{x:180.,y:53.}],..Default::default()};
        assert!(!narrow_options(&mut roads,&[wall],200.,&cfg,surface));
        roads[1].path.iter_mut().for_each(|p| p.y=62.);
        assert!(!narrow_options(&mut roads,&[],200.,&cfg,surface));
        roads[1].path.iter_mut().for_each(|p| p.y=56.);
        roads[1].role="bridge".into();
        assert!(!narrow_options(&mut roads,&[],200.,&cfg,surface));
    }
    #[test]
    fn disabled_option_is_the_legacy_narrow_pass_byte_for_byte() {
        let h=vec![20.;10000];let water=vec![0;h.len()];
        let surface=Surface{geometry:None,width:200.,n:100,height:&h,water:&water};
        let mut a=fixture();let mut b=a.clone();
        assert_eq!(drop_narrow_doubles(&mut a,&[],200.),narrow_options(&mut b,&[],200.,&Default::default(),surface));
        assert_eq!(serde_json::to_vec(&a).unwrap(),serde_json::to_vec(&b).unwrap());
        let mut a=fixture();let mut b=a.clone();
        assert_eq!(clean_with_centers(&mut a,Point{x:90.,y:50.},200.,true,&[]),
            clean_options(&mut b,Point{x:90.,y:50.},200.,true,&[],&Default::default(),surface));
        assert_eq!(serde_json::to_vec(&a).unwrap(),serde_json::to_vec(&b).unwrap());
    }
    fn witness(name:&str, roads:&[Street], shapes:&[super::super::super::Shape]) {
        if let Ok(out)=std::env::var("SITE_OPTS_WITNESSES") {
            crate::urban::site_options_tests::svg(&out,name,roads,shapes,200.);
        }
    }
}
