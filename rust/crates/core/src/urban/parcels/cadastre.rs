//! Block cut results, coverage accounts and reuse across probe cadastres.

use super::camp;
use super::contacts::Front;
use crate::urban::{Layout, Morph, Parcel, ParcelConfig, Point, Shape, warnings};
use crate::urban::geometry::area;

/// One block's lots, warnings and area accounts, merged in block order.
#[derive(Default, Clone)]
pub(super) struct BlockCut {
    pub(super) parcels: Vec<Parcel>,
    pub(super) warnings: Vec<String>,
    pub(super) diagnostics: crate::urban::PartitionDiagnostics,
    /// Set when the coverage accounts of the lots are still to be added
    /// (`Coverage`): the index their warning takes among `warnings`.
    pub(super) uncovered: Option<usize>,
}

/// The coverage accounts of a cut block: the union of its lots against the
/// block (covered, residual and overlap areas) and whether they earn the
/// residual warning. A pure function of the lot shapes, in order, and of the
/// block outline. The trim's probe cadastre reads none of it and skips it;
/// the published cadastre adds it (`apply`), memoised with the cut.
#[derive(Clone, Copy)]
struct Coverage {
    covered: f64,
    residual: f64,
    overlap: f64,
    warn: bool,
}
impl Coverage {
    fn of(parcels: &[Parcel], block: &Shape) -> Self {
        // Boolean pieces retain exclusions as holes; an unresolved hole is
        // never replaced by a filled exterior ring.
        let actual: f64 = parcels.iter().map(|p| area(&p.shape)).sum();
        let expected = area(block);
        let merged = crate::urban::geometry::union(
            &parcels
                .iter()
                .map(|p| p.shape.clone())
                .collect::<Vec<_>>(),
        );
        let covered = merged.iter().flat_map(|s| crate::urban::geometry::intersection(block, s)).map(|s| area(&s)).sum::<f64>();
        let union_area = merged.iter().map(area).sum::<f64>();
        let residual = (expected - covered).max(0.0) + (union_area - covered).max(0.0);
        let overlap = (actual - union_area).max(0.0);
        Self { covered, residual, overlap, warn: residual + overlap > expected.max(1.0) * 1e-5 }
    }
    /// Adds these accounts and their warning to a cut still without them.
    fn apply(&self, cut: &mut BlockCut, bi: usize) {
        let Some(at) = cut.uncovered.take() else { return };
        cut.diagnostics.covered_area += self.covered;
        cut.diagnostics.residual_area += self.residual;
        cut.diagnostics.overlap_area += self.overlap;
        if self.warn {
            let (residual, overlap) = (self.residual, self.overlap);
            cut.warnings.insert(
                at,
                warnings::parcel_coverage(bi, residual, overlap),
            );
        }
    }
}

/// Memoised cuts of ordinary blocks across the probes of one quarters run.
static BLOCK_CUTS: crate::urban::probe_cache::Memo<std::sync::Arc<StoredCut>> =
    crate::urban::probe_cache::Memo::new();
/// Block cuts served by the memo and block cuts computed since the last
/// `URBAN_PROFILE` line.
static MEMO_HITS: std::sync::atomic::AtomicUsize = std::sync::atomic::AtomicUsize::new(0);
static MEMO_MISSES: std::sync::atomic::AtomicUsize = std::sync::atomic::AtomicUsize::new(0);
/// `URBAN_VERIFY_MEMO=1`: every memo hit is also recomputed and compared.
fn verify_memo() -> bool {
    static ON: std::sync::OnceLock<bool> = std::sync::OnceLock::new();
    *ON.get_or_init(|| std::env::var("URBAN_VERIFY_MEMO").is_ok())
}

/// Everything the cut of an ordinary (non-camp) block reads, after its
/// morphology has been resolved. The layout is only read through these: the
/// block itself, its pressure, its wall faces, the organic budget, and its
/// street contacts (`frontages` of the outline) with the roles of their
/// streets (access kinds and gates read those roles).
pub(super) struct ProbeInputs<'a> {
    pub(super) seed: &'a str,
    pub(super) cfg: &'a ParcelConfig,
    pub(super) layout: &'a Layout,
    pub(super) fronts: &'a [Front],
    pub(super) bi: usize,
    pub(super) block: &'a crate::urban::Block,
    pub(super) block_id: &'a str,
    pub(super) fork_label: &'a str,
    pub(super) culture: &'a str,
    pub(super) block_culture: &'a str,
    pub(super) period: &'a str,
    pub(super) route_op: &'a str,
    pub(super) operator: &'a str,
    pub(super) zone: &'a str,
    pub(super) dense_souk: bool,
    pub(super) occupation: f64,
    pub(super) morph: &'a Morph,
    pub(super) faces: &'a [(Point, Point)],
    pub(super) plan: Option<&'a crate::urban::CapacityPlan>,
    pub(super) borrowed: bool,
}
impl ProbeInputs<'_> {
    /// The exact key, and the global indices of the streets it names (sorted):
    /// streets enter the key by their rank in that list, so a block whose
    /// streets were renumbered by a pruning elsewhere still hits.
    fn key(&self) -> (crate::urban::probe_cache::Key, Vec<usize>) {
        let (layout, block) = (self.layout, self.block);
        let mut k = crate::urban::probe_cache::Key::new("parcels.block/v1");
        // Of the parcel options the cut reads directly, only this one; every other
        // option reaches it through the resolved values keyed below (culture,
        // period, operator, zone, morphology), so the probe options and the
        // request's equivalent spelling share their cuts.
        k.str(self.seed).str(&layout.key).bool(self.cfg.street_aligned_homes);
        k.shape(&block.shape).str(&block.kind).str(&block.zone).point(block.axis).usize(block.quarter);
        match block.phase {
            Some(p) => k.bool(true).usize(p),
            None => k.bool(false),
        };
        k.str(self.block_id).str(self.fork_label).str(self.culture).str(self.block_culture)
            .str(self.period).str(self.route_op).str(self.operator).str(self.zone)
            .bool(self.dense_souk).f64(self.occupation).json(&self.morph.value);
        k.usize(self.faces.len());
        for &(a, b) in self.faces {
            k.point(a).point(b);
        }
        match self.plan {
            Some(c) => k.bool(true).f64(c.densify).f64(c.vacancy).f64(c.garden_share),
            None => k.bool(false),
        };
        k.bool(self.borrowed);
        match camp::organic_budget(layout, self.bi) {
            Some(n) => k.bool(true).usize(n),
            None => k.bool(false),
        };
        // The cut reads the network only through the block's street contacts
        // and the roles of their streets (access kinds, gates).
        let mut streets: Vec<usize> = self.fronts.iter().map(|f| f.street).collect();
        streets.sort_unstable();
        streets.dedup();
        // A front without a recorded street falls back to street 0.
        k.bool(streets.first() == Some(&0));
        match layout.streets.first() {
            Some(s) => k.bool(true).str(&s.role),
            None => k.bool(false),
        };
        k.usize(streets.len());
        for &si in &streets {
            k.str(&layout.streets[si].role);
        }
        k.usize(self.fronts.len());
        for f in self.fronts {
            let local = streets.binary_search(&f.street).expect("listed street");
            k.point(f.a).point(f.b).usize(f.rank).usize(local).bool(f.shared).bool(f.gate);
        }
        (k, streets)
    }
}

/// A memoised cut with the block and street numbering it was computed under.
/// The cut is kept without its coverage accounts, which the first published
/// cut of the block computes once.
struct StoredCut {
    bi: usize,
    streets: Vec<usize>,
    cut: BlockCut,
    coverage: std::sync::OnceLock<Coverage>,
}
impl StoredCut {
    fn indices(cut: &mut BlockCut) -> impl Iterator<Item = &mut usize> {
        cut.parcels.iter_mut().flat_map(|p| {
            p.contacts.iter_mut().map(|c| &mut c.street)
                .chain(p.access.as_mut().and_then(|a| a.street.as_mut()))
        })
    }
    fn store(key: crate::urban::probe_cache::Key, streets: Vec<usize>, cut: &BlockCut, bi: usize, coverage: Option<Coverage>) {
        // The block number is not part of the key: it must be recoverable from
        // the cut (every lot's `block`, the warnings' prefix) to be renumbered.
        if cut.parcels.iter().any(|p| p.block != bi)
            || cut.warnings.iter().any(|w| warnings::block_warning_index(w, bi).is_none())
        {
            return;
        }
        let mut cut = cut.clone();
        // Only streets of the key (or the literal fallback 0) may be named.
        if !Self::indices(&mut cut).all(|s| *s == 0 || streets.binary_search(s).is_ok()) {
            return;
        }
        let stored = StoredCut { bi, streets, cut, coverage: std::sync::OnceLock::new() };
        if let Some(c) = coverage {
            let _ = stored.coverage.set(c);
        }
        BLOCK_CUTS.put(key, std::sync::Arc::new(stored));
    }
    /// The cut renumbered onto the current block and streets (same key, so same
    /// street count).
    fn replay(&self, streets: &[usize], bi: usize) -> Option<BlockCut> {
        if streets.len() != self.streets.len() {
            return None;
        }
        let mut cut = self.cut.clone();
        for s in Self::indices(&mut cut) {
            if let Ok(r) = self.streets.binary_search(s) {
                *s = streets[r];
            } else if *s != 0 {
                return None;
            }
        }
        if bi != self.bi {
            for p in &mut cut.parcels {
                p.block = bi;
            }
            for w in &mut cut.warnings {
                let index = warnings::block_warning_index(w, self.bi)?;
                w.replace_range(index, &bi.to_string());
            }
        }
        Some(cut)
    }
}

pub(super) fn cut_with_memo(
    inputs: ProbeInputs<'_>,
    memoise: bool,
    covered: bool,
    run: impl FnOnce() -> BlockCut,
) -> BlockCut {
    let bi = inputs.bi;
    let block = &inputs.block.shape;
    let probe = memoise.then(|| inputs.key());
    let mut replayed = None;
    if let Some((key, streets)) = &probe {
        if let Some(hit) = BLOCK_CUTS.get(key) && let Some(mut cut) = hit.replay(streets, bi) {
            MEMO_HITS.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
            if !verify_memo() {
                if covered {
                    // The replayed lots have the stored shapes, in order.
                    let coverage = *hit.coverage.get_or_init(|| Coverage::of(&cut.parcels, block));
                    coverage.apply(&mut cut, bi);
                }
                return cut;
            }
            replayed = Some(cut);
        } else {
            MEMO_MISSES.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
        }
    }
    let mut cut = run();
    if let Some(r) = replayed {
        let text = |c: &BlockCut| serde_json::to_string(&(&c.parcels, &c.warnings, &c.diagnostics)).unwrap();
        if text(&r) != text(&cut) { eprintln!("MEMO MISMATCH block {bi}"); }
    }
    let coverage = (covered && cut.uncovered.is_some()).then(|| Coverage::of(&cut.parcels, block));
    if let Some((key, streets)) = probe {
        StoredCut::store(key, streets, &cut, bi, coverage);
    }
    if let Some(c) = coverage {
        c.apply(&mut cut, bi);
    }
    cut
}

pub(super) fn clear_block_cache() {
    BLOCK_CUTS.clear();
}

pub(super) fn profile_memo() {
    eprintln!("  parcels.cut.memo: hits={} misses={}", MEMO_HITS.swap(0, std::sync::atomic::Ordering::Relaxed), MEMO_MISSES.swap(0, std::sync::atomic::Ordering::Relaxed));
}
