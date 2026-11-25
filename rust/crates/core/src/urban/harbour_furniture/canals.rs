//! Boats moored along town canals.

use super::*;

/// Most boats moored in the canals of one town.
const MAX_CANAL_BOATS: usize = 80;
/// Clearance of a moored boat from a bridge deck or a lock gate (m).
const CANAL_CLEAR: f64 = 6.0;

pub(super) fn mean(ring: &[Point]) -> Point {
    let k = ring.len().max(1) as f64;
    Point { x: ring.iter().map(|p| p.x).sum::<f64>() / k, y: ring.iter().map(|p| p.y).sum::<f64>() / k }
}

/// Boats moored in town canals and rii, by the river rules of `Builder::berths`: alongside the bank and
/// parallel to the channel, the culture family's small craft only, at most three per reach, no beam above a
/// quarter of the channel (three quarters stay free); none within `CANAL_CLEAR` of a bridge deck or a lock
/// gate. Each boat floats on the canal water of the 3D view (the piece's bank height + 0.04, deck 1 m above
/// it, as `Builder::boat`). Idempotent: the boats of an earlier call are removed first.
pub(super) fn canal_boats(seed: &str, layout: &mut Layout) {
    let families = &data()["families"];
    let culture = layout.culture.clone();
    let family: &'static Value = families
        .as_object()
        .and_then(|m| m.values().find(|f| f["cultures"].as_array().is_some_and(|c| c.iter().any(|x| x.as_str() == Some(culture.as_str())))))
        .unwrap_or(&families["default"]);
    let Some(structure) = layout.structure.as_mut() else { return };
    let channel = |kind: &str| matches!(kind, "canal" | "rio");
    let rings: Vec<Vec<Point>> = structure.waterways.iter().filter(|w| channel(w.kind.as_str())).map(|w| w.shape.outer.clone()).collect();
    let keep_out: Vec<Point> =
        structure.waterways.iter().flat_map(|w| w.crossings.iter().chain(w.locks.iter())).map(|s| mean(&s.outer)).collect();
    let reaches: Vec<(Point, Point, f64, f64)> = structure
        .waterways
        .iter()
        .filter(|w| channel(w.kind.as_str()) && w.path.len() == 2)
        .map(|w| (w.path[0], w.path[1], w.width_m, w.bank_m))
        .collect();
    structure.quays.retain(|q| {
        !(matches!(q.kind.as_str(), "boat" | "cabin" | "mast" | "yard") && rings.iter().any(|r| inside(r, mean(&q.shape.outer))))
    });
    let Some(class) = family["boats"]["small"].as_str() else { return };
    let spec = &data()["boats"][class];
    let (length, beam) = (num(spec, "length", 0.0), num(spec, "beam", 0.0));
    if length <= 0.0 || beam <= 0.0 {
        return;
    }
    let mut rng = Rng::new(&format!("{seed}\u{1}canal-boats-v1"));
    let mut boats = 0;
    for (a, b, width, bank) in reaches {
        let len = dist(a, b);
        if beam > width * 0.25 || len < length + 4.0 {
            continue;
        }
        let t = Point { x: (b.x - a.x) / len, y: (b.y - a.y) / len };
        let n = left(t);
        let (mut s, mut moored) = (2.0 + length * 0.5, 0);
        while s + length * 0.5 + 2.0 <= len && moored < 3 && boats < MAX_CANAL_BOATS {
            let side = if rng.chance(0.5) { 1.0 } else { -1.0 };
            let c = add(add(a, t, s), n, side * (width * 0.5 - beam * 0.5 - 0.3));
            if rng.chance(0.55) && keep_out.iter().all(|&k| dist(k, c) > CANAL_CLEAR + length * 0.5) {
                let bow = if rng.chance(0.5) { t } else { neg(t) };
                let deck = bank + 0.04 + 1.0;
                structure.quays.push(Quay { kind: "boat".into(), shape: hull(c, bow, length, beam, text(spec, "hull", "round")), deck_z_m: deck, material: class.into() });
                if spec["cabin"].as_bool() == Some(true) {
                    let cabin = Obb { c: add(c, bow, -0.05 * length), u: bow, hl: 0.2 * length, hw: beam * 0.33 };
                    structure.quays.push(Quay { kind: "cabin".into(), shape: cabin.shape(), deck_z_m: deck, material: class.into() });
                }
                moored += 1;
                boats += 1;
            }
            s += length + 2.0 + 0.12 * length;
        }
    }
}
