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
