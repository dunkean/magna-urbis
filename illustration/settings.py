"""Validated local inference controls, shared by preview, submission and runtime."""
import math

NEGATIVE_PROMPT = "untextured blockout, plain cuboids, clay render, low-poly placeholder buildings, blurry architecture, distorted perspective, modern skyscrapers, text, watermark, interface"
CONTROL_PRESETS = {
    "balanced": {"edgeScale": .3, "edgeStart": 0., "edgeEnd": .45, "depthScale": .6, "depthStart": 0., "depthEnd": .7},
    "plan": {"edgeScale": .65, "edgeStart": 0., "edgeEnd": .8, "depthScale": .4, "depthStart": 0., "depthEnd": .65},
    "volume": {"edgeScale": .15, "edgeStart": 0., "edgeEnd": .35, "depthScale": .7, "depthStart": 0., "depthEnd": .75},
    "free": {"edgeScale": .15, "edgeStart": 0., "edgeEnd": .3, "depthScale": .35, "depthStart": 0., "depthEnd": .5},
}


def numeric(settings, name, default, low, high, integer=False):
    raw = settings.get(name, default)
    if isinstance(raw, bool):
        raise ValueError(f"Réglage {name} invalide.")
    try:
        value = float(raw)
    except (TypeError, ValueError):
        raise ValueError(f"Réglage {name} invalide.") from None
    if not math.isfinite(value) or not low <= value <= high or (integer and not value.is_integer()):
        raise ValueError(f"{name} doit être compris entre {low} et {high}.")
    return int(value) if integer else value


def local_settings(mode, settings):
    if mode == "cloud":
        return {}
    if mode not in ("fast", "quality"):
        raise ValueError("Moteur inconnu.")
    result = {}
    if mode == "fast":
        variant = settings.get("sdxlVariant", "lightning")
        if variant not in ("base", "lightning"):
            raise ValueError("Version SDXL inconnue.")
        result["sdxlVariant"] = variant
        initializer = settings.get('sdxlInit', 'noise')
        if initializer not in ('noise', 'source'):
            raise ValueError('Initialisation SDXL inconnue.')
        result['sdxlInit'] = initializer
        preset = settings.get("controlPreset", "balanced")
        if preset not in (*CONTROL_PRESETS, "custom"):
            raise ValueError("Préréglage ControlNet inconnu.")
        result["controlPreset"] = preset
        defaults = CONTROL_PRESETS.get(preset, CONTROL_PRESETS["balanced"])
        for name, default in defaults.items():
            result[name] = numeric(settings, name, default, 0, 1.5 if name.endswith("Scale") else 1)
        for kind in ("edge", "depth"):
            if result[kind + "Start"] >= result[kind + "End"]:
                raise ValueError("Le début du contrôle doit précéder sa fin.")
        result["guideResolution"] = numeric(settings, "guideResolution", 512, 128, 2048, True)
        result["sdxlGuidance"] = numeric(settings, "sdxlGuidance", 6, 1, 12)
        result["denoiseStrength"] = numeric(settings, "denoiseStrength", .85, .2, 1)
        allowed_steps = (20, 30, 40, 50) if variant == "base" else (4, 8)
        default_steps = 30 if variant == "base" else 4
    else:
        variant = settings.get("fluxVariant", "distilled")
        if variant not in ("base", "distilled"):
            raise ValueError("Version FLUX inconnue.")
        result["fluxVariant"] = variant
        reference = settings.get("referenceMode", "source")
        if reference not in ("source", "source+edges", "source+depth", "edges"):
            raise ValueError("Référence FLUX inconnue.")
        result["referenceMode"] = reference
        result["referenceResolution"] = numeric(settings, "referenceResolution", 1024, 128, 2048, True)
        result["guideResolution"] = numeric(settings, "guideResolution", 512, 128, 2048, True)
        result["fluxGuidance"] = numeric(settings, "fluxGuidance", 4, 1, 8)
        allowed_steps = (20, 30, 40, 50) if variant == "base" else (4,)
        default_steps = 30 if variant == "base" else 4
    steps = numeric(settings, "steps", default_steps, 1, 60, True)
    if steps not in allowed_steps:
        raise ValueError("Étapes possibles pour cette version : " + ", ".join(map(str, allowed_steps)) + ".")
    result["steps"] = steps
    negative = settings.get("negativePrompt", NEGATIVE_PROMPT)
    if not isinstance(negative, str) or len(negative) > 1500:
        raise ValueError("Le prompt négatif est limité à 1500 caractères.")
    result["negativePrompt"] = negative
    return result
