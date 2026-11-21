//! Shared fortification test surfaces, streets, circuits and towns.

use super::{Predicted, build, dist, g, pt, styled};
use crate::urban::{Enclosure, Layout, LayoutConfig, Point, Shape, Site, Street, Surface, composition, generate_quarters};
use crate::rng::Rng;

pub(super) const W: f64 = 2048.0;

pub(super) const N: usize = 256;

pub(super) fn surface<'a>(height: &'a [f32], water: &'a [u8]) -> Surface<'a> {
    Surface {
        geometry: None,
        width: W,
        n: N,
        height,
        water,
        interpolation: Default::default(),
    }
}

/// Water cells for a river running north-south over x in [x0, x1).
pub(super) fn river(x0: f64, x1: f64) -> Vec<u8> {
    let mut w = vec![0u8; N * N];
    let cell = W / N as f64;
    for y in 0..N {
        for x in 0..N {
            let cx = (x as f64 + 0.5) * cell;
            if cx >= x0 && cx < x1 {
                w[y * N + x] = 1;
            }
        }
    }
    w
}

pub(super) fn street(points: &[(f64, f64)], rank: usize, width: f64) -> Street {
    Street {
        path: points.iter().map(|&(x, y)| pt(x, y)).collect(),
        widths: vec![width; points.len()],
        rank,
        role: "street".into(),
    }
}

/// An irregular octagon around (1000, 1000), closed, counter-clockwise.
pub(super) fn octagon() -> Vec<Point> {
    let r = [320.0, 300.0, 340.0, 290.0, 330.0, 310.0, 300.0, 335.0];
    let mut p: Vec<Point> = (0..8)
        .map(|k| {
            let a = k as f64 * std::f64::consts::TAU / 8.0 + 0.2;
            pt(1000.0 + r[k] * a.cos(), 1000.0 + r[k] * a.sin())
        })
        .collect();
    p.push(p[0]);
    p
}

pub(super) fn streets() -> Vec<Street> {
    vec![
        street(&[(500.0, 1010.0), (1500.0, 990.0)], 1, 8.0),
        street(&[(1005.0, 500.0), (995.0, 1500.0)], 1, 8.0),
        street(&[(700.0, 640.0), (1000.0, 1000.0)], 2, 4.0),
    ]
}

pub(super) fn predicted() -> Predicted {
    Predicted {
        widths: [9.0, 8.0, 5.0, 3.5, 3.0],
        arterial: 1,
        dwelling: [5.0, 5.0],
    }
}

/// One enclosure built as `fortify` does.
pub(super) fn built(style: &str, kind: &str, water: &[u8], pop: u32) -> (Enclosure, Vec<Street>) {
    built_with(style, kind, water, pop, streets())
}

pub(super) fn built_with(
    style: &str,
    kind: &str,
    water: &[u8],
    pop: u32,
    streets: Vec<Street>,
) -> (Enclosure, Vec<Street>) {
    let height = vec![10.0f32; N * N];
    let s = surface(&height, water);
    let path = octagon();
    let mut gates = composition::gates(&path, &streets);
    let land = gates.len();
    let banks = composition::water_gates(&path, s);
    for &(p, _) in &banks {
        if !gates.iter().any(|q| dist(*q, p) < 8.0) {
            gates.push(p);
        }
    }
    let mut e = Enclosure {
        path,
        kind: kind.into(),
        gates,
        ..Default::default()
    };
    let mut st = styled(style, "european-organic", pop);
    st.forced = true;
    build(
        &mut e,
        land,
        &banks,
        &streets,
        s,
        &st,
        pop,
        &predicted(),
        &Rng::new("fortification-test").fork("enc:0"),
    );
    (e, streets)
}

pub(super) fn structures(e: &Enclosure) -> Vec<Shape> {
    e.towers_detail
        .iter()
        .map(|t| t.footprint.clone())
        .chain(e.gatehouses.iter().flat_map(|g| g.masses.clone()))
        .chain(e.bastions.iter().map(|b| b.shape.clone()))
        .chain(e.outworks.iter().map(|w| w.shape.clone()))
        .chain(e.ditch.iter().map(|w| w.shape.clone()))
        .chain(e.attached.iter().map(|a| a.shape.clone()))
        .collect()
}

pub(super) fn town(style: &str) -> Vec<Layout> {
    town_on(style, vec![0u8; N * N])
}

pub(super) fn town_on(style: &str, water: Vec<u8>) -> Vec<Layout> {
    town_with(style, water, "")
}

pub(super) fn town_with(style: &str, water: Vec<u8>, moat: &str) -> Vec<Layout> {
    let height = vec![10.0f32; N * N];
    let roads: Vec<Street> = [
        [(100.0, 1030.0), (1950.0, 1010.0)],
        [(1020.0, 100.0), (1030.0, 1950.0)],
    ]
    .iter()
    .map(|p| Street {
        role: "regional".into(),
        ..street(p, 1, 6.0)
    })
    .collect();
    let cfg = LayoutConfig {
        fortification: "wall".into(),
        fortification_style: style.into(),
        phases: 3,
        suburbs: "many".into(),
        moat: moat.into(),
        // Peripheral frontage strips (open-edge exits) are cut after this
        // stage without the reserve: queued for the quarters stage.
        exit_treatment: "legacy".into(),
        ..LayoutConfig::default()
    };
    let site = Site {
        key: "walls-town".into(),
        name: String::new(),
        population: 12_000,
        culture: "european-organic".into(),
        center: pt(1024.0, 1024.0),
        radius: 420.0,
        neighbours: Vec::new(),
    };
    generate_quarters("walls", &[site], &cfg, surface(&height, &water), &roads).unwrap()
}
