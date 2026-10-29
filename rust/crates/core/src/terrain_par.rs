//! Deterministic data-parallel helpers for the terrain kernels.
//!
//! Each closure writes only its own slice of the output and reads shared
//! inputs that no other task writes (stencil passes read a separate buffer),
//! so results are bit-identical whatever the number of threads. Native builds
//! use rayon's global pool (`RAYON_NUM_THREADS`); wasm32 runs the same
//! closures serially unless the `threads` feature provides a rayon pool.

#[cfg(any(not(target_arch = "wasm32"), feature = "threads"))]
fn parallel(len: usize) -> bool {
    len >= 2 * BLOCK && rayon::current_num_threads() > 1
}

/// Cells per task of the flat per-cell kernels.
const BLOCK: usize = 4096;

/// `f(y, row)` for every `width`-long row of `out`.
pub(crate) fn rows<T, F>(out: &mut [T], width: usize, f: F)
where
    T: Send,
    F: Fn(usize, &mut [T]) + Sync + Send,
{
    #[cfg(any(not(target_arch = "wasm32"), feature = "threads"))]
    if parallel(out.len()) {
        use rayon::prelude::*;
        out.par_chunks_mut(width)
            .enumerate()
            .for_each(|(y, row)| f(y, row));
        return;
    }
    out.chunks_mut(width)
        .enumerate()
        .for_each(|(y, row)| f(y, row));
}

/// `f(y, row_a, row_b)` for every pair of `width`-long rows of `a` and `b`.
pub(crate) fn rows2<A, B, F>(a: &mut [A], b: &mut [B], width: usize, f: F)
where
    A: Send,
    B: Send,
    F: Fn(usize, &mut [A], &mut [B]) + Sync + Send,
{
    #[cfg(any(not(target_arch = "wasm32"), feature = "threads"))]
    if parallel(a.len()) {
        use rayon::prelude::*;
        a.par_chunks_mut(width)
            .zip(b.par_chunks_mut(width))
            .enumerate()
            .for_each(|(y, (ra, rb))| f(y, ra, rb));
        return;
    }
    a.chunks_mut(width)
        .zip(b.chunks_mut(width))
        .enumerate()
        .for_each(|(y, (ra, rb))| f(y, ra, rb));
}

/// `f(i, &mut out[i])` for every cell, in independent blocks.
pub(crate) fn cells<T, F>(out: &mut [T], f: F)
where
    T: Send,
    F: Fn(usize, &mut T) + Sync + Send,
{
    let block = |k: usize, chunk: &mut [T]| {
        let start = k * BLOCK;
        for (j, value) in chunk.iter_mut().enumerate() {
            f(start + j, value);
        }
    };
    #[cfg(any(not(target_arch = "wasm32"), feature = "threads"))]
    if parallel(out.len()) {
        use rayon::prelude::*;
        out.par_chunks_mut(BLOCK)
            .enumerate()
            .for_each(|(k, chunk)| block(k, chunk));
        return;
    }
    out.chunks_mut(BLOCK)
        .enumerate()
        .for_each(|(k, chunk)| block(k, chunk));
}

/// `f(i, &mut a[i], &mut b[i])` for every cell, in independent blocks.
pub(crate) fn cells2<A, B, F>(a: &mut [A], b: &mut [B], f: F)
where
    A: Send,
    B: Send,
    F: Fn(usize, &mut A, &mut B) + Sync + Send,
{
    let block = |k: usize, ca: &mut [A], cb: &mut [B]| {
        let start = k * BLOCK;
        for (j, (va, vb)) in ca.iter_mut().zip(cb.iter_mut()).enumerate() {
            f(start + j, va, vb);
        }
    };
    #[cfg(any(not(target_arch = "wasm32"), feature = "threads"))]
    if parallel(a.len()) {
        use rayon::prelude::*;
        a.par_chunks_mut(BLOCK)
            .zip(b.par_chunks_mut(BLOCK))
            .enumerate()
            .for_each(|(k, (ca, cb))| block(k, ca, cb));
        return;
    }
    a.chunks_mut(BLOCK)
        .zip(b.chunks_mut(BLOCK))
        .enumerate()
        .for_each(|(k, (ca, cb))| block(k, ca, cb));
}

/// Stable LSD radix sort of `(key, value)` pairs by key (three 11-bit digits),
/// `spare` being scratch. Chunks count and place their digits independently,
/// so the order is that of the serial stable sort for any thread count.
pub(crate) fn radix_sort(keys: &mut Vec<(u32, u32)>, spare: &mut Vec<(u32, u32)>) {
    const DIGITS: usize = 2048;
    spare.clear();
    spare.resize(keys.len(), (0, 0));
    #[cfg(any(not(target_arch = "wasm32"), feature = "threads"))]
    if parallel(keys.len()) {
        use rayon::prelude::*;
        struct Out(*mut (u32, u32));
        // SAFETY: the chunks' digit offsets partition the output: every slot
        // is written by exactly one chunk, once.
        unsafe impl Sync for Out {}
        let chunk = keys.len().div_ceil(32);
        for shift in [0, 11, 22] {
            let mut counts: Vec<[usize; DIGITS]> = keys
                .par_chunks(chunk)
                .map(|part| {
                    let mut count = [0usize; DIGITS];
                    for &(key, _) in part {
                        count[(key >> shift) as usize & (DIGITS - 1)] += 1;
                    }
                    count
                })
                .collect();
            let mut start = 0;
            for digit in 0..DIGITS {
                for count in counts.iter_mut() {
                    let c = count[digit];
                    count[digit] = start;
                    start += c;
                }
            }
            let out = Out(spare.as_mut_ptr());
            let out = &out;
            keys.par_chunks(chunk)
                .zip(counts.par_iter_mut())
                .for_each(|(part, slots)| {
                    for &entry in part {
                        let slot = &mut slots[(entry.0 >> shift) as usize & (DIGITS - 1)];
                        unsafe { *out.0.add(*slot) = entry };
                        *slot += 1;
                    }
                });
            std::mem::swap(keys, spare);
        }
        return;
    }
    for shift in [0, 11, 22] {
        let mut count = [0usize; DIGITS];
        for &(key, _) in keys.iter() {
            count[(key >> shift) as usize & (DIGITS - 1)] += 1;
        }
        let mut start = 0;
        for slot in &mut count {
            let c = *slot;
            *slot = start;
            start += c;
        }
        for &entry in keys.iter() {
            let slot = &mut count[(entry.0 >> shift) as usize & (DIGITS - 1)];
            spare[*slot] = entry;
            *slot += 1;
        }
        std::mem::swap(keys, spare);
    }
}

/// Whether the kernels run on more than one thread: selects between serial and
/// parallel formulations of the same exact sums, never between results.
pub(crate) fn threaded() -> bool {
    #[cfg(any(not(target_arch = "wasm32"), feature = "threads"))]
    if rayon::current_num_threads() > 1 {
        return true;
    }
    false
}
