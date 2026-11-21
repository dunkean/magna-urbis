//! Profiling laps of the town engine, printed when `URBAN_PROFILE` is set.

/// Laps for `URBAN_PROFILE`: each call to `lap` prints the time since the
/// previous lap (or since `new`) as `  {prefix}.{label}: N ms`. Silent without
/// the variable, and always silent on wasm (no clock).
pub(super) struct Lap {
    #[cfg(not(target_arch = "wasm32"))]
    prefix: &'static str,
    #[cfg(not(target_arch = "wasm32"))]
    mark: Option<std::time::Instant>,
}
impl Lap {
    #[cfg(not(target_arch = "wasm32"))]
    pub(super) fn new(prefix: &'static str) -> Self {
        Self { prefix, mark: std::env::var("URBAN_PROFILE").is_ok().then(std::time::Instant::now) }
    }
    #[cfg(target_arch = "wasm32")]
    pub(super) fn new(_prefix: &'static str) -> Self {
        Self {}
    }
    #[cfg(not(target_arch = "wasm32"))]
    pub(super) fn lap(&mut self, label: &str) {
        if let Some(mark) = &mut self.mark {
            eprintln!("  {}.{label}: {:.0} ms", self.prefix, mark.elapsed().as_secs_f64() * 1000.0);
            *mark = std::time::Instant::now();
        }
    }
    #[cfg(target_arch = "wasm32")]
    pub(super) fn lap(&mut self, _label: &str) {}
}
