//! Building scale, openings, and floor counts.

use super::*;

/// Inhabitants' size against a human (doors, windows, storeys): small folk build small.
pub(super) fn body_scale(culture: &str) -> f64 {
    let scale = super::super::forms::kit::traits(culture).body_scale;
    if scale > 0.0 { scale } else { 1.0 }
}

/// Facade openness 0..1 (windows per wall): thick masonry in hot dry or Mediterranean climates (the
/// Mediterranean and the flavored cultures) has few small openings, their light walls the openness the
/// culture states (wooden Ottoman houses: somewhat more); temperate and cold cultures are fully open (1).
/// A culture's own `openness` replaces all of this.
pub(super) fn facade_openness(culture: &str, wall: &str) -> f64 {
    let traits = super::super::forms::kit::traits(culture);
    if traits.openness > 0.0 {
        return traits.openness;
    }
    let masonry = matches!(wall, "stone" | "plaster" | "brick" | "earth" | "coral" | "concrete" | "ashlar");
    let warm = traits.mediterranean || !traits.flavor.is_empty();
    match (warm, masonry) { (true, true) => 0.5, (true, false) if traits.light_wall_openness > 0.0 => traits.light_wall_openness, _ => 1.0 }
}

/// Settlement size on 0..1: 500 inhabitants (or fewer) 0, 20 000 and more 1 (unknown: 1).
pub(super) fn size_of(population: u32) -> f64 {
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
    // A style with a height ladder (modern blocks) grades its heights from the
    // core like any town; the tower / house mix is the historical tower cultures'.
    if lo >= 4 && super::super::forms::kit::traits(m.culture).height_ladder.is_empty() {
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

pub(super) fn small_home(m: &Input) -> bool {
    m.small_home && m.zone != "core" && !m.landmark && !m.role.contains("tower")
        && matches!(m.function, "domestic" | "mixed")
        && m.parts.iter().all(|(_,l)| matches!(*l, "barn" | "byre" | "annex") || super::super::forms::plan::is_house_part(l) || super::super::farmsteads::is_outbuilding(l))
        && super::super::house_mix::ordinary_home(m.culture, m.arch, m.seed)
}

/// Lot-level floor count: the tradition's range by zone, pressure, wealth,
/// corner and a per-lot draw; roles pick their end of the range.
pub(super) fn lot_floors(m: &Input, tr: &Tradition, rng: &mut Rng) -> u32 {
    let [lo, hi] = tr.storeys;
    // Invariant (« gradient régulier »): height follows the lot's access
    // pressure along one curve in every zone (a core keeps a floor, as for
    // lot sizes); villages and hamlets stay low.
    let rural = matches!(m.zone, "village" | "hamlet" | "rural");
    let urban = if rural { 0.3 * m.pressure.clamp(0.0, 1.0) }
        else { super::super::zone_blend::floored(m.arch, m.zone, m.pressure.clamp(0.0, 1.0)) };
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
    // Near another phase (`zoneDensity: gradient`) the range leans toward its
    // storeys, capped by the same height ladder.
    let near = super::super::zone_blend::storeys_of(m.arch).map(|(w, o)| {
        let o = super::super::forms::kit::capped_storeys([o[0] as u32, o[1] as u32], super::super::forms::kit::storey_cap(m.culture, m.population, m.user_core));
        let [l, h] = super::super::zone_blend::mix([f64::from(lo), f64::from(hi)], Some((w, o.map(f64::from))));
        (l.round().max(1.0) as u32, h.round().max(1.0) as u32)
    });
    let (lo, hi) = near.map_or((lo, hi), |(l, h)| (l.min(h), h.max(l)));
    let mut floors = lo + ((hi - lo) as f64 * x.clamp(0.0, 1.0)).round() as u32;
    if matches!(m.function, "warehouse" | "workshop") || role.starts_with("storage") {
        floors = floors.min(lo + 1);
    }
    let floors = if small_home(m) { 1 } else { floors.clamp(lo, hi) };
    if small_home(m) { floors } else { gradient_floors(m, tr, floors) }
}
