//! Building massing from the city's occupation preview: every preview piece
//! (street body, rear wing, court range, nave, tower…) gets its own floors,
//! eave height and roof (kind, pitch, ridge), so the displayed building is the
//! planned silhouette raised in volume, never a separate house standing in it.
//!
//! The culture's tissue declares its roof tradition and storey range
//! (`catalogue.json` presets, `params.arch`); cultures without one read the
//! table below. Heights vary with the lot's zone and pressure (taller core),
//! wealth, street corners and a per-lot draw (adjoining houses of one row
//! differ); rear wings and annexes stand lower, landmark parts by role.
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

/// Storey height (m) and the ground floor's extra height for shops.
const STOREY_M: f64 = 3.0;
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
    }
}

/// Cultures whose tissue declares no `arch` (catalogue presets).
fn table(culture: &str) -> Option<Tradition> {
    Some(match culture {
        "al-andalus" => t("hip", 24.0, [1, 2], "tile", "plaster"),
        "bagan" => t("hip", 32.0, [1, 2], "tile", "wood"),
        "budj-bim" | "goblin-warren" | "lizardfolk-swamp" => t("cone", 40.0, [1, 1], "thatch", "stone"),
        "caucasian-highland" | "himalayan-terraces" => t("flat", 0.0, [2, 3], "earth", "stone"),
        "dravidian-temple" | "rajput-fort" => t("flat", 0.0, [1, 3], "plaster", "stone"),
        "egyptian-planned" | "hausa-kano" | "mesopotamian" | "levantine-tell" | "oasis-caravan" => {
            t("flat", 0.0, [1, 2], "earth", "earth")
        }
        "indus-planned" => t("flat", 0.0, [1, 2], "earth", "brick"),
        "ksar-oasis" => t("flat", 0.0, [2, 3], "earth", "earth"),
        "hadhrami-tower" => t("flat", 0.0, [4, 7], "earth", "earth"),
        "tibetan-monastery" => t("flat", 0.0, [2, 4], "earth", "stone"),
        "nubian-fortified" => t("dome", 0.0, [1, 2], "earth", "earth"),
        "merfolk-tidal" => t("dome", 0.0, [1, 2], "stone", "stone"),
        "ethiopian-highland" | "great-zimbabwe" => t("cone", 38.0, [1, 1], "thatch", "wood"),
        "mongol-ordu" => t("tent", 30.0, [1, 1], "felt", "hide"),
        "siberian-camp" => t("tent", 36.0, [1, 1], "hide", "hide"),
        "flemish-cloth-town" => Tradition {
            gable_to_street: true,
            ..t("gable", 52.0, [3, 4], "tile", "brick")
        },
        "rynek-town" => t("gable", 45.0, [2, 4], "tile", "brick"),
        "italian-comune" => t("hip", 22.0, [3, 5], "tile", "brick"),
        "newar" => t("hip", 30.0, [3, 4], "tile", "brick"),
        "vietnamese-citadel" => t("hip", 30.0, [1, 2], "tile", "wood"),
        "giant-hold" => t("gable", 40.0, [2, 3], "stone", "stone"),
        "javanese-courts" => t("pyramid", 34.0, [1, 1], "tile", "wood"),
        "maori-pa" | "slavic-gord" => t("gable", 42.0, [1, 2], "thatch", "wood"),
        "mississippian" | "yoruba" => t("hip", 40.0, [1, 1], "thatch", "earth"),
        _ => return None,
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

/// Roof tradition of the lot: the tissue's `arch` first, else the table, else
/// a plain tiled gable.
fn tradition(arch: &Value, culture: &str) -> Tradition {
    let fallback = table(culture).unwrap_or(t("gable", 38.0, [1, 2], "tile", "plaster"));
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
    let mediterranean = matches!(
        culture,
        "roman-core" | "byzantine-greek" | "ottoman" | "venetian-lagoon" | "italian-comune"
            | "al-andalus" | "bastide" | "levantine-tell"
    );
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
    }
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
    /// Street frontage segments of the lot (public accesses).
    pub fronts: &'a [[Point; 2]],
    pub seed: &'a str,
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

fn round2(v: f64) -> f64 {
    (v * 100.0).round() / 100.0
}
fn seg(a: Point, b: Point) -> Value {
    json!([round2(a.x), round2(a.y), round2(b.x), round2(b.y)])
}

/// Lot-level floor count: the tradition's range by zone, pressure, wealth,
/// corner and a per-lot draw; roles pick their end of the range.
fn lot_floors(m: &Input, tr: &Tradition, rng: &mut Rng) -> u32 {
    let [lo, hi] = tr.storeys;
    let zone = match m.zone {
        "core" => 0.75,
        "middle" | "ring" => 0.5,
        "edge" => 0.3,
        "faubourg" => 0.25,
        _ => 0.1,
    };
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
    let mut x = 0.45 * zone + 0.35 * m.pressure.clamp(0.0, 1.0) + 0.25 * (m.wealth - 0.5)
        + rng.range(-0.28, 0.28)
        + if corner { 0.2 } else { 0.0 };
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
    floors.clamp(lo, hi)
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
}
impl Vol {
    fn json(&self) -> Value {
        let mut v = json!({"ring":ring_json(&self.ring),"floors":self.n,"eave_m":round2(self.eave),"rise_m":round2(self.roof.rise),
            "roof":self.roof.kind,"ridges":self.roof.ridges,"cover":self.cover,"wall":self.wall,"tone":round2(self.tone)});
        if self.parapet > 0.0 {
            v["parapet_m"] = json!(round2(self.parapet));
        }
        if self.overhang > 0.0 {
            v["overhang_m"] = json!(round2(self.overhang));
        }
        if !self.trim.is_empty() {
            v["trim"] = json!(self.trim);
        }
        if !self.features.is_empty() {
            v["features"] = Value::Array(self.features.clone());
        }
        v
    }
}

/// Regional family of a culture for roof-top detail.
fn flavor(culture: &str) -> &'static str {
    match culture {
        "medina" | "sahel" | "ksar-oasis" | "oasis-caravan" | "hausa-kano" | "swahili-stone-town" => "maghreb",
        "levantine-tell" | "mesopotamian" | "egyptian-planned" | "nubian-fortified" | "ottoman" | "indus-planned" => "levant",
        "persian" | "hadhrami-tower" => "persian",
        "native-pueblo" => "pueblo",
        "aztec" | "maya" | "inca" => "meso",
        _ => "other",
    }
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
    let tr = tradition(m.arch, m.culture);
    let mut rng = Rng::new(m.seed).fork("massing");
    let floors = lot_floors(m, &tr, &mut rng);
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
    let nave_eave = 7.5 + 3.5 * landmark_scale;
    let front_dir = m.fronts.first().map(|f| {
        let l = (f[1].x - f[0].x).hypot(f[1].y - f[0].y).max(1e-9);
        Point { x: (f[1].x - f[0].x) / l, y: (f[1].y - f[0].y) / l }
    });
    let main_c = super::geometry::centroid(&m.parts[main].0);
    let detail_rng = rng.fork("details");
    let out: Vec<Value> = m
        .parts
        .iter()
        .enumerate()
        .map(|(i, (shape, label))| {
            let area = areas[i];
            let ring = &shape.outer;
            let mut drng = detail_rng.fork(&i.to_string());
            let mut kind = tr.roof;
            let mut pitch = (tr.pitch * pitch_k).max(0.0);
            let mut cover = lot_cover;
            let mut wall = tr.wall;
            let mut n = floors;
            let mut eave: Option<f64> = None;
            let mut composable = false;
            match *label {
                "tower" | "belfry" | "minaret" | "keep" => {
                    n = floors.max(2) + 3 + rng.int(0, 2);
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
                    // Street bodies take the lot's height, rear wings one or two
                    // floors less, small annexes one floor under a lean-to.
                    if i != main {
                        let front = on_front(shape);
                        let drop = if front { rng.int(0, 1) } else { 1 + u32::from(rng.chance(0.35)) };
                        n = floors.saturating_sub(drop).max(1);
                        if area < 32.0 && kind != "flat" && touches(&m.parts[main].0, shape) {
                            n = 1;
                            kind = "shed";
                            pitch = pitch.clamp(15.0, 28.0);
                            composable = false;
                        }
                    }
                }
            }
            if m.landmark && *label == "building" {
                n = n.max(floors) + 1;
                cover = if tr.cover == "thatch" { "thatch" } else { "slate" };
            }
            if swap && !m.landmark {
                kind = match kind {
                    "gable" => "hip",
                    "hip" => "gable",
                    k => k,
                };
            }
            let base_eave = |n: u32| {
                eave.unwrap_or_else(|| n as f64 * STOREY_M + if shop && i == main { SHOP_EXTRA_M } else { 0.0 })
            };
            if min_frame(ring).is_none() {
                return json!({"floors":n,"eave_m":round2(base_eave(n)),"rise_m":0.0,"roof":"flat","ridges":[],"cover":cover,"wall":wall,"tone":round2(lot_tone)});
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
                return json!({"floors":n,"eave_m":round2(base_eave(n)),"rise_m":round2(rise),"roof":"ring","ridges":[],"cover":cover,"wall":wall,"tone":round2(lot_tone)});
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
                if let Some(d) = front_dir {
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
                let u = axis(vr, vkind);
                let subs = if composable { split_body(vr, u, vn, vkind, &mut rng) } else { vec![(vr.clone(), 0, false)] };
                let multi = subs.len() > 1;
                for (si, (sr, delta, cross)) in subs.into_iter().enumerate() {
                    let sn = (vn as i32 + delta).max(1) as u32;
                    let mut sk = vkind;
                    if multi && si > 0 && !m.landmark && matches!(sk, "gable" | "hip") && rng.chance(0.25) {
                        sk = if sk == "gable" { "hip" } else { "gable" };
                    }
                    let su = if cross { perp(u) } else { u };
                    let c = ring_centroid(&sr);
                    let high = if i != main {
                        Point { x: main_c.x - c.x, y: main_c.y - c.y }
                    } else {
                        front_dir.map_or(Point { x: 0.0, y: 1.0 }, |d| Point { x: -d.x, y: -d.y })
                    };
                    let vp = pitch * (1.0 + rng.range(-0.04, 0.04));
                    let roof = roof_of(&sr, sk, vp, su, high);
                    let rise_cap = if *label == "tower" { 14.0 } else { 12.0 };
                    let roof = Roof { rise: roof.rise.min(rise_cap), ..roof };
                    let (parapet, features) = if roof.kind == "flat" {
                        flat_details(&sr, label, flavor(m.culture), wall, m.wealth, m.landmark, &mut drng)
                    } else {
                        (0.0, vec![])
                    };
                    let thatchy = matches!(cover, "thatch" | "reed" | "palm" | "bamboo" | "bark" | "felt" | "hide" | "turf");
                    let hut = sn == 1 && thatchy && !m.landmark && matches!(roof.kind, "cone" | "tent" | "hip" | "gable" | "pyramid");
                    let (eave_v, overhang) = match (hut, roof.kind) {
                        (true, "tent") => (0.5, 0.3),
                        (true, _) => (base_eave(sn).min(2.2), 0.65),
                        _ => (base_eave(sn), 0.0),
                    };
                    let roof = if hut && roof.kind == "cone" { Roof { rise: roof.rise * 1.12, ..roof } } else { roof };
                    let trim = if roof.kind == "flat" && parapet > 0.0 && flavor(m.culture) == "meso" && sn >= 1 { "red" } else { "" };
                    vols.push(Vol {
                        parapet,
                        features,
                        overhang,
                        trim,
                        eave: eave_v,
                        n: sn,
                        cover,
                        wall,
                        tone: (lot_tone + rng.range(-0.08, 0.08)).clamp(0.0, 1.0),
                        ring: sr,
                        roof,
                    });
                }
            }
            // Entry-level fields repeat the tallest volume.
            let top = vols
                .iter()
                .enumerate()
                .max_by(|a, b| (a.1.eave + a.1.roof.rise).total_cmp(&(b.1.eave + b.1.roof.rise)))
                .map_or(0, |(k, _)| k);
            let t = &vols[top];
            json!({"floors":vols.iter().map(|v| v.n).max().unwrap_or(n),"eave_m":round2(t.eave),"rise_m":round2(t.roof.rise),
                "roof":t.roof.kind,"ridges":t.roof.ridges,"cover":t.cover,"wall":t.wall,"tone":round2(lot_tone),
                "volumes":vols.iter().map(Vol::json).collect::<Vec<_>>()})
        })
        .collect();
    Value::Array(out)
}

#[cfg(test)]
mod tests {
    use super::*;
    fn rect(x0: f64, y0: f64, x1: f64, y1: f64) -> Shape {
        super::super::geometry::rectangle(x0, y0, x1, y1)
    }
    fn input<'a>(parts: &'a [(Shape, &'static str)], arch: &'a Value, fronts: &'a [[Point; 2]], seed: &'a str) -> Input<'a> {
        Input { parts, arch, culture: "european-organic", zone: "core", role: "dwelling.row", function: "domestic",
            landmark: false, wealth: 0.5, pressure: 0.8, fronts, seed }
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
