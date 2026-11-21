//! Deterministic parallel map, as core's `urban/par.rs`.
//!
//! `map` returns its results in input order, so work whose random streams are keyed per item
//! gives the same output whatever the number of threads. Native builds use rayon's global pool,
//! as does wasm32 with the `threads` feature; plain wasm32 and `URBAN_THREADS=1` run serially.

/// Whether the parallel path is disabled for this process (`URBAN_THREADS=1`).
#[cfg(any(not(target_arch = "wasm32"), feature = "threads"))]
fn serial() -> bool {
    static SERIAL: std::sync::OnceLock<bool> = std::sync::OnceLock::new();
    *SERIAL.get_or_init(|| std::env::var("URBAN_THREADS").is_ok_and(|v| v.trim() == "1"))
}

/// `items.iter().enumerate().map(f).collect()`, possibly in parallel, always in input order.
#[cfg(any(not(target_arch = "wasm32"), feature = "threads"))]
pub(crate) fn map<T, R, F>(items: &[T], f: F) -> Vec<R>
where
    T: Sync,
    R: Send,
    F: Fn(usize, &T) -> R + Sync + Send,
{
    use rayon::prelude::*;
    if items.len() < 2 || serial() || rayon::current_num_threads() < 2 {
        return items.iter().enumerate().map(|(i, t)| f(i, t)).collect();
    }
    items.par_iter().enumerate().map(|(i, t)| f(i, t)).collect()
}

/// `items.iter().enumerate().map(f).collect()`, serially.
#[cfg(all(target_arch = "wasm32", not(feature = "threads")))]
pub(crate) fn map<T, R, F>(items: &[T], f: F) -> Vec<R>
where
    F: Fn(usize, &T) -> R,
{
    items.iter().enumerate().map(|(i, t)| f(i, t)).collect()
}
