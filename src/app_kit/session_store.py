"""AP-01: persistence contract for app-owned server-side OIDC sessions."""

from dataclasses import dataclass, field
from typing import Protocol


@dataclass(frozen=True)
class LoginState:
    expires: float
    payload: bytes = field(repr=False)


@dataclass(frozen=True)
class Session:
    expires: float
    absolute: float
    # Negative revisions are durable refresh claims, not available sessions.
    revision: int
    payload: bytes = field(repr=False)


class SessionStore(Protocol):
    """All operations use (scope, hashed key); payloads are opaque ciphertext.

    Operations must be atomic and visible across all workers using the store.
    Return only after commit, and never treat a storage failure as a miss. Do
    not log IDs, payloads or connection secrets. Store errors must be safe to
    expose to server-side exception handlers.
    """

    async def put_login(
        self, scope: str, key: str, state: LoginState, *, now: float, limit: int
    ) -> bool:
        """Prune expired entries and insert atomically under a per-scope cap.

        Return False on capacity exhaustion, never overwrite or evict a live entry.
        """
        ...

    async def consume_login(self, scope: str, key: str) -> LoginState | None:
        """Remove and return in one operation; at most one caller gets the state."""
        ...

    async def put_session(
        self, scope: str, key: str, session: Session, *, now: float, limit: int
    ) -> bool:
        """Like put_login, counting live refresh claims toward the session cap."""
        ...

    async def get_session(self, scope: str, key: str) -> Session | None:
        """Read the current committed record, including a pending claim if present."""
        ...

    async def replace_session(
        self, scope: str, key: str, expected_revision: int, session: Session
    ) -> bool:
        """Only update an existing record with the expected revision, never insert.

        This also commits the exclusive refresh claim *before* any provider call.
        A claim must never fall back to its old revision, even on worker failure.
        """
        ...

    async def delete_session(
        self, scope: str, key: str, *, expected_revision: int | None = None
    ) -> None:
        """Delete atomically; without a revision this also revokes a pending refresh."""
        ...
