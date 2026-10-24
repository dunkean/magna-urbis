//! Synchronous, non-reentrant admission scope for the opt-in city entry only.
//! No async work, unsafe, native archive, query, or parent graph is retained.
//! Future parallel planning must explicitly install/pass this context per worker.
use super::*;
use std::{cell::RefCell,marker::PhantomData,rc::Rc};
struct State {
    allowed:BTreeMap<String,(Vec<Surface>,OnceCell<Surface>)>,prior_land:Surface,prior_roofs:Surface,
    finalized:BTreeMap<String,(Surface,Surface)>,
    guarded:BTreeMap<String,BTreeSet<[u8;32]>>,
}
std::thread_local!{static CURRENT:RefCell<Option<State>>=const{RefCell::new(None)};}
pub(super) struct Scope { _non_send:PhantomData<Rc<()>> }
impl Scope {
    pub(super) fn enter(prior:&PriorOccupation,requests:&[PlacementRequest])->Result<Self,String>{
        CURRENT.with(|cell|{
            if cell.borrow().is_some(){return Err("Native parent planning context is non-reentrant".into());}
            let state=State{allowed:requests.iter().map(|r|(r.id.clone(),(r.neighbors.iter().map(|n|n.footprint.clone()).collect(),OnceCell::new()))).collect(),prior_land:unite(&prior.land_parts),prior_roofs:unite(&prior.roof_parts),
                finalized:BTreeMap::new(),guarded:BTreeMap::new()};
            *cell.borrow_mut()=Some(state);Ok(Self{_non_send:PhantomData})
        })
    }
}
impl Drop for Scope {fn drop(&mut self){CURRENT.with(|cell|{cell.borrow_mut().take();});}}
fn geometry_key(b:&PlanBuilding)->Result<[u8;32],String>{
    struct HashWriter(Sha256);impl std::io::Write for HashWriter{
        fn write(&mut self,b:&[u8])->std::io::Result<usize>{self.0.update(b);Ok(b.len())}
        fn flush(&mut self)->std::io::Result<()>{Ok(())}
    }
    let features=b.structural_features.iter().map(|f|&f.surface).collect::<Vec<_>>();
    let mut h=HashWriter(Sha256::new());
    serde_json::to_writer(&mut h,&(&b.footprint,&b.roof_footprint,&b.courtyards,&b.circulation,features))
        .map_err(|e|e.to_string())?;Ok(h.0.finalize().into())
}
fn check(state:&State,b:&PlanBuilding,land:&Surface)->Result<(),String>{
    if !state.allowed.contains_key(&b.id){return Err("Unexpected identity at native parent admission boundary".into());}
    let neighbors=&state.allowed[&b.id];
    let neighbors=neighbors.1.get_or_init(||unite(&neighbors.0));
    if area(&intersection(&b.roof_footprint,neighbors))>0.0001
        ||area(&intersection(land,&state.prior_roofs))>0.0001
        ||area(&intersection(&b.roof_footprint,&state.prior_land))>0.0001{
        return Err("Native parent admission: land intersects prior roof or roof intersects prior land".into());
    }
    for(id,(other_land,other_roof))in &state.finalized{
        if id==&b.id{continue;}
        if area(&intersection(land,other_roof))>0.0001
            ||area(&intersection(&b.roof_footprint,other_land))>0.0001{
            return Err("Native parent admission: land/roof intersects another finalized parent".into());
        }
    }Ok(())
}
/// Common ordinary admission and minimum witness admission call AFTER all real
/// paths/features exist. Rejection continues their existing bounded search.
pub(crate) fn admission_guard(b:&PlanBuilding)->Result<(),String>{
    super::super::parent_session::guard_building(b)?;
    CURRENT.with(|cell|{
        if cell.borrow().is_none(){return Ok(());}
        let land=unite(&land_parts(b));let key=geometry_key(b)?;
        let mut borrow=cell.borrow_mut();let state=borrow.as_mut().unwrap();
        check(state,b,&land)?;state.guarded.entry(b.id.clone()).or_default().insert(key);Ok(())
    })
}
/// Only the chosen final result updates reservation; successful trial candidates
/// discarded by ordinary selection never reserve any land/roof.
pub(crate) fn record_finalized(b:&PlanBuilding)->Result<(),String>{
    CURRENT.with(|cell|{
        if cell.borrow().is_none(){return Ok(());}
        let land=unite(&land_parts(b));let key=geometry_key(b)?;
        let mut borrow=cell.borrow_mut();let state=borrow.as_mut().unwrap();
        check(state,b,&land)?;
        if !state.guarded.get(&b.id).is_some_and(|set|set.contains(&key)){
            return Err("Final native parent geometry did not traverse the common admission guard".into());
        }
        state.finalized.insert(b.id.clone(),(land,b.roof_footprint.clone()));Ok(())
    })
}
pub(in crate::plans) fn prior_land()->Surface{CURRENT.with(|cell|cell.borrow().as_ref().map_or_else(Vec::new,|s|s.prior_land.clone()))}
#[cfg(test)]
pub(super) fn active()->bool{CURRENT.with(|c|c.borrow().is_some())}
