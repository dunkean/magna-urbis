//! Programme geometry for funerary land and monuments. Role ids, never culture
//! names, select low graves, mausoleums and broken walls in both city views.
use crate::urban::{Point, Shape, geometry as g};
use serde_json::{Value, json};

fn rect(c: Point, u: Point, x: f64, y: f64, w: f64, d: f64) -> Shape {
    Shape { outer: [(-w/2., -d/2.), (w/2., -d/2.), (w/2., d/2.), (-w/2., d/2.)]
        .map(|(s,t)| Point { x:c.x+u.x*(x+s)-u.y*(y+t), y:c.y+u.y*(x+s)+u.x*(y+t) }).to_vec(), holes:vec![] }
}
fn inside(lot: &Shape, s: &Shape) -> bool {
    s.outer.iter().zip(s.outer.iter().cycle().skip(1)).take(s.outer.len())
        .all(|(a,b)| g::segment_within(lot,*a,*b))
        && !lot.holes.iter().any(|h| h.iter().any(|p| g::contains(s,*p)))
}
fn piece(h: f64, rise: f64, roof: &str, tone: f64) -> Value {
    json!({"floors":1,"eave_m":h,"rise_m":rise,"roof":roof,"ridges":[],"cover":"stone","wall":"stone","tone":tone,"openings":if h<2. {"none"} else {"door"}})
}

/// Whether `apply` leaves this lot a silhouette: `None` when the role is not
/// funerary (the request keeps its own preview). Mirrors `apply` for
/// `previewed_parcels`.
pub(super) fn shown(role: &str, seed: &str, lot: &Shape, axis: Point) -> Option<bool> {
    if !matches!(role,"open.cemetery"|"open.necropolis") && !role.starts_with("funerary.mausoleum") { return None; }
    let mut request=json!({"programme":{"role":role},"seed":seed,"preview":[]});
    apply(&mut request,lot,axis);
    Some(request["preview"].as_array().is_some_and(|p| !p.is_empty()))
}

pub(super) fn apply(request: &mut Value, lot: &Shape, axis: Point) {
    let role = request["programme"]["role"].as_str().unwrap_or("");
    let field = matches!(role,"open.cemetery"|"open.necropolis");
    let mausoleum = role.starts_with("funerary.mausoleum");
    // Other ruins already stand as broken walls (occupation.rs `ruined`).
    let ruin = mausoleum && role.ends_with(".ruin");
    if !field && !mausoleum { return; }
    let len=axis.x.hypot(axis.y);
    let u=if len>1e-6 {Point{x:axis.x/len,y:axis.y/len}} else {Point{x:1.,y:0.}};
    let c=g::interior_point(lot);
    let mut previews:Vec<Shape>=Vec::new(); let mut massing:Vec<Value>=Vec::new();
    if field {
        let (mut x0,mut x1,mut y0,mut y1)=(f64::INFINITY,f64::NEG_INFINITY,f64::INFINITY,f64::NEG_INFINITY);
        for p in &lot.outer { let (x,y)=((p.x-c.x)*u.x+(p.y-c.y)*u.y,-(p.x-c.x)*u.y+(p.y-c.y)*u.x);
            x0=x0.min(x); x1=x1.max(x); y0=y0.min(y); y1=y1.max(y); }
        // Bound both mesh count and candidate work, even on a huge cemetery.
        let spacing=((x1-x0)*(y1-y0)/96.).sqrt().max(4.5);
        let mut row=0; let mut y=y0+spacing*0.5;
        while y<y1 && previews.len()<96 {
            let mut x=x0+spacing*0.5;
            while x<x1 && previews.len()<96 {
                // One central aisle, with burial rows on either side.
                if x.abs()>1.5 {
                    let s=rect(c,u,x,y,1.35,2.3);
                    if inside(lot,&s) { previews.push(s); massing.push(piece(0.45+0.15*((row%3) as f64),0.,"flat",0.35+0.1*((row%4) as f64))); }
                }
                x+=spacing;
            }
            row+=1; y+=spacing;
        }
    } else if mausoleum {
        // Shrink a central chamber until its complete outline fits the lot.
        let mut w=12.; let mut d=16.;
        for _ in 0..14 {
            let s=rect(c,u,0.,0.,w,d);
            if inside(lot,&s) { previews.push(s); break; }
            w*=0.82; d*=0.82;
        }
        if !previews.is_empty() { massing.push(piece(4.2,1.6,"pyramid",0.55)); }
    }
    let mut labels=vec![if field {"tomb"} else {"mausoleum"};previews.len()];
    if ruin && !previews.is_empty() {
        // The chamber falls as every ruin does (parcels/ruins.rs).
        let mut rng=crate::rng::Rng::new(request["seed"].as_str().unwrap_or("")).fork("mausoleum-ruin");
        let (mut parts,mut budget)=(vec![],crate::urban::parcels::ruins::RUIN_BUDGET);
        for s in std::mem::take(&mut previews) { crate::urban::parcels::ruins::broken_walls(&s.outer,None,0.2,(0.5,1.0),&mut rng,&mut budget,&mut parts); }
        parts.retain(|(s,_)| inside(lot,s));
        massing=parts.iter().map(|(_,l)| crate::urban::massing::ruin_piece(l,4.2,"stone",0.55,&mut rng)).collect();
        labels=parts.iter().map(|(_,l)| *l).collect();
        previews=parts.into_iter().map(|(s,_)| s).collect();
    }
    if previews.is_empty() { request["function"]=json!("open_space"); }
    request["preview_parts"]=json!(labels);
    request["programme"]["built_area_m2"]=json!(previews.iter().map(g::area).sum::<f64>());
    request["preview"]=json!(previews);
    request["programme"]["massing"]=json!(massing);
    request["programme"]["composition"]=json!("compound");
    request["programme"]["frontage_continuity"]=json!(0.);
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn funerary_roles_keep_their_geometry_and_scale() {
        for pop in [500,10000] {
            let needs=crate::urban::roles::services("necropolis",pop);
            for role in ["open.necropolis","funerary.mausoleum","funerary.mausoleum.ruin"] {
                assert!(needs.iter().any(|n|n.entry.role==role),"{pop}: {role}");
            }
        }
        let mut lot=g::rectangle(0.,0.,70.,90.);
        lot.holes.push(g::rectangle(20.,20.,30.,40.).outer);
        for role in ["open.necropolis","funerary.mausoleum","funerary.mausoleum.ruin"] {
            let mut req=json!({"programme":{"role":role},"preview":[]});
            apply(&mut req,&lot,Point{x:1.,y:0.});
            let shapes:Vec<Shape>=serde_json::from_value(req["preview"].clone()).unwrap();
            assert!(!shapes.is_empty(),"{role}"); assert!(shapes.len()<=96);
            assert!(shapes.iter().all(|s|inside(&lot,s)));
            assert_eq!(shapes.len(),req["programme"]["massing"].as_array().unwrap().len());
            if role.ends_with(".ruin") {assert!(shapes.len()>1);}
            if role=="open.necropolis" {assert!(shapes.len()>20);}
            let again=req.clone(); apply(&mut req,&lot,Point{x:1.,y:0.}); assert_eq!(again,req);
        }
    }
}
