//! The growth loop: quarters opened on the skeleton in cost order, count, ageing, dated events,
//! stop.

use std::collections::HashSet;

use magna_urbis_geom::{self as g, Point};
use magna_urbis_random::Rng;

use super::cells::{self, Cell};
use super::commit::quarter_ops;
use super::contour::Lattice;
use super::count::{self, Birth, QuarterRecord};
use super::driver::{Driver, Step};
use super::par;
use crate::armature;
use crate::graph::{FaceId, Key, Level, NodeId};
use crate::journal::{Cursor, EventKind, QuarterDraft, event_stream};
use crate::survey::QuarterSlope;
use crate::tissue::organic::{self, OrganicParams, OrganicSite};
use crate::tissue::stairs;
use crate::water;

/// Fill steps an intramural quarter gains per step, one more than the others.
const INTRAMURAL_STEPS: usize = 2;
/// Steps in a row that may open nothing in an open precinct before it is raised as it stands.
const IDLE_STEPS: u32 = 2;
/// Quarters opened at most in one step.
const MAX_BATCH: usize = 8;

/// Whether growth laps are printed (`URBAN_PROFILE`, as the classic stages).
fn profiled() -> bool {
    std::env::var_os("URBAN_PROFILE").is_some()
}

/// How a step ended.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum StepEnd {
    /// Its quarters opened and older quarters aged.
    Opened,
    /// No quarter opened, but land remains (an open precinct waits for its raise).
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
        for step in 1..=self.spec.max_steps {
            match self.step(step)? {
                StepEnd::Stopped => return Ok(()),
                StepEnd::Opened | StepEnd::Empty => {}
                StepEnd::Exhausted => break,
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

    /// One step: freeze the cost field, give a newly reached far bank its skeleton, open the
    /// cheapest frontier cells as quarters and age the older ones; then the step's dated events
    /// (precinct surveys, a precinct that can open nothing more raised as it stands) and its
    /// water crossing.
    fn step(&mut self, step: u32) -> Result<StepEnd, String> {
        let started = std::time::Instant::now();
        let costs = self.cost_field();
        let lattice = Lattice::new(&self.survey, &costs);
        self.frozen = Some(costs);
        self.opened_in_step = 0;
        self.cursor = Cursor {
            ring: step,
            last_station: None,
            cost_field_at: self.writer.journal().events.len(),
        };
        self.far_skeleton(step, &lattice)?;
        let cells = self.batch();
        let end = if cells.is_empty() {
            if self.open_sectors.is_some() {
                StepEnd::Empty
            } else {
                StepEnd::Exhausted
            }
        } else {
            let field = armature::field_lines(self.writer.graph(), &self.arms);
            let opened = self.open(step, &cells, &field)?;
            let opened = if opened == Step::Stop {
                Step::Stop
            } else {
                self.age_step(step)?
            };
            if opened == Step::Stop {
                StepEnd::Stopped
            } else {
                StepEnd::Opened
            }
        };
        if profiled() {
            eprintln!(
                "  growth.step {step} cells={} quarters={} clock={:.0}/{:.0} extent={:.0} total={} ms",
                cells.len(),
                self.quarters.len(),
                self.clock.households(),
                self.target.households(),
                self.extent,
                started.elapsed().as_millis()
            );
        }
        if end == StepEnd::Stopped {
            return Ok(end);
        }
        let idle = self.open_sectors.is_some() && self.opened_in_step == 0;
        self.idle_steps = if idle { self.idle_steps + 1 } else { 0 };
        self.dated_events(true, self.idle_steps >= IDLE_STEPS)?;
        let crossed = self.water_step(self.extent + self.spec.step_span)?;
        // A crossing opens a far bank: the next step grows there instead of ageing out.
        Ok(if crossed && end == StepEnd::Exhausted {
            StepEnd::Empty
        } else {
            end
        })
    }

    /// The cells the step opens: the frontier cells within the step's span of the cheapest, at
    /// most `MAX_BATCH`, cheapest first; while a precinct is open, only its own.
    fn batch(&self) -> Vec<Cell> {
        let Some(costs) = self.frozen.as_ref() else {
            return Vec::new();
        };
        let graph = self.writer.graph();
        let mut landings: Vec<Point> = water::far_landings(graph, self.writer.journal());
        // The town starts at its focus, and on a far bank at the crossing's landing node.
        let mut seeds: Vec<NodeId> = self.focus.into_iter().collect();
        for &p in &landings {
            seeds.extend(
                graph
                    .edges_near(Level::Ground, p, 1.0)
                    .into_iter()
                    .flat_map(|e| graph.edge(e).nodes)
                    .filter(|&n| graph.node(n).position.distance(p) < 1.0),
            );
        }
        // A focus no street reaches starts the town from the cell around it.
        if self.quarters.is_empty() {
            landings.push(self.focus_position());
        }
        let mut cells = cells::frontier(graph, costs, &seeds, &landings);
        if let Some(open) = &self.open_sectors {
            cells.retain(|c| open.admits(&c.outline));
        }
        let Some(cheapest) = cells.first().map(|c| c.cost) else {
            return Vec::new();
        };
        cells.retain(|c| c.cost <= cheapest + self.spec.step_span);
        cells.truncate(MAX_BATCH);
        cells
    }

    /// Open the step's cells, cheapest first. The drafts are laid in parallel with the phase at
    /// hand, and laid again for the cells left when a promotion changes the phase. After each
    /// quarter: count, dated events, stop test; the step is cut at the first quarter whose count
    /// reaches the target.
    fn open(&mut self, step: u32, cells: &[Cell], field: &[Vec<Point>]) -> Result<Step, String> {
        let mut drafts: Vec<Option<QuarterDraft>> = vec![None; cells.len()];
        let mut laid_in: Option<usize> = None;
        for (i, cell) in cells.iter().enumerate() {
            let quarter = Key::quarter(step, &cell.station);
            if !self.recorded_keys.contains(&quarter) && laid_in != Some(self.phase) {
                let fresh = self.lay(step, &cells[i..], field);
                for (slot, draft) in drafts[i..].iter_mut().zip(fresh) {
                    *slot = draft;
                }
                laid_in = Some(self.phase);
            }
            let draft = drafts[i].take();
            let phase = self.phase;
            let (tissue, _) = self.birth_tissue(phase);
            let kind = EventKind::OpenQuarter {
                ring: step,
                station: cell.station.clone(),
                tissue: tissue.clone(),
                outline: cell.outline_edges.clone(),
            };
            let applied = self.event(kind, |d, at| {
                let arms: HashSet<&Key> = d.arms.iter().map(|a| &a.chain).collect();
                let ops = quarter_ops(&d.writer, at, draft.as_ref()?, &cell.face, &arms);
                (!ops.is_empty()).then_some(ops)
            })?;
            if let Some(index) = applied {
                self.extent = self.extent.max(cell.cost);
                self.count(step, cell, index, phase, tissue);
                self.cursor.last_station = Some(cell.station.clone());
                self.opened_in_step += 1;
            }
            self.dated()?;
            if self.reached() {
                return Ok(Step::Stop);
            }
        }
        Ok(Step::Go)
    }

    /// Lay the drafts of `cells` in parallel, with the tissue a quarter born now takes, each from
    /// its outline and its own stream; none for a quarter the stopped town already holds. A
    /// quarter mostly too steep for a plain house takes the tissue's terraced form, and short
    /// stepped links join its contour streets.
    fn lay(&self, step: u32, cells: &[Cell], field: &[Vec<Point>]) -> Vec<Option<QuarterDraft>> {
        let (tissue, _) = self.birth_tissue(self.phase);
        let base = self.birth_organic(self.phase);
        // Slope is read serially: the survey stays on this thread.
        let params: Vec<OrganicParams> = cells
            .iter()
            .map(|c| {
                if self.survey.quarter_slope(&c.outline).terraced() {
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
        par::map(cells, |i, cell| {
            let quarter = Key::quarter(step, &cell.station);
            if recorded.contains(&quarter) {
                return None;
            }
            let params = &params[i];
            let mut rng = event_stream(seed, &quarter);
            let mut draft =
                organic::lay_streets(&cell.outline, terrain, field, &site, params, &mut rng);
            let links = stairs::stepped_links(&draft, &cell.outline, terrain, params);
            draft.streets.extend(links);
            Some(QuarterDraft {
                ring: step,
                station: cell.station.clone(),
                tissue: tissue.clone(),
                outline: cell.outline_edges.clone(),
                draft,
            })
        })
    }

    /// Count the quarter opened by event `index` at each fill step of its phase at birth, and
    /// add its first step to the clock. A quarter born in an open precinct is intramural; slope
    /// lowers its density.
    fn count(&mut self, step: u32, cell: &Cell, index: usize, phase: usize, tissue: String) {
        let graph = self.writer.graph();
        let event = &self.writer.journal().events[index];
        let mut faces: Vec<FaceId> = event
            .born
            .faces
            .iter()
            .filter_map(|k| graph.face_id(k))
            .filter(|&f| graph.face(f).life.live())
            .collect();
        if let Some(f) = graph.face_id(&cell.face)
            && graph.face(f).life.live()
        {
            faces.push(f);
        }
        let spec = &self.plan.phases[phase].spec;
        let base = self.plan.phases[0].spec.density;
        let (_, tissue_spec) = self.birth_tissue(phase);
        let intramural = self.open_sectors.is_some();
        let slope: QuarterSlope = self.survey.quarter_slope(&cell.outline);
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
            pressure: count::pressure(cell.cost, self.extent + self.spec.step_span),
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
                "  growth.quarter step={step} faces={} edges={edges} land={:.0} m2 cost={:.0} levels={:?}",
                faces.len(),
                land,
                cell.cost,
                levels.iter().map(|c| c.households().round()).collect::<Vec<_>>()
            );
        }
        let key = event.key.clone();
        let face_keys = faces.iter().map(|&f| graph.face(f).key.clone()).collect();
        let housed = levels[0];
        self.quarters.push(QuarterRecord {
            key,
            ring: step,
            station: cell.station.clone(),
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

    /// Age the quarters born before `step` by one fill step, intramural ones first and by one
    /// step more; dated events and the stop test follow each step.
    fn age_step(&mut self, step: u32) -> Result<Step, String> {
        for q in self.ageing_order(|record| record.ring < step) {
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
    fn ageing_order(&self, keep: impl Fn(&QuarterRecord) -> bool) -> Vec<usize> {
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
    fn age(&mut self, q: usize) -> Result<bool, String> {
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
