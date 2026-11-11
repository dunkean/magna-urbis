//! Main-town site choice: port of `web/src/gen/site/site.ts` (`chooseSite`) and `position.ts` (`resolvePosition`).
//!
//! Same algorithm and the same random draws (sfc32 forks `site` / `jitter` / `archetype`). The polyline scans of the
//! TypeScript (`pointAt` walks, `nearestOn` per candidate cell) use a cumulative-length table and a segment grid.
//!
//! Wire format (request and reply): u32 LE header length, JSON header padded with spaces to a multiple of 4, planes.
//! Request planes: height f32, slope f32, water u8, river points f64 (x, y pairs, all rivers), river widths f64.
//! Reply planes: dWater, dSea, dMain, hab, slopeS, cost (f32), then riverMask, bridgeZone, wide (u8).

use magna_urbis_random::Rng;
use magna_urbis_terrain::noise::Noise;
use serde::Deserialize;
use serde_json::json;
use std::cell::OnceCell;
use std::cmp::Ordering;
use std::collections::{BinaryHeap, HashMap};

pub const BIG_RIVER_W: f64 = 4.5;
const ARCHETYPES: [&str; 12] = [
    "bridge", "confluence", "meander", "harbor", "estuary", "valley", "hilltop", "plain", "lakeshore", "island", "spur", "pass",
];

#[derive(Clone, Copy, Debug, Default, Deserialize)]
pub struct P {
    pub x: f64,
    pub y: f64,
}
fn dist(a: P, b: P) -> f64 {
    (b.x - a.x).hypot(b.y - a.y)
}
fn smoothstep(x: f64, a: f64, b: f64) -> f64 {
    let d = b - a;
    let t = ((x - a) / if d == 0.0 { 1e-9 } else { d }).clamp(0.0, 1.0);
    t * t * (3.0 - 2.0 * t)
}
fn clamp01(v: f64) -> f64 {
    if v < 0.0 { 0.0 } else if v > 1.0 { 1.0 } else { v }
}
/// JavaScript `Math.round`.
fn jround(v: f64) -> f64 {
    (v + 0.5).floor()
}

#[derive(Deserialize, Default, Clone)]
#[serde(rename_all = "camelCase")]
pub struct PrefsIn {
    #[serde(default)]
    pub weights: HashMap<String, f64>,
    pub water_side: Option<String>,
    pub hill_side: Option<String>,
    pub mountain_face: Option<f64>,
    pub woodland: Option<f64>,
    pub flatness: Option<f64>,
    pub margin: Option<f64>,
    pub center_inset: Option<f64>,
}
#[derive(Deserialize)]
pub struct RiverIn {
    /// Number of path points.
    pub len: usize,
    /// Number of width entries.
    pub wlen: usize,
    pub main: bool,
    pub mouth: Option<String>,
    pub id: Option<i64>,
    pub host: Option<i64>,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Header {
    /// Reply with the display planes only (dWater, hab): the V2 keeps the native placement and
    /// land use computes its own fields, so the other planes would cross the wire unused.
    #[serde(default)]
    pub display_only: bool,
    pub seed_key: String,
    pub n: usize,
    pub cell: f64,
    pub map_size: f64,
    pub sea_fraction: f64,
    pub size: String,
    pub relief: String,
    pub site_type: Option<String>,
    pub center: Option<P>,
    pub site_prefs: Option<PrefsIn>,
    pub rivers: Vec<RiverIn>,
}

struct River {
    path: Vec<P>,
    width: Vec<f64>,
    pre: Vec<f64>,
    main: bool,
    mouth: Option<String>,
    id: Option<i64>,
    host: Option<i64>,
    index: OnceCell<PolyIndex>,
}
impl River {
    fn w_at(&self, i: usize) -> f64 {
        self.width.get(i).copied().unwrap_or(f64::NAN)
    }
    fn wmax(&self) -> f64 {
        self.width.iter().copied().fold(f64::NEG_INFINITY, f64::max)
    }
    fn wmin(&self) -> f64 {
        self.width.iter().copied().fold(f64::INFINITY, f64::min)
    }
    fn total(&self) -> f64 {
        *self.pre.last().unwrap_or(&0.0)
    }
    /// Distance to the river when it is at most `r`, else `None` (exactly `nearestOn(path, p).d`).
    fn dist_within(&self, p: P, r: f64) -> Option<f64> {
        self.index.get_or_init(|| PolyIndex::new(&self.path, 24.0)).nearest(&self.path, p, r).map(|n| n.d)
    }
}

struct Near {
    pt: P,
    i: usize,
    t: f64,
    d: f64,
}
fn nearest_on(pl: &[P], p: P) -> Near {
    let mut best = f64::INFINITY;
    let mut res = Near { pt: pl[0], i: 0, t: 0.0, d: f64::INFINITY };
    for i in 0..pl.len().saturating_sub(1) {
        let (a, b) = (pl[i], pl[i + 1]);
        let (dx, dy) = (b.x - a.x, b.y - a.y);
        let l2 = dx * dx + dy * dy;
        let t = if l2 == 0.0 { 0.0 } else { (((p.x - a.x) * dx + (p.y - a.y) * dy) / l2).clamp(0.0, 1.0) };
        let (qx, qy) = (a.x + t * dx, a.y + t * dy);
        let d = (p.x - qx).hypot(p.y - qy);
        if d < best {
            best = d;
            res = Near { pt: P { x: qx, y: qy }, i, t, d };
        }
    }
    res
}

/// Segment grid: `nearest(p, R)` is exactly `nearest_on` (first index on ties) when its distance is <= R.
struct PolyIndex {
    cs: f64,
    cells: HashMap<(i64, i64), Vec<u32>>,
}
impl PolyIndex {
    fn new(pl: &[P], cs: f64) -> Self {
        let mut cells: HashMap<(i64, i64), Vec<u32>> = HashMap::new();
        for i in 0..pl.len().saturating_sub(1) {
            let (a, b) = (pl[i], pl[i + 1]);
            let (x0, x1) = ((a.x.min(b.x) / cs).floor() as i64, (a.x.max(b.x) / cs).floor() as i64);
            let (y0, y1) = ((a.y.min(b.y) / cs).floor() as i64, (a.y.max(b.y) / cs).floor() as i64);
            for y in y0..=y1 {
                for x in x0..=x1 {
                    cells.entry((x, y)).or_default().push(i as u32);
                }
            }
        }
        Self { cs, cells }
    }
    fn nearest(&self, pl: &[P], p: P, r: f64) -> Option<Near> {
        if pl.len() < 2 || !(r >= 0.0) {
            return None;
        }
        let cs = self.cs;
        let (x0, x1) = (((p.x - r) / cs).floor() as i64, ((p.x + r) / cs).floor() as i64);
        let (y0, y1) = (((p.y - r) / cs).floor() as i64, ((p.y + r) / cs).floor() as i64);
        let mut best = f64::INFINITY;
        let mut found: Option<Near> = None;
        let mut bi = usize::MAX;
        for y in y0..=y1 {
            for x in x0..=x1 {
                let Some(list) = self.cells.get(&(x, y)) else { continue };
                for &iu in list {
                    let i = iu as usize;
                    let (a, b) = (pl[i], pl[i + 1]);
                    let (dx, dy) = (b.x - a.x, b.y - a.y);
                    let l2 = dx * dx + dy * dy;
                    let t = if l2 == 0.0 { 0.0 } else { (((p.x - a.x) * dx + (p.y - a.y) * dy) / l2).clamp(0.0, 1.0) };
                    let (qx, qy) = (a.x + t * dx, a.y + t * dy);
                    let d = (p.x - qx).hypot(p.y - qy);
                    if d < best || (d == best && i < bi) {
                        best = d;
                        bi = i;
                        found = Some(Near { pt: P { x: qx, y: qy }, i, t, d });
                    }
                }
            }
        }
        found.filter(|n| n.d <= r)
    }
}

fn lengths(pl: &[P]) -> Vec<f64> {
    let mut s = vec![0.0];
    for i in 1..pl.len() {
        let v = s[i - 1] + dist(pl[i - 1], pl[i]);
        s.push(v);
    }
    s
}
/// `pointAt(pl, s)` with the prefix table: the same floats as the linear walk.
fn point_at(pl: &[P], pre: &[f64], s: f64) -> (P, usize) {
    let n = pl.len();
    if n < 2 {
        return (pl[0], 0);
    }
    let (mut lo, mut hi) = (1, n - 1);
    while lo < hi {
        let m = (lo + hi) >> 1;
        if pre[m] >= s { hi = m } else { lo = m + 1 }
    }
    let i = lo;
    let (a, b) = (pl[i - 1], pl[i]);
    let l = dist(a, b);
    let t = if l > 0.0 { ((s - pre[i - 1]) / l).clamp(0.0, 1.0) } else { 0.0 };
    (P { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }, i - 1)
}
fn tangent_at(pl: &[P], pre: &[f64], s: f64, half: f64) -> P {
    let total = *pre.last().unwrap_or(&0.0);
    let a = point_at(pl, pre, (s - half).max(0.0)).0;
    let b = point_at(pl, pre, (s + half).min(total)).0;
    let l = dist(a, b);
    let l = if l == 0.0 { 1.0 } else { l };
    P { x: (b.x - a.x) / l, y: (b.y - a.y) / l }
}
fn polygon_area(p: &[P]) -> f64 {
    let n = p.len();
    let mut s = 0.0;
    for i in 0..n {
        let (a, b) = (p[i], p[(i + 1) % n]);
        s += a.x * b.y - b.x * a.y;
    }
    s / 2.0
}
fn polygon_contains(p: &[P], pt: P) -> bool {
    let mut inside = false;
    let mut j = p.len().wrapping_sub(1);
    for i in 0..p.len() {
        let (a, b) = (p[i], p[j]);
        if (a.y > pt.y) != (b.y > pt.y) && pt.x < ((b.x - a.x) * (pt.y - a.y)) / (b.y - a.y) + a.x {
            inside = !inside;
        }
        j = i;
    }
    inside
}

/// Cells whose centre is within `radius` of the polyline (the callbacks used here are idempotent: no `seen` set).
fn for_cells_near(pl: &[P], n: usize, cell: f64, radius: f64, mut f: impl FnMut(usize)) {
    for i in 1..pl.len() {
        let (a, b) = (pl[i - 1], pl[i]);
        let x0 = (((a.x.min(b.x) - radius) / cell).floor().max(0.0)) as usize;
        let x1 = (((a.x.max(b.x) + radius) / cell).floor().min(n as f64 - 1.0)).max(-1.0);
        let y0 = (((a.y.min(b.y) - radius) / cell).floor().max(0.0)) as usize;
        let y1 = (((a.y.max(b.y) + radius) / cell).floor().min(n as f64 - 1.0)).max(-1.0);
        if x1 < 0.0 || y1 < 0.0 {
            continue;
        }
        let (dx, dy) = (b.x - a.x, b.y - a.y);
        let l2 = {
            let v = dx * dx + dy * dy;
            if v == 0.0 { 1.0 } else { v }
        };
        for y in y0..=(y1 as usize) {
            for x in x0..=(x1 as usize) {
                let (px, py) = ((x as f64 + 0.5) * cell, (y as f64 + 0.5) * cell);
                let t = (((px - a.x) * dx + (py - a.y) * dy) / l2).clamp(0.0, 1.0);
                let d = (px - a.x - t * dx).hypot(py - a.y - t * dy);
                if d <= radius {
                    f(y * n + x);
                }
            }
        }
    }
}

/// Two-pass chamfer distance transform (same relaxation order and f32 stores as the TypeScript).
fn distance_field(mask: &[u8], n: usize, cell: f64, carry: Option<&[f32]>) -> (Vec<f32>, Option<Vec<f32>>) {
    let total = n * n;
    let mut dist = vec![1e9_f32; total];
    let mut val = carry.map(|_| vec![0f32; total]);
    for i in 0..total {
        if mask[i] != 0 {
            dist[i] = 0.0;
            if let (Some(v), Some(c)) = (val.as_mut(), carry) {
                v[i] = c[i];
            }
        }
    }
    let s2 = std::f64::consts::SQRT_2;
    let relax = |dist: &mut [f32], val: &mut Option<Vec<f32>>, i: usize, j: usize, w: f64| {
        let d = dist[j] as f64 + w;
        if d < dist[i] as f64 {
            dist[i] = d as f32;
            if let Some(v) = val.as_mut() {
                v[i] = v[j];
            }
        }
    };
    for y in 0..n {
        for x in 0..n {
            let i = y * n + x;
            if x > 0 { relax(&mut dist, &mut val, i, i - 1, 1.0) }
            if y > 0 {
                relax(&mut dist, &mut val, i, i - n, 1.0);
                if x > 0 { relax(&mut dist, &mut val, i, i - n - 1, s2) }
                if x < n - 1 { relax(&mut dist, &mut val, i, i - n + 1, s2) }
            }
        }
    }
    for y in (0..n).rev() {
        for x in (0..n).rev() {
            let i = y * n + x;
            if x < n - 1 { relax(&mut dist, &mut val, i, i + 1, 1.0) }
            if y < n - 1 {
                relax(&mut dist, &mut val, i, i + n, 1.0);
                if x < n - 1 { relax(&mut dist, &mut val, i, i + n + 1, s2) }
                if x > 0 { relax(&mut dist, &mut val, i, i + n - 1, s2) }
            }
        }
    }
    for d in dist.iter_mut() {
        *d = (*d as f64 * cell) as f32;
    }
    (dist, val)
}

/// Separable box blur, clipped windows, float32 intermediate stores (sliding sums in f64).
fn blur(src: &[f32], n: usize, radius: usize, passes: usize) -> Vec<f32> {
    let mut src = src.to_vec();
    let mut tmp = vec![0f32; n * n];
    let mut acc = vec![0f64; n];
    for _ in 0..passes {
        for y in 0..n {
            let row = y * n;
            let mut s = 0.0f64;
            for k in 0..=radius.min(n - 1) {
                s += src[row + k] as f64;
            }
            for x in 0..n {
                let cnt = (x + radius).min(n - 1) - x.saturating_sub(radius) + 1;
                tmp[row + x] = (s / cnt as f64) as f32;
                if x + radius + 1 < n { s += src[row + x + radius + 1] as f64 }
                if x >= radius { s -= src[row + x - radius] as f64 }
            }
        }
        let mut out = vec![0f32; n * n];
        for x in 0..n {
            let mut s = 0.0;
            for k in 0..=radius.min(n - 1) {
                s += tmp[k * n + x] as f64;
            }
            acc[x] = s;
        }
        for y in 0..n {
            let cnt = (y + radius).min(n - 1) - y.saturating_sub(radius) + 1;
            for x in 0..n {
                out[y * n + x] = (acc[x] / cnt as f64) as f32;
                if y + radius + 1 < n { acc[x] += tmp[(y + radius + 1) * n + x] as f64 }
                if y >= radius { acc[x] -= tmp[(y - radius) * n + x] as f64 }
            }
        }
        src = out;
    }
    src
}

fn make_sat(m: &[u8], n: usize) -> Vec<i32> {
    let mut sat = vec![0i32; (n + 1) * (n + 1)];
    for y in 0..n {
        let mut row = 0i32;
        for x in 0..n {
            row += m[y * n + x] as i32;
            sat[(y + 1) * (n + 1) + x + 1] = sat[y * (n + 1) + x + 1] + row;
        }
    }
    sat
}

#[derive(Clone, Copy)]
struct Need {
    hab_min: f64,
    hab_max: Option<f64>,
    slope_max: f64,
    smooth_max: f64,
    bfrac_min: f64,
    rb: f64,
}
#[derive(Clone, Copy, Default)]
struct Cand {
    i: usize,
    q: f64,
    crossing: Option<P>,
    harbor: Option<P>,
    feature: Option<P>,
}
#[derive(Clone, Copy)]
struct Anchor {
    p: P,
    q: f64,
    s: f64,
    total: f64,
    r: usize,
    w: f64,
}

struct Ctx<'a> {
    n: usize,
    cell: f64,
    s: f64,
    h: &'a [f32],
    water: &'a [u8],
    slope_raw: &'a [f32],
    slope_s: Vec<f32>,
    hb: Vec<f32>,
    hab: Vec<f32>,
    dw: Vec<f32>,
    sat_b: Vec<i32>,
    margin: f64,
    flat_w: f64,
    prefs: PrefsIn,
    jit: Noise,
    c0: P,
}
impl Ctx<'_> {
    fn at(&self, x: f64, y: f64) -> usize {
        let n = self.n as f64;
        ((y / self.cell).floor().max(0.0).min(n - 1.0) as usize) * self.n + (x / self.cell).floor().max(0.0).min(n - 1.0) as usize
    }
    fn pos(&self, i: usize) -> P {
        P { x: ((i % self.n) as f64 + 0.5) * self.cell, y: ((i / self.n) as f64 + 0.5) * self.cell }
    }
    fn in_m(&self, x: f64, y: f64, slack: f64) -> bool {
        let (m, s) = (self.margin, self.s);
        x >= m - slack && x <= s - m + slack && y >= m - slack && y <= s - m + slack
    }
    fn frac(&self, sat: &[i32], x: f64, y: f64, rad: f64) -> f64 {
        let (n, cell) = (self.n as i64, self.cell);
        let x0 = (((x - rad) / cell).floor() as i64).max(0);
        let x1 = (((x + rad) / cell).floor() as i64).min(n - 1);
        let y0 = (((y - rad) / cell).floor() as i64).max(0);
        let y1 = (((y + rad) / cell).floor() as i64).min(n - 1);
        let cnt = ((x1 - x0 + 1) * (y1 - y0 + 1)) as f64;
        let w = (n + 1) as usize;
        let at = |yy: i64, xx: i64| sat[yy as usize * w + xx as usize];
        let s = at(y1 + 1, x1 + 1) - at(y0, x1 + 1) - at(y1 + 1, x0) + at(y0, x0);
        let full = (jround((2.0 * rad) / cell) + 1.0).max(1.0).powi(2);
        s as f64 / cnt.max(full)
    }
    fn water_dir_score(&self, x: f64, y: f64, want: P) -> f64 {
        let (mut sc, mut tot) = (0.0, 0.0);
        for k in 0..8 {
            let a = (k as f64 / 8.0) * 6.2832;
            let d = P { x: a.cos(), y: a.sin() };
            let mut hit = 0.0;
            for rad in [80.0, 160.0, 260.0, 400.0] {
                let (px, py) = (x + d.x * rad, y + d.y * rad);
                if px < 0.0 || py < 0.0 || px > self.s || py > self.s {
                    break;
                }
                if self.water[self.at(px, py)] != 0 {
                    hit = 1.0 - rad / 600.0;
                    break;
                }
            }
            let al = d.x * want.x + d.y * want.y;
            sc += al * hit;
            tot += al.max(0.0);
        }
        if tot > 0.0 { sc / tot } else { 0.0 }
    }
    fn hill_dir_score(&self, x: f64, y: f64, want: P) -> f64 {
        let d = 260.0;
        let hh = |x: f64, y: f64| self.h[self.at(x, y)] as f64;
        let gx = (hh(x + d, y) - hh(x - d, y)) / (2.0 * d);
        let gy = (hh(x, y + d) - hh(x, y - d)) / (2.0 * d);
        let g = gx.hypot(gy);
        if g < 1e-6 {
            return 0.0;
        }
        ((gx * want.x + gy * want.y) / g) * (g / 0.05).min(1.0)
    }
    fn pref_bonus(&self, i: usize, x: f64, y: f64) -> f64 {
        let mut b = 0.0;
        if let Some(side) = &self.prefs.water_side {
            b += 1.1 * self.water_dir_score(x, y, side_vec(side));
        }
        if let Some(side) = &self.prefs.hill_side {
            b += 1.1 * self.hill_dir_score(x, y, side_vec(side));
        }
        if let Some(mf) = self.prefs.mountain_face.filter(|v| *v != 0.0) {
            let hi = self.h[i] as f64;
            b += 1.4
                * mf
                * smoothstep(self.slope_s[i] as f64 + 0.4 * (((self.hb[i] as f64 - hi) * -0.01).max(0.0)), 0.04, 0.2)
                * (1.0 - smoothstep(self.slope_raw[i] as f64, 0.05, 0.12));
        }
        b
    }
    fn eval_cell(&self, i: usize, nd: &Need) -> f64 {
        if self.water[i] != 0 {
            return f64::NEG_INFINITY;
        }
        let p = self.pos(i);
        if !self.in_m(p.x, p.y, 0.0) {
            return f64::NEG_INFINITY;
        }
        let (sr, ss) = (self.slope_raw[i] as f64, self.slope_s[i] as f64);
        if sr > nd.slope_max || ss > nd.smooth_max {
            return f64::NEG_INFINITY;
        }
        let (hab, dw) = (self.hab[i] as f64, self.dw[i] as f64);
        if dw < 200.0 && hab < nd.hab_min {
            return f64::NEG_INFINITY;
        }
        if let Some(hm) = nd.hab_max {
            if hab > hm {
                return f64::NEG_INFINITY;
            }
        }
        let bf = self.frac(&self.sat_b, p.x, p.y, nd.rb);
        if bf < nd.bfrac_min {
            return f64::NEG_INFINITY;
        }
        let flat_a = 1.0 - smoothstep(ss, 0.15 * nd.smooth_max, 0.9 * nd.smooth_max);
        let flat_p = 1.0 - smoothstep(sr, 0.3 * nd.slope_max, 1.1 * nd.slope_max);
        let dry = if dw < 150.0 { smoothstep(hab, 1.0, 5.0) } else { 1.0 };
        let central = 1.0 - (dist(p, self.c0) / (0.3 * self.s)).min(1.0) * 0.6;
        2.2 * self.flat_w * flat_a
            + self.flat_w * flat_p
            + dry
            + 1.8 * bf
            + 0.8 * central
            + 0.25 * self.jit.fbm(p.x / 450.0, p.y / 450.0, 2)
            + self.pref_bonus(i, p.x, p.y)
    }
    /// Best cell around `anchor` (within `rad`); `extra` adds an archetype term or vetoes (-inf).
    fn refine(&self, anchor: P, rad: f64, nd: &Need, extra: &dyn Fn(usize, P) -> f64) -> Option<(usize, f64)> {
        let (n, cell) = (self.n as i64, self.cell);
        let x0 = (((anchor.x - rad) / cell).floor() as i64).max(0);
        let x1 = (((anchor.x + rad) / cell).floor() as i64).min(n - 1);
        let y0 = (((anchor.y - rad) / cell).floor() as i64).max(0);
        let y1 = (((anchor.y + rad) / cell).floor() as i64).min(n - 1);
        let (mut best, mut bi) = (f64::NEG_INFINITY, usize::MAX);
        for y in y0..=y1 {
            for x in x0..=x1 {
                let i = y as usize * self.n + x as usize;
                let p = self.pos(i);
                if (p.x - anchor.x).hypot(p.y - anchor.y) > rad {
                    continue;
                }
                let e = self.eval_cell(i, nd);
                if e == f64::NEG_INFINITY {
                    continue;
                }
                let ex = extra(i, p);
                if ex == f64::NEG_INFINITY {
                    continue;
                }
                if e + ex > best {
                    best = e + ex;
                    bi = i;
                }
            }
        }
        (bi != usize::MAX).then_some((bi, best))
    }
}
fn side_vec(s: &str) -> P {
    match s {
        "N" => P { x: 0.0, y: -1.0 },
        "S" => P { x: 0.0, y: 1.0 },
        "E" => P { x: 1.0, y: 0.0 },
        _ => P { x: -1.0, y: 0.0 },
    }
}

fn spaced<T: Clone>(list: &[T], gap: f64, k: usize, get: impl Fn(&T) -> (P, f64)) -> Vec<T> {
    let mut sorted: Vec<&T> = list.iter().collect();
    sorted.sort_by(|a, b| get(b).1.partial_cmp(&get(a).1).unwrap_or(Ordering::Equal));
    let mut out: Vec<T> = Vec::new();
    for c in sorted {
        if out.len() >= k {
            break;
        }
        let cp = get(c).0;
        if out.iter().all(|o| dist(get(o).0, cp) >= gap) {
            out.push(c.clone());
        }
    }
    out
}
fn pct(a: &[f64], q: f64) -> f64 {
    if a.is_empty() { 0.0 } else { a[(a.len() - 1).min((a.len() as f64 * q).floor() as usize)] }
}
fn sort_f64(v: &mut [f64]) {
    v.sort_by(|a, b| a.partial_cmp(b).unwrap_or(Ordering::Equal));
}

#[derive(PartialEq)]
struct HeapItem(f64, usize);
impl Eq for HeapItem {}
impl Ord for HeapItem {
    fn cmp(&self, o: &Self) -> Ordering {
        o.0.partial_cmp(&self.0).unwrap_or(Ordering::Equal).then(o.1.cmp(&self.1))
    }
}
impl PartialOrd for HeapItem {
    fn partial_cmp(&self, o: &Self) -> Option<Ordering> {
        Some(self.cmp(o))
    }
}

const D8: [(i64, i64); 8] = [(1, 0), (1, 1), (0, 1), (-1, 1), (-1, 0), (-1, -1), (0, -1), (1, -1)];

/// Travel cost from `start` over passability classes (0 blocked, 1 land, 2 brook, 3 bridgeable river).
pub(crate) fn travel_cost(n: usize, cell: f64, start: usize, pass: &[u8], h: &[f32]) -> Vec<f32> {
    let total = n * n;
    let mut d = vec![f64::INFINITY; total];
    let mut heap = BinaryHeap::new();
    d[start] = 0.0;
    heap.push(HeapItem(0.0, start));
    while let Some(HeapItem(key, c)) = heap.pop() {
        if key > d[c] {
            continue;
        }
        let (cx, cy) = ((c % n) as i64, (c / n) as i64);
        for (k, (dx, dy)) in D8.iter().enumerate() {
            let (nx, ny) = (cx + dx, cy + dy);
            if nx < 0 || ny < 0 || nx >= n as i64 || ny >= n as i64 {
                continue;
            }
            let nb = ny as usize * n + nx as usize;
            let dd = if k % 2 == 0 { 1.0 } else { std::f64::consts::SQRT_2 };
            let pt = pass[nb];
            if pt == 0 {
                continue;
            }
            let g = if pt >= 2 || pass[c] >= 2 { 0.0 } else { (h[nb] as f64 - h[c] as f64).abs() / (dd * cell) };
            let sc = dd * cell * (1.0 + 100.0 * g * g) * (if pt == 1 { 1.0 } else if pt == 2 { 4.0 } else { 3.0 });
            let nd = key + sc;
            if nd < d[nb] {
                d[nb] = nd;
                heap.push(HeapItem(nd, nb));
            }
        }
    }
    d.into_iter().map(|v| v as f32).collect()
}

/// `resolvePosition` (no `maxMove`): keep a usable requested point, else the nearest safe cell.
fn resolve_position(
    water: &[u8], slope: &[f32], n: usize, cell: f64, map_size: f64, requested: P, inset: f64, slope_max: f64, allowed: &dyn Fn(usize) -> bool,
) -> Option<P> {
    if !requested.x.is_finite() || !requested.y.is_finite() {
        return None;
    }
    let inset = (map_size / 2.0 - cell / 2.0).min((cell / 2.0).max(inset));
    let target = P { x: requested.x.min(map_size - inset).max(inset), y: requested.y.min(map_size - inset).max(inset) };
    let index_at = |p: P| ((p.y / cell).floor().max(0.0).min(n as f64 - 1.0) as usize) * n + (p.x / cell).floor().max(0.0).min(n as f64 - 1.0) as usize;
    let safe = |i: usize, p: P| {
        p.x >= inset && p.y >= inset && p.x <= map_size - inset && p.y <= map_size - inset && water[i] == 0
            && slope[i].is_finite() && slope[i] as f64 <= slope_max && allowed(i)
    };
    if safe(index_at(target), target) {
        return Some(target);
    }
    let (mut chosen, mut best) = (None, f64::INFINITY);
    for y in 0..n {
        for x in 0..n {
            let p = P { x: (x as f64 + 0.5) * cell, y: (y as f64 + 0.5) * cell };
            let d = (p.x - target.x).powi(2) + (p.y - target.y).powi(2);
            if d >= best || !safe(y * n + x, p) {
                continue;
            }
            chosen = Some(p);
            best = d;
        }
    }
    chosen
}

pub struct SiteInput<'a> {
    pub header: Header,
    pub height: &'a [f32],
    pub slope: &'a [f32],
    pub water: &'a [u8],
    pub points: Vec<P>,
    pub widths: Vec<f64>,
}
pub struct SiteOutput {
    pub header: serde_json::Value,
    pub d_water: Vec<f32>,
    pub d_sea: Vec<f32>,
    pub d_main: Vec<f32>,
    pub hab: Vec<f32>,
    pub slope_s: Vec<f32>,
    pub cost: Vec<f32>,
    pub river_mask: Vec<u8>,
    pub bridge_zone: Vec<u8>,
    pub wide: Vec<u8>,
}

fn relief_hill(r: &str) -> f64 {
    match r {
        "flat" => 0.3,
        "valley" => 0.85,
        "mountains" => 1.5,
        _ => 1.0,
    }
}

pub fn choose_site(input: &SiteInput) -> Result<SiteOutput, String> {
    let hd = &input.header;
    let (n, cell, s) = (hd.n, hd.cell, hd.map_size);
    let total = n * n;
    if n < 2 || input.height.len() != total || input.slope.len() != total || input.water.len() != total {
        return Err("Invalid site grids.".into());
    }
    let (h, water, slope_raw) = (input.height, input.water, input.slope);
    let prefs = hd.site_prefs.clone().unwrap_or_default();
    let rres = match hd.size.as_str() { "hamlet" => 90.0, "village" => 170.0, "town" => 380.0, "city" => 700.0, _ => 1150.0 };
    let size_idx = match hd.size.as_str() { "hamlet" => 0, "village" => 1, "town" => 2, "city" => 3, _ => 4 };

    // rivers
    let (mut po, mut wo) = (0usize, 0usize);
    let mut rivers: Vec<River> = Vec::new();
    for r in &hd.rivers {
        if po + r.len > input.points.len() || wo + r.wlen > input.widths.len() {
            return Err("Site rivers truncated.".into());
        }
        let path = input.points[po..po + r.len].to_vec();
        po += r.len;
        let width = input.widths[wo..wo + r.wlen].to_vec();
        wo += r.wlen;
        let pre = lengths(&path);
        rivers.push(River { path, width, pre, main: r.main, mouth: r.mouth.clone(), id: r.id, host: r.host, index: OnceCell::new() });
    }

    // ---- river masks
    let main_idx = rivers.iter().position(|r| r.main);
    let mut river_mask = vec![0u8; total];
    let mark = |rv: &River, val: u8, mask: &mut Vec<u8>| {
        for i in 1..rv.path.len() {
            let rad = (rv.w_at(i) / 2.0).max(cell * 0.6) + cell * 0.8;
            for_cells_near(&rv.path[i - 1..=i], n, cell, rad, |idx| {
                if water[idx] == 3 && (val == 1 || mask[idx] == 0) {
                    mask[idx] = val;
                }
            });
        }
    };
    for rv in rivers.iter().filter(|r| !r.main) {
        mark(rv, 2, &mut river_mask);
    }
    if let Some(m) = main_idx {
        mark(&rivers[m], 1, &mut river_mask);
    }
    for i in 0..total {
        if water[i] == 3 && river_mask[i] == 0 {
            river_mask[i] = 2;
        }
    }
    let mut wide = vec![0u8; total];
    for rv in &rivers {
        for i in 1..rv.path.len() {
            let wd = rv.w_at(i - 1).max(rv.w_at(i));
            if wd <= 3.7 || wd.is_nan() {
                continue;
            }
            for_cells_near(&rv.path[i - 1..=i], n, cell, wd / 2.0 + cell * 0.8, |idx| {
                if water[idx] == 3 {
                    wide[idx] = 1;
                }
            });
        }
    }

    // ---- distance fields
    let (mut any_w, mut sea_m, mut main_m) = (vec![0u8; total], vec![0u8; total], vec![0u8; total]);
    let mut carry = vec![0f32; total];
    for i in 0..total {
        if water[i] != 0 {
            any_w[i] = 1;
            carry[i] = if water[i] == 1 { 0.0 } else { h[i] };
        }
        if water[i] == 1 { sea_m[i] = 1 }
        if river_mask[i] == 1 { main_m[i] = 1 }
    }
    let small_main = main_idx.map_or(false, |m| rivers[m].wmax() < 9.0);
    if small_main {
        for_cells_near(&rivers[main_idx.unwrap()].path, n, cell, 2.0 * cell, |idx| {
            if water[idx] == 3 {
                main_m[idx] = 1;
            }
        });
        for v in river_mask.iter_mut() {
            if *v == 1 { *v = 2 }
        }
    }
    let (dw_dist, dw_val) = distance_field(&any_w, n, cell, Some(&carry));
    let dw_val = dw_val.unwrap();
    let d_sea = distance_field(&sea_m, n, cell, None).0;
    let d_main = distance_field(&main_m, n, cell, None).0;
    let hab: Vec<f32> = (0..total).map(|i| (h[i] as f64 - dw_val[i] as f64) as f32).collect();
    let r_slope = (jround(100.0 / cell)).max(1.0) as usize;
    let slope_s = blur(slope_raw, n, r_slope, 2);
    let hc: Vec<f32> = h.iter().map(|v| v.max(0.0)).collect();
    let r_hb = (jround(280.0 / cell)).max(2.0) as usize;
    let hb = blur(&hc, n, r_hb, 2);
    drop(hc);

    let c0 = P { x: s / 2.0, y: s / 2.0 };
    let root = Rng::new(&hd.seed_key);
    let r = root.fork("site");
    let jit = Noise::new(r.fork("jitter"));

    let mut ctx = Ctx {
        n, cell, s, h, water, slope_raw, slope_s, hb, hab, dw: dw_dist, sat_b: Vec::new(), margin: 0.0,
        flat_w: prefs.flatness.unwrap_or(1.0), prefs: prefs.clone(), jit, c0,
    };

    // ---- slope percentiles
    let (mut zr, mut zs) = (Vec::new(), Vec::new());
    {
        let lo = (0.2 * n as f64).floor() as usize;
        let hi = (0.8 * n as f64).ceil() as usize;
        let mut y = lo;
        while y < hi {
            let mut x = lo;
            while x < hi {
                let i = y * n + x;
                if water[i] == 0 {
                    zr.push(slope_raw[i] as f64);
                    zs.push(ctx.slope_s[i] as f64);
                }
                x += 3;
            }
            y += 3;
        }
        sort_f64(&mut zr);
        sort_f64(&mut zs);
    }
    let cap_raw = 0.09_f64.max(0.22_f64.min(pct(&zr, 0.12) * 1.15));
    let cap_smooth = 0.11_f64.max(0.3_f64.min(pct(&zs, 0.12) * 1.15));
    let build_slope = 0.15_f64.max(0.3_f64.min(pct(&zr, 0.3)));

    // ---- buildable land
    let (mut build, mut flat_mk) = (vec![0u8; total], vec![0u8; total]);
    for i in 0..total {
        if water[i] == 0 && (slope_raw[i] as f64) < build_slope && ctx.hab[i] as f64 >= 1.0 {
            build[i] = 1;
        }
        if water[i] == 0 && (slope_raw[i] as f64) < cap_raw {
            flat_mk[i] = 1;
        }
    }
    ctx.sat_b = make_sat(&build, n);
    let sat_f = make_sat(&flat_mk, n);
    drop((build, flat_mk));

    let m_frac = 0.2_f64.max(0.45_f64.min(prefs.margin.unwrap_or(0.2)));
    ctx.margin = m_frac * s;
    let ctx = ctx;

    let bfrac_cap;
    {
        let mut vals = Vec::new();
        let lo = (0.2 * n as f64).floor() as usize;
        let hi = (0.8 * n as f64).ceil() as usize;
        let mut y = lo;
        while y < hi {
            let mut x = lo;
            while x < hi {
                if water[y * n + x] == 0 {
                    vals.push(ctx.frac(&ctx.sat_b, (x as f64 + 0.5) * cell, (y as f64 + 0.5) * cell, 0.6 * rres));
                }
                x += 4;
            }
            y += 4;
        }
        sort_f64(&mut vals);
        bfrac_cap = 0.2_f64.max(0.55_f64.min(0.8 * pct(&vals, 0.85)));
    }
    let need_def = || Need { hab_min: 1.8, hab_max: None, slope_max: cap_raw, smooth_max: cap_smooth, bfrac_min: bfrac_cap, rb: 0.6 * rres };
    let nominal = 2.2 + 1.0 + 1.0 + 1.8 + 0.8;
    let q01 = |score: f64, ex_max: f64, anchor_q: f64| clamp01(0.5 * (score / (nominal + ex_max)) + 0.5 * clamp01(anchor_q));
    let hab_at = |i: usize| ctx.hab[i] as f64;

    // ---- river anchors
    let big_rivers: Vec<usize> = (0..rivers.len())
        .filter(|&k| rivers[k].wmax() >= BIG_RIVER_W && rivers[k].path.len() > 8 && rivers[k].total() > 500.0)
        .collect();
    let rb = 0.6 * rres;
    let mut all_anchors: Vec<Anchor> = Vec::new();
    for &k in &big_rivers {
        let rv = &rivers[k];
        if rv.mouth.as_deref() == Some("sea") && rv.total() < 1.0 {
            continue;
        }
        let total_len = rv.total();
        let (wmin, wmax) = (rv.wmin(), rv.wmax());
        let mut sv = 40.0;
        while sv < total_len - 40.0 {
            let s_here = sv;
            sv += 25.0;
            let (pt, pi) = point_at(&rv.path, &rv.pre, s_here);
            if !ctx.in_m(pt.x, pt.y, 0.05 * s) {
                continue;
            }
            let t = tangent_at(&rv.path, &rv.pre, s_here, 12.0);
            let nrm = P { x: -t.y, y: t.x };
            let w = rv.width[(rv.width.len() - 1).min(pi)];
            let mut tq: f64 = 0.0;
            for side in [1.0, -1.0] {
                let b = P { x: pt.x + side * nrm.x * (w / 2.0 + 45.0), y: pt.y + side * nrm.y * (w / 2.0 + 45.0) };
                if !ctx.in_m(b.x, b.y, 0.05 * s) {
                    continue;
                }
                let bi = ctx.at(b.x, b.y);
                if water[bi] != 0 {
                    continue;
                }
                tq = tq.max(
                    smoothstep(hab_at(bi), 1.5, 5.0)
                        * (1.0 - smoothstep(ctx.slope_s[bi] as f64, 0.03, 0.12))
                        * ctx.frac(&ctx.sat_b, b.x, b.y, rb).sqrt(),
                );
            }
            if tq <= 0.02 {
                continue;
            }
            let narrow = 0.6 * (1.0 - smoothstep(w, 10.0, 50.0)) + 0.4 * ((wmax - w) / (wmax - wmin + 1e-6));
            let central = 1.0 - (dist(pt, c0) / (0.35 * s)).min(1.0);
            let q = tq * (0.12 + 0.42 * narrow + 0.33 * central + 0.13 * (s_here / total_len));
            all_anchors.push(Anchor { p: pt, q, s: s_here, total: total_len, r: k, w });
        }
    }

    let mut cands: HashMap<&'static str, Cand> = HashMap::new();
    let set_best = |cands: &mut HashMap<&'static str, Cand>, a: &'static str, c: Option<Cand>| {
        if let Some(c) = c {
            if cands.get(a).map_or(true, |o| c.q > o.q) {
                cands.insert(a, c);
            }
        }
    };

    let front_r = 0.3 * rres + 45.0;
    let anchor_cand = |an: &Anchor, nd: Need, bonus: &dyn Fn(usize) -> f64, ex_max: f64| -> Option<Cand> {
        let rv = &rivers[an.r];
        let res = ctx.refine(an.p, front_r, &nd, &|i, p| {
            match rv.dist_within(p, front_r) {
                None => f64::NEG_INFINITY,
                Some(dr) => {
                    if dr > front_r || dr < an.w / 2.0 + 14.0 {
                        f64::NEG_INFINITY
                    } else {
                        0.7 * (1.0 - smoothstep(dr, 25.0, front_r)) + bonus(i)
                    }
                }
            }
        })?;
        Some(Cand { i: res.0, q: q01(res.1, ex_max, an.q / 0.42), crossing: Some(an.p), feature: Some(an.p), harbor: None })
    };
    {
        let at_sea = |a: &Anchor| d_sea[ctx.at(a.p.x, a.p.y)] as f64 > 110.0;
        let filtered: Vec<Anchor> = all_anchors.iter().copied().filter(at_sea).collect();
        for an in spaced(&filtered, 140.0, 10, |a| (a.p, a.q)) {
            let c = anchor_cand(&an, Need { hab_min: 2.4, ..need_def() }, &|i| 0.5 * smoothstep(hab_at(i), 2.0, 6.0), 1.2);
            set_best(&mut cands, "bridge", c);
        }
    }
    if let Some(m) = main_idx.filter(|&m| rivers[m].mouth.as_deref() == Some("sea")) {
        let (s0, s1) = (230.0 + 0.25 * rres, 500.0 + 1.5 * rres);
        let est: Vec<Anchor> = all_anchors.iter()
            .filter(|a| a.r == m && a.total - a.s >= s0 && a.total - a.s <= s1)
            .map(|a| Anchor { q: a.q * (1.0 - 0.45 * smoothstep(a.total - a.s, s0, s1)), ..*a })
            .collect();
        for an in spaced(&est, 120.0, 8, |a| (a.p, a.q)) {
            let nd = Need { hab_min: 1.8, bfrac_min: 0.45_f64.min(bfrac_cap), ..need_def() };
            let Some(mut c) = anchor_cand(&an, nd, &|i| 0.4 * smoothstep(hab_at(i), 1.8, 5.0), 1.1) else { continue };
            let cp = ctx.pos(c.i);
            let mr = &rivers[m];
            let nn = nearest_on(&mr.path, cp);
            let wq = mr.width.get(nn.i.min(mr.width.len().saturating_sub(1))).copied().unwrap_or(0.0) / 2.0;
            let dd = { let v = dist(cp, nn.pt); if v == 0.0 { 1.0 } else { v } };
            c.harbor = Some(P { x: nn.pt.x + ((cp.x - nn.pt.x) / dd) * wq, y: nn.pt.y + ((cp.y - nn.pt.y) / dd) * wq });
            set_best(&mut cands, "estuary", Some(c));
        }
    }

    // ---- confluence / valley junction
    for tr in rivers.iter().filter(|rv| rv.mouth.as_deref() == Some("river") && rv.host.is_some() && rv.wmax() >= 2.8 && rv.total() >= 250.0) {
        let Some(host) = rivers.iter().find(|q| q.id.is_some() && q.id == tr.host) else { continue };
        let j = *tr.path.last().unwrap();
        if !ctx.in_m(j.x, j.y, 0.12 * s) {
            continue;
        }
        let nn = nearest_on(&host.path, j);
        let th = tangent_at(&host.path, &host.pre, host.pre[nn.i] + nn.t * dist(host.path[nn.i], host.path[nn.i + 1]), 14.0);
        let lt = tr.total();
        let q_pt = point_at(&tr.path, &tr.pre, (lt - 30.0).max(0.0)).0;
        let dj = { let v = dist(j, q_pt); if v == 0.0 { 1.0 } else { v } };
        let ut = P { x: (j.x - q_pt.x) / dj, y: (j.y - q_pt.y) / dj };
        let mut bis = P { x: -th.x - ut.x, y: -th.y - ut.y };
        let bl = bis.x.hypot(bis.y);
        bis = if bl < 0.25 { P { x: -th.x, y: -th.y } } else { P { x: bis.x / bl, y: bis.y / bl } };
        let (wt, wh) = (tr.wmax(), host.wmax());
        let aq = (0.5 + 0.5 * smoothstep(wt, 2.8, 9.0)) * (0.55 + 0.45 * (1.0 - (dist(j, c0) / (0.4 * s)).min(1.0)));
        let dmax = 0.35 * rres + 75.0;
        for d in [45.0, 80.0, 115.0] {
            let pp = P { x: j.x + bis.x * d, y: j.y + bis.y * d };
            if !ctx.in_m(pp.x, pp.y, 0.05 * s) || water[ctx.at(pp.x, pp.y)] != 0 {
                continue;
            }
            let res = ctx.refine(pp, 55.0, &Need { hab_min: 2.0, ..need_def() }, &|_, p| {
                let (Some(d1), Some(d2)) = (host.dist_within(p, dmax), tr.dist_within(p, dmax)) else { return f64::NEG_INFINITY };
                if d1 < wh / 2.0 + 14.0 || d2 < 10.0 || dist(p, j) > 150.0 {
                    return f64::NEG_INFINITY;
                }
                0.8 * (1.0 - (d1 - d2).abs() / dmax) + 0.3 * (1.0 - smoothstep(d1.max(d2), 60.0, dmax))
            });
            let Some((ri, rs)) = res else { continue };
            let cpos = ctx.pos(ri);
            let crossing = (wh >= BIG_RIVER_W).then(|| nearest_on(&host.path, cpos).pt);
            set_best(&mut cands, "confluence", Some(Cand { i: ri, q: q01(rs, 1.1, aq), crossing, feature: Some(j), harbor: None }));
        }
        if wh >= BIG_RIVER_W {
            let side = if th.x * (q_pt.y - j.y) - th.y * (q_pt.x - j.x) >= 0.0 { 1.0 } else { -1.0 };
            let nrm = P { x: -th.y * side, y: th.x * side };
            for off in [wh / 2.0 + 120.0 + 0.1 * rres, wh / 2.0 + 190.0 + 0.1 * rres] {
                let pp = P { x: j.x + nrm.x * off - th.x * 30.0, y: j.y + nrm.y * off - th.y * 30.0 };
                if !ctx.in_m(pp.x, pp.y, 0.05 * s) {
                    continue;
                }
                let res = ctx.refine(pp, 95.0, &Need { hab_min: 3.0, hab_max: Some(18.0), ..need_def() }, &|i, p| {
                    let (Some(d1), Some(d2)) = (host.dist_within(p, 330.0), tr.dist_within(p, 300.0)) else { return f64::NEG_INFINITY };
                    if d1 < 55.0 {
                        return f64::NEG_INFINITY;
                    }
                    0.5 * smoothstep(hab_at(i), 3.0, 6.0) * (1.0 - smoothstep(hab_at(i), 10.0, 18.0)) + 0.5 * (1.0 - smoothstep(d2, 60.0, 300.0))
                });
                let Some((ri, rs)) = res else { continue };
                set_best(&mut cands, "valley", Some(Cand {
                    i: ri, q: q01(rs, 1.0, aq * 0.9), crossing: Some(nearest_on(&host.path, ctx.pos(ri)).pt), feature: Some(j), harbor: None,
                }));
            }
        }
    }

    // ---- meander neck
    for &k in &big_rivers {
        let rv = &rivers[k];
        let total_len = rv.total();
        let step = 12.0;
        let mut samples: Vec<P> = Vec::new();
        let mut sv = 0.0;
        while sv <= total_len {
            samples.push(point_at(&rv.path, &rv.pre, sv).0);
            sv += step;
        }
        let a_min = 2.5e4_f64.max(0.3 * std::f64::consts::PI * (0.5 * rres) * (0.5 * rres));
        let mut i = 0;
        while i + 8 < samples.len() {
            let mut j = i + 10;
            while j < samples.len().min(i + 140) {
                let jj = j;
                j += 2;
                let arc = (jj - i) as f64 * step;
                let chord = dist(samples[i], samples[jj]);
                if arc < 260.0 || chord > 240.0 || chord > 0.42 * arc {
                    continue;
                }
                let lp = &samples[i..=jj];
                let area = polygon_area(lp).abs();
                if area < a_min {
                    continue;
                }
                let (mut cx, mut cy) = (0.0, 0.0);
                for p in lp {
                    cx += p.x;
                    cy += p.y;
                }
                let cen = P { x: cx / lp.len() as f64, y: cy / lp.len() as f64 };
                if !polygon_contains(lp, cen) || !ctx.in_m(cen.x, cen.y, 0.05 * s) {
                    continue;
                }
                let ci = ctx.at(cen.x, cen.y);
                if water[ci] != 0 || hab_at(ci) < 1.8 {
                    continue;
                }
                let aq = 0.6 * smoothstep(area, a_min, 4.0 * a_min) + 0.4 * (1.0 - smoothstep(chord, 60.0, 240.0));
                let rad = 0.45 * area.sqrt();
                let nd = Need { bfrac_min: 0.4_f64.min(bfrac_cap), hab_min: 2.0, ..need_def() };
                let res = ctx.refine(cen, rad, &nd, &|ii, p| {
                    if !polygon_contains(lp, p) {
                        return f64::NEG_INFINITY;
                    }
                    if let Some(dr) = rv.dist_within(p, 30.0) {
                        if dr < 30.0 {
                            return f64::NEG_INFINITY;
                        }
                    }
                    0.9 * (1.0 - smoothstep(dist(p, cen), 0.2 * rad, rad)) + 0.4 * smoothstep(hab_at(ii), 2.0, 8.0)
                });
                let Some((ri, rs)) = res else { continue };
                let apex = samples[jround((i + jj) as f64 / 2.0) as usize];
                let neck = P { x: (samples[i].x + samples[jj].x) / 2.0, y: (samples[i].y + samples[jj].y) / 2.0 };
                set_best(&mut cands, "meander", Some(Cand { i: ri, q: q01(rs, 1.3, aq * 1.3), crossing: Some(apex), feature: Some(neck), harbor: None }));
            }
            i += 2;
        }
    }

    // ---- harbor
    let mut harbors: Vec<(P, f64)> = Vec::new();
    let rays: Vec<P> = (0..8).map(|k| { let a = (k as f64 / 8.0) * 6.2832; P { x: a.cos(), y: a.sin() } }).collect();
    if hd.sea_fraction > 0.02 {
        let mut raw: Vec<(P, f64)> = Vec::new();
        let lo = (n as f64 * 0.12).floor() as usize;
        let hi_f = n as f64 * 0.88;
        let mut y = lo;
        while (y as f64) < hi_f {
            let mut x = lo;
            while (x as f64) < hi_f {
                let i = y * n + x;
                x += 1;
                if water[i] != 0 || d_sea[i] as f64 > cell * 1.6 {
                    continue;
                }
                let (wx, wy) = (((i % n) as f64 + 0.5) * cell, ((i / n) as f64 + 0.5) * cell);
                let (mut land, mut tot) = (0.0, 0.0);
                for a in 0..12 {
                    for rad in [70.0, 140.0, 210.0] {
                        let ang = (a as f64 / 12.0) * 6.2832;
                        let (px, py) = (wx + ang.cos() * rad, wy + ang.sin() * rad);
                        if px < 0.0 || py < 0.0 || px > s || py > s {
                            continue;
                        }
                        tot += 1.0;
                        if water[ctx.at(px, py)] != 1 {
                            land += 1.0;
                        }
                    }
                }
                let shelter = smoothstep(land / 1.0_f64.max(tot), 0.5, 0.85);
                let flat = 1.0 - smoothstep(ctx.slope_s[i] as f64, 0.03, 0.16);
                raw.push((P { x: wx, y: wy }, (0.25 + 0.75 * shelter) * flat));
            }
            y += 1;
        }
        raw.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(Ordering::Equal));
        for c in &raw {
            if harbors.len() >= 40 {
                break;
            }
            if harbors.iter().all(|o| dist(o.0, c.0) > 90.0) {
                harbors.push(*c);
            }
        }
        let hdist = 160.0_f64.min(60.0 + 0.08 * rres);
        let usable: Vec<(P, f64)> = harbors.iter().copied().filter(|h| ctx.in_m(h.0.x, h.0.y, 0.06 * s)).collect();
        for hb0 in spaced(&usable, 140.0, 10, |h| (h.0, h.1)) {
            let nd = Need { hab_min: 1.2, hab_max: None, slope_max: cap_raw, smooth_max: cap_smooth, bfrac_min: 0.25_f64.min(bfrac_cap), rb };
            let res = ctx.refine(hb0.0, hdist, &nd, &|i, p| {
                if (d_sea[i] as f64) < 12.0 || dist(p, hb0.0) > hdist {
                    return f64::NEG_INFINITY;
                }
                0.8 * (1.0 - smoothstep(d_sea[i] as f64, 20.0, hdist))
            });
            let Some((ri, rs)) = res else { continue };
            let cp = ctx.pos(ri);
            let (mut bq, mut bd) = (hb0.0, f64::INFINITY);
            let x0 = (((cp.x - hdist * 1.6) / cell).floor() as i64).max(0);
            let x1 = (((cp.x + hdist * 1.6) / cell).floor() as i64).min(n as i64 - 1);
            let y0 = (((cp.y - hdist * 1.6) / cell).floor() as i64).max(0);
            let y1 = (((cp.y + hdist * 1.6) / cell).floor() as i64).min(n as i64 - 1);
            for yy in y0..=y1 {
                for xx in x0..=x1 {
                    let i = yy as usize * n + xx as usize;
                    if water[i] != 0 || d_sea[i] as f64 > cell * 1.5 {
                        continue;
                    }
                    let p = ctx.pos(i);
                    let d = dist(p, cp);
                    if d < bd {
                        bd = d;
                        bq = p;
                    }
                }
            }
            if bd > hdist {
                continue;
            }
            set_best(&mut cands, "harbor", Some(Cand { i: ri, q: q01(rs, 0.8, hb0.1), harbor: Some(bq), feature: Some(bq), crossing: None }));
        }
    }

    // ---- hilltop
    {
        let r_top = 45.0_f64.max(0.28 * rres);
        let mut prom_v: Vec<(P, f64, usize)> = Vec::new();
        let lo = (0.2 * n as f64).floor() as usize;
        let hi = (0.8 * n as f64).ceil() as usize;
        let stride = (jround(16.0 / cell)).max(2.0) as usize;
        let mut y = lo;
        while y < hi {
            let mut x = lo;
            while x < hi {
                let i = y * n + x;
                x += stride;
                if water[i] != 0 {
                    continue;
                }
                let prom = h[i] as f64 - ctx.hb[i] as f64;
                if prom < 6.0 {
                    continue;
                }
                let p = ctx.pos(i);
                let ff = ctx.frac(&sat_f, p.x, p.y, r_top);
                if ff < 0.6 {
                    continue;
                }
                let (mut ring, mut cnt) = (0.0, 0.0);
                for d in &rays {
                    let (px, py) = (p.x + d.x * r_top * 1.8, p.y + d.y * r_top * 1.8);
                    if px < 0.0 || py < 0.0 || px > s || py > s {
                        continue;
                    }
                    ring += ctx.slope_s[ctx.at(px, py)] as f64;
                    cnt += 1.0;
                }
                ring = if cnt > 0.0 { ring / cnt } else { 0.0 };
                let q = 0.45 * smoothstep(prom, 6.0, 30.0) + 0.3 * ff + 0.25 * smoothstep(ring, 0.05, 0.18);
                prom_v.push((p, q, i));
            }
            y += stride;
        }
        let has_water = !big_rivers.is_empty() || hd.sea_fraction > 0.02;
        for a in spaced(&prom_v, 200.0, 6, |v| (v.0, v.1)) {
            let nd = Need { hab_min: 0.0, hab_max: None, slope_max: cap_raw * 0.8, smooth_max: cap_smooth * 0.9, bfrac_min: 0.42_f64.min(bfrac_cap), rb: 0.45 * rres };
            let res = ctx.refine(a.0, r_top, &nd, &|i, _| {
                if has_water && ctx.dw[i] as f64 > 450.0 { f64::NEG_INFINITY } else { 0.6 * smoothstep(h[i] as f64 - ctx.hb[i] as f64, 4.0, 26.0) }
            });
            if let Some((ri, rs)) = res {
                set_best(&mut cands, "hilltop", Some(Cand { i: ri, q: q01(rs, 0.6, a.1), feature: Some(ctx.pos(ri)), crossing: None, harbor: None }));
            }
        }
    }

    // ---- plain
    {
        let lo = (0.25 * n as f64).floor() as usize;
        let hi = (0.75 * n as f64).ceil() as usize;
        let stride = (jround(10.0 / cell)).max(1.0) as usize;
        let nd = need_def();
        let (mut best, mut bi, mut bs) = (f64::NEG_INFINITY, usize::MAX, 0.0);
        let mut y = lo;
        while y < hi {
            let mut x = lo;
            while x < hi {
                let i = y * n + x;
                x += stride;
                let mut e = ctx.eval_cell(i, &nd);
                if e == f64::NEG_INFINITY {
                    continue;
                }
                let d = ctx.dw[i] as f64;
                let spring = if d > 40.0 && d < 350.0 { (-(d - 60.0).max(0.0) / 140.0).exp() } else { 0.0 };
                e += 0.8 * spring;
                if e > best {
                    best = e;
                    bi = i;
                    bs = spring;
                }
            }
            y += stride;
        }
        if bi != usize::MAX && pct(&zs, 0.5) < 0.045 {
            set_best(&mut cands, "plain", Some(Cand {
                i: bi, q: clamp01(0.5 * (best / (nominal + 0.8)) + 0.5 * (0.6 + 0.4 * bs)), feature: Some(ctx.pos(bi)), crossing: None, harbor: None,
            }));
        }
    }

    // ---- choose an archetype
    let mut offers: Vec<(&'static str, f64)> = Vec::new();
    for a in ARCHETYPES {
        if let Some(c) = cands.get(a) {
            offers.push((a, jround(c.q * 1000.0) / 1000.0));
        }
    }
    let has_coast = hd.sea_fraction > 0.02 && !harbors.is_empty();
    let has_river = !big_rivers.is_empty();
    let hilltop_by_size = [1.5, 1.15, 0.7, 0.28, 0.1];
    let base_w = |a: &str| -> f64 {
        match a {
            "bridge" => if has_coast { 0.45 } else { 1.0 },
            "confluence" => 0.65,
            "meander" => 0.9,
            "harbor" => 2.4,
            "estuary" => 1.8,
            "valley" => 0.55 * if hd.relief == "valley" || hd.relief == "mountains" { 1.6 } else { 1.0 },
            "hilltop" => hilltop_by_size[size_idx] * relief_hill(&hd.relief) * if has_coast || has_river { 0.3 } else { 1.0 },
            _ => if has_coast || has_river { 0.03 } else { 1.0 },
        }
    };
    let mut weights: Vec<(&'static str, f64)> = Vec::new();
    for a in ARCHETYPES {
        let Some(c) = cands.get(a) else { continue };
        if c.q < 0.22 {
            continue;
        }
        let w = base_w(a) * prefs.weights.get(a).copied().unwrap_or(1.0) * c.q.powf(1.5);
        if w > 0.0 {
            weights.push((a, w));
        }
    }
    let mut pr = r.fork("archetype");
    let mut chosen: Option<&'static str> = None;
    let forced = hd.site_type.as_deref().filter(|t| *t != "auto").and_then(|t| ARCHETYPES.iter().copied().find(|a| *a == t));
    if let Some(f) = forced.filter(|f| cands.get(f).map_or(false, |c| c.q >= 0.1)) {
        chosen = Some(f);
    } else if !weights.is_empty() {
        let tot: f64 = weights.iter().map(|w| w.1).sum();
        let mut x = pr.float() * tot;
        chosen = Some(weights[weights.len() - 1].0);
        for w in &weights {
            x -= w.1;
            if x <= 0.0 {
                chosen = Some(w.0);
                break;
            }
        }
    } else {
        let mut bq = -1.0;
        for a in ARCHETYPES {
            if let Some(c) = cands.get(a) {
                if c.q > bq {
                    bq = c.q;
                    chosen = Some(a);
                }
            }
        }
    }
    let mut pick: Cand = match chosen {
        Some(c) => cands[c],
        None => {
            let nd = Need { hab_min: 1.0, hab_max: None, slope_max: 0.16_f64.max(cap_raw * 1.3), smooth_max: 0.2_f64.max(cap_smooth * 1.3), bfrac_min: 0.1, rb: 0.5 * rres };
            let (mut best, mut bi) = (f64::NEG_INFINITY, usize::MAX);
            let lo = (m_frac * n as f64).floor() as usize;
            let hi = ((1.0 - m_frac) * n as f64).ceil() as usize;
            let mut y = lo;
            while y < hi {
                let mut x = lo;
                while x < hi {
                    let i = y * n + x;
                    let e = ctx.eval_cell(i, &nd);
                    if e > best {
                        best = e;
                        bi = i;
                    }
                    x += 2;
                }
                y += 2;
            }
            if bi == usize::MAX {
                bi = (n / 2) * n + n / 2;
            }
            chosen = Some("plain");
            Cand { i: bi, q: 0.05, feature: Some(ctx.pos(bi)), crossing: None, harbor: None }
        }
    };
    let mut best_i = pick.i;
    let mut center = ctx.pos(best_i);
    let mut warning: Option<String> = None;
    if let Some(req) = hd.center {
        let default_inset = if prefs.margin.unwrap_or(0.0) > 0.2 { prefs.margin.unwrap() * s } else { 0.0 };
        let inset = (0.03 * s + 2.0 * cell).max((0.45 * s).min(prefs.center_inset.unwrap_or(default_inset)));
        let slope_max = 0.22_f64.max(build_slope) + 0.25 * prefs.mountain_face.unwrap_or(0.0) + 0.08 * prefs.woodland.unwrap_or(0.0);
        let fixed = resolve_position(water, slope_raw, n, cell, s, req, inset, slope_max, &|i| ctx.dw[i] as f64 >= 200.0 || ctx.hab[i] as f64 >= 1.0);
        if let Some(f) = fixed {
            center = f;
            best_i = ctx.at(center.x, center.y);
            if dist(center, req) > 0.01 {
                warning = Some(format!("Main centre moved to {}, {} m to stay on usable land inside the map", jround(center.x), jround(center.y)));
            }
            chosen = Some("plain");
            pick = Cand { i: best_i, q: 1.0, ..Default::default() };
            let mut local = f64::INFINITY;
            for a in ARCHETYPES {
                let Some(c) = cands.get(a) else { continue };
                if a == "plain" || forced.map_or(false, |f| a != f) {
                    continue;
                }
                let d = dist(ctx.pos(c.i), center);
                if d < 160.0_f64.min(0.3 * rres + 45.0) && d < local {
                    local = d;
                    chosen = Some(a);
                    pick = Cand { i: best_i, ..*c };
                }
            }
        } else {
            warning = Some("Main centre could not be placed on usable land; automatic placement used".into());
        }
    }
    let archetype = chosen.unwrap();

    // ---- derived features
    let mut crossing = pick.crossing;
    if crossing.is_none() && !all_anchors.is_empty() {
        let mut bs = f64::INFINITY;
        for a in &all_anchors {
            let sc = dist(a.p, center) + 700.0 * (1.0 - (a.q / 0.42).min(1.0));
            if sc < bs {
                bs = sc;
                crossing = Some(a.p);
            }
        }
    }
    if crossing.is_none() {
        if let Some(m) = main_idx {
            let mut bd = f64::INFINITY;
            for p in &rivers[m].path {
                let d = dist(*p, center);
                if d < bd && p.x > 0.05 * s && p.y > 0.05 * s && p.x < 0.95 * s && p.y < 0.95 * s {
                    bd = d;
                    crossing = Some(*p);
                }
            }
        }
    }
    let mut harbor = pick.harbor;
    if harbor.is_none() {
        let mut bs = f64::NEG_INFINITY;
        for c in &harbors {
            let d = dist(c.0, center);
            if d > 1300.0 {
                continue;
            }
            let sc = c.1 * (-d / 400.0).exp();
            if sc > bs && c.1 > 0.08 {
                bs = sc;
                harbor = Some(c.0);
            }
        }
    }
    let mut citadel: Option<P> = None;
    {
        let mut prom_vals: Vec<f64> = Vec::new();
        let lo = (n as f64 * 0.3).floor() as usize;
        let hi = (n as f64 * 0.7).ceil() as usize;
        let mut y = lo;
        while y < hi {
            let mut x = lo;
            while x < hi {
                let pv = h[y * n + x] as f64 - ctx.hb[y * n + x] as f64;
                if pv > 0.0 {
                    prom_vals.push(pv);
                }
                x += 2;
            }
            y += 2;
        }
        sort_f64(&mut prom_vals);
        let prom_n = 3.0_f64.max(if prom_vals.is_empty() { 5.0 } else { prom_vals[(prom_vals.len() as f64 * 0.9).floor() as usize] });
        let wrap_at = |wx: f64, wy: f64| -> f64 {
            let mut c = 0.0;
            for a in 0..8 {
                let ang = (a as f64 / 8.0) * 6.2832;
                let (ca, sa) = (ang.cos(), ang.sin());
                for rad in [60.0, 120.0, 180.0] {
                    let (px, py) = (wx + ca * rad, wy + sa * rad);
                    if px < 0.0 || py < 0.0 || px > s || py > s {
                        break;
                    }
                    if water[ctx.at(px, py)] != 0 {
                        c += 1.0;
                        break;
                    }
                }
            }
            c
        };
        let mut bs = f64::NEG_INFINITY;
        let (r_min, r_max) = (300.0, 600.0);
        let x0 = (((center.x - r_max) / cell).floor() as i64).max(0);
        let x1 = (((center.x + r_max) / cell).floor() as i64).min(n as i64 - 1);
        let y0 = (((center.y - r_max) / cell).floor() as i64).max(0);
        let y1 = (((center.y + r_max) / cell).floor() as i64).min(n as i64 - 1);
        let h_c = h[best_i] as f64;
        for y in (y0..=y1).step_by(2) {
            for x in (x0..=x1).step_by(2) {
                let (wx, wy) = ((x as f64 + 0.5) * cell, (y as f64 + 0.5) * cell);
                let d = (wx - center.x).hypot(wy - center.y);
                if d < r_min || d > r_max {
                    continue;
                }
                let i = (y as usize) * n + x as usize;
                if water[i] != 0 || hab_at(i) < 4.0 || wx < 0.12 * s || wy < 0.12 * s || wx > 0.88 * s || wy > 0.88 * s {
                    continue;
                }
                let prom = ((h[i] as f64 - ctx.hb[i] as f64) / prom_n).max(0.0);
                let wrap = wrap_at(wx, wy);
                let sc = prom.min(1.4) + 0.35 * (wrap / 4.0).min(1.0) + 0.5 * smoothstep(h[i] as f64 - h_c, 0.0, 25.0)
                    - 1.5 * smoothstep(slope_raw[i] as f64, 0.18, 0.4)
                    - 0.8 * smoothstep(ctx.slope_s[i] as f64, 0.06, 0.2)
                    - 0.3 * (d - r_min) / (r_max - r_min);
                if sc > bs {
                    bs = sc;
                    citadel = Some(P { x: wx, y: wy });
                }
            }
        }
        if bs < 0.5 {
            citadel = None;
        }
    }

    // ---- bridge zone + travel cost
    let mut bridge_zone = vec![0u8; total];
    if let Some(cr) = crossing {
        let rz = 260.0;
        let x0 = (((cr.x - rz) / cell).floor() as i64).max(0);
        let x1 = (((cr.x + rz) / cell).floor() as i64).min(n as i64 - 1);
        let y0 = (((cr.y - rz) / cell).floor() as i64).max(0);
        let y1 = (((cr.y + rz) / cell).floor() as i64).min(n as i64 - 1);
        for y in y0..=y1 {
            for x in x0..=x1 {
                let i = y as usize * n + x as usize;
                if ((x as f64 + 0.5) * cell - cr.x).hypot((y as f64 + 0.5) * cell - cr.y) <= rz && river_mask[i] == 1 {
                    bridge_zone[i] = 1;
                }
            }
        }
    }
    let mut pass = vec![0u8; total];
    for i in 0..total {
        pass[i] = match water[i] {
            0 => 1,
            3 => if river_mask[i] == 1 { if bridge_zone[i] != 0 { 3 } else { 0 } } else if wide[i] != 0 { 3 } else { 2 },
            _ => 0,
        };
    }
    let cost = travel_cost(n, cell, best_i, &pass, h);

    let pt = |p: Option<P>| p.map(|p| json!({ "x": p.x, "y": p.y }));
    let header = json!({
        "center": { "x": center.x, "y": center.y },
        "crossing": pt(crossing), "harbor": pt(harbor), "citadelSpot": pt(citadel),
        "archetype": archetype, "feature": pt(pick.feature),
        "offers": offers.iter().map(|(a, q)| json!([a, q])).collect::<Vec<_>>(),
        "reserveRadius": rres,
        "warning": warning,
    });
    let Ctx { slope_s, hab, dw, .. } = ctx;
    Ok(SiteOutput { header, d_water: dw, d_sea, d_main, hab, slope_s, cost, river_mask, bridge_zone, wide })
}

fn f32s(b: &[u8]) -> Vec<f32> {
    b.chunks_exact(4).map(|c| f32::from_le_bytes([c[0], c[1], c[2], c[3]])).collect()
}
fn f64s(b: &[u8]) -> Vec<f64> {
    b.chunks_exact(8).map(|c| f64::from_le_bytes([c[0], c[1], c[2], c[3], c[4], c[5], c[6], c[7]])).collect()
}
fn put_f32(out: &mut Vec<u8>, v: &[f32]) {
    out.reserve(v.len() * 4);
    for x in v {
        out.extend_from_slice(&x.to_le_bytes());
    }
}

/// Framed request in, framed reply out (shared by the native endpoint and the WASM export).
pub fn choose_site_framed(body: &[u8]) -> Result<Vec<u8>, String> {
    let head = body.get(..4).ok_or("Site request incomplete.")?;
    let hl = u32::from_le_bytes([head[0], head[1], head[2], head[3]]) as usize;
    let end = 4usize.checked_add(hl).ok_or("Site request invalid.")?;
    let header: Header = serde_json::from_slice(body.get(4..end).ok_or("Site request incomplete.")?).map_err(|e| e.to_string())?;
    let total = header.n * header.n;
    let np: usize = header.rivers.iter().map(|r| r.len).sum();
    let nw: usize = header.rivers.iter().map(|r| r.wlen).sum();
    let mut off = end;
    let mut take = |len: usize| -> Result<&[u8], String> {
        let s = body.get(off..off + len).ok_or("Site request planes truncated.")?;
        off += len;
        Ok(s)
    };
    let height = f32s(take(total * 4)?);
    let slope = f32s(take(total * 4)?);
    let water = take(total)?;
    let xy = f64s(take(np * 16)?);
    let widths = f64s(take(nw * 8)?);
    let points: Vec<P> = xy.chunks_exact(2).map(|c| P { x: c[0], y: c[1] }).collect();
    let display_only = header.display_only;
    let out = choose_site(&SiteInput { header, height: &height, slope: &slope, water, points, widths })?;
    let mut head = serde_json::to_vec(&out.header).map_err(|e| e.to_string())?;
    while head.len() % 4 != 0 {
        head.push(b' ');
    }
    let mut reply = Vec::with_capacity(4 + head.len() + total * 27);
    reply.extend_from_slice(&(head.len() as u32).to_le_bytes());
    reply.extend_from_slice(&head);
    if display_only {
        for plane in [&out.d_water, &out.hab] {
            put_f32(&mut reply, plane);
        }
        return Ok(reply);
    }
    for plane in [&out.d_water, &out.d_sea, &out.d_main, &out.hab, &out.slope_s, &out.cost] {
        put_f32(&mut reply, plane);
    }
    for plane in [&out.river_mask, &out.bridge_zone, &out.wide] {
        reply.extend_from_slice(plane);
    }
    Ok(reply)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::Value;

    const REQUEST: &[u8] = include_bytes!("../tests/fixtures/site_request.bin");
    const EXPECTED: &str = include_str!("../tests/fixtures/site_expected.json");

    fn with_header(edit: impl Fn(&mut Value)) -> Vec<u8> {
        let hl = u32::from_le_bytes(REQUEST[..4].try_into().unwrap()) as usize;
        let mut header: Value = serde_json::from_slice(&REQUEST[4..4 + hl]).unwrap();
        edit(&mut header);
        let mut text = serde_json::to_vec(&header).unwrap();
        while text.len() % 4 != 0 {
            text.push(b' ');
        }
        let mut out = (text.len() as u32).to_le_bytes().to_vec();
        out.extend_from_slice(&text);
        out.extend_from_slice(&REQUEST[4 + hl..]);
        out
    }
    fn near(a: &Value, b: &Value, what: &str) {
        let (a, b) = (a["x"].as_f64().unwrap(), b["x"].as_f64().unwrap());
        assert!((a - b).abs() < 1e-3, "{what}: {a} vs {b}");
    }

    /// Same chosen site as the TypeScript `chooseSite` (fixture dumped by `web/scripts/site_fixture.ts`).
    #[test]
    fn matches_the_typescript_site() {
        let expected: Value = serde_json::from_str(EXPECTED).unwrap();
        let n = expected["n"].as_u64().unwrap() as usize;
        for case in expected["cases"].as_array().unwrap() {
            let extra = case["extra"].clone();
            let body = with_header(|h| {
                if let Some(c) = extra.get("center") {
                    h["center"] = c.clone();
                }
            });
            let reply = choose_site_framed(&body).unwrap();
            let hl = u32::from_le_bytes(reply[..4].try_into().unwrap()) as usize;
            let got: Value = serde_json::from_slice(&reply[4..4 + hl]).unwrap();
            let want = &case["expected"];
            assert_eq!(got["archetype"], want["archetype"], "archetype {extra}");
            for key in ["center", "crossing", "harbor", "citadelSpot", "feature"] {
                if want[key].is_null() {
                    assert!(got[key].is_null(), "{key} should be absent {extra}");
                } else {
                    near(&got[key], &want[key], key);
                }
            }
            for (a, q) in want["offers"].as_object().unwrap() {
                let hit = got["offers"].as_array().unwrap().iter().find(|o| o[0] == a.as_str()).unwrap_or_else(|| panic!("offer {a}"));
                assert!((hit[1].as_f64().unwrap() - q.as_f64().unwrap()).abs() < 1e-9, "offer {a}");
            }
            assert_eq!(got["offers"].as_array().unwrap().len(), want["offers"].as_object().unwrap().len());
            // planes: f32 x6 then u8 x3
            let planes = &reply[4 + hl..];
            let f32sum = |k: usize| -> f64 { f32s(&planes[k * n * n * 4..(k + 1) * n * n * 4]).iter().map(|v| *v as f64).filter(|v| v.is_finite()).sum() };
            let u8sum = |k: usize| -> f64 { planes[6 * n * n * 4 + k * n * n..][..n * n].iter().map(|v| *v as f64).sum() };
            let sums = &want["sums"];
            for (k, name) in ["dWater", "dSea", "dMain", "hab", "slopeS", "cost"].iter().enumerate() {
                let (g, w) = (f32sum(k), sums[*name].as_f64().unwrap());
                assert!((g - w).abs() <= 1e-4 * w.abs().max(1.0), "{name} sum {g} vs {w}");
            }
            for (k, name) in ["riverMask", "bridgeZone", "wide"].iter().enumerate() {
                assert_eq!(u8sum(k), sums[*name].as_f64().unwrap(), "{name} sum");
            }
        }
    }
}
