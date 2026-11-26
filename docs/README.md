# Documentation

New here? Start with the [project README](../README.md), the illustrated atlas **[How it works?](https://magna-urbis.org/scientific/index.html)** (sources in [scientific/](scientific/README.md)) and the **[architectural styles catalogue](https://magna-urbis.org/scientific/catalogue-architecture.html)**. Questions are welcome on [Discord](https://discord.gg/3yFq8t8Q2W) and in [Discussions](https://github.com/dunkean/magna-urbis/discussions).

## Using Magna Urbis

- [Map styles, layers, diagnostics and masks](RENDERING.md) ([FR](RENDERING_FR.md)) and [sharing recipes](MAP_RECIPES.md).
- [Importing an Azgaar FMG burg](AZGAAR_IMPORT.md) and the [city iframe preview / embed](AZGAAR_EMBED.md).
- [Underdark](UNDERDARK.md) ([FR](UNDERDARK_FR.md)).
- [Fantasy cartography layers](FANTASY_CARTOGRAPHY.md).
- [Desktop release notes](DESKTOP_RELEASE_NOTES.md).
- French-only guides: [V2 workshop guide](V2_ATELIER_FR.md), [map appearance settings](render-settings.md), [urban editing contract](URBAN_EDITING_FR.md).

## Contributing

- [Contribution guide](../CONTRIBUTING.md): setup, checks and documentation policy.
- [Repository map and component status](REPOSITORY_LAYOUT.md).
- [V2 desktop and web setup](../rust/desktop-v2/README.md), the [Rust engine](../rust/README.md) and the [workshop workflow](RUST_BENCH_PIPELINE.md).
- [Generation and rendering methods](methods/README.md) and the [stage registry contract](stage-registry-contract.md).
- Releases: [desktop releases with GitHub Actions](DESKTOP_RELEASE.md), [web publication](WEB_PUBLICATION_FR.md) (FR), [preparing a desktop release](V2_RELEASE_FR.md) (FR).

## Cultures, buildings and names

- [Urban cultures](CITY_CULTURES.md), [world atlas of settlement morphologies](styles_architecturaux_mondiaux_city_mapper.md), [settlement catalogue, Antiquity to the Middle Ages](catalogue_settlements_antiquite_moyen_age_rpg.md), [modern cities review](Modern_cities_review.md).
- [Settlement variation variables](CITY_VARIATION_VARIABLES.md), [building forms](BUILDING_FORMS.md) ([FR](BUILDING_FORMS_FR.md)), [building texture library](BUILDING_TEXTURE_LIBRARY.md), [architectural sources](sources/).
- [Place-name cultural sources](NAMEBENCH_CULTURAL_SOURCES.md), [grammar sources](NAMEBENCH_GRAMMAR_SOURCES.md), [Namebench integration](NAMEBENCH_TOPONYMS_FR.md) (FR).
- French-only: [cultures, environments and place names](CULTURE_ENVIRONMENTS_FR.md), [named, inhabited and historical regions](DESIGN_REGIONS_HABITEES_FR.md), [regional population](REGIONAL_POPULATION_FR.md), [resource tile refinement](RESOURCE_TILE_REFINEMENT.md), [Neural Earth resource methods](ressources_transfert_neural_earth.md).

## Design and engine notes

- [Design specifications](design/README.md): interface, town engine 2, street graph, planner stability, render composition, terrain controls.
- [Surface and ground rendering](surface/): surface world design, render layers, ground materials, canopy, geology, vegetation and water notes. See also [ground material mapping](GROUND_MATERIAL_MAPPING.md) and the [texture generation review](RENDER_REVIEW.md).
- [Neural relief models](models-release/README.md).
- [Technical and scientific overview, October 14](TECHNICAL_AND_SCIENTIFIC_OVERVIEW.md): method foundations before V2 integration.
- [Devlogs](devlog/kofi-devlogs.md).

## Archive

The [archive](archive/README.md) keeps dated studies, audits and release verification records: the October urban redesign study, scaling and road audits, parity reports, relief and river studies, and desktop/web qualification campaigns. They describe their stated date and scope, not the current implementation.

---

English is the preferred language for maintained documentation. French-only documents remain where there is no complete English equivalent yet; translations are welcome. AI instructions, session notes, reviews, diagnostic captures and validation campaigns are local working material and stay out of Git. Published illustrations, attribution, scientific references, reproducible fixtures and their required metadata remain versioned with the documentation or code that uses them.
