//! Small landings and foot access on undeveloped shores.

use super::*;

/// The harbour family of a culture (`default` when no family names it).
pub(super) fn family_of(culture: &str) -> &'static Value {
    let families = &data()["families"];
    families
        .as_object()
        .and_then(|m| m.values().find(|f| f["cultures"].as_array().is_some_and(|c| c.iter().any(|x| x.as_str() == Some(culture)))))
        .unwrap_or(&families["default"])
}
/// The small craft of a culture's family: (class, length, beam).
pub(super) fn small_craft(culture: &str) -> Option<(&'static str, f64, f64)> {
    let family = family_of(culture);
    let class = family["boats"]["small"].as_str()?;
    let spec = &data()["boats"][class];
    let (length, beam) = (num(spec, "length", 0.0), num(spec, "beam", 0.0));
    (length > 0.0).then_some((class, length, beam))
}

/// Settlements under this population (and every port of a `simple` family)
/// get one plain landing instead of quays and harbour works.
pub(super) const TOWN_PORT: u32 = 2500;
/// Width of a plain landing strip: 2 m on the bank, 0.5 m over the water.
const STRIP: (f64, f64) = (2.0, 0.5);
/// Height of a plain landing's deck above its water (m).
const LANDING_DECK: f64 = 0.3;

/// A plain landing on the bank at `bank` (the first water), its water side
/// `n`: one strip `length` m long along the bank, flush with it (a timber
/// deck, or stone for a stone family) 0.3 m above the water, a post
/// at each end and one in the middle, and up to `boats` small boats moored
/// alongside, parallel to the bank. Nothing else: no coping stroke, jetty or
/// shed. Without `strip` (a steep bank with no shelf), the boats alone, moored
/// at its foot. Nothing is moored on `keep_out`.
#[allow(clippy::too_many_arguments)]
fn lay_landing(seed: &str, culture: &str, surface: Surface<'_>, bank: Point, n: Point, length: f64, boats: usize, strip_laid: bool, keep_out: Option<Obb>) -> Vec<Quay> {
    let Some((class, boat_length, beam)) = small_craft(culture) else { return vec![] };
    let material = if text(family_of(culture), "material", "auto") == "stone" { "stone" } else { "timber" };
    let mut b = Builder {
        surface,
        platforms: vec![],
        solid: vec![],
        occupied: keep_out.into_iter().collect(),
        items: vec![],
        rng: Rng::new(&format!("{seed}\u{1}harbour-landing-v1")),
        stone: material == "stone",
        has_mole: false,
        boats: 0,
        boat_cap: boats.min(3),
        posts: 0,
        cargo: 0,
        level_at: None,
    };
    let t = left(n);
    let half = length * 0.5;
    let strip = Obb { c: add(bank, n, (STRIP.1 - STRIP.0) * 0.5), u: t, hl: half, hw: (STRIP.0 + STRIP.1) * 0.5 };
    // The water level, read once from the bank: the lowest water under the
    // strip, never more than 2.5 m below its bank (cave water can carry the
    // height of a chasm floor), and every item of the landing stands on it.
    let samples = strip.samples();
    let heights = |wet: bool| samples.iter().filter(|&&p| surface.wet(p) == wet).map(|&p| surface.height_at(p)).fold(f64::INFINITY, f64::min);
    let (water, bank_height) = (heights(true), heights(false));
    let water = match (water.is_finite(), bank_height.is_finite()) {
        (true, true) => water.max(bank_height - 2.5),
        (true, false) => water,
        (false, true) => bank_height - 0.5,
        (false, false) => return vec![],
    };
    b.level_at = Some(water);
    if strip_laid {
        // 0.3 m above the water: a thin deck with a small face, never a block.
        b.push("landing", material, strip.shape(), water + LANDING_DECK);
    }
    b.occupied.push(strip);
    // Mooring posts a metre above the deck: a post stands 2.1 m above the
    // water its deck height names (`harbourStyle.ts`), so it names a water
    // 0.8 m lower.
    for k in if strip_laid { [-1.0, 0.0, 1.0].as_slice() } else { [].as_slice() } {
        let post = Obb { c: add(add(bank, t, *k * (half - 0.6)), n, STRIP.1 + 0.3), u: t, hl: 0.25, hw: 0.25 };
        b.push("post", "timber", post.shape(), water + 1.0 - 0.8);
    }
    for k in 0..b.boat_cap {
        let along = -half + boat_length * 0.5 + 0.5 + k as f64 * (boat_length + 1.5);
        if along + boat_length * 0.5 > half + 2.0 {
            break;
        }
        let c = add(add(bank, t, along), n, STRIP.1 + 0.9 + beam * 0.5);
        let bow = if b.rng.chance(0.5) { t } else { neg(t) };
        b.float(class, c, bow);
    }
    b.items
}

/// A town on a navigable river whose planner laid no quay (a village under
/// its quay budget, a bank too steep for a quay street) still lands its
/// boats: on the town bank beside its first bridge over the river, a coping
/// strip of 12 m along the bank, three mooring posts and one to three small
/// boats moored alongside, parallel to the flow. False when there is no
/// such bridge.
pub(super) fn landing(seed: &str, layout: &mut Layout, population: u32, surface: Surface<'_>) -> bool {
    let Some((_, _, beam)) = small_craft(&layout.culture) else { return false };
    // The first bridge over water, walked from its end nearer the centre to the first water.
    let centre = layout.center;
    let crossing = layout.streets.iter().filter(|s| s.role == "bridge" && s.path.len() >= 2).find_map(|s| {
        let mut path = s.path.clone();
        if dist(path[0], centre) > dist(*path.last()?, centre) {
            path.reverse();
        }
        let total: f64 = path.windows(2).map(|w| dist(w[0], w[1])).sum();
        let at = |d: f64| {
            let mut d = d;
            for w in path.windows(2) {
                let l = dist(w[0], w[1]);
                if d <= l && l > 1e-9 {
                    let t = Point { x: (w[1].x - w[0].x) / l, y: (w[1].y - w[0].y) / l };
                    return (add(w[0], t, d), t);
                }
                d -= l;
            }
            let (a, b) = (path[path.len() - 2], path[path.len() - 1]);
            let l = dist(a, b).max(1e-9);
            (b, Point { x: (b.x - a.x) / l, y: (b.y - a.y) / l })
        };
        let first = (0..(total * 2.0) as usize).map(|k| k as f64 * 0.5).find(|&d| surface.wet(at(d).0))?;
        let (bank, d) = at(first);
        let mut width = 0.0;
        while width < 400.0 && surface.wet(add(bank, d, width + 0.5)) {
            width += 0.5;
        }
        (harbour::water_code(surface, add(bank, d, 1.0)) == 3 && width >= 10.0).then_some((bank, d, width))
    });
    let Some((bridge, d, width)) = crossing else { return false };
    if beam > 0.25 * width {
        return false;
    }
    let along = left(d);
    // 18 m up or down the bank from the bridge: the first side whose bank is found.
    let Some(bank) = [1.0, -1.0].into_iter().find_map(|side| {
        let p = add(add(bridge, along, side * 18.0), d, -12.0);
        (0..60).map(|k| k as f64 * 0.5).find(|&e| surface.wet(add(p, d, e))).map(|e| add(p, d, e))
    }) else {
        return false;
    };
    // Nothing moored under or against the bridge.
    let bridge_water = Obb { c: add(bridge, d, width * 0.5), u: d, hl: width * 0.5 + 2.0, hw: 8.0 };
    let items = lay_landing(seed, &layout.culture, surface, bank, d, 12.0, if population < 150 { 1 } else { 2 }, true, Some(bridge_water));
    let Some(structure) = layout.structure.as_mut() else { return false };
    let landed = !items.is_empty();
    structure.quays.extend(items);
    landed
}

/// The land around a point on a coarse grid of the drawn water (cells of
/// `cell` metres, `side` a side, at most 256).
struct Land {
    member: Vec<bool>,
    /// Area of the land (m²).
    area: f64,
}
/// Coarse grid side and cell size for `Land`.
fn coarse(surface: Surface<'_>) -> (usize, f64) {
    let side = surface.n.clamp(16, 256);
    (side, surface.width / side as f64)
}
fn coarse_dry(surface: Surface<'_>, i: usize, known: &mut [u8]) -> bool {
    let (side, cell) = coarse(surface);
    if known[i] == 0 {
        let p = Point { x: ((i % side) as f64 + 0.5) * cell, y: ((i / side) as f64 + 0.5) * cell };
        known[i] = if surface.wet(p) { 2 } else { 1 };
    }
    known[i] == 1
}
/// The island under `c`: its land, flooded on the coarse grid from the
/// nearest dry cell, when water closes it within the map and it covers less
/// than a quarter of the map. `None` for land reaching the map edge (part of
/// a larger landmass) or larger than that; the flood stops there.
fn island(surface: Surface<'_>, c: Point) -> Option<Land> {
    let (side, cell) = coarse(surface);
    let mut known = vec![0u8; side * side];
    let (cx, cy) = ((c.x / cell).floor().clamp(0.0, (side - 1) as f64) as isize, (c.y / cell).floor().clamp(0.0, (side - 1) as f64) as isize);
    let start = (0..=3isize)
        .flat_map(|r| (-r..=r).flat_map(move |dy| (-r..=r).map(move |dx| (cx + dx, cy + dy))))
        .filter(|&(x, y)| x >= 0 && y >= 0 && x < side as isize && y < side as isize)
        .map(|(x, y)| y as usize * side + x as usize)
        .find(|&i| coarse_dry(surface, i, &mut known))?;
    let limit = side * side / 4;
    let mut member = vec![false; side * side];
    member[start] = true;
    let (mut stack, mut count) = (vec![start], 1usize);
    while let Some(i) = stack.pop() {
        let (x, y) = (i % side, i / side);
        if x == 0 || y == 0 || x + 1 == side || y + 1 == side {
            return None;
        }
        for j in [i + 1, i - 1, i + side, i - side] {
            if !member[j] && coarse_dry(surface, j, &mut known) {
                member[j] = true;
                count += 1;
                if count > limit {
                    return None;
                }
                stack.push(j);
            }
        }
    }
    Some(Land { member, area: count as f64 * cell * cell })
}

/// A village or town that lives from the water: a fishing activity, or the
/// port function of its programme.
fn fishing(cfg: &LayoutConfig) -> bool {
    cfg.programme.template.contains("fishing") || cfg.programme.functions.is_some_and(|f| f.port > 0.0)
}

/// The foot of a shore below a town. `Shelf`: dry land at most `SHELF_RISE`
/// above the water within 8 m of the bank (a beach, a cove floor, a ledge):
/// room for a landing. `Steep`: no shelf, but a bank a footpath can come down
/// (boats moor at its foot). `Sheer`: a cliff rising faster than `SHEER` over
/// its first 10 m: nothing lands there.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
enum Foot {
    Shelf,
    Steep,
    Sheer,
}
/// Highest shelf above the water (m).
const SHELF_RISE: f64 = 2.5;
/// A sheer cliff rises faster than this over its first 10 m (rise over run, about 65°).
const SHEER: f64 = 2.1;
/// Steepest leg of a footpath down to a landing (switchbacks keep each leg under it).
pub(super) const FOOTPATH_GRADE: f64 = 0.35;
/// The foot of the shore at `bank` (first water), `n` towards the water.
fn foot(surface: Surface<'_>, bank: Point, n: Point) -> Foot {
    let water = surface.height_at(add(bank, n, 0.5));
    let rise = |d: f64| surface.height_at(add(bank, n, -d)) - water;
    if rise(8.0) <= SHELF_RISE {
        Foot::Shelf
    } else if rise(10.0) / 10.0 > SHEER {
        Foot::Sheer
    } else {
        Foot::Steep
    }
}

/// Every island settlement has a harbour, and a fishing village at least a
/// landing, even when the planner laid no quay. The landing stands on the
/// settlement's own waterfront when its streets come within 30 m of the
/// water; otherwise it is detached at the best shore within reach (an
/// island's reach grows with its size, 200 m to 1.5 km): a cove first (the
/// share of directions closed by land seen from its water), else the nearest
/// shore, with boat sheds or fishermen's huts beside it and a track to the
/// nearest street. A lone farm (under 40 people) gets a slipway and its boat.
pub(super) fn shore_landing(seed: &str, layout: &mut Layout, population: u32, cfg: &LayoutConfig, surface: Surface<'_>) {
    let centre = layout.center;
    let land = island(surface, centre);
    // Islands, fishing villages and ports (on a cliffed coast their planner laid no quay).
    if land.is_none() && !fishing(cfg) && !harbour::port_town(cfg) {
        return;
    }
    let (side, cell) = coarse(surface);
    let reach = land.as_ref().map_or(400.0, |l| (l.area.sqrt() * 0.5).clamp(200.0, 1500.0));
    // The town: the vertices of its own streets (not its water works).
    let mut town: Vec<Point> = layout
        .streets
        .iter()
        .filter(|s| !matches!(s.role.as_str(), "bridge" | "pier" | "landing" | "mole" | "boardwalk" | "causeway" | "ford" | "track"))
        .flat_map(|s| s.path.iter().copied())
        .collect();
    if town.is_empty() {
        town.push(centre);
    }
    let near_town = |p: Point| town.iter().map(|&q| dist(p, q)).fold(f64::INFINITY, f64::min);
    // Shore cells within reach: dry (on the island: its own land), water beside them.
    let mut known = vec![0u8; side * side];
    let at = |i: usize| Point { x: ((i % side) as f64 + 0.5) * cell, y: ((i / side) as f64 + 0.5) * cell };
    let span = |v: f64| (((v - reach) / cell).floor().max(1.0) as usize, (((v + reach) / cell).ceil().max(1.0) as usize).min(side - 2));
    let ((x0, x1), (y0, y1)) = (span(centre.x), span(centre.y));
    let mut shores: Vec<(Point, Point)> = vec![];
    for y in y0..=y1 {
        for x in x0..=x1 {
            let i = y * side + x;
            if dist(at(i), centre) > reach || !land.as_ref().map_or_else(|| coarse_dry(surface, i, &mut known), |l| l.member[i]) {
                continue;
            }
            let mut n = Point { x: 0.0, y: 0.0 };
            for (j, dx, dy) in [(i + 1, 1.0, 0.0), (i - 1, -1.0, 0.0), (i + side, 0.0, 1.0), (i - side, 0.0, -1.0)] {
                if !coarse_dry(surface, j, &mut known) {
                    n = Point { x: n.x + dx, y: n.y + dy };
                }
            }
            let l = n.x.hypot(n.y);
            if l > 1e-9 {
                let n = Point { x: n.x / l, y: n.y / l };
                // Sheer cliffs land nothing.
                if foot(surface, add(at(i), n, cell * 0.5), n) != Foot::Sheer {
                    shores.push((at(i), n));
                }
            }
        }
    }
    // A long coast is sampled: at most 400 shore cells are weighed.
    let stride = shores.len().div_ceil(400).max(1);
    let shores: Vec<(Point, Point)> = shores.into_iter().step_by(stride).collect();
    let own = shores.iter().copied().filter(|&(p, _)| near_town(p) <= 30.0 + cell).min_by(|a, b| near_town(a.0).total_cmp(&near_town(b.0)));
    let shelter = |(p, n): (Point, Point)| {
        let o = add(p, n, cell + 4.0);
        (0..16)
            .filter(|&k| {
                let d = rotate(Point { x: 1.0, y: 0.0 }, k as f64 * std::f64::consts::PI / 8.0);
                (1..=30).any(|s| !surface.wet(add(o, d, s as f64 * 4.0)))
            })
            .count() as f64
            / 16.0
    };
    let Some((p, n)) = own.or_else(|| {
        // A shelf at the foot of the slope first.
        let shelf = |s: (Point, Point)| if foot(surface, add(s.0, s.1, cell * 0.5), s.1) == Foot::Shelf { 0.5 } else { 0.0 };
        let score = |s: (Point, Point)| shelter(s) + shelf(s) - 0.6 * dist(s.0, centre) / reach;
        shores.iter().copied().max_by(|a, b| score(*a).total_cmp(&score(*b)))
    }) else {
        return;
    };
    // The bank: the first drawn water along the shore's water side.
    let from = add(p, n, -8.0);
    let Some(e) = (0..80).map(|k| k as f64 * 0.5).find(|&e| surface.wet(add(from, n, e))) else { return };
    let bank = add(from, n, e);
    // The foot decides: a shelf takes the landing, a steep bank only boats, a cliff nothing.
    let shore_foot = foot(surface, bank, n);
    if shore_foot == Foot::Sheer {
        return;
    }
    // One plain landing, scaled to the settlement: 8 m and one boat for a
    // hamlet or a farm (under 150), 14 m and two boats above, 24 m for a town.
    let (length, boats) = match population {
        0..150 => (8.0, 1),
        150..TOWN_PORT => (14.0, 2),
        _ => (24.0, 3),
    };
    let items = lay_landing(seed, &layout.culture, surface, bank, n, length, boats, shore_foot == Foot::Shelf, None);
    if items.is_empty() {
        return;
    }
    // A path from the landing up to the nearest street: switchbacks at a
    // footpath grade (stairs where the culture builds them); a straight path
    // only where it is that gentle, dry and clear of the blocks.
    let grade = if super::super::profiles::stairs_allowed(cfg, &layout.culture) { cfg.max_stair_grade } else { cfg.max_lane_grade.max(FOOTPATH_GRADE) };
    let start = add(bank, n, -3.0);
    let (target, gap) = town.iter().map(|&q| (q, dist(start, q))).fold((centre, f64::INFINITY), |b, c| if c.1 < b.1 { c } else { b });
    let inside_block = |p: Point| layout.blocks.iter().any(|b| inside(&b.shape.outer, p));
    let track = (gap > 4.0)
        .then(|| {
            let margin = 60.0;
            let bounds = (start.x.min(target.x) - margin, start.y.min(target.y) - margin, start.x.max(target.x) + margin, start.y.max(target.y) + margin);
            super::super::routing::RoutePlanner::new(surface, bounds).route(start, target, grade).or_else(|| {
                let k = (gap / 2.0).ceil() as usize;
                let u = Point { x: (target.x - start.x) / gap, y: (target.y - start.y) / gap };
                let at = |i: usize| add(start, u, gap * i as f64 / k as f64);
                let straight = (0..=k).all(|i| !surface.wet(at(i)) && (i + 1 == k || !inside_block(at(i))))
                    && (1..=k).all(|i| (surface.height_at(at(i)) - surface.height_at(at(i - 1))).abs() <= grade * gap / k as f64 + 1e-9);
                straight.then(|| vec![start, target])
            })
        })
        .flatten();
    // A landing away from the town that no path reaches is no landing.
    if track.is_none() && gap > 30.0 + cell {
        return;
    }
    if let Some(path) = track {
        layout.streets.push(Street { widths: vec![2.0; path.len()], path, rank: 4, role: "track".into() });
    }
    if let Some(structure) = layout.structure.as_mut() {
        structure.quays.extend(items);
    }
}

/// A village's or an Underdark port: one plain landing on its waterfront in
/// place of the planner's quay platforms, piers and landing stages. On the
/// quay reach nearest the centre (among the longer ones), at the drawn
/// waterline: a strip of 14 m for a village, up to 40 m for a larger town
/// of a `simple` family, its posts and two or three boats alongside. The
/// quay street stays a street on the bank. Idempotent.
pub(super) fn simple_landing(seed: &str, layout: &mut Layout, population: u32, surface: Surface<'_>) {
    let Some(structure) = layout.structure.as_ref() else { return };
    let platforms: Vec<Quay> = structure.quays.iter().filter(|q| PLATFORM_KINDS.contains(&q.kind.as_str()) && q.material != "water").cloned().collect();
    let fronts = {
        let b = Builder {
            surface,
            platforms: platforms.iter().map(|q| (bbox(&q.shape.outer), &q.shape)).collect(),
            solid: vec![],
            occupied: vec![],
            items: vec![],
            rng: Rng::new(seed),
            stone: false,
            has_mole: false,
            boats: 0,
            boat_cap: 0,
            posts: 0,
            cargo: 0,
            level_at: None,
        };
        b.fronts(&layout.streets)
    };
    let centre = layout.center;
    let mid = |f: &Front| add(f.a, f.t, f.len * 0.5);
    let chosen = fronts.iter().max_by(|a, b| {
        let score = |f: &Front| f.len.min(40.0) - 0.1 * dist(mid(f), centre);
        score(a).total_cmp(&score(b))
    });
    // The bank: the first drawn water from the middle of the reach.
    let landing = chosen.and_then(|f| {
        let p = mid(f);
        (0..120).map(|k| k as f64 * 0.5).find(|&e| surface.wet(add(p, f.n, e))).map(|e| (add(p, f.n, e), *f))
    });
    // Out: the planner's platforms and its piers and stages into the water;
    // the quay street becomes an ordinary street on the bank (no quay paving
    // in 2D or 3D).
    layout.streets.retain(|s| !matches!(s.role.as_str(), "pier" | "landing" | "mole"));
    for s in layout.streets.iter_mut().filter(|s| s.role == "quay") {
        s.role = "street".into();
    }
    let Some(structure) = layout.structure.as_mut() else { return };
    structure.quays.clear();
    let Some((bank, f)) = landing else { return };
    let (length, boats) = if population < TOWN_PORT { (if population < 150 { 8.0 } else { 14.0 }, if population < 150 { 1 } else { 2 }) } else { ((14.0 + population as f64 / 250.0).min(40.0), 3) };
    let items = lay_landing(seed, &layout.culture, surface, bank, f.n, length.min(f.len.max(8.0)), boats, true, None);
    structure.quays.extend(items);
}
