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
//! `{floors, eave_m, rise_m, roof, ridges:[[x0,y0,x1,y1]…], cover, wall}`;
//! `roof` ∈ gable | hip | shed | pyramid | cone | dome | barrel | ring | flat.
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
        "ethiopian-highland" | "great-zimbabwe" | "mongol-ordu" | "siberian-camp" => {
            t("cone", 38.0, [1, 1], "thatch", "wood")
        }
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
    let wall = match material {
        "timber" | "wood" => "timber",
        "brick" => "brick",
        "stone" | "granite" | "marble" => "stone",
        "mud" | "adobe" | "earth" | "rammed-earth" => "earth",
        "thatch" | "reed" | "hide" | "felt" | "fabric" => "wood",
        _ => fallback.wall,
    };
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
    let cover = if material == "thatch" { "thatch" } else { cover };
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

/// Massing of every preview piece, aligned with `preview` (empty when none).
pub(super) fn massing(m: &Input) -> Value {
    if m.parts.is_empty() {
        return Value::Null;
    }
    let tr = tradition(m.arch, m.culture);
    let mut rng = Rng::new(m.seed).fork("massing");
    let floors = lot_floors(m, &tr, &mut rng);
    let pitch_jitter = rng.range(-4.0, 4.0);
    // Hip/gable alternance inside a tradition: a few lots of a gabled street
    // turn their roof to hips and conversely (never for flat traditions).
    let swap = rng.chance(0.12);
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
    let out: Vec<Value> = m
        .parts
        .iter()
        .enumerate()
        .map(|(i, (shape, label))| {
            let area = areas[i];
            let ring = &shape.outer;
            let mut kind = tr.roof;
            let mut pitch = (tr.pitch + pitch_jitter).max(0.0);
            let mut cover = tr.cover;
            let mut wall = tr.wall;
            let mut n = floors;
            let mut eave: Option<f64> = None;
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
                    if kind == "flat" || kind == "cone" {
                        kind = "hip";
                        pitch = 30.0;
                    }
                }
                _ => {
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
            let eave_m = eave.unwrap_or_else(|| {
                n as f64 * STOREY_M + if shop && i == main { SHOP_EXTRA_M } else { 0.0 }
            });
            // Roofs: a court body is a ring; elsewhere the ridge follows the
            // tradition's orientation on the piece's box.
            let Some(box_frame) = min_frame(ring) else {
                return json!({"floors":n,"eave_m":round2(eave_m),"rise_m":0.0,"roof":"flat","ridges":[],"cover":cover,"wall":wall});
            };
            if !shape.holes.is_empty() && !matches!(kind, "flat" | "dome") {
                // Half the range width: area over the whole eave length.
                let perimeter: f64 = std::iter::once(ring)
                    .chain(shape.holes.iter())
                    .map(|r| (0..r.len()).map(|i| { let (a, b) = (r[i], r[(i + 1) % r.len()]); (b.x - a.x).hypot(b.y - a.y) }).sum::<f64>())
                    .sum();
                let half = (area / perimeter.max(1e-6)).min(6.0);
                let rise = (half * pitch.to_radians().tan()).min(5.0);
                return json!({"floors":n,"eave_m":round2(eave_m),"rise_m":round2(rise),"roof":"ring","ridges":[],"cover":cover,"wall":wall});
            }
            let narrow = box_frame.half_w < 1.4;
            if narrow && !matches!(kind, "flat") {
                kind = "shed";
                pitch = pitch.min(20.0);
            }
            // Ridge axis: gabled row houses turn their gable to the street,
            // other street bodies run their ridge along it; the rest, and any
            // piece much longer than wide, along its long side.
            let f = match (front_dir, kind) {
                (Some(d), "gable" | "hip" | "barrel") if on_front(shape) => {
                    let along = frame_along(ring, d);
                    let across = frame_along(ring, Point { x: -d.y, y: d.x });
                    let choice = if tr.gable_to_street { across } else { along };
                    // A body over twice as long one way keeps its long ridge.
                    if choice.half_l * 2.0 < choice.half_w { if tr.gable_to_street { along } else { across } } else { choice }
                }
                _ => box_frame,
            };
            let (c, u) = (f.c, f.u);
            let at = |s: f64, w: f64| Point { x: c.x + u.x * s - u.y * w, y: c.y + u.y * s + u.x * w };
            let tan = pitch.to_radians().tan();
            let (rise, ridges) = match kind {
                "gable" => (f.half_w * tan, vec![seg(at(-f.half_l, 0.0), at(f.half_l, 0.0))]),
                "hip" => {
                    let h = (f.half_l - f.half_w).max(0.0);
                    (f.half_w * tan, vec![seg(at(-h, 0.0), at(h, 0.0))])
                }
                "barrel" => (f.half_w * 0.8, vec![seg(at(-f.half_l, 0.0), at(f.half_l, 0.0))]),
                "pyramid" | "cone" => (f.half_w.max(f.half_l.min(f.half_w * 1.4)) * tan, vec![seg(c, c)]),
                "dome" => (f.half_w.min(f.half_l) * 0.9, vec![seg(c, c)]),
                "shed" => {
                    // High side: toward the main body, else away from the street.
                    let toward = if i != main {
                        let mc = super::geometry::centroid(&m.parts[main].0);
                        (mc.x - c.x) * -u.y + (mc.y - c.y) * u.x
                    } else {
                        front_dir.map_or(1.0, |d| -(d.x * -u.y + d.y * u.x))
                    };
                    let w = if toward >= 0.0 { f.half_w } else { -f.half_w };
                    (2.0 * f.half_w * tan, vec![seg(at(-f.half_l, w), at(f.half_l, w))])
                }
                _ => (0.0, vec![]),
            };
            let rise = rise.min(if *label == "tower" { 14.0 } else { 12.0 });
            json!({"floors":n,"eave_m":round2(eave_m),"rise_m":round2(rise),"roof":kind,"ridges":ridges,"cover":cover,"wall":wall})
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
}
