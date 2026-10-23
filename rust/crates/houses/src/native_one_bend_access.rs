//! Last-resort native connector with one constructive, complete-width turn.
//! No source/pose/portal choice, frontage sampling or shortened passage.
use crate::access::StructuralEntrance;
use crate::geometry::{area, intersection, to_geo};
use crate::model::{Point, Polygon, Surface};

/// Supplied only by the eligible prepared-native-entry path. Older budget
/// callers have no body/site identity certificate and do not use this fallback.
#[derive(Clone, Copy)]
pub(super) struct OneBendContext<'a> {
    pub(super) body_entry: &'a StructuralEntrance,
    pub(super) body_local: &'a Surface,
}

impl OneBendContext<'_> {
    pub(super) fn matches_site(&self, site: &StructuralEntrance) -> bool {
        let body = self.body_entry;
        site.width_m.is_finite()
            && site.width_m >= 0.8
            && site.from_z_m.is_finite()
            && site.from_z_m == site.to_z_m
            && body.opening == site.opening
            && body.passage == site.passage
            && body.width_m == site.width_m
            && body.from_z_m == site.from_z_m
            && body.to_z_m == site.to_z_m
    }
}

pub(super) struct ConstructedBend {
    pub(super) path: Surface,
    #[cfg(test)]
    pub(super) entry: Point,
    #[cfg(test)]
    pub(super) bend: Point,
    pub(super) contact: Point,
    #[cfg(test)]
    pub(super) door_cap: [Point; 2],
    #[cfg(test)]
    pub(super) street_cap: [Point; 2],
    #[cfg(test)]
    pub(super) joint: [Point; 2],
    #[cfg(test)]
    pub(super) first: [f64; 2],
    #[cfg(test)]
    pub(super) second: [f64; 2],
}

/// One constructive route only. The first leg is normal to the actual door;
/// the second is normal to the actual street. A supporting line parallel to
/// that second leg (perpendicular to the street) clears ALL body/support
/// vertices by half the requested clear width. No searched step,
/// scene coordinate, arbitrary setback or shortened native passage is used.
pub(super) fn one_bend_on_support_line(
    opening: [Point; 2],
    body: &Surface,
    solids: &Surface,
    street: [Point; 2],
    width: f64,
) -> Result<ConstructedBend, &'static str> {
    let vector = |a: Point, b: Point| [b.x - a.x, b.y - a.y];
    let dot = |a: [f64; 2], b: [f64; 2]| a[0] * b[0] + a[1] * b[1];
    let at = |p: Point, v: [f64; 2], t: f64| Point { x: p.x + v[0] * t, y: p.y + v[1] * t };
    let normalized = |v: [f64; 2]| {
        let length = libm::hypot(v[0], v[1]);
        (length.is_finite() && length > 0.).then(|| ([v[0] / length, v[1] / length], length))
    };
    let (door_axis, door_length) = normalized(vector(opening[0], opening[1])).ok_or("Invalid door")?;
    let (street_axis, street_length) = normalized(vector(street[0], street[1])).ok_or("Invalid street")?;
    if !width.is_finite() || width <= 0. || door_length < width || street_length < width {
        return Err("Actual cap cannot carry the requested clear width");
    }
    let half = width * 0.5;
    let entry = Point { x: (opening[0].x + opening[1].x) * 0.5, y: (opening[0].y + opening[1].y) * 0.5 };
    let normal = [-door_axis[1], door_axis[0]];
    let half_landing = |sign: f64| vec![Polygon {
        outer: vec![opening[0], opening[1], at(opening[1], normal, sign * half), at(opening[0], normal, sign * half)],
        holes: vec![],
    }];
    let left_body = area(&intersection(&half_landing(1.), body));
    let right_body = area(&intersection(&half_landing(-1.), body));
    if left_body == right_body {
        return Err("Door does not determine a unique exterior half-plane");
    }
    let first = if left_body < right_body { normal } else { [-normal[0], -normal[1]] };
    let mut clearance_normal = street_axis;
    if dot(clearance_normal, first) < 0. {
        clearance_normal = [-clearance_normal[0], -clearance_normal[1]];
    }
    let projection = dot(clearance_normal, first);
    if projection <= 0. {
        return Err("Door ray cannot reach a supporting line parallel to the second leg");
    }
    let support = body.iter().chain(solids).flat_map(|p| &p.outer)
        .map(|p| dot([p.x - entry.x, p.y - entry.y], clearance_normal))
        .fold(f64::NEG_INFINITY, f64::max);
    let distance = (support + half) / projection;
    if !distance.is_finite() || distance <= 0. {
        return Err("No forward supporting-line bend");
    }
    let bend = at(entry, first, distance);
    let contact_from = dot(vector(street[0], bend), street_axis);
    if contact_from < half || street_length - contact_from < half {
        return Err("Perpendicular street cap exceeds its actual segment");
    }
    let contact = at(street[0], street_axis, contact_from);
    let (second, second_length) = normalized(vector(bend, contact)).ok_or("Zero second leg")?;
    let n1 = [-first[1], first[0]];
    let n2 = [-second[1], second[0]];
    let denominator = 1. + dot(n1, n2);
    if denominator <= 0. {
        return Err("A reversing turn has no finite miter joint");
    }
    let miter = [(n1[0] + n2[0]) * half / denominator, (n1[1] + n2[1]) * half / denominator];
    // Both offset sides must advance along each leg: reject a turn whose
    // complete-width joint consumes a cap rather than clipping the joint.
    if distance <= dot(miter, first).abs() || second_length <= dot(miter, second).abs() {
        return Err("A complete-width turn overlaps a terminal cap");
    }
    let door_cap = [at(entry, n1, half), at(entry, n1, -half)];
    let street_cap = [at(contact, n2, half), at(contact, n2, -half)];
    let joint = [at(bend, miter, 1.), at(bend, miter, -1.)];
    let path = vec![Polygon { outer: vec![door_cap[0], joint[0], street_cap[0], street_cap[1], joint[1], door_cap[1]], holes: vec![] }];
    if !crate::placement::valid_surface(&path) || !geo::algorithm::Validation::is_valid(&to_geo(&path)) {
        return Err("Constructed miter route is not a valid simple polygon");
    }
    Ok(ConstructedBend {
        path, contact,
        #[cfg(test)] entry,
        #[cfg(test)] bend,
        #[cfg(test)] door_cap,
        #[cfg(test)] street_cap,
        #[cfg(test)] joint,
        #[cfg(test)] first,
        #[cfg(test)] second,
    })
}

