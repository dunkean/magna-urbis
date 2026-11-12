import base64
import io
import json
import tempfile
import threading
import unittest
from http.server import ThreadingHTTPServer
from unittest.mock import patch
import urllib.request
from PIL import Image
from illustration.__main__ import handler_for
from illustration.images import png
from illustration.outpaint import neighbour_context
from illustration.service import IllustrationService


class MosaicTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.calls = 0
        def provider(*_):
            color = ['red', 'blue', 'green', 'yellow'][self.calls % 4]
            self.calls += 1
            return png(Image.new('RGB', (64, 48), color)), {'model': 'test'}
        self.service = IllustrationService(self.directory.name, cloud_generate=provider)
        self.body = {'version': 1, 'image': 'data:image/png;base64,'+base64.b64encode(png(Image.new('RGB', (64, 48)))).decode(),
                     'context': {'sourceId': 'world', 'projection': 'orthographic', 'camera': {'cx': 100, 'cy': 100, 'scale': 2},
                                 'extentMetres': {'width': 32, 'height': 24}, 'viewport': {'width': 640, 'height': 480}},
                     'settings': {'mode': 'cloud', 'provider': 'openai', 'style': 'rpg', 'output': 'battlemap', 'grid': 'none'}}
        self.root = self.finish(self.body)
        self.east = self.neighbour(self.root, 'east', [self.root])
        self.southeast = self.neighbour(self.east, 'south', [self.root, self.east])

    def tearDown(self):
        self.service.queue.join(); self.service.close(); self.service.worker.join(3); self.directory.cleanup()

    def finish(self, body):
        job = self.service.submit(body); self.service.queue.join(); job = self.service.get(job['id'])
        self.assertEqual(job['status'], 'succeeded', job['message'])
        return job

    def neighbour(self, parent, direction, known):
        return self.finish({**self.body, 'context': neighbour_context(parent, direction),
                            'continuation': {'parentId': parent['id'], 'direction': direction, 'neighbours': [job['id'] for job in known]}})

    def test_global_png_removes_overlaps_preserves_pixels_and_keeps_holes_transparent(self):
        ids = [self.root['id'], self.east['id'], self.southeast['id']]
        # Exercise multiple strips and IDAT chunks even with this tiny fixture.
        with patch('illustration.mosaic.STRIP_BYTES', 1024):
            result = self.service.export_mosaic({'version': 1, 'jobs': ids})
        self.assertEqual((result['width'], result['height'], result['tiles']), (115, 86, 3))
        with Image.open(self.service.mosaic_asset(result['id']+'.png')) as image:
            image.load()
            self.assertEqual(image.mode, 'RGBA')
            self.assertEqual(image.getpixel((1, 1)), (255, 0, 0, 255))
            self.assertEqual(image.getpixel((51, 5)), (255, 0, 0, 255), 'The protected overlap is retained once.')
            self.assertEqual(image.getpixel((100, 5)), (0, 0, 255, 255))
            self.assertEqual(image.getpixel((100, 70)), (0, 128, 0, 255))
            self.assertEqual(image.getpixel((1, 70)), (0, 0, 0, 0))
        again = self.service.export_mosaic({'version': 1, 'jobs': ids})
        self.assertEqual(result['id'], again['id'])
        self.assertEqual(self.calls, 3, 'Exporting must never generate or bill another image.')

    def test_export_covers_negative_offsets_and_deduplicates_tiles(self):
        west = self.neighbour(self.root, 'west', [self.root, self.east])
        result = self.service.export_mosaic({'version': 1, 'jobs': [self.root['id'], west['id'], self.east['id'], west['id']]})
        self.assertEqual((result['width'], result['height'], result['tiles']), (166, 48, 3))

    def test_atlas_restores_siblings_when_opened_from_a_generated_neighbour(self):
        restored = self.service.atlas(self.southeast['id'])
        self.assertEqual(restored['rootId'], self.root['id'])
        self.assertEqual({job['id'] for job in restored['jobs']}, {self.root['id'], self.east['id'], self.southeast['id']})
        with Image.open(self.service.asset(self.east['id'], 'preview.png')) as preview:
            self.assertEqual(preview.size, (64, 48))

    def test_rejects_mixed_atlases_unfinished_tiles_and_bad_paths(self):
        unrelated = self.finish(self.body)
        with self.assertRaises(ValueError): self.service.export_mosaic({'version': 1, 'jobs': [self.root['id'], unrelated['id']]})
        for invalid in ([], None, [self.root['id']]*129):
            with self.assertRaises(ValueError): self.service.export_mosaic({'version': 1, 'jobs': invalid})
        self.service.jobs[self.east['id']]['status'] = 'queued'
        with self.assertRaises(ValueError): self.service.export_mosaic({'version': 1, 'jobs': [self.root['id'], self.east['id']]})
        for path in ('../metadata.json', 'x.png', 'a'*64+'/result.png'):
            with self.assertRaises(KeyError): self.service.mosaic_asset(path)

    def test_http_export_streams_one_downloadable_png(self):
        server = ThreadingHTTPServer(('127.0.0.1', 0), handler_for(self.service))
        thread = threading.Thread(target=server.serve_forever, daemon=True); thread.start()
        base = f'http://127.0.0.1:{server.server_port}'
        try:
            request = urllib.request.Request(base+'/v1/illustrations/mosaics',
                json.dumps({'version': 1, 'jobs': [self.root['id'], self.east['id'], self.southeast['id']]}).encode(), {'Content-Type': 'application/json'})
            with urllib.request.urlopen(request) as response:
                result = json.load(response)
            with urllib.request.urlopen(base+result['url']) as response:
                self.assertIn('attachment', response.headers['Content-Disposition'])
                self.assertEqual(response.headers['Content-Type'], 'image/png')
                data = response.read()
                self.assertEqual(len(data), int(response.headers['Content-Length']))
                with Image.open(io.BytesIO(data)) as image: self.assertEqual(image.size, (115, 86))
            with urllib.request.urlopen(base+f'/v1/illustrations/jobs/{self.east["id"]}/atlas') as response:
                self.assertEqual(len(json.load(response)['jobs']), 3)
        finally:
            server.shutdown(); server.server_close(); thread.join(3)


if __name__ == '__main__': unittest.main()
