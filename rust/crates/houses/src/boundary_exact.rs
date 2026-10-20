//! Exact dyadic predicates and correctly rounded native arrangement nodes.
use super::*;
use num_bigint::{BigInt, BigUint, Sign};
use num_rational::BigRational;
use num_traits::{One, ToPrimitive, Zero};

pub(super) type R = BigRational;
pub(super) fn rational(x: f64) -> R {
    R::from_float(x).expect("validated finite native coordinate")
}

#[derive(Clone, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub(super) struct Q {
    pub x: R,
    pub y: R,
}
impl Q {
    pub fn from(p: Point) -> Self {
        Self {
            x: rational(p.x),
            y: rational(p.y),
        }
    }
    pub fn sub(&self, b: &Self) -> Self {
        Self {
            x: &self.x - &b.x,
            y: &self.y - &b.y,
        }
    }
    pub fn add(&self, b: &Self) -> Self {
        Self {
            x: &self.x + &b.x,
            y: &self.y + &b.y,
        }
    }
    pub fn neg(&self) -> Self {
        Self {
            x: -&self.x,
            y: -&self.y,
        }
    }
    pub fn half(&self) -> Self {
        Self {
            x: &self.x / BigInt::from(2),
            y: &self.y / BigInt::from(2),
        }
    }
    pub fn point(&self) -> Result<Point, String> {
        Ok(Point {
            x: rounded(&self.x)?,
            y: rounded(&self.y)?,
        })
    }
}
pub(super) fn cross(a: &Q, b: &Q) -> R {
    &a.x * &b.y - &a.y * &b.x
}
pub(super) fn sign(q: &R) -> i8 {
    match q.numer().sign() {
        Sign::Minus => -1,
        Sign::NoSign => 0,
        Sign::Plus => 1,
    }
}
pub(super) fn lex(a: R, b: impl FnOnce() -> R) -> i8 {
    let s = sign(&a);
    if s == 0 { sign(&b()) } else { s }
}

#[derive(Clone, PartialEq, Eq)]
pub(super) struct P {
    pub a: R,
    pub b: R,
    pub c: R,
}
impl P {
    pub fn from(p: Plane) -> Self {
        Self {
            a: rational(p.a),
            b: rational(p.b),
            c: rational(p.c),
        }
    }
    pub fn minus(&self, p: &Self) -> Self {
        Self {
            a: &self.a - &p.a,
            b: &self.b - &p.b,
            c: &self.c - &p.c,
        }
    }
    pub fn edge(a: &Q, b: &Q) -> Self {
        let d = b.sub(a);
        Self {
            a: d.y.clone(),
            b: -&d.x,
            c: &d.x * &a.y - &d.y * &a.x,
        }
    }
    pub fn value(&self, p: &Q) -> R {
        &self.a * &p.x + &self.b * &p.y + &self.c
    }
    pub fn derivative(&self, n: &Q) -> R {
        &self.a * &n.x + &self.b * &n.y
    }
}

/// IEEE 754 round to nearest, ties to even. No intermediate floating division.
pub(super) fn rounded(value: &R) -> Result<f64, String> {
    if value.is_zero() {
        return Ok(0.0);
    }
    let negative = value.numer().sign() == Sign::Minus;
    let n = value.numer().magnitude();
    let d = value.denom().magnitude();
    let mut exponent = n.bits() as i64 - d.bits() as i64;
    let below = if exponent >= 0 {
        n < &(d << exponent as usize)
    } else {
        &(n << (-exponent) as usize) < d
    };
    if below {
        exponent -= 1;
    }
    if exponent > 1023 {
        return Err("Nœud Boundary exact hors domaine F64.".into());
    }
    let shift = if exponent >= -1022 {
        52 - exponent
    } else {
        1074
    };
    let (numerator, denominator) = if shift >= 0 {
        (n << shift as usize, d.clone())
    } else {
        (n.clone(), d << (-shift) as usize)
    };
    let mut q = &numerator / &denominator;
    let remainder = &numerator % &denominator;
    let twice = &remainder << 1usize;
    if twice > denominator || (twice == denominator && q.bit(0)) {
        q += BigUint::one();
    }
    let mut significand = q
        .to_u64()
        .ok_or_else(|| "Arrondi Boundary exact hors mantisse.".to_string())?;
    let magnitude = if exponent >= -1022 {
        if significand == 1u64 << 53 {
            significand >>= 1;
            exponent += 1;
        }
        if exponent > 1023 {
            return Err("Arrondi Boundary exact non fini.".into());
        }
        ((exponent + 1023) as u64) << 52 | (significand - (1u64 << 52))
    } else {
        significand
    };
    Ok(f64::from_bits(magnitude | ((negative as u64) << 63)))
}

/// The usual orient2d first-stage bound, enlarged by the known half-ULP
/// coordinate errors of a correctly rounded rational sample. No FMA.
#[cfg(test)]
pub(super) fn orientation(a: Point, b: Point, m: &Q, rounded_m: Point, force_exact: bool) -> i8 {
    if !force_exact {
        let ax = a.x - rounded_m.x;
        let ay = a.y - rounded_m.y;
        let bx = b.x - rounded_m.x;
        let by = b.y - rounded_m.y;
        let left = ax * by;
        let right = ay * bx;
        let determinant = left - right;
        let dx = (b.x - a.x).abs() + ulp(b.x.abs().max(a.x.abs()));
        let dy = (b.y - a.y).abs() + ulp(b.y.abs().max(a.y.abs()));
        let bound = ((3.0 + 16.0 * f64::EPSILON) * f64::EPSILON * (left.abs() + right.abs())
            + dx * ulp(rounded_m.y) * 0.5
            + dy * ulp(rounded_m.x) * 0.5)
            * (1.0 + 8.0 * f64::EPSILON);
        if left.abs() >= f64::MIN_POSITIVE
            && right.abs() >= f64::MIN_POSITIVE
            && determinant.abs() > bound
        {
            return if determinant > 0.0 { 1 } else { -1 };
        }
    }
    sign(&cross(&Q::from(b).sub(&Q::from(a)), &m.sub(&Q::from(a))))
}

/// Certify only non-incidence; an uncertain result leaves the rational guard
/// unchanged. The inputs must be nearest-even images of its three Q values.
pub(super) fn non_incident(af: Point, bf: Point, mf: Point) -> bool {
    let ax = af.x - mf.x;
    let ay = af.y - mf.y;
    let bx = bf.x - mf.x;
    let by = bf.y - mf.y;
    if [ax, ay, bx, by].iter().any(|v| *v != 0.0 && !v.is_normal()) {
        return false;
    }
    let left = ax * by;
    let right = ay * bx;
    if !left.is_normal() || !right.is_normal() {
        return false;
    }
    let determinant = left - right;
    if !determinant.is_finite() {
        return false;
    }
    let sums = [
        ulp(af.x) + ulp(mf.x),
        ulp(af.y) + ulp(mf.y),
        ulp(bf.x) + ulp(mf.x),
        ulp(bf.y) + ulp(mf.y),
    ];
    if sums.iter().any(|v| !v.is_normal() || *v <= 0.0) {
        return false;
    }
    let [eax, eay, ebx, eby] = sums.map(|v| 0.5 * v);
    if [eax, eay, ebx, eby]
        .iter()
        .any(|v| !v.is_normal() || *v <= 0.0)
    {
        return false;
    }
    let products = [
        eax * by.abs(),
        eby * ax.abs(),
        eax * eby,
        eay * bx.abs(),
        ebx * ay.abs(),
        eay * ebx,
    ];
    if products.iter().any(|v| !v.is_normal() || *v <= 0.0) {
        return false;
    }
    let mut uncertainty = products[0];
    for product in &products[1..] {
        uncertainty += product;
        if !uncertainty.is_normal() {
            return false;
        }
    }
    let magnitude = left.abs() + right.abs();
    let arithmetic = ((3.0 + 16.0 * f64::EPSILON) * f64::EPSILON) * magnitude;
    let combined = arithmetic + uncertainty;
    let bound = combined * (1.0 + 16.0 * f64::EPSILON);
    if [magnitude, arithmetic, combined, bound]
        .iter()
        .any(|v| !v.is_normal())
    {
        return false;
    }
    // With u=2^-53, upper-binade ULP/2 bounds each nearest-even input error.
    // A sum of two ULP powers can round down when their exponents differ by
    // at least 53, losing at most u; multiplying its normal result by .5 is
    // exact. The six positive uncertainty terms bound the input perturbation.
    // Their products, five additions, principal addition and final rounding
    // lose at most (1-u)^10, covered by the unchanged (1+32u) margin. The
    // principal coefficient 6u+64u^2 is twice the orient2d first-stage bound.
    // Every contributing result above is normal: no underflow term or FMA is
    // admitted. Thus |det_fl|>bound implies the authoritative determinant is
    // nonzero. No sign is used; a false result requires the original Q test.
    determinant.abs() > bound
}

/// All three inputs are correctly rounded rationals. Certify the floating
/// filter including endpoint errors, then use the authoritative coordinates.
pub(super) fn orientation_q(a: &Q, b: &Q, m: &Q, af: Point, bf: Point, mf: Point) -> i8 {
    let ax = af.x - mf.x;
    let ay = af.y - mf.y;
    let bx = bf.x - mf.x;
    let by = bf.y - mf.y;
    let left = ax * by;
    let right = ay * bx;
    let determinant = left - right;
    let eax = 0.5 * (ulp(af.x) + ulp(mf.x));
    let eay = 0.5 * (ulp(af.y) + ulp(mf.y));
    let ebx = 0.5 * (ulp(bf.x) + ulp(mf.x));
    let eby = 0.5 * (ulp(bf.y) + ulp(mf.y));
    let uncertainty =
        eax * by.abs() + eby * ax.abs() + eax * eby + eay * bx.abs() + ebx * ay.abs() + eay * ebx;
    let bound = (((3.0 + 16.0 * f64::EPSILON) * f64::EPSILON) * (left.abs() + right.abs())
        + uncertainty)
        * (1.0 + 16.0 * f64::EPSILON);
    if left.abs() >= f64::MIN_POSITIVE
        && right.abs() >= f64::MIN_POSITIVE
        && determinant.abs() > bound
    {
        return if determinant > 0.0 { 1 } else { -1 };
    }
    sign(&cross(&b.sub(a), &m.sub(a)))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn check_non_incidence(a: &Q, b: &Q, m: &Q) -> bool {
        let (af, bf, mf) = (a.point().unwrap(), b.point().unwrap(), m.point().unwrap());
        let value = P::edge(a, b).value(m);
        let certified = non_incident(af, bf, mf);
        // This exercises the production orientation_q, not the test-only
        // orientation helper, including non-dyadic endpoint rounding errors.
        assert_eq!(orientation_q(a, b, m, af, bf, mf), -sign(&value));
        if certified {
            assert!(!value.is_zero());
            assert_ne!(orientation_q(a, b, m, af, bf, mf), 0);
        }
        assert_eq!(!certified && value.is_zero(), value.is_zero());
        certified
    }

    #[test]
    fn non_incidence_covers_downward_ulp_sums_at_exponent_gaps() {
        let a = Q::from(Point {
            x: libm::exp2(30.0),
            y: 2.0,
        });
        let b = Q::from(Point {
            x: libm::exp2(30.0) + 1.0,
            y: 3.0,
        });
        for gap in [53.0, 54.0, 60.0, 100.0] {
            let mf = Point {
                x: libm::exp2(30.0 - gap),
                y: libm::exp2(29.0 - gap),
            };
            // The smaller addend really is lost at and beyond the tie.
            assert_eq!(
                ulp(a.point().unwrap().x) + ulp(mf.x),
                ulp(a.point().unwrap().x)
            );
            assert!(check_non_incidence(&a, &b, &Q::from(mf)));
        }
    }

    #[test]
    fn exact_incidence_survives_non_dyadic_ties_and_binade_boundaries() {
        let one = rational(1.0);
        let next = rational(f64::from_bits(1.0f64.to_bits() + 1));
        let tie = (&one + &next) / BigInt::from(2);
        assert_eq!(rounded(&tie).unwrap().to_bits(), 1.0f64.to_bits());
        let third = R::new(1.into(), 3.into());
        for x in [
            rational(f64::from_bits(1.0f64.to_bits() - 1)),
            one,
            next,
            tie,
            rational(2.0),
        ] {
            let midpoint_a = Q {
                x: &x - &third,
                y: rational(1.0) - &third,
            };
            let midpoint_b = Q {
                x: &x + &third,
                y: rational(1.0) + &third,
            };
            let midpoint = midpoint_a.add(&midpoint_b).half();
            assert_eq!(midpoint.x, x);
            assert_eq!(
                midpoint.point().unwrap().x.to_bits(),
                rounded(&x).unwrap().to_bits()
            );
            assert!(!check_non_incidence(&midpoint_a, &midpoint_b, &midpoint));
            let a = Q {
                x: &x + &third,
                y: &third * BigInt::from(2),
            };
            let b = Q {
                x: &x - &third,
                y: -&third,
            };
            for numerator in [1, 2, 3, 5] {
                let t = R::new(numerator.into(), 7.into());
                let d = b.sub(&a);
                let m = Q {
                    x: &a.x + &d.x * &t,
                    y: &a.y + &d.y * &t,
                };
                assert!(!check_non_incidence(&a, &b, &m));
            }
        }
    }

    #[test]
    fn zero_subnormal_and_overflow_operations_use_the_rational_guard() {
        for scale in [0.0, f64::from_bits(1), f64::MIN_POSITIVE, 1e-200, 1e200] {
            let a = Q::from(Point { x: 0.0, y: scale });
            let b = Q::from(Point { x: scale, y: 0.0 });
            let m = Q::from(Point { x: scale, y: scale });
            assert!(!check_non_incidence(&a, &b, &m));
        }
        let a = Q::from(Point {
            x: f64::MAX,
            y: 2.0,
        });
        let b = Q::from(Point {
            x: -f64::MAX,
            y: 3.0,
        });
        let m = Q::from(Point { x: 1.0, y: 1.0 });
        assert!(!check_non_incidence(&a, &b, &m));
    }

    #[test]
    fn raw_plus_delta_and_near_incidence_keep_the_exact_guard_decision() {
        let mut state = 351936u64;
        let mut next = || {
            state ^= state << 13;
            state ^= state >> 7;
            state ^= state << 17;
            state
        };
        let mut certified = 0;
        let mut zeros = 0;
        for _ in 0..2500 {
            let raw = Point {
                x: (next() % 10001) as f64 / 256.0 - 20.0,
                y: (next() % 10001) as f64 / 256.0 - 20.0,
            };
            let delta = Point {
                x: (next() % 101) as f64 / 1000.0 - 0.05,
                y: (next() % 101) as f64 / 1000.0 - 0.05,
            };
            let a = Q::from(raw).add(&Q::from(delta));
            let b = a.add(&Q::from(Point {
                x: (next() % 1000 + 1) as f64 / 128.0,
                y: (next() % 1000 + 1) as f64 / 256.0,
            }));
            let d = b.sub(&a);
            let t = R::new((next() % 19 + 1).into(), 23.into());
            let exact = Q {
                x: &a.x + &d.x * &t,
                y: &a.y + &d.y * &t,
            };
            assert!(!check_non_incidence(&a, &b, &exact));
            zeros += 1;
            for shift in [
                rational(0.125),
                R::new(1.into(), BigInt::from(10u8).pow(40)),
            ] {
                let m = Q {
                    x: exact.x.clone(),
                    y: &exact.y + shift,
                };
                certified += check_non_incidence(&a, &b, &m) as usize;
            }
        }
        assert_eq!(zeros, 2500);
        assert!(certified > 0);
    }

    #[test]
    fn rational_rounding_preserves_ieee_bits_and_ties_to_even() {
        for x in [
            0.0,
            f64::MIN_POSITIVE,
            f64::from_bits(1),
            f64::MAX,
            1.0,
            -0.425,
            48.425,
            1e-300,
        ] {
            assert_eq!(rounded(&rational(x)).unwrap().to_bits(), x.to_bits());
        }
        for bits in [
            1.0f64.to_bits(),
            1.0f64.to_bits() + 1,
            (-0.425f64).to_bits(),
        ] {
            let a = f64::from_bits(bits);
            let b = f64::from_bits(bits + 1);
            let midpoint = (rational(a) + rational(b)) / BigInt::from(2);
            assert_eq!(
                rounded(&midpoint).unwrap().to_bits(),
                if bits & 1 == 0 { bits } else { bits + 1 }
            );
        }
        let half = rational(f64::from_bits(1)) / BigInt::from(2);
        assert_eq!(rounded(&half).unwrap().to_bits(), 0);
    }
    #[test]
    fn certified_filter_has_the_same_sign_as_forced_exact() {
        let a = Point {
            x: 24.0,
            y: -0.4250288424561285,
        };
        let b = Point {
            x: 24.52407517260913,
            y: -0.41892311228980855,
        };
        for p in [
            a,
            b,
            Point {
                x: 23.575,
                y: -0.4299802987668091,
            },
            Point { x: 25.0, y: 1.0 },
        ] {
            let q = Q::from(p);
            let m = q.point().unwrap();
            assert_eq!(
                orientation(a, b, &q, m, false),
                orientation(a, b, &q, m, true)
            );
        }
    }
}
