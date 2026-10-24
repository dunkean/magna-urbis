//! Exact point predicate acceleration, local to one immutable pose search.
//! Bins retain original edge order and the original even/odd expression.
use super::{geometry, Point, Shape, Witness};
use serde::Serialize;
#[cfg(not(target_arch = "wasm32"))]
use std::time::Instant;
const ROWS: usize = 64;
struct RingIndex { low: f64, span: f64, rows: Vec<Vec<(Point,Point)>> }
impl RingIndex {
    fn row(&self, y: f64) -> usize { (((y-self.low)/self.span*ROWS as f64).floor() as usize).min(ROWS-1) }
    fn new(ring: &[Point]) -> Option<Self> {
        if ring.iter().any(|p| !p.x.is_finite() || !p.y.is_finite()) { return None; }
        let low=ring.iter().map(|p|p.y).fold(f64::INFINITY,f64::min);
        let high=ring.iter().map(|p|p.y).fold(f64::NEG_INFINITY,f64::max);
        let span=high-low; if !span.is_finite() || span<=0. { return None; }
        let mut index=Self {low,span,rows:vec![vec![];ROWS]};
        for (&a,&b) in ring.iter().zip(ring.iter().cycle().skip(1)).take(ring.len()) {
            if a.y==b.y { continue; } // original crossing predicate is always false
            let (lo,hi)=(index.row(a.y.min(b.y)),index.row(a.y.max(b.y)));
            for row in lo..=hi { index.rows[row].push((a,b)); }
        }
        Some(index)
    }
    fn contains(&self,p:Point,trace:&mut Option<Trace>) -> bool {
        let mut inside=false;
        for &(a,b) in &self.rows[self.row(p.y)] {
            count(trace,|c|c.indexed_point_edges+=1);
            if (a.y>p.y)!=(b.y>p.y) && p.x<(b.x-a.x)*(p.y-a.y)/(b.y-a.y)+a.x { inside=!inside; }
        }
        inside
    }
}
pub(super) struct PointIndex<'a> { shape:&'a Shape, outer:RingIndex, holes:Vec<RingIndex> }
impl<'a> PointIndex<'a> {
    pub(super) fn new(shape:&'a Shape) -> Option<Self> {
        let outer=RingIndex::new(&shape.outer)?;
        let holes=shape.holes.iter().map(|h|RingIndex::new(h)).collect::<Option<Vec<_>>>()?;
        Some(Self {shape,outer,holes})
    }
    pub(super) fn contains(&self,p:Point,trace:&mut Option<Trace>) -> bool {
        // Preserve the exact original fallback for nonfinite query points.
        if !p.x.is_finite() || !p.y.is_finite() { return geometry::contains(self.shape,p); }
        self.outer.contains(p,trace) && !self.holes.iter().any(|h|h.contains(p,trace))
    }
}
#[derive(Default,Serialize)]
pub(super) struct Counters {
    pub index_build_ns:u64,pub index_stored_edges:u64,
    pub directions:u64,pub fitting_directions:u64,pub positions:u64,pub point_tests:u64,
    pub outside_center:u64,pub indexed_point_edges:u64,pub boundary_tests:u64,
    pub boundary_edges:u64,pub contained:u64,pub height_samples:u64,
}
#[derive(Serialize)]
struct Data {
    style_id:String,recipe_id:String,vertices:usize,holes:usize,bbox:[f64;4],
    footing:Option<[f64;2]>,indexed:bool,elapsed_ns:u64,bound:Option<f64>,bound_infinite:bool,counters:Counters,
}
pub(super) struct Trace {
    #[cfg(not(target_arch = "wasm32"))]
    started:Instant,
    data:Data,
}
impl Trace {
    // Host profiling is unavailable on wasm32; absence is not a zero duration.
    #[cfg(target_arch = "wasm32")]
    pub(super) fn new(_shape:&Shape,_w:&Witness,_indexed:bool) -> Option<Self> { None }
    #[cfg(not(target_arch = "wasm32"))]
    pub(super) fn new(shape:&Shape,w:&Witness,indexed:bool) -> Option<Self> {
        std::env::var("URBAN_FOUNDATION_PROFILE").is_ok().then(|| {
            let (x0,y0,x1,y1)=geometry::bbox(shape);
            Self { started:Instant::now(),data:Data { style_id:w.style_id.clone(),recipe_id:w.recipe_id.clone(),vertices:shape.outer.len()+shape.holes.iter().map(Vec::len).sum::<usize>(),holes:shape.holes.len(),bbox:[x0,y0,x1,y1],footing:w.footing(),indexed,elapsed_ns:0,bound:None,bound_infinite:false,counters:Default::default() } }
        })
    }
}
#[inline]
pub(super) fn count(trace:&mut Option<Trace>,f:impl FnOnce(&mut Counters)) { if let Some(t)=trace { f(&mut t.data.counters); } }
pub(super) fn finish(trace:Option<Trace>,bound:f64) -> f64 {
    if let Some(mut trace)=trace {
        #[cfg(not(target_arch = "wasm32"))]
        { trace.data.elapsed_ns=trace.started.elapsed().as_nanos().min(u64::MAX as u128) as u64; }
        trace.data.bound=bound.is_finite().then_some(bound);trace.data.bound_infinite=bound.is_infinite();
        if let Ok(json)=serde_json::to_string(&trace.data) { eprintln!("FOUNDATION_POSE_PROFILE {json}"); }
    }
    bound
}

pub(super) fn indexed(trace:&mut Option<Trace>,value:bool) { if let Some(t)=trace { t.data.indexed=value; } }

pub(super) fn build_index<'a>(shape:&'a Shape,trace:&mut Option<Trace>) -> Option<PointIndex<'a>> {
    #[cfg(not(target_arch = "wasm32"))]
    let started=trace.as_ref().map(|_|Instant::now());
    let index=PointIndex::new(shape);
    #[cfg(not(target_arch = "wasm32"))]
    if let Some(started)=started {
        let elapsed=started.elapsed().as_nanos().min(u64::MAX as u128) as u64;
        let edges=index.as_ref().map_or(0,|i|i.outer.rows.iter().map(Vec::len).sum::<usize>()+i.holes.iter().flat_map(|h|h.rows.iter()).map(Vec::len).sum::<usize>());
        count(trace,|c|{c.index_build_ns+=elapsed;c.index_stored_edges+=edges as u64;});
    }
    index
}
