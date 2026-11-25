use super::*;

#[test]
fn peripheral_pockets_are_town_only_and_preserve_the_formal_prefix() {
    // An empty tail must stop at an interior junction, preserving the
    // occupied branch and remapping its access after an empty path is removed.
    let street = |path| Street {
        path,
        widths: vec![2.],
        rank: 3,
        role: "path".into(),
    };
    let mut ways = vec![
        street(vec![Point { x: 0., y: 0. }, Point { x: 100., y: 0. }]),
        street(vec![Point { x: 20., y: 0. }, Point { x: 20., y: -30. }]),
        street(vec![Point { x: 60., y: 0. }, Point { x: 60., y: 20. }]),
    ];
    let mut huts = vec![Hut {
        id: "hut".into(),
        shape: g::rectangle(62., 12., 67., 18.),
        axis: Point { x: 1., y: 0. },
        front: [Point { x: 62., y: 12. }, Point { x: 62., y: 18. }],
        street: 7,
    }];
    let road = street(vec![Point { x: 0., y: -10. }, Point { x: 0., y: 10. }]);
    prune_paths(&mut ways, &[road], &mut huts, &[], 5);
    assert_eq!(ways.len(), 2);
    assert_eq!(ways[0].path.last().unwrap().x, 60.);
    assert_eq!(huts[0].street, 6);
    let n = 64;
    let heights = vec![10_f32; n * n];
    let water = vec![0_u8; n * n];
    let levels = vec![0_f32; n * n];
    let surface = Surface {
        geometry: None,
        width: 4000.,
        n,
        height: &heights,
        water: &water,
        interpolation: Default::default(),
    };
    let site = Site {
        key: "town".into(),
        name: String::new(),
        population: 10_000,
        culture: "medina".into(),
        center: Point { x: 2000., y: 2000. },
        radius: 260.,
        neighbours: Vec::new(),
    };
    let road = Street {
        path: vec![Point { x: 200., y: 2000. }, Point { x: 3800., y: 2000. }],
        widths: vec![6.],
        rank: 1,
        role: "road".into(),
    };
    let mut cfg = LayoutConfig {
        fortification: "none".into(),
        radius: 260.,
        ..Default::default()
    };
    cfg.footprint.budget = "radius".into();
    cfg.shanty_scale = 0.;
    let bare = generate_quarters(
        "shanty-proof",
        std::slice::from_ref(&site),
        &cfg,
        surface,
        std::slice::from_ref(&road),
    )
    .unwrap();
    cfg.shanty_scale = 1.;
    let built = generate_quarters(
        "shanty-proof",
        std::slice::from_ref(&site),
        &cfg,
        surface,
        std::slice::from_ref(&road),
    )
    .unwrap();
    let town = &built[0];
    let ext = extension(town).expect("a 10k medina should have peripheral informal pockets");
    assert!(!ext.pockets.is_empty());
    let mut recovered = formal_layout(town).into_owned();
    // The applied configuration and the claim (which holds the informal
    // quarters too, so a neighbouring town keeps off them) are the only
    // intentional differences.
    recovered.config = bare[0].config.clone();
    recovered.claim = bare[0].claim.clone();
    assert_eq!(
        serde_json::to_value(&recovered).unwrap(),
        serde_json::to_value(&bare[0]).unwrap()
    );
    let mut hut_count = 0;
    for p in &ext.pockets {
        let shape = &town.quarters[p.quarter].shape;
        assert_eq!(town.quarters[p.quarter].zone, "shanty");
        assert!(p.huts.len() >= 6);
        for formal in &bare[0].quarters {
            assert!(!overlap(shape, &formal.shape));
        }
        for hut in &p.huts {
            assert!(hut.shape.outer.iter().all(|&p| g::contains(shape, p)));
            assert!(dry_shape(surface, &hut.shape, 0.65));
            assert!((11.0..45.0).contains(&g::area(&hut.shape)));
            assert!(hut.street >= ext.formal_streets && hut.street < town.streets.len());
        }
        for (i, hut) in p.huts.iter().enumerate() {
            for other in p.huts.iter().skip(i + 1) {
                assert!(!overlap(&hut.shape, &other.shape));
            }
        }
        hut_count += p.huts.len();
    }
    assert!(hut_count <= MAX_HUTS && ext.pockets.len() <= MAX_POCKETS);
    assert!(
        town.structure
            .as_ref()
            .unwrap()
            .districts
            .iter()
            .any(|d| d.role == "shanty")
    );
    let mut replay = bare[0].clone();
    let key_seed = "shanty-proof";
    extend(
        key_seed,
        &mut replay,
        &site,
        &cfg,
        kinds::Kind::City,
        surface,
        std::slice::from_ref(&road),
    );
    assert_eq!(
        serde_json::to_value(extension(&replay)).unwrap(),
        serde_json::to_value(extension(town)).unwrap()
    );
    let parcels_cfg = ParcelConfig::default();
    let formal_parts = generate_parcels("shanty-proof", &bare, &parcels_cfg).unwrap();
    let parts = generate_parcels("shanty-proof", &built, &parcels_cfg).unwrap();
    assert!(hut_count <= remaining_households(formal_parts[0].programme.as_ref().unwrap()));
    let mut exhausted = formal_parts[0].programme.clone().unwrap();
    let wanted: f64 = exhausted
        .demands
        .iter()
        .filter(|d| d.unit == "domesticUnits")
        .map(|d| d.requested)
        .sum();
    let cap = (wanted * 1.3).floor().max(wanted.ceil());
    for a in &mut exhausted.allocations {
        a.households = 0.;
    }
    exhausted.allocations[0].households = cap;
    assert_eq!(remaining_households(&exhausted), 0);
    let mut capped = formal_parts[0].clone();
    capped.programme = Some(exhausted);
    allocate(town, &mut capped);
    assert_eq!(
        capped
            .programme
            .as_ref()
            .unwrap()
            .allocations
            .iter()
            .map(|a| a.households)
            .sum::<f64>(),
        cap
    );
    assert_eq!(
        capped
            .parcels
            .iter()
            .filter(|p| p.reason == "population-budget-open-patch")
            .count(),
        hut_count
    );
    let snapshot = serde_json::to_value(&capped).unwrap();
    allocate(town, &mut capped);
    assert_eq!(serde_json::to_value(&capped).unwrap(), snapshot);
    for part in [
        &parts[0],
        &programme::reallocate(&built, &parts).unwrap()[0],
    ] {
        let pr = part.programme.as_ref().unwrap();
        let wanted: f64 = pr
            .demands
            .iter()
            .filter(|d| d.unit == "domesticUnits")
            .map(|d| d.requested)
            .sum();
        let held: f64 = pr.allocations.iter().map(|a| a.households).sum();
        assert!(held <= (wanted * 1.3).floor().max(wanted.ceil()));
    }
    let prefix = formal_parts[0].parcels.len();
    assert_eq!(
        serde_json::to_value(&parts[0].parcels[..prefix]).unwrap(),
        serde_json::to_value(&formal_parts[0].parcels).unwrap()
    );
    let formal_allocations = &formal_parts[0].programme.as_ref().unwrap().allocations;
    assert_eq!(
        serde_json::to_value(
            &parts[0].programme.as_ref().unwrap().allocations[..formal_allocations.len()]
        )
        .unwrap(),
        serde_json::to_value(formal_allocations).unwrap()
    );
    assert_eq!(
        parts[0]
            .parcels
            .iter()
            .filter(|p| p.family == "shanty")
            .count(),
        hut_count
    );
    let formal_again = programme::reallocate(&bare, &formal_parts).unwrap();
    let again = programme::reallocate(&built, &parts).unwrap();
    assert_eq!(
        serde_json::to_value(&again[0].parcels[..prefix]).unwrap(),
        serde_json::to_value(&formal_again[0].parcels).unwrap()
    );
    assert_eq!(
        again[0]
            .parcels
            .iter()
            .filter(|p| p.family == "shanty")
            .count(),
        hut_count
    );
    assert_eq!(
        serde_json::to_value(
            &again[0].programme.as_ref().unwrap().allocations[..formal_again[0]
                .programme
                .as_ref()
                .unwrap()
                .allocations
                .len()]
        )
        .unwrap(),
        serde_json::to_value(&formal_again[0].programme.as_ref().unwrap().allocations).unwrap()
    );
    let before = building_sites::requests_range(
        "shanty-proof",
        &bare,
        &formal_parts,
        surface,
        &levels,
        None,
        0,
        5,
    )
    .unwrap();
    let after = building_sites::requests_range(
        "shanty-proof",
        &built,
        &parts,
        surface,
        &levels,
        None,
        0,
        5,
    )
    .unwrap();
    assert!(
        before == after,
        "formal building footprints and massing must keep their prefix"
    );
    let offset = formal_allocations
        .iter()
        .filter(|a| a.role != "open.garden")
        .count();
    let requests = building_sites::requests_range(
        "shanty-proof",
        &built,
        &parts,
        surface,
        &levels,
        None,
        offset,
        offset + hut_count,
    )
    .unwrap();
    assert_eq!(requests.len(), hut_count);
    let mut covers = std::collections::BTreeSet::new();
    for request in &requests {
        assert_eq!(request["programme"]["district_role"], "shanty");
        let preview = request["preview"].as_array().unwrap();
        let massing = request["programme"]["massing"].as_array().unwrap();
        assert!(!preview.is_empty() && preview.len() == massing.len());
        for m in massing {
            assert_eq!(m["floors"], 1);
            assert!(m["eave_m"].as_f64().unwrap() < 3.);
            covers.insert(m["cover"].as_str().unwrap().to_owned());
        }
    }
    assert!(
        covers.len() > 1,
        "roofs should show several salvage materials"
    );
    if let Ok(path) = std::env::var("SHANTY_PROOF_OUT") {
        std::fs::write(
            path,
            serde_json::to_vec(&json!({"layout":town,"requests":requests})).unwrap(),
        )
        .unwrap();
    }
    let village = Site {
        population: 800,
        ..site.clone()
    };
    let village_layout = generate_quarters(
        "shanty-proof",
        &[village],
        &cfg,
        surface,
        std::slice::from_ref(&road),
    )
    .unwrap();
    assert!(extension(&village_layout[0]).is_none());
    for (population, culture, kind, intent, scale) in [
        (
            800,
            "medina",
            kinds::Kind::NucleatedVillage,
            "settlement",
            1.,
        ),
        (10_000, "elven", kinds::Kind::City, "settlement", 1.),
        (10_000, "medina", kinds::Kind::Camp, "settlement", 1.),
        (10_000, "medina", kinds::Kind::City, "activity", 1.),
        (10_000, "medina", kinds::Kind::City, "settlement", 0.),
        (10_000, "chinese", kinds::Kind::City, "settlement", 1.), // no river
        (10_000, "ottoman", kinds::Kind::City, "settlement", 1.), // no slope
    ] {
        let mut layout = bare[0].clone();
        layout.culture = culture.into();
        let site = Site {
            population,
            culture: culture.into(),
            ..site.clone()
        };
        let mut cfg = cfg.clone();
        cfg.programme.intent = intent.into();
        cfg.shanty_scale = scale;
        extend(
            key_seed,
            &mut layout,
            &site,
            &cfg,
            kind,
            surface,
            std::slice::from_ref(&road),
        );
        assert!(
            extension(&layout).is_none(),
            "unexpected informal quarter for {population} {culture} {intent} {scale}"
        );
    }
    // Controlled banks and hills exercise both positive siting rules; the
    // dry flat fixture above already proves that neither invents terrain.
    let square = g::rectangle(1800., 1800., 2200., 2200.);
    let mut proto = bare[0].clone();
    proto.quarters = vec![Quarter {
        shape: square.clone(),
        phase: 0,
        zone: "core".into(),
    }];
    proto.blocks = vec![Block {
        shape: square.clone(),
        quarter: 0,
        kind: "residential".into(),
        axis: Point { x: 1., y: 0. },
        zone: "core".into(),
        phase: Some(0),
    }];
    proto.enclosures.clear();
    proto.streets = vec![
        Street {
            path: vec![Point { x: 1600., y: 2250. }, Point { x: 2400., y: 2250. }],
            widths: vec![5.],
            rank: 1,
            role: "road".into(),
        },
        Street {
            path: vec![Point { x: 2250., y: 1600. }, Point { x: 2250., y: 2400. }],
            widths: vec![5.],
            rank: 1,
            role: "road".into(),
        },
    ];
    proto.structure = Some(UrbanStructure {
        allocated: vec![square],
        ..Default::default()
    });
    let hill = (0..n * n)
        .map(|i| (10. + 0.12 * (i % n) as f64 * 4000. / n as f64) as f32)
        .collect::<Vec<_>>();
    let river = (0..n * n)
        .map(|i| if (37..39).contains(&(i / n)) { 3_u8 } else { 0 })
        .collect::<Vec<_>>();
    for (culture, surface) in [
        (
            "ottoman",
            Surface {
                height: &hill,
                ..surface
            },
        ),
        (
            "chinese",
            Surface {
                water: &river,
                ..surface
            },
        ),
    ] {
        let mut layout = proto.clone();
        layout.culture = culture.into();
        extend(
            key_seed,
            &mut layout,
            &site,
            &cfg,
            kinds::Kind::City,
            surface,
            &[],
        );
        assert!(
            extension(&layout).is_some(),
            "suitable {culture} terrain should admit an informal pocket"
        );
    }
    let mut other = bare[0].clone();
    extend(
        "another-shanty-seed",
        &mut other,
        &site,
        &cfg,
        kinds::Kind::City,
        surface,
        std::slice::from_ref(&road),
    );
    assert_ne!(
        serde_json::to_value(extension(&other)).unwrap(),
        serde_json::to_value(ext).unwrap()
    );
    eprintln!(
        "shanty: {} pockets, {hut_count} huts; formal plan/parcels/allocations/buildings stable; eligibility and roof materials verified",
        ext.pockets.len()
    );
}
