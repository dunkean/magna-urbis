//! Modern, contemporary and fictional styles (industrial, grid city, high-rise, cyberpunk…):
//! factories, stations, apartment blocks, towers, civic buildings of the styles of
//! `forms/styles_modern.json`.
//!
//! See `mod.rs` for the contract: lay labelled, non-overlapping parts on the
//! site and return true for a role this family builds. The parts are raised by
//! the rules of `forms/roles_modern.json`.
//!
//! A gabled part whose ridge must follow its long side is kept at least 2 m
//! behind the street line: a pitched body on the street turns its ridge along
//! the street whatever its shape.
use super::classical::{aisled, axes, span as along};
use super::utility::{edges, end, laid};
use super::{Brief, Site};
use crate::rng::Rng;

/// Styles whose singular and utility buildings this family builds.
const STYLES: &[&str] = &["american-grid"];

pub(super) fn build(x: &mut Site, q: &Brief, rng: &mut Rng) -> bool {
    if !STYLES.contains(&q.culture) {
        return false;
    }
    laid(x, |x| form(x, q, rng))
}

fn form(x: &mut Site, q: &Brief, rng: &mut Rng) -> bool {
    if q.is("civic.townhall") {
        city_hall(x, rng)
    } else if q.is("civic.courthouse") {
        courthouse(x)
    } else if q.is("civic.station") {
        station(x, rng)
    } else if q.is("commerce.department-store") {
        department_store(x, rng)
    } else if q.is("commerce.bank") {
        bank(x)
    } else if q.is("commerce.hotel") {
        hotel(x, rng)
    } else if q.is("commerce.office-block") {
        office_block(x, rng)
    } else if q.is("commerce.skyscraper") {
        skyscraper(x)
    } else if q.is("civic.theatre") {
        theatre(x)
    } else if q.is("civic.library") {
        library(x)
    } else if q.is("civic.school") {
        school(x)
    } else if q.is("worship.cathedral") {
        church(x, true, rng)
    } else if q.any(&["worship.parish", "worship.church"]) {
        church(x, false, rng)
    } else if q.is("worship.chapel") {
        chapel(x)
    } else if q.is("worship.synagogue") {
        synagogue(x)
    } else if q.is("civic.fire-station") {
        fire_station(x, rng)
    } else if q.is("commerce.market.hall") {
        market_hall(x)
    } else if q.is("craft.factory") {
        factory(x, rng)
    } else if q.is("storage.elevator") {
        elevator(x, rng)
    } else if q.is("civic.power-house") {
        power_house(x)
    } else if q.is("civic.water-tower") {
        water_tower(x, rng)
    } else {
        false
    }
}

/// The rectangles of `outer` left around `inner` (both `[s0, s1, t0, t1]`):
/// in front of it, behind it, on its left and on its right. A block around
/// the tower, the dome or the light court that stands inside it.
fn around(x: &mut Site, [a, b, c, e]: [f64; 4], [i0, i1, j0, j1]: [f64; 4], label: &'static str) -> bool {
    let mut ok = x.rect(a, b, c, j0, label);
    ok |= x.rect(a, b, j1, e, label);
    ok |= x.rect(a, i0, j0, j1, label);
    ok |= x.rect(i1, b, j0, j1, label);
    ok
}

/// City hall: the main block between two end pavilions that stand forward on
/// a wide front and, over the middle of the block, a dome on its drum behind
/// a pedimented portico, or a clock tower on the street.
fn city_hall(x: &mut Site, rng: &mut Rng) -> bool {
    let (a, b, c, e) = edges(x);
    let (span, room) = (b - a, e - c);
    if span < 14.0 || room < 12.0 {
        return false;
    }
    let m = x.mid();
    let w = span.min(70.0);
    let fore = (0.12 * room).clamp(1.5, 6.0);
    let depth = (0.6 * room).clamp(9.0, 26.0).min(room - fore);
    let (l, r, t) = (m - w * 0.5, m + w * 0.5, c + fore);
    let pavilion = if w >= 30.0 { (0.16 * w).clamp(5.0, 10.0) } else { 0.0 };
    if pavilion > 0.0 {
        let forward = (0.5 * fore).min(3.0);
        x.rect(l, l + pavilion, t - forward, t + depth, "cityhall-wing");
        x.rect(r - pavilion, r, t - forward, t + depth, "cityhall-wing");
    }
    let (bl, br) = (l + pavilion, r - pavilion);
    let side = (0.3 * (br - bl)).min(0.6 * depth).clamp(5.0, 14.0);
    let dome = rng.chance(0.5);
    // The dome stands in the middle of the block, the clock tower on its front.
    let tj = if dome { t + (depth - side) * 0.5 } else { t };
    let crown = [m - side * 0.5, m + side * 0.5, tj, tj + side];
    let ok = around(x, [bl, br, t, t + depth], crown, "cityhall-block");
    x.rect(crown[0], crown[1], crown[2], crown[3], if dome { "cityhall-dome" } else { "cityhall-tower" });
    if dome && fore >= 2.0 {
        x.bar(m, (0.3 * (br - bl)).clamp(5.0, 14.0), t - (fore - 0.4).min(4.0), t, "pediment");
    }
    ok
}

/// Courthouse: a square block around its domed cupola, a pedimented portico
/// on the street.
fn courthouse(x: &mut Site) -> bool {
    let (a, b, c, e) = edges(x);
    let (span, room) = (b - a, e - c);
    if span < 12.0 || room < 12.0 {
        return false;
    }
    let m = x.mid();
    let fore = (0.15 * room).clamp(2.0, 6.0);
    let w = span.min(1.5 * (room - fore)).min(40.0);
    let d = (room - fore).min(1.2 * w).min(34.0);
    let t = c + fore;
    let side = (0.3 * w.min(d)).clamp(4.0, 9.0);
    let tj = t + (d - side) * 0.5;
    let cupola = [m - side * 0.5, m + side * 0.5, tj, tj + side];
    let ok = around(x, [m - w * 0.5, m + w * 0.5, t, t + d], cupola, "courthouse-block");
    x.rect(cupola[0], cupola[1], cupola[2], cupola[3], "courthouse-cupola");
    x.bar(m, (0.45 * w).clamp(5.0, 14.0), t - (fore - 0.4).min(4.0), t, "pediment");
    ok
}

/// Railway station: the head house along the street, its clock tower at one
/// end, and behind it the train shed in parallel vaulted spans.
fn station(x: &mut Site, rng: &mut Rng) -> bool {
    let (a, b, c, e) = edges(x);
    let (span, room) = (b - a, e - c);
    if span < 16.0 || room < 20.0 {
        return false;
    }
    let w = span.min(90.0);
    let (l, r) = (x.mid() - w * 0.5, x.mid() + w * 0.5);
    let head = (0.22 * room).clamp(8.0, 16.0);
    let tower = (0.14 * w).clamp(5.0, 9.0).min(head);
    let left = rng.chance(0.5);
    let (t0, t1) = end(l, r, tower, left);
    x.rect(t0, t1, c, c + tower, "station-tower");
    let (h0, h1) = if left { (t1, r) } else { (l, t0) };
    let ok = x.rect(h0, h1, c, c + head, "station-head");
    x.rect(t0, t1, c + tower, c + head, "station-head");
    let length = (room - head).min(140.0);
    let spans = ((w / 24.0).ceil() as usize).clamp(1, 4);
    let bay = w / spans as f64;
    for k in 0..spans {
        let s = l + k as f64 * bay;
        x.rect(s, s + bay, c + head, c + head + length, "train-shed");
    }
    ok
}

/// Department store: a block that fills its lot, a domed rotunda at one
/// street corner and, in a large one, a glazed light court in the middle.
fn department_store(x: &mut Site, rng: &mut Rng) -> bool {
    let (a, b, c, e) = edges(x);
    let (span, room) = (b - a, e - c);
    if span < 14.0 || room < 14.0 {
        return false;
    }
    let (w, d) = (span.min(70.0), room.min(70.0));
    let (l, r) = (x.mid() - w * 0.5, x.mid() + w * 0.5);
    let corner = (0.2 * w.min(d)).clamp(5.0, 9.0);
    let left = rng.chance(0.5);
    let (k0, k1) = end(l, r, corner, left);
    x.rect(k0, k1, c, c + corner, "store-corner");
    let (f0, f1) = if left { (k1, r) } else { (l, k0) };
    x.rect(f0, f1, c, c + corner, "store-block");
    let (t, back) = (c + corner, c + d);
    if w >= 34.0 && back - t >= 30.0 {
        let range = (0.28 * w.min(back - t)).clamp(9.0, 14.0);
        let court = [l + range, r - range, t + range, back - range];
        x.rect(court[0], court[1], court[2], court[3], "store-atrium");
        around(x, [l, r, t, back], court, "store-block")
    } else {
        x.rect(l, r, t, back, "store-block")
    }
}

/// Bank: a tall banking hall behind a temple front.
fn bank(x: &mut Site) -> bool {
    let (a, b, c, e) = edges(x);
    let (span, room) = (b - a, e - c);
    if span < 8.0 || room < 10.0 {
        return false;
    }
    let m = x.mid();
    let w = span.min(26.0);
    let fore = (0.12 * room).clamp(1.8, 4.0);
    let ok = x.bar(m, w, c + fore, c + fore + (room - fore).min(34.0), "bank-hall");
    x.bar(m, (0.7 * w).max(5.0), c + 0.3, c + fore, "pediment");
    ok
}

/// Hotel: a tall block on the street and wings reaching back from it, with
/// light courts open to the rear between them.
fn hotel(x: &mut Site, rng: &mut Rng) -> bool {
    let (a, b, c, e) = edges(x);
    let (span, room) = (b - a, e - c);
    if span < 10.0 || room < 12.0 {
        return false;
    }
    let w = span.min(60.0);
    let (l, r) = (x.mid() - w * 0.5, x.mid() + w * 0.5);
    let front = (0.4 * room).clamp(9.0, 16.0);
    let ok = x.rect(l, r, c, c + front, "hotel-block");
    let back = (room - front).min(30.0);
    if back >= 6.0 {
        let wing = (0.22 * w).clamp(6.0, 9.0);
        let wings: usize = if w >= 3.0 * wing + 10.0 {
            3
        } else if w >= 2.0 * wing + 5.0 {
            2
        } else {
            1
        };
        if wings == 1 {
            let (w0, w1) = end(l, r, wing, rng.chance(0.5));
            x.rect(w0, w1, c + front, c + front + back, "hotel-wing");
        } else {
            for k in 0..wings {
                let s = l + (w - wing) * k as f64 / (wings - 1) as f64;
                x.rect(s, s + wing, c + front, c + front + back, "hotel-wing");
            }
        }
    }
    ok
}

/// Office block: one tall slab on the street across the lot, a low service
/// annex behind it.
fn office_block(x: &mut Site, rng: &mut Rng) -> bool {
    let (a, b, c, e) = edges(x);
    let (span, room) = (b - a, e - c);
    if span < 12.0 || room < 12.0 {
        return false;
    }
    let m = x.mid();
    let w = span.min(40.0);
    let d = (0.75 * room).clamp(12.0, 36.0).min(room);
    let label = if rng.chance(0.4) { "office-block-stone" } else { "office-block" };
    let ok = x.bar(m, w, c, c + d, label);
    if room - d >= 5.0 {
        x.bar(m, (0.6 * w).max(5.0), c + d, c + d + (room - d).min(10.0), "office-annex");
    }
    ok
}

/// Skyscraper: a podium that fills the lot and, rising out of it near the
/// street, the shaft stepped back in tiers.
fn skyscraper(x: &mut Site) -> bool {
    let (a, b, c, e) = edges(x);
    let (span, room) = (b - a, e - c);
    if span < 16.0 || room < 16.0 {
        return false;
    }
    let (w, d) = (span.min(60.0), room.min(60.0));
    let m = x.mid();
    let side = (0.55 * w.min(d)).clamp(12.0, 26.0);
    let tj = c + ((d - side) * 0.35).min(6.0);
    let shaft = [m - side * 0.5, m + side * 0.5, tj, tj + side];
    let ok = x.rect(shaft[0], shaft[1], shaft[2], shaft[3], "tower-shaft");
    around(x, [m - w * 0.5, m + w * 0.5, c, c + d], shaft, "tower-base");
    ok
}

/// Theatre: the lobby front on the street, the auditorium behind it and the
/// taller fly tower over the stage at the back.
fn theatre(x: &mut Site) -> bool {
    let (a, b, c, e) = edges(x);
    let (span, room) = (b - a, e - c);
    if span < 12.0 || room < 20.0 {
        return false;
    }
    let m = x.mid();
    let w = span.min(34.0);
    let length = room.min(60.0);
    let front = (0.2 * length).clamp(5.0, 9.0);
    let stage = (0.25 * length).clamp(6.0, 14.0);
    x.bar(m, w, c, c + front, "theatre-front");
    let ok = x.bar(m, 0.9 * w, c + front, c + length - stage, "auditorium");
    x.bar(m, w, c + length - stage, c + length, "fly-tower");
    ok
}

/// Public library: the reading-room block behind its pedimented entrance,
/// the book stacks in a rear wing.
fn library(x: &mut Site) -> bool {
    let (a, b, c, e) = edges(x);
    let (span, room) = (b - a, e - c);
    if span < 10.0 || room < 10.0 {
        return false;
    }
    let m = x.mid();
    let w = span.min(36.0);
    let fore = (0.14 * room).clamp(1.8, 5.0);
    let d = (0.5 * room).clamp(7.0, 16.0).min(room - fore);
    let t = c + fore;
    let ok = x.bar(m, w, t, t + d, "library-block");
    x.bar(m, (0.35 * w).clamp(4.0, 10.0), t - (fore - 0.4).min(3.5), t, "pediment");
    let back = room - fore - d;
    if back >= 5.0 {
        x.bar(m, (0.5 * w).max(5.0), t + d, t + d + back.min(14.0), "library-stacks");
    }
    ok
}

/// School: a block along the street in two halves beside its gabled entrance
/// bay, which stands forward; two classroom wings reach back from a wide one.
fn school(x: &mut Site) -> bool {
    let (a, b, c, e) = edges(x);
    let (span, room) = (b - a, e - c);
    if span < 12.0 || room < 10.0 {
        return false;
    }
    let m = x.mid();
    let w = span.min(48.0);
    let fore = (0.15 * room).clamp(2.0, 8.0);
    let d = (0.4 * room).clamp(7.0, 12.0).min(room - fore);
    let t = c + fore;
    let entry = (0.22 * w).clamp(4.0, 7.0);
    x.rect(m - w * 0.5, m - entry * 0.5, t, t + d, "school-block");
    let ok = x.rect(m + entry * 0.5, m + w * 0.5, t, t + d, "school-block");
    x.bar(m, entry, t - (fore - 0.5).min(2.5), t + d, "school-entry");
    let back = room - fore - d;
    if w >= 28.0 && back >= 6.0 {
        let wing = (0.2 * w).clamp(6.0, 9.0);
        let length = back.min(16.0);
        x.rect(m - w * 0.5, m - w * 0.5 + wing, t + d, t + d + length, "school-wing");
        x.rect(m + w * 0.5 - wing, m + w * 0.5, t + d, t + d + length, "school-wing");
    }
    ok
}

/// Church: the nave into the lot and the apse at its far end; the steeple in
/// the middle of the front or at a front corner, two towers for a cathedral;
/// lean-to aisles on a wide site and, for a cathedral, a transept.
fn church(x: &mut Site, cathedral: bool, rng: &mut Rng) -> bool {
    let (a, b, c, e) = edges(x);
    let (span, room) = (b - a, e - c);
    if span < 8.0 || room < 16.0 {
        return false;
    }
    let m = x.mid();
    let nave = (0.45 * span).clamp(6.0, if cathedral { 16.0 } else { 11.0 });
    let tower = (0.5 * nave).clamp(3.5, 7.0);
    let apse = 0.45 * nave;
    let t = c + 2.0;
    let length = (room - 2.5 - apse).min(if cathedral { 80.0 } else { 46.0 });
    if length < tower + 8.0 {
        return false;
    }
    let far = t + length;
    // Towers beside the nave need their width on both sides, the plan staying centred.
    let beside = span >= nave + 2.0 * tower + 0.5;
    let twin = cathedral && beside;
    let corner = !twin && beside && rng.chance(0.35);
    let left = rng.chance(0.5);
    let ok = x.bar(m, nave, if twin || corner { t } else { t + tower }, far, "church-nave");
    let (inner, outer) = (nave * 0.5, nave * 0.5 + tower);
    if twin {
        x.rect(m - outer, m - inner, t, t + tower, "church-steeple");
        x.rect(m + inner, m + outer, t, t + tower, "church-steeple");
    } else if corner {
        let (s0, s1) = if left { (m - outer, m - inner) } else { (m + inner, m + outer) };
        x.rect(s0, s1, t, t + tower, "church-steeple");
    } else {
        x.bar(m, tower, t, t + tower, "church-steeple");
    }
    let aisle = ((span - nave) * 0.5 - 0.3).min(0.4 * nave).min(4.5);
    if aisle >= 2.5 && (cathedral || nave >= 8.0) {
        // The transept crosses the nave at three fifths of its length.
        let z0 = t + 0.62 * length;
        let z1 = (z0 + 0.9 * nave).min(far - 1.5);
        let crossed = cathedral && z1 - z0 >= 4.0;
        let arm = (aisle + 2.0).min((span - nave) * 0.5 - 0.1);
        for side in [-1.0, 1.0] {
            // The strip `reach` wide beside the nave, on this side.
            let strip = |reach: f64| {
                let (i, o) = (m + side * inner, m + side * (inner + reach));
                (i.min(o), i.max(o))
            };
            let (a0, a1) = strip(aisle);
            if crossed {
                let (x0, x1) = strip(arm);
                x.rect(a0, a1, t + tower, z0, "church-aisle");
                x.rect(x0, x1, z0, z1, "church-transept");
                x.rect(a0, a1, z1, far, "church-aisle");
            } else {
                x.rect(a0, a1, t + tower, far, "church-aisle");
            }
        }
    }
    x.apse(m, far, apse, "church-apse");
    ok
}

/// Chapel or meeting house: a plain gabled hall into the lot behind the
/// small belfry of its entrance bay.
fn chapel(x: &mut Site) -> bool {
    let (a, b, c, e) = edges(x);
    let (span, room) = (b - a, e - c);
    if span < 7.0 || room < 12.0 {
        return false;
    }
    let m = x.mid();
    let w = (0.7 * span).clamp(6.0, 12.0);
    let t = c + 2.0;
    let belfry = (0.4 * w).clamp(2.5, 4.0);
    x.bar(m, belfry, t, t + belfry, "chapel-belfry");
    x.bar(m, w, t + belfry, t + (room - 2.0).min(26.0), "chapel-hall")
}

/// Synagogue: a hall into the lot between two domed stair towers on the street.
fn synagogue(x: &mut Site) -> bool {
    let (a, b, c, e) = edges(x);
    let (span, room) = (b - a, e - c);
    if span < 10.0 || room < 12.0 {
        return false;
    }
    let m = x.mid();
    let w = span.min(22.0);
    let tower = (0.22 * w).clamp(2.6, 4.5);
    let t = c + 1.0;
    let (l, r) = (m - w * 0.5, m + w * 0.5);
    x.rect(l, l + tower, t, t + tower, "synagogue-tower");
    x.rect(r - tower, r, t, t + tower, "synagogue-tower");
    x.rect(l + tower, r - tower, t, t + tower, "synagogue-hall");
    x.rect(l, r, t + tower, t + (room - 1.0).min(32.0), "synagogue-hall")
}

/// Fire station: the engine house on the street, the hose-drying tower at a
/// rear corner.
fn fire_station(x: &mut Site, rng: &mut Rng) -> bool {
    let (a, b, c, e) = edges(x);
    let (span, room) = (b - a, e - c);
    if span < 7.0 || room < 9.0 {
        return false;
    }
    let w = span.min(18.0);
    let (l, r) = (x.mid() - w * 0.5, x.mid() + w * 0.5);
    let tower = (0.25 * w).clamp(2.6, 4.0);
    let d = (room - tower).clamp(6.0, 16.0);
    let ok = x.rect(l, r, c, c + d, "fire-hall");
    if room - d >= tower {
        let (t0, t1) = end(l, r, tower, rng.chance(0.5));
        x.rect(t0, t1, c + d, c + d + tower, "hose-tower");
    }
    ok
}

/// Market hall: a long nave under its raised roof between two lower aisles,
/// along the longer side of the lot.
fn market_hall(x: &mut Site) -> bool {
    let deep = x.depth() >= x.width();
    let (start, centre, long, short) = axes(x, deep);
    let length = (long - 4.4).min(80.0);
    let wide = (short - if deep { 0.8 } else { 4.4 }).min(0.6 * length).min(34.0);
    if length < 12.0 || wide < 9.0 {
        return false;
    }
    let l0 = start + (long - length) * 0.5;
    aisled(x, deep, [l0, l0 + length], centre, (0.5 * wide, 0.25 * wide), ("market-nave", "market-aisle"))
}

/// Factory: a multi-storey mill block on the street; behind it the saw-tooth
/// sheds, a row of narrow bays lit from the back, with the boiler house and
/// its chimney at one end of the row.
fn factory(x: &mut Site, rng: &mut Rng) -> bool {
    let (a, b, c, e) = edges(x);
    let (span, room) = (b - a, e - c);
    if span < 14.0 || room < 16.0 {
        return false;
    }
    let w = span.min(90.0);
    let (l, r) = (x.mid() - w * 0.5, x.mid() + w * 0.5);
    let block = (0.25 * room).clamp(8.0, 16.0);
    let ok = x.rect(l, r, c, c + block, "mill-block");
    let back = (room - block).min(90.0);
    let left = rng.chance(0.5);
    let boiler = (0.22 * w).clamp(5.0, 12.0);
    let (b0, b1) = end(l, r, boiler, left);
    let (h0, h1) = if left { (b1 + 1.0, r) } else { (l, b0 - 1.0) };
    let t = c + block;
    let bays = ((back / 6.0).floor() as usize).min(12);
    if bays > 0 {
        let bay = (back / bays as f64).min(7.5);
        for k in 0..bays {
            let t0 = t + k as f64 * bay;
            x.rect(h0, h1, t0, t0 + bay, "sawtooth-bay");
        }
    }
    let house = (0.5 * back).clamp(4.0, 12.0).min(back);
    if house >= 4.0 {
        x.rect(b0, b1, t, t + house, "boiler-house");
    }
    let stack = (0.5 * boiler).clamp(2.4, 3.6);
    if back - house >= stack + 1.0 {
        x.bar((b0 + b1) * 0.5, stack, t + house + 1.0, t + house + 1.0 + stack, "factory-chimney");
    }
    ok
}

/// Grain elevator: a row of round silos (two abreast on a wide lot) along
/// the longer side of the lot, the tall headhouse at one end of the row and
/// a low receiving shed at the other.
fn elevator(x: &mut Site, rng: &mut Rng) -> bool {
    let deep = x.depth() >= x.width();
    let (start, centre, long, short) = axes(x, deep);
    if long < 20.0 || short < 9.0 {
        return false;
    }
    let bin = (0.45 * short).clamp(6.0, 9.0);
    let rows: usize = if short >= 2.0 * bin + 1.0 { 2 } else { 1 };
    let width = rows as f64 * bin;
    let head = (0.9 * bin).clamp(6.0, 9.0);
    let room = long - 4.4;
    let bins = (((room - head) / bin).floor() as usize).min(8);
    if bins < 2 {
        return false;
    }
    let row = head + bins as f64 * bin;
    let shed = if room - row >= 5.0 { (room - row).min(10.0) } else { 0.0 };
    let whole = row + shed;
    let l0 = start + (long - whole) * 0.5;
    let flip = rng.chance(0.5);
    // A stretch of the row from its headhouse end, or from the other end when flipped.
    let at = |from: f64, length: f64| if flip { [l0 + whole - from - length, l0 + whole - from] } else { [l0 + from, l0 + from + length] };
    let across = [centre - width * 0.5, centre + width * 0.5];
    let ok = along(x, deep, at(0.0, head), across, "elevator-head");
    for k in 0..bins {
        for abreast in 0..rows {
            let v = across[0] + abreast as f64 * bin;
            along(x, deep, at(head + k as f64 * bin, bin), [v, v + bin], "silo");
        }
    }
    if shed > 0.0 {
        along(x, deep, at(row, shed), [centre - width * 0.35, centre + width * 0.35], "elevator-shed");
    }
    ok
}

/// Power house: the turbine hall along the street, the lower boiler house
/// behind it and a row of chimneys at the back.
fn power_house(x: &mut Site) -> bool {
    let (a, b, c, e) = edges(x);
    let (span, room) = (b - a, e - c);
    if span < 12.0 || room < 16.0 {
        return false;
    }
    let w = span.min(60.0);
    let (l, r) = (x.mid() - w * 0.5, x.mid() + w * 0.5);
    let t = c + 1.8;
    let hall = (0.35 * room).clamp(7.0, 14.0);
    let ok = x.rect(l, r, t, t + hall, "turbine-hall");
    let boiler = (0.3 * room).clamp(5.0, 12.0).min(room - 1.8 - hall);
    let boiler = if boiler >= 4.0 { boiler } else { 0.0 };
    if boiler > 0.0 {
        x.rect(l, r, t + hall, t + hall + boiler, "boiler-house");
    }
    let stack = 3.2;
    let t0 = t + hall + boiler + 0.8;
    if e - t0 >= stack {
        let stacks = ((w / 12.0).floor() as usize).clamp(1, 4);
        for k in 0..stacks {
            x.bar(l + (k as f64 + 0.5) * w / stacks as f64, stack, t0, t0 + stack, "factory-chimney");
        }
    }
    ok
}

/// Water tower: the round standpipe tower in the middle of its lot, the pump
/// house beside it on a wide one.
fn water_tower(x: &mut Site, rng: &mut Rng) -> bool {
    let (a, b, c, e) = edges(x);
    let (span, room) = (b - a, e - c);
    let side = (0.6 * span.min(room)).clamp(5.0, 9.0);
    if span < side || room < side {
        return false;
    }
    let pump = if span >= side + 5.5 { 5.0 } else { 0.0 };
    let whole = side + if pump > 0.0 { pump + 0.5 } else { 0.0 };
    let l = x.mid() - whole * 0.5;
    let left = rng.chance(0.5);
    let (t0, t1) = end(l, l + whole, side, left);
    let tc = c + (room - side) * 0.5;
    let ok = x.rect(t0, t1, tc, tc + side, "water-tower");
    if pump > 0.0 {
        let (p0, p1) = end(l, l + whole, pump, !left);
        let d = room.min(7.0);
        let pc = c + (room - d) * 0.5;
        x.rect(p0, p1, pc, pc + d, "pump-house");
    }
    ok
}

#[cfg(test)]
mod tests {
    use super::super::super::occupation::Frame;
    use super::super::super::super::{Point, Shape, geometry};
    use super::*;

    const ROLES: [&str; 21] = [
        "civic.townhall", "civic.courthouse", "civic.station", "commerce.department-store", "commerce.bank", "commerce.hotel",
        "commerce.office-block", "commerce.skyscraper", "civic.theatre", "civic.library", "civic.school", "worship.cathedral",
        "worship.parish", "worship.chapel", "worship.synagogue", "civic.fire-station", "commerce.market.hall", "craft.factory",
        "storage.elevator", "civic.power-house", "civic.water-tower",
    ];

    /// Parts of the form of `role` on a `w` x `d` rectangular lot of `culture` (empty: the family declines).
    fn parts(role: &str, culture: &str, w: f64, d: f64) -> Vec<super::super::super::landmark::Part> {
        let b = vec![Point { x: 0.0, y: 0.0 }, Point { x: w, y: 0.0 }, Point { x: w, y: d }, Point { x: 0.0, y: d }];
        let f = Frame { u: Point { x: 1.0, y: 0.0 }, n: Point { x: 0.0, y: 1.0 }, t0: 0.0 };
        let mut x = Site { b: &b, f, s0: 0.0, s1: w, ta: 0.0, t1: d, out: vec![] };
        let q = Brief { role, family: "western", culture, zone: "core", function: "collective", wealth: 0.5, landmark: false };
        build(&mut x, &q, &mut Rng::new(&format!("{role}/{w}")));
        x.out
    }

    #[test]
    fn modern_forms_lay_disjoint_ruled_parts_inside_the_lot() {
        for role in ROLES {
            for (w, d) in [(24.0, 40.0), (40.0, 60.0), (60.0, 34.0), (80.0, 110.0)] {
                let out = parts(role, "american-grid", w, d);
                assert!(!out.is_empty(), "{role} {w}x{d}: nothing laid");
                for (i, (ring, _, label)) in out.iter().enumerate() {
                    assert!(crate::urban::forms::roles::rule(label, &["american-grid"]).is_some(), "{role}: {label} has no mass rule");
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
    fn other_styles_are_declined_and_small_lots_refused() {
        for role in ROLES {
            assert!(parts(role, "european-organic", 40.0, 60.0).is_empty(), "{role}");
            assert!(parts(role, "american-grid", 4.0, 4.0).is_empty(), "{role}");
        }
    }
}
