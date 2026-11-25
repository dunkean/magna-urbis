//! Building massing from the city's occupation preview: every preview piece
//! (street body, rear wing, court range, nave, tower…) gets its own floors,
//! eave height and roof (kind, pitch, ridge), so the displayed building is the
//! planned silhouette raised in volume, never a separate house standing in it.
//!
//! The culture's tissue declares its roof tradition and storey range
//! (`catalogue.json` presets, `params.arch`); cultures without one read the
//! tradition of their style traits (`forms/styles.json`), like every other
//! building trait of a culture: this module never tests a culture's name. Heights vary with the lot's zone and pressure (taller core),
//! wealth, street corners and a per-lot draw (adjoining houses of one row
//! differ); rear wings and annexes stand lower, landmark parts by role.
//! Proportions follow measured references: storeys of 2.5 m in the
//! countryside and 2.6–3.2 m in town (scaled for small folk), pitched roofs at
//! most 0.6 × their span and about the wall height on houses, no thin tall
//! sliver, light pile houses. Every lot's storeys are capped by the settlement
//! size and the distance from the core (a village stays low; tower cultures
//! mix towers and ordinary houses), never by its footprint.
//! Display contract (`programme.massing`, one entry per `preview` piece):
//! `{floors, eave_m, rise_m, roof, ridges:[[x0,y0,x1,y1]…], cover, wall, tone,
//! volumes?}`; `roof` ∈ gable | hip | shed | pyramid | cone | tent | dome |
//! barrel | ring | flat. `volumes` (every piece without a court hole) is a
//! partition of the piece into convex, near-rectangular volumes
//! `{ring, floors, eave_m, rise_m, roof, ridges, cover, wall, tone}` (L/T/U
//! shapes cut at their reflex vertices, long bodies split into storeys of
//! different heights with cross-gables); the entry-level fields repeat the
//! tallest volume. Ridges lie strictly inside their (convex) ring.
//! `cover` ∈ tile | slate | thatch | reed | bamboo | palm | shingle | turf |
//! bark | hide | felt | earth | plaster | stone | snow | metal | zinc |
//! bitumen | glass; `wall` ∈ timber | brick | stone | earth | wood | plaster |
//! bamboo | wattle | hide | coral | concrete | glass | steel | ashlar (cut
//! limestone); `tone` ∈ 0..1 per lot. The entry of a building whose style has
//! a palette (`forms/styles_modern.json`) carries `tint`, the wall colour it
//! asks for (sRGB `#rrggbb`, one per lot).
//! Flat roofs also carry `parapet_m` (wall rising above the eave, 0.35–1.1 m
//! by culture), `trim` (red band of mesoamerican flat roofs) and
//! `features:[{kind,x,y,w,d,h,angle}]` (roof-top stair heads,
//! domes, wind-catchers) standing strictly inside the parapet. Huts (one floor
//! of thatch, reed, hide…) have low walls and an `overhang_m` of roof past them.
//! A piece on ground dropping 1 m or more across it carries `footing` (see
//! `footing`): its floor level at the uphill side and how the drop is taken.
use super::{Point, Shape};
use crate::rng::Rng;
use serde_json::{Value, json};

/// The ground floor's extra height (m) for shops.
const SHOP_EXTRA_M: f64 = 0.8;
/// A dwelling of this many storeys is a collective building: its wall tint
/// comes from its palette's `special` list, like a singular building's.
const TALL_FLOORS: u32 = 9;

mod traditions;
use traditions::{Tradition, tradition};
pub(super) use traditions::house_traits;
pub(super) struct Input<'a> {
    pub parts: &'a [(Shape, &'static str)],
    pub arch: &'a Value,
    pub culture: &'a str,
    pub zone: &'a str,
    pub role: &'a str,
    pub function: &'a str,
    pub landmark: bool,
    pub wealth: f64,
    pub pressure: f64,
    /// Selected ordinary fringe/poor home (same draw as its smaller preview).
    pub small_home: bool,
    /// Settlement population (0 unknown): a market town builds lower than a city.
    pub population: u32,
    /// Street frontage segments of the lot (public accesses).
    pub fronts: &'a [[Point; 2]],
    /// `lowRuralHouses`: village homes two storeys under the tradition, faubourg one.
    pub low_rural: bool,
    /// Lot distance from the centre in equivalent settled radii (height gradient).
    pub distance: f64,
    pub seed: &'a str,
    /// Activity archetype id (activities.json) of a specialised service lot, "" otherwise.
    pub archetype: &'a str,
    /// `houseComplexity: complex`: composite roofs (valleys, overhangs), the
    /// kit's extra roof kinds, chimneys and dormers on homes. Monuments and
    /// utility buildings always compose their roofs.
    pub complex: bool,
    /// The lot's quarter is city core by the user's edit (`overrides.quarters.<i>.zone`):
    /// its style's height ladder stands at its top step.
    pub user_core: bool,
}

/// Whether the user set the quarter of `block` as city core (quarter edit `zone: core`).
pub(super) fn user_core(layout: &super::Layout, block: usize) -> bool {
    let Some(b) = layout.blocks.get(block) else { return false };
    layout.config.as_ref().and_then(|c| c.overrides.quarters.get(&b.quarter.to_string()))
        .is_some_and(|o| o.zone.as_deref() == Some("core"))
}

mod shape_geometry;
use shape_geometry::{frame_along, min_frame, near_segment, touches, cross3, ring_area, orient, reflex_count, convex_parts, clip_half, perp, chord, at_st, ring_centroid, ring_json};
pub(super) use shape_geometry::clip_band;
/// roofless stubs broken at a quarter to three quarters of the eaves `full_m`,
/// corners standing to them, low rubble mounds; masonry (a timber or hide
/// house leaves its stone footing), no openings (the gaps between stubs are
/// the doors and windows).
pub(super) fn ruin_piece(label: &str, full_m: f64, wall: &str, tone: f64, rng: &mut Rng) -> Value {
    let wall = match wall {
        "stone" | "brick" | "earth" | "plaster" | "coral" | "concrete" | "ashlar" => wall,
        "glass" | "steel" => "concrete",
        _ => "stone",
    };
    let (eave, roof, rise) = match label {
        "rubble" => (0.12, "pyramid", (full_m * rng.range(0.08, 0.15)).max(0.3)),
        "ruin-corner" => (full_m * rng.range(0.9, 1.05), "flat", 0.0),
        _ => (full_m * rng.range(0.25, 0.75), "flat", 0.0),
    };
    json!({"floors":1,"eave_m":round2(eave.max(0.12)),"rise_m":round2(rise),"roof":roof,"ridges":[],"cover":"ruin","wall":wall,"tone":round2(tone),"openings":"none"})
}
fn round2(v: f64) -> f64 {
    (v * 100.0).round() / 100.0
}
fn seg(a: Point, b: Point) -> Value {
    json!([round2(a.x), round2(a.y), round2(b.x), round2(b.y)])
}

pub(super) fn tower_house(culture: &str, arch: &Value) -> bool {
    arch["typology"].as_str().unwrap_or("").contains("tower") || tradition(arch, culture).storeys[0] >= 4
}

/// Pile cultures (stilt houses by typology or by the culture's home form, and
/// the cultures whose traits say `piles`): small light bodies on posts.
pub(super) fn pile_house(culture: &str, arch: &Value) -> bool {
    let traits = super::forms::kit::traits(culture);
    tradition(arch, culture).form == "stilt" || traits.form == "stilt" || traits.piles
}

mod footings;
pub(super) use footings::{hillside, FOOTING_MIN_DROP_M, footing};
mod storeys;
use storeys::{body_scale, facade_openness, size_of, small_home, lot_floors};
mod roofing;
use roofing::{Roof, roof_of, split_body};
mod edits;
pub(super) use edits::{is_shape_edit, apply_edit};
mod volumes;
use volumes::{Vol, Piece, snow_house, within};
mod details;
use details::{flavor, depth_in, flat_details, tiered, home_details, lot_look, activity_details, sails_feature};
/// Massing of every preview piece, aligned with `preview` (empty when none).
pub(super) fn massing(m: &Input) -> Value {
    if m.parts.is_empty() {
        return Value::Null;
    }
    let mut tr = tradition(m.arch, m.culture);
    // The style's height ladder caps the storeys by the settlement's size
    // (a modern town of 10 000 stays low; a user-set core takes the top step).
    tr.storeys = super::forms::kit::capped_storeys(tr.storeys, super::forms::kit::storey_cap(m.culture, m.population, m.user_core));
    let traits = super::forms::kit::traits(m.culture);
    let (metric_scale, form) = super::forms::kit::house_parameters(m.culture);
    // A culture may give its home form to a share of its lots only (elven
    // settlements favour tree dwellings, with a small share of ground houses).
    let takes_form = traits.form_share <= 0.0 || Rng::new(m.seed).fork("tree-share").float() < traits.form_share;
    if !form.is_empty() && takes_form { tr.form = form; }
    match tr.form {
        "tree" => { tr.roof = "dome"; tr.cover = "turf"; tr.wall = "wood"; }
        "mushroom" => { tr.roof = "dome"; tr.cover = "fungal"; tr.wall = "wattle"; }
        "longhouse" => { tr.roof = "barrel"; tr.cover = "bark"; tr.wall = "wood"; tr.storeys = [1, 1]; }
        "yurt" => { tr.roof = "tent"; tr.cover = "felt"; tr.wall = "hide"; tr.storeys = [1, 1]; }
        "battered" => { tr.roof = "flat"; tr.cover = "earth"; tr.wall = "plaster"; }
        _ => {}
    }
    // Massive-storey cultures (giants): one huge storey of massive stone under a flat roof.
    if traits.massive_storey { tr.roof = "flat"; tr.cover = "stone"; tr.wall = "stone"; tr.storeys = [1, 1]; }
    if let Some(look) = super::activities::archetype(m.archetype)
        .and_then(|a| a.look.as_deref())
        .and_then(|id| super::activities::data().looks.get(id))
        && let Some(material) = look.material.as_deref()
    {
        tr.form = "";
        tr.roof = look.roof.first().map_or("flat", |r| r.as_str());
        tr.wall = material;
        tr.cover = material;
    }
    let mut rng = Rng::new(m.seed).fork("massing");
    let floors = lot_floors(m, &tr, &mut rng);
    let compact = small_home(m);
    // Storeys of 2.5 m in the countryside, 2.6–3.2 m by wealth in town,
    // scaled by the inhabitants' size (small folk).
    let size = size_of(m.population);
    let body = body_scale(m.culture);
    let storey_m = if matches!(m.zone, "village" | "hamlet" | "rural") { 2.5 * body }
        else { (2.6 + 0.6 * m.wealth.clamp(0.0, 1.0)) * body };
    // Variety inside the tradition: pitch ±15 %, a share of lots turn gables
    // to hips (and conversely), some turn the ridge across the street axis,
    // a few tile roofs go slate / shingle by wealth; one tone per lot.
    let pitch_k = 1.0 + rng.range(-0.15, 0.15);
    let swap = rng.chance(0.12);
    let flip = rng.chance(0.12);
    let lot_tone = rng.float();
    let lot_cover = if tr.cover == "tile" && tr.pitch >= 30.0 && m.wealth > 0.65 && rng.chance(0.25) {
        "slate"
    } else if tr.cover == "tile" && tr.wall == "timber" && m.wealth < 0.35 && rng.chance(0.3) {
        "shingle"
    } else {
        tr.cover
    };
    let shop = m.function == "mixed" || m.role.starts_with("dwelling.shop") || m.role.starts_with("commerce");
    let areas: Vec<f64> = m.parts.iter().map(|(s, _)| super::geometry::area(s)).collect();
    let on_front = |s: &Shape| m.fronts.iter().any(|f| near_segment(s, f[0], f[1], 1.5));
    // The main body: the largest piece on the street, else the largest.
    let main = (0..m.parts.len())
        .filter(|&i| m.parts[i].1 == "building" && on_front(&m.parts[i].0))
        .max_by(|&a, &b| areas[a].total_cmp(&areas[b]))
        .or_else(|| (0..m.parts.len()).max_by(|&a, &b| areas[a].total_cmp(&areas[b])))
        .unwrap_or(0);
    // The part a mage tower replaces: the main body, or the smallest wing of a
    // house whose role marks it with a tower.
    let tower_role = traits.form_roles.iter().any(|r| m.role.starts_with(r.as_str()));
    let tower_part = if tower_role {
        (0..m.parts.len()).filter(|&i| areas[i] >= 20.0).min_by(|&a, &b| areas[a].total_cmp(&areas[b])).unwrap_or(main)
    } else {
        main
    };
    let landmark_scale = (areas.iter().sum::<f64>().sqrt() / 12.0).clamp(0.8, 2.2);
    // A village's nave stands lower than a city's.
    let nave_eave = (7.5 + 3.5 * landmark_scale) * (0.75 + 0.25 * size);
    let front_dir = m.fronts.first().map(|f| {
        let l = (f[1].x - f[0].x).hypot(f[1].y - f[0].y).max(1e-9);
        Point { x: (f[1].x - f[0].x) / l, y: (f[1].y - f[0].y) / l }
    });
    let main_c = super::geometry::centroid(&m.parts[main].0);
    let detail_rng = rng.fork("details");
    let look = lot_look(m, &tr);
    // The home vocabulary of the lot's style, and the monument family whose
    // mass rules may override the shared ones.
    let kit = super::forms::kit::house(m.culture, super::forms::kit::Traits { roof: tr.roof, pitch: tr.pitch, cover: tr.cover, wall: tr.wall });
    let family = super::culture::architecture_pack(m.culture).map_or("western", super::parcels::monument_family);
    let home = !m.landmark && matches!(m.function, "domestic" | "mixed") && look.is_none();
    // The wall tint the building asks for (its style's palette, `forms::kit`):
    // one draw per lot, from the singular list for a landmark, a lot that is
    // not a dwelling or a tall collective dwelling, from the homes list otherwise.
    let special = m.landmark || !m.role.starts_with("dwelling") || floors >= TALL_FLOORS;
    let tint = super::forms::kit::tints(m.culture, special)
        .and_then(|t| super::forms::kit::draw(t, &mut Rng::new(m.seed).fork("tint"), &|_| true, &|_, w| w));
    // A complex home draws its roof kind once in its kit (the wings follow the body).
    let home_roof: Option<&'static str> = (m.complex && home && matches!(tr.roof, "gable" | "hip") && tr.form.is_empty())
        .then(|| super::forms::kit::draw(&kit.roofs, &mut Rng::new(m.seed).fork("kit-roof"), &|_| true, &|_, w| w))
        .flatten();
    // Towards the street from a point (the nearest frontage), for sheds and dormers.
    let to_street = |c: Point| -> Option<Point> {
        m.fronts.iter().map(|s| {
            let (dx, dy) = (s[1].x - s[0].x, s[1].y - s[0].y);
            let k = (((c.x - s[0].x) * dx + (c.y - s[0].y) * dy) / (dx * dx + dy * dy).max(1e-9)).clamp(0.0, 1.0);
            Point { x: s[0].x + k * dx - c.x, y: s[0].y + k * dy - c.y }
        }).min_by(|a, b| a.x.hypot(a.y).total_cmp(&b.x.hypot(b.y)))
    };
    // A stepped landmark's preview is concentric terrace rings plus a shrine.
    // Their heights follow nesting, independent of culture, roof tradition or
    // preview order; each inner tier stands above the outer retaining wall.
    let terraces: Vec<&Shape> = m.parts.iter().filter(|(_, label)| *label == "terrace").map(|(s, _)| s).collect();
    let stepped = m.landmark && !terraces.is_empty() && m.parts.iter().any(|(_, label)| *label == "shrine");
    let tier_height = (terraces.iter().filter_map(|s| min_frame(&s.outer)).map(|f| 2.0 * f.half_w).fold(0.0_f64, f64::max)
        / (2.0 * (terraces.len() + 1) as f64)).clamp(1.2 * metric_scale, 4.0 * metric_scale);
    let mut pieces: Vec<Piece> = m
        .parts
        .iter()
        .enumerate()
        .map(|(i, (shape, label))| {
            let area = areas[i];
            let ring = &shape.outer;
            let mut drng = detail_rng.fork(&i.to_string());
            if stepped && matches!(*label, "terrace" | "shrine") {
                let tier = if *label == "shrine" { terraces.len() + 1 } else {
                    1 + terraces.iter().filter(|s| ring_area(&s.outer) > ring_area(ring) + 1e-6).count()
                };
                return Piece::Raw(json!({"floors":1,"eave_m":round2(tier_height * tier as f64),"rise_m":0.0,"roof":"flat",
                    "ridges":[],"cover":"stone","wall":"stone","tone":round2(lot_tone),"openings":"none"}));
            }
            if super::parcels::ruins::is_ruin(label) {
                return Piece::Raw(ruin_piece(label, metric_scale * floors.min(2) as f64 * storey_m, tr.wall, lot_tone, &mut drng));
            }
            let mut kind = tr.roof;
            let mut pitch = (tr.pitch * pitch_k).max(0.0);
            let mut cover = lot_cover;
            let mut wall = tr.wall;
            let mut n = floors;
            let mut eave: Option<f64> = None;
            let mut composable = false;
            // A tent people's landmark is a larger tent of its own tradition,
            // never a stone nave or tower of another one.
            let tribal = tr.roof == "tent" || matches!(tr.form, "tree" | "mushroom" | "longhouse" | "igloo");
            // A farm outbuilding (farmsteads.rs): one low storey under its type's roof.
            let out = m.role.starts_with("dwelling") && super::farmsteads::is_outbuilding(label);
            let mut out_stilts = 0.0;
            // The label's mass rule (forms/roles_*.json), the culture's or its
            // monument family's override first; labels without one are raised below.
            let rule = if out { None } else { super::forms::roles::rule(label, &[m.culture, family]) };
            // Base of a ruled mass above the ground (m, before the metric scale).
            let mut ruled_base = 0.0;
            // A tent people's part without a rule of its own is one more tent.
            match if tribal && !out && rule.is_none() { "building" } else { *label } {
                _ if out => {
                    let o = super::farmsteads::look(m.culture, m.seed, label, &mut drng);
                    n = 1;
                    eave = Some(o.eave);
                    kind = o.roof;
                    if kind != "flat" && pitch < 25.0 { pitch = 35.0; }
                    if let Some(c) = o.cover { cover = c; }
                    if let Some(w) = o.wall { wall = w; }
                    out_stilts = o.stilts;
                }
                _ if rule.is_some() => {
                    let r = rule.unwrap();
                    let width = min_frame(ring).map_or(4.0, |f| 2.0 * f.half_w.min(f.half_l)) / (metric_scale * body).max(1e-6);
                    let lot = super::forms::roles::Lot { floors, storey: storey_m / body, nave: nave_eave, width };
                    let (h, shown) = r.height(lot, &mut drng);
                    n = shown;
                    eave = Some(h);
                    ruled_base = r.base(lot);
                    kind = r.roof_kind(home_roof.unwrap_or(tr.roof), &mut drng);
                    pitch = r.pitch_deg(pitch, &mut drng);
                    wall = super::forms::roles::MassRule::material(&r.wall, tr.wall);
                    cover = super::forms::roles::MassRule::material(&r.cover, lot_cover);
                    composable = r.composable;
                }
                "tower" | "belfry" | "minaret" | "keep" => {
                    let extra = rng.int(0, 2);
                    n = floors.max(2) + 2 + (2.0 * size).round() as u32 + extra.min(1);
                    kind = if tr.roof == "flat" { "flat" } else { "pyramid" };
                    pitch = 62.0;
                    wall = "stone";
                    cover = if tr.roof == "flat" { tr.cover } else { "slate" };
                }
                "nave" | "hall" | "cella" | "portico" | "prayer-hall" => {
                    eave = Some(if *label == "hall" { nave_eave * 0.7 } else { nave_eave });
                    if tr.roof != "flat" && tr.roof != "dome" {
                        kind = "gable";
                        pitch = if matches!(*label, "cella" | "portico") { 22.0 } else { tr.pitch.max(38.0) + 6.0 };
                    }
                    wall = "stone";
                }
                "choir" => {
                    eave = Some(nave_eave * 0.85);
                    if tr.roof != "flat" && tr.roof != "dome" {
                        kind = "gable";
                        pitch = tr.pitch.max(38.0) + 6.0;
                    }
                    wall = "stone";
                }
                "apse" => {
                    eave = Some(nave_eave * 0.7);
                    kind = if tr.roof == "flat" { "flat" } else { "cone" };
                    pitch = 35.0;
                    wall = "stone";
                }
                "cold-room" | "warm-room" | "hot-room" => {
                    eave = Some(5.5);
                    kind = "barrel";
                    wall = "stone";
                    cover = "tile";
                }
                "wheel" if look.is_some_and(|l| !l.wheel) => {
                    // A mill turned by wind or beasts: its race-side strip is a lean-to.
                    n = 1;
                    eave = Some(2.2);
                    kind = "shed";
                    pitch = pitch.clamp(15.0, 28.0);
                }
                "wheel" if look.is_some() => {
                    eave = Some(4.2);
                    kind = "flat";
                    wall = "wood";
                }
                "building" | "granary" | "mill-house" if look.is_some() => {
                    let l = look.unwrap();
                    (n, eave) = if i == main { (l.floors, Some(l.eave)) } else { (l.floors_lo, Some(l.eave_lo)) };
                    kind = l.roof;
                    if kind != "flat" { pitch = l.pitch; }
                    if l.chimney && matches!(wall, "timber" | "wattle" | "wood" | "bamboo") { wall = "stone"; }
                    out_stilts = l.stilts;
                }
                "furnace" | "wheel" | "wall" => {
                    eave = Some(if *label == "wall" { 6.0 } else { 2.5 });
                    kind = "flat";
                    wall = "stone";
                }
                "cloister" => {
                    n = 1;
                }
                "granary" | "mill-house" => {
                    n = if *label == "granary" { floors.min(2) } else { 2 };
                    if kind == "flat" || kind == "cone" || kind == "tent" {
                        kind = "hip";
                        pitch = 30.0;
                    }
                }
                _ => {
                    composable = true;
                    if let Some(k) = home_roof {
                        kind = k;
                    }
                    // Street bodies take the lot's height, rear wings one or two
                    // floors less, small annexes one floor under a lean-to.
                    if i != main {
                        let front = on_front(shape);
                        let drop = if front { rng.int(0, 1) } else { 1 + u32::from(rng.chance(0.35)) };
                        n = floors.saturating_sub(drop).max(1);
                        if area < 32.0 && kind != "flat" && !tribal && touches(&m.parts[main].0, shape) {
                            n = 1;
                            kind = "shed";
                            pitch = pitch.clamp(15.0, 28.0);
                            composable = false;
                        }
                    }
                }
            }
            if m.landmark && *label == "building" && !tribal && look.is_none() {
                n = n.max(floors) + 1;
                cover = if tr.roof == "flat" || tr.cover == "thatch" { tr.cover } else { "slate" };
            }
            if tr.form == "battered" { wall = tr.wall; }
            // A rule that names its roof keeps it.
            if swap && !m.landmark && rule.is_none_or(|r| matches!(r.roof.as_deref(), None | Some("culture"))) {
                kind = match kind {
                    "gable" => "hip",
                    "hip" => "gable",
                    k => k,
                };
            }
            let base_eave = |n: u32| {
                metric_scale * eave.map_or_else(|| n as f64 * storey_m + if shop && i == main { SHOP_EXTRA_M * body } else { 0.0 }, |e| e * body)
            };
            if min_frame(ring).is_none() {
                return Piece::Raw(json!({"floors":n,"eave_m":round2(base_eave(n)),"rise_m":0.0,"roof":"flat","ridges":[],"cover":cover,"wall":wall,"tone":round2(lot_tone)}));
            }
            if !shape.holes.is_empty() && !matches!(kind, "flat" | "dome") {
                // A court body is a ring: half the range width (area over the
                // whole eave length) sets the rise.
                let perimeter: f64 = std::iter::once(ring)
                    .chain(shape.holes.iter())
                    .map(|r| (0..r.len()).map(|i| { let (a, b) = (r[i], r[(i + 1) % r.len()]); (b.x - a.x).hypot(b.y - a.y) }).sum::<f64>())
                    .sum();
                let half = (area / perimeter.max(1e-6)).min(6.0);
                let rise = (half * pitch.to_radians().tan()).min(5.0);
                return Piece::Raw(json!({"floors":n,"eave_m":round2(base_eave(n)),"rise_m":round2(rise),"roof":"ring","ridges":[],"cover":cover,"wall":wall,"tone":round2(lot_tone)}));
            }
            // Convex decomposition of the piece, the largest part first.
            let mut budget = 6;
            let mut rings = convex_parts(ring.clone(), &mut budget);
            rings.sort_by(|a, b| ring_area(b).total_cmp(&ring_area(a)));
            if rings.len() > 1 && matches!(kind, "cone" | "tent" | "dome") {
                kind = "pyramid";
            }
            // Ridge axis: gabled row houses turn their gable to the street,
            // other street bodies run their ridge along it; the rest, and any
            // part much longer than wide, along its long side.
            let axis = |vr: &[Point], kind: &str| -> Point {
                let part = Shape { outer: vr.to_vec(), holes: vec![] };
                if let Some(d) = front_dir.filter(|_| kind != "barrel") {
                    if matches!(kind, "gable" | "hip" | "barrel") && on_front(&part) {
                        let along = frame_along(vr, d);
                        let across = frame_along(vr, perp(d));
                        let to_street = tr.gable_to_street || (flip && kind == "gable" && !m.landmark);
                        let (choice, other) = if to_street { (across, along) } else { (along, across) };
                        return if choice.half_l * 2.0 < choice.half_w { other.u } else { choice.u };
                    }
                }
                min_frame(vr).map_or(Point { x: 1.0, y: 0.0 }, |f| f.u)
            };
            // Ridge of the lot's main body, for parts whose rule follows or crosses it.
            let main_axis = axis(&m.parts[main].0.outer, "gable");
            let plain = super::forms::roof::plain;
            let mut vols: Vec<Vol> = Vec::new();
            for (pi, vr) in rings.iter().enumerate() {
                let mut vkind = kind;
                let mut vn = n;
                if composable && pi > 0 {
                    vn = n.saturating_sub(rng.int(0, 1)).max(1);
                    if !m.landmark && matches!(kind, "gable" | "hip") && rng.chance(0.25) {
                        vkind = if kind == "gable" { "hip" } else { "gable" };
                    }
                }
                let u = axis(vr, plain(vkind));
                let u = match rule.and_then(|r| r.axis.as_deref()) {
                    Some("short") => perp(min_frame(vr).map_or(u, |f| f.u)),
                    Some("street") => front_dir.unwrap_or(u),
                    Some("main") => main_axis,
                    Some("cross") => perp(main_axis),
                    _ => u,
                };
                let subs = if composable && !tribal {
                    let metric: Vec<Point> = vr.iter().map(|p| Point { x: p.x / metric_scale, y: p.y / metric_scale }).collect();
                    split_body(&metric, u, vn, plain(vkind), &mut rng).into_iter().map(|(r, d, c)|
                        (r.into_iter().map(|p| Point { x: p.x * metric_scale, y: p.y * metric_scale }).collect(), d, c)).collect()
                } else { vec![(vr.clone(), 0, false)] };
                let multi = subs.len() > 1;
                for (si, (mut sr, delta, cross)) in subs.into_iter().enumerate() {
                    let one_storey = compact || traits.massive_storey && !m.landmark && *label == "building"
                        || tr.form == "stilt";
                    let sn = if one_storey { 1 } else { (vn as i32 + delta).max(1) as u32 };
                    // A stepped part never rises above the lot's height (it steps down).
                    let sn = if sn > vn.max(floors) { vn.saturating_sub(1).max(1) } else { sn };
                    let mut sk = vkind;
                    if multi && si > 0 && !m.landmark && matches!(sk, "gable" | "hip") && rng.chance(0.25) {
                        sk = if sk == "gable" { "hip" } else { "gable" };
                    }
                    let mage = tr.form == "mage" && i == tower_part && pi == 0 && si == 0
                        && if traits.form_roles.is_empty() { m.landmark || drng.chance((0.08 + 0.3 * size) * (0.3 + 0.7 * (1.25 - m.distance).clamp(0.0, 1.0))) } else { tower_role };
                    let exterior = if mage { "tower" } else if tr.form == "mage" || out { "" } else { tr.form };
                    if matches!(exterior, "tree" | "mushroom" | "yurt" | "tower") {
                        if let Some(f) = min_frame(&sr) {
                            let c = super::geometry::centroid(&Shape { outer: sr.clone(), holes: vec![] });
                            let r = depth_in(&sr, c).min(if mage { 3.8 } else { f.half_w }).max(0.1);
                            sr = (0..16).map(|k| {
                                let a = k as f64 * std::f64::consts::TAU / 16.0;
                                let r = r * if exterior == "tree" { 0.94 + 0.06 * (5.0 * a).cos() } else { 1.0 };
                                Point { x: c.x + r * a.cos(), y: c.y + r * a.sin() }
                            }).collect();
                        }
                    }
                    // A snow house: a dome set back on its plan, its entrance tunnel before it.
                    let mut tunnel = None;
                    if exterior == "igloo" && sk == "dome" {
                        let c = ring_centroid(&sr);
                        if let Some((dome, way)) = snow_house(&sr, to_street(c).unwrap_or(Point { x: 0.0, y: 1.0 }), metric_scale * body) {
                            (sr, tunnel) = (dome, Some(way));
                        }
                    }
                    if mage { sk = "cone"; }
                    // Windmill: the main body is a round tower under a cone.
                    if look.is_some_and(|l| l.name == "wind_mill") && i == main && pi == 0 && si == 0 {
                        if let Some(f) = min_frame(&sr) {
                            let c = ring_centroid(&sr);
                            let r = f.half_w.min(f.half_l).min(4.5 * metric_scale * body).max(0.5);
                            sr = (0..16).map(|k| { let a = k as f64 * std::f64::consts::TAU / 16.0; Point { x: c.x + r * a.cos(), y: c.y + r * a.sin() } }).collect();
                        }
                        sk = "cone";
                    }
                    // A ruled round part (turret, drum, kiln): a regular polygon inscribed in its footprint.
                    if let Some(sides) = rule.and_then(|r| r.round)
                        && let Some(f) = min_frame(&sr)
                    {
                        let c = ring_centroid(&sr);
                        let r = depth_in(&sr, c).min(f.half_w).max(0.3);
                        let sides = sides.clamp(5, 24);
                        sr = (0..sides).map(|k| { let a = k as f64 * std::f64::consts::TAU / sides as f64; Point { x: c.x + r * a.cos(), y: c.y + r * a.sin() } }).collect();
                    }
                    let su = if cross { perp(u) } else { u };
                    let c = ring_centroid(&sr);
                    let high = if i != main {
                        Point { x: main_c.x - c.x, y: main_c.y - c.y }
                    } else {
                        front_dir.map_or(Point { x: 0.0, y: 1.0 }, |d| Point { x: -d.x, y: -d.y })
                    };
                    let high = match rule.and_then(|r| r.high.as_deref()) {
                        Some("street") => to_street(c).unwrap_or(high),
                        Some("back") => to_street(c).map_or(high, |d| Point { x: -d.x, y: -d.y }),
                        // A lean-to rises towards the body it touches (the largest one), not
                        // always the lot's main body: an aisle to its nave, a gallery to its hall.
                        Some("main") => (0..m.parts.len())
                            .filter(|&j| j != i && touches(&m.parts[j].0, shape))
                            .max_by(|&a, &b| areas[a].total_cmp(&areas[b]))
                            .map_or(high, |j| { let o = super::geometry::centroid(&m.parts[j].0); Point { x: o.x - c.x, y: o.y - c.y } }),
                        _ => high,
                    };
                    // A ruled lean-to runs its ridge along the wall it leans on.
                    let su = match (sk, rule.is_some_and(|r| r.high.is_some()), min_frame(&sr)) {
                        ("shed", true, Some(f)) => {
                            let across = perp(f.u);
                            if (f.u.x * high.x + f.u.y * high.y).abs() <= (across.x * high.x + across.y * high.y).abs() { f.u } else { across }
                        }
                        _ => su,
                    };
                    let vp = if mage { 68.0 } else { pitch * (1.0 + rng.range(-0.04, 0.04)) };
                    let roof = roof_of(&sr, plain(sk), vp, su, high);
                    let rise_cap = metric_scale * if *label == "tower" { 14.0 } else { 12.0 };
                    let roof = Roof { rise: roof.rise.min(rise_cap), ..roof };
                    let (parapet, features) = if roof.kind == "flat" {
                        flat_details(&sr, label, flavor(m.culture), wall, m.wealth, m.landmark, &mut drng)
                    } else {
                        (0.0, vec![])
                    };
                    let thatchy = matches!(cover, "thatch" | "reed" | "palm" | "bamboo" | "bark" | "felt" | "hide" | "turf");
                    let hut = sn == 1 && thatchy && !m.landmark && matches!(roof.kind, "cone" | "tent" | "hip" | "gable" | "pyramid");
                    // Yurt: round felt wall and a shallow cone; tipi: a tall hide cone
                    // on poles, no wall; stilt house: the body on posts.
                    let radius = min_frame(&sr).map_or(0.0, |f| f.half_w.max(f.half_l.min(f.half_w * 1.4)));
                    let tent = roof.kind == "tent" && tr.form != "";
                    let roof = match (tent, tr.form) {
                        (true, "yurt") => Roof { rise: radius * 0.4, ..roof },
                        (true, "tipi") => Roof { rise: (radius * 1.8).min(rise_cap), ..roof },
                        _ => roof,
                    };
                    let stilts = if out_stilts > 0.0 { out_stilts * body } else if tr.form == "stilt" { (1.6 + 0.6 * drng.float()) * body } else { 0.0 };
                    let composed_hut = hut && m.complex && home && matches!(roof.kind, "hip" | "gable");
                    let (eave_v, overhang) = match (hut, roof.kind) {
                        (true, "tent") if tent && tr.form == "yurt" => (1.6, 0.2),
                        (true, "tent") if tent && tr.form == "tipi" => (0.1, 0.0),
                        (true, "tent") => (0.5, 0.3),
                        // A complex home under a pitched thatch composes its roof like any other
                        // (valleys, the kit's eaves): its hut overhang gives way to the composition's.
                        (true, _) if composed_hut => (base_eave(sn).min(2.2), 0.0),
                        (true, _) => (base_eave(sn).min(2.2), 0.65),
                        _ => (base_eave(sn), 0.0),
                    };
                    let eave_v = match exterior {
                        "yurt" => 1.6,
                        "tipi" => 0.1,
                        "tree" => 11.5,
                        "mushroom" => 2.5 + 2.0 * drng.float(),
                        "longhouse" => 1.5,
                        // Snow blocks spiral up from the ground: hardly a wall under the dome.
                        "igloo" => 0.4 * body,
                        "tower" => 9.0 + (6.0 + 22.0 * size) * drng.float(),
                        _ => eave_v,
                    };
                    let roof = if matches!(exterior, "tree" | "mushroom") { Roof { kind: "dome", rise: radius * if exterior == "tree" { 0.95 } else { 0.65 }, ..roof } }
                        else if hut && roof.kind == "cone" && !mage { Roof { rise: roof.rise * 1.12, ..roof } } else { roof };
                    // No thin tall sliver (a tower at most 4.5 × its
                    // width, any other body 2.5 ×); a pitched roof rises at most 0.6 ×
                    // its span, a house roof about its wall height at most.
                    let (sn, eave_v, roof) = if !matches!(exterior, "tree" | "mushroom" | "yurt" | "tipi" | "tower" | "longhouse" | "igloo") {
                        let w = min_frame(&sr).map_or(0.0, |f| 2.0 * f.half_w);
                        let tower = matches!(*label, "tower" | "belfry" | "minaret" | "keep");
                        let (mut sn, mut ev) = (sn, eave_v);
                        if w > 0.5 && eave.is_none() && !hut {
                            let max = w * if tower { 4.5 } else { 2.5 };
                            while sn > 1 && ev > max { sn -= 1; ev = base_eave(sn); }
                        }
                        let mut rise = roof.rise;
                        if w > 0.5 && !tower && matches!(roof.kind, "gable" | "hip" | "shed" | "pyramid" | "cone") {
                            rise = rise.min(0.6 * w);
                            if *label == "building" && !m.landmark { rise = rise.min((1.25 * ev).max(2.2 * body)); }
                        }
                        (sn, ev, Roof { rise, ..roof })
                    } else { (sn, eave_v, roof) };
                    let trim = if roof.kind == "flat" && parapet > 0.0 && flavor(m.culture) == "meso" && sn >= 1 { "red" } else { "" };
                    let base = metric_scale * body * ruled_base;
                    // The plain kind may have changed (a narrow body under a shed, a concave part left flat).
                    let form_roof = if roof.kind == plain(sk) { sk } else { roof.kind };
                    let vol = Vol {
                        parapet,
                        features,
                        overhang,
                        trim,
                        form: exterior,
                        stilts,
                        body: body * metric_scale,
                        eave: base + eave_v,
                        n: sn,
                        cover,
                        wall,
                        tone: (lot_tone + rng.range(-0.08, 0.08)).clamp(0.0, 1.0),
                        ring: sr,
                        roof,
                        base,
                        stack: rule.is_some_and(|r| r.base == super::forms::roles::Base::Stack),
                        axis: su,
                        high,
                        form_roof,
                        pitch: vp,
                        eaves: rule.and_then(|r| r.overhang).or(composed_hut.then_some(kit.overhang.max(0.5))),
                        pans: None,
                        gables: vec![],
                        minor: rule.is_some_and(|r| r.minor),
                        openings: if tunnel.is_some() { "none" } else { rule.and_then(|r| r.openings.as_deref()).unwrap_or("") },
                    };
                    // The tunnel comes first: the plan paints the dome over its inner end.
                    if let Some((ring, axis, width)) = tunnel {
                        let g = ring_centroid(&ring);
                        let n = perp(axis);
                        let t = g.x * n.x + g.y * n.y;
                        let ridges = chord(&ring, axis, t).map(|(a, b)| seg(at_st(axis, a + 0.05, t), at_st(axis, b - 0.05, t))).into_iter().collect();
                        vols.push(Vol {
                            ring, n: 1, eave: 0.4 * width, roof: Roof { kind: "barrel", rise: 0.45 * width, ridges },
                            cover, wall, tone: vol.tone, parapet: 0.0, features: vec![], overhang: 0.0, trim: "", form: "igloo", stilts: 0.0, body,
                            base: 0.0, stack: false, axis, high, form_roof: "barrel", pitch: vp, eaves: None, pans: None, gables: vec![], minor: false, openings: "door",
                        });
                    }
                    match rule.and_then(|r| r.tiers.as_ref()) {
                        Some(t) => vols.extend(tiered(vol, t, &mut drng)),
                        None => vols.push(vol),
                    }
                }
            }
            if i == main && let Some(l) = look && !vols.is_empty() {
                let sc = metric_scale * body;
                let has_wheel = m.parts.iter().any(|(_, l)| *l == "wheel");
                vols.extend(activity_details(&vols[0], l, has_wheel, m.fronts, sc));
                if l.sails && let Some(f) = sails_feature(&vols[0], m.seed) {
                    vols[0].features.push(f);
                }
            }
            Piece::Vols(vols, n)
        })
        .collect();
    // Chimneys and dormers of a complex home, on its main body.
    let details = (m.complex && home)
        .then(|| match pieces.get(main) {
            Some(Piece::Vols(vols, _)) => vols.first().filter(|v| v.composes()).map(|v| home_details(v, kit, m.seed, metric_scale * body, &to_street)),
            _ => None,
        })
        .flatten();
    if let (Some(extra), Some(Piece::Vols(vols, _))) = (details, pieces.get_mut(main)) {
        vols.extend(extra);
    }
    // A stacked volume stands on the highest volume of another piece under its centre.
    let tops: Vec<(Vec<Point>, f64, usize)> = pieces
        .iter()
        .enumerate()
        .flat_map(|(i, p)| match p {
            Piece::Raw(v) => vec![(m.parts[i].0.outer.clone(), v["eave_m"].as_f64().unwrap_or(0.0), i)],
            Piece::Vols(vols, _) => vols.iter().filter(|v| !v.stack).map(|v| (v.ring.clone(), v.eave, i)).collect(),
        })
        .collect();
    for (i, p) in pieces.iter_mut().enumerate() {
        if let Piece::Vols(vols, _) = p {
            for v in vols.iter_mut().filter(|v| v.stack) {
                let c = ring_centroid(&v.ring);
                v.lift(tops.iter().filter(|t| t.2 != i && within(&t.0, c)).map(|t| t.1).fold(0.0, f64::max));
            }
        }
    }
    // Composed roofs: homes in complex mode, every other building always.
    if m.complex || !home {
        let all: Vec<&Vol> = pieces.iter().flat_map(|p| match p { Piece::Vols(v, _) => v.iter().collect::<Vec<_>>(), Piece::Raw(_) => vec![] }).collect();
        if all.iter().any(|v| v.composes()) {
            // Eaves pass the walls where the building stands free: a rural home, any singular building.
            let rural = matches!(m.zone, "village" | "hamlet" | "rural");
            let over = metric_scale * if !home { 0.25 } else if rural { kit.overhang } else { 0.0 };
            let masses: Vec<super::forms::roof::Mass> = all
                .iter()
                .map(|v| super::forms::roof::Mass {
                    ring: &v.ring,
                    kind: if v.composes() { v.form_roof } else if v.roof.kind == "flat" { "flat" } else { "curved" },
                    axis: v.axis,
                    eave: v.eave,
                    rise: v.roof.rise,
                    overhang: if !v.composes() { 0.0 } else if v.minor { 0.08 } else { v.eaves.map_or(over, |e| e * metric_scale) },
                    high: v.high,
                })
                .collect();
            let mut roofs = super::forms::roof::compose(&masses).into_iter();
            drop(masses);
            drop(all);
            for p in pieces.iter_mut() {
                if let Piece::Vols(vols, _) = p {
                    for v in vols.iter_mut() {
                        if let Some(Some(r)) = roofs.next() {
                            v.eave = r.eave;
                            v.roof.rise = r.rise;
                            v.pans = Some(r.pans);
                            v.gables = r.gables;
                        }
                    }
                }
            }
        }
    }
    Value::Array(
        pieces
            .into_iter()
            .enumerate()
            .map(|(i, p)| {
                let (vols, n) = match p {
                    Piece::Raw(mut v) => {
                        if let Some(t) = tint && v["cover"] != "ruin" {
                            v["tint"] = json!(t);
                        }
                        return v;
                    }
                    Piece::Vols(vols, n) => (vols, n),
                };
                // Entry-level fields repeat the tallest volume (a chimney is not one).
                let top = vols
                    .iter()
                    .enumerate()
                    .filter(|v| !v.1.minor)
                    .max_by(|a, b| (a.1.eave + a.1.roof.rise).total_cmp(&(b.1.eave + b.1.roof.rise)))
                    .map_or(0, |(k, _)| k);
                let t = &vols[top];
                let mut entry = json!({"floors":vols.iter().map(|v| v.n).max().unwrap_or(n),"eave_m":round2(t.eave),"rise_m":round2(t.roof.rise),
                    "roof":t.roof.kind,"ridges":t.roof.ridges,"cover":t.cover,"wall":t.wall,"tone":round2(lot_tone),
                    "volumes":vols.iter().enumerate().map(|(j, v)| {
                        let mut out = v.json();
                        let open = facade_openness(m.culture, v.wall);
                        if open < 1.0 { out["openness"] = json!(open); }
                        if v.form == "tree" { out["tree_seed"] = json!(format!("{}:tree:{}:{}", m.seed, i, j)); }
                        out
                    }).collect::<Vec<_>>()});
                if let Some(t) = tint {
                    entry["tint"] = json!(t);
                }
                entry
            })
            .collect(),
    )
}

#[cfg(test)]
mod tests;
