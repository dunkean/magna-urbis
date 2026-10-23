//! Deterministic parallel map for the urban stages.
//!
//! `map` returns its results in input order, so a caller that keeps every
//! random stream forked per item (`rng.fork(&format!("quarter:{i}"))`) and
//! merges the results serially gets bit-identical output whatever the number
//! of threads. Native builds use rayon's global pool; wasm32 (and
//! `URBAN_THREADS=1`) run the same closure serially.

/// Whether the parallel path is disabled for this process (`URBAN_THREADS=1`).
#[cfg(not(target_arch = "wasm32"))]
fn serial() -> bool {
    static SERIAL: std::sync::OnceLock<bool> = std::sync::OnceLock::new();
    *SERIAL.get_or_init(|| std::env::var("URBAN_THREADS").is_ok_and(|v| v.trim() == "1"))
}

/// `items.iter().enumerate().map(f).collect()`, possibly in parallel, always
/// in input order.
#[cfg(not(target_arch = "wasm32"))]
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

#[cfg(target_arch = "wasm32")]
pub(crate) fn map<T, R, F>(items: &[T], f: F) -> Vec<R>
where
    F: Fn(usize, &T) -> R,
{
    items.iter().enumerate().map(|(i, t)| f(i, t)).collect()
}

/// Threads `map` uses here (1 when serial): a width for speculative rounds.
/// Results never depend on it.
#[cfg(not(target_arch = "wasm32"))]
pub(crate) fn threads() -> usize {
    if serial() {
        1
    } else {
        rayon::current_num_threads().max(1)
    }
}

#[cfg(target_arch = "wasm32")]
pub(crate) fn threads() -> usize {
    1
}

/// `(0..n).map(f).collect()`, possibly in parallel, always in index order.
pub(crate) fn range<R, F>(n: usize, f: F) -> Vec<R>
where
    R: Send,
    F: Fn(usize) -> R + Sync + Send,
{
    let indices: Vec<usize> = (0..n).collect();
    map(&indices, |_, &i| f(i))
}

/// Runs `f` on a dedicated pool of `threads` threads (tests compare 1 against
/// many). wasm32 runs it directly.
#[cfg(not(target_arch = "wasm32"))]
#[allow(dead_code)]
pub(crate) fn with_threads<R: Send>(threads: usize, f: impl FnOnce() -> R + Send) -> R {
    rayon::ThreadPoolBuilder::new()
        .num_threads(threads.max(1))
        .build()
        .expect("urban thread pool")
        .install(f)
}

#[cfg(target_arch = "wasm32")]
#[allow(dead_code)]
pub(crate) fn with_threads<R>(_threads: usize, f: impl FnOnce() -> R) -> R {
    f()
}

#[cfg(test)]
mod tests {
    #[test]
    fn map_keeps_input_order_with_any_thread_count() {
        let items: Vec<u64> = (0..1000).collect();
        let f = |i: usize, v: &u64| (i as u64) * 31 + v * v;
        let one = super::with_threads(1, || super::map(&items, f));
        let many = super::with_threads(8, || super::map(&items, f));
        assert_eq!(one, many);
        assert_eq!(one[7], 7 * 31 + 49);
    }
}
