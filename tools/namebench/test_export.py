"""Focused, stdlib-only exporter checks; run python -m unittest discover -s tools/namebench."""
import gzip
import importlib.util
import json
from pathlib import Path
import sqlite3
import tempfile
import unittest

spec = importlib.util.spec_from_file_location("namebench_export", Path(__file__).with_name("export.py"))
exporter = importlib.util.module_from_spec(spec)
spec.loader.exec_module(exporter)


class ExportTests(unittest.TestCase):
    def test_sample_is_order_independent_and_distinct(self):
        values = [f"Rivière {i}" for i in range(1200)]
        a = exporter.Sample("FR", "water")
        b = exporter.Sample("FR", "water")
        for name in values + values[:30]:
            a.add(name)
        for name in reversed(values):
            b.add(name)
        self.assertEqual(a.values(), b.values())
        self.assertEqual(len(a.values()), 512)

    def test_feature_boundaries(self):
        self.assertEqual(exporter.bucket_for("H", "STM"), "water")
        self.assertEqual(exporter.bucket_for("H", "LK"), "lakes")
        for feature_class, code in [("H", "RSV"), ("H", "WLL"), ("H", "BAY"),
                                    ("P", "PPLQ"), ("P", "PPLH"), ("T", "ISL"), ("A", "ADM1H")]:
            self.assertIsNone(exporter.bucket_for(feature_class, code))

    def test_fixture_normalization_and_read_only_source(self):
        with tempfile.TemporaryDirectory() as directory:
            database = Path(directory) / "data" / "names.db"
            database.parent.mkdir()
            connection = sqlite3.connect(database)
            connection.executescript("""
                CREATE TABLE places(country_iso TEXT,name TEXT,feature_class TEXT,feature_code TEXT);
                CREATE TABLE fantasy_meta(style_key TEXT,pattern TEXT);
                CREATE TABLE fantasy_arrays(style_key TEXT,array_name TEXT,values_json TEXT);
            """)
            connection.executemany("INSERT INTO places VALUES (?,?,?,?)", [
                ("FR", "E\u0301vian", "P", "PPL"), ("FR", "Évian", "P", "PPL"),
                ("FR", "Loire", "H", "STM"), ("FR", "Léman", "H", "LK"),
                ("FR", "Abandoned", "P", "PPLQ"), ("JP", "日本山", "T", "MT")])
            pattern = json.dumps({"variants": [{"concat": ["nm1", "nm2"], "space": True, "space_pos": 1}]})
            connection.execute("INSERT INTO fantasy_meta VALUES (?,?)", ("places.rivers", pattern))
            connection.executemany("INSERT INTO fantasy_arrays VALUES (?,?,?)", [
                ("places.rivers", "nm1", '["","A","A"]'), ("places.rivers", "nm2", '["B"]')])
            connection.commit()
            connection.close()
            before = database.read_bytes()
            payload, metadata = exporter.export(database)
            self.assertEqual(database.read_bytes(), before)
            self.assertEqual((payload, metadata), exporter.export(database))
            pack, manifest = json.loads(payload), json.loads(metadata)
            self.assertEqual(pack["countries"]["FR"]["settlements"], ["Évian"])
            self.assertEqual(pack["countries"]["FR"]["water"], ["Loire"])
            self.assertEqual(pack["countries"]["FR"]["lakes"], ["Léman"])
            self.assertEqual(pack["countries"]["JP"]["relief"], ["日本山"])
            self.assertEqual(pack["generators"]["places.rivers"]["arrays"]["nm1"], ["", "A", "A"])
            self.assertEqual(manifest["artifact"]["rawBytes"], len(payload))
            self.assertEqual(manifest["artifact"]["gzipBytes"], len(gzip.compress(payload, compresslevel=9, mtime=0)))


if __name__ == "__main__":
    unittest.main()
