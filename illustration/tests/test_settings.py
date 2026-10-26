import unittest
from illustration.settings import local_settings
from illustration.local import prompt_chunks


class SettingsTests(unittest.TestCase):
    def test_complete_versions_have_real_cfg_and_step_controls(self):
        sdxl = local_settings('fast', {'sdxlVariant': 'base', 'steps': 40, 'sdxlGuidance': 7.5, 'controlPreset': 'volume'})
        self.assertEqual(sdxl['steps'], 40)
        self.assertEqual(sdxl['sdxlGuidance'], 7.5)
        self.assertEqual((sdxl['edgeScale'], sdxl['depthScale']), (.15, .7))
        flux = local_settings('quality', {'fluxVariant': 'base', 'steps': 50, 'fluxGuidance': 3.5, 'referenceMode': 'source+edges'})
        self.assertEqual((flux['steps'], flux['fluxGuidance']), (50, 3.5))
        self.assertEqual(flux['referenceMode'], 'source+edges')

    def test_invalid_controls_and_schedules_are_rejected(self):
        for setting in ({'edgeScale': 1.6}, {'edgeEnd': 0}, {'depthStart': .8, 'depthEnd': .5},
                        {'sdxlGuidance': float('nan')}, {'guideResolution': -1}, {'edgeScale': True},
                        {'sdxlVariant': 'base', 'steps': 4}, {'controlPreset': 'unknown'}, {'denoiseStrength': .1}):
            with self.subTest(setting=setting), self.assertRaises(ValueError):
                local_settings('fast', setting)
        for setting in ({'fluxVariant': 'base', 'steps': 4}, {'referenceMode': 'invalid'},
                        {'fluxGuidance': 9}, {'referenceResolution': 0}, {'negativePrompt': 'x' * 1501}):
            with self.subTest(setting=setting), self.assertRaises(ValueError):
                local_settings('quality', setting)

    def test_prompt_tail_is_kept_across_small_clip_contexts(self):
        from types import SimpleNamespace
        class Tokenizer:
            model_max_length = 6
            def __call__(self, text, **kwargs):
                return SimpleNamespace(input_ids=text.split())
        text = 'Aerial view of a complete Japanese village in watercolor with detailed roofs'
        chunks = prompt_chunks(text, [Tokenizer(), Tokenizer()])
        self.assertEqual(' '.join(chunks), text)
        self.assertTrue(all(len(chunk.split()) <= 4 for chunk in chunks))
        self.assertIn('detailed roofs', chunks[-1])

    def test_flux_references_fit_token_grid_without_cropping_the_view(self):
        from PIL import Image
        from illustration.images import reference_images
        source = Image.new('RGB', (2048, 1225), 'red')
        settings = local_settings('quality', {'referenceMode': 'source+edges', 'referenceResolution': 2048})
        images = reference_images(source, {'edges': Image.new('RGB', (1328, 784))}, (1328, 784), settings)
        self.assertTrue(all(image.width % 16 == image.height % 16 == 0 for image in images))
        self.assertTrue(all(image.width * image.height <= 1048576 for image in images))
        self.assertEqual(images[1].size, (512, 304))
