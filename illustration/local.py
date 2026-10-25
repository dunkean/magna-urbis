"""Built-in local pipelines, lazy loaded and serialized by the job worker."""
import gc
from importlib.metadata import version
import os
import time

FAST_BASE = "stabilityai/stable-diffusion-xl-base-1.0"
FAST_CONTROL = "xinsir/controlnet-union-sdxl-1.0"
FAST_LIGHTNING = "ByteDance/SDXL-Lightning"
QUALITY_BASE = "Tongyi-MAI/Z-Image-Turbo"
QUALITY_CONTROL = "alibaba-pai/Z-Image-Turbo-Fun-Controlnet-Union-2.1"
QUALITY_FILE = "Z-Image-Turbo-Fun-Controlnet-Union-2.1-2602-8steps.safetensors"
REVISIONS = {
    FAST_BASE: "462165984030d82259a11f4367a4eed129e94a7b",
    FAST_CONTROL: "801a4a3fa3d4c936f4feea95b98607bc6726f80c",
    FAST_LIGHTNING: "c9a24f48e1c025556787b0c58dd67a091ece2e44",
    QUALITY_BASE: "f332072aa78be7aecdf3ee76d5c247082da564a6",
    QUALITY_CONTROL: "5155fc56d17821007d6f62ac192c09e0f0e72016",
}


def control_kinds(mode, requested, guides):
    if requested == "auto":
        # Depth alone cannot carry street/river positions. Preserve those by
        # default: SDXL combines both; Z-Image's single-guide path uses edges.
        requested = "both" if mode == "fast" and "depth" in guides else "edges"
    if requested not in ("edges", "depth", "both"):
        raise ValueError("Guide inconnu.")
    kinds = ["edges", "depth"] if requested == "both" else [requested]
    if any(kind not in guides for kind in kinds):
        raise ValueError("Ce guide est absent de la capture. Choisissez les contours ou capturez une vue 3D.")
    if mode == "quality" and len(kinds) > 1:
        raise ValueError("Le moteur Z-Image intégré utilise un seul guide à la fois. Le double contrôle est disponible avec SDXL.")
    return kinds


class LocalRuntime:
    def __init__(self):
        self.pipe = None
        self.identity = None

    def release(self):
        self.pipe = None
        self.identity = None
        gc.collect()
        import torch
        if torch.cuda.is_available():
            torch.cuda.empty_cache()

    def load(self, mode, steps, progress, check):
        identity = (mode, steps if mode == "fast" else 8)
        if identity == self.identity:
            return self.pipe
        self.release()
        import torch
        if not torch.cuda.is_available():
            raise RuntimeError("Les moteurs locaux nécessitent actuellement CUDA. Utilisez le mode API sur cette machine.")
        progress("loading", 0, "Chargement des modèles (première utilisation : téléchargement des poids)…")
        from huggingface_hub import hf_hub_download
        if mode == "fast":
            from diffusers import ControlNetUnionModel, StableDiffusionXLControlNetUnionPipeline, UNet2DConditionModel, EulerDiscreteScheduler
            from safetensors.torch import load_file
            control = ControlNetUnionModel.from_pretrained(FAST_CONTROL, revision=REVISIONS[FAST_CONTROL], torch_dtype=torch.float16)
            check()
            unet = UNet2DConditionModel.from_config(UNet2DConditionModel.load_config(FAST_BASE, subfolder="unet", revision=REVISIONS[FAST_BASE]))
            filename = f"sdxl_lightning_{steps}step_unet.safetensors"
            unet.load_state_dict(load_file(hf_hub_download(FAST_LIGHTNING, filename, revision=REVISIONS[FAST_LIGHTNING])))
            unet.to(dtype=torch.float16)
            pipe = StableDiffusionXLControlNetUnionPipeline.from_pretrained(
                FAST_BASE, revision=REVISIONS[FAST_BASE], unet=unet, controlnet=control, torch_dtype=torch.float16, variant="fp16", use_safetensors=True, add_watermarker=False)
            pipe.scheduler = EulerDiscreteScheduler.from_config(pipe.scheduler.config, timestep_spacing="trailing")
        else:
            from diffusers import ZImageControlNetModel, ZImageControlNetPipeline
            control = ZImageControlNetModel.from_single_file(hf_hub_download(QUALITY_CONTROL, QUALITY_FILE, revision=REVISIONS[QUALITY_CONTROL]), torch_dtype=torch.bfloat16)
            check()
            pipe = ZImageControlNetPipeline.from_pretrained(QUALITY_BASE, revision=REVISIONS[QUALITY_BASE], controlnet=control, torch_dtype=torch.bfloat16)
        check()
        pipe.set_progress_bar_config(disable=True)
        if mode == "quality":
            # Z-Image ControlNet shares its refiner/embeddings with the transformer.
            # Independent Accelerate CPU-offload hooks on those shared modules can
            # fight each other; explicitly stage the encoder and the denoiser instead.
            pipe.vae.to("cuda")
        elif torch.cuda.mem_get_info()[0] > 12 * 1024**3:
            pipe.to("cuda")
        else:
            # In particular, release the text encoder between encoding and denoising.
            pipe.enable_model_cpu_offload()
        pipe.vae.enable_tiling()
        self.pipe, self.identity = pipe, identity
        return pipe

    def generate(self, mode, prompt, guides, size, settings, progress, check):
        import torch
        from .images import png
        steps = int(settings.get("steps", 4 if mode == "fast" else 8))
        if steps not in ((4, 8) if mode == "fast" else (8,)):
            raise ValueError("Utilisez 4 ou 8 étapes pour Lightning et 8 étapes pour Z-Image Turbo ControlNet.")
        kinds = control_kinds(mode, settings.get("control", "auto"), guides)
        pipe = self.load(mode, steps, progress, check)
        check()
        scale = {"strong": .95, "balanced": .75, "free": .45}[settings.get("fidelity", "strong")]
        seed = int(settings.get("seed", 0))
        generator = torch.Generator(device="cpu").manual_seed(seed)
        def callback(_pipe, step, _timestep, values):
            check()
            progress("generating", (step + 1) / steps, f"Génération {step + 1}/{steps}")
            return values
        common = dict(prompt=prompt, height=size[1], width=size[0], num_inference_steps=steps,
                      guidance_scale=0.0, generator=generator, callback_on_step_end=callback)
        progress("generating", 0, "Génération de l’illustration…")
        begin = time.monotonic()
        with torch.inference_mode():
            if mode == "fast":
                image = pipe(**common, control_image=[guides[k] for k in kinds],
                             control_mode=[3 if k == "edges" else 1 for k in kinds], controlnet_conditioning_scale=scale).images[0]
            else:
                progress("encoding", 0, "Description de la scène et préparation du modèle qualité…")
                pipe.transformer.to("cpu"); pipe.controlnet.to("cpu"); torch.cuda.empty_cache()
                pipe.text_encoder.to("cuda")
                embeddings, _ = pipe.encode_prompt(prompt, device=torch.device("cuda"), do_classifier_free_guidance=False)
                pipe.text_encoder.to("cpu"); torch.cuda.empty_cache(); check()
                pipe.transformer.to("cuda"); pipe.controlnet.to("cuda")
                common.pop("prompt")
                try:
                    image = pipe(**common, prompt_embeds=embeddings, control_image=guides[kinds[0]], controlnet_conditioning_scale=scale).images[0]
                finally:
                    pipe.transformer.to("cpu"); pipe.controlnet.to("cpu"); torch.cuda.empty_cache()
        check()
        return png(image), {"provider": "local", "model": FAST_BASE if mode == "fast" else QUALITY_BASE,
                            "controlModel": FAST_CONTROL if mode == "fast" else QUALITY_CONTROL,
                            "checkpoint": f"sdxl_lightning_{steps}step_unet.safetensors" if mode == "fast" else QUALITY_FILE,
                            "licenses": ["OpenRAIL++", "Apache-2.0"] if mode == "fast" else ["Apache-2.0"],
                            "controls": kinds, "controlScale": scale, "steps": steps, "seed": seed,
                            "inferenceSeconds": round(time.monotonic() - begin, 3),
                            "revisions": {name: REVISIONS[name] for name in ([FAST_BASE, FAST_CONTROL, FAST_LIGHTNING] if mode == "fast" else [QUALITY_BASE, QUALITY_CONTROL])},
                            "torch": torch.__version__, "device": torch.cuda.get_device_name(),
                            "runtime": {name: version(name) for name in ("torch", "diffusers", "transformers", "accelerate")}}
