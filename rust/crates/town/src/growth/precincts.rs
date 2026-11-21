//! The precinct cycle in the growth loop (design 4.3, 5.2, 5.3, 5.5): the founding precinct of
//! an enclosed charter (a camp's figure for a camp tissue), the raise of a full precinct with the
//! fossil rule on the circuit it overtakes, the next survey when due, the first circuit of a town
//! walled when grown, and the citadel of a culture that keeps one.
//!
//! The plans are computed on a resumed run too, whenever the next recorded event is theirs, so
//! that the precinct records are rebuilt; the recorded operations are the ones applied.

use magna_urbis_geom as g;

use super::driver::Driver;
use crate::graph::Key;
use crate::harbour;
use crate::journal::EventKind;
use crate::spec::{DefensiveIntent, PhaseDraw, WallKind};
use crate::survey::CostField;
use crate::walls::{self, HarbourSide, PrecinctPlan, PrecinctSite, Purpose, QuarterAge};

/// Citadels are numbered from here in the town's sequence of circuits, apart from the town's
/// own circuits, which each survey numbers after the one it extends.
const CITADEL_INDEX: u32 = 100;
/// Width in metres of the strip along the quay a harbour-outside curtain keeps out of, beyond
/// the quay itself: the apron and the first row of lots.
const SERVICE_ROW: f64 = 40.0;
/// Site archetypes on which a camp takes the defensive figure.
const DEFENSIVE_SITES: [&str; 4] = ["spur", "hilltop", "meander", "island"];

impl Driver<'_> {
    /// The founding precinct of a charter enclosed from founding, at the founding date before
    /// the first ring: sized for the founding cohort, or a camp's figure for a camp tissue.
    pub(super) fn found_precinct(&mut self) -> Result<(), String> {
        if self.charter.defensive_intent != DefensiveIntent::EnclosedFromFounding
            || !self.may_apply(&walls::precinct_key(0))
        {
            return Ok(());
        }
        match self.plan_founding_precinct() {
            Some(plan) => {
                self.apply_precinct(plan, 1.0)?;
            }
            None => self
                .warnings
                .push("No founding precinct — no land (Pas d'enceinte — pas de terrain)".into()),
        }
        Ok(())
    }

    fn plan_founding_precinct(&self) -> Option<PrecinctPlan> {
        let specs = self.request.specs;
        let costs = self.frozen.as_ref()?;
        let side = self.harbour_side();
        let chains = self.arm_chains();
        let site = self.precinct_site(costs, side.as_ref(), &chains);
        let phase = &self.plan.phases[0];
        let camp = self.tissue(0).1.is_some_and(|t| t.pattern == "camp");
        if !camp {
            return walls::survey_precinct(
                &self.writer,
                &self.survey,
                &self.charter,
                phase,
                None,
                self.clock,
                self.clock,
                &site,
            );
        }
        let draw = self.charter.draws.phases.get(&phase.spec.name)?;
        let focus = self.survey.center();
        let defensive = self
            .charter
            .site_archetype
            .as_deref()
            .is_some_and(|a| DEFENSIVE_SITES.contains(&a));
        let figure = defensive
            .then(|| walls::defensive_figure(&self.survey, focus, &specs.precinct))
            .flatten()
            .map(|(outline, _)| outline)
            .unwrap_or_else(|| {
                walls::flat_figure(
                    focus,
                    road_bearing(&self.road_lines, focus),
                    phase.spec.compact_density.max(1.0),
                    &specs.precinct,
                )
            });
        let households = f64::from(specs.precinct.camp_unit) / self.spec.household_size.max(1e-9);
        walls::survey_camp(
            &self.writer,
            &self.survey,
            figure,
            defensive,
            draw.wall_kind,
            0,
            households,
            self.clock,
            &site,
        )
    }

    /// The wall step: raise the open precinct when full (or, with `force`, as it stands); survey
    /// the next precinct as soon as it is due, so that the faubourg outside the standing wall
    /// stays under its bound; at a ring's end (`ring_end`) survey the first circuit of a town
    /// walled when grown once its phase allows it.
    pub(super) fn wall_step(&mut self, ring_end: bool, force: bool) -> Result<(), String> {
        if self.charter.defensive_intent == DefensiveIntent::Never {
            return Ok(());
        }
        let name = &self.plan.phases[self.phase].spec.name;
        let Some(draw) = self.charter.draws.phases.get(name).cloned() else {
            return Ok(());
        };
        if let Some(i) = self.precincts.iter().rposition(|p| p.raised.is_none()) {
            return self.raise(i, &draw, force);
        }
        self.next_precinct(&draw, ring_end)
    }

    /// Raise precinct `i` in the kind its survey drew (the phase's, else a hedge) when every
    /// sector of it is born, or at once with `force`.
    fn raise(&mut self, i: usize, draw: &PhaseDraw, force: bool) -> Result<(), String> {
        let kind = self.precincts[i]
            .kind
            .or(draw.wall_kind)
            .unwrap_or(WallKind::Hedge);
        let event = walls::raise_event(&self.precincts[i], kind);
        if !self.may_apply(&event.key()) && !self.fossil_pending(i) {
            return Ok(());
        }
        let graph = self.writer.graph();
        let regime = PhaseDraw {
            wall_kind: Some(kind),
            ..draw.clone()
        };
        let ops = match walls::raise_when_full(graph, &self.precincts[i], &regime) {
            Some(ops) => ops,
            None if force => walls::raise_ops(graph, &self.precincts[i]).unwrap_or_default(),
            None => return Ok(()),
        };
        self.fossil(i, draw)?;
        if self.event(event, |_, _| Some(ops))?.is_none() {
            return Ok(());
        }
        let precinct = &mut self.precincts[i];
        precinct.raised = Some(self.clock);
        precinct.kind = Some(kind);
        self.open_sectors = None;
        self.idle_rings = 0;
        self.inside_at_raise = self.households_inside().0;
        self.citadel(i)?;
        // Design 5.2: once the wall stands, the walled town densifies up to the charter's gain
        // before the next survey, instead of spilling into a faubourg.
        let goal = self.inside_at_raise * (1.0 + draw.precinct_gain.max(0.0));
        self.age_within(goal)
    }

    /// Age the intramural quarters, one fill step each in turn, until the households inside the
    /// standing walls reach `goal`, no step remains or the target is housed; the dated events
    /// follow each step.
    fn age_within(&mut self, goal: f64) -> Result<(), String> {
        loop {
            let mut aged = false;
            for q in self.ageing_order(|record| record.intramural) {
                if self.reached() || self.households_inside().0 >= goal {
                    return Ok(());
                }
                let step = self.quarters[q].step;
                if self.age(q)? && self.quarters[q].step > step {
                    aged = true;
                    self.dated()?;
                }
            }
            if !aged {
                return Ok(());
            }
        }
    }

    /// The circuit a concentric raise of precinct `i` overtakes: the last raised town circuit
    /// before it. A lobe's old circuit is kept whole.
    fn overtaken(&self, i: usize) -> Option<usize> {
        if self.precincts[i].attached_to.is_some() {
            return None;
        }
        self.precincts[..i]
            .iter()
            .rposition(|p| p.purpose == Purpose::Town && p.raised.is_some())
    }

    /// Whether the next recorded event is the fossil retype that precedes precinct `i`'s raise.
    fn fossil_pending(&self, i: usize) -> bool {
        self.overtaken(i).is_some_and(|o| {
            let chain = &self.precincts[o].chain;
            let kind = EventKind::RetypeChain {
                chain: chain.clone(),
                step: self.retype_step(chain),
                class: None,
                rank: None,
            };
            self.may_apply(&kind.key())
        })
    }

    /// Before a concentric raise, the fossil rule on the circuit it overtakes, as one
    /// `RetypeChain`; removals are kept as far as the graph accepts them one by one.
    fn fossil(&mut self, i: usize, draw: &PhaseDraw) -> Result<(), String> {
        let Some(o) = self.overtaken(i) else {
            return Ok(());
        };
        let Some(retype) = walls::fossil(self.writer.graph(), &self.precincts[o], draw.fossil_rule)
        else {
            return Ok(());
        };
        let kind = EventKind::RetypeChain {
            step: self.retype_step(&retype.chain),
            chain: retype.chain,
            class: retype.class,
            rank: retype.rank,
        };
        if !self.may_apply(&kind.key()) {
            return Ok(());
        }
        let ops = self.accepted(retype.ops);
        if !ops.is_empty() {
            self.event(kind, |_, _| Some(ops))?;
        }
        Ok(())
    }

    /// The next precinct, once the standing one has aged by its gain or the faubourg outside it
    /// has grown to its bound; or, at a ring's end, the first circuit of a town walled when grown.
    fn next_precinct(&mut self, draw: &PhaseDraw, ring_end: bool) -> Result<(), String> {
        let last = self
            .precincts
            .iter()
            .rposition(|p| matches!(p.purpose, Purpose::Town | Purpose::Camp));
        let plan = match last {
            None => {
                let grown = ring_end
                    && self.charter.defensive_intent == DefensiveIntent::WalledWhenGrown
                    && self.plan.phases[self.phase].spec.walls_when_grown;
                if !grown || !self.may_apply(&walls::precinct_key(0)) {
                    return Ok(());
                }
                self.plan_grown()
            }
            Some(last) => {
                let (inside, outside) = self.households_inside();
                let index = self.precincts[last].index + 1;
                if !walls::survey_due(inside, outside, self.inside_at_raise, draw)
                    || !self.may_apply(&walls::precinct_key(index))
                {
                    return Ok(());
                }
                self.plan_next(last)
            }
        };
        if let Some(plan) = plan {
            let raised = plan.raise_now;
            let index = self.precincts.len();
            if self.apply_precinct(plan, draw.precinct_step)? && raised {
                self.citadel(index)?;
            }
        }
        Ok(())
    }

    fn plan_grown(&self) -> Option<PrecinctPlan> {
        let costs = self.frozen.as_ref()?;
        let side = self.harbour_side();
        let chains = self.arm_chains();
        let site = self.precinct_site(costs, side.as_ref(), &chains);
        let ages: Vec<QuarterAge<'_>> = self
            .quarters
            .iter()
            .map(|q| QuarterAge {
                faces: &q.faces,
                ring: q.ring,
                step: q.step,
            })
            .collect();
        walls::survey_grown(
            &self.writer,
            &self.survey,
            &self.charter,
            &self.plan.phases[self.phase],
            &ages,
            self.clock,
            self.clock,
            &site,
        )
    }

    fn plan_next(&self, last: usize) -> Option<PrecinctPlan> {
        let costs = self.frozen.as_ref()?;
        let side = self.harbour_side();
        let chains = self.arm_chains();
        let site = self.precinct_site(costs, side.as_ref(), &chains);
        walls::survey_precinct(
            &self.writer,
            &self.survey,
            &self.charter,
            &self.plan.phases[self.phase],
            Some(&self.precincts[last]),
            self.clock,
            self.clock,
            &site,
        )
    }

    /// A citadel astride the first raised town circuit, for a culture that keeps one and a town
    /// without a castle.
    fn citadel(&mut self, i: usize) -> Result<(), String> {
        let specs = self.request.specs;
        let town = &self.precincts[i];
        if !specs.wall.keeps_citadel
            || self.castle.is_some()
            || town.purpose != Purpose::Town
            || town.raised.is_none()
            || self.precincts.iter().any(|p| p.purpose == Purpose::Citadel)
        {
            return Ok(());
        }
        let index = CITADEL_INDEX + town.index;
        if !self.may_apply(&walls::precinct_key(index)) {
            return Ok(());
        }
        let plan = (|| {
            let costs = self.frozen.as_ref()?;
            let outline = walls::citadel_outline(town, self.request.terrain, &specs.precinct)?;
            let chains = self.arm_chains();
            let site = self.precinct_site(costs, None, &chains);
            walls::survey_citadel(
                &self.writer,
                &self.survey,
                town,
                outline,
                index,
                self.clock,
                &site,
            )
        })();
        if let Some(plan) = plan {
            self.apply_precinct(plan, 0.0)?;
        }
        Ok(())
    }

    /// Apply a surveyed precinct: its `SurveyPrecinct` event, then its raise when it stands at
    /// once (a grown regime's first circuit, a citadel), else it opens its land. Returns whether
    /// the survey was applied.
    fn apply_precinct(&mut self, plan: PrecinctPlan, step: f64) -> Result<bool, String> {
        let PrecinctPlan {
            mut precinct,
            ops,
            open_sectors,
            raise_now,
            warnings,
            ..
        } = plan;
        let kind = EventKind::SurveyPrecinct {
            precinct: precinct.index,
            step,
        };
        if self.event(kind, |_, _| Some(ops))?.is_none() {
            return Ok(false);
        }
        self.warnings.extend(warnings);
        if raise_now {
            let kind = precinct.kind.unwrap_or(WallKind::Hedge);
            let ops = walls::raise_ops(self.writer.graph(), &precinct).unwrap_or_default();
            self.event(walls::raise_event(&precinct, kind), |_, _| Some(ops))?;
            precinct.raised = Some(self.clock);
            precinct.kind = Some(kind);
            self.inside_at_raise = self.households_inside().0;
        } else {
            self.open_sectors = Some(open_sectors);
            self.idle_rings = 0;
        }
        self.precincts.push(precinct);
        Ok(true)
    }

    /// Households inside the standing town walls, and outside them: a quarter is inside when it
    /// was born in a precinct or its land lies within the last raised town circuit.
    pub(super) fn households_inside(&self) -> (f64, f64) {
        let graph = self.writer.graph();
        let walled = self
            .precincts
            .iter()
            .rev()
            .find(|p| matches!(p.purpose, Purpose::Town | Purpose::Camp) && p.raised.is_some())
            .map(|p| &p.enclosed);
        let within = |faces: &[Key]| {
            walled.is_some_and(|w| {
                faces
                    .iter()
                    .filter_map(|k| graph.face_id(k))
                    .filter(|&f| graph.face(f).life.live())
                    .find_map(|f| graph.outline(f))
                    .is_some_and(|s| g::contains(w, g::interior_point(&s)))
            })
        };
        self.quarters.iter().fold((0.0, 0.0), |(inside, outside), q| {
            let housed = q.housed().households();
            if q.intramural || within(&q.faces) {
                (inside + housed, outside)
            } else {
                (inside, outside + housed)
            }
        })
    }

    /// Chains of the main axes, whose crossings are main gates.
    fn arm_chains(&self) -> Vec<Key> {
        self.arms.iter().map(|a| a.chain.clone()).collect()
    }

    fn precinct_site<'s>(
        &'s self,
        costs: &'s CostField,
        harbour: Option<&'s HarbourSide>,
        chains: &'s [Key],
    ) -> PrecinctSite<'s> {
        let specs = self.request.specs;
        PrecinctSite {
            terrain: self.request.terrain,
            wall: &specs.wall,
            spec: &specs.precinct,
            costs,
            household_size: self.spec.household_size,
            neighbour_claims: self.request.neighbour_claims,
            main_chains: chains,
            harbour,
            castle: self.castle.as_ref(),
        }
    }

    /// What the harbour, decided before the wall, gives a precinct survey: the quay line, its
    /// landings, the service row behind it and the harbour road.
    fn harbour_side(&self) -> Option<HarbourSide> {
        let front = self.front.as_ref()?;
        let graph = self.writer.graph();
        let landings = match &self.harbour {
            Some(state) => state
                .landings
                .iter()
                .filter_map(|(_, k)| graph.node_id(k))
                .map(|n| graph.node(n).position)
                .collect(),
            None => vec![front.landing],
        };
        let width = self.request.specs.harbour.works.quay_width + SERVICE_ROW;
        let service_row = g::ribbon(&front.line, &vec![width; front.line.len()])
            .into_iter()
            .max_by(|a, b| g::area(a).total_cmp(&g::area(b)));
        let found = EventKind::Found {
            center: g::Point::default(),
            focus: String::new(),
        }
        .key();
        let road = Some(harbour::road_chain(&found)).filter(|c| !graph.faces_along_chain(c).is_empty());
        Some(HarbourSide {
            habit: self.charter.draws.harbour_enclosure,
            quay: front.line.clone(),
            landings,
            approach: None,
            service_row,
            road,
        })
    }
}

/// Direction in radians of the regional road segment nearest `p`, or 0 without roads.
fn road_bearing(roads: &[Vec<g::Point>], p: g::Point) -> f64 {
    roads
        .iter()
        .flat_map(|r| r.windows(2))
        .map(|w| (g::distance(p, w[0], w[1]).0, (w[1].y - w[0].y).atan2(w[1].x - w[0].x)))
        .min_by(|a, b| a.0.total_cmp(&b.0))
        .map_or(0.0, |(_, angle)| angle)
}
