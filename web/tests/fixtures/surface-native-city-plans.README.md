This is an exact copy of the existing native scene cache
`web/out/native-entry-existing-door-cli-proof/small-roman-plans.json`, captured
by the earlier city/native architecture integration work. It contains two
accepted native `architectural-plans-2` records with original stable building
and parcel IDs, source footprints, volumes, materials and retained plan data.
It is not constructed from a cartographic projection and contains no newly
generated or reconstructed native building.

SHA-256 of the copied source bytes:
`4d382db04625e0b6aa1d088970d814753fc8a15fe3d4b92c2d6e7c7b980657d5`.

These are compact accepted plans, with no realized roof mesh. They validate
preservation of an actual existing native city source; the separate existing
`rust/fixtures/houses/batch-reference.json` exercises realized native roof data.
Small artificial hole/road geometries in the unit tests are labelled unit test
inputs and do not serve as evidence of native city generation.
