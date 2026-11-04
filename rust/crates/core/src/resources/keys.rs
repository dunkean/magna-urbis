//! Addressed randomness, ported from Neural Earth (`backend/terrain_resources.py`,
//! itself the Chronos `keys.rs`): every draw is a pure function of
//! `(seed, domain, lod, cell)`, so values never depend on the computation order
//! or on the requested window.

const FNV_OFFSET: u64 = 0xcbf29ce484222325;
const FNV_PRIME: u64 = 0x100000001b3;
/// Native lattice cell (m): cell (lod, i, j) covers `[i, i+1) x [j, j+1) * 30 * 2^lod`.
pub const NATIVE_M: f64 = 30.0;

pub fn splitmix(z: u64) -> u64 {
    let z = z.wrapping_add(0x9e3779b97f4a7c15);
    let z = (z ^ (z >> 30)).wrapping_mul(0xbf58476d1ce4e5b9);
    let z = (z ^ (z >> 27)).wrapping_mul(0x94d049bb133111eb);
    z ^ (z >> 31)
}

/// Chronos `key(seed, parts)`: FNV-1a over the parts with 0xff separators, then splitmix.
pub fn key(seed: u64, parts: &[&str]) -> u64 {
    let mut h = FNV_OFFSET ^ splitmix(seed);
    for part in parts {
        for &b in part.as_bytes() {
            h = (h ^ b as u64).wrapping_mul(FNV_PRIME);
        }
        h = (h ^ 0xff).wrapping_mul(FNV_PRIME);
    }
    splitmix(h)
}

/// Numeric seed of a map seed string.
pub fn seed_of(seed: &str) -> u64 {
    key(0, &["magna-urbis", seed])
}

pub fn cell_size(lod: i32) -> f64 {
    NATIVE_M * 2f64.powi(lod)
}

/// 64-bit cell id: 5 bits lod+16, 30 bits i+2^29, 29 bits j+2^28 (Neural Earth `cell_id`).
pub fn cell_id(lod: i32, i: i64, j: i64) -> u64 {
    (((lod + 16) as u64) << 59) | (((i + (1 << 29)) as u64) << 29) | ((j + (1 << 28)) as u64)
}

/// `splitmix(prefix ^ cell)`, then `splitmix(.. ^ draw)` for the draw-th value.
pub fn cell_key(prefix: u64, id: u64, draw: u64) -> u64 {
    let k = splitmix(prefix ^ id);
    if draw == 0 { k } else { splitmix(k ^ draw) }
}

/// Uniform [0, 1) from the 53 high bits.
pub fn unit(k: u64) -> f64 {
    (k >> 11) as f64 / (1u64 << 53) as f64
}

/// Splits integer `total` by integer `weights`, exactly (largest remainders, ties by
/// ascending id). A zero-weight set receives the total uniformly: a budget is never lost.
pub fn apportion(total: u64, weights: &[u64], ids: &[u64]) -> Vec<u64> {
    assert_eq!(weights.len(), ids.len());
    if total == 0 || weights.is_empty() {
        return vec![0; weights.len()];
    }
    let uniform = weights.iter().all(|&w| w == 0);
    let w = |i: usize| if uniform { 1 } else { weights[i] as u128 };
    let sum: u128 = (0..weights.len()).map(w).sum();
    let mut share = vec![0u64; weights.len()];
    let mut rest = vec![0u128; weights.len()];
    let mut given = 0u64;
    for i in 0..weights.len() {
        let p = total as u128 * w(i);
        share[i] = (p / sum) as u64;
        rest[i] = p % sum;
        given += share[i];
    }
    let mut order: Vec<usize> = (0..weights.len()).filter(|&i| rest[i] > 0).collect();
    order.sort_by(|&a, &b| rest[b].cmp(&rest[a]).then(ids[a].cmp(&ids[b])));
    for &i in order.iter().take((total - given) as usize) {
        share[i] += 1;
    }
    share
}

/// Keyed value noise on the LOD lattice (nodes at cell centres, smoothstep bilinear),
/// in [-1, 1], evaluable at any world point: two windows agree where they overlap.
#[derive(Clone, Copy)]
pub struct ValueNoise {
    prefix: u64,
    lod: i32,
    size: f64,
}
impl ValueNoise {
    pub fn new(seed: u64, name: &str, lod: i32) -> Self {
        Self {
            prefix: key(seed, &["resources", "noise", name, &format!("lod{lod}")]),
            lod,
            size: cell_size(lod),
        }
    }
    fn node(&self, i: i64, j: i64) -> f64 {
        2.0 * unit(cell_key(self.prefix, cell_id(self.lod, i, j), 0)) - 1.0
    }
    pub fn at(&self, x: f64, y: f64) -> f64 {
        let (gx, gy) = (x / self.size - 0.5, y / self.size - 0.5);
        let (i0, j0) = (gx.floor(), gy.floor());
        let (fx, fy) = (gx - i0, gy - j0);
        let (fx, fy) = (fx * fx * (3.0 - 2.0 * fx), fy * fy * (3.0 - 2.0 * fy));
        let (i0, j0) = (i0 as i64, j0 as i64);
        let a = self.node(i0, j0) * (1.0 - fx) + self.node(i0 + 1, j0) * fx;
        let b = self.node(i0, j0 + 1) * (1.0 - fx) + self.node(i0 + 1, j0 + 1) * fx;
        a * (1.0 - fy) + b * fy
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn keys_match_neural_earth() {
        assert_eq!(key(7, &["resources", "noise", "granite", "lod5"]), 0xd062b6ccfa8dd194);
        assert_eq!(key(0, &[]), 0x5b21f68ffa77f14c);
        assert_eq!(cell_key(key(7, &["a"]), cell_id(3, -5, 12), 0), 0x4d36edb466ecd06b);
    }

    #[test]
    fn apportion_is_exact() {
        let ids: Vec<u64> = (0..7).collect();
        for (total, weights) in [
            (1000, vec![3, 1, 4, 1, 5, 9, 2]),
            (17, vec![1, 1, 1, 1, 1, 1, 1]),
            (5, vec![0, 0, 0, 0, 0, 0, 0]),
            (123456789, vec![7, 0, 13, 0, 1, 1, 1000]),
        ] {
            let out = apportion(total, &weights, &ids);
            assert_eq!(out.iter().sum::<u64>(), total);
            for (o, w) in out.iter().zip(&weights) {
                if weights.iter().any(|&w| w > 0) && *w == 0 {
                    assert_eq!(*o, 0);
                }
            }
        }
        // Ties go to the lowest id.
        assert_eq!(apportion(1, &[1, 1, 1], &[9, 3, 5]), vec![0, 1, 0]);
    }
}
