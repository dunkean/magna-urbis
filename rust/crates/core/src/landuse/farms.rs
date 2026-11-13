//! Context driven farm plans. Catalogue and draw order mirror the former farms.ts.
use super::{geom::*, *};
use std::{f64::consts::PI, sync::OnceLock};
pub const SIZES: [&str; 4] = ["cottage", "family", "large", "manor"];
#[derive(Clone, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Context {
    pub culture: String,
    #[serde(default)]
    pub biome: String,
    pub soil: f64,
    pub slope: f64,
    pub downhill: Option<Point>,
    pub wet: f64,
    pub exposed: f64,
    pub market: f64,
    pub west: f64,
    pub pop: Option<f64>,
    #[serde(default)]
    pub street_aligned_homes: bool,
}
#[derive(Clone, Copy)]
pub struct Frame {
    pub south: Point,
    pub west: Point,
    pub down: Option<Point>,
}
#[derive(Clone)]
pub struct Part {
    pub use_: String,
    pub poly: Polygon,
    pub passage: bool,
    pub round: bool,
}
#[derive(Clone)]
pub struct Plot {
    pub kind: String,
    pub poly: Polygon,
}
#[derive(Clone)]
pub struct LocalFarm {
    pub type_: String,
    pub size: usize,
    pub w: f64,
    pub d: f64,
    pub parts: Vec<Part>,
    pub yard: Polygon,
    pub walls: Vec<Polygon>,
    pub plots: Vec<Plot>,
    pub trees: Polygon,
    pub gate_u: f64,
    pub entry: Point,
    pub tags: Vec<String>,
}
struct Ctx<'a> {
    c: &'a Context,
    f: Frame,
    si: usize,
    r: Rng,
    slope_f: f64,
}
struct Zone {
    parts: Vec<Part>,
    yard: Polygon,
    walls: Vec<Polygon>,
    gate_u: f64,
    entry: Point,
    w: f64,
    d: f64,
    house_u: f64,
}
fn part(u: &str, poly: Polygon) -> Part {
    Part {
        use_: u.into(),
        poly,
        passage: false,
        round: false,
    }
}
fn round_part(u: &str, poly: Polygon) -> Part {
    Part {
        round: true,
        ..part(u, poly)
    }
}
fn passage(u: &str, poly: Polygon) -> Part {
    Part {
        passage: true,
        ..part(u, poly)
    }
}
fn plot(k: &str, poly: Polygon) -> Plot {
    Plot {
        kind: k.into(),
        poly,
    }
}
fn cl(v: f64) -> f64 {
    v.clamp(0.0, 1.0)
}
fn rrect(u0: f64, v0: f64, u1: f64, v1: f64) -> Polygon {
    let (a, b, c, d) = (u0.min(u1), u0.max(u1), v0.min(v1), v0.max(v1));
    vec![p(a, c), p(b, c), p(b, d), p(a, d)]
}
fn shift(a: &[Point], du: f64, dv: f64) -> Polygon {
    a.iter().map(|q| p(q.x + du, q.y + dv)).collect()
}
fn bounds(a: &[Polygon]) -> Box2 {
    bbox(&a.iter().flatten().copied().collect::<Vec<_>>())
}
fn dot(a: Point, b: Point) -> f64 {
    a.x * b.x + a.y * b.y
}
fn selected(r: &mut Rng, ranges: [(f64, f64); 4], si: usize) -> f64 {
    let a = ranges.map(|(a, b)| r.range(a, b));
    a[si]
}
fn data() -> &'static Value {
    static DATA: OnceLock<Value> = OnceLock::new();
    DATA.get_or_init(|| {
        let s = include_str!("../urban/catalogue.json");
        let start = s
            .find("\"farmstead\"")
            .and_then(|k| s[k..].find('{').map(|i| k + i))
            .expect("farmstead");
        let mut depth = 0;
        let end = s[start..]
            .char_indices()
            .find_map(|(i, c)| {
                match c {
                    '{' => depth += 1,
                    '}' => {
                        depth -= 1;
                        if depth == 0 {
                            return Some(start + i + 1);
                        }
                    }
                    _ => (),
                }
                None
            })
            .expect("farmstead end");
        serde_json::from_str(&s[start..end]).expect("farmstead catalogue")
    })
}
pub fn culture(culture: &str) -> &'static Value {
    data()["cultures"]
        .get(culture)
        .unwrap_or(&data()["cultures"][s(&data()["default"])])
}
pub fn size(c: &Context, r: &mut Rng) -> usize {
    let mut w = 0.45 * c.soil + 0.45 * (0.45 - c.market) - 0.45 * cl(c.slope / 0.16) - 0.3 * c.wet
        + 0.36 * (r.float() - 0.5);
    if let Some(pop) = c.pop {
        w += (pop - 8.0) / 14.0;
    }
    if w < -0.3 {
        0
    } else if w < 0.04 {
        1
    } else if w < 0.2 {
        2
    } else {
        3
    }
}
fn affinity(t: &str, c: &Context, si: usize) -> f64 {
    let sf = cl(c.slope / 0.16);
    let rich = cl((c.soil + 1.0) / 2.0);
    let near = 1.0 - c.market;
    let west = cl(0.5 + c.west);
    let small = si == 0;
    let big = si >= 2;
    match t {
        "vierkanthof" => {
            if small {
                0.0
            } else {
                (0.3 + 1.7 * rich)
                    * (0.5 + near)
                    * (1.25 - 0.8 * west)
                    * (1.0 - 0.7 * sf)
                    * if big { 1.5 } else { 0.8 }
            }
        }
        "u-yard" => {
            if small {
                0.15
            } else {
                (0.5 + rich) * (1.0 - 0.5 * sf) * if big { 1.2 } else { 1.0 }
            }
        }
        "l-yard" => 0.6 + 1.8 * sf,
        "haufenhof" => {
            (0.35 + 1.1 * sf + 0.6 * (1.0 - rich) + 0.8 * c.exposed)
                * if si == 3 { 0.4 } else { 1.0 }
        }
        "longere" => {
            (0.2 + 1.5 * west)
                * (0.7 + 0.6 * (1.0 - rich))
                * if si == 3 {
                    0.3
                } else if small {
                    1.4
                } else {
                    1.0
                }
                * (1.0 - 0.5 * sf)
        }
        "einhaus" => 0.2 + 3.0 * c.wet + 0.4 * cl(1.0 - 2.0 * sf) * (1.0 - west),
        "masseria" => (0.6 + 0.8 * (1.0 - west)) * (1.0 + 0.5 * c.exposed),
        _ => 1.0,
    }
}
pub fn farm_type(c: &Context, si: usize, r: &mut Rng) -> String {
    if c.biome == "underdark" {
        return if c.culture == "myconid-colony" {
            "spore-farm"
        } else {
            "fungal-farm"
        }
        .into();
    }
    // The culture's weighted draw (as urban/farmsteads.rs `farm_type`), each weight scaled
    // by the site rules of the type (slope, wet ground, exposure, soil, farm size), so a
    // culture's minor types appear at their share.
    let regime = arr(&culture(&c.culture)["types"]);
    let weights: Vec<f64> = regime
        .iter()
        .map(|v| num(&v[1]) * affinity(s(&v[0]), c, si))
        .collect();
    let mut x = r.float() * weights.iter().sum::<f64>();
    for (v, w) in regime.iter().zip(&weights) {
        if x < *w {
            return s(&v[0]).into();
        }
        x -= w;
    }
    regime.last().map_or("haufenhof", |v| s(&v[0])).into()
}
fn dims(use_: &str, si: usize, r: &mut Rng) -> (f64, f64) {
    let ranges = match use_ {
        "house" => Some([
            ((8.0, 10.0), (6.0, 7.0)),
            ((10.0, 13.0), (6.5, 8.0)),
            ((12.0, 14.0), (7.0, 9.0)),
            ((13.0, 14.0), (8.0, 9.0)),
        ]),
        "barn" => Some([
            ((15.0, 16.0), (8.0, 8.5)),
            ((16.0, 22.0), (8.0, 10.0)),
            ((20.0, 28.0), (9.0, 11.0)),
            ((24.0, 30.0), (10.0, 12.0)),
        ]),
        "byre" | "stable" => Some([
            ((8.0, 10.0), (5.5, 6.5)),
            ((10.0, 14.0), (6.0, 8.0)),
            ((12.0, 16.0), (7.0, 8.0)),
            ((14.0, 18.0), (7.0, 9.0)),
        ]),
        _ => None,
    };
    if let Some(a) = ranges {
        let ((a, b), (c, d)) = a[si];
        return (r.range(a, b), r.range(c, d));
    }
    let (a, b, c, d) = match use_ {
        "cart-shed" => (7.0, 10.0, 5.0, 6.0),
        "lean-to" => (4.0, 7.0, 2.5, 3.5),
        "granary" | "storehouse" => (4.5, 6.5, 4.0, 5.0),
        "bakehouse" => (4.0, 6.0, 3.5, 5.0),
        _ => (4.5, 8.0, 3.0, 5.5),
    };
    (r.range(a, b), r.range(c, d))
}
fn overlaps(a: &[Point], b: &[Point], gap: f64) -> bool {
    for ring in [a, b] {
        for i in 0..ring.len() {
            let (p, q) = (ring[i], ring[(i + 1) % ring.len()]);
            let (mut nx, mut ny) = (-(q.y - p.y), q.x - p.x);
            let l = nx.hypot(ny);
            let l = if l == 0.0 { 1.0 } else { l };
            nx /= l;
            ny /= l;
            let range = |r: &[Point]| {
                r.iter()
                    .map(|p| p.x * nx + p.y * ny)
                    .fold((f64::INFINITY, f64::NEG_INFINITY), |(lo, hi), d| {
                        (lo.min(d), hi.max(d))
                    })
            };
            let (a0, a1) = range(a);
            let (b0, b1) = range(b);
            if a1 + gap <= b0 + 1e-6 || b1 + gap <= a0 + 1e-6 {
                return false;
            }
        }
    }
    true
}
fn seg_hits(p: Point, q: Point, a: &[Point]) -> bool {
    overlaps(&[p, q, super::geom::p(q.x + 1e-4, q.y + 1e-4)], a, 0.25)
}
#[derive(Default)]
struct CourtOptions {
    walled: bool,
    gate_end: bool,
    tower: bool,
    uses: Vec<&'static str>,
    depth: Option<f64>,
    yard: Option<(f64, f64)>,
    dovecote: bool,
}
fn normal(e: usize) -> Point {
    [p(0.0, 1.0), p(-1.0, 0.0), p(1.0, 0.0), p(0.0, -1.0)][e]
}
fn court(x: &mut Ctx, edges: &[usize], tags: &mut Vec<String>, o: CourtOptions) -> Zone {
    let f = x.f;
    let si = x.si;
    let r = &mut x.r;
    let side: Vec<_> = edges.iter().copied().filter(|&e| e != 3).collect();
    let north = |e| -dot(normal(e), f.south);
    let mut house_e = side[0];
    for &e in &side {
        if north(e) + if e == 0 { 0.02 } else { 0.0 } > north(house_e) {
            house_e = e;
        }
    }
    let rest: Vec<_> = side.iter().copied().filter(|&e| e != house_e).collect();
    let mut barn_e = rest.first().copied();
    if let Some(mut barn) = barn_e {
        let score = |e| {
            let n = normal(e);
            let t = p(n.y, -n.x);
            if let Some(down) = f.down.filter(|_| x.slope_f > 0.25) {
                -dot(t, down).abs()
            } else {
                dot(n, f.west)
            }
        };
        for &e in &rest {
            if score(e) > score(barn) {
                barn = e;
            }
        }
        barn_e = Some(barn);
        if let Some(d) = f.down.filter(|_| x.slope_f > 0.35) {
            let n = normal(barn);
            if dot(p(n.y, -n.x), d).abs() < 0.5 {
                tags.push("bank-barn".into());
            }
        }
    }
    let uses = if o.uses.is_empty() {
        vec!["house", "barn", "byre", "stable"]
    } else {
        o.uses
    };
    let mut roles = [""; 4];
    roles[house_e] = uses[0];
    if let Some(b) = barn_e {
        roles[b] = uses[1];
    }
    let mut k = 2;
    for &e in &rest {
        if Some(e) != barn_e {
            roles[e] = uses[(uses.len() - 1).min(k)];
            k += 1;
        }
    }
    if edges.contains(&3) {
        roles[3] = "cart-shed";
    }
    let mut de = [0.0; 4];
    for &e in edges {
        de[e] = if let Some(d) = o.depth {
            d
        } else if roles[e] == "cart-shed" {
            r.range(5.0, 6.5)
        } else {
            dims(roles[e], si, r).1
        };
    }
    let yr = o
        .yard
        .unwrap_or([(11.0, 15.0), (15.0, 21.0), (19.0, 26.0), (24.0, 32.0)][si]);
    let mut yw = r.range(yr.0, yr.1);
    let mut yd = r.range(yr.0, yr.1) * 0.95;
    if let Some(b) = barn_e {
        if uses.get(1) == Some(&"barn") {
            let lb = dims("barn", si, r).0;
            if b == 0 {
                yw = yw.max(lb - de[1] - de[2]);
            } else {
                yd = yd.max(lb.min(30.0));
            }
        }
    }
    let wall_m = if o.walled { 1.5 } else { 0.0 };
    let fm = 2.0 + wall_m;
    let yv0 = fm + de[3];
    let yv1 = yv0 + yd;
    let ul = -yw / 2.0 - de[1];
    let ur = yw / 2.0 + de[2];
    let mut parts = vec![];
    fn fill(
        parts: &mut Vec<Part>,
        r: &mut Rng,
        si: usize,
        tower: bool,
        e: usize,
        a: f64,
        b: f64,
        d0: f64,
        d1: f64,
        first: &str,
        high: bool,
    ) {
        let along = e == 0 || e == 3;
        let l = b - a;
        let mut seq = vec![first];
        if first == "house" || first == "tower" {
            seq.push(if si >= 1 { "byre" } else { "shed" });
            seq.push("shed");
        } else if first == "barn" {
            seq.push(if si >= 2 { "cart-shed" } else { "shed" });
        } else {
            seq.extend(["shed", "shed"]);
        }
        if tower && first == "house" {
            seq.insert(0, "tower");
        }
        let mut pos = 0.0;
        for use_ in seq {
            let rem = l - pos;
            if rem < 4.0 {
                break;
            }
            let mut len = if use_ == "tower" {
                8.0
            } else {
                let len = dims(use_, si, r).0;
                if use_ == first {
                    rem.min(len.max(if use_ == "barn" { 15.0 } else { 0.0 }))
                } else {
                    rem.min(len)
                }
            };
            let max_l = if use_ == "barn" {
                30.0
            } else if use_ == "byre" || use_ == "stable" {
                18.0
            } else {
                10.0
            };
            if use_ == first
                && first != "house"
                && first != "tower"
                && rem - len < 4.0
                && rem <= max_l
            {
                len = rem;
            }
            if use_ == "house" && rem - len < 4.0 && rem - len > 0.0 {
                len = rem.min(14.0);
            }
            let p0 = if high { b - pos - len } else { a + pos };
            let p1 = p0 + len;
            let poly = if along {
                rrect(p0, d0, p1, d1)
            } else {
                rrect(d0, p0, d1, p1)
            };
            parts.push(part(
                if use_ == "shed" && len * (d1 - d0).abs() > 40.0 {
                    "cart-shed"
                } else {
                    use_
                },
                poly,
            ));
            pos += len
                + if use_ == "tower" {
                    0.0
                } else if r.chance(0.3) {
                    r.range(1.5, 3.0)
                } else {
                    0.0
                };
        }
    }
    for &e in edges {
        let use_ = roles[e];
        if e == 0 {
            let high = r.chance(0.5);
            fill(
                &mut parts,
                r,
                si,
                o.tower,
                e,
                ul,
                ur,
                yv1 + de[0],
                yv1,
                use_,
                high,
            );
        } else if e == 1 {
            fill(
                &mut parts,
                r,
                si,
                o.tower,
                e,
                yv0,
                yv1,
                ul,
                -yw / 2.0,
                use_,
                true,
            );
        } else if e == 2 {
            fill(
                &mut parts,
                r,
                si,
                o.tower,
                e,
                yv0,
                yv1,
                ur,
                yw / 2.0,
                use_,
                true,
            );
        }
    }
    let mut gate_u = 0.0;
    if o.gate_end {
        gate_u = if f.west.x > 0.0 { -1.0 } else { 1.0 } * (yw / 2.0 - 4.2);
    }
    if edges.contains(&3) {
        let gh = si == 3 || o.walled && si >= 2;
        if gh {
            parts.push(passage(
                "gatehouse",
                rrect(gate_u - 3.5, fm, gate_u + 3.5, yv0),
            ));
        }
        let gl = if gh { 3.5 } else { 2.2 };
        let (a, b) = (gate_u - gl, gate_u + gl);
        if a - ul >= 4.0 {
            parts.push(part(
                if si >= 2 || a - ul > 9.0 {
                    "cart-shed"
                } else {
                    "shed"
                },
                rrect(ul, fm, a, yv0),
            ));
        }
        if ur - b >= 4.0 {
            parts.push(part(
                if si >= 3 {
                    "stable"
                } else if ur - b > 9.0 {
                    "cart-shed"
                } else {
                    "shed"
                },
                rrect(b, fm, ur, yv0),
            ));
        }
    } else if si == 3 && o.walled {
        parts.push(passage(
            "gatehouse",
            rrect(gate_u - 3.5, 0.5, gate_u + 3.5, fm + 3.5),
        ));
    }
    let yard = rrect(-yw / 2.0, yv0, yw / 2.0, yv1);
    if o.dovecote && (si == 3 || si == 2 && r.chance(0.35)) {
        let cu = if gate_u >= 0.0 { -1.0 } else { 1.0 } * (yw / 2.0 - 3.5);
        let cv = yv1 - 3.5;
        let poly = if r.chance(0.5) {
            circle(p(cu, cv), 2.4, 12)
        } else {
            rrect(cu - 2.2, cv - 2.2, cu + 2.2, cv + 2.2)
        };
        parts.push(round_part("dovecote", poly));
    }
    let w = ur - ul + 2.0 * wall_m;
    let d = yv1 + de[0] + wall_m;
    let mut walls = vec![];
    if o.walled {
        let (w0, w1, v0, v1) = (
            ul - wall_m * 0.6,
            ur + wall_m * 0.6,
            wall_m * 0.6,
            d - wall_m * 0.4,
        );
        walls.push(vec![
            p(gate_u - 2.2, v0),
            p(w0, v0),
            p(w0, v1),
            p(w1, v1),
            p(w1, v0),
            p(gate_u + 2.2, v0),
        ]);
    }
    let hu = parts
        .iter()
        .find(|p| p.use_ == "house")
        .map(|p| {
            let b = bbox(&p.poly);
            (b.x0 + b.x1) / 2.0
        })
        .unwrap_or(0.0);
    let cu = (ul + ur) / 2.0;
    for p in &mut parts {
        p.poly = shift(&p.poly, -cu, 0.0);
    }
    Zone {
        parts,
        yard: shift(&yard, -cu, 0.0),
        walls: walls.iter().map(|p| shift(p, -cu, 0.0)).collect(),
        gate_u: gate_u - cu,
        entry: p(gate_u - cu, yv0 + 1.5),
        w,
        d,
        house_u: hu - cu,
    }
}
fn range(x: &mut Ctx, uses: Vec<&str>, depth: f64) -> Zone {
    let f = x.f;
    let si = x.si;
    let r = &mut x.r;
    let along_v = if let Some(d) = f.down.filter(|_| x.slope_f > 0.3) {
        d.x.abs() > d.y.abs()
    } else {
        f.south.x.abs() > f.south.y.abs() + 0.2
    };
    let lens: Vec<_> = uses
        .iter()
        .map(|&u| {
            if u == "room" {
                r.range(4.5, 6.5)
            } else {
                dims(u, si, r).0
            }
        })
        .collect();
    let total = lens.iter().sum::<f64>();
    let yc = r.range(10.0, 15.0);
    let mut parts = vec![];
    let fm = 2.0;
    let mut pos = 0.0;
    let (w, d, entry, gate_u, yard);
    if !along_v {
        let back = f.south.y <= 0.15;
        let lane = if back { 0.0 } else { 4.5 };
        w = total + lane + 2.0;
        let u0 = -w / 2.0 + 1.0;
        let v0 = if back { fm + yc } else { fm };
        let v1 = v0 + depth;
        for (i, &use_) in uses.iter().enumerate() {
            parts.push(part(
                if use_ == "room" {
                    if i == 0 { "house" } else { "storeroom" }
                } else {
                    use_
                },
                rrect(u0 + pos, v0, u0 + pos + lens[i], v1),
            ));
            pos += lens[i];
        }
        yard = if back {
            rrect(-w / 2.0 + 1.0, fm, w / 2.0 - 1.0, v0)
        } else {
            rrect(-w / 2.0 + 1.0, v1, w / 2.0 - 1.0, v1 + yc)
        };
        d = if back {
            v1 + if si == 0 { 4.0 } else { 1.0 }
        } else {
            v1 + yc + 1.0
        };
        gate_u = if back {
            0.0
        } else {
            w / 2.0 - 1.0 - lane / 2.0
        };
        entry = if back {
            p(0.0, fm + yc / 2.0)
        } else {
            p(gate_u, v1 + 2.0)
        };
    } else {
        let left = f.south.x > 0.0;
        w = depth + yc + 2.0;
        let a = if left {
            -w / 2.0 + 1.0
        } else {
            w / 2.0 - 1.0 - depth
        };
        for (i, &use_) in uses.iter().enumerate() {
            parts.push(part(
                if use_ == "room" {
                    if i == 0 { "house" } else { "storeroom" }
                } else {
                    use_
                },
                rrect(a, fm + pos, a + depth, fm + pos + lens[i]),
            ));
            pos += lens[i];
        }
        let ya = if left { a + depth } else { -w / 2.0 + 1.0 };
        let yb = if left { w / 2.0 - 1.0 } else { a };
        yard = rrect(ya, fm, yb, fm + total);
        d = fm + total + 1.0;
        gate_u = (ya + yb) / 2.0;
        entry = p(gate_u, fm + 3.0);
    }
    if uses[0] == "house" && si == 0 {
        let hb = bbox(&parts[0].poly);
        let l = r.range(4.0, 6.0);
        if !along_v && f.south.y <= 0.15 {
            let pp = rrect(hb.x0 + 1.0, hb.y1, hb.x0 + 1.0 + l, hb.y1 + 3.0);
            if pp[2].y <= d - 0.5 {
                parts.push(part("lean-to", pp));
            }
        }
    }
    let yb = bbox(&yard);
    if yb.x1 - yb.x0 > 12.0 && yb.y1 - yb.y0 > 9.0 {
        let (l, dep) = dims(if si >= 2 { "cart-shed" } else { "bakehouse" }, si, r);
        let cu = if gate_u > (yb.x0 + yb.x1) / 2.0 {
            yb.x0 + l / 2.0 + 1.0
        } else {
            yb.x1 - l / 2.0 - 1.0
        };
        let near = if !along_v && f.south.y <= 0.15 {
            yb.y0 + dep / 2.0 + 1.0
        } else {
            yb.y1 - dep / 2.0 - 1.0
        };
        if !along_v {
            parts.push(part(
                if si >= 2 { "cart-shed" } else { "bakehouse" },
                rrect(
                    cu - l / 2.0,
                    near - dep / 2.0,
                    cu + l / 2.0,
                    near + dep / 2.0,
                ),
            ));
        }
    }
    let hb = bbox(&parts[0].poly);
    Zone {
        parts,
        yard,
        walls: vec![],
        gate_u,
        entry,
        w,
        d,
        house_u: (hb.x0 + hb.x1) / 2.0,
    }
}
fn hall(x: &mut Ctx, tags: &mut Vec<String>) -> Zone {
    let si = x.si;
    let f = x.f;
    let r = &mut x.r;
    let w = selected(
        r,
        [(9.0, 11.0), (12.0, 14.0), (13.0, 15.0), (14.0, 16.0)],
        si,
    );
    let l = selected(
        r,
        [(14.0, 18.0), (20.0, 27.0), (27.0, 34.0), (33.0, 40.0)],
        si,
    );
    let yd = r.range(9.0, 13.0);
    let fm = 2.0;
    let mut parts = vec![part(
        "house",
        rrect(-w / 2.0, fm + yd, w / 2.0, fm + yd + l),
    )];
    let (mut umin, mut umax) = (-w / 2.0, w / 2.0);
    let west_side = if f.west.x < 0.0 { -1.0 } else { 1.0 };
    if si >= 2 {
        let (bl, bd) = dims("barn", si, r);
        let a = if west_side < 0.0 {
            -w / 2.0 - 6.0 - bd
        } else {
            w / 2.0 + 6.0
        };
        parts.push(part(
            "barn",
            rrect(a, fm + yd + 2.0, a + bd, fm + yd + 2.0 + bl),
        ));
        umin = umin.min(a);
        umax = umax.max(a + bd);
    }
    if si >= 3 {
        let (bl, bd) = dims("byre", si, r);
        let a = if west_side < 0.0 {
            w / 2.0 + 6.0
        } else {
            -w / 2.0 - 6.0 - bd
        };
        parts.push(part(
            "byre",
            rrect(a, fm + yd + 2.0, a + bd, fm + yd + 2.0 + bl),
        ));
        umin = umin.min(a);
        umax = umax.max(a + bd);
    }
    let small = if si == 0 {
        vec!["shed"]
    } else if si == 1 {
        vec!["granary", "bakehouse"]
    } else {
        vec!["granary", "bakehouse", "shed"]
    };
    for (i, u) in small.iter().enumerate() {
        let (l, d) = dims(u, si, r);
        let sign = if i % 2 == 0 { -west_side } else { west_side };
        let a = if sign < 0.0 {
            umin - 4.0 - l
        } else {
            umax + 4.0
        };
        let v0 = fm + 1.0 + if i >= 2 { yd + 4.0 } else { r.range(0.0, 2.0) };
        parts.push(part(u, rrect(a, v0, a + l, v0 + d)));
        if sign < 0.0 {
            umin = umin.min(a);
        } else {
            umax = umax.max(a + l);
        }
    }
    if si == 3 {
        parts.push(round_part(
            "dovecote",
            circle(
                p(
                    if west_side < 0.0 {
                        w / 2.0 + 3.0
                    } else {
                        -w / 2.0 - 3.0
                    },
                    fm + 3.5,
                ),
                2.3,
                12,
            ),
        ));
    }
    let bb = bounds(&parts.iter().map(|p| p.poly.clone()).collect::<Vec<_>>());
    let cu = (bb.x0 + bb.x1) / 2.0;
    for p in &mut parts {
        p.poly = shift(&p.poly, -cu, 0.0);
    }
    if x.c.wet > 0.35 {
        tags.push("warft".into());
    }
    Zone {
        parts,
        yard: rrect(-w / 2.0 - 2.0 - cu, fm, w / 2.0 + 2.0 - cu, fm + yd),
        walls: vec![],
        gate_u: -cu,
        entry: p(-cu, fm + yd / 2.0),
        w: bb.x1 - bb.x0 + 2.0,
        d: bb.y1 + 1.0,
        house_u: -cu,
    }
}
fn dvor(x: &mut Ctx) -> Zone {
    let si = x.si;
    let r = &mut x.r;
    let (hl, hd) = (r.range(8.0, 11.0), r.range(6.5, 8.5));
    let cl = selected(
        r,
        [(8.0, 10.0), (10.0, 14.0), (13.0, 17.0), (15.0, 20.0)],
        si,
    );
    let fm = 2.0;
    let lane = r.range(5.0, 7.0);
    let mut parts = vec![
        part("house", rrect(0.0, fm, hd, fm + hl)),
        part("covered-yard", rrect(0.0, fm + hl, hd + 1.0, fm + hl + cl)),
    ];
    let ou = hd + 1.0 + lane;
    let (al, ad) = dims("granary", si, r);
    parts.push(part(
        "barn",
        rrect(ou, fm + 4.0, ou + ad + 1.0, fm + 4.0 + al + 1.0),
    ));
    if si >= 1 {
        parts.push(part(
            "bath",
            rrect(ou, fm + hl + cl - 4.5, ou + 4.0, fm + hl + cl),
        ));
    }
    if si >= 2 {
        let (sl, sd) = dims("shed", si, r);
        parts.push(part(
            "shed",
            rrect(ou, fm + 6.0 + al + 2.0, ou + sd, fm + 6.0 + al + 2.0 + sl),
        ));
    }
    let bb = bounds(&parts.iter().map(|p| p.poly.clone()).collect::<Vec<_>>());
    let cu = (bb.x0 + bb.x1) / 2.0;
    for p in &mut parts {
        p.poly = shift(&p.poly, -cu, 0.0);
    }
    Zone {
        parts,
        yard: rrect(hd + 1.0 - cu, fm, ou - cu, fm + hl + cl),
        walls: vec![],
        gate_u: hd + 1.0 + lane / 2.0 - cu,
        entry: p(hd + 1.0 + lane / 2.0 - cu, fm + 3.0),
        w: bb.x1 - bb.x0 + 2.0,
        d: bb.y1 + 1.0,
        house_u: hd / 2.0 - cu,
    }
}
struct Item {
    u: &'static str,
    len: f64,
    dep: f64,
    shape: &'static str,
}
fn item(u: &'static str, len: f64, dep: f64, shape: &'static str) -> Item {
    Item { u, len, dep, shape }
}
fn ld(u: &'static str, si: usize, r: &mut Rng) -> Item {
    let (l, d) = dims(u, si, r);
    item(u, l, d, "rect")
}
fn longhouse(c: Point, len: f64, dep: f64, a: f64, bow: bool) -> Polygon {
    let mut pts = vec![];
    if bow {
        for i in 0..=5 {
            let x = -len / 2.0 + len * i as f64 / 5.0;
            let t = 2.0 * i as f64 / 5.0 - 1.0;
            pts.push(p(x, -dep / 2.0 * (1.0 - 0.32 * t * t)));
        }
        for i in (0..=5).rev() {
            let x = -len / 2.0 + len * i as f64 / 5.0;
            let t = 2.0 * i as f64 / 5.0 - 1.0;
            pts.push(p(x, dep / 2.0 * (1.0 - 0.32 * t * t)));
        }
    } else {
        let rr = dep / 2.0;
        let h = len / 2.0 - rr;
        for i in 0..=4 {
            let t = -PI / 2.0 + i as f64 / 4.0 * PI;
            pts.push(p(h + rr * t.cos(), rr * t.sin()));
        }
        for i in 0..=4 {
            let t = PI / 2.0 + i as f64 / 4.0 * PI;
            pts.push(p(-h + rr * t.cos(), rr * t.sin()));
        }
    }
    pts.iter()
        .map(|q| {
            p(
                c.x + q.x * a.cos() - q.y * a.sin(),
                c.y + q.x * a.sin() + q.y * a.cos(),
            )
        })
        .collect()
}
fn scatter(x: &mut Ctx, items: Vec<Item>, parallel: bool) -> Zone {
    let r = &mut x.r;
    let f = x.f;
    let ry = 5.0 + 1.1 * items.len() as f64 + r.range(0.0, 2.5);
    let contour = f.down.filter(|_| x.slope_f > 0.3).map(|d| d.x.atan2(-d.y));
    let ew = (-f.south.x).atan2(f.south.y);
    let slots = [
        90.0, 20.0, 160.0, -28.0, -152.0, 55.0, 125.0, 0.0, 180.0, -60.0, -120.0,
    ];
    let mut parts: Vec<Part> = vec![];
    for (i, it) in items.iter().enumerate() {
        let mut a = slots[i % slots.len()] + r.range(-12.0, 12.0);
        if ((a + 90.0 + 540.0) % 360.0 - 180.0).abs() < 40.0 {
            a += 40.0;
        }
        let ar = a * PI / 180.0;
        let mut ang = if parallel {
            contour.unwrap_or(ew)
        } else {
            ar + PI / 2.0 + r.range(-0.15, 0.15)
        };
        if !parallel && contour.is_some() && it.len > 9.0 {
            ang = contour.unwrap() + r.range(-0.1, 0.1);
        }
        for k in 0..10 {
            let d =
                ry + if it.shape == "circle" {
                    it.len / 2.0
                } else {
                    it.dep.max((ang - ar).sin().abs() * it.len) / 2.0
                } + 1.5
                    + 2.5 * k as f64;
            let c = p(ar.cos() * d, ry + 2.0 + ar.sin() * d);
            let poly = if it.shape == "circle" {
                circle(c, it.len / 2.0, 12)
            } else if it.shape == "bow" || it.shape == "round" {
                longhouse(c, it.len, it.dep, ang, it.shape == "bow")
            } else {
                rect(c.x, c.y, it.len, it.dep, ang)
            };
            if parts.iter().any(|p| overlaps(&p.poly, &poly, 2.5))
                || seg_hits(p(0.0, -50.0), p(0.0, ry + 2.0), &poly)
            {
                continue;
            }
            parts.push(Part {
                round: it.shape == "circle",
                ..part(it.u, poly)
            });
            break;
        }
    }
    let yard_c = p(0.0, ry + 2.0);
    let mut shapes: Vec<_> = parts.iter().map(|p| p.poly.clone()).collect();
    shapes.push(circle(yard_c, ry * 0.8, 10));
    let bb = bounds(&shapes);
    let du = -(bb.x0 + bb.x1) / 2.0;
    let dv = 2.0 - bb.y0;
    let hu = parts
        .iter()
        .find(|p| ["house", "longhouse", "hall"].contains(&p.use_.as_str()))
        .map(|p| {
            let b = bbox(&p.poly);
            (b.x0 + b.x1) / 2.0 + du
        })
        .unwrap_or(du);
    for p in &mut parts {
        p.poly = shift(&p.poly, du, dv);
    }
    Zone {
        parts,
        yard: shift(&circle(yard_c, ry * 0.8, 12), du, dv),
        walls: vec![],
        gate_u: du,
        entry: p(du, yard_c.y + dv),
        w: bb.x1 - bb.x0 + 2.0,
        d: bb.y1 - bb.y0 + 3.0,
        house_u: hu,
    }
}
fn ring_points(c: Point, rad: f64, a: f64, w: f64) -> Polygon {
    (0..=28)
        .map(|i| {
            let a = a + w / 2.0 + i as f64 / 28.0 * (2.0 * PI - w);
            p(c.x + rad * a.cos(), c.y + rad * a.sin())
        })
        .collect()
}
fn ring(x: &mut Ctx, kind: &str, plots: &mut Vec<Plot>) -> Zone {
    let si = x.si;
    let r = &mut x.r;
    let mut parts: Vec<Part> = vec![];
    let mut walls = vec![];
    let front = -PI / 2.0;
    if kind == "roundhouse" {
        let ro = selected(
            r,
            [(13.0, 16.0), (16.0, 20.0), (19.0, 24.0), (23.0, 28.0)],
            si,
        );
        let c = p(0.0, 3.0 + ro);
        let n = if si >= 2 { 2 } else { 1 };
        for i in 0..n {
            let dia = if i == 0 {
                selected(
                    r,
                    [(8.0, 10.0), (9.0, 12.0), (11.0, 13.0), (12.0, 14.0)],
                    si,
                )
            } else {
                r.range(7.0, 9.0)
            };
            let a = PI / 2.0
                + if i == 0 {
                    0.0
                } else {
                    (if r.chance(0.5) { 1.0 } else { -1.0 }) * 1.3
                };
            let d = if i == 0 {
                ro * 0.25
            } else {
                ro - dia / 2.0 - 2.5
            };
            parts.push(round_part(
                if i == 0 { "roundhouse" } else { "byre" },
                circle(
                    p(
                        c.x + a.cos() * d * if i == 0 { 0.0 } else { 1.0 },
                        c.y + a.sin() * d,
                    ),
                    dia / 2.0,
                    14,
                ),
            ));
        }
        for i in 0..1 + si {
            let a = front + 0.9 + i as f64 * 0.55 + r.range(-0.1, 0.1);
            let s = r.range(2.6, 3.4);
            let d = ro - 4.0;
            let pp = rect(c.x + a.cos() * d, c.y + a.sin() * d, s, s, a);
            if !parts.iter().any(|p| overlaps(&p.poly, &pp, 1.0)) {
                parts.push(part("granary", pp));
            }
        }
        walls.push(ring_points(c, ro, front, 0.32));
        return Zone {
            parts,
            yard: circle(c, ro - 1.0, 16),
            walls,
            gate_u: 0.0,
            entry: p(0.0, 6.0),
            w: 2.0 * ro + 3.0,
            d: 2.0 * ro + 4.0,
            house_u: 0.0,
        };
    }
    let n_hut = if kind == "ail" {
        [1, 2, 3, 4][si]
    } else {
        let ns = [2, r.int(3, 4), r.int(5, 6), r.int(7, 9)];
        ns[si] as usize
    };
    let hr = if kind == "ail" {
        r.range(2.8, 3.6)
    } else if kind == "sahel-compound" {
        r.range(2.2, 2.8)
    } else {
        r.range(2.3, 3.0)
    };
    let pen = if kind == "kraal" {
        [4.0, 5.0, 7.0, 9.0][si]
    } else if kind == "ail" {
        [4.0, 5.0, 6.0, 7.0][si]
    } else {
        0.0
    };
    let rh = (pen + hr + 3.5).max(n_hut as f64 * (2.0 * hr + 2.2) / (2.0 * PI - 1.2));
    let ro = rh + hr + 2.5;
    let c = p(0.0, 3.0 + ro);
    let span = 2.0 * PI - 1.2;
    for i in 0..n_hut {
        let a = front + 0.6 + span * (i as f64 + 0.5) / n_hut as f64;
        let big = i == n_hut / 2;
        let cc = p(c.x + a.cos() * rh, c.y + a.sin() * rh);
        if kind == "sahel-compound" && big && si >= 1 {
            parts.push(part("house", rect(cc.x, cc.y, 8.0, 5.0, a + PI / 2.0)));
        } else {
            parts.push(round_part(
                if kind == "ail" { "ger" } else { "hut" },
                circle(cc, if big { hr * 1.2 } else { hr }, 12),
            ));
        }
    }
    if kind != "ail" {
        let ng = if kind == "sahel-compound" { 2 + si } else { si };
        for i in 0..ng {
            let a = front + 0.45 + span * (i + 1) as f64 / (ng + 1) as f64;
            let d = rh - hr - 2.2;
            let pp = circle(p(c.x + a.cos() * d, c.y + a.sin() * d), 1.2, 8);
            if !parts.iter().any(|p| overlaps(&p.poly, &pp, 0.6)) && d > pen + 2.0 {
                parts.push(round_part("granary", pp));
            }
        }
    }
    if pen != 0.0 {
        walls.push(ring_points(c, pen, PI / 2.0, 0.5));
        plots.push(plot("pen", circle(c, pen - 0.3, 16)));
    }
    if kind != "ail" {
        walls.push(ring_points(c, ro, front, 0.32));
    }
    Zone {
        parts,
        yard: circle(c, ro - 0.8, 16),
        walls,
        gate_u: 0.0,
        entry: p(0.0, c.y - pen - 1.5),
        w: 2.0 * ro + 3.0,
        d: 2.0 * ro + 4.0,
        house_u: 0.0,
    }
}
fn ksar(x: &mut Ctx) -> Zone {
    let si = x.si;
    let r = &mut x.r;
    let q = selected(
        r,
        [(18.0, 22.0), (24.0, 30.0), (30.0, 36.0), (36.0, 44.0)],
        si,
    );
    let t = if si >= 1 { 4.5 } else { 0.0 };
    let d = r.range(4.0, 4.5);
    let (a, b, v0, v1) = (-q / 2.0, q / 2.0, 2.0, 2.0 + q);
    let mut parts = vec![];
    if t != 0.0 {
        let mut corners = vec![(a, v1), (b, v1)];
        if si >= 2 {
            corners.extend([(a, v0), (b, v0)]);
        }
        for (cu, cv) in corners {
            parts.push(part(
                "tower",
                rrect(
                    if cu == a { a } else { b - t },
                    if cv == v0 { v0 } else { v1 - t },
                    if cu == a { a + t } else { b },
                    if cv == v0 { v0 + t } else { v1 },
                ),
            ));
        }
    }
    let tf = if si >= 2 { t } else { 0.0 };
    parts.extend([
        part("house", rrect(a + t, v1 - d, b - t, v1)),
        part("storeroom", rrect(a, v0 + tf, a + d, v1 - t)),
        part("byre", rrect(b - d, v0 + tf, b, v1 - t)),
    ]);
    if si >= 3 {
        parts.push(passage("gatehouse", rrect(-3.5, v0, 3.5, v0 + d)));
    }
    let gl = if si >= 3 { 3.5 } else { 2.0 };
    let e = d.max(tf);
    if -gl - (a + e) >= 3.0 {
        parts.push(part("storeroom", rrect(a + e, v0, -gl, v0 + d)));
    }
    if b - e - gl >= 3.0 {
        parts.push(part("shed", rrect(gl, v0, b - e, v0 + d)));
    }
    Zone {
        parts,
        yard: rrect(a + d, v0 + d, b - d, v1 - d),
        walls: vec![vec![
            p(-2.0, v0),
            p(a, v0),
            p(a, v1),
            p(b, v1),
            p(b, v0),
            p(2.0, v0),
        ]],
        gate_u: 0.0,
        entry: p(0.0, v0 + d + 2.0),
        w: q + 2.0,
        d: v1 + 1.0,
        house_u: 0.0,
    }
}
fn zone_of(x: &mut Ctx, t: &str, tags: &mut Vec<String>, plots: &mut Vec<Plot>) -> Zone {
    let si = x.si;
    match t {
        "fungal-farm" => court(
            x,
            &[0, 1],
            tags,
            CourtOptions {
                walled: si >= 2,
                uses: vec!["house", if si == 0 { "byre" } else { "barn" }],
                ..Default::default()
            },
        ),
        "spore-farm" => ring(x, "roundhouse", plots),
        "vierkanthof" => court(
            x,
            &[0, 1, 2, 3],
            tags,
            CourtOptions {
                dovecote: true,
                ..Default::default()
            },
        ),
        "u-yard" => court(
            x,
            &[0, 1, 2],
            tags,
            CourtOptions {
                walled: si >= 2,
                dovecote: true,
                ..Default::default()
            },
        ),
        "l-yard" => court(
            x,
            &[0, if x.f.west.x < 0.0 { 1 } else { 2 }],
            tags,
            CourtOptions {
                walled: si >= 3,
                uses: vec!["house", if si == 0 { "byre" } else { "barn" }],
                dovecote: true,
                ..Default::default()
            },
        ),
        "masseria" => {
            if si == 0 {
                court(
                    x,
                    &[0, 1],
                    tags,
                    CourtOptions {
                        walled: true,
                        uses: vec!["house", "byre"],
                        ..Default::default()
                    },
                )
            } else {
                court(
                    x,
                    &[0, 1, 2],
                    tags,
                    CourtOptions {
                        walled: true,
                        tower: si >= 2,
                        dovecote: true,
                        ..Default::default()
                    },
                )
            }
        }
        "chinese-court" => court(
            x,
            if si >= 2 {
                &[0, 1, 2, 3]
            } else if si == 1 {
                &[0, 1, 2]
            } else {
                &[0, 1]
            },
            tags,
            CourtOptions {
                walled: si >= 1,
                gate_end: true,
                uses: vec!["house", "byre", "byre", "shed"],
                ..Default::default()
            },
        ),
        "indian-court" => court(
            x,
            if si >= 2 { &[0, 1, 2, 3] } else { &[0, 1, 2] },
            tags,
            CourtOptions {
                walled: si <= 1,
                uses: vec!["house", "byre", "storeroom"],
                depth: if si >= 2 { Some(5.0) } else { None },
                ..Default::default()
            },
        ),
        "kancha" => court(
            x,
            if si >= 1 { &[0, 1, 2, 3] } else { &[0, 1] },
            tags,
            CourtOptions {
                walled: true,
                uses: vec!["house", "house", "storeroom"],
                depth: Some(5.5),
                yard: Some([(9.0, 12.0), (11.0, 15.0), (14.0, 19.0), (18.0, 24.0)][si]),
                ..Default::default()
            },
        ),
        "minka" => court(
            x,
            if si >= 2 { &[0, 1, 2] } else { &[0, 1] },
            tags,
            CourtOptions {
                walled: si >= 3,
                uses: vec!["house", "storehouse", "barn"],
                yard: Some([(10.0, 13.0), (12.0, 16.0), (15.0, 20.0), (18.0, 24.0)][si]),
                ..Default::default()
            },
        ),
        "hanok" => court(
            x,
            if si >= 2 { &[0, 1, 2] } else { &[0, 1] },
            tags,
            CourtOptions {
                walled: true,
                uses: vec!["house", "byre", "storehouse"],
                ..Default::default()
            },
        ),
        "haufenhof" => {
            let r = &mut x.r;
            let mut it = vec![ld("house", si, r)];
            if si >= 1 {
                it.extend([ld("barn", si, r), ld("byre", si, r)]);
            }
            it.push(ld("shed", si, r));
            if si >= 1 {
                it.push(ld("bakehouse", si, r));
            }
            if si >= 2 {
                it.extend([ld("granary", si, r), ld("barn", si, r)]);
            }
            if si >= 3 {
                it.extend([ld("stable", si, r), item("dovecote", 4.6, 4.6, "circle")]);
            }
            scatter(x, it, false)
        }
        "norse-longhouse" => {
            let r = &mut x.r;
            let lh = selected(
                r,
                [(14.0, 18.0), (20.0, 28.0), (28.0, 36.0), (36.0, 45.0)],
                si,
            );
            let mut it = vec![item(
                "longhouse",
                lh,
                r.range(5.5, 7.5) + si as f64 * 0.4,
                "bow",
            )];
            if si >= 1 {
                it.push(item("barn", r.range(12.0, 16.0), r.range(5.5, 7.0), "bow"));
            }
            for _ in 0..1 + si {
                it.push(item(
                    "pit-house",
                    r.range(3.5, 4.5),
                    r.range(3.0, 3.5),
                    "rect",
                ));
            }
            if si >= 2 {
                it.extend([item("smithy", 5.0, 4.0, "rect"), ld("storehouse", si, r)]);
            }
            scatter(x, it, false)
        }
        "native-longhouse" => {
            let r = &mut x.r;
            let mut it = vec![];
            for i in 0..[1, 1, 2, 3][si] {
                it.push(item(
                    if i == 0 { "house" } else { "longhouse" },
                    r.range(18.0, 22.0) + si as f64 * 5.0,
                    r.range(6.0, 7.0),
                    "round",
                ));
            }
            for _ in 0..1 + si {
                it.push(item("granary", 3.0, 3.0, "rect"));
            }
            scatter(x, it, true)
        }
        "solar" => {
            let r = &mut x.r;
            let mut it = vec![
                item("house", r.range(8.0, 10.0), r.range(5.0, 6.0), "round"),
                item("kitchen", 5.0, 4.0, "rect"),
                item("granary", 3.2, 3.2, "circle"),
            ];
            for _ in 0..si {
                it.push(item(
                    "house",
                    r.range(8.0, 10.0),
                    r.range(5.0, 6.0),
                    "round",
                ));
            }
            if si >= 1 {
                it.push(item("bath", 3.0, 3.0, "circle"));
            }
            scatter(x, it, false)
        }
        "stilt" => {
            let r = &mut x.r;
            let mut it = vec![
                item("house", r.range(8.0, 12.0), r.range(5.0, 7.0), "rect"),
                item("granary", 3.5, 3.0, "rect"),
                item("byre", r.range(6.0, 8.0), r.range(4.0, 5.0), "rect"),
            ];
            for i in 0..si {
                it.push(item(
                    if i % 2 == 1 { "shed" } else { "house" },
                    r.range(7.0, 10.0),
                    r.range(5.0, 6.0),
                    "rect",
                ));
            }
            scatter(x, it, true)
        }
        "pueblo-ranch" => range(x, vec!["room"; 2 + si * 2], 5.0),
        "longere" => {
            let uses = match si {
                0 => vec!["house", "byre"],
                1 => vec!["house", "byre", "barn"],
                2 => vec!["house", "byre", "barn", "stable"],
                _ => vec!["house", "house", "stable", "barn", "barn"],
            };
            let d = if si == 0 {
                x.r.range(6.5, 7.5)
            } else {
                x.r.range(8.0, 9.0)
            };
            range(x, uses, d)
        }
        "einhaus" => hall(x, tags),
        "dvor" => dvor(x),
        "ksar" => ksar(x),
        "roundhouse" | "kraal" | "ail" | "sahel-compound" => ring(x, t, plots),
        // Every other type of the catalogue builds its own programme in its own layout.
        _ if data()["types"][t].is_object() => steading(x, t),
        _ => ring(x, t, plots),
    }
}
/// Footprint of a catalogue body at `c`, its long side along `ang`.
fn body(it: &Item, c: Point, ang: f64) -> Polygon {
    match it.shape {
        "circle" => circle(c, it.len / 2.0, 12),
        "bow" | "round" => longhouse(c, it.len.max(it.dep), it.dep, ang, it.shape == "bow"),
        _ => rect(c.x, c.y, it.len, it.dep, ang),
    }
}
fn body_part(it: &Item, poly: Polygon) -> Part {
    Part {
        round: it.shape == "circle",
        ..part(it.u, poly)
    }
}
/// Yard wall of a rectangular steading, open at the gate.
fn yard_wall(gate_u: f64, half: f64, d: f64) -> Polygon {
    vec![
        p(gate_u - 2.2, 0.9),
        p(-half - 0.9, 0.9),
        p(-half - 0.9, d - 0.6),
        p(half + 0.9, d - 0.6),
        p(half + 0.9, 0.9),
        p(gate_u + 2.2, 0.9),
    ]
}
/// Plan of a farm type from its catalogue record (`farmstead.types`, the record the
/// settlement farmsteads of urban/farmsteads.rs read): the house of the type's size,
/// its core buildings and a draw of its ancillary ones (more on a larger farm), at the
/// catalogue's footprints and the culture's body scale, laid out by the type's layout:
/// a court (closed, U, L), a row (linear, terraced), a round compound or a scatter.
fn steading(x: &mut Ctx, t: &str) -> Zone {
    let ty = &data()["types"][t];
    let table = &data()["buildings"];
    let si = x.si;
    let scale = crate::urban::activities::farm_scale(&x.c.culture);
    let layout = s(&ty["layout"]);
    let r = &mut x.r;
    let span = |v: &Value, lo: f64, hi: f64| {
        let a = v[0].as_f64().unwrap_or(lo);
        (a, v[1].as_f64().unwrap_or(hi).max(a))
    };
    // The house: its length grows with the farm's size inside the type's range.
    let hs = |k: usize, d: f64| ty["houseSize"][k].as_f64().unwrap_or(d);
    let hl = (hs(0, 8.0) + (hs(1, 13.0) - hs(0, 8.0)).max(0.0) * (si as f64 + r.float()) / 4.0) * scale;
    let hd = (hs(2, 6.0) + (hs(3, 9.0) - hs(2, 6.0)).max(0.0) * r.float()) * scale;
    // A people of round roofs lives in a round house (an oval one when it is long).
    let round_roof = ["conical", "dome", "thatch-round"].contains(&s(&ty["roof"]));
    let house_shape = if !round_roof || !["round", "scattered"].contains(&layout) {
        "rect"
    } else if hs(1, 13.0) <= hs(3, 9.0) + 1.0 {
        "circle"
    } else {
        "round"
    };
    let mut items = vec![item("house", hl.max(hd), hd, house_shape)];
    // Programme: the core buildings, then draws from the ancillary pool.
    let names = |key: &str| -> Vec<&'static str> {
        arr(&ty[key])
            .iter()
            .filter_map(Value::as_str)
            .filter(|l| table[*l].is_object())
            .collect()
    };
    let mut list = names("core");
    let pool = names("ancillary");
    let (lo, hi) = span(&ty["outbuildings"], 1.0, 3.0);
    let want = ((lo + (hi - lo) * (si as f64 + r.float()) / 4.0).round() as usize).max(list.len());
    while list.len() < want && !pool.is_empty() {
        list.push(pool[r.int(0, pool.len() as u32 - 1) as usize]);
    }
    for l in list {
        let b = &table[l];
        let (w0, w1) = span(&b["width"], 3.0, 5.0);
        let (d0, d1) = span(&b["depth"], 3.0, 4.0);
        let (w, d) = (r.range(w0, w1) * scale, r.range(d0, d1) * scale);
        // A round compound's small bodies (granaries, huts) are round too.
        let round = yes(&b["round"]) || layout == "round" && w * d <= 25.0 * scale * scale;
        items.push(item(l, w.max(d), w.min(d), if round { "circle" } else { "rect" }));
    }
    let (y0, y1) = span(&ty["yard"], 4.0, 9.0);
    let yard = r.range(y0, y1) * scale;
    let jitter = ty["jitter"].as_f64().unwrap_or(0.05);
    let enclosure = s(&ty["enclosure"]);
    match layout {
        "closed" => yard_court(x, &items, 3, yard, enclosure == "wall"),
        "u" => yard_court(x, &items, 2, yard, enclosure == "wall"),
        "l" => yard_court(x, &items, 1, yard, enclosure == "wall"),
        "linear" => row(x, &items, false, yard, enclosure == "wall"),
        "terraced" => row(x, &items, true, yard, enclosure == "wall"),
        "round" => compound(x, &items, yard, jitter, enclosure != "none"),
        _ => scatter(x, items, false),
    }
}
/// Catalogue court: the house on the back range and the long buildings on `sides` more
/// ranges round a rectangular yard (1: an L, 2: a U, 3: a closed court, the gate between
/// its front buildings); round bodies (well, dovecote, rick) stand in the yard's corners.
fn yard_court(x: &mut Ctx, items: &[Item], sides: usize, yard: f64, walled: bool) -> Zone {
    let wall_m = if walled { 1.5 } else { 0.0 };
    let fm = 2.0 + wall_m;
    let house = &items[0];
    let mut long: Vec<&Item> = items[1..].iter().filter(|i| i.shape == "rect").collect();
    long.sort_by(|a, b| (b.len * b.dep).total_cmp(&(a.len * a.dep)));
    // Ranges: 0 left, 1 right, 2 front left, 3 front right; the first on the lee side.
    let first = usize::from(x.f.west.x >= 0.0);
    let order: Vec<usize> = match sides {
        1 => vec![first],
        2 => vec![first, 1 - first],
        _ => vec![first, 1 - first, 2, 3],
    };
    let mut ranges: [Vec<&Item>; 4] = Default::default();
    for (k, it) in long.iter().enumerate() {
        ranges[order[k % order.len()]].push(*it);
    }
    let deep = |k: usize| ranges[k].iter().map(|i| i.dep).fold(0.0_f64, f64::max);
    let load = |k: usize| ranges[k].iter().map(|i| i.len + 0.6).sum::<f64>();
    let (dl, dr, df) = (deep(0), deep(1), deep(2).max(deep(3)));
    let open = yard + 6.0 + 2.0 * x.si as f64;
    let yd = open.max(load(0)).max(load(1));
    let yw = open
        .max(house.len - dl - dr)
        .max(2.0 * (load(2) + 2.2 - dl))
        .max(2.0 * (load(3) + 2.2 - dr));
    let (yv0, ul, ur) = (fm + df, -yw / 2.0 - dl, yw / 2.0 + dr);
    let yv1 = yv0 + yd;
    let hu = 0.0_f64.clamp(ul + house.len / 2.0, (ur - house.len / 2.0).max(ul + house.len / 2.0));
    let mut parts = vec![part(
        "house",
        rrect(hu - house.len / 2.0, yv1, hu + house.len / 2.0, yv1 + house.dep),
    )];
    for (k, range) in ranges.iter().enumerate() {
        let mut pos = 0.0;
        for it in range {
            let poly = match k {
                0 => rrect(-yw / 2.0 - it.dep, yv1 - pos - it.len, -yw / 2.0, yv1 - pos),
                1 => rrect(yw / 2.0, yv1 - pos - it.len, yw / 2.0 + it.dep, yv1 - pos),
                2 => rrect(ul + pos, yv0 - it.dep, ul + pos + it.len, yv0),
                _ => rrect(ur - pos - it.len, yv0 - it.dep, ur - pos, yv0),
            };
            parts.push(part(it.u, poly));
            pos += it.len + 0.6;
        }
    }
    let corners = [(-1.0, true), (1.0, true), (-1.0, false), (1.0, false)];
    for (it, (sd, back)) in items[1..].iter().filter(|i| i.shape != "rect").zip(corners) {
        let rad = it.len / 2.0;
        // Never on the way in from the gate.
        if yw / 2.0 - 2.0 * rad - 1.0 < 1.5 {
            continue;
        }
        let c = p(
            sd * (yw / 2.0 - rad - 1.0),
            if back { yv1 - rad - 1.0 } else { yv0 + rad + 1.0 },
        );
        parts.push(body_part(it, body(it, c, 0.0)));
    }
    let cu = (ul + ur) / 2.0;
    for q in &mut parts {
        q.poly = shift(&q.poly, -cu, 0.0);
    }
    let d = yv1 + house.dep + wall_m;
    Zone {
        parts,
        yard: shift(&rrect(-yw / 2.0, yv0, yw / 2.0, yv1), -cu, 0.0),
        walls: if walled {
            vec![yard_wall(-cu, (ur - ul) / 2.0, d)]
        } else {
            vec![]
        },
        gate_u: -cu,
        entry: p(-cu, yv0 + 1.5),
        w: ur - ul + 2.0 * wall_m,
        d,
        house_u: hu - cu,
    }
}
/// Catalogue row: the house and the long buildings in one line behind a front yard (a
/// linear farm), or stepped against each other (a terraced one); round and small bodies
/// stand at the two ends of the yard.
fn row(x: &mut Ctx, items: &[Item], stepped: bool, yard: f64, walled: bool) -> Zone {
    let wall_m = if walled { 1.5 } else { 0.0 };
    let fm = 2.0 + wall_m;
    let yc = yard + 5.0;
    let v0 = fm + yc;
    let house = &items[0];
    let mut parts = vec![part(
        "house",
        rrect(-house.len / 2.0, v0, house.len / 2.0, v0 + house.dep),
    )];
    let (mut lo, mut hi, mut top) = (-house.len / 2.0, house.len / 2.0, v0 + house.dep);
    let lee = x.f.west.x >= 0.0;
    let mut loose = vec![];
    let mut k = 0;
    for it in &items[1..] {
        if it.shape != "rect" || !stepped && it.len * it.dep <= 16.0 {
            loose.push(it);
            continue;
        }
        let right = (k % 2 == 0) == lee;
        let step = if stepped { 1.5 * (1 + k / 2) as f64 } else { 0.0 };
        let (a, b) = if right {
            (hi, hi + it.len)
        } else {
            (lo - it.len, lo)
        };
        parts.push(part(it.u, rrect(a, v0 + step, b, v0 + step + it.dep)));
        if right {
            hi = b;
        } else {
            lo = a;
        }
        top = top.max(v0 + step + it.dep);
        k += 1;
    }
    let (cu, half) = ((lo + hi) / 2.0, ((hi - lo) / 2.0).max(7.0));
    for q in &mut parts {
        q.poly = shift(&q.poly, -cu, 0.0);
    }
    let mut cursor = [fm + 1.0; 2];
    for (j, it) in loose.into_iter().enumerate() {
        let dep = if it.shape == "rect" { it.dep } else { it.len };
        let side = j % 2;
        // Inside the yard, clear of the way in from the gate.
        if cursor[side] + dep > v0 - 1.0 || half - it.len - 0.5 < 1.5 {
            continue;
        }
        let c = p(
            if side == 0 { -1.0 } else { 1.0 } * (half - it.len / 2.0 - 0.5),
            cursor[side] + dep / 2.0,
        );
        parts.push(body_part(it, body(it, c, 0.0)));
        cursor[side] += dep + 1.0;
    }
    let d = top + 1.0 + wall_m;
    Zone {
        parts,
        yard: rrect(-half, fm, half, v0),
        walls: if walled {
            vec![yard_wall(0.0, half, d)]
        } else {
            vec![]
        },
        gate_u: 0.0,
        entry: p(0.0, fm + yc / 2.0),
        w: 2.0 * half + 2.0 + 2.0 * wall_m,
        d,
        house_u: -cu,
    }
}
/// Catalogue compound: the house at the back of a round yard, the type's huts and stores
/// on its rim, their long side to the yard, inside a ring fence unless the type has none.
fn compound(x: &mut Ctx, items: &[Item], yard: f64, jitter: f64, fenced: bool) -> Zone {
    let r = &mut x.r;
    let radial = |it: &Item| if it.shape == "circle" { it.len } else { it.dep };
    let gap = 1.2;
    let arc = 2.0 * PI - gap;
    let around = items.iter().map(|it| it.len + 2.0).sum::<f64>()
        + items.iter().map(|it| it.len).fold(0.0_f64, f64::max);
    let deep = items.iter().map(radial).fold(0.0_f64, f64::max);
    // Rim of the bodies' centres: the yard's, or what the bodies need side by side
    // (measured on their inner faces, where they stand closest).
    let rh = (0.5 * yard + 2.0).max(around / arc) + deep / 2.0;
    let mut parts: Vec<Part> = vec![];
    // Angle taken on either side of the house, which stands at the back (PI / 2).
    let mut taken = [0.0_f64; 2];
    for (k, it) in items.iter().enumerate() {
        let half = (it.len / 2.0 + 1.0) / (rh - deep / 2.0);
        let a = if k == 0 {
            taken = [half; 2];
            PI / 2.0
        } else {
            let sd = usize::from(taken[1] < taken[0]);
            let a = PI / 2.0 + if sd == 1 { 1.0 } else { -1.0 } * (taken[sd] + half);
            if taken[sd] + 2.0 * half > arc / 2.0 {
                continue;
            }
            taken[sd] += 2.0 * half;
            a
        };
        let turn = if k == 0 { 0.0 } else { r.range(-1.0, 1.0) * jitter };
        let c = p(a.cos() * rh, a.sin() * rh);
        parts.push(body_part(it, body(it, c, a + PI / 2.0 + turn)));
    }
    let ro = parts
        .iter()
        .flat_map(|q| q.poly.iter())
        .map(|q| q.x.hypot(q.y))
        .fold(0.0_f64, f64::max)
        + 1.5;
    let c = p(0.0, 3.0 + ro);
    for q in &mut parts {
        q.poly = shift(&q.poly, c.x, c.y);
    }
    Zone {
        parts,
        yard: circle(c, ro - 0.8, 16),
        walls: if fenced {
            vec![ring_points(c, ro, -PI / 2.0, 0.32)]
        } else {
            vec![]
        },
        gate_u: 0.0,
        entry: p(0.0, c.y - 0.5 * (rh - deep / 2.0 - 1.0).max(0.0)),
        w: 2.0 * ro + 3.0,
        d: 2.0 * ro + 4.0,
        house_u: 0.0,
    }
}
fn arid(t: &str) -> bool {
    [
        "ksar",
        "masseria",
        "pueblo-ranch",
        "sahel-compound",
        "indian-court",
    ]
    .contains(&t)
}
pub fn frame(inward: Point, downhill: Option<Point>) -> Frame {
    let u = p(inward.y, -inward.x);
    let local = |w| p(dot(w, u), dot(w, inward));
    Frame {
        south: local(p(0.0, 1.0)),
        west: local(p(-1.0, 0.0)),
        down: downhill.map(local),
    }
}
pub fn layout(t: &str, si: usize, c: &Context, mut f: Frame, r: Rng) -> LocalFarm {
    if c.street_aligned_homes {
        f.south = p(0.0, -1.0);
        f.down = None;
    }
    let sub = c.biome == "underdark" || ["fungal-farm", "spore-farm"].contains(&t);
    let mut x = Ctx {
        c,
        f,
        si,
        r,
        slope_f: cl(c.slope / 0.16),
    };
    let mut tags = vec![];
    if x.slope_f > 0.35 {
        tags.push("slope".into());
    }
    if c.wet > 0.35 {
        tags.push("wet".into());
    }
    if c.exposed > 0.5 {
        tags.push("exposed".into());
    }
    let mut plots = vec![];
    let z = zone_of(&mut x, t, &mut tags, &mut plots);
    let r = &mut x.r;
    let mut parts: Vec<Part> = vec![];
    let mut home = false;
    for p_ in z.parts {
        let essential =
            !home && ["house", "longhouse", "roundhouse", "hut", "ger"].contains(&p_.use_.as_str());
        if essential {
            home = true;
        }
        if !essential && parts.iter().any(|q| overlaps(&q.poly, &p_.poly, 0.0)) {
            continue;
        }
        if !p_.passage && !essential && seg_hits(p(z.gate_u, -1.0), z.entry, &p_.poly) {
            continue;
        }
        parts.push(p_);
    }
    let side = if c.exposed > 0.5 { 4.0 } else { 2.0 };
    let w = z.w.max(14.0) + 2.0 * side;
    let db = if c.wet > 0.55 && si == 0 {
        0.0
    } else {
        selected(
            r,
            [(12.0, 18.0), (18.0, 26.0), (24.0, 32.0), (30.0, 40.0)],
            si,
        )
    };
    let dz = z.d;
    let d = dz + db;
    let mut lot_plots = vec![plot("farmyard", rrect(-w / 2.0, 0.0, w / 2.0, dz))];
    let mut trees = vec![];
    let mut pond_host: Option<Polygon> = None;
    if db > 0.0 {
        let g_share = if si == 0 { 0.6 } else { 0.4 };
        let gs = if z.house_u.abs() > 2.0 {
            z.house_u.signum()
        } else if f.south.x >= 0.0 {
            1.0
        } else {
            -1.0
        };
        let gw = w * g_share;
        let g = if gs > 0.0 {
            rrect(w / 2.0 - gw, dz, w / 2.0, d)
        } else {
            rrect(-w / 2.0, dz, -w / 2.0 + gw, d)
        };
        let o = if gs > 0.0 {
            rrect(-w / 2.0, dz, w / 2.0 - gw, d)
        } else {
            rrect(-w / 2.0 + gw, dz, w / 2.0, d)
        };
        let orchard = !sub
            && ![
                "kraal",
                "ail",
                "sahel-compound",
                "roundhouse",
                "norse-longhouse",
                "native-longhouse",
                "pueblo-ranch",
            ]
            .contains(&t)
            // A type without an enclosure (camps, clearings) keeps no orchard.
            && data()["types"][t]["enclosure"].as_str() != Some("none")
            && c.wet < 0.55;
        lot_plots.extend([
            plot("garden", g),
            plot(if orchard { "orchard" } else { "paddock" }, o.clone()),
        ]);
        pond_host = Some(o.clone());
        if orchard {
            let b = bbox(&o);
            let sp = if arid(t) { 8.0 } else { 7.0 };
            let mut u = b.x0 + 3.0;
            while u <= b.x1 - 3.0 {
                let mut v = b.y0 + 3.5;
                while v <= b.y1 - 2.5 {
                    trees.push(p(u + r.range(-0.6, 0.6), v + r.range(-0.6, 0.6)));
                    v += sp;
                }
                u += sp;
            }
        }
    }
    if let Some(o) = &pond_host {
        if (c.wet > 0.3 || si == 3 || t == "stilt") && !arid(t) {
            let b = bbox(o);
            let pr = if si == 3 {
                r.range(6.0, 8.0)
            } else {
                r.range(3.5, 5.5)
            }
            .min((b.x1 - b.x0) / 2.0 - 2.0)
            .min((b.y1 - b.y0) / 2.0 - 2.0);
            if pr > 2.5 {
                let du = if let Some(d) = f.down {
                    d.x
                } else if r.chance(0.5) {
                    1.0
                } else {
                    -1.0
                };
                let dv = f.down.map(|d| d.y).unwrap_or(1.0);
                let c = p(
                    if du >= 0.0 {
                        b.x1 - pr - 2.0
                    } else {
                        b.x0 + pr + 2.0
                    },
                    if dv >= 0.0 {
                        b.y1 - pr - 2.0
                    } else {
                        b.y0 + pr + 2.0
                    },
                );
                lot_plots.push(plot("pond", circle(c, pr, 14)));
                trees.retain(|&p| dist(p, c) >= pr + 2.5);
            }
        }
        if t == "masseria" || t == "ksar" {
            let b = bbox(o);
            let tr = 5.0_f64
                .min((b.y1 - b.y0) / 2.0 - 1.5)
                .min((b.x1 - b.x0) / 2.0 - 1.5);
            if tr > 3.0 {
                let c = p((b.x0 + b.x1) / 2.0, (b.y0 + b.y1) / 2.0);
                lot_plots.push(plot("threshing-floor", circle(c, tr, 12)));
                trees.retain(|&p| dist(p, c) >= tr + 2.5);
            }
        }
    }
    if c.exposed > 0.5 && !sub {
        let edges = [
            (
                p(-w / 2.0 + 1.5, 1.0),
                p(-w / 2.0 + 1.5, d - 1.0),
                p(-1.0, 0.0),
            ),
            (
                p(w / 2.0 - 1.5, 1.0),
                p(w / 2.0 - 1.5, d - 1.0),
                p(1.0, 0.0),
            ),
            (
                p(-w / 2.0 + 1.0, d - 1.5),
                p(w / 2.0 - 1.0, d - 1.5),
                p(0.0, 1.0),
            ),
        ];
        for (a, b, n) in edges {
            if dot(n, f.west) < 0.3 {
                continue;
            }
            let l = dist(a, b);
            let mut s = 0.0;
            while s <= l {
                let p = lerp(a, b, s / l);
                let shape = circle(p, 1.8, 6);
                let blocked = parts.iter().any(|q| overlaps(&q.poly, &shape, 0.0))
                    || lot_plots
                        .iter()
                        .any(|q| q.kind == "pond" && overlaps(&q.poly, &shape, 0.0));
                if !blocked && (p.x - z.gate_u).abs() > 4.0 {
                    trees.push(p);
                }
                s += 5.0;
            }
        }
    }
    if tags.iter().any(|s| s == "wet" || s == "warft") {
        plots.push(plot(
            "platform",
            rrect(-w / 2.0 + 0.5, 0.5, w / 2.0 - 0.5, dz - 0.5),
        ));
    }
    if sub {
        tags.push("fungal-cultivation".into());
        for p in lot_plots.iter_mut().chain(&mut plots) {
            if ["orchard", "paddock", "pen", "threshing-floor"].contains(&p.kind.as_str()) {
                p.kind = "garden".into();
            }
        }
    }
    lot_plots.extend(plots);
    LocalFarm {
        type_: t.into(),
        size: si,
        w,
        d,
        parts,
        yard: z.yard,
        walls: z.walls,
        plots: lot_plots,
        trees,
        gate_u: z.gate_u,
        entry: z.entry,
        tags,
    }
}
fn dress(t: &str, p: &Part, tags: &[String]) -> Value {
    let d = &data()["types"][t];
    let u = p.use_.as_str();
    let named = d["names"][u].as_str().unwrap_or(u);
    let mut arch = format!("{}-{named}", s(&d["arch"]));
    let mut roof = d["roofs"][u].as_str().unwrap_or(s(&d["roof"])).to_string();
    if u == "dovecote" {
        arch = "dovecote".into();
        roof = if p.round { "conical" } else { "pyramidal" }.into();
    } else if u == "tower" {
        arch = format!("{}-tower", s(&d["arch"]));
        roof = "flat".into();
    } else if u == "barn" && tags.iter().any(|s| s == "bank-barn") {
        arch = "bank-barn".into();
    } else if ["hut", "roundhouse", "ger"].contains(&u) {
        roof = match s(&d["roof"]) {
            "dome" => "dome",
            "conical" => "conical",
            _ => "thatch-round",
        }
        .into();
    } else if d["roofs"][u].is_null()
        && let Some(own) = data()["buildings"][u]["roof"].as_str()
    {
        // A catalogue building with a roof of its own (well, rick, tower) keeps it.
        roof = match own {
            "cone" => "conical",
            "pyramid" => "pyramidal",
            own => own,
        }
        .into();
    }
    if p.round && roof == "gable" {
        roof = "conical".into();
    }
    let storeys = if ["tower", "farm-tower", "pigeon-tower"].contains(&u) {
        3
    } else if u == "house" && ["masseria", "vierkanthof", "dvor"].contains(&t) {
        2
    } else {
        1
    };
    let mut use_ = u;
    if ["fungal-farm", "spore-farm"].contains(&t) {
        if ["barn", "byre", "hut"].contains(&u) {
            use_ = "cultivation";
        } else if ["granary", "shed"].contains(&u) {
            use_ = "spore-store";
        }
    }
    if tags.iter().any(|s| s == "wet") && ["stilt", "native-longhouse", "solar"].contains(&t) {
        arch += "-raised";
    }
    let mut v = serde_json::json!({"use":use_,"arch":arch,"roof":roof,"storeys":storeys,"material":d["mats"][u].as_str().unwrap_or(s(&d["material"]))});
    if p.passage {
        v["passage"] = true.into();
    }
    v
}
pub fn place(lf: &LocalFarm, o: Point, v: Point) -> Value {
    let u = p(v.y, -v.x);
    let point = |p: Point| super::geom::p(o.x + p.x * u.x + p.y * v.x, o.y + p.x * u.y + p.y * v.y);
    let poly = |a: &Polygon| a.iter().copied().map(point).collect::<Polygon>();
    let parts: Vec<_> = lf
        .parts
        .iter()
        .map(|p| {
            let mut d = dress(&lf.type_, p, &lf.tags);
            d["poly"] = serde_json::to_value(poly(&p.poly)).unwrap();
            d
        })
        .collect();
    serde_json::json!({"lot":poly(&rrect(-lf.w/2.0,0.0,lf.w/2.0,lf.d)),"parts":parts,"yard":poly(&lf.yard),"walls":lf.walls.iter().map(poly).collect::<Vec<_>>(),"plots":lf.plots.iter().map(|p|serde_json::json!({"kind":p.kind,"poly":poly(&p.poly)})).collect::<Vec<_>>(),"trees":lf.trees.iter().copied().map(point).collect::<Polygon>(),"gate":point(p(lf.gate_u,0.0)),"entry":point(lf.entry),"angle":u.y.atan2(u.x)})
}
pub fn seg_rect_dist(a: Point, b: Point, u0: f64, v0: f64, u1: f64, v1: f64) -> f64 {
    let (mut t0, mut t1) = (0.0_f64, 1.0_f64);
    let (dx, dy) = (b.x - a.x, b.y - a.y);
    let mut clip = |p: f64, q: f64| {
        if p == 0.0 {
            return q >= 0.0;
        }
        let t = q / p;
        if p < 0.0 {
            if t > t1 {
                return false;
            }
            t0 = t0.max(t);
        } else {
            if t < t0 {
                return false;
            }
            t1 = t1.min(t);
        }
        true
    };
    if clip(-dx, a.x - u0)
        && clip(dx, u1 - a.x)
        && clip(-dy, a.y - v0)
        && clip(dy, v1 - a.y)
        && t0 <= t1
    {
        return 0.0;
    }
    let pr = |p: Point| {
        (u0 - p.x)
            .max(0.0)
            .max(p.x - u1)
            .hypot((v0 - p.y).max(0.0).max(p.y - v1))
    };
    let mut best = pr(a).min(pr(b));
    for p in [p(u0, v0), p(u1, v0), p(u1, v1), p(u0, v1)] {
        best = best.min(dist(p, nearest(p, a, b)));
    }
    best
}
#[cfg(test)]
mod tests {
    use super::*;
    /// Two cultures on the same site build different farm types and ground plans; every
    /// building carries the massing of the town buildings in its culture's materials;
    /// the parts stay inside the lot, clear of each other.
    #[test]
    fn countryside_farms_follow_their_culture() {
        let farm = |people: &str| {
            let ctx = Context {
                culture: people.into(),
                slope: 0.02,
                market: 0.5,
                ..Context::default()
            };
            let mut r = Rng::new("countryside-farm");
            let kind = farm_type(&ctx, 1, &mut r);
            let lf = layout(&kind, 1, &ctx, frame(p(0.0, 1.0), None), r.fork("plan"));
            let mut g = place(&lf, p(500.0, 500.0), p(0.0, 1.0));
            super::super::rural_farms::farm_massing(&mut g, people, &kind, lf.size, "countryside-farm");
            (kind, lf, g)
        };
        let regime = |people: &str| -> Vec<&'static str> {
            arr(&culture(people)["types"]).iter().map(|v| s(&v[0])).collect()
        };
        let (gulf, plains) = (farm("gulf-contemporary"), farm("native-plains"));
        assert!(regime("gulf-contemporary").contains(&gulf.0.as_str()), "{}", gulf.0);
        assert!(regime("native-plains").contains(&plains.0.as_str()), "{}", plains.0);
        assert_ne!(gulf.0, plains.0);
        let plan = |lf: &LocalFarm| -> Vec<String> {
            lf.parts
                .iter()
                .map(|q| {
                    let b = bbox(&q.poly);
                    format!("{}:{:.0},{:.0}", q.use_, (b.x0 + b.x1) / 2.0, (b.y0 + b.y1) / 2.0)
                })
                .collect()
        };
        assert_ne!(plan(&gulf.1), plan(&plains.1));
        for (kind, lf, g) in [&gulf, &plains] {
            assert!(lf.parts.len() >= 2, "{kind}: a house and its outbuildings");
            for (i, q) in lf.parts.iter().enumerate() {
                assert!(
                    q.poly.iter().all(|v| v.x.abs() <= lf.w / 2.0 + 1e-6 && v.y >= -1e-6 && v.y <= lf.d + 1e-6),
                    "{kind}: {} outside the lot",
                    q.use_
                );
                for o in &lf.parts[..i] {
                    assert!(!overlaps(&q.poly, &o.poly, -0.05), "{kind}: {} overlaps {}", q.use_, o.use_);
                }
            }
            let parts = arr(&g["parts"]);
            assert_eq!(parts.len(), lf.parts.len());
            for b in parts {
                let piece = &b["massing"][0];
                assert!(
                    piece["wall"].is_string() && !arr(&piece["volumes"]).is_empty(),
                    "{kind}: {} without massing",
                    s(&b["use"])
                );
            }
        }
        // The dwellings stand in their own building tradition (hide tents, plastered blocks).
        let wall = |g: &Value| s(&g["parts"][0]["massing"][0]["wall"]).to_string();
        assert_ne!(wall(&gulf.2), wall(&plains.2));
    }
}
