import base64
import io
import json
import tempfile
import threading
import time
import unittest
from pathlib import Path
from unittest.mock import patch
from http.server import ThreadingHTTPServer
import urllib.error
import urllib.request
from PIL import Image
from illustration.context import compile_prompt, dimensions
from illustration.images import png
from illustration.service import IllustrationService
from illustration.providers import generate
from illustration.local import control_kinds
from illustration.__main__ import handler_for, origin_allowed


def encoded(size=(96, 64), color='white'):
    return 'data:image/png;base64,' + base64.b64encode(png(Image.new('RGB', size, color))).decode()


def request(**settings):
    return {'version': 1, 'image': encoded(), 'guides': {'edges': encoded(color='black')},
            'context': {'sourceStyle': 'parchment', 'projection': 'orthographic', 'culture': 'courtyard houses'},
            'settings': {'mode': 'cloud', **settings}, 'apiKey': 'private-test-key'}


class FakeRuntime:
    def generate(self, mode, prompt, guides, size, settings, progress, check):
        check()
        return png(Image.new('RGB', size, 'green')), {'model': 'fake', 'seed': settings['seed'], 'controls': list(guides)}


class ServiceTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.service = IllustrationService(self.directory.name, FakeRuntime(),
            lambda *args: (png(Image.new('RGB', (96, 64), 'blue')), {'model': 'cloud-test'}))

    def tearDown(self):
        self.service.queue.join()
        self.service.close()
        self.service.worker.join(3)
        self.directory.cleanup()

    def finish(self, job):
        self.service.queue.join()
        return self.service.get(job['id'])

    def test_cloud_job_is_persistent_and_never_saves_credentials(self):
        job = self.finish(self.service.submit(request()))
        self.assertEqual(job['status'], 'succeeded')
        self.assertEqual(job['resolvedStyle'], 'parchment')
        self.assertIn('orthographic', job['prompt'])
        self.assertEqual(job['outputSize'], [96, 64])
        for file in Path(self.directory.name).glob('*/*.json'):
            self.assertNotIn('private-test-key', file.read_text('utf-8'))
            self.assertNotIn('apiKey', file.read_text('utf-8'))
        self.assertTrue(self.service.asset(job['id'], 'source.png').is_file())
        self.assertEqual(self.service.history()[0]['id'], job['id'])
        self.service.jobs.clear()
        self.assertEqual(self.service.get(job['id'])['status'], 'succeeded')

    def test_prompt_preview_is_prose_without_an_image_job_or_credentials(self):
        body = request(mode='cloud'); body.pop('image'); body.pop('guides')
        preview = self.service.preview_prompt(body)
        self.assertIn('aerial view', preview['description'])
        self.assertIn('Edit the supplied source image itself', preview['prompt'])
        self.assertNotIn('private-test-key', json.dumps(preview))
        self.assertEqual(self.service.history(), [])

    def test_edited_cloud_prompt_is_preserved_in_preview_and_job(self):
        edited = 'My precise image edit. ' + 'Keep all architectural details. ' * 150
        body = request(mode='cloud', style='satellite', promptOverride=edited)
        self.assertEqual(self.service.preview_prompt(body)['prompt'], edited.strip())
        job = self.finish(self.service.submit(body))
        self.assertEqual(job['prompt'], edited.strip())
        self.assertEqual(job['settings']['promptOverride'], edited)
        self.assertTrue(job['promptCustomized'])
        with self.assertRaises(ValueError): self.service.preview_prompt(request(mode='fast', promptOverride=edited))
        with self.assertRaises(ValueError): self.service.submit(request(mode='cloud', promptOverride=' '))

    def test_fast_passes_aligned_guides_and_seed(self):
        job = self.finish(self.service.submit(request(mode='fast', seed=42)))
        self.assertEqual(job['status'], 'succeeded')
        self.assertEqual(job['provenance']['seed'], 42)
        self.assertIn('edges', job['provenance']['controls'])

    def test_rejects_misaligned_and_missing_depth(self):
        body = request(); body['guides']['depth'] = encoded((80, 64))
        with self.assertRaises(ValueError): self.service.submit(body)
        with self.assertRaises(ValueError): self.service.submit(request(control='depth'))

    def test_rejects_invalid_steps_resolution_and_protocol(self):
        for body in (request(mode='quality', steps=4), request(mode='fast', pixels=2097152), {**request(), 'version': 99}, request(seed=-1)):
            with self.assertRaises(ValueError): self.service.submit(body)
        body = request(provider='openai'); body.update(image=encoded((256, 64)), guides={})
        with self.assertRaisesRegex(ValueError, 'ratio 3:1'): self.service.submit(body)

    def test_cancel_running_cloud_prevents_result_and_delete_does_not_resurrect(self):
        entered, release = threading.Event(), threading.Event()
        def provider(*_args):
            entered.set(); release.wait(3)
            return png(Image.new('RGB', (16, 16))), {}
        self.service.cloud_generate = provider
        job = self.service.submit(request())
        self.assertTrue(entered.wait(3))
        self.service.cancel(job['id']); self.service.delete(job['id']); release.set()
        self.service.queue.join()
        self.assertFalse((Path(self.directory.name) / job['id']).exists())

    def test_error_redacts_key(self):
        def provider(*_args): raise RuntimeError('failure private-test-key')
        self.service.cloud_generate = provider
        job = self.finish(self.service.submit(request()))
        self.assertEqual(job['status'], 'failed')
        self.assertNotIn('private-test-key', json.dumps(job))

    def test_cancelled_queued_jobs_cannot_overflow_or_create_orphan_history(self):
        entered, release = threading.Event(), threading.Event()
        def provider(*_args):
            entered.set(); release.wait(5)
            return png(Image.new('RGB', (16, 16))), {}
        self.service.cloud_generate = provider
        self.service.submit(request())
        self.assertTrue(entered.wait(3))
        try:
            queued = [self.service.submit(request()) for _ in range(6)]
            for job in queued: self.service.cancel(job['id'])
            with self.assertRaisesRegex(ValueError, 'file est pleine'):
                self.service.submit(request())
            self.assertEqual(len(list(Path(self.directory.name).glob('*/metadata.json'))), 7)
        finally:
            release.set()

    def test_asset_traversal_rejected(self):
        with self.assertRaises(KeyError): self.service.get('../' * 8)
        job = self.finish(self.service.submit(request()))
        with self.assertRaises(KeyError): self.service.asset(job['id'], '../metadata.json')

    def test_http_routes_cors_host_and_payload(self):
        server = ThreadingHTTPServer(('127.0.0.1', 0), handler_for(self.service))
        thread = threading.Thread(target=server.serve_forever, daemon=True); thread.start()
        url = f'http://127.0.0.1:{server.server_port}'
        try:
            with urllib.request.urlopen(url + '/status') as response:
                self.assertEqual(json.load(response)['protocol'], 1)
            bad = urllib.request.Request(url + '/status', headers={'Origin': 'https://untrusted.example'})
            with self.assertRaises(urllib.error.HTTPError) as error: urllib.request.urlopen(bad)
            self.assertEqual(error.exception.code, 403)
            bad = urllib.request.Request(url + '/status', headers={'Host': 'untrusted.example'})
            with self.assertRaises(urllib.error.HTTPError): urllib.request.urlopen(bad)
            req = urllib.request.Request(url + '/v1/illustrations/jobs', json.dumps(request()).encode(), {'Content-Type': 'application/json', 'Origin': 'http://localhost:5173'})
            with urllib.request.urlopen(req) as response:
                self.assertEqual(response.status, 202)
                self.assertEqual(response.headers['Access-Control-Allow-Origin'], 'http://localhost:5173')
                job = json.load(response)
            self.finish(job)
            with urllib.request.urlopen(url + f'/v1/illustrations/jobs/{job["id"]}/result.png') as response:
                self.assertEqual(response.headers['Content-Type'], 'image/png')
        finally:
            server.shutdown(); server.server_close(); thread.join(3)


class AdapterTests(unittest.TestCase):
    def test_automatic_control_preserves_plan_in_both_local_engines(self):
        guides = {'edges': object(), 'depth': object()}
        self.assertEqual(control_kinds('fast', 'auto', guides), ['edges', 'depth'])
        self.assertEqual(control_kinds('quality', 'auto', guides), ['edges'])
        self.assertEqual(control_kinds('quality', 'depth', guides), ['depth'])
        with self.assertRaises(ValueError): control_kinds('quality', 'both', guides)
        with self.assertRaises(ValueError): control_kinds('fast', 'depth', {'edges': object()})

    def test_openai_edit_uploads_source_and_uses_private_header(self):
        image = Image.new('RGB', (64, 64))
        def transport(req, timeout):
            self.assertEqual(req.full_url, 'https://api.openai.com/v1/images/edits')
            self.assertEqual(req.get_header('Authorization'), 'Bearer session-key')
            self.assertIn(b'name="image[]"', req.data)
            self.assertIn(b'source image to reproduce in the requested new style', req.data)
            self.assertNotIn(b'session-key', req.data)
            return io.BytesIO(json.dumps({'data': [{'b64_json': base64.b64encode(png(image)).decode()}], 'usage': {'total_tokens': 1}}).encode())
        data, meta = generate('openai', 'session-key', '', 'prompt', image, {}, {}, transport=transport)
        self.assertEqual(Image.open(io.BytesIO(data)).size, (64, 64))
        self.assertEqual(meta['usage']['total_tokens'], 1)

    def test_gemini_edits_with_image_input(self):
        image = Image.new('RGB', (64, 64))
        def transport(req, timeout):
            self.assertEqual(req.get_header('X-goog-api-key'), 'session-key')
            self.assertEqual(json.loads(req.data)['contents'][0]['parts'][1]['inlineData']['mimeType'], 'image/png')
            return io.BytesIO(json.dumps({'candidates': [{'content': {'parts': [{'inlineData': {'mimeType': 'image/png', 'data': base64.b64encode(png(image)).decode()}}]}}]}).encode())
        data, meta = generate('gemini', 'session-key', '', 'prompt', image, {}, {}, transport=transport)
        self.assertTrue(data.startswith(b'\x89PNG'))
        self.assertIsNone(meta['seed'])

    def test_prompt_uses_style_geometry_and_facts(self):
        compiled = compile_prompt({'sourceStyle': 'parchment', 'projection': 'orthographic', 'biome': 'arid', 'apiKey': 'hidden'}, {'fidelity': 'strong'})
        self.assertEqual(compiled['style'], 'parchment')
        self.assertIn('arid', compiled['prompt'])
        self.assertIn('building footprints', compiled['prompt'])
        self.assertNotIn('hidden', compiled['prompt'])
        width, height = dimensions(1920, 1080, 786432)
        self.assertLess(abs(width / height - 1920 / 1080), .04)
        self.assertIn('do not invent urban development', compiled['localPrompt'])
        self.assertEqual(compile_prompt({'sourceStyle': 'fantasy-color'}, {})['style'], 'watercolor')

    def test_roman_plain_and_inca_snow_are_described_in_prose(self):
        roman = compile_prompt({'projection': 'orthographic', 'environment': {'relief': 'flat', 'climate': 'mediterranean'},
            'settlements': [{'urbanCulture': 'roman-core', 'name': 'Roma', 'population': 30000}],
            'architecture': {'roofSystems': ['tiled_hip'], 'materials': [{'label': 'fired clay tiles'}], 'storeys': [1, 2]}}, {'style': 'photorealistic'})
        self.assertIn('a Roman city in a Mediterranean plain', roman['description'])
        self.assertIn('fired clay tiles', roman['description'])
        self.assertIn('tiled hip', roman['description'])
        self.assertNotIn('Scene data:', roman['prompt'])
        self.assertNotIn('"urbanCulture"', roman['prompt'])
        self.assertIn('relative positions', roman['prompt'])
        self.assertIn('do not create a different scene', roman['prompt'])
        context = {'projection': 'perspective', 'environment': {'relief': 'mountains', 'snowCover': True},
                   'settlements': [{'urbanCulture': 'inca', 'population': 600}]}
        self.assertIn('an Inca village in snow-covered mountains', compile_prompt(context, {})['description'])
        context['environment'].pop('snowCover')
        self.assertNotIn('snow', compile_prompt(context, {})['description'])
        self.assertNotIn('Mediterranean', compile_prompt(context, {})['description'])

    def test_natural_world_does_not_inherit_an_unused_city_culture(self):
        compiled = compile_prompt({'application': 'neural-earth', 'generation': {'workflow': 'environment', 'culture': 'roman-core'},
                                   'environment': {'relief': 'mountains'}}, {})
        self.assertNotIn('Roman', compiled['description'])
        self.assertIn('natural terrain landscape', compiled['description'])

    def test_visible_layer_is_default_but_requested_style_overrides_it(self):
        for layer, expected in [('cadastre', 'cadastre'), ('parchment', 'parchment'), ('topographic', 'geographic'), ('satellite', 'satellite'), ('render', 'photorealistic')]:
            self.assertEqual(compile_prompt({'sourceStyle': layer}, {'style': 'auto'})['style'], expected)
        prompt = compile_prompt({'sourceStyle': 'parchment'}, {'style': 'satellite'})
        self.assertEqual(prompt['style'], 'satellite')
        self.assertIn('satellite imagery', prompt['prompt'])
        self.assertIn('source image itself', prompt['prompt'])

    def test_remote_origin_never_authorized_by_loopback_spelling(self):
        self.assertFalse(origin_allowed('https://localhost.evil.example'))
        self.assertFalse(origin_allowed('null'))
        self.assertTrue(origin_allowed('http://127.0.0.1:5173'))


if __name__ == '__main__': unittest.main()
