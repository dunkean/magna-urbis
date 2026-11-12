//! Hardware-speed replacement for the `hypot` of wasm32's software libm.
//!
//! wasm32-unknown-unknown has no system libm: `f64::hypot` resolves to the weak
//! `hypot` of compiler-builtins, a correctly rounded algorithm built on a
//! software `fma` (WebAssembly has no fused multiply-add). Profiles of the V2 web
//! profile spent 25-30 % of the urban quarters stage and of every rayon worker
//! in that pair (hypot + fma), against a few nanoseconds natively. This strong
//! symbol replaces it for the whole module: `sqrt(x^2 + y^2)` with the hardware
//! `f64.sqrt`, rescaled only when the squares would overflow or underflow.
//! Results differ from the libm ones by at most about one ulp.

#[cfg(target_arch = "wasm32")]
#[unsafe(no_mangle)]
pub extern "C" fn hypot(x: f64, y: f64) -> f64 {
    fast_hypot(x, y)
}

#[inline]
#[cfg_attr(not(target_arch = "wasm32"), allow(dead_code))]
pub fn fast_hypot(x: f64, y: f64) -> f64 {
    let (ax, ay) = (x.abs(), y.abs());
    let squares = ax * ax + ay * ay;
    if squares.is_finite() && squares >= f64::MIN_POSITIVE {
        return squares.sqrt();
    }
    // IEEE 754: an infinite side wins over NaN.
    if ax.is_infinite() || ay.is_infinite() {
        return f64::INFINITY;
    }
    if ax.is_nan() || ay.is_nan() {
        return f64::NAN;
    }
    let big = ax.max(ay);
    if big == 0.0 {
        return 0.0;
    }
    let (a, b) = (ax / big, ay / big);
    big * (a * a + b * b).sqrt()
}

#[cfg(test)]
mod tests {
    use super::fast_hypot as hypot;

    #[test]
    fn matches_libm_within_an_ulp_and_handles_extremes() {
        for &(x, y) in &[(3.0, 4.0), (1e-3, 2.5e2), (-7.25, 0.125), (1e5, 1e5), (123.456, -0.001)] {
            let exact = f64::hypot(x, y);
            assert!((hypot(x, y) - exact).abs() <= exact * 2.0 * f64::EPSILON, "{x} {y}");
        }
        assert_eq!(hypot(1e300, 1e300), 1e300 * 2f64.sqrt());
        assert!(hypot(1e-300, 1e-300) > 0.0);
        assert_eq!(hypot(f64::INFINITY, f64::NAN), f64::INFINITY);
        assert!(hypot(f64::NAN, 1.0).is_nan());
        assert_eq!(hypot(0.0, -0.0), 0.0);
    }
}
