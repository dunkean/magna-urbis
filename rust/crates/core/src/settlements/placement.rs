use super::grid::Fields;
use super::{
    Config, Output, Point, Scores, Settlement, SettlementSpec, class_of, extent_gap, extent_radius,
    pair_spacing, smooth,
};
use crate::{noise::Noise, rng::Rng};
use std::collections::BTreeMap;

const CLASSES: [(&str, u32, u32); 5] = [
    ("city", 20000, 60000),
    ("town", 1000, 5000),
    ("village", 150, 600),
    ("hamlet", 20, 80),
    ("farmstead", 5, 12),
];
/// Site types that are not a single archetype of a cell; their weights apply where they match.
const SPECIAL_SITES: [&str; 7] = [
    "estuary",
    "confluence",
    "meander",
    "lakeshore",
    "island",
    "spur",
    "pass",
];
/// Rank-size density at ×1: places per 100 km² of usable land.
const ZIPF_PLACES_PER_100_KM2: f64 = 10.0;

fn archetype(f: &Fields, i: usize, pop: u32, relief: &str) -> &'static str {
    let ext = extent_radius(pop);
    if f.ds[i] < ext + 70.0 {
        "harbor"
    } else if f.db[i] < ext + 60.0 {
        "bridge"
    } else if (f.r.height[i] - f.hb[i]) > 8.0 && f.slope_s[i] < 0.12 {
        "hilltop"
    } else if ["valley", "mountains", "high-mountains", "mixed"].contains(&relief)
        && f.dw[i] < 900.0
    {
        "valley"
    } else {
        "plain"
    }
}
fn site_matches(f: &Fields, i: usize, site: &str, pop: u32) -> bool {
    let ext = extent_radius(pop);
    match site {
        "harbor" => f.ds[i] < ext + 60.0,
        "estuary" => f.ds[i] < 700.0 && f.db[i] < ext + 60.0,
        "bridge" | "meander" => f.db[i] < ext + 60.0,
        "confluence" => {
            let x = i % f.r.n;
            let y = i / f.r.n;
            let rad = ((ext + 150.0) / f.cell).ceil() as usize;
            let mut ids = std::collections::HashSet::new();
            for yy in y.saturating_sub(rad)..=(y + rad).min(f.r.n - 1) {
                for xx in x.saturating_sub(rad)..=(x + rad).min(f.r.n - 1) {
                    let j = yy * f.r.n + xx;
                    if f.r.river_ids[j] >= 0 && f.r.river_width[j] >= 2.5 {
                        ids.insert(f.r.river_ids[j]);
                    }
                }
            }
            ids.len() > 1
        }
        "hilltop" => f.r.height[i] - f.hb[i] > 6.0,
        "lakeshore" => f.dl[i] < ext + 60.0,
        "island" => f.island[i],
        // A fortress height: clearly above its surroundings, with a usable top.
        "spur" => f.r.height[i] - f.hb[i] > 15.0 && f.slope_s[i] < 0.14,
        "pass" => is_pass(f, i, ext),
        "valley" => f.dw[i] < 900.0 && f.hab[i] > 2.5,
        "plain" => f.slope_s[i] < 0.05,
        _ => true,
    }
}
/// A saddle between two heights: ground rises on both sides of one axis and
/// falls away on both sides of the crossing axis, high above the lowlands.
fn is_pass(f: &Fields, i: usize, ext: f64) -> bool {
    let n = f.r.n;
    let reach = ((ext * 2.0).max(300.0) / f.cell).round().max(2.0) as isize;
    let (x, y) = ((i % n) as isize, (i / n) as isize);
    let h = f.r.height[i];
    let at = |dx: isize, dy: isize| {
        let (xx, yy) = (x + dx * reach, y + dy * reach);
        (xx >= 0 && yy >= 0 && xx < n as isize && yy < n as isize)
            .then(|| f.r.height[yy as usize * n + xx as usize] - h)
    };
    let axes = [
        ((1, 0), (0, 1)),
        ((0, 1), (1, 0)),
        ((1, 1), (1, -1)),
        ((1, -1), (1, 1)),
    ];
    f.elevation(i) > 0.35
        && f.slope_s[i] < 0.16
        && axes.iter().any(|&((ax, ay), (bx, by))| {
            let rise = [at(ax, ay), at(-ax, -ay)];
            let fall = [at(bx, by), at(-bx, -by)];
            rise.iter().all(|d| d.is_some_and(|d| d > 25.0))
                && fall.iter().all(|d| d.is_some_and(|d| d < -10.0))
        })
}
fn matches(f: &Fields, i: usize, s: &SettlementSpec) -> bool {
    site_matches(f, i, &s.site_type, s.population)
}
/// Culture preference × global multiplier for one site type (1 = neutral).
fn site_weight(s: &SettlementSpec, cfg: &Config, site: &str) -> f64 {
    s.site_prefs.weights.get(site).copied().unwrap_or(1.0)
        * cfg.site_weights.get(site).copied().unwrap_or(1.0)
}
/// Log-weight: ×3 → +0.55, ×0 → −1.96 (strongly avoided, still possible as a last resort).
fn log_weight(w: f64) -> f64 {
    0.5 * w.max(0.02).ln()
}
fn score(f: &Fields, i: usize, s: &SettlementSpec, cfg: &Config, noise: &Noise) -> (Scores, bool) {
    let pop = s.population;
    let p = f.pos(i);
    let ext = extent_radius(pop);
    let prefs = &s.site_prefs;
    let mountain = prefs.mountain_face;
    let wood = prefs.woodland;
    let cap_s = 0.11 + 0.18 * mountain + 0.06 * wood + if pop < 100 { 0.03 } else { 0.0 };
    let cap_r = 0.16 + 0.25 * mountain + 0.08 * wood + if pop < 100 { 0.04 } else { 0.0 };
    let bf = f.fraction(p, (0.8 * ext).max(f.cell));
    let dw = f.dw[i];
    let sl = f.slope_s[i] as f64;
    let hab = f.hab[i];
    let prominence = (f.r.height[i] - f.hb[i]) as f64;
    let flatness = 1.6 * (1.0 - smooth(sl, 0.015, cap_s)) * cfg.flatness_weight;
    let buildable = 1.4 * bf * cfg.buildable_weight;
    let fresh_water =
        0.8 * if dw > 30.0 && dw < 450.0 {
            (-(dw - 70.0).max(0.0) / 180.0).exp()
        } else {
            0.0
        } * cfg.fresh_water_weight;
    let river = if pop >= 150 && f.db[i] < ext + 120.0 && hab > 2.0 {
        if pop >= 1000 { 0.9 } else { 0.4 }
    } else {
        0.0
    } * cfg.river_weight;
    let harbor = if pop >= 150 && f.ds[i] < ext + 80.0 {
        if pop >= 1000 { 1.0 } else { 0.5 }
    } else {
        0.0
    } * cfg.coast_weight;
    let flood = if dw < 250.0 {
        -0.6 * (1.0 - smooth(hab, 1.5, 4.0))
    } else {
        0.0
    } * cfg.flood_weight;
    // The legacy road-side term is zero here: points precede the road stage.
    let culture = 1.4 * mountain * smooth(sl, 0.04, 0.18)
        + 0.6 * mountain * smooth(prominence, 0.0, 30.0)
        + 0.8 * wood
        + 0.4 * wood * smooth(sl, 0.03, 0.1);
    let mut site = log_weight(site_weight(s, cfg, archetype(f, i, pop, &cfg.relief)));
    for special in SPECIAL_SITES {
        let w = site_weight(s, cfg, special);
        if w != 1.0 && site_matches(f, i, special, pop) {
            site += log_weight(w);
        }
    }
    let defense = cfg.defense_weight
        * (0.7 * smooth(prominence, 2.0, 25.0) + 0.3 * smooth(f.dw[i], 200.0, 1500.0));
    let elevation = cfg.elevation * 0.9 * (2.0 * f.elevation(i) - 1.0);
    let variation = 0.35 * cfg.variation_weight * noise.fbm(p.x / 900.0, p.y / 900.0, 2);
    let edge = p.x.min(p.y).min(f.r.width - p.x).min(f.r.width - p.y);
    let min_bf = if pop >= 1000 {
        0.45
    } else if pop >= 150 {
        0.35
    } else {
        0.2
    } * (1.0 - 0.6 * mountain).max(0.0);
    let valid = f.r.water[i] == 0
        && edge >= cfg.edge_margin * f.r.width + 0.8 * ext + 40.0
        && sl <= cap_s
        && f.slope[i] as f64 <= cap_r
        && dw >= 25.0_f64.max(0.35 * ext)
        && !(dw < 200.0 && hab < 1.5)
        && bf >= min_bf;
    (
        Scores {
            total: flatness
                + buildable
                + fresh_water
                + river
                + harbor
                + flood
                + culture
                + site
                + defense
                + elevation
                + variation,
            flatness,
            ranking_score: None,
            candidate_rank: None,
            ranking_population: None,
            buildable,
            fresh_water,
            river,
            harbor,
            flood,
            culture,
            site,
            defense,
            elevation,
            cluster: 0.0,
            variation,
            buildable_fraction: bf,
            water_distance: dw.min(1e6),
            slope: sl,
            height_above_water: hab,
            spacing_relaxation: 1.0,
            manual: s.position.is_some(),
        },
        valid,
    )
}
/// Satellites: a small place gains from being near a much larger one already placed.
fn cluster_bonus(cfg: &Config, placed: &[Settlement], pop: u32, p: Point) -> f64 {
    if cfg.clustering <= 0.0 {
        return 0.0;
    }
    placed
        .iter()
        .filter(|o| o.spec.population >= 4 * pop)
        .map(|o| {
            let reach = 3.0 * pair_spacing(pop, o.spec.population);
            0.8 * (-p.distance(o.center) / reach).exp()
        })
        .fold(0.0, f64::max)
        * cfg.clustering
}
fn relief_factor(relief: &str) -> f64 {
    match relief {
        "mountains" | "high-mountains" => 0.55,
        "flat" => 1.15,
        "valley" => 0.9,
        _ => 1.0,
    }
}
/// Legacy class bands, sized from the usable land.
fn class_requests(root: &Rng, cfg: &Config, usable: f64, requests: &mut Vec<SettlementSpec>) {
    let rf = relief_factor(&cfg.relief);
    let cities = ((usable / 1300.0).floor() as isize - isize::from(cfg.main.population >= 20000))
        .max(0) as usize;
    let towns = ((usable / 320.0).powf(0.85).round() as isize
        - isize::from((1000..20000).contains(&cfg.main.population))
        - 2 * cities as isize)
        .max(0) as usize;
    let villages = (usable.powf(0.8) / 7.0 * rf).round() as usize;
    let counts = [
        cities,
        towns,
        villages,
        (villages as f64 * 0.5).round() as usize,
        (villages as f64 * 0.4).round() as usize,
    ];
    for (k, (cls, lo, hi)) in CLASSES.iter().enumerate() {
        let count = if cfg.mode == "auto" {
            if *lo >= cfg.main.population {
                0
            } else {
                (counts[k] as f64 * cfg.density).round() as usize
            }
        } else {
            *cfg.counts.get(*cls).unwrap_or(&0)
        };
        for j in 0..count.min(1000 - requests.len().min(1000)) {
            let key = format!("{cls}:{j}");
            let mut r = root.fork(&format!("settlement:{key}")).fork("pop");
            requests.push(SettlementSpec {
                key,
                population: (*lo as f64 * (*hi as f64 / *lo as f64).powf(r.float())).round() as u32,
                name: String::new(),
                position: None,
                ..cfg.main.clone()
            });
        }
    }
}
/// Rank-size law: rank r holds main / r^q inhabitants, down to the minimum population, with as
/// many ranks (the main place included) as the density allows on the usable land.
fn zipf_requests(root: &Rng, cfg: &Config, usable: f64, requests: &mut Vec<SettlementSpec>) {
    let main = cfg.main.population as f64;
    let places = (ZIPF_PLACES_PER_100_KM2 * cfg.density * relief_factor(&cfg.relief) * usable
        / 100.0)
        .round()
        .clamp(0.0, 999.0) as usize;
    for rank in 2..=places {
        let ideal = main / (rank as f64).powf(cfg.zipf_exponent);
        if ideal < cfg.min_population as f64 {
            break;
        }
        let key = format!("place:{rank}");
        let mut r = root.fork(&format!("settlement:{key}")).fork("pop");
        // Box–Muller normal, then a log-normal factor around the law.
        let normal =
            (-2.0 * r.float().max(1e-12).ln()).sqrt() * (std::f64::consts::TAU * r.float()).cos();
        let population = (ideal * (0.5 * cfg.population_jitter * normal).exp())
            .round()
            .clamp(cfg.min_population as f64, (main - 1.0).max(1.0))
            as u32;
        requests.push(SettlementSpec {
            key,
            population,
            name: String::new(),
            position: None,
            ..cfg.main.clone()
        });
    }
    // Largest first, so spacing and clustering see the big places before their satellites.
    requests[1..].sort_by(|a, b| {
        b.population
            .cmp(&a.population)
            .then_with(|| a.key.cmp(&b.key))
    });
}
pub(super) fn place(seed: &str, f: &Fields, cfg: &Config) -> Output {
    let root = Rng::new(&format!("magna-urbis:{seed}"));
    let noise = Noise::new(root.fork("settlements").fork("noise"));
    let usable =
        f.r.water
            .iter()
            .enumerate()
            .filter(|(i, w)| **w == 0 && f.slope[*i] < 0.3)
            .count() as f64
            * f.cell
            * f.cell
            / 1e6;
    let mut requests = vec![];
    if cfg.mode == "list" {
        requests = cfg.list.clone();
    } else {
        let mut main = cfg.main.clone();
        main.key = "main".into();
        requests.push(main);
        if cfg.mode == "auto" && cfg.distribution == "zipf" {
            zipf_requests(&root, cfg, usable, &mut requests);
        } else {
            class_requests(&root, cfg, usable, &mut requests);
        }
    }
    let mut out = Output {
        settlements: vec![],
        warnings: vec![],
        requested: requests.len(),
        usable_km2: usable,
    };
    // The legacy class budget: secondary places never outnumber the main population in total.
    let budget = cfg.mode == "auto" && cfg.distribution == "classes";
    let stride = ((40.0_f64.max(1.5 * f.cell) / f.cell).round() as usize).max(1);
    let candidates: Vec<_> = (0..f.r.n)
        .step_by(stride)
        .flat_map(|y| (0..f.r.n).step_by(stride).map(move |x| y * f.r.n + x))
        .filter(|&i| f.r.water[i] == 0)
        .collect();
    let mut rankings: BTreeMap<String, Vec<(usize, f64)>> = BTreeMap::new();
    let mut remaining = cfg.main.population;
    for (index, mut s) in requests.into_iter().enumerate() {
        if s.key.is_empty() {
            s.key = format!("place:{index}");
        }
        if budget && index > 0 && s.population > remaining {
            continue;
        }
        let pop = s.population;
        let ext = extent_radius(pop);
        let minimum = |other: &Settlement, relax: f64| -> f64 {
            let mut minimum = extent_gap(pop, other.spec.population)
                .max(pair_spacing(pop, other.spec.population) * relax);
            if cfg.mode == "auto" && index > 0 && pop < 1000 && other.spec.key == "main" {
                minimum = minimum.max(cfg.main_clear * other.radius + ext);
            }
            minimum
        };
        let clear = |p: Point, relax: f64| -> bool {
            out.settlements
                .iter()
                .all(|other| p.distance(other.center) >= minimum(other, relax))
        };
        // Candidate cells inside another place's spacing disk, rasterized once per spacing pass
        // so the candidate scan never scores a cell that cannot be used.
        let blocked = |relax: f64| -> Vec<bool> {
            let mut b = vec![false; f.r.n * f.r.n];
            for other in &out.settlements {
                let r = minimum(other, relax);
                let c = f.index(other.center);
                let (cx, cy) = (c % f.r.n, c / f.r.n);
                let k = (r / f.cell).ceil() as usize + 1;
                for y in cy.saturating_sub(k)..=(cy + k).min(f.r.n - 1) {
                    for x in cx.saturating_sub(k)..=(cx + k).min(f.r.n - 1) {
                        let i = y * f.r.n + x;
                        if f.pos(i).distance(other.center) < r {
                            b[i] = true;
                        }
                    }
                }
            }
            b
        };
        let mut chosen = None;
        let mut ranking = None;
        if let Some(p) = s.position {
            let i = f.index(p);
            // Keep an explicitly chosen dry point exactly; never silently move a user's marker.
            if f.r.water[i] == 0
                && out
                    .settlements
                    .iter()
                    .all(|o| p.distance(o.center) >= extent_gap(pop, o.spec.population))
            {
                chosen = Some((i, p, 1.0));
            } else {
                out.warnings.push(format!(
                    "{}: manual position is wet, solid rock or overlaps another settlement",
                    s.key
                ));
            }
        } else {
            let band = if pop < 15 {
                0
            } else if pop < 100 {
                1
            } else if pop < 1000 {
                2
            } else if pop < 20000 {
                3
            } else {
                4
            };
            let rank_key = format!("{band}|{}|{:?}", s.culture, s.site_prefs);
            let ranked = rankings.entry(rank_key).or_insert_with(|| {
                let rep = SettlementSpec {
                    population: [8, 40, 300, 3000, 30000][band],
                    ..s.clone()
                };
                let mut list: Vec<_> = candidates
                    .iter()
                    .filter_map(|&i| {
                        let (score, valid) = score(f, i, &rep, cfg, &noise);
                        valid.then_some((i, score.total))
                    })
                    .collect();
                list.sort_by(|a, b| b.1.total_cmp(&a.1).then_with(|| a.0.cmp(&b.0)));
                list
            });
            let limit = if cfg.mode == "auto" && index > 0 && pop < 150 {
                (ranked.len() as f64 * cfg.small_top).ceil() as usize
            } else {
                ranked.len()
            };
            let relaxations = if cfg.mode == "auto" {
                vec![cfg.spread]
            } else {
                vec![1.0, 0.85, 0.7, 0.55, 0.4]
            };
            // Without clustering the first admissible candidate wins (legacy order). With it, the
            // best of the first admissible candidates after adding the attraction term.
            let pool = if cfg.clustering > 0.0 { 160 } else { 1 };
            'search: for relax in relaxations {
                // Built only once the cheap exact check has rejected many candidates.
                let mut mask: Option<Vec<bool>> = None;
                let mut rejected = 0;
                for require_site in [true, false] {
                    let mut best: Option<(usize, usize, f64, f64)> = None;
                    let mut seen = 0;
                    for (rank, &(i, ranking_score)) in ranked.iter().take(limit).enumerate() {
                        let p = f.pos(i);
                        if mask.is_none() && rejected >= 256 {
                            mask = Some(blocked(relax));
                        }
                        let free = match &mask {
                            Some(b) => !b[i],
                            None => clear(p, relax),
                        };
                        if !free {
                            rejected += 1;
                            continue;
                        }
                        if (require_site && !matches(f, i, &s)) || !score(f, i, &s, cfg, &noise).1 {
                            continue;
                        }
                        let value = ranking_score + cluster_bonus(cfg, &out.settlements, pop, p);
                        if best.is_none_or(|b| value > b.3) {
                            best = Some((rank, i, ranking_score, value));
                        }
                        seen += 1;
                        if seen >= pool {
                            break;
                        }
                    }
                    if let Some((rank, i, ranking_score, _)) = best {
                        if !require_site && s.site_type != "auto" {
                            out.warnings.push(format!(
                                "{}: no {} site available; using the best other site",
                                s.key, s.site_type
                            ));
                        }
                        chosen = Some((i, f.pos(i), relax));
                        ranking = Some((rank + 1, ranking_score, [8, 40, 300, 3000, 30000][band]));
                        break 'search;
                    }
                }
            }
        }
        let Some((i, mut p, relax)) = chosen else {
            out.warnings.push(format!(
                "{} ({} inhabitants): no suitable position available",
                s.key, pop
            ));
            continue;
        };
        if s.position.is_none() {
            let mut jr = root.fork(&format!("settlement:{}", s.key)).fork("jitter");
            let jitter = Point {
                x: p.x + jr.range(-0.3, 0.3) * f.cell * stride as f64,
                y: p.y + jr.range(-0.3, 0.3) * f.cell * stride as f64,
            };
            let j = f.index(jitter);
            if score(f, j, &s, cfg, &noise).1 && clear(jitter, relax) {
                p = jitter;
            }
        }
        let final_i = f.index(p);
        let (mut scores, valid) = score(f, final_i, &s, cfg, &noise);
        scores.spacing_relaxation = relax;
        scores.cluster = cluster_bonus(cfg, &out.settlements, pop, p);
        scores.total += scores.cluster;
        if let Some((rank, value, reference)) = ranking {
            scores.candidate_rank = Some(rank);
            scores.ranking_score = Some(value);
            scores.ranking_population = Some(reference);
        }
        if s.position.is_some() && !valid {
            out.warnings.push(format!(
                "{}: manual position bypasses slope, flood or buildable-land preferences",
                s.key
            ));
        }
        if relax < 1.0 {
            out.warnings.push(format!(
                "{}: spacing relaxed to {:.0}%",
                s.key,
                relax * 100.0
            ));
        }
        let kind = if s.site_type != "auto" && matches(f, i, &s) {
            s.site_type.clone()
        } else {
            archetype(f, final_i, pop, &cfg.relief).into()
        };
        if s.name.is_empty() {
            s.name = if s.key == "main" {
                "Main settlement".into()
            } else {
                s.key.clone()
            };
        }
        out.settlements.push(Settlement {
            spec: s,
            center: p,
            cls: class_of(pop).into(),
            archetype: kind,
            radius: ext,
            scores,
        });
        if budget && index > 0 {
            remaining -= pop;
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::settlements::Raster;

    #[test]
    fn island_spur_and_lakeshore_sites_are_recognised() {
        let n = 64;
        let mut height = vec![10.0f32; n * n];
        let mut water = vec![0u8; n * n];
        let mut level = vec![0.0f32; n * n];
        for y in 0..n {
            for x in 0..n {
                let i = y * n + x;
                // Sea on the east third, with a small island in it.
                if x >= 44 && !((50..56).contains(&x) && (28..36).contains(&y)) {
                    water[i] = 1;
                }
                // A lake in the north-west, and a steep knoll in the south-west.
                if (6..14).contains(&x) && (6..14).contains(&y) {
                    water[i] = 2;
                    level[i] = 11.0;
                    height[i] = 8.0;
                }
                let d = ((x as f32 - 16.0).powi(2) + (y as f32 - 48.0).powi(2)).sqrt();
                if d < 6.0 {
                    height[i] = 40.0;
                }
            }
        }
        let rivers = vec![0.0f32; n * n];
        let ids = vec![-1i32; n * n];
        let f = Fields::new(Raster {
            width: 3200.0,
            n,
            height: &height,
            water: &water,
            water_level: &level,
            river_width: &rivers,
            river_ids: &ids,
        });
        let at = |x: usize, y: usize| y * n + x;
        assert!(site_matches(&f, at(52, 31), "island", 300));
        assert!(!site_matches(&f, at(30, 31), "island", 300));
        assert!(site_matches(&f, at(16, 10), "lakeshore", 300));
        assert!(!site_matches(&f, at(30, 40), "lakeshore", 300));
        assert!(site_matches(&f, at(16, 48), "spur", 300));
        assert!(!site_matches(&f, at(30, 31), "spur", 300));
    }
}
