# Place names bundled from Namebench

Name generation uses a local extract of Namebench and profiles that link Magna Urbis cultures to corpora and composition rules. The browser contacts neither Namebench nor any external API. The interface language remains independent of the name style.

## Resources

The [pack](../web/src/gen/names/data/names-pack.json) contains **549,469 names**, distributed among settlements, watercourses, lakes, landforms and regions, as well as the tables and patterns for **51 generators**. It occupies **8,194,380 bytes of UTF-8 JSON**, or **3,040,090 bytes gzipped** at build time. The 253 country codes are those of the source, including a few obsolete codes with no inhabited places.

The [manifest](../web/src/gen/names/data/names-manifest.json) lists the fingerprints, counts per country, filters, quotas and sources. The maximum quota per country is 2,048 settlements, 512 watercourses, 256 lakes, 512 landforms and 256 regions. Small sources are not artificially padded. The corpora are modern geographic selections; they prove neither the exact language nor the historical authenticity of a name. Approximations in the profiles are declared in the registry.

The Roman and Viking generators whose referenced source tables were empty have been excluded from the extract. The source database contains no vegetation class: forests use the procedural resources or the available composition. The extract contains no genealogies, persons or descriptions.
## Usage and rules

### Presentation, profiles and sources

In **Map → Naming**, the default presentation translates generic elements into the interface language (French, English, Spanish, Portuguese, Chinese, Arabic, Russian and Japanese). The **Full culture** mode keeps the cultural form. An independent map language can be chosen for a map intended for another language, without changing the interface.

Profile and source settings apply, as desired, to the common settings, the regional landscape or a town. The name editor also allows an override per object or district. Inheritance follows object → district → town → common settings; the regional landscape has its own override. Native streets and objects follow the local culture of the phases/districts, unless a linguistic profile is explicitly chosen.

All profiles in the registry are accessible, including fine-grained profiles. The automatic European profile is stable (French), regardless of the seed. The native aliases `west` and `mongol` are normalised. An unknown culture has a diagnosed English fallback; it does not silently receive a French name.

Sources are **by profile**, **geographic**, **invented** or **mixed**. Geographic sources are selections of modern countries, with no guarantee of language or historical period. A profile without a geographic corpus keeps its invented palette and provides a diagnostic. Invented palettes are fictional conventions, with no claim of historical reconstruction.

Latin reading keeps names that are already in Latin script and applies the explicit correspondences available for Greek and Cyrillic sources. A script without an available reading remains intact; the system does not invent a transcription or an original script from a Latin palette.

### Common model and references

Proper names, cultural forms and displayed texts are kept separate. Known descriptions (market, old quarter, direction, trade) are kept as multilingual concepts at the time of composition. Historical vocabularies also provide this metadata. A complete imported name remains opaque when no reliable decomposition is available.

Native districts, streets, gates, buildings and monuments are converted into name records with identity, culture and role. Their former French diagnostic labels no longer serve as toponyms. Native and classical labels share the presentation of the map, 3D and exports. Arabic texts and combined sequences are shaped as a single segment, to preserve ligatures and bidirectional order.

The editor distinguishes **proper name and references**, **full free text**, and placement/typography changes. Modifying only the style or position does not freeze the language of the label. Modified establishment names update the roads, gates and castles that reference them.

### Preservation and regeneration

Identifiers are attached to objects, without dependence on the order of labels. Identity metadata of streets, rivers, roads and districts are preserved when moving and within the project. Former `n0`, `n1`, etc. edits are migrated using the type and anchor of their object in the saved map, never their new position in the list.

A registry of generated names (`NamesLayer.bank`) is saved with the world. With profile and policy unchanged, names are reused after the corpus is updated. **Generate other names** explicitly changes the variation of the chosen scope (map, region, town or object); the other scopes are preserved. Author corrections are reapplied after composition. Changing language, style or visible quantity does not regenerate names.

Algorithm 3 keeps corpus fingerprints as provenance, without injecting them into the seed of all objects. Corpora, generators and palettes remain local, with no network calls. The map title can be customised independently of the town name.

### Visible quantity by importance

In **Display → Text**, nine independent sliders control inhabited places, rivers, other waters, landscapes, districts, streets, buildings, monuments and landmarks. **0** hides the category, **1** keeps its main element, **100** allows all candidates. Intermediate steps progressively add objects according to their importance, then their extent and stable identity. Names of small rivers, secondary streets and native objects are produced even when they are hidden.

Zoom, visible groups, collisions and the global label budget continue to protect legibility. The slider's maximum allows all names; it does not force their overlap. Older compositions without sliders keep their earlier visibility behaviour. Settings are saved in the composition and used by 2D, 3D and vector/raster export renderers.

The main modules are `gen/names/{profiles,toponyms,culturalVocabulary,meanings,identity,policy,displayNames}.ts`, `v2/{mapNaming,nativeNames,mapLabels}.ts` and `render/{textLayer,mapLabels,svgLabels}.ts`. The tests `namingSystem.test.ts` cover the integration of profiles, sources, references, preserved names, edits, native objects, sliders and scripts.

## Redoing the extraction

From the root of Magna Urbis, with Python and `../namebench/data/names.db`:

```powershell
python tools/namebench/export.py
python tools/namebench/export.py --check
```

The exporter opens the SQLite source read-only and immutable. It selects NFC-normalised names by stable hash ranking, without random SQL sampling. The check recomputes the outputs and compares the bytes. The 1.2 GB database remains local; web builds use the tracked JSON files directly along with the code. No Python Namebench environment is needed at web runtime.

From `web/`, the dedicated browser check is `node scripts/namebench_browser_check.mjs`. It builds a bundle from the real naming engine and its checks, loads it into Edge without a visible interface, cuts the network and verifies the replay across all cultural profiles, the eight generic translations and both modes of the panel. Its report is written to `web/out/namebench-browser-check.json`. It does not test the graphical placement of labels.
