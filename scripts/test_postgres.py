"""Run pytest with a disposable, pinned, loopback-only PostgreSQL container.

Credentials are generated at runtime, never written to harness files or passed
in process arguments. Cleanup removes only this process's container.
"""

import hashlib
import os
import secrets
import shutil
import subprocess
import sys
import time
import uuid
from pathlib import Path


def main():
    runtime = shutil.which("docker") or shutil.which("podman")
    if not runtime:
        raise SystemExit("Docker or Podman required for PostgreSQL acceptance")
    recipe = Path(__file__).resolve().parent / "postgres"
    digest = hashlib.sha256((recipe / "Dockerfile").read_bytes()).hexdigest()[:16]
    image = "localhost/app-kit-test-postgres:" + digest
    build = [runtime, "build", "--tag", image]
    if Path(runtime).name == "podman":
        build.extend(["--http-proxy=false", "--cap-drop=ALL", "--security-opt=no-new-privileges"])
    result = subprocess.run([*build, str(recipe)], capture_output=True, timeout=180)
    if result.returncode:
        raise SystemExit("Hardened PostgreSQL recipe failed to build")
    name = "app-kit-test-" + uuid.uuid4().hex
    password = secrets.token_urlsafe(40)
    try:
        # AP-01: only the isolated test container needs this one-use credential.
        # Runtime operators can inspect the container environment until cleanup.
        result = subprocess.run(
            [
                runtime,
                "run",
                "--detach",
                "--name",
                name,
                "--label",
                "dhw.scope=isolated-app-test",
                "--cap-drop=ALL",
                "--security-opt=no-new-privileges",
                "--user",
                "70:70",
                "--tmpfs",
                "/var/lib/postgresql/data:rw,noexec,nosuid,nodev,mode=1777",
                "--tmpfs",
                "/run/postgresql:rw,noexec,nosuid,nodev,mode=1777",
                "--publish",
                "127.0.0.1::5432",
                "--env",
                "POSTGRES_PASSWORD",
                "-e",
                "PGDATA=/var/lib/postgresql/data/pgdata",
                "-e",
                "POSTGRES_USER=pilot",
                "-e",
                "POSTGRES_DB=pilot",
                image,
            ],
            env={**os.environ, "POSTGRES_PASSWORD": password},
            capture_output=True,
            timeout=150,
        )
        if result.returncode:
            raise SystemExit("Isolated PostgreSQL container failed to start")
        # Unlike inspect, port only returns network bindings, not the secret env.
        binding = subprocess.check_output(
            [runtime, "port", name, "5432/tcp"], text=True, timeout=15
        ).strip()
        host, _, port = binding.rpartition(":")
        if host != "127.0.0.1" or not port.isascii() or not port.isdecimal():
            raise SystemExit("Unexpected PostgreSQL test port binding")
        url = f"postgresql+psycopg://pilot:{password}@127.0.0.1:{port}/pilot"
        from sqlalchemy import create_engine, text

        engine = create_engine(url, hide_parameters=True)
        try:
            for _ in range(60):
                try:
                    with engine.connect() as db:
                        db.execute(text("SELECT 1"))
                    break
                except Exception:
                    time.sleep(0.5)
            else:
                raise SystemExit("Isolated PostgreSQL not ready")
        finally:
            engine.dispose()
        env = {**os.environ, "APP_KIT_TEST_DATABASE_URL": url}
        return subprocess.run([sys.executable, "-m", "pytest", *sys.argv[1:]], env=env).returncode
    finally:
        # Even a timed-out `run` may have created the randomly named container.
        subprocess.run(
            [runtime, "rm", "--force", name],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            timeout=30,
        )


if __name__ == "__main__":
    raise SystemExit(main())
