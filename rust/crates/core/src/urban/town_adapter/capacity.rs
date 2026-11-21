//! Household capacity of a single quarter at its birth conditions.

use magna_urbis_town::growth::{Capacity, CapacityBlock, CapacityInputs};

use super::super::{
    Block, GrowthPhase, Layout, LayoutConfig, ParcelConfig, Quarter, Street, Surface,
    footprint::capacity::housing_probe_programme, geometry as g, parcels, programme, resolve,
};
use super::layout::frontage_axis;

pub(super) struct QuarterCapacity<'a, 'terrain> {
    pub seed: &'a str,
    pub site_key: &'a str,
    pub culture: &'a str,
    pub config: &'a LayoutConfig,
    pub surface: Surface<'terrain>,
}

impl Capacity for QuarterCapacity<'_, '_> {
    fn households(&self, blocks: &[CapacityBlock], inputs: CapacityInputs<'_>) -> f64 {
        if blocks.is_empty() || inputs.fill_level <= 0.0 {
            if std::env::var_os("URBAN_PROFILE").is_some() {
                eprintln!("  growth.capacity none: no buildable block");
            }
            return 0.0;
        }
        let counted = self.probe_quarter(blocks, inputs);
        if std::env::var_os("URBAN_PROFILE").is_some() && !counted.as_ref().is_ok_and(|&h| h > 0.0) {
            let fronts: usize = blocks.iter().map(|b| b.frontage_edges.len()).sum();
            eprintln!(
                "  growth.capacity none: blocks={} fronts={fronts} zone={} result={counted:?}",
                blocks.len(),
                inputs.zone
            );
        }
        counted.unwrap_or(0.0)
    }
}

impl QuarterCapacity<'_, '_> {
    fn probe_quarter(
        &self,
        blocks: &[CapacityBlock],
        inputs: CapacityInputs<'_>,
    ) -> Result<f64, String> {
        let cfg = LayoutConfig {
            preset: self.config.preset.clone(),
            recipe: inputs.recipe.into(),
            zone: inputs.zone.into(),
            density: inputs.density,
            params: self.config.params.clone(),
            tissue: self.config.tissue.clone(),
            programme: self.config.programme.clone(),
            ..LayoutConfig::default()
        };
        let parcel_cfg = ParcelConfig {
            preset: cfg.preset.clone(),
            recipe: cfg.recipe.clone(),
            zone: cfg.zone.clone(),
            density: cfg.density,
            params: cfg.params.clone(),
            ..ParcelConfig::default()
        };
        let morph = resolve(
            self.culture,
            &cfg.preset,
            inputs.recipe,
            inputs.zone,
            inputs.density,
            &cfg.params,
            "parcels",
        )?;
        let pressure = inputs.pressure.clamp(0.0, 1.0);
        let pressure = if inputs.intramural && pressure > 0.0 {
            0.65 + 0.35 * pressure
        } else {
            pressure
        };
        let shapes: Vec<_> = blocks.iter().map(|b| b.outline.clone()).collect();
        let area = shapes.iter().map(g::area).sum::<f64>();
        // The allocator needs a local demographic scale for its household and storey rules.
        let density = morph.value["density"][inputs.zone]
            .as_f64()
            .unwrap_or(100.0);
        let population = (area * density / 10_000.0).round() as u32;
        let environment = blocks
            .iter()
            .enumerate()
            .map(|(block, b)| {
                let (center, height, slope) = programme::block_grade(self.surface, &b.outline);
                programme::BlockEnvironment {
                    block,
                    pressure,
                    slope,
                    wet: programme::block_is_wet(self.surface, &b.outline, center),
                    height,
                    waterfront: false,
                    district: None,
                    water: String::new(),
                    water_height: 0.0,
                }
            })
            .collect();
        // Frontage edges already sit on the kerb, so they need no additional offset.
        let streets = blocks
            .iter()
            .flat_map(|b| &b.frontage_edges)
            .map(|edge| Street {
                key: None,
                path: edge.to_vec(),
                widths: vec![0.0; 2],
                rank: 2,
                role: "street".into(),
            })
            .collect();
        let quarter_shape = shapes[0].clone();
        let programme =
            housing_probe_programme(self.site_key, self.culture, &cfg, environment, population);
        let layout = Layout {
            config: Some(cfg),
            programme: Some(programme),
            key: self.site_key.into(),
            culture: self.culture.into(),
            center: g::centroid(&quarter_shape),
            quarters: vec![Quarter {
                key: None,
                shape: quarter_shape,
                phase: 0,
                zone: inputs.zone.into(),
            }],
            streets,
            regional_road_result: None,
            blocks: blocks
                .iter()
                .map(|b| Block {
                    key: None,
                    shape: b.outline.clone(),
                    quarter: 0,
                    kind: "block".into(),
                    axis: frontage_axis(b.frontage_edges.iter().copied()),
                    zone: inputs.zone.into(),
                    phase: Some(0),
                    fill: Some(inputs.fill_level),
                })
                .collect(),
            warnings: vec![],
            enclosures: vec![],
            phases: vec![GrowthPhase {
                culture: self.culture.into(),
                kind: "quarter".into(),
                recipe: inputs.recipe.into(),
                zone: inputs.zone.into(),
                population: f64::from(population),
                target_area: area,
                shapes,
            }],
            archetype: String::new(),
            structure: None,
            claim: Default::default(),
        };
        let mut partition =
            parcels::generate_quarter_probe(self.seed, &layout, &parcel_cfg, &morph, pressure)?;
        programme::allocate_quarter_probe(&layout, &mut partition, inputs.intramural);
        Ok(partition
            .programme
            .iter()
            .flat_map(|p| &p.allocations)
            .map(|a| a.households)
            .sum())
    }
}
