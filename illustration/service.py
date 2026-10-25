"""Bounded, persistent illustration jobs. No model imports on ordinary app startup."""
import base64
import hashlib
import importlib.util
import io
import json
import os
from pathlib import Path
import queue
import secrets
import threading
import time
from PIL import Image
from . import PROTOCOL
from .context import clean, compile_prompt, dimensions
from .images import decode_image, guide_images, png
from .providers import DEFAULT_MODELS

TERMINAL = {"succeeded", "failed", "cancelled"}


class Cancelled(Exception):
    pass


def prompt_settings(body):
    raw = body.get("settings", {})
    if not isinstance(raw, dict):
        raise ValueError("Réglages invalides.")
    settings = clean(raw)
    # The full editor has a larger, explicit bound than ordinary context strings.
    # compile_prompt validates it; do not silently truncate a user's edited text.
    if "promptOverride" in raw:
        settings["promptOverride"] = raw["promptOverride"]
    return settings


def default_output():
    base = Path(os.environ.get("LOCALAPPDATA", Path.home() / ".local" / "share"))
    return Path(os.environ.get("MAGNA_ILLUSTRATION_OUTPUT", base / "MagnaUrbis" / "illustrations"))


class IllustrationService:
    def __init__(self, output=None, local_runtime=None, cloud_generate=None):
        self.output = Path(output) if output else default_output()
        self.output.mkdir(parents=True, exist_ok=True)
        self.jobs = {}
        self.lock = threading.RLock()
        self.queue = queue.Queue(maxsize=6)
        self.local_runtime = local_runtime
        self.cloud_generate = cloud_generate
        self.closed = False
        self.worker = threading.Thread(target=self._work, daemon=True, name="illustration-worker")
        self.worker.start()

    def capabilities(self):
        dependencies = all(importlib.util.find_spec(name) is not None for name in ("torch", "diffusers", "transformers", "cv2", "accelerate"))
        return {"service": "magna-illustration", "protocol": PROTOCOL, "localDependencies": dependencies,
                "models": DEFAULT_MODELS, "modes": ["cloud", "fast", "quality"],
                "controls": {"fast": ["auto", "edges", "depth", "both"], "quality": ["auto", "edges", "depth"], "cloud": ["auto"]},
                "configuredKeys": {"openai": bool(os.environ.get("OPENAI_API_KEY")), "gemini": bool(os.environ.get("GEMINI_API_KEY"))},
                "steps": {"fast": [4, 8], "quality": [8]}, "queueLimit": 6}

    def preview_prompt(self, body):
        if not isinstance(body, dict) or body.get("version") != PROTOCOL:
            raise ValueError("Version de contexte incompatible.")
        context, settings = clean(body.get("context", {})), prompt_settings(body)
        if not isinstance(context, dict) or not isinstance(settings, dict):
            raise ValueError("Contexte et réglages invalides.")
        mode = settings.get("mode", "fast")
        if mode not in ("fast", "quality", "cloud"):
            raise ValueError("Moteur inconnu.")
        compiled = compile_prompt(context, settings)
        return {"description": compiled["description"], "style": compiled["style"], "customized": compiled["customized"],
                "prompt": compiled["prompt"] if mode == "cloud" else compiled["fastPrompt"] if mode == "fast" else compiled["localPrompt"]}

    def submit(self, body):
        if not isinstance(body, dict) or body.get("version") != PROTOCOL:
            raise ValueError("Version de capture incompatible.")
        settings = prompt_settings(body)
        context = clean(body.get("context", {}))
        if not isinstance(context, dict) or not isinstance(settings, dict):
            raise ValueError("Contexte et réglages invalides.")
        mode = settings.get("mode", "fast")
        if mode not in ("fast", "quality", "cloud"):
            raise ValueError("Moteur inconnu.")
        if mode != "cloud" and not self.capabilities()["localDependencies"] and self.local_runtime is None:
            raise ValueError("Dépendances locales absentes. Installez illustration/requirements.txt dans l’environnement du service.")
        source = decode_image(body.get("image"))
        supplied = body.get("guides", {})
        if not isinstance(supplied, dict):
            raise ValueError("Guides invalides.")
        # Validate alignment before accepting a job, including guides not used by the selected engine.
        for value in supplied.values():
            if decode_image(value).size != source.size:
                raise ValueError("Les guides et la capture doivent avoir les mêmes dimensions.")
        if settings.get("control") in ("depth", "both") and "depth" not in supplied:
            raise ValueError("La capture ne contient pas de profondeur.")
        if mode == "quality" and settings.get("control") == "both":
            raise ValueError("Z-Image accepte un guide à la fois ; choisissez SDXL pour profondeur + contours.")
        steps = int(settings.get("steps", 4 if mode == "fast" else 8))
        if mode != "cloud" and steps not in ([4, 8] if mode == "fast" else [8]):
            raise ValueError("Nombre d’étapes incompatible avec ce moteur.")
        pixels = int(settings.get("pixels", 786432 if mode == "fast" else 1048576))
        if pixels not in (393216, 786432, 1048576, 2097152):
            raise ValueError("Résolution non prise en charge.")
        if mode == "fast" and pixels > 1048576:
            raise ValueError("Le mode rapide est limité à un mégapixel.")
        if max(source.size) / min(source.size) > 4:
            raise ValueError("Recadrez la capture à un ratio inférieur ou égal à 4:1.")
        if mode == "cloud" and settings.get("provider", "openai") == "openai" and max(source.size) / min(source.size) > 3:
            raise ValueError("OpenAI accepte au maximum un ratio 3:1. Réduisez la largeur de la vue avant de la capturer.")
        settings["seed"] = int(settings.get("seed", secrets.randbelow(2**31)))
        if not 0 <= settings["seed"] < 2**32:
            raise ValueError("La seed doit être comprise entre 0 et 4294967295.")
        settings["steps"] = steps
        settings["projection"] = context.get("projection", "orthographic")
        settings["pixels"] = pixels
        compiled = compile_prompt(context, settings)
        job_id = secrets.token_hex(12)
        job = {"id": job_id, "version": PROTOCOL, "status": "queued", "progress": 0, "message": "En attente…",
               "createdAt": time.time(), "context": context, "settings": settings,
               "prompt": compiled["prompt"], "description": compiled["description"], "resolvedStyle": compiled["style"], "promptCustomized": compiled["customized"],
               "localPrompt": compiled["fastPrompt"] if mode == "fast" else compiled["localPrompt"],
               "sourceSize": list(source.size), "size": list(dimensions(*source.size, pixels)),
               "sourceHash": hashlib.sha256(png(source)).hexdigest()}
        credential = str(body.get("apiKey", ""))
        with self.lock:
            active = sum(j["status"] not in TERMINAL for j in self.jobs.values())
            if active >= 7 or self.queue.full():
                raise ValueError("La file est pleine. Attendez ou annulez un travail.")
            self.jobs[job_id] = job
            self._save(job)
            self.queue.put_nowait((job_id, source, supplied, credential))
        return self.get(job_id)

    def _save(self, job):
        directory = self.output / job["id"]
        directory.mkdir(exist_ok=True)
        temporary = directory / "metadata.tmp"
        temporary.write_text(json.dumps(job, ensure_ascii=False, indent=2), encoding="utf-8")
        temporary.replace(directory / "metadata.json")

    def get(self, job_id):
        if not isinstance(job_id, str) or len(job_id) != 24 or any(c not in "0123456789abcdef" for c in job_id):
            raise KeyError("Travail inconnu.")
        with self.lock:
            if job_id in self.jobs:
                return json.loads(json.dumps(self.jobs[job_id]))
            path = self.output / job_id / "metadata.json"
            if not path.is_file():
                raise KeyError("Travail inconnu.")
            job = json.loads(path.read_text(encoding="utf-8"))
            if job["status"] not in TERMINAL:
                job.update(status="failed", message="Le service a été arrêté pendant ce travail.")
            return job

    def history(self):
        paths = sorted(self.output.glob("*/metadata.json"), key=lambda p: p.stat().st_mtime, reverse=True)[:60]
        result = []
        for path in paths:
            try:
                result.append(self.get(path.parent.name))
            except (KeyError, ValueError, OSError):
                continue
        return result

    def cancel(self, job_id):
        with self.lock:
            job = self.jobs.get(job_id)
            if job is None:
                return self.get(job_id)
            if job["status"] not in TERMINAL:
                job.update(status="cancelled", message="Annulé. Une requête API déjà transmise peut rester facturée.", finishedAt=time.time())
                self._save(job)
        return self.get(job_id)

    def delete(self, job_id):
        job = self.get(job_id)
        if job["status"] not in TERMINAL:
            raise ValueError("Annulez ce travail avant de le supprimer.")
        with self.lock:
            # A cancelled worker may still be returning from its provider. It checks before writing.
            self.jobs.pop(job_id, None)
            directory = self.output / job_id
            for path in directory.iterdir():
                if path.is_file():
                    path.unlink()
            directory.rmdir()

    def asset(self, job_id, name):
        self.get(job_id)
        if name not in ("result.png", "source.png", "edges.png", "depth.png", "normal.png", "segmentation.png", "metadata.json"):
            raise KeyError("Fichier inconnu.")
        path = self.output / job_id / name
        if not path.is_file():
            raise KeyError("Fichier indisponible.")
        return path

    def _work(self):
        while True:
            try:
                item = self.queue.get(timeout=120)
            except queue.Empty:
                if self.local_runtime is not None and hasattr(self.local_runtime, "release"):
                    self.local_runtime.release()
                if self.closed:
                    return
                continue
            if item is None:
                self.queue.task_done()
                return
            job_id, source, supplied, key = item
            try:
                def check():
                    with self.lock:
                        if self.closed or job_id not in self.jobs or self.jobs[job_id]["status"] == "cancelled":
                            raise Cancelled()
                def progress(status, fraction, message):
                    check()
                    with self.lock:
                        self.jobs[job_id].update(status=status, progress=fraction, message=message)
                check()
                job = self.get(job_id)
                begin = time.monotonic()
                directory = self.output / job_id
                (directory / "source.png").write_bytes(png(source))
                progress("preparing", 0, "Préparation des guides…")
                guides = guide_images(source, supplied, tuple(job["size"]))
                for kind, image in guides.items():
                    # Stored guides stay aligned to the original, so history can reproduce a job.
                    retained = decode_image(supplied[kind]) if kind in supplied else image.resize(source.size, Image.Resampling.NEAREST)
                    (directory / f"{kind}.png").write_bytes(png(retained))
                mode, settings = job["settings"]["mode"], job["settings"]
                if mode == "cloud":
                    from .providers import generate
                    progress("generating", 0, "Génération chez le fournisseur…")
                    data, provenance = (self.cloud_generate or generate)(settings.get("provider", "openai"), key,
                        settings.get("model", ""), job["prompt"], source, {}, settings)
                else:
                    from .local import LocalRuntime
                    if self.local_runtime is None:
                        self.local_runtime = LocalRuntime()
                    data, provenance = self.local_runtime.generate(mode, job["localPrompt"], guides, tuple(job["size"]), settings, progress, check)
                check()
                with Image.open(io.BytesIO(data)) as image:
                    result = png(image.convert("RGB"))
                    output_size = list(image.size)
                with self.lock:
                    check()
                    (directory / "result.png").write_bytes(result)
                    self.jobs[job_id].update(status="succeeded", progress=1, message="Illustration terminée.",
                        finishedAt=time.time(), totalSeconds=round(time.monotonic() - begin, 3), outputSize=output_size,
                        provenance=clean(provenance))
                    self._save(self.jobs[job_id])
            except Cancelled:
                pass
            except Exception as error:
                with self.lock:
                    if job_id in self.jobs and self.jobs[job_id]["status"] != "cancelled":
                        message = str(error).replace(key, "[clé masquée]") if key else str(error)
                        if "out of memory" in message.lower():
                            message = "Mémoire GPU insuffisante. Réduisez la résolution ou libérez les modèles de terrain."
                            if self.local_runtime is not None and hasattr(self.local_runtime, "release"):
                                self.local_runtime.release()
                        self.jobs[job_id].update(status="failed", message=message[:1200], finishedAt=time.time())
                        self._save(self.jobs[job_id])
            finally:
                key = ""
                self.queue.task_done()

    def close(self):
        self.closed = True
        try:
            self.queue.put_nowait(None)
        except queue.Full:
            pass
