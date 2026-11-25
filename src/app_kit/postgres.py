"""Optional AP-01 adapter for existing PostgreSQL pilot tables; no runtime DDL."""

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from sqlalchemy import (
    Column,
    Float,
    Integer,
    LargeBinary,
    MetaData,
    String,
    Table,
    delete,
    func,
    insert,
    select,
    update,
)
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.ext.asyncio import AsyncConnection, AsyncEngine

from .session_store import LoginState, Session

metadata = MetaData()
states = Table(
    "kit_login_states",
    metadata,
    Column("id", String(64), primary_key=True),
    Column("scope", String(64), nullable=False),
    Column("expires", Float, nullable=False),
    Column("payload", LargeBinary, nullable=False),
)
sessions = Table(
    "kit_sessions",
    metadata,
    Column("id", String(64), primary_key=True),
    Column("scope", String(64), nullable=False),
    Column("expires", Float, nullable=False),
    Column("absolute", Float, nullable=False),
    Column("revision", Integer, nullable=False),
    Column("payload", LargeBinary, nullable=False),
)


class PostgresSessionStore:
    def __init__(self, engine: AsyncEngine):
        if engine.dialect.name != "postgresql":
            raise ValueError("The legacy session adapter requires PostgreSQL")
        self.engine = engine

    @asynccontextmanager
    async def _transaction(self) -> AsyncIterator[AsyncConnection]:
        try:
            async with self.engine.begin() as db:
                yield db
        except SQLAlchemyError:
            # AP-01: driver diagnostics can include connection or row data.
            raise RuntimeError("Session storage unavailable") from None

    async def _admit(
        self, table: Table, scope: str, key: str, *, now: float, limit: int, **values: object
    ) -> bool:
        async with self._transaction() as db:
            # AP-01: lock before any writes to avoid lock-upgrade deadlocks.
            # Table objects are module constants; no caller-selected identifiers.
            await db.exec_driver_sql(f"LOCK TABLE {table.name} IN SHARE ROW EXCLUSIVE MODE")
            expired = table.c.expires <= now
            if table is sessions:
                expired = expired | (table.c.absolute <= now)
            await db.execute(delete(table).where(expired))
            count = await db.scalar(
                select(func.count()).select_from(table).where(table.c.scope == scope)
            )
            if count >= limit:
                return False
            await db.execute(insert(table).values(id=key, scope=scope, **values))
            return True

    async def put_login(
        self, scope: str, key: str, state: LoginState, *, now: float, limit: int
    ) -> bool:
        return await self._admit(
            states, scope, key, now=now, limit=limit, expires=state.expires, payload=state.payload
        )

    async def consume_login(self, scope: str, key: str) -> LoginState | None:
        async with self._transaction() as db:
            row = (
                (
                    await db.execute(
                        delete(states)
                        .where(states.c.id == key, states.c.scope == scope)
                        .returning(states)
                    )
                )
                .mappings()
                .one_or_none()
            )
            return LoginState(row["expires"], row["payload"]) if row is not None else None

    async def put_session(
        self, scope: str, key: str, session: Session, *, now: float, limit: int
    ) -> bool:
        return await self._admit(
            sessions,
            scope,
            key,
            now=now,
            limit=limit,
            expires=session.expires,
            absolute=session.absolute,
            revision=session.revision,
            payload=session.payload,
        )

    async def get_session(self, scope: str, key: str) -> Session | None:
        async with self._transaction() as db:
            row = (
                (
                    await db.execute(
                        select(sessions).where(sessions.c.id == key, sessions.c.scope == scope)
                    )
                )
                .mappings()
                .one_or_none()
            )
            return (
                Session(row["expires"], row["absolute"], row["revision"], row["payload"])
                if row is not None
                else None
            )

    async def replace_session(
        self, scope: str, key: str, expected_revision: int, session: Session
    ) -> bool:
        async with self._transaction() as db:
            return (
                await db.scalar(
                    update(sessions)
                    .where(
                        sessions.c.id == key,
                        sessions.c.scope == scope,
                        sessions.c.revision == expected_revision,
                    )
                    .values(
                        expires=session.expires,
                        absolute=session.absolute,
                        revision=session.revision,
                        payload=session.payload,
                    )
                    .returning(sessions.c.id)
                )
                is not None
            )

    async def delete_session(
        self, scope: str, key: str, *, expected_revision: int | None = None
    ) -> None:
        statement = delete(sessions).where(sessions.c.id == key, sessions.c.scope == scope)
        if expected_revision is not None:
            statement = statement.where(sessions.c.revision == expected_revision)
        async with self._transaction() as db:
            await db.execute(statement)
