"""Run pytest with a disposable, pinned, loopback-only PostgreSQL container.

All credentials are generated at runtime outside Git. No named data volumes or
existing database are used. Cleanup removes only this process's container.
"""

import json
import os
import secrets
import shutil
import subprocess
import sys
import tempfile
import time
import uuid
from pathlib import Path

IMAGE = "docker.io/library/postgres:17-alpine@sha256:3540c0362c809df084ffac0ae69fe794515f9de92692f02178bcdce0ef0302ac"


def main():
    runtime = shutil.which("docker") or shutil.which("podman")
    if not runtime:
        raise SystemExit("Docker or Podman required for PostgreSQL acceptance")
    name = "app-kit-test-" + uuid.uuid4().hex
    created = False
    with tempfile.TemporaryDirectory(prefix="app-kit-db-") as directory:
        root = Path(directory)
        root.chmod(0o700)
        password = secrets.token_urlsafe(40)
        env_file = root / "postgres.env"
        env_file.write_text("POSTGRES_PASSWORD=" + password + "\n")
        env_file.chmod(0o600)
        try:
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
                    "--env-file",
                    str(env_file),
                    "-e",
                    "PGDATA=/var/lib/postgresql/data/pgdata",
                    "-e",
                    "POSTGRES_USER=pilot",
                    "-e",
                    "POSTGRES_DB=pilot",
                    IMAGE,
                ],
                capture_output=True,
                timeout=150,
            )
            if result.returncode:
                raise SystemExit("Isolated PostgreSQL container failed to start")
            created = True
            info = json.loads(subprocess.check_output([runtime, "inspect", name]))
            port = info[0]["NetworkSettings"]["Ports"]["5432/tcp"][0]["HostPort"]
            url = "postgresql+psycopg://pilot:" + password + "@127.0.0.1:" + port + "/pilot"
            db_file = root / "database-url"
            db_file.write_text(url)
            db_file.chmod(0o600)
            from sqlalchemy import create_engine, text

            engine = create_engine(url, hide_parameters=True)
            ready = False
            for _ in range(60):
                try:
                    with engine.connect() as db:
                        db.execute(text("SELECT 1"))
                    ready = True
                    break
                except Exception:
                    time.sleep(0.5)
            engine.dispose()
            if not ready:
                raise SystemExit("Isolated PostgreSQL not ready")
            env = {**os.environ, "PILOT_DATABASE_URL_FILE": str(db_file)}
            result = subprocess.run([sys.executable, "-m", "pytest", *sys.argv[1:]], env=env)
            return result.returncode
        finally:
            if created:
                subprocess.run(
                    [runtime, "rm", "--force", name],
                    stdout=subprocess.DEVNULL,
                    stderr=subprocess.DEVNULL,
                    timeout=30,
                )


if __name__ == "__main__":
    raise SystemExit(main())
