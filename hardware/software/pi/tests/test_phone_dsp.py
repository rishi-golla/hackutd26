import shutil
import subprocess
from pathlib import Path

import pytest

SCRIPT = Path(__file__).resolve().parents[2] / "phone" / "dsp_selftest.js"


@pytest.mark.skipif(shutil.which("node") is None, reason="node not on PATH")
def test_phone_dsp_selftest():
    res = subprocess.run(["node", str(SCRIPT)], cwd=SCRIPT.parent,
                         capture_output=True, text=True, timeout=60)
    assert res.returncode == 0, res.stdout + res.stderr
