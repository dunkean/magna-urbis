//! One exact, wall-supported aperture in source-reconstructed vigas.
//! Ambiguous factories remain on their previous path; no generic registry.
use super::*;

const BEAMS: &[&str] = &[
    "bays",
    "regular_bays",
    "exposed_frame",
    "large_frame",
    "large_timber_span",
    "ligatures",
    "timber_bands",
    "vigas",
];

#[derive(Clone, Copy, Debug)]
struct Rect {
    x0: f64,
    y0: f64,
    x1: f64,
    y1: f64,
}

impl Rect {
    fn positive(self) -> bool {
        self.x0 < self.x1 && self.y0 < self.y1
    }
    fn contains(self, p: Point) -> bool {
        self.x0 <= p.x && p.x <= self.x1 && self.y0 <= p.y && p.y <= self.y1
    }
    fn strict(self, p: Point) -> bool {
        self.x0 < p.x && p.x < self.x1 && self.y0 < p.y && p.y < self.y1
    }
    fn corners(self) -> [Point; 4] {
        [
            Point {
                x: self.x0,
                y: self.y0,
            },
            Point {
                x: self.x1,
                y: self.y0,
            },
            Point {
                x: self.x1,
                y: self.y1,
            },
            Point {
                x: self.x0,
                y: self.y1,
            },
        ]
    }
}

fn edges(r: &[Point]) -> impl Iterator<Item = (Point, Point)> + '_ {
    r.iter()
        .copied()
        .zip(r.iter().copied().cycle().skip(1))
        .take(r.len())
}

fn orthogonal(r: &[Point]) -> bool {
    r.len() >= 4
        && r.iter().all(|p| p.x.is_finite() && p.y.is_finite())
        && edges(r).all(|(a, b)| (a.x == b.x && a.y != b.y) || (a.y == b.y && a.x != b.x))
}

fn rectangle_bounds(p: &Polygon) -> Option<Rect> {
    if p.outer.len() != 4 || !p.holes.is_empty() || !orthogonal(&p.outer) {
        return None;
    }
    let b = bounds(&vec![p.clone()]);
    let r = Rect {
        x0: b[0],
        y0: b[1],
        x1: b[2],
        y1: b[3],
    };
    if !r.positive()
        || !p
            .outer
            .iter()
            .all(|q| (q.x == r.x0 || q.x == r.x1) && (q.y == r.y0 || q.y == r.y1))
        || signed_area(&p.outer) <= 0.0
    {
        return None;
    }
    Some(r)
}

fn edge_touches(a: Point, b: Point, r: Rect) -> bool {
    if a.x == b.x {
        r.x0 <= a.x && a.x <= r.x1 && a.y.min(b.y) <= r.y1 && a.y.max(b.y) >= r.y0
    } else {
        r.y0 <= a.y && a.y <= r.y1 && a.x.min(b.x) <= r.x1 && a.x.max(b.x) >= r.x0
    }
}

fn on_edge(p: Point, a: Point, b: Point) -> bool {
    (a.x == b.x && p.x == a.x && a.y.min(b.y) <= p.y && p.y <= a.y.max(b.y))
        || (a.y == b.y && p.y == a.y && a.x.min(b.x) <= p.x && p.x <= a.x.max(b.x))
}

// Orthogonal ray crossing uses only comparisons of existing coordinates.
fn in_ring(p: Point, r: &[Point]) -> bool {
    if edges(r).any(|(a, b)| on_edge(p, a, b)) {
        return true;
    }
    edges(r)
        .filter(|(a, b)| a.x == b.x && a.x > p.x && (a.y > p.y) != (b.y > p.y))
        .count()
        % 2
        == 1
}

fn ring_touches(ring: &[Point], r: Rect) -> bool {
    !orthogonal(ring)
        || edges(ring).any(|(a, b)| edge_touches(a, b, r))
        || ring.iter().any(|&p| r.contains(p))
        || in_ring(r.corners()[0], ring)
}

fn contained(r: Rect, p: &Polygon) -> bool {
    if !orthogonal(&p.outer)
        || p.holes.iter().any(|h| ring_touches(h, r))
        || !r.corners().into_iter().all(|q| in_ring(q, &p.outer))
    {
        return false;
    }
    // No concave boundary can enter the open rectangle between its corners.
    !edges(&p.outer).any(|(a, b)| {
        if a.x == b.x {
            r.x0 < a.x && a.x < r.x1 && a.y.min(b.y) < r.y1 && a.y.max(b.y) > r.y0
        } else {
            r.y0 < a.y && a.y < r.y1 && a.x.min(b.x) < r.x1 && a.x.max(b.x) > r.x0
        }
    })
}

fn exactly_one_container(surface: &Surface, r: Rect) -> bool {
    surface.iter().filter(|p| contained(r, p)).count() == 1
}

// A closed bounding-box separation is a conservative certificate, not an
// inclusion oracle. A possibly touching or non-finite obstacle refuses the cut.
fn shadow(surface: &Surface, r: Rect) -> bool {
    surface.iter().any(|p| {
        if p.outer.is_empty() {
            return true;
        }
        let b = bounds(&vec![p.clone()]);
        b.iter().any(|v| !v.is_finite())
            || !(b[2] < r.x0 || r.x1 < b[0] || b[3] < r.y0 || r.y1 < b[1])
    })
}

fn mask(passage: &Surface, target: &Surface) -> Option<Rect> {
    if passage.len() != 1 {
        return None;
    }
    let p = rectangle_bounds(&passage[0])?;
    let mut border = None;
    for polygon in target {
        if !orthogonal(&polygon.outer)
            || polygon.holes.iter().any(|h| ring_touches(h, p))
            || polygon.outer.iter().any(|&q| p.strict(q))
        {
            return None;
        }
        for (a, b) in edges(&polygon.outer).filter(|(a, b)| edge_touches(*a, *b, p)) {
            let line = if a.y == b.y {
                (true, a.y.to_bits(), b.x > a.x)
            } else {
                (false, a.x.to_bits(), b.y < a.y)
            };
            if border.is_some_and(|old| old != line) {
                return None;
            }
            border = Some(line);
        }
    }
    let (horizontal, bits, positive) = border?;
    let coordinate = f64::from_bits(bits);
    let mut m = p;
    if horizontal {
        if positive {
            m.y0 = m.y0.max(coordinate);
        } else {
            m.y1 = m.y1.min(coordinate);
        }
    } else if positive {
        m.x0 = m.x0.max(coordinate);
    } else {
        m.x1 = m.x1.min(coordinate);
    }
    if !m.positive() || !exactly_one_container(target, m) {
        return None;
    }
    Some(m)
}

fn original(unit: &HouseUnit) -> Option<Result<Vec<(usize, Feature)>, String>> {
    let parameters = crate::features::viga_bundle(unit)?;
    let material = crate::features::viga_material(unit)?;
    if unit.bodies.len() != 1 {
        return None;
    }
    fn active(details: &[String]) -> Vec<&String> {
        details
            .iter()
            .filter(|d| BEAMS.contains(&d.as_str()))
            .collect()
    }
    let global = active(&parameters.details);
    let body = &unit.bodies[0];
    let local = active(&body.details);
    if global.len() != 1
        || local.len() != 1
        || global[0] != "vigas"
        || local[0] != "vigas"
        || parameters.materials.roof_frame.is_empty()
    {
        return None;
    }
    let exported = unit
        .features
        .iter()
        .enumerate()
        .filter(|(_, f)| f.id.starts_with("detail-vigas-"))
        .collect::<Vec<_>>();
    let first = exported.first()?.0;
    let level = body.levels.last()?;
    let z = level.z_m + level.height_m;
    let surfaces = crate::features::beam_surfaces(body, crate::features::BEAM_SPACING_M)
        .into_iter()
        .filter(|s| area(s) >= 0.002)
        .collect::<Vec<_>>();
    if exported.len() != surfaces.len() {
        return Some(Err("Factory vigas : nombre de Features différent.".into()));
    }
    let mut out = vec![];
    for (i, surface) in surfaces.into_iter().enumerate() {
        let index = first + i;
        if exported[i].0 != index || exported[i].1.id != format!("detail-vigas-{index}") {
            return Some(Err("Factory vigas : ids non consécutifs.".into()));
        }
        out.push((
            index,
            crate::features::feature(
                format!("detail-vigas-{index}"),
                FeatureKind::Frame,
                surface,
                z,
                0.18,
                material,
            ),
        ));
    }
    Some(Ok(out))
}

fn same(a: &Feature, b: &Feature) -> bool {
    serde_json::to_vec(a)
        .ok()
        .zip(serde_json::to_vec(b).ok())
        .is_some_and(|(a, b)| a == b)
}

fn with_bounds(source: &Polygon, old: Rect, new: Rect) -> Polygon {
    Polygon {
        outer: source
            .outer
            .iter()
            .map(|p| Point {
                x: if p.x == old.x0 { new.x0 } else { new.x1 },
                y: p.y,
            })
            .collect(),
        holes: vec![],
    }
}

fn proposed(
    unit: &HouseUnit,
    source: &Feature,
    target: &AccessNode,
    passage: &Surface,
) -> Option<Feature> {
    let m = mask(passage, &target.floor)?;
    let p = rectangle_bounds(passage.first()?)?;
    let body = unit.bodies.first()?;
    let levels = body
        .levels
        .iter()
        .filter(|l| {
            l.roof_slab
                .as_ref()
                .is_some_and(|s| snap(s.z_m).to_bits() == target.z_m.to_bits())
        })
        .collect::<Vec<_>>();
    if levels.len() != 1 {
        return None;
    }
    let slab = levels[0].roof_slab.as_ref()?;
    if source.z_m.to_bits() != slab.z_m.to_bits()
        || target.kind != AccessKind::Terrace
        || target.household_id.is_some()
        || !slab.walkable
    {
        return None;
    }
    let touched = source
        .surface
        .iter()
        .enumerate()
        .filter(|(_, q)| shadow(&vec![(*q).clone()], p))
        .collect::<Vec<_>>();
    if touched.len() != 1 {
        return None;
    }
    let (index, polygon) = touched[0];
    let v = rectangle_bounds(polygon)?;
    if !(v.y0 >= m.y0 && v.y1 <= m.y1 && v.x0 < m.x0 && m.x1 < v.x1) {
        return None;
    }
    let r = Rect {
        x0: m.x0,
        y0: v.y0,
        x1: m.x1,
        y1: v.y1,
    };
    if !r.positive() || !exactly_one_container(&slab.surface, r) {
        return None;
    }
    let walls = unit
        .walls
        .iter()
        .filter(|w| {
            w.body_id.as_deref() == Some(body.id.as_str())
                && w.level == levels[0].index
                && w.solid.is_none()
                && !w.party
                && !w.shell_reference
                && !w.id.contains(":volume:")
                && (w.z_m + w.height_m).to_bits() == slab.z_m.to_bits()
                && exactly_one_container(&w.footprint, r)
        })
        .collect::<Vec<_>>();
    if walls.len() != 1 {
        return None;
    }
    let wall = walls[0];
    if unit.access.portals.iter().any(|q| {
        (q.from_z_m < slab.z_m || q.to_z_m < slab.z_m || wall.opening_ids.contains(&q.id))
            && (shadow(&q.passage, r) || shadow(&q.opening_surface, r))
    }) || unit.features.iter().any(|f| {
        matches!(f.kind, FeatureKind::Window | FeatureKind::PortalLintel)
            && f.z_m < slab.z_m
            && shadow(&f.surface, r)
    }) {
        return None;
    }
    let left = with_bounds(polygon, v, Rect { x1: r.x0, ..v });
    let right = with_bounds(polygon, v, Rect { x0: r.x1, ..v });
    rectangle_bounds(&left)?;
    rectangle_bounds(&right)?;
    let mut expected = source.clone();
    expected.surface.splice(index..=index, [left, right]);
    expected.vertices3d = expected
        .surface
        .iter()
        .flat_map(|q| &q.outer)
        .map(|p| Vertex3 {
            x: p.x,
            y: p.y,
            z: expected.z_m,
        })
        .collect();
    Some(expected)
}

pub(super) fn prepare(
    unit: &HouseUnit,
    target: &AccessNode,
    passage: &Surface,
) -> Option<HouseUnit> {
    let native = original(unit)?.ok()?;
    if native.iter().any(|(i, f)| !same(f, &unit.features[*i])) {
        return None;
    }
    let proposals = native
        .iter()
        .filter_map(|(i, f)| proposed(unit, f, target, passage).map(|p| (*i, p)))
        .collect::<Vec<_>>();
    if proposals.len() != 1 {
        return None;
    }
    let mut candidate = unit.clone();
    candidate.features[proposals[0].0] = proposals[0].1.clone();
    Some(candidate)
}

pub(super) fn eligible(unit: &HouseUnit) -> bool {
    original(unit).is_some_and(|result| {
        result.is_ok_and(|native| native.iter().all(|(i, f)| same(f, &unit.features[*i])))
    })
}

pub(super) fn validate(unit: &HouseUnit) -> Result<(), String> {
    let Some(native) = original(unit) else {
        return Ok(());
    };
    let native = native?;
    let changed = native
        .iter()
        .filter(|(i, f)| !same(f, &unit.features[*i]))
        .collect::<Vec<_>>();
    if changed.is_empty() {
        return Ok(());
    }
    if changed.len() != 1 {
        return Err("Plus d'une Viga native modifiée.".into());
    }
    let (index, source) = changed[0];
    let mut matches = 0;
    for (target, passage) in twoflight::certified_terminals(unit)? {
        if proposed(unit, source, target, &passage.passage)
            .is_some_and(|expected| same(&expected, &unit.features[*index]))
        {
            matches += 1;
        }
    }
    if matches != 1 {
        return Err("Viga coupée sans unique certificat CURRENT de chaîne paire.".into());
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fixture(index: usize) -> HouseUnit {
        let bytes: &[u8] = match index {
            0 => include_bytes!("../../../../fixtures/houses/viga-j9-0.json"),
            4 => include_bytes!("../../../../fixtures/houses/viga-j9-4.json"),
            5 => include_bytes!("../../../../fixtures/houses/viga-j9-5.json"),
            7 => include_bytes!("../../../../fixtures/houses/viga-j9-7.json"),
            _ => panic!("Unknown stored geometry"),
        };
        serde_json::from_value(crate::access::fixture_json_exact::value(bytes)).unwrap()
    }

    fn terminal(unit: &HouseUnit) -> (&AccessNode, &Portal) {
        twoflight::certified_terminals(unit)
            .unwrap()
            .into_iter()
            .find(|(target, _)| target.id.ends_with(":space:30"))
            .unwrap()
    }

    #[test]
    fn exact_rear_cut_and_final_certificate_preserve_every_other_field() {
        for index in [5, 7] {
            let unit = fixture(index);
            let (target, portal) = terminal(&unit);
            let candidate = prepare(&unit, target, &portal.passage).unwrap();
            validate(&candidate).unwrap();
            let changed = unit
                .features
                .iter()
                .zip(&candidate.features)
                .enumerate()
                .filter(|(_, (a, b))| !same(a, b))
                .collect::<Vec<_>>();
            assert_eq!(changed.len(), 1);
            let i = changed[0].0;
            let source = &unit.features[i];
            let expected = &candidate.features[i];
            assert_eq!(expected.surface.len(), source.surface.len() + 1);
            let mut restored = candidate.clone();
            restored.features[i] = source.clone();
            assert_eq!(
                serde_json::to_vec(&restored).unwrap(),
                serde_json::to_vec(&unit).unwrap()
            );
            assert!(prepare(&candidate, target, &portal.passage).is_none());
            let mut foreign = candidate;
            foreign.features[i].surface[0].outer[0].x =
                f64::from_bits(foreign.features[i].surface[0].outer[0].x.to_bits() + 1);
            assert!(validate(&foreign).is_err());
        }
    }

    #[test]
    fn positive_fringe_and_door_below_remain_refusals() {
        for index in [0, 4] {
            let unit = fixture(index);
            let (target, portal) = terminal(&unit);
            assert!(prepare(&unit, target, &portal.passage).is_none());
            validate(&unit).unwrap();
        }
    }

    #[test]
    fn ambiguous_intact_factory_is_inert_and_wrong_material_is_rejected() {
        let mut unit = fixture(5);
        let original_unit = unit.clone();
        unit.bodies[0].details.push("timber_bands".into());
        assert!(!eligible(&unit));
        validate(&unit).unwrap();
        unit = original_unit;
        let i = original(&unit).unwrap().unwrap()[0].0;
        unit.features[i].material = "foreign".into();
        assert!(!eligible(&unit));
        assert!(validate(&unit).is_err());
    }

    #[test]
    fn exact_wall_and_window_shadow_contracts() {
        let original_unit = fixture(5);
        for mutation in 0..4 {
            let mut unit = original_unit.clone();
            let wall = unit
                .walls
                .iter_mut()
                .find(|w| w.id == "wall:unit-0:body:0:1:2")
                .unwrap();
            match mutation {
                0 => wall.party = true,
                1 => wall.id.push_str(":volume:extra"),
                2 => wall.height_m = f64::from_bits(wall.height_m.to_bits() + 1),
                _ => wall.shell_reference = true,
            }
            let (target, portal) = terminal(&unit);
            assert!(prepare(&unit, target, &portal.passage).is_none());
        }
        let mut unit = original_unit;
        let (target, portal) = terminal(&unit);
        let mut window = unit.features[1].clone();
        window.id = "window-only-negative".into();
        window.kind = FeatureKind::Window;
        window.z_m = 0.0;
        window.surface = portal.passage.clone();
        let target = target.clone();
        let passage = portal.passage.clone();
        unit.features.push(window);
        assert!(prepare(&unit, &target, &passage).is_none());
    }

    #[test]
    fn native_bounds_and_closed_arrangement_refuse_ulp_holes_and_obliquity() {
        let unit = fixture(5);
        let (target, portal) = terminal(&unit);
        let source = original(&unit)
            .unwrap()
            .unwrap()
            .into_iter()
            .find(|(_, f)| f.id == "detail-vigas-2")
            .unwrap()
            .1;
        let mut wrong = source.clone();
        let v = rectangle_bounds(&wrong.surface[1]).unwrap();
        for q in &mut wrong.surface[1].outer {
            if q.y == v.y1 {
                q.y = f64::from_bits(q.y.to_bits() + 1);
            }
        }
        assert!(proposed(&unit, &wrong, target, &portal.passage).is_none());
        let mut target = target.clone();
        let p = rectangle_bounds(&portal.passage[0]).unwrap();
        target.floor[0].holes.push(vec![
            Point { x: p.x0, y: p.y1 },
            Point { x: p.x1, y: p.y1 },
            Point {
                x: p.x1,
                y: p.y1 + 0.1,
            },
            Point {
                x: p.x0,
                y: p.y1 + 0.1,
            },
        ]);
        assert!(mask(&portal.passage, &target.floor).is_none());
        let mut passage = portal.passage.clone();
        passage[0].outer[0].x += 0.01;
        assert!(mask(&passage, &target.floor).is_none());
        let target = &terminal(&unit).0.floor;
        let mut null_remainder = portal.passage.clone();
        for q in &mut null_remainder[0].outer {
            if q.x == p.x0 {
                q.x = v.x0;
            }
        }
        assert!(proposed(&unit, &source, terminal(&unit).0, &null_remainder).is_none());
        assert!(mask(&portal.passage, target).is_some());
    }

    #[test]
    fn bundle_material_equals_resolved_material_for_both_actual_configs() {
        let catalogue = crate::catalogue::catalogue().unwrap();
        let recipe = catalogue
            .recipes
            .iter()
            .find(|r| r.id == "AM-PUEB-B02")
            .unwrap();
        for bytes in [
            include_bytes!("../../../../fixtures/houses/viga-j9-AM-PUEB-B02-default-config.json")
                .as_slice(),
            include_bytes!(
                "../../../../fixtures/houses/viga-j9-AM-PUEB-B02-stone_walls-config.json"
            )
            .as_slice(),
        ] {
            let mut config: HouseConfig =
                serde_json::from_value(crate::access::fixture_json_exact::value(bytes)).unwrap();
            let id = config
                .overrides
                .variant
                .clone()
                .unwrap_or_else(|| "default".into());
            let expected = if id == "default" {
                &recipe.parameters
            } else {
                &recipe
                    .variants
                    .iter()
                    .find(|v| v.id == id)
                    .unwrap()
                    .parameters
            };
            for overrides in [false, true] {
                if overrides {
                    config.overrides.infill = Some(expected.materials.infill.clone());
                    config.overrides.roof_pitch_deg = Some(0.0);
                }
                let resolved = catalogue
                    .resolve_variant_parameters(recipe, &config, &id)
                    .unwrap();
                assert_eq!(resolved.materials.roof_frame, expected.materials.roof_frame);
            }
        }
    }
}
