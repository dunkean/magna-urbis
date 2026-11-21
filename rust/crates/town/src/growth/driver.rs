//! The growth loop's state, and the one place where it applies events.
//!
//! Every event goes through [`Driver::event`]. A fresh run computes the event's operations and
//! hands them to the writer. A resumed run first walks the stopped town's journal: while
//! recorded events remain, the loop takes the same decisions it took then, and each event it
//! reaches is applied from the record instead of being recomputed (no street is laid again),
//! after checking that it falls at the same place and date. Counts, phases and ages are rebuilt
//! along the way exactly as the first run made them. Once the record is used up the loop goes on
//! computing, so resuming to a larger target continues the same ring from the same station.

use std::collections::{HashSet, VecDeque};

use magna_urbis_geom::{Point, area};
use magna_urbis_random::Rng;

use super::Capacity;
use super::count::QuarterRecord;
use crate::TownRequest;
use crate::armature::{self, Arm};
use crate::charter::{self, Charter, PhasePlan};
use crate::export::{DatedPhase, QuarterPlan, Stop, TownPlan, WallPlan};
use crate::graph::{Clock, Key, NodeId};
use crate::harbour::{self, FrontChoice, HarbourState};
use crate::journal::{Checkpoint, Cursor, Event, EventKind, Op, Writer};
use crate::spec::{FoundingFocusKind, GrowthSpec, TissueSpec};
use crate::survey::{CostField, CostPath, Survey};
use crate::tissue::organic::OrganicParams;
use crate::walls::{self, Castle, OpenSectors, Precinct};
use crate::water;

/// Cell size of the graph's spatial index in metres: about a block side.
const GRAPH_CELL: f64 = 32.0;

/// Whether growth goes on after a step.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) enum Step {
    Go,
    Stop,
}

pub(super) struct Driver<'a> {
    pub request: &'a TownRequest<'a>,
    pub capacity: &'a dyn Capacity,
    pub spec: &'a GrowthSpec,
    /// Survey centred on the founding focus.
    pub survey: Survey,
    pub charter: Charter,
    pub plan: PhasePlan,
    pub writer: Writer,
    /// Events of the stopped town not yet reached, oldest first, and their keys.
    recorded: VecDeque<Event>,
    pub recorded_keys: HashSet<Key>,
    /// Households at which growth stops.
    pub target: Clock,
    /// Households housed so far.
    pub clock: Clock,
    /// Position of the current phase in the plan.
    pub phase: usize,
    pub quarters: Vec<QuarterRecord>,
    /// The founding focus, once founded.
    pub focus: Option<NodeId>,
    pub arms: Vec<Arm>,
    pub cursor: Cursor,
    pub warnings: Vec<String>,
    /// The regional roads as plain lines, for the street field and the castle road.
    pub road_lines: Vec<Vec<Point>>,
    /// The cost field frozen at the start of the current ring (or at founding).
    pub frozen: Option<CostField>,
    /// Quarters opened in the current ring.
    pub opened_in_ring: usize,
    /// Rings in a row that opened nothing while a precinct was open.
    pub idle_rings: u32,
    /// The harbour front the town uses, and its harbour once opened.
    pub front: Option<FrontChoice>,
    pub harbour: Option<HarbourState>,
    /// The founding castle.
    pub castle: Option<Castle>,
    /// The town's circuits in survey order (citadels included, the castle apart).
    pub precincts: Vec<Precinct>,
    /// While the last precinct is open: the land its sectors open on.
    pub open_sectors: Option<OpenSectors>,
    /// Intramural households when the last wall was raised.
    pub inside_at_raise: f64,
}

impl<'a> Driver<'a> {
    /// Survey the site, resolve the charter and set up a run to `target`, replaying `from` first.
    pub(super) fn new(
        request: &'a TownRequest<'a>,
        capacity: &'a dyn Capacity,
        target: Clock,
        from: Option<&Checkpoint>,
    ) -> Result<Self, String> {
        let spec = &request.specs.growth;
        if !(spec.ring_step > 0.0 && spec.household_size > 0.0 && spec.reach > 0.0) {
            return Err("Invalid growth specification".into());
        }
        let site = &request.site;
        let first = Survey::from_request(request, spec.reach)?;
        let (charter, plan) = charter::found(request, &first)?;
        // A pinned site or an imposed radius keeps the requested centre; otherwise the rings
        // are measured from the founding focus.
        let at = if site.pinned || site.radius.is_some() {
            site.center
        } else {
            charter.focus.position
        };
        let survey = if at.distance(first.center()) < first.cell_size() * 0.5 {
            first
        } else {
            Survey::new(
                request.terrain,
                at,
                spec.reach,
                site.radius,
                request.neighbour_claims,
                &request.specs.survey,
            )?
        };
        // The harbour is decided once, on the survey the town grows on: on the front the
        // regional placement reserved, else the best the town can reach.
        let specs = request.specs;
        let front = match request.harbour_landing {
            Some(landing) => harbour::front_at_landing(
                &survey,
                charter.focus.position,
                landing,
                &specs.harbour.works,
            ),
            None => harbour::choose_front(&survey, &charter, &specs.harbour),
        };
        let road_lines: Vec<Vec<Point>> = request
            .regional_roads
            .iter()
            .map(|r| r.points.clone())
            .collect();
        let recorded: VecDeque<Event> = from
            .map(|c| c.journal.events.iter().cloned().collect())
            .unwrap_or_default();
        let recorded_keys = recorded.iter().map(|e| e.key.clone()).collect();
        let cell = from.map_or(GRAPH_CELL, |c| c.journal.cell);
        Ok(Self {
            request,
            capacity,
            spec,
            survey,
            charter,
            plan,
            writer: Writer::new(cell),
            recorded,
            recorded_keys,
            target,
            clock: Clock::ZERO,
            phase: 0,
            quarters: Vec::new(),
            focus: None,
            arms: Vec::new(),
            cursor: Cursor {
                ring: 0,
                last_station: None,
                cost_field_at: 0,
            },
            warnings: Vec::new(),
            road_lines,
            frozen: None,
            opened_in_ring: 0,
            idle_rings: 0,
            front,
            harbour: None,
            castle: None,
            precincts: Vec::new(),
            open_sectors: None,
            inside_at_raise: 0.0,
        })
    }

    /// Whether an event keyed `key` can be applied now: always on a fresh run; while a resumed
    /// run replays its record, only when it is the next recorded event. Callers that compute an
    /// expensive plan test this first.
    pub(super) fn may_apply(&self, key: &Key) -> bool {
        self.recorded.front().is_none_or(|e| &e.key == key)
    }

    /// The operations of `ops` the graph accepts, each tried on its own in order, at the clock.
    pub(super) fn accepted(&self, ops: Vec<Op>) -> Vec<Op> {
        let mut stage = self.writer.stage(self.clock);
        for op in ops {
            let _ = stage.try_push(vec![op]);
        }
        stage.into_ops()
    }

    /// Apply an event of `kind` at the current clock and return its position in the journal.
    /// While recorded events remain, the next one must be this event (else the first run did
    /// not apply it, and neither does this one); otherwise `compute` proposes the operations,
    /// and an event it has none for is not applied.
    pub(super) fn event(
        &mut self,
        kind: EventKind,
        compute: impl FnOnce(&Self, Clock) -> Option<Vec<Op>>,
    ) -> Result<Option<usize>, String> {
        let key = kind.key();
        if let Some(front) = self.recorded.front() {
            if front.key != key {
                return Ok(None);
            }
            let event = self.recorded.pop_front().expect("front event");
            self.recorded_keys.remove(&key);
            if event.clock != self.clock {
                return Err(format!(
                    "Resume diverged at {key:?}: recorded at {}, reached at {}",
                    event.clock.0, self.clock.0
                ));
            }
            return self
                .writer
                .apply(event.clock, event.kind, event.ops)
                .map(Some)
                .map_err(|e| format!("Resume failed at {key:?}: {e}"));
        }
        let Some(ops) = compute(&*self, self.clock) else {
            return Ok(None);
        };
        self.writer
            .apply(self.clock, kind, ops)
            .map(Some)
            .map_err(|e| format!("Event {key:?} refused: {e}"))
    }

    /// `Found`: regional roads, the castle and its road when the focus is a strong point, the
    /// founding focus, and the harbour road to a distant front; then the main axes are planned
    /// from the focus, and an enclosed charter surveys its founding precinct. The founding stage
    /// is computed on a resumed run too, so that the castle and the harbour road are known; the
    /// recorded operations are the ones applied.
    pub(super) fn found(&mut self) -> Result<(), String> {
        let centre = self.survey.center();
        let kind = EventKind::Found {
            center: centre,
            focus: focus_name(self.charter.focus.kind).into(),
        };
        let event = kind.key();
        let specs = self.request.specs;
        let mut stage = self.writer.stage(self.clock);
        armature::fate::import_regional_roads(
            &mut stage,
            &event,
            self.request.regional_roads,
            centre,
            self.spec.reach,
            self.spec.regional_road_width,
        );
        let mut focus_at = centre;
        if self.charter.focus.kind == FoundingFocusKind::StrongPoint
            && let Some(point) = self.survey.strong_points().first()
            && let Some((castle, warnings)) = walls::found_castle(
                &mut stage,
                &self.survey,
                self.request.terrain,
                point,
                f64::from(self.charter.founding_cohort),
                &self.road_lines,
                specs.survey.lane_grade,
                &specs.precinct,
            )
        {
            focus_at = castle.foot;
            self.warnings.extend(warnings);
            self.castle = Some(castle);
        }
        armature::place_focus(&mut stage, focus_at);
        if let Some(front) = self.front.clone().filter(|f| !f.at_focus) {
            let laid = armature::focus_node(stage.graph(), focus_at).and_then(|n| {
                let focus_key = stage.graph().node(n).key.clone();
                let path = harbour::harbour_road(&self.survey, focus_at, &front, &specs.harbour)?;
                harbour::lay_harbour_road(&mut stage, &event, &path, &focus_key, &specs.harbour)
            });
            if laid.is_none() {
                self.front = None;
                self.warnings
                    .push("No harbour — no road (Pas de port — pas de route)".into());
            }
        }
        let ops = stage.into_ops();
        if self.event(kind, |_, _| Some(ops))?.is_none() {
            return Err("The founding was not applied".into());
        }
        let graph = self.writer.graph();
        let focus = armature::focus_node(graph, focus_at).ok_or("The founding placed no focus")?;
        let params = self.organic(0);
        self.arms = armature::plan_arms(
            graph,
            focus,
            &self.road_lines,
            self.request.terrain,
            &self.survey,
            &params,
            self.spec.nucleus_radius,
            &event,
            Rng::new(self.request.seed).fork("armature"),
        );
        self.focus = Some(focus);
        self.frozen = Some(self.cost_field());
        self.found_precinct()
    }

    /// The tissue quarters born in `phase` are laid with: the charter's founding tissue in the
    /// founding phase, the phase's own afterwards.
    pub(super) fn tissue(&self, phase: usize) -> (String, Option<&'a TissueSpec>) {
        let id = if phase == 0 {
            self.charter.founding_tissue_id.clone()
        } else {
            self.plan.phases[phase].spec.tissue_id.clone()
        };
        let spec = self.request.specs.tissues.iter().find(|t| t.id == id);
        (id, spec)
    }

    /// The organic street morphology of the tissue of `phase`; classic's defaults when the
    /// tissue gives none.
    pub(super) fn organic(&self, phase: usize) -> OrganicParams {
        self.tissue(phase)
            .1
            .and_then(|t| t.organic.clone())
            .unwrap_or_default()
    }

    /// The tissue a quarter born now in `phase` is laid with: inside an open precinct the
    /// phase's compact tissue (the charter's founding tissue in the founding phase, compact
    /// already for an enclosed town), elsewhere the phase's own.
    pub(super) fn birth_tissue(&self, phase: usize) -> (String, Option<&'a TissueSpec>) {
        if self.open_sectors.is_none() || phase == 0 {
            return self.tissue(phase);
        }
        let id = self.plan.phases[phase].spec.compact_tissue_id.clone();
        let spec = self.request.specs.tissues.iter().find(|t| t.id == id);
        (id, spec)
    }

    /// The organic street morphology of `birth_tissue`.
    pub(super) fn birth_organic(&self, phase: usize) -> OrganicParams {
        self.birth_tissue(phase)
            .1
            .and_then(|t| t.organic.clone())
            .unwrap_or_default()
    }

    /// Position of the founding focus.
    pub(super) fn focus_position(&self) -> Point {
        self.focus.map_or(self.survey.center(), |f| {
            self.writer.graph().node(f).position
        })
    }

    /// The cost field over the graph as it stands: open ground, cheaper along the armature, the
    /// harbour road and quay and across the water crossings, and lowered around the harbour's
    /// front so that the town grows towards it.
    pub(super) fn cost_field(&self) -> CostField {
        let graph = self.writer.graph();
        let specs = self.request.specs;
        let mut lines = armature::cost_lines(graph, self.spec, &self.arms);
        lines.extend(harbour::cost_lines(graph, self.spec));
        lines.extend(water::cost_lines(
            graph,
            self.writer.journal(),
            self.spec,
            &specs.crossing,
        ));
        let paths: Vec<CostPath<'_>> = lines
            .iter()
            .map(|line| CostPath {
                points: &line.points,
                multiplier: line.multiplier,
                allow_crossings: line.crossings,
            })
            .collect();
        match &self.front {
            Some(front) => {
                // The discount falls off at the field's cheapest multiplier, so the discounted
                // land stays connected to the centre.
                let slope = self.spec.regional_road_cost.min(self.spec.axis_cost);
                let discount = harbour::front_discount(front, &specs.harbour, slope);
                self.survey.recompute_costs_with(&paths, &|p| discount.at(p))
            }
            None => self.survey.recompute_costs(&paths),
        }
    }

    /// Whether the target is housed.
    pub(super) fn reached(&self) -> bool {
        self.clock >= self.target
    }

    /// Promote the town through every phase whose threshold the housed population has crossed.
    pub(super) fn promote(&mut self) -> Result<(), String> {
        loop {
            let inhabitants = (self.clock.households() * self.spec.household_size).floor();
            let housed = inhabitants.min(f64::from(u32::MAX)) as u32;
            let Some(next) = self.plan.promotion_after(self.phase, housed) else {
                return Ok(());
            };
            let phase = self.phase + 1;
            let kind = EventKind::Promote {
                phase: phase as u32,
                name: next.spec.name.clone(),
            };
            self.event(kind, |_, _| Some(Vec::new()))?;
            self.phase = phase;
        }
    }

    /// The stopped town.
    pub(super) fn finish(mut self) -> TownPlan {
        self.tissue_warnings();
        let graph = self.writer.graph();
        let quarters: Vec<QuarterPlan> = self
            .quarters
            .iter()
            .map(|q| QuarterPlan {
                key: q.key.clone(),
                phase: q.phase,
                tissue: q.tissue.clone(),
                faces: q
                    .faces
                    .iter()
                    .filter_map(|k| graph.face_id(k))
                    .filter(|&f| graph.face(f).life.live())
                    .collect(),
                fill_level: q.fill(),
                population: q.housed().households() * self.spec.household_size,
                aged: q
                    .compact()
                    .then(|| {
                        let id = &self.plan.phases[q.phase].spec.compact_tissue_id;
                        self.request.specs.tissues.iter().find(|t| &t.id == id)
                    })
                    .flatten()
                    .map(|t| (t.recipe.clone(), t.zone.clone())),
            })
            .collect();
        let phases = (0..=self.phase)
            .map(|k| self.dated_phase(k, &quarters))
            .collect();
        let checkpoint = self.writer.checkpoint(self.cursor.clone());
        let focus = self.focus_position();
        let roads = armature::fate::road_result(graph);
        let (quays, port_quarters) = match &self.harbour {
            Some(state) => (
                harbour::export_quays(graph, state),
                harbour::port_quarters(graph, &self.quarters, state),
            ),
            None => (Vec::new(), Vec::new()),
        };
        let household_size = self.spec.household_size;
        let at_stop = walls::inhabitants(self.clock, household_size);
        let walls: Vec<WallPlan> = self
            .castle
            .iter()
            .map(|c| &c.precinct)
            .chain(&self.precincts)
            .map(|p| WallPlan {
                population: p
                    .raised
                    .map_or(at_stop, |at| walls::inhabitants(at, household_size).max(1)),
                precinct: p.clone(),
            })
            .collect();
        let mut fords: Vec<Key> = water::ford_stems(self.writer.journal()).into_iter().collect();
        fords.sort();
        let bailey = self.castle.as_ref().map(|c| c.outline.clone());
        TownPlan {
            clock: self.clock,
            center: self.charter.center,
            focus,
            phases,
            quarters,
            regional_road_result: (!roads.is_empty()).then_some(roads),
            walls,
            quays,
            port_quarters,
            fords,
            bailey,
            warnings: self.warnings,
            stop: Stop {
                checkpoint,
                target: self.target,
                phase: self.phase,
                records: self.quarters,
            },
            graph: self.writer.into_graph(),
        }
    }

    /// Phase `k` as the layout reads it: its date, its tissue's recipe and zone, and the
    /// inhabitants and land of the quarters born in it.
    fn dated_phase(&self, k: usize, quarters: &[QuarterPlan]) -> DatedPhase {
        let born = self
            .writer
            .journal()
            .events
            .iter()
            .find(|e| matches!(&e.kind, EventKind::Promote { phase, .. } if *phase as usize == k))
            .map_or(Clock::ZERO, |e| e.clock);
        let (_, tissue) = self.tissue(k);
        let graph = self.writer.graph();
        let (mut population, mut target_area) = (0.0, 0.0);
        for (record, plan) in self.quarters.iter().zip(quarters) {
            if record.phase != k {
                continue;
            }
            population += record.housed().households() * self.spec.household_size;
            target_area += plan
                .faces
                .iter()
                .filter_map(|&f| graph.outline(f))
                .map(|s| area(&s))
                .sum::<f64>();
        }
        DatedPhase {
            born,
            kind: self.plan.phases[k].spec.name.clone(),
            recipe: tissue.map_or_else(String::new, |t| t.recipe.clone()),
            zone: tissue.map_or_else(String::new, |t| t.zone.clone()),
            population,
            target_area,
        }
    }

    /// One line per tissue that is not organic or not in the specs: its quarters were laid with
    /// organic streets.
    fn tissue_warnings(&mut self) {
        let mut seen: Vec<&str> = Vec::new();
        for quarter in &self.quarters {
            if seen.contains(&quarter.tissue.as_str()) {
                continue;
            }
            seen.push(&quarter.tissue);
            let spec = self
                .request
                .specs
                .tissues
                .iter()
                .find(|t| t.id == quarter.tissue);
            let line = match spec {
                None => format!(
                    "Tissue {} missing: organic streets (Tissu {} absent : rues organiques)",
                    quarter.tissue, quarter.tissue
                ),
                Some(t) if t.pattern != "organic" => format!(
                    "Tissue {} not available yet: organic streets (Tissu {} pas encore disponible : rues organiques)",
                    t.pattern, t.pattern
                ),
                Some(_) => continue,
            };
            self.warnings.push(line);
        }
    }
}

/// The founding focus as the `Found` event names it.
fn focus_name(kind: FoundingFocusKind) -> &'static str {
    match kind {
        FoundingFocusKind::Site => "site",
        FoundingFocusKind::RoadCrossing => "road-crossing",
        FoundingFocusKind::Ford => "ford",
        FoundingFocusKind::Bridge => "bridge",
        FoundingFocusKind::HarbourFront => "harbour-front",
        FoundingFocusKind::StrongPoint => "strong-point",
        FoundingFocusKind::PlannedFrame => "planned-frame",
    }
}
