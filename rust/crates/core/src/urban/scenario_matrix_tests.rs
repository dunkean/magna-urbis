//! Conditional scenario matrix through the real request path
//! (`generate_quarters` → `generate_parcels`): requested, resolved and built
//! must agree. One row per scenario of TODO P1 « validate combinations »; it
//! does not certify every combination.
use super::super::{generate_parcels, generate_quarters, Layout, LayoutConfig, ParcelConfig, Partition, Point, Site, Street, Surface};
use super::super::programme::ProgrammeFunctions;
use crate::settlements::demographics::class_of;

fn run(culture: &str, population: u32, cfg: &LayoutConfig) -> (Layout, Partition) {
    let n = 128;
    let (height, water) = (vec![0.0; n * n], vec![0u8; n * n]);
    let surface = Surface { geometry: None, width: 9000.0, n, height: &height, water: &water };
    let road = Street {
        path: vec![Point { x: 300.0, y: 4520.0 }, Point { x: 8700.0, y: 4480.0 }],
        widths: vec![6.0, 6.0], rank: 0, role: "regional".into(),
    };
    let site = Site {
        key: "matrix".into(), name: String::new(), population, culture: culture.into(),
        center: Point { x: 4500.0, y: 4560.0 }, radius: crate::settlements::extent_radius(population),
    };
    let layouts = generate_quarters("matrix", &[site], cfg, surface, &[road]).expect("plan");
    let partitions = generate_parcels("matrix", &layouts, &ParcelConfig::default()).expect("parcels");
    (layouts[0].clone(), partitions[0].clone())
}
fn built_roles(p: &Partition) -> Vec<String> {
    p.programme.as_ref().expect("programme").allocations.iter().map(|a| a.role.clone()).collect()
}
/// Requested population reaches the programme unchanged (no silent cap), the
/// requested config is kept on the layout, and the returned grammar is the one expected.
fn consistent(l: &Layout, p: &Partition, population: u32, cfg: &LayoutConfig, archetype: &str) {
    assert_eq!(l.archetype, archetype, "grammar for {population}");
    assert_eq!(p.programme.as_ref().unwrap().population, population, "programme population");
    let kept = l.config.as_ref().expect("requested config kept");
    assert_eq!((kept.settlement_form.as_str(), kept.programme.intent.as_str()), (cfg.settlement_form.as_str(), cfg.programme.intent.as_str()));
}

#[test]
fn isolated_establishments_build_their_one_structure() {
    for (intent, population, archetype, role) in [("isolated-farm", 8, "farmstead", "dwelling.farm"), ("isolated-mill", 12, "single", "craft.mill")] {
        let mut cfg = LayoutConfig::default();
        cfg.programme.intent = intent.into();
        let (l, p) = run("european-organic", population, &cfg);
        consistent(&l, &p, population, &cfg, archetype);
        assert_eq!(l.quarters.len(), 1, "{intent}: no quarter grid");
        assert!(l.enclosures.is_empty(), "{intent}: no wall");
        assert!(built_roles(&p).iter().any(|r| r.starts_with(role)), "{intent}: {:?}", built_roles(&p));
    }
}

#[test]
fn village_has_one_phase_no_suburb_and_no_wall() {
    let cfg = LayoutConfig::default();
    let (l, p) = run("european-organic", 300, &cfg);
    assert_eq!(class_of(300), "village");
    assert!(["street-village", "nucleated-village"].contains(&l.archetype.as_str()), "{}", l.archetype);
    consistent(&l, &p, 300, &cfg, &l.archetype.clone());
    assert!(l.enclosures.is_empty());
    assert!(l.phases.iter().all(|ph| ph.kind != "faubourg"), "no suburb in a village");
}

#[test]
fn explicit_enclosure_style_overrides_the_grammar_default() {
    // A 2 000-inhabitant market town has no wall by default; an explicit style asks for its type.
    let mut cfg = LayoutConfig::default();
    let (open, _) = run("european-organic", 2000, &cfg);
    assert_eq!(open.archetype, "market-town");
    assert!(open.enclosures.iter().all(|e| !e.purpose.is_empty()), "default market town: no town wall");
    cfg.fortification_style = "flanked".into();
    let (walled, p) = run("european-organic", 2000, &cfg);
    consistent(&walled, &p, 2000, &cfg, &walled.archetype.clone());
    let main = walled.enclosures.iter().find(|e| e.purpose.is_empty()).expect("town wall built");
    assert_eq!((main.kind.as_str(), main.style.as_str()), ("wall", "flanked"));
}

#[test]
fn artisan_port_capital_keeps_its_weighted_functions_and_demands() {
    let mut cfg = LayoutConfig::default();
    cfg.programme.functions = Some(ProgrammeFunctions { artisan: 0.8, port: 0.5, capital: 1.0, ..Default::default() });
    let (l, p) = run("european-organic", 30_000, &cfg);
    consistent(&l, &p, 30_000, &cfg, "city");
    let programme = p.programme.as_ref().unwrap();
    let json = |f: &Option<ProgrammeFunctions>| serde_json::to_string(f).unwrap();
    assert_eq!(json(&programme.context.functions), json(&cfg.programme.functions), "functions reach the programme unchanged");
    let roles = built_roles(&p);
    assert!(roles.iter().any(|r| r.starts_with("craft.")), "artisan demand is built");
    // No navigable access declared on a dry site: no port facility is invented.
    assert!(!programme.navigable_frontage);
    assert!(roles.iter().all(|r| !r.starts_with("port.")), "no port without water: {roles:?}");
}

#[test]
fn metropolis_floor_is_multicentre_and_extrapolated_profiles_are_not_capped() {
    // 100 000 is the Metropolis class floor: the multi-centre grammar starts there.
    let cfg = LayoutConfig::default();
    let (m, p) = run("european-organic", 100_000, &cfg);
    consistent(&m, &p, 100_000, &cfg, "metropolis");
    assert!(m.structure.as_ref().unwrap().centers.len() >= 2, "several centres");
    // A culture far beyond its documented scale keeps the requested population.
    let (pa, pp) = run("maori-pa", 120_000, &cfg);
    consistent(&pa, &pp, 120_000, &cfg, "metropolis");
}
