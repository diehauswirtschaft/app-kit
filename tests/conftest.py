"""Authentication integration tests use disposable PostgreSQL schemas only."""

import os
import uuid
from pathlib import Path

import pytest
from sqlalchemy import create_engine
from sqlalchemy.ext.asyncio import create_async_engine

from app_kit.auth import metadata


@pytest.fixture
async def async_db():
    source = os.environ.get("PILOT_DATABASE_URL_FILE")
    if not source:
        pytest.skip("PILOT_DATABASE_URL_FILE required for real PostgreSQL tests")
    url = Path(source).read_text().strip()
    schema = "kit_pilot_" + uuid.uuid4().hex
    admin = create_engine(url, hide_parameters=True)
    with admin.begin() as db:
        # Generated identifier only; never shared/prod schema deletion.
        db.exec_driver_sql(f'CREATE SCHEMA "{schema}"')
    args = {"options": f"-c search_path={schema} -c statement_timeout=5000 -c lock_timeout=3000"}
    engine = create_async_engine(url, hide_parameters=True, connect_args=args)
    async with engine.begin() as db:
        await db.run_sync(metadata.create_all)
    yield engine
    await engine.dispose()
    with admin.begin() as db:
        db.exec_driver_sql(f'DROP SCHEMA "{schema}" CASCADE')
    admin.dispose()
