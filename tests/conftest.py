"""Run the store contract against a test double and optionally real PostgreSQL."""

import os
import uuid
from urllib.parse import urlsplit

import pytest

from app_kit.session_store import LoginState, Session


class TestMemoryStore:
    """Test-only; no suspension within operations on a single event loop."""

    def __init__(self):
        self.logins: dict[tuple[str, str], LoginState] = {}
        self.sessions: dict[tuple[str, str], Session] = {}

    @staticmethod
    def _put(rows, scope, key, value, now, limit):
        for k, row in list(rows.items()):
            if min(row.expires, getattr(row, "absolute", row.expires)) <= now:
                del rows[k]
        if sum(k[0] == scope for k in rows) >= limit:
            return False
        if (scope, key) in rows:
            raise RuntimeError("Duplicate key")
        rows[scope, key] = value
        return True

    async def put_login(self, scope, key, state, *, now, limit):
        return self._put(self.logins, scope, key, state, now, limit)

    async def consume_login(self, scope, key):
        return self.logins.pop((scope, key), None)

    async def put_session(self, scope, key, session, *, now, limit):
        return self._put(self.sessions, scope, key, session, now, limit)

    async def get_session(self, scope, key):
        return self.sessions.get((scope, key))

    async def replace_session(self, scope, key, expected_revision, session):
        row = self.sessions.get((scope, key))
        if row is None or row.revision != expected_revision:
            return False
        self.sessions[scope, key] = session
        return True

    async def delete_session(self, scope, key, *, expected_revision=None):
        row = self.sessions.get((scope, key))
        if row is not None and (expected_revision is None or row.revision == expected_revision):
            del self.sessions[scope, key]


# Read only in this test process; do not propagate to its subprocesses.
DATABASE_URL = os.environ.pop("APP_KIT_TEST_DATABASE_URL", None)


@pytest.fixture(params=["memory", "postgres"] if DATABASE_URL else ["memory"])
async def store_args(request):
    if request.param == "memory":
        yield {"store": TestMemoryStore()}
        return

    from sqlalchemy import create_engine
    from sqlalchemy.ext.asyncio import create_async_engine

    from app_kit.auth import metadata

    target = urlsplit(DATABASE_URL)
    # AP-01: schema setup/cleanup must never target a remote service.
    if (
        target.scheme != "postgresql+psycopg"
        or target.hostname != "127.0.0.1"
        or target.username != "pilot"
        or target.path != "/pilot"
        or target.query
        or target.fragment
    ):
        pytest.fail("Expected an isolated loopback PostgreSQL test database")
    schema = "kit_pilot_" + uuid.uuid4().hex
    admin = create_engine(DATABASE_URL, hide_parameters=True)
    try:
        with admin.begin() as db:
            # Generated identifier only; never shared/prod schema deletion.
            db.exec_driver_sql(f'CREATE SCHEMA "{schema}"')
        try:
            args = {
                "options": f"-c search_path={schema} -c statement_timeout=5000 -c lock_timeout=3000"
            }
            engine = create_async_engine(DATABASE_URL, hide_parameters=True, connect_args=args)
            try:
                async with engine.begin() as db:
                    await db.run_sync(metadata.create_all)
                yield {"engine": engine}
            finally:
                await engine.dispose()
        finally:
            with admin.begin() as db:
                db.exec_driver_sql(f'DROP SCHEMA "{schema}" CASCADE')
    finally:
        admin.dispose()


@pytest.fixture
def session_store(store_args):
    if "store" in store_args:
        return store_args["store"]
    from app_kit.postgres import PostgresSessionStore

    return PostgresSessionStore(store_args["engine"])
