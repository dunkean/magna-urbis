//! Invariants of the river planform and of the breaches on the V2 chain (V2 default settings).
use super::*;

fn v2_conditioning(mode: &str) -> Conditioning {
    Conditioning { mode: mode.into(), strength: 2.0, max_depth: 8.0, max_length: 3000.0, banks: "valley".into(), ..Conditioning::default() }
}
fn v2_settings(width: f64) -> Settings {
    Settings {
        river_area: (0.003 * (width / 1000.0).powi(2)).max(0.02),
        lake_depth: 1.0,
        lake_area: 10.0,
        river_mode: "vector".into(),
        flat_slope: 1.0,
        sinuosity: 1.8,
        width_scale: 3.0,
        balance: true,
        braiding: 1.0,
        anabranching: true,
        terrain_influence: true,
        avulsions: true,
        confluence: "climate".into(),
        deltas: true,
        headwaters: 1.0,
        min_river_length: 400.0,
        density: 1.0,
        no_lakes: false,
        oxbows: 0.0,
    }
}
/// Length of a course, its length in straight runs of 150 m or more, and its longest straight run: a run is a
/// stretch whose vertices all lie within max(0.75 m, 0.15 channel width) of its chord (as `rivers_review_probe`).
fn straight_runs(line: &rivers::Line, scale: f64) -> (f64, f64, f64) {
    let m = line.points.len() / 2;
    let pt = |k: usize| (line.points[2 * k], line.points[2 * k + 1]);
    let (mut length, mut ruled, mut longest) = (0.0_f64, 0.0_f64, 0.0_f64);
    for k in 1..m {
        length += (pt(k).0 - pt(k - 1).0).hypot(pt(k).1 - pt(k - 1).1);
    }
    let mut i = 0;
    while i + 1 < m {
        let mut j = i + 1;
        while j + 1 < m {
            let ((ax, ay), (bx, by)) = (pt(i), pt(j + 1));
            let l = (bx - ax).hypot(by - ay).max(1e-9);
            let tolerance = (0.15 * rivers::channel_width(line.area[i], scale)).max(0.75);
            let straight = (i + 1..=j).all(|k| {
                let (px, py) = pt(k);
                (((px - ax) * (by - ay) - (py - ay) * (bx - ax)) / l).abs() <= tolerance
            });
            if !straight {
                break;
            }
            j += 1;
        }
        let run = (pt(j).0 - pt(i).0).hypot(pt(j).1 - pt(i).1);
        longest = longest.max(run);
        if run >= 150.0 {
            ruled += run;
        }
        i = j;
    }
    (length, ruled, longest)
}

/// Bounds of `no_ruled_river_on_a_plain`: the longest straight run (m) and the share of length in straight runs of
/// 150 m or more. On the same relief the grid directions alone give ruled lines over most of the length.
const RULED_LONGEST: f64 = 600.0;
const RULED_SHARE: f64 = 0.25;

/// Invariant: on a plain no river is a ruled line. The relief is a smooth plane tilted by 0.15 %, oblique to the
/// grid, with a broad swale: steepest descent has nothing to follow on it but the eight grid directions.
#[test]
fn no_ruled_river_on_a_plain() {
    let (n, width) = (192_usize, 3840.0_f64);
    let cell = width / n as f64;
    let height: Vec<f32> = (0..n * n)
        .map(|c| {
            let (x, y) = (((c % n) as f64 + 0.5) * cell, ((c / n) as f64 + 0.5) * cell);
            let (u, v) = ((x + 0.35 * y) / 1.0595, (y - 0.35 * x) / 1.0595 - 1300.0);
            (40.0 - 0.0015 * u + 4e-7 * v * v) as f32
        })
        .collect();
    let settings = v2_settings(width);
    let climate = Climate { temperature: 10.0, precipitation: 1000.0 };
    let (result, water) = condition_and_water(&height, n, width, &v2_conditioning("both"), &settings, climate, "plain", false);
    let network = water.rivers.as_ref().unwrap();
    let (mut length, mut ruled, mut longest) = (0.0_f64, 0.0_f64, 0.0_f64);
    for line in &network.rivers {
        let (l, r, m) = straight_runs(line, settings.width_scale);
        length += l;
        ruled += r;
        longest = longest.max(m);
        assert!(line.level.windows(2).all(|w| w[1] <= w[0] + 1e-9), "water never rises downstream");
    }
    let share = 100.0 * ruled / length.max(1.0);
    eprintln!("plain: {} rivers, {length:.0} m, {share:.1} % in straight runs of 150 m or more, longest {longest:.0} m", network.rivers.len());
    assert!(length > 3000.0, "rivers on the plain: {length:.0} m");
    assert!(longest <= RULED_LONGEST, "longest straight run {longest:.0} m ({share:.1} % of {length:.0} m in runs of 150 m or more)");
    assert!(ruled <= RULED_SHARE * length, "{share:.1} % of {length:.0} m in straight runs of 150 m or more (longest {longest:.0} m)");
    assert!(result.delta.iter().all(|d| d.is_finite()));
}

/// Invariant: a breach leaves no closed pocket. Every cell a breach lowers drains: after the pass the flood of the
/// relief does not stand over any of them, and the pond it opened is gone.
#[test]
fn breaches_leave_no_closed_pocket() {
    let (n, width) = (128_usize, 2560.0_f64);
    let cell = width / n as f64;
    // A valley sloping east, closed by a 2 m swell with an uneven crest, over an uneven floor: a pond 1.2 m deep
    // behind the swell, lowest and spilling near y = 990 m.
    let height: Vec<f32> = (0..n * n)
        .map(|c| {
            let (x, y) = (((c % n) as f64 + 0.5) * cell, ((c / n) as f64 + 0.5) * cell);
            let dam = (2.0 + 0.3 * (y / 210.0).sin()) * (-((x - 1600.0) / 90.0).powi(2)).exp();
            (30.0 - 0.002 * x + dam + 2e-6 * (y - 990.0).powi(2) + 0.12 * (x / 97.0).sin() * (y / 131.0).cos()) as f32
        })
        .collect();
    let before = crate::priority_flood::flood_surface(&height, n, false).filled;
    let pond = (0..n * n).map(|c| before[c] as f64 - height[c] as f64).fold(0.0, f64::max);
    assert!(pond > 0.8, "the swell holds a pond ({pond:.2} m)");
    let result = conditioning::condition_options(&height, n, width, &v2_conditioning("breach"), false, true, true);
    assert!(result.breaches > 0, "the swell is breached");
    let filled = crate::priority_flood::flood_surface(&result.height, n, false).filled;
    let (mut lowered, mut worst) = (0_usize, 0.0_f64);
    for c in 0..n * n {
        if result.delta[c] < -0.05 {
            lowered += 1;
            worst = worst.max(filled[c] as f64 - result.height[c] as f64);
        }
    }
    let deepest = (0..n * n).map(|c| filled[c] as f64 - result.height[c] as f64).fold(0.0, f64::max);
    eprintln!("breach: pond {pond:.2} m, {} breaches, {lowered} cells lowered, deepest water over a lowered cell {worst:.3} m, over any cell {deepest:.3} m", result.breaches);
    assert!(lowered > 20, "{lowered} cells lowered");
    assert!(worst <= 0.1, "a lowered cell stands under {worst:.3} m of water");
    assert!(deepest <= 0.3, "no pond is left behind the swell ({deepest:.3} m)");
}

/// Zero means none: river density 0 draws no course and `no_lakes` no lake, on a relief with a pond and no conditioning.
#[test]
fn zero_rivers_and_zero_lakes_leave_none() {
    let (n, width) = (96_usize, 9600.0_f64);
    let height: Vec<f32> = (0..n * n)
        .map(|c| {
            let (x, y) = ((c % n) as f64 - 48.0, (c / n) as f64 - 48.0);
            (60.0 - 0.2 * x + 0.002 * y * y - 25.0 * (-(x * x + y * y) / 120.0).exp()) as f32
        })
        .collect();
    let climate = Climate { temperature: 10.0, precipitation: 1000.0 };
    let run = |density: f64, no_lakes: bool| compute_water(&height, n, width, &Settings { density, no_lakes, ..v2_settings(width) }, climate, "zero", None);
    let courses = |water: &Water| water.rivers.as_ref().map_or(0, |network| network.rivers.len());
    let all = run(1.0, false);
    assert!(courses(&all) > 0 && all.lakes > 0, "{} courses and {} lakes", courses(&all), all.lakes);
    let dry = run(0.0, false);
    assert!(courses(&dry) == 0 && dry.river_cells == 0 && dry.lakes > 0);
    let drained = run(1.0, true);
    assert!(courses(&drained) > 0 && drained.lakes == 0 && drained.lake.iter().all(|&v| v == 0));
}

/// Invariant of the river density (the V2 `Rivers` setting): at 0.5 the rivers are a subset of those at 1, each kept
/// one with the very polyline it has at 1 (same source, same course), and there are fewer of them. Lowering the
/// density removes whole rivers; it never shortens one.
#[test]
fn a_lower_river_density_drops_whole_rivers_and_keeps_the_others_as_they_are() {
    let (n, width) = (192_usize, 3840.0_f64);
    let cell = width / n as f64;
    let height: Vec<f32> = (0..n * n)
        .map(|c| {
            let (x, y) = (((c % n) as f64 + 0.5) * cell, ((c / n) as f64 + 0.5) * cell);
            let (u, v) = ((x + 0.35 * y) / 1.0595, (y - 0.35 * x) / 1.0595 - 1300.0);
            (40.0 - 0.0015 * u + 4e-7 * v * v) as f32
        })
        .collect();
    let climate = Climate { temperature: 10.0, precipitation: 1000.0 };
    let run = |density: f64| {
        let settings = Settings { density, ..v2_settings(width) };
        let (_, water) = condition_and_water(&height, n, width, &v2_conditioning("both"), &settings, climate, "plain", false);
        water.rivers.unwrap().rivers
    };
    let (all, few) = (run(1.0), run(0.5));
    eprintln!("density: {} rivers at 1, {} at 0.5", all.len(), few.len());
    assert!(!few.is_empty(), "rivers are left at density 0.5");
    assert!(few.len() < all.len(), "fewer rivers at density 0.5: {} against {}", few.len(), all.len());
    for line in &few {
        assert!(all.iter().any(|other| other.points == line.points), "a river kept at density 0.5 has the course it has at density 1");
    }
}

/// Invariant of the cut-off loops: by default none is kept as water (a cut-off leaves dry ground, the network holds
/// no oxbow); when a share is asked, a kept one is a lake of its own: neither of its ends lies within a channel
/// width of a river vertex.
#[test]
fn no_oxbow_unless_asked_and_a_kept_one_is_detached() {
    let (n, width) = (192_usize, 3840.0_f64);
    let cell = width / n as f64;
    let height: Vec<f32> = (0..n * n)
        .map(|c| {
            let (x, y) = (((c % n) as f64 + 0.5) * cell, ((c / n) as f64 + 0.5) * cell);
            let (u, v) = ((x + 0.35 * y) / 1.0595, (y - 0.35 * x) / 1.0595 - 1300.0);
            (40.0 - 0.0015 * u + 4e-7 * v * v) as f32
        })
        .collect();
    let climate = Climate { temperature: 10.0, precipitation: 1000.0 };
    let run = |oxbows: f64| {
        let settings = Settings { oxbows, ..v2_settings(width) };
        let (_, water) = condition_and_water(&height, n, width, &v2_conditioning("both"), &settings, climate, "plain", false);
        water.rivers.unwrap()
    };
    let none = run(0.0);
    assert!(none.oxbows.is_empty(), "{} oxbows by default", none.oxbows.len());
    let all = run(1.0);
    eprintln!("oxbows: {} kept when every cut-off loop is asked for", all.oxbows.len());
    for oxbow in &all.oxbows {
        let m = oxbow.points.len() / 2;
        assert!(m >= 4, "an oxbow of {m} vertices");
        let wide = rivers::channel_width(oxbow.area[0], 3.0).max(0.5 * cell);
        for end in [0, m - 1] {
            let (ex, ey) = (oxbow.points[2 * end], oxbow.points[2 * end + 1]);
            for river in &all.rivers {
                for k in 0..river.points.len() / 2 {
                    let d = (river.points[2 * k] - ex).hypot(river.points[2 * k + 1] - ey);
                    assert!(d >= wide, "an oxbow end {d:.1} m from a river, {wide:.1} m wide");
                }
            }
        }
    }
}

/// A plain tilted by 0.1 % with a bowl 3 m deep and about 400 m across: a closed basin no breach of `max_depth` 0
/// may cut, so only the silting or the kept selection decides what becomes of it.
fn bowl_plain(n: usize, cell: f64) -> Vec<f32> {
    (0..n * n)
        .map(|c| {
            let (x, y) = (((c % n) as f64 + 0.5) * cell, ((c / n) as f64 + 0.5) * cell);
            let r2 = (x - 1300.0).powi(2) + (y - 1250.0).powi(2);
            (20.0 - 0.001 * x - 4.0 * (-r2 / 200.0_f64.powi(2)).exp()) as f32
        })
        .collect()
}

/// Invariant of the conditioning: no closed depression is left but the kept lakes. A basin that is not kept is silted
/// (raised to its spill, never lowered, by no more than its depth and the floor slope), and a kept one keeps its water.
#[test]
fn an_unkept_basin_is_silted_and_a_kept_one_stays() {
    let (n, width) = (128_usize, 2560.0_f64);
    let cell = width / n as f64;
    let height = bowl_plain(n, cell);
    let flood = crate::priority_flood::flood_surface(&height, n, false).filled;
    let pond = (0..n * n).map(|c| flood[c] as f64 - height[c] as f64).fold(0.0, f64::max);
    assert!(pond > 2.0, "the bowl holds {pond:.2} m");
    let unkept = Conditioning { mode: "breach".into(), max_depth: 0.0, max_length: 0.0, ..Conditioning::default() };
    let result = conditioning::condition_options(&height, n, width, &unkept, false, false, false);
    let filled = crate::priority_flood::flood_surface(&result.height, n, false).filled;
    let left = (0..n * n).map(|c| filled[c] as f64 - result.height[c] as f64).fold(0.0, f64::max);
    let (lowest, highest) = (0..n * n).fold((f64::INFINITY, 0.0_f64), |(lo, hi), c| {
        let d = result.height[c] as f64 - height[c] as f64;
        (lo.min(d), hi.max(d))
    });
    eprintln!("silt: pond {pond:.2} m, {left:.4} m of water left, raised by up to {highest:.2} m");
    assert!(left < 1e-3, "{left:.4} m of standing water left in an unkept basin");
    assert!(lowest >= -1e-4, "the silting lowered a cell by {:.4} m", -lowest);
    assert!(highest <= pond + 1.5 * width * 5e-5 * 1.9, "raised by {highest:.2} m for a pond of {pond:.2} m");
    let kept = Conditioning { lakes: 2.0, lake_area: 0.3, lake_depth: 0.2, lake_coverage: 0.5, max_lake_area: 0.5, ..unkept };
    let result = conditioning::condition_options(&height, n, width, &kept, false, false, false);
    let filled = crate::priority_flood::flood_surface(&result.height, n, false).filled;
    let water = (0..n * n).map(|c| filled[c] as f64 - result.height[c] as f64).fold(0.0, f64::max);
    assert!(water > 1.0, "the kept basin holds {water:.2} m of water");
}

/// Invariant of the braided reaches: a thread is an island channel, not a bump on the bank. On an unconfined gravel
/// valley (as `riverVectors.braids.test.ts`) threads exist, each spans at least 12 channel widths of its course and
/// stands at least one width away from it at its peak.
#[test]
fn braid_threads_are_long_islands() {
    let (n, width) = (256_usize, 10_000.0_f64);
    let cell = width / n as f64;
    let height: Vec<f32> = (0..n * n)
        .map(|c| {
            let (x, y) = (c % n, c / n);
            let across = (y as f64 - n as f64 / 2.0).abs() * cell;
            (if x < 4 { -5.0 } else { 0.01 * x as f64 * cell + 0.002 * across + 0.1 * (across - 1500.0).max(0.0) }) as f32
        })
        .collect();
    let settings = Settings { river_area: 0.5, anabranching: false, avulsions: false, deltas: false, headwaters: 0.0, ..v2_settings(width) };
    let climate = Climate { temperature: 10.0, precipitation: 1200.0 };
    let (_, water) = condition_and_water(&height, n, width, &v2_conditioning("none"), &settings, climate, "braids", false);
    let network = water.rivers.as_ref().unwrap();
    assert!(!network.braids.is_empty(), "the gravel valley is braided");
    for thread in &network.braids {
        let m = thread.points.len() / 2;
        let owner = network.rivers.iter().find(|l| l.id == thread.id).expect("a thread belongs to a course");
        let span: f64 = (1..m).map(|k| (thread.points[2 * k] - thread.points[2 * k - 2]).hypot(thread.points[2 * k + 1] - thread.points[2 * k - 1])).sum();
        let wide = rivers::channel_width(thread.area[m / 2] * 3.0, settings.width_scale).max(0.5 * cell);
        let peak = (0..m)
            .map(|k| {
                (0..owner.points.len() / 2)
                    .map(|q| (owner.points[2 * q] - thread.points[2 * k]).hypot(owner.points[2 * q + 1] - thread.points[2 * k + 1]))
                    .fold(f64::INFINITY, f64::min)
            })
            .fold(0.0, f64::max);
        assert!(span >= 11.0 * wide, "a thread of {span:.0} m beside a channel {wide:.1} m wide");
        assert!(peak >= 0.9 * wide, "a thread {peak:.1} m from a channel {wide:.1} m wide");
    }
    eprintln!("braids: {} threads", network.braids.len());
}
