//! Enclosure of lots (town) and fields (countryside), per culture (`enclosures.json`).
//! `plotEnclosure` 0 leaves every lot open, 1 closes the sides the culture closes;
//! `fieldEnclosure` is resolved here and consumed by the land-use stage.
use super::{Parcel, ParcelConfig, Point};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashSet;
use std::sync::OnceLock;

fn data() -> &'static Value {
    static DATA: OnceLock<Value> = OnceLock::new();
    DATA.get_or_init(|| serde_json::from_str(include_str!("enclosures.json")).expect("enclosure table"))
}

/// Resolved values of a culture, after the user's overrides.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct Resolved {
    pub plot: f64,
    pub field: f64,
    /// `wall|hedge|fence`.
    pub material: String,
    /// Boundary of the countryside fields (`hedge|wall|fence`); a forced `enclosureMaterial` wins.
    pub field_material: String,
    pub front: f64,
    pub side: f64,
    pub back: f64,
}
/// A run of lot boundary: `side` is `front|side|back`.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct LotEnclosure {
    pub path: Vec<Point>,
    pub material: String,
    pub side: String,
}

fn entry(culture: &str, key: &str) -> Option<&'static Value> {
    let d = data();
    d["cultures"].get(culture).and_then(|c| c.get(key)).or_else(|| {
        d["groups"].as_object()?.values()
            .find(|g| g["cultures"].as_array().is_some_and(|l| l.iter().any(|c| c == culture)))
            .and_then(|g| g.get(key))
    }).or_else(|| d["default"].get(key))
}
fn num(culture: &str, key: &str) -> f64 { entry(culture, key).and_then(Value::as_f64).unwrap_or(0.0) }

fn material_forced(cfg: &ParcelConfig) -> bool { ["wall", "hedge", "fence"].contains(&cfg.enclosure_material.as_str()) }
pub(super) fn resolve(culture: &str, cfg: &ParcelConfig) -> Resolved {
    let material = if material_forced(cfg) { cfg.enclosure_material.clone() }
        else { entry(culture, "material").and_then(Value::as_str).unwrap_or("fence").to_string() };
    Resolved {
        plot: cfg.plot_enclosure.unwrap_or_else(|| num(culture, "plot")).clamp(0.0, 1.0),
        field: cfg.field_enclosure.unwrap_or_else(|| num(culture, "field")).clamp(0.0, 1.0),
        field_material: if material_forced(cfg) { cfg.enclosure_material.clone() } else { entry(culture, "fieldMaterial").and_then(Value::as_str).unwrap_or("hedge").to_string() },
        material, front: num(culture, "front"), side: num(culture, "side"), back: num(culture, "back"),
    }
}
pub(super) fn valid(cfg: &ParcelConfig) -> bool {
    [cfg.plot_enclosure, cfg.field_enclosure].iter().flatten().all(|v| v.is_finite() && (0.0..=1.0).contains(v))
        && ["", "auto", "wall", "hedge", "fence"].contains(&cfg.enclosure_material.as_str())
}

/// Gap of a closed street front: a door for a town lot, a cart gate for a farm or compound.
pub(super) const DOOR_M: f64 = 1.4;
pub(super) const CART_GATE_M: f64 = 3.5;

fn key(a: Point, b: Point) -> (i64, i64, i64, i64) {
    let q = |p: Point| ((p.x * 10.0).round() as i64, (p.y * 10.0).round() as i64);
    let (a, b) = (q(a), q(b));
    if a <= b { (a.0, a.1, b.0, b.1) } else { (b.0, b.1, a.0, a.1) }
}
/// Deterministic draw in [0, 1) of one boundary edge (shared edges agree).
fn draw(seed: u64, k: (i64, i64, i64, i64)) -> f64 {
    let mut h = seed ^ 0x9e37_79b9_7f4a_7c15;
    for v in [k.0, k.1, k.2, k.3] {
        h = (h ^ (v as u64)).wrapping_mul(0xff51_afd7_ed55_8ccd);
        h ^= h >> 32;
    }
    (h >> 11) as f64 / (1u64 << 53) as f64
}
fn on_segment(p: Point, a: Point, b: Point, tol: f64) -> bool {
    let (dx, dy) = (b.x - a.x, b.y - a.y);
    let l2 = (dx * dx + dy * dy).max(1e-9);
    let t = (((p.x - a.x) * dx + (p.y - a.y) * dy) / l2).clamp(0.0, 1.0);
    (p.x - (a.x + t * dx)).hypot(p.y - (a.y + t * dy)) <= tol
}

/// Closed boundary runs of the built lots. Street fronts, sides and backs are
/// closed with probability `plot * weight`; an edge shared by two lots is drawn once.
pub(super) fn lot_enclosures(seed: &str, parcels: &[Parcel], r: &Resolved) -> Vec<LotEnclosure> {
    let mut out = Vec::new();
    if r.plot <= 0.0 { return out; }
    let seed = seed.bytes().fold(0xcbf2_9ce4_8422_2325u64, |h, b| (h ^ u64::from(b)).wrapping_mul(0x100_0000_01b3));
    let mut seen = HashSet::new();
    let push = |path: Vec<Point>, side: &str, out: &mut Vec<LotEnclosure>| {
        out.push(LotEnclosure { path, material: r.material.clone(), side: side.into() });
    };
    for p in parcels.iter().filter(|p| matches!(p.use_kind.as_str(), "plot" | "compound" | "garden")) {
        let ring = &p.shape.outer;
        let n = ring.len();
        if n < 3 { continue; }
        let fronts: Vec<[Point; 2]> = p.front.iter().copied()
            .chain(p.contacts.iter().map(|c| [c.a, c.b])).collect();
        let fdir = fronts.first().map(|f| {
            let (dx, dy) = (f[1].x - f[0].x, f[1].y - f[0].y);
            let l = dx.hypot(dy).max(1e-9);
            (dx / l, dy / l)
        });
        let area = (0..n).map(|i| ring[i].x * ring[(i + 1) % n].y - ring[(i + 1) % n].x * ring[i].y).sum::<f64>().abs() / 2.0;
        let gate = if p.use_kind == "compound" || area > 600.0 { CART_GATE_M } else { DOOR_M };
        let mut run: Vec<Point> = Vec::new();
        let mut run_side = "side";
        for i in 0..n {
            let (a, b) = (ring[i], ring[(i + 1) % n]);
            let (dx, dy) = (b.x - a.x, b.y - a.y);
            let len = dx.hypot(dy);
            if len < 0.5 { continue; }
            let mid = Point { x: (a.x + b.x) / 2.0, y: (a.y + b.y) / 2.0 };
            let par = |d: (f64, f64)| ((dx * d.0 + dy * d.1) / len).abs();
            let is_front = fdir.is_some_and(|d| par(d) > 0.9) && fronts.iter().any(|f| on_segment(mid, f[0], f[1], 1.0));
            let side = if is_front { "front" } else if fdir.is_none_or(|d| par(d) > 0.8) { "back" } else { "side" };
            let k = key(a, b);
            let weight = match side { "front" => r.front, "side" => r.side, _ => r.back };
            let closed = seen.insert(k) && draw(seed, k) < r.plot * weight;
            if closed && side == "front" && len > gate + 1.0 {
                // Opening where the lot is entered: a door (town lot) or a cart gate (farm compound).
                if run.len() > 1 { push(std::mem::take(&mut run), run_side, &mut out); } else { run.clear(); }
                let at = |t: f64| Point { x: a.x + dx * t, y: a.y + dy * t };
                // Centre on the street contact of the lot (its real access); the middle when it has none.
                let contact = p.contacts.iter().filter(|c| on_segment(Point { x: (c.a.x + c.b.x) / 2.0, y: (c.a.y + c.b.y) / 2.0 }, a, b, 1.0))
                    .max_by(|x, y| x.length.total_cmp(&y.length));
                let centre = contact.map_or(0.5, |c| {
                    let m = Point { x: (c.a.x + c.b.x) / 2.0, y: (c.a.y + c.b.y) / 2.0 };
                    ((m.x - a.x) * dx + (m.y - a.y) * dy) / (len * len)
                });
                let half = gate / (2.0 * len);
                let centre = centre.clamp(half, 1.0 - half);
                let (t0, t1) = (centre - half, centre + half);
                push(vec![a, at(t0)], "front", &mut out);
                run_side = "front"; run = vec![at(t1), b];
            } else if closed && !run.is_empty() && run_side == side { run.push(b); }
            else {
                if run.len() > 1 { push(std::mem::take(&mut run), run_side, &mut out); } else { run.clear(); }
                if closed { run_side = side; run = vec![a, b]; }
            }
        }
        if run.len() > 1 { push(run, run_side, &mut out); }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn lot(i: usize) -> Parcel {
        let x = i as f64 * 20.0;
        serde_json::from_value(json!({
            "id": format!("lot/{i}"), "block": 0, "use": "plot", "rank": 1, "axis": {"x": 1.0, "y": 0.0},
            "shape": {"outer": [{"x": x, "y": 0.0}, {"x": x + 20.0, "y": 0.0}, {"x": x + 20.0, "y": 30.0}, {"x": x, "y": 30.0}]},
            "front": [{"x": x, "y": 0.0}, {"x": x + 20.0, "y": 0.0}]
        })).unwrap()
    }
    fn edges(v: &[LotEnclosure], side: Option<&str>) -> usize {
        v.iter().filter(|e| side.is_none_or(|s| e.side == s)).map(|e| e.path.len() - 1).sum()
    }
    #[test]
    fn closed_front_opens_a_door_at_the_entrance() {
        let lots: Vec<Parcel> = (0..3).map(lot).collect();
        let mut cfg = ParcelConfig::default();
        cfg.plot_enclosure = Some(1.0);
        let all = lot_enclosures("s", &lots, &resolve("chinese", &cfg));
        let fronts: Vec<&LotEnclosure> = all.iter().filter(|e| e.side == "front").collect();
        for i in 0..3 {
            let cx = i as f64 * 20.0 + 10.0;
            // the front line is interrupted at the lot's middle, by a door-wide gap
            let covered: f64 = fronts.iter().flat_map(|e| e.path.windows(2)).filter(|w| w[0].y == 0.0 && w[1].y == 0.0 && w[0].x.min(w[1].x) >= cx - 10.0 && w[0].x.max(w[1].x) <= cx + 10.0)
                .map(|w| (w[1].x - w[0].x).abs()).sum();
            assert!((20.0 - covered - DOOR_M).abs() < 1e-6, "lot {i}: gap {}", 20.0 - covered);
            assert!(!fronts.iter().flat_map(|e| e.path.windows(2)).any(|w| w[0].x.min(w[1].x) < cx - 0.1 && w[0].x.max(w[1].x) > cx + 0.1));
        }
    }
    #[test]
    fn door_follows_the_street_contact() {
        let mut l = lot(0);
        l.contacts = vec![serde_json::from_value(json!({"a": {"x": 2.0, "y": 0.0}, "b": {"x": 6.0, "y": 0.0}, "street": 0, "rank": 1, "length": 4.0, "kind": "street"})).unwrap()];
        let mut cfg = ParcelConfig::default();
        cfg.plot_enclosure = Some(1.0);
        let all = lot_enclosures("s", &[l], &resolve("chinese", &cfg));
        let front: Vec<&LotEnclosure> = all.iter().filter(|e| e.side == "front").collect();
        // contact middle x = 4: the opening is [3.3, 4.7]
        assert!(front.iter().any(|e| (e.path.last().unwrap().x - (4.0 - DOOR_M / 2.0)).abs() < 1e-6));
        assert!(front.iter().any(|e| (e.path[0].x - (4.0 + DOOR_M / 2.0)).abs() < 1e-6));
    }
    #[test]
    fn plot_enclosure_zero_is_open_and_one_closes_every_non_street_side() {
        let lots: Vec<Parcel> = (0..6).map(lot).collect();
        let mut cfg = ParcelConfig::default();
        cfg.plot_enclosure = Some(0.0);
        assert!(lot_enclosures("s", &lots, &resolve("chinese", &cfg)).is_empty());
        cfg.plot_enclosure = Some(1.0);
        let r = resolve("chinese", &cfg);
        assert_eq!(r.material, "wall");
        let all = lot_enclosures("s", &lots, &r);
        // 6 backs + 7 distinct side walls (2 outer, 5 shared once) + 6 street fronts (walled culture)
        assert_eq!(edges(&all, Some("back")), 6);
        assert_eq!(edges(&all, Some("side")), 7);
        assert_eq!(edges(&all, Some("front")), 12); // each front is split by its door
        // an open-front culture leaves the street edges unclosed but closes every back yard
        let open = lot_enclosures("s", &lots, &resolve("hanseatic", &cfg));
        assert_eq!(edges(&open, Some("front")), 0);
        assert_eq!(edges(&open, Some("back")), 6);
        // every catalogue culture has an entry
        let catalogue: Value = serde_json::from_str(include_str!("catalogue.json")).unwrap();
        for c in catalogue["cultures"].as_object().unwrap().keys() {
            let listed = data()["groups"].as_object().unwrap().values()
                .any(|g| g["cultures"].as_array().unwrap().iter().any(|x| x == c.as_str()));
            assert!(listed, "culture {c} missing from enclosures.json");
        }
        cfg.enclosure_material = "bogus".into();
        assert!(!valid(&cfg));
    }
}
