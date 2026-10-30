//! Offline wall witness: fixture.json out.svg. Quarter stage only (walls are traced there).
//! Blue = water, cream = blocks, white = streets, red = enclosures (darker = inner).
use magna_urbis_core::urban::{Geography, LayoutConfig, Site, Street, Surface, VectorGeography, generate_quarters};
use serde::Deserialize;
use std::fmt::Write;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Fixture { seed: String, n: usize, width: f64, height: Vec<f32>, water: Vec<u8>, geometry: Option<VectorGeography>, sites: Vec<Site>, roads: Vec<Street>, layout_config: LayoutConfig }

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let args: Vec<_> = std::env::args().collect();
    let f: Fixture = serde_json::from_slice(&std::fs::read(&args[1])?)?;
    let geography = f.geometry.map(|g| Geography::new(g, f.width)).transpose()?;
    let surface = Surface { geometry: geography.as_ref(), width: f.width, n: f.n, height: &f.height, water: &f.water };
    let t = std::time::Instant::now();
    let layouts = generate_quarters(&f.seed, &f.sites, &f.layout_config, surface, &f.roads)?;
    let l = &layouts[0];
    let pts = l.blocks.iter().flat_map(|b| &b.shape.outer).chain(l.enclosures.iter().flat_map(|e| &e.path));
    let (mut x0, mut y0, mut x1, mut y1) = (f64::MAX, f64::MAX, f64::MIN, f64::MIN);
    for p in pts { x0 = x0.min(p.x); y0 = y0.min(p.y); x1 = x1.max(p.x); y1 = y1.max(p.y); }
    let m = (x1 - x0).max(y1 - y0) * 0.05;
    let (x0, y0, side) = (x0 - m, y0 - m, (x1 - x0).max(y1 - y0) + 2.0 * m);
    let mut svg = format!("<svg xmlns='http://www.w3.org/2000/svg' width='1400' height='1400' viewBox='{x0} {y0} {side} {side}'><rect x='{x0}' y='{y0}' width='{side}' height='{side}' fill='#cbd3ad'/>");
    let cell = f.width / f.n as f64;
    for y in 0..f.n { for x in 0..f.n {
        let (px, py) = (x as f64 * cell, y as f64 * cell);
        if !(px + cell > x0 && px < x0 + side && py + cell > y0 && py < y0 + side) { continue; }
        if f.water[y * f.n + x] != 0 {
            write!(svg, "<rect x='{px}' y='{py}' width='{}' height='{}' fill='#628d9b'/>", cell + 0.5, cell + 0.5)?;
        } else if x + 1 < f.n && y + 1 < f.n {
            // Hillshade from the north-west, so walls over relief read.
            let h = |i: usize, j: usize| f.height[j * f.n + i] as f64;
            let shade = ((h(x, y) - h(x + 1, y + 1)) / cell * 2.0).clamp(-1.0, 1.0);
            if shade.abs() > 0.05 {
                write!(svg, "<rect x='{px}' y='{py}' width='{}' height='{}' fill='{}' fill-opacity='{:.2}'/>", cell + 0.5, cell + 0.5, if shade > 0.0 { "#ffffff" } else { "#3d3a2a" }, shade.abs() * 0.55)?;
            }
        }
    }}
    for b in &l.blocks {
        write!(svg, "<path fill-opacity='0.75' fill='{}' stroke='#887859' stroke-width='{}' d='", if b.kind == "reserve" { "#a9bb85" } else { "#e3d5b6" }, side / 1400.0)?;
        for (i, p) in b.shape.outer.iter().enumerate() { write!(svg, "{}{},{} ", if i == 0 { "M" } else { "L" }, p.x, p.y)?; }
        svg.push_str("Z'/>");
    }
    for s in &l.streets {
        write!(svg, "<polyline fill='none' stroke='#fff3ce' stroke-width='{}' points='", s.widths.first().copied().unwrap_or(3.0))?;
        for p in &s.path { write!(svg, "{},{} ", p.x, p.y)?; }
        svg.push_str("'/>");
    }
    for (i, e) in l.enclosures.iter().enumerate() {
        write!(svg, "<polygon fill='none' stroke='{}' stroke-width='{}' points='", if i == 0 { "#c0302a" } else { "#6d1410" }, side / 300.0)?;
        for p in &e.path { write!(svg, "{},{} ", p.x, p.y)?; }
        svg.push_str("'/>");
        let area = (0..e.path.len()).map(|i| { let (a, b) = (e.path[i], e.path[(i + 1) % e.path.len()]); a.x * b.y - b.x * a.y }).sum::<f64>().abs() / 2.0;
        println!("enclosure {i} kind={} style={} vertices={} area_ha={:.1}", e.kind, e.style, e.path.len(), area / 1e4);
    }
    // Invariants: a street crosses a curtain only at a gate; the curtain is dry except at water gates.
    let wet = |p: magna_urbis_core::urban::Point| surface.wet(p);
    for (i, e) in l.enclosures.iter().enumerate().filter(|(_, e)| !e.style.is_empty()) {
        let mut stray = vec![];
        for s in l.streets.iter().filter(|s| !matches!(s.role.as_str(), "wall-lane" | "bridge" | "ford" | "causeway" | "quay" | "pier" | "landing" | "mole")) {
            for w in s.path.windows(2) { for c in e.path.windows(2) {
                let (d1, d2) = ((w[1].x - w[0].x, w[1].y - w[0].y), (c[1].x - c[0].x, c[1].y - c[0].y));
                let den = d1.0 * d2.1 - d1.1 * d2.0; if den.abs() < 1e-9 { continue; }
                let (qx, qy) = (c[0].x - w[0].x, c[0].y - w[0].y);
                let (t, u) = ((qx * d2.1 - qy * d2.0) / den, (qx * d1.1 - qy * d1.0) / den);
                if !(0.0..=1.0).contains(&t) || !(0.0..=1.0).contains(&u) { continue; }
                let sl = (d1.0.hypot(d1.1)).max(1e-9); if t * sl < 0.6 || (1.0 - t) * sl < 0.6 { continue; }
                let x = magna_urbis_core::urban::Point { x: w[0].x + t * d1.0, y: w[0].y + t * d1.1 };
                let g = e.gates.iter().map(|g| ((g.x - x.x).powi(2) + (g.y - x.y).powi(2)).sqrt()).fold(f64::MAX, f64::min);
                if g > 8.0 { stray.push((s.role.clone(), x.x.round(), x.y.round(), g.round(), wet(x), s.path.len(), (s.path[0].x.round(), s.path[0].y.round()), (s.path[s.path.len()-1].x.round(), s.path[s.path.len()-1].y.round()))); }
            }}
        }
        let mut wet_m = 0.0; let mut dry_gate_wet = 0.0;
        for c in e.path.windows(2) { let len = ((c[1].x - c[0].x).powi(2) + (c[1].y - c[0].y).powi(2)).sqrt(); let k = (len / 4.0).ceil().max(1.0) as usize;
            for j in 0..k { let t = (j as f64 + 0.5) / k as f64; let p = magna_urbis_core::urban::Point { x: c[0].x + t * (c[1].x - c[0].x), y: c[0].y + t * (c[1].y - c[0].y) };
                if wet(p) { wet_m += len / k as f64; if e.gatehouses.iter().filter(|gh| gh.kind == "water").all(|gh| { let (a, b) = (gh.passage[0], gh.passage[1]); let (dx, dy) = (b.x - a.x, b.y - a.y); let t = (((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy).max(1e-9)).clamp(0.0, 1.0); ((a.x + t * dx - p.x).powi(2) + (a.y + t * dy - p.y).powi(2)).sqrt() > 25.0 }) { dry_gate_wet += len / k as f64; eprintln!("WET {:.0},{:.0}", p.x, p.y); } } } }
        let mut on_wall = 0.0;
        for st in l.streets.iter().filter(|s| !matches!(s.role.as_str(), "wall-lane" | "bridge" | "ford" | "causeway" | "quay" | "pier" | "landing" | "mole")) {
            for w in st.path.windows(2) { let len = ((w[1].x - w[0].x).powi(2) + (w[1].y - w[0].y).powi(2)).sqrt(); let k = (len / 2.0).ceil().max(1.0) as usize;
                for j in 0..k { let t = (j as f64 + 0.5) / k as f64; let p = magna_urbis_core::urban::Point { x: w[0].x + t * (w[1].x - w[0].x), y: w[0].y + t * (w[1].y - w[0].y) };
                    let d = e.path.windows(2).map(|c| { let (dx, dy) = (c[1].x - c[0].x, c[1].y - c[0].y); let u = (((p.x - c[0].x) * dx + (p.y - c[0].y) * dy) / (dx * dx + dy * dy).max(1e-9)).clamp(0.0, 1.0); ((c[0].x + u * dx - p.x).powi(2) + (c[0].y + u * dy - p.y).powi(2)).sqrt() }).fold(f64::MAX, f64::min);
                    if d < 1.0 && e.gates.iter().all(|g| ((g.x - p.x).powi(2) + (g.y - p.y).powi(2)).sqrt() > 12.0) { on_wall += len / k as f64; if std::env::var("ONWALL").is_ok() { eprintln!("ONWALL {} rank={} {:.0},{:.0} w={:?}", st.role, st.rank, p.x, p.y, st.widths.first()); } } } }
        }
        println!("AUDIT on_wall_street_m={on_wall:.0}");
        println!("AUDIT enclosure {i}: stray_crossings={} {:?} wet_curtain_m={:.0} wet_away_from_gates_m={:.0}", stray.len(), &stray[..stray.len().min(12)], wet_m, dry_gate_wet);
    }
    for st in l.streets.iter().filter(|s| s.role == "wall-lane") { for w in st.path.windows(2) {
        let len = ((w[1].x - w[0].x).powi(2) + (w[1].y - w[0].y).powi(2)).sqrt(); if len < 6.0 { continue; }
        let m = magna_urbis_core::urban::Point { x: (w[0].x + w[1].x) / 2.0, y: (w[0].y + w[1].y) / 2.0 };
        let best = l.enclosures.iter().flat_map(|e| e.path.windows(2).map(|c| { let (dx, dy) = (c[1].x - c[0].x, c[1].y - c[0].y); let u = (((m.x - c[0].x) * dx + (m.y - c[0].y) * dy) / (dx * dx + dy * dy).max(1e-9)).clamp(0.0, 1.0); ((c[0].x + u * dx - m.x).hypot(c[0].y + u * dy - m.y), dy.atan2(dx)) })).fold((f64::MAX, 0.0), |a, b| if b.0 < a.0 { b } else { a });
        let mut da = ((w[1].y - w[0].y).atan2(w[1].x - w[0].x) - best.1).rem_euclid(std::f64::consts::PI); if da > std::f64::consts::FRAC_PI_2 { da = std::f64::consts::PI - da; }
        if da.to_degrees() > 15.0 && best.0 < 40.0 { println!("ASKEW lane {:.0},{:.0} len={:.0} angle={:.0} d_wall={:.0}", m.x, m.y, len, da.to_degrees(), best.0); }
    }}
    for p in &l.phases { println!("phase {} {} pop={:.0}", p.kind, p.zone, p.population); }
    svg.push_str("</svg>");
    std::fs::write(&args[2], svg)?;
    std::fs::write(format!("{}.json", args[2]), serde_json::to_vec(&l.enclosures)?)?;
    println!("{} pop={} blocks={} enclosures={} warnings={:?} {:.1}s", l.culture, f.sites[0].population, l.blocks.len(), l.enclosures.len(), l.warnings, t.elapsed().as_secs_f64());
    Ok(())
}
