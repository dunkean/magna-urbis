//! Analytic street contact for a fixed entrance and a finite-width connector.
//! No building movement, ray sampling, magic setback or site-rights relaxation.
use crate::model::Point;

// Finite numerical scope only, not an allowed translation or site margin.
const MAX_COORDINATE: f64 = 1_000_000_000_000.;

#[derive(Clone, Debug, PartialEq)]
pub(crate) struct FrontageContact {
    pub point: Point,
    /// Scalar coordinate on street[0] -> street[1].
    pub distance_on_street_m: f64,
    /// Conservative floating representation of the analytic feasible interval.
    pub feasible_interval_m: [f64; 2],
    pub half_cap_m: f64,
}

#[derive(Clone, Debug, PartialEq)]
pub(crate) enum ContactOutcome {
    Fit(FrontageContact),
    Empty,
    /// Degenerate or numerically unsupported input. The caller keeps its
    /// existing fallback; this is not a geometric impossibility certificate.
    Unsupported(String),
}

#[derive(Clone, Copy)]
struct Interval {
    lo: f64,
    hi: f64,
}

fn unsupported(reason: &str) -> ContactOutcome {
    ContactOutcome::Unsupported(reason.into())
}

/// x >= h * hypot(v, x-u) / v, with x >= 0 and v,h > 0.
/// The coefficient sign matters: v<h has TWO finite bounds, not one margin.
fn one_end_interval(u: f64, v: f64, h: f64) -> Result<Option<Interval>, &'static str> {
    let a = (v - h) * (v + h);
    let hh = h * h;
    let b = 2. * hh * u;
    let c = -hh * (u * u + v * v);
    if hh == 0. || c == 0. {
        return Err("Contact coefficients underflow at this numerical scale.");
    }
    if a == 0. {
        if v != h {
            return Err("Contact quadratic coefficient underflow.");
        }
        return if b > 0. {
            Ok(Some(Interval {
                lo: -c / b,
                hi: f64::INFINITY,
            }))
        } else {
            Ok(None)
        };
    }
    // b² - 4ac = 4h²v²(u²+v²-h²). The factored expression avoids
    // cancellation of the large b² and 4ac terms for a nearby entrance.
    let radicand = u * u + a;
    if radicand < 0. {
        let error_scale = 16. * f64::EPSILON * (u * u + a.abs());
        return if -radicand <= error_scale {
            Err("Contact tangency cannot be certified at this floating precision.")
        } else {
            Ok(None)
        };
    }
    let discriminant_root = 2. * h * v * libm::sqrt(radicand);
    if radicand > 0. && discriminant_root == 0. {
        return Err("Contact discriminant underflow.");
    }
    // Stable quadratic roots: one is q/a, the other c/q. This avoids
    // subtracting almost equal b and sqrt(discriminant) for the small root.
    let q = -0.5 * (b + discriminant_root.copysign(b));
    if q == 0. || !q.is_finite() {
        return Err("Contact quadratic roots are numerically indeterminate.");
    }
    let x = q / a;
    let y = c / q;
    if x.is_nan() || y.is_nan() {
        return Err("Contact quadratic roots are invalid.");
    }
    let (lo, hi) = (x.min(y), x.max(y));
    Ok(Some(if a > 0. {
        // c<0 means the other exterior branch is entirely at x<0.
        Interval {
            lo: hi,
            hi: f64::INFINITY,
        }
    } else {
        Interval { lo, hi }
    }))
}

fn inward_lower(value: f64) -> f64 {
    // Called only on finite nonnegative street coordinates.
    f64::from_bits(value.to_bits() + 1)
}

fn inward_upper(value: f64) -> f64 {
    if value == 0. {
        0.
    } else {
        f64::from_bits(value.to_bits() - 1)
    }
}

fn spacing(value: f64) -> f64 {
    let value = value.abs();
    f64::from_bits(value.to_bits() + 1) - value
}

/// Project the entrance onto the complete feasible street interval. The
/// connector's cap on the entrance itself, obstacles, terrain and the actual
/// world-space edge-capped polygon still require the caller's native guards.
pub(crate) fn solve(entry: Point, street: [Point; 2], width_m: f64) -> ContactOutcome {
    let [a, b] = street;
    if [entry, a, b].into_iter().any(|p| {
        !p.x.is_finite()
            || !p.y.is_finite()
            || p.x.abs() > MAX_COORDINATE
            || p.y.abs() > MAX_COORDINATE
    }) || !width_m.is_finite()
        || width_m <= 0.
        || width_m > MAX_COORDINATE
    {
        return unsupported(
            "Contact requires finite coordinates and a positive finite width within numerical bounds.",
        );
    }
    let dx = b.x - a.x;
    let dy = b.y - a.y;
    let length = libm::hypot(dx, dy);
    if length == 0. {
        return unsupported("Contact street segment is degenerate.");
    }
    if length < width_m {
        return ContactOutcome::Empty;
    }
    let (tx, ty) = (dx / length, dy / length);
    let (ex, ey) = (entry.x - a.x, entry.y - a.y);
    let u = ex * tx + ey * ty;
    let v = (-ex * ty + ey * tx).abs();
    let h = width_m * 0.5;
    if v == 0. {
        return unsupported(
            "Entrance lies on the street supporting line; a zero-length or parallel connector needs another operator.",
        );
    }
    let left = match one_end_interval(u, v, h) {
        Ok(Some(value)) => value,
        Ok(None) => return ContactOutcome::Empty,
        Err(reason) => return unsupported(reason),
    };
    // Mirror the right endpoint: x=L-s and its entrance projection is L-u.
    let right = match one_end_interval(length - u, v, h) {
        Ok(Some(value)) => value,
        Ok(None) => return ContactOutcome::Empty,
        Err(reason) => return unsupported(reason),
    };
    let mut lo = 0_f64.max(left.lo).max(length - right.hi);
    let mut hi = length.min(left.hi).min(length - right.lo);
    if lo > hi {
        if lo.is_finite()
            && hi.is_finite()
            && lo - hi <= 16. * f64::EPSILON * length.max(lo.abs()).max(hi.abs())
        {
            return unsupported("Contact intervals meet within unresolved floating precision.");
        }
        return ContactOutcome::Empty;
    }
    if !lo.is_finite() || !hi.is_finite() {
        return unsupported("Contact interval is not finitely representable.");
    }
    // Directed rounding of nonpoint intervals by ONE representable number.
    // No physical epsilon, repeated proposals or tolerance enlargement.
    if lo < hi {
        let inner_lo = inward_lower(lo);
        let inner_hi = inward_upper(hi);
        if inner_lo > inner_hi {
            return unsupported("Contact interval has no conservatively representable interior.");
        }
        lo = inner_lo;
        hi = inner_hi;
    }
    let cap = |s: f64| h * libm::hypot(v, s - u) / v;
    let valid = |s: f64| {
        let half = cap(s);
        half.is_finite() && s >= half && length - s >= half
    };
    if !valid(lo) || !valid(hi) {
        return unsupported("Contact root failed strict cap verification at floating precision.");
    }
    let mut s = u.clamp(lo, hi);
    if !valid(s) {
        return unsupported("Contact projection failed strict cap verification.");
    }
    let at = |s: f64| Point {
        x: a.x + tx * s,
        y: a.y + ty * s,
    };
    // Reproduce the street-cap arithmetic from the actual represented Point.
    // A scalar root can be inside while world-coordinate rounding puts this
    // recomputed cap a few ulps outside. No physical threshold is relaxed.
    let represented_cap = |contact: Point| -> Option<f64> {
        let vx = contact.x - entry.x;
        let vy = contact.y - entry.y;
        let connector_length = libm::hypot(vx, vy);
        if connector_length == 0. {
            return None;
        }
        let dot = (dx * (vy / connector_length) + dy * (-vx / connector_length)) / length;
        let half = h / dot.abs();
        let from = ((contact.x - a.x) * dx + (contact.y - a.y) * dy) / length;
        (half.is_finite() && from >= half && length - from >= half).then_some(half)
    };
    let mut point = at(s);
    let half_cap = if let Some(half) = represented_cap(point) {
        half
    } else {
        let middle = lo + (hi - lo) * 0.5;
        if middle == s {
            return unsupported("Represented contact has no interior direction for rounding.");
        }
        // One numerical representation correction, not a search or setback.
        // World spacing dominates on city coordinates; scalar spacing makes
        // the correction representable when the contact is close to (0,0).
        let step = libm::hypot(spacing(point.x), spacing(point.y)).max(spacing(s));
        let distance = (middle - s).abs();
        s = if step >= distance {
            middle
        } else {
            s + (middle - s).signum() * step
        };
        if s < lo || s > hi || !valid(s) {
            return unsupported("Represented contact correction leaves its analytic interval.");
        }
        point = at(s);
        let Some(half) = represented_cap(point) else {
            return unsupported("Represented contact still fails the strict street-cap guard.");
        };
        half
    };
    ContactOutcome::Fit(FrontageContact {
        point,
        distance_on_street_m: s,
        feasible_interval_m: [lo, hi],
        half_cap_m: half_cap,
    })
}

#[cfg(test)]
#[path = "frontage_contact_tests.rs"]
mod tests;
