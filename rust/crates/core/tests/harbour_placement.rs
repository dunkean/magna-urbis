use magna_urbis_core::settlements::{Config, Output, Point, Raster, SettlementSpec, SitePrefs, generate};

const SEED: &str = "regional-harbour";
const PORT: Point = Point { x: 1397.0, y: 1610.0 };

fn recipe() -> Config {
    Config {
        mode: "list".into(),
        relief: "flat".into(),
        farm_density: 0.0,
        remote_places: 0.0,
        list: vec![
            SettlementSpec {
                key: "port".into(),
                population: 300,
                culture: "european-organic".into(),
                position: Some(PORT),
                site_prefs: SitePrefs {
                    weights: [("harbor".into(), 2.0)].into(),
                    ..SitePrefs::default()
                },
                ..SettlementSpec::default()
            },
            SettlementSpec {
                key: "hamlet".into(),
                population: 40,
                site_type: "harbor".into(),
                ..SettlementSpec::default()
            },
        ],
        ..Config::default()
    }
}

fn place(config: &Config) -> Output {
    const N: usize = 160;
    let mut height = vec![3.0; N * N];
    let mut water = vec![0; N * N];
    for i in 0..N * N {
        let (x, y) = (i % N, i / N);
        if x >= 90 {
            water[i] = 1;
            height[i] = 0.0;
        } else if x >= 82 {
            // Only one row makes the low bank suitable for automatic settlement siting.
            height[i] = if y == 80 { 2.0 } else { 1.0 };
        }
    }
    let zeros = vec![0.0; N * N];
    let ids = vec![-1; N * N];
    generate(
        SEED,
        Raster {
            width: 3200.0,
            n: N,
            height: &height,
            water: &water,
            water_level: &zeros,
            river_width: &zeros,
            river_ids: &ids,
        },
        config,
    )
    .unwrap()
}

#[test]
fn classic_still_places_the_hamlet_on_the_port_front() {
    let mut cfg = recipe();
    let default = place(&cfg);
    cfg.engine = "classic".into();
    let classic = place(&cfg);
    assert_eq!(
        serde_json::to_value(&default).unwrap(),
        serde_json::to_value(&classic).unwrap(),
    );
    assert_eq!(classic.settlements.len(), 2);
    assert_eq!(classic.settlements[0].center, PORT);
    assert!(classic.settlements.iter().all(|s| s.harbour_reservation.is_none()));
    let hamlet = &classic.settlements[1];
    assert_eq!(hamlet.spec.population, 40);
    assert_eq!(hamlet.archetype, "harbor");
    // Before harbour reservations, (1770, 1610) is the only shore candidate after the
    // keep-away from the port and the low-bank flood check. Jitter can move it by up to 12 m.
    assert!((1758.0..=1782.0).contains(&hamlet.center.x), "{:?}", hamlet.center);
    assert!((1598.0..=1622.0).contains(&hamlet.center.y), "{:?}", hamlet.center);
}

#[test]
fn growth_reserves_the_distant_front_for_the_port_and_moves_the_hamlet() {
    let mut cfg = recipe();
    let classic = place(&cfg);
    cfg.engine = "growth".into();
    let growth = place(&cfg);
    assert_eq!(growth.settlements.len(), 2, "{:?}", growth.warnings);
    let port = &growth.settlements[0];
    assert_eq!(port.center, PORT);
    let claim = port.harbour_reservation.expect("the port's front is reserved");
    assert!((395.0..405.0).contains(&PORT.distance(claim.landing)), "{:?}", claim.landing);
    assert_eq!(claim.radius, 150.0);
    assert_eq!(claim.corridor_width, 60.0);
    let middle_x = 0.5 * (PORT.x + claim.landing.x);
    assert!(claim.contains(PORT, Point { x: middle_x, y: PORT.y + 25.0 }));
    assert!(!claim.contains(PORT, Point { x: middle_x, y: PORT.y + 35.0 }));
    assert!(claim.contains(PORT, classic.settlements[1].center));
    let hamlet = &growth.settlements[1];
    assert_eq!(hamlet.spec.population, 40);
    assert!(!claim.contains(PORT, hamlet.center), "{:?}", hamlet.center);
}
