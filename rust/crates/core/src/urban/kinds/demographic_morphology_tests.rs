use super::{*, camps::ring_tracks};
fn site(population: u32) -> Site {
    Site { key: "demographic-morphology".into(), name: String::new(), population,
        culture: "european-organic".into(), center: Point { x: 4000.0, y: 4000.0 }, radius: 200.0,
        neighbours: Vec::new(), }
}

#[test]
fn hamlet_farms_match_the_programmes_cultural_households() {
    let n = 32;
    let height = vec![0.0; n * n];
    let water = vec![0; n * n];
    let surface = Surface { geometry: None, width: 8000.0, n,
        height: &height, water: &water, interpolation: Default::default() };
    let morph = Morph { value: serde_json::json!({"plotDepth":{"village":[40.,60.]}}) };
    // Small European households need 41 homes for 149 people (0.85 home per household).
    // A cultural override must size the plan with the selected profile.
    for (population, culture, expected) in [(90,"site",25), (149,"site",41), (90,"haussmannian",22)] {
        let cfg = LayoutConfig { culture: culture.into(), ..Default::default() };
        let plan = linear(&site(population), &cfg, Kind::Hamlet, &morph, &None, &[], &|_| 3.,
            &[], surface, &mut Rng::new("household-farms"), 1.0).unwrap();
        assert_eq!(plan.blocks.len(), expected, "{population} / {culture}: one farm per model household");
    }
}
    /// A camp ring is as tight as its tents: a small camp keeps one ring, a
    /// camp of 1 500 pitches several rows round a plausible centre, whole.
    #[test]
    fn a_camp_ring_gains_rows_before_its_centre_grows_empty() {
        let (row, step) = (15.5, 35.0);
        for tents in [20.0, 60.0, 120.0, 200.0, 330.0, 900.0] {
            let (radius, tracks) = ring_tracks(tents, 7.0, row, step);
            let capacity: f64 = (0..tracks).map(|t| 2.0 * std::f64::consts::TAU * (radius + t as f64 * step) / 7.0).sum();
            assert!(capacity >= tents * 0.999, "{tents}: {capacity}");
            assert!(radius - row <= 1.5 * tracks as f64 * step, "{tents}: centre {} m", radius - row);
            assert!(tracks == 1 || radius - row >= 13.9, "{tents}: no centre");
            assert!(tents > 60.0 || tracks == 1, "{tents}: {tracks} rings");
        }
        assert!(ring_tracks(330.0, 7.0, row, step).1 >= 2);
    }
#[test]
fn demographic_morphology_boundaries_are_distinct_without_changing_population() {
    let cfg = LayoutConfig::default();
    // The automatic grammar changes exactly on the demographic class floors.
    for (population, class, kind) in [(12,"farmstead",Kind::Farmstead),(14,"farmstead",Kind::Farmstead),(15,"hamlet",Kind::Hamlet),(149,"hamlet",Kind::Hamlet),(150,"village",Kind::NucleatedVillage),(999,"village",Kind::NucleatedVillage),(1000,"town",Kind::MarketTown),(19999,"town",Kind::WalledTown),(20000,"city",Kind::City),(99999,"city",Kind::City),(100000,"metropolis",Kind::Metropolis),(1000000,"megacity",Kind::Metropolis)] {
        let s = site(population);
        assert_eq!(crate::settlements::demographics::class_of(s.population), class);
        assert_eq!(resolve(&s, &cfg, &[]), kind, "{population}");
        let (applied, resolved) = effective(&s, &cfg, &[]);
        assert_eq!(resolved, kind);
        assert_eq!(applied.settlement_form, kind.id());
        assert_eq!(s.population, population);
        assert_eq!(cfg.settlement_form, "auto");
    }
}
#[test]
fn demographic_morphology_preserves_cultural_camps_and_isolated_intents() {
    let mut cfg = LayoutConfig::default();
    let mut s = site(300); s.culture = "nomad-camp".into();
    assert_eq!(resolve(&s, &cfg, &[]), Kind::Camp);
    for role in ["isolated-mill","isolated-inn","isolated-tower","isolated-shrine","roadside-temple"] {
        cfg.programme.intent = role.into();
        assert_eq!(resolve(&site(100000), &cfg, &[]), Kind::Single);
    }
    cfg.programme.intent = "isolated-farm".into();
    assert_eq!(resolve(&s, &cfg, &[]), Kind::Farmstead);
    cfg.programme.state = "ruined".into();
    assert_eq!(resolve(&s, &cfg, &[]), Kind::Ruin);
}
#[test]
fn demographic_morphology_all_explicit_ids_and_old_village_preferences_keep_their_meaning() {
    let s = site(300);
    for expected in ALL {
        let mut cfg = LayoutConfig::default(); cfg.settlement_form = expected.id().into(); cfg.programme.intent = "isolated-mill".into();
        assert_eq!(resolve(&s, &cfg, &[]), expected);
    }
    let mut cfg = LayoutConfig::default(); cfg.settlement_form = "ribbon".into();
    assert_eq!(resolve(&s, &cfg, &[]), Kind::StreetVillage);
    cfg.settlement_form = "nucleated".into(); assert_eq!(resolve(&s, &cfg, &[]), Kind::NucleatedVillage);
    cfg.settlement_form = "ribbon".into(); assert_eq!(resolve(&site(100000), &cfg, &[]), Kind::Metropolis);
}
