//! Landmark preview massing keyed by the programme role: a parish church is a
//! nave, a choir with its apse and a west tower; a mosque a court with arcades,
//! a prayer hall and a minaret; a castle a keep inside a towered bailey. These
//! are city-side previews labelled by part, never disguised houses; the houses
//! engine has no landmark recipe yet (review issue 6).
//!
//! Pure geometry in the frame of the lot's main frontage (`s` along the street,
//! `t` inwards, the street at `t = ta`): every part is the buildable lot clipped
//! by a convex window, so it always lies inside the parcel, and parts are laid
//! side by side (no overlaps). Deterministic from the parcel seed.
use super::occupation::{Frame, Occupancy, Plane, circle, clip, clip_parts, ring_area};
use super::*;

type Part = (Vec<Point>, Option<Vec<Point>>, &'static str);

struct Site<'a> {
    b: &'a [Point],
    f: Frame,
    s0: f64,
    s1: f64,
    ta: f64,
    t1: f64,
    out: Vec<Part>,
}
impl Site<'_> {
    fn at(&self, s: f64, t: f64) -> Point {
        add(scale(self.f.u, s), scale(self.f.n, t))
    }
    fn mid(&self) -> f64 {
        (self.s0 + self.s1) * 0.5
    }
    fn width(&self) -> f64 {
        self.s1 - self.s0
    }
    fn depth(&self) -> f64 {
        self.t1 - self.ta
    }
    /// Every valid component of the lot inside the window (a concave lot may
    /// leave several), never one ring bridged by zero-width edges.
    fn clip(&mut self, planes: &[Plane], label: &'static str) -> bool {
        let mut ok = false;
        for r in clip_parts(self.b, planes) {
            if r.len() >= 3 && ring_area(&r).abs() >= 4.0 {
                self.out.push((r, None, label));
                ok = true;
            }
        }
        ok
    }
    fn rect(&mut self, s0: f64, s1: f64, t0: f64, t1: f64, label: &'static str) -> bool {
        s1 - s0 > 1.0 && t1 - t0 > 1.0 && self.clip(&self.f.rect(s0, s1, t0, t1), label)
    }
    /// Rectangle centred on `s`.
    fn bar(&mut self, s: f64, w: f64, t0: f64, t1: f64, label: &'static str) -> bool {
        self.rect(s - w * 0.5, s + w * 0.5, t0, t1, label)
    }
    fn disk(&mut self, s: f64, t: f64, r: f64, label: &'static str) -> bool {
        r > 1.0 && self.clip(&circle(self.at(s, t), r), label)
    }
    /// Half disk beyond `t` (an apse), centred on `s`.
    fn apse(&mut self, s: f64, t: f64, r: f64, label: &'static str) -> bool {
        let mut planes = circle(self.at(s, t), r);
        planes.push(self.f.above(t));
        r > 1.0 && self.clip(&planes, label)
    }
    /// A rectangle with a rectangular hole (a terrace around its hall).
    fn ring(&mut self, outer: [f64; 4], inner: [f64; 4], label: &'static str) -> bool {
        let [a, b, c, d] = outer;
        let [e, g, h, k] = inner;
        let r = clip(self.b, &self.f.rect(a, b, c, d));
        if r.len() < 3 || ring_area(&r).abs() < 4.0 {
            return false;
        }
        let shape = Shape {
            outer: r.clone(),
            holes: vec![],
        };
        let hole = (g - e > 1.0
            && k - h > 1.0
            && super::families::rect_within(
                &shape,
                self.at(e, h),
                self.f.u,
                self.f.n,
                g - e,
                k - h,
            ))
        .then(|| vec![self.at(e, h), self.at(g, h), self.at(g, k), self.at(e, k)]);
        self.out.push((r, hole, label));
        true
    }
    /// Ranges around an open court (cloister, caravanserai, madrasa), with a
    /// gate gap in the front range; the court itself stays unbuilt.
    fn court(&mut self, [a, b, c, d]: [f64; 4], range: f64, gate: f64, label: &'static str) {
        let r = range.min((b - a) * 0.3).min((d - c) * 0.3);
        let m = (a + b) * 0.5;
        if gate > 0.0 {
            self.rect(a, m - gate * 0.5, c, c + r, label);
            self.rect(m + gate * 0.5, b, c, c + r, label);
        } else {
            self.rect(a, b, c, c + r, label);
        }
        self.rect(a, a + r, c + r, d - r, label);
        self.rect(b - r, b, c + r, d - r, label);
        self.rect(a, b, d - r, d, label);
    }
}

fn family(pack: &str) -> &'static str {
    match pack.split('-').next().unwrap_or("") {
        _ if pack.starts_with("EUR-EAST") => "orthodox",
        _ if pack.starts_with("AF-MAG") || pack.starts_with("AF-NILE") => "maghreb",
        _ if pack.starts_with("AS-MIDE") => "persian",
        _ if pack.starts_with("AS-CHI") || pack.starts_with("AS-KOR") => "chinese",
        _ if pack.starts_with("AS-JAP") => "japanese",
        _ if pack.starts_with("AS-IND") || pack.starts_with("AS-SEA") => "indic",
        _ if pack.starts_with("MED-ANT") => "antique",
        _ if pack.starts_with("AM-MESO") || pack.starts_with("AM-AND") => "american",
        "AF" => "african",
        _ => "western",
    }
}

/// Landmark parts, or None when the role is not a landmark programme (or the
/// lot is too small for it, in which case the ordinary occupation applies).
pub(super) fn massing(
    o: &Occupancy,
    b: &[Point],
    f: Frame,
    (s0, s1, ta, t1): (f64, f64, f64, f64),
    rng: &mut Rng,
) -> Option<Vec<Part>> {
    let role = o.role;
    let style = family(o.pack);
    let mut x = Site {
        b,
        f,
        s0,
        s1,
        ta,
        t1,
        out: vec![],
    };
    let (w, d, m) = (x.width(), x.depth(), x.mid());
    if w < 8.0 || d < 8.0 {
        return None;
    }
    let short = w.min(d);
    let is = |p: &str| role == p || role.starts_with(&format!("{p}."));
    if is("worship.parish") || is("worship.cathedral") || is("worship.church") {
        church(&mut x, is("worship.cathedral"), style, rng)?;
    } else if is("worship.mosque") || is("worship.masjid") {
        mosque(
            &mut x,
            role == "worship.mosque.friday",
            is("worship.masjid"),
            style,
        )?;
    } else if is("worship.monastery") {
        // Church along one side, cloister ranges beside it.
        let cw = (0.3 * w).clamp(7.0, 14.0);
        let left = rng.chance(0.5);
        let (a, b2) = if left { (s0, s0 + cw) } else { (s1 - cw, s1) };
        let len = (0.85 * d).min(60.0);
        let t = ta + 1.0;
        x.rect(a, b2, t, t + cw * 0.9, "tower");
        x.rect(a, b2, t + cw * 0.9, t + len - cw * 0.5, "nave");
        x.apse((a + b2) * 0.5, t + len - cw * 0.5, cw * 0.4, "apse");
        let (c0, c1) = if left { (b2 + 1.0, s1) } else { (s0, a - 1.0) };
        let side = (c1 - c0).min(len);
        if side > 12.0 {
            let (c0, c1) = if left {
                (c0, c0 + side)
            } else {
                (c1 - side, c1)
            };
            x.court(
                [c0, c1, t, t + side],
                (side * 0.22).clamp(4.0, 8.0),
                0.0,
                "cloister",
            );
        }
    } else if is("worship.pyramid-precinct")
        || (style == "american" && role.starts_with("worship.temple"))
    {
        // Stepped pyramid: concentric terraces and the shrine on top.
        let side = (0.7 * short).clamp(12.0, 60.0);
        let (c, t) = (m, ta + d * 0.55);
        let steps = 3;
        for k in 0..steps {
            let o2 = side * 0.5 * (1.0 - k as f64 / (steps as f64 + 1.0));
            let i2 = side * 0.5 * (1.0 - (k + 1) as f64 / (steps as f64 + 1.0));
            x.ring(
                [c - o2, c + o2, t - o2, t + o2],
                [c - i2, c + i2, t - i2, t + i2],
                "terrace",
            );
        }
        let top = side * 0.5 / (steps as f64 + 1.0);
        x.rect(c - top, c + top, t - top, t + top, "shrine");
    } else if role.starts_with("worship.") && !matches!(role, "worship.wayside")
        || is("civic.drum-tower")
    {
        if is("civic.drum-tower") {
            let s = (0.5 * short).clamp(8.0, 18.0);
            x.bar(m, s, ta + (d - s) * 0.5, ta + (d + s) * 0.5, "tower");
        } else {
            temple(&mut x, role, style, rng)?;
        }
    } else if is("defence.keep")
        || is("defence.castle")
        || is("defence.fortress")
        || is("defence.fort")
        || is("defence.kasbah")
    {
        castle(&mut x, role, style)?;
    } else if is("defence.tower") || is("worship.wayside") {
        let s = (0.45 * short).clamp(4.0, 12.0);
        x.bar(m, s, ta + (d - s) * 0.5, ta + (d + s) * 0.5, "tower");
    } else if is("civic.townhall") || is("civic.council-house") || is("civic.guildhall") {
        // Hall on the street; a town hall raises a belfry in its middle.
        let depth = (0.45 * d).clamp(9.0, 18.0);
        let bell = (0.2 * w).clamp(5.0, 8.0);
        if is("civic.guildhall") || w < bell + 10.0 {
            x.rect(s0, s1, ta, ta + depth, "hall");
        } else {
            x.rect(s0, m - bell * 0.5, ta, ta + depth, "hall");
            x.bar(m, bell, ta, ta + bell, "belfry");
            x.rect(
                m - bell * 0.5,
                m + bell * 0.5,
                ta + bell,
                ta + depth,
                "hall",
            );
            x.rect(m + bell * 0.5, s1, ta, ta + depth, "hall");
        }
        if d - depth > 14.0 {
            x.rect(
                s0,
                s0 + (0.35 * w).max(5.0),
                ta + depth,
                ta + depth + (0.4 * d).min(20.0),
                "wing",
            );
        }
    } else if is("civic.bathhouse") || is("civic.hammam") || is("civic.thermae") {
        // Cold, warm and hot rooms in a row, the furnace behind.
        let bw = (0.6 * w).clamp(8.0, if is("civic.thermae") { 50.0 } else { 18.0 });
        let room = ((d - 6.0) / 3.5).clamp(4.0, if is("civic.thermae") { 20.0 } else { 9.0 });
        let t = ta + 1.0;
        x.bar(m, bw, t, t + room * 1.2, "cold-room");
        x.bar(m, bw * 0.85, t + room * 1.2, t + room * 2.2, "warm-room");
        x.bar(m, bw * 0.85, t + room * 2.2, t + room * 3.2, "hot-room");
        x.bar(
            m,
            (bw * 0.3).max(3.0),
            t + room * 3.2,
            t + room * 3.2 + 3.0,
            "furnace",
        );
    } else if is("commerce.caravanserai")
        || is("commerce.funduq")
        || is("commerce.inn")
        || is("commerce.dharamshala")
        || is("civic.madrasa")
        || is("civic.maristan")
        || is("civic.hospital")
        || is("defence.barracks")
        || is("civic.yamen")
        || is("elite.palace")
        || is("civic.palace")
        || is("civic.academy")
        || is("civic.university")
    {
        let side = (0.92 * w).min(0.92 * d);
        if side < 16.0 {
            return None;
        }
        let (a, c) = (m - side * 0.5, ta + 0.5);
        let range = if is("commerce.inn") {
            5.5
        } else {
            (0.16 * side).clamp(5.0, 10.0)
        };
        x.court([a, a + side, c, c + side.min(d - 1.0)], range, 3.5, "range");
    } else if is("commerce.market.hall")
        || is("commerce.macellum")
        || is("commerce.fishmarket")
        || (is("commerce.market") && !matches!(o.function, "market" | "common" | "open_space"))
    {
        let hw = (0.8 * w).min(30.0);
        x.bar(
            m,
            hw,
            ta + 2.0,
            ta + 2.0 + (0.7 * d).min(45.0),
            "market-hall",
        );
    } else if is("commerce.souk") || is("commerce.bazaar") || is("commerce.emporium") {
        // Two rows of booths along a covered lane.
        let lane = 3.5;
        let len = (0.9 * d).min(80.0);
        let row = ((w - lane) * 0.5).clamp(3.0, 7.0);
        x.rect(m - lane * 0.5 - row, m - lane * 0.5, ta, ta + len, "shops");
        x.rect(m + lane * 0.5, m + lane * 0.5 + row, ta, ta + len, "shops");
    } else if is("storage.granary") || is("storage.horreum") || is("storage.barn") {
        let gw = (0.4 * w).clamp(7.0, 14.0);
        x.bar(
            m,
            gw,
            ta + 2.0,
            ta + 2.0 + (0.75 * d).clamp(12.0, 50.0),
            "granary",
        );
    } else if is("storage.qollqa") {
        let r = 2.6;
        let mut t = ta + r + 1.0;
        while t + r < t1 {
            x.disk(m - 3.5, t, r, "store");
            x.disk(m + 3.5, t, r, "store");
            t += 2.0 * r + 1.5;
        }
    } else if is("craft.mill") {
        let (mw, md) = ((0.5 * w).clamp(7.0, 12.0), (0.5 * d).clamp(7.0, 12.0));
        x.bar(m, mw, ta + 1.0, ta + 1.0 + md, "mill-house");
        x.rect(
            m + mw * 0.5,
            m + mw * 0.5 + 1.5,
            ta + 2.0,
            ta + md - 1.0,
            "wheel",
        );
    } else {
        return None;
    }
    (!x.out.is_empty()).then_some(x.out)
}

fn church(x: &mut Site, cathedral: bool, style: &str, rng: &mut Rng) -> Option<()> {
    let (w, d, m) = (x.width(), x.depth(), x.mid());
    let parvis = (0.1 * d).clamp(1.5, 10.0);
    let t = x.ta + parvis;
    let room = x.t1 - t - 1.0;
    if style == "orthodox" {
        // Cross-in-square: narthex, domed naos, apse, detached bell tower.
        let q = (0.6 * w)
            .min(0.55 * room)
            .clamp(8.0, if cathedral { 32.0 } else { 18.0 });
        x.bar(m, q, t, t + 0.3 * q, "narthex");
        x.bar(m, q, t + 0.3 * q, t + 1.3 * q, "naos");
        x.apse(m, t + 1.3 * q, 0.22 * q, "apse");
        let bell = (0.28 * q).max(4.0);
        let side = if rng.chance(0.5) {
            m - q * 0.5 - bell - 2.0
        } else {
            m + q * 0.5 + 2.0
        };
        if side > x.s0 && side + bell < x.s1 {
            x.rect(side, side + bell, t, t + bell, "tower");
        }
        return Some(());
    }
    let nw = if cathedral {
        (0.3 * w).clamp(10.0, 20.0)
    } else {
        (0.32 * w).clamp(6.5, 12.0)
    };
    let tower = if cathedral { nw * 0.5 } else { nw * 0.9 };
    let choir = nw * 0.9;
    let r = 0.375 * nw;
    let nave = (room - tower - choir - r).min(if cathedral { 80.0 } else { 34.0 });
    if nave < nw || w < nw + 2.0 {
        return None;
    }
    if cathedral {
        // Twin west towers framing the portal.
        x.rect(
            m - nw * 0.5 - tower * 0.5,
            m - nw * 0.5 + tower * 0.5,
            t,
            t + tower,
            "tower",
        );
        x.rect(
            m - nw * 0.5 + tower * 0.5,
            m + nw * 0.5 - tower * 0.5,
            t,
            t + tower,
            "portal",
        );
        x.rect(
            m + nw * 0.5 - tower * 0.5,
            m + nw * 0.5 + tower * 0.5,
            t,
            t + tower,
            "tower",
        );
    } else {
        x.bar(m, tower, t, t + tower, "tower");
    }
    let t = t + tower;
    if cathedral && nave > 3.0 * nw {
        // Transept at two thirds of the nave.
        let a = t + nave * 0.66;
        x.bar(m, nw, t, a, "nave");
        x.bar(m, (2.2 * nw).min(w - 1.0), a, a + nw * 0.8, "transept");
        x.bar(m, nw, a + nw * 0.8, t + nave, "nave");
    } else {
        x.bar(m, nw, t, t + nave, "nave");
    }
    x.bar(m, nw * 0.75, t + nave, t + nave + choir, "choir");
    x.apse(m, t + nave + choir, r, "apse");
    Some(())
}

fn mosque(x: &mut Site, friday: bool, masjid: bool, style: &str) -> Option<()> {
    let (w, d, m) = (x.width(), x.depth(), x.mid());
    let (a, b) = (x.s0 + 0.5, x.s1 - 0.5);
    let (c, e) = (x.ta + 0.5, x.t1 - 0.5);
    let square = !matches!(style, "persian" | "indic");
    let tall = (0.12 * w.min(d)).clamp(4.0, if friday { 9.0 } else { 6.0 });
    if masjid || d < 24.0 || w < 16.0 {
        // Neighbourhood masjid: prayer hall and a small minaret at the street.
        let hall = (0.7 * d).clamp(8.0, 22.0);
        x.rect(a, b - tall - 0.5, e - hall, e, "prayer-hall");
        if square {
            x.rect(b - tall, b, c, c + tall, "minaret");
        } else {
            x.disk(b - tall * 0.5, c + tall * 0.5, tall * 0.4, "minaret");
        }
        return Some(());
    }
    // Prayer hall at the back (qibla), arcades around the sahn in front.
    let hall = (if friday { 0.5 } else { 0.42 } * (e - c)).clamp(10.0, 70.0);
    let h = e - hall;
    x.rect(a, b, h, e, "prayer-hall");
    let arc = (0.1 * w).clamp(3.0, 6.0);
    x.rect(
        a + tall,
        b - if friday { tall } else { 0.0 },
        c,
        c + arc,
        "arcade",
    );
    x.rect(a, a + arc, c + tall.max(arc), h, "arcade");
    x.rect(
        b - arc,
        b,
        c + if friday { tall.max(arc) } else { arc },
        h,
        "arcade",
    );
    let corners: &[f64] = if friday { &[0.0, 1.0] } else { &[0.0] };
    for &k in corners {
        let s = if k == 0.0 { a } else { b - tall };
        if square {
            x.rect(s, s + tall, c, c + tall, "minaret");
        } else {
            x.disk(s + tall * 0.5, c + tall * 0.5, tall * 0.4, "minaret");
        }
    }
    if friday && w > 30.0 {
        // Ablution fountain in the court.
        x.disk(m, (c + arc + h) * 0.5, 2.0, "fountain");
    }
    Some(())
}

fn temple(x: &mut Site, role: &str, style: &str, rng: &mut Rng) -> Option<()> {
    let (w, d, m) = (x.width(), x.depth(), x.mid());
    let t = x.ta + 1.0;
    let major = role.contains("major") || role.contains("city-god") || role.contains("confucian");
    match style {
        "chinese" | "japanese" => {
            // Axial gate hall, court, main hall on its terrace, rear hall.
            let hw = (0.7 * w).clamp(8.0, 36.0);
            x.bar(m, hw * 0.6, t, t + 5.0, "gate-hall");
            let pt = t + 5.0 + (0.18 * d).clamp(4.0, 20.0);
            let pd = (0.35 * d).clamp(8.0, 30.0);
            x.ring(
                [m - hw * 0.5, m + hw * 0.5, pt, pt + pd],
                [m - hw * 0.4, m + hw * 0.4, pt + 1.5, pt + pd - 1.5],
                "platform",
            );
            x.bar(m, hw * 0.8, pt + 1.5, pt + pd - 1.5, "hall");
            if major && x.t1 - (pt + pd) > 10.0 {
                x.bar(
                    m,
                    hw * 0.7,
                    pt + pd + 3.0,
                    (pt + pd + 3.0 + pd * 0.6).min(x.t1 - 1.0),
                    "hall",
                );
            }
            if major && w > hw + 10.0 {
                // Pagoda beside the axis.
                let p = (0.2 * w).clamp(6.0, 10.0);
                let s = if rng.chance(0.5) {
                    x.s0 + 1.0
                } else {
                    x.s1 - 1.0 - p
                };
                x.rect(s, s + p, t + 6.0, t + 6.0 + p, "pagoda");
            }
        }
        "indic" => {
            // Gopuram at the gate, mandapa, then the vimana tower.
            let hw = (0.4 * w).clamp(6.0, 24.0);
            x.bar(m, hw * 0.8, t, t + 5.0, "gopuram");
            let a = t + 5.0 + (0.15 * d).clamp(3.0, 15.0);
            let md = (0.3 * d).clamp(6.0, 25.0);
            x.bar(m, hw, a, a + md, "mandapa");
            x.bar(m, hw * 0.9, a + md, a + md + hw * 0.9, "vimana");
        }
        "antique" => {
            // Podium temple: pronaos steps and cella.
            let hw = (0.4 * w).clamp(8.0, 30.0);
            let len = (0.6 * d).clamp(12.0, 60.0);
            let start = t + (0.12 * d).clamp(2.0, 12.0);
            x.bar(m, hw, start, start + len * 0.35, "portico");
            x.bar(m, hw, start + len * 0.35, start + len, "cella");
        }
        _ => {
            // Platform and hall (shrine, hof, kiva and other temples).
            let hw = (0.5 * w).clamp(6.0, 28.0);
            let len = (0.6 * d).clamp(6.0, 50.0);
            let start = t + (0.15 * d).clamp(1.0, 12.0);
            x.ring(
                [
                    m - hw * 0.5 - 1.5,
                    m + hw * 0.5 + 1.5,
                    start - 1.5,
                    start + len + 1.5,
                ],
                [m - hw * 0.5, m + hw * 0.5, start, start + len],
                "platform",
            );
            x.bar(m, hw, start, start + len, "hall");
        }
    }
    (!x.out.is_empty()).then_some(())
}

fn castle(x: &mut Site, role: &str, style: &str) -> Option<()> {
    let (w, d, m) = (x.width(), x.depth(), x.mid());
    let (a, b, c, e) = (x.s0 + 0.5, x.s1 - 0.5, x.ta + 0.5, x.t1 - 0.5);
    let short = w.min(d);
    let keep = (0.35 * short).clamp(7.0, if role.contains("keep") { 18.0 } else { 24.0 });
    if short < 20.0 || role == "defence.keep" && short < 30.0 {
        // A lone keep (donjon, tower house) in its yard.
        x.bar(
            m,
            keep.min(w - 2.0),
            c + (d - keep) * 0.5,
            c + (d + keep) * 0.5,
            "keep",
        );
        return Some(());
    }
    let tw = (0.1 * short).clamp(4.0, 9.0);
    let wall = (0.35 * tw).clamp(1.5, 3.0);
    let round = matches!(style, "western" | "orthodox");
    for (s, t) in [(a, c), (b - tw, c), (a, e - tw), (b - tw, e - tw)] {
        if round {
            x.disk(s + tw * 0.5, t + tw * 0.5, tw * 0.5, "tower");
        } else {
            x.rect(s, s + tw, t, t + tw, "tower");
        }
    }
    // Curtain walls between the towers, a gate in the front wall.
    let gate = 4.0;
    let inset = (tw - wall) * 0.5;
    x.rect(a + tw, m - gate * 0.5, c + inset, c + inset + wall, "wall");
    x.rect(m + gate * 0.5, b - tw, c + inset, c + inset + wall, "wall");
    x.rect(a + tw, b - tw, e - inset - wall, e - inset, "wall");
    x.rect(a + inset, a + inset + wall, c + tw, e - tw, "wall");
    x.rect(b - inset - wall, b - inset, c + tw, e - tw, "wall");
    // Keep towards the back, a hall (palas) along one side.
    let kt = e - tw - 2.0 - keep;
    x.bar(m, keep, kt, kt + keep, "keep");
    if role != "defence.kasbah" && kt - (c + tw + 4.0) > 8.0 {
        x.rect(
            a + tw,
            a + tw + (0.2 * w).clamp(5.0, 10.0),
            c + tw + 4.0,
            kt - 2.0,
            "hall",
        );
    }
    Some(())
}
