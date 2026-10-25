"""Image decoding and guide generation, isolated from model dependencies."""
import base64
import io
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
