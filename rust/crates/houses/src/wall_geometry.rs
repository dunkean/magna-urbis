//! Convex wall volumes and their native horizontal sections.
//! Plane intersections retain their precision, so shared faces remain planar.
use crate::geometry::{GRID_M, signed_area};
use crate::model::{Point, Polygon, Surface, Vertex3, Wall, WallSolid};
use geo::kernels::{Kernel, Orientation, RobustKernel};
use geo::{ConvexHull, TriangulateEarcut};
use std::collections::{BTreeMap, BTreeSet};

const EPS: f64 = 1e-9;
const FACE_EPS: f64 = 1e-18;

fn sub(a: &Vertex3, b: &Vertex3) -> [f64; 3] {
    [a.x - b.x, a.y - b.y, a.z - b.z]
}
fn dot(a: [f64; 3], b: [f64; 3]) -> f64 {
    a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
}
fn cross(a: [f64; 3], b: [f64; 3]) -> [f64; 3] {
    [
        a[1] * b[2] - a[2] * b[1],
        a[2] * b[0] - a[0] * b[2],
        a[0] * b[1] - a[1] * b[0],
    ]
}
fn norm(a: [f64; 3]) -> f64 {
    libm::sqrt(dot(a, a))
}

/// A prism over a convex, counterclockwise ring without holes.
pub fn prism_solid(polygon: &Polygon, z: f64, height: f64) -> Result<WallSolid, String> {
    if !polygon.holes.is_empty()
        || polygon.outer.len() < 3
        || signed_area(&polygon.outer) <= 0.0
        || !z.is_finite()
        || !height.is_finite()
        || height <= 0.0
    {
        return Err("Prisme de mur invalide.".into());
    }
    let n = polygon.outer.len();
    for i in 0..n {
        let a = polygon.outer[i];
        let b = polygon.outer[(i + 1) % n];
        let c = polygon.outer[(i + 2) % n];
        // A shallow reflex corner still gives an inward prism face. Its turn
        // cannot use the distance tolerance used for coincident 3D vertices.
        if RobustKernel::orient2d(
            geo::Coord { x: a.x, y: a.y },
            geo::Coord { x: b.x, y: b.y },
            geo::Coord { x: c.x, y: c.y },
        ) == Orientation::Clockwise
        {
            return Err("Un solide de mur doit être convexe.".into());
        }
    }
    let vertices = [z, z + height]
        .into_iter()
        .flat_map(|z| {
            polygon
                .outer
                .iter()
                .map(move |p| Vertex3 { x: p.x, y: p.y, z })
        })
        .collect();
    let mut faces = vec![
        (0..n as u32).rev().collect(),
        (n as u32..2 * n as u32).collect(),
    ];
    for i in 0..n {
        let j = (i + 1) % n;
        faces.push(vec![i as u32, j as u32, (n + j) as u32, (n + i) as u32]);
    }
    Ok(WallSolid { vertices, faces })
}

fn closed_topology(solid: &WallSolid) -> Result<(), String> {
    if solid.vertices.len() < 4 || solid.faces.len() < 4 {
        return Err("Volume de mur ouvert ou incomplet.".into());
    }
    let mut edges = BTreeMap::<(u32, u32), u32>::new();
    for face in &solid.faces {
        if face.len() < 3 || face.iter().any(|i| *i as usize >= solid.vertices.len()) {
            return Err("Face de mur invalide.".into());
        }
        for i in 0..face.len() {
            let a = face[i];
            let b = face[(i + 1) % face.len()];
            if a == b {
                return Err("Arête de mur nulle.".into());
            }
            *edges.entry((a, b)).or_default() += 1;
        }
    }
    if edges
        .iter()
        .any(|(&(a, b), &n)| n != 1 || edges.get(&(b, a)) != Some(&1))
        || solid.vertices.len() as isize - (edges.len() / 2) as isize + solid.faces.len() as isize
            != 2
    {
        return Err("Volume de mur ouvert ou de topologie invalide.".into());
    }
    Ok(())
}

/// Intersect a convex solid with n·p <= bound, preserving shared edge ids.
pub fn clip_solid(
    solid: &WallSolid,
    normal: [f64; 3],
    bound: f64,
) -> Result<Option<WallSolid>, String> {
    closed_topology(solid)?;
    let length = norm(normal);
    if length == 0.0 || !length.is_finite() || !bound.is_finite() {
        return Err("Plan de découpe de mur invalide.".into());
    }
    let distances: Vec<_> = solid
        .vertices
        .iter()
        .map(|v| dot(normal, [v.x, v.y, v.z]) - bound)
        .collect();
    if distances.iter().any(|d| !d.is_finite()) {
        return Err("Coordonnées de découpe de mur non finies.".into());
    }
    let signs: Vec<i8> = distances
        .iter()
        .map(|&d| {
            if d < -EPS * length {
                -1
            } else if d > EPS * length {
                1
            } else {
                0
            }
        })
        .collect();
    if signs.iter().all(|&s| s <= 0) {
        return Ok(Some(solid.clone()));
    }
    if signs.iter().all(|&s| s >= 0) {
        return Ok(None);
    }
    // Keep the source ids until the cap is traced. Complementary cuts then
    // share the same coordinates and the same canonical first cap vertex.
    let mut vertices = solid.vertices.clone();
    let mut on_plane: Vec<_> = signs.iter().map(|&s| s == 0).collect();
    let mut crossings = BTreeMap::<(u32, u32), u32>::new();
    let mut faces = vec![];
    for face in &solid.faces {
        let mut out = vec![];
        for i in 0..face.len() {
            let a = face[i];
            let b = face[(i + 1) % face.len()];
            if signs[a as usize] <= 0 {
                out.push(a);
            }
            if signs[a as usize] * signs[b as usize] < 0 {
                let key = (a.min(b), a.max(b));
                let id = *crossings.entry(key).or_insert_with(|| {
                    let (a, b) = (key.0 as usize, key.1 as usize);
                    let t = distances[a] / (distances[a] - distances[b]);
                    let (a, b) = (&solid.vertices[a], &solid.vertices[b]);
                    let id = vertices.len() as u32;
                    vertices.push(Vertex3 {
                        x: a.x + (b.x - a.x) * t,
                        y: a.y + (b.y - a.y) * t,
                        z: a.z + (b.z - a.z) * t,
                    });
                    on_plane.push(true);
                    id
                });
                out.push(id);
            }
        }
        out.dedup();
        if out.first() == out.last() {
            out.pop();
        }
        if out.len() >= 3 && !out.iter().all(|&id| on_plane[id as usize]) {
            faces.push(out);
        }
    }
    let mut successor = BTreeMap::new();
    let mut incoming = BTreeSet::new();
    for face in &faces {
        for i in 0..face.len() {
            let a = face[i];
            let b = face[(i + 1) % face.len()];
            if on_plane[a as usize]
                && on_plane[b as usize]
                && (successor.insert(b, a).is_some() || !incoming.insert(a))
            {
                return Err("Cap de mur à arêtes ambiguës.".into());
            }
        }
    }
    let Some((&start, _)) = successor.first_key_value() else {
        return Err("Découpe de mur sans cap fermé.".into());
    };
    let mut cap = vec![];
    let mut cursor = start;
    loop {
        cap.push(cursor);
        cursor = *successor.get(&cursor).ok_or("Cap de mur ouvert.")?;
        if cursor == start {
            break;
        }
        if cap.len() >= successor.len() {
            return Err("Cap de mur à cycles multiples.".into());
        }
    }
    if cap.len() < 3 || cap.len() != successor.len() {
        return Err("Cap de mur incomplet.".into());
    }
    faces.push(cap);
    let used: BTreeSet<_> = faces.iter().flatten().copied().collect();
    let remap: BTreeMap<_, _> = used
        .iter()
        .enumerate()
        .map(|(i, &id)| (id, i as u32))
        .collect();
    let result = WallSolid {
        vertices: used
            .into_iter()
            .map(|id| vertices[id as usize].clone())
            .collect(),
        faces: faces
            .into_iter()
            .map(|f| f.into_iter().map(|id| remap[&id]).collect())
            .collect(),
    };
    closed_topology(&result)?;
    Ok((signed_volume(&result) > 1e-12).then_some(result))
}

fn hull(points: Vec<Point>) -> Vec<Point> {
    if points.len() < 3 {
        return vec![];
    }
    // Robust orientation retains extreme corners whose x coordinates differ
    // only by floating point noise after a sequence of plane intersections.
    let points = geo::MultiPoint(
        points
            .into_iter()
            .map(|p| geo::Point::new(p.x, p.y))
            .collect(),
    );
    let polygon = points.convex_hull();
    let mut ring: Vec<_> = polygon
        .exterior()
        .0
        .iter()
        .map(|p| Point { x: p.x, y: p.y })
        .collect();
    if ring.first() == ring.last() {
        ring.pop();
    }
    if signed_area(&ring) < 0.0 {
        ring.reverse();
    }
    if let Some(index) = (0..ring.len()).min_by(|&a, &b| {
        ring[a]
            .x
            .total_cmp(&ring[b].x)
            .then(ring[a].y.total_cmp(&ring[b].y))
    }) {
        ring.rotate_left(index);
    }
    if ring.len() < 3 || signed_area(&ring) <= FACE_EPS {
        vec![]
    } else {
        ring
    }
}

fn surface(points: Vec<Point>) -> Surface {
    let outer = hull(points);
    if outer.is_empty() {
        vec![]
    } else {
        vec![Polygon {
            outer,
            holes: vec![],
        }]
    }
}

pub fn solid_projection(solid: &WallSolid) -> Surface {
    surface(
        solid
            .vertices
            .iter()
            .map(|p| Point { x: p.x, y: p.y })
            .collect(),
    )
}

/// Exact horizontal section of an ordinary prism or a convex wall volume.
pub fn wall_section(wall: &Wall, z: f64) -> Surface {
    if z < wall.z_m - EPS || z > wall.z_m + wall.height_m + EPS {
        return vec![];
    }
    if wall.shell_reference {
        return if (z - wall.z_m).abs() <= 0.02 {
            wall.footprint.clone()
        } else {
            vec![]
        };
    }
    let Some(solid) = &wall.solid else {
        return wall.footprint.clone();
    };
    let mut points = vec![];
    for face in &solid.faces {
        for i in 0..face.len() {
            let a = &solid.vertices[face[i] as usize];
            let b = &solid.vertices[face[(i + 1) % face.len()] as usize];
            if (a.z - z).abs() <= EPS {
                points.push(Point { x: a.x, y: a.y });
            }
            if (a.z < z && b.z > z) || (a.z > z && b.z < z) {
                let t = (z - a.z) / (b.z - a.z);
                points.push(Point {
                    x: a.x + (b.x - a.x) * t,
                    y: a.y + (b.y - a.y) * t,
                });
            }
        }
    }
    surface(points)
}

/// Refresh the footprint and render cut from the authoritative solid.
pub fn assign_solid(wall: &mut Wall, solid: WallSolid) {
    let min = solid
        .vertices
        .iter()
        .map(|v| v.z)
        .fold(f64::INFINITY, f64::min);
    let max = solid
        .vertices
        .iter()
        .map(|v| v.z)
        .fold(f64::NEG_INFINITY, f64::max);
    wall.footprint = solid_projection(&solid);
    wall.z_m = min;
    wall.height_m = max - min;
    wall.solid = Some(solid);
    wall.plan_section = Some(wall_section(wall, min + 0.01));
}

pub(crate) fn convex_parts(surface: &Surface) -> Vec<Polygon> {
    let mut parts = vec![];
    for polygon in surface {
        if polygon.holes.is_empty() && prism_solid(polygon, 0.0, 1.0).is_ok() {
            parts.push(polygon.clone());
        } else {
            for triangle in crate::geometry::to_geo(&vec![polygon.clone()]).0[0].earcut_triangles()
            {
                let mut outer = vec![
                    Point {
                        x: triangle.v1().x,
                        y: triangle.v1().y,
                    },
                    Point {
                        x: triangle.v2().x,
                        y: triangle.v2().y,
                    },
                    Point {
                        x: triangle.v3().x,
                        y: triangle.v3().y,
                    },
                ];
                if signed_area(&outer) < 0.0 {
                    outer.reverse();
                }
                if signed_area(&outer) > 1e-12 {
                    parts.push(Polygon {
                        outer,
                        holes: vec![],
                    });
                }
            }
        }
    }
    parts
}

fn subtract_convex(solid: WallSolid, planes: &[([f64; 3], f64)]) -> Result<Vec<WallSolid>, String> {
    let mut remaining = Some(solid);
    let mut pieces = vec![];
    for &(normal, bound) in planes {
        let Some(current) = remaining.take() else {
            break;
        };
        if let Some(outside) = clip_solid(&current, normal.map(|v| -v), -bound)? {
            pieces.push(outside);
        }
        remaining = clip_solid(&current, normal, bound)?;
    }
    Ok(pieces)
}

/// Remove an opening varying linearly between its sill and head. Every retained
/// jamb, lintel and sill is part of the original volume, rather than decoration.
#[allow(clippy::too_many_arguments)]
pub fn cut_profile_wall(
    wall: &mut Wall,
    cut: &Surface,
    opening: [Point; 2],
    width: f64,
    top_width: f64,
    sill: f64,
    head: f64,
    portal_id: &str,
) -> Result<Vec<Wall>, String> {
    if cut.len() != 1
        || !cut[0].holes.is_empty()
        || cut[0].outer.len() != 4
        || head <= sill
        || !width.is_finite()
        || !top_width.is_finite()
        || width <= 0.0
        || top_width <= 0.0
    {
        return Err("Profil de passage invalide.".into());
    }
    if wall.shell_reference {
        wall.footprint = crate::geometry::difference(&wall.footprint, cut);
        wall.opening_ids.push(portal_id.into());
        return Ok(vec![]);
    }
    let length = libm::hypot(opening[1].x - opening[0].x, opening[1].y - opening[0].y);
    if length < EPS {
        return Err("Axe de passage nul.".into());
    }
    let ax = (opening[1].x - opening[0].x) / length;
    let ay = (opening[1].y - opening[0].y) / length;
    let center =
        ax * (opening[0].x + opening[1].x) * 0.5 + ay * (opening[0].y + opening[1].y) * 0.5;
    let k = (top_width - width) / (2.0 * (head - sill));
    let mut planes = vec![];
    // Bound the depth and maximum width by the actual native passage polygon.
    for i in 0..4 {
        let a = cut[0].outer[i];
        let b = cut[0].outer[(i + 1) % 4];
        let normal = [b.y - a.y, a.x - b.x, 0.0];
        planes.push((normal, normal[0] * a.x + normal[1] * a.y));
    }
    planes.extend([
        ([0.0, 0.0, -1.0], -sill),
        ([0.0, 0.0, 1.0], head),
        ([ax, ay, -k], center + width * 0.5 - k * sill),
        ([-ax, -ay, -k], -center + width * 0.5 - k * sill),
    ]);
    let solids = if let Some(solid) = &wall.solid {
        subtract_convex(solid.clone(), &planes)?
    } else {
        let original = crate::geometry::intersection(&wall.footprint, cut);
        convex_parts(&original)
            .into_iter()
            .map(|p| prism_solid(&p, wall.z_m, wall.height_m))
            .collect::<Result<Vec<_>, _>>()?
            .into_iter()
            .map(|s| subtract_convex(s, &planes))
            .collect::<Result<Vec<_>, _>>()?
            .into_iter()
            .flatten()
            .collect()
    };
    let template = wall.clone();
    let mut parts = vec![];
    for (i, solid) in solids.into_iter().enumerate() {
        let mut part = template.clone();
        part.id = format!("{}:{portal_id}:volume:{i}", template.id);
        part.opening_ids.clear();
        assign_solid(&mut part, solid);
        validate_wall(&part)?;
        parts.push(part);
    }
    if wall.solid.is_some() {
        // The source convex wall is replaced by its actual complementary pieces.
        if let Some(first) = parts.first_mut() {
            first.id = wall.id.clone();
        }
        wall.footprint.clear();
        wall.solid = None;
        wall.plan_section = None;
    } else {
        wall.footprint = crate::geometry::difference(&wall.footprint, cut);
        wall.opening_ids.push(portal_id.into());
    }
    Ok(parts)
}

pub fn signed_volume(solid: &WallSolid) -> f64 {
    let Some(origin) = solid.vertices.first() else {
        return 0.0;
    };
    solid
        .faces
        .iter()
        .map(|f| {
            let a = &solid.vertices[f[0] as usize];
            (1..f.len() - 1)
                .map(|i| {
                    let b = &solid.vertices[f[i] as usize];
                    let c = &solid.vertices[f[i + 1] as usize];
                    dot(sub(a, origin), cross(sub(b, origin), sub(c, origin))) / 6.0
                })
                .sum::<f64>()
        })
        .sum()
}

/// Closed, outward and convex; projection and extents must match the record.
pub fn validate_wall(wall: &Wall) -> Result<(), String> {
    let Some(solid) = &wall.solid else {
        return Ok(());
    };
    if solid.vertices.len() < 4
        || solid.faces.len() < 4
        || solid
            .vertices
            .iter()
            .any(|v| !v.x.is_finite() || !v.y.is_finite() || !v.z.is_finite())
    {
        return Err(format!("Mur {} : volume non fini ou incomplet.", wall.id));
    }
    closed_topology(solid)?;
    for face in &solid.faces {
        if face.len() < 3 || face.iter().any(|i| *i as usize >= solid.vertices.len()) {
            return Err("Face de mur invalide.".into());
        }
        let a = &solid.vertices[face[0] as usize];
        let (normal, length) = (1..face.len() - 1)
            .filter_map(|i| {
                let b = &solid.vertices[face[i] as usize];
                let c = &solid.vertices[face[i + 1] as usize];
                let coords = |p: &Vertex3| [[p.x, p.y], [p.y, p.z], [p.z, p.x]];
                if coords(a)
                    .into_iter()
                    .zip(coords(b))
                    .zip(coords(c))
                    .all(|((a, b), c)| {
                        RobustKernel::orient2d(a.into(), b.into(), c.into())
                            == Orientation::Collinear
                    })
                {
                    return None;
                }
                let normal = cross(sub(b, a), sub(c, a));
                let length = libm::hypot(libm::hypot(normal[0], normal[1]), normal[2]);
                Some((normal, length))
            })
            .max_by(|a, b| a.1.total_cmp(&b.1))
            .ok_or("Face de mur dégénérée.")?;
        if length <= 0.0 || !length.is_finite() {
            return Err("Normale de face de mur non représentable.".into());
        }
        // Positive faces below an absolute area threshold still close the
        // solid. Projection/section area tolerances cannot certify these tiny
        // corners; topology and these metric half-space tests must retain them.
        let normal = normal.map(|n| n / length);
        if face
            .iter()
            .any(|i| dot(normal, sub(&solid.vertices[*i as usize], a)).abs() > 1e-6)
            || solid.vertices.iter().any(|v| dot(normal, sub(v, a)) > 1e-6)
        {
            return Err("Face de mur non plane ou volume non convexe.".into());
        }
    }
    if signed_volume(solid) <= 1e-12 {
        return Err("Volume de mur ouvert, inversé ou de topologie invalide.".into());
    }
    let projection = solid_projection(solid);
    if crate::geometry::area(&crate::geometry::difference(&projection, &wall.footprint))
        + crate::geometry::area(&crate::geometry::difference(&wall.footprint, &projection))
        > 1e-6
    {
        return Err("Projection de mur différente de son solide.".into());
    }
    let min = solid
        .vertices
        .iter()
        .map(|v| v.z)
        .fold(f64::INFINITY, f64::min);
    let max = solid
        .vertices
        .iter()
        .map(|v| v.z)
        .fold(f64::NEG_INFINITY, f64::max);
    if (min - wall.z_m).abs() > EPS || (max - min - wall.height_m).abs() > EPS {
        return Err("Cotes de mur différentes de son solide.".into());
    }
    let cut = wall_section(wall, min + 0.01);
    let exported = wall
        .plan_section
        .as_ref()
        .ok_or("Mur solide sans coupe native pour le plan.")?;
    if crate::geometry::area(&crate::geometry::difference(&cut, exported))
        + crate::geometry::area(&crate::geometry::difference(exported, &cut))
        > GRID_M * GRID_M
    {
        return Err("Coupe publiée de mur différente de son volume.".into());
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::geometry::{area, rectangle};
    use crate::model::WallKind;

    fn wall(solid: WallSolid) -> Wall {
        let mut wall = Wall {
            id: "jamb".into(),
            kind: WallKind::Exterior,
            body_id: Some("body".into()),
            level: 0,
            z_m: 0.0,
            height_m: 1.0,
            footprint: vec![],
            centerline: vec![],
            material: "MAT-STONE".into(),
            party: false,
            opening_ids: vec![],
            solid: None,
            plan_section: None,
            shell_reference: false,
        };
        assign_solid(&mut wall, solid);
        wall
    }

    #[test]
    fn captured_positive_subthreshold_face_is_retained() {
        let wall: Wall = serde_json::from_str(include_str!(
            "../../../fixtures/houses/positive-wall-face.json"
        ))
        .unwrap();
        validate_wall(&wall).unwrap();
        let solid = wall.solid.as_ref().unwrap();
        assert_eq!(solid.vertices.len(), 8);
        assert_eq!(solid.faces.len(), 6);
        assert!(signed_volume(solid) > 1e-12);
        let mut translated = wall.clone();
        for v in &mut translated.solid.as_mut().unwrap().vertices {
            v.x += 1e4;
            v.y += 1e4;
        }
        for surface in
            std::iter::once(&mut translated.footprint).chain(translated.plan_section.iter_mut())
        {
            for p in surface {
                for q in p.outer.iter_mut().chain(p.holes.iter_mut().flatten()) {
                    q.x += 1e4;
                    q.y += 1e4;
                }
            }
        }
        validate_wall(&translated).unwrap();
    }

    #[test]
    fn truly_collinear_face_is_rejected_with_unchanged_topology() {
        let mut wall: Wall = serde_json::from_str(include_str!(
            "../../../fixtures/houses/positive-wall-face.json"
        ))
        .unwrap();
        let solid = wall.solid.as_mut().unwrap();
        solid.vertices[4].x = solid.vertices[3].x;
        closed_topology(solid).unwrap();
        assert_eq!(validate_wall(&wall).unwrap_err(), "Face de mur dégénérée.");
    }

    #[test]
    fn indexed_clips_preserve_closed_complementary_wall_volumes() {
        let cases: Vec<serde_json::Value> = serde_json::from_str(include_str!(
            "../../../fixtures/houses/wall-clip-regressions.json"
        ))
        .unwrap();
        for case in cases {
            let id = case["id"].as_str().unwrap();
            let source: WallSolid = serde_json::from_value(case["solid"].clone()).unwrap();
            let normal: [f64; 3] = serde_json::from_value(case["normal"].clone()).unwrap();
            let bound = case["bound"].as_f64().unwrap();
            let inside = clip_solid(&source, normal, bound).unwrap();
            let outside = clip_solid(&source, normal.map(|n| -n), -bound).unwrap();
            let mut retained = 0.0;
            for solid in inside.into_iter().chain(outside) {
                closed_topology(&solid).unwrap();
                retained += signed_volume(&solid);
                validate_wall(&wall(solid)).unwrap_or_else(|e| panic!("{id}: {e}"));
            }
            assert!(
                (retained - signed_volume(&source)).abs() < 1e-12,
                "{id}: volume lost"
            );
        }
    }

    #[test]
    fn wall_volume_is_translation_invariant_and_open_plates_are_errors() {
        let source = prism_solid(&rectangle(0.0, 0.0, 2.0, 1.0)[0], 0.0, 3.0).unwrap();
        let mut translated = source.clone();
        for vertex in &mut translated.vertices {
            vertex.x += 10_000.0;
            vertex.y += 10_000.0;
        }
        assert_eq!(signed_volume(&source), signed_volume(&translated));
        assert_eq!(signed_volume(&source), 6.0);
        let mut plate = source;
        plate.faces.truncate(1);
        assert!(clip_solid(&plate, [1.0, 0.0, 0.0], 1.0).is_err());
    }

    #[test]
    fn touching_planes_do_not_duplicate_caps_and_crossings_are_shared() {
        let source = prism_solid(&rectangle(0.0, 0.0, 2.0, 1.0)[0], 0.0, 3.0).unwrap();
        assert_eq!(
            clip_solid(&source, [1.0, 0.0, 0.0], 2.0).unwrap(),
            Some(source.clone())
        );
        assert!(clip_solid(&source, [1.0, 0.0, 0.0], 0.0).unwrap().is_none());
        let a = clip_solid(&source, [1.0, 0.0, 0.0], 0.7).unwrap().unwrap();
        let b = clip_solid(&source, [-1.0, 0.0, 0.0], -0.7)
            .unwrap()
            .unwrap();
        let cap = |solid: &WallSolid| {
            solid
                .faces
                .iter()
                .find_map(|face| {
                    let vertices: Vec<_> = face
                        .iter()
                        .map(|&id| solid.vertices[id as usize].clone())
                        .collect();
                    vertices.iter().all(|v| v.x == 0.7).then_some(vertices)
                })
                .unwrap()
        };
        let ca = cap(&a);
        let mut cb = cap(&b);
        cb[1..].reverse();
        assert_eq!(ca, cb);
        closed_topology(&a).unwrap();
        closed_topology(&b).unwrap();
        assert!((signed_volume(&a) + signed_volume(&b) - 6.0).abs() < 1e-12);
    }

    #[test]
    fn trapezoid_jambs_are_closed_and_conserve_the_opening_volume() {
        let polygon = &rectangle(-0.6, -0.15, 1.2, 0.3)[0];
        let prism = prism_solid(polygon, 0.0, 1.5).unwrap();
        let k = (1.2 - 0.8) / (2.0 * 1.5);
        let left = wall(clip_solid(&prism, [1.0, 0.0, -k], -0.6).unwrap().unwrap());
        let right = wall(clip_solid(&prism, [-1.0, 0.0, -k], -0.6).unwrap().unwrap());
        validate_wall(&left).unwrap();
        validate_wall(&right).unwrap();
        let jambs = signed_volume(left.solid.as_ref().unwrap())
            + signed_volume(right.solid.as_ref().unwrap());
        let opening = 0.3 * (1.2 + 0.8) * 0.5 * 1.5;
        assert!((signed_volume(&prism) - jambs - opening).abs() < 1e-6);
        for z in [0.000001, 0.75, 1.499999] {
            let occupied = area(&wall_section(&left, z)) + area(&wall_section(&right, z));
            let width = 1.2 - (1.2 - 0.8) * z / 1.5;
            assert!((occupied + width * 0.3 - 1.2 * 0.3).abs() < 1e-6);
        }
        assert!(wall_section(&left, -0.001).is_empty());
        assert!(wall_section(&right, 1.501).is_empty());
        assert!(area(&left.footprint) > area(&wall_section(&left, 0.01)));
    }

    #[test]
    fn inclined_bank_has_real_volume_and_height_dependent_sections() {
        let prism = prism_solid(&rectangle(0.0, 0.0, 2.0, 1.0)[0], 0.0, 1.0).unwrap();
        let bank = wall(clip_solid(&prism, [0.5, 0.0, 1.0], 1.0).unwrap().unwrap());
        validate_wall(&bank).unwrap();
        assert!((signed_volume(bank.solid.as_ref().unwrap()) - 1.0).abs() < 1e-6);
        for z in [0.01, 0.5, 0.99] {
            assert!((area(&wall_section(&bank, z)) - 2.0 * (1.0 - z)).abs() < 1e-6);
        }
        let mut broken = bank.clone();
        broken.solid.as_mut().unwrap().faces.pop();
        assert!(validate_wall(&broken).is_err());
        let mut broken = bank;
        broken.plan_section = Some(rectangle(0.0, 0.0, 2.0, 1.0));
        assert!(validate_wall(&broken).is_err());
    }

    #[test]
    fn a_shallow_reflex_bank_corner_is_decomposed_before_extrusion() {
        // AS-SIB-B08, seed42: an overlay leaves a genuine reflex turn whose
        // determinant is only -1.4e-14, but its side face is metres inward.
        let polygon = Polygon {
            outer: vec![
                Point {
                    x: 12.632999990344047,
                    y: 18.000000011980536,
                },
                Point {
                    x: 12.633000005245208,
                    y: 17.999999997079374,
                },
                Point {
                    x: 12.633000005245208,
                    y: 17.99999905830622,
                },
                Point {
                    x: 12.90399998819828,
                    y: 0.6469999969601652,
                },
                Point {
                    x: 12.90399998819828,
                    y: 18.75300000315905,
                },
            ],
            holes: vec![],
        };
        assert!(prism_solid(&polygon, -2.55, 2.95).is_err());
        let parts = convex_parts(&vec![polygon.clone()]);
        assert!(parts.len() > 1);
        let mut retained = 0.0;
        for part in parts {
            let prism = prism_solid(&part, -2.55, 2.95).unwrap();
            let solid = clip_solid(
                &prism,
                [7.242400000000001, 0.0, 4.906725999999983],
                93.4559296,
            )
            .unwrap()
            .unwrap();
            let bank = wall(solid);
            validate_wall(&bank).unwrap();
            assert!(signed_volume(bank.solid.as_ref().unwrap()) > 0.0);
            retained += signed_area(&part.outer);
        }
        assert!((retained - signed_area(&polygon.outer)).abs() < 1e-9);
    }

    #[test]
    fn low_trapezoid_retains_its_real_lintel_sill_and_jambs() {
        let mut source = wall(prism_solid(&rectangle(-2.0, -0.15, 4.0, 0.3)[0], 0.0, 3.0).unwrap());
        // Ordinary source wall is still an extrusion before its first opening.
        source.solid = None;
        source.plan_section = None;
        let original = area(&source.footprint) * source.height_m;
        let cut = rectangle(-0.6, -0.25, 1.2, 0.5);
        let opening = [Point { x: -0.6, y: 0.0 }, Point { x: 0.6, y: 0.0 }];
        let pieces =
            cut_profile_wall(&mut source, &cut, opening, 1.2, 0.8, 0.2, 1.7, "door").unwrap();
        let retained = area(&source.footprint) * source.height_m
            + pieces
                .iter()
                .map(|w| signed_volume(w.solid.as_ref().unwrap()))
                .sum::<f64>();
        let void = 0.3 * (1.2 + 0.8) * 0.5 * (1.7 - 0.2);
        assert!((original - retained - void).abs() < 1e-6);
        for piece in &pieces {
            validate_wall(piece).unwrap();
            assert!(piece.opening_ids.is_empty());
        }
        for z in [0.200001, 0.95, 1.699999] {
            let filled = pieces
                .iter()
                .map(|w| area(&wall_section(w, z)))
                .sum::<f64>();
            let width = 1.2 - (1.2 - 0.8) * (z - 0.2) / 1.5;
            assert!(
                (filled + width * 0.3 - 1.2 * 0.3).abs() < 1e-6,
                "section z={z}, solid area={filled}, expected={}",
                (1.2 - width) * 0.3
            );
        }
        assert!(
            (pieces
                .iter()
                .map(|w| area(&wall_section(w, 0.1)))
                .sum::<f64>()
                - 0.36)
                .abs()
                < 1e-6
        );
        assert!(
            (pieces
                .iter()
                .map(|w| area(&wall_section(w, 1.8)))
                .sum::<f64>()
                - 0.36)
                .abs()
                < 1e-6
        );
    }
}
