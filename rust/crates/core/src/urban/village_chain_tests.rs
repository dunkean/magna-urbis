//! Small places end built, round the centre they publish (user report 2026-11-17, map
//! `magna-urbis` / temperate / pnw-plank-village / hills / 6 km).
//!
//! The hamlet of 52 inhabitants stood on a junction of three regional roads: the roads took
//! half of its 4,160 m² and the camp lattice found no whole house cell in the wedges left, so
//! its only block went back to the fields and the place stood empty. The village of 295 showed
//! a dozen plank houses (four households of eight under each roof).
//!
//! Invariants:
//! (a) a place of 15 inhabitants or more houses at least half of its households (the bound
//!     under which `generate_quarters` lays it out again on more land);
//! (b) the centre the layout publishes (`structure.centers[0]`, else `center`) has a home
//!     within the place's radius: the page moves the label and the camera there;
//! (d) a home holds no more households than its culture declares for one house.
use super::geometry as g;
use super::*;

/// The junction of the reported hamlet, its centre moved to (2000, 2000): two tracks of
/// 4.05 m and one of 2.7 m leave the centre (captured `/urban` request, simplified).
fn junction() -> Vec<Street> {
    let road = |width: f64, points: &[(f64, f64)]| Street {
        key: None,
        path: points.iter().map(|&(x, y)| Point { x, y }).collect(),
        widths: vec![width; points.len()],
        rank: 2,
        role: "regional".into(),
    };
    vec![
        road(4.05, &[(2000., 2000.), (2033., 2003.), (2098., 2005.), (2648., 2005.)]),
        road(4.05, &[(2000., 2000.), (1945., 2060.), (1893., 2118.), (1849., 2192.), (1802., 2251.), (1522., 2435.)]),
        road(2.7, &[(2000., 2000.), (1957., 1955.), (1928., 1896.), (1842., 1644.), (1836., 1549.), (1793., 1398.)]),
    ]
}

struct Built {
    kind: String,
    wanted: f64,
    housed: f64,
    /// Lots with households and a building on them.
    homes: usize,
    /// Most households under one roof.
    crowded: f64,
    /// Distance (m) from the published centre to the nearest home.
    nearest: f64,
    warnings: Vec<String>,
}

/// One place on flat dry land, with the V2 page's layout switches, through the whole chain
/// (quarters, parcels, building sites).
fn build(culture: &str, population: u32, roads: &[Street]) -> Built {
    let n = 16;
    let (h, w, level) = (vec![10.0_f32; n * n], vec![0_u8; n * n], vec![0.0_f32; n * n]);
    let s = Surface { geometry: None, width: 4000.0, n, height: &h, water: &w, interpolation: Default::default() };
    let base: LayoutConfig = serde_json::from_str(include_str!("fixtures/small-layout-config.json")).unwrap();
    let cfg = LayoutConfig {
        natural_camp_approaches: true,
        street_frontage: true,
        align_enclosed_grid: true,
        hide_unused_quarters: true,
        organic_branch_variation: 0.5,
        ribbon_width_variation: 0.5,
        site_archetype: "plain".into(),
        ..base
    };
    let seed = "magna-urbis";
    let site = Site {
        key: "hamlet-0".into(),
        name: String::new(),
        population,
        culture: culture.into(),
        center: Point { x: 2000., y: 2000. },
        radius: crate::settlements::extent_radius(population),
        neighbours: Vec::new(),
    };
    let layouts = generate_quarters(seed, &[site], &cfg, s, roads).unwrap();
    let parts = generate_parcels(seed, &layouts, &ParcelConfig::default()).unwrap();
    let requests = building_sites::requests(seed, &layouts, &parts, s, &level, None).unwrap();
    let built: std::collections::HashSet<&str> = requests
        .iter()
        .filter(|r| r["preview"].as_array().is_some_and(|p| !p.is_empty()))
        .filter_map(|r| r["parcel_id"].as_str())
        .collect();
    let layout = &layouts[0];
    let pr = parts[0].programme.as_ref().unwrap();
    let centre = layout.structure.as_ref().and_then(|s| s.centers.first()).map_or(layout.center, |c| c.point);
    let homes: Vec<_> = pr.allocations.iter().filter(|a| a.households > 0.0 && built.contains(a.parcel_id.as_str())).collect();
    let nearest = homes
        .iter()
        .filter_map(|a| parts[0].parcels.iter().find(|p| p.id == a.parcel_id))
        .map(|p| {
            let c = g::centroid(&p.shape);
            (c.x - centre.x).hypot(c.y - centre.y)
        })
        .fold(f64::INFINITY, f64::min);
    Built {
        kind: layout.archetype.clone(),
        wanted: pr.demands.iter().filter(|d| d.unit == "domesticUnits").map(|d| d.requested).sum(),
        housed: homes.iter().map(|a| a.households).sum(),
        homes: homes.len(),
        crowded: homes.iter().map(|a| a.households).fold(0.0, f64::max),
        nearest,
        warnings: layout.warnings.iter().chain(&parts[0].warnings).cloned().collect(),
    }
}

/// The reported hamlet: 52 inhabitants of the plank-house culture on its road junction.
#[test]
fn a_plank_hamlet_on_a_road_junction_is_built_round_its_centre() {
    let b = build("pnw-plank-village", 52, &junction());
    eprintln!(
        "VILLAGE-CHAIN pnw 52: {} · {} homes · {:.1}/{:.1} households · {:.0} per roof · nearest home {:.0} m\n  {}",
        b.kind, b.homes, b.housed, b.wanted, b.crowded, b.nearest, b.warnings.join("\n  ")
    );
    // (a) built, and its households housed.
    assert!(b.homes >= 2, "{} homes for 52 inhabitants", b.homes);
    assert!(b.housed >= 0.5 * b.wanted, "{:.1}/{:.1} households", b.housed, b.wanted);
    // (d) two households of eight under one plank roof, as the catalogue declares.
    assert!(b.crowded <= 2.0, "{} households under one roof", b.crowded);
    // (b) homes round the published centre.
    assert!(b.nearest <= crate::settlements::extent_radius(52), "nearest home {:.0} m from the centre", b.nearest);
}

/// (d) A longhouse the culture does not declare as a large building shelters two or three
/// households (20 people at most), however large its farm lot: a Norse hamlet of 60 shows
/// three longhouses or more (it showed two, three households of eight under each roof).
#[test]
fn a_longhouse_shelters_two_or_three_households() {
    let mut failures = vec![];
    for population in [60, 150] {
        let b = build("barbarian-norse", population, &junction());
        let persons = b.crowded * roles::occupancy("barbarian-norse").household_size;
        eprintln!(
            "VILLAGE-CHAIN barbarian-norse {population}: {} · {} homes · {:.1}/{:.1} households · {persons:.0} people under the fullest roof",
            b.kind, b.homes, b.housed, b.wanted
        );
        if persons > 20.0 {
            failures.push(format!("{population}: {persons:.0} people under one roof"));
        }
        if b.housed < 0.5 * b.wanted {
            failures.push(format!("{population}: {:.1}/{:.1} households", b.housed, b.wanted));
        }
        if population == 60 && b.homes < 3 {
            failures.push(format!("60 inhabitants in {} longhouses", b.homes));
        }
    }
    assert!(failures.is_empty(), "{}", failures.join("\n"));
}

/// A farmstead is one household on its reserved block (use `reserve`, role `dwelling.farm`):
/// it is built, and carries no "No housing" notice (both farms of the reported map did).
#[test]
fn a_farmstead_with_its_farm_is_not_announced_empty() {
    for (culture, population) in [("pnw-plank-village", 10), ("european-organic", 9)] {
        let b = build(culture, population, &junction());
        eprintln!("VILLAGE-CHAIN {culture} {population}: {} · {} homes\n  {}", b.kind, b.homes, b.warnings.join("\n  "));
        assert!(b.homes >= 1, "{culture}: a farm of {population} inhabitants without its farm");
        assert!(!b.warnings.iter().any(|w| w.starts_with("No housing")), "{culture}: {:?}", b.warnings);
    }
}

/// The same invariants across cultures and sizes, on the junction and without any road.
#[test]
fn small_places_house_their_households_round_their_centre() {
    let mut failures = vec![];
    for (culture, populations) in [
        ("pnw-plank-village", &[52, 150, 295][..]),
        ("european-organic", &[20, 52, 150][..]),
        ("japanese-jokamachi", &[20, 52, 150][..]),
        ("dwarven", &[52, 150][..]),
        ("medina", &[52, 150][..]),
    ] {
        for &population in populations {
            for (name, roads) in [("junction", junction()), ("no road", vec![])] {
                // One pass without road is enough for the larger villages.
                if name == "no road" && population > 52 {
                    continue;
                }
                let b = build(culture, population, &roads);
                eprintln!(
                    "VILLAGE-CHAIN {culture} {population} ({name}): {} · {} homes · {:.1}/{:.1} households · nearest home {:.0} m",
                    b.kind, b.homes, b.housed, b.wanted, b.nearest
                );
                if b.homes == 0 || b.housed < 0.5 * b.wanted {
                    failures.push(format!("{culture} {population} ({name}): {} homes, {:.1}/{:.1} households", b.homes, b.housed, b.wanted));
                } else if b.nearest > crate::settlements::extent_radius(population) {
                    failures.push(format!("{culture} {population} ({name}): nearest home {:.0} m from the published centre", b.nearest));
                }
            }
        }
    }
    assert!(failures.is_empty(), "{}", failures.join("\n"));
}
