// Shared with the browser runtime by the adapter build overlay.
impl crate::Sketch {
    pub fn relief_mask_at(&self, x: f64, y: f64) -> Option<(f32, f32)> {
        if let Self::ReliefMap {
            resolution,
            relief,
            strength,
            extent,
            origin,
            context,
        } = self
        {
            let (u, v) = ((x - origin.0) / extent, (y - origin.1) / extent);
            if !(0.0..=1.0).contains(&u) || !(0.0..=1.0).contains(&v) {
                return context.relief_mask_at(x, y);
            }
            let n = *resolution;
            let gx = (u * n as f64 - 0.5).clamp(0.0, (n - 1) as f64);
            let gy = (v * n as f64 - 0.5).clamp(0.0, (n - 1) as f64);
            let (x0, y0) = (gx.floor() as usize, gy.floor() as usize);
            let (tx, ty) = ((gx - x0 as f64) as f32, (gy - y0 as f64) as f32);
            let sample = |a: &[f32]| {
                let x1 = (x0 + 1).min(n - 1);
                let y1 = (y0 + 1).min(n - 1);
                (a[y0 * n + x0] * (1.0 - tx) + a[y0 * n + x1] * tx) * (1.0 - ty)
                    + (a[y1 * n + x0] * (1.0 - tx) + a[y1 * n + x1] * tx) * ty
            };
            Some((sample(strength).clamp(0.0, 1.0), sample(relief).max(0.0)))
        } else {
            None
        }
    }
}
