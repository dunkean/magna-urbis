"""Built-in local pipelines, lazy loaded and serialized by the job worker."""
import gc
from importlib.metadata import version
import time
from .settings import local_settings

FAST_BASE = "stabilityai/stable-diffusion-xl-base-1.0"
FAST_CONTROL = "xinsir/controlnet-union-sdxl-1.0"
FAST_LIGHTNING = "ByteDance/SDXL-Lightning"
QUALITY_BASE = "black-forest-labs/FLUX.2-klein-4B"
QUALITY_FULL = "black-forest-labs/FLUX.2-klein-base-4B"
REVISIONS = {
    FAST_BASE: "462165984030d82259a11f4367a4eed129e94a7b",
    FAST_CONTROL: "801a4a3fa3d4c936f4feea95b98607bc6726f80c",
    FAST_LIGHTNING: "c9a24f48e1c025556787b0c58dd67a091ece2e44",
    QUALITY_BASE: "e7b7dc27f91deacad38e78976d1f2b499d76a294",
    QUALITY_FULL: "a3b4f4849157f664bdbc776fd7453c2783562f4d",
}


def control_kinds(mode, requested, guides):
    if mode == "quality":
        if requested != "auto":
            raise ValueError("FLUX utilise directement l’image source. Choisissez le guide automatique.")
        return ["reference"]
    if requested == "auto":
        requested = "both" if "depth" in guides else "edges"
    if requested not in ("edges", "depth", "both"):
        raise ValueError("Guide inconnu.")
    kinds = ["edges", "depth"] if requested == "both" else [requested]
    if any(kind not in guides for kind in kinds):
        raise ValueError("Ce guide est absent de la capture. Choisissez les contours ou capturez une vue 3D.")
    return kinds


def prompt_chunks(text, tokenizers):
    """Fit complete words in both CLIP contexts; never silently drop the tail."""
    chunks, current = [], ''
    def fits(value):
        return all(len(tokenizer(value, add_special_tokens=False).input_ids) <= tokenizer.model_max_length - 2 for tokenizer in tokenizers)
    for word in text.split():
        candidate = (current + ' ' + word).strip()
        if fits(candidate):
            current = candidate
        else:
            if current:
                chunks.append(current)
            if not fits(word):
                raise ValueError('Un mot du prompt dépasse la capacité du texte SDXL ; séparez-le par des espaces.')
            current = word
    return chunks + [current] if current else chunks or ['']


def encode_sdxl_prompt(pipe, prompt, negative, guidance, check):
    import torch
    tokenizers = [pipe.tokenizer, pipe.tokenizer_2]
    positive = prompt_chunks(prompt, tokenizers)
    negative_chunks = prompt_chunks(negative, tokenizers) if guidance > 1 else []
    count = max(len(positive), len(negative_chunks))
    encoded = []
    for index in range(count):
        check()
        encoded.append(pipe.encode_prompt(prompt=positive[index] if index < len(positive) else '',
            negative_prompt=negative_chunks[index] if index < len(negative_chunks) else '',
            device=pipe._execution_device, do_classifier_free_guidance=guidance > 1))
    return dict(prompt_embeds=torch.cat([value[0] for value in encoded], dim=1),
                negative_prompt_embeds=torch.cat([value[1] for value in encoded], dim=1) if guidance > 1 else None,
                pooled_prompt_embeds=encoded[0][2], negative_pooled_prompt_embeds=encoded[0][3]), count


class LocalRuntime:
    def __init__(self):
        self.pipe = None
        self.identity = None
        self.sdxl_reference = False

    def release(self):
        self.pipe = None
        self.identity = None
        self.sdxl_reference = False
        gc.collect()
        import torch
        if torch.cuda.is_available():
            torch.cuda.empty_cache()

    def load(self, mode, steps, progress, check, *, variant=None):
        variant = variant or ('lightning' if mode == 'fast' else 'distilled')
        identity = (mode, variant, steps if mode == 'fast' and variant == 'lightning' else None)
        if identity == self.identity:
            progress("preparing", 0, "Réutilisation du modèle déjà en mémoire…")
            return self.pipe
        self.release()
        import torch
        if not torch.cuda.is_available():
            raise RuntimeError("Les moteurs locaux nécessitent actuellement CUDA. Utilisez le mode API sur cette machine.")
        progress("loading", 0, "Chargement des modèles (première utilisation : téléchargement des poids)…")
        from huggingface_hub import hf_hub_download
        if mode == "fast":
            from diffusers import ControlNetUnionModel, StableDiffusionXLControlNetUnionPipeline, UNet2DConditionModel, EulerDiscreteScheduler, DPMSolverMultistepScheduler
            from diffusers.models.controlnets.multicontrolnet_union import MultiControlNetUnionModel
            from safetensors.torch import load_file
            control = ControlNetUnionModel.from_pretrained(FAST_CONTROL, revision=REVISIONS[FAST_CONTROL], torch_dtype=torch.float16)
            check()
            options = {}
            if variant == 'lightning':
                unet = UNet2DConditionModel.from_config(UNet2DConditionModel.load_config(FAST_BASE, subfolder="unet", revision=REVISIONS[FAST_BASE]))
                filename = f"sdxl_lightning_{steps}step_unet.safetensors"
                unet.load_state_dict(load_file(hf_hub_download(FAST_LIGHTNING, filename, revision=REVISIONS[FAST_LIGHTNING])))
                unet.to(dtype=torch.float16)
                options['unet'] = unet
            # Shared weights, independent forward passes/scales/windows for the two guides.
            controls = MultiControlNetUnionModel([control, control])
            pipe = StableDiffusionXLControlNetUnionPipeline.from_pretrained(
                FAST_BASE, revision=REVISIONS[FAST_BASE], controlnet=controls, torch_dtype=torch.float16, variant="fp16", use_safetensors=True, add_watermarker=False, **options)
            pipe.scheduler = (EulerDiscreteScheduler.from_config(pipe.scheduler.config, timestep_spacing="trailing") if variant == 'lightning' else
                              DPMSolverMultistepScheduler.from_config(pipe.scheduler.config, use_karras_sigmas=True, algorithm_type='dpmsolver++'))
        else:
            from diffusers import Flux2KleinPipeline
            model = QUALITY_FULL if variant == 'base' else QUALITY_BASE
            pipe = Flux2KleinPipeline.from_pretrained(model, revision=REVISIONS[model], dtype=torch.bfloat16)
        check()
        pipe.set_progress_bar_config(disable=True)
        if mode == "quality":
            pipe.enable_model_cpu_offload()
        elif torch.cuda.mem_get_info()[0] > 12 * 1024**3:
            pipe.to("cuda")
        else:
            # In particular, release the text encoder between encoding and denoising.
            pipe.enable_model_cpu_offload()
        pipe.vae.enable_tiling()
        self.pipe, self.identity = pipe, identity
        return pipe

    def sdxl_pipeline(self, reference):
        """Switch pipeline classes while sharing the loaded weights and scheduler."""
        if reference == self.sdxl_reference:
            return self.pipe
        from diffusers import StableDiffusionXLControlNetUnionPipeline, StableDiffusionXLControlNetUnionImg2ImgPipeline
        pipe = self.pipe
        offload = bool(getattr(pipe, '_all_hooks', []))
        if offload:
            pipe.remove_all_hooks()
        pipeline = StableDiffusionXLControlNetUnionImg2ImgPipeline if reference else StableDiffusionXLControlNetUnionPipeline
        pipe = pipeline.from_pipe(pipe, dtype=pipe.unet.dtype)
        pipe.set_progress_bar_config(disable=True)
        if offload:
            pipe.enable_model_cpu_offload()
        self.pipe, self.sdxl_reference = pipe, reference
        return pipe

    def generate(self, mode, prompt, guides, size, settings, progress, check, *, source=None):
        import torch
        from PIL import Image
        from .images import png, reference_images, simplify_guide
        config = local_settings(mode, settings)
        steps = config['steps']
        variant = config['sdxlVariant' if mode == 'fast' else 'fluxVariant']
        kinds = control_kinds(mode, settings.get("control", "auto"), guides)
        source_init = mode == 'fast' and variant == 'base' and config['sdxlInit'] == 'source'
        uses_source = mode == 'quality' or source_init
        if uses_source and source is None:
            raise ValueError("Ce rendu nécessite l’image source.")
        requested_identity = (mode, variant, steps if mode == 'fast' and variant == 'lightning' else None)
        cache_hit = self.pipe is not None and self.identity == requested_identity
        pipe = self.load(mode, steps, progress, check, variant=variant)
        if mode == 'fast' and variant == 'base':
            pipe = self.sdxl_pipeline(source_init)
        check()
        guidance = config['sdxlGuidance'] if mode == 'fast' and variant == 'base' else config['fluxGuidance'] if mode == 'quality' and variant == 'base' else 0.0 if mode == 'fast' else 1.0
        seed = int(settings.get("seed", 0))
        generator = torch.Generator(device="cpu").manual_seed(seed)
        actual_steps = max(1, int(steps * config['denoiseStrength'])) if source_init else steps
        def callback(_pipe, step, _timestep, values):
            check()
            progress("generating", (step + 1) / actual_steps, f"Génération {step + 1}/{actual_steps}")
            return values
        common = dict(prompt=prompt, height=size[1], width=size[0], num_inference_steps=steps,
                      guidance_scale=guidance, generator=generator, callback_on_step_end=callback)
        progress("generating", 0, "Génération de l’illustration…")
        begin = time.monotonic()
        chunks, reference_sizes = None, None
        scales, starts, ends = None, None, None
        with torch.inference_mode():
            if mode == "fast":
                progress('encoding', 0, 'Encodage du prompt SDXL complet…')
                embeds, chunks = encode_sdxl_prompt(pipe, prompt, config['negativePrompt'], guidance, check)
                common.pop('prompt')
                if source_init:
                    common.update(image=source.resize(size, Image.Resampling.LANCZOS), strength=config['denoiseStrength'])
                blank = Image.new('RGB', size)
                images = [simplify_guide(guides[k], config['guideResolution'], size, k == 'edges') if k in kinds else blank for k in ('edges', 'depth')]
                scales = [config['edgeScale'] if 'edges' in kinds else 0., config['depthScale'] if 'depth' in kinds else 0.]
                starts, ends = [config['edgeStart'], config['depthStart']], [config['edgeEnd'], config['depthEnd']]
                image = pipe(**common, **embeds, control_image=images, control_mode=[3, 1],
                             controlnet_conditioning_scale=scales, control_guidance_start=starts, control_guidance_end=ends).images[0]
            else:
                references = reference_images(source, guides, size, config)
                reference_sizes = [list(image.size) for image in references]
                kinds = ['reference' if part == 'source' else part for part in config['referenceMode'].split('+')]
                if variant == 'base' and config['negativePrompt'] and guidance > 1:
                    progress('encoding', 0, 'Encodage des prompts positif et négatif FLUX…')
                    positive, _ = pipe.encode_prompt(prompt=prompt, device=torch.device('cuda'))
                    negative, _ = pipe.encode_prompt(prompt=config['negativePrompt'], device=torch.device('cuda'))
                    common.pop('prompt')
                    common.update(prompt_embeds=positive, negative_prompt_embeds=negative)
                progress("generating", 0, "FLUX : génération avec les références sélectionnées…")
                image = pipe(**common, image=references).images[0]
        check()
        model = FAST_BASE if mode == 'fast' else QUALITY_FULL if variant == 'base' else QUALITY_BASE
        revisions = [FAST_BASE, FAST_CONTROL] + ([FAST_LIGHTNING] if variant == 'lightning' else []) if mode == 'fast' else [model]
        return png(image), {"provider": "local", "model": model, 'variant': variant,
                            "controlModel": FAST_CONTROL if mode == "fast" else None,
                            "checkpoint": f"sdxl_lightning_{steps}step_unet.safetensors" if mode == "fast" and variant == 'lightning' else 'unet/diffusion_pytorch_model.fp16.safetensors' if mode == 'fast' else "transformer/diffusion_pytorch_model.safetensors",
                            "licenses": ["OpenRAIL++", "Apache-2.0"] if mode == "fast" else ["Apache-2.0"],
                            "controls": kinds, "controlScale": scales, 'controlStart': starts, 'controlEnd': ends,
                            'effectiveSettings': config, 'promptChunks': chunks, 'referenceSizes': reference_sizes, "steps": steps, "seed": seed,
                            "modelCacheHit": cache_hit,
                            "referenceImage": uses_source, "denoisingSteps": actual_steps, "guidanceScale": common["guidance_scale"],
                            "inferenceSeconds": round(time.monotonic() - begin, 3),
                            "revisions": {name: REVISIONS[name] for name in revisions},
                            "torch": torch.__version__, "device": torch.cuda.get_device_name(),
                            "runtime": {name: version(name) for name in ("torch", "diffusers", "transformers", "accelerate")}}
