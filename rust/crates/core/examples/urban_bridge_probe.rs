//! Offline bridge inspection. Args: urban fixture.json output-directory.
use magna_urbis_core::urban::{Geography, LayoutConfig, Site, Street, Surface, VectorGeography, generate_quarters};
use serde::Deserialize;
use std::{fmt::Write, path::PathBuf};

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Fixture {
    seed: String, n: usize, width: f64, height: Vec<f32>, water: Vec<u8>,
    geometry: Option<VectorGeography>, sites: Vec<Site>, roads: Vec<Street>, layout_config: LayoutConfig,
}
fn main() -> Result<(), Box<dyn std::error::Error>> {
    let args: Vec<_> = std::env::args().collect();
    if args.len() != 3 { return Err("Expected fixture.json output-directory".into()); }
    let f: Fixture = serde_json::from_slice(&std::fs::read(&args[1])?)?;
    let geography = f.geometry.map(|g| Geography::new(g, f.width)).transpose()?;
    let surface = Surface { geometry: geography.as_ref(), width: f.width, n: f.n, height: &f.height, water: &f.water };
    let layouts = generate_quarters(&f.seed, &f.sites, &f.layout_config, surface, &f.roads)?;
    let out = PathBuf::from(&args[2]); std::fs::create_dir_all(&out)?;
    std::fs::write(out.join("layouts.json"), serde_json::to_vec(&layouts)?)?;
    for l in &layouts {
        let reach = 1100.0;
        let mut svg = format!("<svg xmlns='http://www.w3.org/2000/svg' viewBox='{} {} {} {}'><rect x='0' y='0' width='{}' height='{}' fill='#e8e0c4'/>", l.center.x - reach, l.center.y - reach, reach * 2.0, reach * 2.0, f.width, f.width);
        let cell = f.width / f.n as f64;
        for y in 0..f.n { for x in 0..f.n {
            let (px, py) = (x as f64 * cell, y as f64 * cell);
            if f.water[y * f.n + x] != 0 && (px-l.center.x).abs() < reach && (py-l.center.y).abs() < reach {
                write!(svg, "<rect x='{px}' y='{py}' width='{cell}' height='{cell}' fill='#628d9b'/>")?;
            }
        }}
        for b in &l.blocks {
            svg.push_str("<polygon fill='#d1c3a5' stroke='#a89c81' stroke-width='0.4' points='");
            for p in &b.shape.outer { write!(svg, "{},{} ", p.x, p.y)?; } svg.push_str("'/>");
        }
        let mut unsupported = 0;
        for s in &l.streets {
            if !matches!(s.role.as_str(), "bridge" | "causeway" | "quay" | "pier" | "mole" | "landing") {
                unsupported += s.path.windows(2).filter(|w| surface.wet(magna_urbis_core::urban::Point { x: (w[0].x + w[1].x)*0.5, y: (w[0].y+w[1].y)*0.5 })).count();
            }
            let bridge = s.role == "bridge";
            write!(svg, "<polyline fill='none' stroke='{}' stroke-width='{}' points='", if bridge { "#e34522" } else { "#fff7dc" }, if bridge { 7.0 } else { s.widths.first().copied().unwrap_or(3.0) })?;
            for p in &s.path { write!(svg, "{},{} ", p.x, p.y)?; } svg.push_str("'/>");
        }
        svg.push_str("</svg>"); std::fs::write(out.join(format!("{}.svg", l.culture)), svg)?;
        println!("{}: {} streets, {} bridge records, {} wet segments outside bridges/platforms", l.culture, l.streets.len(), l.streets.iter().filter(|s| s.role == "bridge").count(), unsupported);
    }
    Ok(())
}
