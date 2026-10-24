//! Synchronous immutable index lease; actual candidate queries, never parcel coverage claims.
use super::*;
use super::leaf_index::{LeafIndex,Kind};
use std::{cell::RefCell,marker::PhantomData,rc::Rc};
struct Active {index:Arc<LeafIndex>,allowed:BTreeMap<String,String>,report:ParentIndexQueryReport,fatal:Option<String>,candidate:Option<(String,Surface)>}
std::thread_local!{static CURRENT:RefCell<Option<Active>>=const{RefCell::new(None)};}
pub(super) struct Scope{_non_send:PhantomData<Rc<()>>}
impl Scope {
    pub fn enter(index:Arc<LeafIndex>,requests:&[PlacementRequest])->Result<Self,String>{CURRENT.with(|cell|{
        if cell.borrow().is_some(){return Err("Native prefix scope is non-reentrant".into());}
        *cell.borrow_mut()=Some(Active{index,allowed:requests.iter().map(|r|(r.id.clone(),r.id.clone())).collect(),report:ParentIndexQueryReport::default(),fatal:None,candidate:None});
        Ok(Self{_non_send:PhantomData})
    })}
    pub fn finish(&self)->Result<ParentIndexQueryReport,String>{CURRENT.with(|cell|{
        let b=cell.borrow();let s=b.as_ref().ok_or("Native prefix scope lost")?;
        match &s.fatal{Some(e)=>Err(e.clone()),None=>Ok(s.report.clone())}
    })}
}
impl Drop for Scope{fn drop(&mut self){CURRENT.with(|c|{c.borrow_mut().take();});}}
pub(crate) fn register_member(parent:&str,member:&str)->Result<(),String>{CURRENT.with(|cell|{
    let mut b=cell.borrow_mut();let Some(s)=b.as_mut()else{return Ok(())};
    if !s.allowed.get(parent).is_some_and(|p|p==parent)||s.allowed.contains_key(member){
        let e="Unexpected native prefix member ownership".to_string();s.fatal=Some(e.clone());return Err(e);
    }s.allowed.insert(member.into(),parent.into());Ok(())
})}
fn check(id:&str,land:&Surface,roof:Option<&Surface>,include_base:bool)->Result<(),String>{CURRENT.with(|cell|{
    let mut b=cell.borrow_mut();let Some(s)=b.as_mut()else{return Ok(())};
    if !s.allowed.contains_key(id){let e="Unexpected identity at exact native prefix query".to_string();s.fatal=Some(e.clone());return Err(e);}
    let complete;
    let land=if include_base&&s.candidate.as_ref().is_some_and(|(owner,_)|owner==id){
        complete=unite(&[s.candidate.as_ref().unwrap().1.clone(),land.clone()]);&complete
    }else{land};
    let result:Result<(),String>=(||{
        for kind in [Kind::Land,Kind::Roof]{let other=s.index.query_union(land,kind,&mut s.report)?;
            if area(&intersection(land,&other))>0.0001{return Err("Native candidate land intersects exact prior land/roof".into());}}
        if let Some(roof)=roof{let other=s.index.query_union(roof,Kind::Land,&mut s.report)?;
            if area(&intersection(roof,&other))>0.0001{return Err("Native candidate roof intersects exact prior land".into());}}
        Ok(())
    })();
    if let Err(e)=&result{if e.starts_with("[parent_session_budget]")||e.contains("Nonfinite"){s.fatal=Some(e.clone());}}
    result
})}
pub(crate) fn land_clear(id:&str,land:&Surface)->Result<(),String>{check(id,land,None,true)}
pub(crate) fn necessary_clear(id:&str,land:&Surface,roof:&Surface)->Result<(),String>{check(id,land,Some(roof),false)}
pub(crate) fn guard_building(b:&PlanBuilding)->Result<(),String>{
    if !CURRENT.with(|cell|cell.borrow().is_some()){return Ok(());}
    let mut parts=vec![b.footprint.clone(),b.courtyards.clone(),b.circulation.clone()];
    parts.extend(b.structural_features.iter().map(|f|f.surface.clone()));
    check(&b.id,&unite(&parts),Some(&b.roof_footprint),false)
}

pub(crate) struct CandidateScope{previous:Option<(String,Surface)>,active:bool,_non_send:PhantomData<Rc<()>>}
pub(crate) fn candidate_land(id:&str,parts:impl FnOnce()->Surface)->Result<CandidateScope,String>{
    if !CURRENT.with(|c|c.borrow().is_some()){return Ok(CandidateScope{previous:None,active:false,_non_send:PhantomData});}
    let land=parts();check(id,&land,None,false)?;
    let previous=CURRENT.with(|c|c.borrow_mut().as_mut().unwrap().candidate.replace((id.into(),land)));
    Ok(CandidateScope{previous,active:true,_non_send:PhantomData})
}
impl Drop for CandidateScope{fn drop(&mut self){if self.active{CURRENT.with(|c|{if let Some(s)=c.borrow_mut().as_mut(){s.candidate=self.previous.take();}});}}}
