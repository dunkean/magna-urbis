"""Validate the quality editor dispatch without loading model weights or CUDA."""
import importlib.util
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch
from PIL import Image
from illustration.local import LocalRuntime, QUALITY_BASE, QUALITY_FULL


@unittest.skipUnless(importlib.util.find_spec('torch'), 'Local runtime not installed')
class QualityEditTests(unittest.TestCase):
    def test_switching_models_does_not_pin_previous_weights_during_loading(self):
        import weakref
        class Pipeline:
            def __call__(self, **kwargs):
                return SimpleNamespace(images=[Image.new('RGB', (96, 64))])
        runtime = LocalRuntime()
        runtime.pipe, runtime.identity = Pipeline(), ('fast', 'base', None)
        previous = weakref.ref(runtime.pipe)
        def load(*args, **kwargs):
            runtime.pipe = None
            self.assertIsNone(previous(), 'Old model weights must be releasable before loading the next model.')
            runtime.pipe = Pipeline()
            return runtime.pipe
        with patch.object(runtime, 'load', side_effect=load), patch('torch.cuda.get_device_name', return_value='test device'):
            _, meta = runtime.generate('quality', 'Detailed city', {}, (96, 64), {}, lambda *args: None, lambda: None,
                                       source=Image.new('RGB', (96, 64)))
        self.assertFalse(meta['modelCacheHit'])

    def test_switching_sdxl_initialization_keeps_half_precision_and_cached_identity(self):
        import sys
        import torch
        runtime = LocalRuntime()
        original = SimpleNamespace(unet=SimpleNamespace(dtype=torch.float16))
        converted = SimpleNamespace(set_progress_bar_config=Mock())
        factory = SimpleNamespace(from_pipe=Mock(return_value=converted))
        runtime.pipe, runtime.identity = original, ('fast', 'base', None)
        with patch.dict(sys.modules, {'diffusers': SimpleNamespace(StableDiffusionXLControlNetUnionPipeline=factory, StableDiffusionXLControlNetUnionImg2ImgPipeline=factory)}):
            self.assertIs(runtime.sdxl_pipeline(True), converted)
            self.assertIs(runtime.sdxl_pipeline(True), converted)
        factory.from_pipe.assert_called_once_with(original, dtype=torch.float16)
        self.assertEqual(runtime.identity, ('fast', 'base', None))

    def test_quality_passes_color_reference_and_edit_prompt_directly_to_flux(self):
        calls = []
        class Pipeline:
            def __call__(self, **kwargs):
                calls.append(kwargs)
                kwargs['callback_on_step_end'](self, 3, None, {})
                return SimpleNamespace(images=[Image.new('RGB', (96, 64), 'green')])
        runtime = LocalRuntime()
        runtime.pipe, runtime.identity = Pipeline(), ('quality', 'distilled', None)
        source = Image.new('RGB', (96, 64), (20, 80, 120))
        messages = []
        with patch('torch.cuda.get_device_name', return_value='test device'):
            data, meta = runtime.generate('quality', 'Edit this image; keep the plan; freely enrich details.',
                {'edges': Image.new('RGB', source.size)}, source.size, {'seed': 42},
                lambda *args: messages.append(args), lambda: None, source=source)
        self.assertEqual(calls[0]['image'][0].getpixel((30, 30)), (20, 80, 120))
        self.assertEqual(calls[0]['num_inference_steps'], 4)
        self.assertEqual(calls[0]['guidance_scale'], 1.0)
        self.assertNotIn('control_image', calls[0])
        self.assertEqual(meta['model'], QUALITY_BASE)
        self.assertEqual(meta['controls'], ['reference'])
        self.assertTrue(meta['referenceImage'])
        self.assertTrue(meta['modelCacheHit'])
        self.assertTrue(data.startswith(b'\x89PNG'))
        self.assertIn(('generating', 1.0, 'Génération 4/4'), messages)

    def test_quality_rejects_a_missing_reference_before_loading_weights(self):
        runtime = LocalRuntime()
        with patch.object(runtime, 'load') as load:
            with self.assertRaisesRegex(ValueError, 'image source'):
                runtime.generate('quality', 'prompt', {}, (96, 64), {}, lambda *args: None, lambda: None)
            load.assert_not_called()

    def test_sdxl_passes_independent_control_weights_and_cutoffs_and_complete_prompt(self):
        import torch
        calls, text_calls = [], []
        class Tokenizer:
            model_max_length = 6
            def __call__(self, text, **kwargs):
                return SimpleNamespace(input_ids=text.split())
        class Pipeline:
            tokenizer = tokenizer_2 = Tokenizer()
            _execution_device = torch.device('cpu')
            def encode_prompt(self, **kwargs):
                text_calls.append(kwargs)
                return torch.zeros(1, 6, 2), torch.zeros(1, 6, 2), torch.zeros(1, 2), torch.zeros(1, 2)
            def __call__(self, **kwargs):
                calls.append(kwargs)
                return SimpleNamespace(images=[Image.new('RGB', (96, 64))])
        runtime = LocalRuntime()
        runtime.pipe, runtime.identity = Pipeline(), ('fast', 'base', None)
        runtime.sdxl_reference = True
        with patch('torch.cuda.get_device_name', return_value='test device'):
            _, meta = runtime.generate('fast', 'Aerial view of an ancient Egyptian town with detailed courtyards and painted facades',
                {'edges': Image.new('RGB', (96, 64), 'white'), 'depth': Image.new('RGB', (96, 64), 'gray')}, (96, 64),
                {'sdxlVariant': 'base', 'sdxlInit': 'source', 'steps': 30, 'edgeScale': .2, 'edgeEnd': .35, 'depthScale': .7, 'depthStart': .1, 'depthEnd': .75},
                lambda *args: None, lambda: None, source=Image.new('RGB', (96, 64), 'blue'))
        self.assertIn('painted facades', ' '.join(call['prompt'] for call in text_calls))
        self.assertNotIn('prompt', calls[0])
        self.assertEqual(calls[0]['controlnet_conditioning_scale'], [.2, .7])
        self.assertEqual(calls[0]['control_guidance_start'], [0, .1])
        self.assertEqual(calls[0]['control_guidance_end'], [.35, .75])
        self.assertEqual(calls[0]['guidance_scale'], 6)
        self.assertEqual(calls[0]['image'].getpixel((0, 0)), (0, 0, 255))
        self.assertEqual(calls[0]['strength'], .85)
        self.assertEqual(calls[0]['prompt_embeds'].shape, calls[0]['negative_prompt_embeds'].shape)
        self.assertGreater(meta['promptChunks'], 1)
        self.assertTrue(meta['modelCacheHit'])

    def test_complete_flux_receives_both_references_and_negative_embeddings(self):
        import torch
        calls, texts = [], []
        class Pipeline:
            def encode_prompt(self, **kwargs):
                texts.append(kwargs['prompt'])
                return torch.zeros(1, 6, 2), torch.zeros(6, 4)
            def __call__(self, **kwargs):
                calls.append(kwargs)
                return SimpleNamespace(images=[Image.new('RGB', (96, 64))])
        runtime = LocalRuntime()
        runtime.pipe, runtime.identity = Pipeline(), ('quality', 'base', None)
        with patch('torch.cuda.get_device_name', return_value='test device'):
            _, meta = runtime.generate('quality', 'Keep the plan, freely redraw architecture.', {'edges': Image.new('RGB', (96, 64), 'white')},
                (96, 64), {'fluxVariant': 'base', 'steps': 30, 'referenceMode': 'source+edges', 'fluxGuidance': 3.5, 'negativePrompt': 'plain cubes'},
                lambda *args: None, lambda: None, source=Image.new('RGB', (96, 64), 'red'))
        self.assertEqual(texts, ['Keep the plan, freely redraw architecture.', 'plain cubes'])
        self.assertEqual(len(calls[0]['image']), 2)
        self.assertEqual(calls[0]['guidance_scale'], 3.5)
        self.assertIn('negative_prompt_embeds', calls[0])
        self.assertEqual(meta['model'], QUALITY_FULL)
        self.assertEqual(meta['controls'], ['reference', 'edges'])


if __name__ == '__main__':
    unittest.main()
