/// The standalone vectorizer stays serial. Whole-stage independent classes use an ordered map.
pub fn map<T: Sync, U: Send>(items: &[T], f: impl Fn(&T) -> U + Sync + Send) -> Vec<U> {
    #[cfg(any(not(target_arch = "wasm32"), feature = "threads"))]
    {
        use rayon::prelude::*;
        items.par_iter().map(f).collect()
    }
    #[cfg(all(target_arch = "wasm32", not(feature = "threads")))]
    {
        items.iter().map(f).collect()
    }
}

/// Independent cells; index and floating evaluation within each cell stay unchanged.
pub fn for_each<T: Send>(items: &mut [T], f: impl Fn(usize, &mut T) + Sync + Send) {
    #[cfg(any(not(target_arch = "wasm32"), feature = "threads"))]
    {
        use rayon::prelude::*;
        items.par_iter_mut().enumerate().for_each(|(i, v)| f(i, v));
    }
    #[cfg(all(target_arch = "wasm32", not(feature = "threads")))]
    {
        items.iter_mut().enumerate().for_each(|(i, v)| f(i, v));
    }
}
pub fn for_each2<T: Send, U: Send>(
    a: &mut [T],
    b: &mut [U],
    f: impl Fn(usize, &mut T, &mut U) + Sync + Send,
) {
    #[cfg(any(not(target_arch = "wasm32"), feature = "threads"))]
    {
        use rayon::prelude::*;
        a.par_iter_mut()
            .zip(b.par_iter_mut())
            .enumerate()
            .for_each(|(i, (a, b))| f(i, a, b));
    }
    #[cfg(all(target_arch = "wasm32", not(feature = "threads")))]
    {
        a.iter_mut()
            .zip(b.iter_mut())
            .enumerate()
            .for_each(|(i, (a, b))| f(i, a, b));
    }
}
