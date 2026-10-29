//! One bounded comparison when a nominal source ranking lost area on the site.
use super::*;
#[cfg(test)] std::thread_local! {static DISABLED:std::cell::Cell<bool>=const{std::cell::Cell::new(false)};}

pub(super) fn improve(r:&PlacementRequest, occupied:&Surface, old:PlanBuilding)->PlanBuilding {
    #[cfg(test)] if DISABLED.with(std::cell::Cell::get){return old;}
    use crate::programme::ProgrammeComposition;
    let Some(p)=&r.programme else{return old};
    let Some(target)=p.built_area_m2.filter(|v|v.is_finite()&&*v>0.) else{return old};
    if p.composition!=Some(ProgrammeComposition::Row)
        || !matches!(p.role.as_deref(),Some("dwelling.house"|"dwelling.tenement"))
        || r.typology.is_some() || !r.native_minimum_candidates.is_empty()
        || r.culture.mode!=HistoricalMode::HistoricalInspired || r.parcel_fit==Some(false) {return old;}
    let mut config=r.config.clone().unwrap_or_default();
    if config.recipe.is_some()||config.workshop.is_some()||config.overrides!=Overrides::default(){return old;}
    config.pack=r.culture.pack.clone();config.mode=r.culture.mode;config.seed=r.seed.clone();config.count=1;config.orientation_deg=0.;
    let query=StyleQuery{pack_id:Some(config.pack.clone()),
        tradition_id:crate::cultural_palettes::automatic_tradition(&r.culture,&config,false).map(str::to_owned),
        mode:config.mode,era:config.era.clone(),allow_late:config.allow_late,
        include_variants:config.variation>0.,..Default::default()};
    let Ok(index)=style_index() else{return old};
    let Ok(entries)=index.candidate_styles_for_programme(&query,&config,&r.seed,4,p) else{return old};
    let Some(position)=entries.iter().position(|e|e.recipe_id==old.recipe_id&&e.variant_id==old.variant_id) else{return old};
    let current=entries[position];
    let residential=|e:&crate::style_index::StyleEntry|matches!(e.role,crate::model::Role::Dwelling
        |crate::model::Role::CommunalDwelling|crate::model::Role::MixedResidential);
    if !residential(current){return old;}
    let Some([_,cap])=crate::style_index::residential_nominal_body_area(current,&config) else{return old};
    let actual=area(&old.footprint);
    // A source already attaining its nominal bound needs no extra construction.
    if actual>=target||actual>=cap-0.0001{return old;}
    // Earlier sources already failed in the initial pass. Never rebuild them.
    let Some(next)=entries.iter().skip(position+1).find(|e|residential(e)&&e.recipe_id!=old.recipe_id
        && p.rank(e,&config).1==p.rank(current,&config).1
        && crate::style_index::residential_nominal_body_area(e,&config)
            .is_some_and(|[lo,hi]|lo<=target&&hi<cap&&hi>actual+0.0001)) else{return old};
    let floor=p.preferred_floor(next,&config,&r.seed);
    let mut recovery=initial_terrain_recovery::Recovery::new(r,None,false);
    let mut attempted=false;
    // Keep the automatic placement rules. A source override narrows the existing
    // loop without pinning the request or recursively reopening source selection.
    let result=plan_one_initial_pass_selected(r,occupied,None,false,
        automatic_initial_programme_area(r,false,None),&mut attempted,None,&mut recovery,
        Some((next.recipe_id,next.variant_id,floor))).map(|initial|
            improve_domestic_budget_selection(r,occupied,initial,target,true).finalize(r,occupied));
    let mut selected=old;
    let status=match result {
        Ok(new) if (area(&new.footprint)/target).ln().abs()+1e-6<(actual/target).ln().abs()
            && new.volumes.iter().map(|v|v.levels.len()).max().unwrap_or(0)
                >=selected.volumes.iter().map(|v|v.levels.len()).max().unwrap_or(0)
            && new.resolved.has_retained_entrance()=>{
            selected=new;"admitted challenger closer to target"
        },
        Ok(_)=>"whole incumbent retained; challenger did not improve area with a retained native entry",
        Err(ref reason)=>{selected.diagnostics.push(format!("Placed source budget challenger {}: {reason}",next.recipe_id));"whole incumbent retained; challenger refused physical admission"},
    };
    selected.diagnostics.push(format!("Placed source budget comparison: 1/1 already-drawn challenger {}; {status}. Original target={target:.3}m2; incumbent body={actual:.3}m2. Challenger uses the existing 8-dimension/24-pose budget and final entry retention. No capacity inferred; all site guards unchanged.",next.recipe_id));
    selected
}

#[cfg(test)] mod tests {
    use super::*;
    struct Control(bool);
    impl Control {fn new()->Self{Self(DISABLED.with(|v|v.replace(true)))}}
    impl Drop for Control {fn drop(&mut self){DISABLED.with(|v|v.set(self.0));}}
    #[test] fn fixed_row128_compares_current_pipeline_without_repeating_refused_sources() {
        let input:PlanBatchRequest=serde_json::from_str(include_str!("../tests/fixtures/placed-budget-row128.json")).unwrap();
        let before={let _control=Control::new();plan_batch(input.clone()).unwrap()};
        let after=plan_batch(input.clone()).unwrap();
        for old in &before.buildings {
            let new=after.buildings.iter().find(|b|b.id==old.id).expect("keep every current admission");
            assert!(!old.resolved.has_retained_entrance()||new.resolved.has_retained_entrance(),"{} lost its native entry",old.id);
            let Some(target)=input.requests.iter().find(|r|r.id==old.id).unwrap().programme.as_ref().and_then(|p|p.built_area_m2) else{continue};
            assert!((area(&new.footprint)/target).ln().abs()<=(area(&old.footprint)/target).ln().abs()+1e-6,"{} regressed",old.id);
        }
        if let Some(dir)=std::env::var_os("HOUSES_PIPE_PROOF_DIR") {
            let dir=std::path::PathBuf::from(dir);std::fs::create_dir_all(&dir).unwrap();
            std::fs::write(dir.join("java128-control-plans.json"),serde_json::to_vec(&before).unwrap()).unwrap();
            std::fs::write(dir.join("java128-candidate-plans.json"),serde_json::to_vec(&after).unwrap()).unwrap();
        }
        eprintln!("fixed row128 current A/B: before={}/{}/{} after={}/{}/{}",before.buildings.len(),before.refusals.len(),before.open_spaces.len(),after.buildings.len(),after.refusals.len(),after.open_spaces.len());
    }
    #[test] fn constrained_a702_compares_placed_area_once() {
        let r:PlacementRequest=serde_json::from_str(include_str!("../tests/fixtures/placed-budget-a702.json")).unwrap();
        let old=plan_one_initial(&r,&vec![],None,false).unwrap();
        let new=plan_one_before_incumbent_growth(&r,&vec![],None,false).unwrap();
        eprintln!("a702 initial={} final={} source={} comparison={:?}",area(&old.footprint),area(&new.footprint),new.recipe_id,new.diagnostics.iter().filter(|d|d.starts_with("Placed source")).collect::<Vec<_>>());
        assert!(area(&new.footprint)>=82.5-0.0001);
        assert!(new.resolved.has_retained_entrance());
        for interiors in [false,true] {realize_plan(RealizePlanRequest{building:new.clone(),interiors}).unwrap();}
        assert_eq!(new.diagnostics.iter().filter(|d|d.starts_with("Placed source budget comparison:")).count(),1);
        assert_eq!(new.domestic_units,0);
        let mut pinned=r.clone();pinned.config.get_or_insert_default().recipe=Some(new.recipe_id.clone());
        let before=new;
        let unchanged=improve(&pinned,&vec![],before.clone());
        assert_eq!(serde_json::to_vec(&before).unwrap(),serde_json::to_vec(&unchanged).unwrap());
    }
}
