# License inventory and retained texts

The project code license is [AGPL-3.0-only](../LICENSE). The previous
[GPL v3 text](GPL-3.0.txt) is retained for GPL third-party portions and historical
versions. Start with the
[third-party notices](../THIRD_PARTY_NOTICES.md) for scope and credits.

`dependency-inventory.json` contains 1,142 unique registry package/version pairs:
183 npm and 959 Cargo, deduplicated across all committed lockfiles. The npm
lockfile has 208 install locations; some refer to the same package/version.
The inventory records licenses as declared by upstream, including alternatives.
`cfg_block` specifies an Apache 2.0 notice through `license-file` instead of a
manifest license expression; its retained text is the authority.

`DEPENDENCY_LICENSES.txt` contains 521 distinct license/copyright/notice texts
from installed package sources or registry archives. Downloaded archives are
verified against lockfile integrity values. It includes notices for development
and optional packages, not just the browser bundle. **239 package versions omit
a separate notice file from their package sources.** They still have declared
license expressions, and are marked `review`; obtain relevant upstream notices
when distributing them. A package's root license does not necessarily enumerate
all libraries inside a native binary or Python wheel.

Regenerate with Python 3.11 or later, from the repository root:

```sh
python scripts/license_inventory.py --refresh
python scripts/license_inventory.py --check
```

`--refresh` uses local npm/Cargo sources when present and downloads missing
registry archives. It caches metadata/notices under ignored `.tmp/license-inventory/`.
It never installs dependencies, extracts archives to disk or executes their code.
Text hashes use normalized LF line endings so the checks work across platforms.
`--check` needs no network, npm installation or Cargo cache; it checks manifest
and lockfile hashes, the exact package set, and the aggregate text's checksum.
This detects stale input inventories, not legal compliance of a release.

The following separately retained texts were fetched on 2026-10-30:

| File | Source |
| --- | --- |
| [earcut-2.2.4-ISC.txt](earcut-2.2.4-ISC.txt) | [Mapbox Earcut v2.2.4 LICENSE](https://raw.githubusercontent.com/mapbox/earcut/v2.2.4/LICENSE); full text also added to the local TypeScript port. |
| [polylabel-ISC.txt](polylabel-ISC.txt) | [Mapbox Polylabel v1.1.0 LICENSE](https://raw.githubusercontent.com/mapbox/polylabel/v1.1.0/LICENSE); conservative method/reference credit. The local implementation's upstream revision was not recorded, so this is not a claim that v1.1.0 was the source. |
| [coi-serviceworker-0.1.7-MIT.txt](coi-serviceworker-0.1.7-MIT.txt) | `LICENSE` from the [npm 0.1.7 archive](https://registry.npmjs.org/coi-serviceworker/-/coi-serviceworker-0.1.7.tgz), verified with registry integrity metadata; full text also added to the copied worker. |
| [CC0-1.0.txt](CC0-1.0.txt) | [SPDX license-list-data text](https://raw.githubusercontent.com/spdx/license-list-data/main/text/CC0-1.0.txt); [Creative Commons legal terms](https://creativecommons.org/publicdomain/zero/1.0/legalcode). Applies to the identified provider assets, not automatically to all project files. |
| [CC-BY-4.0.txt](CC-BY-4.0.txt) | [SPDX license-list-data text](https://raw.githubusercontent.com/spdx/license-list-data/main/text/CC-BY-4.0.txt); [Creative Commons legal terms](https://creativecommons.org/licenses/by/4.0/legalcode). Attribution and local changes for CHMv2 are described in the root notices and experiment README. |

Other existing full texts remain next to their sources:
[polygon-clipping](../web/src/vendor/polygonClipping.LICENSE.md) and
[Terrain Diffusion teacher](../rust/models/neural-earth/LICENSE-TEACHER.txt).
Copy the applicable texts/provenance with distributed builds and provide the
corresponding source required by the relevant copyleft licenses.
