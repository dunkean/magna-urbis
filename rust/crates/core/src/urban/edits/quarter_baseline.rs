//! The pre-redraw inputs used by the cadastre and its programme.
//!
//! The selected quarter can consume a different share of the city's bounded
//! housing and service budget. Allocation then changes which parcels are
//! merged into yards, even in blocks whose geometry and pressure stayed put.
//! Replay the source's allocation for those blocks before allocating the
//! edited ones, using the parcel options of the current request.
use super::super::*;
use super::{blocks, quarter_parts, stripped, structural};
use std::collections::{BTreeMap, BTreeSet};

/// The common part is already in the edited layout. Only replaced geometry
/// is retained, with no nested layout or computed parcels in the payload.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(untagged)]
enum Source<T> {
    Retained(usize),
    Replaced(T),
}

impl<T: Clone + Serialize> Source<T> {
    fn capture(original: Vec<T>, edited: &[T]) -> Vec<Self> {
        let key = |item: &T| serde_json::to_vec(item).expect("source geometry");
        let edited: BTreeMap<_, _> = edited
            .iter()
            .enumerate()
            .rev()
            .map(|(i, item)| (key(item), i))
            .collect();
        original
            .into_iter()
            .map(|item| match edited.get(&key(&item)) {
                Some(&index) => Self::Retained(index),
                None => Self::Replaced(item),
            })
            .collect()
    }

    fn restore(items: &[Self], edited: &[T]) -> Option<Vec<T>> {
        items
            .iter()
            .map(|item| match item {
                Self::Retained(index) => edited.get(*index).cloned(),
                Self::Replaced(value) => Some(value.clone()),
            })
            .collect()
    }
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct QuarterBaseline {
    center: Point,
    blocks: Vec<Source<Block>>,
    quarters: Vec<Source<Quarter>>,
    streets: Vec<Source<Street>>,
    phases: Vec<Source<GrowthPhase>>,
    enclosures: Vec<Source<Enclosure>>,
    quays: Vec<Source<macroplan::harbour::Quay>>,
    spring_sites: Vec<Source<springs::SpringSite>>,
    gate_village_centers: Vec<Point>,
    centers: Vec<UrbanCenter>,
    districts: Vec<UrbanDistrict>,
    metrics: UrbanMetrics,
    programme: UrbanProgramme,
}

pub(in crate::urban) fn retain(layout: &mut Layout, baseline: Layout) {
    let (Some(original), Some(programme)) = (baseline.structure, baseline.programme) else {
        return;
    };
    let Some(edited) = layout.structure.as_mut() else {
        return;
    };
    edited.quarter_baseline = Some(Box::new(QuarterBaseline {
        center: baseline.center,
        blocks: Source::capture(baseline.blocks, &layout.blocks),
        quarters: Source::capture(baseline.quarters, &layout.quarters),
        streets: Source::capture(baseline.streets, &layout.streets),
        phases: Source::capture(baseline.phases, &layout.phases),
        enclosures: Source::capture(baseline.enclosures, &layout.enclosures),
        quays: Source::capture(original.quays, &edited.quays),
        spring_sites: Source::capture(original.spring_sites, &edited.spring_sites),
        gate_village_centers: original.gate_village_centers,
        centers: original.centers,
        districts: original.districts,
        metrics: original.metrics,
        programme,
    }));
}

pub(in crate::urban) fn restore(
    input: &Layout,
    config: &ParcelConfig,
) -> Option<(Layout, ParcelConfig)> {
    let restored = blocks::restore(input);
    let input = restored.as_ref().unwrap_or(input);
    let edited = input.structure.as_ref()?;
    let source = edited.quarter_baseline.as_ref()?;
    let block_overrides = &config.overrides.blocks;
    let reverse: BTreeMap<_, _> = source
        .blocks
        .iter()
        .enumerate()
        .filter_map(|(i, entry)| match entry {
            Source::Retained(index) => Some((*index, i)),
            Source::Replaced(_) => None,
        })
        .collect();
    let mut config = config.clone();
    // Numeric block edits address the edited plan. Translate their source
    // indices before applying them to the original plan.
    config.overrides.blocks = block_overrides
        .iter()
        .filter_map(|(key, edit)| {
            let (index, part) = blocks::parse_key(key)?;
            let index = reverse.get(&index)?;
            let key = if part == 0 {
                index.to_string()
            } else {
                format!("{index}/{part}")
            };
            Some((key, edit.clone()))
        })
        .collect();
    let cfg = input.config.as_ref().map(|cfg| {
        let mut cfg = stripped(&quarter_parts::base(cfg));
        cfg.block_edits = None;
        cfg
    });
    let base = Layout {
        config: cfg,
        programme: Some(source.programme.clone()),
        key: input.key.clone(),
        culture: input.culture.clone(),
        center: source.center,
        quarters: Source::restore(&source.quarters, &input.quarters)?,
        streets: Source::restore(&source.streets, &input.streets)?,
        blocks: Source::restore(&source.blocks, &input.blocks)?,
        warnings: vec![],
        enclosures: Source::restore(&source.enclosures, &input.enclosures)?,
        phases: Source::restore(&source.phases, &input.phases)?,
        archetype: input.archetype.clone(),
        structure: Some(UrbanStructure {
            mechanism: edited.mechanism.clone(),
            family: edited.family.clone(),
            centers: source.centers.clone(),
            districts: source.districts.clone(),
            metrics: source.metrics.clone(),
            quays: Source::restore(&source.quays, &edited.quays)?,
            spring_sites: Source::restore(&source.spring_sites, &edited.spring_sites)?,
            gate_village_centers: source.gate_village_centers.clone(),
            ..Default::default()
        }),
        claim: Default::default(),
    };
    Some((base, config))
}

/// Occupation is frozen only where the original lot is still present with
/// the same geometry. Index shifts from a redraw or block split are harmless.
pub(in crate::urban) fn retained_lots(
    edited: &Layout,
    parcels: &[Parcel],
    baseline: &Layout,
    original: &Partition,
) -> BTreeSet<String> {
    let source: BTreeMap<_, _> = original
        .parcels
        .iter()
        .map(|p| (p.id.as_str(), p))
        .collect();
    let changed = |quarter: usize| {
        edited.config.as_ref().is_some_and(|cfg| {
            cfg.overrides
                .quarters
                .get(&quarter.to_string())
                .is_some_and(structural)
                || cfg
                    .quarter_edits
                    .as_ref()
                    .is_some_and(|e| e.parts.iter().any(|p| p.quarter == quarter))
        })
    };
    let same_block = |a: usize, b: usize| {
        edited
            .blocks
            .get(a)
            .zip(baseline.blocks.get(b))
            .is_some_and(|(a, b)| {
                !changed(a.quarter)
                    && a.quarter == b.quarter
                    && a.phase == b.phase
                    && a.zone == b.zone
                    && a.kind == b.kind
                    && a.axis == b.axis
                    && a.shape == b.shape
            })
    };
    parcels
        .iter()
        .filter(|p| {
            source.get(p.id.as_str()).is_some_and(|prev| {
                p.shape == prev.shape
                    && p.use_kind == prev.use_kind
                    && p.family == prev.family
                    && same_block(p.block, prev.block)
            })
        })
        .map(|p| p.id.clone())
        .collect()
}
