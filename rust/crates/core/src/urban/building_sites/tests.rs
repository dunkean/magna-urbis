use super::*;

#[test]
fn ground_patch_retains_physical_cell_spacing() {
    let height: Vec<f32> = (0..64 * 64).map(|i| (i % 64) as f32 + 0.5).collect();
    let water = vec![0; 16 * 16];
    let surface = Surface { geometry: None, width: 64.0, n: 16, height: &height, water: &water, interpolation: Default::default(),};
    let shape = super::super::Shape {
        outer: vec![Point { x: 20.0, y: 20.0 }, Point { x: 22.0, y: 20.0 },
            Point { x: 22.0, y: 22.0 }, Point { x: 20.0, y: 22.0 }], holes: vec![],
    };
    let patch = ground_patch(surface, &shape);
    assert_eq!(patch["step_m"], 1.0);
    assert_eq!(patch["origin"]["x"], 18.5);
    assert_eq!(patch["elevations_m"][0], 18.5);
    let empty = super::super::Shape { outer: vec![], holes: vec![] };
    assert!(ground_patch(surface, &empty).is_null());
    let mut invalid = shape.clone();
    invalid.outer[0].x = f64::INFINITY;
    assert!(ground_patch(surface, &invalid).is_null());
}

#[test]
fn spline_ground_patch_exports_sampled_metres_not_control_values() {
    let mut controls = vec![0.0; 64 * 64];
    controls[18 * 64 + 18] = 100.0;
    let water = vec![0; 16 * 16];
    let surface = Surface { geometry: None, width: 64.0, n: 16, height: &controls, water: &water,
        interpolation: super::super::HeightInterpolation::BSpline { floor: 0.0 } };
    let shape = super::super::Shape { outer: vec![Point { x: 20.0, y: 20.0 }, Point { x: 22.0, y: 20.0 },
        Point { x: 22.0, y: 22.0 }, Point { x: 20.0, y: 22.0 }], holes: vec![] };
    let patch = ground_patch(surface, &shape);
    let sampled = surface.height_at(Point { x: 18.5, y: 18.5 });
    assert!((patch["elevations_m"][0].as_f64().unwrap() - sampled).abs() < 1e-5);
    assert!(sampled < 100.0);
}

fn native_fits(
    pack: &str,
    culture: &str,
    period: &str,
    strict: bool,
    parcel: &Parcel,
    keep: fn(&NativeProfile) -> bool,
) -> Vec<&'static NativeProfile> {
    let admissible = feasibility::admissible(pack, culture, period, strict);
    feasibility::lot_fit(parcel, &admissible)
        .fits
        .into_iter()
        .filter(|w| keep(w))
        .collect()
}

fn paging_fixture() -> (Vec<Layout>, Vec<Partition>) {
    let shape = |x: f64, y: f64, w: f64, d: f64| {
        json!({
            "outer":[{"x":x,"y":y},{"x":x+w,"y":y},{"x":x+w,"y":y+d},{"x":x,"y":y+d}],
            "holes":[]
        })
    };
    let culture = super::super::culture::mapping("european-organic").unwrap();
    let mut layouts = Vec::new();
    let mut partitions = Vec::new();
    for (k, count) in [("démo-a", 10), ("démo-b", 4)] {
        let y = if k == "démo-a" { 101. } else { 201. };
        let mut parcels = Vec::new();
        let mut allocations = Vec::new();
        let mut adjacency = Vec::new();
        for i in 0..count {
            let id = format!("{k}/lot-{i}");
            let lot = shape(20. + i as f64 * 12., y, 12., 26.);
            parcels.push(json!({"id":id,"shape":lot,"block":0,"use":"domestic",
                "front":null,"axis":{"x":1.,"y":0.},"rank":0,"pressure":0.85,"family":"frontage"}));
            let function = if i == 3 {
                "market"
            } else if i == 4 {
                "mixed"
            } else {
                "domestic"
            };
            allocations.push(json!({"parcelId":id,"demandId":"demand","function":function,
                "culture":"european-organic","architecturePack":"EUR-MED","capacity":1.,
                "unit":"domesticUnits","score":1.,"reasons":[],
                "role":if i==2 { "open.garden" } else if i==3 { "commerce.market" } else { "dwelling" }}));
            if i > 0 {
                adjacency
                    .push(json!({"a":format!("{k}/lot-{}",i-1),"b":id,"sharedLength":26.}));
            }
        }
        let programme = json!({"version":1,"population":2500,"context":{},"cultures":[culture],
            "demands":[],"reservations":[],"allocations":allocations,"adjacency":adjacency,
            "environment":[],"reconciliationPasses":0,"warnings":[]});
        let layout: Layout = serde_json::from_value(json!({"key":k,"culture":"european-organic",
            "config":{},"programme":programme,"center":{"x":70.,"y":y+13.},
            "quarters":[{"shape":shape(20.,y,120.,26.),"phase":0,"zone":"core"}],
            "streets":[{"path":[{"x":0.,"y":y-1.},{"x":160.,"y":y-1.}],"widths":[2.,2.],"rank":0,"role":"local"}],
            "blocks":[{"shape":shape(20.,y,120.,26.),"quarter":0,"kind":"housing","axis":{"x":1.,"y":0.},"zone":"core"}],
            "warnings":[],"structure":{"districts":[
                {"id":0,"center":0,"phase":0,"tissue":"organic","quarters":[0],"role":"commoner","wealth":0.2},
                {"id":1,"center":0,"phase":0,"tissue":"grid","quarters":[0],"role":"elite","wealth":0.9}
            ]}})).unwrap();
        layouts.push(layout);
        partitions.push(
            serde_json::from_value(json!({"key":k,"config":{},"parcels":parcels,
            "programme":programme,"warnings":[]}))
            .unwrap(),
        );
    }
    (layouts, partitions)
}

#[test]
fn block_building_type_reaches_all_its_parcels_and_a_lot_can_override_it() {
    let (layouts, mut partitions) = paging_fixture();
    let partition = &mut partitions[0];
    let special = partition.parcels[0].id.clone();
    partition.config.as_mut().unwrap().overrides.blocks.insert("0".into(), serde_json::from_value(json!({"role":"worship.temple"})).unwrap());
    partition.config.as_mut().unwrap().overrides.parcels.insert(special.clone(), serde_json::from_value(json!({"role":"civic.wizard-tower"})).unwrap());
    super::super::programme::allocate(&layouts[0], partition);
    let allocations = &partition.programme.as_ref().unwrap().allocations;
    assert!(!allocations.is_empty());
    assert!(allocations.iter().any(|a| a.parcel_id == special && a.role == "civic.wizard-tower"));
    assert!(allocations.iter().filter(|a| a.parcel_id != special).all(|a| a.role == "worship.temple"));
}

#[test]
fn selected_area_culture_replaces_every_house_tissue_deterministically() {
    let (mut layouts, mut partitions) = paging_fixture();
    layouts[0].config.as_mut().unwrap().overrides.quarters.insert("0".into(), serde_json::from_value(json!({"culture":"elven"})).unwrap());
    for parcel in &partitions[0].parcels {
        assert_eq!(drawn_culture(None, "same-seed", &layouts[0], &partitions[0], parcel, "dwelling", "domestic"), Some(("elven".into(), true)));
    }
    // A block's explicit style must select its whole tissue too, rather
    // than borrowing a new pack while retaining the old ground-house form.
    partitions[0].config.as_mut().unwrap().overrides.blocks.insert("0".into(), serde_json::from_value(json!({"culture":"elven"})).unwrap());
    let profile = json!({"houses":{"blocks":{"0":{"styles":[{"culture":"elven","weight":1}]}}}}).to_string();
    for seed in ["same-seed", "rerolled"] {
        for parcel in &partitions[0].parcels {
            assert_eq!(drawn_culture(Some(&profile), seed, &layouts[0], &partitions[0], parcel, "dwelling", "domestic"), Some(("elven".into(), true)));
        }
    }
}

#[test]
fn local_house_styles_override_the_parcel_quarter_and_city_independently() {
    let (mut layouts, mut partitions) = paging_fixture();
    let id = partitions[0].parcels[0].id.clone();
    layouts[0].config.as_mut().unwrap().overrides.quarters.insert("0".into(), serde_json::from_value(json!({
        "culture":"medina", "buildingCulture":"medina", "houseConfig":{"wealth":0.8,"overrides":{"roof":"RF-FLAT"}}
    })).unwrap());
    partitions[0].config.as_mut().unwrap().overrides.parcels.insert(id.clone(), serde_json::from_value(json!({
        "culture":"byzantine-greek", "houseConfig":{"pack":"AS-CHI","overrides":{"floors":2}}
    })).unwrap());
    let (layout, partition) = (&layouts[0], &partitions[0]);
    let parcel = &partition.parcels[0];
    assert_eq!(drawn_culture(None,"seed",layout,partition,parcel,"dwelling","domestic").unwrap().0,"byzantine-greek");
    let profile = json!({"houses":{"buildings":{format!("{id}/building"):{"styles":[{"culture":"myconid-colony","weight":1}]}}}}).to_string();
    assert_eq!(drawn_culture(Some(&profile),"seed",layout,partition,parcel,"dwelling","domestic").unwrap().0,"myconid-colony");
    assert_eq!(layout.culture,"european-organic");
    let mut request = json!({"config":{"pack":"EUR-MED","recipe":"old","mode":"historical_inspired","overrides":{}},"culture":{},"native_minimum_candidates":[{}]});
    inherit_house_config(&mut request,layout,partition,parcel);
    assert_eq!(request["config"]["wealth"],0.8);
    assert_eq!(request["config"]["overrides"]["roof"],"RF-FLAT");
    assert_eq!(request["config"]["overrides"]["floors"],2);
    assert_eq!(request["config"]["recipe"],Value::Null);
    assert_eq!(request["culture"]["pack"],"AS-CHI");
    assert!(request.get("native_minimum_candidates").is_none());
}

#[test]
fn pages_match_collect_and_only_build_requested_sites_with_exact_byte_budgets() {
    let (layouts, partitions) = paging_fixture();
    let heights = vec![20.; 16 * 16];
    let water = vec![0; heights.len()];
    let surface = Surface {
        geometry: None,
        width: 512.,
        n: 16,
        height: &heights,
        water: &water,
        interpolation: Default::default(),
    };
    let seed = "paged-sites";
    let collected = requests(seed, &layouts, &partitions, surface, &heights, None).unwrap();
    assert_eq!(
        collected.len(),
        12,
        "gardens omitted; open markets retained"
    );
    assert!(collected.iter().any(|r| r["function"] == "open_space"));
    assert!(collected.iter().any(|r| {
        r["party_boundaries"]
            .as_array()
            .is_some_and(|a| !a.is_empty())
    }));
    let first = &collected[0];
    assert_eq!(first["id"], "démo-a/lot-0/building");
    assert_eq!(first["seed"], "paged-sites/démo-a/lot-0");
    assert_eq!(
        first["programme"]["district_role"], "elite",
        "last district metadata still wins"
    );
    assert_eq!(first["programme"]["wealth"], 0.9);
    assert!(first["programme"]["floors"].is_array());
    assert!(first["config"]["overrides"]["floors"].is_null());
    assert!(first["programme"]["composition"].is_string());
    assert!(
        !first["accesses"].as_array().unwrap().is_empty(),
        "fallback frontage exercised"
    );
    assert!(
        !first["terrain"]["grid"]["elevations_m"]
            .as_array()
            .unwrap()
            .is_empty()
    );

    for limit in [1, 7, 64] {
        let mut index = BuildingSiteIndex::prepare(&layouts, &partitions, &[0, 1]).unwrap();
        assert_eq!(index.generated.load(std::sync::atomic::Ordering::Relaxed), 0, "opening must not build payloads");
        assert!(
            index
                .partitions
                .iter()
                .flat_map(|p| &p.tissues)
                .all(|t| t.get().is_none()),
            "unrequested block/culture morphologies remain lazy"
        );
        assert_eq!(index.total(), collected.len());
        let mut actual = Vec::new();
        while actual.len() < index.total() {
            let offset = actual.len();
            let page = index
                .page(
                    seed,
                    &layouts,
                    &partitions,
                    surface,
                    &heights,
                    None,
                    offset,
                    limit,
                    MAX_SITE_PAGE_BYTES,
                )
                .unwrap();
            assert_eq!(page.offset, offset);
            assert_eq!(page.next, offset + page.requests.len());
            assert_eq!(page.total, collected.len());
            assert!(page.required_bytes.is_none());
            actual.extend(page.requests);
            assert_eq!(
                index.generated.load(std::sync::atomic::Ordering::Relaxed),
                actual.len(),
                "no lookahead beyond requested count"
            );
        }
        assert_eq!(
            serde_json::to_vec(&actual).unwrap(),
            serde_json::to_vec(&collected).unwrap()
        );
    }

    let mut index = BuildingSiteIndex::prepare(&layouts, &partitions, &[0, 1]).unwrap();
    let first_bytes = serde_json::to_vec(&vec![first]).unwrap().len();
    assert_eq!(
        first_bytes,
        json_bytes(first).unwrap() + 2,
        "UTF-8 and array framing counted exactly"
    );
    let empty = index
        .page(
            seed,
            &layouts,
            &partitions,
            surface,
            &heights,
            None,
            0,
            7,
            first_bytes - 1,
        )
        .unwrap();
    assert!(empty.requests.is_empty());
    assert_eq!(
        (empty.offset, empty.next, empty.required_bytes),
        (0, 0, Some(first_bytes))
    );
    assert!(
        index.generated.load(std::sync::atomic::Ordering::Relaxed) <= 7,
        "a page generates at most its own limit"
    );
    let partial = index
        .page(
            seed,
            &layouts,
            &partitions,
            surface,
            &heights,
            None,
            0,
            7,
            first_bytes,
        )
        .unwrap();
    assert_eq!(partial.requests, vec![first.clone()]);
    assert_eq!(partial.next, 1);
    assert_eq!(
        partial.required_bytes,
        Some(json_bytes(&collected[1]).unwrap() + 2)
    );
    let replay = index
        .page(
            seed,
            &layouts,
            &partitions,
            surface,
            &heights,
            None,
            0,
            7,
            first_bytes,
        )
        .unwrap();
    assert_eq!(
        serde_json::to_value(&partial).unwrap(),
        serde_json::to_value(&replay).unwrap()
    );
    let end = index
        .page(
            seed,
            &layouts,
            &partitions,
            surface,
            &heights,
            None,
            index.total(),
            64,
            2,
        )
        .unwrap();
    assert!(end.requests.is_empty());
    assert_eq!(end.next, index.total());
    assert!(end.required_bytes.is_none());

    let mut selected = BuildingSiteIndex::prepare(&layouts, &partitions, &[1]).unwrap();
    let page = selected
        .page(
            seed,
            &layouts,
            &partitions,
            surface,
            &heights,
            None,
            0,
            64,
            MAX_SITE_PAGE_BYTES,
        )
        .unwrap();
    assert_eq!(page.requests, collected[9..]);
    let changed = selected
        .page(
            "new-seed",
            &layouts,
            &partitions,
            surface,
            &heights,
            Some("bastide"),
            0,
            1,
            MAX_SITE_PAGE_BYTES,
        )
        .unwrap();
    assert_eq!(changed.requests[0]["seed"], "new-seed/démo-b/lot-0");
    assert_eq!(
        changed.requests[0]["culture"]["culture"], "bastide",
        "no candidate cache crosses query bindings"
    );

    let mut invalid = partitions.clone();
    invalid[1].programme.as_mut().unwrap().allocations[3].parcel_id = "missing".into();
    assert!(BuildingSiteIndex::prepare(&layouts, &invalid, &[0, 1]).is_err());
    invalid = partitions.clone();
    invalid[1].programme.as_mut().unwrap().allocations[3].culture = "missing".into();
    assert!(BuildingSiteIndex::prepare(&layouts, &invalid, &[0, 1]).is_err());
}

#[test]
fn fringe_home_request_keeps_preview_area_and_single_storey_massing_together() {
    let (mut layouts, mut partitions) = paging_fixture();
    let layout = &mut layouts[0];
    layout.blocks[0].zone = "faubourg".into(); layout.quarters[0].zone = "faubourg".into();
    partitions[0].config.as_mut().unwrap().zone = "auto".into();
    let context = super::super::house_mix::HomeContext {
        zone:"faubourg", district:"elite", wealth:0.9, pressure:0.85, distance:1.0, outside:false, farm:false, low_rural:true,
    };
    let seed = (0..100).map(|k| format!("houses2-request-{k}")).find(|s|
        context.area_scale(&format!("{s}/démo-a/lot-0")) < 1.0).unwrap();
    let site_seed = format!("{seed}/démo-a/lot-0");
    let parcel = &partitions[0].parcels[0];
    let (zone, morph) = super::super::culture::parcel_morph(layout, &partitions[0], "european-organic", 0).unwrap();
    let mapping = super::super::culture::parcel_mapping(layout, parcel, "european-organic", "domestic").unwrap();
    let (original, _) = super::super::parcels::occupation_preview(parcel, &super::super::parcels::Occupancy {
        morph:&morph, zone, function:"domestic", role:"dwelling", landmark:false,
        party_walls:mapping.admissibility.party_walls, wealth:0.9, seed:&site_seed,
        pack:&mapping.architecture_pack, court_lot:false, court_kept:None,
    });
    let heights = vec![20.; 16*16]; let water = vec![0; heights.len()];
    let surface = Surface { geometry:None, width:512., n:16, height:&heights, water:&water, interpolation: Default::default(),};
    let index = BuildingSiteIndex::prepare(&layouts, &partitions, &[0]).unwrap();
    let request = index.request_one(0, &seed, &layouts, &partitions, surface, &heights, None).unwrap();
    let preview: Vec<super::super::Shape> = serde_json::from_value(request["preview"].clone()).unwrap();
    let area = |parts: &[super::super::Shape]| parts.iter().map(super::super::geometry::area).sum::<f64>();
    let original: Vec<_> = original.into_iter().map(|(s,_)| s).collect();
    assert!(area(&original) > 4.0);
    assert!((area(&preview)/area(&original)-context.area_scale(&site_seed)).abs() < 1e-6);
    assert_eq!(request["programme"]["floors"], json!([1,1]));
    for piece in request["programme"]["massing"].as_array().unwrap() { assert_eq!(piece["floors"], 1); }
    assert!((request["programme"]["built_area_m2"].as_f64().unwrap()-area(&preview)).abs() <= 0.051);
}

#[test]
fn village_levels_use_a_real_low_native_recipe() {
    let culture = super::super::culture::mapping("halfling").unwrap();
    assert!(culture.admissibility.floors[0] <= 2);
    assert_ne!(culture.admissibility.recipe_id, "EUR-MED-B08");
    assert_eq!(typical_floors(&culture, "domestic", 200, 1.0), 1);
    let town = super::super::culture::mapping("european-organic").unwrap();
    assert_eq!(typical_floors(&town, "mixed", 2500, 0.9), 2);
    assert_eq!(typical_floors(&town, "workshop", 2500, 0.9), 1);
}

/// Role before tissue (CODEX_ROMAN_COURTYARD_REVIEW.md): in a roman-core
/// core block (domus tissue), a tenement lot holding the pack's insula
/// asks three floors or more, a shop fronts its street as a row, and a
/// domus keeps its court in the preview and the composition alike.
#[test]
fn small_roman_lot_offers_the_insula_variants_that_fit_it() {
    // 9 × 14 m: too small for the B04 court insula (34 × 38 m), large
    // enough for the B13 strip witnesses (6.65 × 10.2 m + 0.6 m).
    let parcel: Parcel = serde_json::from_value(json!({"id":"small","block":0,"use":"plot",
        "shape":{"outer":[{"x":0.,"y":0.},{"x":9.,"y":0.},{"x":9.,"y":14.},{"x":0.,"y":14.}],"holes":[]},
        "front":[{"x":0.,"y":0.},{"x":9.,"y":0.}],"axis":{"x":1.,"y":0.},"rank":1,"pressure":0.5,
        "family":"frontage","contacts":[{"a":{"x":0.,"y":0.},"b":{"x":9.,"y":0.},"street":0,"rank":1,"length":9.,"kind":"public"}]}))
    .unwrap();
    let fits = native_fits(
        "MED-ANT",
        "roman-core",
        "A",
        false,
        &parcel,
        tall_collective,
    );
    assert!(!fits.is_empty() && fits.iter().all(|p| p.recipe_id == "MED-ANT-B13"));
    // Levels come from the variants, by pressure; never 5 from B13.
    assert_eq!(collective_floors(&fits, 0.0), Some([3, 3]));
    assert_eq!(collective_floors(&fits, 1.0), Some([3, 4]));
    // Strict mode never takes an inspired-only source.
    let strict = native_fits("MED-ANT", "roman-core", "A", true, &parcel, tall_collective);
    assert!(collective_floors(&strict, 1.0).is_none());
}
#[test]
fn roman_core_roles_choose_insula_shop_and_domus() {
    let y = 100.;
    let shape = |x: f64, w: f64, d: f64| json!({"outer":[{"x":x,"y":y},{"x":x+w,"y":y},{"x":x+w,"y":y+d},{"x":x,"y":y+d}],"holes":[]});
    let culture = super::super::culture::mapping("roman-core").unwrap();
    let lots = [
        ("tenement", 0., 40., 44., "domestic", "dwelling.tenement"),
        ("shop", 40., 8., 26., "mixed", "dwelling.shop"),
        ("domus", 48., 30., 32., "domestic", "dwelling.courtyard"),
        (
            "small-domus",
            78.,
            20.,
            30.,
            "domestic",
            "dwelling.courtyard",
        ),
    ];
    let (mut parcels, mut allocations) = (vec![], vec![]);
    for (id, x, w, d, function, role) in lots {
        let front = json!([{"x":x,"y":y},{"x":x+w,"y":y}]);
        parcels.push(json!({"id":id,"shape":shape(x, w, d),"block":0,"use":"plot",
            "front":front,"axis":{"x":1.,"y":0.},"rank":1,"pressure":0.9,"family":"frontage",
            "contacts":[{"a":{"x":x,"y":y},"b":{"x":x+w,"y":y},"street":0,"rank":1,"length":w,"kind":"public"}]}));
        allocations.push(
            json!({"parcelId":id,"demandId":"demand","function":function,
            "culture":"roman-core","architecturePack":"MED-ANT","capacity":1.,
            "unit":"domesticUnits","score":1.,"reasons":[],"role":role}),
        );
    }
    let programme = json!({"version":1,"population":5000,"context":{},"cultures":[culture],
        "demands":[],"reservations":[],"allocations":allocations,"adjacency":[],
        "environment":[],"reconciliationPasses":0,"warnings":[]});
    let layout: Layout = serde_json::from_value(json!({"key":"rome","culture":"roman-core",
        "config":{},"programme":programme,"center":{"x":37.,"y":y+22.},
        "quarters":[{"shape":shape(0.,98.,44.),"phase":0,"zone":"core"}],
        "streets":[{"path":[{"x":-10.,"y":y-1.},{"x":90.,"y":y-1.}],"widths":[2.,2.],"rank":1,"role":"local"}],
        "blocks":[{"shape":shape(0.,98.,44.),"quarter":0,"kind":"housing","axis":{"x":1.,"y":0.},"zone":"core"}],
        "warnings":[]}))
    .unwrap();
    let partition: Partition = serde_json::from_value(json!({"key":"rome","config":{},
        "parcels":parcels,"programme":programme,"warnings":[]}))
    .unwrap();
    let heights = vec![20.; 16 * 16];
    let water = vec![0; heights.len()];
    let surface = Surface {
        geometry: None,
        width: 512.,
        n: 16,
        height: &heights,
        water: &water,
        interpolation: Default::default(),
    };
    let sites = requests("rome", &[layout], &[partition], surface, &heights, None).unwrap();
    let site = |id: &str| {
        sites
            .iter()
            .find(|r| r["parcel_id"] == id)
            .unwrap_or_else(|| panic!("{id} site"))
    };
    let holes = |r: &Value| {
        r["preview"]
            .as_array()
            .unwrap()
            .iter()
            .map(|s| s["holes"].as_array().map_or(0, Vec::len))
            .sum::<usize>()
    };
    let tenement = site("tenement");
    assert!(
        tenement["programme"]["floors"][0].as_u64().unwrap() >= 3,
        "{}",
        tenement["programme"]
    );
    // The lot holds the pack's court insula: an Ostia-style court.
    assert_eq!(tenement["programme"]["composition"], "courtyard");
    assert!(holes(tenement) >= 1);
    let shop = site("shop");
    assert_eq!(
        shop["programme"]["frontage_continuity"], 1.0,
        "{}",
        shop["programme"]
    );
    assert_eq!(holes(shop), 0);
    let street_wall = shop["preview"][0]["outer"]
        .as_array()
        .unwrap()
        .iter()
        .map(|p| p["y"].as_f64().unwrap())
        .fold(f64::INFINITY, f64::min);
    assert!(
        street_wall < y + 0.5,
        "the shop fronts its street: {street_wall}"
    );
    let domus = site("domus");
    assert_eq!(domus["programme"]["composition"], "courtyard");
    assert!(holes(domus) >= 1, "a domus keeps its court");
    // 20 × 30 m holds no native Roman court house (B02 needs 28.1 m):
    // the programme asks what the lot holds, never a court houses refuses.
    let small = site("small-domus");
    assert_ne!(small["programme"]["composition"], "courtyard");
}

/// Invariant: a direct native pose is only proposed on a lot its witness
/// fits — the whole site bounds inside the lot, the door facing the
/// declared access, the contact on that access, the body founded within
/// the limit — and never on a lot too narrow or too steep for it.
#[test]
fn native_candidates_only_on_lots_their_witness_fits() {
    let (x, y) = (100.0, 100.0);
    let lot = |w: f64, d: f64| super::super::Shape {
        outer: vec![
            Point { x, y },
            Point { x: x + w, y },
            Point { x: x + w, y: y + d },
            Point { x, y: y + d },
        ],
        holes: vec![],
    };
    let access = |w: f64| {
        vec![
            json!({"id":"lot/street/0","segment":[{"x":x,"y":y},{"x":x+w,"y":y}],
            "kind":"public","width_m":w}),
        ]
    };
    let flat = vec![20.0_f32; 16 * 16];
    let steep: Vec<f32> = (0..16 * 16)
        .map(|i| 20.0 + 0.25 * ((i / 16) as f32 + 0.5) * 32.0)
        .collect();
    let water = vec![0_u8; 16 * 16];
    let level = Surface {
        geometry: None,
        width: 512.,
        n: 16,
        height: &flat,
        water: &water,
        interpolation: Default::default(),
    };
    let slope = Surface {
        geometry: None,
        width: 512.,
        n: 16,
        height: &steep,
        water: &water,
        interpolation: Default::default(),
    };
    let Some(b12) = feasibility::pose_witness("MED-ANT-B12::default") else {
        // A table older than the houses export emits no pose at all.
        assert!(feasibility::pose_witness("MED-ANT-B01::default").is_none());
        return;
    };
    let poses = feasibility::minimum_candidates(b12, &lot(7.0, 12.0), &access(7.0), level);
    assert!(!poses.is_empty() && poses.len() <= 4);
    for c in &poses {
        let t = &c["transform"];
        let (ox, oy) = (
            t["origin"]["x"].as_f64().unwrap(),
            t["origin"]["y"].as_f64().unwrap(),
        );
        let a = t["orientation_deg"].as_f64().unwrap().to_radians();
        let world = |px: f64, py: f64| {
            (
                ox + px * a.cos() - py * a.sin(),
                oy + px * a.sin() + py * a.cos(),
            )
        };
        // Native site bounds of B12 (roof included) inside the lot.
        for (px, py) in [(-0.15, -0.15), (4.65, -0.15), (4.65, 7.2), (-0.15, 7.2)] {
            let (wx, wy) = world(px, py);
            assert!((x - 1e-6..=x + 7.0 + 1e-6).contains(&wx), "{c}");
            assert!((y - 1e-6..=y + 12.0 + 1e-6).contains(&wy), "{c}");
        }
        // The door (native y = 7) faces the street at y = 100.
        assert!(world(1.1, 7.0).1 < world(1.1, 0.0).1);
        let contact = &c["contact"];
        assert!((contact["y"].as_f64().unwrap() - y).abs() < 1e-9);
        let along = contact["x"].as_f64().unwrap() - x;
        assert!((0.425..=7.0 - 0.425).contains(&along));
        assert_eq!(c["access_id"], "lot/street/0");
        assert_eq!(c["identity"]["style_id"], "MED-ANT-B12::default");
    }
    // Too narrow for its 4.8 m site bounds, or too steep to found it.
    assert!(
        feasibility::minimum_candidates(b12, &lot(4.0, 12.0), &access(4.0), level).is_empty()
    );
    assert!(
        feasibility::minimum_candidates(b12, &lot(7.0, 12.0), &access(7.0), slope).is_empty()
    );
}

/// Invariant: a lot on which no source houses may draw has a founded
/// pose is not sent to be drawn and refused, and no smaller house stands
/// for it: it stays open land with an explicit deficit (cause and
/// households), counted by the warning. The same lot on level
/// ground stays a home of the wished composition.
#[test]
fn a_lot_no_native_house_can_found_is_an_explicit_deficit() {
    let y = 100.;
    let shape = |x: f64, w: f64, d: f64| json!({"outer":[{"x":x,"y":y},{"x":x+w,"y":y},{"x":x+w,"y":y+d},{"x":x,"y":y+d}],"holes":[]});
    let culture = super::super::culture::mapping("roman-core").unwrap();
    let parcels = vec![
        json!({"id":"steep","shape":shape(0., 12., 20.),"block":0,"use":"plot",
        "front":[{"x":0.,"y":y},{"x":12.,"y":y}],"axis":{"x":1.,"y":0.},"rank":1,"pressure":0.6,"family":"frontage",
        "contacts":[{"a":{"x":0.,"y":y},"b":{"x":12.,"y":y},"street":0,"rank":1,"length":12.,"kind":"public"}]}),
    ];
    let allocations = vec![
        json!({"parcelId":"steep","demandId":"demand","function":"domestic",
        "culture":"roman-core","architecturePack":"MED-ANT","capacity":1.,"households":2.,
        "unit":"domesticUnits","score":1.,"reasons":[],"role":"dwelling.house"}),
    ];
    let programme = json!({"version":1,"population":5000,"context":{},"cultures":[culture],
        "demands":[],"reservations":[],"allocations":allocations,"adjacency":[],
        "environment":[],"reconciliationPasses":0,"warnings":[]});
    let layout: Layout = serde_json::from_value(json!({"key":"rome","culture":"roman-core",
        "config":{},"programme":programme,"center":{"x":6.,"y":y+10.},
        "quarters":[{"shape":shape(0.,12.,20.),"phase":0,"zone":"core"}],
        "streets":[{"path":[{"x":-10.,"y":y-1.},{"x":30.,"y":y-1.}],"widths":[2.,2.],"rank":1,"role":"local"}],
        "blocks":[{"shape":shape(0.,12.,20.),"quarter":0,"kind":"housing","axis":{"x":1.,"y":0.},"zone":"core"}],
        "warnings":[]}))
    .unwrap();
    let partition: Partition = serde_json::from_value(json!({"key":"rome","config":{},
        "parcels":parcels,"programme":programme,"warnings":[]}))
    .unwrap();
    let water = vec![0; 16 * 16];
    // 14° plane rising away from the street: 1.1 m across any 4.5 m body.
    let steep: Vec<f32> = (0..16 * 16)
        .map(|i| 20.0 + 0.25 * ((i / 16) as f32 + 0.5) * 32.0)
        .collect();
    let flat = vec![20.0_f32; 16 * 16];
    let site = |height: &[f32]| {
        let surface = Surface {
            geometry: None,
            width: 512.,
            n: 16,
            height,
            water: &water,
            interpolation: Default::default(),
        };
        requests(
            "rome",
            std::slice::from_ref(&layout),
            std::slice::from_ref(&partition),
            surface,
            height,
            None,
        )
        .unwrap()
        .remove(0)
    };
    let steep_site = site(&steep);
    assert_eq!(
        steep_site["function"], "open_space",
        "{}",
        steep_site["programme"]
    );
    assert_eq!(steep_site["programme"]["deficit"]["cause"], "pente");
    assert_eq!(steep_site["programme"]["deficit"]["households"], 2.0);
    assert!(steep_site.get("native_minimum_candidates").is_none());
    let warning = deficit_warning(std::slice::from_ref(&steep_site)).unwrap();
    assert!(
        warning == "Unbuilt lots: 1, unhoused households: 2.0 — no fitting building",
        "{warning}"
    );
    let level = site(&flat);
    assert_eq!(level["function"], "domestic");
    assert!(level["programme"].get("deficit").is_none());
    assert!(deficit_warning(std::slice::from_ref(&level)).is_none());
    assert!(level["feasibility"]["fitting_witnesses"].as_u64().unwrap() > 0);
}

/// One-street fixture: rectangular lots side by side on a street at
/// y = 99, the terrain rising away from it by `grade` m per m.
fn lot_sites(
    culture: &str,
    pack: &str,
    lots: &[(&str, f64, f64, f64, &str, &str)],
    grade: f32,
) -> Vec<Value> {
    lot_sites_context(culture,pack,lots,grade,"inspired")
}
fn lot_sites_context(culture:&str,pack:&str,lots:&[(&str,f64,f64,f64,&str,&str)],grade:f32,mode:&str) -> Vec<Value> {
    let y = 100.;
    let shape = |x: f64, w: f64, d: f64| json!({"outer":[{"x":x,"y":y},{"x":x+w,"y":y},{"x":x+w,"y":y+d},{"x":x,"y":y+d}],"holes":[]});
    let mapping = super::super::culture::mapping(culture).unwrap();
    let (mut parcels, mut allocations) = (vec![], vec![]);
    let mut right: f64 = 0.0;
    for &(id, x, w, d, function, role) in lots {
        right = right.max(x + w);
        parcels.push(json!({"id":id,"shape":shape(x, w, d),"block":0,"use":"plot",
            "front":[{"x":x,"y":y},{"x":x+w,"y":y}],"axis":{"x":1.,"y":0.},"rank":1,"pressure":0.6,"family":"frontage",
            "contacts":[{"a":{"x":x,"y":y},"b":{"x":x+w,"y":y},"street":0,"rank":1,"length":w,"kind":"public"}]}));
        allocations.push(
            json!({"parcelId":id,"demandId":"demand","function":function,
            "culture":culture,"architecturePack":pack,"capacity":1.,"households":1.,
            "unit":"domesticUnits","score":1.,"reasons":[],"role":role}),
        );
    }
    let programme = json!({"version":1,"population":5000,"context":{"mode":mode},"cultures":[mapping],
        "demands":[],"reservations":[],"allocations":allocations,"adjacency":[],
        "environment":[],"reconciliationPasses":0,"warnings":[]});
    let layout: Layout = serde_json::from_value(json!({"key":"lots","culture":culture,
        "config":{},"programme":programme,"center":{"x":right*0.5,"y":y+20.},
        "quarters":[{"shape":shape(0.,right,60.),"phase":0,"zone":"core"}],
        "streets":[{"path":[{"x":-10.,"y":y-1.},{"x":right+10.,"y":y-1.}],"widths":[2.,2.],"rank":1,"role":"local"}],
        "blocks":[{"shape":shape(0.,right,60.),"quarter":0,"kind":"housing","axis":{"x":1.,"y":0.},"zone":"core"}],
        "warnings":[]}))
    .unwrap();
    let partition: Partition = serde_json::from_value(json!({"key":"lots","config":{},
        "parcels":parcels,"programme":programme,"warnings":[]}))
    .unwrap();
    let height: Vec<f32> = (0..16 * 16)
        .map(|i| 20.0 + grade * ((i / 16) as f32 + 0.5) * 32.0)
        .collect();
    let water = vec![0; height.len()];
    let surface = Surface {
        geometry: None,
        width: 512.,
        n: 16,
        height: &height,
        water: &water,
        interpolation: Default::default(),
    };
    requests("lots", &[layout], &[partition], surface, &height, None).unwrap()
}
fn site_of<'a>(sites: &'a [Value], id: &str) -> &'a Value {
    sites
        .iter()
        .find(|r| r["parcel_id"] == id)
        .unwrap_or_else(|| panic!("{id} site"))
}

#[test]
#[ignore = "Local frozen Roman replay; requires HOUSES_PIPE_ROMAN_CITY, HOUSES_PIPE_ROMAN_FIXTURE and HOUSES_PIPE_PROOF_DIR"]
fn frozen_roman_preview_keeps_the_current_native_request_budget() {
    #[derive(serde::Deserialize)] #[serde(rename_all="camelCase")]
    struct Fixture {seed:String,n:usize,width:f64,height:Vec<f32>,water:Vec<u8>,water_level:Vec<f32>,geometry:Option<super::super::VectorGeography>}
    let path=|key|std::path::PathBuf::from(std::env::var_os(key).expect(key));
    let city=path("HOUSES_PIPE_ROMAN_CITY");
    let raw:Value=serde_json::from_slice(&std::fs::read(path("HOUSES_PIPE_ROMAN_FIXTURE")).unwrap()).unwrap();
    let t:Fixture=serde_json::from_value(raw).unwrap();
    let layouts:Vec<Layout>=serde_json::from_slice(&std::fs::read(city.join("layouts.json")).unwrap()).unwrap();
    let partitions:Vec<Partition>=serde_json::from_slice(&std::fs::read(city.join("partitions.json")).unwrap()).unwrap();
    let geo=t.geometry.map(|g|super::super::Geography::new(g,t.width).unwrap());
    let surface=Surface{geometry:geo.as_ref(),width:t.width,n:t.n,height:&t.height,water:&t.water, interpolation: Default::default(),};
    struct Mode(bool);
    impl Mode {fn control()->Self{Self(PREVIEW_TOPOLOGY.with(|v|v.replace(false)))}}
    impl Drop for Mode {fn drop(&mut self){PREVIEW_TOPOLOGY.with(|v|v.set(self.0));}}
    let before={let _control=Mode::control();requests(&t.seed,&layouts,&partitions,surface,&t.water_level,None).unwrap()};
    let after=requests(&t.seed,&layouts,&partitions,surface,&t.water_level,None).unwrap();
    assert_eq!(before.len(),after.len());
    for (old,new) in before.iter().zip(&after) {
        assert_eq!(old["id"],new["id"]);
        for field in ["households","housing_floor_need","built_area_m2","floors","role"] {
            assert_eq!(old["programme"][field],new["programme"][field],"{}: {field}",old["id"]);
        }
    }
    let out=path("HOUSES_PIPE_PROOF_DIR");std::fs::create_dir_all(&out).unwrap();
    std::fs::write(out.join("roman-current-control-requests.json"),serde_json::to_vec(&before).unwrap()).unwrap();
    std::fs::write(out.join("roman-requests.json"),serde_json::to_vec(&after).unwrap()).unwrap();
    eprintln!("Roman current Core preview A/B: {} exact IDs; programme budgets, floors and household wishes unchanged",after.len());
}

/// Invariant: a home's wished composition is one whose first houses
/// shortlist group draws a source of the programme's own role among the
/// sources the lot holds (a Roman shop or house never wishes the
/// street-block insula MED-ANT-B13 first, a tenement does), while the
/// street wall stays the wished one.
#[test]
fn roman_homes_wish_the_sources_of_their_own_programme() {
    let sites = lot_sites(
        "roman-core",
        "MED-ANT",
        &[
            ("house", 0., 10., 22., "domestic", "dwelling.house"),
            ("shop", 10., 9., 22., "mixed", "dwelling.shop"),
            ("tenement", 19., 12., 24., "domestic", "dwelling.tenement"),
        ],
        0.0,
    );
    let admissible = feasibility::admissible("MED-ANT", "roman-core", "", false);
    for (id, role) in [
        ("house", "dwelling"),
        ("shop", "mixed_residential"),
        ("tenement", "communal_dwelling"),
    ] {
        let site = site_of(&sites, id);
        let composition = site["programme"]["composition"].as_str().unwrap();
        if matches!(composition,"row"|"detached") {
            assert!(site["preview"].as_array().unwrap().iter().all(|s|s["holes"].as_array().unwrap().is_empty()),"{id}: simple resolved preview kept a closed ring");
        }
        let floors = wish_of(&site["programme"]["floors"]);
        let rank = |w: &NativeProfile| {
            let f = floors.map_or(0, |[lo, hi]| {
                w.floors[0]
                    .saturating_sub(hi)
                    .max(lo.saturating_sub(w.floors[1]))
            });
            (feasibility::composition_rank(composition, w), f)
        };
        let parcel: Parcel = serde_json::from_value(json!({"id":id,"shape":site["cadastral"][0],
            "block":0,"use":"plot","axis":{"x":1.,"y":0.},"rank":1,"family":"frontage",
            "contacts":[{"a":site["accesses"][0]["segment"][0],"b":site["accesses"][0]["segment"][1],
                "street":0,"rank":1,"length":site["accesses"][0]["width_m"],"kind":"public"}]}))
        .unwrap();
        let fits = feasibility::lot_fit(&parcel, &admissible).fits;
        let first = fits.iter().map(|w| rank(w)).min().unwrap();
        assert!(
            fits.iter().any(|w| rank(w) == first && w.role == role),
            "{id}: {composition} {}",
            site["programme"]
        );
    }
    assert_eq!(
        site_of(&sites, "house")["programme"]["composition"],
        "detached"
    );
    assert_eq!(
        site_of(&sites, "shop")["programme"]["composition"],
        "detached"
    );
    assert_eq!(
        site_of(&sites, "tenement")["programme"]["composition"],
        "row"
    );
    assert_eq!(
        site_of(&sites, "shop")["programme"]["frontage_continuity"],
        1.0
    );
}

/// Invariant: a functional choice houses resolves from its registry
/// (Javanese granary, inn) asks for a built target inside the body-area
/// range its declared simple sources span, never one none of them takes.
#[test]
fn registered_functional_targets_stay_within_their_sources() {
    let sites = lot_sites(
        "javanese-courts",
        "AS-ISL",
        &[("granary", 0., 40., 40., "warehouse", "storage.granary")],
        0.0,
    );
    let site = site_of(&sites, "granary");
    let (_, [lo, hi]) = super::super::culture::functional_choice_sources(
        "javanese-courts",
        "AS-ISL",
        "storage.granary",
        "warehouse",
        "hall",
        "historical_inspired",
    )
    .unwrap();
    let target = site["programme"]["built_area_m2"].as_f64().unwrap();
    assert!((lo..=hi).contains(&target), "{target} outside {lo}..{hi}");
    assert!(site["config"]["recipe"].is_null());
}

/// Missing architectural source coverage cannot become a slope proof on
/// a pinned domestic recipe, even on a physically level lot.
#[test]
fn an_uncovered_facility_is_not_a_domestic_slope_or_shape_deficit() {
    let lots = [("horreum", 0., 45., 45., "warehouse", "storage.horreum")];
    for grade in [0.0,0.06] {
        let sites=lot_sites_context("roman-core","MED-ANT",&lots,grade,"strict");
        let site=site_of(&sites,"horreum");
        assert_eq!(site["function"],"open_space");
        assert!(site["config"]["recipe"].is_null(),"{}",site["config"]);
        assert!(site["config"]["overrides"]["floors"].is_null());
        assert_eq!(site["programme"]["deficit"]["cause"],"source_absente");
        assert_eq!(site["programme"]["source_coverage"]["status"],"missing");
        assert_eq!(site["programme"]["source_coverage"]["functional_footing_tested"],false);
        let warning=deficit_warning(std::slice::from_ref(site)).unwrap();
        assert!(warning.starts_with("Unbuilt lots: 1, "),"{warning}");
    }
}
#[test]
fn a_declared_storage_envelope_keeps_its_real_footing_gate() {
    let lots=[("granary",0.,45.,45.,"warehouse","storage.granary")];
    let flat=lot_sites("javanese-courts","AS-ISL",&lots,0.0);
    let request=site_of(&flat,"granary");
    assert_eq!(request["function"],"warehouse");
    assert!(request["programme"].get("source_coverage").is_none());
    assert!(request["programme"].get("deficit").is_none());
    let steep=lot_sites("javanese-courts","AS-ISL",&lots,0.25);
    let request=site_of(&steep,"granary");
    assert_eq!(request["function"],"open_space");
    assert_eq!(request["programme"]["deficit"]["cause"],"pente");
    assert!(request["programme"].get("source_coverage").is_none());
}
#[test]
fn housing_floor_need_core_old_allocation_stays_unknown_and_export_never_remodels() {
    let f: Value = serde_json::from_str(include_str!("../../../tests/fixtures/occupancy-c1358-origin.json")).unwrap();
    let mut a: super::super::programme::Allocation = serde_json::from_value(f["allocation"].clone()).unwrap();
    let mut parcel: Parcel = serde_json::from_value(f["parcel"].clone()).unwrap();
    parcel.block = 0;
    let layout: Layout = serde_json::from_value(json!({"key":"frozen-origin","culture":"javanese-courts",
        "center":{"x":0.,"y":0.},"quarters":[],"streets":[],"warnings":[],
        "blocks":[{"shape":parcel.shape.clone(),"quarter":0,"kind":"block","axis":{"x":1.,"y":0.}}]})).unwrap();
    let districts = BTreeMap::from([(0, ("commoner".to_owned(), Some(0.9)))]);
    let old = programme_of(&a, &parcel, &layout, &districts);
    assert!(old.get("housing_floor_need").is_none());
    assert_eq!(old["households"], 3.);
    a.households = 2.345;
    a.housing_floor_need = super::super::roles::indicative_housing_floor_need(&a.culture, a.households, 0.25);
    let new = programme_of(&a, &parcel, &layout, &districts);
    assert_eq!(new["households"], 2.35); // old rounded field is untouched
    assert_eq!(new["wealth"], 0.9); // appearance is deliberately different
    assert_eq!(new["housing_floor_need"]["allocated_households"], 2.345);
    assert_eq!(new["housing_floor_need"]["model"]["wealth"], 0.25);
    assert!((new["housing_floor_need"]["requested_m2"].as_f64().unwrap()-2.345*54.).abs()<1e-10);
    // Editing the current allocation's display wealth cannot rewrite a
    // model already captured with its original provenance.
    a.wealth = 0.8;
    assert_eq!(programme_of(&a, &parcel, &layout, &districts)["housing_floor_need"], new["housing_floor_need"]);
    assert_eq!(f["request"]["programme"]["built_area_m2"], 617.9);
}
