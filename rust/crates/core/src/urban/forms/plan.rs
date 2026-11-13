//! House plan grammar: a home as an assembly of whole rectangles.
//!
//! The occupation gives the body it would have built (one rectangle in the
//! lot's frame) and the room the lot leaves around it; the grammar composes a
//! plan of the home's kit in that room: a rear wing (L), a middle wing (T), two
//! wings around a yard (U), a taller cross-wing at one end (hall and
//! cross-wing) or at both (H), then the extras the kit allows (lean-to
//! outshot, porch, front bay, stair turret in the inner angle).
//!
//! Every part is a rectangle of the frame, parts never overlap and each
//! carries its label (`building` for the body, then `wing`, `crosswing`,
//! `outshot`, `porch`, `bay`, `turret`): `roles` raises them and `roof` joins
//! their roofs. The caller fits each part in its lot and drops the ones that
//! do not hold; the body always comes first.
//!
//! Rectangles are `[s0, s1, t0, t1]`: `s` along the home's front, `t` away
//! from it (the front wall at `t0`).
use super::kit::{self, HouseKit, Traits};
use crate::rng::Rng;
use serde_json::Value;

pub(in crate::urban) struct PlanInput<'a> {
    /// The body the occupation fitted (m).
    pub body: [f64; 4],
    /// The room parts may use around it: the lot's span in the same frame.
    pub free: [f64; 4],
    /// The tissue's `arch` and the building culture (they choose the kit).
    pub arch: &'a Value,
    pub culture: &'a str,
    pub wealth: f64,
    /// Village, hamlet or isolated home: room is not counted.
    pub rural: bool,
    pub farm: bool,
    pub seed: &'a str,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub(in crate::urban) struct PlanPart {
    pub rect: [f64; 4],
    pub label: &'static str,
}

/// Labels of a home's parts (the body and what the grammar adds to it).
pub(in crate::urban) fn is_house_part(label: &str) -> bool {
    matches!(label, "building" | "wing" | "crosswing" | "outshot" | "porch" | "bay" | "turret")
}

/// Thinnest side (m) a part of this label may keep when its lot narrows it.
pub(in crate::urban) fn min_side(label: &str) -> f64 {
    match label {
        "porch" => 1.0,
        "bay" => 0.8,
        "outshot" => 1.8,
        "turret" => 2.2,
        "wing" | "crosswing" => 3.0,
        _ => 3.0,
    }
}

fn kit_of<'a>(i: &PlanInput<'a>) -> &'static HouseKit {
    let (roof, pitch, cover, wall) = super::super::massing::house_traits(i.arch, i.culture);
    kit::house(i.culture, Traits { roof, pitch, cover, wall })
}

/// The home's parts, the body first.
pub(in crate::urban) fn house(i: &PlanInput) -> Vec<PlanPart> {
    compose(i, kit_of(i))
}

fn compose(i: &PlanInput, kit: &HouseKit) -> Vec<PlanPart> {
    let [x0, x1, t0, t1] = i.body;
    let (w, d) = (x1 - x0, t1 - t0);
    let body = PlanPart { rect: i.body, label: "building" };
    if w < 5.0 || d < 3.5 {
        return vec![body];
    }
    let mut rng = Rng::new(i.seed).fork("house-plan");
    let rear = (i.free[3] - t1).max(0.0);
    let front = (t0 - i.free[2]).max(0.0);
    let (left, right) = ((x0 - i.free[0]).max(0.0), (i.free[1] - x1).max(0.0));
    // Larger plans come with wealth and room: a cramped or poor lot keeps a bar.
    let means = ((i.wealth - 0.35) * 1.6).clamp(0.0, 1.0);
    let room = if i.rural { 1.0 } else { (rear / 8.0).clamp(0.0, 1.0) };
    let favour = 1.0 + kit.growth * (2.0 * means + room - 1.0) + if i.farm { 0.3 } else { 0.0 };
    let usable = |plan: &str| match plan {
        "bar" => true,
        "ell" => rear >= 3.2 && w >= 7.0,
        "tee" => rear >= 3.2 && w >= 9.0,
        "court" => rear >= 4.0 && w >= 11.0,
        "cross" => w >= 9.0 && rear >= 1.5,
        "aitch" => w >= 13.5 && rear >= 2.0,
        _ => false,
    };
    let plan = kit::draw(&kit.plans, &mut rng, &usable, &|k, wt| if k == "bar" { wt } else { wt * favour.max(0.1) }).unwrap_or("bar");
    // The wing's side on the lot: the end with the more room behind keeps the yard open to the other.
    let at_left = if (left - right).abs() > 2.0 { left < right } else { rng.chance(0.5) };
    let wing_w = |rng: &mut Rng| (rng.range(0.36, 0.52) * w).clamp(3.6, (1.05 * d).clamp(4.0, 7.5));
    let wing_d = |rng: &mut Rng| (rng.range(3.6, 6.5) * (1.0 + 0.35 * means)).min(rear - 0.4).max(3.0);
    let mut parts = vec![body];
    // The part of the rear wall still free for an outshot, and the inner angle a turret may take.
    let mut rear_free: Vec<[f64; 2]> = vec![[x0, x1]];
    let mut angle: Option<[f64; 2]> = None;
    match plan {
        "ell" => {
            let (ww, wd) = (wing_w(&mut rng), wing_d(&mut rng));
            let (a, b) = if at_left { (x0, x0 + ww) } else { (x1 - ww, x1) };
            parts.push(PlanPart { rect: [a, b, t1, t1 + wd], label: "wing" });
            rear_free = vec![if at_left { [b, x1] } else { [x0, a] }];
            angle = Some(if at_left { [b, 1.0] } else { [a, -1.0] });
        }
        "tee" => {
            let (ww, wd) = (wing_w(&mut rng), wing_d(&mut rng));
            let c = x0 + w * rng.range(0.4, 0.6);
            let (a, b) = ((c - ww * 0.5).max(x0 + 1.5), (c + ww * 0.5).min(x1 - 1.5));
            if b - a >= 3.2 {
                parts.push(PlanPart { rect: [a, b, t1, t1 + wd], label: "wing" });
                rear_free = vec![[x0, a], [b, x1]];
            }
        }
        "court" => {
            let ww = (rng.range(0.24, 0.32) * w).clamp(3.6, 6.5);
            let wd = wing_d(&mut rng).max(4.0).min(rear - 0.4);
            // Wings of slightly different lengths: a yard open to the back.
            let wd2 = (wd * rng.range(0.7, 1.0)).max(3.0);
            parts.push(PlanPart { rect: [x0, x0 + ww, t1, t1 + wd], label: "wing" });
            parts.push(PlanPart { rect: [x1 - ww, x1, t1, t1 + wd2], label: "wing" });
            rear_free = vec![];
        }
        "cross" | "aitch" => {
            // The cross-wing takes one end of the body (both for an H), deeper than it.
            let both = plan == "aitch";
            let cw = if both { (rng.range(0.24, 0.3) * w).clamp(4.2, 6.5) } else { (rng.range(0.3, 0.42) * w).clamp(4.5, 7.5) };
            let behind = rng.range(1.2, 4.0).min(rear - 0.3).max(0.0);
            let ahead = if front >= 0.8 { rng.range(0.0, 1.4).min(front - 0.2) } else { 0.0 };
            let (bl, br) = (if both || at_left { x0 + cw } else { x0 }, if both || !at_left { x1 - cw } else { x1 });
            parts[0].rect = [bl, br, t0, t1];
            if both || at_left {
                parts.push(PlanPart { rect: [x0, x0 + cw, t0 - ahead, t1 + behind], label: "crosswing" });
            }
            if both || !at_left {
                parts.push(PlanPart { rect: [x1 - cw, x1, t0 - ahead, t1 + behind], label: "crosswing" });
            }
            rear_free = vec![[bl, br]];
            if behind >= 2.6 && !both {
                angle = Some(if at_left { [bl, 1.0] } else { [br, -1.0] });
            }
        }
        _ => {}
    }
    // A stair turret in the inner angle of a wealthy home.
    if let Some([x, dir]) = angle
        && rng.chance(kit.turret * (0.5 + 2.0 * means))
    {
        let side = rng.range(2.6, 3.4);
        let (a, b) = if dir > 0.0 { (x, x + side) } else { (x - side, x) };
        if rear >= side + 0.3 && a >= x0 - 1e-6 && b <= x1 + 1e-6 {
            parts.push(PlanPart { rect: [a, b, t1, t1 + side], label: "turret" });
            rear_free = rear_free.iter().flat_map(|&[p, q]| [[p, a.min(q)], [b.max(p), q]]).filter(|r| r[1] - r[0] > 0.1).collect();
        }
    }
    // A lean-to along the free rear wall.
    if rear >= 2.4
        && rng.chance(kit.outshot)
        && let Some(&[a, b]) = rear_free.iter().max_by(|p, q| (p[1] - p[0]).total_cmp(&(q[1] - q[0])))
        && b - a >= 3.0
    {
        let len = (rng.range(0.5, 0.95) * (b - a)).max(3.0);
        let at = a + (b - a - len) * rng.float();
        let depth = rng.range(2.0, 3.2).min(rear - 0.3);
        parts.push(PlanPart { rect: [at, at + len, t1, t1 + depth], label: "outshot" });
    }
    // A gabled bay or a porch on the front, where the home stands back from its street.
    let bx = parts[0].rect;
    if front >= 1.1 && bx[1] - bx[0] >= 9.0 && rng.chance(kit.bay) {
        let bw = rng.range(3.0, 4.4);
        let c = bx[0] + (bx[1] - bx[0]) * rng.range(0.35, 0.65);
        let depth = rng.range(0.8, 1.5).min(front - 0.2);
        parts.push(PlanPart { rect: [c - bw * 0.5, c + bw * 0.5, t0 - depth, t0], label: "bay" });
    } else if front >= 1.2 && rng.chance(kit.porch) {
        let pw = rng.range(1.6, 2.8).min(bx[1] - bx[0] - 1.0);
        let c = bx[0] + pw * 0.5 + (bx[1] - bx[0] - pw) * rng.range(0.2, 0.8);
        let depth = rng.range(1.0, 1.7).min(front - 0.2);
        if pw >= 1.2 {
            parts.push(PlanPart { rect: [c - pw * 0.5, c + pw * 0.5, t0 - depth, t0], label: "porch" });
        }
    }
    parts
}

#[cfg(test)]
mod tests {
    use super::*;

    fn kit(plan: &str) -> HouseKit {
        HouseKit {
            plans: [(plan.to_string(), 1.0)].into_iter().collect(),
            outshot: 1.0,
            porch: 1.0,
            turret: 1.0,
            ..HouseKit::default()
        }
    }
    fn overlap(a: [f64; 4], b: [f64; 4]) -> f64 {
        ((a[1].min(b[1]) - a[0].max(b[0])).max(0.0)) * ((a[3].min(b[3]) - a[2].max(b[2])).max(0.0))
    }
    fn input(seed: &str) -> PlanInput<'_> {
        PlanInput { body: [10.0, 26.0, 4.0, 11.0], free: [0.0, 40.0, 0.0, 40.0], arch: &Value::Null, culture: "", wealth: 0.8, rural: true, farm: false, seed }
    }

    #[test]
    fn every_plan_keeps_whole_parts_that_never_overlap_and_stay_in_their_room() {
        for plan in ["bar", "ell", "tee", "court", "cross", "aitch"] {
            for seed in ["a", "b", "c", "d", "e", "f"] {
                let i = input(seed);
                let parts = compose(&i, &kit(plan));
                assert_eq!(parts[0].label, "building", "{plan}");
                if plan != "bar" && plan != "tee" {
                    assert!(parts.len() >= 2, "{plan} {seed}: {parts:?}");
                }
                for (k, p) in parts.iter().enumerate() {
                    let [a, b, c, d] = p.rect;
                    assert!(b - a >= min_side(p.label) - 1e-9 && d - c >= min_side(p.label) - 1e-9, "{plan} {seed}: thin {p:?}");
                    assert!(a >= i.free[0] && b <= i.free[1] && c >= i.free[2] && d <= i.free[3], "{plan} {seed}: outside {p:?}");
                    for q in &parts[k + 1..] {
                        assert!(overlap(p.rect, q.rect) < 1e-9, "{plan} {seed}: {p:?} over {q:?}");
                    }
                }
            }
        }
    }

    #[test]
    fn a_cramped_lot_keeps_a_bar() {
        let i = PlanInput { free: [10.0, 26.0, 4.0, 11.5], ..input("x") };
        assert_eq!(compose(&i, &kit("court")).len(), 1);
    }

    #[test]
    fn the_same_seed_gives_the_same_plan() {
        assert_eq!(compose(&input("s"), &kit("ell")), compose(&input("s"), &kit("ell")));
    }
}
