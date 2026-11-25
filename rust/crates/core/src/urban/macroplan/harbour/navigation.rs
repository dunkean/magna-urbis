//! Navigable frontage and protection of sea access.

use super::*;

/// Narrowest water a quay may front (m): two barges' beams and the way
/// between them. A stream narrower than this is crossed and banked, not
/// berthed.
pub(super) const NAVIGABLE: f64 = 10.0;

/// Width of the water beside a quay (m): across the first water met within
/// 15 m and two raster cells of the path, square to it, at a quarter, half and three quarters of
/// its length; the median of the three (the open sea counts as wide).
pub(super) fn channel_width(surface: Surface<'_>, path: &[Point]) -> f64 {
    // The quay stands back from the raster shore by up to a cell or two.
    let reach = 15.0 + 2.0 * surface.width / surface.n as f64;
    let l = length(path);
    let mut widths: Vec<f64> = [0.25, 0.5, 0.75]
        .iter()
        .filter_map(|&f| {
            let at = sub_path(path, 0.0, l * f);
            let (&p, &q) = (at.last()?, at.get(at.len().checked_sub(2)?)?);
            let n = left(unit(q, p));
            let across = |s: f64| {
                let first = (1..=(2.0 * reach) as usize)
                    .map(|k| k as f64 * 0.5)
                    .find(|&d| surface.wet(add(p, n, s * d)))?;
                let mut d = first;
                while d < first + 200.0 && surface.wet(add(p, n, s * (d + 0.5))) {
                    d += 0.5;
                }
                Some(d + 0.5 - first)
            };
            across(1.0).into_iter().chain(across(-1.0)).reduce(f64::max)
        })
        .collect();
    widths.sort_by(f64::total_cmp);
    widths.get(widths.len() / 2).copied().unwrap_or(0.0)
}

/// Whether the water beside a quay (15 m plus two raster cells) is a river.
/// Underdark: the first obstacle met square to the front (at a quarter, half or three quarters
/// of it, within 15 m plus two raster cells) is cave rock: a wall foot, not a shore.
pub(super) fn rock_side(surface: Surface<'_>, path: &[Point]) -> bool {
    let l = length(path);
    let reach = (15.0 + 2.0 * surface.width / surface.n as f64).ceil() as usize;
    [0.25, 0.5, 0.75].into_iter().any(|f| {
        let at = sub_path(path, 0.0, l * f);
        let (Some(&p), Some(&q)) = (at.last(), at.get(at.len().saturating_sub(2))) else {
            return false;
        };
        let n = left(unit(q, p));
        (1..=reach)
            .flat_map(|d| [add(p, n, d as f64), add(p, n, -(d as f64))])
            .find(|&x| surface.wet(x))
            .is_some_and(|x| surface.solid(x))
    })
}

pub(super) fn river_side(surface: Surface<'_>, path: &[Point]) -> bool {
    let l = length(path);
    let at = sub_path(path, 0.0, l * 0.5);
    let (Some(&p), Some(&q)) = (at.last(), at.get(at.len().saturating_sub(2))) else {
        return false;
    };
    let n = left(unit(q, p));
    (1..=(15.0 + 2.0 * surface.width / surface.n as f64).ceil() as usize)
        .flat_map(|d| [add(p, n, d as f64), add(p, n, -(d as f64))])
        .map(|x| code(surface, x))
        .find(|&c| c != 0)
        == Some(3)
}

/// Physical water served by a quay, across its embankment apron.
pub(in super::super::super) fn front_water(surface: Surface<'_>, path: &[Point]) -> Option<(&'static str, f64)> {
    let at = sub_path(path, 0.0, length(path) * 0.5);
    let (&p, &previous) = (at.last()?, at.get(at.len().checked_sub(2)?)?);
    let n = left(unit(previous, p));
    let reach = (20.0 + 2.0 * surface.width / surface.n as f64).ceil() as usize;
    (1..=reach).flat_map(|d| [add(p, n, d as f64), add(p, n, -(d as f64))])
        .find_map(|q| match code(surface, q) {
            1 => Some(("sea", surface.height_at(q))),
            2 => Some(("lake", surface.height_at(q))),
            3 => Some(("river", surface.height_at(q))),
            _ => None,
        })
}

pub(in super::super::super) fn navigable(layout: &super::super::super::Layout, surface: Surface<'_>) -> bool {
    layout.streets.iter().any(|s| s.role == "quay" && channel_width(surface, &s.path) >= NAVIGABLE)
}

pub(in super::super::super) fn crosses_sea(surface: Surface<'_>, a: Point, b: Point) -> bool {
    let steps=(dist(a,b)/2.0).ceil().max(1.0) as usize;
    (0..=steps).any(|k| {let p=super::super::point(a,b,k as f64/steps as f64);surface.wet(p) && code(surface,p)==1})
}

/// New watercourse crossings cannot become bridges across a sea harbour.
/// An explicitly imported marine span keeps its own regional provenance.
pub(in super::super::super) fn keep_sea_access(streets: &mut Vec<Street>, surface: Surface<'_>, roads: &[Street]) {
    streets.retain(|s| {
        if !matches!(s.role.as_str(),"bridge"|"causeway"|"ford") || !s.path.windows(2).any(|w|crosses_sea(surface,w[0],w[1])) {return true;}
        let p=super::super::point(s.path[0],*s.path.last().unwrap(),0.5);
        roads.iter().filter(|r|matches!(r.role.as_str(),"bridge"|"causeway"))
            .any(|r|r.path.windows(2).any(|w|g::distance(p,w[0],w[1]).0<2.0))
    });
}

pub(in super::super::super) fn protect_navigation(layout: &mut super::super::super::Layout, surface: Surface<'_>, roads: &[Street]) {
    // Final network clearance already rejected obstructing decks and connected
    // admissible inland replacements, including those behind a marine basin.
    if layout.config.as_ref().is_some_and(|c| c.harbour_bridge_clearance)
        && layout.streets.iter().any(|s| s.role == "quay") { return; }
    let reserved:Vec<_>=layout.programme.iter().flat_map(|p|&p.reservations).map(|r|layout.streets.get(r.street).cloned()).collect();
    keep_sea_access(&mut layout.streets,surface,roads);
    if let Some(p)=&mut layout.programme {
        for (r,old) in p.reservations.iter_mut().zip(reserved) {
            if let Some(index)=old.and_then(|old|layout.streets.iter().position(|s|s.role==old.role && s.path==old.path)) {r.street=index;}
        }
    }
}
