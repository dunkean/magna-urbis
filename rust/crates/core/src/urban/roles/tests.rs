    use super::super::{
        LayoutConfig, ParcelConfig, Site, Street, Surface, UrbanProgramme, generate_parcels,
        generate_quarters,
    };
    use super::*;

    #[test]
    fn requested_counts_set_exact_sites_remove_zero_and_add_catalogue_roles() {
        let mut needs = services("european-organic", 5000);
        let drawn = site_counts(&needs);
        let mut roles = drawn.keys().cloned();
        let (gone, more) = (roles.next().unwrap(), roles.next().unwrap());
        let foreign = catalogue().families.values().flatten().map(|e| e.role.clone()).find(|r| !drawn.contains_key(r)).unwrap();
        let counts = BTreeMap::from([(gone.clone(), 0), (more.clone(), 5), (foreign.clone(), 2), ("nonsense.role".to_string(), 3)]);
        assert_eq!(resolve_counts(&mut needs, &counts, "european-organic", 5000), vec!["nonsense.role".to_string()]);
        let after = site_counts(&needs);
        assert!(!after.contains_key(&gone), "0 removes the role");
        assert_eq!(after[&more], 5, "an exact count, past the catalogue cap");
        assert_eq!(after[&foreign], 2, "a role the town does not draw comes from the catalogue");
        assert!(needs.iter().all(|n| n.sites > 0 && n.entry.culture.is_empty()));
        assert!(countable_role(&foreign) && !countable_role("nonsense.role"));
        for (role, n) in &drawn {
            if role != &gone && role != &more {
                assert_eq!(after[role], *n, "other roles stay automatic");
            }
        }
    }

    #[test]
    fn service_counts_scale_with_population_and_culture() {
        let small = services("european-organic", 120);
        assert!(
            small.iter().all(|s| s.entry.role == "storage.barn"),
            "a hamlet below 150 has no parish, only a shared barn"
        );
        let town = services("european-organic", 5000);
        let count = |s: &[ServiceNeed], r: &str| {
            s.iter()
                .filter(|n| n.entry.role == r)
                .map(|n| n.sites)
                .sum::<usize>()
        };
        assert_eq!(count(&town, "worship.parish"), 2);
        assert_eq!(count(&town, "worship.cathedral"), 0);
        let city = services("european-organic", 100_000);
        assert_eq!(count(&city, "worship.cathedral"), 1);
        assert!(count(&city, "commerce.market.gate") >= 8);
        let medina = services("medina", 5000);
        let friday = medina
            .iter()
            .find(|n| n.entry.role == "worship.mosque.friday")
            .unwrap();
        assert!(friday.entry.landmark && friday.entry.site == "nucleus");
        assert!(friday.area >= 3200.0, "nucleus area from catalogue.json");
        assert!(district_target(100_000) >= 10 && district_target(100_000) <= 30);
        assert_eq!(district_target(150), 1);
    }

    #[test]
    fn singular_density_scales_services_and_cultures_own_their_buildings() {
        let f = super::super::programme::ProgrammeFunctions::default();
        let count = |s: &[ServiceNeed], r: &str| s.iter().filter(|n| n.entry.role == r).map(|n| n.sites).sum::<usize>();
        let base = services_scaled("european-organic", 5000, f, 1.0);
        let rich = services_scaled("european-organic", 5000, f, 3.0);
        let bare = services_scaled("european-organic", 5000, f, 0.0);
        assert!(count(&base, "commerce.tavern") >= 5 && count(&base, "commerce.inn") >= 4);
        assert!(count(&rich, "commerce.tavern") > count(&base, "commerce.tavern"));
        assert!(bare.iter().all(|n| matches!(n.entry.function.as_str(), "market" | "common")), "density 0 keeps the nucleus and open land");
        let dwarven = services("dwarven", 2000);
        assert!(dwarven.iter().any(|n| n.entry.role == "civic.great-forge" && n.entry.landmark));
        assert_eq!(dwarven.iter().filter(|n| n.entry.role == "craft.smithy").count(), 1, "the culture entry replaces the family one");
        assert_eq!(count(&dwarven, "craft.smithy"), 5);
        assert_eq!(role_function("civic.great-forge"), Some("workshop"));
        assert!(is_landmark("civic.moot-tree") && !is_landmark("commerce.tavern"));
    }

    /// A river town: mills or tanneries on the river bank (tanneries on the
    /// lowest reach), English district names and French building role labels,
    /// user overrides of a lot and of
    /// a quarter honoured with stable lot ids, hamlet barns and a ruined state.
    #[test]
    fn river_town_overrides_labels_and_states() {
        let n = 96;
        let width = 2400.0;
        let cell = width / n as f64;
        // River along y ~ 1500 m, flowing east (its bed falls with x).
        let in_river = |i: usize| (1480.0..1530.0).contains(&((i / n) as f64 * cell + cell * 0.5));
        let height: Vec<f32> = (0..n * n)
            .map(|i| {
                let x = (i % n) as f32 * cell as f32;
                (if in_river(i) { 12.0 } else { 20.0 }) - x * 0.004
            })
            .collect();
        let water: Vec<u8> = (0..n * n)
            .map(|i| if in_river(i) { 3 } else { 0 })
            .collect();
        let surface = Surface {
            geometry: None,
            width,
            n,
            height: &height,
            water: &water,
            interpolation: Default::default(),
        };
        let road = |a: (f64, f64), b: (f64, f64)| Street {
            path: vec![Point { x: a.0, y: a.1 }, Point { x: b.0, y: b.1 }],
            widths: vec![6.0; 2],
            rank: 1,
            role: "regional".into(),
        };
        let roads = [
            road((100.0, 1250.0), (2300.0, 1250.0)),
            road((1200.0, 100.0), (1200.0, 1460.0)),
        ];
        let site = Site {
            key: "river-town".into(),
            name: String::new(),
            population: 5000,
            culture: "european-organic".into(),
            center: Point {
                x: 1200.0,
                y: 1250.0,
            },
            radius: 330.0,
            neighbours: Vec::new(),
        };
        let run = |config: &LayoutConfig, parcels: &ParcelConfig| {
            let layouts = generate_quarters(
                "river",
                std::slice::from_ref(&site),
                config,
                surface,
                &roads,
            )
            .unwrap();
            let parts = generate_parcels("river", &layouts, parcels).unwrap();
            (layouts, parts)
        };
        let (layouts, parts) = run(&LayoutConfig::default(), &ParcelConfig::default());
        let pr = parts[0].programme.as_ref().unwrap();
        let block = |id: &str| parts[0].parcels.iter().find(|p| p.id == id).unwrap().block;
        // Water trades on the river.
        let on_river: Vec<&str> = pr
            .allocations
            .iter()
            .filter(|a| pr.environment[block(&a.parcel_id)].water == "river")
            .map(|a| a.role.as_str())
            .collect();
        assert!(
            on_river
                .iter()
                .any(|r| matches!(*r, "craft.mill" | "craft.tannery" | "craft.dyer")),
            "no mill/tannery on the river: {on_river:?}"
        );
        // Labels: never a raw id.
        assert!(
            pr.allocations
                .iter()
                .all(|a| !a.label.is_empty() && a.label != a.role)
        );
        let parish = pr
            .allocations
            .iter()
            .find(|a| a.role == "worship.parish")
            .unwrap();
        assert_eq!(parish.label, "Église paroissiale");
        let districts = &layouts[0].structure.as_ref().unwrap().districts;
        assert!(
            districts
                .iter()
                .all(|d| d.label.contains(" Parish") && !d.label.contains("Quartier"))
        );
        // Lot override: a dwelling becomes a parish, another a mansion of 2 households.
        let count =
            |pr: &UrbanProgramme, r: &str| pr.allocations.iter().filter(|a| a.role == r).count();
        let homes: Vec<&str> = pr
            .allocations
            .iter()
            .filter(|a| a.role.starts_with("dwelling.") && a.role != "dwelling.mansion")
            .map(|a| a.parcel_id.as_str())
            .take(2)
            .collect();
        let mut edited = ParcelConfig::default();
        let forced = |role: &str, households: Option<f64>| super::super::ParcelOverride {
            role: Some(role.into()),
            households,
            ..Default::default()
        };
        edited
            .overrides
            .parcels
            .insert(homes[0].into(), forced("worship.parish", None));
        edited
            .overrides
            .parcels
            .insert(homes[1].into(), forced("dwelling.mansion", Some(2.0)));
        let again = super::super::programme::reallocate(&layouts, &{
            let mut p = parts.clone();
            p[0].config = Some(edited.clone());
            p
        })
        .unwrap();
        let (_, fresh) = run(&LayoutConfig::default(), &edited);
        let ids = |p: &[super::super::Partition]| {
            p[0].parcels
                .iter()
                .map(|p| p.id.clone())
                .collect::<Vec<_>>()
        };
        assert_eq!(
            ids(&fresh),
            ids(&parts),
            "lot ids stable under lot overrides"
        );
        let edited_pr = fresh[0].programme.as_ref().unwrap();
        assert_eq!(
            serde_json::to_string(&again[0].programme).unwrap(),
            serde_json::to_string(&fresh[0].programme).unwrap(),
            "reallocation replays the edited generation"
        );
        let get = |id: &str| {
            edited_pr
                .allocations
                .iter()
                .find(|a| a.parcel_id == id)
                .unwrap()
        };
        assert_eq!(get(homes[0]).role, "worship.parish");
        assert_eq!(
            (get(homes[1]).role.as_str(), get(homes[1]).households),
            ("dwelling.mansion", 2.0)
        );
        assert_eq!(
            count(edited_pr, "worship.parish"),
            count(pr, "worship.parish"),
            "parishes re-balance"
        );
        // Quarter override: role and wealth on that quarter only.
        let mut config = LayoutConfig::default();
        config.overrides.quarters.insert(
            "0".into(),
            super::super::QuarterOverride {
                role: Some("craft:smiths".into()),
                wealth: Some(0.9),
                ..Default::default()
            },
        );
        let (ql, _) = run(&config, &ParcelConfig::default());
        let d = ql[0]
            .structure
            .as_ref()
            .unwrap()
            .districts
            .iter()
            .find(|d| d.quarters.contains(&0))
            .unwrap();
        assert_eq!(
            (d.role.as_str(), d.wealth, d.quarters.len()),
            ("craft:smiths", 0.9, 1)
        );
        assert!(d.label.starts_with("Smiths' Quarter, St "), "{}", d.label);
        assert!(d.label.contains(" Parish"), "{}", d.label);
        // Ruined: every building empty and labelled as a ruin.
        config = LayoutConfig::default();
        config.programme.state = "ruined".into();
        let (_, ruin) = run(&config, &ParcelConfig::default());
        let rp = ruin[0].programme.as_ref().unwrap();
        assert!(rp.allocations.iter().all(|a| a.households == 0.0));
        let church = rp
            .allocations
            .iter()
            .find(|a| a.role == "worship.parish.ruin")
            .unwrap();
        assert_eq!(church.label, "Église paroissiale en ruine");
        // A hamlet of 30 is only farms; a village of 200 shares a barn.
        assert!(services("european-organic", 30).is_empty());
        assert!(
            services("european-organic", 200)
                .iter()
                .any(|s| s.entry.role == "storage.barn")
        );
    }

    /// Scale probe (cargo test --release roles::tests::probe -- --ignored --nocapture).
    #[test]
    #[ignore]
    fn probe_role_scale() {
        for (culture, pop) in [
            ("european-organic", 30_000u32),
            ("medina", 12_000),
            ("european-organic", 100_000),
        ] {
            let n = 128;
            let height = vec![20.0f32; n * n];
            let water = vec![0u8; n * n];
            let width = 12_000.0;
            let surface = Surface {
                geometry: None,
                width,
                n,
                height: &height,
                water: &water,
                interpolation: Default::default(),
            };
            let c = width / 2.0;
            let roads = [
                Street {
                    path: vec![
                        Point { x: 200.0, y: c },
                        Point {
                            x: width - 200.0,
                            y: c,
                        },
                    ],
                    widths: vec![6.0; 2],
                    rank: 1,
                    role: "regional".into(),
                },
                Street {
                    path: vec![
                        Point { x: c, y: 200.0 },
                        Point {
                            x: c,
                            y: width - 200.0,
                        },
                    ],
                    widths: vec![6.0; 2],
                    rank: 1,
                    role: "regional".into(),
                },
            ];
            let site = Site {
                key: "probe".into(),
                name: String::new(),
                population: pop,
                culture: culture.into(),
                center: Point { x: c, y: c },
                radius: 30.0 * (pop as f64).sqrt(),
                neighbours: Vec::new(),
            };
            let t = std::time::Instant::now();
            let layouts = generate_quarters(
                "probe",
                std::slice::from_ref(&site),
                &LayoutConfig::default(),
                surface,
                &roads,
            )
            .unwrap();
            let q = t.elapsed();
            let parts = generate_parcels("probe", &layouts, &ParcelConfig::default()).unwrap();
            let t = std::time::Instant::now();
            let again = super::super::programme::reallocate(&layouts, &parts).unwrap();
            let a = t.elapsed();
            let pr = again[0].programme.as_ref().unwrap();
            let ds = &layouts[0].structure.as_ref().unwrap().districts;
            let mut roles = BTreeMap::<String, usize>::new();
            for d in ds {
                *roles.entry(d.role.clone()).or_default() += 1;
            }
            let dom = pr
                .demands
                .iter()
                .find(|d| d.function == "domestic")
                .unwrap();
            let gardens = pr
                .allocations
                .iter()
                .filter(|a| a.role == "open.garden")
                .count();
            eprintln!(
                "{culture} {pop}: quarters {q:?}; {} parcels, allocate {a:?} ({:.1} us/parcel); {} districts {roles:?}; domestic {:.0}/{:.0}; gardens {gardens}; services {}",
                again[0].parcels.len(),
                a.as_micros() as f64 / again[0].parcels.len().max(1) as f64,
                ds.len(),
                dom.parcel_capacity,
                dom.requested,
                pr.allocations
                    .iter()
                    .filter(|a| !a.role.starts_with("dwelling") && a.role != "open.garden")
                    .count()
            );
        }
    }

    /// A 5k European town: districts with roles, a worship building, a market,
    /// an inn near a gate, housing fully served and almost no vacant plot.
    #[test]
    fn a_european_market_town_houses_everyone_and_places_its_services() {
        let n = 96;
        let height: Vec<f32> = (0..n * n).map(|i| 20.0 + (i % n) as f32 * 0.02).collect();
        let water = vec![0u8; n * n];
        let surface = Surface {
            geometry: None,
            width: 2400.0,
            n,
            height: &height,
            water: &water,
            interpolation: Default::default(),
        };
        let road = |a: (f64, f64), b: (f64, f64)| Street {
            path: vec![Point { x: a.0, y: a.1 }, Point { x: b.0, y: b.1 }],
            widths: vec![6.0; 2],
            rank: 1,
            role: "regional".into(),
        };
        let roads = [
            road((100.0, 1200.0), (2300.0, 1200.0)),
            road((1200.0, 100.0), (1200.0, 2300.0)),
        ];
        let site = Site {
            key: "market-town".into(),
            name: String::new(),
            population: 5000,
            culture: "european-organic".into(),
            center: Point {
                x: 1200.0,
                y: 1200.0,
            },
            radius: 330.0,
            neighbours: Vec::new(),
        };
        let t = std::time::Instant::now();
        let layouts = generate_quarters(
            "roles-town",
            std::slice::from_ref(&site),
            &LayoutConfig::default(),
            surface,
            &roads,
        )
        .unwrap();
        let quarters_ms = t.elapsed().as_millis();
        let t = std::time::Instant::now();
        let parts = generate_parcels("roles-town", &layouts, &ParcelConfig::default()).unwrap();
        let parcels_ms = t.elapsed().as_millis();
        let t = std::time::Instant::now();
        let again = super::super::programme::reallocate(&layouts, &parts).unwrap();
        let allocate_us = t.elapsed().as_micros() as f64 / parts[0].parcels.len().max(1) as f64;
        assert_eq!(
            serde_json::to_string(&again[0].programme).unwrap(),
            serde_json::to_string(&parts[0].programme).unwrap(),
            "allocation replays exactly"
        );
        let layout = &layouts[0];
        let districts = &layout.structure.as_ref().unwrap().districts;
        assert!(
            (2..=8).contains(&districts.len()),
            "{} districts",
            districts.len()
        );
        assert!(districts.iter().all(|d| !d.role.is_empty()));
        assert!(districts.iter().all(|d| (0.0..=1.0).contains(&d.wealth)));
        let pr = parts[0].programme.as_ref().unwrap();
        let has = |prefix: &str| pr.allocations.iter().any(|a| a.role.starts_with(prefix));
        assert!(has("worship."), "no worship building");
        assert!(has("commerce.market"), "no market");
        let frame = Frame::new(layout, &pr.environment);
        let inn = pr
            .allocations
            .iter()
            .filter(|a| a.role == "commerce.inn")
            .map(|a| {
                let p = parts[0]
                    .parcels
                    .iter()
                    .find(|p| p.id == a.parcel_id)
                    .unwrap();
                frame.gate_distance(g::centroid(&p.shape)) / frame.radius
            })
            .fold(f64::INFINITY, f64::min);
        assert!(inn < 0.45, "inn far from every gate: {inn}");
        let domestic = pr
            .demands
            .iter()
            .find(|d| d.function == "domestic")
            .unwrap();
        let mut by_role = BTreeMap::<&str, (usize, f64)>::new();
        for a in &pr.allocations {
            let e = by_role.entry(a.role.as_str()).or_default();
            e.0 += 1;
            e.1 += a.households;
        }
        eprintln!(
            "districts {:?}
roles {by_role:?}
parcels {} demands {:?}; quarters {quarters_ms} ms, parcels+alloc {parcels_ms} ms, allocate {allocate_us:.1} us/parcel",
            districts.iter().map(|d| (&d.role, d.wealth, d.quarters.len())).collect::<Vec<_>>(),
            parts[0].parcels.len(),
            pr.demands.iter().map(|d| (&d.role, d.requested.round(), d.parcel_capacity.round())).collect::<Vec<_>>()
        );
        assert!(
            domestic.parcel_capacity + 0.01 >= domestic.requested,
            "domestic land deficit {} / {}",
            domestic.parcel_capacity,
            domestic.requested
        );
        assert!(pr.allocations.iter().any(|a| a.households > 1.0) || domestic.requested < 1000.0);
        // Buildable = admissible for housing; vacant = buildable without any use.
        let used: std::collections::BTreeSet<_> = pr
            .allocations
            .iter()
            .map(|a| a.parcel_id.as_str())
            .collect();
        let buildable: Vec<_> = parts[0]
            .parcels
            .iter()
            .filter(|p| matches!(p.use_kind.as_str(), "plot" | "compound"))
            .collect();
        let vacant = buildable
            .iter()
            .filter(|p| !used.contains(p.id.as_str()))
            .count();
        let mut roles = BTreeMap::<&str, usize>::new();
        for a in &pr.allocations {
            *roles.entry(a.role.as_str()).or_default() += 1;
        }
        eprintln!(
            "districts {:?}\nroles {roles:?}\nplots {} vacant {vacant}; quarters {quarters_ms} ms, parcels+alloc {parcels_ms} ms",
            districts
                .iter()
                .map(|d| (&d.role, d.wealth, d.quarters.len()))
                .collect::<Vec<_>>(),
            buildable.len()
        );
        assert!(
            (vacant as f64) < 0.10 * buildable.len() as f64,
            "{vacant} vacant of {} buildable plots",
            buildable.len()
        );
    }

    /// Invariant: in a harbour town every `quay` service stands on a block a
    /// quay serves, and the port district covers that quay frontage (all of
    /// it but the nucleus quarter's). Synthetic sea to the east, Roman town.
    #[test]
    fn port_roles_stand_on_quay_blocks_inside_the_quay_district() {
        let (n, width) = (96, 2400.0);
        let cell = width / n as f64;
        let sea = |i: usize| (i % n) as f64 * cell + cell * 0.5 > 1500.0;
        let height: Vec<f32> = (0..n * n)
            .map(|i| {
                if sea(i) {
                    5.0
                } else {
                    8.0 - (i % n) as f32 * 0.03
                }
            })
            .collect();
        let water: Vec<u8> = (0..n * n).map(|i| u8::from(sea(i))).collect();
        let surface = Surface {
            geometry: None,
            width,
            n,
            height: &height,
            water: &water,
            interpolation: Default::default(),
        };
        let road = |a: (f64, f64), b: (f64, f64)| Street {
            path: vec![Point { x: a.0, y: a.1 }, Point { x: b.0, y: b.1 }],
            widths: vec![6.0; 2],
            rank: 1,
            role: "regional".into(),
        };
        let roads = [
            road((100.0, 1200.0), (1480.0, 1200.0)),
            road((1250.0, 100.0), (1250.0, 2300.0)),
        ];
        let site = Site {
            key: "harbour".into(),
            name: String::new(),
            population: 6000,
            culture: "roman-core".into(),
            center: Point {
                x: 1250.0,
                y: 1200.0,
            },
            radius: 420.0,
            neighbours: Vec::new(),
        };
        // An open harbour (no sea wall between the town and its quays).
        let config = LayoutConfig {
            fortification: "none".into(),
            ..LayoutConfig::default()
        };
        let layouts = generate_quarters(
            "harbour",
            std::slice::from_ref(&site),
            &config,
            surface,
            &roads,
        )
        .unwrap();
        let parts = generate_parcels("harbour", &layouts, &ParcelConfig::default()).unwrap();
        let (layout, part) = (&layouts[0], &parts[0]);
        let contact = quay_contacts(layout);
        assert!(
            contact.iter().any(|&c| c >= QUAY_FRONT),
            "no quay serves a block"
        );
        let pr = part.programme.as_ref().unwrap();
        let quay_roles: Vec<&str> = pr
            .demands
            .iter()
            .filter(|d| d.site == "quay")
            .map(|d| d.role.as_str())
            .collect();
        let placed: Vec<_> = pr
            .allocations
            .iter()
            .filter(|a| quay_roles.contains(&a.role.as_str()))
            .collect();
        assert!(!placed.is_empty(), "no port role placed: {quay_roles:?}");
        for a in &placed {
            let block = part
                .parcels
                .iter()
                .find(|p| p.id == a.parcel_id)
                .unwrap()
                .block;
            assert!(
                contact[block] >= QUAY_FRONT,
                "{} on block {block} off the quays ({:.1} m)",
                a.role,
                contact[block]
            );
        }
        let structure = layout.structure.as_ref().unwrap();
        let port: Vec<usize> = structure
            .districts
            .iter()
            .filter(|d| d.role == "port")
            .flat_map(|d| d.quarters.clone())
            .collect();
        let nucleus = layout
            .quarters
            .iter()
            .position(|q| g::contains(&q.shape, layout.center));
        let env = &pr.environment;
        for (bi, b) in layout.blocks.iter().enumerate() {
            if contact[bi] >= QUAY_FRONT && !env[bi].wet && Some(b.quarter) != nucleus {
                assert!(
                    port.contains(&b.quarter),
                    "quay block {bi} (quarter {}) outside the port {port:?}",
                    b.quarter
                );
            }
        }
    }
