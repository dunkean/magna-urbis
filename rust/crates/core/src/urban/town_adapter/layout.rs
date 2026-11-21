//! Project the finished graph into the index-based urban layout.

use std::collections::BTreeSet;

use magna_urbis_town::TownPlan;
use magna_urbis_town::blocks::{self, BlockSpec};
use magna_urbis_town::graph::{Clock, Edge, EdgeClass, FaceKind, Graph, Key};

use super::super::{
    Block, GrowthPhase, Layout, LayoutConfig, Point, Quarter, Site, Street, UrbanCenter,
    UrbanDistrict, UrbanMetrics, UrbanStructure, geometry as g, parcels,
};

pub(super) fn build(
    plan: &TownPlan,
    site: &Site,
    config: &LayoutConfig,
    culture: &str,
) -> Result<Layout, String> {
    let graph = &plan.graph;
    let clock = plan.clock;
    let mut phases: Vec<_> = plan
        .phases
        .iter()
        .map(|phase| GrowthPhase {
            culture: culture.into(),
            kind: phase.kind.clone(),
            zone: phase.zone.clone(),
            recipe: phase.recipe.clone(),
            population: phase.population,
            target_area: phase.target_area,
            shapes: Vec::new(),
        })
        .collect();
    let mut layout = Layout {
        config: Some(config.clone()),
        programme: None,
        key: site.key.clone(),
        culture: culture.into(),
        center: plan.center,
        quarters: Vec::with_capacity(plan.quarters.len()),
        streets: streets(graph, clock),
        blocks: Vec::new(),
        warnings: Vec::new(),
        enclosures: Vec::new(),
        phases: Vec::new(),
        archetype: config.site_archetype.clone(),
        structure: None,
        claim: Default::default(),
    };
    let index = parcels::FrontageIndex::new(&layout);
    let spec = BlockSpec::default();
    let mut structure = UrbanStructure {
        version: 1,
        mechanism: "growth".into(),
        family: plan
            .quarters
            .first()
            .map_or(config.tissue.as_str(), |q| q.tissue.as_str())
            .into(),
        centers: vec![UrbanCenter {
            id: 0,
            point: plan.focus,
            weight: 1.0,
        }],
        metrics: UrbanMetrics {
            planned_population: f64::from(site.population),
            target_area: phases.iter().map(|p| p.target_area).sum(),
            ..UrbanMetrics::default()
        },
        ..UrbanStructure::default()
    };
    for birth in &plan.quarters {
        let phase = phases
            .get_mut(birth.phase)
            .ok_or_else(|| format!("Unknown growth phase for {:?}", birth.key))?;
        let key = key_string(&birth.key);
        let mut faces = birth.faces.clone();
        faces.retain(|&id| graph.face(id).life.live() && graph.face(id).life.alive_at(clock));
        faces.sort_by(|&a, &b| graph.face(a).key.cmp(&graph.face(b).key));
        let outlines: Vec<_> = faces.iter().filter_map(|&id| graph.outline(id)).collect();
        let mut shapes = g::union(&outlines);
        if shapes.len() != 1 {
            return Err(format!("Growth quarter {key} has no single outline"));
        }
        let shape = shapes.pop().unwrap();
        phase.shapes.push(shape.clone());
        let quarter = layout.quarters.len();
        layout.quarters.push(Quarter {
            key: Some(key),
            shape,
            phase: birth.phase,
            zone: phase.zone.clone(),
        });
        structure.districts.push(UrbanDistrict {
            id: quarter,
            center: 0,
            phase: birth.phase,
            tissue: birth.tissue.clone(),
            quarters: vec![quarter],
            role: String::new(),
            wealth: 0.5,
            label: String::new(),
        });
        for id in faces {
            let face = graph.face(id);
            let kind = match face.kind.at(clock).unwrap_or(face.kind.current()) {
                FaceKind::Block => "block",
                FaceKind::Plaza => "reserve:plaza",
                FaceKind::Reserve => "reserve:open",
                FaceKind::Works => "reserve:works",
                FaceKind::Apron => "reserve:apron",
                FaceKind::Common => "reserve:common",
                FaceKind::Bailey => "reserve:bailey",
                FaceKind::Unbuilt => "reserve:unbuilt",
            };
            let key = key_string(&face.key);
            for shape in blocks::from_graph(graph, id, clock, &spec) {
                let fronts = parcels::block_contacts_indexed(&shape, &layout, &index);
                let axis = frontage_axis(fronts.into_iter().map(|c| [c.a, c.b]));
                if kind != "block" {
                    structure.reserve.push(shape.clone());
                }
                layout.blocks.push(Block {
                    key: Some(key.clone()),
                    shape,
                    quarter,
                    kind: kind.into(),
                    axis,
                    zone: phase.zone.clone(),
                    phase: Some(birth.phase),
                    fill: Some(birth.fill_level),
                });
            }
        }
    }
    for phase in &mut phases {
        phase.shapes = g::union(&phase.shapes);
    }
    layout.phases = phases;
    layout.structure = Some(structure);
    Ok(layout)
}

fn streets(graph: &Graph, clock: Clock) -> Vec<Street> {
    let mut chains = BTreeSet::new();
    let mut loose = Vec::new();
    for id in graph.live_edges() {
        let edge = graph.edge(id);
        if let Some(chain) = &edge.chain {
            chains.insert(chain);
        } else {
            loose.push(edge);
        }
    }
    loose.sort_by(|a, b| a.key.cmp(&b.key));
    let mut streets = Vec::new();
    for chain in chains {
        streets.extend(
            graph
                .faces_along_chain(chain)
                .into_iter()
                .filter_map(|step| street(graph.edge(step.edge), clock, step.half.is_forward())),
        );
    }
    streets.extend(
        loose
            .into_iter()
            .filter_map(|edge| street(edge, clock, true)),
    );
    streets
}

fn street(edge: &Edge, clock: Clock, forward: bool) -> Option<Street> {
    if !edge.life.alive_at(clock) {
        return None;
    }
    let rank = usize::from(*edge.rank.at(clock)?);
    let role = match edge.class.at(clock)? {
        EdgeClass::Street if rank >= 3 => "lane",
        EdgeClass::Street => "street",
        EdgeClass::Lane => "lane",
        EdgeClass::Stairs => "stairs",
        EdgeClass::Quay => "quay",
        EdgeClass::Bridge => "bridge",
        EdgeClass::RegionalRoad => "regional",
        EdgeClass::HarbourRoad => "port-road",
        EdgeClass::CastleRoad => "street",
        // The other edges delimit land and do not carry street traffic.
        EdgeClass::Boundary | EdgeClass::Wall | EdgeClass::Precinct | EdgeClass::Canal => {
            return None;
        }
    };
    let mut path = edge.polyline.clone();
    let mut widths = edge.widths.clone();
    if !forward {
        path.reverse();
        widths.reverse();
    }
    Some(Street {
        key: Some(key_string(&edge.key)),
        path,
        widths,
        rank,
        role: role.into(),
    })
}

fn key_string(key: &Key) -> String {
    key.parts()
        .iter()
        .map(u32::to_string)
        .collect::<Vec<_>>()
        .join(".")
}

pub(super) fn frontage_axis(edges: impl IntoIterator<Item = [Point; 2]>) -> Point {
    edges
        .into_iter()
        .map(|[a, b]| (a.distance(b), a, b))
        .filter(|&(length, _, _)| length > 0.0)
        .max_by(|a, b| a.0.total_cmp(&b.0))
        .map_or(Point { x: 1.0, y: 0.0 }, |(length, a, b)| Point {
            x: (b.x - a.x) / length,
            y: (b.y - a.y) / length,
        })
}
