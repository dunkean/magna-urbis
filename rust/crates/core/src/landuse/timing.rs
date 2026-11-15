pub struct Clock {
    #[cfg(not(target_arch = "wasm32"))]
    start: std::time::Instant,
}
impl Clock {
    pub fn new() -> Self {
        Self {
            #[cfg(not(target_arch = "wasm32"))]
            start: std::time::Instant::now(),
        }
    }
    pub fn ms(&self) -> f64 {
        #[cfg(not(target_arch = "wasm32"))]
        {
            (self.start.elapsed().as_secs_f64() * 1000.0 + 0.5).floor()
        }
        #[cfg(target_arch = "wasm32")]
        {
            0.0
        }
    }
}

/// Laps for `URBAN_PROFILE`, as `urban::network::Lap`: each `lap` prints the time since the
/// previous one as `  {prefix}.{label}: N ms`. Silent without the variable and on wasm.
pub struct Lap {
    #[cfg(not(target_arch = "wasm32"))]
    prefix: &'static str,
    #[cfg(not(target_arch = "wasm32"))]
    mark: Option<std::time::Instant>,
}
impl Lap {
    #[cfg(not(target_arch = "wasm32"))]
    pub fn new(prefix: &'static str) -> Self {
        Self { prefix, mark: std::env::var("URBAN_PROFILE").is_ok().then(std::time::Instant::now) }
    }
    #[cfg(target_arch = "wasm32")]
    pub fn new(_prefix: &'static str) -> Self {
        Self {}
    }
    #[cfg(not(target_arch = "wasm32"))]
    pub fn lap(&mut self, label: &str) {
        if let Some(mark) = &mut self.mark {
            eprintln!("  {}.{label}: {:.0} ms", self.prefix, mark.elapsed().as_secs_f64() * 1000.0);
            *mark = std::time::Instant::now();
        }
    }
    #[cfg(target_arch = "wasm32")]
    pub fn lap(&mut self, _label: &str) {}
}
