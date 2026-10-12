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
