import contextlib
import io
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest
import zipfile
from unittest.mock import patch

import runtime_manager as manager


class RuntimeManagerTests(unittest.TestCase):
    def invoke(self, *args):
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            code = manager.main(list(args))
        return code, json.loads(out.getvalue())

    def test_status_missing_environments_is_offline_and_isolated(self):
        with tempfile.TemporaryDirectory() as temp, patch.object(manager.subprocess, "run") as run:
            code, result = self.invoke("--data-dir", temp, "status")
            self.assertEqual(code, 0)
            self.assertEqual([x["installed"] for x in result["components"]], [False, False])
            run.assert_not_called()

    def test_setup_uses_separate_venv_and_cuda_index_and_reports_failure(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            req = root / "requirements.txt"
            req.write_text("torch==2.11.0\n")
            calls = []
            def fake(command, env, **kwargs):
                calls.append((list(map(str, command)), env))
                return subprocess.CompletedProcess(command, 2 if len(calls) == 2 else 0)
            with patch.object(manager.subprocess, "run", side_effect=fake):
                code, result = self.invoke("--data-dir", str(root / "data"), "--cache-dir", str(root / "cache"),
                                           "--illustration-requirements", str(req), "setup", "illustration")
            self.assertEqual(code, 1)
            self.assertIn("Dependency installation failed", result["error"])
            self.assertIn("--managed-python", calls[0][0])
            self.assertIn("--allow-existing", calls[0][0])
            self.assertIn("--torch-backend", calls[1][0])
            self.assertIn("cu128", calls[1][0])
            self.assertIn("illustration", calls[1][0][calls[1][0].index("--python") + 1])
            self.assertEqual(calls[0][1]["UV_CACHE_DIR"], str((root / "cache" / "uv").resolve()))
            self.assertEqual(calls[0][1]["UV_PYTHON_INSTALL_DIR"], str((root / "data" / "python").resolve()))

    def test_cpu_probe_does_not_claim_cuda_readiness(self):
        with tempfile.TemporaryDirectory() as temp:
            args = manager.parser().parse_args(["--data-dir", temp, "probe", "terrain"])
            args.data_dir = Path(temp)
            args.cache_dir = Path(temp) / "cache"
            python = manager.interpreter(args, "terrain")
            python.parent.mkdir(parents=True)
            python.touch()
            response = subprocess.CompletedProcess([], 0, json.dumps({"cuda_available": False, "torch": "2.11.0+cpu"}), "")
            with patch.object(manager.subprocess, "run", return_value=response):
                result = manager.probe(args, "terrain")
            self.assertFalse(result["cuda_ready"])
            self.assertIn("CUDA", result["reason"])

    def test_acquire_source_is_pinned_and_filters_archive_contents(self):
        def archive(files):
            buf = io.BytesIO()
            with zipfile.ZipFile(buf, "w") as z:
                for name in files:
                    z.writestr("repo/" + name, "fixture")
            buf.seek(0)
            return buf
        archives = [archive(["backend/terrain_app.py", "distill/inference.py", "requirements-lock.txt",
                             "distill/weights/huge.pt", "../escape"]),
                    archive(["terrain_diffusion/inference/world_pipeline.py", "LICENSE"])]
        with tempfile.TemporaryDirectory() as temp:
            args = manager.parser().parse_args(["--data-dir", temp, "acquire-source"])
            args.data_dir = Path(temp)
            with patch.object(manager.urllib.request, "urlopen", side_effect=archives) as fetch:
                result = manager.acquire_source(args)
            self.assertIn(manager.EARTH_REVISION, fetch.call_args_list[0].args[0])
            self.assertIn(manager.DIFFUSION_REVISION, fetch.call_args_list[1].args[0])
            self.assertTrue((result / "backend/terrain_app.py").is_file())
            self.assertFalse((result / "distill/weights").exists())
            self.assertFalse((result.parent / "escape").exists())
            with patch.object(manager.urllib.request, "urlopen") as fetch:
                self.assertEqual(manager.acquire_source(args), result)
                fetch.assert_not_called()

    def test_explicit_interpreter_override_only_affects_probe_and_run(self):
        args = manager.parser().parse_args(["probe", "terrain"])
        with patch.dict(os.environ, {"MAGNA_NEURAL_PYTHON": "existing-python"}):
            self.assertEqual(manager.selected_interpreter(args, "terrain"), Path("existing-python"))
            self.assertNotEqual(manager.interpreter(args, "terrain"), Path("existing-python"))

    def test_existing_python_override_does_not_force_managed_python(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            req = root / "requirements.txt"
            req.touch()
            with patch.object(manager, "execute", return_value=0) as execute:
                code, _ = self.invoke("--data-dir", str(root / "data"), "--python", "custom-python",
                                      "--terrain-requirements", str(req), "setup", "terrain")
            self.assertEqual(code, 0)
            command = execute.call_args_list[0].args[0]
            self.assertIn("custom-python", command)
            self.assertNotIn("--managed-python", command)


if __name__ == "__main__":
    unittest.main()

