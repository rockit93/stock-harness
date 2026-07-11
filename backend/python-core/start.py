from __future__ import annotations

import argparse
import os
import subprocess
import sys
from pathlib import Path


SERVICE_DIR = Path(__file__).resolve().parent
ROOT_DIR = SERVICE_DIR.parents[1]
VENV_DIR = ROOT_DIR / ".venv"


def venv_python() -> Path:
    if os.name == "nt":
        return VENV_DIR / "Scripts" / "python.exe"
    return VENV_DIR / "bin" / "python"


def ensure_venv() -> Path:
    python = venv_python()
    if python.exists():
        return python

    subprocess.check_call([sys.executable, "-m", "venv", str(VENV_DIR)], cwd=ROOT_DIR)
    subprocess.check_call([str(python), "-m", "pip", "install", "--upgrade", "pip"], cwd=ROOT_DIR)
    subprocess.check_call(
        [str(python), "-m", "pip", "install", "-r", str(SERVICE_DIR / "requirements.txt")],
        cwd=ROOT_DIR,
    )
    return python


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Start Python Core.")
    parser.add_argument("--streamlit", action="store_true", help="Start the legacy Streamlit UI.")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    python = ensure_venv()

    if args.streamlit:
        command = [
            str(python),
            "-m",
            "streamlit",
            "run",
            "app.py",
            "--server.address",
            "127.0.0.1",
            "--server.port",
            os.environ.get("STREAMLIT_PORT", "8501"),
        ]
    else:
        command = [
            str(python),
            "-m",
            "uvicorn",
            "src.quant_lab.api:app",
            "--host",
            "127.0.0.1",
            "--port",
            os.environ.get("PYTHON_CORE_PORT", "8765"),
            "--reload",
        ]

    return subprocess.call(command, cwd=SERVICE_DIR)


if __name__ == "__main__":
    raise SystemExit(main())
