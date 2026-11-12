"""Generation and PNG export sizes are distinct: resizing adds no model detail."""
import math

GENERATION_PIXELS = (393216, 786432, 1048576, 2097152, 4194304, 8294400)
EXPORT_PIXELS = (0, 4194304, 8388608, 16777216)


def choice(settings, name, default, choices):
    raw = settings.get(name, default)
    try:
        value = float(raw)
        if isinstance(raw, bool) or value not in choices:
            raise ValueError()
    except (ValueError, TypeError, OverflowError):
        raise ValueError('Résolution non prise en charge.') from None
    return int(value)


def resolution_settings(settings):
    mode = settings.get('mode', 'cloud')
    pixels = choice(settings, 'pixels', 1048576, GENERATION_PIXELS)
    output = choice(settings, 'outputPixels', 0, EXPORT_PIXELS)
    if mode == 'fast' and settings.get('sdxlVariant', 'lightning') == 'lightning' and pixels > 1048576:
        raise ValueError('Lightning est limité à un mégapixel ; choisissez SDXL complet pour une plus grande génération.')
    if mode != 'cloud' and pixels > 4194304:
        raise ValueError('La génération locale est limitée à 4 MP. Les exports peuvent être agrandis davantage.')
    if mode == 'cloud' and settings.get('provider', 'openai') != 'openai' and pixels > 2097152:
        raise ValueError('Choisissez au maximum 2 MP avec ce fournisseur.')
    return {'pixels': pixels, 'outputPixels': output}


def openai_dimensions(width, height, pixels):
    """GPT Image custom sizes: <=3840/edge, <=8294400 pixels, multiples of 16."""
    scale = min(math.sqrt(max(786432, pixels) / (width * height)), 3840 / max(width, height))
    w, h = max(16, math.floor(width * scale / 16) * 16), max(16, math.floor(height * scale / 16) * 16)
    if max(w, h) / min(w, h) > 3 or w*h < 655360:
        raise ValueError('Format OpenAI incompatible : conservez un rapport inférieur ou égal à 3:1.')
    return w, h
