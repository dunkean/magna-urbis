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
//! bark | hide | felt | earth | plaster | stone | snow | metal; `wall` ∈
//! timber | brick | stone | earth | wood | plaster | bamboo | wattle | hide |
//! coral; `tone` ∈ 0..1 per lot.
//! Flat roofs also carry `parapet_m` (wall rising above the eave, 0.35–1.1 m
//! by culture), `trim` (red band of mesoamerican flat roofs) and
//! `features:[{kind,x,y,w,d,h,angle}]` (roof-top stair heads,
//! domes, wind-catchers) standing strictly inside the parapet. Huts (one floor
//! of thatch, reed, hide…) have low walls and an `overhang_m` of roof past them.
use super::{Point, Shape};
use crate::rng::Rng;
use serde_json::{Value, json};

/// The ground floor's extra height (m) for shops.
const SHOP_EXTRA_M: f64 = 0.8;

#[derive(Clone, Copy)]
struct Tradition {
    roof: &'static str,
    pitch: f64,
    storeys: [u32; 2],
    cover: &'static str,
    wall: &'static str,
    /// Ridge perpendicular to the street (gabled row houses), else along the
    /// street for street bodies.
    gable_to_street: bool,
    /// Building form the typology names (`yurt`, `tipi`, `stilt`), else empty.
    form: &'static str,
}

const fn t(
    roof: &'static str,
    pitch: f64,
    storeys: [u32; 2],
    cover: &'static str,
    wall: &'static str,
) -> Tradition {
    Tradition {
        roof,
        pitch,
        storeys,
        cover,
        wall,
        gable_to_street: false,
        form: "",
    }
}

/// Roof tradition a culture's style traits declare, for a tissue without
/// `arch` (`forms/styles.json`, `cultures.<id>.traits.tradition`). Its `form`
/// makes a landmark or untyped lot of a tipi people a tipi too, never a stone nave.
fn declared(traits: &'static super::forms::kit::CultureTraits) -> Option<Tradition> {
    traits.tradition.as_ref().map(|d| Tradition {
        roof: d.roof.as_str(),
        pitch: d.pitch,
        storeys: d.storeys,
        cover: d.cover.as_str(),
        wall: d.wall.as_str(),
        gable_to_street: d.gable_to_street,
        form: d.form.as_str(),
    })
}

/// Cover and wall a catalogue `arch.material` asks for (None: keep the roof
/// kind's default cover / the culture's wall).
fn material_style(material: &str, roof: &str, typology: &str) -> (Option<&'static str>, Option<&'static str>) {
    let pitched_wood = matches!(roof, "gable" | "thatch-ridge");
    match material {
        "timber" => (None, Some("timber")),
        "wood" => match typology {
            "stilt-house" => (Some("bamboo"), Some("bamboo")),
            _ => (if pitched_wood { Some("shingle") } else { None }, Some("wood")),
        },
        "cedar-plank" => (Some("shingle"), Some("wood")),
        "brick" => (None, Some("brick")),
        "stone" | "granite" | "marble" => (None, Some("stone")),
        "dark-stone" | "rock" => (Some("stone"), Some("stone")),
        "coral-stone" => (Some("plaster"), Some("coral")),
        "mud" | "adobe" | "earth" | "rammed-earth" => (Some("earth"), Some("earth")),
        "thatch" => match typology {
            "maloca" => (Some("palm"), Some("wood")),
            "stilt-house" => (Some("palm"), Some("bamboo")),
            "beehive-hut" => (Some("thatch"), Some("wattle")),
            _ => (Some("thatch"), Some("wood")),
        },
        "reed" => (Some("reed"), Some("wattle")),
        "bamboo" => (Some("bamboo"), Some("bamboo")),
        "palm" => (Some("palm"), Some("wood")),
        "wattle" => (Some(if typology == "maya-house" { "palm" } else { "reed" }), Some("wattle")),
        "turf" => (Some("turf"), Some("earth")),
        "hide" => (Some("hide"), Some("hide")),
        "felt" | "fabric" => (Some("felt"), Some("hide")),
        "bark" | "living-wood" => (Some("bark"), Some("wood")),
        "fungal" => (Some("turf"), Some("wattle")),
        "snow" => (Some("snow"), Some("plaster")),
        _ => (None, None),
    }
}

/// Roof tradition of the lot: the tissue's `arch` first, else the culture's
/// declared tradition, else a plain tiled gable.
fn tradition(arch: &Value, culture: &str) -> Tradition {
    let traits = super::forms::kit::traits(culture);
    let fallback = declared(traits).unwrap_or(t("gable", 38.0, [1, 2], "tile", "plaster"));
    let Some(roof) = arch["roof"].as_str() else {
        return fallback;
    };
    let typology = arch["typology"].as_str().unwrap_or("");
    let material = arch["material"].as_str().unwrap_or("");
    let storeys = match (arch["storeys"][0].as_u64(), arch["storeys"][1].as_u64()) {
        (Some(lo), Some(hi)) if lo >= 1 && hi >= lo => [lo as u32, hi as u32],
        _ => fallback.storeys,
    };
    let (mat_cover, mat_wall) = material_style(material, roof, typology);
    let wall = mat_wall.unwrap_or(fallback.wall);
    // Mediterranean tile roofs stay low whatever the tissue's material;
    // elsewhere a gable's pitch follows its cover (steep thatch and timber
    // towns, low plank and turf roofs).
    let mediterranean = traits.mediterranean;
    let gable_pitch = match material {
        _ if mediterranean => 24.0,
        "timber" => 50.0,
        "brick" | "thatch" => 46.0,
        "stone" => 40.0,
        "turf" | "wood" => 34.0,
        "cedar-plank" => 22.0,
        _ => 38.0,
    };
    let (kind, pitch, cover) = match roof {
        "gable" => ("gable", gable_pitch, if material == "stone" && !mediterranean { "slate" } else { "tile" }),
        "tiled-hip" => ("hip", if mediterranean { 22.0 } else { 28.0 }, "tile"),
        "hip" => ("hip", 32.0, "tile"),
        "shed" => ("shed", 18.0, "shingle"),
        "flat" | "terraced" => ("flat", 0.0, "earth"),
        "dome" => ("dome", 0.0, "plaster"),
        "thatch-round" => ("cone", 42.0, "thatch"),
        "conical" => ("cone", 40.0, "thatch"),
        "pyramidal" => ("pyramid", 35.0, "tile"),
        "barrel" => ("barrel", 0.0, "plaster"),
        "thatch-ridge" => ("gable", 45.0, "thatch"),
        _ => (fallback.roof, fallback.pitch, fallback.cover),
    };
    let cover = mat_cover.unwrap_or(cover);
    // Round roofs of skins and felt are tents (yurts, tipis, orc huts).
    let kind = if matches!(material, "hide" | "felt" | "fabric") && matches!(kind, "cone" | "dome") {
        "tent"
    } else {
        kind
    };
    Tradition {
        roof: kind,
        pitch,
        storeys,
        cover,
        wall,
        gable_to_street: kind == "gable"
            && !mediterranean
            && (typology.contains("gable") || typology.contains("giebel")),
        form: match typology {
            "ger" | "yurt" => "yurt",
            "tipi" | "tepee" => "tipi",
            "stilt-house" => "stilt",
            _ => "",
        },
    }
}

/// Roof kind, pitch (degrees), cover and wall of a lot's tradition: the
/// building traits a style kit is chosen from (`forms::kit`).
pub(super) fn house_traits(arch: &Value, culture: &str) -> (&'static str, f64, &'static str, &'static str) {
    let t = tradition(arch, culture);
    (t.roof, t.pitch, t.cover, t.wall)
}

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
}

/// Oriented box of a ring along a chosen axis: centre, unit axis, half length
/// (along the axis) and half width (across).
#[derive(Clone, Copy)]
struct Frame {
    c: Point,
    u: Point,
    half_l: f64,
    half_w: f64,
}
fn frame_along(ring: &[Point], u: Point) -> Frame {
    let (mut s0, mut s1, mut t0, mut t1) = (f64::MAX, f64::MIN, f64::MAX, f64::MIN);
    for p in ring {
        let s = p.x * u.x + p.y * u.y;
        let t = -p.x * u.y + p.y * u.x;
        s0 = s0.min(s);
        s1 = s1.max(s);
        t0 = t0.min(t);
        t1 = t1.max(t);
    }
    let (s, t) = ((s0 + s1) / 2.0, (t0 + t1) / 2.0);
    Frame {
        c: Point {
            x: s * u.x - t * u.y,
            y: s * u.y + t * u.x,
        },
        u,
        half_l: (s1 - s0) / 2.0,
        half_w: (t1 - t0) / 2.0,
    }
}
/// Minimum-area oriented box, its axis along the longer side.
fn min_frame(ring: &[Point]) -> Option<Frame> {
    let mut best: Option<(f64, Frame)> = None;
    for i in 0..ring.len() {
        let (a, b) = (ring[i], ring[(i + 1) % ring.len()]);
        let l = (b.x - a.x).hypot(b.y - a.y);
        if l < 1e-6 {
            continue;
        }
        let f = frame_along(ring, Point { x: (b.x - a.x) / l, y: (b.y - a.y) / l });
        let area = f.half_l * f.half_w;
        if best.as_ref().is_none_or(|(a, _)| area < *a) {
            best = Some((area, f));
        }
    }
    best.map(|(_, f)| {
        if f.half_l >= f.half_w {
            f
        } else {
            frame_along(ring, Point { x: -f.u.y, y: f.u.x })
        }
    })
}

fn near_segment(shape: &Shape, a: Point, b: Point, tolerance: f64) -> bool {
    let ring = &shape.outer;
    (0..ring.len()).any(|i| {
        let (p, q) = (ring[i], ring[(i + 1) % ring.len()]);
        let m = Point { x: (p.x + q.x) / 2.0, y: (p.y + q.y) / 2.0 };
        [p, m, q]
            .iter()
            .any(|&x| super::geometry::distance(x, a, b).0 <= tolerance)
    })
}
fn touches(a: &Shape, b: &Shape) -> bool {
    let ring = &b.outer;
    (0..ring.len()).any(|i| near_segment(a, ring[i], ring[(i + 1) % ring.len()], 0.35))
}

/// Display massing of one ruin piece (parcels/ruins.rs `broken_walls`):
/// roofless stubs broken at a quarter to three quarters of the eaves `full_m`,
/// corners standing to them, low rubble mounds; masonry (a timber or hide
/// house leaves its stone footing), no openings (the gaps between stubs are
/// the doors and windows).
pub(super) fn ruin_piece(label: &str, full_m: f64, wall: &str, tone: f64, rng: &mut Rng) -> Value {
    let wall = if matches!(wall, "stone" | "brick" | "earth" | "plaster" | "coral") { wall } else { "stone" };
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

/// Inhabitants' size against a human (doors, windows, storeys): small folk build small.
fn body_scale(culture: &str) -> f64 {
    let scale = super::forms::kit::traits(culture).body_scale;
    if scale > 0.0 { scale } else { 1.0 }
}

/// Facade openness 0..1 (windows per wall): thick masonry in hot dry or Mediterranean climates (the
/// Mediterranean and the flavored cultures) has few small openings, their light walls the openness the
/// culture states (wooden Ottoman houses: somewhat more); temperate and cold cultures are fully open (1).
/// A culture's own `openness` replaces all of this.
fn facade_openness(culture: &str, wall: &str) -> f64 {
    let traits = super::forms::kit::traits(culture);
    if traits.openness > 0.0 {
        return traits.openness;
    }
    let masonry = matches!(wall, "stone" | "plaster" | "brick" | "earth" | "coral");
    let warm = traits.mediterranean || !traits.flavor.is_empty();
    match (warm, masonry) { (true, true) => 0.5, (true, false) if traits.light_wall_openness > 0.0 => traits.light_wall_openness, _ => 1.0 }
}

/// Settlement size on 0..1: 500 inhabitants (or fewer) 0, 20 000 and more 1 (unknown: 1).
fn size_of(population: u32) -> f64 {
    if population == 0 { 1.0 } else { ((population as f64).ln() - 500f64.ln()) / (20_000f64.ln() - 500f64.ln()) }.clamp(0.0, 1.0)
}

/// Height gradient (« dégradé de hauteur depuis un cœur »): every non-landmark
/// lot is capped by the settlement size and its distance from the core, so a
/// village stays at one or two storeys whatever the function and a town grades
/// from its core to a low periphery, with some low houses in the core too.
/// Tower cultures (storeys from four) mix towers and ordinary houses: the
/// tower share grows from a few per village to most of a large town's core.
fn gradient_floors(m: &Input, tr: &Tradition, floors: u32) -> u32 {
    let size = size_of(m.population);
    // A main building scales with the population: modest in a village (its
    // landmark storey comes on top), the tradition's full height in a city.
    if m.landmark { return floors.min(1 + ((0.4 + 0.6 * size) * tr.storeys[1].max(2).saturating_sub(1) as f64).round() as u32); }
    let central = (1.25 - m.distance).clamp(0.0, 1.0);
    let g = (0.25 + 0.75 * size) * central;
    let [lo, hi] = tr.storeys;
    let mut r = Rng::new(m.seed).fork("height-gradient");
    // A third storey needs a dense core (g >= 0.78 on a three-storey tradition), or a tenement / mansion
    // on a pressured lot: isolated tall blocks in a thin periphery are wrong for every culture.
    let cap = |hi: u32| 1 + (g * hi.saturating_sub(1) as f64 + if hi >= 3 { 0.45 } else { 0.5 }).floor() as u32;
    let mixed = size > 0.3 && r.chance(0.2);
    if lo >= 4 {
        if r.chance(0.03 + 0.6 * size * central) {
            return lo + ((hi - lo) as f64 * size * central).round() as u32;
        }
        // Ordinary houses of a tower people keep a storey more than their cap (at most three).
        let c = (cap(3) + 1).min(3);
        let f = (1.0 + (c - 1) as f64 * r.float()).round() as u32;
        return if mixed { f.saturating_sub(1).max(1) } else { f.max(1) };
    }
    let c = cap(hi.max(2));
    let floors = floors.min(if mixed { c.saturating_sub(1).max(1) } else { c });
    let big_home = m.role.contains("tenement") || m.role.contains("insula") || m.role.contains("mansion") || m.role.contains("palace");
    if floors >= 3 && m.pressure < 0.5 && !big_home && hi <= 3 { 2 } else { floors }
}

fn small_home(m: &Input) -> bool {
    m.small_home && m.zone != "core" && !m.landmark && !m.role.contains("tower")
        && matches!(m.function, "domestic" | "mixed")
        && m.parts.iter().all(|(_,l)| matches!(*l, "barn" | "byre" | "annex") || super::forms::plan::is_house_part(l) || super::farmsteads::is_outbuilding(l))
        && super::house_mix::ordinary_home(m.culture, m.arch, m.seed)
}

/// Lot-level floor count: the tradition's range by zone, pressure, wealth,
/// corner and a per-lot draw; roles pick their end of the range.
fn lot_floors(m: &Input, tr: &Tradition, rng: &mut Rng) -> u32 {
    let [lo, hi] = tr.storeys;
    // Invariant (« gradient régulier »): height follows the lot's access
    // pressure along one curve in every zone (a core keeps a floor, as for
    // lot sizes); villages and hamlets stay low.
    let rural = matches!(m.zone, "village" | "hamlet" | "rural");
    let urban = if rural { 0.3 * m.pressure.clamp(0.0, 1.0) }
        else if m.zone == "core" { m.pressure.clamp(0.0, 1.0).max(0.65) } else { m.pressure.clamp(0.0, 1.0) };
    // A market town's centre stands lower than a city's: the full storey
    // range is reached from about 20 000 inhabitants (unknown: full range).
    let size = if m.population == 0 { 1.0 }
        else { ((m.population as f64).ln() - 500f64.ln()) / (20_000f64.ln() - 500f64.ln()) }.clamp(0.0, 1.0);
    let urban = urban * (0.5 + 0.5 * size);
    let hi = if size < 1.0 && hi > lo { lo + ((hi - lo) as f64 * (0.5 + 0.5 * size)).round() as u32 } else { hi };
    // Away from the core more and more ordinary homes of a multi-storey
    // tradition have one floor less: a mix of cottages and storeyed houses
    // that thins out gradually, never a uniform lowering.
    let home = !m.landmark && matches!(m.function, "domestic" | "mixed") && !m.role.contains("tower") && lo < 4;
    let drop = ((0.6 - urban) / 0.45).clamp(0.0, 1.0) * 0.7;
    // Gradient core > ring > faubourg > village: a village's storeys are the
    // tradition's range lowered by two (floor 1, cap two floors, a notable
    // house in ten reaches a third); a faubourg lowers it by one.
    let low = m.low_rural;
    let (lo, hi) = if home && rural && low {
        let l = lo.saturating_sub(2).max(1);
        let notable = hi > l + 1 && Rng::new(m.seed).fork("storey-notable").chance(0.06 + 0.3 * (m.wealth - 0.6).max(0.0));
        (l, if notable { l + 2 } else { (l + 1).min(hi) })
    } else if home && rural {
        (lo, hi.min(lo + 1))
    } else if home && low && m.zone == "faubourg" {
        (lo.saturating_sub(1).max(1), hi.saturating_sub(1).max(lo.saturating_sub(1).max(1)))
    } else { (lo, hi) };
    let lo = if home && !(low && (rural || m.zone == "faubourg")) && Rng::new(m.seed).fork("storey-drop").chance(drop) { lo.saturating_sub(1).max(1) } else { lo };
    let corner = m.fronts.len() >= 2 && {
        let d = |s: &[Point; 2]| {
            let l = (s[1].x - s[0].x).hypot(s[1].y - s[0].y).max(1e-9);
            ((s[1].x - s[0].x) / l, (s[1].y - s[0].y) / l)
        };
        let a = d(&m.fronts[0]);
        m.fronts[1..].iter().any(|s| {
            let b = d(s);
            (a.0 * b.0 + a.1 * b.1).abs() < 0.7
        })
    };
    let mut x = 0.85 * urban - 0.05 + 0.25 * (m.wealth - 0.5)
        + rng.range(-0.25, 0.25) + if rural && low { 0.3 } else { 0.0 }
        + if corner { 0.15 } else { 0.0 };
    let role = m.role;
    if role.contains("tenement") || role.contains("insula") || m.function == "collective" {
        x += 0.45;
    } else if role.contains("mansion") || role.contains("townhouse") || role.contains("palace") {
        x += 0.25;
    } else if role.contains("farm") || role.contains("hut") || role.contains("platform") {
        x -= 0.4;
    }
    let mut floors = lo + ((hi - lo) as f64 * x.clamp(0.0, 1.0)).round() as u32;
    if matches!(m.function, "warehouse" | "workshop") || role.starts_with("storage") {
        floors = floors.min(lo + 1);
    }
    let floors = if small_home(m) { 1 } else { floors.clamp(lo, hi) };
    if small_home(m) { floors } else { gradient_floors(m, tr, floors) }
}

// ---- polygon helpers (convex decomposition, clipping, ridges) ----

fn cross3(a: Point, b: Point, c: Point) -> f64 {
    (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)
}
fn ring_area(r: &[Point]) -> f64 {
    super::geometry::signed(r).abs()
}
/// Drops repeated and collinear vertices.
fn clean(ring: Vec<Point>) -> Vec<Point> {
    let mut r: Vec<Point> = Vec::with_capacity(ring.len());
    for p in ring {
        if r.last().is_none_or(|q| (q.x - p.x).hypot(q.y - p.y) > 1e-5) {
            r.push(p);
        }
    }
    while r.len() > 1 && (r[0].x - r[r.len() - 1].x).hypot(r[0].y - r[r.len() - 1].y) <= 1e-5 {
        r.pop();
    }
    let mut changed = true;
    while changed && r.len() > 3 {
        changed = false;
        for i in 0..r.len() {
            let (p, v, q) = (r[(i + r.len() - 1) % r.len()], r[i], r[(i + 1) % r.len()]);
            let l = (v.x - p.x).hypot(v.y - p.y) * (q.x - v.x).hypot(q.y - v.y);
            if cross3(p, v, q).abs() <= 1e-6 * l.max(1e-9) {
                r.remove(i);
                changed = true;
                break;
            }
        }
    }
    r
}
fn orient(r: &[Point]) -> f64 {
    if super::geometry::signed(r) >= 0.0 { 1.0 } else { -1.0 }
}
fn reflex_at(r: &[Point], i: usize, sg: f64) -> bool {
    let n = r.len();
    let (p, v, q) = (r[(i + n - 1) % n], r[i], r[(i + 1) % n]);
    let l = (v.x - p.x).hypot(v.y - p.y) * (q.x - v.x).hypot(q.y - v.y);
    l > 1e-9 && cross3(p, v, q) * sg < -0.03 * l
}
fn reflex_count(r: &[Point]) -> usize {
    let sg = orient(r);
    (0..r.len()).filter(|&i| reflex_at(r, i, sg)).count()
}
/// Cuts the ring from reflex vertex `i` along the extension of its edge
/// towards `from`; returns the two parts and the cut length.
fn cut_from(r: &[Point], i: usize, from: usize) -> Option<(Vec<Point>, Vec<Point>, f64)> {
    let n = r.len();
    let v = r[i];
    let (dx, dy) = (v.x - r[from].x, v.y - r[from].y);
    let l = dx.hypot(dy);
    if l < 1e-9 {
        return None;
    }
    let d = Point { x: dx / l, y: dy / l };
    let skip = [(i + n - 1) % n, i];
    let mut best: Option<(f64, usize)> = None;
    for j in 0..n {
        if skip.contains(&j) {
            continue;
        }
        let (a, b) = (r[j], r[(j + 1) % n]);
        let e = Point { x: b.x - a.x, y: b.y - a.y };
        let den = d.x * e.y - d.y * e.x;
        if den.abs() < 1e-12 {
            continue;
        }
        let av = Point { x: a.x - v.x, y: a.y - v.y };
        let t = (av.x * e.y - av.y * e.x) / den;
        let s = (av.x * d.y - av.y * d.x) / den;
        if t > 1e-6 && (-1e-9..1.0).contains(&s) && best.is_none_or(|(bt, _)| t < bt) {
            best = Some((t, j));
        }
    }
    let (t, j) = best?;
    let h = Point { x: v.x + d.x * t, y: v.y + d.y * t };
    let mut a = vec![v];
    let mut k = (i + 1) % n;
    loop {
        a.push(r[k]);
        if k == j {
            break;
        }
        k = (k + 1) % n;
    }
    a.push(h);
    let mut b = vec![h];
    let mut k = (j + 1) % n;
    while k != i {
        b.push(r[k]);
        k = (k + 1) % n;
    }
    b.push(v);
    let (a, b) = (clean(a), clean(b));
    if a.len() < 3 || b.len() < 3 || ring_area(&a) < 0.5 || ring_area(&b) < 0.5 {
        return None;
    }
    Some((a, b, t))
}
/// Convex decomposition at reflex vertices: each cut extends an edge across
/// the reflex corner, the cut leaving the fewest reflex corners (then the
/// shortest) wins. Parts that stay non-convex (cut budget spent) are kept.
fn convex_parts(ring: Vec<Point>, budget: &mut usize) -> Vec<Vec<Point>> {
    let ring = clean(ring);
    if ring.len() < 3 || reflex_count(&ring) == 0 || *budget == 0 {
        return vec![ring];
    }
    let sg = orient(&ring);
    let n = ring.len();
    let mut best: Option<(usize, f64, Vec<Point>, Vec<Point>)> = None;
    for i in 0..n {
        if !reflex_at(&ring, i, sg) {
            continue;
        }
        for from in [(i + n - 1) % n, (i + 1) % n] {
            if let Some((a, b, len)) = cut_from(&ring, i, from) {
                let score = reflex_count(&a) + reflex_count(&b);
                if best.as_ref().is_none_or(|(s, l, _, _)| (score, len) < (*s, *l)) {
                    best = Some((score, len, a, b));
                }
            }
        }
    }
    let Some((_, _, a, b)) = best else {
        return vec![ring];
    };
    *budget -= 1;
    let mut out = convex_parts(a, budget);
    out.extend(convex_parts(b, budget));
    out
}
/// Keeps the part of a convex ring with `p·n >= d`.
fn clip_half(r: &[Point], n: Point, d: f64) -> Vec<Point> {
    let mut out = Vec::new();
    for i in 0..r.len() {
        let (a, b) = (r[i], r[(i + 1) % r.len()]);
        let (da, db) = (a.x * n.x + a.y * n.y - d, b.x * n.x + b.y * n.y - d);
        if da >= 0.0 {
            out.push(a);
        }
        if (da >= 0.0) != (db >= 0.0) {
            let k = da / (da - db);
            out.push(Point { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k });
        }
    }
    clean(out)
}
/// Part of a convex ring with `lo <= p·axis <= hi`.
fn clip_band(r: &[Point], axis: Point, lo: f64, hi: f64) -> Vec<Point> {
    let a = clip_half(r, axis, lo);
    if a.len() < 3 {
        return a;
    }
    clip_half(&a, Point { x: -axis.x, y: -axis.y }, -hi)
}
fn perp(u: Point) -> Point {
    Point { x: -u.y, y: u.x }
}
/// Extent along `u` of the line `p·perp(u) = t` inside a convex ring.
fn chord(r: &[Point], u: Point, t: f64) -> Option<(f64, f64)> {
    let n = perp(u);
    let (mut s0, mut s1) = (f64::MAX, f64::MIN);
    for i in 0..r.len() {
        let (a, b) = (r[i], r[(i + 1) % r.len()]);
        let (ta, tb) = (a.x * n.x + a.y * n.y - t, b.x * n.x + b.y * n.y - t);
        if ta * tb <= 0.0 && (ta - tb).abs() > 1e-12 {
            let k = ta / (ta - tb);
            let p = Point { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k };
            let s = p.x * u.x + p.y * u.y;
            s0 = s0.min(s);
            s1 = s1.max(s);
        }
    }
    (s1 > s0).then_some((s0, s1))
}
fn at_st(u: Point, s: f64, t: f64) -> Point {
    Point { x: s * u.x - t * u.y, y: s * u.y + t * u.x }
}
fn ring_centroid(r: &[Point]) -> Point {
    super::geometry::centroid(&Shape { outer: r.to_vec(), holes: vec![] })
}
fn ring_json(r: &[Point]) -> Value {
    Value::Array(r.iter().map(|p| json!([round2(p.x), round2(p.y)])).collect())
}

struct Roof {
    kind: &'static str,
    rise: f64,
    ridges: Vec<Value>,
}
/// Roof of one convex volume: ridges strictly inside the ring, along axis `u`
/// (gable, hip, barrel, shed). `high` points to the shed's high side.
fn roof_of(ring: &[Point], mut kind: &'static str, mut pitch: f64, u: Point, high: Point) -> Roof {
    let flat = Roof { kind: "flat", rise: 0.0, ridges: vec![] };
    if kind == "flat" || ring.len() < 3 || reflex_count(ring) > 0 {
        return flat;
    }
    let area = ring_area(ring);
    let g = ring_centroid(ring);
    if matches!(kind, "pyramid" | "cone" | "tent" | "dome") {
        let Some(f) = min_frame(ring) else { return flat };
        let reach = f.half_w.max(f.half_l.min(f.half_w * 1.4));
        let rise = match kind {
            "dome" => f.half_w.min(f.half_l) * 0.9,
            "tent" => reach * pitch.max(30.0).to_radians().tan().min(0.75),
            _ => reach * pitch.to_radians().tan(),
        };
        return Roof { kind, rise, ridges: vec![seg(g, g)] };
    }
    let fr = frame_along(ring, u);
    if fr.half_l < 1e-6 {
        return flat;
    }
    let half = area / (4.0 * fr.half_l);
    if half < 1.4 && matches!(kind, "gable" | "hip" | "barrel") {
        kind = "shed";
        pitch = pitch.min(20.0);
    }
    let tan = pitch.to_radians().tan();
    let n = perp(u);
    let tg = g.x * n.x + g.y * n.y;
    let Some((s0, s1)) = chord(ring, u, tg) else { return flat };
    let e = 0.05;
    let ridge = |a: f64, b: f64, t: f64| {
        if b - a < 0.1 {
            let m = at_st(u, (a + b) / 2.0, t);
            seg(m, m)
        } else {
            seg(at_st(u, a, t), at_st(u, b, t))
        }
    };
    match kind {
        "gable" => Roof { kind, rise: half * tan, ridges: vec![ridge(s0 + e, s1 - e, tg)] },
        "barrel" => Roof { kind, rise: half * 0.8, ridges: vec![ridge(s0 + e, s1 - e, tg)] },
        "hip" => {
            let inset = half.min((s1 - s0) / 2.0 - e).max(e);
            Roof { kind, rise: half * tan, ridges: vec![ridge(s0 + inset, s1 - inset, tg)] }
        }
        _ => {
            let sign = if high.x * n.x + high.y * n.y >= 0.0 { 1.0 } else { -1.0 };
            let ts = ring.iter().map(|p| p.x * n.x + p.y * n.y);
            let ext = if sign > 0.0 { ts.fold(f64::MIN, f64::max) } else { ts.fold(f64::MAX, f64::min) };
            let full = s1 - s0;
            let mut r = None;
            for k in 0..8 {
                let t = ext - sign * (0.05 + k as f64 * 0.24 * half);
                if let Some((a, b)) = chord(ring, u, t) {
                    if b - a >= 0.5 * full {
                        r = Some(ridge(a + e, b - e, t));
                        break;
                    }
                }
            }
            Roof { kind: "shed", rise: 2.0 * half * tan, ridges: vec![r.unwrap_or_else(|| ridge(s0 + e, s1 - e, tg))] }
        }
    }
}

/// A long or large convex body splits along its ridge axis into volumes of
/// different heights (segments with a raised part or a cross-gable, or two
/// side strips); returns (ring, storey delta, ridge turned across).
fn split_body(ring: &[Point], u: Point, n: u32, kind: &str, rng: &mut Rng) -> Vec<(Vec<Point>, i32, bool)> {
    let single = || vec![(ring.to_vec(), 0, false)];
    if !matches!(kind, "gable" | "hip" | "flat") || reflex_count(ring) > 0 {
        return single();
    }
    let f = frame_along(ring, u);
    let (l, w) = (2.0 * f.half_l, 2.0 * f.half_w);
    let area = ring_area(ring);
    let s_lo = f.c.x * u.x + f.c.y * u.y - f.half_l;
    let nrm = perp(u);
    let t_lo = f.c.x * nrm.x + f.c.y * nrm.y - f.half_w;
    let long = l >= 15.0 || (area >= 150.0 && l >= 11.0);
    let mut out: Vec<(Vec<Point>, i32, bool)> = Vec::new();
    if long && rng.chance(0.85) {
        let cuts: Vec<f64> = if l >= 26.0 { vec![rng.range(0.28, 0.38), rng.range(0.62, 0.72)] } else { vec![rng.range(0.4, 0.6)] };
        let mut edges = vec![0.0];
        edges.extend(cuts);
        edges.push(1.0);
        let mut raised = false;
        for k in 0..edges.len() - 1 {
            let (a, b) = (s_lo + edges[k] * l, s_lo + edges[k + 1] * l);
            let part = clip_band(ring, u, a - 1e-9, b + 1e-9);
            let delta = if k == 0 {
                0
            } else if n <= 1 {
                i32::from(rng.chance(0.6))
            } else if rng.chance(0.5) {
                1
            } else {
                -1
            };
            raised |= delta != 0;
            let cross = kind != "flat" && (b - a) <= 1.5 * w && w >= 5.0 && rng.chance(0.5);
            out.push((part, delta, cross));
        }
        if !raised {
            if let Some(last) = out.last_mut() {
                last.1 = 1;
            }
        }
    } else if w >= 10.0 && area >= 110.0 && n >= 2 && rng.chance(0.5) {
        let cut = t_lo + w * rng.range(0.5, 0.62);
        out.push((clip_half(ring, nrm, cut), 0, false));
        out.push((clip_half(ring, Point { x: -nrm.x, y: -nrm.y }, -cut), -1, false));
    } else {
        return single();
    }
    if out.iter().any(|(p, _, _)| p.len() < 3 || ring_area(p) < 4.0) {
        return single();
    }
    out
}

struct Vol {
    ring: Vec<Point>,
    n: u32,
    eave: f64,
    roof: Roof,
    cover: &'static str,
    wall: &'static str,
    tone: f64,
    parapet: f64,
    features: Vec<Value>,
    overhang: f64,
    trim: &'static str,
    form: &'static str,
    /// Height (m) of the posts the body stands on.
    stilts: f64,
    /// Inhabitants' size against a human, for doors and windows.
    body: f64,
    /// Bottom of the volume above the building ground (m): an upper tier, a
    /// chimney or a dormer starts above the ground.
    base: f64,
    /// Stands on the volume under it (resolved once the lot's volumes stand).
    stack: bool,
    /// Ridge axis and the high side of a shed, for the composed roof.
    axis: Point,
    high: Point,
    /// The roof's true kind (`halfhip`, `gablet`, `gambrel`…); `roof.kind` is
    /// the plain kind a renderer without the pans falls back to.
    form_roof: &'static str,
    /// Roof pitch (degrees) the volume was raised with.
    pitch: f64,
    /// Eaves past the walls (m) when the mass rule sets them.
    eaves: Option<f64>,
    /// Composed roof (`forms::roof`): visible pans, and wall faces above the wall top.
    pans: Option<Vec<Vec<[f64; 3]>>>,
    gables: Vec<Vec<[f64; 3]>>,
    /// Small decorative volume (chimney, dormer, porch).
    minor: bool,
    /// `none` | `door` | "" (windows by storey).
    openings: &'static str,
}
fn faces_json(faces: &[Vec<[f64; 3]>]) -> Value {
    Value::Array(faces.iter().map(|f| Value::Array(f.iter().flat_map(|p| p.iter().map(|&c| json!(round2(c)))).collect())).collect())
}
impl Vol {
    /// Whether `forms::roof` composes this volume's roof: a pitched kind on a
    /// plain walled body (huts, tents, tree and pile houses keep their own).
    fn composes(&self) -> bool {
        super::forms::roof::composed(self.form_roof) && self.pans.is_none() && self.form.is_empty()
            && self.overhang == 0.0 && self.stilts == 0.0 && self.roof.rise > 0.05
    }
    /// Raises the whole volume by `d` metres (a stacked part on its support).
    fn lift(&mut self, d: f64) {
        if d <= 0.0 {
            return;
        }
        self.base += d;
        self.eave += d;
        for p in self.pans.iter_mut().flatten().chain(self.gables.iter_mut()).flatten() {
            p[2] += d;
        }
    }
    fn json(&self) -> Value {
        let mut v = json!({"ring":ring_json(&self.ring),"floors":self.n,"eave_m":round2(self.eave),"rise_m":round2(self.roof.rise),
            "roof":self.roof.kind,"ridges":self.roof.ridges,"cover":self.cover,"wall":self.wall,"tone":round2(self.tone)});
        if self.base > 0.0 {
            v["base_m"] = json!(round2(self.base));
        }
        if let Some(pans) = &self.pans {
            v["pans"] = faces_json(pans);
            if !self.gables.is_empty() {
                v["gables"] = faces_json(&self.gables);
            }
        }
        if self.form_roof != self.roof.kind {
            v["roof_form"] = json!(self.form_roof);
        }
        if self.minor {
            v["minor"] = json!(true);
        }
        if !self.openings.is_empty() {
            v["openings"] = json!(self.openings);
        }
        if self.parapet > 0.0 {
            v["parapet_m"] = json!(round2(self.parapet));
        }
        if self.overhang > 0.0 {
            v["overhang_m"] = json!(round2(self.overhang));
        }
        if !self.form.is_empty() && self.form != "stilt" {
            v["form"] = json!(self.form);
        }
        if self.stilts > 0.0 {
            v["stilts_m"] = json!(round2(self.stilts));
        }
        if !self.trim.is_empty() {
            v["trim"] = json!(self.trim);
        }
        if !self.features.is_empty() {
            v["features"] = Value::Array(self.features.clone());
        }
        if self.body > 0.0 {
            v["body_scale"] = json!(round2(self.body));
        }
        v
    }
}

/// Regional family of a culture for roof-top detail (`maghreb`, `levant`,
/// `persian`, `pueblo`, `meso`; empty: none), from its style traits.
fn flavor(culture: &str) -> &'static str {
    super::forms::kit::traits(culture).flavor.as_str()
}

/// Distance of `p` inside a convex ring (negative outside).
fn depth_in(ring: &[Point], p: Point) -> f64 {
    let sg = orient(ring);
    (0..ring.len())
        .map(|i| {
            let (a, b) = (ring[i], ring[(i + 1) % ring.len()]);
            sg * cross3(a, b, p) / (b.x - a.x).hypot(b.y - a.y).max(1e-9)
        })
        .fold(f64::MAX, f64::min)
}

/// Parapet height and roof-top features of a flat-roofed volume, from the
/// culture's family and the lot's own draw; features stand inside the parapet.
fn flat_details(ring: &[Point], label: &str, fl: &str, wall: &str, wealth: f64, landmark: bool, rng: &mut Rng) -> (f64, Vec<Value>) {
    if matches!(wall, "hide" | "bamboo" | "wattle") {
        return (0.0, vec![]);
    }
    let base = match fl { "maghreb" | "persian" => 0.9, "levant" => 0.8, "pueblo" => 0.35, _ => 0.6 };
    let parapet = (base * rng.range(0.85, 1.2)).min(1.1);
    let area = ring_area(ring);
    let Some(f) = min_frame(ring) else { return (parapet, vec![]) };
    if area < 14.0 || !matches!(label, "building" | "tower" | "keep" | "minaret" | "nave" | "hall" | "prayer-hall" | "cella" | "portico") {
        return (parapet, vec![]);
    }
    let dwelling = label == "building";
    let mut plan: Vec<(&str, f64, f64, f64)> = Vec::new();
    let r = (f.half_w * 0.55).clamp(1.4, 4.5);
    if label != "tower" && label != "minaret" && (landmark || label != "building") && !matches!(fl, "pueblo" | "meso") && area >= 40.0 {
        plan.push(("dome", 2.0 * r, 2.0 * r, 0.85 * r));
    } else if dwelling && area >= 40.0 && wealth > 0.6 && rng.chance(0.07) {
        plan.push(("dome", 2.0 * 1.6, 2.0 * 1.6, 1.4));
    }
    if dwelling && area >= 25.0 && rng.chance(0.5) {
        plan.push(("stair", rng.range(1.8, 2.3), rng.range(2.2, 2.8), rng.range(2.0, 2.4)));
    }
    if dwelling && fl == "persian" && area >= 30.0 {
        for _ in 0..(1 + u32::from(area > 80.0 && rng.chance(0.5))) {
            if rng.chance(0.55) {
                plan.push(("windcatcher", 1.5, 1.5, rng.range(3.0, 5.0)));
            }
        }
    }
    let mut out: Vec<Value> = Vec::new();
    let mut placed: Vec<(Point, f64)> = Vec::new();
    for (kind, w, d, h) in plan {
        let reach = (w * w + d * d).sqrt() / 2.0;
        let margin = parapet + 0.35;
        for _ in 0..14 {
            let s = rng.range(-f.half_l, f.half_l);
            let t = rng.range(-f.half_w, f.half_w);
            let c = at_st(f.u, s, t);
            let c = Point { x: f.c.x + c.x, y: f.c.y + c.y };
            let corners = [(w, d), (w, -d), (-w, d), (-w, -d)];
            let ok = corners.iter().all(|&(a, b)| {
                let o = at_st(f.u, a / 2.0, b / 2.0);
                depth_in(ring, Point { x: c.x + o.x, y: c.y + o.y }) >= margin
            }) && placed.iter().all(|&(q, rq)| (q.x - c.x).hypot(q.y - c.y) >= reach + rq + 0.5);
            if ok {
                placed.push((c, reach));
                out.push(json!({"kind":kind,"x":round2(c.x),"y":round2(c.y),"w":round2(w),"d":round2(d),"h":round2(h),"angle":round2(f.u.y.atan2(f.u.x))}));
                break;
            }
        }
    }
    (parapet, out)
}

/// Massing of every preview piece, aligned with `preview` (empty when none).
pub(super) fn massing(m: &Input) -> Value {
    if m.parts.is_empty() {
        return Value::Null;
    }
    let mut tr = tradition(m.arch, m.culture);
    let traits = super::forms::kit::traits(m.culture);
    let (metric_scale, form) = super::forms::kit::house_parameters(m.culture);
    // A culture may give its home form to a share of its lots only (elven
    // settlements mix tree dwellings and ordinary houses half and half).
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
            let tribal = tr.roof == "tent" || matches!(tr.form, "tree" | "mushroom" | "longhouse");
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
                    let mage = tr.form == "mage" && i == main && pi == 0 && si == 0 && (m.landmark || drng.chance((0.08 + 0.3 * size) * (0.3 + 0.7 * (1.25 - m.distance).clamp(0.0, 1.0))));
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
                    let (eave_v, overhang) = match (hut, roof.kind) {
                        (true, "tent") if tent && tr.form == "yurt" => (1.6, 0.2),
                        (true, "tent") if tent && tr.form == "tipi" => (0.1, 0.0),
                        (true, "tent") => (0.5, 0.3),
                        (true, _) => (base_eave(sn).min(2.2), 0.65),
                        _ => (base_eave(sn), 0.0),
                    };
                    let eave_v = match exterior {
                        "yurt" => 1.6,
                        "tipi" => 0.1,
                        "tree" => 11.5,
                        "mushroom" => 2.5 + 2.0 * drng.float(),
                        "longhouse" => 1.5,
                        "tower" => 9.0 + (6.0 + 22.0 * size) * drng.float(),
                        _ => eave_v,
                    };
                    let roof = if matches!(exterior, "tree" | "mushroom") { Roof { kind: "dome", rise: radius * if exterior == "tree" { 0.95 } else { 0.65 }, ..roof } }
                        else if hut && roof.kind == "cone" && !mage { Roof { rise: roof.rise * 1.12, ..roof } } else { roof };
                    // No thin tall sliver (a tower at most 4.5 × its
                    // width, any other body 2.5 ×); a pitched roof rises at most 0.6 ×
                    // its span, a house roof about its wall height at most.
                    let (sn, eave_v, roof) = if !matches!(exterior, "tree" | "mushroom" | "yurt" | "tipi" | "tower" | "longhouse") {
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
                        body,
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
                        eaves: rule.and_then(|r| r.overhang),
                        pans: None,
                        gables: vec![],
                        minor: rule.is_some_and(|r| r.minor),
                        openings: rule.and_then(|r| r.openings.as_deref()).unwrap_or(""),
                    };
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
                    Piece::Raw(v) => return v,
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
                json!({"floors":vols.iter().map(|v| v.n).max().unwrap_or(n),"eave_m":round2(t.eave),"rise_m":round2(t.roof.rise),
                    "roof":t.roof.kind,"ridges":t.roof.ridges,"cover":t.cover,"wall":t.wall,"tone":round2(lot_tone),
                    "volumes":vols.iter().enumerate().map(|(j, v)| {
                        let mut out = v.json();
                        let open = facade_openness(m.culture, v.wall);
                        if open < 1.0 { out["openness"] = json!(open); }
                        if v.form == "tree" { out["tree_seed"] = json!(format!("{}:tree:{}:{}", m.seed, i, j)); }
                        out
                    }).collect::<Vec<_>>()})
            })
            .collect(),
    )
}

/// One preview piece on its way to the display contract: an entry already
/// written (stepped terrace, ruin, court ring) or the volumes to finish.
enum Piece {
    Raw(Value),
    Vols(Vec<Vol>, u32),
}

/// Whether `p` lies inside ring `r` (even-odd).
fn within(r: &[Point], p: Point) -> bool {
    let mut inside = false;
    for i in 0..r.len() {
        let (a, b) = (r[i], r[(i + 1) % r.len()]);
        if (a.y > p.y) != (b.y > p.y) && p.x < a.x + (b.x - a.x) * (p.y - a.y) / (b.y - a.y) {
            inside = !inside;
        }
    }
    inside
}

/// A mass raised in receding tiers (`MassRule::tiers`): each tier stands on the
/// one below, its ring scaled about the centre; a skirt roof joins two tiers
/// (pagoda eaves); the last tier takes the mass's roof.
fn tiered(v: Vol, t: &'static super::forms::roles::Tiers, rng: &mut Rng) -> Vec<Vol> {
    let count = rng.int(t.count[0].max(1), t.count[1].max(t.count[0]).max(1)) as usize;
    let total = v.eave - v.base;
    if count <= 1 || total < 1.0 || v.ring.len() < 3 {
        return vec![v];
    }
    let c = ring_centroid(&v.ring);
    let first = if t.first > 0.0 { t.first.clamp(0.1, 0.9) } else { 1.0 / count as f64 };
    let rest = (1.0 - first) / (count - 1) as f64;
    let inset = t.inset.clamp(0.0, 0.6);
    let scaled = |k: f64| -> Vec<Point> { v.ring.iter().map(|p| Point { x: c.x + (p.x - c.x) * k, y: c.y + (p.y - c.y) * k }).collect() };
    let top_kind: &'static str = t.top.as_deref().unwrap_or(v.form_roof);
    let floors = (v.n / count as u32).max(1);
    let mut out = Vec::with_capacity(count);
    let (mut z, mut k) = (v.base, 1.0);
    for tier in 0..count {
        let h = total * if tier == 0 { first } else { rest };
        let ring = scaled(k);
        let last = tier + 1 == count;
        let (roof, form_roof, pans) = if last {
            let plain = super::forms::roof::plain(top_kind);
            let r = roof_of(&ring, plain, v.pitch, v.axis, v.high);
            let form = if r.kind == plain { top_kind } else { r.kind };
            (r, form, None)
        } else if let Some(s) = t.skirt.filter(|s| s.rise > 0.0) {
            let next = scaled(k * (1.0 - inset));
            let pans = super::forms::roof::skirt(&ring, &next, z + h - 0.35 * s.rise, z + h + 0.65 * s.rise, s.overhang);
            (Roof { kind: "hip", rise: 0.65 * s.rise, ridges: vec![] }, "hip", Some(pans))
        } else {
            (Roof { kind: "flat", rise: 0.0, ridges: vec![] }, "flat", None)
        };
        out.push(Vol {
            ring,
            n: floors,
            eave: z + h,
            roof,
            cover: v.cover,
            wall: v.wall,
            tone: v.tone,
            parapet: if last { v.parapet } else { 0.0 },
            features: vec![],
            overhang: 0.0,
            trim: v.trim,
            form: v.form,
            stilts: 0.0,
            body: v.body,
            base: z,
            stack: v.stack,
            axis: v.axis,
            high: v.high,
            form_roof,
            pitch: v.pitch,
            eaves: v.eaves,
            pans,
            gables: vec![],
            minor: v.minor,
            openings: v.openings,
        });
        z += h;
        k *= 1.0 - inset;
    }
    out
}

/// Chimney stacks and dormers of a complex home's main body `v` (`sc`: metres
/// to plan units): small volumes standing on its roof, drawn among the kit's
/// chances. Stacks stand on the ridge near an end; dormers on the slope that
/// faces the street.
fn home_details(v: &Vol, kit: &'static super::forms::kit::HouseKit, seed: &str, sc: f64, to_street: &dyn Fn(Point) -> Option<Point>) -> Vec<Vol> {
    let mut out = vec![];
    let f = frame_along(&v.ring, v.axis);
    if f.half_l < 1e-6 || f.half_w < 1e-6 {
        return out;
    }
    let nrm = perp(f.u);
    let at = |s: f64, t: f64| Point { x: f.c.x + f.u.x * s + nrm.x * t, y: f.c.y + f.u.y * s + nrm.y * t };
    let mass = super::forms::roof::Mass { ring: &v.ring, kind: v.form_roof, axis: v.axis, eave: v.eave, rise: v.roof.rise, overhang: 0.0, high: v.high };
    let small = |ring: Vec<Point>, base: f64, eave: f64, roof: Roof, form_roof: &'static str, axis: Point, cover: &'static str, wall: &'static str| Vol {
        ring, n: 1, eave, roof, cover, wall, tone: v.tone, parapet: 0.0, features: vec![], overhang: 0.0, trim: "", form: "", stilts: 0.0, body: v.body,
        base, stack: false, axis, high: nrm, form_roof, pitch: 40.0, eaves: None, pans: None, gables: vec![], minor: true, openings: "none",
    };
    let mut r = Rng::new(seed).fork("home-details");
    if r.chance(kit.chimney) && f.half_l > 2.0 * sc {
        let stack: &'static str = kit.stack.as_str();
        let count = 1 + usize::from(f.half_l > 6.0 * sc && r.chance(0.35));
        let first = if r.chance(0.5) { 1.0 } else { -1.0 };
        for k in 0..count {
            let side = if k == 0 { first } else { -first };
            let p = at(side * (f.half_l - r.range(0.9, 1.6) * sc), r.range(-0.25, 0.25) * f.half_w);
            let Some(z) = super::forms::roof::height_at(&mass, p) else { continue };
            let h = r.range(0.3, 0.42) * sc;
            let (du, dn) = (Point { x: f.u.x * h, y: f.u.y * h }, Point { x: nrm.x * h, y: nrm.y * h });
            let ring = vec![
                Point { x: p.x - du.x - dn.x, y: p.y - du.y - dn.y },
                Point { x: p.x + du.x - dn.x, y: p.y + du.y - dn.y },
                Point { x: p.x + du.x + dn.x, y: p.y + du.y + dn.y },
                Point { x: p.x - du.x + dn.x, y: p.y - du.y + dn.y },
            ];
            let top = v.eave + v.roof.rise + r.range(0.5, 1.0) * sc;
            out.push(small(ring, (z - 0.3 * sc).max(0.0), top, Roof { kind: "flat", rise: 0.0, ridges: vec![] }, "flat", f.u, stack, stack));
        }
    }
    let sloped = matches!(v.form_roof, "gable" | "halfhip" | "gablet" | "gambrel" | "mansard" | "hip");
    if sloped && r.chance(kit.dormer) && f.half_w >= 2.6 * sc && f.half_l >= 2.4 * sc && v.roof.rise >= 1.8 * sc {
        let street = to_street(f.c).map_or(1.0, |d| if d.x * nrm.x + d.y * nrm.y >= 0.0 { 1.0 } else { -1.0 });
        let count = ((2.0 * f.half_l / (3.4 * sc)).floor() as usize).clamp(1, 3);
        let wd = 1.3 * sc;
        let (front, depth) = (0.3 * f.half_w, (0.55 * f.half_w).min(2.6 * sc));
        let (ta, tb) = (street * (f.half_w - front), street * (f.half_w - front - depth));
        for k in 0..count {
            let s = 0.7 * ((k as f64 + 0.5) / count as f64 * 2.0 - 1.0) * f.half_l;
            let Some(z) = super::forms::roof::height_at(&mass, at(s, ta)) else { continue };
            let ring = vec![at(s - wd * 0.5, ta), at(s + wd * 0.5, ta), at(s + wd * 0.5, tb), at(s - wd * 0.5, tb)];
            out.push(small(ring, z, z + 0.95 * sc, Roof { kind: "gable", rise: 0.45 * wd, ridges: vec![] }, "gable", nrm, v.cover, v.wall));
        }
    }
    out
}

/// Activity look (activities.json `looks`) a specialised service lot's bodies take.
#[derive(Clone, Copy)]
struct LotLook {
    name: &'static str,
    roof: &'static str,
    pitch: f64,
    /// Main body's eave (m) and storeys; other bodies take the low end.
    eave: f64,
    floors: u32,
    eave_lo: f64,
    floors_lo: u32,
    chimney: bool,
    wheel: bool,
    sails: bool,
    stilts: f64,
}
fn lot_look(m: &Input, tr: &Tradition) -> Option<LotLook> {
    if m.archetype.is_empty() || tr.roof == "tent" || matches!(tr.form, "tree" | "mushroom" | "longhouse") { return None; }
    let a = super::activities::archetype(m.archetype)?;
    let (name, l) = super::activities::data().looks.get_key_value(a.look.as_deref()?)?;
    let mut r = Rng::new(m.seed).fork("look");
    let t = r.float();
    let roof = l.roof.get((r.float() * l.roof.len() as f64) as usize).or(l.roof.first())?.as_str();
    // A flat-roof tradition keeps its flat roofs on ordinary pitched looks.
    let roof = if tr.roof == "flat" && matches!(roof, "gable" | "hip" | "shed") { "flat" } else { roof };
    let has = |f: &str| l.features.iter().any(|x| x == f);
    Some(LotLook {
        name: name.as_str(),
        roof,
        pitch: match (name.as_str(), roof) { (_, "cone") => 55.0, ("barn", _) => 45.0, (_, "shed") => 20.0, _ => tr.pitch.clamp(30.0, 45.0) },
        eave: l.eave[0] + (l.eave[1] - l.eave[0]) * t,
        floors: (l.floors[0] as f64 + (l.floors[1] - l.floors[0]) as f64 * t).round() as u32,
        eave_lo: l.eave[0],
        floors_lo: l.floors[0],
        chimney: has("chimney"),
        wheel: has("wheel"),
        sails: has("sails"),
        stilts: if has("stilts") { 1.2 } else { 0.0 },
    })
}

/// Extra volumes of a look on the main body `v` (`sc` = metres to plan units):
/// a chimney stack through the roof (kiln, forge), a wheel against the wall
/// away from the street (water mill whose preview has no wheel piece).
fn activity_details(v: &Vol, l: LotLook, has_wheel: bool, fronts: &[[Point; 2]], sc: f64) -> Vec<Vol> {
    let Some(f) = min_frame(&v.ring) else { return vec![] };
    let n = perp(f.u);
    let rect = |c: Point, a: Point, ha: f64, hb: f64| -> Vec<Point> {
        let b = perp(a);
        [(-1.0, -1.0), (1.0, -1.0), (1.0, 1.0), (-1.0, 1.0)].iter()
            .map(|(s, t)| Point { x: c.x + a.x * ha * s + b.x * hb * t, y: c.y + a.y * ha * s + b.y * hb * t }).collect()
    };
    let part = |ring: Vec<Point>, eave: f64, wall: &'static str| Vol {
        ring, n: 1, eave, roof: Roof { kind: "flat", rise: 0.0, ridges: vec![] }, cover: v.cover, wall, tone: v.tone,
        parapet: 0.0, features: vec![], overhang: 0.0, trim: "", form: "", stilts: v.stilts, body: 0.0,
        base: 0.0, stack: false, axis: f.u, high: n, form_roof: "flat", pitch: 0.0, eaves: None, pans: None, gables: vec![], minor: false, openings: "",
    };
    let mut out = vec![];
    if l.chimney {
        let c = Point { x: f.c.x + f.u.x * f.half_l * 0.55, y: f.c.y + f.u.y * f.half_l * 0.55 };
        out.push(part(rect(c, f.u, 0.55 * sc, 0.55 * sc), v.eave + v.roof.rise + 1.2 * sc, "stone"));
    }
    if l.wheel && !has_wheel {
        // Away from the street: the side of the body whose normal points
        // farthest from the nearest frontage.
        let away = fronts.iter().map(|s| {
            let (dx, dy) = (s[1].x - s[0].x, s[1].y - s[0].y);
            let k = (((f.c.x - s[0].x) * dx + (f.c.y - s[0].y) * dy) / (dx * dx + dy * dy).max(1e-9)).clamp(0.0, 1.0);
            Point { x: f.c.x - s[0].x - k * dx, y: f.c.y - s[0].y - k * dy }
        }).min_by(|a, b| a.x.hypot(a.y).total_cmp(&b.x.hypot(b.y))).unwrap_or(n);
        let (a, h, other) = [(n, f.half_w, f.half_l), (f.u, f.half_l, f.half_w), (Point { x: -n.x, y: -n.y }, f.half_w, f.half_l), (Point { x: -f.u.x, y: -f.u.y }, f.half_l, f.half_w)]
            .into_iter().max_by(|p, q| (p.0.x * away.x + p.0.y * away.y).total_cmp(&(q.0.x * away.x + q.0.y * away.y))).unwrap();
        let c = Point { x: f.c.x + a.x * (h + 0.45 * sc), y: f.c.y + a.y * (h + 0.45 * sc) };
        out.push(part(rect(c, a, 0.35 * sc, (2.0 * sc).min(0.8 * other)), 4.2 * sc, "wood"));
    }
    out
}

/// Four crossed blades on the cap of a round tower (wind mill): a roof feature
/// `{kind:"sails", x, y, w: blade length, d: blade width, h: hub height above the
/// eave, angle: facing, turn: rotation of the cross}`, the hub standing just
/// out of the cone on the side the lot's draw faces.
fn sails_feature(v: &Vol, seed: &str) -> Option<Value> {
    if v.roof.kind != "cone" || v.roof.rise <= 0.5 {
        return None;
    }
    let f = min_frame(&v.ring)?;
    let mut r = Rng::new(seed).fork("sails");
    let angle = r.float() * std::f64::consts::TAU;
    let turn = r.range(0.0, std::f64::consts::FRAC_PI_2);
    let up = v.roof.rise * 0.55;
    let hub = v.eave + up;
    let out = f.half_l.max(f.half_w) * 0.45 + 0.5;
    let len = (hub * 0.8).min(f.half_l.max(f.half_w) * 3.2);
    Some(json!({"kind":"sails","x":round2(f.c.x + angle.cos() * out),"y":round2(f.c.y + angle.sin() * out),
        "w":round2(len),"d":round2(len * 0.2),"h":round2(up),"angle":round2(angle),"turn":round2(turn)}))
}

#[cfg(test)]
mod tests {
    use super::*;
    fn rect(x0: f64, y0: f64, x1: f64, y1: f64) -> Shape {
        super::super::geometry::rectangle(x0, y0, x1, y1)
    }
    fn input<'a>(parts: &'a [(Shape, &'static str)], arch: &'a Value, fronts: &'a [[Point; 2]], seed: &'a str) -> Input<'a> {
        Input { parts, arch, culture: "european-organic", zone: "core", role: "dwelling.row", function: "domestic",
            landmark: false, wealth: 0.5, pressure: 0.8, small_home: false, population: 0, fronts, seed, low_rural: true, distance: 0.0, archetype: "", complex: false }
    }

    /// A complex home: the wing takes its rule, the roofs are composed (the
    /// wing's pans run into the body) and every volume carries explicit pans.
    /// The same parts in simple mode keep the plain contract.
    #[test]
    fn a_complex_home_composes_its_roofs_and_a_simple_one_keeps_the_plain_contract() {
        let parts = [(rect(0.0, 0.0, 12.0, 6.0), "building"), (rect(1.0, 6.0, 5.5, 12.0), "wing")];
        let arch = json!({"typology":"stone-house","roof":"gable","storeys":[2,2],"material":"stone"});
        let fronts = [[Point { x: 0.0, y: 0.0 }, Point { x: 12.0, y: 0.0 }]];
        let simple = massing(&Input { zone: "village", ..input(&parts, &arch, &fronts, "home") });
        let volumes = |m: &Value| -> Vec<Value> { m.as_array().unwrap().iter().flat_map(|p| p["volumes"].as_array().cloned().unwrap_or_default()).collect() };
        assert!(volumes(&simple).iter().all(|v| v.get("pans").is_none() && v.get("base_m").is_none()));
        let complex = massing(&Input { zone: "village", complex: true, ..input(&parts, &arch, &fronts, "home") });
        let vols = volumes(&complex);
        let pitched: Vec<&Value> = vols.iter().filter(|v| v["roof"] != "flat").collect();
        assert!(pitched.len() >= 2 && pitched.iter().all(|v| v["pans"].as_array().is_some_and(|p| !p.is_empty())), "{complex}");
        // The wing's roof reaches inside the body (y < 6): a valley, not a gable wall on the body's eave.
        let wing = complex[1]["volumes"][0]["pans"].as_array().unwrap();
        assert!(wing.iter().any(|pan| pan.as_array().unwrap().chunks(3).any(|p| p[1].as_f64().unwrap() < 5.5)), "{wing:?}");
        // Deterministic.
        assert_eq!(complex, massing(&Input { zone: "village", complex: true, ..input(&parts, &arch, &fronts, "home") }));
    }

    #[test]
    fn stepped_landmark_heights_follow_nested_terraces() {
        let terrace = |outer: f64, inner: f64| Shape {
            outer: rect(-outer, -outer, outer, outer).outer,
            holes: vec![rect(-inner, -inner, inner, inner).outer],
        };
        // Deliberately shuffled: preview order must not determine tier height.
        let parts = [(terrace(6.0, 3.0), "terrace"), (rect(-3.0, -3.0, 3.0, 3.0), "shrine"),
            (terrace(12.0, 9.0), "terrace"), (terrace(9.0, 6.0), "terrace")];
        let arch = json!({"roof":"thatch-round","storeys":[1,1],"material":"thatch"});
        let m = massing(&Input { culture: "maya", role: "worship.pyramid-precinct", function: "religious", landmark: true,
            ..input(&parts, &arch, &[], "stepped") });
        let heights: Vec<f64> = m.as_array().unwrap().iter().map(|p| {
            assert_eq!(p["roof"], "flat");
            assert_eq!(p["rise_m"], 0.0);
            assert_eq!(p["cover"], "stone");
            assert_eq!(p["openings"], "none");
            p["eave_m"].as_f64().unwrap()
        }).collect();
        assert_eq!(heights, vec![9.0, 12.0, 3.0, 6.0]);
    }

    /// A river mill draws a water gristmill (an inca one never a water or
    /// wind mill); its massing has a wheel against the rear wall, a smithy a
    /// chimney through its roof, a raised granary stilts.
    #[test]
    fn activity_archetypes_choose_by_context_and_shape_the_massing() {
        use super::super::activities::{pick, LotContext};
        let river = LotContext { river: true, shore: false, open: false };
        for s in ["a", "b", "c", "d"] {
            assert_eq!(pick("craft.mill", "european-organic", river, s), Some("water_gristmill"));
            for ctx in [river, LotContext { open: true, ..river }, LotContext::default()] {
                let id = pick("craft.mill", "inca", ctx, s).unwrap();
                assert!(!id.starts_with("water") && !id.starts_with("wind"), "inca {id}");
            }
        }
        assert_eq!(pick("craft.mill", "european-organic", LotContext { river: false, shore: false, open: true }, "a"), Some("wind_gristmill"));
        let parts = [(rect(0.0, 0.0, 10.0, 12.0), "building")];
        let arch = json!({"roof":"gable","storeys":[2,4],"material":"timber"});
        let fronts = [[Point { x: 0.0, y: 0.0 }, Point { x: 10.0, y: 0.0 }]];
        let vols = |a: &'static str| {
            let m = massing(&Input { archetype: a, role: "craft.mill", function: "workshop", ..input(&parts, &arch, &fronts, "a") });
            m[0]["volumes"].as_array().unwrap().clone()
        };
        let mill = vols("water_gristmill");
        let wheel = mill.iter().find(|v| v["wall"] == "wood" && v["roof"] == "flat").expect("wheel");
        assert!(wheel["ring"].as_array().unwrap().iter().all(|p| p[1].as_f64().unwrap() > 11.9), "wheel behind: {wheel}");
        let smithy = vols("smithy");
        let top = |v: &Value| v["eave_m"].as_f64().unwrap() + v["rise_m"].as_f64().unwrap();
        let chimney = smithy.last().unwrap();
        assert!(chimney["wall"] == "stone" && top(chimney) > top(&smithy[0]), "{smithy:?}");
        assert!(vols("granary_raised")[0]["stilts_m"].as_f64().unwrap() > 0.5);
        assert_eq!(vols("wind_gristmill")[0]["roof"], "cone");
        let sails = &vols("wind_gristmill")[0]["features"][0];
        assert!(sails["kind"] == "sails" && sails["w"].as_f64().unwrap() > 2.0 && sails["h"].as_f64().unwrap() > 0.5, "{sails}");
        assert!(vols("water_gristmill").iter().all(|v| v.get("features").is_none()));
        assert!(vols("").iter().all(|v| v["wall"] != "wood" || v["roof"] != "flat"));
    }

    #[test]
    fn gabled_row_house_turns_its_gable_to_the_street() {
        // 7 m frontage on y = 0, 14 m deep: gable to street → ridge along y.
        let parts = [(rect(0.0, 0.0, 7.0, 14.0), "building")];
        let arch = json!({"roof":"gable","typology":"gabled-row-house","storeys":[2,4],"material":"timber"});
        let fronts = [[Point { x: 0.0, y: 0.0 }, Point { x: 7.0, y: 0.0 }]];
        let m = massing(&input(&parts, &arch, &fronts, "a"));
        let r = &m[0]["ridges"][0];
        let (dx, dy) = (r[2].as_f64().unwrap() - r[0].as_f64().unwrap(), r[3].as_f64().unwrap() - r[1].as_f64().unwrap());
        assert!(dy.abs() > 6.0 && dx.abs() < 0.5, "{m}");
        let floors = m[0]["floors"].as_u64().unwrap();
        assert!((2..=4).contains(&floors), "{m}");
    }

    #[test]
    fn giant_storeys_use_the_house_metric_scale() {
        let parts = [(rect(0.0, 0.0, 10.0, 8.0), "building")];
        let arch = json!({"roof":"gable","storeys":[1,1],"material":"stone"});
        let mut i = input(&parts, &arch, &[], "giant-scale");
        let human = massing(&i);
        i.culture = "giant-hold";
        let giant = massing(&i);
        assert_eq!(giant[0]["eave_m"].as_f64().unwrap(), human[0]["eave_m"].as_f64().unwrap() * 2.5);
        assert_eq!(giant[0]["roof"], "flat", "{giant}");
        let recipe = json!({"roof":"gable","storeys":[3,4],"material":"timber"});
        i.arch = &recipe;
        let tall = massing(&i);
        assert_eq!(tall[0]["eave_m"], giant[0]["eave_m"], "giant houses keep one storey whatever the recipe: {tall}");
    }

    #[test]
    fn culture_house_forms_have_physical_heights_and_roof_plans() {
        let mut fixtures = vec![];
        for (culture, form, w, d) in [
            ("elven", "tree", 14.0, 14.0), ("myconid-colony", "mushroom", 10.0, 10.0),
            ("mongol-ordu", "yurt", 7.0, 7.0), ("native-iroquoian", "longhouse", 40.0, 6.5),
            ("tibetan-monastery", "battered", 14.0, 10.0), ("merfolk-tidal", "", 10.0, 8.0),
            ("giant-hold", "", 40.0, 24.0), ("wizard-city", "", 10.0, 8.0),
        ] {
            let arch = super::super::catalogue()["presets"][format!("{culture}/village")]["params"]["arch"].clone();
            let parts = [(rect(0.0, 0.0, w, d), "building")];
            let fronts = [[Point { x: 0.0, y: 0.0 }, Point { x: w, y: 0.0 }]];
            let mut i = input(&parts, &arch, &fronts, "houses-review");
            i.culture = culture;
            if culture == "wizard-city" { i.landmark = true; }
            let m = massing(&i);
            for v in m[0]["volumes"].as_array().unwrap() {
                assert!(v["eave_m"].as_f64().unwrap() > 0.0, "{culture}: {m}");
                if !form.is_empty() && culture != "elven" { assert_eq!(v["form"], form, "{culture}: {m}"); }
            }
            if form == "mushroom" { assert_eq!(m[0]["roof"], "dome"); }
            if form == "longhouse" {
                assert_eq!(m[0]["roof"], "barrel");
                assert_eq!(m[0]["eave_m"], 1.5);
                let r = &m[0]["ridges"][0];
                assert!((r[2].as_f64().unwrap() - r[0].as_f64().unwrap()).abs() > 39.0);
            }
            // Light pile houses: posts of 1.6–2.2 m.
            if culture == "merfolk-tidal" { assert!((1.6..=2.2).contains(&m[0]["volumes"][0]["stilts_m"].as_f64().unwrap())); }
            fixtures.push(json!({"culture":culture,"footprint":[parts[0].0],"massing":m}));
        }
        if let Ok(path) = std::env::var("HOUSES_MASSING_OUT") { std::fs::write(path, serde_json::to_vec(&fixtures).unwrap()).unwrap(); }
    }

    #[test]
    fn elven_settlements_mix_tree_and_ordinary_houses() {
        let parts = [(rect(0.0, 0.0, 14.0, 14.0), "building")];
        let arch = json!({"roof":"gable","storeys":[1,2],"material":"wood"});
        let trees = (0..100).filter(|k| {
            let seed = format!("elf-{k}");
            let mut i = input(&parts, &arch, &[], &seed); i.culture = "elven";
            massing(&i)[0]["volumes"].as_array().unwrap().iter().any(|v| v["form"] == "tree")
        }).count();
        assert!((35..=65).contains(&trees), "{trees} tree dwellings / 100 homes");
    }

    #[test]
    fn mage_towers_are_a_frequent_varied_culture_feature() {
        let parts = [(rect(0.0, 0.0, 10.0, 8.0), "building")];
        let arch = json!({"roof":"hip","storeys":[2,4],"material":"stone"});
        let mut heights = vec![];
        for k in 0..100 {
            let seed = format!("mage-{k}");
            let mut i = input(&parts, &arch, &[], &seed); i.culture = "wizard-city";
            let m = massing(&i);
            for v in m[0]["volumes"].as_array().unwrap() {
                if v["form"] == "tower" {
                    assert_eq!(v["roof"], "cone"); heights.push(v["eave_m"].as_f64().unwrap());
                }
            }
        }
        assert!(heights.len() >= 20 && heights.len() <= 55, "{} towers / 100 homes", heights.len());
        assert!(heights.iter().copied().fold(f64::MIN, f64::max) - heights.iter().copied().fold(f64::MAX, f64::min) > 10.0);
    }

    #[test]
    fn rear_annex_is_lower_than_the_street_body() {
        let parts = [(rect(0.0, 0.0, 8.0, 10.0), "building"), (rect(2.0, 10.0, 6.0, 15.0), "building")];
        let arch = json!({"roof":"gable","typology":"gabled-row-house","storeys":[3,4],"material":"timber"});
        let fronts = [[Point { x: 0.0, y: 0.0 }, Point { x: 8.0, y: 0.0 }]];
        for seed in ["a", "b", "c", "d"] {
            let m = massing(&input(&parts, &arch, &fronts, seed));
            assert!(m[1]["eave_m"].as_f64() < m[0]["eave_m"].as_f64(), "{m}");
            assert_eq!(m[1]["roof"], "shed", "{m}");
        }
    }

    #[test]
    fn village_homes_are_low_even_in_a_multi_storey_tradition() {
        let parts = [(rect(0.0, 0.0, 7.0, 10.0), "building")];
        let arch = json!({"roof":"gable","typology":"giebelhaus","storeys":[3,5],"material":"timber"});
        let fronts = [[Point { x: 0.0, y: 0.0 }, Point { x: 7.0, y: 0.0 }]];
        let (mut high, mut tall) = (0, 0);
        for k in 0..200 {
            let seed = format!("village-{k}");
            let mut i = input(&parts, &arch, &fronts, &seed);
            i.zone = "village"; i.population = 500; i.pressure = 0.3;
            let f = massing(&i)[0]["floors"].as_u64().unwrap();
            assert!(f <= 3, "{f}");
            high += (f >= 2) as u32; tall += (f == 3) as u32;
            i.zone = "core"; i.population = 50_000;
            assert!(massing(&i)[0]["floors"].as_u64().unwrap() >= 3);
        }
        assert!(high < 90 && tall < 30, "{high} {tall}");
        // `lowRuralHouses` off: the tradition's own range (3–4 floors here).
        for k in 0..50 {
            let seed = format!("village-{k}");
            let mut i = input(&parts, &arch, &fronts, &seed);
            i.zone = "village"; i.population = 500; i.pressure = 0.3; i.low_rural = false;
            assert!(massing(&i)[0]["floors"].as_u64().unwrap() >= 2);
        }
    }

    #[test]
    fn small_homes_follow_distance_and_poverty_without_changing_the_core() {
        let parts = [(rect(0.0, 0.0, 24.0, 12.0), "building")];
        let arch = json!({"roof":"gable","storeys":[2,4],"material":"timber"});
        let share = |zone: &str, district: &str, wealth: f64, distance: f64, outside: bool, farm: bool| {
            let mut single = 0;
            for k in 0..1000 {
                let seed = format!("houses2-{k}");
                let mut m = input(&parts, &arch, &[], &seed);
                m.zone = zone; m.wealth = wealth; m.pressure = 0.5;
                let old = massing(&m);
                let area = super::super::house_mix::HomeContext {
                    zone, district, wealth, pressure:m.pressure, distance, outside, farm, low_rural: true,
                }.area_scale(&seed);
                m.small_home = area < 1.0;
                let new = massing(&m);
                assert_eq!(new, massing(&m), "deterministic per lot");
                if m.small_home {
                    assert_eq!(new[0]["floors"], 1, "no raised section: {new}");
                    assert!(volumes_of(&new, 0).iter().all(|v| v["floors"] == 1));
                    assert!((if zone == "middle" && !outside && !farm { 0.88..=0.93 } else { 0.7..=1.0 }).contains(&area));
                } else { assert_eq!(old, new, "unselected lots keep every original draw"); }
                single += usize::from(new[0]["floors"] == 1);
            }
            single as f64 / 1000.0
        };
        let core = share("core", "poor", 0.1, 2.0, true, true);
        let middle = share("middle", "commoner", 0.5, 0.4, false, false);
        let poor = share("middle", "poor", 0.25, 0.4, false, false);
        let low_wealth = share("middle", "commoner", 0.25, 0.4, false, false);
        let near = share("edge", "commoner", 0.5, 0.55, false, false);
        let far = share("edge", "commoner", 0.5, 1.0, false, false);
        // A town-centre middle lot is rarely a one-storey house (a lowered
        // storey range there is a gradual draw, not a rule).
        assert_eq!(core, 0.0); assert!(middle < 0.02, "middle: {middle}");
        assert!((0.45..=0.58).contains(&poor), "poor: {poor}");
        assert_eq!(poor, low_wealth);
        assert!(near > middle && far > near && far > poor, "{middle} {near} {far} {poor}");
        for (zone, district, outside, farm) in [
            ("faubourg", "commoner", false, false),
            ("middle", "commoner", true, false), ("middle", "commoner", false, true),
            ("edge", "gardens", false, false), ("edge", "poor", true, false),
        ] {
            let fringe = share(zone, district, 0.5, 1.0, outside, farm);
            // The height gradient lowers a further share of town lots (low houses in the core too).
            assert!((0.6..=0.8).contains(&fringe), "{zone}/{district}: {fringe}");
        }
        // The countryside is small houses: more of them shrink than at the fringe.
        let village = share("village", "commoner", 0.5, 1.0, false, false);
        // (and the height gradient keeps a village at one or two storeys).
        assert!((0.7..=0.95).contains(&village), "village: {village}");
        eprintln!("houses2 single-storey shares: core={core:.3}, middle={middle:.3}, near={near:.3}, fringe={far:.3}, poor={poor:.3}");
    }

    #[test]
    fn small_home_selection_preserves_landmarks_towers_and_cultural_forms() {
        let parts = [(rect(0.0, 0.0, 24.0, 12.0), "building")];
        let arch = json!({"roof":"gable","storeys":[2,4],"material":"timber"});
        for culture in ["giant-hold", "mongol-ordu", "native-iroquoian", "myconid-colony", "wizard-city", "hadhrami-tower"] {
            let mut m = input(&parts, &Value::Null, &[], "protected");
            m.zone = "faubourg"; m.culture = culture;
            let old = massing(&m); m.small_home = true;
            assert_eq!(old, massing(&m), "{culture}");
            if culture == "giant-hold" {
                assert_eq!(old[0]["floors"], 1);
                assert_eq!(old[0]["roof"], "flat");
            }
        }
        for k in 0..100 {
            let seed = format!("elf-{k}");
            let mut m = input(&parts, &arch, &[], &seed);
            m.zone = "faubourg"; m.culture = "elven";
            let old = massing(&m); m.small_home = true;
            let new = massing(&m);
            let trees = |v: &Value| volumes_of(v, 0).iter().filter(|v| v["form"] == "tree").count();
            assert_eq!(trees(&old), trees(&new));
            if trees(&old) > 0 { assert_eq!(old, new); }
        }
        let tower = [(parts[0].0.clone(), "tower")];
        for (zone, landmark, parts) in [("core", false, parts.as_slice()), ("faubourg", true, parts.as_slice()), ("faubourg", false, tower.as_slice())] {
            let mut m = input(parts, &arch, &[], "protected"); m.zone = zone; m.landmark = landmark;
            let old = massing(&m); m.small_home = true;
            assert_eq!(old, massing(&m));
        }
    }

    #[test]
    fn core_is_taller_than_edge_on_average() {
        let parts = [(rect(0.0, 0.0, 8.0, 12.0), "building")];
        let arch = json!({"roof":"gable","storeys":[1,5],"material":"brick"});
        let fronts = [[Point { x: 0.0, y: 0.0 }, Point { x: 8.0, y: 0.0 }]];
        let mean = |zone: &'static str, pressure: f64| {
            (0..64).map(|i| {
                let seed = format!("s{i}");
                let mut m = input(&parts, &arch, &fronts, &seed);
                m.zone = zone;
                m.pressure = pressure;
                massing(&m)[0]["floors"].as_f64().unwrap()
            }).sum::<f64>() / 64.0
        };
        assert!(mean("core", 0.9) > mean("edge", 0.2) + 1.0);
    }

    #[test]
    fn courtyard_body_gets_a_ring_roof_and_towers_stand_out() {
        let mut court = rect(0.0, 0.0, 20.0, 20.0);
        court.holes.push(rect(6.0, 6.0, 14.0, 14.0).outer);
        let parts = [(court, "building"), (rect(22.0, 0.0, 27.0, 5.0), "tower")];
        let arch = json!({"roof":"tiled-hip","storeys":[1,2],"material":"brick"});
        let fronts = [[Point { x: 0.0, y: 0.0 }, Point { x: 20.0, y: 0.0 }]];
        let m = massing(&input(&parts, &arch, &fronts, "x"));
        assert_eq!(m[0]["roof"], "ring", "{m}");
        assert_eq!(m[1]["roof"], "pyramid", "{m}");
        assert!(m[1]["eave_m"].as_f64() > m[0]["eave_m"].as_f64(), "{m}");
    }

    fn shape(pts: &[(f64, f64)]) -> Shape {
        Shape { outer: pts.iter().map(|&(x, y)| Point { x, y }).collect(), holes: vec![] }
    }
    fn volumes_of(m: &Value, k: usize) -> Vec<Value> {
        m[k]["volumes"].as_array().cloned().unwrap_or_default()
    }
    fn ring_of(v: &Value) -> Shape {
        Shape {
            outer: v["ring"].as_array().unwrap().iter().map(|p| Point { x: p[0].as_f64().unwrap(), y: p[1].as_f64().unwrap() }).collect(),
            holes: vec![],
        }
    }
    fn check_volumes(piece: &Shape, m: &Value, k: usize) {
        let vols = volumes_of(m, k);
        assert!(!vols.is_empty(), "{m}");
        let pa = super::super::geometry::area(piece);
        let mut sum = 0.0;
        for v in &vols {
            let r = ring_of(v);
            let a = super::super::geometry::area(&r);
            sum += a;
            let inside: f64 = super::super::geometry::intersection(piece, &r).iter().map(super::super::geometry::area).sum();
            assert!((inside - a).abs() < 0.03 * a + 0.05, "volume leaves the piece: {v}");
            if v["roof"] != "flat" {
                assert_eq!(reflex_count(&r.outer), 0, "pitched volume not convex: {v}");
            }
            for rg in v["ridges"].as_array().unwrap() {
                for (x, y) in [(0, 1), (2, 3)] {
                    let p = Point { x: rg[x].as_f64().unwrap(), y: rg[y].as_f64().unwrap() };
                    assert!(super::super::geometry::contains(&r, p), "ridge outside ring: {v}");
                }
            }
        }
        assert!((sum - pa).abs() < 0.03 * pa + 0.1, "volumes do not partition the piece: {sum} vs {pa}");
    }

    #[test]
    fn volumes_partition_irregular_pieces_with_inside_ridges() {
        let arch = json!({"roof":"gable","storeys":[2,4],"material":"timber"});
        let fronts = [[Point { x: 0.0, y: 0.0 }, Point { x: 10.0, y: 0.0 }]];
        let pieces = [
            shape(&[(0.0, 0.0), (10.0, 0.0), (10.0, 5.0), (5.0, 5.0), (5.0, 12.0), (0.0, 12.0)]),
            shape(&[(0.0, 0.0), (14.0, 0.0), (12.0, 9.0), (2.0, 7.0)]),
            shape(&[(0.0, 0.0), (22.0, 0.0), (22.0, 9.0), (0.0, 9.0)]),
            shape(&[(0.0, 0.0), (30.0, 0.0), (30.0, 6.0), (18.0, 6.0), (18.0, 14.0), (12.0, 14.0), (12.0, 6.0), (0.0, 6.0)]),
            shape(&[(0.0, 0.0), (12.0, 3.0), (9.0, 14.0), (-2.0, 10.0)]),
            shape(&[(0.0, 0.0), (9.0, 0.0), (9.0, 12.0), (6.0, 12.0), (6.0, 4.0), (3.0, 4.0), (3.0, 12.0), (0.0, 12.0)]),
        ];
        for (k, p) in pieces.iter().enumerate() {
            for seed in ["a", "b", "c", "d", "e", "f"] {
                let parts = [(p.clone(), "building")];
                let m = massing(&input(&parts, &arch, &fronts, seed));
                check_volumes(p, &m, 0);
                if k == 0 || k == 3 || k == 5 {
                    assert!(volumes_of(&m, 0).len() >= 2, "non-convex piece {k} gave one volume: {m}");
                }
            }
        }
    }

    #[test]
    fn massing_is_deterministic_per_seed() {
        let parts = [(rect(0.0, 0.0, 20.0, 10.0), "building"), (rect(2.0, 10.0, 8.0, 16.0), "building")];
        let arch = json!({"roof":"gable","storeys":[2,4],"material":"brick"});
        let fronts = [[Point { x: 0.0, y: 0.0 }, Point { x: 20.0, y: 0.0 }]];
        assert_eq!(massing(&input(&parts, &arch, &fronts, "z")), massing(&input(&parts, &arch, &fronts, "z")));
    }

    #[test]
    fn european_sample_mixes_roofs_and_eave_heights() {
        let arch = json!({"roof":"gable","storeys":[2,4],"material":"timber"});
        let fronts = [[Point { x: 0.0, y: 0.0 }, Point { x: 18.0, y: 0.0 }]];
        let parts = [(rect(0.0, 0.0, 18.0, 11.0), "building")];
        let (mut roofs, mut eaves) = (std::collections::BTreeSet::new(), std::collections::BTreeSet::new());
        for i in 0..24 {
            let seed = format!("eu{i}");
            let m = massing(&input(&parts, &arch, &fronts, &seed));
            for v in volumes_of(&m, 0) {
                roofs.insert(v["roof"].as_str().unwrap().to_string());
                eaves.insert((v["eave_m"].as_f64().unwrap() * 10.0) as i64);
            }
        }
        assert!(roofs.len() >= 2 && eaves.len() >= 3, "{roofs:?} {eaves:?}");
    }

    #[test]
    fn mongol_ordu_lives_in_felt_tents() {
        let parts = [(rect(0.0, 0.0, 6.0, 6.0), "building")];
        let fronts = [[Point { x: 0.0, y: 0.0 }, Point { x: 6.0, y: 0.0 }]];
        let mut i = input(&parts, &Value::Null, &fronts, "k");
        i.culture = "mongol-ordu";
        let m = massing(&i);
        assert_eq!(m[0]["roof"], "tent", "{m}");
        assert_eq!(m[0]["cover"], "felt", "{m}");
        let arch = json!({"roof":"conical","typology":"tipi","storeys":[1,1],"material":"hide"});
        let m = massing(&input(&parts, &arch, &fronts, "k"));
        assert_eq!((m[0]["roof"].as_str(), m[0]["cover"].as_str(), m[0]["wall"].as_str()), (Some("tent"), Some("hide"), Some("hide")), "{m}");
    }

    #[test]
    fn yurts_tipis_and_stilt_houses_read_as_themselves() {
        let parts = [(rect(0.0, 0.0, 6.0, 6.0), "building")];
        let fronts = [[Point { x: 0.0, y: 0.0 }, Point { x: 6.0, y: 0.0 }]];
        let vol = |arch: &Value| massing(&input(&parts, arch, &fronts, "k"))[0]["volumes"][0].clone();
        let yurt = vol(&json!({"roof":"dome","typology":"ger","storeys":[1,1],"material":"felt"}));
        assert_eq!((yurt["form"].as_str(), yurt["roof"].as_str(), yurt["eave_m"].as_f64()), (Some("yurt"), Some("tent"), Some(1.6)), "{yurt}");
        assert!(yurt["rise_m"].as_f64().unwrap() < 1.6, "{yurt}");
        let tipi = vol(&json!({"roof":"conical","typology":"tipi","storeys":[1,1],"material":"hide"}));
        assert_eq!(tipi["form"], "tipi", "{tipi}");
        assert!(tipi["rise_m"].as_f64().unwrap() > 4.0 && tipi["eave_m"].as_f64().unwrap() < 0.3, "{tipi}");
        let stilt = vol(&json!({"roof":"thatch-round","typology":"stilt-house","storeys":[1,1],"material":"thatch"}));
        assert!(stilt["stilts_m"].as_f64().unwrap() >= 1.8, "{stilt}");
        // A landmark of a tent people is a tent, not a stone nave.
        let church = [(rect(0.0, 0.0, 8.0, 14.0), "nave"), (rect(0.0, 14.0, 5.0, 19.0), "tower")];
        let tipi_arch = json!({"roof":"conical","typology":"tipi","storeys":[1,1],"material":"hide"});
        let mut i = input(&church, &tipi_arch, &fronts, "k");
        i.landmark = true;
        for m in massing(&i).as_array().unwrap() { assert_eq!(m["roof"], "tent", "{m}"); }
    }

    #[test]
    fn medina_flat_roofs_get_parapets_and_inner_features() {
        let parts = [(rect(0.0, 0.0, 12.0, 10.0), "building")];
        let fronts = [[Point { x: 0.0, y: 0.0 }, Point { x: 12.0, y: 0.0 }]];
        let arch = json!({"roof":"flat","storeys":[1,2],"material":"adobe"});
        let (mut seen, mut kinds) = (0, std::collections::BTreeSet::new());
        for k in 0..40 {
            let seed = format!("m{k}");
            let mut i = input(&parts, &arch, &fronts, &seed);
            i.culture = "persian";
            let m = massing(&i);
            for v in volumes_of(&m, 0) {
                assert!(v["parapet_m"].as_f64().unwrap() >= 0.5, "{v}");
                let ring = ring_of(&v);
                for f in v["features"].as_array().into_iter().flatten() {
                    let p = Point { x: f["x"].as_f64().unwrap(), y: f["y"].as_f64().unwrap() };
                    assert!(depth_in(&ring.outer, p) > 1.0, "{f} outside {v}");
                    kinds.insert(f["kind"].as_str().unwrap().to_string());
                    seen += 1;
                }
            }
        }
        assert!(seen > 0 && kinds.contains("stair") && kinds.contains("windcatcher"), "{kinds:?}");
    }
}
