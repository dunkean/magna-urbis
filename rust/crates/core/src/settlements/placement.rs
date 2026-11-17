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

/// The single-cell archetypes, in `archetype_index` order.
const ARCHETYPES: [&str; 5] = ["harbor", "bridge", "hilltop", "valley", "plain"];
fn archetype_index(f: &Fields, i: usize, pop: u32, relief: &str) -> usize {
    let ext = extent_radius(pop);
    if f.ds[i] < ext + 70.0 {
        0
    } else if f.db[i] < ext + 60.0 {
        1
    } else if (f.r.height[i] - f.hb[i]) > 8.0 && f.slope_s[i] < 0.12 {
        2
    } else if ["valley", "mountains", "high-mountains", "mixed"].contains(&relief)
        && f.place_dw(i) < 900.0
    {
        3
    } else {
        4
    }
}
fn archetype(f: &Fields, i: usize, pop: u32, relief: &str) -> &'static str {
    ARCHETYPES[archetype_index(f, i, pop, relief)]
}
/// The per-spec constants of `score` (culture catalogue lookups through `serde_json::Value`),
/// resolved once per request instead of once per candidate cell. Same values, same order of use.
struct SitePrep {
    mountain: f64,
    /// `log_weight(site_weight(..))` of each archetype, in `ARCHETYPES` order.
    archetype: [f64; 5],
    /// `site_weight(..)` of each special site, in `SPECIAL_SITES` order.
    special: [f64; 7],
    /// Culture trait `sitePrefs.flatWater` (0 = none): a canal culture without locks wants flat
    /// ground at the water (`flat_water`).
    flat_water: f64,
    /// Pull of the sea for this culture: its harbour weight (catalogue `sitePrefs.harbor`, 1 by
    /// default, times the user's multiplier), within [0, 2]. A culture that builds no ports
    /// (dwarven 0.1) is barely drawn to the shore.
    shore: f64,
}
impl SitePrep {
    fn new(s: &SettlementSpec, cfg: &Config) -> Self {
        Self {
            shore: site_weight(s, cfg, "harbor").clamp(0.0, 2.0),
            mountain: s
                .site_prefs
                .mountain_face
                .max(crate::urban::culture_site_pref(&s.culture, "mountainFace", 0.0)),
            archetype: ARCHETYPES.map(|site| log_weight(site_weight(s, cfg, site))),
            special: SPECIAL_SITES.map(|site| site_weight(s, cfg, site)),
            flat_water: crate::urban::culture_site_pref(&s.culture, "flatWater", 0.0).max(0.0),
        }
    }
}
fn site_matches(f: &Fields, i: usize, site: &str, pop: u32) -> bool {
    let ext = extent_radius(pop);
    match site {
        "harbor" => f.ds[i] < water_reach(ext),
        "estuary" => f.ds[i] < 700.0 && f.db[i] < ext + 60.0,
        "bridge" | "meander" => f.db[i] < water_reach(ext),
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
        "valley" => f.place_dw(i) < 900.0 && f.place_hab(i) > 2.5,
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
/// 1 on the shore strip (one block), fading to 0 half an extent further inland.
fn waterfront(d: f64, ext: f64) -> f64 {
    1.0 - smooth(d, 90.0, 90.0 + 0.5 * ext)
}
/// How far from the water a site of a water type may sit: its core fronts the shore.
fn water_reach(ext: f64) -> f64 {
    90.0 + 0.2 * ext
}
fn matches(f: &Fields, i: usize, s: &SettlementSpec) -> bool {
    site_matches(f, i, &s.site_type, s.population)
}
/// Site types defined by their water: the town fronts it (sea, river, lake, or an island's shore).
const WATER_SITES: [&str; 7] = [
    "harbor",
    "estuary",
    "bridge",
    "meander",
    "confluence",
    "lakeshore",
    "island",
];
fn water_site(site: &str) -> bool {
    WATER_SITES.contains(&site)
}
/// Culture preference × global multiplier for one site type (1 = neutral).
fn site_weight(s: &SettlementSpec, cfg: &Config, site: &str) -> f64 {
    s.site_prefs
        .weights
        .get(site)
        .copied()
        .unwrap_or_else(|| crate::urban::culture_site_weight(&s.culture, site))
        * cfg.site_weights.get(site).copied().unwrap_or(1.0)
}
/// Log-weight: ×3 → +0.55, ×0 → −1.96 (strongly avoided, still possible as a last resort).
fn log_weight(w: f64) -> f64 {
    0.5 * w.max(0.02).ln()
}
/// Small holdings can exploit a hillside without needing room for an entire town.
fn rural_flexibility(pop: u32) -> f64 {
    1.0 - smooth((pop.max(1) as f64).ln(), 80.0_f64.ln(), 1000.0_f64.ln())
}
fn raw_grade_limit(s: &SettlementSpec, prep: &SitePrep) -> f64 {
    0.16 + 0.25 * prep.mountain + 0.08 * s.site_prefs.woodland
        + 0.24 * rural_flexibility(s.population)
}
fn minimum_buildable_fraction(pop: u32, mountain: f64) -> f64 {
    let minimum = if pop >= 1000 {
        0.45
    } else if pop >= 150 {
        0.35
    } else {
        0.2
    };
    minimum * (1.0 - 0.6 * mountain).max(0.0) * (1.0 - rural_flexibility(pop))
}
/// The static suitability of cell `i` for `s` (log-weight scale): terrain, culture, site type,
/// water reached over the ground (`LandMasses::sea`, `river`: a cliff shore barely attracts) and
/// access from the regional entries (`LandMasses::access`). `valid` = the cell may hold the place.
fn score(f: &Fields, i: usize, s: &SettlementSpec, prep: &SitePrep, cfg: &Config, noise: &Noise, land: &LandMasses) -> (Scores, bool) {
    let pop = s.population;
    let p = f.pos(i);
    let ext = extent_radius(pop);
    let prefs = &s.site_prefs;
    // A hill culture (tibetan monastery) carries its own mountain-face preference in the catalogue.
    let mountain = prep.mountain;
    let wood = prefs.woodland;
    let rural = rural_flexibility(pop);
    let cap_s = 0.11 + 0.18 * mountain + 0.06 * wood + 0.18 * rural;
    let cap_r = raw_grade_limit(s, prep);
    let bf = f.fraction(p, (0.8 * ext).max(f.cell));
    let dw = f.place_dw(i);
    let sl = f.slope_s[i] as f64;
    let hab = f.place_hab(i);
    let prominence = (f.r.height[i] - f.hb[i]) as f64;
    let flatness = 1.6 * (1.0 - smooth(sl, 0.015, cap_s)) * cfg.flatness_weight;
    let buildable = 1.4 * bf * cfg.buildable_weight;
    // Fresh water: a river or a lake, never the sea.
    let fresh = if f.ds[i] <= dw + 0.5 { f.db[i].min(f.dl[i]) } else { dw };
    let fresh_water =
        0.8 * if fresh > 30.0 && fresh < 450.0 {
            (-(fresh - 70.0).max(0.0) / 180.0).exp()
        } else {
            0.0
        } * cfg.fresh_water_weight;
    // Water attraction: worth most at the water and fading with the distance walked to it
    // (slope-weighted, so a cliff top is far from the sea below it); the sea pull is the culture's.
    let sea = land.sea[i] as f64;
    let river_d = land.river[i] as f64;
    let river = if pop >= 150 && river_d.is_finite() {
        (if pop >= 1000 { 1.0 } else { 0.4 }) * waterfront(river_d, ext + 300.0)
    } else {
        0.0
    } * cfg.river_weight;
    let harbor = if pop >= 150 && sea.is_finite() {
        (if pop >= 1000 { 1.2 } else { 0.4 }) * waterfront(sea, ext + 300.0)
    } else {
        0.0
    } * cfg.coast_weight
        * prep.shore;
    let water_site = pop >= 150 && (f.ds[i] < ext + 80.0 || (f.db[i] < ext + 120.0 && hab > 2.0));
    let flood = if dw < 250.0 {
        -0.6 * (1.0 - smooth(hab, 1.5, 4.0))
    } else {
        0.0
    } * cfg.flood_weight;
    // Access: a town wants the regional entries within reach (slope-weighted cost-distance).
    let reach = land.access[i] as f64;
    let access = if pop >= 150 {
        -(if pop >= 1000 { 1.2 } else { 0.5 }) * if reach.is_finite() { smooth(reach, 2000.0, 20000.0) } else { 1.0 }
    } else {
        0.0
    };
    let culture = 1.4 * mountain * smooth(sl, 0.04, 0.18)
        + 0.6 * mountain * smooth(prominence, 0.0, 30.0)
        + 0.8 * wood
        + 0.4 * wood * smooth(sl, 0.03, 0.1);
    let culture = if prep.flat_water > 0.0 { culture + flat_water(f, i, ext, prep.flat_water) } else { culture };
    let mut site = prep.archetype[archetype_index(f, i, pop, &cfg.relief)];
    for (special, &w) in SPECIAL_SITES.iter().zip(&prep.special) {
        if w != 1.0 && site_matches(f, i, special, pop) {
            site += log_weight(w);
        }
    }
    let defense = cfg.defense_weight
        * (0.7 * smooth(prominence, 2.0, 25.0) + 0.3 * smooth(f.place_dw(i), 200.0, 1500.0));
    let elevation = cfg.elevation * 0.9 * (2.0 * f.elevation(i) - 1.0);
    let variation = 0.35 * cfg.variation_weight * noise.fbm(p.x / 900.0, p.y / 900.0, 2);
    let edge = p.x.min(p.y).min(f.r.width - p.x).min(f.r.width - p.y);
    let min_bf = minimum_buildable_fraction(pop, mountain);
    let valid = f.r.water[i] == 0
        && edge >= cfg.edge_margin * f.r.width + 0.8 * ext + 40.0
        && sl <= cap_s
        && f.slope[i] as f64 <= cap_r
        && dw >= if water_site { 40.0 } else { 25.0_f64.max(0.35 * ext) }
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
                + access
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
/// A site must hold the town plan's land need times this margin (`site_room`).
const ROOM_MARGIN: f64 = 1.15;
/// The land a town may draw on around its centre, in land radii (`extent_radius`): the plan grows
/// past its nominal disc (capacity extension) and stretches along a shore, so a port on a straight
/// coast (half a disc of land) still holds its town; a pocket does not.
const ROOM_REACH: f64 = 1.6;
/// Land counted as room must be walkable from the centre: no more than this rise per metre of
/// distance (plus `ROOM_RISE_FREE` m), so a plateau above a cliff never makes a shelf roomy.
const ROOM_RISE: f64 = 0.12;
const ROOM_RISE_FREE: f64 = 8.0;
/// Land (m²) a site must leave a place: the town plan's budget (`urban::planned_land`) with
/// `ROOM_MARGIN`. A hamlet needs its (small) plan's land too, counted with the buildable notion
/// of `site_room` (dry, under the house slope, above the water, on its own land mass): a centre
/// the urban stage cannot build round (a sand spit, a ledge) holds no place of 15 inhabitants
/// or more. Zero for a farmstead: one farm fits any usable cell.
fn site_need(s: &SettlementSpec) -> f64 {
    if s.population < 15 {
        return 0.0;
    }
    let need = crate::urban::planned_land(&s.culture, s.population)
        .unwrap_or(s.population as f64 / 60.0 * 10_000.0);
    ROOM_MARGIN * need
}
/// Dry buildable land (m², as `Fields::fraction` counts it) a place centred on cell `i` can use
/// within `ROOM_REACH` land radii, on the cell's own land mass. Read from the summed-area table
/// (disc ≈ π/4 of its square) away from water; counted cell by cell near water, where another
/// land mass or the sea may share the square. `f64::INFINITY` when nothing is needed.
fn site_room(f: &Fields, i: usize, pop: u32, need: f64) -> f64 {
    if need <= 0.0 {
        return f64::INFINITY;
    }
    let reach = ROOM_REACH * extent_radius(pop);
    let n = f.r.n;
    let k = n + 1;
    let cell2 = f.cell * f.cell;
    let r = (reach / f.cell).ceil() as usize;
    let (cx, cy) = (i % n, i / n);
    let (x0, x1) = (cx.saturating_sub(r), (cx + r).min(n - 1));
    let (y0, y1) = (cy.saturating_sub(r), (cy + r).min(n - 1));
    let square = (f.sat[(y1 + 1) * k + x1 + 1] as i64 - f.sat[y0 * k + x1 + 1] as i64
        - f.sat[(y1 + 1) * k + x0] as i64
        + f.sat[y0 * k + x0] as i64) as f64
        * cell2;
    if square < need {
        return square;
    }
    // A hamlet (many places, a small need) reads the table only: its few thousand m² are there
    // or not; the exact count is for the villages and towns a shore pocket would squeeze.
    if pop < 150 || f.place_dw(i) > reach + f.cell {
        return square * std::f64::consts::FRAC_PI_4;
    }
    let p = f.pos(i);
    let part = f.land_part[i];
    let h0 = f.r.height[i] as f64;
    let mut room = 0.0;
    for y in y0..=y1 {
        for x in x0..=x1 {
            let j = y * n + x;
            if f.land_part[j] != part || f.r.water[j] != 0 || f.slope[j] >= 0.2 || f.place_hab(j) < 1.0 {
                continue;
            }
            let d = f.pos(j).distance(p);
            if d <= reach && (f.r.height[j] as f64 - h0).abs() <= ROOM_RISE * d + ROOM_RISE_FREE {
                room += cell2;
            }
        }
    }
    room
}
/// Cost of one metre of a move climbing or descending `grade`: 1 on the flat, about 7 on a 20 %
/// slope, 40 on a 50 % scarp; a cliff is near-impassable.
fn grade_factor(grade: f64) -> f64 {
    1.0 + (grade / 0.08).powi(2)
}
/// Slope-weighted cost-distance (m) from the `source` cells over the `open` cells, 8 neighbours.
/// Unreached cells stay at infinity.
fn cost_distance(f: &Fields, source: impl Fn(usize) -> bool, open: impl Fn(usize) -> bool) -> Vec<f32> {
    use std::cmp::Reverse;
    use std::collections::BinaryHeap;
    let n = f.r.n;
    let mut d = vec![f32::INFINITY; n * n];
    let mut heap = BinaryHeap::new();
    for i in 0..n * n {
        if open(i) && source(i) {
            d[i] = 0.0;
            heap.push(Reverse((0u32, i)));
        }
    }
    const STEPS: [(isize, isize); 8] = [(1, 0), (-1, 0), (0, 1), (0, -1), (1, 1), (1, -1), (-1, 1), (-1, -1)];
    while let Some(Reverse((bits, i))) = heap.pop() {
        let di = f32::from_bits(bits);
        if di > d[i] {
            continue;
        }
        let (x, y) = ((i % n) as isize, (i / n) as isize);
        for (dx, dy) in STEPS {
            let (xx, yy) = (x + dx, y + dy);
            if xx < 0 || yy < 0 || xx >= n as isize || yy >= n as isize {
                continue;
            }
            let j = yy as usize * n + xx as usize;
            if !open(j) {
                continue;
            }
            let len = if dx != 0 && dy != 0 { f.cell * std::f64::consts::SQRT_2 } else { f.cell };
            let grade = (f.r.height[j] - f.r.height[i]).abs() as f64 / len;
            let nd = (di as f64 + len * grade_factor(grade)) as f32;
            if nd < d[j] {
                d[j] = nd;
                // Non-negative floats order as their bits.
                heap.push(Reverse((nd.to_bits(), j)));
            }
        }
    }
    d
}
/// A culture that turns its back to the sea: a harbour weight under this builds no port.
const INLAND_HARBOUR_WEIGHT: f64 = 0.5;
/// A land mass holding this share of the land is a mainland; with none, the map is an archipelago.
const MAINLAND_SHARE: f64 = 0.4;
/// The static layers of a placement, measured once: land masses, and the slope-weighted
/// cost-distances to usable water and from the regional entries.
struct LandMasses {
    total: f64,
    largest: usize,
    mainland: bool,
    /// From the regional entries (dry map-edge cells) over land and crossable rivers; infinite on
    /// land no road can reach (an island). All zero in the Underdark (its own cave rules).
    access: Vec<f32>,
    /// Some dry land is reachable from the entries.
    reachable: bool,
    /// To the sea or a lake shore, and to a navigable river bank (river width 4.5 m and more).
    sea: Vec<f32>,
    river: Vec<f32>,
}
impl LandMasses {
    fn of(f: &Fields) -> Self {
        let n = f.r.n;
        let total: f64 = f.land_area.iter().sum();
        let largest = (0..f.land_area.len())
            .max_by(|&a, &b| f.land_area[a].total_cmp(&f.land_area[b]).then_with(|| b.cmp(&a)))
            .unwrap_or(0);
        let mainland = f.land_area.get(largest).is_some_and(|&a| a >= MAINLAND_SHARE * total);
        // Land and crossable rivers; the sea, lakes and cave rock stop a walker.
        let open = |i: usize| f.r.water[i] == 0 || f.r.water[i] == 3;
        let lake = |j: usize| f.r.water[j] == 2 && f.r.water_level[j] > f.r.height[j];
        let next_to = |i: usize, water: &dyn Fn(usize) -> bool| {
            let (x, y) = (i % n, i / n);
            (x > 0 && water(i - 1)) || (x + 1 < n && water(i + 1)) || (y > 0 && water(i - n)) || (y + 1 < n && water(i + n))
        };
        let sea = cost_distance(f, |i| f.r.water[i] == 0 && next_to(i, &|j| f.r.water[j] == 1 || lake(j)), open);
        let river = cost_distance(f, |i| f.r.water[i] == 0 && next_to(i, &|j| f.r.water[j] == 3 && f.r.river_width[j] >= 4.5), open);
        let access = if f.cave.is_some() {
            vec![0.0; n * n]
        } else {
            cost_distance(f, |i| f.r.water[i] == 0 && (i % n == 0 || i / n == 0 || i % n == n - 1 || i / n == n - 1), open)
        };
        let reachable = (0..n * n).any(|i| f.r.water[i] == 0 && access[i].is_finite());
        Self { total, largest, mainland, access, reachable, sea, river }
    }
    /// The main place (request `index` 0) always stands on the largest land mass. A town of 1,000
    /// or more stands on land reachable from the regional entries (on the largest mass when no
    /// land is). Smaller places go anywhere (islands included). Explicit positions are kept apart.
    fn admits(&self, f: &Fields, i: usize, s: &SettlementSpec, index: usize) -> bool {
        if index == 0 {
            return f.land_part[i] as usize == self.largest;
        }
        if s.population < 1000 {
            return true;
        }
        if self.reachable { self.access[i].is_finite() } else { f.land_part[i] as usize == self.largest }
    }
}
/// Underdark population steps below a request, largest first: a town, a large village, a
/// village, a hamlet, a small hamlet, a single farmstead or outpost.
const CAVE_STEPS: [u32; 6] = [5000, 1000, 300, 80, 20, 8];
/// Underdark, once every pass has failed: the largest place this request still fits on open
/// floor (dry, no steeper than the raw grade limit, above any real water, inside the frame,
/// clear of every placed extent): its own population first, then the smaller steps.
/// - A town or city (1000 inhabitants and more) need not fit one chamber: it spreads along
///   the galleries and packs (`CAVE_SPREAD`, `CAVE_LAND_PER_HOME`). It fits where the floor of
///   its cave system within `CAVE_SPREAD` × its land radius holds `CAVE_LAND_PER_HOME` of its
///   ordinary buildable land, and takes the chamber with the most such floor.
/// - A smaller place needs its class's share of buildable floor around it, as on the surface.
///
/// Returns the cell and the population it holds, or `None` when no open floor is left.
fn cave_room(
    f: &Fields,
    s: &SettlementSpec,
    cfg: &Config,
    noise: &Noise,
    placed: &[Settlement],
    candidates: &[usize],
    land: &LandMasses,
) -> Option<(usize, u32)> {
    let steps = std::iter::once(s.population)
        .chain(CAVE_STEPS.into_iter().filter(|&p| p < s.population));
    for pop in steps {
        let spec = SettlementSpec { population: pop, ..s.clone() };
        let prep = SitePrep::new(&spec, cfg);
        let ext = extent_radius(pop);
        let frame = 0.8 * ext + 40.0;
        let grade = raw_grade_limit(&spec, &prep);
        let min_bf = minimum_buildable_fraction(pop, prep.mountain);
        let town = pop >= 1000;
        // A town's ordinary buildable land, and the radius its spread may draw floor from.
        let need = min_bf.max(0.25) * std::f64::consts::PI * (0.8 * ext).powi(2);
        let spread = super::CAVE_SPREAD * 0.8 * ext;
        let values: Vec<Option<(f64, f64)>> = crate::urban::par::map(candidates, |_, &i| {
            let p = f.pos(i);
            let edge = p.x.min(p.y).min(f.r.width - p.x).min(f.r.width - p.y);
            if f.r.water[i] != 0 || edge < frame || f.slope[i] as f64 > grade || f.place_hab(i) < 1.0
                || !placed.iter().all(|o| p.distance(o.center) >= extent_gap(pop, o.spec.population))
            {
                return None;
            }
            let core = f.fraction(p, (0.2 * ext).max(f.cell));
            let room = if town {
                // Floor within the spread radius (the fraction's square), and no more than the
                // connected cave system holds.
                let near = f.fraction(p, spread) * (2.0 * spread).powi(2);
                let reachable = f.cave.as_ref().map_or(near, |c| near.min(c.reachable_floor(i)));
                (reachable >= super::CAVE_LAND_PER_HOME * need).then_some(reachable)
            } else {
                (f.fraction(p, (0.8 * ext).max(f.cell)) >= min_bf).then_some(0.0)
            };
            room.filter(|_| core > 0.0).map(|room| {
                (room, score(f, i, &spec, &prep, cfg, noise, land).0.total + cluster_bonus(cfg, placed, pop, p))
            })
        });
        let best = candidates
            .iter()
            .zip(&values)
            .filter_map(|(&i, value)| value.map(|v| (i, v)))
            .max_by(|a, b| {
                a.1.0.total_cmp(&b.1.0)
                    .then_with(|| a.1.1.total_cmp(&b.1.1))
                    .then_with(|| b.0.cmp(&a.0))
            });
        if let Some((i, _)) = best {
            return Some((i, pop));
        }
    }
    None
}
/// Canal towns without locks (culture trait `sitePrefs.flatWater`, weight `w`): their canals only
/// follow ground within about 2 m of their start level, so the town seeks flat land at the sea or a
/// wide river mouth, best a lagoon or a delta (sea and river both in reach), and avoids hilly land.
/// Relief: the height range of the dry ground at 0.4 and 0.8 extent in eight directions (17 cells),
/// flat under 2 m, hilly over 8 m.
fn flat_water(f: &Fields, i: usize, ext: f64, w: f64) -> f64 {
    let p = f.pos(i);
    let h0 = f.r.height[i];
    let (mut lo, mut hi) = (h0, h0);
    for r in [0.4 * ext, 0.8 * ext] {
        for k in 0..8 {
            let a = k as f64 * std::f64::consts::FRAC_PI_4;
            let q = Point { x: p.x + r * a.cos(), y: p.y + r * a.sin() };
            if q.x < 0.0 || q.y < 0.0 || q.x >= f.r.width || q.y >= f.r.width {
                continue;
            }
            let j = f.index(q);
            if f.r.water[j] == 0 {
                lo = lo.min(f.r.height[j]);
                hi = hi.max(f.r.height[j]);
            }
        }
    }
    let flat = 1.0 - smooth((hi - lo) as f64, 2.0, 8.0);
    let sea = f.ds[i] < ext + 80.0;
    let mouth = f.db[i] < ext + 120.0;
    let water = if sea && mouth { 1.5 } else if sea || mouth { 1.0 } else { 0.0 };
    w * (0.8 * water * flat - 0.4 * (1.0 - flat))
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
    let rural_places = usable.powf(0.8) / 7.0;
    let villages = (rural_places * rf).round() as usize;
    let counts = [
        cities,
        towns,
        villages,
        rural_places.round() as usize,
        (rural_places * 1.4).round() as usize,
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
/// Size bands of the placement layers and their representative populations.
const BAND_REPS: [u32; 5] = [8, 40, 300, 3000, 30000];
fn band_of(pop: u32) -> usize {
    if pop < 15 {
        0
    } else if pop < 100 {
        1
    } else if pop < 1000 {
        2
    } else if pop < 20000 {
        3
    } else {
        4
    }
}
/// One class down (city → town → village → hamlet), for a place no cell can hold.
fn shrink(pop: u32) -> Option<u32> {
    [19999, 999, 149, 14].into_iter().find(|&p| p < pop)
}
/// How strongly a new place of `big` inhabitants repels a later place of band population `q`
/// (score units at the centre, fading to 0 at their pair spacing): towns and large villages
/// keep well apart; hamlets and farms near a much larger place are welcome (satellites).
fn repulsion(q: u32, big: u32) -> f64 {
    let satellite = 4 * q as u64 <= big as u64;
    if q >= 1000 {
        8.0
    } else if q >= 150 {
        if satellite { 4.0 } else { 6.0 }
    } else if satellite {
        0.5
    } else {
        2.0
    }
}
/// Updates the dynamic layers (`penalty`, one per band, on the candidate cells of the `stride`
/// grid) around a place just set at `center`: its footprint gap is excluded, the repulsion fades
/// over the pair spacing, and smaller bands gain the optional satellite pull (`cfg.clustering`).
fn repel(f: &Fields, penalty: &mut [Vec<f32>], stride: usize, cfg: &Config, spacing_scale: f64, center: Point, pop: u32) {
    let n = f.r.n as isize;
    let s = stride as isize;
    for (band, layer) in penalty.iter_mut().enumerate() {
        let q = BAND_REPS[band];
        let spacing = pair_spacing(q, pop) * spacing_scale;
        let gap = extent_gap(q, pop);
        let strength = repulsion(q, pop);
        let pull = if cfg.clustering > 0.0 && 4 * q as u64 <= pop as u64 { 0.8 * cfg.clustering } else { 0.0 };
        let reach = (if pull > 0.0 { 3.0 * spacing } else { spacing }).max(gap);
        let r = (reach / f.cell).ceil() as isize;
        let (cx, cy) = ((center.x / f.cell) as isize, (center.y / f.cell) as isize);
        let mut y = ((cy - r).max(0) + s - 1) / s * s;
        while y <= (cy + r).min(n - 1) {
            let mut x = ((cx - r).max(0) + s - 1) / s * s;
            while x <= (cx + r).min(n - 1) {
                let i = (y * n + x) as usize;
                let d = f.pos(i).distance(center);
                if d < gap {
                    layer[i] = f32::NEG_INFINITY;
                } else if d < reach {
                    let mut v = 0.0;
                    if d < spacing {
                        v -= strength * (1.0 - smooth(d, gap, spacing));
                    }
                    if pull > 0.0 {
                        v += pull * (-d / (3.0 * spacing)).exp();
                    }
                    layer[i] += v as f32;
                }
                x += s;
            }
            y += s;
        }
    }
}
/// The site model (see `web/out/settlement-review/PLACEMENT_MODEL.md`).
/// - Static layers, once per map: room (summed-area table), water reached over the ground and
///   access from the regional entries (slope-weighted cost-distances, `LandMasses`), terrain and
///   culture (`score`), one per size band and culture.
/// - Places in descending size, each drawn (seeded, weighted) from its band layer restricted to
///   the cells that hold it: land rule (`LandMasses::admits`), room for its population, frame,
///   explicit site type; then the dynamic layers are updated around it (`repel`).
/// - No cell: the place shrinks one class and draws again (announced); a user's site type is
///   given up before that. Explicit positions are kept as given.
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
    // Largest first (the main place stays first), so each place draws from layers that already
    // carry the larger places' repulsion.
    if requests.len() > 2 {
        requests[1..].sort_by(|a, b| b.population.cmp(&a.population));
    }
    let mut out = Output {
        settlements: vec![],
        warnings: vec![],
        requested: requests.len(),
        usable_km2: usable,
        activities: vec![],
    };
    // The legacy class budget: secondary places never outnumber the main population in total.
    let budget = cfg.mode == "auto" && cfg.distribution == "classes";
    let n = f.r.n;
    let stride = ((40.0_f64.max(1.5 * f.cell) / f.cell).round() as usize).max(1);
    let candidates: Vec<_> = (0..n)
        .step_by(stride)
        .flat_map(|y| (0..n).step_by(stride).map(move |x| y * n + x))
        .filter(|&i| f.r.water[i] == 0)
        .collect();
    let land = LandMasses::of(f);
    let mut remaining = cfg.main.population;
    // Underdark: the class spacing is a law of usable land; on a map that is only a share of
    // open floor it shrinks with the square root of that share. Automatic maps also apply the
    // user's spread. Ordinary list maps: 1.
    let cave_spacing = f.cave.as_ref().map_or(1.0, |c| c.floor.sqrt().clamp(0.1, 1.0));
    let spacing_scale = cave_spacing * if cfg.mode == "auto" { cfg.spread.max(0.05) } else { 1.0 };
    let mut statics: BTreeMap<String, Vec<Option<f32>>> = BTreeMap::new();
    let mut penalty: Vec<Vec<f32>> = (0..BAND_REPS.len()).map(|_| vec![0.0f32; n * n]).collect();
    let mut dropped_underground = 0usize;
    for (index, mut s) in requests.into_iter().enumerate() {
        if s.key.is_empty() {
            s.key = format!("place:{index}");
        }
        if budget && index > 0 && s.population > remaining {
            continue;
        }
        let requested = s.population;
        let explicit = s.site_type != "auto";
        let prep = SitePrep::new(&s, cfg);
        let mut chosen: Option<(usize, Point)> = None;
        let mut reference: Option<(f64, u32)> = None;
        let mut lowered = None;
        let mut site_dropped = false;
        if let Some(p) = s.position {
            let i = f.index(p);
            // Keep an explicitly chosen dry point exactly, wherever it is (also against another
            // settlement: the urban stage keeps their land apart); never move a user's marker.
            if f.r.water[i] == 0 {
                chosen = Some((i, p));
            } else {
                out.warnings.push(format!("{}: manual position is wet or solid rock", s.key));
            }
        } else {
            // Attempts: the requested size (with its explicit site type first), then one class
            // smaller at a time. The Underdark keeps its own lowering (`cave_room`).
            let mut attempts = vec![];
            if explicit {
                attempts.push((requested, true));
            }
            attempts.push((requested, false));
            if f.cave.is_none() {
                let mut pop = requested;
                while let Some(smaller) = shrink(pop) {
                    attempts.push((smaller, false));
                    pop = smaller;
                }
            }
            let mut draw = root.fork(&format!("settlement:{}", s.key)).fork("placement");
            for (pop, require_site) in attempts {
                let spec = SettlementSpec { population: pop, ..s.clone() };
                let band = band_of(pop);
                let key = format!("{band}|{}|{:?}", s.culture, s.site_prefs);
                let layer: &[Option<f32>] = statics.entry(key).or_insert_with(|| {
                    let rep = SettlementSpec { population: BAND_REPS[band], ..s.clone() };
                    let rep_prep = SitePrep::new(&rep, cfg);
                    crate::urban::par::map(&candidates, |_, &i| {
                        let (scores, valid) = score(f, i, &rep, &rep_prep, cfg, &noise, &land);
                        valid.then_some(scores.total as f32)
                    })
                });
                let ext = extent_radius(pop);
                let frame = cfg.edge_margin * f.r.width + 0.8 * ext + 40.0;
                let need = site_need(&spec);
                let temperature = 0.22 + 0.9 * rural_flexibility(pop);
                let dynamic = &penalty[band];
                let mut weights: Vec<Option<f64>> = crate::urban::par::map(&candidates, |k, &i| {
                    let base = layer[k]?;
                    let repelled = dynamic[i];
                    if !repelled.is_finite() || !land.admits(f, i, &spec, index) {
                        return None;
                    }
                    let p = f.pos(i);
                    if p.x.min(p.y).min(f.r.width - p.x).min(f.r.width - p.y) < frame
                        || (require_site && !matches(f, i, &spec))
                    {
                        return None;
                    }
                    let room = site_room(f, i, pop, need);
                    if room < need {
                        return None;
                    }
                    let roomy = if need > 0.0 { 0.5 * smooth(room / need, 1.0, 2.0) } else { 0.0 };
                    Some((base as f64 + repelled as f64) / temperature + roomy)
                });
                // Gumbel-max: one seeded draw over the whole layer, in candidate order. A drawn
                // cell closer to a placed footprint than this place's own gap is struck and redrawn.
                let picked = loop {
                    let mut best: Option<(usize, f64)> = None;
                    for (k, w) in weights.iter().enumerate() {
                        let Some(w) = *w else { continue };
                        let value = w - (-draw.float().max(1e-12).ln()).ln();
                        if best.is_none_or(|b| value > b.1) {
                            best = Some((k, value));
                        }
                    }
                    let Some((k, _)) = best else { break None };
                    let p = f.pos(candidates[k]);
                    if out.settlements.iter().all(|o| p.distance(o.center) >= extent_gap(pop, o.spec.population)) {
                        break Some(k);
                    }
                    weights[k] = None;
                };
                if let Some(k) = picked {
                    let i = candidates[k];
                    chosen = Some((i, f.pos(i)));
                    reference = layer[k].map(|v| (v as f64, BAND_REPS[band]));
                    if pop < requested {
                        lowered = Some(pop);
                    }
                    site_dropped = explicit && !require_site;
                    break;
                }
            }
        }
        // Underdark: never forced into the rock or over another place. The request takes the
        // largest place its room still holds, announced; with no open floor left it is not placed.
        let mut forced = false;
        if chosen.is_none() && s.position.is_none() && f.cave.is_some() {
            if let Some((i, room)) = cave_room(f, &s, cfg, &noise, &out.settlements, &candidates, &land) {
                if room < requested {
                    out.warnings.push(format!(
                        "{}: lowered from {} to {} inhabitants to fit its cave chamber",
                        s.key, requested, room
                    ));
                    lowered = Some(room);
                }
                chosen = Some((i, f.pos(i)));
                forced = true;
            }
        }
        let Some((i, mut p)) = chosen else {
            if f.cave.is_some() {
                dropped_underground += 1;
                out.warnings.push(format!("{} ({} inhabitants): no open cave floor left; not placed", s.key, requested));
            } else {
                out.warnings.push(format!("{} ({} inhabitants): no suitable position available", s.key, requested));
            }
            continue;
        };
        let pop = lowered.unwrap_or(requested);
        if pop < requested && !forced {
            out.warnings.push(format!("{}: lowered from {} to {} inhabitants: no room for it on the map", s.key, requested, pop));
        }
        s.population = pop;
        let ext = extent_radius(pop);
        if s.position.is_none() && !forced {
            let mut jr = root.fork(&format!("settlement:{}", s.key)).fork("jitter");
            let jitter = Point {
                x: p.x + jr.range(-0.3, 0.3) * f.cell * stride as f64,
                y: p.y + jr.range(-0.3, 0.3) * f.cell * stride as f64,
            };
            let j = f.index(jitter);
            if land.admits(f, j, &s, index)
                && score(f, j, &s, &prep, cfg, &noise, &land).1
                && out.settlements.iter().all(|o| jitter.distance(o.center) >= extent_gap(pop, o.spec.population))
            {
                p = jitter;
            }
        }
        // A centre lies strictly inside the map, a manual marker on the frame line included (the
        // road stage refuses a centre at the map width).
        p.x = p.x.clamp(0.5, f.r.width - 0.5);
        p.y = p.y.clamp(0.5, f.r.width - 0.5);
        let final_i = f.index(p);
        let (mut scores, valid) = score(f, final_i, &s, &prep, cfg, &noise, &land);
        if let Some((value, reference)) = reference {
            scores.ranking_score = Some(value);
            scores.ranking_population = Some(reference);
        }
        if s.position.is_some() && !valid {
            out.warnings.push(format!(
                "{}: manual position bypasses slope, flood or buildable-land preferences",
                s.key
            ));
        }
        let site_kept = explicit && !site_dropped && matches(f, i, &s);
        if explicit && !site_kept {
            // Never silent: a requested site type that could not be met is announced.
            out.warnings.push(if water_site(&s.site_type) {
                format!(
                    "{}: no {} site on the water, even on a narrow or steep shore; the town is placed away from the water without this role",
                    s.key, s.site_type
                )
            } else {
                format!("{}: no {} site available; sampling another available site", s.key, s.site_type)
            });
        }
        let mut kind = if site_kept {
            s.site_type.clone()
        } else {
            archetype(f, final_i, pop, &cfg.relief).into()
        };
        // A place is a harbour when its site is on the sea and its culture builds ports.
        if kind == "harbor" && !site_kept && site_weight(&s, cfg, "harbor") < INLAND_HARBOUR_WEIGHT {
            kind = ARCHETYPES[1 + archetype_index_inland(f, final_i, pop, &cfg.relief)].into();
        }
        if s.name.is_empty() {
            s.name = if s.key == "main" { "Main settlement".into() } else { s.key.clone() };
        }
        repel(f, &mut penalty, stride, cfg, spacing_scale, p, pop);
        out.settlements.push(Settlement {
            spec: s,
            center: p,
            cls: class_of(pop).into(),
            archetype: kind,
            radius: ext,
            scores,
        });
        if budget && index > 0 {
            remaining = remaining.saturating_sub(pop);
        }
    }
    if dropped_underground > 0 {
        out.warnings.push(format!("{} places not placed: no open cave floor left", dropped_underground));
    }
    out
}
/// `archetype_index` without the harbour: the archetype of a shore cell for a culture that
/// builds no port (index into `ARCHETYPES[1..]`).
fn archetype_index_inland(f: &Fields, i: usize, pop: u32, relief: &str) -> usize {
    let ext = extent_radius(pop);
    if f.db[i] < ext + 60.0 {
        0
    } else if (f.r.height[i] - f.hb[i]) > 8.0 && f.slope_s[i] < 0.12 {
        1
    } else if ["valley", "mountains", "high-mountains", "mixed"].contains(&relief) && f.place_dw(i) < 900.0 {
        2
    } else {
        3
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::settlements::Raster;

    fn flat(n: usize, width: f64, height: f32) -> Fields {
        let h = vec![height; n * n];
        let water = vec![0u8; n * n];
        let rivers = vec![0.0f32; n * n];
        let ids = vec![-1i32; n * n];
        Fields::new(Raster { width, n, height: &h, water: &water, water_level: &h, river_width: &rivers, river_ids: &ids })
    }

    /// A steep cone (grade 2): no cell can hold a town, nor a hamlet. The request is announced,
    /// never forced onto the slope.
    #[test]
    fn a_request_with_no_admissible_cell_is_announced_not_forced() {
        let n = 32;
        let width = 3200.0;
        let cell = width / n as f64;
        let height: Vec<f32> = (0..n * n)
            .map(|i| {
                let x = (i % n) as f64 * cell + 0.5 * cell - width / 2.0;
                let y = (i / n) as f64 * cell + 0.5 * cell - width / 2.0;
                (10000.0 - 2.0 * x.hypot(y)) as f32
            })
            .collect();
        let water = vec![0; n * n];
        let rivers = vec![0.0; n * n];
        let ids = vec![-1; n * n];
        let f = Fields::new(Raster { width, n, height: &height, water: &water, water_level: &height, river_width: &rivers, river_ids: &ids });
        let spec = SettlementSpec { key: "steep-town".into(), population: 5000, ..Default::default() };
        let cfg = Config { mode: "list".into(), list: vec![spec], edge_margin: 0.15, relief: "high-mountains".into(), ..Default::default() };
        let out = place("required-steep-town", &f, &cfg);
        assert_eq!(out.requested, 1);
        assert!(out.settlements.is_empty(), "{:?}", out.settlements.iter().map(|s| s.center).collect::<Vec<_>>());
        assert!(out.warnings.iter().any(|w| w.contains("steep-town (5000 inhabitants): no suitable position available")));
    }

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
        let f = Fields::new(Raster { width: 3200.0, n, height: &height, water: &water, water_level: &level, river_width: &rivers, river_ids: &ids });
        let at = |x: usize, y: usize| y * n + x;
        assert!(site_matches(&f, at(52, 31), "island", 300));
        assert!(!site_matches(&f, at(30, 31), "island", 300));
        assert!(site_matches(&f, at(16, 10), "lakeshore", 300));
        assert!(!site_matches(&f, at(30, 40), "lakeshore", 300));
        assert!(site_matches(&f, at(16, 48), "spur", 300));
        assert!(!site_matches(&f, at(30, 31), "spur", 300));
    }

    /// 4 km square, 50 m cells: a flat plateau (200 m) in the west, a steep scarp (grade ~0.5)
    /// from 2400 to 2800 m, a narrow 200 m shore shelf (3 m) and the sea from 3000 m.
    fn steep_coast() -> Fields {
        let n = 80;
        let width = 4000.0;
        let cell = width / n as f64;
        let mut height = vec![0.0f32; n * n];
        let mut water = vec![0u8; n * n];
        for i in 0..n * n {
            let x = (i % n) as f64 * cell + 0.5 * cell;
            height[i] = if x >= 3000.0 {
                water[i] = 1;
                -5.0
            } else if x >= 2800.0 {
                3.0
            } else if x >= 2400.0 {
                (3.0 + (2800.0 - x) * 197.0 / 400.0) as f32
            } else {
                200.0
            };
        }
        let level = vec![0.0f32; n * n];
        let rivers = vec![0.0f32; n * n];
        let ids = vec![-1i32; n * n];
        Fields::new(Raster { width, n, height: &height, water: &water, water_level: &level, river_width: &rivers, river_ids: &ids })
    }

    fn harbour_list(site_type: &str) -> (SettlementSpec, Config) {
        let spec = SettlementSpec { key: "port".into(), population: 6000, site_type: site_type.into(), ..Default::default() };
        let cfg = Config { mode: "list".into(), list: vec![spec.clone()], edge_margin: 0.0, ..Default::default() };
        (spec, cfg)
    }

    /// A harbour asked on a coast whose only shore is a 200 m shelf under a scarp: the shelf
    /// cannot hold 6,000 people, so the town keeps its size on the plateau, announced, and the
    /// cliff makes the sea far for the plateau (slope-weighted water distance).
    #[test]
    fn a_harbour_town_is_never_squeezed_onto_a_cliff_shelf() {
        let f = steep_coast();
        let (spec, cfg) = harbour_list("harbor");
        let land = LandMasses::of(&f);
        let plateau = 40 * f.r.n + 40;
        assert!(land.sea[plateau] as f64 > 5.0 * f.ds[plateau], "the scarp lengthens the way to the sea");
        let out = place("steep-harbour", &f, &cfg);
        assert_eq!(out.settlements.len(), 1);
        let town = &out.settlements[0];
        assert_eq!(town.spec.population, spec.population);
        assert!(town.center.x < 2400.0, "town at {:?}", town.center);
        assert_ne!(town.archetype, "harbor");
        assert!(out.warnings.iter().any(|w| w.contains("no harbor site on the water")));
    }

    #[test]
    fn harbour_town_without_water_in_reach_loses_its_site_with_a_warning() {
        let f = flat(40, 4000.0, 50.0);
        let (_, cfg) = harbour_list("harbor");
        let out = place("dry-harbour", &f, &cfg);
        assert_eq!(out.settlements.len(), 1);
        assert_ne!(out.settlements[0].archetype, "harbor");
        assert!(out.warnings.iter().any(|w| w.contains("no harbor site on the water")));
    }

    /// 64 × 50 m cells of cave rock (class 2 at ground level, as the bridge sends it) with two
    /// round chambers (radius 8 cells, centres 2 km apart) joined by a 150 m corridor.
    fn two_chambers() -> (Vec<f32>, Vec<u8>) {
        let n = 64;
        let mut height = vec![10.5f32; n * n];
        let mut water = vec![2u8; n * n];
        for y in 0..n {
            for x in 0..n {
                let d = |cx: f64| ((x as f64 - cx).powi(2) + (y as f64 - 32.0).powi(2)).sqrt();
                if d(12.0) <= 8.0 || d(52.0) <= 8.0 || ((12..=52).contains(&x) && (31..=33).contains(&y)) {
                    height[y * n + x] = 10.0;
                    water[y * n + x] = 0;
                }
            }
        }
        (height, water)
    }

    #[test]
    fn underdark_places_every_settlement_on_floor_and_drops_the_rest() {
        let n = 64;
        let (height, water) = two_chambers();
        let rivers = vec![0.0f32; n * n];
        let ids = vec![-1i32; n * n];
        let level: Vec<f32> = height.iter().zip(&water).map(|(&h, &w)| if w == 2 { h - 1000.0 } else { h }).collect();
        let f = Fields::new(Raster { width: 3200.0, n, height: &height, water: &water, water_level: &level, river_width: &rivers, river_ids: &ids });
        assert!(f.cave.is_some());
        let mut list = vec![SettlementSpec { key: "main".into(), population: 3000, ..Default::default() }];
        list.extend((1..120).map(|k| SettlementSpec { key: format!("place-{k}"), population: 300, ..Default::default() }));
        let cfg = Config { mode: "list".into(), list, edge_margin: 0.0, ..Default::default() };
        let out = place("cave-dense", &f, &cfg);
        assert!(out.settlements.len() > 2 && out.settlements.len() < 120, "{} placed", out.settlements.len());
        for s in &out.settlements {
            assert_eq!(f.r.water[f.index(s.center)], 0, "{} on rock", s.spec.key);
        }
        for (k, a) in out.settlements.iter().enumerate() {
            for b in &out.settlements[k + 1..] {
                assert!(a.center.distance(b.center) >= extent_gap(a.spec.population, b.spec.population) - 1e-6,
                    "{} over {}", a.spec.key, b.spec.key);
            }
        }
        let chamber = |cx: f64| out.settlements.iter()
            .any(|s| (s.center.x - (cx + 0.5) * 50.0).hypot(s.center.y - 32.5 * 50.0) <= 425.0);
        assert!(chamber(12.0) && chamber(52.0), "both chambers used");
        assert!(out.warnings.iter().any(|w| w.contains("not placed: no open cave floor left")));
    }

    /// An archipelago: four islands (250 m radius, 6 m high) in the sea, and a lagoon of water
    /// class 2 at ground level over 14 % of the map. That lagoon is not cave rock: no cave, and
    /// the villages stand on the shore.
    #[test]
    fn archipelago_villages_hug_the_sea_and_no_cave_is_seen() {
        let n = 64;
        let mut height = vec![-5.0f32; n * n];
        let mut water = vec![1u8; n * n];
        let mut level = vec![0.0f32; n * n];
        for y in 0..n {
            for x in 0..n {
                let i = y * n + x;
                if y < 9 {
                    (height[i], water[i], level[i]) = (0.5, 2, 0.5);
                }
                for (cx, cy) in [(16.0, 24.0), (48.0, 24.0), (16.0, 48.0), (48.0, 48.0)] {
                    if ((x as f64 - cx).powi(2) + (y as f64 - cy).powi(2)).sqrt() <= 5.0 {
                        (height[i], water[i], level[i]) = (6.0, 0, 6.0);
                    }
                }
            }
        }
        let rivers = vec![0.0f32; n * n];
        let ids = vec![-1i32; n * n];
        let f = Fields::new(Raster { width: 3200.0, n, height: &height, water: &water, water_level: &level, river_width: &rivers, river_ids: &ids });
        assert!(f.cave.is_none(), "a lagoon at ground level is not cave rock");
        let list = (0..4).map(|k| SettlementSpec { key: format!("village-{k}"), population: 400, ..Default::default() }).collect();
        let cfg = Config { mode: "list".into(), list, ..Default::default() };
        let out = place("archipelago", &f, &cfg);
        let reach = extent_radius(400) + 70.0;
        let shore = out.settlements.iter().filter(|s| f.ds[f.index(s.center)] < reach).count();
        assert!(shore >= 3, "{shore} of {} villages on the shore", out.settlements.len());
    }

    /// `n` cells of cave rock on `width` metres with round chambers of `r` cells on a grid of
    /// `step` cells (first centre at `first`), joined to their neighbours by galleries `w` cells
    /// wide (none when `w` is 0).
    fn cave_grid(n: usize, width: f64, r: f64, first: usize, step: usize, w: usize) -> Fields {
        let mut height = vec![10.5f32; n * n];
        let mut water = vec![2u8; n * n];
        let centres: Vec<usize> = (first..n).step_by(step).filter(|&c| c + (r as usize) < n).collect();
        let (lo, hi) = (centres[0], *centres.last().unwrap());
        for y in 0..n {
            for x in 0..n {
                let chamber = centres.iter().any(|&cy| centres.iter()
                    .any(|&cx| ((x as f64 - cx as f64).powi(2) + (y as f64 - cy as f64).powi(2)).sqrt() <= r));
                let gallery = w > 0
                    && ((centres.iter().any(|&c| y.abs_diff(c) <= w / 2) && (lo..=hi).contains(&x))
                        || (centres.iter().any(|&c| x.abs_diff(c) <= w / 2) && (lo..=hi).contains(&y)));
                if chamber || gallery {
                    height[y * n + x] = 10.0;
                    water[y * n + x] = 0;
                }
            }
        }
        let rivers = vec![0.0f32; n * n];
        let ids = vec![-1i32; n * n];
        let level: Vec<f32> = height.iter().zip(&water).map(|(&h, &w)| if w == 2 { h - 1000.0 } else { h }).collect();
        Fields::new(Raster { width, n, height: &height, water: &water, water_level: &level, river_width: &rivers, river_ids: &ids })
    }

    #[test]
    fn underdark_city_of_twenty_thousand_keeps_its_population_within_the_caps() {
        // 10 km, 6 x 6 chambers of 470 m radius 1.56 km apart, galleries 156 m wide: about 31 % floor.
        let f = cave_grid(128, 10000.0, 6.0, 14, 20, 2);
        let floor = f.cave.as_ref().unwrap().floor;
        assert!((0.2..0.45).contains(&floor), "floor share {floor}");
        let city = SettlementSpec { key: "main".into(), population: 20000, ..Default::default() };
        let cfg = Config { mode: "list".into(), list: vec![city], edge_margin: 0.0, ..Default::default() };
        let out = place("cave-city", &f, &cfg);
        assert_eq!(out.settlements.len(), 1);
        let s = &out.settlements[0];
        assert_eq!(s.spec.population, 20000, "{:?}", out.warnings);
        assert_eq!(f.r.water[f.index(s.center)], 0);
        assert!(!out.warnings.iter().any(|w| w.contains("to fit its cave chamber")));
        // One 250 m chamber alone: beyond the caps, lowered and announced.
        let small = cave_grid(64, 4000.0, 4.0, 32, 64, 0);
        let out = place("cave-small", &small, &cfg);
        assert_eq!(out.settlements.len(), 1);
        assert!(out.settlements[0].spec.population < 20000);
        assert!(out.warnings.iter().any(|w| w.contains("lowered from 20000")), "{:?}", out.warnings);
    }

    /// 6.4 km, 100 m cells: flat land (10 m) west of x = 4 km, the sea east of it, and land
    /// disc islands of `islands` (centre and radius in cells) in that sea, or a sea everywhere
    /// but the islands when `mainland` is false.
    fn coast_and_islands(mainland: bool, islands: &[(f64, f64, f64)]) -> Fields {
        let n = 64;
        let mut height = vec![-5.0f32; n * n];
        let mut water = vec![1u8; n * n];
        let mut level = vec![0.0f32; n * n];
        for y in 0..n {
            for x in 0..n {
                let i = y * n + x;
                let island = islands.iter().any(|&(cx, cy, r)| ((x as f64 - cx).powi(2) + (y as f64 - cy).powi(2)).sqrt() <= r);
                if (mainland && x < 40) || island {
                    (height[i], water[i], level[i]) = (10.0, 0, 10.0);
                }
            }
        }
        let rivers = vec![0.0f32; n * n];
        let ids = vec![-1i32; n * n];
        Fields::new(Raster { width: 6400.0, n, height: &height, water: &water, water_level: &level, river_width: &rivers, river_ids: &ids })
    }

    #[test]
    fn the_main_town_and_the_towns_stand_on_the_mainland_not_a_small_island() {
        let f = coast_and_islands(true, &[(53.0, 32.0, 5.0)]);
        let land = LandMasses::of(&f);
        assert!(land.mainland && land.reachable);
        let mut list = vec![SettlementSpec { key: "main".into(), population: 5000, site_type: "harbor".into(), ..Default::default() }];
        list.extend((0..2).map(|k| SettlementSpec { key: format!("town-{k}"), population: 2000, ..Default::default() }));
        list.push(SettlementSpec { key: "fishers".into(), population: 60, ..Default::default() });
        let cfg = Config { mode: "list".into(), list, ..Default::default() };
        let out = place("mainland", &f, &cfg);
        for s in out.settlements.iter().filter(|s| s.spec.population >= 1000) {
            assert_eq!(f.land_part[f.index(s.center)] as usize, land.largest, "{} on an island at {:?}", s.spec.key, s.center);
        }
        let main = out.settlements.iter().find(|s| s.spec.key == "main").expect("main placed");
        assert!(f.ds[f.index(main.center)] <= 400.0, "harbour town {} m from the sea", f.ds[f.index(main.center)]);
        assert_eq!(main.archetype, "harbor");
    }

    /// Connectivity: the mainland touches the map edge (the regional entries), the island does
    /// not. Towns need reachable land, villages may take the island, the main place always
    /// stands on the largest land mass.
    #[test]
    fn towns_need_reachable_land_villages_may_take_islands() {
        let f = coast_and_islands(true, &[(53.0, 32.0, 9.0)]);
        let land = LandMasses::of(&f);
        let island = 32 * f.r.n + 53;
        let shore = 32 * f.r.n + 20;
        assert!(land.access[island].is_infinite() && land.access[shore].is_finite());
        let town = SettlementSpec { population: 2000, ..Default::default() };
        let village = SettlementSpec { population: 400, ..Default::default() };
        assert!(!land.admits(&f, island, &town, 1) && land.admits(&f, shore, &town, 1));
        assert!(land.admits(&f, island, &village, 1));
        assert!(!land.admits(&f, island, &village, 0), "the main place stays on the largest mass");
    }

    /// An archipelago (no land reaches the map edge): the main place and the towns stand on the
    /// largest island, a village anywhere.
    #[test]
    fn an_archipelago_keeps_its_main_town_on_the_largest_island() {
        let f = coast_and_islands(false, &[(16.0, 16.0, 7.0), (46.0, 18.0, 9.0), (18.0, 46.0, 7.0), (46.0, 46.0, 6.0)]);
        let land = LandMasses::of(&f);
        assert!(!land.reachable);
        let largest = 18 * f.r.n + 46;
        assert_eq!(f.land_part[largest] as usize, land.largest);
        let main = SettlementSpec { key: "main".into(), population: 2000, ..Default::default() };
        for i in (0..f.r.n * f.r.n).filter(|&i| f.r.water[i] == 0) {
            assert_eq!(land.admits(&f, i, &main, 0), f.land_part[i] as usize == land.largest);
        }
        let cfg = Config { mode: "list".into(), list: vec![main], ..Default::default() };
        let out = place("archipelago-main", &f, &cfg);
        assert_eq!(out.settlements.len(), 1);
        assert_eq!(f.land_part[f.index(out.settlements[0].center)] as usize, land.largest);
    }

    #[test]
    fn a_mainland_keeps_its_main_town_even_when_an_island_has_a_good_harbour() {
        let f = coast_and_islands(true, &[(53.0, 32.0, 10.0)]);
        let land = LandMasses::of(&f);
        let island = 32 * f.r.n + 53;
        let main = SettlementSpec { key: "main".into(), population: 2500, ..Default::default() };
        let cfg = Config { mode: "list".into(), list: vec![main], ..Default::default() };
        let mut ports = 0;
        for site in ["auto", "harbor", "island"] {
            let mut cfg = cfg.clone();
            cfg.list[0].site_type = site.into();
            assert!(!land.admits(&f, island, &cfg.list[0], 0));
            for seed in ["magna-urbis", "magna-urbis-2", "magna-urbis-3", "coast-0", "coast-1"] {
                let out = place(seed, &f, &cfg);
                let town = out.settlements.first().expect("main town placed");
                assert_eq!(f.land_part[f.index(town.center)] as usize, land.largest,
                    "{site}, {seed}: main town at {:?}", town.center);
                if town.archetype == "harbor" {
                    ports += 1;
                    assert!(f.ds[f.index(town.center)] <= extent_radius(town.spec.population) + 70.0 + f.cell);
                }
            }
        }
        assert!(ports > 0, "mainland coast must still offer harbours");
    }

    #[test]
    fn rivers_connect_land_masses_but_sea_and_lakes_separate_them() {
        let base = coast_and_islands(true, &[(53.0, 32.0, 10.0)]);
        let r = &base.r;
        for (class, rock, separated) in [(3, false, false), (2, false, true), (2, true, false)] {
            let mut water = r.water.clone();
            let mut level = r.water_level.clone();
            for y in 0..r.n {
                for x in 0..40 {
                    if x == 20 || y == 32 {
                        let i = y * r.n + x;
                        water[i] = class;
                        level[i] = if rock { r.height[i] - 1000.0 } else { r.height[i] + 1.0 };
                    }
                }
            }
            let f = Fields::new(Raster { width: r.width, n: r.n, height: &r.height, water: &water,
                water_level: &level, river_width: &r.river_width, river_ids: &r.river_ids });
            let a = f.land_part[10 * r.n + 10];
            assert_eq!(a != f.land_part[50 * r.n + 30], separated, "class {class}, rock {rock}");
            assert_ne!(a, f.land_part[32 * r.n + 53], "sea separates the offshore island");
            if !separated {
                let land = LandMasses::of(&f);
                assert!(land.mainland && a as usize == land.largest);
                assert!(f.land_area[land.largest] / land.total > 0.8);
            }
        }
    }

    /// 6.4 km, 100 m cells, the sea east of 4.8 km. North: a hilly coast (8 m swells every 800 m).
    /// South: a flat delta 4 m high with a 20 m river at y = 4.8 km flowing into the sea. A
    /// Venetian canal town (`sitePrefs.flatWater`) goes to the delta.
    #[test]
    fn a_venetian_canal_town_goes_to_the_flat_delta_not_the_hilly_coast() {
        assert!(crate::urban::culture_site_pref("venetian-lagoon", "flatWater", 0.0) > 0.0);
        let n = 64;
        let mut height = vec![-5.0f32; n * n];
        let mut water = vec![1u8; n * n];
        let mut level = vec![0.0f32; n * n];
        let mut rivers = vec![0.0f32; n * n];
        let mut ids = vec![-1i32; n * n];
        for y in 0..n {
            for x in 0..48 {
                let i = y * n + x;
                let tau = std::f64::consts::TAU;
                if y < 32 {
                    let h = 12.0 + 8.0 * (tau * x as f64 / 8.0).sin() * (tau * y as f64 / 8.0).sin();
                    (height[i], water[i], level[i]) = (h as f32, 0, h as f32);
                } else if y == 48 {
                    (height[i], water[i], level[i], rivers[i], ids[i]) = (1.0, 3, 1.0, 20.0, 0);
                } else {
                    (height[i], water[i], level[i]) = (4.0, 0, 4.0);
                }
            }
        }
        let f = Fields::new(Raster { width: 6400.0, n, height: &height, water: &water, water_level: &level, river_width: &rivers, river_ids: &ids });
        let town = SettlementSpec { key: "main".into(), population: 5000, culture: "venetian-lagoon".into(), ..Default::default() };
        let cfg = Config { mode: "list".into(), list: vec![town], edge_margin: 0.0, ..Default::default() };
        let out = place("canal-town", &f, &cfg);
        assert_eq!(out.settlements.len(), 1);
        let c = out.settlements[0].center;
        assert!(c.y > 3200.0, "canal town on the hilly coast at {c:?}");
        assert!(f.ds[f.index(c)] < 700.0 || f.db[f.index(c)] < 700.0, "canal town away from the water at {c:?}");
    }

    /// 10 km of plains (gentle swells) with the sea along the south edge (the last 1.5 km), or the
    /// same plains steepened into a 0.3 scarp over the last 2 km before the sea except a small
    /// flat shore pocket.
    fn coastal_plain(scarp: bool) -> Fields {
        let n = 64;
        let cell = 10000.0 / n as f64;
        let mut height = vec![0.0f32; n * n];
        let mut water = vec![0u8; n * n];
        let mut level = vec![0.0f32; n * n];
        let pocket = |x: usize, y: usize| (28..=31).contains(&x) && (52..=54).contains(&y);
        for y in 0..n {
            for x in 0..n {
                let i = y * n + x;
                let yy = y as f64 * cell;
                if yy >= 8500.0 {
                    (height[i], water[i], level[i]) = (-5.0, 1, 0.0);
                    continue;
                }
                let h = if !scarp {
                    12.0 + 3.0 * (x as f64 * 0.4).sin() * (y as f64 * 0.3).cos()
                } else if pocket(x, y) {
                    3.0
                } else if yy >= 6500.0 {
                    3.0 + 0.3 * (8500.0 - yy)
                } else {
                    603.0
                };
                (height[i], level[i]) = (h as f32, h as f32);
            }
        }
        let rivers = vec![0.0f32; n * n];
        let ids = vec![-1i32; n * n];
        Fields::new(Raster { width: 10000.0, n, height: &height, water: &water, water_level: &level, river_width: &rivers, river_ids: &ids })
    }

    /// Water attracts: on an open coastal plain, the main town of a port-building culture takes
    /// the shore in some seeds and is then a harbour, with room for its whole population.
    #[test]
    fn a_coastal_plain_draws_its_main_town_to_a_roomy_shore() {
        let f = coastal_plain(false);
        let main = SettlementSpec { key: "main".into(), population: 3000, ..Default::default() };
        let need = site_need(&main);
        let cfg = Config { mode: "list".into(), list: vec![main], ..Default::default() };
        let ports: Vec<_> = (0..8).map(|k| place(&format!("coast-{k}"), &f, &cfg))
            .filter(|out| out.settlements.first().is_some_and(|s| s.archetype == "harbor")).collect();
        assert!(!ports.is_empty(), "no port in eight seeds");
        for out in &ports {
            let s = &out.settlements[0];
            assert!(site_room(&f, f.index(s.center), s.spec.population, need) >= need);
        }
    }

    /// Culture weights: a culture whose catalogue harbour weight is low (dwarven,
    /// `sitePrefs.harbor` 0.1) keeps its town off the same shore.
    #[test]
    fn a_culture_without_sea_pull_keeps_its_town_off_the_shore() {
        assert!(crate::urban::culture_site_weight("dwarven", "harbor") < INLAND_HARBOUR_WEIGHT);
        let f = coastal_plain(false);
        let main = SettlementSpec { key: "main".into(), population: 3000, culture: "dwarven".into(), ..Default::default() };
        let cfg = Config { mode: "list".into(), list: vec![main], ..Default::default() };
        for k in 0..6 {
            let out = place(&format!("coast-{k}"), &f, &cfg);
            let town = out.settlements.first().expect("main town placed");
            assert!(f.ds[f.index(town.center)] > town.radius + 70.0, "seed {k}: dwarven town on the shore at {:?}", town.center);
            assert_ne!(town.archetype, "harbor");
        }
    }

    /// Room: a high plateau, a steep coast and one small flat shore pocket (about 29 ha). The
    /// pocket cannot hold 8,000 people: the main town, automatic or asking for a harbour, stays
    /// on the plateau at full size.
    #[test]
    fn a_small_shore_pocket_never_squeezes_the_main_town() {
        let f = coastal_plain(true);
        let n = f.r.n;
        let cell = f.cell;
        let main = SettlementSpec { key: "main".into(), population: 8000, ..Default::default() };
        let need = site_need(&main);
        assert!(need > 12.0 * cell * cell, "the pocket ({:.0} ha) must be smaller than the need ({:.0} ha)", 12.0 * cell * cell / 1e4, need / 1e4);
        assert!(site_room(&f, 53 * n + 29, main.population, need) < need);
        for site in ["auto", "harbor"] {
            for seed in ["coast-0", "coast-1", "coast-2"] {
                let spec = SettlementSpec { site_type: site.into(), ..main.clone() };
                let cfg = Config { mode: "list".into(), list: vec![spec], ..Default::default() };
                let out = place(seed, &f, &cfg);
                let town = out.settlements.first().expect("main town placed");
                let i = f.index(town.center);
                assert_eq!(town.spec.population, 8000, "{site}, {seed}: the town keeps its size");
                assert_ne!(town.archetype, "harbor", "{site}, {seed}: port in the pocket at {:?}", town.center);
                assert!(site_room(&f, i, town.spec.population, need) >= need, "{site}, {seed}: no room at {:?}", town.center);
            }
        }
    }

    /// A map too small for a town: the place shrinks one class at a time until a layer holds it,
    /// and says so.
    #[test]
    fn a_place_no_cell_can_hold_shrinks_one_class_and_is_announced() {
        let f = flat(16, 800.0, 20.0);
        let town = SettlementSpec { key: "main".into(), population: 5000, ..Default::default() };
        let cfg = Config { mode: "list".into(), list: vec![town], edge_margin: 0.0, ..Default::default() };
        let out = place("tiny-map", &f, &cfg);
        assert_eq!(out.settlements.len(), 1);
        let s = &out.settlements[0];
        assert!(s.spec.population < 5000);
        assert_eq!(shrink(5000), Some(999));
        assert!(out.warnings.iter().any(|w| w.contains(&format!("lowered from 5000 to {}", s.spec.population))), "{:?}", out.warnings);
    }

    /// Repulsion grows with size: on an open 20 km plain, towns keep at least half their pair
    /// spacing apart, while hamlets may settle near the main town.
    #[test]
    fn towns_repel_towns_and_hamlets_may_stand_near_them() {
        let f = flat(64, 20000.0, 30.0);
        let mut list = vec![SettlementSpec { key: "main".into(), population: 5000, ..Default::default() }];
        list.extend((0..3).map(|k| SettlementSpec { key: format!("town-{k}"), population: 2000, ..Default::default() }));
        list.extend((0..6).map(|k| SettlementSpec { key: format!("hamlet-{k}"), population: 30, ..Default::default() }));
        let cfg = Config { mode: "list".into(), list, edge_margin: 0.0, ..Default::default() };
        let out = place("repulsion", &f, &cfg);
        assert_eq!(out.settlements.len(), 10, "{:?}", out.warnings);
        let towns: Vec<_> = out.settlements.iter().filter(|s| s.spec.population >= 1000).collect();
        for (k, a) in towns.iter().enumerate() {
            for b in &towns[k + 1..] {
                let d = a.center.distance(b.center);
                assert!(d >= 0.5 * pair_spacing(a.spec.population, b.spec.population), "{} and {} {d:.0} m apart", a.spec.key, b.spec.key);
            }
        }
        for (k, a) in out.settlements.iter().enumerate() {
            for b in &out.settlements[k + 1..] {
                assert!(a.center.distance(b.center) >= extent_gap(a.spec.population, b.spec.population) - 1e-6);
            }
        }
    }

    /// The same seed gives the same places; another seed other places.
    #[test]
    fn placement_is_deterministic_per_seed() {
        let f = coastal_plain(false);
        let mut list = vec![SettlementSpec { key: "main".into(), population: 3000, ..Default::default() }];
        list.extend((0..4).map(|k| SettlementSpec { key: format!("village-{k}"), population: 300, ..Default::default() }));
        let cfg = Config { mode: "list".into(), list, ..Default::default() };
        let centres = |seed: &str| place(seed, &f, &cfg).settlements.iter().map(|s| (s.spec.key.clone(), s.center.x, s.center.y)).collect::<Vec<_>>();
        assert_eq!(centres("same"), centres("same"));
        assert_ne!(centres("same"), centres("other"));
    }
}
