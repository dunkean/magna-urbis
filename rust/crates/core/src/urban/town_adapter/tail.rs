//! Finish the graph layout for the programme and cadastre.

use super::super::{
    Layout, LayoutConfig, Site, Surface, access, fortification, harbour_furniture, kinds,
    neighbours, programme, resolve, springs, with_tissue,
};

pub(super) fn finish(
    seed: &str,
    key_seed: &str,
    layout: &mut Layout,
    site: &Site,
    config: &LayoutConfig,
    kind: kinds::Kind,
    surface: Surface<'_>,
) -> Result<(), String> {
    let morph = resolve(
        &layout.culture,
        &config.preset,
        &config.recipe,
        if config.zone == "auto" {
            "core"
        } else {
            &config.zone
        },
        config.density,
        &config.params,
        "quarters",
    )?;
    let morph = with_tissue(morph, &config.tissue);
    let archetype = layout.archetype.clone();
    kinds::stamp(layout, kind, config);
    if !archetype.is_empty() {
        layout.archetype = archetype;
    }
    access::refine(layout, config, &morph, surface);
    fortification::prepare_options(layout, config, surface);
    springs::reserve(layout, site, surface, config);
    // Neighbour and spring cuts can change block indices before the programme reads them.
    neighbours::settle(seed, layout, site, surface);
    access::summarize(layout, config);
    programme::prepare(layout, site.population, &config.programme, surface)?;
    fortification::finish_options(layout, config, surface);
    kinds::finish(layout, kind, config);
    harbour_furniture::furnish(key_seed, layout, site.population, config, surface);
    layout.claim = neighbours::claim(layout);
    Ok(())
}
