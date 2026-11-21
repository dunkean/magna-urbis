//! Validate parallel cuts against the street network in serial quarter order.

use super::street_index::Bins;
use super::subdivision::Piece;
use crate::urban::{GrowthPhase, Point, Street, par};

/// A read of the street network by a quarter cut: what the network before the
/// pass plus the cut's own streets gave (`own`), and the answer the cut used
/// (`seen`, with the other quarters' streets it was shown). A cut depends on
/// the other quarters only through these reads, so it is exact for the true
/// earlier streets when every read gives the same answer with them.
pub(super) enum Read {
    Near {
        p: Point,
        max_rank: usize,
        reach: f64,
        own: Option<f64>,
        seen: Option<f64>,
    },
    Cross {
        path: Vec<Point>,
        own: bool,
        seen: bool,
    },
}
/// Streets of other quarters shown to a cut, with their bins.
pub(super) type Layer<'a> = (&'a [Street], &'a Bins);
impl Read {
    /// Whether the read gives the answer the cut used when the other
    /// quarters' streets are `layers`.
    fn holds(&self, layers: &[Layer<'_>]) -> bool {
        match self {
            Read::Near {
                p,
                max_rank,
                reach,
                own,
                seen,
            } => {
                let answer = layers
                    .iter()
                    .filter_map(|(s, b)| b.nearest(*p, s, *max_rank, *reach))
                    .map(|v| v.0)
                    .chain(*own)
                    .min_by(f64::total_cmp);
                answer.map(f64::to_bits) == seen.map(f64::to_bits)
            }
            Read::Cross { path, own, seen } => {
                (*own || layers.iter().any(|(s, b)| b.crosses(path, s))) == *seen
            }
        }
    }
}

/// One quarter cut: its pieces, the streets it added, its edited phase.
pub(super) type CutQuarter = (Vec<Piece>, Vec<Street>, Option<GrowthPhase>);

pub(super) struct OrderedCuts {
    pub(super) pieces: Vec<Vec<Piece>>,
    pub(super) added: Vec<Street>,
    pub(super) edited_phases: Vec<(usize, GrowthPhase)>,
}

/// Cut against the base network in parallel, then retry any cut whose reads
/// differ when the accepted streets of earlier quarters are also visible.
pub(super) fn ordered_cuts(
    count: usize,
    run: impl Fn(usize, &[Layer<'_>]) -> (Result<CutQuarter, String>, Vec<Read>) + Sync,
    lap: &impl Fn(&str),
) -> Result<OrderedCuts, String> {
    let mut pieces = Vec::with_capacity(count);
    let mut added = vec![];
    let mut edited_phases = vec![];
    let streets_of = |c: &(Result<CutQuarter, String>, Vec<Read>)| -> Vec<Street> {
        c.0.as_ref().map_or_else(|_| vec![], |r| r.1.clone())
    };
    let mut results: Vec<Option<_>> = par::range(count, |i| Some(run(i, &[])));
    lap("split.first_cut");
    let width = par::threads();
    let mut added_bins = Bins::new(20.0, usize::MAX);
    let (mut recut, mut rounds) = (0, 0);
    for i in 0..count {
        added_bins.sync(&added);
        let finals: Layer<'_> = (&added, &added_bins);
        let current = results[i].as_ref().expect("quarter cut");
        if !current.1.iter().all(|r| r.holds(&[finals])) {
            // Recut this quarter with the true earlier streets, and in the
            // same parallel round the next quarters that also fail, each shown
            // the window's current streets before it as a guess: they are
            // validated again when the serial pass reaches them.
            let mut members = vec![(i, vec![])];
            let mut guess = streets_of(current);
            let mut guess_bins = Bins::new(20.0, usize::MAX);
            for k in i + 1..count.min(i + 32 * width) {
                if members.len() >= width {
                    break;
                }
                guess_bins.sync(&guess);
                let next = results[k].as_ref().expect("quarter cut");
                if !next
                    .1
                    .iter()
                    .all(|r| r.holds(&[finals, (&guess, &guess_bins)]))
                {
                    members.push((k, guess.clone()));
                }
                guess.extend(streets_of(next));
            }
            recut += members.len();
            rounds += 1;
            let redone = par::map(&members, |_, (k, guess)| {
                let mut bins = Bins::new(20.0, usize::MAX);
                bins.sync(guess);
                run(*k, &[finals, (guess, &bins)])
            });
            for ((k, _), c) in members.iter().zip(redone) {
                results[*k] = Some(c);
            }
        }
        // Exact now: kept by its reads, or just cut with the true streets.
        let (result, _) = results[i].take().expect("quarter cut");
        let (pcs, own, edited_phase) = result?;
        pieces.push(pcs);
        added.extend(own);
        if let Some(phase) = edited_phase {
            edited_phases.push((i, phase));
        }
    }
    if std::env::var("URBAN_PROFILE").is_ok() {
        eprintln!(
            "    split: {recut} recuts of {} quarters in {rounds} rounds",
            count
        );
    }
    lap("split");
    Ok(OrderedCuts { pieces, added, edited_phases })
}
