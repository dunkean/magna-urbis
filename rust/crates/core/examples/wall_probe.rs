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
    for p in &l.phases { println!("phase {} {} pop={:.0}", p.kind, p.zone, p.population); }
    svg.push_str("</svg>");
    std::fs::write(&args[2], svg)?;
    std::fs::write(format!("{}.json", args[2]), serde_json::to_vec(&l.enclosures)?)?;
    println!("{} pop={} blocks={} enclosures={} warnings={:?} {:.1}s", l.culture, f.sites[0].population, l.blocks.len(), l.enclosures.len(), l.warnings, t.elapsed().as_secs_f64());
    Ok(())
}
