//! Fast deterministic hashing for internal integer grid keys (never iteration order).
use std::hash::{BuildHasherDefault, Hasher};
#[derive(Default)]
pub struct GridHasher(u64);
impl Hasher for GridHasher {
    fn finish(&self) -> u64 {
        self.0
    }
    fn write(&mut self, bytes: &[u8]) {
        for &b in bytes {
            self.write_u64(b as u64);
        }
    }
    fn write_u64(&mut self, n: u64) {
        self.0 = (self.0.rotate_left(5) ^ n).wrapping_mul(0x517cc1b727220a95);
    }
    fn write_usize(&mut self, n: usize) {
        self.write_u64(n as u64);
    }
    fn write_i32(&mut self, n: i32) {
        self.write_u64(n as u32 as u64);
    }
}
pub type HashMap<K, V> = std::collections::HashMap<K, V, BuildHasherDefault<GridHasher>>;
pub type HashSet<K> = std::collections::HashSet<K, BuildHasherDefault<GridHasher>>;
