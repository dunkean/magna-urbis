"""Cloud adapters. Keys stay in process memory and never enter job metadata."""
import base64
import json
import os
import re
import urllib.error
import urllib.request
import uuid
from .images import png
from .context import dimensions

DEFAULT_MODELS = {"openai": "gpt-image-2.5-sunburst", "gemini": "gemini-3.1-flash-image"}


def request_json(url, body, headers, *, transport=urllib.request.urlopen):
    data = json.dumps(body).encode() if isinstance(body, dict) else body
    req = urllib.request.Request(url, data=data, headers=headers, method="POST")
    try:
        with transport(req, timeout=240) as response:
            return json.load(response)
    except urllib.error.HTTPError as error:
        # Provider error bodies may echo user input. Do not persist them.
        reasons = {401: "Clé API refusée", 403: "Accès au modèle refusé", 429: "Quota ou limite de débit atteint", 400: "Requête refusée par le fournisseur"}
        raise RuntimeError(f"{reasons.get(error.code, 'Erreur du fournisseur')} (HTTP {error.code}).") from None


def generate(provider, key, model, prompt, source, guides, settings, *, transport=urllib.request.urlopen):
    if provider not in DEFAULT_MODELS:
        raise ValueError("Fournisseur inconnu.")
    key = key or os.environ.get("OPENAI_API_KEY" if provider == "openai" else "GEMINI_API_KEY", "")
    if not key:
        raise ValueError("Renseignez votre clé API personnelle ou configurez-la dans l’environnement du service.")
    model = model or DEFAULT_MODELS[provider]
    if not re.fullmatch(r"[A-Za-z0-9_.-]{1,100}", model):
        raise ValueError("Identifiant de modèle invalide.")
    references = [("source", source)] + [(name, image) for name, image in guides.items() if name in ("edges", "depth")]
    prompt += (" Reference image 1 is the source image to reproduce in the requested new style. "
               "Use its visible details, composition and layout as the primary reference, respecting the fidelity instructions above. "
               "Additional images are structural guides, not output styles.")
    if provider == "openai":
        boundary = "magna" + uuid.uuid4().hex
        chunks = []
        width, height = dimensions(*source.size, max(786432, int(settings.get("pixels", 1048576))))
        if model.startswith("gpt-image-1"):
            width, height = (1536, 1024) if source.width / source.height > 1.2 else (1024, 1536) if source.height / source.width > 1.2 else (1024, 1024)
        for name, value in {"model": model, "prompt": prompt, "size": f"{width}x{height}", "quality": settings.get("cloudQuality", "high"), "n": "1"}.items():
            chunks.append(f'--{boundary}\r\nContent-Disposition: form-data; name="{name}"\r\n\r\n{value}\r\n'.encode())
        for name, image in references:
            chunks += [f'--{boundary}\r\nContent-Disposition: form-data; name="image[]"; filename="{name}.png"\r\nContent-Type: image/png\r\n\r\n'.encode(), png(image), b"\r\n"]
        chunks.append(f"--{boundary}--\r\n".encode())
        result = request_json("https://api.openai.com/v1/images/edits", b"".join(chunks),
                              {"Authorization": f"Bearer {key}", "Content-Type": f"multipart/form-data; boundary={boundary}"}, transport=transport)
        image = next((entry.get("b64_json") for entry in result.get("data", []) if entry.get("b64_json")), None)
        if not image:
            raise RuntimeError("Le fournisseur n’a renvoyé aucune image.")
        return base64.b64decode(image, validate=True), {"provider": provider, "model": model, "usage": result.get("usage"), "seed": None}
    parts = [{"text": prompt}] + [{"inlineData": {"mimeType": "image/png", "data": base64.b64encode(png(image)).decode()}} for _, image in references]
    ratios = {"1:1": 1, "2:3": 2/3, "3:2": 1.5, "3:4": .75, "4:3": 4/3, "9:16": 9/16, "16:9": 16/9, "21:9": 21/9}
    ratio = min(ratios, key=lambda name: abs(ratios[name] - source.width / source.height))
    result = request_json(f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent",
                          {"contents": [{"parts": parts}], "generationConfig": {"responseModalities": ["TEXT", "IMAGE"],
                           "imageConfig": {"aspectRatio": ratio, "imageSize": "2K" if int(settings.get("pixels", 1048576)) > 1048576 else "1K"}}},
                          {"x-goog-api-key": key, "Content-Type": "application/json"}, transport=transport)
    for candidate in result.get("candidates", []):
        for part in candidate.get("content", {}).get("parts", []):
            inline = part.get("inlineData", part.get("inline_data", {}))
            if inline.get("data") and inline.get("mimeType", inline.get("mime_type", "")).startswith("image/"):
                return base64.b64decode(inline["data"], validate=True), {"provider": provider, "model": model, "usage": result.get("usageMetadata"), "seed": None}
    raise RuntimeError("Gemini n’a renvoyé aucune image (requête filtrée ou réponse sans image).")
