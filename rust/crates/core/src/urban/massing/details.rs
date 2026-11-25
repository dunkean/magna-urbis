//! Architectural details for roofs, homes, landmarks, and activity sites.

use super::*;

/// Regional family of a culture for roof-top detail (`maghreb`, `levant`,
/// `persian`, `pueblo`, `meso`; empty: none), from its style traits.
pub(super) fn flavor(culture: &str) -> &'static str {
    super::super::forms::kit::traits(culture).flavor.as_str()
}

/// Distance of `p` inside a convex ring (negative outside).
pub(super) fn depth_in(ring: &[Point], p: Point) -> f64 {
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
pub(super) fn flat_details(ring: &[Point], label: &str, fl: &str, wall: &str, wealth: f64, landmark: bool, rng: &mut Rng) -> (f64, Vec<Value>) {
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

/// A mass raised in receding tiers (`MassRule::tiers`): each tier stands on the
/// one below, its ring scaled about the centre; a skirt roof joins two tiers
/// (pagoda eaves); the last tier takes the mass's roof.
pub(super) fn tiered(v: Vol, t: &'static super::super::forms::roles::Tiers, rng: &mut Rng) -> Vec<Vol> {
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
            let plain = super::super::forms::roof::plain(top_kind);
            let r = roof_of(&ring, plain, v.pitch, v.axis, v.high);
            let form = if r.kind == plain { top_kind } else { r.kind };
            (r, form, None)
        } else if let Some(s) = t.skirt.filter(|s| s.rise > 0.0) {
            let next = scaled(k * (1.0 - inset));
            let pans = super::super::forms::roof::skirt(&ring, &next, z + h - 0.35 * s.rise, z + h + 0.65 * s.rise, s.overhang);
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
pub(super) fn home_details(v: &Vol, kit: &'static super::super::forms::kit::HouseKit, seed: &str, sc: f64, to_street: &dyn Fn(Point) -> Option<Point>) -> Vec<Vol> {
    let mut out = vec![];
    let f = frame_along(&v.ring, v.axis);
    if f.half_l < 1e-6 || f.half_w < 1e-6 {
        return out;
    }
    let nrm = perp(f.u);
    let at = |s: f64, t: f64| Point { x: f.c.x + f.u.x * s + nrm.x * t, y: f.c.y + f.u.y * s + nrm.y * t };
    let mass = super::super::forms::roof::Mass { ring: &v.ring, kind: v.form_roof, axis: v.axis, eave: v.eave, rise: v.roof.rise, overhang: 0.0, high: v.high };
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
            let Some(z) = super::super::forms::roof::height_at(&mass, p) else { continue };
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
            let Some(z) = super::super::forms::roof::height_at(&mass, at(s, ta)) else { continue };
            let ring = vec![at(s - wd * 0.5, ta), at(s + wd * 0.5, ta), at(s + wd * 0.5, tb), at(s - wd * 0.5, tb)];
            out.push(small(ring, z, z + 0.95 * sc, Roof { kind: "gable", rise: 0.45 * wd, ridges: vec![] }, "gable", nrm, v.cover, v.wall));
        }
    }
    out
}

/// Activity look (activities.json `looks`) a specialised service lot's bodies take.
#[derive(Clone, Copy)]
pub(super) struct LotLook {
    pub(super) name: &'static str,
    pub(super) roof: &'static str,
    pub(super) pitch: f64,
    /// Main body's eave (m) and storeys; other bodies take the low end.
    pub(super) eave: f64,
    pub(super) floors: u32,
    pub(super) eave_lo: f64,
    pub(super) floors_lo: u32,
    pub(super) chimney: bool,
    pub(super) wheel: bool,
    pub(super) sails: bool,
    pub(super) stilts: f64,
}
pub(super) fn lot_look(m: &Input, tr: &Tradition) -> Option<LotLook> {
    if m.archetype.is_empty() || tr.roof == "tent" || matches!(tr.form, "tree" | "mushroom" | "longhouse") { return None; }
    let a = super::super::activities::archetype(m.archetype)?;
    let (name, l) = super::super::activities::data().looks.get_key_value(a.look.as_deref()?)?;
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
pub(super) fn activity_details(v: &Vol, l: LotLook, has_wheel: bool, fronts: &[[Point; 2]], sc: f64) -> Vec<Vol> {
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
pub(super) fn sails_feature(v: &Vol, seed: &str) -> Option<Value> {
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
