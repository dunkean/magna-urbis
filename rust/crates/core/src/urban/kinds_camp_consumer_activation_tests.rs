//! Ordinary native consumer regressions on the same frozen synthetic cases.
use super::*;
use serde::Deserialize;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Case { id: String, culture: String, population: u32, radius: f64, road_y: f64 }
#[derive(Deserialize)]
struct Corpus { cases: Vec<Case> }
fn corpus() -> Corpus {
    serde_json::from_slice(include_bytes!("fixtures/camp-cultural-consumer-synthetic.json")).unwrap()
}
fn inputs(c: &Case) -> (Site, LayoutConfig, Vec<Street>) {
    let site = Site { key: c.id.clone(), name: c.id.clone(), culture: c.culture.clone(),
        population: c.population, center: Point { x: 2000., y: 2000. }, radius: c.radius };
    let mut cfg = LayoutConfig::default();
    cfg.footprint.budget = "radius".into();
    let roads = vec![Street { path: vec![Point { x: 1000., y: c.road_y }, Point { x: 3000., y: c.road_y }],
        widths: vec![6., 6.], rank: 0, role: "regional".into() }];
    (site, cfg, roads)
}
fn morph(site: &Site, cfg: &LayoutConfig) -> Morph {
    super::super::with_tissue(super::super::resolve(culture(site, cfg), &cfg.preset,
        &cfg.recipe, "core", cfg.density, &cfg.params, "quarters").unwrap(), &cfg.tissue)
}
fn surface<'a>(height: &'a [f32], water: &'a [u8]) -> Surface<'a> {
    Surface { geometry: None, width: 4000., n: 128, height, water }
}
fn bytes<T: serde::Serialize>(value: &T) -> Vec<u8> { serde_json::to_vec(value).unwrap() }

// This canonical adjustment already exists in the V1/production effective()
// branch, byte-identical there. It is not part of the cultural camp delta.
fn canonical_programme(cfg: &LayoutConfig, kind: Kind) -> super::super::ProgrammeContext {
    let mut expected = cfg.programme.clone();
    if cfg.footprint.mechanism != "legacy"
        && matches!(kind, Kind::Farmstead | Kind::Ruin) && expected.role == "auto"
    { expected.role = "isolated-farm".into(); }
    expected
}


#[test]
fn camp_consumer_native_metadata_delegates_while_legacy_stays_on_its_old_path() {
    let (h, w) = (vec![20.; 128*128], vec![0; 128*128]);
    for c in corpus().cases.into_iter().filter(|c| c.population == 300) {
        let (site, cfg, roads) = inputs(&c);
        let (effective, kind) = effective(&site, &cfg, &roads);
        let m = morph(&site, &effective);
        assert_eq!(kind, Kind::Camp);
        let small = lay_out("camp-consumer-unit", &site, &effective, kind, &m, surface(&h, &w), &roads);
        assert_eq!(small.is_none(), !m.text("campLayout").is_empty(), "{}", c.id);
    }
}

#[test]
fn camp_consumer_preserves_cultural_enclosure_and_explicit_fortification_choices() {
    // The initial quarters Morph historically resolves core even for grown
    // profiles. An explicit Camp must not reopen a removed grown campLayout.
    let c = corpus().cases.into_iter().find(|c| c.id == "SYN-grown-kraal").unwrap();
    let (site, mut cfg, roads) = inputs(&c);
    cfg.settlement_form = "camp".into();
    let (applied, kind) = effective(&site, &cfg, &roads);
    assert_eq!(kind, Kind::Camp);
    assert_eq!(applied.fortification, "none");
    let (h,w) = (vec![20.;128*128],vec![0;128*128]);
    assert!(lay_out("explicit-grown-camp", &site, &applied, kind,
        &morph(&site, &applied), surface(&h,&w), &roads).is_some());
    for c in corpus().cases {
        let (site, mut cfg, roads) = inputs(&c);
        let (applied, kind) = effective(&site, &cfg, &roads);
        if kind == Kind::Camp && c.culture != "nomad-camp" {
            assert_eq!(applied.fortification, "culture", "{}", c.id);
        }
        if c.culture == "nomad-camp" { assert_eq!(applied.fortification, "none"); }
        for selected in ["none", "hedge", "palisade", "wall"] {
            cfg.fortification = selected.into();
            assert_eq!(effective(&site, &cfg, &roads).0.fortification, selected, "{}", c.id);
        }
        assert_eq!(bytes(&canonical_programme(&cfg, kind)), bytes(&effective(&site, &cfg, &roads).0.programme));
    }
}

#[test]
fn camp_consumer_programme_expectation_keeps_the_preexisting_isolated_farm_rule() {
    let c = corpus().cases.into_iter().find(|c| c.id == "SYN-tiny-kraal").unwrap();
    let (site, mut cfg, roads) = inputs(&c);
    for state in ["thriving", "ruined"] {
        cfg.programme.state = state.into();
        let (actual,kind) = effective(&site,&cfg,&roads);
        assert!(matches!(kind,Kind::Farmstead|Kind::Ruin));
        assert_eq!(cfg.programme.role,"auto");
        assert_eq!(actual.programme.role,"isolated-farm");
        assert_eq!(bytes(&actual.programme),bytes(&canonical_programme(&cfg,kind)));
    }
    cfg.programme.role="isolated-mill".into();
    let (actual,kind)=effective(&site,&cfg,&roads);
    assert_eq!(actual.programme.role,"isolated-mill");
    assert_eq!(bytes(&actual.programme),bytes(&canonical_programme(&cfg,kind)));
    cfg.footprint.mechanism="legacy".into();cfg.programme.role="auto".into();
    let (actual,kind)=effective(&site,&cfg,&roads);
    assert_eq!(actual.programme.role,"auto");
    assert_eq!(bytes(&actual.programme),bytes(&canonical_programme(&cfg,kind)));
}

// This reproduces the EXISTING caller's fallback and finish, not a second
// camp algorithm. Equality proves the full public chain used that consumer.