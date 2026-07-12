from __future__ import annotations

import argparse
import os
import signal
import shutil
import socket
import subprocess
import sys
import time
import uuid
from pathlib import Path


ROOT_DIR = Path(__file__).resolve().parent
LOG_DIR = ROOT_DIR / "logs"
NPM_CACHE_DIR = ROOT_DIR / ".npm-cache"
RUNTIME_DIR = ROOT_DIR / ".runtime"

# Keep npm's runtime cache off the system drive. This is especially important on
# Windows, where npm otherwise writes logs and cache data below LocalAppData.
os.environ["NPM_CONFIG_CACHE"] = str(NPM_CACHE_DIR)

SERVICES = {
    "ollama": {
        "name": "Ollama",
        "command": ["ollama", "serve"],
        "cwd": ROOT_DIR,
        "port": 11434,
        "url": "http://127.0.0.1:11434",
    },
    "python-core": {
        "name": "Python Core",
        "command": [sys.executable, str(ROOT_DIR / "backend" / "python-core" / "start.py")],
        "cwd": ROOT_DIR,
        "port": 8765,
        "url": "http://127.0.0.1:8765",
    },
    "node-api": {
        "name": "Node API",
        "command": ["npm", "run", "dev"],
        "cwd": ROOT_DIR / "backend" / "node-api",
        "port": 8787,
        "url": "http://127.0.0.1:8787",
    },
    "web": {
        "name": "Vue Web",
        "command": ["npm", "run", "dev"],
        "cwd": ROOT_DIR / "frontend" / "web",
        "port": 5173,
        "url": "http://127.0.0.1:5173",
    },
}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Start stock-harness services.")
    parser.add_argument(
        "service",
        nargs="?",
        default="all",
        choices=["all", *SERVICES.keys()],
        help="Service to start. Defaults to all.",
    )
    return parser.parse_args()


def selected_services(service: str) -> list[tuple[str, dict[str, Path | str]]]:
    if service == "all":
        services = [(key, config) for key, config in SERVICES.items() if key != "ollama"]
        if ollama_command() is not None:
            services.insert(0, ("ollama", SERVICES["ollama"]))
        return services
    if service == "ollama" and ollama_command() is None:
        raise RuntimeError("Ollama was not found. Install Ollama first.")
    return [(service, SERVICES[service])]


def popen_kwargs() -> dict[str, object]:
    if os.name == "nt":
        return {"creationflags": subprocess.CREATE_NEW_PROCESS_GROUP}
    return {"start_new_session": True}


def npm_command() -> str:
    command = shutil.which("npm.cmd" if os.name == "nt" else "npm") or shutil.which("npm")
    if command is None:
        raise RuntimeError("npm was not found. Install Node.js first.")
    return command


def ollama_command() -> str | None:
    command = shutil.which("ollama.exe" if os.name == "nt" else "ollama") or shutil.which("ollama")
    if command is not None or os.name != "nt":
        return command
    local_app_data = os.environ.get("LOCALAPPDATA")
    if not local_app_data:
        return None
    candidate = Path(local_app_data) / "Programs" / "Ollama" / "ollama.exe"
    return str(candidate) if candidate.is_file() else None


def ensure_node_modules(cwd: Path) -> None:
    if (cwd / "node_modules").exists():
        return
    subprocess.check_call([npm_command(), "install"], cwd=cwd)


def service_command(config: dict[str, object]) -> list[str]:
    command = list(config["command"])  # type: ignore[arg-type]
    if command[0] == "npm":
        command[0] = npm_command()
    elif command[0] == "ollama":
        command[0] = ollama_command() or command[0]
    return command


def port_is_busy(port: int) -> bool:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.settimeout(0.2)
        return sock.connect_ex(("127.0.0.1", port)) == 0


def owner_path(key: str) -> Path:
    return RUNTIME_DIR / f"{key}.owner"


def claim_services(services: list[tuple[str, dict[str, object]]]) -> dict[str, str]:
    RUNTIME_DIR.mkdir(parents=True, exist_ok=True)
    owners: dict[str, str] = {}
    for key, _ in services:
        token = uuid.uuid4().hex
        path = owner_path(key)
        temporary = path.with_suffix(".owner.tmp")
        temporary.write_text(token, encoding="utf-8")
        temporary.replace(path)
        owners[key] = token
    return owners


def owns_service(key: str, owners: dict[str, str]) -> bool:
    try:
        return owner_path(key).read_text(encoding="utf-8").strip() == owners[key]
    except (KeyError, OSError):
        return False


def release_service(key: str, owners: dict[str, str]) -> None:
    if owns_service(key, owners):
        owner_path(key).unlink(missing_ok=True)


def stop_existing_service(key: str, config: dict[str, object]) -> None:
    port = int(config["port"])
    if not port_is_busy(port):
        return
    print(f"Restarting existing {config['name']} on port {port}...")
    if os.name == "nt":
        command = [
            "powershell.exe",
            "-NoProfile",
            "-ExecutionPolicy",
            "Bypass",
            "-File",
            str(ROOT_DIR / "stop.ps1"),
            key,
        ]
    else:
        command = [str(ROOT_DIR / "stop.sh"), key]
    subprocess.run(command, cwd=ROOT_DIR, check=True)

    deadline = time.time() + 10
    while port_is_busy(port) and time.time() < deadline:
        time.sleep(0.2)
    if port_is_busy(port):
        raise RuntimeError(f"Port {port} is still occupied after stopping {config['name']}.")


def stop_process(process: subprocess.Popen[bytes]) -> None:
    if process.poll() is not None:
        return

    try:
        if os.name == "nt":
            try:
                process.send_signal(signal.CTRL_BREAK_EVENT)
            except (AttributeError, OSError):
                process.terminate()
        else:
            os.killpg(process.pid, signal.SIGTERM)
    except ProcessLookupError:
        return


def main() -> int:
    args = parse_args()
    services = selected_services(args.service)
    if any(key == "ollama" for key, _ in services) and port_is_busy(11434):
        print("Ollama is already running on http://127.0.0.1:11434; using the existing service.")
        services = [(key, config) for key, config in services if key != "ollama"]
    if not services:
        return 0
    service_map = dict(services)
    owners = claim_services(services)
    processes: dict[str, subprocess.Popen[bytes]] = {}
    started_at: dict[str, float] = {}
    failure_counts: dict[str, int] = {key: 0 for key, _ in services}
    next_restart: dict[str, float] = {key: 0 for key, _ in services}
    port_missing_since: dict[str, float | None] = {key: None for key, _ in services}
    log_files: dict[str, object] = {}

    def start_service(key: str) -> None:
        config = service_map[key]
        cwd = config["cwd"]
        if key in {"node-api", "web"}:
            ensure_node_modules(cwd)  # type: ignore[arg-type]
        log_file = log_files[key]
        log_file.write(  # type: ignore[attr-defined]
            f"\n\n===== {time.strftime('%Y-%m-%d %H:%M:%S')} starting {config['name']} =====\n".encode("utf-8")
        )
        process = subprocess.Popen(
            service_command(config),
            cwd=cwd,
            stdout=log_file,
            stderr=subprocess.STDOUT,
            **popen_kwargs(),
        )
        processes[key] = process
        started_at[key] = time.monotonic()
        port_missing_since[key] = None
        print(f"Started {config['name']} (PID {process.pid}).")

    try:
        LOG_DIR.mkdir(parents=True, exist_ok=True)
        for key, config in services:
            log_path = LOG_DIR / f"{key}.log"
            log_file = log_path.open("ab", buffering=0)
            log_files[key] = log_file
            print(f"  log: {log_path}")

        for key, config in services:
            stop_existing_service(key, config)
            try:
                start_service(key)
            except Exception as error:
                failure_counts[key] += 1
                next_restart[key] = time.monotonic() + 1
                print(f"Failed to start '{key}': {error}; supervisor will retry.")

        print()
        print("Services:")
        for _, config in services:
            print(f"  {config['name']}  {config['url']}")
        print()
        print("Press Ctrl+C to stop.")

        while any(owns_service(key, owners) for key in service_map):
            for key in service_map:
                if key in processes or not owns_service(key, owners):
                    continue
                if time.monotonic() < next_restart[key]:
                    continue
                try:
                    stop_existing_service(key, service_map[key])
                    start_service(key)
                except Exception as error:
                    failure_counts[key] += 1
                    delay = min(2 ** min(failure_counts[key] - 1, 5), 30)
                    next_restart[key] = time.monotonic() + delay
                    print(f"Failed to start '{key}': {error}; retrying in {delay}s.")

            for key, process in list(processes.items()):
                return_code = process.poll()
                if return_code is None:
                    port = int(service_map[key]["port"])
                    if port_is_busy(port):
                        port_missing_since[key] = None
                    elif time.monotonic() - started_at[key] >= 10:
                        missing_since = port_missing_since[key]
                        if missing_since is None:
                            port_missing_since[key] = time.monotonic()
                        elif time.monotonic() - missing_since >= 3:
                            print(
                                f"Service '{key}' is running but port {port} is not listening; "
                                "stopping it so the supervisor can restart it."
                            )
                            stop_process(process)
                            time.sleep(0.2)
                            if process.poll() is None:
                                process.kill()
                            port_missing_since[key] = None
                    continue

                del processes[key]
                port_missing_since[key] = None
                if not owns_service(key, owners):
                    print(f"Service '{key}' was handed off to another bootstrap instance.")
                    continue

                uptime = time.monotonic() - started_at[key]
                failure_counts[key] = 0 if uptime >= 60 else failure_counts[key] + 1
                delay = min(2 ** min(failure_counts[key] - 1, 5), 30)
                print(f"Service '{key}' exited with code {return_code}; restarting in {delay}s.")
                next_restart[key] = time.monotonic() + delay
            time.sleep(1)
        return 0
    except KeyboardInterrupt:
        print()
        print("Stopping services...")
        return 130
    finally:
        for process in processes.values():
            stop_process(process)

        deadline = time.time() + 5
        for process in processes.values():
            while process.poll() is None and time.time() < deadline:
                time.sleep(0.1)
            if process.poll() is None:
                process.kill()
        for key in owners:
            release_service(key, owners)
        for log_file in log_files.values():
            log_file.close()


if __name__ == "__main__":
    raise SystemExit(main())
