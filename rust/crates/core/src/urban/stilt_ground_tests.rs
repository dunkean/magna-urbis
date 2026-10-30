//! Stream X contracts: effective ground is shared by planning and programme;
//! the original wet terrain is retained for site requests, never construction proof.
use super::*;

fn shore_water(n: usize, width: f64, bank: f64) -> Vec<u8> {
    (0..n * n)
        .map(|k| u8::from(((k % n) as f64 + 0.5) * width / n as f64 > bank))
        .collect()
}
fn site(population: u32) -> Site {
    Site {
        key: "shared-stilt-ground".into(), name: String::new(), population,
        culture: "stilt-town".into(), center: Point { x: 400.0, y: 500.0 }, radius: 120.0,
    }
}
fn at_bank(layout: &Layout, ground: &geography::StiltGround) {
    assert_eq!(layout.center.x.to_bits(), ground.site.center.x.to_bits());
    assert_eq!(layout.center.y.to_bits(), ground.site.center.y.to_bits());
}
/// Re-evaluate only the public programme contract on the retained real blocks.
/// prepare changes reservation kinds but not their geometry. Compare wetness,
/// height and slope, independently of reservation/role choices on this replay.
fn environment_matches(layout: &Layout, population: u32, surface: Surface<'_>) -> Vec<bool> {
    let programme = layout.programme.as_ref().unwrap();
    assert_eq!(programme.environment.len(), layout.blocks.len());
    let mut replay = layout.clone();
    programme::prepare(&mut replay, population, &programme.context, surface).unwrap();
    let expected = &replay.programme.as_ref().unwrap().environment;
    for (actual, expected) in programme.environment.iter().zip(expected) {
        assert_eq!(actual.block, expected.block);
        assert_eq!(actual.wet, expected.wet, "block {} uses different ground", actual.block);
        assert_eq!(actual.height.to_bits(), expected.height.to_bits());
        assert_eq!(actual.slope.to_bits(), expected.slope.to_bits());
    }
    expected.iter().map(|e| e.wet).collect()
}

#[test]
fn stilt_entry_small_kind_receives_the_same_bank_and_ground_as_programme() {
    let n = 200;
    let height = vec![20.0; n * n];
    let water = shore_water(n, 1000.0, 600.0);
    let saved_water = water.clone();
    let surface = Surface { geometry: None, width: 1000.0, n, height: &height, water: &water };
    let site = site(100);
    let ground = geography::stilt_ground(&site, &site.culture, surface).unwrap();
    assert!((ground.site.center.x - site.center.x).abs() > 150.0);
    let cfg = LayoutConfig { settlement_form: "hamlet".into(), fortification: "none".into(), ..Default::default() };
    let layout = generate_quarters("shared-small-kind", std::slice::from_ref(&site), &cfg, surface, &[])
        .unwrap().remove(0);
    assert_eq!(layout.archetype, "hamlet");
    assert_eq!(layout.structure.as_ref().unwrap().mechanism, "kind", "exercise the small-kind branch");
    at_bank(&layout, &ground);
    environment_matches(&layout, site.population, ground.surface(surface));
    assert_eq!(water, saved_water, "original native terrain must not be overwritten");
    assert_eq!(site.center.x, 400.0, "caller site remains untouched");
    assert_eq!(serde_json::to_value(layout.config.unwrap()).unwrap(), serde_json::to_value(cfg).unwrap());
}

#[test]
fn stilt_entry_culture_override_controls_ground_without_affecting_other_cultures() {
    let n = 100;
    let height = vec![20.0; n * n];
    let water = shore_water(n, 1000.0, 600.0);
    let surface = Surface { geometry: None, width: 1000.0, n, height: &height, water: &water };
    let mut site = site(100);
    let mut cfg = LayoutConfig { culture: "european-organic".into(), settlement_form: "hamlet".into(), fortification: "none".into(), ..Default::default() };
    assert!(geography::stilt_ground(&site, &cfg.culture, surface).is_none());
    let ordinary = generate_quarters("shared-override", std::slice::from_ref(&site), &cfg, surface, &[])
        .unwrap().remove(0);
    assert_eq!(ordinary.culture, "european-organic");
    assert_eq!(ordinary.center, site.center);
    environment_matches(&ordinary, site.population, surface);
    site.culture = "european-organic".into();
    cfg.culture = "stilt-town".into();
    let ground = geography::stilt_ground(&site, &cfg.culture, surface).unwrap();
    let overridden = generate_quarters("shared-override", std::slice::from_ref(&site), &cfg, surface, &[])
        .unwrap().remove(0);
    assert_eq!(overridden.culture, "stilt-town");
    at_bank(&overridden, &ground);
    environment_matches(&overridden, site.population, ground.surface(surface));
}

#[test]
fn stilt_entry_keeps_stilt_bank_priority_over_a_second_port_relocation() {
    let n = 200;
    let height = vec![20.0; n * n];
    let water = shore_water(n, 1000.0, 600.0);
    let surface = Surface { geometry: None, width: 1000.0, n, height: &height, water: &water };
    let mut site = site(2000);
    site.radius = 360.0; // 160 m stilt reach, further than the harbour's 90 m front.
    let mut cfg = LayoutConfig { fortification: "none".into(), ..Default::default() };
    cfg.programme.functions = Some(crate::urban::programme::ProgrammeFunctions { port: 1.0, ..Default::default() });
    let ground = geography::stilt_ground(&site, &site.culture, surface).unwrap();
    let effective_surface = ground.surface(surface);
    assert!(macroplan::harbour::sited(&ground.site, &cfg, effective_surface).is_some(),
        "the competing port relocation must actually be available");
    let (_, kind) = kinds::effective(&site, &cfg, &[]);
    assert!(!kind.small());
    let actual = generate_quarters("shared-port", &[site], &cfg, surface, &[]).unwrap().remove(0);
    at_bank(&actual, &ground);
    // Neighbourhoods may balance around the anchor; the port cannot move it.
    let parts = generate_parcels("shared-port", std::slice::from_ref(&actual), &ParcelConfig::default()).unwrap();
    let pr = parts[0].programme.as_ref().unwrap();
    assert!(parts[0].parcels.iter().any(|p| surface.wet(geometry::interior_point(p.envelope.as_ref().unwrap_or(&p.shape)))
        && pr.allocations.iter().any(|a| a.parcel_id == p.id && a.households > 0.)));
    environment_matches(&actual, 2000, effective_surface);
}

fn f32_le(bytes: &[u8]) -> Vec<f32> {
    assert_eq!(bytes.len() % 4, 0);
    bytes.chunks_exact(4).map(|b| f32::from_le_bytes(b.try_into().unwrap())).collect()
}

#[test]
fn stilt_entry_p29_shared_surface_allocates_wet_lots_and_exports_real_water_levels() {
    let request: Value = serde_json::from_str(include_str!("../../tests/fixtures/stilt-ground/p29-request.json")).unwrap();
    let raster: Value = serde_json::from_str(include_str!("../../tests/fixtures/stilt-ground/p29.json")).unwrap();
    let height = f32_le(include_bytes!("../../tests/fixtures/stilt-ground/p29.height"));
    let levels = f32_le(include_bytes!("../../tests/fixtures/stilt-ground/p29.level"));
    let water = include_bytes!("../../tests/fixtures/stilt-ground/p29.water");
    let n = raster["n"].as_u64().unwrap() as usize;
    assert_eq!(height.len(), n * n);
    assert_eq!(levels.len(), n * n);
    assert_eq!(water.len(), n * n);
    let surface = Surface { geometry: None, width: raster["width"].as_f64().unwrap(), n, height: &height, water };
    let sites: Vec<Site> = serde_json::from_value(request["sites"].clone()).unwrap();
    let roads: Vec<Street> = serde_json::from_value(request["roads"].clone()).unwrap();
    let cfg: LayoutConfig = serde_json::from_value(request["layoutConfig"].clone()).unwrap();
    let seed = request["seed"].as_str().unwrap();
    assert_eq!(sites.len(), 1);
    assert_eq!(sites[0].culture, "stilt-town");
    assert_eq!(sites[0].population, 2000);
    let ground = geography::stilt_ground(&sites[0], "stilt-town", surface).unwrap();
    let layouts = generate_quarters(seed, &sites, &cfg, surface, &roads).unwrap();
    let layout = &layouts[0];
    let shared_wet = environment_matches(layout, sites[0].population, ground.surface(surface));
    let mut raw_replay = layout.clone();
    programme::prepare(&mut raw_replay, sites[0].population, &layout.programme.as_ref().unwrap().context, surface).unwrap();
    let made_available = shared_wet.iter().zip(&raw_replay.programme.as_ref().unwrap().environment)
        .filter(|(effective, raw)| !**effective && raw.wet).count();
    assert!(made_available > 0, "P29 must exercise genuinely wet native ground, not just a moved dry town");
    let partitions = generate_parcels(seed, &layouts, &ParcelConfig::default()).unwrap();
    let partition = &partitions[0];
    let wet_lots = partition.parcels.iter().filter(|p| surface.wet(geometry::centroid(&p.shape))).count();
    let allocated_wet = partition.programme.as_ref().unwrap().allocations.iter().filter(|a|
        partition.parcels.iter().any(|p| p.id == a.parcel_id && surface.wet(geometry::centroid(&p.shape)))
    ).count();
    assert!(wet_lots > 0 && allocated_wet > 0, "P29 must allocate real wet lots");
    // IMPORTANT: export uses the ORIGINAL native surface, not the dry planning mask.
    let requests = building_sites::requests(seed, &layouts, &partitions, surface, &levels, None).unwrap();
    let mut water_requests = 0;
    for r in &requests {
        let origin: Point = serde_json::from_value(r["terrain"]["origin"].clone()).unwrap();
        let z = &r["terrain"]["water_z_m"];
        assert_eq!(z.is_number(), surface.wet(origin), "{} must retain original water evidence", r["id"]);
        if let Some(z) = z.as_f64() {
            let x = ((origin.x / surface.width * n as f64).floor().clamp(0.0, (n - 1) as f64)) as usize;
            let y = ((origin.y / surface.width * n as f64).floor().clamp(0.0, (n - 1) as f64)) as usize;
            assert_eq!(z.to_bits(), f64::from(levels[y * n + x]).to_bits());
            water_requests += 1;
        }
    }
    assert!(water_requests > 0, "wet planned lots must retain a water-level witness in actual site requests");
    println!("P29 current source: shared_dry_blocks={made_available}; wet_lots={wet_lots}; allocated_wet={allocated_wet}; requests_with_water_z={water_requests}; constructed_buildings=UNVERIFIED");
}

#[test]
fn tidal_settlements_build_a_real_share_of_their_occupied_lots_over_water() {
    let n = 240;
    let width = 4000.;
    let height = vec![1.; n*n];
    let water = shore_water(n, width, 2000.);
    let surface = Surface { geometry:None, width, n, height:&height, water:&water };
    let mut shares = vec![];
    let mut footprint_shares = vec![];
    for population in [500, 10000] {
        let site = Site { key:"tidal-share".into(), name:String::new(), population,
            culture:"merfolk-tidal".into(), center:Point { x:1900., y:2000. },
            radius:if population == 500 { 150. } else { 650. } };
        let cfg = LayoutConfig { fortification:"none".into(), ..Default::default() };
        let layouts = generate_quarters("tidal-share", &[site], &cfg, surface, &[]).unwrap();
        let parts = generate_parcels("tidal-share", &layouts, &ParcelConfig::default()).unwrap();
        let pr = parts[0].programme.as_ref().unwrap();
        let lots: Vec<_> = parts[0].parcels.iter().filter(|p| pr.allocations.iter()
            .any(|a| a.parcel_id == p.id && !a.role.starts_with("open.") && !matches!(a.function.as_str(),"common"|"market"))).collect();
        let wet = lots.iter().filter(|p| surface.wet(geometry::interior_point(p.envelope.as_ref().unwrap_or(&p.shape)))).count();
        let share = wet as f64 / lots.len().max(1) as f64;
        println!("TIDAL {population}: wet {wet}/{} = {share:.3}",lots.len());
        let levels = vec![2.; n*n];
        let mut index = building_sites::BuildingSiteIndex::prepare(&layouts, &parts, &[0]).unwrap();
        let (mut offset,mut built,mut over_water) = (0,0,0);
        loop {
            let page = index.page("tidal-share", &layouts, &parts, surface, &levels, None, offset, 64, 24*1024*1024).unwrap();
            offset += page.requests.len();
            for r in &page.requests {
                let Some(shape) = r["preview"].as_array().and_then(|s|s.first()) else { continue };
                let shape: Shape = serde_json::from_value(shape.clone()).unwrap();
                built += 1;
                if surface.wet(geometry::centroid(&shape)) {
                    over_water += 1;
                    if pr.allocations.iter().any(|a| r["parcel_id"] == a.parcel_id && a.households > 0.) {
                        assert!(r["programme"]["massing"].as_array().unwrap().iter().any(|m|
                            m["volumes"].as_array().unwrap().iter().any(|v|v["stilts_m"].as_f64().is_some_and(|h|h>0.))),
                            "a tidal house over water needs stilts");
                    }
                }
            }
            if offset == page.total || page.requests.is_empty() { break; }
        }
        let built_share = over_water as f64 / built.max(1) as f64;
        println!("TIDAL {population}: actual footprints over water {over_water}/{built} = {built_share:.3}");
        footprint_shares.push((population,built_share));
        assert!(lots.iter().all(|p| p.access.as_ref().is_some_and(|a| a.kind != "unserved")), "occupied tidal lots need access");
        assert!(layouts[0].streets.iter().any(|s| s.role == "pier" && s.path.windows(2).any(|w|
            surface.wet(Point { x:(w[0].x+w[1].x)*0.5, y:(w[0].y+w[1].y)*0.5 }))), "waterfront homes need boardwalks");
        shares.push((population,share));
    }
    assert!(shares.iter().all(|(_,s)| (0.30..=0.55).contains(s)), "over-water shares {shares:?}");
    assert!(footprint_shares.iter().all(|(_,s)| (0.30..=0.55).contains(s)), "actual over-water shares {footprint_shares:?}");
}
