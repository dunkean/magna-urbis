//! Countryside activity sites and monuments: mills by type, sawmills, forges,
//! kilns, mine heads, quarries, salt works, fishing stations, press houses, tithe
//! barns, dovecotes, watch and beacon towers, toll houses, hermitages, wayside
//! shrines and crosses, megaliths, barrows.
//!
//! See `mod.rs` for the contract: lay labelled, non-overlapping parts on the
//! site and return true for a role this family builds. Every role here starts
//! with `rural.`; a sub-role fixes a variant (`rural.windmill.post`), the bare
//! role lets the culture and the site's draw choose it. A free-standing form
//! keeps only parts of 4 m² or more, 1.5 m thick or more
//! (`parcels/standalone.rs`), so the smallest markers stand on a 2.1 m base.
//! The site's front (`ta`) is its access; water-driven works turn their wheel
//! against the back of the site.
use super::utility::{edges, end, laid};
use super::{Brief, Site};
use crate::rng::Rng;
use std::f64::consts::{FRAC_PI_2, PI, TAU};

pub(super) fn build(x: &mut Site, q: &Brief, rng: &mut Rng) -> bool {
    if !q.is("rural") {
        return false;
    }
    laid(x, |x| form(x, q, rng))
}

fn form(x: &mut Site, q: &Brief, rng: &mut Rng) -> bool {
    if q.is("rural.watermill") {
        watermill(x, q, rng)
    } else if q.is("rural.windmill") {
        windmill(x, q, rng)
    } else if q.is("rural.sawmill") {
        sawmill(x, rng)
    } else if q.is("rural.charcoal") {
        charcoal(x, rng)
    } else if q.is("rural.tar-works") {
        tar_works(x, rng)
    } else if q.is("rural.bloomery") {
        bloomery(x, rng)
    } else if q.is("rural.smelter") {
        smelter(x, rng)
    } else if q.is("rural.limekiln") {
        limekiln(x, rng)
    } else if q.is("rural.brickworks") {
        brickworks(x, q, rng)
    } else if q.is("rural.glasshouse") {
        glasshouse(x, q, rng)
    } else if q.is("rural.minehead") {
        minehead(x, rng)
    } else if q.is("rural.quarry") {
        quarry(x, rng)
    } else if q.is("rural.saltworks") {
        saltworks(x, q, rng)
    } else if q.is("rural.fishery") {
        fishery(x, rng)
    } else if q.is("rural.ferry") {
        ferry(x, rng)
    } else if q.is("rural.tollhouse") {
        tollhouse(x, q, rng)
    } else if q.is("rural.press") {
        press(x, q, rng)
    } else if q.is("rural.dovecote") {
        dovecote(x, q, rng)
    } else if q.is("rural.sheepfold") {
        sheepfold(x, q, rng)
    } else if q.is("rural.icehouse") {
        icehouse(x, q)
    } else if q.is("rural.oast") {
        oast(x, q, rng)
    } else if q.is("rural.tithe-barn") {
        tithe_barn(x, q, rng)
    } else if q.is("rural.granary") {
        raised_granaries(x, q)
    } else if q.is("rural.hunting-lodge") {
        hunting_lodge(x, rng)
    } else if q.is("rural.beacon") {
        beacon(x, q, rng)
    } else if q.any(&["rural.watchtower", "rural.signal"]) {
        watchtower(x, q, rng)
    } else if q.is("rural.border-post") {
        border_post(x, rng)
    } else if q.is("rural.wayside") {
        let kind = wayside_kind(q, rng);
        marker(x, kind)
    } else if q.is("rural.megalith") {
        megalith(x, q, rng)
    } else if q.is("rural.barrow") {
        barrow(x, q, rng)
    } else if q.is("rural.cairn") {
        marker(x, if folk(q) == "steppe" { "ovoo" } else { "cairn" })
    } else if q.is("rural.tomb") {
        tomb(x, q, rng)
    } else if q.is("rural.memorial") {
        let obelisk = q.family == "antique" || rng.chance(0.4);
        marker(x, if obelisk { "obelisk" } else { "column" })
    } else if q.is("rural.holy-well") {
        holy_well(x, q)
    } else if q.is("rural.hermitage") {
        hermitage(x, q, rng)
    } else if q.any(&["rural.chapel", "rural.bridge-chapel"]) {
        chapel(x, q, rng)
    } else if q.is("rural.grove") {
        grove(x, q)
    } else if q.is("rural.summit-temple") {
        summit_temple(x, q)
    } else if q.is("rural.cliff-monastery") {
        cliff_monastery(x, rng)
    } else if q.is("rural.rock-sanctuary") {
        rock_sanctuary(x)
    } else {
        false
    }
}

/// Activity family of the culture in `activities.json` (`european`, `islamic`,
/// `steppe`, `clan`…), empty for an unknown culture.
fn folk(q: &Brief) -> &'static str {
    crate::urban::activities::family_of(q.culture).map_or("", |f| f.0)
}

/// A square of side `w` centred on (`s`, `t`).
fn square(x: &mut Site, s: f64, t: f64, w: f64, label: &'static str) -> bool {
    x.rect(s - w * 0.5, s + w * 0.5, t - w * 0.5, t + w * 0.5, label)
}

/// Walls `th` thick round the rectangle `[s0, s1, t0, t1]`, a gate of `gate`
/// metres in the middle of the front one.
fn walls(x: &mut Site, [a, b, c, e]: [f64; 4], th: f64, gate: f64, label: &'static str) {
    let m = (a + b) * 0.5;
    x.rect(a, m - gate * 0.5, c, c + th, label);
    x.rect(m + gate * 0.5, b, c, c + th, label);
    x.rect(a, a + th, c + th, e - th, label);
    x.rect(b - th, b, c + th, e - th, label);
    x.rect(a, b, e - th, e, label);
}

/// Cultures whose corn mills turn a horizontal wheel under the stones (the
/// Norse, Balkan, Anatolian, Iranian and Himalayan mill).
fn horizontal_wheel(q: &Brief) -> bool {
    folk(q) == "norse"
        || matches!(q.culture, "caucasian-highland" | "byzantine-greek" | "himalayan-terraces" | "tibetan-monastery" | "newar" | "ottoman" | "persian" | "korean")
}

/// Water mill: the mill house at the back of the site with its wheel against
/// the rear wall (the race), a store against its front wall, the miller's
/// house on the access at the other end. `.fulling` dries its cloth in an
/// open shed, `.paper` in a louvred loft, `.hammer` is a forge with its stack
/// and fuel shed, `.tide` stands on its dam, `.horizontal` is a small hut
/// over its chute.
fn watermill(x: &mut Site, q: &Brief, rng: &mut Rng) -> bool {
    let (a, b, c, e) = edges(x);
    let (span, room) = (b - a, e - c);
    if span < 9.0 || room < 11.0 {
        return false;
    }
    let left = rng.chance(0.5);
    let horizontal = q.is("rural.watermill.horizontal") || (q.role == "rural.watermill" && horizontal_wheel(q) && rng.chance(0.7));
    if horizontal {
        let (mw, md) = ((0.4 * span).clamp(4.5, 6.0), (0.4 * room).clamp(5.0, 7.0));
        let (m0, m1) = end(a, b, mw, left);
        let back = e - 3.2;
        x.rect(m0, m1, back - md, back, "mill-hut");
        x.bar((m0 + m1) * 0.5, 2.2, back, e, "mill-chute");
        let hw = (span - mw - 2.5).min(7.0);
        if hw >= 4.5 {
            let (h0, h1) = end(a, b, hw, !left);
            x.rect(h0, h1, c, c + (0.34 * room).clamp(4.5, 6.0), "mill-dwelling");
        }
        return true;
    }
    let (hammer, tide) = (q.is("rural.watermill.hammer"), q.is("rural.watermill.tide"));
    let mw = (0.5 * span).clamp(7.0, if tide { 13.0 } else { 11.0 });
    let md = (0.42 * room).clamp(6.5, 10.0);
    let (m0, m1) = end(a, b, mw, left);
    let back = e - 2.2;
    x.rect(m0, m1, back - md, back, if hammer { "hammer-mill" } else { "mill-body" });
    let (ws, ww) = ((m0 + m1) * 0.5, (0.55 * mw).clamp(3.6, 5.5));
    x.bar(ws, ww, back, e, "mill-wheel");
    if tide {
        // The dam holding the mill pond, either side of the wheel.
        x.rect(a, ws - ww * 0.5 - 0.6, back + 0.2, e, "mill-dam");
        x.rect(ws + ww * 0.5 + 0.6, b, back + 0.2, e, "mill-dam");
    }
    if hammer {
        let (k0, k1) = if left { (m1, m1 + 2.2) } else { (m0 - 2.2, m0) };
        x.rect(k0, k1, back - md, back - md + 2.2, "works-stack");
    }
    let sd = (back - md - c - 1.0).min(5.0);
    if sd >= 3.0 {
        let (s0, s1) = end(m0, m1, 0.7 * mw, left);
        let label = if hammer {
            "fuel-shed"
        } else if q.is("rural.watermill.fulling") {
            "open-shed"
        } else if q.is("rural.watermill.paper") {
            "drying-loft"
        } else {
            "mill-store"
        };
        x.rect(s0, s1, back - md - sd, back - md, label);
    }
    let hw = (span - mw - 2.5).min(9.0);
    if hw >= 5.0 {
        let (h0, h1) = end(a, b, hw, !left);
        x.rect(h0, h1, c, c + (0.34 * room).clamp(5.0, 7.0), "mill-dwelling");
    }
    true
}

/// Windmill at the back of its plot, the miller's house and the store on the
/// access. `.post`: the timber buck over its roundhouse (or with its tail
/// ladder); `.tower`: a tapering masonry tower under a cap; `.smock`: an
/// eight-sided boarded tower; `.sailcloth`: the squat round tower of the
/// Mediterranean; `.vertical`: the Persian mill, a row of tall wind cells over
/// their grinding rooms. The bare role follows the culture.
fn windmill(x: &mut Site, q: &Brief, rng: &mut Rng) -> bool {
    let (a, b, c, e) = edges(x);
    let (span, room, m) = (b - a, e - c, (a + b) * 0.5);
    if span < 9.0 || room < 9.0 {
        return false;
    }
    let short = span.min(room);
    let (left, draw) = (rng.chance(0.5), rng.float());
    let kind = if q.is("rural.windmill.post") {
        "post"
    } else if q.is("rural.windmill.tower") {
        "tower"
    } else if q.is("rural.windmill.smock") {
        "smock"
    } else if q.is("rural.windmill.vertical") {
        "vertical"
    } else if q.is("rural.windmill.sailcloth") {
        "sailcloth"
    } else if q.family == "persian" {
        "vertical"
    } else if matches!(q.family, "maghreb" | "antique") || matches!(q.culture, "byzantine-greek" | "italian-comune" | "al-andalus" | "venetian-lagoon") {
        "sailcloth"
    } else if matches!(q.culture, "hanseatic" | "flemish-cloth-town") {
        if draw < 0.5 { "smock" } else { "tower" }
    } else if q.family == "orthodox" || draw < 0.4 {
        "post"
    } else if draw < 0.8 {
        "tower"
    } else {
        "smock"
    };
    // Depth the mill takes at the back of the plot.
    let taken = match kind {
        "vertical" => {
            let n = ((span / 3.8).floor() as usize).clamp(2, 6);
            let s0 = m - n as f64 * 1.9;
            for k in 0..n {
                let s = s0 + k as f64 * 3.8;
                x.rect(s, s + 3.8, e - 5.5, e, "asbad-cell");
            }
            x.rect(s0, s0 + n as f64 * 3.8, e - 9.0, e - 5.5, "asbad-room");
            9.0
        }
        "post" => {
            let tm = e - 4.4;
            let buck = [m - 1.8, m + 1.8, tm - 2.3, tm + 2.3];
            // The roundhouse hides the trestle; a small plot shows the tail ladder instead.
            if !(short >= 12.0 && super::utility::holed(x, [m - 3.7, m + 3.7, tm - 4.2, tm + 4.2], buck, "mill-roundhouse")) {
                x.bar(m, 2.2, tm + 2.3, e, "mill-tail");
            }
            x.rect(buck[0], buck[1], buck[2], buck[3], "mill-buck");
            8.6
        }
        "smock" => {
            let w = (0.36 * short).clamp(6.0, 7.2);
            square(x, m, e - 0.2 - w * 0.5, w, "mill-smock");
            w + 0.2
        }
        _ => {
            let r = if kind == "tower" { (0.17 * short).clamp(3.0, 3.8) } else { (0.15 * short).clamp(2.8, 3.4) };
            x.disk(m, e - 0.2 - 1.04 * r, r, if kind == "tower" { "mill-tower" } else { "mill-drum" });
            2.08 * r + 0.2
        }
    };
    let free = room - taken - 1.5;
    if free >= 4.5 {
        let hw = (0.42 * span).clamp(5.0, 8.0);
        let (h0, h1) = end(a, b, hw, left);
        x.rect(h0, h1, c, c + free.min(6.0), "mill-dwelling");
        let sw = (0.3 * span).clamp(4.0, 6.0);
        if span >= hw + sw + 2.0 {
            let (s0, s1) = end(a, b, sw, !left);
            x.rect(s0, s1, c, c + free.min(5.0), "mill-store");
        }
    }
    true
}

/// Sawmill: the open saw shed along the race at the back, its wheel at one
/// end and the log yard at the other, the sawn timber stacked along the
/// access beside the sawyer's house.
fn sawmill(x: &mut Site, rng: &mut Rng) -> bool {
    let (a, b, c, e) = edges(x);
    let (span, room) = (b - a, e - c);
    if span < 12.0 || room < 14.0 {
        return false;
    }
    let left = rng.chance(0.5);
    let sd = (0.3 * room).clamp(5.0, 7.0);
    let ls = (0.62 * span).clamp(9.0, 22.0);
    let back = e - 2.2;
    let (s0, s1) = end(a, b, ls, left);
    x.rect(s0, s1, back - sd, back, "saw-shed");
    let (w0, w1) = end(s0, s1, 4.4, left);
    x.rect(w0, w1, back, e, "mill-wheel");
    let free = span - ls - 1.5;
    if free >= 2.6 {
        let (l0, l1) = end(a, b, free.min(6.0), !left);
        x.rect(l0, l1, back - sd, back, "log-pile");
    }
    let (h0, h1) = end(a, b, (0.35 * span).clamp(5.0, 7.5), !left);
    x.rect(h0, h1, c, c + 5.0, "mill-dwelling");
    let (q0, q1) = if left { (a, h0 - 1.5) } else { (h1 + 1.5, b) };
    let n = (((q1 - q0 + 1.2) / 7.2).floor().max(0.0) as usize).min(3);
    for k in 0..n {
        let s = if left { q0 + k as f64 * 7.2 } else { q1 - 6.0 - k as f64 * 7.2 };
        x.rect(s, s + 6.0, c + 0.5, c + 2.9, "timber-stack");
    }
    true
}

/// Charcoal burners' camp: one to three turf-covered clamps in a row, the
/// burner's hut and the cordwood stacked on the access side.
fn charcoal(x: &mut Site, rng: &mut Rng) -> bool {
    let (a, b, c, e) = edges(x);
    let (span, room) = (b - a, e - c);
    if span < 10.0 || room < 10.0 {
        return false;
    }
    let r = (0.16 * span.min(1.4 * room)).clamp(2.4, 3.6);
    let k = 2.08 * r;
    let n = (((span + 1.5) / (k + 1.5)).floor() as usize).clamp(1, 3);
    let total = n as f64 * k + (n - 1) as f64 * 1.5;
    let s = (a + b - total) * 0.5;
    for i in 0..n {
        x.disk(s + k * 0.5 + i as f64 * (k + 1.5), e - k * 0.5, r, "charcoal-clamp");
    }
    if room - k - 1.5 >= 3.6 {
        let left = rng.chance(0.5);
        let (h0, h1) = end(a, b, 3.6, left);
        x.rect(h0, h1, c, c + 3.6, "burner-hut");
        if span >= 10.5 {
            let (w0, w1) = end(a, b, 5.0, !left);
            x.rect(w0, w1, c, c + 2.2, "cordwood");
        }
    }
    true
}

/// Tar and resin works: the round tar kiln under its turf, the boiling house
/// beside it, an open barrel shed on the access.
fn tar_works(x: &mut Site, rng: &mut Rng) -> bool {
    let (a, b, c, e) = edges(x);
    let (span, room) = (b - a, e - c);
    if span < 10.0 || room < 10.0 {
        return false;
    }
    let left = rng.chance(0.5);
    let r = (0.18 * span).clamp(2.4, 3.4);
    let k = 2.08 * r;
    let (k0, k1) = end(a, b, k, left);
    x.disk((k0 + k1) * 0.5, e - k * 0.5, r, "tar-kiln");
    let hw = (span - k - 1.5).min(6.0);
    if hw >= 3.5 {
        let (h0, h1) = end(a, b, hw, !left);
        x.rect(h0, h1, e - 5.0, e, "boiling-house");
    }
    if room - k.max(5.0) - 1.5 >= 3.0 {
        let (s0, s1) = end(a, b, span.min(8.0), left);
        x.rect(s0, s1, c, c + 3.0, "open-shed");
    }
    true
}

/// Bloomery: the open smithing shed, one or two shaft furnaces behind it, the
/// charcoal store at the other end of the yard.
fn bloomery(x: &mut Site, rng: &mut Rng) -> bool {
    let (a, b, c, e) = edges(x);
    let (span, room) = (b - a, e - c);
    if span < 10.0 || room < 10.0 {
        return false;
    }
    let left = rng.chance(0.5);
    let (sw, sd) = ((0.55 * span).clamp(6.0, 9.0), (0.45 * room).clamp(5.0, 7.0));
    let (s0, s1) = end(a, b, sw, left);
    x.rect(s0, s1, c, c + sd, "bloomery-shed");
    if c + sd + 3.4 <= e {
        let furnaces = if sw >= 7.5 { 2 } else { 1 };
        for i in 0..furnaces {
            x.disk(s0 + 1.6 + i as f64 * 3.4, c + sd + 2.0, 1.3, "shaft-furnace");
        }
    }
    let fw = (span - sw - 1.5).min(5.0);
    if fw >= 3.0 {
        let (f0, f1) = end(a, b, fw, !left);
        x.rect(f0, f1, c, c + (0.4 * room).clamp(4.0, 6.0), "fuel-shed");
    }
    true
}

/// Smelter: the smelting house on the access with its stack against the rear
/// gable, the ore shed and the fuel shed down the other side of the yard.
fn smelter(x: &mut Site, rng: &mut Rng) -> bool {
    let (a, b, c, e) = edges(x);
    let (span, room) = (b - a, e - c);
    if span < 12.0 || room < 14.0 {
        return false;
    }
    let left = rng.chance(0.5);
    let (hw, hd) = ((0.5 * span).clamp(7.0, 10.0), (0.5 * room).clamp(8.0, 13.0));
    let (h0, h1) = end(a, b, hw, left);
    x.rect(h0, h1, c, c + hd, "smelt-house");
    if c + hd + 2.4 <= e {
        x.bar((h0 + h1) * 0.5, 2.4, c + hd, c + hd + 2.4, "smelter-stack");
    }
    let fw = (span - hw - 2.0).min(6.0);
    if fw >= 3.5 {
        let (f0, f1) = end(a, b, fw, !left);
        let half = (room - 1.5) * 0.5;
        x.rect(f0, f1, c, c + half.min(9.0), "ore-shed");
        x.rect(f0, f1, e - half.min(7.0), e, "fuel-shed");
    }
    true
}

/// Lime kiln: the massive draw kiln (a bank of two on a wide site), its
/// loading ramp behind and the lean-to over the draw arches in front.
fn limekiln(x: &mut Site, rng: &mut Rng) -> bool {
    let (a, b, c, e) = edges(x);
    let (span, room, m) = (b - a, e - c, (a + b) * 0.5);
    if span < 9.0 || room < 10.0 {
        return false;
    }
    let double = span >= 16.0 && rng.chance(0.5);
    let kw = (0.4 * span).clamp(5.5, 7.0);
    let kd = kw.min(room - 4.0);
    if kd < 4.5 {
        return false;
    }
    let (t0, t1) = (e - 3.5 - kd, e - 3.5);
    let blocks = if double { vec![-0.5, 0.5] } else { vec![0.0] };
    for k in blocks {
        let s = m + k * kw;
        x.bar(s, kw, t0, t1, "lime-kiln");
        x.bar(s, 3.0, t1, e, "kiln-ramp");
        if t0 - c >= 3.0 {
            x.bar(s, 0.8 * kw, t0 - 3.0, t0, "lime-shed");
        }
    }
    true
}

/// Brick and tile works: the kiln (or the clamp of fired bricks under its
/// earth casing) at a rear corner, the horse-driven pug mill at the other,
/// rows of low drying sheds across the front of the yard.
fn brickworks(x: &mut Site, q: &Brief, rng: &mut Rng) -> bool {
    let (a, b, c, e) = edges(x);
    let (span, room) = (b - a, e - c);
    if span < 16.0 || room < 14.0 {
        return false;
    }
    let left = rng.chance(0.5);
    let clamp = matches!(folk(q), "african" | "native" | "ancient" | "mesoamerican" | "andean" | "clan") || rng.chance(0.3);
    let kd = (0.4 * room).clamp(6.0, 9.0);
    let (k0, k1) = end(a, b, 5.5, left);
    x.rect(k0, k1, e - kd, e, if clamp { "brick-clamp" } else { "brick-kiln" });
    let (p0, p1) = end(a, b, 4.6, !left);
    x.disk((p0 + p1) * 0.5, e - 2.4, 2.2, "pug-mill");
    let rows = (((room - kd - 1.5 + 1.6) / 4.4).floor().max(0.0) as usize).min(4);
    for k in 0..rows {
        let t = c + k as f64 * 4.4;
        x.rect(a, b.min(a + 26.0), t, t + 2.8, "hack-shed");
    }
    true
}

/// Glass house: the furnace hall with its stack against the rear gable, the
/// fuel shed and the cordwood beside it; `.cone` (and some western works) is
/// the brick cone over the furnace with the glass shop on the access.
fn glasshouse(x: &mut Site, q: &Brief, rng: &mut Rng) -> bool {
    let (a, b, c, e) = edges(x);
    let (span, room, m) = (b - a, e - c, (a + b) * 0.5);
    if span < 12.0 || room < 12.0 {
        return false;
    }
    let left = rng.chance(0.5);
    if q.is("rural.glasshouse.cone") || (q.family == "western" && rng.chance(0.35)) {
        let r = (0.26 * span.min(room)).clamp(4.0, 5.5);
        x.disk(m, e - 0.2 - 1.04 * r, r, "glass-cone");
        let free = room - 2.08 * r - 1.7;
        if free >= 4.0 {
            x.bar(m, (0.6 * span).clamp(6.0, 10.0), c, c + free.min(5.5), "glass-shop");
        }
        return true;
    }
    let (hw, hd) = ((0.55 * span).clamp(7.0, 10.0), (0.6 * room).clamp(8.0, 12.0));
    let (h0, h1) = end(a, b, hw, left);
    x.rect(h0, h1, c, c + hd, "glass-house");
    if c + hd + 2.2 <= e {
        x.bar((h0 + h1) * 0.5, 2.2, c + hd, c + hd + 2.2, "works-stack");
    }
    let fw = (span - hw - 1.5).min(5.0);
    if fw >= 3.0 {
        let (f0, f1) = end(a, b, fw, !left);
        x.rect(f0, f1, c, c + 5.0, "fuel-shed");
        if room >= 9.0 {
            x.rect(f0, f1, e - 2.2, e, "cordwood");
        }
    }
    true
}

/// Mine head: the shaft house and its headframe at the back, the round horse
/// whim beside them, the ore shed and the washing floor on the access, the
/// ore store between on a deep site.
fn minehead(x: &mut Site, rng: &mut Rng) -> bool {
    let (a, b, c, e) = edges(x);
    let (span, room) = (b - a, e - c);
    if span < 16.0 || room < 14.0 {
        return false;
    }
    let left = rng.chance(0.5);
    let (s0, s1) = end(a, b, 5.5, left);
    x.rect(s0, s1, e - 6.5, e, "shaft-house");
    let (f0, f1) = if left { (s1, s1 + 2.4) } else { (s0 - 2.4, s0) };
    x.rect(f0, f1, e - 4.5, e - 2.1, "headframe");
    let r = (0.14 * span).clamp(3.4, 4.5);
    let (g0, g1) = end(a, b, 2.08 * r, !left);
    x.disk((g0 + g1) * 0.5, e - 0.1 - 1.04 * r, r, "gin-house");
    let (o0, o1) = end(a, b, (0.42 * span).clamp(6.0, 10.0), left);
    x.rect(o0, o1, c, c + 4.5, "ore-shed");
    let (w0, w1) = end(a, b, (0.3 * span).clamp(4.5, 8.0), !left);
    x.rect(w0, w1, c + 0.5, c + 4.5, "washing-floor");
    let (mid0, mid1) = (c + 6.0, e - 6.5_f64.max(2.08 * r + 0.3) - 1.5);
    if mid1 - mid0 >= 4.0 {
        x.rect(o0, o1.min(o0 + 8.0), mid0, mid0 + (mid1 - mid0).min(5.5), "ore-store");
    }
    true
}

/// Quarry: the masons' open cutting shed on the access and the tool smith's
/// hut beside it, the crane on its round base towards the face, the dressed
/// stone stacked along the back.
fn quarry(x: &mut Site, rng: &mut Rng) -> bool {
    let (a, b, c, e) = edges(x);
    let (span, room) = (b - a, e - c);
    if span < 14.0 || room < 12.0 {
        return false;
    }
    let left = rng.chance(0.5);
    let (sl, sd) = ((0.6 * span).clamp(9.0, 16.0), (0.32 * room).clamp(4.5, 6.0));
    let (s0, s1) = end(a, b, sl, left);
    x.rect(s0, s1, c, c + sd, "cutting-shed");
    let hw = (span - sl - 1.5).min(4.5);
    if hw >= 3.0 {
        let (h0, h1) = end(a, b, hw, !left);
        x.rect(h0, h1, c, c + 4.0, "smith-hut");
    }
    x.disk(if left { b - 1.9 } else { a + 1.9 }, e - 1.9, 1.7, "quarry-crane");
    let (q0, q1) = if left { (a, b - 5.5) } else { (a + 5.5, b) };
    let n = (((q1 - q0 + 1.5) / 5.1).floor().max(0.0) as usize).min(3);
    for k in 0..n {
        let s = if left { q0 + k as f64 * 5.1 } else { q1 - 3.6 - k as f64 * 5.1 };
        x.rect(s, s + 3.6, e - 2.6, e, "stone-stack");
    }
    true
}

/// Salt works: the long boiling house on the access with its stack at one
/// end, the salt store at a rear corner, the brine pans in the yard; an
/// inland western works adds the graduation house, a long thorn-filled wall
/// along the back.
fn saltworks(x: &mut Site, q: &Brief, rng: &mut Rng) -> bool {
    let (a, b, c, e) = edges(x);
    let (span, room) = (b - a, e - c);
    if span < 14.0 || room < 14.0 {
        return false;
    }
    let left = rng.chance(0.5);
    let (bl, bd) = ((0.62 * span).clamp(10.0, 18.0), (0.3 * room).clamp(5.0, 6.5));
    let (b0, b1) = end(a, b, bl, left);
    x.rect(b0, b1, c, c + bd, "boiling-house");
    if span - bl >= 2.2 {
        let (k0, k1) = if left { (b1, b1 + 2.2) } else { (b0 - 2.2, b0) };
        x.rect(k0, k1, c, c + 2.2, "works-stack");
    }
    let sw = (0.4 * span).clamp(6.0, 9.0);
    let (s0, s1) = end(a, b, sw, !left);
    x.rect(s0, s1, e - 6.0, e, "salt-store");
    if q.family == "western" && span - sw - 1.5 >= 10.0 && rng.chance(0.5) {
        let (g0, g1) = end(a, b, (span - sw - 1.5).min(30.0), left);
        x.rect(g0, g1, e - 3.0, e, "thorn-house");
    }
    let depth = (room - bd - 9.0).min(6.0);
    if depth >= 3.0 {
        let n = (((span + 1.2) / 5.7).floor() as usize).min(5);
        let s = (a + b - (n as f64 * 5.7 - 1.2)) * 0.5;
        for k in 0..n {
            x.rect(s + k as f64 * 5.7, s + k as f64 * 5.7 + 4.5, c + bd + 1.5, c + bd + 1.5 + depth, "brine-pan");
        }
    }
    true
}

/// Fishing station: boat sheds gable to the water at the back, the tall net
/// loft beside them, the fisher's house and the smokehouse on the access,
/// the drying racks between them.
fn fishery(x: &mut Site, rng: &mut Rng) -> bool {
    let (a, b, c, e) = edges(x);
    let (span, room) = (b - a, e - c);
    if span < 12.0 || room < 12.0 {
        return false;
    }
    let left = rng.chance(0.5);
    let bl = (0.45 * room).clamp(6.5, 9.0);
    let sheds = if span >= 20.0 { 2 } else { 1 };
    for k in 0..sheds {
        let s = if left { a + k as f64 * 5.7 } else { b - 4.5 - k as f64 * 5.7 };
        x.rect(s, s + 4.5, e - bl, e, "boat-shed");
    }
    let (n0, n1) = end(a, b, 4.0, !left);
    x.rect(n0, n1, e - 6.0, e, "net-loft");
    let fd = room - bl - 1.0;
    if fd < 3.5 {
        return true;
    }
    let (h0, h1) = end(a, b, (0.4 * span).clamp(5.0, 7.5), left);
    x.rect(h0, h1, c, c + fd.min(5.0), "fisher-house");
    let (k0, k1) = end(a, b, 2.8, !left);
    x.rect(k0, k1, c, c + 2.8, "smoke-house");
    let (r0, r1) = if left { (h1 + 1.5, k0 - 1.5) } else { (k1 + 1.5, h0 - 1.5) };
    let len = (r1 - r0).min(7.0);
    if len >= 3.0 {
        x.rect(r0, r0 + len, c + 0.3, c + 2.5, "fish-rack");
        if fd >= 5.5 {
            x.rect(r0, r0 + len, c + 3.3, c + 5.5, "fish-rack");
        }
    }
    true
}

/// Ferry house: the keeper's house on the road, the boat shed and the
/// landing stage at the back (the water).
fn ferry(x: &mut Site, rng: &mut Rng) -> bool {
    let (a, b, c, e) = edges(x);
    let (span, room) = (b - a, e - c);
    if span < 10.0 || room < 12.0 {
        return false;
    }
    let left = rng.chance(0.5);
    let (h0, h1) = end(a, b, (0.5 * span).clamp(5.5, 8.0), left);
    x.rect(h0, h1, c, c + (0.38 * room).clamp(5.0, 6.5), "ferry-house");
    let (s0, s1) = end(a, b, 4.5, !left);
    x.rect(s0, s1, e - (0.45 * room).clamp(6.0, 8.5), e, "boat-shed");
    x.bar((h0 + h1) * 0.5, 2.6, e - 5.0, e, "landing-stage");
    true
}

/// Toll house: the keeper's house with its three-sided bay watching the road
/// both ways and a lean-to behind; in East Asia a barrier gate across the
/// way with the guard range behind it.
fn tollhouse(x: &mut Site, q: &Brief, rng: &mut Rng) -> bool {
    let (a, b, c, e) = edges(x);
    let (span, room, m) = (b - a, e - c, (a + b) * 0.5);
    if span < 7.0 || room < 7.0 {
        return false;
    }
    if matches!(q.family, "chinese" | "japanese") {
        x.bar(m, (0.55 * span).clamp(5.0, 8.0), c, c + 3.6, "gate-hall");
        if room >= 11.0 {
            let (g0, g1) = end(a, b, (0.6 * span).clamp(5.0, 9.0), rng.chance(0.5));
            x.rect(g0, g1, c + 5.6, (c + 10.6).min(e), "side-hall");
        }
        return true;
    }
    let (hw, hd) = ((0.6 * span).clamp(5.5, 7.5), (0.5 * room).clamp(5.0, 6.5).min(room - 1.9));
    let t = c + 1.9;
    x.bar(m, hw, t, t + hd, "toll-house");
    x.poly(&[(m - 2.2, t), (m - 1.1, c + 0.1), (m + 1.1, c + 0.1), (m + 2.2, t)], "toll-bay");
    if e - (t + hd) >= 2.6 {
        x.bar(m, 0.7 * hw, t + hd, t + hd + 2.6, "lean-rear");
    }
    true
}

/// Press house (`.wine`, `.oil`, `.cider`): the press barn on the access, the
/// half-sunk cellar range against its side; an oil or cider press adds the
/// round horse mill that crushes the fruit, a wine press the open vat shed.
fn press(x: &mut Site, q: &Brief, rng: &mut Rng) -> bool {
    let (a, b, c, e) = edges(x);
    let (span, room) = (b - a, e - c);
    if span < 10.0 || room < 12.0 {
        return false;
    }
    let left = rng.chance(0.5);
    let (pw, pd) = ((0.5 * span).clamp(6.5, 9.0), (0.6 * room).clamp(9.0, 14.0));
    let (p0, p1) = end(a, b, pw, left);
    x.rect(p0, p1, c, c + pd, "press-house");
    let cw = (span - pw).min(5.0);
    let cellar = c + pd - (0.45 * pd).clamp(4.0, 8.0);
    if cw >= 3.0 {
        let (c0, c1) = if left { (p1, p1 + cw) } else { (p0 - cw, p0) };
        x.rect(c0, c1, cellar, c + pd, "press-cellar");
    }
    if q.any(&["rural.press.oil", "rural.press.cider"]) {
        if span - pw >= 5.0 && cellar - c >= 4.9 {
            x.disk(if left { p1 + 2.7 } else { p0 - 2.7 }, c + 2.35, 2.2, "edge-mill");
        }
    } else {
        let (fw, fd) = ((span - pw - 0.8).min(6.0), (cellar - c - 0.8).min(4.0));
        if fw >= 3.0 && fd >= 3.0 {
            let (f0, f1) = if left { (p1 + 0.8, p1 + 0.8 + fw) } else { (p0 - 0.8 - fw, p0 - 0.8) };
            x.rect(f0, f1, c, c + fd, "open-shed");
        }
    }
    true
}

/// Dovecote: a round or square tower in the West; the great pigeon tower of
/// Persia (a drum with a central turret); a cluster of mud cones along the
/// Nile and in the Maghreb.
fn dovecote(x: &mut Site, q: &Brief, rng: &mut Rng) -> bool {
    let (a, b, c, e) = edges(x);
    let (m, tc, short) = ((a + b) * 0.5, (c + e) * 0.5, (b - a).min(e - c));
    if short < 7.0 {
        return false;
    }
    if q.family == "persian" {
        return x.disk(m, tc, (0.42 * short).clamp(3.4, 6.5), "pigeon-drum");
    }
    if q.family == "maghreb" || matches!(q.culture, "egyptian-planned" | "nubian-fortified") {
        let r = (0.2 * short).clamp(1.6, 2.4);
        let o = 1.04 * r + 0.3;
        let mut ok = false;
        for (ds, dt) in [(-1.0, -1.0), (1.0, -1.0), (-1.0, 1.0), (1.0, 1.0)] {
            ok |= x.disk(m + ds * o, tc + dt * o, r, "pigeon-cone");
        }
        return ok;
    }
    if rng.chance(0.55) {
        x.disk(m, tc, (0.36 * short).clamp(2.4, 3.5), "dove-tower")
    } else {
        square(x, m, tc, (0.6 * short).clamp(4.5, 6.0), "dovecote-square")
    }
}

/// Sheepfold: the shepherd's hut at the gate, the dry-stone fold beside it
/// (a ring where folds are round), a lambing shed against its back wall.
fn sheepfold(x: &mut Site, q: &Brief, rng: &mut Rng) -> bool {
    let (a, b, c, e) = edges(x);
    let (span, room) = (b - a, e - c);
    if span < 14.0 || room < 12.0 {
        return false;
    }
    let left = rng.chance(0.5);
    let round = matches!(folk(q), "norse" | "african" | "clan" | "native") || rng.chance(0.25);
    let (h0, h1) = end(a, b, 3.6, left);
    x.rect(h0, h1, c, c + 4.4, "shepherd-hut");
    let (f0, f1) = if left { (h1 + 1.5, b) } else { (a, h0 - 1.5) };
    if round {
        let rr = 0.5 * (f1 - f0).min(room) - 0.1;
        if rr >= 5.0 {
            x.wedges(((f0 + f1) * 0.5, (c + e) * 0.5), (rr, rr), 1.9, (-FRAC_PI_2 + 0.3, 1.5 * PI - 0.3), 10, "fold-wall");
        }
    } else {
        walls(x, [f0, f1, c, e], 1.7, 3.0, "fold-wall");
        if f1 - f0 >= 9.0 {
            x.rect(f0 + 1.7, f1 - 1.7, e - 4.9, e - 1.7, "open-shed");
        }
    }
    true
}

/// Ice house: an earth-covered dome with its entrance passage; in Persia the
/// stepped cone of the yakhchal behind its long shade wall.
fn icehouse(x: &mut Site, q: &Brief) -> bool {
    let (a, b, c, e) = edges(x);
    let (m, short) = ((a + b) * 0.5, (b - a).min(e - c));
    if short < 8.0 {
        return false;
    }
    if q.family == "persian" {
        let r = (0.3 * short).clamp(3.0, 6.0);
        let ok = x.disk(m, e - 0.2 - 1.04 * r, r, "yakhchal");
        if e - c - 2.08 * r - 0.4 >= 3.5 {
            x.rect(a, b, c, c + 2.0, "shade-wall");
        }
        return ok;
    }
    let r = (0.3 * short).clamp(2.6, 4.5);
    let front = e - 0.2 - 2.08 * r;
    let ok = x.disk(m, e - 0.2 - 1.04 * r, r, "ice-mound");
    if front - 3.2 >= c {
        x.bar(m, 2.4, front - 3.2, front, "ice-passage");
    }
    ok
}

/// Oast or drying kiln: the stowage barn on the access, the kiln at its rear
/// end (round under a steep cone in the West, square under a pyramid
/// elsewhere), a second one beside the barn on a wide site.
fn oast(x: &mut Site, q: &Brief, rng: &mut Rng) -> bool {
    let (a, b, c, e) = edges(x);
    let (span, room) = (b - a, e - c);
    if span < 9.0 || room < 12.0 {
        return false;
    }
    let left = rng.chance(0.5);
    let round = q.family == "western";
    let r = 2.7;
    let k = 2.08 * r;
    let bw = (0.6 * span).clamp(5.6, 7.5);
    let bd = (0.5 * room).clamp(6.0, 10.0).min(room - k - 0.1);
    let (h0, h1) = end(a, b, bw, left);
    x.rect(h0, h1, c, c + bd, "oast-stowage");
    let sc = (h0 + h1) * 0.5;
    if round {
        x.disk(sc, c + bd + 1.04 * r, r, "oast-kiln");
        if span - bw >= k + 0.5 && bd >= k {
            x.disk(if left { h1 + 0.3 + 1.04 * r } else { h0 - 0.3 - 1.04 * r }, c + bd - 1.04 * r, r, "oast-kiln");
        }
    } else {
        square(x, sc, c + bd + 2.3, 4.6, "drying-kiln");
    }
    true
}

/// Tithe barn: the great barn along the access with its cart porches; a
/// grange (`.grange`, or any deep site) adds a granary range across the back
/// of the yard.
fn tithe_barn(x: &mut Site, q: &Brief, rng: &mut Rng) -> bool {
    let (a, b, c, e) = edges(x);
    let (span, room, m) = (b - a, e - c, (a + b) * 0.5);
    if span < 16.0 || room < 10.0 {
        return false;
    }
    let bw = (0.5 * room).clamp(8.0, 11.0);
    let len = span.min(44.0).min(4.2 * bw);
    let pd = (room - bw - 0.2).min(3.2);
    let t0 = c + pd.max(0.0);
    x.bar(m, len, t0, t0 + bw, "tithe-barn");
    if pd >= 2.4 {
        if len >= 30.0 {
            x.bar(m - 0.22 * len, 4.6, c, t0, "barn-porch");
            x.bar(m + 0.22 * len, 4.6, c, t0, "barn-porch");
        } else {
            x.bar(m, 4.6, c, t0, "barn-porch");
        }
    }
    if (q.is("rural.tithe-barn.grange") || rng.chance(0.5)) && e - 5.5 >= t0 + bw + 3.0 {
        let (g0, g1) = end(a, b, (0.45 * span).clamp(7.0, 16.0), rng.chance(0.5));
        x.rect(g0, g1, e - 5.5, e, "grange-range");
    }
    true
}

/// Raised granaries: a row of small stores on their staddles; a row of
/// thatched granary pots in sub-Saharan Africa.
fn raised_granaries(x: &mut Site, q: &Brief) -> bool {
    let (a, b, c, e) = edges(x);
    let (span, room, tc) = (b - a, e - c, (c + e) * 0.5);
    if span < 7.0 || room < 6.0 {
        return false;
    }
    let mut ok = false;
    if q.family == "african" {
        let n = (((span + 0.8) / 3.92).floor() as usize).clamp(1, 5);
        let s = (a + b - (n as f64 * 3.92 - 0.8)) * 0.5;
        for k in 0..n {
            ok |= x.disk(s + 1.56 + k as f64 * 3.92, tc, 1.5, "granary-pot");
        }
        return ok;
    }
    let (gw, gd) = (3.0, (0.6 * room).clamp(3.6, 5.0));
    let n = (((span + 1.2) / (gw + 1.2)).floor() as usize).clamp(1, 5);
    let s = (a + b - (n as f64 * (gw + 1.2) - 1.2)) * 0.5;
    for k in 0..n {
        let s = s + k as f64 * (gw + 1.2);
        ok |= x.rect(s, s + gw, tc - gd * 0.5, tc + gd * 0.5, "raised-store");
    }
    ok
}

/// Hunting lodge: the hall on the access with a prospect tower at its end,
/// the kennels down one side of the yard and the stable across its back.
fn hunting_lodge(x: &mut Site, rng: &mut Rng) -> bool {
    let (a, b, c, e) = edges(x);
    let (span, room) = (b - a, e - c);
    if span < 14.0 || room < 14.0 {
        return false;
    }
    let left = rng.chance(0.5);
    let (hw, hd) = ((0.6 * span).clamp(9.0, 14.0), (0.4 * room).clamp(6.5, 8.5));
    let (h0, h1) = end(a, b, hw, left);
    x.rect(h0, h1, c, c + hd, "lodge-hall");
    if span - hw >= 3.6 {
        let (t0, t1) = if left { (h1, h1 + 3.6) } else { (h0 - 3.6, h0) };
        x.rect(t0, t1, c, c + 3.6, "lodge-tower");
    }
    let rear = e - (c + hd);
    if rear >= 7.0 {
        let (k0, k1) = end(h0, h1, 4.5, left);
        x.rect(k0, k1, c + hd, c + hd + rear.min(12.0), "lodge-kennel");
        let sw = (hw - 7.5).min(8.0);
        if sw >= 4.0 {
            let (s0, s1) = end(h0, h1, sw, !left);
            x.rect(s0, s1, e - 4.5, e, "lodge-stable");
        }
    }
    true
}

/// Beacon: the stone stance of the fire with the watcher's hut before it; in
/// East Asia and on the steppe a battered signal tower.
fn beacon(x: &mut Site, q: &Brief, rng: &mut Rng) -> bool {
    let (a, b, c, e) = edges(x);
    let (m, room, short) = ((a + b) * 0.5, e - c, (b - a).min(e - c));
    if short < 8.0 {
        return false;
    }
    let depth = if matches!(q.family, "chinese" | "japanese") || folk(q) == "steppe" {
        let w = (0.55 * short).clamp(5.0, 8.0);
        square(x, m, e - 0.2 - w * 0.5, w, "beacon-tower");
        w + 0.2
    } else {
        let r = (0.2 * short).clamp(2.2, 3.2);
        x.disk(m, e - 0.2 - 1.04 * r, r, "beacon-stance");
        2.08 * r + 0.2
    };
    if room - depth - 1.5 >= 4.4 {
        let (h0, h1) = end(a, b, 3.6, rng.chance(0.5));
        x.rect(h0, h1, c, c + 4.4, "watch-hut");
    }
    true
}

/// Watch or signal tower: the tower with the guard hut against its foot; a
/// signal station (and any Roman one) stands inside a walled yard.
fn watchtower(x: &mut Site, q: &Brief, rng: &mut Rng) -> bool {
    let (a, b, c, e) = edges(x);
    let (m, span, room) = ((a + b) * 0.5, b - a, e - c);
    let short = span.min(room);
    if short < 8.0 {
        return false;
    }
    let tw = (0.4 * short).clamp(4.6, 6.5);
    let walled = (q.is("rural.signal") || q.family == "antique" || rng.chance(0.25)) && short >= tw + 9.0;
    let inset = if walled { 2.7 } else { 0.2 };
    if walled {
        walls(x, [a, b, c, e], 1.7, 3.0, "barmkin-wall");
    }
    let back = e - inset;
    square(x, m, back - tw * 0.5, tw, "watch-tower");
    if back - tw - 3.6 >= c + inset {
        x.bar(m, tw.max(4.0), back - tw - 3.6, back - tw, "watch-hut");
    }
    true
}

/// Border post: the guard house and the watch tower either side of the
/// barrier on the road, the stable range across the back of the yard.
fn border_post(x: &mut Site, rng: &mut Rng) -> bool {
    let (a, b, c, e) = edges(x);
    let (span, room) = (b - a, e - c);
    if span < 14.0 || room < 10.0 {
        return false;
    }
    let left = rng.chance(0.5);
    let (g0, g1) = end(a, b, (0.45 * span).clamp(6.0, 9.0), left);
    x.rect(g0, g1, c, c + 5.5, "guard-house");
    let tw = (0.25 * span).clamp(4.6, 6.0);
    let (t0, t1) = end(a, b, tw, !left);
    x.rect(t0, t1, c, c + tw, "watch-tower");
    if room >= 12.5 {
        x.rect(a, b.min(a + 16.0), e - 4.5, e, "stable-range");
    }
    true
}

/// What a culture sets by the wayside: a cross, a calvary or an oratory, a
/// marabout, a chorten, a spirit house, a torii and its small shrine, a
/// statue shelter, an earth-god shrine, an ovoo, a rune stone, a totem pole,
/// a platform shrine, a herm, an aedicula, a shrine hut, a cairn.
/// `.cross`, `.calvary` and `.shrine` fix the Christian ones.
fn wayside_kind(q: &Brief, rng: &mut Rng) -> &'static str {
    let d = rng.float();
    if q.is("rural.wayside.cross") {
        return "cross";
    }
    if q.is("rural.wayside.calvary") {
        return "calvary";
    }
    let kind = match folk(q) {
        "european" | "industrial" => {
            if q.family == "orthodox" {
                if d < 0.6 { "oratory" } else { "cross" }
            } else if d < 0.45 {
                "cross"
            } else if d < 0.8 {
                "oratory"
            } else {
                "calvary"
            }
        }
        "islamic" => "marabout",
        "chinese" => if d < 0.6 { "earth-shrine" } else { "statue" },
        "japanese" => if d < 0.5 { "torii" } else { "statue" },
        "indian" => {
            if matches!(q.culture, "tibetan-monastery" | "himalayan-terraces" | "newar" | "bagan" | "khmer") || d < 0.5 { "chorten" } else { "aedicula" }
        }
        "insular" => "spirit-house",
        "mesoamerican" => "platform",
        "andean" => if d < 0.5 { "cairn" } else { "platform" },
        "norse" => if d < 0.6 { "runestone" } else { "cairn" },
        "steppe" => "ovoo",
        "african" => if q.culture == "ethiopian-highland" { "cross" } else { "shrine-hut" },
        "native" => if matches!(q.culture, "native-pueblo" | "native-plains") { "cairn" } else { "totem" },
        "clan" => if matches!(q.culture, "inuit-camp" | "siberian-camp" | "budj-bim") { "cairn" } else { "totem" },
        "classical" | "ancient" => if d < 0.5 { "herm" } else { "aedicula" },
        "fantasy" => if d < 0.5 { "runestone" } else { "cairn" },
        _ => "cairn",
    };
    if q.is("rural.wayside.shrine") && matches!(kind, "cross" | "calvary") { "oratory" } else { kind }
}

/// One wayside or memorial marker in the middle of its ground.
fn marker(x: &mut Site, kind: &str) -> bool {
    let (a, b, c, e) = edges(x);
    let (m, tc, span, room) = ((a + b) * 0.5, (c + e) * 0.5, b - a, e - c);
    let short = span.min(room);
    match kind {
        "cross" => square(x, m, tc, 2.3, "wayside-cross"),
        "calvary" => {
            let ok = square(x, m, tc, 2.5, "calvary-cross");
            if span >= 9.6 {
                square(x, m - 3.5, tc, 2.1, "calvary-thief");
                square(x, m + 3.5, tc, 2.1, "calvary-thief");
            }
            ok
        }
        "oratory" => x.bar(m, 3.0, tc - 1.8, tc + 1.8, "oratory"),
        "marabout" => {
            let w = (0.5 * short).clamp(3.6, 5.5);
            let ok = square(x, m, tc, w, "marabout");
            if short * 0.5 - w * 0.5 >= 2.8 {
                let half = (w * 0.5 + 3.0).min(short * 0.5);
                walls(x, [m - half, m + half, tc - half, tc + half], 1.6, 2.4, "tomb-wall");
            }
            ok
        }
        "chorten" => {
            let w = (0.4 * short).clamp(3.0, 4.5);
            let ok = square(x, m, tc, w, "chorten");
            if span >= 14.0 {
                x.rect(m + w * 0.5 + 1.5, (m + w * 0.5 + 8.5).min(b), tc - 0.9, tc + 0.9, "mani-wall");
            }
            ok
        }
        "spirit-house" => square(x, m, tc, 2.4, "spirit-house"),
        "torii" => {
            let ok = x.bar(m, 4.4, c + 0.2, c + 1.9, "torii");
            if room >= 8.0 {
                x.bar(m, 2.6, e - 3.2, e - 0.2, "hokora");
            }
            ok
        }
        "statue" => square(x, m, tc, 2.4, "statue-shelter"),
        "earth-shrine" => x.bar(m, 2.8, tc - 1.5, tc + 1.5, "earth-shrine"),
        "ovoo" => {
            let r = (0.22 * short).clamp(1.8, 3.0);
            let ok = x.disk(m, tc, r, "ovoo");
            let n = (((span * 0.5 - 1.04 * r - 0.5) / 3.1).floor().max(0.0) as usize).min(3);
            for k in 0..n {
                let off = 1.04 * r + 1.8 + k as f64 * 3.1;
                x.disk(m - off, tc, 1.25, "ovoo-small");
                x.disk(m + off, tc, 1.25, "ovoo-small");
            }
            ok
        }
        "runestone" => x.bar(m, 2.1, tc - 1.1, tc + 1.1, "menhir"),
        "totem" => square(x, m, tc, 2.1, "totem-pole"),
        "platform" => square(x, m, tc, (0.5 * short).clamp(4.0, 6.0), "platform-shrine"),
        "herm" => square(x, m, tc, 2.1, "stele"),
        "aedicula" => x.bar(m, 2.8, tc - 1.8, tc + 1.8, "aedicula"),
        "shrine-hut" => x.disk(m, tc, 1.7, "shrine-hut"),
        "obelisk" => square(x, m, tc, 2.3, "memorial-obelisk"),
        "column" => square(x, m, tc, 2.3, "memorial-column"),
        _ => x.disk(m, tc, (0.2 * short).clamp(1.5, 2.6), "cairn"),
    }
}

/// Megaliths: a standing stone (`.menhir`), a stone row (`.row`), a stone
/// circle (`.circle`) or a dolmen behind its passage (`.dolmen`); the bare
/// role draws one the ground allows.
fn megalith(x: &mut Site, q: &Brief, rng: &mut Rng) -> bool {
    let (a, b, c, e) = edges(x);
    let (m, tc, span, room) = ((a + b) * 0.5, (c + e) * 0.5, b - a, e - c);
    let short = span.min(room);
    let (d, phase, second) = (rng.float(), rng.float(), rng.chance(0.5));
    let kind = if q.is("rural.megalith.menhir") {
        "menhir"
    } else if q.is("rural.megalith.row") {
        "row"
    } else if q.is("rural.megalith.circle") {
        "circle"
    } else if q.is("rural.megalith.dolmen") {
        "dolmen"
    } else if d < 0.25 {
        "menhir"
    } else if d < 0.45 {
        "row"
    } else if d < 0.8 {
        "circle"
    } else {
        "dolmen"
    };
    match kind {
        "row" if span >= 14.0 => {
            let n = (((span + 1.4) / 3.5).floor() as usize).clamp(3, 9);
            let mut ok = false;
            for k in 0..n {
                let s = m + (k as f64 - (n - 1) as f64 * 0.5) * 3.5;
                ok |= square(x, s, tc, 2.1, if k % 3 == 0 { "menhir" } else { "menhir-small" });
            }
            ok
        }
        "circle" if short >= 12.0 => {
            let r = (0.5 * short - 1.3).min(13.0);
            let n = ((TAU * r / 4.6).floor() as usize).clamp(6, 16);
            let mut ok = false;
            for k in 0..n {
                let ang = (k as f64 + phase) * TAU / n as f64;
                ok |= square(x, m + r * ang.cos(), tc + r * ang.sin(), 2.1, if k % 4 == 0 { "menhir" } else { "menhir-small" });
            }
            if r >= 6.0 && second {
                x.bar(m, 2.4, tc - 1.2, tc + 1.2, "recumbent");
            }
            ok
        }
        "dolmen" if room >= 7.0 => {
            let ok = x.bar(m, 3.2, tc - 1.0, tc + 3.0, "dolmen");
            x.bar(m, 2.1, tc - 3.4, tc - 1.0, "dolmen-passage");
            ok
        }
        _ => {
            let ok = x.bar(m, 2.1, tc - 1.1, tc + 1.1, "menhir");
            if span >= 9.5 && second {
                square(x, m + 3.6, tc + 0.4, 2.1, "menhir-small");
            }
            ok
        }
    }
}

/// Barrow: the round mound inside its kerb of stones; `.long` (and some
/// European and Norse ones) is the long barrow tapering from its stone facade.
fn barrow(x: &mut Site, q: &Brief, rng: &mut Rng) -> bool {
    let (a, b, c, e) = edges(x);
    let (m, tc, span, room) = ((a + b) * 0.5, (c + e) * 0.5, b - a, e - c);
    let short = span.min(room);
    if short < 9.0 {
        return false;
    }
    let long = q.is("rural.barrow.long") || (q.role == "rural.barrow" && matches!(folk(q), "european" | "norse") && span >= 20.0 && rng.chance(0.3));
    if long {
        let (w0, w1) = (0.5 * room.min(12.0), 0.3 * room.min(12.0));
        let len = span.min(40.0);
        let s0 = m - len * 0.5;
        x.rect(s0, s0 + 2.4, tc - w0, tc + w0, "barrow-facade");
        return x.poly(&[(s0 + 2.4, tc - w0), (s0 + len, tc - w1), (s0 + len, tc + w1), (s0 + 2.4, tc + w0)], "long-barrow");
    }
    let kerb = short >= 11.5;
    let r = if kerb { ((short * 0.5 - 2.4) / 1.1).clamp(3.0, 10.0) } else { ((short * 0.5 - 0.3) / 1.04).min(5.0) };
    let ok = x.disk(m, tc, r, "barrow-mound");
    if kerb {
        let outer = 1.1 * r + 2.1;
        x.wedges((m, tc), (outer, outer), 1.9, (0.0, TAU), ((TAU * outer / 3.2).round() as usize).clamp(12, 28), "barrow-kerb");
    }
    ok
}

/// Tomb in the open country: a marabout in the Maghreb, a tomb tower in
/// Persia, a pyramid with its chapel on the Nile, a tall monolithic tomb in
/// the Levant, a tower tomb in the classical world, a mound behind its stele
/// pavilion in China, a chhatri in India, a platform in the Americas, a
/// stele in Ethiopia, a barrow for the northern, steppe and clan peoples, a
/// small mausoleum elsewhere.
fn tomb(x: &mut Site, q: &Brief, rng: &mut Rng) -> bool {
    let (a, b, c, e) = edges(x);
    let (m, tc, span, room) = ((a + b) * 0.5, (c + e) * 0.5, b - a, e - c);
    let short = span.min(room);
    if short < 8.0 {
        return false;
    }
    if matches!(folk(q), "norse" | "steppe" | "clan" | "native") {
        return barrow(x, q, rng);
    }
    if folk(q) == "islamic" && q.family != "persian" {
        return marker(x, "marabout");
    }
    match q.family {
        "persian" => {
            let r = (0.26 * short).clamp(2.6, 4.0);
            let ok = x.disk(m, tc + 1.0, r, "tomb-tower");
            x.bar(m, 2.6, tc + 1.0 - 1.04 * r - 2.2, tc + 1.0 - 1.04 * r, "tomb-porch");
            ok
        }
        "maghreb" => marker(x, "marabout"),
        "antique" if matches!(q.culture, "egyptian-planned" | "nubian-fortified") => {
            let w = (0.55 * short).clamp(5.0, 9.0);
            let ok = square(x, m, tc + 1.2, w, "pyramid-tomb");
            x.bar(m, 3.0, tc + 1.2 - w * 0.5 - 2.4, tc + 1.2 - w * 0.5, "tomb-chapel");
            ok
        }
        "antique" if matches!(q.culture, "levantine-tell" | "mesopotamian") => {
            let ok = x.bar(m, (0.7 * span).clamp(6.0, 10.0), tc, tc + 2.6, "rock-tomb");
            x.bar(m, 2.6, tc - 2.0, tc, "tomb-porch");
            ok
        }
        "antique" => square(x, m, tc, (0.5 * short).clamp(4.5, 7.0), "tower-tomb"),
        "chinese" => {
            let r = (0.28 * short).clamp(2.6, 6.0);
            let ok = x.disk(m, e - 0.2 - 1.04 * r, r, "barrow-mound");
            let front = e - 2.08 * r - 1.9;
            if front - 3.0 >= c {
                x.bar(m, 3.0, front - 3.0, front, "stele-pavilion");
            }
            ok
        }
        "japanese" => square(x, m, tc, 2.3, "stele"),
        "indic" => square(x, m, tc, (0.45 * short).clamp(3.6, 5.5), "chhatri"),
        "american" => marker(x, "platform"),
        "african" if q.culture == "ethiopian-highland" => square(x, m, tc, 2.4, "stele-tall"),
        "african" => marker(x, "shrine-hut"),
        _ if folk(q) == "islamic" => marker(x, "marabout"),
        _ => {
            let w = (0.45 * short).clamp(4.2, 6.0);
            let t = tc - w * 0.5 + 0.8;
            let ok = x.bar(m, w, t, t + w, "tomb-house");
            x.bar(m, 2.6, t - 2.0, t, "tomb-porch");
            ok
        }
    }
}

/// Holy well: the well house over the spring (a dome in the Islamic lands,
/// an open pavilion in Asia) and its basin in front; a cross beside it in
/// the West.
fn holy_well(x: &mut Site, q: &Brief) -> bool {
    let (a, b, c, e) = edges(x);
    let (m, tc, span, room) = ((a + b) * 0.5, (c + e) * 0.5, b - a, e - c);
    if span < 6.0 || room < 7.0 {
        return false;
    }
    let label = match q.family {
        "persian" | "maghreb" => "well-dome",
        "chinese" | "japanese" | "indic" => "spring-pavilion",
        _ => "well-house",
    };
    let ok = x.bar(m, 3.0, tc - 0.4, tc + 3.0, label);
    x.bar(m, 2.2, tc - 2.8, tc - 0.4, "well-basin");
    if matches!(q.family, "western" | "orthodox") && span >= 11.0 {
        square(x, m + 4.2, tc - 1.2, 2.2, "wayside-cross");
    }
    ok
}

/// Hermitage: the hermit's cell and his oratory (the shrine of his faith
/// elsewhere) inside a garden wall.
fn hermitage(x: &mut Site, q: &Brief, rng: &mut Rng) -> bool {
    let (a, b, c, e) = edges(x);
    let (span, room) = (b - a, e - c);
    if span < 13.0 || room < 13.0 {
        return false;
    }
    let left = rng.chance(0.5);
    walls(x, [a, b, c, e], 1.6, 2.4, "garden-wall");
    let (ia, ib, ic, ie) = (a + 2.6, b - 2.6, c + 2.6, e - 2.6);
    let (h0, h1) = end(ia, ib, 3.6, left);
    x.rect(h0, h1, ie - 4.6, ie, "hermit-cell");
    let (o0, o1) = end(ia, ib, 3.6, !left);
    let om = (o0 + o1) * 0.5;
    match q.family {
        "western" | "orthodox" => {
            x.rect(o0, o1, ic, ic + 4.6, "hermit-oratory");
            if ic + 6.5 <= ie {
                x.apse(om, ic + 4.6, 1.75, "hermit-apse");
            }
        }
        "maghreb" | "persian" => {
            square(x, om, ic + 1.8, 3.6, "marabout");
        }
        "chinese" | "japanese" => {
            x.bar(om, 2.6, ic, ic + 3.0, "hokora");
        }
        "indic" => {
            square(x, om, ic + 1.6, 3.2, "chorten");
        }
        _ => {
            x.disk(om, ic + 1.8, 1.6, "cairn");
        }
    }
    true
}

/// Country chapel of the Christian West and East: nave, apse and a west
/// porch for the pilgrims (`.pilgrim`, with their shelter beside it); a
/// cemetery chapel (`.cemetery`) stands inside the graveyard wall behind its
/// lych gate. Other faiths set their own tomb or wayside shrine.
fn chapel(x: &mut Site, q: &Brief, rng: &mut Rng) -> bool {
    if !matches!(q.family, "western" | "orthodox") {
        if q.is("rural.chapel.cemetery") {
            return tomb(x, q, rng);
        }
        let kind = wayside_kind(q, rng);
        return marker(x, kind);
    }
    let (a, b, c, e) = edges(x);
    let (span, room) = (b - a, e - c);
    if span < 7.0 || room < 12.0 {
        return false;
    }
    let cemetery = q.is("rural.chapel.cemetery") && span >= 18.0 && room >= 20.0;
    let pilgrim = q.is("rural.chapel.pilgrim");
    let left = rng.chance(0.5);
    let (ia, ib, ic, ie) = if cemetery {
        walls(x, [a, b, c, e], 1.6, 3.0, "grave-wall");
        x.bar((a + b) * 0.5, 2.8, c, c + 1.6, "lych-gate");
        (a + 3.0, b - 3.0, c + 4.0, e - 3.0)
    } else {
        (a, b, c, e)
    };
    let cm = (ia + ib) * 0.5;
    let nw = (0.5 * (ib - ia)).clamp(4.6, 6.0);
    let t0 = ic + if pilgrim { 2.6 } else { 0.0 };
    let r = 0.42 * nw;
    let nl = (ie - t0 - 1.04 * r - 0.2).min(11.0);
    if nl < 6.0 {
        return false;
    }
    if pilgrim {
        x.bar(cm, 0.75 * nw, ic, t0, "chapel-porch");
    }
    x.bar(cm, nw, t0, t0 + nl, "chapel-nave");
    x.apse(cm, t0 + nl, r, "chapel-apse");
    if pilgrim && ib - ia >= nw + 5.5 {
        let (s0, s1) = end(ia, ib, 3.5, left);
        x.rect(s0, s1, t0 + 1.0, t0 + 1.0 + nl.min(8.0), "open-shed");
    }
    true
}

/// Sacred grove: a ring fence open towards the access round the ground left
/// to the trees, the altar in its middle (a small shrine in Japan, a standing
/// stone in the North, a shrine hut in Africa).
fn grove(x: &mut Site, q: &Brief) -> bool {
    let (a, b, c, e) = edges(x);
    let (m, tc, short) = ((a + b) * 0.5, (c + e) * 0.5, (b - a).min(e - c));
    if short < 12.0 {
        return false;
    }
    let rr = (0.5 * short - 0.2).min(14.0);
    let n = ((TAU * rr / 3.4).round() as usize).clamp(10, 24);
    let ok = x.wedges((m, tc), (rr, rr), 1.9, (-FRAC_PI_2 + 0.35, 1.5 * PI - 0.35), n, "grove-fence");
    match (q.family, folk(q)) {
        ("japanese", _) => x.bar(m, 2.6, tc - 1.5, tc + 1.5, "hokora"),
        (_, "norse") => x.bar(m, 2.1, tc - 1.1, tc + 1.1, "menhir"),
        ("african", _) => x.disk(m, tc, 1.7, "shrine-hut"),
        _ => x.bar(m, 2.2, tc - 1.3, tc + 1.3, "grove-altar"),
    };
    ok
}

/// Summit temple (a remote place, settlements/remote.rs): the sanctuary raised
/// on its stepped platform at the back of a terrace held by low walls, the
/// stair up to it on the axis; a chapel with its apse in the Christian West
/// and East. A summit too small for the terrace keeps the sanctuary alone.
fn summit_temple(x: &mut Site, q: &Brief) -> bool {
    let (a, b, c, e) = edges(x);
    let m = (a + b) * 0.5;
    let short = (b - a).min(e - c);
    if short < 9.0 {
        return false;
    }
    let (ia, ib, ic, ie) = if short >= 15.0 {
        walls(x, [a, b, c, e], 1.6, 3.2, "summit-terrace");
        (a + 2.4, b - 2.4, c + 2.4, e - 2.4)
    } else {
        (a, b, c, e)
    };
    let depth = ie - ic;
    if matches!(q.family, "western" | "orthodox") {
        let nw = (0.45 * (ib - ia)).clamp(4.6, 6.0);
        let r = 0.42 * nw;
        let nl = (depth - 1.04 * r - 0.2).min(9.0);
        if nl < 5.0 {
            return false;
        }
        let t0 = ie - 0.2 - 1.04 * r - nl;
        let ok = x.bar(m, nw, t0, t0 + nl, "chapel-nave");
        x.apse(m, t0 + nl, r, "chapel-apse");
        return ok;
    }
    let w = (0.55 * (ib - ia).min(depth)).clamp(5.0, 9.0);
    let back = ie - 0.2;
    let ok = square(x, m, back - w * 0.5, w, "summit-sanctuary");
    if back - w - 2.6 >= ic {
        x.bar(m, 2.4, back - w - 2.6, back - w, "summit-stair");
    }
    ok
}

/// Cliff monastery (a remote place): strung along its ledge and stepped down
/// the face. The hall against the rock in the middle, a range either side of
/// it, a lower row of cells on the brink before one range, the gate tower
/// before the other, the steps between the two levels. The site's front is
/// the brink, its back the rock.
fn cliff_monastery(x: &mut Site, rng: &mut Rng) -> bool {
    let (a, b, c, e) = edges(x);
    let (m, span, room) = ((a + b) * 0.5, b - a, e - c);
    if span < 16.0 || room < 8.0 {
        return false;
    }
    let left = rng.chance(0.5);
    let wc = (0.3 * span).clamp(7.0, 11.0);
    let dh = (0.62 * room).clamp(5.0, 8.0);
    let ok = x.bar(m, wc, e - dh, e, "cliff-hall");
    let dr = (0.5 * room).clamp(4.0, 6.0);
    let (w0, w1) = (m - wc * 0.5 - 0.6, m + wc * 0.5 + 0.6);
    x.rect(a, w0, e - dr, e, "cliff-range");
    x.rect(w1, b, e - dr, e, "cliff-range");
    // The lower level, on the brink.
    let low = e - dr - 1.4 - c;
    if low >= 3.0 {
        let (c0, c1) = if left { (a, w0) } else { (w1, b) };
        x.rect(c0, c1, c, c + low.min(4.5), "cliff-cells");
        if low >= 4.0 {
            let (g0, g1) = end(a, b, 4.4, !left);
            x.rect(g0, g1, c, c + 4.0, "cliff-gate");
        }
    }
    if e - dh - c >= 2.4 {
        x.bar(m, 2.4, c, e - dh, "cliff-steps");
    }
    ok
}

/// Rock-cut sanctuary (a remote place): the carved front against the rock at
/// the back of the site, its porch on the axis and, where the front is wide,
/// a colossus either side of the door.
fn rock_sanctuary(x: &mut Site) -> bool {
    let (a, b, c, e) = edges(x);
    let (m, span, room) = ((a + b) * 0.5, b - a, e - c);
    if span < 8.0 || room < 6.5 {
        return false;
    }
    let fw = (0.75 * span).clamp(7.0, 16.0);
    let fd = (0.3 * room).clamp(2.6, 3.6);
    let front = e - fd;
    let ok = x.bar(m, fw, front, e, "rock-facade");
    x.bar(m, 3.6, front - 2.8, front, "rock-porch");
    if fw >= 11.0 {
        for side in [-1.0, 1.0] {
            square(x, m + side * 3.8, front - 1.2, 2.4, "rock-colossus");
        }
    }
    ok
}

#[cfg(test)]
mod tests {
    use super::super::super::super::{Point, Shape, geometry};
    use super::super::super::occupation::{Frame, ring_area};
    use super::*;

    /// The part as a shape: outer ring counter-clockwise, its court clockwise.
    fn shape(ring: &[Point], hole: &Option<Vec<Point>>) -> Shape {
        let mut outer = ring.to_vec();
        if ring_area(&outer) < 0.0 {
            outer.reverse();
        }
        let holes = hole
            .iter()
            .map(|h| {
                let mut h = h.clone();
                if ring_area(&h) > 0.0 {
                    h.reverse();
                }
                h
            })
            .collect();
        Shape { outer, holes }
    }

    /// Parts of the form of `role` for a culture on a `w` x `d` rectangular site.
    fn parts(role: &str, family: &'static str, culture: &str, w: f64, d: f64) -> Vec<super::super::super::landmark::Part> {
        let b = vec![Point { x: 0.0, y: 0.0 }, Point { x: w, y: 0.0 }, Point { x: w, y: d }, Point { x: 0.0, y: d }];
        let f = Frame { u: Point { x: 1.0, y: 0.0 }, n: Point { x: 0.0, y: 1.0 }, t0: 0.0 };
        let mut x = Site { b: &b, f, s0: 0.0, s1: w, ta: 0.0, t1: d, out: vec![] };
        let q = Brief { role, family, culture, zone: "village", function: "collective", wealth: 0.5, landmark: true };
        assert!(build(&mut x, &q, &mut Rng::new(role)), "{role} {culture} {w}x{d}");
        x.out
    }

    /// Every rural form lays parts of 4 m² or more inside its site, none
    /// overlapping another, on a small and on a large site, for a western, a
    /// Persian and a Japanese culture.
    #[test]
    fn rural_forms_lay_disjoint_parts_inside_the_site() {
        let roles = [
            "rural.watermill", "rural.watermill.horizontal", "rural.watermill.hammer", "rural.watermill.tide", "rural.windmill.post", "rural.windmill.tower",
            "rural.windmill.smock", "rural.windmill.vertical", "rural.windmill.sailcloth", "rural.sawmill", "rural.charcoal", "rural.tar-works",
            "rural.bloomery", "rural.smelter", "rural.limekiln", "rural.brickworks", "rural.glasshouse", "rural.glasshouse.cone", "rural.minehead",
            "rural.quarry", "rural.saltworks", "rural.fishery", "rural.ferry", "rural.tollhouse", "rural.press.wine", "rural.press.oil", "rural.dovecote",
            "rural.sheepfold", "rural.icehouse", "rural.oast", "rural.tithe-barn", "rural.granary.raised", "rural.hunting-lodge", "rural.beacon",
            "rural.watchtower", "rural.signal", "rural.border-post", "rural.wayside", "rural.wayside.calvary", "rural.megalith.row", "rural.megalith.circle",
            "rural.megalith.dolmen", "rural.barrow", "rural.barrow.long", "rural.cairn", "rural.tomb", "rural.memorial", "rural.holy-well",
            "rural.hermitage", "rural.chapel.pilgrim", "rural.chapel.cemetery", "rural.grove", "rural.summit-temple", "rural.cliff-monastery",
            "rural.rock-sanctuary",
        ];
        for role in roles {
            for (family, culture) in [("western", "european-organic"), ("persian", "persian"), ("japanese", "japanese-jokamachi")] {
                for (w, d) in [(18.0, 18.0), (30.0, 26.0)] {
                    let out = parts(role, family, culture, w, d);
                    for (i, (ring, hole, label)) in out.iter().enumerate() {
                        assert!(ring.iter().all(|p| p.x > -1e-6 && p.x < w + 1e-6 && p.y > -1e-6 && p.y < d + 1e-6), "{role}: {label} leaves the site");
                        let sa = shape(ring, hole);
                        assert!(geometry::area(&sa) >= 3.99, "{role} {culture} {w}x{d}: {label} under 4 m²");
                        for (other, h2, l2) in &out[i + 1..] {
                            let overlap: f64 = geometry::intersection(&sa, &shape(other, h2)).iter().map(geometry::area).sum();
                            assert!(overlap < 0.01, "{role} {culture} {w}x{d}: {label} overlaps {l2}");
                        }
                    }
                }
            }
        }
    }
}
