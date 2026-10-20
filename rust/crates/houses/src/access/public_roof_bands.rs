//! Material apertures in native non-structural timber bands, never exemptions.
use super::links::{bands, recorded_cuts};
use super::*;

struct NativeBand {
    index: usize,
    body_id: String,
    surface: Surface,
    z: f64,
}

#[derive(Clone)]
pub(super) struct Cut {
    index: usize,
    expected: Surface,
}

fn same_bits(a: &Surface, b: &Surface) -> bool {
    a.len() == b.len()
        && a.iter().zip(b).all(|(a, b)| {
            a.holes.len() == b.holes.len()
                && std::iter::once(&a.outer)
                    .chain(&a.holes)
                    .zip(std::iter::once(&b.outer).chain(&b.holes))
                    .all(|(a, b)| {
                        a.len() == b.len()
                            && a.iter().zip(b).all(|(a, b)| {
                                a.x.to_bits() == b.x.to_bits() && a.y.to_bits() == b.y.to_bits()
                            })
                    })
        })
}

fn native_bands(unit: &HouseUnit) -> Result<Vec<NativeBand>, String> {
    let exported: Vec<_> = unit
        .features
        .iter()
        .enumerate()
        .filter(|(_, f)| f.id.starts_with("detail-timber_bands-"))
        .collect();
    let mut native = vec![];
    for body in unit
        .bodies
        .iter()
        .filter(|b| b.details.iter().any(|d| d == "timber_bands"))
    {
        let level = body.levels.last().ok_or("Bande native sans niveau.")?;
        let z = level.z_m + level.height_m;
        for surface in crate::features::beam_surfaces(body, crate::features::BEAM_SPACING_M) {
            // This is precisely the existing generator's push filter, not a
            // filter on the positive pieces retained after an aperture.
            if area(&surface) < 0.002 {
                continue;
            }
            let &(index, f) = exported
                .get(native.len())
                .ok_or("Bande native manquante.")?;
            if f.id != format!("detail-timber_bands-{index}")
                || f.kind != FeatureKind::Frame
                || f.roof.is_some()
                || f.z_m.to_bits() != z.to_bits()
                || f.height_m.to_bits() != 0.18_f64.to_bits()
                || f.material != level.materials.roof_frame
            {
                return Err("Bande timber_bands sans identité native exacte.".into());
            }
            native.push(NativeBand {
                index,
                body_id: body.id.clone(),
                surface,
                z,
            });
        }
    }
    if exported.len() != native.len() {
        return Err("Bande timber_bands supplémentaire ou origine ambiguë.".into());
    }
    Ok(native)
}

struct Mask {
    surface: Surface,
    bridge: Option<band_open::Mask>,
    portal_index: usize,
}

/// One registry for preparation and export checks, in native portal order.
fn masks(unit: &HouseUnit, except: Option<&str>) -> Result<Vec<Mask>, String> {
    let mut out = vec![];
    for (portal_index, p) in unit.access.portals.iter().enumerate() {
        if except == Some(p.id.as_str()) {
            continue;
        }
        if p.kind == PortalKind::Ladder {
            for f in unit.features.iter().filter(|f| {
                f.kind == FeatureKind::Ladder
                    && f.id.contains(":public-roof:")
                    && f.id.contains(":link:")
                    && p.feature_ids.contains(&f.id)
                    && except != Some(f.id.as_str())
            }) {
                out.push(Mask {
                    surface: f.surface.clone(),
                    bridge: None,
                    portal_index,
                });
            }
        }
        if p.kind == PortalKind::Passage && p.feature_ids.iter().any(|id| id.contains(":band-open"))
        {
            let bridge = band_open::mask(unit, p)?;
            out.push(Mask {
                surface: bridge.surface.clone(),
                bridge: Some(bridge),
                portal_index,
            });
        }
    }
    for f in unit.features.iter().filter(|f| f.id.contains(":band-open")) {
        if !out
            .iter()
            .filter_map(|m| m.bridge.as_ref())
            .any(|m| f.id.starts_with(&format!("{}:", m.key)))
        {
            // During preparation only the new route's own registry is absent.
            let preparing = except
                .and_then(|id| unit.access.portals.iter().find(|p| p.id == id))
                .and_then(|p| p.feature_ids.first())
                .and_then(|id| id.strip_suffix(":landing:2"))
                .is_some_and(|key| f.id.starts_with(&format!("{key}:")));
            if !preparing {
                return Err("Pièce band-open sans portail matériel certifié.".into());
            }
        }
    }
    Ok(out)
}

fn applies(mask: &Mask, band: &NativeBand) -> bool {
    mask.bridge
        .as_ref()
        .is_none_or(|m| m.body_id == band.body_id && (m.z - band.z).abs() <= 1e-9)
}

fn combined(masks: &[Mask], band: &NativeBand) -> Surface {
    unite(
        &masks
            .iter()
            .filter(|m| applies(m, band))
            .map(|m| m.surface.clone())
            .collect::<Vec<_>>(),
    )
}

fn matches_export(unit: &HouseUnit, band: &NativeBand, cuts: &Surface) -> Result<(), String> {
    let f = &unit.features[band.index];
    if area(&intersection(&band.surface, cuts)) <= AREA_EPS {
        if !same_bits(&f.surface, &band.surface) {
            return Err("Bande non touchée modifiée au lieu d'être conservée.".into());
        }
    } else {
        let expected = difference(&band.surface, cuts);
        if f.surface.len() != expected.len()
            || area(&difference(&f.surface, &expected)) > AREA_EPS
            || area(&difference(&expected, &f.surface)) > AREA_EPS
        {
            return Err("Coupe de bande plus large, incomplète ou morceau abandonné.".into());
        }
    }
    Ok(())
}

pub(super) fn validate(unit: &HouseUnit) -> Result<(), String> {
    let masks = masks(unit, None)?;
    let native = native_bands(unit)?;
    for mask in masks.iter().filter(|m| m.bridge.is_some()) {
        check_bridge_support(unit, mask.bridge.as_ref().unwrap())?;
        let mut necessary = 0.0;
        for band in native.iter().filter(|b| applies(mask, b)) {
            let older = unite(
                &masks
                    .iter()
                    .filter(|m| m.portal_index < mask.portal_index && applies(m, band))
                    .map(|m| m.surface.clone())
                    .collect::<Vec<_>>(),
            );
            necessary += area(&intersection(
                &difference(&band.surface, &older),
                &mask.surface,
            ));
            check_bridge_band(
                unit,
                band,
                mask.bridge.as_ref().unwrap(),
                &combined(&masks, band),
            )?;
        }
        if necessary <= AREA_EPS {
            return Err("Marqueur band-open sans ouverture matérielle nécessaire.".into());
        }
    }
    for band in native {
        matches_export(unit, &band, &combined(&masks, &band))?;
    }
    Ok(())
}

fn wall_support(unit: &HouseUnit, body: &str, z: f64) -> Surface {
    unite(
        &unit
            .walls
            .iter()
            .filter(|w| w.body_id.as_deref() == Some(body))
            .map(|w| crate::wall_geometry::wall_section(w, z))
            .collect::<Vec<_>>(),
    )
}

pub(super) fn prepare(
    unit: &HouseUnit,
    f: &Feature,
    p: &Portal,
    base: &BTreeSet<String>,
    target: &BTreeSet<String>,
) -> Result<Vec<Cut>, String> {
    let older_masks = masks(unit, Some(&f.id))?;
    let all_masks = masks(unit, None)?;
    let clear = flight_clear(f);
    let (low, high) = bands(f);
    let masks = recorded_cuts(unit, f, p, &clear)?;
    let mut cuts = vec![];
    for band in native_bands(unit)? {
        let older = combined(&older_masks, &band);
        let all = combined(&all_masks, &band);
        matches_export(unit, &band, &older)?;
        let current = &unit.features[band.index];
        let overlap = intersection(&current.surface, &f.surface);
        if area(&overlap) <= AREA_EPS {
            continue;
        }
        if !rings(&overlap).flatten().all(|q| {
            band.z + 0.18 > plane_z(f, *q) - 0.15 + CONTACT
                && band.z < plane_z(f, *q) + 2.05 - CONTACT
        }) {
            return Err("Bande partiellement hors de la fenêtre nécessaire de coupe.".into());
        }
        let body = unit.bodies.iter().find(|b| b.id == band.body_id).unwrap();
        let slab = body
            .levels
            .last()
            .and_then(|l| l.roof_slab.as_ref())
            .ok_or("Bande native sans dalle porteuse.")?;
        let over_clear = intersection(&overlap, &clear);
        if target.contains(&band.body_id) && (band.z - p.to_z_m).abs() < 1e-9 {
            if area(&difference(&over_clear, &masks)) > AREA_EPS
                || area(&intersection(&over_clear, &slab.surface)) > AREA_EPS
            {
                return Err("Bande haute sur clear sans mur coupé et dalle ouverte.".into());
            }
            let terminal = intersection(&overlap, &high);
            if area(&difference(&terminal, &slab.surface)) > AREA_EPS
                || area(&difference(
                    &terminal,
                    &wall_support(unit, &band.body_id, band.z),
                )) > AREA_EPS
            {
                return Err("Bande haute sans appui natif intact au terminal.".into());
            }
        } else if base.contains(&band.body_id) && (band.z - p.from_z_m).abs() < 1e-9 {
            if area(&difference(&overlap, &slab.surface)) > AREA_EPS
                || area(&difference(
                    &overlap,
                    &wall_support(unit, &band.body_id, band.z),
                )) > AREA_EPS
                || area(&intersection(&overlap, &high)) > AREA_EPS
                || !rings(&intersection(&overlap, &union(&clear, &low)))
                    .flatten()
                    .all(|q| band.z <= plane_z(f, *q) + 1e-9)
            {
                return Err("Bande basse dont le mur ou la dalle d'appui a été percé.".into());
            }
        } else {
            return Err("Bande étrangère ou trait structurel dans la liaison.".into());
        }
        let expected = difference(&band.surface, &all);
        if area(&difference(&expected, &slab.surface)) > AREA_EPS {
            return Err("Morceau restant de bande sans dalle porteuse.".into());
        }
        cuts.push(Cut {
            index: band.index,
            expected,
        });
    }
    Ok(cuts)
}

fn check_bridge_support(unit: &HouseUnit, mask: &band_open::Mask) -> Result<(), String> {
    let body = unit
        .bodies
        .iter()
        .find(|b| b.id == mask.body_id)
        .ok_or("Corps de bande absent.")?;
    let slab = body
        .levels
        .last()
        .and_then(|l| l.roof_slab.as_ref())
        .ok_or("Dalle de bande absente.")?;
    let walls = unite(
        &unit
            .walls
            .iter()
            .filter(|w| {
                w.body_id.as_deref() == Some(mask.body_id.as_str())
                    && !w.party
                    && !w.id.contains(":portal:volume:")
                    && (w.z_m + w.height_m - mask.z).abs() <= 1e-9
            })
            .map(|w| crate::wall_geometry::wall_section(w, mask.z))
            .collect::<Vec<_>>(),
    );
    if area(&difference(&mask.surface, &slab.surface)) > AREA_EPS
        || area(&difference(&mask.surface, &walls)) > AREA_EPS
    {
        return Err("Ouverture de bande sans dalle et murs de rive intacts.".into());
    }
    Ok(())
}

fn check_bridge_band(
    unit: &HouseUnit,
    band: &NativeBand,
    mask: &band_open::Mask,
    all_cuts: &Surface,
) -> Result<(), String> {
    if area(&intersection(&band.surface, &mask.outside_target)) > AREA_EPS {
        return Err("Bande de pont au-delà du seul terminal sur la terrasse.".into());
    }
    let body = unit.bodies.iter().find(|b| b.id == band.body_id).unwrap();
    let slab = body
        .levels
        .last()
        .and_then(|l| l.roof_slab.as_ref())
        .ok_or("Bande de pont sans dalle.")?;
    if area(&difference(
        &difference(&band.surface, all_cuts),
        &slab.surface,
    )) > AREA_EPS
    {
        return Err("Morceau restant de bande de pont sans dalle porteuse.".into());
    }
    Ok(())
}

pub(super) fn prepare_bridge(unit: &HouseUnit, p: &Portal) -> Result<Vec<Cut>, String> {
    let bridge = band_open::mask(unit, p)?;
    check_bridge_support(unit, &bridge)?;
    let older = masks(unit, Some(&p.id))?;
    let all = masks(unit, None)?;
    let mut cuts = vec![];
    for band in native_bands(unit)? {
        matches_export(unit, &band, &combined(&older, &band))?;
        if band.body_id != bridge.body_id || (band.z - bridge.z).abs() > 1e-9 {
            continue;
        }
        if area(&intersection(
            &unit.features[band.index].surface,
            &bridge.surface,
        )) <= AREA_EPS
        {
            continue;
        }
        check_bridge_band(unit, &band, &bridge, &combined(&all, &band))?;
        cuts.push(Cut {
            index: band.index,
            expected: difference(&band.surface, &combined(&all, &band)),
        });
    }
    if cuts.is_empty() {
        return Err("Ouverture de bande sans obstacle natif nécessaire.".into());
    }
    Ok(cuts)
}

pub(super) fn ignored(unit: &HouseUnit, cuts: &[Cut]) -> BTreeSet<String> {
    cuts.iter()
        .map(|c| unit.features[c.index].id.clone())
        .collect()
}

pub(super) fn apply(unit: &mut HouseUnit, cuts: Vec<Cut>, portal: &str) {
    for cut in cuts {
        let f = &mut unit.features[cut.index];
        f.surface = cut.expected;
        f.vertices3d = f.surface.first().map_or_else(Vec::new, |p| {
            p.outer
                .iter()
                .map(|p| Vertex3 {
                    x: p.x,
                    y: p.y,
                    z: f.z_m,
                })
                .collect()
        });
        unit.diagnostics
            .push(format!("Bande timber_bands {} coupée par {portal}.", f.id));
    }
}
