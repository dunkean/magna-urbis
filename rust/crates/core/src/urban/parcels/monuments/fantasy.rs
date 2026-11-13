//! Fantasy peoples (dwarven, elven, gnomish, orcish, drow, duergar, myconid, merfolk, giant, halfling, wizard): their own halls, forges, vaults, towers and pits.
//!
//! See `mod.rs` for the contract: lay labelled, non-overlapping parts on the
//! site and return true for a role this family builds.
use super::utility::{edges, end, laid};
use super::{Brief, Site};
use crate::rng::Rng;
use std::f64::consts::{FRAC_PI_2, PI, TAU};

pub(super) fn build(x: &mut Site, q: &Brief, rng: &mut Rng) -> bool {
    let fantasy = matches!(
        q.culture,
        "dwarven" | "duergar-hold" | "elven" | "gnomish" | "orcish" | "goblin-warren" | "drow-enclave" | "myconid-colony" | "merfolk-tidal"
            | "giant-hold" | "halfling" | "wizard-city" | "lizardfolk-swamp"
    );
    // A sacred grove is the same ring around an open centre for every people.
    if !fantasy && !q.is("worship.grove") {
        return false;
    }
    laid(x, |x| {
        if q.is("worship.grove") {
            grove(x, !fantasy && !matches!(q.family, "western" | "orthodox" | "antique"), rng)
        } else if q.is("civic.great-forge") {
            great_forge(x, rng)
        } else if q.is("civic.vault") {
            vault(x)
        } else if q.is("civic.moot-tree") {
            moot_tree(x)
        } else if q.is("civic.war-pit") {
            war_pit(x)
        } else if q.is("civic.spore-hall") {
            spore_hall(x, rng)
        } else if q.is("civic.web-spire") {
            web_spire(x)
        } else if q.is("civic.tide-hall") {
            tide_hall(x)
        } else if q.is("civic.giant-hall") {
            giant_hall(x)
        } else if q.is("civic.clockwork") {
            clockwork(x, rng)
        } else if q.is("civic.wizard-tower") {
            wizard_tower(x, rng)
        } else {
            false
        }
    })
}

/// Great forge: a massive hall into the lot, a row of chimney stacks against
/// one long wall, a lean-to aisle of workshops against the other.
fn great_forge(x: &mut Site, rng: &mut Rng) -> bool {
    let (a, b, c, e) = edges(x);
    let (span, room, m) = (b - a, e - c, x.mid());
    if span < 12.0 || room < 12.0 {
        return false;
    }
    let left = rng.chance(0.5);
    let st = (0.12 * span).clamp(2.5, 4.5);
    let ai = (0.16 * span).clamp(3.0, 6.0);
    let hw = (0.5 * span).clamp(7.0, 22.0).min(span - st - ai);
    let len = (0.85 * room).clamp(11.0, 50.0).min(room);
    let t = c + (room - len) * 0.5;
    let s = m - (st + hw + ai) * 0.5;
    let (h0, h1) = if left { (s + st, s + st + hw) } else { (s + ai, s + ai + hw) };
    x.rect(h0, h1, t, t + len, "forge-hall");
    let (a0, a1) = if left { (h1, h1 + ai) } else { (h0 - ai, h0) };
    x.rect(a0, a1, t + 1.5, t + len - 1.5, "forge-aisle");
    let (c0, c1) = if left { (h0 - st, h0) } else { (h1, h1 + st) };
    let n = ((len / 9.0).round() as usize).clamp(2, 5);
    for k in 0..n {
        let u = t + len * (k as f64 + 0.5) / n as f64;
        x.rect(c0, c1, u - st * 0.5, u + st * 0.5, "forge-stack");
    }
    true
}

/// Vault: one blind square block raised in two steps (rule `vault-block`), its
/// door porch towards the street.
fn vault(x: &mut Site) -> bool {
    let (a, b, c, e) = edges(x);
    let (span, room, m) = (b - a, e - c, x.mid());
    let side = (0.6 * span.min(room)).clamp(7.0, 26.0);
    let door = if room - side >= 3.0 { 2.0 } else { 0.0 };
    let t = c + door + (room - door - side) * 0.5;
    x.bar(m, side, t, t + side, "vault-block");
    if door > 0.0 {
        x.small(m - 1.6, m + 1.6, t - door, t, "vault-door");
    }
    true
}

/// Moot tree: a ring of round pavilions around the open court of the great
/// tree, the ring open on the street axis.
fn moot_tree(x: &mut Site) -> bool {
    let (a, b, c, e) = edges(x);
    let (span, room, m) = (b - a, e - c, x.mid());
    let short = span.min(room);
    if short < 16.0 {
        return false;
    }
    let ring = 0.5 * short.min(60.0);
    let p = (0.2 * ring).clamp(2.0, 4.5);
    let orbit = ring - 1.04 * p;
    let n = ((TAU * orbit / (2.08 * p + 2.5)).floor() as usize).clamp(5, 10);
    let t = c + room * 0.5;
    for k in 0..n {
        let ang = -FRAC_PI_2 + TAU * (k as f64 + 0.5) / n as f64;
        x.disk(m + orbit * ang.cos(), t + orbit * ang.sin(), p, "moot-pavilion");
    }
    true
}

/// War pit: an oval arena, a high outer stand and a lower inner bench around
/// the open pit, both cut by the gate on the street axis.
fn war_pit(x: &mut Site) -> bool {
    let (a, b, c, e) = edges(x);
    let (span, room, m) = (b - a, e - c, x.mid());
    let short = span.min(room);
    if short < 16.0 {
        return false;
    }
    let (rs, rt) = (0.5 * span.min(1.4 * short).min(70.0), 0.5 * room.min(1.4 * short).min(70.0));
    let thick = (0.3 * rs.min(rt)).clamp(3.0, 9.0);
    let t = c + room * 0.5;
    let gate = (2.2 / rs).min(0.25);
    let arc = (-FRAC_PI_2 + gate, 1.5 * PI - gate);
    let n = ((TAU * 0.5 * (rs + rt) / 7.0).round() as usize).clamp(10, 28);
    x.wedges((m, t), (rs, rt), 0.55 * thick, arc, n, "pit-stand");
    x.wedges((m, t), (rs - 0.55 * thick, rt - 0.55 * thick), 0.45 * thick, arc, n, "pit-bench");
    true
}

/// Spore hall: a great dome with smaller domes budding around it.
fn spore_hall(x: &mut Site, rng: &mut Rng) -> bool {
    let (a, b, c, e) = edges(x);
    let (span, room, m) = (b - a, e - c, x.mid());
    let short = span.min(room);
    let big = (0.22 * short).clamp(2.6, 9.0);
    let t = c + room * 0.5;
    x.disk(m, t, big, "spore-dome");
    let n = if short >= 13.0 { rng.int(4, 6) as usize } else { 0 };
    let small = (0.55 * big).clamp(1.6, 5.0);
    // Centre distance at which the 12-gons of the two domes touch.
    let off = (big + small) * 1.04;
    let turn = rng.range(0.0, TAU);
    for k in 0..n {
        let ang = turn + TAU * k as f64 / n as f64;
        let r = small * if k % 2 == 0 { 1.0 } else { 0.8 };
        x.disk(m + off * ang.cos(), t + off * ang.sin(), r, "spore-dome");
    }
    true
}

/// Web spire: one spire raised in receding tiers (rule `web-spire`), an
/// anchor pier at each corner of its precinct.
fn web_spire(x: &mut Site) -> bool {
    let (a, b, c, e) = edges(x);
    let (span, room, m) = (b - a, e - c, x.mid());
    let short = span.min(room);
    let half = 0.5 * (0.38 * short).clamp(5.0, 14.0);
    let t = c + room * 0.5;
    x.bar(m, 2.0 * half, t - half, t + half, "web-spire");
    let o = (0.42 * short).min(half + 10.0);
    if o - 1.0 >= half + 2.0 && o + 1.0 <= 0.5 * short {
        for (ds, dt) in [(-1.0, -1.0), (1.0, -1.0), (1.0, 1.0), (-1.0, 1.0)] {
            x.small(m + ds * o - 1.0, m + ds * o + 1.0, t + dt * o - 1.0, t + dt * o + 1.0, "web-pier");
        }
    }
    true
}

/// Tide hall: an oval domed hall, a colonnade around its back half.
fn tide_hall(x: &mut Site) -> bool {
    let (a, b, c, e) = edges(x);
    let (span, room, m) = (b - a, e - c, x.mid());
    let (rs, rt) = ((0.36 * span).clamp(3.4, 18.0), (0.3 * room).clamp(3.4, 13.0));
    let t = c + room * 0.5;
    x.ellipse(m, t, rs, rt, "tide-hall");
    let (gap, th) = (2.0, 2.2);
    if rs + gap + th <= 0.5 * span && rt + gap + th <= 0.5 * room {
        let n = ((PI * 0.5 * (rs + rt) / 6.0).round() as usize).clamp(5, 14);
        x.wedges((m, t), (rs + gap + th, rt + gap + th), th, (0.0, PI), n, "tide-arcade");
    }
    true
}

/// Giant hall: one huge hall into the lot behind its porch.
fn giant_hall(x: &mut Site) -> bool {
    let (a, b, c, e) = edges(x);
    let (span, room, m) = (b - a, e - c, x.mid());
    if span < 14.0 || room < 16.0 {
        return false;
    }
    let hw = (0.6 * span).clamp(12.0, 34.0);
    let porch = (0.14 * room).clamp(3.0, 6.0);
    let len = (0.8 * room).clamp(12.0, 60.0).min(room - porch);
    let t = c + porch + (room - porch - len) * 0.5;
    x.bar(m, hw, t, t + len, "giant-hall");
    x.bar(m, 0.5 * hw, t - porch, t, "giant-porch");
    true
}

/// Clockwork hall: a hall on the street around the clock tower at one of its
/// front corners, the engine house as a lean-to against its rear wall.
fn clockwork(x: &mut Site, rng: &mut Rng) -> bool {
    let (a, b, c, e) = edges(x);
    let (span, room, m) = (b - a, e - c, x.mid());
    if span < 10.0 || room < 10.0 {
        return false;
    }
    let hw = span.min(26.0);
    let (a0, b0) = (m - hw * 0.5, m + hw * 0.5);
    let hd = (0.5 * room).clamp(8.0, 16.0);
    let tw = (0.22 * hw).clamp(3.5, 6.0);
    let left = rng.chance(0.5);
    let (t0, t1) = end(a0, b0, tw, left);
    x.rect(t0, t1, c, c + tw, "clockwork-tower");
    let (h0, h1) = if left { (t1, b0) } else { (a0, t0) };
    x.rect(h0, h1, c, c + hd, "clock-hall");
    x.rect(t0, t1, c + tw, c + hd, "clock-hall");
    if e - (c + hd) >= 3.5 {
        x.rect(a0 + 0.15 * hw, b0 - 0.15 * hw, c + hd, c + hd + 3.5, "lean-rear");
    }
    true
}

/// Wizard's tower: a round tower raised in tiers (rule `wizard-tower`), two
/// or three slender turrets against it.
fn wizard_tower(x: &mut Site, rng: &mut Rng) -> bool {
    let (a, b, c, e) = edges(x);
    let (span, room, m) = (b - a, e - c, x.mid());
    let short = span.min(room);
    let r = (0.2 * short).clamp(2.6, 5.5);
    let t = c + room * 0.5;
    x.disk(m, t, r, "wizard-tower");
    let q = (0.4 * r).clamp(1.3, 2.2);
    let off = (r + q) * 1.04;
    let n = if off + 1.04 * q <= 0.5 * short { rng.int(2, 3) as usize } else { 0 };
    let turn = rng.range(0.0, TAU);
    for k in 0..n {
        let ang = turn + TAU * k as f64 / 3.0;
        x.disk(m + off * ang.cos(), t + off * ang.sin(), q, "wizard-turret");
    }
    true
}

/// Sacred grove: standing stones (or small shrines) in a ring around the
/// open centre, the ring open on the street axis; a stone circle keeps an
/// altar stone off its centre.
fn grove(x: &mut Site, shrines: bool, rng: &mut Rng) -> bool {
    let (a, b, c, e) = edges(x);
    let (span, room, m) = (b - a, e - c, x.mid());
    let short = span.min(room);
    if short < 10.0 {
        return false;
    }
    let h = if shrines { 1.3 } else { 0.7 };
    let orbit = (0.38 * short).min(0.5 * short - h - 0.3).min(20.0);
    let n = if shrines { ((TAU * orbit / 9.0).round() as usize).clamp(4, 8) } else { ((TAU * orbit / 4.5).round() as usize).clamp(6, 14) };
    let t = c + room * 0.5;
    for k in 0..n {
        let ang = -FRAC_PI_2 + TAU * (k as f64 + 0.5) / n as f64;
        let (s, u) = (m + orbit * ang.cos(), t + orbit * ang.sin());
        // Stones are not all of one size.
        let w = if shrines { h } else { h + rng.range(-0.15, 0.25) };
        x.small(s - w, s + w, u - h, u + h, if shrines { "grove-shrine" } else { "standing-stone" });
    }
    if !shrines {
        x.small(m - 1.1, m + 1.1, t + 0.25 * orbit - 0.6, t + 0.25 * orbit + 0.6, "altar-stone");
    }
    true
}
