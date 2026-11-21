//! The ring loop: armature, quarters in station order, count, ageing, promotions, stop.

use std::collections::HashSet;

use magna_urbis_geom::Point;
use magna_urbis_random::Rng;

use super::commit::quarter_ops;
use super::contour::{Land, Lattice};
use super::count::{self, Birth, QuarterRecord};
use super::driver::{Driver, Step};
use super::par;
use super::sectors::{self, Sector};
use crate::armature::{self, Draw, chain_ops};
use crate::graph::{Clock, EdgeClass, FaceId, Key};
use crate::journal::{Cursor, EventKind, Op, QuarterDraft, event_stream};
use crate::tissue::organic::{self, OrganicSite};

/// Rank of boundary edges: below every street.
const BOUNDARY_RANK: u8 = 4;
/// Fill steps an intramural quarter gains per ring, one more than the others.
const INTRAMURAL_STEPS: usize = 2;

/// How a ring ended.
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
    /// sectors as quarters in station order, then age the older quarters.
    fn ring(&mut self, ring: u32) -> Result<RingEnd, String> {
        let costs = self.cost_field();
        let level = f64::from(ring + 1) * self.spec.ring_step;
        let land = Lattice::new(&self.survey, &costs).land(level);
        let whole = land.as_ref().is_none_or(|l| l.whole);
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
        let applied = self.event(kind, |d, at| d.extension(&event, land.as_ref()?, at))?;
        let Some(index) = applied else {
            return Ok(ended);
        };
        let graph = self.writer.graph();
        let sectors = sectors::of_ring(graph, &self.writer.journal().events[index].ops, &costs);
        if sectors.is_empty() {
            return Ok(ended);
        }
        // The lines orienting the street field, frozen with the ring's outlines.
        let field = armature::field_lines(graph, &self.arms);
        if self.open(ring, &sectors, &field, level)? == Step::Stop {
            return Ok(RingEnd::Stopped);
        }
        if self.age_ring(ring)? == Step::Stop {
            return Ok(RingEnd::Stopped);
        }
        Ok(RingEnd::Opened)
    }

    /// The operations of a ring's `ExtendArmature` event: its boundary arcs, then each axis
    /// prolonged across it. `None` when no arc can be drawn.
    fn extension(&self, event: &Key, land: &Land, at: Clock) -> Option<Vec<Op>> {
        let mut stage = self.writer.stage(at);
        let mut rank = 0;
        let mut arcs = HashSet::new();
        for arc in armature::arcs(stage.graph(), &land.outline, self.spec.min_quarter_depth) {
            let draw = Draw {
                event,
                next_rank: &mut rank,
                chain: None,
                class: EdgeClass::Boundary,
                rank: BOUNDARY_RANK,
                width: 0.0,
            };
            let (ops, chain) = chain_ops(draw, &arc.path, arc.start, arc.end, &arc.hits);
            if stage.try_push(ops).is_ok() {
                arcs.insert(chain);
            }
        }
        if arcs.is_empty() {
            return None;
        }
        let focus = self.focus?;
        let params = self.organic(self.phase);
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
        Some(stage.into_ops())
    }

    /// Open the ring's sectors in station order. The drafts are laid in parallel with the phase
    /// at hand, and laid again for the sectors left when a promotion changes the phase. After
    /// each quarter: count, promotions, stop test; the ring is cut at the first station whose
    /// count reaches the target.
    fn open(
        &mut self,
        ring: u32,
        sectors: &[Sector],
        field: &[Vec<Point>],
        level: f64,
    ) -> Result<Step, String> {
        let mut drafts: Vec<Option<QuarterDraft>> = vec![None; sectors.len()];
        let mut laid_in: Option<usize> = None;
        for (i, sector) in sectors.iter().enumerate() {
            let quarter = Key::quarter(ring, &sector.station);
            if !self.recorded_keys.contains(&quarter) && laid_in != Some(self.phase) {
                let fresh = self.lay(ring, &sectors[i..], field);
                for (slot, draft) in drafts[i..].iter_mut().zip(fresh) {
                    *slot = draft;
                }
                laid_in = Some(self.phase);
            }
            let draft = drafts[i].take();
            let phase = self.phase;
            let (tissue, _) = self.tissue(phase);
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
            }
            self.promote()?;
            if self.reached() {
                return Ok(Step::Stop);
            }
        }
        Ok(Step::Go)
    }

    /// Lay the drafts of `sectors` in parallel, with the current phase's tissue, each from its
    /// frozen outline and its own stream; none for a quarter the stopped town already holds.
    fn lay(
        &self,
        ring: u32,
        sectors: &[Sector],
        field: &[Vec<Point>],
    ) -> Vec<Option<QuarterDraft>> {
        let (tissue, _) = self.tissue(self.phase);
        let params = self.organic(self.phase);
        let site = OrganicSite {
            centre: self.focus_position(),
            radius: self.spec.nucleus_radius,
            field: Rng::new(self.request.seed).fork("organic-field"),
        };
        let terrain = self.request.terrain;
        let seed = self.request.seed;
        let recorded = &self.recorded_keys;
        par::map(sectors, |_, sector| {
            let quarter = Key::quarter(ring, &sector.station);
            if recorded.contains(&quarter) {
                return None;
            }
            let mut rng = event_stream(seed, &quarter);
            let draft =
                organic::lay_streets(&sector.outline, terrain, field, &site, &params, &mut rng);
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
    /// add its first step to the clock.
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
        let (_, tissue_spec) = self.tissue(phase);
        // Precincts, which open their sectors in the intramural regime, come in a later lot.
        let intramural = false;
        let fill_schedule = if spec.fill_schedule.is_empty() {
            vec![1.0]
        } else {
            spec.fill_schedule.clone()
        };
        let birth = Birth {
            pressure: count::pressure(sector.cost, level, intramural),
            recipe: tissue_spec.map_or("", |t| t.recipe.as_str()),
            zone: tissue_spec.map_or("", |t| t.zone.as_str()),
            density: if base > 0.0 { spec.density / base } else { 1.0 },
            intramural,
            fill_schedule: &fill_schedule,
        };
        let levels = count::levels(graph, &faces, self.clock, self.capacity, &birth);
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
        });
        self.clock = self.clock + housed;
    }

    /// Age the quarters born before `ring` by one fill step, intramural ones first and by one
    /// step more; promotions and the stop test follow each step.
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
                self.promote()?;
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
                    self.promote()?;
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
