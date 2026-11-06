# Compact Namebench toponym pack

Run from the Magna Urbis checkout with Python 3 (standard library only):

```powershell
python tools/namebench/export.py
python tools/namebench/export.py --check
```

The default source is the sibling `../namebench/data/names.db`. Override it with
`--database PATH`; override the destination with `--output DIRECTORY`. The source
opens with SQLite URI `mode=ro&immutable=1`. A nonempty WAL is rejected because
immutable mode must read a checkpointed snapshot. No Namebench modules are
imported, no database tables are changed, and no source database is copied into
this repository.

The exporter writes UTF-8 `web/src/gen/names/data/names-pack.json` and
`names-manifest.json`. `--check` re-extracts the complete source and compares both files
byte for byte, without writing. The manifest records the database SHA-256 and
size, source checkout revision, upstream provenance, feature-code policy,
eligible source row counts, exported distinct-name counts, pack SHA-256 and raw
and level-9 gzip byte sizes. Gzip size is informational; no compressed duplicate
is committed. There are no timestamps or machine-specific absolute paths in
the artifacts. Changing the source checkout revision changes the manifest.

Every source country code gets all five arrays, including empty arrays when
coverage is absent. Names are sampled independently per country and kind using
streaming bottom-k BLAKE2b-128 ranks seeded by a fixed versioned string. This
avoids alphabetical prefixes, database iteration order, platform random-number
generators and population bias. It caps settlements at 2,048 names, rivers at
512, relief at 512, lakes at 256 and regions at 256 per country. Small pools keep
every distinct eligible name; counts do not imply an equal amount of source
coverage. The raw pack must remain below 12 MiB.

The five kinds are inhabited settlements, flowing water, lakes, land relief and
administrative regions. Rivers exclude lakes, reservoirs, wells, ponds and
coastlines. Relief excludes islands, beaches and capes. Administrative pools
exclude historical divisions and country names. See the manifest's explicit
feature-code lists for the complete policy. Unicode NFC and surrounding-space
trimming are the only name transformations; accents, original scripts and case
are retained. Exact duplicates are removed within each country/kind.

Generator data includes usable generic `towns_and_cities.*` styles and a fixed set
of geographic `places.*` styles. It carries the source pattern and arrays, with
array order, duplicates and empty phonemes retained because they affect
generation. Description, personal-name and franchise categories are excluded.
Styles with absent or empty referenced arrays are omitted and identified in the
manifest (`roman_towns` and `viking_towns` in the initial source snapshot).
The pack is an extract, not a new transliteration or alternate-name dataset.
Modern geographic pools do not establish historical naming authenticity.

Place records originate in GeoNames `allCountries.zip` through Namebench's
`namegen/importers/import_geonames.py` original `name` column. Generator records
originate in Snake4life/fantasy-names through Namebench's extracted pattern and
phoneme tables. Source redistribution terms still apply; the local database
does not supply a unified data license. The manifest identifies these upstream
sources without claiming a new license for their data.
