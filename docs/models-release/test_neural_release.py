import hashlib
import importlib.util
import json
import io
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

SPEC = importlib.util.spec_from_file_location('neural_release', Path(__file__).resolve().parents[2] / 'scripts/neural_release.py')
r = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(r)
CATALOG_SPEC = importlib.util.spec_from_file_location('neural_model_catalog', Path(__file__).resolve().parents[2] / 'web/scripts/neural_model_catalog.py')
catalog = importlib.util.module_from_spec(CATALOG_SPEC)
CATALOG_SPEC.loader.exec_module(catalog)

class ReleaseTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.assets = self.root / 'assets'
        self.assets.mkdir()
        self.source = self.root / 'weights'
        self.source.mkdir()
        data = b'inference weights'
        (self.source / 'student.pt').write_bytes(data)
        self.inventory = {'models': {'student': {'file': 'student.pt', 'bytes': len(data), 'sha256': hashlib.sha256(data).hexdigest()}}}
        (self.assets / 'model-inventory.json').write_text(json.dumps(self.inventory), encoding='utf-8')
        for name in (*r.CONFIGS, 'LICENSE-TEACHER.txt'):
            (self.assets / name).write_text(name, encoding='utf-8')
        card = self.root / 'docs/models-release/MODEL_CARD.md'
        card.parent.mkdir(parents=True)
        card.write_text('Model card', encoding='utf-8')
        (card.parent / 'LICENSE').write_text('MIT license', encoding='utf-8')
        self.patches = [patch.object(r, 'ROOT', self.root), patch.object(r, 'ASSETS', self.assets), patch.object(r, 'INVENTORY', self.inventory), patch.object(r, 'DISTILLED', ('student',))]
        for p in self.patches: p.start()

    def tearDown(self):
        for p in reversed(self.patches): p.stop()
        self.temp.cleanup()

    def test_corrupt_weights_fail_before_export(self):
        (self.source / 'student.pt').write_bytes(b'X' * len(b'inference weights'))
        output = self.root / 'release'
        with self.assertRaisesRegex(ValueError, 'SHA-256 mismatch'): r.prepare(self.source, output)
        self.assertFalse(output.exists())

    def test_release_boundary_and_inventory(self):
        output = self.root / 'release'
        r.prepare(self.source, output)
        r.validate_release(output)
        (output / 'secret.txt').write_text('must never upload')
        with self.assertRaisesRegex(ValueError, 'exactly'): r.validate_release(output)
        (output / 'secret.txt').unlink()
        (output / 'LICENSE').write_text('changed')
        with self.assertRaisesRegex(ValueError, 'license'): r.validate_release(output)
        (output / 'LICENSE').write_text('MIT license')
        (output / 'model-inventory.json').write_text('{}')
        with self.assertRaisesRegex(ValueError, 'inventory'): r.validate_release(output)

    def test_revision_and_destination(self):
        with self.assertRaises(Exception): r.commit_revision('main')
        self.assertEqual(r.commit_revision('a' * 40), 'a' * 40)
        output = self.root / 'release'
        output.mkdir()
        (output / 'existing').write_text('preserve')
        with self.assertRaisesRegex(ValueError, 'empty'): r.prepare(self.source, output)
        self.assertEqual((output / 'existing').read_text(), 'preserve')

    def test_git_blob_verification(self):
        path = self.root / 'config.json'
        path.write_bytes(b'{}')
        digest = hashlib.sha1(b'blob 2\0{}').hexdigest()
        self.assertEqual(r.verify_git_blob(path, digest), path)
        with self.assertRaisesRegex(ValueError, 'Git blob'): r.verify_git_blob(path, '0' * 40)

    def test_json_status_is_offline_and_reports_corruption(self):
        with patch.object(r, 'hub', side_effect=AssertionError('must remain offline')), patch('sys.stdout', new_callable=io.StringIO) as stdout:
            self.assertEqual(r.main(['status', '--weights-dir', str(self.source), '--json']), 0)
            self.assertTrue(json.loads(stdout.getvalue())['models'][0]['ok'])
        (self.source / 'student.pt').write_bytes(b'bad')
        with patch.object(r, 'hub', side_effect=AssertionError('must remain offline')), patch('sys.stdout', new_callable=io.StringIO) as stdout:
            self.assertEqual(r.main(['status', '--weights-dir', str(self.source), '--json']), 1)
            self.assertFalse(json.loads(stdout.getvalue())['ok'])

    def test_distilled_download_is_pinned_and_verified(self):
        calls = []
        def download(**kwargs):
            calls.append(kwargs)
            return str(self.source / 'student.pt')
        output = self.root / 'download'
        with patch.object(r, 'hub', return_value=(download, None)), patch('sys.stdout', new_callable=io.StringIO):
            self.assertEqual(r.main(['download-distilled', '--repo', 'owner/model', '--revision', 'a' * 40, '--output', str(output), '--cache-dir', str(self.root / 'cache'), '--local-files-only']), 0)
        self.assertEqual(calls[0]['revision'], 'a' * 40)
        self.assertTrue(calls[0]['local_files_only'])
        self.assertEqual(calls[0]['cache_dir'], self.root / 'cache')
        self.assertEqual((output / 'student.pt').read_bytes(), b'inference weights')

    def test_bundled_bytes_follow_present_files(self):
        with patch.object(catalog, 'ASSETS', self.assets), patch.object(catalog, '_inventory', self.inventory):
            self.assertEqual(catalog.catalog()['bundledBytes'], 0)
            (self.assets / 'student.pt').write_bytes(b'abc')
            self.assertEqual(catalog.catalog()['bundledBytes'], 3)

    def test_interrupted_copy_preserves_target_and_cleans_temporary_file(self):
        target = self.root / 'student.pt'
        target.write_bytes(b'old')
        def interrupted(source, dest):
            Path(dest).write_bytes(b'partial')
            raise OSError('interrupted')
        with patch.object(r.shutil, 'copyfile', side_effect=interrupted):
            with self.assertRaisesRegex(OSError, 'interrupted'):
                r.safe_copy(self.source / 'student.pt', target, replace=True)
        self.assertEqual(target.read_bytes(), b'old')
        self.assertEqual(list(self.root.glob('.student.pt.*.tmp')), [])

    def test_corrupt_download_repaired_only_with_verified_source(self):
        output = self.root / 'download'
        output.mkdir()
        target = output / 'student.pt'
        target.write_bytes(b'bad')
        invalid = self.root / 'invalid.pt'
        invalid.write_bytes(b'bad source')
        args = ['download-distilled', '--repo', 'owner/model', '--revision', 'a' * 40, '--output', str(output)]
        with patch.object(r, 'hub', return_value=(lambda **kw: str(invalid), None)), patch('sys.stdout', new_callable=io.StringIO):
            with self.assertRaises(ValueError): r.main(args)
        self.assertEqual(target.read_bytes(), b'bad')
        with patch.object(r, 'hub', return_value=(lambda **kw: str(self.source / 'student.pt'), None)), patch('sys.stdout', new_callable=io.StringIO):
            self.assertEqual(r.main(args), 0)
        self.assertEqual(target.read_bytes(), b'inference weights')

    def test_runtime_rechecks_switched_or_changed_weights(self):
        other = self.root / 'other'
        other.mkdir()
        (other / 'student.pt').write_bytes(b'X' * len(b'inference weights'))
        with patch.object(catalog, '_inventory', self.inventory), patch.object(catalog, '_verified', {}), patch.dict('os.environ', {'MAGNA_NEURAL_WEIGHTS_DIR': str(self.source)}):
            self.assertEqual(catalog.verified_model('student'), self.source / 'student.pt')
            with patch.dict('os.environ', {'MAGNA_NEURAL_WEIGHTS_DIR': str(other)}):
                with self.assertRaisesRegex(RuntimeError, 'integrity'): catalog.verified_model('student')
            (self.source / 'student.pt').write_bytes(b'bad')
            with self.assertRaisesRegex(RuntimeError, 'integrity'): catalog.verified_model('student')

if __name__ == '__main__': unittest.main()
