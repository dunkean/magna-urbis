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
        audit(l, surface, f.width / f.n as f64, f.layout_config.max_street_grade);
        svg.push_str("</svg>"); std::fs::write(out.join(format!("{}.svg", l.culture)), svg)?;
        println!("{}: {} streets, {} bridge records, {} wet segments outside bridges/platforms", l.culture, l.streets.len(), l.streets.iter().filter(|s| s.role == "bridge").count(), unsupported);
    }
    Ok(())
}

/// Per-bridge invariants: spans the water, dry landings, connected ends, crossing angle,
/// ramp grade, and near-parallel neighbours.
fn audit(l: &magna_urbis_core::urban::Layout, surface: Surface<'_>, cell: f64, max_grade: f64) {
    use magna_urbis_core::urban::Point;
    let bridges: Vec<_> = l.streets.iter().filter(|s| s.role == "bridge" && s.path.len() >= 2).collect();
    let mut dirs = vec![];
    for (i, s) in bridges.iter().enumerate() {
        let (a, b) = (s.path[0], *s.path.last().unwrap());
        let len = ((b.x - a.x).powi(2) + (b.y - a.y).powi(2)).sqrt();
        let at = |t: f64| Point { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
        let steps = (len / 1.0).ceil().max(2.0) as usize;
        let (mut wet_n, mut max_g, mut dry_gap) = (0, 0.0f64, 0.0f64);
        let mut first_wet = None; let mut last_wet = 0;
        for k in 0..=steps { if surface.wet(at(k as f64 / steps as f64)) { wet_n += 1; first_wet.get_or_insert(k); last_wet = k; } }
        let fw = first_wet.unwrap_or(0);
        for k in 0..steps { let (p, q) = (at(k as f64 / steps as f64), at((k + 1) as f64 / steps as f64));
            if !surface.wet(p) && !surface.wet(q) { max_g = max_g.max((surface.height_at(q) - surface.height_at(p)).abs()); } }
        // dry deck inside the water span (gaps)
        for k in fw..last_wet { if !surface.wet(at(k as f64 / steps as f64)) { dry_gap += 1.0; } }
        // flow direction from wet cells within 80 m (PCA)
        let m = at(0.5); let r = 80.0; let (mut sx, mut sy, mut sxx, mut sxy, mut syy, mut c) = (0.0f64,0.0f64,0.0f64,0.0f64,0.0f64,0.0f64);
        let mut y = m.y - r; while y <= m.y + r { let mut x = m.x - r; while x <= m.x + r {
            if surface.wet(Point { x, y }) { sx += x; sy += y; sxx += x*x; sxy += x*y; syy += y*y; c += 1.0; } x += cell.max(2.0); } y += cell.max(2.0); }
        let (mx, my) = (sx / c.max(1.0), sy / c.max(1.0));
        let (cxx, cxy, cyy) = (sxx / c.max(1.0) - mx*mx, sxy / c.max(1.0) - mx*my, syy / c.max(1.0) - my*my);
        let flow = 0.5 * (2.0 * cxy).atan2(cxx - cyy);
        let deck = (b.y - a.y).atan2(b.x - a.x);
        let mut d = (deck - flow).abs().to_degrees() % 180.0; if d > 90.0 { d = 180.0 - d; }
        let conn = |e: Point| l.streets.iter().filter(|o| o.role != "bridge").any(|o| o.path.windows(2).any(|w| {
            let (dx, dy) = (w[1].x - w[0].x, w[1].y - w[0].y); let t = (((e.x - w[0].x) * dx + (e.y - w[0].y) * dy) / (dx*dx + dy*dy).max(1e-9)).clamp(0.0, 1.0);
            ((w[0].x + dx*t - e.x).powi(2) + (w[0].y + dy*t - e.y).powi(2)).sqrt() < 0.5 }));
        let flags = format!("{}{}{}{}{}{}", if surface.wet(a) || surface.wet(b) {" WET-END"} else {""},
            if !conn(a) || !conn(b) {" UNCONNECTED"} else {""}, if dry_gap > 3.0 {" DRY-GAP"} else {""},
            if d < 55.0 {" OBLIQUE"} else {""}, if max_g > max_grade {" STEEP"} else {""}, if wet_n == 0 {" NO-WATER"} else {""});
        println!("  bridge#{i} at ({:.0},{:.0}) len {len:.0}m wet {}m gap {dry_gap:.0}m angle-to-perp {:.0}deg (90=perp) maxdry-grade {max_g:.3} conn {}/{}{flags}",
            m.x, m.y, wet_n, d, conn(a), conn(b));
        dirs.push((m, deck));
    }
    for i in 0..dirs.len() { for j in i+1..dirs.len() {
        let dist = ((dirs[i].0.x - dirs[j].0.x).powi(2) + (dirs[i].0.y - dirs[j].0.y).powi(2)).sqrt();
        let mut da = (dirs[i].1 - dirs[j].1).abs().to_degrees() % 180.0; if da > 90.0 { da = 180.0 - da; }
        if dist < 120.0 { println!("  PAIR #{i}/#{j}: {dist:.0}m apart, {da:.0}deg apart{}", if da < 25.0 {" NEAR-PARALLEL"} else {""}); }
    }}
}
