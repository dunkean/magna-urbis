//! Site geometry and ground samples for building requests.

use super::*;

pub(super) fn access_segments(
    layout: &Layout,
    p: &Parcel,
    frontages: &super::super::parcels::FrontageIndex,
) -> Vec<Value> {
    let mut out=p.contacts.iter().filter(|c|c.kind!="unserved"&&c.kind!="reserved"&&c.length>0.1)
        .map(|c|json!({"id":format!("{}/street/{}",p.id,c.street),"segment":[c.a,c.b],
            "kind":if c.kind=="collective"{"collective"}else if c.kind=="private"{"private"}else{"public"},"width_m":c.length})).collect::<Vec<_>>();
    out.sort_by(|a, b| {
        b["width_m"]
            .as_f64()
            .unwrap_or(0.0)
            .total_cmp(&a["width_m"].as_f64().unwrap_or(0.0))
    });
    if !out.is_empty() {
        return out;
    }
    if let Some(front) = p.front
        && let Some(a) = &p.access
        && !matches!(a.kind.as_str(), "unserved" | "reserved")
    {
        out.push(json!({"id":format!("{}/front",p.id),"segment":front,"kind":a.kind,"width_m":a.front_length}));
        return out;
    }
    // A reservation keeps the same exact continuous contacts as the cadastre.
    out.extend(
        super::super::parcels::block_contacts_indexed(&p.shape, layout, frontages)
            .iter()
            .map(|c| {
                json!({
                    "id":format!("{}/reserved-street/{}",p.id,c.street),"segment":[c.a,c.b],
                    "kind":c.kind,"width_m":c.length
                })
            }),
    );
    out.sort_by(|a, b| {
        b["width_m"]
            .as_f64()
            .unwrap_or(0.0)
            .total_cmp(&a["width_m"].as_f64().unwrap_or(0.0))
    });
    out
}
/// Row-major physical samples; origin is the centre of the first source cell.
pub(super) fn ground_patch(surface: Surface<'_>, shape: &super::super::Shape) -> Value {
    let n = surface.height_resolution();
    let step = surface.width / n as f64;
    // A collapsed/invalid cut has no terrain grid. Clamp in floating point
    // before casting: infinite bounds used to overflow the index margins,
    // and an empty ring produced reversed indices and unsigned subtraction.
    if n == 0 || !step.is_finite() || step <= 0.0 || shape.outer.len() < 3
        || shape.outer.iter().any(|p| !p.x.is_finite() || !p.y.is_finite()) {
        return Value::Null;
    }
    let (mut x0, mut y0, mut x1, mut y1) = (
        f64::INFINITY,
        f64::INFINITY,
        f64::NEG_INFINITY,
        f64::NEG_INFINITY,
    );
    for p in &shape.outer {
        x0 = x0.min(p.x);
        y0 = y0.min(p.y);
        x1 = x1.max(p.x);
        y1 = y1.max(p.y);
    }
    let lo =
        |v: f64| ((v / step - 0.5).floor() - 1.0).clamp(0.0, (n - 1) as f64) as usize;
    let hi =
        |v: f64| ((v / step - 0.5).ceil() + 1.0).clamp(0.0, (n - 1) as f64) as usize;
    let (a, b, c, d) = (lo(x0), lo(y0), hi(x1), hi(y1));
    let mut heights = vec![];
    for y in b..=d {
        for x in a..=c {
            heights.push(surface.height_at(Point { x: (x as f64 + 0.5) * step, y: (y as f64 + 0.5) * step }) as f32);
        }
    }
    json!({"origin":{"x":(a as f64+0.5)*step,"y":(b as f64+0.5)*step},"step_m":step,
        "width":c-a+1,"height":d-b+1,"elevations_m":heights})
}
/// Actual shared cadastral segments, only where the cultural recipe permits party walls.
pub(super) fn shared_boundaries(a: &super::super::Shape, b: &super::super::Shape) -> Vec<[Point; 2]> {
    let mut out = vec![];
    for (&u, &v) in a
        .outer
        .iter()
        .zip(a.outer.iter().cycle().skip(1))
        .take(a.outer.len())
    {
        let length = (v.x - u.x).hypot(v.y - u.y);
        if length < 0.01 {
            continue;
        }
        let (dx, dy) = ((v.x - u.x) / length, (v.y - u.y) / length);
        for (&p, &q) in b
            .outer
            .iter()
            .zip(b.outer.iter().cycle().skip(1))
            .take(b.outer.len())
        {
            let side = |p: Point| ((p.x - u.x) * dy - (p.y - u.y) * dx).abs();
            if side(p) > 0.02 || side(q) > 0.02 {
                continue;
            }
            let t = |p: Point| (p.x - u.x) * dx + (p.y - u.y) * dy;
            let lo = t(p).min(t(q)).max(0.0);
            let hi = t(p).max(t(q)).min(length);
            if hi - lo > 0.1 {
                out.push([
                    Point {
                        x: u.x + lo * dx,
                        y: u.y + lo * dy,
                    },
                    Point {
                        x: u.x + hi * dx,
                        y: u.y + hi * dy,
                    },
                ]);
            }
        }
    }
    out
}
/// The farmhouse of a lone farm lot the occupation preview left empty: its culture's house
/// size (farmsteads.rs `house_size`), centred on the lot's interior point along its longest
/// side, shrunk until it stands inside the lot (None on a lot too small for a 4 m house).
pub(super) fn lone_farmhouse(lot: &super::super::Shape, culture: &str, seed: &str) -> Option<super::super::Shape> {
    let ring = &lot.outer;
    if ring.len() < 3 {
        return None;
    }
    let (a, b) = (0..ring.len()).map(|i| (ring[i], ring[(i + 1) % ring.len()]))
        .max_by(|p, q| (p.1.x - p.0.x).hypot(p.1.y - p.0.y).total_cmp(&(q.1.x - q.0.x).hypot(q.1.y - q.0.y)))?;
    let l = (b.x - a.x).hypot(b.y - a.y).max(1e-9);
    let (u, v) = (Point { x: (b.x - a.x) / l, y: (b.y - a.y) / l }, Point { x: -(b.y - a.y) / l, y: (b.x - a.x) / l });
    let c = super::super::geometry::interior_point(lot);
    let (w, d) = super::super::farmsteads::house_size(culture, seed);
    let scale = super::super::culture::house_parameters(culture).0;
    for k in [1.0, 0.8, 0.64, 0.5] {
        let (hw, hd) = (w * scale * k / 2.0, d * scale * k / 2.0);
        if hw.min(hd) < 2.0 {
            break;
        }
        let outer: Vec<Point> = [(-1.0, -1.0), (1.0, -1.0), (1.0, 1.0), (-1.0, 1.0)].iter()
            .map(|(s, t)| Point { x: c.x + u.x * s * hw + v.x * t * hd, y: c.y + u.y * s * hw + v.y * t * hd }).collect();
        let house = super::super::geometry::normalized(super::super::Shape { outer, holes: vec![] });
        if house.outer.iter().all(|&p| super::super::geometry::contains(lot, p)) {
            return Some(house);
        }
    }
    None
}

pub(super) fn ring_area(ring: &[Point]) -> f64 {
    ring.iter()
        .zip(ring.iter().cycle().skip(1))
        .map(|(a, b)| a.x * b.y - b.x * a.y)
        .sum::<f64>()
        .abs()
        * 0.5
}
