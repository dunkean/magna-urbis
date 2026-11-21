//! Project the finished graph into the index-based urban layout.

use std::collections::{BTreeSet, HashSet};

use magna_urbis_town::TownPlan;
use magna_urbis_town::blocks::{self, BlockSpec};
use magna_urbis_town::graph::{Clock, Edge, EdgeClass, EdgeId, FaceId, FaceKind, Graph, Key};

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
        streets: streets(graph, clock, &town_faces(plan), &plan.fords.iter().collect()),
        regional_road_result: plan.regional_road_result.clone(),
        blocks: Vec::new(),
        warnings: Vec::new(),
        enclosures: Vec::new(),
        phases: Vec::new(),
        archetype: config.site_archetype.clone(),
        structure: None,
        claim: Default::default(),
    };
    // The harbour's works as classic's streets (roles quay, mole, pier, landing): the graph's
    // quay edges are left out of `streets` for these.
    layout.streets.extend(plan.quays.iter().map(|q| Street {
        key: Some(key_string(&q.key)),
        path: q.path.clone(),
        widths: q.widths.clone(),
        rank: q.rank,
        role: q.role.into(),
    }));
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
        // A quarter rebuilt in its compact tissue with age is cut as a phase of its own: its
        // birth phase with the compact recipe and zone, holding its inhabitants and land.
        let slot = match &birth.aged {
            None => birth.phase,
            Some((recipe, zone)) => {
                let base = phases
                    .get(birth.phase)
                    .ok_or_else(|| format!("Unknown growth phase for {:?}", birth.key))?;
                let kind = format!("{}-aged", base.kind);
                match phases.iter().position(|p| p.kind == kind) {
                    Some(at) => at,
                    None => {
                        let aged = GrowthPhase {
                            kind,
                            recipe: recipe.clone(),
                            zone: zone.clone(),
                            population: 0.0,
                            target_area: 0.0,
                            ..base.clone()
                        };
                        phases.push(aged);
                        phases.len() - 1
                    }
                }
            }
        };
        if slot != birth.phase {
            let land: f64 = birth.faces.iter().filter_map(|&f| graph.outline(f)).map(|s| g::area(&s)).sum();
            let born = &mut phases[birth.phase];
            born.population = (born.population - birth.population).max(0.0);
            born.target_area = (born.target_area - land).max(0.0);
            let aged = &mut phases[slot];
            aged.population += birth.population;
            aged.target_area += land;
        }
        let phase = &mut phases[slot];
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
            phase: slot,
            zone: phase.zone.clone(),
        });
        // A quarter hanging on the harbour is a port district (design 6), by lineage.
        let role = if plan.port_quarters.contains(&birth.key) {
            "port"
        } else {
            ""
        };
        structure.districts.push(UrbanDistrict {
            id: quarter,
            center: 0,
            phase: slot,
            tissue: birth.tissue.clone(),
            quarters: vec![quarter],
            role: role.into(),
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
                    phase: Some(slot),
                    fill: Some(birth.fill_level),
                });
            }
        }
    }
    // The castle's bailey stands outside the housing budget: a reserve of the founding quarter.
    if let Some(bailey) = &plan.bailey
        && !layout.quarters.is_empty()
    {
        structure.reserve.push(bailey.clone());
        layout.blocks.push(Block {
            key: Some("bailey".into()),
            shape: bailey.clone(),
            quarter: 0,
            kind: "reserve:bailey".into(),
            axis: Point { x: 1.0, y: 0.0 },
            zone: layout.quarters[0].zone.clone(),
            phase: Some(layout.quarters[0].phase),
            fill: None,
        });
    }
    for phase in &mut phases {
        phase.shapes = g::union(&phase.shapes);
    }
    layout.phases = phases;
    layout.structure = Some(structure);
    Ok(layout)
}

/// The live faces of the town's quarters.
fn town_faces(plan: &TownPlan) -> HashSet<FaceId> {
    plan.quarters.iter().flat_map(|q| q.faces.iter().copied()).collect()
}

/// Whether an edge borders a quarter on both sides (`both`) or on at least one.
fn bordered(graph: &Graph, id: EdgeId, town: &HashSet<FaceId>, both: bool) -> bool {
    let sides = [graph.left_face(id), graph.right_face(id)].map(|f| town.contains(&f));
    if both { sides[0] && sides[1] } else { sides[0] || sides[1] }
}

fn streets(
    graph: &Graph,
    clock: Clock,
    town: &HashSet<FaceId>,
    fords: &HashSet<&Key>,
) -> Vec<Street> {
    let mut chains = BTreeSet::new();
    let mut loose = Vec::new();
    for id in graph.live_edges() {
        let edge = graph.edge(id);
        // A regional road runs on beyond the town, and a ring boundary may run between two
        // unopened faces: only their stretches along a quarter are streets. The harbour's
        // works are exported from the harbour itself.
        let kept = match edge.class.current() {
            EdgeClass::RegionalRoad | EdgeClass::Boundary => bordered(graph, id, town, false),
            EdgeClass::Quay => false,
            _ => true,
        };
        if !kept {
            continue;
        }
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
                .filter(|step| match graph.edge(step.edge).class.current() {
                    EdgeClass::RegionalRoad | EdgeClass::Boundary => {
                        bordered(graph, step.edge, town, false)
                    }
                    EdgeClass::Quay => false,
                    _ => true,
                })
                .filter_map(|step| {
                    let mut street = street(graph.edge(step.edge), clock, step.half.is_forward())?;
                    if fords.contains(&graph.edge(step.edge).stem) {
                        street.role = "ford".into();
                    }
                    // A boundary between two rings is an ordinary street; the outermost one,
                    // with open land beyond, is the town's peripheral street (classic's role),
                    // so that the lots of the last ring keep the access they were counted with.
                    if *graph.edge(step.edge).class.current() == EdgeClass::Boundary
                        && !bordered(graph, step.edge, town, true)
                    {
                        street.role = "peripheral".into();
                    }
                    Some(street)
                }),
        );
    }
    streets.extend(loose.into_iter().filter_map(|edge| {
        let mut street = street(edge, clock, true)?;
        if fords.contains(&edge.stem) {
            street.role = "ford".into();
        }
        if *edge.class.current() == EdgeClass::Boundary {
            let id = graph.edge_id(&edge.key)?;
            if !bordered(graph, id, town, true) {
                street.role = "peripheral".into();
            }
        }
        Some(street)
    }));
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
        // A regional alignment taken into a planned grid is one of its streets.
        EdgeClass::GridAxis => "street",
        EdgeClass::HarbourRoad => "port-road",
        EdgeClass::CastleRoad => "street",
        // A ring boundary along a quarter (the caller keeps only those) is a street.
        EdgeClass::Boundary => {
            return street_of(edge, clock, forward, 2, "street");
        }
        // The other edges delimit land and do not carry street traffic.
        EdgeClass::Wall | EdgeClass::Precinct | EdgeClass::Canal => {
            return None;
        }
    };
    street_of(edge, clock, forward, rank, role)
}

fn street_of(edge: &Edge, _clock: Clock, forward: bool, rank: usize, role: &str) -> Option<Street> {
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
