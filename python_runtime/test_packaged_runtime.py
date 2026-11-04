"""Smoke-test staged desktop resources without downloads or a CUDA device."""
import json
import os
from pathlib import Path
import subprocess
import sys
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parent.parent
RESOURCES = ROOT / "rust" / "desktop-v2" / "resources"
UV = RESOURCES / "bin" / ("uv.exe" if os.name == "nt" else "uv")
MANAGER = RESOURCES / "python_runtime" / "runtime_manager.py"
PYTHON = Path(sys.executable)


@unittest.skipUnless(UV.is_file() and MANAGER.is_file() and PYTHON.is_file(),
                     "staged desktop resources required")
class PackagedRuntimeTest(unittest.TestCase):
    def test_bundled_uv_and_offline_status_from_unrelated_directory(self):
        with tempfile.TemporaryDirectory() as tmp:
            env = os.environ.copy()
            env.update({"MAGNA_RUNTIME_DATA": str(Path(tmp) / "data"),
                        "MAGNA_RUNTIME_CACHE": str(Path(tmp) / "cache"), "UV_OFFLINE": "1"})
            env.pop("MAGNA_NEURAL_PYTHON", None)
            env.pop("MAGNA_ILLUSTRATION_PYTHON", None)
            version = subprocess.run([str(UV), "--version"], cwd=tmp, env=env,
                                     capture_output=True, text=True, timeout=15, check=True)
            self.assertTrue(version.stdout.startswith("uv "))
            status = subprocess.run([str(PYTHON), str(MANAGER), "status"], cwd=tmp, env=env,
                                    capture_output=True, text=True, timeout=30, check=True)
            data = json.loads(status.stdout)
            self.assertEqual(Path(data["data_dir"]), (Path(tmp) / "data").resolve())
            self.assertEqual(Path(data["cache_dir"]), (Path(tmp) / "cache").resolve())
            self.assertEqual([item["component"] for item in data["components"]], ["illustration", "terrain"])
            self.assertTrue(all(not item["installed"] for item in data["components"]))
            self.assertFalse((Path(tmp) / "data").exists())
            self.assertFalse((Path(tmp) / "cache").exists())

    def test_repeated_venv_creation_preserves_existing_files(self):
        with tempfile.TemporaryDirectory() as tmp:
            venv = Path(tmp) / "venv"
            command = [str(UV), "venv", "--allow-existing", "--python", sys.executable, str(venv)]
            for run in range(2):
                result = subprocess.run(command, cwd=tmp, stdin=subprocess.DEVNULL,
                                        capture_output=True, text=True, timeout=30)
                self.assertEqual(result.returncode, 0, result.stderr)
                if run == 0:
                    (venv / "keep-marker").write_text("preserved", encoding="utf-8")
            self.assertEqual((venv / "keep-marker").read_text(encoding="utf-8"), "preserved")


if __name__ == "__main__":
    unittest.main()
