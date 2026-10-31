//! Street network witness on a captured City Bench case: `street_probe <case.json> [streets-out.json]`.
//! Quarter stage only. Prints the stage time, widths by role/rank, branches wider than every
//! road they join, dead ends lying in another road (overshoot), and near-parallel doubles.
use magna_urbis_core::urban::{Geography, LayoutConfig, Point, Site, Street, Surface, VectorGeography, generate_quarters};
use serde::Deserialize;
use std::collections::BTreeMap;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Fixture { seed: String, n: usize, width: f64, height: Vec<f32>, water: Vec<u8>, geometry: Option<VectorGeography>, sites: Vec<Site>, roads: Vec<Street>, layout_config: LayoutConfig }

fn key(p: Point) -> (i64, i64) { ((p.x * 1000.0).round() as i64, (p.y * 1000.0).round() as i64) }
fn w(s: &Street, i: usize) -> f64 { s.widths.get(i).or(s.widths.last()).copied().unwrap_or(3.0) }
fn seg_dist(p: Point, a: Point, b: Point) -> (f64, f64) {
    let (dx, dy) = (b.x - a.x, b.y - a.y);
    let l2 = (dx * dx + dy * dy).max(1e-12);
    let t = (((p.x - a.x) * dx + (p.y - a.y) * dy) / l2).clamp(0.0, 1.0);
    ((p.x - a.x - t * dx).hypot(p.y - a.y - t * dy), t)
}

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let args: Vec<_> = std::env::args().collect();
    let mut f: Fixture = serde_json::from_slice(&std::fs::read(&args[1])?)?;
    if let Some(v) = std::env::var("PM").ok().and_then(|v| v.parse().ok()) { f.layout_config.parallel_merge = v; }
    let geography = f.geometry.map(|g| Geography::new(g, f.width)).transpose()?;
    let surface = Surface { geometry: geography.as_ref(), width: f.width, n: f.n, height: &f.height, water: &f.water };
    let runs = std::env::var("RUNS").ok().and_then(|v| v.parse().ok()).unwrap_or(1usize);
    let mut times = vec![];
    let mut layouts = vec![];
    for _ in 0..runs {
        let t = std::time::Instant::now();
        layouts = generate_quarters(&f.seed, &f.sites, &f.layout_config, surface, &f.roads)?;
        times.push(t.elapsed().as_secs_f64() * 1000.0);
    }
    times.sort_by(f64::total_cmp);
    let l = &layouts[0];
    let streets = &l.streets;
    println!("population {} · quarters stage {:.0} ms (median of {runs}) · {} streets", f.sites[0].population, times[runs / 2], streets.len());
    for w in l.warnings.iter().filter(|w| w.starts_with("Emprise")) { println!("warning: {w}"); }
    // Widths by role/rank.
    let mut table: BTreeMap<String, (usize, f64, f64, f64)> = BTreeMap::new();
    for s in streets {
        let len: f64 = s.path.windows(2).map(|p| (p[1].x - p[0].x).hypot(p[1].y - p[0].y)).sum();
        let (lo, hi) = s.widths.iter().fold((f64::MAX, 0f64), |(a, b), &x| (a.min(x), b.max(x)));
        let e = table.entry(format!("{}/r{}", s.role, s.rank)).or_insert((0, 0.0, f64::MAX, 0.0));
        e.0 += 1; e.1 += len; e.2 = e.2.min(lo); e.3 = e.3.max(hi);
    }
    for (k, (n, len, lo, hi)) in &table { println!("  {k:<22} {n:>3} × {len:>6.0} m  width {lo:.2}–{hi:.2}"); }
    // Nodes: every vertex; arms = streets touching the node.
    let mut nodes: BTreeMap<(i64, i64), Vec<(usize, usize)>> = BTreeMap::new();
    for (i, s) in streets.iter().enumerate() { for (j, &p) in s.path.iter().enumerate() { nodes.entry(key(p)).or_default().push((i, j)); } }
    let degree = |p: Point| nodes.get(&key(p)).map_or(0, |v| v.iter().map(|&(i, j)| if j == 0 || j + 1 == streets[i].path.len() { 1 } else { 2 }).sum::<usize>());
    // Branch wider than every other arm at its junction end.
    let mut wider = vec![];
    for (i, s) in streets.iter().enumerate() {
        for end in [0, s.path.len() - 1] {
            let arms = &nodes[&key(s.path[end])];
            if arms.len() < 2 { continue; }
            let mine = w(s, end);
            let other = arms.iter().filter(|&&(k, _)| k != i).map(|&(k, j)| w(&streets[k], j)).fold(0f64, f64::max);
            if mine > other + 0.1 { wider.push(format!("{}/r{} {:.2} > {:.2} at ({:.0},{:.0})", s.role, s.rank, mine, other, s.path[end].x, s.path[end].y)); }
        }
    }
    println!("branches wider than their junction: {}", wider.len());
    for x in wider.iter().take(8) { println!("    {x}"); }
    // Dead ends inside or just past another road's ribbon.
    let mut over = vec![];
    for (i, s) in streets.iter().enumerate() {
        for end in [0, s.path.len() - 1] {
            let p = s.path[end];
            if degree(p) != 1 { continue; }
            for (k, o) in streets.iter().enumerate() {
                if k == i { continue; }
                for (j, q) in o.path.windows(2).enumerate() {
                    let (d, _) = seg_dist(p, q[0], q[1]);
                    let reach = w(o, j) / 2.0 + w(s, end) / 2.0 + 0.5;
                    if d < reach { over.push(format!("{}/r{} end at {:.1} m from {}/r{} axis (half {:.1}) ({:.0},{:.0})", s.role, s.rank, d, o.role, o.rank, w(o, j) / 2.0, p.x, p.y)); break; }
                }
            }
        }
    }
    println!("dead ends inside/at another road: {}", over.len());
    for x in over.iter().take(8) { println!("    {x}"); }
    // Doubles: near-parallel segment pairs of distinct, not consecutive streets, axis gap < half widths + 10 m.
    let segs: Vec<(usize, usize, Point, Point)> = streets.iter().enumerate().flat_map(|(i, s)| s.path.windows(2).enumerate().map(move |(j, q)| (i, j, q[0], q[1]))).collect();
    let mut doubled = vec![0f64; streets.len()];
    let mut marks: Vec<[Point; 2]> = vec![];
    for &(i, j, a, b) in &segs {
        let len = (b.x - a.x).hypot(b.y - a.y);
        if len < 0.5 { continue; }
        let m = Point { x: (a.x + b.x) / 2.0, y: (a.y + b.y) / 2.0 };
        let (ux, uy) = ((b.x - a.x) / len, (b.y - a.y) / len);
        let hit = segs.iter().any(|&(k, jj, c, d)| {
            if k == i { return false; }
            let l2 = (d.x - c.x).hypot(d.y - c.y);
            if l2 < 0.5 || (ux * (d.x - c.x) + uy * (d.y - c.y)).abs() / l2 < 0.94 { return false; }
            let (dist, t) = seg_dist(m, c, d);
            t > 0.0 && t < 1.0 && dist > (w(&streets[i], j) + w(&streets[k], jj)) / 2.0 && dist < (w(&streets[i], j) + w(&streets[k], jj)) / 2.0 + 10.0
        });
        if hit { doubled[i] += len; marks.push([a, b]); }
    }
    let total: f64 = doubled.iter().sum();
    println!("doubled length (parallel within half widths + 10 m): {total:.0} m");
    let mut by: BTreeMap<String, f64> = BTreeMap::new();
    for (i, d) in doubled.iter().enumerate() { if *d > 0.0 { *by.entry(format!("{}/r{}", streets[i].role, streets[i].rank)).or_default() += d; } }
    for (k, v) in by { println!("    {k:<22} {v:.0} m"); }
    if let Some(out) = args.get(2) { std::fs::write(out, serde_json::to_string(&serde_json::json!({ "streets": streets, "blocks": l.blocks.iter().map(|b| &b.shape).collect::<Vec<_>>(), "center": l.center, "doubles": marks }))?)?; }
    Ok(())
}
