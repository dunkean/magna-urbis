//! Exact archived requests and rasters, prepared by examples/camps_pnw_fixtures.py.
use super::*;
use serde::Deserialize;
use serde_json::json;

#[derive(Deserialize)]
#[serde(rename_all="camelCase")]
struct Fixture { seed:String,n:usize,width:f64,height:Vec<f32>,water:Vec<u8>,water_level:Vec<f32>,sites:Vec<Site>,roads:Vec<Street>,layout_config:LayoutConfig }

#[test]
#[ignore = "Requires the five archived decor rasters; run examples/camps_pnw_fixtures.py first"]
fn exact_archived_camp_requests_keep_needs_and_regional_access() {
    use geo::Validation;
    let root=std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../..");
    let fixtures=root.join(".tmp/camps-pnw/fixtures");
    let out=root.join(".tmp/camps-pnw/current");std::fs::create_dir_all(&out).unwrap();
    let mut failures=vec![];
    for id in ["P01","P03","P05","P06","P07"] {
        let input=std::fs::read(fixtures.join(format!("{id}.json"))).unwrap();
        let f:Fixture=serde_json::from_slice(&input).unwrap();
        let config=serde_json::to_vec(&f.layout_config).unwrap();
        let roads=serde_json::to_vec(&f.roads).unwrap();
        let surface=Surface{geometry:None,width:f.width,n:f.n,height:&f.height,water:&f.water};
        let tick=std::time::Instant::now();
        let layouts=super::super::generate_quarters(&f.seed,&f.sites,&f.layout_config,surface,&f.roads).unwrap();
        let parts=super::super::generate_parcels(&f.seed,&layouts,&Default::default()).unwrap();
        let selected=(0..layouts.len()).collect::<Vec<_>>();
        let mut index=super::super::building_sites::BuildingSiteIndex::prepare(&layouts,&parts,&selected).unwrap();let mut requests=vec![];
        loop {let page=index.page(&f.seed,&layouts,&parts,surface,&f.water_level,None,requests.len(),64,24*1024*1024).unwrap();let total=page.total;assert!(!page.requests.is_empty()||requests.len()==total);requests.extend(page.requests);if requests.len()==total{break;}}
        let l=&layouts[0];let p=&parts[0];let pr=p.programme.as_ref().unwrap();
        let before:Layout=serde_json::from_slice(&std::fs::read(root.join(format!("web/out/tribes/data-after/{id}/layout.json"))).unwrap()).unwrap();
        // Capture the original JSON's nearest IEEE values, as the PNW proof
        // does. Default serde_json parsing can shift historical decimals 1 ulp.
        let original:serde_json::Value=serde_json::from_slice(include_bytes!("fixtures/camp-original-needs-bits.json")).unwrap();
        for d in original[id].as_array().unwrap() {
            let n=pr.demands.iter().find(|n|n.id==d["id"].as_str().unwrap()).expect("Original demand ID");
            assert_eq!((n.function.as_str(),n.role.as_str(),n.unit.as_str()),(d["function"].as_str().unwrap(),d["role"].as_str().unwrap(),d["unit"].as_str().unwrap()));
            let bits=|key:&str|u64::from_str_radix(d[key].as_str().unwrap(),16).unwrap();
            assert_eq!((n.requested.to_bits(),n.target_area.to_bits(),n.target_frontage.to_bits()),(bits("requestedBits"),bits("targetAreaBits"),bits("targetFrontageBits")),"{id} {} need changed",n.id);
        }
        let invalid=p.parcels.iter().filter(|p|!g::polygon(&p.shape).is_valid()).map(|p|p.id.clone()).collect::<Vec<_>>();
        let mut entries=0;let mut missing_entries=vec![];
        for road in f.roads.iter().filter(|s|s.role=="regional") {
            for q in &l.quarters {for clipped in macroplan::clip(road,&q.shape) {
                if !routing::path_clear(surface,&clipped.path,f.layout_config.max_street_grade) {continue;}
                for &entry in [clipped.path.first().unwrap(),clipped.path.last().unwrap()] {
                    if !q.shape.outer.iter().zip(q.shape.outer.iter().cycle().skip(1)).any(|(&a,&b)|g::distance(entry,a,b).0<0.1) {continue;}
                    entries+=1;
                    if !l.streets.iter().any(|s|s.path.windows(2).enumerate().any(|(i,w)|g::distance(entry,w[0],w[1]).0<=s.widths[i].max(s.widths[i+1])*0.5+0.1)) {missing_entries.push(entry);}
                }
            }}
        }
        let report=json!({"case":id,"kind":l.archetype,"quarters":l.quarters.len(),"blocks":l.blocks.len(),"lots":p.parcels.len(),"requests":requests.len(),"regionalEntriesChecked":entries,"elapsedSeconds":tick.elapsed().as_secs_f64(),"invalid":invalid,"needs":pr.demands,"streets":l.streets,"capacity":l.structure.as_ref().map(|s|&s.metrics.capacity),"baselineKind":before.archetype,"baselineLotsSource":"web/out/tribes/data-after; historical capture, not a fresh build"});
        let dir=out.join(id);std::fs::create_dir_all(&dir).unwrap();
        for(name,v)in[("layouts.json",serde_json::to_value(&layouts).unwrap()),("partitions.json",serde_json::to_value(&parts).unwrap()),("requests.json",json!(requests)),("report.json",report)] {std::fs::write(dir.join(name),serde_json::to_vec(&v).unwrap()).unwrap();}
        let bb=p.parcels.iter().map(|p|g::bbox(&p.shape)).fold((f.width,f.width,0_f64,0_f64),|b,s|(b.0.min(s.0),b.1.min(s.1),b.2.max(s.2),b.3.max(s.3)));
        let mut svg=format!("<svg xmlns='http://www.w3.org/2000/svg' viewBox='{} {} {} {}'>",bb.0-20.,bb.1-20.,bb.2-bb.0+40.,bb.3-bb.1+40.);
        for parcel in &p.parcels {let color=match parcel.use_kind.as_str(){"plot"|"compound"=>"#c4a473","court"=>"#f8ecd2","place"=>"#dfcf9d",_=>"#c7ce9f"};svg.push_str(&format!("<path d='{}' fill='{color}' fill-rule='evenodd' stroke='#726b52' stroke-width='0.5'/>",std::iter::once(&parcel.shape.outer).chain(&parcel.shape.holes).map(|r|format!("M{}Z",r.iter().map(|p|format!("{},{}",p.x,p.y)).collect::<Vec<_>>().join("L"))).collect::<String>()));}
        for s in &l.streets {svg.push_str(&format!("<polyline points='{}' fill='none' stroke='#a65b37' stroke-width='{}'/>",s.path.iter().map(|p|format!("{},{}",p.x,p.y)).collect::<Vec<_>>().join(" "),s.widths.first().unwrap_or(&2.)));}svg.push_str("</svg>");std::fs::write(dir.join("layout.svg"),svg).unwrap();
        eprintln!("CAMP_EXACT {id} kind={} quarters={} blocks={} lots={} requests={} invalid={} seconds={:.2}",l.archetype,l.quarters.len(),l.blocks.len(),p.parcels.len(),index.total(),invalid.len(),tick.elapsed().as_secs_f64());
        if l.archetype!="camp"||l.quarters.is_empty()||l.blocks.is_empty(){failures.push(format!("{id}: missing camp land"));}
        if entries==0{failures.push(format!("{id}: no real incoming regional access exercised"));}
        if !missing_entries.is_empty(){failures.push(format!("{id}: incoming road loses its real entrance at {missing_entries:?}"));}
        if l.streets.is_empty(){failures.push(format!("{id}: regional access lost"));}
        if pr.allocations.iter().any(|a|matches!(a.function.as_str(),"warehouse"|"collective"|"workshop")){failures.push(format!("{id}: unsourced urban facility"));}
        if !invalid.is_empty(){failures.push(format!("{id}: invalid geometry {invalid:?}"));}
        assert_eq!(config,serde_json::to_vec(&f.layout_config).unwrap());assert_eq!(roads,serde_json::to_vec(&f.roads).unwrap());
    }
    assert!(failures.is_empty(),"{}",failures.join("\n"));
}
