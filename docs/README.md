# Documentation

Start with the [project README](../README.md), the illustrated atlas [How it works?](https://magna-urbis.org/scientific/index.html) (sources in [scientific/](scientific/README.md)) and the [architectural styles catalogue](https://magna-urbis.org/scientific/catalogue-architecture.html). These are the entry points for the V2 pipeline and its current cultures; dated studies below retain earlier implementation details and proposals.

## Development and usage

- [Repository map and component status](REPOSITORY_LAYOUT.md): maintained applications, developer tools, optional modules and experiments.
- [Contribution guide](../CONTRIBUTING.md): setup, checks and documentation policy.
- [Open technical debt for contributors](CONTRIBUTOR_TECHNICAL_DEBT.md) covers city plan operators, terrain passes, editing tools and file formats.
- [V2 desktop and web setup](../rust/desktop-v2/README.md).
- [Web publication and custom domains](WEB_PUBLICATION_FR.md).
- [Repeatable desktop releases with GitHub Actions](DESKTOP_RELEASE.md).
- [Rust engine](../rust/README.md) and [workshop workflow](RUST_BENCH_PIPELINE.md).
- [Generation and rendering methods](methods/README.md).
- [Stage registry contract](stage-registry-contract.md).
- [Rendering styles and layers](RENDERING.md), [render settings](render-settings.md) and [sharing recipes](MAP_RECIPES.md).

## Architecture, designs and sources

- [Interface design specifications](design/README.md).
- [Surface rendering design](RENDER_SURFACE_DESIGN.md) and [render layers](SURFACE_RENDER_LAYERS.md).
- [Ground materials](GROUND_MATERIAL_MAPPING.md) and [ground texture mapping](GROUND_TEXTURE_MAPPING_V1.md).
- [Urban cultures](CITY_CULTURES.md), [settlement variation](CITY_VARIATION_VARIABLES.md) and [settlement catalog](catalogue_settlements_antiquite_moyen_age_rpg.md).
- [Architectural sources](sources/) and [model documentation](models-release/README.md).
- [Toponym cultural sources](NAMEBENCH_CULTURAL_SOURCES.md) and [grammar sources](NAMEBENCH_GRAMMAR_SOURCES.md).

## Historical studies and reference snapshots

- [Technical and scientific overview, October 14](TECHNICAL_AND_SCIENTIFIC_OVERVIEW.md): method foundations and the architecture before V2 integration; source links follow the current crate layout.
- [Urban redesign study, October 13](REFONTE_GENERATION_URBAINE_2026-10-13.md): complete English version in three parts, followed by an [implementation report](REFONTE_URBAINE_IMPLEMENTATION_2026-10-13.md).
- [City generation scaling review, November 14](CITY_GENERATION_SCALING_2026-11-14.md) and [growth-until-housed proposal, November 15](GROW_UNTIL_HOUSED_2026-11-15.md): measured optimisation work and a remaining design proposal, rather than current performance promises.
- [Earlier 79-culture architectural reference](CATALOGUE_ARCHITECTURE_FR.md): historical French recipe descriptions, with links to the maintained 115-culture catalogue.

English is the preferred language for maintained documentation. French-only reference documents remain where there is no complete English equivalent, including the [V2 usage guide](V2_ATELIER_FR.md), [Namebench integration](NAMEBENCH_TOPONYMS_FR.md) and [inhabited-region design](DESIGN_REGIONS_HABITEES_FR.md). The illustrated atlas retains its bilingual publication assets.

Dated studies and proposals describe their stated scope and date, rather than guaranteeing current implementation. AI instructions, session notes, reviews, diagnostic captures and validation campaigns are local working material, excluded from Git. Published illustrations, attribution, scientific references, reproducible fixtures and their required metadata remain versioned with the documentation or code that uses them.
