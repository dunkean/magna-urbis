//! Content-addressed memo for the repeated probes of one quarters run.
//!
//! `generate_quarters` re-runs the programme and the cadastre several times
//! (`trim::run` until a fixed point, `trim::finish`) on layouts that differ
//! only locally between calls. Sub-results that are a pure function of a
//! small, exactly known set of inputs (one block's lot cutting, one quarter's
//! port refinement) are memoised under a key holding the exact bytes of those
//! inputs (`f64` bit patterns, full strings). A hit is therefore the same value
//! a recomputation would give; nothing is keyed by a lossy hash.
//!
//! The memo is live only inside a `Scope` (opened by `generate_quarters`) and
//! is emptied when the last open scope closes, so nothing outlives a request.
//! `URBAN_NO_PROBE_CACHE=1` disables it (debug, and the equivalence test).
use super::{Point, Shape};
use std::collections::HashMap;
use std::sync::Mutex;
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};

static ACTIVE: AtomicUsize = AtomicUsize::new(0);
/// Test switch: forces the memo off whatever the environment says.
static FORCED_OFF: AtomicBool = AtomicBool::new(false);

fn disabled_by_env() -> bool {
    std::env::var("URBAN_NO_PROBE_CACHE").is_ok_and(|v| v.trim() == "1")
}

/// Keeps the memo live while it exists; the last one to drop empties it.
pub(crate) struct Scope {
    on: bool,
}
impl Scope {
    pub(crate) fn open() -> Self {
        let on = !FORCED_OFF.load(Ordering::SeqCst) && !disabled_by_env();
        if on {
            ACTIVE.fetch_add(1, Ordering::SeqCst);
        }
        Self { on }
    }
}
impl Drop for Scope {
    fn drop(&mut self) {
        if self.on && ACTIVE.fetch_sub(1, Ordering::SeqCst) == 1 {
            super::parcels::clear_probe_cache();
            super::roles::clear_probe_cache();
        }
    }
}

/// Whether memoised probe results may be used now.
pub(crate) fn enabled() -> bool {
    ACTIVE.load(Ordering::SeqCst) > 0 && !FORCED_OFF.load(Ordering::SeqCst)
}

#[cfg(test)]
static HITS: AtomicUsize = AtomicUsize::new(0);

/// A memo table: exact input bytes to a stored value.
pub(crate) struct Memo<V> {
    map: Mutex<Option<HashMap<Vec<u8>, V>>>,
}
impl<V: Clone> Memo<V> {
    pub(crate) const fn new() -> Self {
        Self { map: Mutex::new(None) }
    }
    fn lock(&self) -> std::sync::MutexGuard<'_, Option<HashMap<Vec<u8>, V>>> {
        self.map.lock().unwrap_or_else(|e| e.into_inner())
    }
    pub(crate) fn get(&self, key: &Key) -> Option<V> {
        if !enabled() {
            return None;
        }
        let hit = self.lock().as_ref().and_then(|m| m.get(&key.0).cloned());
        #[cfg(test)]
        if hit.is_some() {
            HITS.fetch_add(1, Ordering::SeqCst);
        }
        hit
    }
    pub(crate) fn put(&self, key: Key, value: V) {
        if !enabled() {
            return;
        }
        self.lock().get_or_insert_with(HashMap::new).insert(key.0, value);
    }
    pub(crate) fn clear(&self) {
        *self.lock() = None;
    }
}

/// Exact, unambiguous byte encoding of memo inputs.
pub(crate) struct Key(Vec<u8>);
impl Key {
    pub(crate) fn new(tag: &str) -> Self {
        let mut k = Self(Vec::with_capacity(1024));
        k.str(tag);
        k
    }
    pub(crate) fn u64(&mut self, v: u64) -> &mut Self {
        self.0.extend_from_slice(&v.to_le_bytes());
        self
    }
    pub(crate) fn usize(&mut self, v: usize) -> &mut Self {
        self.u64(v as u64)
    }
    pub(crate) fn bool(&mut self, v: bool) -> &mut Self {
        self.0.push(v as u8);
        self
    }
    pub(crate) fn f64(&mut self, v: f64) -> &mut Self {
        self.u64(v.to_bits())
    }
    pub(crate) fn str(&mut self, v: &str) -> &mut Self {
        self.usize(v.len());
        self.0.extend_from_slice(v.as_bytes());
        self
    }
    pub(crate) fn point(&mut self, p: Point) -> &mut Self {
        self.f64(p.x).f64(p.y)
    }
    pub(crate) fn ring(&mut self, ring: &[Point]) -> &mut Self {
        self.usize(ring.len());
        for &p in ring {
            self.point(p);
        }
        self
    }
    pub(crate) fn shape(&mut self, s: &Shape) -> &mut Self {
        self.ring(&s.outer).usize(s.holes.len());
        for h in &s.holes {
            self.ring(h);
        }
        self
    }
    /// A serialisable value, through its exact JSON text (length-prefixed).
    pub(crate) fn json<T: serde::Serialize + ?Sized>(&mut self, v: &T) -> &mut Self {
        let bytes = serde_json::to_vec(v).expect("serialisable memo input");
        self.usize(bytes.len());
        self.0.extend_from_slice(&bytes);
        self
    }
}

#[cfg(test)]
mod tests {
    use super::super::{
        LayoutConfig, ParcelConfig, Point, Site, Street, Surface, generate_parcels, generate_quarters,
    };
    use std::sync::atomic::Ordering;

    /// A river town: several trim probes, port quarters, trim finish, bridges.
    fn town(culture: &str, population: u32, memo: bool) -> String {
        let n = 128;
        let height = vec![10.0; n * n];
        let mut water = vec![0; n * n];
        for y in 0..n {
            for x in n / 2..n / 2 + 2 {
                water[y * n + x] = 3;
            }
        }
        let surface = Surface { geometry: None, width: 6000.0, n, height: &height, water: &water };
        let site = Site {
            key: "memo".into(), name: String::new(), population, culture: culture.into(),
            center: Point { x: 2800.0, y: 3000.0 }, radius: 150.0,
        };
        let cfg: LayoutConfig = serde_json::from_str(include_str!("fixtures/small-layout-config.json")).unwrap();
        let roads = vec![Street {
            path: vec![Point { x: 0.0, y: 3000.0 }, Point { x: 6000.0, y: 3000.0 }],
            widths: vec![8.0; 2], rank: 1, role: "regional".into(),
        }];
        super::FORCED_OFF.store(!memo, Ordering::SeqCst);
        let layouts = generate_quarters("memo", &[site], &cfg, surface, &roads);
        super::FORCED_OFF.store(false, Ordering::SeqCst);
        let layouts = layouts.unwrap();
        let parts = generate_parcels("memo", &layouts, &ParcelConfig::default()).unwrap();
        serde_json::to_string(&(layouts, parts)).unwrap()
    }

    /// `URBAN_NO_PROBE_CACHE` changes nothing but the time: the memoised
    /// probes give the very bytes a recomputation gives.
    #[test]
    fn probe_memo_output_is_identical_to_recomputation() {
        for (culture, population) in [("khmer", 10000), ("maya", 10000)] {
            let hits = super::HITS.load(Ordering::SeqCst);
            let memo = town(culture, population, true);
            assert!(super::HITS.load(Ordering::SeqCst) > hits, "{culture}: the memo was not used");
            let plain = town(culture, population, false);
            assert!(memo == plain, "{culture}: memoised probes changed the output");
        }
    }
}
