#!/usr/bin/env python3
"""Export a compact, reproducible browser corpus from a local Namebench database.

Python standard library only. Never opens the source database for writing.
"""
from __future__ import annotations

import argparse
from collections import Counter
import gzip
import hashlib
import heapq
import json
from pathlib import Path
import sqlite3
import subprocess
import sys
import unicodedata

ROOT = Path(__file__).resolve().parents[2]
VERSION = "namebench-toponyms-v1"
SEED = "magna-urbis/namebench/toponyms/v1"
LIMITS = {"settlements": 2048, "water": 512, "lakes": 256,
          "relief": 512, "regions": 256}
# Existing, inhabited settlements; omit abandoned/historical/destroyed places,
# neighbourhoods, farms and aggregate populated-place clusters.
SETTLEMENTS = {"PPL", "PPLA", "PPLA2", "PPLA3", "PPLA4", "PPLA5", "PPLC", "PPLG", "PPLL", "STLMT"}
# Flowing water only: no lakes, wells, ponds, reservoirs, seas or coastlines.
WATER = {"STM", "STMI", "STMS", "STMD", "STMH", "WAD", "WADI"}
LAKES = {"LK", "LKI", "LKS", "LKN", "LKNI", "LKO", "LKOI", "LKSI"}
# Land relief, excluding islands, beaches, capes and points.
RELIEF = {"MT", "MTS", "PK", "PKS", "HLL", "HLLS", "RDGE", "VAL", "VALS",
          "PASS", "GAP", "PLAT", "PLN", "UPLD", "VLC", "CNYN", "GRGE", "MESA",
          "DUNE", "CLF", "SPUR", "SLP", "CRTR", "BUTE", "SCRP"}
REGIONS = {"ADM1", "ADM2", "ADM3", "ADM4", "ADM5", "ADMD"}
PLACE_GENERATORS = {"bridges", "castles", "caves", "city_districts", "civilizations",
                    "countrys", "forests", "harbors", "islands", "lakes", "lands",
                    "mountains", "oasis", "plazas", "rivers", "roads", "ruins",
                    "streets", "swamps", "towers", "waterfalls", "waters"}


def encode(value: object) -> bytes:
    return (json.dumps(value, ensure_ascii=False, sort_keys=True,
                       separators=(",", ":")) + "\n").encode("utf-8")


def source_hash(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(8 * 1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


class Sample:
    """Streaming bottom-k distinct strings, independent of source row order."""
    def __init__(self, country: str, bucket: str):
        self.limit = LIMITS[bucket]
        self.prefix = f"{SEED}/{country}/{bucket}/".encode("utf-8")
        self.heap: list[tuple[int, str]] = []
        self.names: set[str] = set()

    def add(self, name: str) -> None:
        if name in self.names:
            return
        rank = int.from_bytes(hashlib.blake2b(self.prefix + name.encode("utf-8"), digest_size=16).digest(), "big")
        entry = (-rank, name)
        if len(self.heap) < self.limit:
            heapq.heappush(self.heap, entry)
            self.names.add(name)
        elif entry > self.heap[0]:
            removed = heapq.heapreplace(self.heap, entry)
            self.names.remove(removed[1])
            self.names.add(name)

    def values(self) -> list[str]:
        return [name for _, name in sorted(self.heap, key=lambda item: (-item[0], item[1]))]


def bucket_for(feature_class: str, code: str) -> str | None:
    if feature_class == "P" and code in SETTLEMENTS:
        return "settlements"
    if feature_class == "H":
        if code in WATER:
            return "water"
        if code in LAKES:
            return "lakes"
    if feature_class == "T" and code in RELIEF:
        return "relief"
    if feature_class == "A" and code in REGIONS:
        return "regions"
    return None


def export(database: Path) -> tuple[bytes, bytes]:
    wal = Path(str(database) + "-wal")
    if wal.exists() and wal.stat().st_size:
        raise ValueError("Source has a nonempty WAL; provide a checkpointed snapshot for immutable reads")
    before = database.stat()
    digest = source_hash(database)
    samples: dict[str, dict[str, Sample]] = {}
    eligible_rows: dict[str, Counter] = {}
    scanned = 0
    connection = sqlite3.connect(database.as_uri() + "?mode=ro&immutable=1", uri=True)
    try:
        for country, name, feature_class, code in connection.execute(
                "SELECT country_iso,name,feature_class,feature_code FROM places"):
            scanned += 1
            if not isinstance(country, str) or len(country) != 2 or not country.isascii() or not country.isalpha():
                continue
            country = country.upper()
            if country not in samples:
                samples[country] = {bucket: Sample(country, bucket) for bucket in LIMITS}
                eligible_rows[country] = Counter()
            bucket = bucket_for(feature_class, code)
            if bucket is None:
                continue
            name = unicodedata.normalize("NFC", name.strip())
            if not name or any(unicodedata.category(char) == "Cc" for char in name):
                continue
            eligible_rows[country][bucket] += 1
            samples[country][bucket].add(name)
        generators = {}
        skipped_generators = {}
        for style, pattern_json in connection.execute("SELECT style_key,pattern FROM fantasy_meta ORDER BY style_key"):
            category, _, key = style.partition(".")
            if category != "towns_and_cities" and not (category == "places" and key in PLACE_GENERATORS):
                continue
            pattern = json.loads(pattern_json)
            arrays = {}
            for array_name, values_json in connection.execute(
                    "SELECT array_name,values_json FROM fantasy_arrays WHERE style_key=? ORDER BY array_name", (style,)):
                # Array repetitions and empty phonemes are meaningful source weights.
                arrays[array_name] = [unicodedata.normalize("NFC", value) for value in json.loads(values_json)]
            variants = pattern.get("variants", [])
            if not variants or any(not variant.get("concat") or any(
                    part not in arrays or not arrays[part] for part in variant["concat"]) for variant in variants):
                skipped_generators[style] = "Source pattern has absent or empty referenced phoneme arrays"
                continue
            generators[style] = {"pattern": pattern, "arrays": arrays}
    finally:
        connection.close()
    if (before.st_size, before.st_mtime_ns) != (database.stat().st_size, database.stat().st_mtime_ns):
        raise ValueError("Source changed during export")
    countries = {country: {bucket: sample.values() for bucket, sample in buckets.items()}
                 for country, buckets in sorted(samples.items())}
    payload = encode({"schemaVersion": 1, "version": VERSION, "countries": countries, "generators": generators})
    if len(payload) >= 12 * 1024 * 1024:
        raise ValueError(f"Pack exceeds 12 MiB raw budget: {len(payload)} bytes")
    try:
        revision = subprocess.check_output(["git", "-C", str(database.parent.parent), "rev-parse", "HEAD"], text=True, stderr=subprocess.DEVNULL).strip()
    except (subprocess.CalledProcessError, FileNotFoundError):
        revision = None
    counts = {country: {bucket: len(names) for bucket, names in buckets.items()}
              for country, buckets in countries.items()}
    manifest = {
        "schemaVersion": 1, "version": VERSION,
        "source": {"database": "namebench/data/names.db", "sha256": digest,
                   "bytes": before.st_size, "namebenchRevision": revision,
                   "tables": ["places", "fantasy_meta", "fantasy_arrays"],
                   "placesRowsScanned": scanned,
                   "provenance": [
                       {"data": "places", "upstream": "GeoNames allCountries.zip", "url": "https://www.geonames.org/", "notes": "Original name column retained by Namebench importer; no ASCII/transliterated alternative names."},
                       {"data": "generators", "upstream": "Snake4life fantasy-names", "url": "https://github.com/Snake4life/fantasy-names", "notes": "Namebench-extracted patterns and phoneme arrays; only towns_and_cities and selected generic places, no franchise categories or descriptions."}]},
        "sampling": {"algorithm": "Streaming bottom-k BLAKE2b-128 of UTF-8 seed/country/bucket/NFC-name; ascending hash output", "seed": SEED,
                     "limitsPerCountry": LIMITS, "normalization": "Unicode NFC, trim surrounding whitespace, exact string dedup per country/bucket; no case folding, diacritic stripping or transliteration",
                     "featureCodes": {"settlements": sorted(SETTLEMENTS), "water": sorted(WATER), "lakes": sorted(LAKES), "relief": sorted(RELIEF), "regions": sorted(REGIONS)},
                     "skippedGenerators": skipped_generators,
                     "notes": "Equal per-country caps prioritize geographic diversity over population. Empty and small pools reflect source coverage; eligible counts include duplicate rows. Generator array order, duplicates and empty phonemes are preserved."},
        "counts": {"countries": len(countries), "names": sum(sum(item.values()) for item in counts.values()),
                   "byBucket": {bucket: sum(item[bucket] for item in counts.values()) for bucket in LIMITS},
                   "byCountry": counts, "eligibleRowsByCountry": {country: {bucket: rows[bucket] for bucket in LIMITS} for country, rows in sorted(eligible_rows.items())},
                   "generators": len(generators), "generatorValues": sum(len(values) for generator in generators.values() for values in generator["arrays"].values())},
        "artifact": {"file": "names-pack.json", "sha256": hashlib.sha256(payload).hexdigest(),
                     "rawBytes": len(payload), "gzipBytes": len(gzip.compress(payload, compresslevel=9, mtime=0)), "gzipLevel": 9},
        "limitations": ["Current GeoNames country pools are geographic style samples, not historical attestations or language-pure lexicons.",
                        "No alternate-name or transliteration expansion; source spelling noise remains possible.",
                        "Upstream dataset and generator redistribution terms remain applicable; Namebench does not provide a unified data license."]}
    return payload, encode(manifest)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--database", type=Path, default=ROOT.parent / "namebench/data/names.db")
    parser.add_argument("--output", type=Path, default=ROOT / "web/src/gen/names/data")
    parser.add_argument("--check", action="store_true", help="Re-extract and byte-compare both committed artifacts without writing")
    args = parser.parse_args()
    payload, manifest = export(args.database.resolve())
    artifacts = {"names-pack.json": payload, "names-manifest.json": manifest}
    if args.check:
        different = [name for name, data in artifacts.items() if not (args.output / name).exists() or (args.output / name).read_bytes() != data]
        if different:
            print("Artifacts differ: " + ", ".join(different), file=sys.stderr)
            return 1
        print("Namebench pack and manifest match byte-for-byte.")
    else:
        args.output.mkdir(parents=True, exist_ok=True)
        for name, data in artifacts.items():
            (args.output / name).write_bytes(data)
            print(f"Wrote {name}: {len(data):,} bytes")
    summary = json.loads(manifest)
    print(json.dumps({"counts": summary["counts"]["byBucket"], "countries": summary["counts"]["countries"], "generators": summary["counts"]["generators"], "artifact": summary["artifact"]}, ensure_ascii=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
