//! Step 5 of a clock step (design 3.2): the dated events whose threshold the step crossed, in
//! their fixed order: promotions, road fates, harbour (open, then extend), walls (raise a full
//! precinct, then survey the next); and, once per ring, the water crossing.
//!
//! Every event is decided from the graph, the journal, the survey and the clock, so that a
//! resumed run takes the same decisions and replays each from its record; the state the loop
//! keeps (the harbour, the precincts, the axes a crossing opened) is rebuilt as the record is
//! replayed.

use super::driver::Driver;
use crate::armature::fate;
use crate::graph::Key;
use crate::harbour::{self, HarbourState};
use crate::journal::EventKind;
use crate::spec::HarbourEnclosure;
use crate::walls::{self, Purpose};
use crate::water;

impl Driver<'_> {
    /// The dated events after a quarter's count or an ageing step.
    pub(super) fn dated(&mut self) -> Result<(), String> {
        self.dated_events(false, false)
    }

    /// The dated events in their order. At a ring's end (`ring_end`) the walls may also survey
    /// their next precinct, and `force` raises an open precinct the rings can open no more of.
    pub(super) fn dated_events(&mut self, ring_end: bool, force: bool) -> Result<(), String> {
        self.promote()?;
        self.road_fates()?;
        self.harbour_step()?;
        self.wall_step(ring_end, force)
    }

    /// Position of the next `RetypeChain` of `chain` among its changes.
    pub(super) fn retype_step(&self, chain: &Key) -> u32 {
        self.writer
            .journal()
            .events
            .iter()
            .filter(|e| matches!(&e.kind, EventKind::RetypeChain { chain: c, .. } if c == chain))
            .count() as u32
    }

    /// Road fates: the stretches and entries of each regional road as the current phase and the
    /// town limit make them, one `RetypeChain` per road chain that changes.
    fn road_fates(&mut self) -> Result<(), String> {
        let spec = &self.plan.phases[self.phase].spec;
        let graph = self.writer.graph();
        let ops = fate::road_fates(graph, spec, &self.charter, self.clock);
        if ops.is_empty() {
            return Ok(());
        }
        for (chain, ops) in fate::group_road_fates(graph, ops) {
            let kind = EventKind::RetypeChain {
                step: self.retype_step(&chain),
                chain,
                class: None,
                rank: None,
            };
            if !self.may_apply(&kind.key()) {
                continue;
            }
            let ops = self.accepted(ops);
            if !ops.is_empty() {
                self.event(kind, |_, _| Some(ops))?;
            }
        }
        Ok(())
    }

    /// The harbour: opened once the town reaches its front (or, founded on it, at the landing
    /// population), then extended whenever its quay or works are due. A standing sea wall takes
    /// a water gate at each new landing.
    fn harbour_step(&mut self) -> Result<(), String> {
        let Some(front) = self.front.clone() else {
            return Ok(());
        };
        let specs = self.request.specs;
        let spec = &specs.harbour;
        let inhabitants = walls::inhabitants(self.clock, self.spec.household_size);
        let applied = match &self.harbour {
            None => {
                let due = (front.at_focus && inhabitants >= spec.thresholds.landing)
                    || harbour::opened(&front, self.writer.graph(), spec);
                let kind = EventKind::OpenHarbour { front: front.index };
                let key = kind.key();
                if !due || !self.may_apply(&key) {
                    return Ok(());
                }
                self.event(kind, |d, at| {
                    harbour::open_harbour(&d.writer, at, &key, &d.survey, &front, spec, inhabitants)
                })?
            }
            Some(state) => {
                let works = &self.plan.phases[self.phase].spec.harbour_works;
                if !harbour::extension_due(state, spec, works, inhabitants) {
                    return Ok(());
                }
                let kind = EventKind::ExtendHarbour {
                    front: front.index,
                    step: state.extensions + 1,
                    quay_length: harbour::quay_length(spec, inhabitants),
                };
                let key = kind.key();
                if !self.may_apply(&key) {
                    return Ok(());
                }
                let state = state.clone();
                self.event(kind, |d, at| {
                    let works = &d.plan.phases[d.phase].spec.harbour_works;
                    let ops = harbour::extend_harbour(
                        &d.writer, at, &key, &d.survey, &state, spec, works, inhabitants,
                    )?;
                    let mut stage = d.writer.stage(at);
                    stage.try_push(ops).ok()?;
                    if let Some(wall) = d.sea_wall() {
                        let after = HarbourState::read(
                            stage.graph(),
                            d.writer.journal(),
                            state.front.clone(),
                            spec,
                        );
                        let landings: Vec<_> = after
                            .iter()
                            .flat_map(|s| &s.landings)
                            .filter_map(|(_, k)| stage.graph().node_id(k))
                            .map(|n| stage.graph().node(n).position)
                            .collect();
                        walls::landing_gates(&mut stage, wall, &landings, &key);
                    }
                    Some(stage.into_ops())
                })?
            }
        };
        if applied.is_some() {
            self.harbour =
                HarbourState::read(self.writer.graph(), self.writer.journal(), front, spec);
        }
        Ok(())
    }

    /// The standing town circuit that runs as a sea wall along the harbour, if any.
    fn sea_wall(&self) -> Option<&walls::Precinct> {
        if self.charter.draws.harbour_enclosure != HarbourEnclosure::SeaWall {
            return None;
        }
        self.precincts
            .iter()
            .rev()
            .find(|p| p.purpose == Purpose::Town && p.raised.is_some())
    }

    /// The water step, once per ring: a far bank is opened when crossing to it is cheaper than
    /// the town's own banks' land left. Returns whether a crossing was applied.
    pub(super) fn water_step(&mut self, level: f64) -> Result<bool, String> {
        let specs = self.request.specs;
        let Some(costs) = self.frozen.as_ref() else {
            return Ok(false);
        };
        let inputs = water::WaterInputs {
            survey: &self.survey,
            costs,
            graph: self.writer.graph(),
            journal: self.writer.journal(),
            arms: &self.arms,
            focus: self.focus_position(),
            level,
            inhabitants: self.clock.households() * self.spec.household_size,
            water_charge: specs.survey.water_charge,
            growth: &specs.growth,
            spec: &specs.crossing,
        };
        let Some(crossing) = water::far_bank_due(&inputs) else {
            return Ok(false);
        };
        let kind = crossing.event();
        if !self.may_apply(&kind.key()) {
            return Ok(false);
        }
        let applied = self.event(kind, |d, _| water::cross_water(d.writer.graph(), &crossing))?;
        if applied.is_none() {
            return Ok(false);
        }
        // A crossing that joined a street off the axes opened a new axis across the water.
        let arms = water::crossing_arms(self.writer.graph(), self.writer.journal(), &self.arms);
        self.arms.extend(arms);
        Ok(true)
    }
}
