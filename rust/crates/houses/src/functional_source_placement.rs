//! Bounded rigid admission of an exhausted registered functional source.
//! Source geometry and the requested footprint stay frozen throughout.
use super::*;

pub(super) fn place(r:&PlacementRequest,prepared:&PreparedPlan<'_>,domain:&Surface,occupied:&Surface)
    -> Result<PlanBuilding,String> {
    let b=bounds(&prepared.plan_local);
    let mut axes=Vec::<f64>::new();
    for access in r.accesses.iter().filter(|a|a.width_m>=0.8) {
        let angle=libm::atan2(access.segment[1].y-access.segment[0].y,
            access.segment[1].x-access.segment[0].x).to_degrees().rem_euclid(180.);
        if axes.iter().any(|a|(a-angle).abs()<0.001) { continue; }
        axes.push(angle); if axes.len()==4 { break; }
    }
    let fractions=[0.5,0.25,0.75,0.375,0.625,0.125,0.875,0.,1.];
    let mut best:Option<(f64,Transform,[f64;2])>=None;
    let mut attempts=0;
    let mut errors=std::collections::BTreeSet::new();
    for angle in axes { for orientation_deg in [angle,angle+180.] {
        let local=bounds(&map_surface(domain,&Transform{origin:point(0.,0.),orientation_deg:-orientation_deg}));
        let room=[local[2]-local[0]-(b[2]-b[0]),local[3]-local[1]-(b[3]-b[1])];
        if room.iter().any(|v|*v<0.) { continue; }
        for fy in fractions { for fx in fractions {
            let frame=Transform{origin:point(0.,0.),orientation_deg};
            let offset=point(local[0]+room[0]*fx-b[0],local[1]+room[1]*fy-b[1]);
            let transform=Transform{origin:transform_point(offset,&frame),orientation_deg};
            let mut failure=None;attempts+=1;
            match visual_with_front_access_prepared_reported(r,prepared,transform.clone(),occupied,
                false,true,None,false,Some(&mut failure)) {
                Ok(mut building)=>{annotate(&mut building,attempts);return Ok(building);}
                Err(reason)=>{if errors.len()<4 {errors.insert(reason);}}
            }
            if let Some(f)=failure {
                let step=f.high-f.low;
                if best.as_ref().is_none_or(|b|step<b.0) {best=Some((step,transform,room));}
            }
        } }
    } }
    // Refine the best actually measured foundation failure, never its limit.
    // Maximum 648 coarse + 25 refined admissions, one native source draw.
    if let Some((_,centre,room))=&best {
        for y in [-2.,-1.,0.,1.,2.] {for x in [-2.,-1.,0.,1.,2.] {
            let transform=Transform{origin:transform_point(point(x*room[0]/32.,y*room[1]/32.),centre),
                orientation_deg:centre.orientation_deg};
            attempts+=1;
            match visual_with_front_access_prepared_reported(r,prepared,transform,occupied,
                false,true,None,false,None) {
                Ok(mut building)=>{annotate(&mut building,attempts);return Ok(building);}
                Err(reason)=>{if errors.len()<4 {errors.insert(reason);}}
            }
        }}
    }
    Err(format!("Registered functional rigid admission exhausted {attempts}/673 poses; best measured foundation step {:?} m (limit unchanged {} m). {}",
        best.map(|b|b.0),r.terrain.max_foundation_step_m,errors.into_iter().collect::<Vec<_>>().join(" ")))
}
fn annotate(building:&mut PlanBuilding,attempts:usize) {
    building.diagnostics.push(format!("Registered functional source: {attempts}/673 bounded rigid access-axis poses; one retained source draw, unchanged target, native bearing, terrain, roof and access checks."));
}
