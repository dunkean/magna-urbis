use super::*;
use serde::Deserialize;
use serde_json::json;

#[derive(Deserialize)]
struct RecordedCase {
    id:String,culture:String,population:u32,center:Point,config:LayoutConfig,
    #[serde(rename="expectedKindAfter")] after:String,
}
fn cases()->Vec<RecordedCase>{serde_json::from_slice(include_bytes!("fixtures/camp-kind-mapping-cases.json")).unwrap()}
fn site(culture:&str,population:u32)->Site{Site{key:"camp-mapping".into(),name:String::new(),culture:culture.into(),population,center:Point{x:2000.,y:2000.},radius:200.}}
fn crossing(center:Point)->Vec<Street>{vec![Street{path:vec![Point{x:center.x-1000.,y:center.y},Point{x:center.x+1000.,y:center.y}],widths:vec![6.,6.],rank:0,role:"regional".into()}]}

#[test]
fn camp_mapping_actual_metadata_cases_are_radius_and_road_independent_at_this_boundary(){
    for c in cases(){
        for radius in [1.,200.,25000.]{
            let mut s=site(&c.culture,c.population);s.key=c.id.clone();s.center=c.center;s.radius=radius;
            assert_eq!(resolve(&s,&c.config,&[]).id(),c.after,"{} no roads",c.id);
            assert_eq!(resolve(&s,&c.config,&crossing(s.center)).id(),c.after,"{} crossing road",c.id);
        }
    }
}

#[test]
fn camp_mapping_native_property_and_legacy_nomad_are_data_driven(){
    let cfg=LayoutConfig::default();let mut declared=0;
    for (culture,entry) in super::super::catalogue()["cultures"].as_object().unwrap(){
        let native=&super::super::catalogue()["presets"][format!("{culture}/core")]["params"]["campLayout"];
        if native.as_str().is_some_and(|v|!v.is_empty()){
            declared+=1;assert_eq!(resolve(&site(culture,300),&cfg,&[]),Kind::Camp,"{culture}");
            assert!(entry.is_object());
        }
    }
    assert!(declared>0);
    assert_eq!(super::super::catalogue()["cultures"]["nomad-camp"]["camp"]["layout"],"ring");
    assert_eq!(resolve(&site("nomad-camp",300),&cfg,&[]),Kind::Camp);
    assert!(!cultural_camp("inuit-camp",80,&cfg),"organic winter camp has no native campLayout");
    assert_eq!(resolve(&site("inuit-camp",80),&cfg,&[]),Kind::Hamlet,"remaining separate organic small-settlement issue");
}

#[test]
fn camp_mapping_tiny_ruin_farmstead_and_explicit_camp_precedence_is_unambiguous(){
    for culture in ["kraal","native-plains","nomad-camp","guarani-village"]{
        for population in [0,8,12]{
            let s=site(culture,population);let cfg=LayoutConfig::default();
            assert_eq!(resolve(&s,&cfg,&[]),Kind::Farmstead);
            let mut ruined=cfg.clone();ruined.programme.state="ruined".into();assert_eq!(resolve(&s,&ruined,&[]),Kind::Ruin);
            for mut explicit in [cfg,ruined]{explicit.settlement_form="camp".into();assert_eq!(resolve(&s,&explicit,&[]),Kind::Camp);}
        }
        assert_eq!(resolve(&site(culture,13),&LayoutConfig::default(),&[]),Kind::Camp);
    }
}

#[test]
fn camp_mapping_explicit_types_isolated_intent_and_legacy_village_preferences_win(){
    let s=site("kraal",300);
    for kind in ALL{
        let mut c=LayoutConfig::default();c.settlement_form=kind.id().into();c.programme.role="isolated-mill".into();
        assert_eq!(resolve(&s,&c,&[]),kind);
    }
    for role in ["isolated-mill","isolated-inn","isolated-tower","isolated-shrine","roadside-temple"]{
        let mut c=LayoutConfig::default();c.programme.role=role.into();assert_eq!(resolve(&s,&c,&[]),Kind::Single);
        c.programme.state="ruined".into();assert_eq!(resolve(&s,&c,&[]),Kind::Ruin);
    }
    let mut c=LayoutConfig::default();c.programme.role="isolated-farm".into();assert_eq!(resolve(&s,&c,&[]),Kind::Farmstead);
    c.programme.role="auto".into();c.settlement_form="ribbon".into();assert_eq!(resolve(&s,&c,&[]),Kind::StreetVillage);
    c.settlement_form="nucleated".into();assert_eq!(resolve(&s,&c,&[]),Kind::NucleatedVillage);
}

#[test]
fn camp_mapping_actual_preset_culture_override_and_native_growth_transition_are_respected(){
    let mut c=LayoutConfig::default();c.culture="kraal".into();assert_eq!(resolve(&site("european-organic",300),&c,&[]),Kind::Camp);
    c.culture="european-organic".into();assert_ne!(resolve(&site("kraal",300),&c,&[]),Kind::Camp);
    c=LayoutConfig::default();c.preset="native-iroquoian/core".into();assert_eq!(resolve(&site("european-organic",300),&c,&[]),Kind::Camp);
    c.preset="european-organic/core".into();assert_ne!(resolve(&site("kraal",300),&c,&[]),Kind::Camp);
    c=LayoutConfig::default();c.recipe="grown-core".into();assert_ne!(resolve(&site("kraal",300),&c,&[]),Kind::Camp);
    c=LayoutConfig::default();assert_eq!(resolve(&site("kraal",2999),&c,&[]),Kind::Camp);assert_eq!(resolve(&site("kraal",3000),&c,&[]),Kind::WalledTown);
    assert_eq!(resolve(&site("native-plains",4499),&c,&[]),Kind::Camp);assert_eq!(resolve(&site("native-plains",4500),&c,&[]),Kind::MarketTown);
    assert_eq!(resolve(&site("native-iroquoian",3499),&c,&[]),Kind::Camp);assert_eq!(resolve(&site("native-iroquoian",3500),&c,&[]),Kind::WalledTown);
    for culture in ["kraal","native-plains","nomad-camp","mongol-ordu","guarani-village"]{
        for population in [5000,30000,200000,1000000]{assert_ne!(resolve(&site(culture,population),&c,&[]),Kind::Camp);}
    }
}

#[test]
fn camp_mapping_canonical_noncamp_thresholds_and_programme_functions_stay_intact(){
    let cfg=LayoutConfig::default();
    for (population,expected) in [(12,Kind::Farmstead),(13,Kind::Hamlet),(149,Kind::Hamlet),(150,Kind::NucleatedVillage),(1199,Kind::NucleatedVillage),(1200,Kind::MarketTown),(4999,Kind::WalledTown),(5000,Kind::WalledTown),(30000,Kind::City),(200000,Kind::Metropolis)]{
        assert_eq!(resolve(&site("european-organic",population),&cfg,&[]),expected);
    }
    let mut c=cfg;c.programme.functions=Some(super::super::programme::ProgrammeFunctions{artisan:0.7,port:0.2,..Default::default()});c.programme.resources=vec!["fish".into()];
    let before=serde_json::to_vec(&c.programme).unwrap();let s=site("kraal",300);let before_population=s.population;
    let(effective,kind)=effective(&s,&c,&[]);assert_eq!(kind,Kind::Camp);
    assert_eq!(before,serde_json::to_vec(&effective.programme).unwrap());assert_eq!(before,serde_json::to_vec(&c.programme).unwrap());assert_eq!(s.population,before_population);
    assert_eq!(resolve(&s,&effective,&[]),Kind::Camp);
}

#[test]
fn camp_mapping_override_limits_match_the_actual_native_morph_consumer(){
    for stage in ["quarters","parcels"]{
        assert!(!super::super::catalogue()["fields"][stage].as_array().unwrap().iter().any(|v|v=="campLayout"),"a newly supported override requires updating the selector contract");
    }
    for value in [serde_json::Value::Null,json!(""),json!("rows")]{
        let params=json!({"campLayout":value});
        let error=super::super::resolve("kraal","culture","auto","core",1.,&params,"quarters").err().expect("campLayout override must remain invalid at the quarters stage");
        assert!(error.contains("campLayout")&&error.contains("quarters"));
    }
    let mut c=LayoutConfig::default();c.preset="missing-camp-mapping-preset".into();
    assert!(!cultural_camp("kraal",300,&c));
    assert!(super::super::resolve("kraal",&c.preset,"auto","core",1.,&json!({}),"quarters").is_err());
}
