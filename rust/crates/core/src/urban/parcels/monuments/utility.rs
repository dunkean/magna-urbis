//! Utility buildings any culture may fall back to: quay warehouses, taverns, coaching inns, stables, shipyards, ropewalks, sawmills, kilns, arsenals, granaries, workshops.
//!
//! See `mod.rs` for the contract: lay labelled, non-overlapping parts on the
//! site and return true for a role this family builds.
use super::{Brief, Site};
use crate::rng::Rng;

/// Runs a form and keeps its parts only when it laid some: a form that gives
/// up leaves the site as it found it, for the next family or the older forms.
pub(super) fn laid(x: &mut Site, form: impl FnOnce(&mut Site) -> bool) -> bool {
    let n = x.out.len();
    if form(x) && x.out.len() > n {
        return true;
    }
    x.out.truncate(n);
    false
}

/// A ring part with its hole, or nothing: false when the lot cuts the ring so
/// that the hole (where another part will stand) cannot be kept.
pub(super) fn holed(x: &mut Site, outer: [f64; 4], inner: [f64; 4], label: &'static str) -> bool {
    if !x.ring(outer, inner, label) {
        return false;
    }
    if x.out.last().is_some_and(|p| p.1.is_some()) {
        return true;
    }
    x.out.pop();
    false
}

/// The site inside a small margin: `(s0, s1, t0, t1)`.
pub(super) fn edges(x: &Site) -> (f64, f64, f64, f64) {
    (x.s0 + 0.4, x.s1 - 0.4, x.ta + 0.4, x.t1 - 0.4)
}

/// A span of `w` metres at the left or the right end of `[a, b]`.
pub(super) fn end(a: f64, b: f64, w: f64, left: bool) -> (f64, f64) {
    if left { (a, a + w) } else { (b - w, b) }
}

pub(super) fn build(x: &mut Site, q: &Brief, rng: &mut Rng) -> bool {
    laid(x, |x| form(x, q, rng))
}

fn form(x: &mut Site, q: &Brief, rng: &mut Rng) -> bool {
    if q.is("commerce.warehouse") {
        warehouse(x, rng)
    } else if q.is("commerce.inn") {
        inn(x, rng)
    } else if q.any(&["commerce.tavern", "commerce.taberna"]) {
        tavern(x, rng)
    } else if q.is("commerce.stable") {
        stable(x, rng)
    } else if q.is("craft.shipyard") {
        shipyard(x, 4)
    } else if q.is("craft.boatshed") {
        shipyard(x, 2)
    } else if q.is("craft.ropewalk") {
        ropewalk(x, rng)
    } else if q.is("craft.sawmill") {
        sawmill(x, rng)
    } else if q.any(&["craft.kiln", "craft.potter"]) {
        kiln(x, rng)
    } else if q.is("craft.smithy") {
        smithy(x, rng)
    } else if q.any(&["craft.tannery", "craft.dyer", "craft.fullonica"]) {
        tannery(x, rng)
    } else if q.is("craft.brewery") {
        brewery(x, rng)
    } else if q.is("craft.bakery") {
        bakery(x, rng)
    } else if q.any(&["craft.workshop", "craft.weaver", "craft.obsidian", "craft.alchemist"]) {
        workshop(x, rng)
    } else if q.is("defence.arsenal") {
        arsenal(x)
    } else if q.function == "warehouse" && (q.role.is_empty() || q.any(&["commerce", "craft"])) && !q.is("craft.mill") {
        // Any other trading or craft lot allotted to storage.
        warehouse(x, rng)
    } else {
        false
    }
}

/// Quay or street warehouse: long gabled sheds side by side, gable to the
/// street, a counting house at one end of the row on a large lot.
fn warehouse(x: &mut Site, rng: &mut Rng) -> bool {
    let (a, b, c, e) = edges(x);
    let (span, room) = (b - a, e - c);
    let len = room.min(48.0);
    let ow = if span >= 26.0 && room >= 16.0 { (0.2 * span).clamp(6.0, 9.0) } else { 0.0 };
    let row = (span - ow).min(60.0);
    // Bays narrow enough for their ridge to run into the lot, 7.5 m wide when the depth allows.
    let widest = (len / 1.5).clamp(4.5, 10.0);
    let bays = ((row / widest).ceil() as usize).max((row / 7.5).round() as usize).clamp(1, 6);
    let bw = (row / bays as f64).min(11.0);
    let left = rng.chance(0.5);
    let start = a + (span - ow - bays as f64 * bw) * 0.5;
    let first = start + if left { ow } else { 0.0 };
    for k in 0..bays {
        // A deep row steps back here and there: sheds were built one by one.
        let short = if len > 22.0 && rng.chance(0.3) { rng.range(0.08, 0.18) * len } else { 0.0 };
        let s = first + k as f64 * bw;
        x.rect(s, s + bw, c, c + len - short, "store-shed");
    }
    if ow > 0.0 {
        let s = if left { start } else { first + bays as f64 * bw };
        x.rect(s, s + ow, c, c + (0.45 * len).clamp(7.0, 12.0), "counting-house");
    }
    true
}

/// Coaching inn: street range with a carriage gateway, two lodging ranges and
/// the stable range around the yard; on a street lot, a front range with a
/// carriage passage at one end, a wing down one side and the stable across the back.
fn inn(x: &mut Site, rng: &mut Rng) -> bool {
    let (a, b, c, e) = edges(x);
    let (span, room) = (b - a, e - c);
    if room < 14.0 {
        return false;
    }
    let left = rng.chance(0.5);
    if span < 16.0 || room < 18.0 {
        let pass = if span >= 10.5 { 2.8 } else { 0.0 };
        let fd = (0.35 * room).clamp(6.0, 9.0);
        let (f0, f1) = if left { (a, b - pass) } else { (a + pass, b) };
        x.rect(f0, f1, c, c + fd, "inn-front");
        let st = if room >= 20.0 { (0.2 * room).clamp(4.0, 6.0) } else { 0.0 };
        let (w0, w1) = end(a, b, (0.45 * span).clamp(4.0, 6.0), left);
        x.rect(w0, w1, c + fd, (c + fd + 16.0).min(e - st), "inn-range");
        if st > 0.0 {
            x.rect(a, b, e - st, e, "stable-range");
        }
        return true;
    }
    let cw = span.min(34.0);
    let cd = room.min(1.5 * cw).min(42.0);
    let (a, b) = (x.mid() - cw * 0.5, x.mid() + cw * 0.5);
    let fd = (0.2 * cd).clamp(5.5, 8.0);
    let sr = (0.16 * cw).clamp(4.5, 6.5);
    let st = (0.17 * cd).clamp(5.0, 7.0);
    // Gateway off the middle, so that the larger part of the front range holds the hall.
    let g = a + cw * if left { 0.3 } else { 0.7 };
    x.rect(a, g - 1.6, c, c + fd, "inn-front");
    x.rect(g + 1.6, b, c, c + fd, "inn-front");
    x.rect(a, a + sr, c + fd, c + cd - st, "inn-range");
    x.rect(b - sr, b, c + fd, c + cd - st, "inn-range");
    x.rect(a, b, c + cd - st, c + cd, "stable-range");
    true
}

/// Tavern: body on the street behind its porch, a kitchen lean-to against the
/// rear wall, a wing down one side of the yard, a brewhouse at the back of a deep lot.
fn tavern(x: &mut Site, rng: &mut Rng) -> bool {
    let (a, b, c, e) = edges(x);
    let (span, room) = (b - a, e - c);
    let left = rng.chance(0.5);
    let bw = span.min(16.0);
    let (a, b) = end(a, b, bw, left);
    let porch = if room >= 14.0 { 1.6 } else { 0.0 };
    let bd = (0.4 * room).clamp(6.0, 10.0).min(room - porch);
    let t = c + porch;
    x.rect(a, b, t, t + bd, "tavern-body");
    let door = a + bw * rng.range(0.35, 0.65);
    if porch > 0.0 {
        x.small(door - 1.5, door + 1.5, c + 0.1, t, "porch");
    }
    let rear = e - (t + bd);
    if rear < 3.0 {
        return true;
    }
    let ww = if bw >= 9.0 && rear >= 6.0 { (0.42 * bw).clamp(4.0, 6.0) } else { 0.0 };
    if ww > 0.0 {
        let (w0, w1) = end(a, b, ww, left);
        x.rect(w0, w1, t + bd, t + bd + (0.35 * room).clamp(4.5, 10.0).min(rear), "tavern-wing");
    }
    // The kitchen takes the rear wall left free by the wing, against the wing.
    let (k0, k1) = if left { (a + ww, b) } else { (a, b - ww) };
    let (k0, k1) = end(k0, k1, ((k1 - k0) * 0.75).max(3.0).min(k1 - k0), left);
    x.rect(k0, k1, t + bd, t + bd + 3.0, "tavern-kitchen");
    if rear >= 14.0 {
        let (r0, r1) = end(a, b, (0.55 * bw).max(5.0).min(bw), !left);
        x.rect(r0, r1, e - 4.5, e, "yard-range");
    }
    true
}

/// Livery stable: a long low range with its hay loft down one side of the
/// lot; on a large lot, ranges on three sides of a yard open to the street
/// and the ostler's lodge at a front corner.
fn stable(x: &mut Site, rng: &mut Rng) -> bool {
    let (a, b, c, e) = edges(x);
    let (span, room) = (b - a, e - c);
    let left = rng.chance(0.5);
    if span < 16.0 || room < 16.0 {
        let rw = (0.45 * span).clamp(4.5, 6.5);
        let (r0, r1) = end(a, b, rw, left);
        x.rect(r0, r1, c, c + room.min(32.0), "stable-range");
        if span - rw >= 6.5 && room >= 12.0 {
            // Lodge on the street across the yard gate (3 m) from the range.
            let (l0, l1) = if left { (a + rw + 3.0, b) } else { (a, b - rw - 3.0) };
            let (l0, l1) = end(l0, l1, (l1 - l0).min(7.0), !left);
            x.rect(l0, l1, c, c + 5.5, "yard-lodge");
        }
        return true;
    }
    let cw = span.min(36.0);
    let cd = room.min(1.2 * cw).min(40.0);
    let (a, b) = (x.mid() - cw * 0.5, x.mid() + cw * 0.5);
    let rw = (0.18 * cw).clamp(4.5, 6.5);
    let (l0, l1) = end(a, b, rw + 1.5, left);
    x.rect(l0, l1, c, c + 6.0, "yard-lodge");
    x.rect(a, a + rw, c + if left { 6.0 } else { 0.0 }, c + cd - rw, "stable-range");
    x.rect(b - rw, b, c + if left { 0.0 } else { 6.0 }, c + cd - rw, "stable-range");
    x.rect(a, b, c + cd - rw, c + cd, "stable-range");
    true
}

/// Shipyard: open slip sheds side by side running to the back of the lot
/// (the water), the mould loft across the street end. A boatshed is the same
/// with at most two slips.
fn shipyard(x: &mut Site, slips: usize) -> bool {
    let (a, b, c, e) = edges(x);
    let (span, room) = (b - a, e - c);
    if room < 12.0 {
        return false;
    }
    let loft = if room >= 20.0 { (0.2 * room).clamp(5.0, 8.0) } else { 0.0 };
    let n = ((span / 9.0).round() as usize).clamp(1, slips.max(1));
    let gap = 1.5;
    let sw = ((span - gap * (n - 1) as f64) / n as f64).min(10.0);
    let total = n as f64 * sw + gap * (n - 1) as f64;
    let s = x.mid() - total * 0.5;
    let len = (room - if loft > 0.0 { loft + 2.5 } else { 0.0 }).min(40.0);
    for k in 0..n {
        let s = s + k as f64 * (sw + gap);
        x.rect(s, s + sw, e - len, e, "slip-shed");
    }
    if loft > 0.0 {
        x.bar(x.mid(), total.min(30.0), c, c + loft, "mould-loft");
    }
    true
}

/// Ropewalk: one very long narrow shed along the lot's longer side, the hemp
/// store beside its head.
fn ropewalk(x: &mut Site, rng: &mut Rng) -> bool {
    let (a, b, c, e) = edges(x);
    let (span, room) = (b - a, e - c);
    let left = rng.chance(0.5);
    if room >= span {
        let rw = (0.3 * span).clamp(3.5, 6.0);
        let (r0, r1) = end(a, b, rw, left);
        x.rect(r0, r1, c, e, "ropewalk");
        if span - rw >= 6.0 && room >= 16.0 {
            let (h0, h1) = if left { (a + rw, b) } else { (a, b - rw) };
            let (h0, h1) = end(h0, h1, (h1 - h0).min(8.0), left);
            x.rect(h0, h1, c, c + (0.3 * room).clamp(6.0, 12.0), "store-shed");
        }
    } else {
        let rw = (0.3 * room).clamp(3.5, 6.0);
        x.rect(a, b, e - rw, e, "ropewalk");
        if room - rw >= 7.0 && span >= 16.0 {
            let (h0, h1) = end(a, b, (0.3 * span).clamp(6.0, 10.0), left);
            x.rect(h0, h1, (e - rw - 10.0).max(c), e - rw, "store-shed");
        }
    }
    true
}

/// Sawmill: the open saw shed at the back of the lot (the race), the office
/// on the street in front of it, timber stacks down the other side of the yard.
fn sawmill(x: &mut Site, rng: &mut Rng) -> bool {
    let (a, b, c, e) = edges(x);
    let (span, room) = (b - a, e - c);
    if room < 12.0 {
        return false;
    }
    let left = rng.chance(0.5);
    let sw = (0.5 * span).clamp(5.0, 9.0);
    let len = (0.5 * room).clamp(8.0, 22.0);
    let (s0, s1) = end(a, b, sw, left);
    x.rect(s0, s1, e - len, e, "saw-shed");
    let od = (e - len - c - 2.0).min(6.5);
    if od >= 4.0 {
        x.rect(s0, s1, c, c + od, "yard-range");
    }
    let free = span - sw - 1.5;
    if free >= 3.0 {
        let (q0, q1) = end(a, b, free.min(4.0), !left);
        let mut t = c + 2.0;
        for _ in 0..3 {
            if t + 6.0 > e - 1.0 {
                break;
            }
            x.rect(q0, q1, t, t + 6.0, "timber-stack");
            t += 8.0;
        }
    }
    true
}

/// Pottery or lime works: the workshop on the street, one to three round
/// kilns in a row in the yard behind it.
fn kiln(x: &mut Site, rng: &mut Rng) -> bool {
    let (a, b, c, e) = edges(x);
    let (span, room) = (b - a, e - c);
    let r = (0.17 * span).clamp(1.8, 3.2);
    // Room a kiln takes: its 12-gon reaches 4 % past the radius.
    let k = 2.08 * r;
    let wd = (0.4 * room).clamp(5.0, 8.0).min(room - k - 2.0);
    if wd < 4.0 {
        return false;
    }
    let left = rng.chance(0.5);
    let (a0, b0) = end(a, b, span.min(14.0), left);
    x.rect(a0, b0, c, c + wd, "shop-body");
    let n = (((span + 1.2) / (k + 1.2)).floor() as usize).clamp(1, 3);
    let total = n as f64 * k + (n - 1) as f64 * 1.2;
    let s = ((a0 + b0 - total) * 0.5).min(b - total).max(a);
    let t = (e - k * 0.5).min(c + wd + 6.0 + k * 0.5);
    for i in 0..n {
        x.disk(s + k * 0.5 + i as f64 * (k + 1.2), t, r, "round-kiln");
    }
    true
}

/// Smithy: the forge on the street, a shoeing shed against its rear wall and
/// the forge chimney at the end of that shed.
fn smithy(x: &mut Site, rng: &mut Rng) -> bool {
    let (a, b, c, e) = edges(x);
    let (span, room) = (b - a, e - c);
    let left = rng.chance(0.5);
    let (a0, b0) = end(a, b, span.min(11.0), left);
    let bd = (0.4 * room).clamp(6.0, 9.0).min(room);
    x.rect(a0, b0, c, c + bd, "smithy-forge");
    let rear = e - (c + bd);
    if rear >= 1.6 {
        let (h0, h1) = end(a0, b0, 1.6, !left);
        x.small(h0, h1, c + bd, c + bd + 1.6, "works-chimney");
        let (l0, l1) = if left { (a0, b0 - 1.6) } else { (a0 + 1.6, b0) };
        x.rect(l0, l1, c + bd, c + bd + rear.min(3.0), "lean-rear");
    }
    true
}

/// Tannery, dye works or fullery: the shop on the street beside the yard
/// gate, open drying sheds down both sides and across the back, the pits in
/// the yard. A small lot holds a plain workshop.
fn tannery(x: &mut Site, rng: &mut Rng) -> bool {
    let (a, b, c, e) = edges(x);
    let (span, room) = (b - a, e - c);
    if span < 10.0 || room < 14.0 {
        return workshop(x, rng);
    }
    let cw = span.min(30.0);
    let cd = room.min(40.0);
    let (a, b) = (x.mid() - cw * 0.5, x.mid() + cw * 0.5);
    let sh = (0.2 * cw).clamp(3.5, 5.5);
    let fd = (0.25 * cd).clamp(4.5, 7.0);
    let (f0, f1) = end(a, b, (0.5 * cw).clamp(5.0, 10.0), rng.chance(0.5));
    x.rect(f0, f1, c, c + fd, "shop-body");
    x.rect(a, a + sh, c + fd, c + cd - sh, "open-shed");
    x.rect(b - sh, b, c + fd, c + cd - sh, "open-shed");
    x.rect(a, b, c + cd - sh, c + cd, "open-shed");
    // Pits on a 3.6 m grid in the middle of the yard.
    let (yw, yd) = (cw - 2.0 * sh - 2.0, cd - fd - sh - 3.0);
    let (cols, rows) = (((yw / 3.6).floor() as usize).min(3), ((yd / 3.6).floor() as usize).min(3));
    let (ys, yt) = ((a + b) * 0.5, c + fd + 1.5 + yd * 0.5);
    for i in 0..cols {
        for j in 0..rows {
            let s = ys + (i as f64 - (cols as f64 - 1.0) * 0.5) * 3.6;
            let t = yt + (j as f64 - (rows as f64 - 1.0) * 0.5) * 3.6;
            x.disk(s, t, 1.3, "tan-pit");
        }
    }
    true
}

/// Brewery: the tall brewhouse on the street, the malt kiln under its
/// pyramid roof against a rear corner with the copper's chimney beside it, a
/// cellar range across the back of the yard.
fn brewery(x: &mut Site, rng: &mut Rng) -> bool {
    let (a, b, c, e) = edges(x);
    let (span, room) = (b - a, e - c);
    if room < 12.0 {
        return false;
    }
    let left = rng.chance(0.5);
    let bw = span.min(14.0);
    let (a0, b0) = end(a, b, bw, left);
    let bd = (0.4 * room).clamp(7.0, 11.0);
    x.rect(a0, b0, c, c + bd, "brew-house");
    let k = (0.4 * bw).clamp(4.0, 5.5);
    let t = c + bd;
    if e - t >= k {
        let (k0, k1) = end(a0, b0, k, left);
        x.rect(k0, k1, t, t + k, "malt-kiln");
        let (h0, h1) = if left { (k1, k1 + 1.6) } else { (k0 - 1.6, k0) };
        x.small(h0, h1, t, t + 1.6, "works-chimney");
        if e - (t + k) >= 9.0 {
            x.rect(a0, b0, e - 5.0, e, "yard-range");
        }
    }
    true
}

/// Bakery: the shop on the street, the bakehouse as a lean-to against its
/// rear wall, the domed oven and its chimney behind the bakehouse.
fn bakery(x: &mut Site, rng: &mut Rng) -> bool {
    let (a, b, c, e) = edges(x);
    let (span, room) = (b - a, e - c);
    let left = rng.chance(0.5);
    let bw = span.min(10.0);
    let (a0, b0) = end(a, b, bw, left);
    let bd = (0.4 * room).clamp(6.0, 9.0).min(room);
    x.rect(a0, b0, c, c + bd, "shop-body");
    let rear = e - (c + bd);
    if rear >= 3.0 {
        let kd = rear.min(3.5);
        let t = c + bd + kd;
        x.rect(a0, b0, c + bd, t, "lean-rear");
        if e - t >= 3.4 {
            let s = a0 + 0.35 * bw;
            x.disk(s, t + 1.67, 1.6, "bake-oven");
            x.small(s + 1.75, s + 3.1, t, t + 1.35, "works-chimney");
        }
    }
    true
}

/// Workshop: the shop on the street, a range down one side of the yard, an
/// open shed across the back of a deep lot.
fn workshop(x: &mut Site, rng: &mut Rng) -> bool {
    let (a, b, c, e) = edges(x);
    let (span, room) = (b - a, e - c);
    if room < 12.0 {
        return false;
    }
    let left = rng.chance(0.5);
    let bw = span.min(14.0);
    let (a0, b0) = end(a, b, bw, left);
    let bd = (0.4 * room).clamp(6.0, 10.0);
    x.rect(a0, b0, c, c + bd, "shop-body");
    let rear = e - (c + bd);
    if rear >= 4.0 {
        let back = if rear >= 14.0 { 4.5 } else { 0.0 };
        let (r0, r1) = end(a0, b0, (0.4 * bw).clamp(3.5, 5.0), left);
        x.rect(r0, r1, c + bd, (c + bd + 14.0).min(e - back), "yard-range");
        if back > 0.0 {
            x.rect(a0, b0, e - back, e, "open-shed");
        }
    }
    true
}

/// Arsenal: long armoury halls on the four sides of a court, a gate block in
/// the middle of the street range; on a smaller lot, two long halls either
/// side of a yard.
fn arsenal(x: &mut Site) -> bool {
    let (a, b, c, e) = edges(x);
    let (span, room) = (b - a, e - c);
    if span < 14.0 || room < 14.0 {
        return false;
    }
    if span < 24.0 || room < 24.0 {
        let hw = (0.36 * span.min(room)).clamp(5.0, 9.0);
        if room >= span {
            let t = c + room.min(60.0);
            x.rect(a, a + hw, c, t, "arsenal-hall");
            x.rect(b - hw, b, c, t, "arsenal-hall");
        } else {
            let (a, b) = (x.mid() - span.min(60.0) * 0.5, x.mid() + span.min(60.0) * 0.5);
            x.rect(a, b, c, c + hw, "arsenal-hall");
            x.rect(a, b, e - hw, e, "arsenal-hall");
        }
        return true;
    }
    let cw = span.min(70.0);
    let cd = room.min(1.6 * cw).min(90.0);
    let m = x.mid();
    let (a, b) = (m - cw * 0.5, m + cw * 0.5);
    let r = (0.2 * cw.min(cd)).clamp(6.0, 12.0);
    let gate = (0.12 * cw).clamp(5.0, 8.0);
    x.rect(a, m - gate * 0.5, c, c + r, "arsenal-hall");
    x.bar(m, gate, c, c + r, "arsenal-gate");
    x.rect(m + gate * 0.5, b, c, c + r, "arsenal-hall");
    x.rect(a, a + r, c + r, c + cd - r, "arsenal-hall");
    x.rect(b - r, b, c + r, c + cd - r, "arsenal-hall");
    x.rect(a, b, c + cd - r, c + cd, "arsenal-hall");
    true
}

#[cfg(test)]
mod tests {
    use super::super::super::occupation::Frame;
    use super::super::super::super::{Point, Shape, geometry};
    use super::*;

    /// Parts of the form of `role` on a `w` x `d` rectangular lot.
    fn parts(role: &str, function: &str, w: f64, d: f64) -> Vec<super::super::super::landmark::Part> {
        let b = vec![Point { x: 0.0, y: 0.0 }, Point { x: w, y: 0.0 }, Point { x: w, y: d }, Point { x: 0.0, y: d }];
        let f = Frame { u: Point { x: 1.0, y: 0.0 }, n: Point { x: 0.0, y: 1.0 }, t0: 0.0 };
        let mut x = Site { b: &b, f, s0: 0.0, s1: w, ta: 0.0, t1: d, out: vec![] };
        let q = Brief { role, family: "western", culture: "european-organic", zone: "middle", function, wealth: 0.5, landmark: false };
        assert!(build(&mut x, &q, &mut Rng::new(role)), "{role} {w}x{d}");
        x.out
    }

    #[test]
    fn utility_forms_lay_disjoint_parts_inside_the_lot() {
        let roles = ["commerce.warehouse", "commerce.inn", "commerce.tavern", "commerce.stable", "craft.shipyard", "craft.ropewalk",
            "craft.sawmill", "craft.kiln", "craft.smithy", "craft.tannery", "craft.brewery", "craft.bakery", "craft.workshop", "defence.arsenal"];
        for role in roles {
            for (w, d) in [(10.0, 24.0), (16.0, 30.0), (40.0, 36.0)] {
                if role == "defence.arsenal" && w < 14.0 {
                    continue;
                }
                let out = parts(role, "workshop", w, d);
                for (i, (ring, _, label)) in out.iter().enumerate() {
                    assert!(ring.iter().all(|p| p.x > -1e-6 && p.x < w + 1e-6 && p.y > -1e-6 && p.y < d + 1e-6), "{role}: {label} leaves the lot");
                    let sa = Shape { outer: ring.clone(), holes: vec![] };
                    for (other, _, l2) in &out[i + 1..] {
                        let overlap: f64 = geometry::intersection(&sa, &Shape { outer: other.clone(), holes: vec![] }).iter().map(geometry::area).sum();
                        assert!(overlap < 0.01, "{role} {w}x{d}: {label} overlaps {l2}");
                    }
                }
            }
        }
    }

    #[test]
    fn a_warehouse_is_a_row_of_sheds_and_storage_lots_fall_back_to_it() {
        let out = parts("commerce.warehouse", "warehouse", 40.0, 30.0);
        assert!(out.iter().filter(|p| p.2 == "store-shed").count() >= 3);
        assert!(out.iter().any(|p| p.2 == "counting-house"));
        assert!(parts("commerce.shop", "warehouse", 12.0, 20.0).iter().all(|p| p.2 == "store-shed"));
    }
}
