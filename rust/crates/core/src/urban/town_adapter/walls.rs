//! The growth town's raised circuits as classic's enclosures, with their works built by classic's
//! `fortification::build` from the inputs the growth engine reads off each circuit; the blocks
//! then give up the works' land before any lot is cut.

use magna_urbis_town::TownPlan;
use magna_urbis_town::graph::EdgeClass;
use magna_urbis_town::walls::{WorksContext, works_inputs};

use super::super::{
    Enclosure, Layout, LayoutConfig, Surface, culture, fortification, geometry as g, network,
    resolve,
};
use crate::rng::Rng;

/// Pieces of a block smaller than this (square metres) are dropped when the works cut it.
const MIN_PIECE: f64 = 20.0;

/// Add an enclosure for every raised circuit of `plan`, cut the blocks to their reserve, and end
/// the streets that cross a curtain away from its gates.
pub(super) fn enclose(
    plan: &TownPlan,
    layout: &mut Layout,
    config: &LayoutConfig,
    surface: Surface<'_>,
) {
    let raised: Vec<_> = plan
        .walls
        .iter()
        .filter(|w| w.precinct.raised.is_some() && standing(plan, &w.precinct))
        .collect();
    if raised.is_empty() {
        return;
    }
    let population = raised.iter().map(|w| w.population).max().unwrap_or(0);
    let context = works_context(layout, config, population);
    for wall in raised {
        let inputs = works_inputs(&plan.graph, &wall.precinct, &surface, wall.population, &context);
        if inputs.path.len() < 4 {
            continue;
        }
        let key: Vec<String> = inputs.event.parts().iter().map(u32::to_string).collect();
        let rng = Rng::new(&layout.key).fork(&format!("growth-circuit:{}", key.join(".")));
        let mut e = Enclosure {
            path: inputs.path.clone(),
            kind: inputs.kind.into(),
            gates: inputs.gates.clone(),
            purpose: inputs.purpose.into(),
            ..Enclosure::default()
        };
        // The growth engine chose the style with the trace: it is forced here when the kind
        // admits it.
        let mut style = fortification::resolve(
            inputs.kind,
            &fortification::Inputs {
                culture: &layout.culture,
                pop: inputs.population,
                period: &config.programme.period,
                state: &config.programme.state,
                archetype: &layout.archetype,
                forced: &inputs.style,
                relief: 0.0,
            },
            &rng,
            &mut Vec::new(),
        );
        style.options(config);
        // Access lanes added this late would change the road network.
        style.attached = 0.0;
        let predicted = fortification::Predicted {
            widths: inputs.predicted_widths,
            arterial: usize::from(inputs.arterial),
            dwelling: inputs.dwelling,
        };
        let lanes = fortification::build(
            &mut e,
            inputs.land,
            &inputs.banks,
            &layout.streets,
            surface,
            &style,
            inputs.population,
            &predicted,
            &rng,
        );
        layout.streets.extend(lanes);
        layout.enclosures.push(e);
    }
    fortification::enforce(layout, surface);
    yield_works(layout);
}

/// Street widths and dwelling dimensions the works are cut for, as classic predicts them.
fn works_context(layout: &Layout, config: &LayoutConfig, population: u32) -> WorksContext {
    let morph = resolve(
        &layout.culture,
        &config.preset,
        &config.recipe,
        "core",
        config.density,
        &config.params,
        "quarters",
    )
    .ok();
    let base: [f64; 5] = std::array::from_fn(|r| {
        morph.as_ref().map_or(3.0, |m| {
            m.value["widthByRank"][r].as_f64().unwrap_or(3.0) * m.number_or("widthScale", 1.0)
        })
    });
    WorksContext {
        rank_widths: network::rank_widths(base, population, config.road_width_by_size),
        arterial: if population >= 20_000 { 0 } else { 1 },
        dwelling: culture::mapping_for(&layout.culture, &config.programme.period)
            .map_or([5.0, 5.0], |m| {
                [m.admissibility.min_frontage, m.admissibility.min_depth]
            }),
    }
}

/// The blocks give up the land of every enclosure's reserve (curtain, towers, gatehouses,
/// ditch, glacis); a block cut in several pieces keeps each piece of some size.
fn yield_works(layout: &mut Layout) {
    let reserve: Vec<_> = layout
        .enclosures
        .iter()
        .flat_map(|e| e.reserve.iter())
        .map(|s| (s.clone(), g::bbox(s)))
        .collect();
    if reserve.is_empty() {
        return;
    }
    let overlaps = |a: (f64, f64, f64, f64), b: (f64, f64, f64, f64)| {
        a.0 <= b.2 && a.2 >= b.0 && a.1 <= b.3 && a.3 >= b.1
    };
    let mut blocks = Vec::with_capacity(layout.blocks.len());
    for block in std::mem::take(&mut layout.blocks) {
        let bb = g::bbox(&block.shape);
        if block.kind != "block" || !reserve.iter().any(|(_, rb)| overlaps(bb, *rb)) {
            blocks.push(block);
            continue;
        }
        let mut pieces = vec![block.shape.clone()];
        for (r, rb) in &reserve {
            if !overlaps(bb, *rb) {
                continue;
            }
            pieces = pieces
                .into_iter()
                .flat_map(|s| g::difference(&s, r))
                .collect();
        }
        for (k, shape) in pieces
            .into_iter()
            .filter(|s| g::area(s) >= MIN_PIECE)
            .enumerate()
        {
            let key = match (&block.key, k) {
                (Some(key), 0) => Some(key.clone()),
                (Some(key), k) => Some(format!("{key}.{k}")),
                (None, _) => None,
            };
            blocks.push(super::super::Block {
                key,
                shape,
                ..block.clone()
            });
        }
    }
    layout.blocks = blocks;
}

/// Whether a raised circuit still stands at the stop: an old line the fossil rule removed or
/// turned into a boulevard keeps its record but no longer carries a wall. A lobe's line keeps its
/// own stretch only, the shared one being the old circuit's.
fn standing(plan: &TownPlan, precinct: &magna_urbis_town::walls::Precinct) -> bool {
    let graph = &plan.graph;
    let wall: f64 = graph
        .faces_along_chain(&precinct.chain)
        .iter()
        .map(|s| graph.edge(s.edge))
        .filter(|e| e.life.live() && *e.class.current() == EdgeClass::Wall)
        .map(|e| e.polyline.windows(2).map(|w| w[0].distance(w[1])).sum::<f64>())
        .sum();
    let ring = &precinct.outline.outer;
    let perimeter: f64 = (0..ring.len()).map(|i| ring[i].distance(ring[(i + 1) % ring.len()])).sum();
    wall >= STANDING_SHARE * perimeter
}

/// Share of a circuit's perimeter that must still carry a wall for it to be exported.
const STANDING_SHARE: f64 = 0.25;
