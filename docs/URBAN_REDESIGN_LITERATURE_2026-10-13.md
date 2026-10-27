# Urban redesign: literature, techniques and libraries

This is an English translation of section 2 of [the October 13, 2026 urban redesign analysis](REFONTE_GENERATION_URBAINE_2026-10-13.md). The [detailed repository analysis](URBAN_REDESIGN_CURRENT_WORKFLOW_2026-10-13.md) and [design proposals](URBAN_REDESIGN_PROPOSALS_2026-10-13.md) are translated separately. The [implementation note](REFONTE_URBAINE_IMPLEMENTATION_2026-10-13.md) describes later delivered work. This focused review is sourced, not exhaustive, and its proposals are not a proven universal solution.

## 2.1. What “state of the art” means here

There is no single ranking of the best city generator. A work can excel at aerial-image resemblance yet be of little use for editable vector parcels. Another can guarantee good access without reproducing a historical city. A mature product need not use the newest algorithm.

For Magna Urbis, useful criteria are premodern shape diversity, artistic control, site consistency, a connected network, valid partition, credible access, reproducibility and interactive time. Fidelity to a particular history additionally requires dated references, rarely present in modern urban datasets.

The review finds a combination of methods more relevant than wholesale replacement by the latest paper. Foundations from 2008–2013 remain directly useful; 2024 co-generation offers an important structural direction; recent diffusion primarily broadens learning and example-based control.

### Urban morphology as a complement

Computational generation literature should be supplemented by urban analysis. **Anne Vernez Moudon, 1997 — Urban Morphology as an Emerging Interdisciplinary Field** situates the convergence of English, Italian and French schools around the legacies of Conzen and Muratori. For this project it reminds us to study form with its scale and transformations: reading a city is not reducible to a graphical style. The abstract and accessible translated material were consulted; the original journal article was inaccessible during the research. [Translation distributed by the Portuguese urban morphology network](https://pnum.fe.up.pt/en-gb/assets/pdf/rmu/rmu-3-1_moudon.pdf).

M. R. G. Conzen's **Alnwick, Northumberland: A Study in Town-plan Analysis** is a reading lead for plan units, land inheritance and growth. A [translation of the second 1969 edition](https://pnum.fe.up.pt/en-gb/alnwick.pdf) is distributed by the same network. Its full text was not analyzed here: this document's recommendations are not presented as a reproduction of its model.

## 2.2. Major method families

| Family | Principle | Strength | Limit for Magna Urbis |
| --- | --- | --- | --- |
| Grammars and local growth | Propose street extensions, then accept, connect or stop them under rules | Visible hierarchy and growth | Ordering effects and network/parcel repairs |
| Direction/tensor fields | Define preferred orientations, then trace roads | Control of grids, radials, shores and transitions | The field guarantees neither connections nor usable parcels |
| Hierarchical subdivision | Cut large regions into fine units | Controlled partitions and local editing | Repeated-cut bias and joins between regions |
| Deformable templates | Adapt reference patterns to a domain | More precise fabric identity | Distortion, seams and interface compatibility |
| Voronoi and weighted diagrams | Allocate land around seeds | Multiple centers and area allocation | Frontages, land history and roads are not guaranteed |
| Street/parcel co-generation | Subdivide and add required access jointly | Address access when the need arises | Optimization and rules must be adapted to historical fabrics |
| Temporal simulation | Evolve streets, uses and land units in stages | Inheritance and transformation | Cost, tuning and validation of assumptions |
| Example-based synthesis | Recombine or learn observed structures | Reference-grounded variety | Corpus quality and period are decisive |
| Learned generative models | Produce conditioned layouts, often raster and sometimes topological | Varied proposals, completion and sketches | Geometric guarantees and historical transfer remain to be established |

This table is a project comparison, not a published universal ranking.

## 2.3. Streets and plan structure: foundational references

**Parish and Müller, 2001 — Procedural Modeling of Cities.** Street generation follows global goals and is corrected by local constraints; population and terrain maps guide decisions. This is a major procedural-generation foundation, not a validation of medieval morphogenesis. [Paper](https://people.eecs.berkeley.edu/~sequin/CS285/PAPERS/Parish_Muller01.pdf).

**Chen, Esch, Wonka, Müller and Zhang, 2008 — Interactive Procedural Street Modeling.** Controllable tensor fields are converted into networks; the user can edit field or graph. Separating directional intent from realized network suits grids, radials and local mixtures. It still requires connection and spacing rules. [Authors' paper](https://peterwonka.net/Publications/pdfs/2008.SG.Chen.InteractiveProceduralStreetModeling.pdf).

**Galin, Peytavie, Maréchal and Guérin, 2010 — Procedural Generation of Roads.** A path minimizes anisotropic cost incorporating terrain and obstacles. It is a reference for connecting landscape destinations, not by itself a method for defining neighborhoods or cadastre. The current Rust router uses a simplified, bounded logic. [Paper](https://perso.liris.cnrs.fr/egalin/Articles/2010-roads.pdf).

**Yang, Wang, Vouga and Wonka, 2013 — Urban Pattern: Layout Design by Hierarchical Domain Splitting.** The domain is subdivided along field lines or deformed predesigned patterns. This combination matters: fabric can have richer repeatable organization than direction and noise alone. The current engine is close to the guided-cut branch without reproducing the entire framework. [Institutional publication and abstract](https://repository.kaust.edu.sa/handle/10754/575588).

For Magna Urbis, “network first” versus “regions first” is too simple. Major destinations and the framework can precede subdivision; subdivision can then create streets; fine access must finally respond to land depths.

## 2.4. Parcels: access and shape

**Vanegas, Kelly, Weber, Halatsch, Aliaga and Müller, 2012 — Procedural Generation of Parcels in Urban Modeling.** The work explicitly addresses block coverage, access, orientation, dimensions and parcel plausibility. It is a direct reference for comparing recursive subdivision and boundary-guided methods. [Authors' paper](https://www.cs.purdue.edu/cgvlab/www/resources/papers/Vanegas-Eurographics-2012-Procedural_Generation_of_Parcels_in_Urban_Modeling.pdf).

Three geometric tools must be distinguished:

- **Frontage bands:** easy to parameterize by width and depth, especially for strip lots. Corners and competing frontages need an explicit rule.
- **Straight skeleton:** follows parallel propagation of polygon edges; useful for frontage territories and offsets. It does not automatically provide access or land history.
- **Medial axis:** describes locations equidistant from boundaries; useful for identifying depths and corridors. It is not interchangeable with the straight skeleton.

CGAL documentation distinguishes these objects and supplies weighted straight skeletons and offsets for polygons with holes. It permits reuse of one skeleton for multiple offsets. The project should measure its value on difficult blocks rather than impose it everywhere. [Manual](https://doc.cgal.org/latest/Straight_skeleton_2/index.html).

Recursive subdivisions suit compact oriented units better than long-lot series. Compounds can remain whole units or require specific internal organization. A streetless interior can be a garden, collective space or property reached by passage: geometric fallback should not decide its use alone.

## 2.5. Co-generation: a particularly relevant recent direction

**Zebin Chen, Peng Song and F. Peter Ortner, 2024 — Hierarchical Co-generation of Parcels and Streets in Urban Modeling.** The system subdivides regions and adds streets to serve newly inaccessible units, then optimizes geometric quality. The authors report a simple connected network providing parcel access. [Paper](https://sutd-cgl.github.io/supp/Publication/papers/2024-EG-UrbanModeling.pdf), [authors' presentation](https://adaptivedesignlab.com/hierarchical-co-generation-of-parcels-and-streets-in-urban-modeling/).

Its value for Magna Urbis is addressing access during refinement rather than discovering unassignable rear areas at the end. Adaptation must remain selective: the paper conceptually equates several polygon scales and seeks regularity that is not every historical fabric's goal. Its results do not demonstrate a universal generator for medinas, compounds or terraced cities.

**Our interpretation:** a local “land need → access → new subdivision” loop could improve consistency without replacing the main framework. Heritage streets and reserves would remain constraints; only authorized regions would be reworked.

## 2.6. Growth and example-based synthesis

**Weber, Müller, Wonka and Gross, 2009 — Interactive Geometric Simulation of 4D Cities.** A geometric urban model evolves over time with explicit parcels and streets. It shows that transformation history can be represented beyond concentric rings, but is not a ready-made premodern historical simulation. [ETH paper](https://cgl.ethz.ch/Downloads/Publications/Papers/2009/Web09/Web09.pdf).

**Aliaga, Vanegas and Beneš, 2008 — Interactive Example-Based Urban Layout Synthesis.** Synthesis combines structure and image from observed urban fragments through extension and blending operations. Its contribution here is local fabric references and joins rather than merely a list of global styles. [Authors' paper](https://cs.purdue.edu/homes/bbenes/papers/Aliaga08ToG.pdf).

A present-day extension at a core's edge becomes “historical” only if it retains coherent traces of the past: former axis, alignment, land boundary, former wall or absorbed center. This is a design recommendation; choosing a recipe named “medieval” is not enough.

## 2.7. Diffusion and recent work: useful in their proper place

**Generating Urban Road Networks with Conditional Diffusion Models, 2024.** The approach treats the network as a context-conditioned image. It expands proposal diversity, but image output must be converted and the network checked for usable intersections and access. [ISPRS IJGI publication](https://www.mdpi.com/2220-9964/13/6/203).

**CityGen, 2023 preprint, revised 2025.** The framework offers layout extension, multiscale refinement and sketch control. It is a reference for completion and spatial control rather than proof of exact historical cadastre. [Record and paper](https://arxiv.org/abs/2312.01508).

**CaRoLS — Condition-adaptive multi-level road layout synthesis, 2025.** The publisher's abstract describes a diffusion/VAE combination for discrete topology and continuous geometric detail. This move toward more structured representation merits monitoring. The full text was unavailable for this review, so no partition or land-access guarantee is attributed to it. [Publisher abstract](https://www.sciencedirect.com/science/article/abs/pii/S0097849325002924).

For a pre-Renaissance generator, challenges are corpus, domain shift and guarantees. Contemporary data risks reproducing automobile roads, recent zoning and reshaped routes. An inference seed alone does not guarantee the same reproducibility across hardware, versions and vector conversions.

**Proposed position:** learning might suggest a footprint, complete a fabric or estimate parameters from examples. The accepted result must then pass the engine's geometric and access rules. The reviewed sources do not prove that an available neural model can immediately replace the entire requested pipeline.

## 2.8. Available products and libraries

These tools have different roles. A geometry library provides operations; it does not choose urban logic.

| Tool | Contribution | Possible use / caveat |
| --- | --- | --- |
| [ArcGIS CityEngine](https://doc.arcgis.com/en/cityengine/latest/help/help-layers-block-parameters.htm) | Blocks tied to street loops; recursive, offset, skeleton or no subdivision | Mature workflow/settings comparator; proprietary product, not an embeddable Rust library |
| [Watabou / TownGeneratorOS](https://github.com/watabou/TownGeneratorOS) | Artistic generator and historical project reference | Compare legibility, diversity and simplicity; GPL-3.0 repository, public source older than some current tool features |
| [ProbableTrain / MapGenerator](https://github.com/ProbableTrain/MapGenerator) | City-map generation using tensor fields | Inspectable demonstrator; declared orientation toward American plans, to adapt rather than use as historical reference |
| [geo, Rust](https://docs.rs/geo/latest/geo/) | Geometry, booleans, buffers, topological relations and measurements | Already used in the prototype; good first base before another stack |
| [Spade, Rust](https://docs.rs/spade/latest/spade/) | Delaunay triangulations, including constrained, and related structures | Candidate for domain meshing and local operations; does not generate a cadastre by itself |
| [petgraph, Rust](https://docs.rs/petgraph/latest/petgraph/) | Graph structures and algorithms | Accessibility, components and paths; geometric embedding and crossings remain separate |
| [CGAL, straight skeleton](https://doc.cgal.org/latest/Straight_skeleton_2/group__PkgStraightSkeleton2Ref.html) | Weighted skeleton and offsets of polygons with holes | Robust reference to evaluate; C++, WASM integration to measure, GPL package with commercial alternative |
| [Clipper2](https://angusj.com/clipper2/Docs/Overview.htm) | Booleans and offsets, internal integer coordinates | Compare on difficult cases; check the chosen binding and its license separately from upstream |
| [GEOS](https://libgeos.org/) | Predicates, buffers, polygon assembly, validation and indexing | Excellent external audit tool; C/C++, LGPL, browser integration cost to assess |
| [OSMnx](https://osmnx.readthedocs.io/en/stable/) | Collection and analysis of real urban networks | Comparison corpus and outside-engine measurements; current data need filtering and are not automatically historical plans |

Check license compatibility, maintenance, bindings and distribution size for the version actually chosen. The proposal is not to install every library: start with existing capabilities and justify each dependency by a measured gap.

Weighted Voronoi diagrams can help assign territories or meet target areas. But libraries called “weighted Voronoi” do not all define weights alike, and some require a convex domain. Use on islands, holes and concave regions needs verification. [Example API and limitations](https://github.com/Kcnarf/d3-weighted-voronoi).

## 2.9. Assessing the twelve proposed footprint families

**The list is useful creative vocabulary, not a validated scientific taxonomy or twelve exclusive classes.** Categories overlap: a city can be compact, oval and composite; branching can result from a valley rather than an intended shape.

First define the silhouette considered. A wall can enclose fields, reserves and gardens; a settlement can extend beyond walls. Comparisons require the same convention, period and comparable scale. Historical names in the request are corpus leads, not automatic validation of an entire city silhouette at every period. Reconstructed plans and uncertain boundaries must be identified.

| Proposed family | Value for generator | Parameters / mechanism to distinguish |
| --- | --- | --- |
| 1. Circular / oval | Compact form with relatively regular boundary | Aspect, regularity, chosen wall or isotropic growth; independent internal network |
| 2. Square / rectangular | Foundation or extension with directed outline | Orientation, aspect, grid, area actually urbanized within the envelope |
| 3. Polygonal | Wall or boundary made of segments | Side count, irregularity and adaptation; “polygonal” alone is too broad |
| 4. Compact organic | Irregular but not greatly elongated growth | Access attraction, obstacles, prior parcels and large-scale irregularity |
| 5. Elongated / spindle | Urban mass with a dominant axis | Length/width ratio and central thickening |
| 6. Linear / ribbon | Shallow frontages along a road or shore | Strip depth, continuity, frontage count and polarities |
| 7. Fan / sector | Expansion from a point or constrained opening | Available angle, apex position and width gradient |
| 8. Radial with arms | Compact center and extensions along approaches | Arm count, length, thickness and intervening gaps |
| 9. Branching / dendritic | Growth guided by valleys or paths | Branch depth, confluences and physical constraints |
| 10. Lobed / polycentric | Connected masses, often tied to several centers | Center count and weight, constrictions and merging stage |
| 11. Discontinuous / archipelago | Separate cores in one settlement | Components, distances and links; accept gaps and multipolygons |
| 12. Composite / asymmetric | Combination of forms and inheritance | Sequence and assembly of mechanisms; better as composition than primitive form |

The twelve names can remain in the interface or example catalog. Internal methods should instead express compactness, elongation, anisotropy, core count, branching, fragmentation and boundary regularity. One method can cover several families and multiple methods can produce similar silhouettes.

Suggested modifiers—insular, peninsular, in a meander, on a spur, terraced, on two banks, port, successive walls—remain useful but differ in kind: the first constrain site; “port” adds function and access; successive walls describe history. They should not all occupy a single “geographic constraint” field.

## 2.10. Assessing the twelve proposed neighborhood families

The list chiefly describes **network morphologies or land-use organizations**, rather than twelve kinds of neighborhood. Commercial and residential neighborhoods can share a fabric; one neighborhood can combine a grid and dead-end-access courts.

| Proposed family | Main nature | Useful interpretation |
| --- | --- | --- |
| Regular orthogonal | Network | Two controlled directions and spacings |
| Irregular orthogonal | Network | Grid with size variation, distortion and inheritance |
| Organic | Network + process | Several local directions; do not equate with random noise |
| Radial | Network | Axes toward one or more centers |
| Radial-concentric | Network | Radials and ring roads, possibly from former boundaries |
| Linear | Settlement + network | Main axis and lateral access; compatible with multiple parcel types |
| Branching / dendritic | Network topology | Access tree and hierarchy |
| Polycentric | Center organization | Several connected fabrics, not one local operator |
| Topographic | Site relation | Directions following contours, flats and vertical connections |
| River / coastal | Site and access relation | Shores, quays, parallel and cross axes |
| Enclosures / complexes | Land organization | Large units, gates and internal access with variable outside network |
| Aggregated clusters | Group organization | Commons and connected groups, sometimes uncertain land boundaries |

Suggested cross-cutting parameters—regularity, density, hierarchy, centrality and permeability—are relevant. Add block size and elongation, access depth, passage status, land-unit size and collective-space share.

**The block/parcel distinction must remain strict.** A block depends on network and public space; a parcel depends on frontages, land use, access and inheritance. A grid does not dictate one parcel layout, and a compound does not require a particular city silhouette.

## 2.11. Synthesis for the problem

The best-motivated combination from the reviewed sources is fields and paths for the framework, hierarchical subdivision and patterns for fabrics, frontage methods for parcels, and local co-generation to resolve access. A lightweight chronology can explain contrasts between extensions.

This is **a proposed synthesis for Magna Urbis**, not an experimental result establishing superiority over every alternative. The current engine already has some of these components; the work is as much about improving orchestration as adding algorithms.
