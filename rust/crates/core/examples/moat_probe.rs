//! Moat probe (docs/MOAT_REDESIGN_2026-11-27.md). Replays an archived request to the final town
//! layout and draws the engine's moat of every circuit: its runs (reaches by supply, lips, dams,
//! sluices) and its crossings, over the reserve and the final streets; writes the audit and metrics.
//!
//! Usage: moat_probe <fixture> <out_dir> [--zoom x,y,radius ...] [--pop N] [--culture C] [--style S] [--moat M] [--seed S] [--key K] [--canals SHARE] [--shore on|off] [--tag T]
//!
//! `<fixture>` is one of:
//! - a V2 capture `<case>-request-1-raster.bin` (raster upload; the quarters request
//!   `<case>-request-6-urban.bin` must lie beside it), e.g. `web/out/round-1126b/fortified-moat-cases-full/`;
//! - a raster fixture JSON (`seed, n, width, height, water, [geometry], sites, roads, layoutConfig`,
//!   the `wall_probe` / `urban_case_replay` format);
//! - a finished-layout JSON (`{"layout": ...}`), read on flat dry ground (`--pop`, default 10 000).
//!
//! Writes `<out_dir>/<name>-e<i>.svg` (whole circuit), `-e<i>-gate<g>.svg` (90 m round each land
//! gatehouse), `-e<i>-zoom<k>.svg` (each `--zoom` near the circuit) and `<name>.json` (metrics).
// The metrics object is one large `json!` literal.
#![recursion_limit = "256"]
use magna_urbis_core::urban::{
    Enclosure, Geography, HeightInterpolation, Layout, LayoutConfig, Point, Shape, Site, Street, Surface, VectorGeography,
    generate_quarters, moat_audit, roads_without_gate,
};
use magna_urbis_geom as geom;
use serde::Deserialize;
use serde_json::{Value, json};
use std::collections::BTreeMap;
use std::error::Error;
use std::fmt::Write;
use std::path::{Path, PathBuf};
use std::time::Instant;

type Bounds = (f64, f64, f64, f64);
type View = (f64, f64, f64);

const USAGE: &str = "moat_probe <fixture> <out_dir> [--zoom x,y,radius ...] [--pop N] [--culture C] [--style S] [--moat M] [--seed S] [--key K] [--canals SHARE] [--shore on|off] [--tag T]";
/// Side (px) of every SVG.
const PX: f64 = 1600.0;
/// Radius (m) of the automatic gate zooms.
const GATE_ZOOM: f64 = 90.0;
/// Arc step (m) of the smoothness figure.
const TURN_STEP: f64 = 6.0;

/// What a fixture gives: the terrain, then either a request to replay or a finished layout.
struct Input {
    width: f64,
    n: usize,
    height: Vec<f32>,
    water: Vec<u8>,
    /// Water level plane of a capture (the hydrology's level on wet cells).
    water_level: Option<Vec<f32>>,
    interpolation: HeightInterpolation,
    geometry: Option<Value>,
    source: Source,
}

enum Source {
    Replay { seed: String, sites: Vec<Site>, roads: Vec<Street>, config: LayoutConfig },
    Finished(Box<Layout>),
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct RasterFixture {
    seed: String,
    n: usize,
    width: f64,
    height: Vec<f32>,
    water: Vec<u8>,
    #[serde(default)]
    geometry: Option<Value>,
    sites: Vec<Site>,
    roads: Vec<Street>,
    layout_config: LayoutConfig,
}

fn main() -> Result<(), Box<dyn Error>> {
    let args: Vec<String> = std::env::args().collect();
    if args.len() < 3 {
        return Err(USAGE.into());
    }
    let fixture = PathBuf::from(&args[1]);
    let out = PathBuf::from(&args[2]);
    let (mut zooms, mut pop_override) = (vec![], None);
    // Variants of a capture: another culture, wall style or moat choice on the same site and relief.
    let (mut culture, mut style, mut moat, mut tag): (Option<String>, Option<String>, Option<String>, Option<String>) = (None, None, None, None);
    // `--key`: the site key, which seeds the draws made once per site (wall style, moat form).
    let (mut seed_override, mut key, mut canals): (Option<String>, Option<String>, Option<f64>) = (None, None, None);
    // `--shore off`: the ground of a coastal B-spline field without the shore detail of the drawn coast.
    let mut shore = true;
    let mut i = 3;
    while i < args.len() {
        let value = args.get(i + 1).ok_or(USAGE)?;
        match args[i].as_str() {
            "--zoom" => {
                let v = value.split(',').map(|s| s.trim().parse::<f64>()).collect::<Result<Vec<_>, _>>()?;
                if v.len() != 3 {
                    return Err("--zoom takes x,y,radius".into());
                }
                zooms.push((v[0], v[1], v[2]));
            }
            "--pop" => pop_override = Some(value.parse::<u32>()?),
            "--culture" => culture = Some(value.clone()),
            "--style" => style = Some(value.clone()),
            "--moat" => moat = Some(value.clone()),
            "--seed" => seed_override = Some(value.clone()),
            "--key" => key = Some(value.clone()),
            "--shore" => shore = value != "off",
            "--canals" => canals = Some(value.parse::<f64>()?),
            "--tag" => tag = Some(value.clone()),
            other => return Err(format!("unknown argument {other}; {USAGE}").into()),
        }
        i += 2;
    }
    std::fs::create_dir_all(&out)?;
    let name = match &tag {
        Some(t) => format!("{}-{t}", case_name(&fixture)),
        None => case_name(&fixture),
    };
    let input = load(&fixture)?;
    let mut geography = input
        .geometry
        .map(|v| serde_json::from_value::<VectorGeography>(v).map_err(|e| e.to_string()).and_then(|g| Geography::new(g, input.width)))
        .transpose()?;
    if let (Some(geography), Some(level)) = (geography.as_mut(), &input.water_level) {
        geography.set_water_levels(input.n, input.width, &input.water, level);
    }
    let surface = Surface {
        geometry: geography.as_ref(),
        width: input.width,
        n: input.n,
        height: &input.height,
        water: &input.water,
        interpolation: match input.interpolation {
            HeightInterpolation::BSpline { floor, shore: coastal } => HeightInterpolation::BSpline { floor, shore: coastal && shore },
            other => other,
        },
    };
    let started = Instant::now();
    let (layouts, pops, generation_ms, roads) = match input.source {
        Source::Replay { seed, mut sites, roads, mut config } => {
            for (i, site) in sites.iter_mut().enumerate() {
                if let Some(k) = &key {
                    site.key = if i == 0 { k.clone() } else { format!("{k}-{i}") };
                }
                if let Some(c) = &culture {
                    site.culture = c.clone();
                }
                if let Some(n) = pop_override {
                    site.population = n;
                }
            }
            if let Some(c) = &culture {
                config.culture = c.clone();
            }
            if let Some(st) = &style {
                config.fortification = "wall".into();
                config.fortification_style = st.clone();
            }
            if let Some(m) = &moat {
                config.moat = m.clone();
            }
            if canals.is_some() {
                config.lagoon_canals = canals;
            }
            let seed = seed_override.clone().unwrap_or(seed);
            let layouts = generate_quarters(&seed, &sites, &config, surface, &roads)?;
            let ms = started.elapsed().as_secs_f64() * 1e3;
            (layouts, sites.iter().map(|s| s.population).collect::<Vec<_>>(), Some(ms), roads)
        }
        Source::Finished(layout) => (vec![*layout], vec![10_000], None, vec![]),
    };
    eprintln!("{name}: {} layout(s), generation {:?} ms", layouts.len(), generation_ms.map(|m| m.round()));
    let terrain = TerrainView { width: input.width, n: input.n, height: &input.height, water: &input.water };
    let mut report_layouts = vec![];
    for (li, layout) in layouts.iter().enumerate() {
        let pop = pop_override.unwrap_or_else(|| pops.get(li).copied().unwrap_or(10_000));
        let mut report = vec![];
        let gates: Vec<Value> = layout.enclosures.iter().enumerate().map(|(ei, e)| json!({"enclosure": ei, "editKey": e.edit_key, "gates": gate_streets(e, layout), "ungatedCrossings": ungated(e, layout).iter().map(|(p, role)| json!({"at": [r2(p.x), r2(p.y)], "role": role})).collect::<Vec<_>>()})).collect();
        for e in &layout.enclosures {
            let loose = ungated(e, layout);
            println!("{name} {}: {} gates, {} street crossings away from a gate {}", e.edit_key, e.gates.len(), loose.len(), loose.iter().map(|(p, role)| format!("{role} ({:.0},{:.0})", p.x, p.y)).collect::<Vec<_>>().join(" "));
        }
        for (ei, e) in layout.enclosures.iter().enumerate() {
            let Some(m) = &e.moat else {
                continue;
            };
            let stem = if li == 0 { format!("{name}-e{ei}") } else { format!("{name}-l{li}-e{ei}") };
            let scene = Scene { e, layout, terrain: &terrain };
            let b = bounds(&e.path, m.width_m + 60.0);
            let side = (b.2 - b.0).max(b.3 - b.1);
            std::fs::write(out.join(format!("{stem}.svg")), render(&scene, (b.0, b.1, side), false)?)?;
            for (gi, gh) in e.gatehouses.iter().enumerate().filter(|(_, gh)| !matches!(gh.kind.as_str(), "water" | "shore")) {
                let c = gh.passage[1];
                let view = (c.x - GATE_ZOOM, c.y - GATE_ZOOM, 2.0 * GATE_ZOOM);
                std::fs::write(out.join(format!("{stem}-gate{gi}.svg")), render(&scene, view, true)?)?;
            }
            for (zi, &(x, y, r)) in zooms.iter().enumerate() {
                if x >= b.0 - 200.0 && x <= b.2 + 200.0 && y >= b.1 - 200.0 && y <= b.3 + 200.0 {
                    std::fs::write(out.join(format!("{stem}-zoom{zi}.svg")), render(&scene, (x - r, y - r, 2.0 * r), true)?)?;
                }
            }
            let metrics = metrics(&scene, surface, &roads);
            let audit = &metrics["audit"];
            println!(
                "{stem}: style={} form={} width={:.1} runs={} crossings={} gates {}/{} along={} wet={} unsourced={} invalid={} dry curtain {} covered {} gaps {} roads without gate {} pool={}",
                e.style,
                m.form,
                m.width_m,
                m.runs.len(),
                m.crossings.len(),
                audit["gateCrossings"],
                audit["gates"],
                audit["streetsAlongM"],
                audit["wetReaches"],
                audit["wetWithoutSource"],
                audit["invalid"],
                audit["curtainM"],
                audit["coveredM"],
                audit["uncovered"].as_array().map_or(0, Vec::len),
                audit["roadsWithoutGate"].as_array().map_or(0, Vec::len),
                audit["poolReaches"]
            );
            report.push(metrics);
        }
        report_layouts.push(json!({"key": layout.key, "culture": layout.culture, "population": pop, "enclosures": report, "gateStreets": gates}));
    }
    let summary = json!({"fixture": fixture.display().to_string(), "generationMs": generation_ms.map(r2), "layouts": report_layouts});
    std::fs::write(out.join(format!("{name}.json")), serde_json::to_vec_pretty(&summary)?)?;
    Ok(())
}

// --- Loading ------------------------------------------------------------------------------------

fn case_name(fixture: &Path) -> String {
    let stem = fixture.file_stem().and_then(|s| s.to_str()).unwrap_or("case");
    stem.strip_suffix("-request-1-raster").unwrap_or(stem).to_string()
}

fn load(fixture: &Path) -> Result<Input, Box<dyn Error>> {
    if fixture.extension().is_some_and(|x| x == "bin") {
        return load_capture(fixture);
    }
    let v: Value = serde_json::from_slice(&std::fs::read(fixture)?)?;
    if v.get("layout").is_some() {
        let layout: Layout = serde_json::from_value(v["layout"].clone())?;
        // Flat dry ground over the layout: no terrain travels with these fixtures.
        let b = layout.blocks.iter().flat_map(|b| &b.shape.outer).chain(layout.streets.iter().flat_map(|s| &s.path)).fold(0.0_f64, |m, p| m.max(p.x).max(p.y));
        let n = 16;
        return Ok(Input {
            width: (b * 1.25 + 100.0).max(500.0),
            n,
            height: vec![0.0; n * n],
            water: vec![0; n * n],
            interpolation: HeightInterpolation::Bilinear,
            water_level: None,
            geometry: None,
            source: Source::Finished(Box::new(layout)),
        });
    }
    let f: RasterFixture = serde_json::from_value(v)?;
    if f.height.len() != f.n * f.n || f.water.len() != f.n * f.n {
        return Err("raster fixture: plane sizes differ from n²".into());
    }
    Ok(Input {
        width: f.width,
        n: f.n,
        height: f.height,
        water: f.water,
        interpolation: HeightInterpolation::Bilinear,
            water_level: None,
        geometry: f.geometry.filter(|g| !g.is_null()),
        source: Source::Replay { seed: f.seed, sites: f.sites, roads: f.roads, config: f.layout_config },
    })
}

/// A raster upload as the engine reads it (`rust/crates/local/src/main.rs`, `raster_upload`): a
/// u32 header length, the JSON header, then height, water level, river width, river ids (f32/i32
/// planes) and the u8 water mask, and an optional physical height plane.
fn load_capture(raster: &Path) -> Result<Input, Box<dyn Error>> {
    let bytes = std::fs::read(raster)?;
    let size = u32::from_le_bytes(bytes.get(..4).ok_or("short raster")?.try_into()?) as usize;
    let header: Value = serde_json::from_slice(bytes.get(4..4 + size).ok_or("short raster header")?)?;
    let n = header["n"].as_u64().ok_or("raster header: n")? as usize;
    let width = header["width"].as_f64().ok_or("raster header: width")?;
    let count = n * n;
    let data = &bytes[4 + size..];
    let physical = header["physicalN"].as_u64().map(|p| p as usize);
    if data.len() != count * 17 + 4 * physical.map_or(0, |p| p * p) {
        return Err("unexpected raster plane sizes".into());
    }
    let floats = |from: usize, len: usize| -> Vec<f32> {
        data[from..from + 4 * len].chunks_exact(4).map(|b| f32::from_le_bytes([b[0], b[1], b[2], b[3]])).collect()
    };
    let water = data[16 * count..17 * count].to_vec();
    let (height, interpolation) = match physical {
        None => (floats(0, count), HeightInterpolation::Bilinear),
        Some(p) if header["physicalInterpolation"].is_null() => (floats(17 * count, p * p), HeightInterpolation::PhysicalBilinear),
        // As the engine's `set_physical_spline`, without the cave test: a capture carries no cave field.
        Some(p) if header["physicalInterpolation"] == "bspline" => {
            let floor = header["physicalFloor"].as_f64().unwrap_or(0.0) as f32;
            (floats(17 * count, p * p), HeightInterpolation::BSpline { floor, shore: floor <= 0.0 && water.contains(&1) })
        }
        Some(_) => return Err("unknown physical interpolation".into()),
    };
    let file = raster.file_name().and_then(|f| f.to_str()).ok_or("raster file name")?;
    let quarters = raster.with_file_name(file.replace("request-1-raster.bin", "request-6-urban.bin"));
    let q: Value = serde_json::from_slice(&std::fs::read(&quarters).map_err(|e| format!("{}: {e}", quarters.display()))?)?;
    if q["kind"] != "quarters" {
        return Err(format!("{} is no quarters request", quarters.display()).into());
    }
    Ok(Input {
        width,
        n,
        height,
        water,
        water_level: Some(floats(count, count)),
        interpolation,
        geometry: Some(header["geometry"].clone()).filter(|g| !g.is_null()),
        source: Source::Replay {
            seed: q["seed"].as_str().ok_or("quarters seed")?.to_string(),
            sites: serde_json::from_value(q["sites"].clone())?,
            roads: serde_json::from_value(q["roads"].clone())?,
            config: serde_json::from_value(q["layoutConfig"].clone())?,
        },
    })
}

// --- Metrics ------------------------------------------------------------------------------------

fn metrics(scene: &Scene<'_>, surface: Surface<'_>, roads: &[Street]) -> Value {
    let Scene { e, layout, .. } = *scene;
    let Some(m) = &e.moat else {
        return Value::Null;
    };
    let a = moat_audit(e, &layout.enclosures, &layout.streets, surface);
    let blank = roads_without_gate(e, roads);
    let widths: Vec<f64> = m.runs.iter().flat_map(|r| r.inner.iter().zip(&r.outer).map(|(&p, &q)| dist(p, q))).collect();
    let outer_lips: Vec<Vec<Point>> = m
        .runs
        .iter()
        .map(|r| {
            let mut c = r.outer.clone();
            if r.closed && !c.is_empty() {
                c.push(c[0]);
            }
            c
        })
        .collect();
    let mut kinds = BTreeMap::new();
    for d in &e.ditch {
        *kinds.entry(d.kind.clone()).or_insert(0usize) += 1;
    }
    // Land: the ditch outside the reserve, over blocks.
    let reserve: Vec<(&Shape, Bounds)> = e.reserve.iter().map(|s| (s, bounds(&s.outer, 0.0))).collect();
    let blocks: Vec<(&Shape, Bounds)> = layout.blocks.iter().map(|b| (&b.shape, bounds(&b.shape.outer, 0.0))).collect();
    let overlap = |s: &Shape, others: &[(&Shape, Bounds)]| -> f64 {
        let sb = bounds(&s.outer, 0.0);
        others.iter().filter(|(_, ob)| meets(sb, *ob)).map(|(o, _)| geom::intersection(s, o).iter().map(geom::area).sum::<f64>()).sum()
    };
    let escape: f64 = e.ditch.iter().map(|d| (geom::area(&d.shape) - overlap(&d.shape, &reserve)).max(0.0)).sum();
    let on_blocks: f64 = e.ditch.iter().map(|d| overlap(&d.shape, &blocks)).sum();
    json!({
        "enclosure": {"editKey": e.edit_key, "kind": e.kind, "style": e.style, "purpose": e.purpose},
        "form": m.form, "state": m.state, "widthM": r2(m.width_m), "depthM": r2(m.depth_m),
        "runs": m.runs.iter().map(|r| json!({
            "closed": r.closed,
            "stations": r.inner.len(),
            "ends": r.ends,
            "reaches": r.reaches.iter().map(|x| json!({"from": x.from, "to": x.to, "supply": x.supply, "level": x.level})).collect::<Vec<_>>(),
        })).collect::<Vec<_>>(),
        "crossings": m.crossings.iter().map(|c| json!({"run": c.run, "gate": c.gate, "kind": c.kind, "halfWidthM": r2(c.half_width_m),
            "lengthM": r2(c.path.windows(2).map(|w| dist(w[0], w[1])).sum())})).collect::<Vec<_>>(),
        "dams": m.dams.len(),
        "sluices": m.sluices.len(),
        "ditchWidthM": {"min": r2(widths.iter().copied().fold(f64::MAX, f64::min)), "mean": r2(widths.iter().sum::<f64>() / widths.len().max(1) as f64),
                        "max": r2(widths.iter().copied().fold(0.0, f64::max))},
        "outerLipRmsTurnDegPer6m": r2(rms_turn(&outer_lips)),
        "ditch": {"pieces": e.ditch.len(), "kinds": kinds,
                  "vertices": e.ditch.iter().map(|d| d.shape.outer.len() + d.shape.holes.iter().map(Vec::len).sum::<usize>()).sum::<usize>()},
        "ditchOutsideReserveM2": r2(escape),
        "ditchOverBlocksM2": r2(on_blocks),
        "audit": {"runs": a.runs, "ringM": r2(a.ring_m), "runM": r2(a.run_m), "gates": a.gates, "gateCrossings": a.gate_crossings, "uncrossedGates": a.uncrossed_gates.iter().map(|p| json!([r2(p.x), r2(p.y)])).collect::<Vec<_>>(),
                  "otherCrossings": a.other_crossings, "streetsAlongM": r2(a.streets_along_m), "wetReaches": a.wet_reaches,
                  "poolReaches": a.pool_reaches, "wetWithoutSource": a.wet_without_source, "dams": a.dams, "invalid": a.invalid,
                  "curtainM": r2(a.curtain_m), "coveredM": r2(a.covered_m),
                  "uncovered": a.uncovered.iter().map(|u| json!({"at": [r2(u.at.x), r2(u.at.y)], "lengthM": r2(u.length_m), "reason": u.reason})).collect::<Vec<_>>(),
                  "roadsWithoutGate": blank.iter().map(|p| [r2(p.x), r2(p.y)]).collect::<Vec<_>>()},
    })
}

/// RMS turn angle (degrees) of the chains resampled every `TURN_STEP` m.
/// Where a land street crosses the curtain of `e` more than `GATE_AT` m from every gate and every gatehouse passage: the wall is cut only by gates.
fn ungated(e: &Enclosure, layout: &Layout) -> Vec<(Point, String)> {
    const GATE_AT: f64 = 12.0;
    let mut out: Vec<(Point, String)> = vec![];
    // Decks and waterside ways pass a curtain by a water passage, not a gate.
    let land = |s: &&Street| !matches!(s.role.as_str(), "wall-lane" | "bridge" | "ford" | "quay" | "pier" | "boardwalk" | "landing" | "mole" | "causeway");
    for s in layout.streets.iter().filter(land) {
        for w in s.path.windows(2) {
            for c in e.path.windows(2) {
                if let Some((_, p)) = geom::segment_hit(w[0], w[1], c[0], c[1])
                    && e.gates.iter().all(|&q| dist(q, p) > GATE_AT)
                    // The passage of a gatehouse, a water or a shore passage too: the curtain is open along it.
                    && e.gatehouses.iter().all(|gh| geom::distance(p, gh.passage[0], gh.passage[1]).0 > GATE_AT)
                    && out.iter().all(|(q, _)| dist(*q, p) > 2.0)
                {
                    if std::env::var("URBAN_PROFILE").is_ok() {
                        let gate = e.gates.iter().map(|&q| dist(q, p)).fold(f64::INFINITY, f64::min);
                        let passage = e.gatehouses.iter().map(|gh| (geom::distance(p, gh.passage[0], gh.passage[1]).0, gh.kind.clone())).min_by(|a, b| a.0.total_cmp(&b.0));
                        let ends = layout.streets.iter().flat_map(|t| [t.path[0], t.path[t.path.len() - 1]]).filter(|&q| dist(q, p) < 0.6).count();
                        eprintln!("  ungated: {} ({:.1},{:.1}) of {} points, widths {:?}, from ({:.1},{:.1}) to ({:.1},{:.1}); nearest gate {gate:.1} m, passage {passage:?}, street ends there {ends}, segment ({:.2},{:.2})-({:.2},{:.2})", s.role, p.x, p.y, s.path.len(), s.widths.first(), s.path[0].x, s.path[0].y, s.path[s.path.len() - 1].x, s.path[s.path.len() - 1].y, w[0].x, w[0].y, w[1].x, w[1].y);
                    }
                    out.push((p, s.role.clone()));
                }
            }
        }
    }
    out
}

/// Reach (m) round a gate within which streets are listed.
const GATE_STREETS: f64 = 45.0;
/// What meets at each gate of a circuit: the streets with a vertex within `GATE_STREETS` of the gate point, their role,
/// rank and width, where they start and end, how close they pass, whether they cross the curtain there and which of
/// their ends are dead ends (no other street within 1.5 m).
fn gate_streets(e: &Enclosure, layout: &Layout) -> Vec<Value> {
    let free = |p: Point, own: usize| !layout.streets.iter().enumerate().any(|(j, s)| j != own && s.path.windows(2).any(|w| geom::distance(p, w[0], w[1]).0 < 1.5));
    let curtain_hit = |s: &Street, q: Point| {
        s.path.windows(2).any(|w| e.path.windows(2).any(|c| geom::segment_hit(w[0], w[1], c[0], c[1]).is_some_and(|h| dist(h.1, q) < GATE_STREETS)))
    };
    e.gates
        .iter()
        .enumerate()
        .map(|(gi, &q)| {
            let house = e.gatehouses.iter().find(|gh| gh.gate == gi);
            let streets: Vec<Value> = layout
                .streets
                .iter()
                .enumerate()
                .filter_map(|(si, s)| {
                    let near = s.path.windows(2).map(|w| geom::distance(q, w[0], w[1]).0).fold(f64::MAX, f64::min);
                    if near > GATE_STREETS || s.path.len() < 2 {
                        return None;
                    }
                    let (a, b) = (s.path[0], s.path[s.path.len() - 1]);
                    let length: f64 = s.path.windows(2).map(|w| dist(w[0], w[1])).sum();
                    let inside = |p: Point| geom::contains(&Shape { outer: e.path.clone(), holes: vec![] }, p);
                    Some(json!({
                        "street": si, "role": s.role, "rank": s.rank, "widthM": r2(s.widths.first().copied().unwrap_or(0.0)),
                        "lengthM": r2(length), "nearM": r2(near), "crossesCurtain": curtain_hit(s, q),
                        "from": [r2(a.x), r2(a.y)], "to": [r2(b.x), r2(b.y)],
                        "fromInside": inside(a), "toInside": inside(b), "fromDead": free(a, si), "toDead": free(b, si),
                        "fromToGateM": r2(dist(a, q)), "toToGateM": r2(dist(b, q)),
                    }))
                })
                .collect();
            json!({"gate": gi, "at": [r2(q.x), r2(q.y)], "inner": e.inner_gates.contains(&gi), "house": house.map(|gh| gh.kind.clone()), "streets": streets})
        })
        .collect()
}

fn rms_turn(chains: &[Vec<Point>]) -> f64 {
    let mut sum = 0.0;
    let mut count = 0usize;
    for c in chains {
        let p = resample_open(c, TURN_STEP);
        for i in 1..p.len().saturating_sub(1) {
            let (u, v) = ((p[i].x - p[i - 1].x, p[i].y - p[i - 1].y), (p[i + 1].x - p[i].x, p[i + 1].y - p[i].y));
            let turn = (u.0 * v.1 - u.1 * v.0).atan2(u.0 * v.0 + u.1 * v.1).to_degrees();
            sum += turn * turn;
            count += 1;
        }
    }
    if count == 0 { 0.0 } else { (sum / count as f64).sqrt() }
}

// --- SVG ----------------------------------------------------------------------------------------

struct TerrainView<'a> {
    width: f64,
    n: usize,
    height: &'a [f32],
    water: &'a [u8],
}

struct Scene<'a> {
    e: &'a Enclosure,
    layout: &'a Layout,
    terrain: &'a TerrainView<'a>,
}

fn render(scene: &Scene<'_>, view: View, close: bool) -> Result<String, std::fmt::Error> {
    let Scene { e, layout, terrain } = *scene;
    let (x0, y0, side) = view;
    let px = side / PX;
    let vb: Bounds = (x0, y0, x0 + side, y0 + side);
    let mut svg = String::new();
    write!(svg, "<svg xmlns='http://www.w3.org/2000/svg' width='{PX}' height='{PX}' viewBox='{x0:.2} {y0:.2} {side:.2} {side:.2}'>")?;
    write!(svg, "<rect x='{x0:.2}' y='{y0:.2}' width='{side:.2}' height='{side:.2}' fill='#cbd3ad'/>")?;
    // Water cells (merged along rows), then hillshade as in wall_probe.
    let cell = terrain.width / terrain.n as f64;
    let (i0, i1) = (((x0 / cell).floor().max(0.0)) as usize, (((x0 + side) / cell).ceil() as usize).min(terrain.n));
    let (j0, j1) = (((y0 / cell).floor().max(0.0)) as usize, (((y0 + side) / cell).ceil() as usize).min(terrain.n));
    for j in j0..j1 {
        let mut i = i0;
        while i < i1 {
            if terrain.water[j * terrain.n + i] == 0 {
                i += 1;
                continue;
            }
            let start = i;
            while i < i1 && terrain.water[j * terrain.n + i] != 0 {
                i += 1;
            }
            write!(svg, "<rect x='{:.2}' y='{:.2}' width='{:.2}' height='{:.2}' fill='#628d9b'/>", start as f64 * cell, j as f64 * cell, (i - start) as f64 * cell + 0.3, cell + 0.3)?;
        }
    }
    let res = ((terrain.height.len() as f64).sqrt() as usize).max(1);
    let hcell = terrain.width / res as f64;
    let (a0, a1) = (((x0 / hcell).floor().max(0.0)) as usize, (((x0 + side) / hcell).ceil() as usize).min(res.saturating_sub(1)));
    let (b0, b1) = (((y0 / hcell).floor().max(0.0)) as usize, (((y0 + side) / hcell).ceil() as usize).min(res.saturating_sub(1)));
    let h = |i: usize, j: usize| f64::from(terrain.height[j * res + i]);
    for y in b0..b1 {
        for x in a0..a1 {
            let shade = ((h(x, y) - h(x + 1, y + 1)) / hcell * 2.0).clamp(-1.0, 1.0);
            if shade.abs() > 0.05 {
                write!(svg, "<rect x='{:.2}' y='{:.2}' width='{:.2}' height='{:.2}' fill='{}' fill-opacity='{:.2}'/>", x as f64 * hcell, y as f64 * hcell, hcell + 0.3, hcell + 0.3,
                    if shade > 0.0 { "#ffffff" } else { "#3d3a2a" }, shade.abs() * 0.55)?;
            }
        }
    }
    for b in layout.blocks.iter().filter(|b| meets(bounds(&b.shape.outer, 0.0), vb)) {
        let fill = if b.kind == "reserve" { "#a9bb85" } else { "#e3d5b6" };
        write!(svg, "<path fill='{fill}' fill-opacity='0.8' stroke='#887859' stroke-width='{:.3}' d='{}'/>", 0.6 * px, shape_d(&b.shape))?;
    }
    for s in &layout.streets {
        for (k, w) in s.path.windows(2).enumerate() {
            if !meets(bounds(w, 10.0), vb) {
                continue;
            }
            let width = s.widths.get(k).or(s.widths.first()).copied().unwrap_or(4.0);
            write!(svg, "<line x1='{:.2}' y1='{:.2}' x2='{:.2}' y2='{:.2}' stroke='#fff3ce' stroke-width='{width:.2}' stroke-linecap='round'/>", w[0].x, w[0].y, w[1].x, w[1].y)?;
        }
    }
    for r in e.reserve.iter().filter(|r| meets(bounds(&r.outer, 0.0), vb)) {
        write!(svg, "<path fill='none' stroke='#7a5230' stroke-width='{:.3}' stroke-dasharray='{:.2} {:.2}' d='{}'/>", 0.8 * px, 4.0 * px, 3.0 * px, shape_d(r))?;
    }
    // Ditch pieces by kind: one per reach (fed, pool, dry), then the detached ditches.
    for d in e.ditch.iter().filter(|d| meets(bounds(&d.shape.outer, 0.0), vb)) {
        let fill = match d.kind.as_str() {
            "wet" => "#2f6fb0",
            "pool" => "#3f9f8f",
            _ => "#b89a5a",
        };
        write!(svg, "<path fill='{fill}' fill-opacity='0.45' fill-rule='evenodd' stroke='#2b3b44' stroke-width='{:.3}' d='{}'/>", 0.4 * px, shape_d(&d.shape))?;
    }
    write!(svg, "<polyline fill='none' stroke='#c0302a' stroke-width='{:.3}' points='{}'/>", 1.6 * px, points(&e.path))?;
    let works = e.towers_detail.iter().map(|t| &t.footprint).chain(e.gatehouses.iter().flat_map(|gh| gh.masses.iter()));
    for w in works.filter(|w| meets(bounds(&w.outer, 0.0), vb)) {
        write!(svg, "<path fill='#6d1410' d='{}'/>", shape_d(w))?;
    }
    let Some(m) = &e.moat else {
        svg.push_str("</svg>");
        return Ok(svg);
    };
    // Lips and levels of the engine's runs, its dams, sluices and crossings (green: by a gate,
    // magenta: another street; dashed: a bridge), drawn at their width.
    for run in &m.runs {
        for lip in [&run.inner, &run.outer] {
            let mut lip = lip.clone();
            if run.closed && !lip.is_empty() {
                lip.push(lip[0]);
            }
            write!(svg, "<polyline fill='none' stroke='#e07b00' stroke-width='{:.3}' points='{}'/>", 1.2 * px, points(&lip))?;
        }
        if close {
            for reach in &run.reaches {
                let k = if reach.to > reach.from { (reach.from + reach.to) / 2 } else { reach.from };
                let at = lerp(run.inner[k], run.outer[k], 0.5);
                let text = reach.level.map_or_else(|| reach.supply.clone(), |l| format!("{} {l:.1} m", reach.supply));
                write!(svg, "<text x='{:.2}' y='{:.2}' font-size='{:.2}' font-family='sans-serif' fill='#102030'>{text}</text>", at.x, at.y, 11.0 * px)?;
            }
        }
    }
    for d in &m.dams {
        write!(svg, "<line x1='{:.2}' y1='{:.2}' x2='{:.2}' y2='{:.2}' stroke='#111' stroke-width='{:.3}'/>", d[0].x, d[0].y, d[1].x, d[1].y, 2.2 * px)?;
    }
    for s in &m.sluices {
        write!(svg, "<line x1='{:.2}' y1='{:.2}' x2='{:.2}' y2='{:.2}' stroke='#00bcd4' stroke-width='{:.3}'/>", s[0].x, s[0].y, s[1].x, s[1].y, 2.2 * px)?;
    }
    for c in &m.crossings {
        let colour = if c.gate.is_some() { "#1b9e3a" } else { "#d81b9a" };
        let dash = if c.kind == "causeway" { String::new() } else { format!(" stroke-dasharray='{:.2} {:.2}'", 3.0 * px, 2.0 * px) };
        write!(svg, "<polyline fill='none' stroke='{colour}' stroke-opacity='0.55' stroke-width='{:.2}'{dash} points='{}'/>", 2.0 * c.half_width_m, points(&c.path))?;
    }
    svg.push_str("</svg>");
    Ok(svg)
}

fn shape_d(s: &Shape) -> String {
    let mut d = String::new();
    for r in std::iter::once(&s.outer).chain(&s.holes) {
        for (i, p) in r.iter().enumerate() {
            let _ = write!(d, "{}{:.2},{:.2} ", if i == 0 { "M" } else { "L" }, p.x, p.y);
        }
        if !r.is_empty() {
            d.push_str("Z ");
        }
    }
    d
}

fn points(p: &[Point]) -> String {
    let mut s = String::new();
    for q in p {
        let _ = write!(s, "{:.2},{:.2} ", q.x, q.y);
    }
    s
}

// --- Small geometry -----------------------------------------------------------------------------

fn r2(x: f64) -> f64 {
    (x * 100.0).round() / 100.0
}

fn dist(a: Point, b: Point) -> f64 {
    (a.x - b.x).hypot(a.y - b.y)
}

fn lerp(a: Point, b: Point, t: f64) -> Point {
    Point { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }
}

fn bounds(points: &[Point], margin: f64) -> Bounds {
    let b = points.iter().fold((f64::MAX, f64::MAX, f64::MIN, f64::MIN), |b, p| (b.0.min(p.x), b.1.min(p.y), b.2.max(p.x), b.3.max(p.y)));
    (b.0 - margin, b.1 - margin, b.2 + margin, b.3 + margin)
}

fn meets(a: Bounds, b: Bounds) -> bool {
    a.0 <= b.2 && b.0 <= a.2 && a.1 <= b.3 && b.1 <= a.3
}

/// An open polyline resampled every `step` m from its first point.
fn resample_open(line: &[Point], step: f64) -> Vec<Point> {
    let mut out = vec![];
    let Some(&first) = line.first() else {
        return out;
    };
    out.push(first);
    let mut left = step;
    for w in line.windows(2) {
        let l = dist(w[0], w[1]);
        let mut at = 0.0;
        while l - at >= left {
            at += left;
            out.push(lerp(w[0], w[1], at / l));
            left = step;
        }
        left -= l - at;
    }
    out
}
