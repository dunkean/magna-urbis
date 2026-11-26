# Named, Inhabited and Historical Regions

5 November 2026: Design proposal, not implemented. Scope: Magna Urbis, Chronos, Lineage Lab and Namebench.

## 1. Architecture: Making Chronos the Social Memory of the World

**I recommend a targeted redesign of the Chronos core: a temporal graph of social groups and events, of which genealogy is one component.** The v3 study already describes this direction; the prototype remains an annual loop over sites, with flat institutions. It already imports Namebench and Lineage Lab, but its demography evolves separately from that of the imported people. Adding connectors would not resolve this inconsistency.

| Component | Proposed responsibility | To reuse or complete |
|---|---|---|
| Magna Urbis | Places, geometry, roads, architecture and exploration | Existing site keys and naming; add the dated social layer |
| Chronos | Groups, affiliations, powers, events, causality and names over time | Keep addressed randomness, provenance, replay and validators; replace the flat social model |
| Lineage Lab | Births, deaths, unions, kinship, residences and headcounts | Start with `full`; then adapt the hybrid and the temporal control |
| Namebench | Onomastic corpora and candidate generators | Export frozen, typed and versioned packages |

**The graph has four simple objects:**

- `Place`: region, establishment, district or building; spatial anchor independent of inhabitants.
- `SocialEntity`: person, household, house, guild, community, political power; persistent identity and typed attributes.
- Dated `Relation`: belongs to, resides at, governs, owns, allies with, descends from. A person may belong to several groups simultaneously.
- `Event`: interval, actors, scope, preconditions, effects and causes; `NameUsage` records the names, languages and periods of use of an identity.

Groups carry activities, resources, objectives and decision rules; their creation, splitting and dissolution are events. Functions and mandates are dated, including when authority is collective.

The views world → region → community → household → person are projections of this graph. **Territory, community and authority remain distinct**: a guild spans several cities; a region hosts several communities. Composition is therefore not a single tree. Causes form an acyclic graph; breaking a war down into campaigns does not establish its causality.

Time is also multi-scale: century → period → year, then point-in-time detail. Chronos references existing geographic identities, notably those of Neural Earth when available; it does not build a second, competing spatial division.

## 2. Generation: One Demography, Coherent Names and Pasts

**Inputs:** map, seed, period, initial populations, cultural profiles and possible author-defined events. For the first version, Magna Urbis headcounts explicitly become those of the initial year; the displayed present results from the evolution. Reconstructing a past that exactly leads to an imposed present will be a separate task.

**1 — Anchor identities.** Assign a persistent `RegionId` and `PlaceId` values based on site keys, never on their position in a list. A change to terrain or placement invalidates the affected dependencies; a renaming preserves the identity. Author changes create a new revision of the world.

**2 — Install communities.** Create resident populations, households, a few groups and authorities. A `CultureProfile` explicitly links naming traditions, social practices and architectural recipes. It allows several communities and languages per site: the urban culture of Magna Urbis does not automatically determine the identity of all its inhabitants.

**3 — Name using Namebench.** Its current API does not offer deterministic replay; export normalised, sorted and fingerprinted corpora, then select by stable key `(world, entity, usage)`. The profile specifies the order of elements, possible patronymics, transmission, writing and transliteration. Do not impose "given name + hereditary surname" on all cultures. Distinguish names of people, establishments, regions and natural features: a pool of city names is not enough to name a river. Add the missing rules, with declared fallbacks. Keep exonyms and former names; a homonym is not a duplicate identity. Author-provided names take priority.

**4 — Evolve history and inhabitants.** Chronos chooses the social events and their conditions; Lineage Lab applies the demographic processes and returns the facts actually carried out. An epidemic parameterises a risk; its published toll comes from the observed deaths. An exact imposed loss would require an additional quota mechanism. Chronos adds no parallel growth or mortality.

For the first deliverable, use Lineage Lab's existing batch contract: fixed crisis scenario, simulation, then assignment of roles and events compatible with the lives obtained. Successions use the real deaths. Full co-evolution will require a new public interface per time step: state → Chronos decisions → Lineage Lab transition → validated effects. It does not exist today; avoid two simulations that try to correct each other after the fact.

**5 — Detail without rewriting.** Eventually, global facts reserve their totals before zooms. An event between two regions belongs to their common scope; its migration is counted once, with the corresponding departure and arrival. Local detail respects these reservations and may add facts without macro effect. Any new macro consequence requires a new revision.

Lineage Lab's hybrid already provides a simulated core and cohorts with projected families; it is not yet a historical refinement engine under constraints. Its limits must be preserved: two ascending and five descending generations for the background, individual migrations omitted from these cohorts. A projected resident does not retroactively become a causal character. Historical actors are reserved in the core; the others remain projections explicitly flagged as such.
## 3. User experience and progressive delivery

In Magna Urbis, add an action **“Populate and write history”**, with a start date, a duration, cultural profiles and crisis intensity. The map shows names and headcounts at the chosen date. Selecting a region opens its population, communities, powers and timeline; selecting a place leads to its groups and inhabitants; selecting a person shows kinship, residences and shared events.

**Fictional example:** a crisis causes families to leave a village for a neighbouring town; their community then founds a brotherhood. At the current date, its name, members and local presence refer back to the same events. A house receives specific occupants only at urban zoom, subject to capacity constraints. Built traces and the historical transformation of town plans will come after the first cartographic layer.

Summaries are first produced from templates based on facts. Biased accounts may then interpret them; they do not alter the canon.

**Three deliverables, each usable on its own:**

1. **Names and inhabitants.** One region, a few thousand inhabitants at `full`, the Namebench corpus, stable identities, households, residences and saving. Connect to Magna Urbis's existing naming; keep manual corrections.
2. **Social history.** Chronos graph, about a century over fixed sites, dated affiliations, successions, crises and causality; headcounts drawn exclusively from Lineage Lab. Start with a few types of groups, without depending on a complete institutional catalogue.
3. **Change of scale.** Coupled temporal control, reconciled hybrid, reservation of effects, regional neighbourhoods and on-demand detail; then foundations, ruins and urban phases.

Keep the projects independent and their exchanges versioned. A local orchestrator calls the Python tools and the Rust core, then produces an archive containing a manifest, fingerprints, the graph and demographic data. The browser explores the archive without Python; regenerating requires the local engine. The logical graph can be stored as tables and indexes: no specialised graph database is needed at the start.

**Acceptance criteria:** same inputs and versions → same canon; same people after export/import; residents all alive at the displayed date; total headcount equal to the simulated people, then to core + cohorts without double counting; recorded demographic effects equal to the transitions; names stable and corrections preserved; zooms A→B and B→A identical once refinement is introduced. Performance remains to be measured on the selected scenarios.

**Study inputs outside this repository:** Chronos (`docs/methods/chronology.md`, `docs/reviews/vision-entites-sociales.md`, `conception_generateur_histoire_multiechelle_v3.md`), Lineage Lab (`docs/genealogy-hybrid.md`) and Namebench (`README.md`). These paths identify the local files examined for this proposal; they are not prerequisites for cloning or building Magna Urbis. Project links are listed in the [main README](../README.md#related-projects). Magna Urbis's own [map naming implementation](../web/src/v2/mapNaming.ts) is versioned here.
