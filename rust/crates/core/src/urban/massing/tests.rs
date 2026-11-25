use super::*;
fn rect(x0: f64, y0: f64, x1: f64, y1: f64) -> Shape {
    super::super::geometry::rectangle(x0, y0, x1, y1)
}
fn input<'a>(parts: &'a [(Shape, &'static str)], arch: &'a Value, fronts: &'a [[Point; 2]], seed: &'a str) -> Input<'a> {
    Input { parts, arch, culture: "european-organic", zone: "core", role: "dwelling.row", function: "domestic",
        landmark: false, wealth: 0.5, pressure: 0.8, small_home: false, population: 0, fronts, seed, low_rural: true, distance: 0.0, archetype: "", complex: false, user_core: false }
}
#[test]
fn a_roof_edit_keeps_the_authored_procedural_bodies_without_replacing_their_plan() {
    let parts = [(rect(0.0,0.0,12.0,6.0),"building"),(rect(1.0,6.0,5.5,12.0),"wing")];
    let shapes: Vec<Shape> = parts.iter().map(|(shape,_)|shape.clone()).collect();
    let arch = json!({"typology":"stone-house","roof":"gable","storeys":[2,2],"material":"stone"});
    let mut original = massing(&input(&parts,&arch,&[],"roof-edit"));
    let rings: Vec<Value> = original.as_array().unwrap().iter().map(|piece|piece["volumes"].as_array().map(|volumes|json!(volumes.iter().map(|v|v["ring"].clone()).collect::<Vec<_>>())).unwrap_or(Value::Null)).collect();
    apply_edit(&mut original,&shapes,&json!({"overrides":{"roof":"RF-FLAT","floors":3}})).unwrap();
    for (index,piece) in original.as_array().unwrap().iter().enumerate() {
        assert_eq!(piece["roof"],"flat"); assert_eq!(piece["floors"],3);
        if let Some(volumes)=piece["volumes"].as_array(){assert_eq!(json!(volumes.iter().map(|v|v["ring"].clone()).collect::<Vec<_>>()),rings[index]);}
    }
    let retained=original.clone();
    assert!(apply_edit(&mut original,&shapes,&json!({"overrides":{"roof":"RF-INVALID"}})).is_err());
    assert_eq!(original,retained);
}

/// A complex home: the wing takes its rule, the roofs are composed (the
/// wing's pans run into the body) and every volume carries explicit pans.
/// The same parts in simple mode keep the plain contract.
#[test]
fn a_complex_home_composes_its_roofs_and_a_simple_one_keeps_the_plain_contract() {
    let parts = [(rect(0.0, 0.0, 12.0, 6.0), "building"), (rect(1.0, 6.0, 5.5, 12.0), "wing")];
    let arch = json!({"typology":"stone-house","roof":"gable","storeys":[2,2],"material":"stone"});
    let fronts = [[Point { x: 0.0, y: 0.0 }, Point { x: 12.0, y: 0.0 }]];
    let simple = massing(&Input { zone: "village", ..input(&parts, &arch, &fronts, "home") });
    let volumes = |m: &Value| -> Vec<Value> { m.as_array().unwrap().iter().flat_map(|p| p["volumes"].as_array().cloned().unwrap_or_default()).collect() };
    assert!(volumes(&simple).iter().all(|v| v.get("pans").is_none() && v.get("base_m").is_none()));
    let complex = massing(&Input { zone: "village", complex: true, ..input(&parts, &arch, &fronts, "home") });
    let vols = volumes(&complex);
    let pitched: Vec<&Value> = vols.iter().filter(|v| v["roof"] != "flat").collect();
    assert!(pitched.len() >= 2 && pitched.iter().all(|v| v["pans"].as_array().is_some_and(|p| !p.is_empty())), "{complex}");
    // The wing's roof reaches inside the body (y < 6): a valley, not a gable wall on the body's eave.
    let wing = complex[1]["volumes"][0]["pans"].as_array().unwrap();
    assert!(wing.iter().any(|pan| pan.as_array().unwrap().chunks(3).any(|p| p[1].as_f64().unwrap() < 5.5)), "{wing:?}");
    // Deterministic.
    assert_eq!(complex, massing(&Input { zone: "village", complex: true, ..input(&parts, &arch, &fronts, "home") }));
}

#[test]
fn stepped_landmark_heights_follow_nested_terraces() {
    let terrace = |outer: f64, inner: f64| Shape {
        outer: rect(-outer, -outer, outer, outer).outer,
        holes: vec![rect(-inner, -inner, inner, inner).outer],
    };
    // Deliberately shuffled: preview order must not determine tier height.
    let parts = [(terrace(6.0, 3.0), "terrace"), (rect(-3.0, -3.0, 3.0, 3.0), "shrine"),
        (terrace(12.0, 9.0), "terrace"), (terrace(9.0, 6.0), "terrace")];
    let arch = json!({"roof":"thatch-round","storeys":[1,1],"material":"thatch"});
    let m = massing(&Input { culture: "maya", role: "worship.pyramid-precinct", function: "religious", landmark: true,
        ..input(&parts, &arch, &[], "stepped") });
    let heights: Vec<f64> = m.as_array().unwrap().iter().map(|p| {
        assert_eq!(p["roof"], "flat");
        assert_eq!(p["rise_m"], 0.0);
        assert_eq!(p["cover"], "stone");
        assert_eq!(p["openings"], "none");
        p["eave_m"].as_f64().unwrap()
    }).collect();
    assert_eq!(heights, vec![9.0, 12.0, 3.0, 6.0]);
}

/// A river mill draws a water gristmill (an inca one never a water or
/// wind mill); its massing has a wheel against the rear wall, a smithy a
/// chimney through its roof, a raised granary stilts.
#[test]
fn activity_archetypes_choose_by_context_and_shape_the_massing() {
    use super::super::activities::{pick, LotContext};
    let river = LotContext { river: true, shore: false, open: false };
    for s in ["a", "b", "c", "d"] {
        assert_eq!(pick("craft.mill", "european-organic", river, s), Some("water_gristmill"));
        for ctx in [river, LotContext { open: true, ..river }, LotContext::default()] {
            let id = pick("craft.mill", "inca", ctx, s).unwrap();
            assert!(!id.starts_with("water") && !id.starts_with("wind"), "inca {id}");
        }
    }
    assert_eq!(pick("craft.mill", "european-organic", LotContext { river: false, shore: false, open: true }, "a"), Some("wind_gristmill"));
    let parts = [(rect(0.0, 0.0, 10.0, 12.0), "building")];
    let arch = json!({"roof":"gable","storeys":[2,4],"material":"timber"});
    let fronts = [[Point { x: 0.0, y: 0.0 }, Point { x: 10.0, y: 0.0 }]];
    let vols = |a: &'static str| {
        let m = massing(&Input { archetype: a, role: "craft.mill", function: "workshop", ..input(&parts, &arch, &fronts, "a") });
        m[0]["volumes"].as_array().unwrap().clone()
    };
    let mill = vols("water_gristmill");
    let wheel = mill.iter().find(|v| v["wall"] == "wood" && v["roof"] == "flat").expect("wheel");
    assert!(wheel["ring"].as_array().unwrap().iter().all(|p| p[1].as_f64().unwrap() > 11.9), "wheel behind: {wheel}");
    let smithy = vols("smithy");
    let top = |v: &Value| v["eave_m"].as_f64().unwrap() + v["rise_m"].as_f64().unwrap();
    let chimney = smithy.last().unwrap();
    assert!(chimney["wall"] == "stone" && top(chimney) > top(&smithy[0]), "{smithy:?}");
    assert!(vols("granary_raised")[0]["stilts_m"].as_f64().unwrap() > 0.5);
    assert_eq!(vols("wind_gristmill")[0]["roof"], "cone");
    let sails = &vols("wind_gristmill")[0]["features"][0];
    assert!(sails["kind"] == "sails" && sails["w"].as_f64().unwrap() > 2.0 && sails["h"].as_f64().unwrap() > 0.5, "{sails}");
    assert!(vols("water_gristmill").iter().all(|v| v.get("features").is_none()));
    assert!(vols("").iter().all(|v| v["wall"] != "wood" || v["roof"] != "flat"));
}

#[test]
fn gabled_row_house_turns_its_gable_to_the_street() {
    // 7 m frontage on y = 0, 14 m deep: gable to street → ridge along y.
    let parts = [(rect(0.0, 0.0, 7.0, 14.0), "building")];
    let arch = json!({"roof":"gable","typology":"gabled-row-house","storeys":[2,4],"material":"timber"});
    let fronts = [[Point { x: 0.0, y: 0.0 }, Point { x: 7.0, y: 0.0 }]];
    let m = massing(&input(&parts, &arch, &fronts, "a"));
    let r = &m[0]["ridges"][0];
    let (dx, dy) = (r[2].as_f64().unwrap() - r[0].as_f64().unwrap(), r[3].as_f64().unwrap() - r[1].as_f64().unwrap());
    assert!(dy.abs() > 6.0 && dx.abs() < 0.5, "{m}");
    let floors = m[0]["floors"].as_u64().unwrap();
    assert!((2..=4).contains(&floors), "{m}");
}

#[test]
fn giant_storeys_use_the_house_metric_scale() {
    let parts = [(rect(0.0, 0.0, 10.0, 8.0), "building")];
    let arch = json!({"roof":"gable","storeys":[1,1],"material":"stone"});
    let mut i = input(&parts, &arch, &[], "giant-scale");
    let human = massing(&i);
    i.culture = "giant-hold";
    let giant = massing(&i);
    assert_eq!(giant[0]["eave_m"].as_f64().unwrap(), human[0]["eave_m"].as_f64().unwrap() * 3.5);
    assert_eq!(giant[0]["volumes"][0]["body_scale"], 3.5);
    assert_eq!(giant[0]["roof"], "flat", "{giant}");
    let recipe = json!({"roof":"gable","storeys":[3,4],"material":"timber"});
    i.arch = &recipe;
    let tall = massing(&i);
    assert_eq!(tall[0]["eave_m"], giant[0]["eave_m"], "giant houses keep one storey whatever the recipe: {tall}");
}

#[test]
fn culture_house_forms_have_physical_heights_and_roof_plans() {
    let mut fixtures = vec![];
    for (culture, form, w, d) in [
        ("elven", "tree", 14.0, 14.0), ("myconid-colony", "mushroom", 10.0, 10.0),
        ("mongol-ordu", "yurt", 7.0, 7.0), ("native-iroquoian", "longhouse", 40.0, 6.5),
        ("tibetan-monastery", "battered", 14.0, 10.0), ("merfolk-tidal", "", 10.0, 8.0),
        ("giant-hold", "", 40.0, 24.0), ("wizard-city", "", 10.0, 8.0),
    ] {
        let arch = super::super::catalogue()["presets"][format!("{culture}/village")]["params"]["arch"].clone();
        let parts = [(rect(0.0, 0.0, w, d), "building")];
        let fronts = [[Point { x: 0.0, y: 0.0 }, Point { x: w, y: 0.0 }]];
        let mut i = input(&parts, &arch, &fronts, "houses-review");
        i.culture = culture;
        if culture == "wizard-city" { i.landmark = true; }
        let m = massing(&i);
        for v in m[0]["volumes"].as_array().unwrap() {
            assert!(v["eave_m"].as_f64().unwrap() > 0.0, "{culture}: {m}");
            if !form.is_empty() && culture != "elven" { assert_eq!(v["form"], form, "{culture}: {m}"); }
        }
        if form == "mushroom" { assert_eq!(m[0]["roof"], "dome"); }
        if form == "longhouse" {
            assert_eq!(m[0]["roof"], "barrel");
            assert_eq!(m[0]["eave_m"], 1.5);
            let r = &m[0]["ridges"][0];
            assert!((r[2].as_f64().unwrap() - r[0].as_f64().unwrap()).abs() > 39.0);
        }
        // Light pile houses: posts of 1.6–2.2 m.
        if culture == "merfolk-tidal" { assert!((1.6..=2.2).contains(&m[0]["volumes"][0]["stilts_m"].as_f64().unwrap())); }
        fixtures.push(json!({"culture":culture,"footprint":[parts[0].0],"massing":m}));
    }
    if let Ok(path) = std::env::var("HOUSES_MASSING_OUT") { std::fs::write(path, serde_json::to_vec(&fixtures).unwrap()).unwrap(); }
}

#[test]
fn elven_settlements_mix_tree_and_ordinary_houses() {
    let parts = [(rect(0.0, 0.0, 14.0, 14.0), "building")];
    let arch = json!({"roof":"gable","storeys":[1,2],"material":"wood"});
    let trees = (0..100).filter(|k| {
        let seed = format!("elf-{k}");
        let mut i = input(&parts, &arch, &[], &seed); i.culture = "elven";
        massing(&i)[0]["volumes"].as_array().unwrap().iter().any(|v| v["form"] == "tree")
    }).count();
    assert!((80..=95).contains(&trees), "{trees} tree dwellings / 100 homes; ground houses must remain a small minority");
}

#[test]
fn mage_towers_are_a_frequent_varied_culture_feature() {
    let parts = [(rect(0.0, 0.0, 10.0, 8.0), "building")];
    let arch = json!({"roof":"hip","storeys":[2,4],"material":"stone"});
    let mut heights = vec![];
    for k in 0..100 {
        let seed = format!("mage-{k}");
        let mut i = input(&parts, &arch, &[], &seed); i.culture = "wizard-city";
        let m = massing(&i);
        for v in m[0]["volumes"].as_array().unwrap() {
            if v["form"] == "tower" {
                assert_eq!(v["roof"], "cone"); heights.push(v["eave_m"].as_f64().unwrap());
            }
        }
    }
    assert!(heights.len() >= 20 && heights.len() <= 55, "{} towers / 100 homes", heights.len());
    assert!(heights.iter().copied().fold(f64::MIN, f64::max) - heights.iter().copied().fold(f64::MAX, f64::min) > 10.0);
}

#[test]
fn rear_annex_is_lower_than_the_street_body() {
    let parts = [(rect(0.0, 0.0, 8.0, 10.0), "building"), (rect(2.0, 10.0, 6.0, 15.0), "building")];
    let arch = json!({"roof":"gable","typology":"gabled-row-house","storeys":[3,4],"material":"timber"});
    let fronts = [[Point { x: 0.0, y: 0.0 }, Point { x: 8.0, y: 0.0 }]];
    for seed in ["a", "b", "c", "d"] {
        let m = massing(&input(&parts, &arch, &fronts, seed));
        assert!(m[1]["eave_m"].as_f64() < m[0]["eave_m"].as_f64(), "{m}");
        assert_eq!(m[1]["roof"], "shed", "{m}");
    }
}

#[test]
fn village_homes_are_low_even_in_a_multi_storey_tradition() {
    let parts = [(rect(0.0, 0.0, 7.0, 10.0), "building")];
    let arch = json!({"roof":"gable","typology":"giebelhaus","storeys":[3,5],"material":"timber"});
    let fronts = [[Point { x: 0.0, y: 0.0 }, Point { x: 7.0, y: 0.0 }]];
    let (mut high, mut tall) = (0, 0);
    for k in 0..200 {
        let seed = format!("village-{k}");
        let mut i = input(&parts, &arch, &fronts, &seed);
        i.zone = "village"; i.population = 500; i.pressure = 0.3;
        let f = massing(&i)[0]["floors"].as_u64().unwrap();
        assert!(f <= 3, "{f}");
        high += (f >= 2) as u32; tall += (f == 3) as u32;
        i.zone = "core"; i.population = 50_000;
        assert!(massing(&i)[0]["floors"].as_u64().unwrap() >= 3);
    }
    assert!(high < 90 && tall < 30, "{high} {tall}");
    // `lowRuralHouses` off: the tradition's own range (3–4 floors here).
    for k in 0..50 {
        let seed = format!("village-{k}");
        let mut i = input(&parts, &arch, &fronts, &seed);
        i.zone = "village"; i.population = 500; i.pressure = 0.3; i.low_rural = false;
        assert!(massing(&i)[0]["floors"].as_u64().unwrap() >= 2);
    }
}

#[test]
fn small_homes_follow_distance_and_poverty_without_changing_the_core() {
    let parts = [(rect(0.0, 0.0, 24.0, 12.0), "building")];
    let arch = json!({"roof":"gable","storeys":[2,4],"material":"timber"});
    let share = |zone: &str, district: &str, wealth: f64, distance: f64, outside: bool, farm: bool| {
        let mut single = 0;
        for k in 0..1000 {
            let seed = format!("houses2-{k}");
            let mut m = input(&parts, &arch, &[], &seed);
            m.zone = zone; m.wealth = wealth; m.pressure = 0.5;
            let old = massing(&m);
            let area = super::super::house_mix::HomeContext {
                zone, district, wealth, pressure:m.pressure, distance, outside, farm, low_rural: true,
            }.area_scale(&seed);
            m.small_home = area < 1.0;
            let new = massing(&m);
            assert_eq!(new, massing(&m), "deterministic per lot");
            if m.small_home {
                assert_eq!(new[0]["floors"], 1, "no raised section: {new}");
                assert!(volumes_of(&new, 0).iter().all(|v| v["floors"] == 1));
                assert!((if zone == "middle" && !outside && !farm { 0.88..=0.93 } else { 0.7..=1.0 }).contains(&area));
            } else { assert_eq!(old, new, "unselected lots keep every original draw"); }
            single += usize::from(new[0]["floors"] == 1);
        }
        single as f64 / 1000.0
    };
    let core = share("core", "poor", 0.1, 2.0, true, true);
    let middle = share("middle", "commoner", 0.5, 0.4, false, false);
    let poor = share("middle", "poor", 0.25, 0.4, false, false);
    let low_wealth = share("middle", "commoner", 0.25, 0.4, false, false);
    let near = share("edge", "commoner", 0.5, 0.55, false, false);
    let far = share("edge", "commoner", 0.5, 1.0, false, false);
    // A town-centre middle lot is rarely a one-storey house (a lowered
    // storey range there is a gradual draw, not a rule).
    assert_eq!(core, 0.0); assert!(middle < 0.02, "middle: {middle}");
    assert!((0.45..=0.58).contains(&poor), "poor: {poor}");
    assert_eq!(poor, low_wealth);
    assert!(near > middle && far > near && far > poor, "{middle} {near} {far} {poor}");
    for (zone, district, outside, farm) in [
        ("faubourg", "commoner", false, false),
        ("middle", "commoner", true, false), ("middle", "commoner", false, true),
        ("edge", "gardens", false, false), ("edge", "poor", true, false),
    ] {
        let fringe = share(zone, district, 0.5, 1.0, outside, farm);
        // The height gradient lowers a further share of town lots (low houses in the core too).
        assert!((0.6..=0.8).contains(&fringe), "{zone}/{district}: {fringe}");
    }
    // The countryside is small houses: more of them shrink than at the fringe.
    let village = share("village", "commoner", 0.5, 1.0, false, false);
    // (and the height gradient keeps a village at one or two storeys).
    assert!((0.7..=0.95).contains(&village), "village: {village}");
    eprintln!("houses2 single-storey shares: core={core:.3}, middle={middle:.3}, near={near:.3}, fringe={far:.3}, poor={poor:.3}");
}

#[test]
fn small_home_selection_preserves_landmarks_towers_and_cultural_forms() {
    let parts = [(rect(0.0, 0.0, 24.0, 12.0), "building")];
    let arch = json!({"roof":"gable","storeys":[2,4],"material":"timber"});
    for culture in ["giant-hold", "mongol-ordu", "native-iroquoian", "myconid-colony", "wizard-city", "hadhrami-tower"] {
        let mut m = input(&parts, &Value::Null, &[], "protected");
        m.zone = "faubourg"; m.culture = culture;
        let old = massing(&m); m.small_home = true;
        assert_eq!(old, massing(&m), "{culture}");
        if culture == "giant-hold" {
            assert_eq!(old[0]["floors"], 1);
            assert_eq!(old[0]["roof"], "flat");
        }
    }
    for k in 0..100 {
        let seed = format!("elf-{k}");
        let mut m = input(&parts, &arch, &[], &seed);
        m.zone = "faubourg"; m.culture = "elven";
        let old = massing(&m); m.small_home = true;
        let new = massing(&m);
        let trees = |v: &Value| volumes_of(v, 0).iter().filter(|v| v["form"] == "tree").count();
        assert_eq!(trees(&old), trees(&new));
        if trees(&old) > 0 { assert_eq!(old, new); }
    }
    let tower = [(parts[0].0.clone(), "tower")];
    for (zone, landmark, parts) in [("core", false, parts.as_slice()), ("faubourg", true, parts.as_slice()), ("faubourg", false, tower.as_slice())] {
        let mut m = input(parts, &arch, &[], "protected"); m.zone = zone; m.landmark = landmark;
        let old = massing(&m); m.small_home = true;
        assert_eq!(old, massing(&m));
    }
}

#[test]
fn core_is_taller_than_edge_on_average() {
    let parts = [(rect(0.0, 0.0, 8.0, 12.0), "building")];
    let arch = json!({"roof":"gable","storeys":[1,5],"material":"brick"});
    let fronts = [[Point { x: 0.0, y: 0.0 }, Point { x: 8.0, y: 0.0 }]];
    let mean = |zone: &'static str, pressure: f64| {
        (0..64).map(|i| {
            let seed = format!("s{i}");
            let mut m = input(&parts, &arch, &fronts, &seed);
            m.zone = zone;
            m.pressure = pressure;
            massing(&m)[0]["floors"].as_f64().unwrap()
        }).sum::<f64>() / 64.0
    };
    assert!(mean("core", 0.9) > mean("edge", 0.2) + 1.0);
}

#[test]
fn courtyard_body_gets_a_ring_roof_and_towers_stand_out() {
    let mut court = rect(0.0, 0.0, 20.0, 20.0);
    court.holes.push(rect(6.0, 6.0, 14.0, 14.0).outer);
    let parts = [(court, "building"), (rect(22.0, 0.0, 27.0, 5.0), "tower")];
    let arch = json!({"roof":"tiled-hip","storeys":[1,2],"material":"brick"});
    let fronts = [[Point { x: 0.0, y: 0.0 }, Point { x: 20.0, y: 0.0 }]];
    let m = massing(&input(&parts, &arch, &fronts, "x"));
    assert_eq!(m[0]["roof"], "ring", "{m}");
    assert_eq!(m[1]["roof"], "pyramid", "{m}");
    assert!(m[1]["eave_m"].as_f64() > m[0]["eave_m"].as_f64(), "{m}");
}

fn shape(pts: &[(f64, f64)]) -> Shape {
    Shape { outer: pts.iter().map(|&(x, y)| Point { x, y }).collect(), holes: vec![] }
}
fn volumes_of(m: &Value, k: usize) -> Vec<Value> {
    m[k]["volumes"].as_array().cloned().unwrap_or_default()
}
fn ring_of(v: &Value) -> Shape {
    Shape {
        outer: v["ring"].as_array().unwrap().iter().map(|p| Point { x: p[0].as_f64().unwrap(), y: p[1].as_f64().unwrap() }).collect(),
        holes: vec![],
    }
}
fn check_volumes(piece: &Shape, m: &Value, k: usize) {
    let vols = volumes_of(m, k);
    assert!(!vols.is_empty(), "{m}");
    let pa = super::super::geometry::area(piece);
    let mut sum = 0.0;
    for v in &vols {
        let r = ring_of(v);
        let a = super::super::geometry::area(&r);
        sum += a;
        let inside: f64 = super::super::geometry::intersection(piece, &r).iter().map(super::super::geometry::area).sum();
        assert!((inside - a).abs() < 0.03 * a + 0.05, "volume leaves the piece: {v}");
        if v["roof"] != "flat" {
            assert_eq!(reflex_count(&r.outer), 0, "pitched volume not convex: {v}");
        }
        for rg in v["ridges"].as_array().unwrap() {
            for (x, y) in [(0, 1), (2, 3)] {
                let p = Point { x: rg[x].as_f64().unwrap(), y: rg[y].as_f64().unwrap() };
                assert!(super::super::geometry::contains(&r, p), "ridge outside ring: {v}");
            }
        }
    }
    assert!((sum - pa).abs() < 0.03 * pa + 0.1, "volumes do not partition the piece: {sum} vs {pa}");
}

#[test]
fn volumes_partition_irregular_pieces_with_inside_ridges() {
    let arch = json!({"roof":"gable","storeys":[2,4],"material":"timber"});
    let fronts = [[Point { x: 0.0, y: 0.0 }, Point { x: 10.0, y: 0.0 }]];
    let pieces = [
        shape(&[(0.0, 0.0), (10.0, 0.0), (10.0, 5.0), (5.0, 5.0), (5.0, 12.0), (0.0, 12.0)]),
        shape(&[(0.0, 0.0), (14.0, 0.0), (12.0, 9.0), (2.0, 7.0)]),
        shape(&[(0.0, 0.0), (22.0, 0.0), (22.0, 9.0), (0.0, 9.0)]),
        shape(&[(0.0, 0.0), (30.0, 0.0), (30.0, 6.0), (18.0, 6.0), (18.0, 14.0), (12.0, 14.0), (12.0, 6.0), (0.0, 6.0)]),
        shape(&[(0.0, 0.0), (12.0, 3.0), (9.0, 14.0), (-2.0, 10.0)]),
        shape(&[(0.0, 0.0), (9.0, 0.0), (9.0, 12.0), (6.0, 12.0), (6.0, 4.0), (3.0, 4.0), (3.0, 12.0), (0.0, 12.0)]),
    ];
    for (k, p) in pieces.iter().enumerate() {
        for seed in ["a", "b", "c", "d", "e", "f"] {
            let parts = [(p.clone(), "building")];
            let m = massing(&input(&parts, &arch, &fronts, seed));
            check_volumes(p, &m, 0);
            if k == 0 || k == 3 || k == 5 {
                assert!(volumes_of(&m, 0).len() >= 2, "non-convex piece {k} gave one volume: {m}");
            }
        }
    }
}

#[test]
fn massing_is_deterministic_per_seed() {
    let parts = [(rect(0.0, 0.0, 20.0, 10.0), "building"), (rect(2.0, 10.0, 8.0, 16.0), "building")];
    let arch = json!({"roof":"gable","storeys":[2,4],"material":"brick"});
    let fronts = [[Point { x: 0.0, y: 0.0 }, Point { x: 20.0, y: 0.0 }]];
    assert_eq!(massing(&input(&parts, &arch, &fronts, "z")), massing(&input(&parts, &arch, &fronts, "z")));
}

#[test]
fn european_sample_mixes_roofs_and_eave_heights() {
    let arch = json!({"roof":"gable","storeys":[2,4],"material":"timber"});
    let fronts = [[Point { x: 0.0, y: 0.0 }, Point { x: 18.0, y: 0.0 }]];
    let parts = [(rect(0.0, 0.0, 18.0, 11.0), "building")];
    let (mut roofs, mut eaves) = (std::collections::BTreeSet::new(), std::collections::BTreeSet::new());
    for i in 0..24 {
        let seed = format!("eu{i}");
        let m = massing(&input(&parts, &arch, &fronts, &seed));
        for v in volumes_of(&m, 0) {
            roofs.insert(v["roof"].as_str().unwrap().to_string());
            eaves.insert((v["eave_m"].as_f64().unwrap() * 10.0) as i64);
        }
    }
    assert!(roofs.len() >= 2 && eaves.len() >= 3, "{roofs:?} {eaves:?}");
}

#[test]
fn mongol_ordu_lives_in_felt_tents() {
    let parts = [(rect(0.0, 0.0, 6.0, 6.0), "building")];
    let fronts = [[Point { x: 0.0, y: 0.0 }, Point { x: 6.0, y: 0.0 }]];
    let mut i = input(&parts, &Value::Null, &fronts, "k");
    i.culture = "mongol-ordu";
    let m = massing(&i);
    assert_eq!(m[0]["roof"], "tent", "{m}");
    assert_eq!(m[0]["cover"], "felt", "{m}");
    let arch = json!({"roof":"conical","typology":"tipi","storeys":[1,1],"material":"hide"});
    let m = massing(&input(&parts, &arch, &fronts, "k"));
    assert_eq!((m[0]["roof"].as_str(), m[0]["cover"].as_str(), m[0]["wall"].as_str()), (Some("tent"), Some("hide"), Some("hide")), "{m}");
}

#[test]
fn yurts_tipis_and_stilt_houses_read_as_themselves() {
    let parts = [(rect(0.0, 0.0, 6.0, 6.0), "building")];
    let fronts = [[Point { x: 0.0, y: 0.0 }, Point { x: 6.0, y: 0.0 }]];
    let vol = |arch: &Value| massing(&input(&parts, arch, &fronts, "k"))[0]["volumes"][0].clone();
    let yurt = vol(&json!({"roof":"dome","typology":"ger","storeys":[1,1],"material":"felt"}));
    assert_eq!((yurt["form"].as_str(), yurt["roof"].as_str(), yurt["eave_m"].as_f64()), (Some("yurt"), Some("tent"), Some(1.6)), "{yurt}");
    assert!(yurt["rise_m"].as_f64().unwrap() < 1.6, "{yurt}");
    let tipi = vol(&json!({"roof":"conical","typology":"tipi","storeys":[1,1],"material":"hide"}));
    assert_eq!(tipi["form"], "tipi", "{tipi}");
    assert!(tipi["rise_m"].as_f64().unwrap() > 4.0 && tipi["eave_m"].as_f64().unwrap() < 0.3, "{tipi}");
    let stilt = vol(&json!({"roof":"thatch-round","typology":"stilt-house","storeys":[1,1],"material":"thatch"}));
    assert!(stilt["stilts_m"].as_f64().unwrap() >= 1.8, "{stilt}");
    // A landmark of a tent people is a tent, not a stone nave.
    let church = [(rect(0.0, 0.0, 8.0, 14.0), "nave"), (rect(0.0, 14.0, 5.0, 19.0), "tower")];
    let tipi_arch = json!({"roof":"conical","typology":"tipi","storeys":[1,1],"material":"hide"});
    let mut i = input(&church, &tipi_arch, &fronts, "k");
    i.landmark = true;
    for m in massing(&i).as_array().unwrap() { assert_eq!(m["roof"], "tent", "{m}"); }
}

#[test]
fn medina_flat_roofs_get_parapets_and_inner_features() {
    let parts = [(rect(0.0, 0.0, 12.0, 10.0), "building")];
    let fronts = [[Point { x: 0.0, y: 0.0 }, Point { x: 12.0, y: 0.0 }]];
    let arch = json!({"roof":"flat","storeys":[1,2],"material":"adobe"});
    let (mut seen, mut kinds) = (0, std::collections::BTreeSet::new());
    for k in 0..40 {
        let seed = format!("m{k}");
        let mut i = input(&parts, &arch, &fronts, &seed);
        i.culture = "persian";
        let m = massing(&i);
        for v in volumes_of(&m, 0) {
            assert!(v["parapet_m"].as_f64().unwrap() >= 0.5, "{v}");
            let ring = ring_of(&v);
            for f in v["features"].as_array().into_iter().flatten() {
                let p = Point { x: f["x"].as_f64().unwrap(), y: f["y"].as_f64().unwrap() };
                assert!(depth_in(&ring.outer, p) > 1.0, "{f} outside {v}");
                kinds.insert(f["kind"].as_str().unwrap().to_string());
                seen += 1;
            }
        }
    }
    assert!(seen > 0 && kinds.contains("stair") && kinds.contains("windcatcher"), "{kinds:?}");
}

/// Modern styles build in their materials and tint their walls from their
/// palette: a Haussmannian home is cut limestone in its beige range, the
/// towers of a high-rise style vary, a historical culture asks for no tint.
#[test]
fn modern_styles_tint_their_walls_from_their_palette() {
    let parts = [(rect(0.0, 0.0, 16.0, 12.0), "building")];
    let fronts = [[Point { x: 0.0, y: 0.0 }, Point { x: 16.0, y: 0.0 }]];
    let arch = json!({"typology":"apartment-building","roof":"hip","storeys":[5,6],"material":"ashlar"});
    let home = massing(&Input { culture: "haussmannian", ..input(&parts, &arch, &fronts, "paris") });
    let homes = super::super::forms::kit::tints("haussmannian", false).unwrap();
    for p in home.as_array().unwrap() {
        assert_eq!(p["wall"], "ashlar", "{p}");
        assert!(p["tint"].as_str().is_some_and(|t| homes.contains_key(t)), "{p}");
    }
    let tower = [(rect(0.0, 0.0, 30.0, 24.0), "office-block")];
    let glass = json!({"typology":"tower-block","roof":"flat","storeys":[20,40],"material":"glass"});
    let tints: std::collections::BTreeSet<String> = (0..12).map(|k| {
        let seed = format!("tower{k}");
        let m = massing(&Input { culture: "global-high-rise", role: "commerce.office", function: "commerce", ..input(&tower, &glass, &fronts, &seed) });
        assert_eq!(m[0]["wall"], "glass", "{m}");
        m[0]["tint"].as_str().unwrap().to_string()
    }).collect();
    assert!(tints.len() >= 2, "{tints:?}");
    let old = massing(&input(&parts, &json!({"roof":"gable","storeys":[2,3],"material":"stone"}), &fronts, "paris"));
    assert!(old.as_array().unwrap().iter().all(|p| p.get("tint").is_none()), "{old}");
}

/// A tower style's height ladder: a core lot of a town of 10 000 stays at
/// four storeys at most, the same lot in a city of 100 000 or in a quarter
/// the user set as core rises to a collective block of nine storeys or more.
#[test]
fn modern_heights_climb_the_style_ladder() {
    // A footprint broad enough for a tower (bodies stay under 2.5 × their width).
    let parts = [(rect(0.0, 0.0, 40.0, 40.0), "building")];
    let fronts = [[Point { x: 0.0, y: 0.0 }, Point { x: 40.0, y: 0.0 }]];
    let arch = json!({"typology":"megatower","roof":"flat","storeys":[25,50],"material":"glass"});
    let top = |population: u32, user_core: bool| (0..16).map(|k| {
        let seed = format!("ladder{k}");
        let m = massing(&Input { culture: "cyberpunk", role: "dwelling.house", population, user_core, ..input(&parts, &arch, &fronts, &seed) });
        m.as_array().unwrap().iter().filter_map(|p| p["floors"].as_u64()).max().unwrap()
    }).max().unwrap();
    assert!(top(10_000, false) <= 4, "{}", top(10_000, false));
    assert!(top(100_000, false) >= TALL_FLOORS as u64, "{}", top(100_000, false));
    assert!(top(10_000, true) >= TALL_FLOORS as u64, "{}", top(10_000, true));
    // A historical tower culture keeps its tradition.
    assert_eq!(super::super::forms::kit::storey_cap("hadhrami-tower", 10_000, false), None);
}
