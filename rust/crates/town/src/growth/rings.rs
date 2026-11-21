//! The ring loop: armature, quarters in station order, count, ageing, dated events, stop.

use std::collections::HashSet;

use magna_urbis_geom::{self as g, Point, Shape};
use magna_urbis_random::Rng;

use super::commit::quarter_ops;
use super::contour::{Land, Lattice};
use super::count::{self, Birth, QuarterRecord};
use super::driver::{Driver, Step};
use super::par;
use super::sectors::{self, Sector};
use crate::armature::{self, BoundaryArc, Draw, chain_ops};
use crate::graph::{Clock, EdgeClass, FaceId, FaceKind, Graph, Key, Level};
use crate::journal::{Cursor, EventKind, Op, QuarterDraft, event_stream};
use crate::survey::QuarterSlope;
use crate::tissue::organic::{self, OrganicParams, OrganicSite};
use crate::tissue::stairs;
use crate::walls::{self, Precinct};
use crate::water;

/// Rank of boundary edges: below every street.
const BOUNDARY_RANK: u8 = 4;
/// Fill steps an intramural quarter gains per ring, one more than the others.
const INTRAMURAL_STEPS: usize = 2;
/// Rings in a row that may open nothing in an open precinct before it is raised as it stands.
const IDLE_RINGS: u32 = 2;

/// Extra cost levels, in survey cells above a ring's level, tried when its outline cannot be
/// drawn against the graph.
const LEVEL_TRIES: [f64; 4] = [0.0, 0.37, 0.71, 1.13];

/// Whether growth laps are printed (`URBAN_PROFILE`, as the classic stages).
fn profiled() -> bool {
    std::env::var_os("URBAN_PROFILE").is_some()
}

/// How a ring ended.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum RingEnd {
    /// Its quarters opened and older quarters aged.
    Opened,
    /// No quarter opened, but land remains beyond its level.
    Empty,
    /// No quarter opened and no land remains: growth goes on by ageing only.
    Exhausted,
    /// The target was housed.
    Stopped,
}

impl Driver<'_> {
    /// Grow from founding until the target is housed or the land and the fill steps run out.
    pub(super) fn grow(&mut self) -> Result<(), String> {
        self.found()?;
        self.cursor = Cursor {
            ring: 0,
            last_station: None,
            cost_field_at: self.writer.journal().events.len(),
        };
        if self.reached() {
            return Ok(());
        }
        for ring in 0..self.spec.max_rings {
            match self.ring(ring)? {
                RingEnd::Stopped => return Ok(()),
                RingEnd::Opened | RingEnd::Empty => {}
                RingEnd::Exhausted => break,
            }
        }
        if self.age_out()? == Step::Stop {
            return Ok(());
        }
        let share = (self.clock.0 as f64 / self.target.0.max(1) as f64 * 100.0).floor();
        self.warnings.push(format!(
            "Out of land: {share} % housed (Plus de terrain : {share} % logés)"
        ));
        Ok(())
    }

    /// One ring: freeze the cost field, extend the armature and draw the boundary, open the
    /// sectors as quarters in station order and age the older quarters; then the ring's dated
    /// events (precinct surveys, a precinct that can open nothing more raised as it stands) and
    /// its water crossing.
    fn ring(&mut self, ring: u32) -> Result<RingEnd, String> {
        let level = f64::from(ring + 1) * self.spec.ring_step;
        let costs = self.cost_field();
        let lattice = Lattice::new(&self.survey, &costs);
        self.frozen = Some(costs);
        self.opened_in_ring = 0;
        let end = self.ring_quarters(ring, &lattice, level)?;
        if end == RingEnd::Stopped {
            return Ok(end);
        }
        let idle = self.open_sectors.is_some() && self.opened_in_ring == 0;
        self.idle_rings = if idle { self.idle_rings + 1 } else { 0 };
        self.dated_events(true, self.idle_rings >= IDLE_RINGS)?;
        let crossed = self.water_step(level)?;
        // A crossing opens a far bank: the next ring grows there instead of ageing out.
        Ok(if crossed && end == RingEnd::Exhausted {
            RingEnd::Empty
        } else {
            end
        })
    }

    /// The ring's armature, quarters and ageing.
    fn ring_quarters(&mut self, ring: u32, lattice: &Lattice, level: f64) -> Result<RingEnd, String> {
        let started = std::time::Instant::now();
        let seeds = water::far_landings(self.writer.graph(), self.writer.journal());
        // The ring's land at its level, then at a few slightly higher levels: when the outline
        // of one meets the graph too closely to be drawn (two crossings closer than the minimum
        // gap), the next, a few metres out, usually does not.
        let land = lattice.land(level, &seeds);
        // No land below the level is not the end of the site: on a steep flank the first rings
        // hold too little to be drawn; only a closed centre or land that holds every reachable
        // cell ends the rings.
        let whole = match &land {
            Some(l) => l.whole,
            None => !lattice.centre_open(),
        };
        let prepared = started.elapsed();
        let ended = if whole {
            RingEnd::Exhausted
        } else {
            RingEnd::Empty
        };
        self.cursor = Cursor {
            ring,
            last_station: None,
            cost_field_at: self.writer.journal().events.len(),
        };
        let kind = EventKind::ExtendArmature { ring };
        let event = kind.key();
        let applied =
            self.event(kind, |d, at| d.extension(&event, lattice, &seeds, level, at))?;
        let trace = |what: &str, sectors: usize, d: &Self| {
            if profiled() {
                eprintln!(
                    "  growth.ring {ring} level={level:.0} land={} centre={} whole={whole} {what} sectors={sectors} quarters={} clock={:.0}/{:.0} prepare={} ms total={} ms",
                    land.is_some(),
                    lattice.centre_open(),
                    d.quarters.len(),
                    d.clock.households(),
                    d.target.households(),
                    prepared.as_millis(),
                    started.elapsed().as_millis()
                );
            }
        };
        let Some(index) = applied else {
            trace("no-arc", 0, self);
            return Ok(ended);
        };
        let extra = self.precinct_faces(level);
        let graph = self.writer.graph();
        let Some(costs) = self.frozen.as_ref() else {
            return Ok(ended);
        };
        let sectors =
            sectors::of_ring(graph, &self.writer.journal().events[index].ops, costs, &extra);
        if sectors.is_empty() {
            trace("no-sector", 0, self);
            return Ok(ended);
        }
        // The lines orienting the street field, frozen with the ring's outlines.
        let field = armature::field_lines(graph, &self.arms);
        let step = self.open(ring, &sectors, &field, level)?;
        let step = if step == Step::Stop {
            Step::Stop
        } else {
            self.age_ring(ring)?
        };
        trace("opened", sectors.len(), self);
        if step == Step::Stop {
            return Ok(RingEnd::Stopped);
        }
        Ok(RingEnd::Opened)
    }

    /// The operations of a ring's `ExtendArmature` event: its boundary arcs, then each axis
    /// prolonged across it, then a gate wherever an axis now crosses a circuit. `None` when no
    /// arc can be drawn and no precinct is open (an open precinct's land may be reached without
    /// an arc, its wall street bounding it already).
    fn extension(
        &self,
        event: &Key,
        lattice: &Lattice,
        seeds: &[Point],
        level: f64,
        at: Clock,
    ) -> Option<Vec<Op>> {
        let mut stage = self.writer.stage(at);
        let mut rank = 0;
        let mut arcs = HashSet::new();
        let params = self.organic(self.phase);
        // A boundary turns into the street between two rings once the next ring opens: it is
        // drawn with a street's width so the blocks on both sides keep their frontage.
        let width = params.width_by_rank[2] * params.width_scale;
        let drawn = LEVEL_TRIES
            .iter()
            .filter_map(|&t| lattice.land(level + t * self.survey.cell_size(), seeds))
            .map(|land| self.ring_arcs(stage.graph(), &land))
            .find(|arcs| !arcs.is_empty())
            .unwrap_or_default();
        for arc in drawn {
            let draw = Draw {
                event,
                next_rank: &mut rank,
                chain: None,
                class: EdgeClass::Boundary,
                rank: BOUNDARY_RANK,
                width,
            };
            let (ops, chain) = chain_ops(draw, &arc.path, arc.start, arc.end, &arc.hits);
            if stage.try_push(ops).is_ok() {
                arcs.insert(chain);
            }
        }
        if arcs.is_empty() {
            return self.open_sectors.is_some().then(|| stage.into_ops());
        }
        let focus = self.focus?;
        let reach = 4.0 * (self.spec.ring_step + self.survey.cell_size());
        armature::extend(
            &mut stage,
            event,
            &mut rank,
            &self.arms,
            focus,
            &arcs,
            &self.survey,
            self.request.terrain,
            params.max_street_grade,
            reach,
        );
        let circuits: Vec<&Precinct> = self
            .precincts
            .iter()
            .chain(self.castle.iter().map(|c| &c.precinct))
            .collect();
        let chains: Vec<Key> = self.arms.iter().map(|a| a.chain.clone()).collect();
        for op in walls::gates_on_circuits(stage.graph(), &circuits, &chains) {
            let _ = stage.try_push(vec![op]);
        }
        Some(stage.into_ops())
    }

    /// The boundary arcs of a ring's land: one set per piece of land, each piece cut to the open
    /// precinct's line while a precinct is open.
    fn ring_arcs(&self, graph: &Graph, land: &Land) -> Vec<BoundaryArc> {
        let depth = self.spec.min_quarter_depth;
        let mut out = Vec::new();
        for outline in &land.outlines {
            match &self.open_sectors {
                Some(open) => {
                    let piece = Shape {
                        outer: outline.clone(),
                        holes: vec![],
                    };
                    for cut in open.clip(&piece) {
                        out.extend(armature::arcs(graph, &g::normalized(cut).outer, depth));
                    }
                }
                None => out.extend(armature::arcs(graph, outline, depth)),
            }
        }
        out
    }

    /// The unbuilt faces of the open precinct's land cheaper than `level`: a ring reaches them
    /// even where its land covers the precinct whole and no arc is drawn.
    fn precinct_faces(&self, level: f64) -> Vec<FaceId> {
        let (Some(open), Some(costs)) = (&self.open_sectors, &self.frozen) else {
            return Vec::new();
        };
        let graph = self.writer.graph();
        let outside = graph.outside(Level::Ground);
        let b = g::bbox(&open.land);
        graph
            .live_faces()
            .filter(|&f| {
                f != outside
                    && graph.face(f).level == Level::Ground
                    && *graph.face(f).kind.current() == FaceKind::Unbuilt
            })
            .filter(|&f| {
                graph.outline(f).is_some_and(|s| {
                    let fb = g::bbox(&s);
                    fb.0 <= b.2
                        && fb.2 >= b.0
                        && fb.1 <= b.3
                        && fb.3 >= b.1
                        && open.admits(&s)
                        && costs.cost_at(g::interior_point(&s)) < level
                })
            })
            .collect()
    }

    /// Open the ring's sectors in station order. The drafts are laid in parallel with the phase
    /// at hand, and laid again for the sectors left when a promotion, a precinct survey or a
    /// raise changes the tissue. While a
    /// precinct is open only its sectors open. After each quarter: count, dated events, stop
    /// test; the ring is cut at the first station whose count reaches the target.
    fn open(
        &mut self,
        ring: u32,
        sectors: &[Sector],
        field: &[Vec<Point>],
        level: f64,
    ) -> Result<Step, String> {
        let mut drafts: Vec<Option<QuarterDraft>> = vec![None; sectors.len()];
        // The phase and precinct regime the drafts were laid in: a promotion, a survey or a
        // raise during the ring changes the tissue the remaining sectors are laid with.
        let mut laid_in: Option<(usize, bool)> = None;
        for (i, sector) in sectors.iter().enumerate() {
            if self
                .open_sectors
                .as_ref()
                .is_some_and(|open| !open.admits(&sector.outline))
            {
                continue;
            }
            let quarter = Key::quarter(ring, &sector.station);
            let regime = (self.phase, self.open_sectors.is_some());
            if !self.recorded_keys.contains(&quarter) && laid_in != Some(regime) {
                let fresh = self.lay(ring, &sectors[i..], field);
                for (slot, draft) in drafts[i..].iter_mut().zip(fresh) {
                    *slot = draft;
                }
                laid_in = Some(regime);
            }
            let draft = drafts[i].take();
            if profiled() {
                eprintln!(
                    "  growth.draft ring={ring} streets={}",
                    draft.as_ref().map_or(0, |d| d.draft.streets.len())
                );
            }
            let phase = self.phase;
            let (tissue, _) = self.birth_tissue(phase);
            let kind = EventKind::OpenQuarter {
                ring,
                station: sector.station.clone(),
                tissue: tissue.clone(),
                outline: sector.outline_edges.clone(),
            };
            let applied = self.event(kind, |d, at| {
                let ops = quarter_ops(&d.writer, at, draft.as_ref()?, &sector.face);
                (!ops.is_empty()).then_some(ops)
            })?;
            if let Some(index) = applied {
                self.count(ring, sector, index, phase, tissue, level);
                self.cursor.last_station = Some(sector.station.clone());
                self.opened_in_ring += 1;
            }
            self.dated()?;
            if self.reached() {
                return Ok(Step::Stop);
            }
        }
        Ok(Step::Go)
    }

    /// Lay the drafts of `sectors` in parallel, with the tissue a quarter born now takes, each
    /// from its frozen outline and its own stream; none for a quarter the stopped town already
    /// holds. A quarter mostly too steep for a plain house takes the tissue's terraced form, and
    /// short stepped links join its contour streets.
    fn lay(
        &self,
        ring: u32,
        sectors: &[Sector],
        field: &[Vec<Point>],
    ) -> Vec<Option<QuarterDraft>> {
        let (tissue, _) = self.birth_tissue(self.phase);
        let base = self.birth_organic(self.phase);
        // Slope is read serially: the survey stays on this thread.
        let params: Vec<OrganicParams> = sectors
            .iter()
            .map(|s| {
                if self.survey.quarter_slope(&s.outline).terraced() {
                    base.terraced()
                } else {
                    base.clone()
                }
            })
            .collect();
        let site = OrganicSite {
            centre: self.focus_position(),
            radius: self.spec.nucleus_radius,
            field: Rng::new(self.request.seed).fork("organic-field"),
        };
        let terrain = self.request.terrain;
        let seed = self.request.seed;
        let recorded = &self.recorded_keys;
        par::map(sectors, |i, sector| {
            let quarter = Key::quarter(ring, &sector.station);
            if recorded.contains(&quarter) {
                return None;
            }
            let params = &params[i];
            let mut rng = event_stream(seed, &quarter);
            let mut draft =
                organic::lay_streets(&sector.outline, terrain, field, &site, params, &mut rng);
            let links = stairs::stepped_links(&draft, &sector.outline, terrain, params);
            draft.streets.extend(links);
            Some(QuarterDraft {
                ring,
                station: sector.station.clone(),
                tissue: tissue.clone(),
                outline: sector.outline_edges.clone(),
                draft,
            })
        })
    }

    /// Count the quarter opened by event `index` at each fill step of its phase at birth, and
    /// add its first step to the clock. A quarter born in an open precinct is intramural; slope
    /// lowers its density.
    fn count(
        &mut self,
        ring: u32,
        sector: &Sector,
        index: usize,
        phase: usize,
        tissue: String,
        level: f64,
    ) {
        let graph = self.writer.graph();
        let event = &self.writer.journal().events[index];
        let mut faces: Vec<FaceId> = event
            .born
            .faces
            .iter()
            .filter_map(|k| graph.face_id(k))
            .filter(|&f| graph.face(f).life.live())
            .collect();
        if let Some(f) = graph.face_id(&sector.face)
            && graph.face(f).life.live()
        {
            faces.push(f);
        }
        let spec = &self.plan.phases[phase].spec;
        let base = self.plan.phases[0].spec.density;
        let (_, tissue_spec) = self.birth_tissue(phase);
        let intramural = self.open_sectors.is_some();
        let slope: QuarterSlope = self.survey.quarter_slope(&sector.outline);
        let mut fill_schedule = if spec.fill_schedule.is_empty() {
            vec![1.0]
        } else {
            spec.fill_schedule.clone()
        };
        // Old quarters densify with age: past its fill schedule a quarter is rebuilt in its
        // phase's compact tissue (smaller lots), counted now so that the clock stays fixed at birth.
        let compact_spec = (spec.compact_tissue_id != tissue)
            .then(|| self.request.specs.tissues.iter().find(|t| t.id == spec.compact_tissue_id))
            .flatten();
        let compact = compact_spec.map(|t| {
            let density = if base > 0.0 { spec.compact_density / base } else { 1.0 };
            (t.recipe.as_str(), t.zone.as_str(), density * slope.density)
        });
        let compact_step = compact.map(|_| fill_schedule.len());
        if compact.is_some() {
            fill_schedule.push(1.0);
        }
        let density = if base > 0.0 { spec.density / base } else { 1.0 };
        let birth = Birth {
            pressure: count::pressure(sector.cost, level),
            recipe: tissue_spec.map_or("", |t| t.recipe.as_str()),
            zone: tissue_spec.map_or("", |t| t.zone.as_str()),
            density: density * slope.density,
            intramural,
            fill_schedule: &fill_schedule[..compact_step.unwrap_or(fill_schedule.len())],
            compact,
        };
        let levels = count::levels(graph, &faces, self.clock, self.capacity, &birth);
        if profiled() {
            let land: f64 = faces.iter().filter_map(|&f| graph.outline(f)).map(|o| g::area(&o)).sum();
            let edges = event.born.edges.len();
            eprintln!(
                "  growth.quarter ring={ring} faces={} edges={edges} land={:.0} m2 cost={:.0} levels={:?}",
                faces.len(),
                land,
                sector.cost,
                levels.iter().map(|c| c.households().round()).collect::<Vec<_>>()
            );
        }
        let key = event.key.clone();
        let face_keys = faces.iter().map(|&f| graph.face(f).key.clone()).collect();
        let housed = levels[0];
        self.quarters.push(QuarterRecord {
            key,
            ring,
            station: sector.station.clone(),
            phase,
            tissue,
            intramural,
            faces: face_keys,
            fill_schedule,
            levels,
            step: 0,
            compact_step,
        });
        self.clock = self.clock + housed;
    }

    /// Age the quarters born before `ring` by one fill step, intramural ones first and by one
    /// step more; dated events and the stop test follow each step.
    fn age_ring(&mut self, ring: u32) -> Result<Step, String> {
        for q in self.ageing_order(|record| record.ring < ring) {
            let steps = if self.quarters[q].intramural {
                INTRAMURAL_STEPS
            } else {
                1
            };
            for _ in 0..steps {
                if !self.age(q)? {
                    break;
                }
                self.dated()?;
                if self.reached() {
                    return Ok(Step::Stop);
                }
            }
        }
        Ok(Step::Go)
    }

    /// With no land left, age every quarter step by step, round after round, until all are at
    /// their last fill step or the target is housed.
    fn age_out(&mut self) -> Result<Step, String> {
        loop {
            let mut aged = false;
            for q in self.ageing_order(|_| true) {
                if self.age(q)? {
                    aged = true;
                    self.dated()?;
                    if self.reached() {
                        return Ok(Step::Stop);
                    }
                }
            }
            if !aged {
                return Ok(Step::Go);
            }
        }
    }

    /// Quarters chosen by `keep`, intramural first, then by key.
    pub(super) fn ageing_order(&self, keep: impl Fn(&QuarterRecord) -> bool) -> Vec<usize> {
        let mut order: Vec<usize> = (0..self.quarters.len())
            .filter(|&q| keep(&self.quarters[q]))
            .collect();
        order.sort_by(|&a, &b| {
            let (x, y) = (&self.quarters[a], &self.quarters[b]);
            y.intramural
                .cmp(&x.intramural)
                .then_with(|| x.key.cmp(&y.key))
        });
        order
    }

    /// Raise quarter `q` by one fill step. Returns whether it had a step left.
    pub(super) fn age(&mut self, q: usize) -> Result<bool, String> {
        let record = &self.quarters[q];
        let Some(increment) = record.next_increment() else {
            return Ok(false);
        };
        let step = record.step + 1;
        let kind = EventKind::AgeQuarter {
            quarter: record.key.clone(),
            step: step as u32,
        };
        if self.event(kind, |_, _| Some(Vec::new()))?.is_some() {
            self.quarters[q].step = step;
            self.clock = self.clock + increment;
        }
        Ok(true)
    }
}
