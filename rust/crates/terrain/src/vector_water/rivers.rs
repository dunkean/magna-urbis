//! V2 vector channel tracing. Independent meander reaches are parallel;
//! junctions, bank merges and delta fans retain the serial TS insertion order.
mod geometry;
mod meander;
mod network;
mod support;
use super::*;
use crate::rng::Rng;
use geometry::*;
pub(super) use network::vector_rivers;
use serde::Serialize;
use support::*;
// Integer spatial bins and membership sets are queried in geometric order,
// never iterated in hash order. Fx-style hashing preserves every tie decision.
use std::hash::{BuildHasherDefault, Hasher};
#[derive(Default)]
struct FastHasher(u64);
impl Hasher for FastHasher {
    fn finish(&self) -> u64 {
        self.0
    }
    fn write(&mut self, bytes: &[u8]) {
        for &b in bytes {
            self.write_u64(b as u64);
        }
    }
    fn write_u64(&mut self, v: u64) {
        self.0 = (self.0.rotate_left(5) ^ v).wrapping_mul(0x517cc1b727220a95);
    }
    fn write_u32(&mut self, v: u32) {
        self.write_u64(v as u64);
    }
    fn write_i32(&mut self, v: i32) {
        self.write_u64(v as u64);
    }
    fn write_i64(&mut self, v: i64) {
        self.write_u64(v as u64);
    }
    fn write_usize(&mut self, v: usize) {
        self.write_u64(v as u64);
    }
}
type HashMap<K, V> = std::collections::HashMap<K, V, BuildHasherDefault<FastHasher>>;
type HashSet<K> = std::collections::HashSet<K, BuildHasherDefault<FastHasher>>;
#[derive(Clone, Default, Serialize)]
pub struct Line {
    pub points: Vec<f64>,
    pub area: Vec<f64>,
    pub level: Vec<f64>,
    pub kind: Vec<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub id: Option<usize>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub joins: Option<i32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub outlet: Option<usize>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub threads: Option<Vec<f64>>,
}
impl Line {
    fn uniform(points: Vec<f64>, area: f64, level: f64, kind: f64, id: Option<usize>) -> Self {
        let m = points.len() / 2;
        Self {
            points,
            area: vec![area; m],
            level: vec![level; m],
            kind: vec![kind; m],
            id,
            ..Self::default()
        }
    }
}
#[derive(Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct Network {
    pub rivers: Vec<Line>,
    pub lake_links: Vec<Line>,
    pub width_scale: f64,
    pub oxbows: Vec<Line>,
    pub braids: Vec<Line>,
    pub distributaries: Vec<Line>,
    pub meander_runs: usize,
    pub length_km: f64,
    pub meander_km: f64,
    pub braided_km: f64,
    pub avulsions: usize,
    pub deltas: usize,
    pub ms: f64,
}
pub(super) fn channel_width(area: f64, scale: f64) -> f64 {
    scale * 3.0 * (area / 1e6).powf(0.45)
}
fn smoothstep(t: f64) -> f64 {
    if t <= 0.0 {
        0.0
    } else if t >= 1.0 {
        1.0
    } else {
        t * t * (3.0 - 2.0 * t)
    }
}
fn nonzero(v: f64) -> f64 {
    if v == 0.0 { 1.0 } else { v }
}
fn lattice_hash(i: i32, j: i32, seed: u32) -> f64 {
    let mut h = (i as u32)
        .wrapping_mul(374761393)
        .wrapping_add((j as u32).wrapping_mul(668265263))
        .wrapping_add(seed.wrapping_mul(2147483647));
    h = (h ^ (h >> 13)).wrapping_mul(1274126177);
    (h ^ (h >> 16)) as f64 / 2147483648.0 - 1.0
}
fn value_noise(x: f64, y: f64, seed: u32) -> f64 {
    let (i, j) = (x.floor() as i32, y.floor() as i32);
    let (fx, fy) = (x - x.floor(), y - y.floor());
    let (u, v) = (fx * fx * (3.0 - 2.0 * fx), fy * fy * (3.0 - 2.0 * fy));
    let (a, b, c, d) = (
        lattice_hash(i, j, seed),
        lattice_hash(i + 1, j, seed),
        lattice_hash(i, j + 1, seed),
        lattice_hash(i + 1, j + 1, seed),
    );
    a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v
}
struct Context<'a> {
    h: &'a Hydrology,
    field: &'a LakeField,
    still: &'a [u8],
    standing: &'a [u8],
    cell: f64,
}
impl Context<'_> {
    fn centre(&self, c: usize) -> (f64, f64) {
        (
            (c % self.h.n) as f64 * self.cell + 0.5 * self.cell,
            ((c / self.h.n) as f64 + 0.5) * self.cell,
        )
    }
    #[inline(always)]
    fn at(&self, x: f64, y: f64) -> Option<usize> {
        let (gx, gy) = ((x / self.cell).floor(), (y / self.cell).floor());
        (gx >= 0.0 && gy >= 0.0 && gx < self.h.n as f64 && gy < self.h.n as f64)
            .then(|| gy as u32 as usize * self.h.n + gx as u32 as usize)
    }
    #[inline(always)]
    fn terrain(&self, x: f64, y: f64) -> f64 {
        let n = self.h.n;
        let fx = (x / self.cell - 0.5).clamp(0.0, n as f64 - 1.000001);
        let fy = (y / self.cell - 0.5).clamp(0.0, n as f64 - 1.000001);
        let (i, j) = (fx as u32 as usize, fy as u32 as usize);
        let (u, v) = (fx - i as f64, fy - j as f64);
        let c = j * n + i;
        let z = &self.h.height;
        // SAFETY: n >= 2; clamped coordinates leave room for the +1 stencil.
        unsafe {
            (*z.get_unchecked(c) as f64 * (1.0 - u) + *z.get_unchecked(c + 1) as f64 * u)
                * (1.0 - v)
                + (*z.get_unchecked(c + n) as f64 * (1.0 - u)
                    + *z.get_unchecked(c + n + 1) as f64 * u)
                    * v
        }
    }
    #[inline(always)]
    fn wet(&self, x: f64, y: f64, z: Option<f64>) -> bool {
        self.at(x, y).is_some_and(|c| {
            self.h.grids.sea[c] == 1
                || (self.field.distance[c] > -2.0
                    && lake::sample(self.field, self.h.width, x, y) > 0.0)
                || z.unwrap_or_else(|| self.terrain(x, y)) <= 0.0
        })
    }
}
