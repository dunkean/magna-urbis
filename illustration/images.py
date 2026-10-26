"""Image decoding and guide generation, isolated from model dependencies."""
import base64
import io
import math
from PIL import Image, ImageOps

MAX_IMAGE_BYTES = 12 * 1024 * 1024


def decode_image(value):
    if not isinstance(value, str) or len(value) > MAX_IMAGE_BYTES * 4 // 3 + 200:
        raise ValueError("Image absente ou trop volumineuse (12 Mo maximum).")
    if value.startswith("data:"):
        head, value = value.split(",", 1)
        if head not in ("data:image/png;base64", "data:image/jpeg;base64", "data:image/webp;base64"):
            raise ValueError("Format d’image non pris en charge.")
    try:
        raw = base64.b64decode(value, validate=True)
        if len(raw) > MAX_IMAGE_BYTES:
            raise ValueError("Image trop volumineuse.")
        with Image.open(io.BytesIO(raw)) as source:
            if source.width * source.height > 24_000_000:
                raise ValueError("Capture trop grande (24 mégapixels maximum).")
            image = ImageOps.exif_transpose(source).convert("RGB")
        return image
    except (OSError, base64.binascii.Error, Image.DecompressionBombError) as error:
        raise ValueError("Image illisible.") from error


def png(image):
    output = io.BytesIO()
    image.save(output, format="PNG")
    return output.getvalue()


def guide_images(source, supplied, size):
    import cv2
    import numpy as np
    result = {}
    for kind in ("edges", "depth", "normal", "segmentation"):
        if supplied.get(kind):
            guide = decode_image(supplied[kind])
            if guide.size != source.size:
                raise ValueError(f"Le guide {kind} ne correspond pas à la capture.")
            result[kind] = guide.resize(size, Image.Resampling.NEAREST if kind == "segmentation" else Image.Resampling.LANCZOS)
    if "edges" in result and result["edges"].convert("L").getextrema()[0] == result["edges"].convert("L").getextrema()[1]:
        # Terrain-only views have no vector overlay. A blank structural pass is not useful conditioning.
        del result["edges"]
    if "edges" not in result:
        # Fallback for third-party screenshots; native adapters supply clean structural guides.
        gray = cv2.cvtColor(np.array(source.resize(size, Image.Resampling.LANCZOS)), cv2.COLOR_RGB2GRAY)
        edges = cv2.Canny(gray, 80, 180)
        result["edges"] = Image.fromarray(edges).convert("RGB")
    return result


def simplify_guide(image, resolution, size, edges=False):
    """Keep coarse structure without forcing every small roof edge."""
    ratio = min(1., resolution / max(image.size))
    small = image.resize((max(1, round(image.width * ratio)), max(1, round(image.height * ratio))), Image.Resampling.LANCZOS)
    if edges:
        small = small.convert('L').point(lambda value: 255 if value >= 64 else 0).convert('RGB')
    return small.resize(size, Image.Resampling.NEAREST if edges else Image.Resampling.BILINEAR)


def reference_images(source, guides, size, settings):
    def reference_size(width, height, resolution):
        ratio = min(1., resolution / max(width, height), math.sqrt(1048576 / (width * height)))
        target = (max(16, round(width * ratio / 16) * 16), max(16, round(height * ratio / 16) * 16))
        if target[0] * target[1] > 1048576:
            target = (max(16, int(width * ratio / 16) * 16), max(16, int(height * ratio / 16) * 16))
        return target
    # Resize the entire aligned view to FLUX's token grid here. Otherwise the
    # pipeline center-crops each differently sized reference to multiples of 16.
    reference = source.resize(reference_size(*source.size, settings['referenceResolution']), Image.Resampling.LANCZOS)
    mode = settings['referenceMode']
    if mode == 'source':
        return [reference]
    kind = 'depth' if mode == 'source+depth' else 'edges'
    if kind not in guides:
        raise ValueError('Ce guide est absent de la capture.')
    # FLUX references may have different resolutions. Keep a coarse guide small
    # instead of spending a second full image's attention budget on upscaled lines.
    guide_size = reference_size(*source.size, settings['guideResolution'])
    guide = simplify_guide(guides[kind], settings['guideResolution'], guide_size, kind == 'edges')
    return [guide] if mode == 'edges' else [reference, guide]
