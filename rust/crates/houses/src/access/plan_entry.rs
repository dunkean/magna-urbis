//! Retain a native entrance before site placement and interior subdivision.
//! The caller supplies its already-built structural unit; this module never
//! constructs a layout, draws a source, divides rooms or builds roof meshes.
use super::{StructuralEntrance, structural_access, structural_site_entry};
use crate::catalogue::Parameters;
use crate::geometry::{area, intersection, unite};
use crate::model::{FeatureKind, HouseUnit, PortalKind, Surface};
use crate::wall_geometry::wall_section;
use std::sync::Arc;

pub(crate) const MAX_EXISTING_ENTRY_ALTERNATIVES: usize = 4;

#[derive(Clone)]
pub(crate) struct PreparedEntrancePair {
    pub portal_id: String,
    pub body_entry: StructuralEntrance,
    pub site_entry: StructuralEntrance,
}

#[derive(Clone)]
pub(crate) struct PreparedPlanEntry {
    /// Store this in ResolvedArchitecture::entrance for exact detail replay.
    pub body_entry: StructuralEntrance,
    /// Attach the public connector here; a perimeter gate can differ from the
    /// body portal. The supported ground Strip scope has no perimeter gate.
    pub site_entry: StructuralEntrance,
    /// Local post/party-wall and actual cut-wall sections at the site entrance
    /// walking level. Transform this once-prepared union with the connector;
    /// walkable gallery surfaces themselves are not obstacles.
    pub site_solids: Arc<Surface>,
    /// Other already-cut root doors in stable id order. No site or solid
    /// admission is implied until selected; successful canonical doors pay
    /// neither additional wall unions nor passage/solid booleans for these.
    pub alternatives: Vec<PreparedEntrancePair>,
    /// Previously checked native passages that must remain reserved in the
    /// exported circulation when another existing door is selected. Empty on
    /// the canonical path; reconstructed identically for an archived choice.
    pub retained_passages: Vec<Surface>,
}

pub(crate) fn same_entrance(a: &StructuralEntrance, b: &StructuralEntrance) -> bool {
    a.opening == b.opening
        && a.passage == b.passage
        && a.width_m == b.width_m
        && a.from_z_m == b.from_z_m
        && a.to_z_m == b.to_z_m
}

impl PreparedPlanEntry {
    pub(crate) fn with_existing_entry(&self, index: usize) -> Result<Self, String> {
        let pair = self
            .alternatives
            .get(index)
            .ok_or("Unknown existing native entrance alternative.")?;
        // The collection below permits only the same walking level and no
        // separate perimeter gate, so this exact union applies to both doors.
        if area(&intersection(&pair.site_entry.passage, &self.site_solids)) > 0.0001
            || area(&intersection(&pair.body_entry.passage, &self.site_solids)) > 0.0001
        {
            return Err("Existing native entrance passage intersects a structural support or an uncut wall.".into());
        }
        let mut selected = self.clone();
        for passage in [&self.body_entry.passage, &self.site_entry.passage] {
            if !selected.retained_passages.contains(passage) {
                selected.retained_passages.push(passage.clone());
            }
        }
        selected.body_entry = pair.body_entry.clone();
        selected.site_entry = pair.site_entry.clone();
        Ok(selected)
    }
}

fn solids_at_entry(unit: &HouseUnit, entry: &StructuralEntrance) -> Surface {
    let z = entry.from_z_m + 0.01;
    let mut parts: Vec<_> = unit
        .walls
        .iter()
        .map(|wall| wall_section(wall, z))
        .collect();
    parts.extend(
        unit.features
            .iter()
            .filter(|feature| {
                matches!(feature.kind, FeatureKind::Post | FeatureKind::PartyWall)
                    && feature.z_m <= z
                    && feature.z_m + feature.height_m > z
            })
            .map(|feature| feature.surface.clone()),
    );
    unite(&parts)
}

/// Consumes one fresh native access graph on the caller's ephemeral structural
/// unit. The source parameters and layout paths remain immutable. Access may
/// cut native walls or add structural interfaces: callers must collect their
/// site features AFTER this function and validate all resulting occupation,
/// supports, passages and public connection against the real site.
///
/// This certificate fixes the opening, not parcel/terrain/interior feasibility.
/// In particular, the synthetic unit lot is not a cadastral access right.
pub(crate) fn prepare_plan_entry(
    unit: &mut HouseUnit,
    paths: &Surface,
    parameters: &Parameters,
) -> Result<PreparedPlanEntry, String> {
    if !unit.rooms.is_empty()
        || !unit.roofs.vertices.is_empty()
        || !unit.roofs.faces.is_empty()
        || !unit.access.nodes.is_empty()
        || !unit.access.portals.is_empty()
    {
        return Err(
            "Planning entrance preparation requires a fresh structural unit without rooms, roof mesh or an existing access graph.".into(),
        );
    }
    let body_entry = structural_access(unit, paths, parameters)?;
    let site_entry = structural_site_entry(unit, parameters, &body_entry)?;
    let site_solids = solids_at_entry(unit, &site_entry);
    // structural_access rejects physical walls, but Posts/PartyWalls may be
    // retained features rather than Wall records. They must not be cut or
    // ignored by this planning certificate. Reuse the same solid union when
    // the body and site entrances share a walking level (all supported Strips).
    let body_level_solids =
        (body_entry.from_z_m != site_entry.from_z_m).then(|| solids_at_entry(unit, &body_entry));
    let body_solids = body_level_solids.as_ref().unwrap_or(&site_solids);
    if area(&intersection(&site_entry.passage, &site_solids)) > 0.0001
        || area(&intersection(&body_entry.passage, body_solids)) > 0.0001
    {
        return Err(
            "Native planning entrance passage intersects a structural support or an uncut wall."
                .into(),
        );
    }
    let mut alternatives = vec![];
    // The initial production scope is the same-level, unenclosed ground Strip.
    // A separate site gate/vertical route needs its own certificate pairing;
    // do not infer it from a root portal or reuse solids from another level.
    if same_entrance(&body_entry, &site_entry)
        && body_entry.from_z_m.is_finite()
        && body_entry.from_z_m == body_entry.to_z_m
        && !unit
            .features
            .iter()
            .any(|f| matches!(f.kind, FeatureKind::Enclosure | FeatureKind::Fence))
    {
        let mut portals: Vec<_> = unit
            .access
            .portals
            .iter()
            .filter(|portal| {
                (portal.from == unit.access.root || portal.to == unit.access.root)
                    && matches!(
                        portal.kind,
                        PortalKind::Door | PortalKind::Gate | PortalKind::Passage
                    )
                    && portal.from_z_m == body_entry.from_z_m
                    && portal.to_z_m == body_entry.to_z_m
                    && portal.width_m.is_finite()
                    && portal.width_m >= 0.8
                    && portal.opening != body_entry.opening
            })
            .collect();
        portals.sort_by(|a, b| a.id.cmp(&b.id));
        for portal in portals.into_iter().take(MAX_EXISTING_ENTRY_ALTERNATIVES) {
            let entry = StructuralEntrance {
                opening: portal.opening,
                passage: portal.passage.clone(),
                width_m: portal.width_m,
                from_z_m: portal.from_z_m,
                to_z_m: portal.to_z_m,
            };
            alternatives.push(PreparedEntrancePair {
                portal_id: portal.id.clone(),
                body_entry: entry.clone(),
                site_entry: entry,
            });
        }
    }
    Ok(PreparedPlanEntry {
        body_entry,
        site_entry,
        site_solids: Arc::new(site_solids),
        alternatives,
        retained_passages: vec![],
    })
}
