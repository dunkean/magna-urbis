//! Whole old shared() is a bit oracle on EVERY real call under cfg(test).
//! Not compiled in non-test release; no threshold, probe or order change.
use super::*;

pub(super) fn assert_legacy(a: &Shape, b: &Shape, actual: f64) {
    let expected = legacy_shared(a, b);
    assert_eq!(actual.to_bits(), expected.to_bits(),
        "shared predicate ordering changed f64 bits; a={:?}, b={:?}", a.outer, b.outer);
}
fn shape(outer: &[(f64, f64)]) -> Shape {
    Shape { outer: outer.iter().map(|&(x,y)| Point{x,y}).collect(), holes: vec![] }
}
fn rectangle(x: f64,y:f64,w:f64,d:f64)->Shape {
    shape(&[(x,y),(x+w,y),(x+w,y+d),(x,y+d)])
}
#[test]
fn shared_predicates_keep_segment_splits_holes_reversal_and_nonconvex_sums() {
    let a=rectangle(0.,0.,10.,10.);
    let b=shape(&[(10.,0.),(10.,4.),(10.,10.),(20.,10.),(20.,0.)]);
    assert_eq!(shared(&a,&b).to_bits(),10_f64.to_bits());
    let mut hole=a.clone();
    hole.holes.push(vec![Point{x:2.,y:2.},Point{x:8.,y:2.},Point{x:8.,y:8.},Point{x:2.,y:8.}]);
    // Old shared intentionally uses outer rings only.
    assert_eq!(shared(&hole,&b).to_bits(),shared(&a,&b).to_bits());
    let mut reversed=b.clone();reversed.outer.reverse();
    assert_eq!(shared(&a,&reversed).to_bits(),10_f64.to_bits());
    let nonconvex=shape(&[(0.,0.),(8.,0.),(8.,2.),(3.,2.),(3.,8.),(0.,8.)]);
    for other in [&a,&b,&hole,&reversed,&nonconvex] {
        for first in [&a,&b,&hole,&reversed,&nonconvex] { shared(first,other); }
    }
}
#[test]
fn shared_predicates_keep_native_threshold_ulps_slopes_zero_and_large_offsets() {
    let limit=0.01_f64;
    let min_angle=0.99999_f64;
    for off in [0.,2000.,1.0e9] {
        let a=rectangle(off,off,10.,10.);
        for distance in [0.,limit,-limit,f64::from_bits(limit.to_bits()-1),f64::from_bits(limit.to_bits()+1)] {
            let b=shape(&[(off+2.,off+distance),(off+8.,off+distance),(off+8.,off+distance),(off+8.,off+4.)]);
            shared(&a,&b);shared(&b,&a);
        }
        for cosine in [min_angle,f64::from_bits(min_angle.to_bits()-1),f64::from_bits(min_angle.to_bits()+1)] {
            let sine=(1.-cosine*cosine).sqrt();
            let b=shape(&[(off+2.,off),(off+2.+cosine*10.,off+sine*10.),(off+2.,off+20.)]);
            shared(&a,&b);shared(&b,&a);
        }
    }
    for z in [0.0_f64, -0.0_f64] {
        let signed_zero=shape(&[(z,z),(10.,z),(10.,10.),(z,10.)]);
        shared(&signed_zero,&signed_zero);
        let negative_zero=shape(&[(-0.0,-0.0),(-0.0,10.),(10.,10.),(10.,-0.0)]);
        shared(&signed_zero,&negative_zero);shared(&negative_zero,&signed_zero);
    }
    let empty=shape(&[]);
    let point=shape(&[(0.,0.),(0.,0.),(0.,0.)]);
    assert_eq!(shared(&empty,&point).to_bits(),0_f64.to_bits());
    shared(&point,&point);
    // Pure comparisons commute also on nonfinite operands; no new acceptance rule.
    let nonfinite=shape(&[(f64::NAN,0.),(f64::INFINITY,0.),(0.,f64::NEG_INFINITY)]);
    shared(&point,&nonfinite);shared(&nonfinite,&point);
}
#[test]
fn shared_predicates_avoid_normalizing_far_edge_pairs_without_dropping_any_candidate() {
    let a=rectangle(0.,0.,10.,10.);
    let mut old_direction_checks=0_usize;
    let mut new_direction_checks=0_usize;
    for i in 0..4096 {
        let b=rectangle(100.+i as f64*3.,100.+i as f64*7.,2.,4.);
        assert_eq!(shared(&a,&b).to_bits(),0_f64.to_bits());
        for ai in 0..a.outer.len() {
            let p=a.outer[ai];let q=a.outer[(ai+1)%a.outer.len()];
            let dir=unit(sub(q,p));
            for &r in &b.outer {
                old_direction_checks+=1;
                let off=sub(r,p);
                if !((off.x*dir.y-off.y*dir.x).abs()>0.01) {new_direction_checks+=1;}
            }
        }
    }
    assert_eq!(old_direction_checks,65536);
    assert_eq!(new_direction_checks,0);
}

// Archived ORIGINAL function; name only differs. verify.py checks exact source.
fn legacy_shared(a: &Shape, b: &Shape) -> f64 {
    let mut len = 0.0;
    for i in 0..a.outer.len() {
        let p = a.outer[i];
        let q = a.outer[(i + 1) % a.outer.len()];
        let dir = unit(sub(q, p));
        let edge_len = length(sub(q, p));
        for j in 0..b.outer.len() {
            let r = b.outer[j];
            let s = b.outer[(j + 1) % b.outer.len()];
            if dot(dir, unit(sub(s, r))).abs() < 0.99999 {
                continue;
            }
            // Overlapping collinear edges may use different vertex splits.
            let off = sub(r, p);
            if (off.x * dir.y - off.y * dir.x).abs() > 0.01 {
                continue;
            }
            let u = dot(off, dir);
            let v = dot(sub(s, p), dir);
            len += (u.max(v).min(edge_len) - u.min(v).max(0.0)).max(0.0);
        }
    }
    len
}
