//! Deterministic parallel map for the urban stages.
//!
//! `map` returns its results in input order, so a caller that keeps every
//! random stream forked per item (`rng.fork(&format!("quarter:{i}"))`) and
//! merges the results serially gets bit-identical output whatever the number
//! of threads. Native builds use rayon's global pool, as does wasm32 with the
//! `threads` feature (pool started by wasm-bindgen-rayon's `initThreadPool`);
//! plain wasm32 (and `URBAN_THREADS=1`) run the same closure serially.

/// Whether the parallel path is disabled for this process (`URBAN_THREADS=1`).
#[cfg(any(not(target_arch = "wasm32"), feature = "threads"))]
fn serial() -> bool {
    static SERIAL: std::sync::OnceLock<bool> = std::sync::OnceLock::new();
    *SERIAL.get_or_init(|| std::env::var("URBAN_THREADS").is_ok_and(|v| v.trim() == "1"))
}

#[cfg(any(not(target_arch = "wasm32"), feature = "threads"))]
thread_local! {
    static HOLDS_CELL: std::cell::Cell<bool> = const { std::cell::Cell::new(false) };
}

/// Runs `f`, the initialiser of a cell shared by parallel items, with every
/// `map` on this thread serial. A rayon worker waiting in a parallel map steals
/// other items, and an item reaching the same cell would wait on the worker
/// initialising it: itself.
#[cfg(any(not(target_arch = "wasm32"), feature = "threads"))]
pub(crate) fn holding_cell<R>(f: impl FnOnce() -> R) -> R {
    struct Release(bool);
    impl Drop for Release {
        fn drop(&mut self) {
            HOLDS_CELL.set(self.0);
        }
    }
    let _release = Release(HOLDS_CELL.replace(true));
    f()
}

#[cfg(all(target_arch = "wasm32", not(feature = "threads")))]
pub(crate) fn holding_cell<R>(f: impl FnOnce() -> R) -> R {
    f()
}

/// `items.iter().enumerate().map(f).collect()`, possibly in parallel, always
/// in input order.
#[cfg(any(not(target_arch = "wasm32"), feature = "threads"))]
pub(crate) fn map<T, R, F>(items: &[T], f: F) -> Vec<R>
where
    T: Sync,
    R: Send,
    F: Fn(usize, &T) -> R + Sync + Send,
{
    use rayon::prelude::*;
    if items.len() < 2 || serial() || HOLDS_CELL.get() || rayon::current_num_threads() < 2 {
        return items.iter().enumerate().map(|(i, t)| f(i, t)).collect();
    }
    items.par_iter().enumerate().map(|(i, t)| f(i, t)).collect()
}

#[cfg(all(target_arch = "wasm32", not(feature = "threads")))]
pub(crate) fn map<T, R, F>(items: &[T], f: F) -> Vec<R>
where
    F: Fn(usize, &T) -> R,
{
    items.iter().enumerate().map(|(i, t)| f(i, t)).collect()
}

/// Threads `map` uses here (1 when serial): a width for speculative rounds.
/// Results never depend on it.
#[cfg(any(not(target_arch = "wasm32"), feature = "threads"))]
pub(crate) fn threads() -> usize {
    if serial() || HOLDS_CELL.get() {
        1
    } else {
        rayon::current_num_threads().max(1)
    }
}

#[cfg(all(target_arch = "wasm32", not(feature = "threads")))]
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
#[cfg(any(not(target_arch = "wasm32"), feature = "threads"))]
#[allow(dead_code)]
pub(crate) fn with_threads<R: Send>(threads: usize, f: impl FnOnce() -> R + Send) -> R {
    rayon::ThreadPoolBuilder::new()
        .num_threads(threads.max(1))
        .build()
        .expect("urban thread pool")
        .install(f)
}

#[cfg(all(target_arch = "wasm32", not(feature = "threads")))]
#[allow(dead_code)]
pub(crate) fn with_threads<R>(_threads: usize, f: impl FnOnce() -> R) -> R {
    f()
}

#[cfg(test)]
mod tests {
    /// Every item reaches one cell whose initialiser maps in parallel: a worker
    /// stealing an item while it initialises would wait on itself for ever.
    #[test]
    fn a_cell_shared_by_parallel_items_does_not_wait_on_itself() {
        let cell = std::sync::OnceLock::new();
        let items: Vec<u64> = (0..64).collect();
        let sums = super::with_threads(4, || {
            super::map(&items, |_, _| {
                *cell.get_or_init(|| {
                    super::holding_cell(|| super::map(&items, |_, v| *v).iter().sum::<u64>())
                })
            })
        });
        assert!(sums.iter().all(|s| *s == 2016));
    }

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
