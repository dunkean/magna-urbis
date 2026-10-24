//! Exact old scalar implementation is a test-only oracle, not a second runtime solver.
use super::*;
fn fields(f:&Front)->(u64,u64,u64,u64,usize,usize,bool,bool){
 (f.a.x.to_bits(),f.a.y.to_bits(),f.b.x.to_bits(),f.b.y.to_bits(),f.rank,f.street,f.shared,f.gate)
}
pub(super) fn assert_legacy(shape:&Shape,fronts:&[Front],actual:&[Front]){
 let expected=legacy_contacts(shape,fronts);
 let first=actual.iter().zip(&expected).position(|(a,b)|fields(a)!=fields(b));
 assert!(actual.len()==expected.len()&&first.is_none(),"boundary contacts differ from old scalar implementation: lengths {} / {}, first differing front {:?}",actual.len(),expected.len(),first);
}
fn front(a:Point,b:Point,id:usize)->Front{Front{a,b,street:id,rank:id%4,shared:id%2==0,gate:id%3==0}}
fn rectangle(x:f64,y:f64)->Shape{Shape{outer:vec![Point{x,y},Point{x:x+10.,y},Point{x:x+10.,y:y+10.},Point{x,y:y+10.}],holes:vec![]}}
#[test]
fn holes_overlapping_fronts_and_metadata_keep_the_exact_scalar_order(){
 let mut shape=rectangle(0.,0.);shape.holes.push(vec![Point{x:2.,y:2.},Point{x:2.,y:4.},Point{x:4.,y:4.},Point{x:4.,y:2.}]);
 let mut fronts=vec![];
 for ring in std::iter::once(&shape.outer).chain(shape.holes.iter()){
  for i in 0..ring.len(){fronts.push(front(ring[i],ring[(i+1)%ring.len()],fronts.len()));}
 }
 // Equal-support duplicates intentionally preserve stable source precedence.
 fronts.insert(1,front(shape.outer[0],shape.outer[1],91));
 let actual=boundary_contacts(&shape,&fronts);assert!(!actual.is_empty());assert_legacy(&shape,&fronts,&actual);
 fronts.reverse();let reversed=boundary_contacts(&shape,&fronts);assert_legacy(&shape,&fronts,&reversed);
}
#[test]
fn exact_native_tolerances_reversed_zero_and_large_offset_fronts_stay_identical(){
 for offset in [0.,2000.,1.0e9]{
  let mut shape=rectangle(offset,offset);shape.outer.insert(2,shape.outer[1]);
  let threshold=0.025_f64;
  let mut fronts=vec![];
  for (i,normal)in [0.,threshold,f64::from_bits(threshold.to_bits()-1),f64::from_bits(threshold.to_bits()+1),-threshold].into_iter().enumerate(){
   fronts.push(front(Point{x:offset+1.,y:offset+normal},Point{x:offset+9.,y:offset+normal},i));
  }
  fronts.push(front(shape.outer[1],shape.outer[0],101));
  fronts.push(front(shape.outer[0],shape.outer[0],102));
  let actual=boundary_contacts(&shape,&fronts);assert_legacy(&shape,&fronts,&actual);
  assert!(!actual.iter().any(|f|f.street==101||f.street==102));
 }
}
#[test]
fn thousands_of_irrelevant_fronts_and_empty_rings_preserve_every_output_bit(){
 let shape=rectangle(0.,0.);let mut fronts=vec![front(shape.outer[0],shape.outer[1],0)];
 for i in 0..4096{let x=100.+i as f64*3.;fronts.push(front(Point{x,y:100.},Point{x:x+2.,y:100.},i+1));}
 let actual=boundary_contacts(&shape,&fronts);assert_eq!(actual.len(),1);assert_legacy(&shape,&fronts,&actual);
 let empty=Shape{outer:vec![],holes:vec![]};assert!(boundary_contacts(&empty,&fronts).is_empty());
 assert!(boundary_contacts(&shape,&[]).is_empty());
}

fn legacy_contacts(shape: &Shape, fronts: &[Front]) -> Vec<Front> {
    let mut result = Vec::new();
    for ring in std::iter::once(&shape.outer).chain(shape.holes.iter()) {
        let mut pieces = Vec::new();
        for (&a, &b) in ring
            .iter()
            .zip(ring.iter().cycle().skip(1))
            .take(ring.len())
        {
            let edge = sub(b, a);
            let len = length(edge);
            if len < 1e-7 {
                continue;
            }
            let axis = scale(edge, 1.0 / len);
            let mut spans = Vec::new();
            for f in fronts {
                if dot(unit(sub(f.b, f.a)), axis) < 1.0 - 1e-8
                    || dot(sub(f.a, a), normal(axis)).abs() > 0.025
                    || dot(sub(f.b, a), normal(axis)).abs() > 0.025
                {
                    continue;
                }
                let lo = dot(sub(f.a, a), axis).max(0.0);
                let hi = dot(sub(f.b, a), axis).min(len);
                if hi - lo > 1e-7 {
                    spans.push((lo, hi, *f));
                }
            }
            spans.sort_by(|a, b| a.0.total_cmp(&b.0));
            let mut end = 0.0_f64;
            for (lo, hi, f) in spans {
                let lo = lo.max(end);
                if hi - lo > 1e-7 {
                    pieces.push(Front {
                        a: add(a, scale(axis, lo)),
                        b: add(a, scale(axis, hi)),
                        ..f
                    });
                }
                end = end.max(hi);
            }
        }
        result.extend(merge(pieces));
    }
    result
}
