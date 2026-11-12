import base64
import math
import tempfile
import unittest
from PIL import Image
from illustration.battlemap import availability, draw_grid, ground_frame
from illustration.context import compile_prompt, STYLES
from illustration.images import png
from illustration.service import IllustrationService
from illustration.outpaint import neighbour_context
from illustration.resolution import openai_dimensions


def scene(width=60, height=40):
    return {'sourceId': 'test-world', 'projection': 'orthographic', 'viewport': {'width': 900, 'height': 600},
            'extentMetres': {'width': width, 'height': height}, 'camera': {'cx': 0, 'cy': 0},
            'visibleScene': {'measured': True, 'medianBuildingSpanMetres': 12},
            'environment': {'relief': 'flat', 'biome': 'forest'}}


class BattlemapTests(unittest.TestCase):
    def test_zoom_and_resolution_gate(self):
        self.assertTrue(availability(scene())['eligible'])
        self.assertTrue(availability(scene(300, 200))['eligible'])
        self.assertTrue(availability(scene(300, 200))['warning'])
        self.assertFalse(availability(scene(1200, 800))['eligible'])
        self.assertTrue(availability(scene(1200, 800), cell_metres=6)['eligible'])
        self.assertFalse(availability(scene(2, 2))['eligible'])
        self.assertFalse(availability({'projection': 'globe'})['eligible'])
        self.assertTrue(availability(scene(120, 80), 393216)['eligible'])
        self.assertTrue(availability(scene(120, 80), 2097152)['eligible'])

    def test_perspective_footprint_uses_actual_clearance_and_excludes_walk_and_horizon(self):
        context = {'projection': 'perspective', 'viewport': {'width': 800, 'height': 600},
                   'camera': {'distance': 50, 'pitch': 1.48, 'heightAboveTargetMetres': 50}}
        self.assertTrue(availability(context)['eligible'])
        vertical = {**context, 'camera': {'distance': 20, 'pitch': math.pi / 2, 'verticalFovDegrees': 90}}
        self.assertAlmostEqual(ground_frame(vertical)['width'], 160 / 3, places=6)
        self.assertAlmostEqual(ground_frame(vertical)['height'], 40, places=6)
        context['camera']['heightAboveTargetMetres'] = 500
        self.assertFalse(availability(context)['eligible'])
        context['camera'].pop('heightAboveTargetMetres')
        context['camera']['pitch'] = math.pi / 4
        self.assertIn('75°', availability(context)['reason'])
        context['camera']['pitch'] = .1
        self.assertIsNone(ground_frame(context))
        context['camera'].update(pitch=1.48, navigation='walk')
        self.assertFalse(availability(context)['eligible'])

    def test_all_engines_receive_scale_camera_and_requested_art_direction(self):
        context = scene()
        for style, vocabulary in [('fineart-photo', 'fine-art photorealistic'), ('rpg', 'role-playing'),
                                   ('pencil', 'graphite'), ('watercolor', 'translucent washes')]:
            compiled = compile_prompt(context, {'style': style, 'output': 'battlemap'})
            for key in ('prompt', 'fastPrompt', 'localPrompt'):
                self.assertIn(vocabulary, compiled[key])
                self.assertIn('60.0 m wide by 40.0 m high', compiled[key])
                self.assertIn('12.0 m across', compiled[key])
                self.assertIn('orthographic', compiled[key])
                self.assertIn('1.50 m', compiled[key])
                self.assertIn('No tokens', compiled[key])
                self.assertIn('never squeeze a whole town', compiled[key])
        for style in STYLES:
            self.assertEqual(compile_prompt(context, {'style': style})['style'], style)

    def test_offscreen_generation_defaults_cannot_invent_a_city(self):
        context = scene()
        context['generation'] = {'culture': 'roman-core', 'population': 30000, 'river': True, 'coast': True}
        context['visibleScene'].update(sampledTerrainCells=20, water={'land': 20})
        compiled = compile_prompt(context, {})
        self.assertIn('natural terrain landscape', compiled['description'])
        self.assertNotIn('Roman', compiled['description'])
        self.assertNotIn('map contains a river', compiled['description'])
        self.assertNotIn('map includes a coast', compiled['description'])

    def test_grid_spacing_is_measured_and_aligned_with_world_coordinates(self):
        context = scene(60, 45)
        image = draw_grid(Image.new('RGB', (600, 450), 'white'), context)
        self.assertEqual(image.getpixel((7, 7)), (255, 255, 255))
        for x in (15, 30, 45, 300, 585):
            self.assertNotEqual(image.getpixel((x, 7)), (255, 255, 255))
        context['camera']['cx'] = .5
        shifted = draw_grid(Image.new('RGB', (600, 450), 'white'), context)
        self.assertNotEqual(shifted.getpixel((10, 7)), (255, 255, 255))
        self.assertEqual(shifted.getpixel((15, 7)), (255, 255, 255))
        # The line has one dark stroke, no light outline on either side.
        grey = draw_grid(Image.new('RGB', (600, 450), (140, 140, 140)), scene(60, 45))
        self.assertEqual(grey.getpixel((14, 7)), (140, 140, 140))
        self.assertEqual(grey.getpixel((16, 7)), (140, 140, 140))
        self.assertLess(grey.getpixel((15, 7))[0], 140)
        larger = draw_grid(Image.new('RGB', (600, 450), 'white'), scene(60, 45), {'cellMetres': 3})
        self.assertEqual(larger.getpixel((15, 7)), (255, 255, 255))
        self.assertNotEqual(larger.getpixel((30, 7)), (255, 255, 255))

    def test_hex_cells_have_one_shared_edge_and_correct_size(self):
        image = draw_grid(Image.new('RGB', (600, 600), 'white'), scene(60, 60), {'grid': 'hex', 'cellMetres': 6})
        # A cell centred at (0,0) has opposite faces 60 pixels apart.
        for y in (270, 330):
            self.assertNotEqual(image.getpixel((300, y)), (255, 255, 255))
        self.assertEqual(image.getpixel((300, 300)), (255, 255, 255))
        self.assertEqual(image.getpixel((300, 269)), (255, 255, 255))
        self.assertEqual(image.getpixel((300, 331)), (255, 255, 255))
        # Shared borders must not receive a second semi-transparent stroke.
        self.assertEqual(image.getpixel((300, 270)), image.getpixel((300, 330)))
        prompt = compile_prompt(scene(), {'output': 'battlemap', 'grid': 'hex', 'cellMetres': 3})['prompt']
        self.assertIn('3.00 m per hexagonal cell', prompt)
        self.assertIn('opposite faces', prompt)
        for invalid in (0, -1, True, float('nan'), 101, 'oops'):
            with self.assertRaises(ValueError): compile_prompt(scene(), {'cellMetres': invalid})

    def test_openai_sizes_reach_4k_without_exceeding_documented_limits(self):
        self.assertEqual(openai_dimensions(1920, 1080, 8294400), (3840, 2160))
        for aspect in ((1, 1), (1, 3), (3, 1), (9, 16)):
            w, h = openai_dimensions(*aspect, 8294400)
            self.assertEqual(w % 16, 0)
            self.assertEqual(h % 16, 0)
            self.assertLessEqual(max(w, h), 3840)
            self.assertLessEqual(w*h, 8294400)

    def test_service_validates_preview_and_submit_and_keeps_gridless_artwork(self):
        with tempfile.TemporaryDirectory() as directory:
            def provider(*_):
                return png(Image.new('RGB', (900, 600), 'white')), {'model': 'test'}
            service = IllustrationService(directory, cloud_generate=provider)
            body = {'version': 1, 'context': scene(), 'image': 'data:image/png;base64,' + base64.b64encode(png(Image.new('RGB', (90, 60)))).decode(),
                    'settings': {'mode': 'cloud', 'style': 'rpg', 'output': 'battlemap', 'pixels': 1048576}}
            try:
                self.assertTrue(service.preview_prompt(body)['battlemap']['eligible'])
                for operation in (service.preview_prompt, service.submit):
                    invalid = {**body, 'context': scene(1200, 800)}
                    with self.assertRaisesRegex(ValueError, 'Battlemap indisponible'):
                        operation(invalid)
                for grid in ('square', 'hex', 'none'):
                    body['settings']['grid'] = grid
                    job = service.submit(body)
                    service.queue.join()
                    job = service.get(job['id'])
                    self.assertEqual(job['status'], 'succeeded', job['message'])
                    self.assertEqual(job['battlemap']['cellMetres'], 1.5)
                    self.assertEqual(job['battlemap']['grid'], grid)
                    self.assertEqual(job['outputSize'], [900, 600], 'Native provider detail must not be rescaled to the budget.')
                    if grid != 'none':
                        self.assertNotEqual(service.asset(job['id'], 'artwork.png').read_bytes(), service.asset(job['id'], 'result.png').read_bytes())
                    else:
                        with self.assertRaises(KeyError): service.asset(job['id'], 'artwork.png')
            finally:
                service.queue.join()
                service.close()
                service.worker.join(3)

    def test_outpaint_preserves_all_known_pixels_and_sends_a_real_alpha_mask(self):
        with tempfile.TemporaryDirectory() as directory:
            calls = []
            def provider(_provider, _key, _model, prompt, source, guides, settings):
                calls.append((prompt, source.copy(), {k: v.copy() for k, v in guides.items()}))
                return png(Image.new('RGB', (900, 600), 'red' if len(calls) == 1 else 'blue')), {'model': 'test'}
            service = IllustrationService(directory, cloud_generate=provider)
            body = {'version': 1, 'context': scene(), 'image': 'data:image/png;base64,' + base64.b64encode(png(Image.new('RGB', (90, 60)))).decode(),
                    'settings': {'mode': 'cloud', 'provider': 'openai', 'model': 'test', 'style': 'rpg', 'output': 'battlemap', 'grid': 'none', 'pixels': 1048576}}
            try:
                first = service.submit(body); service.queue.join(); first = service.get(first['id'])
                neighbour = {**body, 'context': neighbour_context(first, 'east'), 'continuation': {'parentId': first['id'], 'direction': 'east', 'neighbours': []}}
                second = service.submit(neighbour); service.queue.join(); second = service.get(second['id'])
                self.assertEqual(second['status'], 'succeeded', second['message'])
                self.assertIn('OUTPAINTING', calls[1][0])
                mask = calls[1][2]['mask']
                self.assertEqual(mask.mode, 'RGBA')
                self.assertEqual(mask.getpixel((1, 20))[3], 255)
                self.assertEqual(mask.getpixel((70, 20))[3], 0)
                with Image.open(service.asset(second['id'], 'result.png')) as image:
                    self.assertEqual(image.getpixel((179, 300)), (255, 0, 0))
                    self.assertEqual(image.getpixel((180, 300)), (0, 0, 255))
                self.assertEqual(service.submit(neighbour)['id'], second['id'])
                returning = {**body, 'context': neighbour_context(second, 'west'), 'continuation': {'parentId': second['id'], 'direction': 'west', 'neighbours': [first['id']]}}
                self.assertEqual(service.submit(returning)['id'], first['id'])
                self.assertEqual(len(calls), 2, 'A cached tile must not cause another provider request.')
                invalid = {**neighbour, 'context': scene()}
                with self.assertRaisesRegex(ValueError, 'cadrage attendu'): service.submit(invalid)
                for provider_id in ('gemini',):
                    with self.assertRaises(ValueError): service.submit({**neighbour, 'settings': {**body['settings'], 'provider': provider_id}})
            finally:
                service.queue.join(); service.close(); service.worker.join(3)

    def test_large_export_reports_native_size_and_draws_a_crisp_grid_after_resizing(self):
        with tempfile.TemporaryDirectory() as directory:
            service = IllustrationService(directory, cloud_generate=lambda *_: (png(Image.new('RGB', (900, 600), 'white')), {}))
            body = {'version': 1, 'context': scene(), 'image': 'data:image/png;base64,' + base64.b64encode(png(Image.new('RGB', (90, 60)))).decode(),
                    'settings': {'mode': 'cloud', 'output': 'battlemap', 'grid': 'square', 'cellMetres': 3, 'outputPixels': 4194304}}
            try:
                job = service.submit(body); service.queue.join(); job = service.get(job['id'])
                self.assertEqual(job['status'], 'succeeded', job['message'])
                self.assertEqual(job['nativeOutputSize'], [900, 600])
                self.assertTrue(job['upscaled'])
                self.assertGreater(job['outputSize'][0] * job['outputSize'][1], 4_000_000)
                with Image.open(service.asset(job['id'], 'result.png')) as image:
                    colors = {image.getpixel((x, 7)) for x in range(image.width)}
                    self.assertEqual(len(colors), 2, 'Resizing an already drawn grid would blur its edges into intermediate colours.')
            finally:
                service.queue.join(); service.close(); service.worker.join(3)


if __name__ == '__main__':
    unittest.main()
