//! Exact native prefix leaves: broad-phase grid, exact union narrow phase.
use super::*;
#[derive(Clone,Copy,Debug,PartialEq,Eq)]
pub(super) enum Kind {Land,Roof}
pub(super) struct Leaf {pub kind:Kind,pub owner:u64,pub surface:Surface,pub bounds:[f64;4],pub vertices:usize,pub accounted_bytes:usize}
pub(super) struct BatchLeaves {pub leaves:Vec<Leaf>,pub parents:usize,pub members:usize}
#[derive(Default)]
pub(super) struct LeafIndex {
    leaves:Vec<Leaf>,cells:BTreeMap<(i64,i64),Vec<usize>>,overflow:Vec<usize>,pub counts:ParentPrefixCounts,
}
pub(super) const MAX_QUERY_PARTS:usize=4096;
pub(super) const MAX_QUERY_VERTICES:usize=262144;
pub(super) const MAX_RETAINED_VERTICES:usize=32_000_000;
pub(super) const MAX_INDEX_REFERENCES:usize=8_000_000;
pub(super) const MAX_RETAINED_BYTES:usize=512*1024*1024;
fn fail(s:&str)->String{format!("[parent_session_budget] {s}; complete context refused, never truncated")}
fn keys(b:[f64;4])->Option<Vec<(i64,i64)>>{
    if !b.iter().all(|v|v.is_finite()){return None;}
    let b=b.map(|v|(v/64.).floor() as i64);
    let w=b[2] as i128-b[0] as i128+1;let h=b[3] as i128-b[1] as i128+1;
    if w<=0||h<=0||w>4096||h>4096||w*h>4096{return None;}
    Some((b[1]..=b[3]).flat_map(|y|(b[0]..=b[2]).map(move|x|(x,y))).collect())
}
fn overlaps(a:[f64;4],b:[f64;4])->bool{a[0]<=b[2]&&a[2]>=b[0]&&a[1]<=b[3]&&a[3]>=b[1]}
fn make_leaf(kind:Kind,owner:u64,surface:Surface)->Result<Option<Leaf>,String>{
    if surface.is_empty(){return Ok(None);}
    let b=bounds(&surface);if !b.iter().all(|v|v.is_finite()){return Err("Nonfinite native prefix bounds".into());}
    let vertices=surface.iter().map(|p|p.outer.len()+p.holes.iter().map(Vec::len).sum::<usize>()).sum::<usize>();
    // Explicit logical accounting, NOT Vec capacity, allocator or heap peak.
    let rings=surface.iter().map(|p|1+p.holes.len()).sum::<usize>();
    let accounted_bytes=vertices.saturating_mul(16).saturating_add(rings.saturating_mul(24))
        .saturating_add(surface.len().saturating_mul(48)).saturating_add(80);
    Ok(Some(Leaf{kind,owner,surface,bounds:b,vertices,accounted_bytes}))
}
impl BatchLeaves {
    pub fn from_batch(batch:&ParentPlanBatch,first_owner:u64)->Result<Self,String>{
        let mut leaves=vec![];let mut members=0;
        for(i,parent)in batch.parents.iter().enumerate(){
            members+=parent.plan.physical_members();let owner=first_owner.checked_add(i as u64).ok_or("Native leaf owner overflow")?;
            let(land,roofs)=parent.plan.occupation_parts();
            for(kind,parts)in [(Kind::Land,land),(Kind::Roof,roofs)]{for surface in parts{
                if let Some(leaf)=make_leaf(kind,owner,surface)?{leaves.push(leaf);}
            }}
        }Ok(Self{leaves,parents:batch.parents.len(),members})
    }
}
impl LeafIndex {
    pub fn preflight_append(&self,batch:&BatchLeaves)->Result<ParentPrefixCounts,String>{
        let mut c=self.counts.clone();c.parents=c.parents.saturating_add(batch.parents);c.members=c.members.saturating_add(batch.members);
        for leaf in &batch.leaves{
            c.leaves=c.leaves.saturating_add(1);c.vertices=c.vertices.saturating_add(leaf.vertices);
            let refs=keys(leaf.bounds).map_or(1,|k|k.len());c.index_references=c.index_references.saturating_add(refs);
            c.retained_index_bytes=c.retained_index_bytes.saturating_add(leaf.accounted_bytes).saturating_add(refs.saturating_mul(8));
        }
        if c.vertices>MAX_RETAINED_VERTICES||c.index_references>MAX_INDEX_REFERENCES||c.retained_index_bytes>MAX_RETAINED_BYTES{
            return Err(fail("Retained exact leaf index budget exceeded"));
        }Ok(c)
    }
    pub fn append(&mut self,batch:BatchLeaves)->Result<(),String>{
        let counts=self.preflight_append(&batch)?;
        for leaf in batch.leaves{
            let id=self.leaves.len();if let Some(keys)=keys(leaf.bounds){for key in keys{self.cells.entry(key).or_default().push(id);}}
            else{self.overflow.push(id);}self.leaves.push(leaf);
        }self.counts=counts;Ok(())
    }
    pub fn query_union(&self,geometry:&Surface,kind:Kind,report:&mut ParentIndexQueryReport)->Result<Surface,String>{
        if geometry.is_empty(){return Ok(vec![]);}
        let b=bounds(geometry);if !b.iter().all(|v|v.is_finite()){return Err("Nonfinite native candidate query".into());}
        report.queries+=1;match kind{Kind::Land=>report.land_queries+=1,Kind::Roof=>report.roof_queries+=1}
        // Stream broad-phase references; retain only <=4096 actual bbox hits,
        // never materialize/copy every prefix ID for a wide/dense query.
        let mut ids=BTreeSet::new();let(mut vertices,mut polygons)=(0usize,0usize);
        let mut consider=|id:usize|->Result<(),String>{
            let leaf=&self.leaves[id];if leaf.kind!=kind||!overlaps(leaf.bounds,b)||ids.contains(&id){return Ok(());}
            let nv=vertices.saturating_add(leaf.vertices);let np=polygons.saturating_add(leaf.surface.len());
            if ids.len()>=MAX_QUERY_PARTS||np>MAX_QUERY_PARTS||nv>MAX_QUERY_VERTICES{return Err(fail("Dense exact candidate query budget exceeded"));}
            vertices=nv;polygons=np;ids.insert(id);Ok(())
        };
        for &id in &self.overflow{consider(id)?;}
        if let Some(keys)=keys(b){for key in keys{if let Some(list)=self.cells.get(&key){for &id in list{consider(id)?;}}}}
        else{for id in 0..self.leaves.len(){consider(id)?;}}
        let parts=ids.into_iter().map(|id|{let leaf=&self.leaves[id];let _typed_prior_owner=leaf.owner;leaf.surface.clone()}).collect::<Vec<_>>();
        report.leaf_hits+=parts.len();report.max_query_parts=report.max_query_parts.max(parts.len()).max(polygons);
        report.max_query_vertices=report.max_query_vertices.max(vertices);
        if parts.is_empty(){Ok(vec![])}else{report.union_calls+=1;Ok(unite(&parts))}
    }
}
#[cfg(test)]
pub(super) fn test_leaf(kind:Kind,owner:u64,surface:Surface)->Leaf{make_leaf(kind,owner,surface).unwrap().unwrap()}
