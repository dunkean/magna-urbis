//! Activity sites (catalogue P3) on a terrain-bench dump: the dump's settlements are
//! placed as a fixed list, sites are counted by template / mode / parent class, roads are
//! routed with `activityAccess` off (must equal the network without sites) and on, and
//! `activity_sites.png` draws sites, network nodes (crimson), buildings and the two networks over a
//! hillshade; `activity_nodes_installations.png` zooms on nodes and sites with their installations.
//!
//! `cargo run --release -p magna-urbis-core --example activities_probe -- [dump.json] [out dir] [culture]`
use magna_urbis_core::settlements::roads::{RoadConfig, RoadOutput};
use magna_urbis_core::settlements::{Config, Point, Raster, SettlementSpec, Terrain};
use std::collections::BTreeMap;
use std::time::Instant;

fn decode(text: &str) -> Vec<u8> {
    const TABLE: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut value = [255_u8; 256];
    for (i, &c) in TABLE.iter().enumerate() {
        value[c as usize] = i as u8;
    }
    let (mut out, mut acc, mut bits) = (Vec::new(), 0_u32, 0);
    for &c in text.as_bytes() {
        let v = value[c as usize];
        if v == 255 {
            continue;
        }
        acc = (acc << 6) | v as u32;
        bits += 6;
        if bits >= 8 {
            bits -= 8;
            out.push((acc >> bits) as u8);
        }
    }
    out
}
fn words<T>(text: &str, f: fn([u8; 4]) -> T) -> Vec<T> {
    decode(text).as_chunks::<4>().0.iter().map(|b| f(*b)).collect()
}
/// Minimal PNG (RGB, stored deflate blocks).
fn png(path: &std::path::Path, w: usize, h: usize, rgb: &[u8]) {
    fn crc(data: &[u8]) -> u32 {
        let mut c = !0u32;
        for &b in data {
            c ^= b as u32;
            for _ in 0..8 {
                c = if c & 1 != 0 { 0xedb88320 ^ (c >> 1) } else { c >> 1 };
            }
        }
        !c
    }
    let mut raw = Vec::with_capacity(h * (3 * w + 1));
    for y in 0..h {
        raw.push(0);
        raw.extend_from_slice(&rgb[y * 3 * w..(y + 1) * 3 * w]);
    }
    let mut z = vec![0x78, 0x01];
    for (i, chunk) in raw.chunks(65535).enumerate() {
        z.push(u8::from((i + 1) * 65535 >= raw.len()));
        z.extend_from_slice(&(chunk.len() as u16).to_le_bytes());
        z.extend_from_slice(&(!(chunk.len() as u16)).to_le_bytes());
        z.extend_from_slice(chunk);
    }
    let (mut a, mut b) = (1u32, 0u32);
    for &v in &raw {
        a = (a + v as u32) % 65521;
        b = (b + a) % 65521;
    }
    z.extend_from_slice(&((b << 16) | a).to_be_bytes());
    let mut out = b"\x89PNG\r\n\x1a\n".to_vec();
    let mut chunk = |kind: &[u8], data: &[u8]| {
        out.extend_from_slice(&(data.len() as u32).to_be_bytes());
        let body: Vec<u8> = kind.iter().chain(data).copied().collect();
        out.extend_from_slice(&body);
        out.extend_from_slice(&crc(&body).to_be_bytes());
    };
    let mut head = (w as u32).to_be_bytes().to_vec();
    head.extend_from_slice(&(h as u32).to_be_bytes());
    head.extend_from_slice(&[8, 2, 0, 0, 0]);
    chunk(b"IHDR", &head);
    chunk(b"IDAT", &z);
    chunk(b"IEND", &[]);
    std::fs::write(path, out).unwrap();
}

fn main() {
    let args: Vec<String> = std::env::args().collect();
    let default = concat!(env!("CARGO_MANIFEST_DIR"), "/../../../web/out/terrain-roads/mountains-7-dump.json");
    let path = args.get(1).filter(|s| !s.is_empty()).map_or(default, String::as_str);
    let out_dir = std::path::PathBuf::from(args.get(2).filter(|s| !s.is_empty()).cloned().unwrap_or_else(|| {
        std::env::temp_dir().join("magna-urbis-activities-probe").to_string_lossy().into()
    }));
    std::fs::create_dir_all(&out_dir).unwrap();
    let culture = args.get(3).cloned();
    let dump: serde_json::Value = serde_json::from_str(&std::fs::read_to_string(path).expect("dump file")).unwrap();
    let width = dump["width"].as_f64().unwrap();
    let n = dump["n"].as_u64().unwrap() as usize;
    let height = words(dump["height"].as_str().unwrap(), f32::from_le_bytes);
    let water = decode(dump["water"].as_str().unwrap());
    let level = words(dump["waterLevel"].as_str().unwrap(), f32::from_le_bytes);
    let widths = words(dump["riverWidth"].as_str().unwrap(), f32::from_le_bytes);
    let ids = words(dump["riverIds"].as_str().unwrap(), i32::from_le_bytes);
    let mut terrain = Terrain::new(Raster { width, n, height: &height, water: &water, water_level: &level, river_width: &widths, river_ids: &ids }).unwrap();
    terrain.set_region(magna_urbis_core::resources::RegionInput { seed: "7".into(), biome: "temperate".into(), ..Default::default() });
    let list: Vec<SettlementSpec> = dump["sites"]
        .as_array()
        .unwrap()
        .iter()
        .map(|s| SettlementSpec {
            key: s["key"].as_str().unwrap().into(),
            population: s["population"].as_u64().unwrap() as u32,
            culture: culture.clone().unwrap_or_else(|| s["culture"].as_str().unwrap().into()),
            position: Some(Point { x: s["center"]["x"].as_f64().unwrap(), y: s["center"]["y"].as_f64().unwrap() }),
            ..Default::default()
        })
        .collect();
    let t = Instant::now();
    let r = terrain.resources();
    let coastal = r.anchors.iter().filter(|a| a.resource == "fish_coast").count();
    println!("resources {:.0} ms: {} anchors ({} coastal landings)", t.elapsed().as_secs_f64() * 1e3, r.anchors.len(), coastal);
    let t = Instant::now();
    let placed = terrain.place("7", &Config { mode: "list".into(), list, ..Default::default() }).unwrap();
    println!("placement + activities {:.0} ms: {} settlements, {} activity sites", t.elapsed().as_secs_f64() * 1e3, placed.settlements.len(), placed.activities.len());
    let mut by: BTreeMap<String, usize> = BTreeMap::new();
    for a in &placed.activities {
        *by.entry(format!("{} ({})", a.template, a.mode)).or_default() += 1;
        *by.entry(format!("  building {}", a.buildings.iter().map(|b| b.archetype.as_str()).collect::<Vec<_>>().join("+"))).or_default() += 0;
    }
    for (k, v) in by.iter().filter(|(_, v)| **v > 0) {
        println!("  {k:<45} {v}");
    }
    let mut per_parent: BTreeMap<String, (String, usize)> = BTreeMap::new();
    for s in &placed.settlements {
        per_parent.insert(s.spec.key.clone(), (s.cls.clone(), 0));
    }
    for a in &placed.activities {
        per_parent.get_mut(&a.parent).unwrap().1 += 1;
    }
    println!("sites per parent: {}", per_parent.iter().map(|(k, (c, n))| format!("{k}[{c}]={n}")).collect::<Vec<_>>().join(" "));
    let buildings: usize = placed.activities.iter().map(|a| a.buildings.len()).sum();
    let massed = placed.activities.iter().flat_map(|a| &a.buildings).filter(|b| b.massing.is_array()).count();
    println!("{buildings} buildings ({massed} with massing)");
    // Roads: settlements only, all sites with the switch off, all sites with it on.
    let places: Vec<_> = placed.road_sites().into_iter().filter(|s| s.access.is_none()).collect();
    let all = placed.road_sites();
    let cfg = RoadConfig::default();
    let t = Instant::now();
    let base = terrain.roads("7", &places, &cfg).unwrap();
    let base_ms = t.elapsed().as_secs_f64() * 1e3;
    let off = terrain.roads("7", &all, &cfg).unwrap();
    let same = serde_json::to_string(&base).unwrap() == serde_json::to_string(&off).unwrap();
    let t = Instant::now();
    let on = terrain.roads("7", &all, &RoadConfig { activity_access: true, ..cfg }).unwrap();
    let on_ms = t.elapsed().as_secs_f64() * 1e3;
    let km = |o: &RoadOutput| o.segments.iter().map(|s| s.length).sum::<f64>() / 1000.0;
    println!("roads: base {} segments {:.1} km {base_ms:.0} ms | off identical: {same} | on {} segments {:.1} km {on_ms:.0} ms {:?}",
        base.segments.len(), km(&base), on.segments.len(), km(&on), on.length_by_class);
    // Network nodes (P4) and installations (P5).
    let mut nodes: BTreeMap<String, usize> = BTreeMap::new();
    for n in &on.nodes {
        *nodes.entry(format!("{} ({} {})", n.template, n.resource, n.culture)).or_default() += 1;
    }
    println!("nodes: {} {:?}", on.nodes.len(), nodes);
    for n in &on.nodes {
        println!("  {} {} [{}] inst {}", n.id, n.parent, n.buildings.iter().map(|b| b.archetype.as_str()).collect::<Vec<_>>().join("+"), n.installations.iter().map(|i| i.archetype.as_str()).collect::<Vec<_>>().join("+"));
    }
    let mut kinds: BTreeMap<String, usize> = BTreeMap::new();
    for i in placed.activities.iter().chain(&on.nodes).flat_map(|a| &a.installations) {
        *kinds.entry(i.kind.clone()).or_default() += 1;
    }
    let wanted: usize = placed.activities.iter().chain(&on.nodes).map(|a| a.installations.len()).sum();
    println!("installations: {} {:?}", kinds.values().sum::<usize>(), kinds);
    let _ = wanted;
    // Picture: 1024 px over the hillshade.
    let px = 1024usize;
    let s = width / px as f64;
    let dem = width / n as f64;
    let h = |x: f64, y: f64| height[((y / dem) as usize).min(n - 1) * n + ((x / dem) as usize).min(n - 1)];
    let mut rgb = vec![0u8; px * px * 3];
    for j in 0..px {
        for i in 0..px {
            let (x, y) = ((i as f64 + 0.5) * s, (j as f64 + 0.5) * s);
            let w = water[((y / dem) as usize).min(n - 1) * n + ((x / dem) as usize).min(n - 1)];
            let gx = (h(x + s, y) - h(x - s, y)) / (2.0 * s as f32);
            let gy = (h(x, y + s) - h(x, y - s)) / (2.0 * s as f32);
            let shade = (0.85 + 1.6 * (-gx - gy) / (1.0 + gx * gx + gy * gy).sqrt()).clamp(0.45, 1.25);
            let c = if w != 0 { [70, 120, 180] } else { [(225.0 * shade).min(255.0) as u8, (215.0 * shade).min(255.0) as u8, (190.0 * shade).min(255.0) as u8] };
            rgb[(j * px + i) * 3..][..3].copy_from_slice(&c);
        }
    }
    let mut put = |x: f64, y: f64, c: [u8; 3]| {
        let (i, j) = ((x / s) as isize, (y / s) as isize);
        if i >= 0 && j >= 0 && (i as usize) < px && (j as usize) < px {
            rgb[(j as usize * px + i as usize) * 3..][..3].copy_from_slice(&c);
        }
    };
    let line = |a: Point, b: Point, c: [u8; 3], put: &mut dyn FnMut(f64, f64, [u8; 3])| {
        let steps = (a.distance_to(b) / (0.5 * s)).ceil().max(1.0) as usize;
        for k in 0..=steps {
            let t = k as f64 / steps as f64;
            put(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t, c);
        }
    };
    for seg in &on.segments {
        let c = match seg.class.as_str() { "track" => [200, 120, 40], "trail" => [230, 170, 90], _ => [150, 60, 40] };
        for w in seg.path.windows(2) {
            line(w[0], w[1], c, &mut put);
        }
    }
    for seg in &base.segments {
        for w in seg.path.windows(2) {
            line(w[0], w[1], [60, 30, 20], &mut put);
        }
    }
    for st in &placed.settlements {
        for k in 0..64 {
            let a = k as f64 / 64.0 * std::f64::consts::TAU;
            put(st.center.x + st.radius * a.cos(), st.center.y + st.radius * a.sin(), [0, 0, 0]);
        }
    }
    let color = |kind: &str| match kind {
        "quarry" => [120, 120, 120],
        "clay_pit" => [190, 110, 60],
        "mill_seat" => [0, 120, 255],
        "wind_knoll" => [120, 200, 255],
        "fishing_landing" => [0, 40, 160],
        "logging" | "charcoal" => [20, 110, 20],
        "pasture" | "upland_pasture" => [200, 180, 0],
        "hunting" => [230, 120, 20],
        "mine" => [200, 0, 0],
        _ => [255, 0, 255],
    };
    for a in &placed.activities {
        let c = color(&a.kind);
        for dy in -6_i32..=6 {
            for dx in -6_i32..=6 {
                let d2 = dx * dx + dy * dy;
                if d2 <= 38 {
                    put(a.x + dx as f64 * s, a.y + dy as f64 * s, if d2 > 24 { [0, 0, 0] } else { c });
                }
            }
        }
        line(Point { x: a.x, y: a.y }, a.access, [0, 0, 0], &mut put);
    }
    for n in &on.nodes {
        for dy in -7_i32..=7 {
            for dx in -7_i32..=7 {
                let d2 = dx * dx + dy * dy;
                if d2 <= 49 {
                    put(n.x + dx as f64 * s, n.y + dy as f64 * s, if d2 > 30 { [255, 255, 255] } else { [208, 48, 106] });
                }
            }
        }
    }
    let file = out_dir.join("activity_sites.png");
    png(&file, px, px, &rgb);
    println!("image: {}", file.display());
    // Zoom: footprints of the first sites with three buildings or more, 0.25 m/px, 4 tiles.
    let tile = 240usize;
    let picks: Vec<_> = placed.activities.iter().filter(|a| a.buildings.len() >= 3).take(4).collect();
    let mut zoom = vec![235u8; 2 * tile * 2 * tile * 3];
    for (t, a) in picks.iter().enumerate() {
        let (ox, oy) = ((t % 2) * tile, (t / 2) * tile);
        for b in &a.buildings {
            let c = match b.look.as_str() {
                "water_mill" | "wind_mill" => [60, 110, 200],
                "kiln" => [190, 70, 40],
                "barn" | "long_shed" | "shed" => [150, 110, 60],
                "hut" => [120, 140, 70],
                _ => [110, 110, 110],
            };
            let inside = |p: Point| {
                let r = &b.ring;
                (0..r.len()).all(|i| {
                    let (a, q) = (r[i], r[(i + 1) % r.len()]);
                    let cr = (q.x - a.x) * (p.y - a.y) - (q.y - a.y) * (p.x - a.x);
                    cr >= 0.0
                }) || (0..r.len()).all(|i| {
                    let (a, q) = (r[i], r[(i + 1) % r.len()]);
                    (q.x - a.x) * (p.y - a.y) - (q.y - a.y) * (p.x - a.x) <= 0.0
                })
            };
            for j in 0..tile {
                for i in 0..tile {
                    let p = Point { x: a.x + (i as f64 - tile as f64 / 2.0) * 0.25, y: a.y + (j as f64 - tile as f64 / 2.0) * 0.25 };
                    if inside(p) {
                        zoom[((oy + j) * 2 * tile + ox + i) * 3..][..3].copy_from_slice(&c);
                    }
                }
            }
        }
        println!("zoom {t}: {} ({}) {}", a.template, a.culture, a.buildings.iter().map(|b| format!("{}[{}]", b.archetype, b.look)).collect::<Vec<_>>().join(" "));
    }
    let file = out_dir.join("activity_zoom.png");
    png(&file, 2 * tile, 2 * tile, &zoom);
    println!("zoom: {}", file.display());
    // Nodes and installations: 3x2 tiles at 0.5 m/px (nodes first, then sites with water or earth works).
    let (tile, mpp) = (300usize, 0.5);
    let rich = |a: &&magna_urbis_core::settlements::activities::ActivitySite| a.installations.iter().any(|i| matches!(i.kind.as_str(), "water_structure" | "excavation" | "mound" | "landing"));
    let mut picks: Vec<&magna_urbis_core::settlements::activities::ActivitySite> = vec![];
    for a in on.nodes.iter().chain(placed.activities.iter().filter(rich)) {
        let quota = if a.mode == "network_node" { 3 } else { 6 };
        if picks.len() < quota && !picks.iter().any(|p| p.template == a.template) {
            picks.push(a);
        }
    }
    let mut img = vec![0u8; 3 * tile * 2 * tile * 3];
    let ground = |k: &str| match k {
        "excavation" => [133, 117, 101],
        "mound" => [155, 152, 147],
        "water_structure" => [80, 110, 130],
        "enclosure" => [109, 92, 66],
        "industrial_ground" => [142, 108, 77],
        "landing" => [160, 125, 85],
        "open_surface" => [203, 187, 142],
        "engineered_path" => [166, 157, 140],
        "terrace" => [170, 166, 115],
        _ => [120, 100, 90],
    };
    let in_ring = |r: &[Point], p: Point| {
        let mut odd = false;
        for i in 0..r.len() {
            let (a, b) = (r[i], r[(i + 1) % r.len()]);
            if (a.y > p.y) != (b.y > p.y) && p.x < a.x + (p.y - a.y) / (b.y - a.y) * (b.x - a.x) {
                odd = !odd;
            }
        }
        odd
    };
    let near_line = |path: &[Point], p: Point, w: f64| {
        path.windows(2).any(|q| {
            let (a, b) = (q[0], q[1]);
            let (dx, dy) = (b.x - a.x, b.y - a.y);
            let l2 = dx * dx + dy * dy;
            let t = if l2 > 0.0 { (((p.x - a.x) * dx + (p.y - a.y) * dy) / l2).clamp(0.0, 1.0) } else { 0.0 };
            (p.x - a.x - dx * t).hypot(p.y - a.y - dy * t) <= w
        })
    };
    for (t, a) in picks.iter().enumerate() {
        let (ox, oy) = ((t % 3) * tile, (t / 3) * tile);
        let roads_here: Vec<_> = on.segments.iter().filter(|sg| sg.path.iter().any(|p| (p.x - a.x).hypot(p.y - a.y) < 600.0)).collect();
        for j in 0..tile {
            for i in 0..tile {
                let p = Point { x: a.x + (i as f64 - tile as f64 / 2.0) * mpp, y: a.y + (j as f64 - tile as f64 / 2.0) * mpp };
                let w = water[((p.y / dem) as usize).min(n - 1) * n + ((p.x / dem) as usize).min(n - 1)];
                let mut c = if w != 0 { [70, 120, 180] } else { [226, 220, 200] };
                for sg in &roads_here {
                    if near_line(&sg.path, p, sg.width / 2.0) {
                        c = [150, 140, 125];
                    }
                }
                for g in &a.installations {
                    let hit = if g.closed { in_ring(&g.points, p) || near_line(&g.points, p, 0.4) } else { near_line(&g.points, p, if g.kind == "enclosure" { 0.5 } else { 1.3 }) };
                    if hit {
                        c = ground(&g.kind);
                    }
                }
                for b in &a.buildings {
                    if in_ring(&b.ring, p) {
                        c = if a.mode == "network_node" { [160, 40, 80] } else { [90, 70, 60] };
                    }
                }
                img[((oy + j) * 3 * tile + ox + i) * 3..][..3].copy_from_slice(&c);
            }
        }
        println!("tile {t}: {} ({}, {}) {}", a.template, a.culture, a.mode, a.installations.iter().map(|g| format!("{}[{}]", g.archetype, g.kind)).collect::<Vec<_>>().join(" "));
    }
    let file = out_dir.join("activity_nodes_installations.png");
    png(&file, 3 * tile, 2 * tile, &img);
    println!("nodes/installations: {}", file.display());
}

trait Dist {
    fn distance_to(self, b: Point) -> f64;
}
impl Dist for Point {
    fn distance_to(self, b: Point) -> f64 {
        (self.x - b.x).hypot(self.y - b.y)
    }
}
