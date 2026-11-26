"""AP-01 storage invariants, exercised against every configured test store."""

import asyncio
from dataclasses import replace

from app_kit.session_store import LoginState, Session


async def test_login_consume_is_single_use_and_scoped(session_store):
    store = session_store
    state = LoginState(10, b"opaque")
    assert await store.put_login("app", "key", state, now=0, limit=1)
    assert await store.consume_login("other-app", "key") is None
    results = await asyncio.gather(*(store.consume_login("app", "key") for _ in range(8)))
    assert results.count(state) == 1 and results.count(None) == 7


async def test_login_capacity_is_atomic_and_reclaims_expired_state(session_store):
    store = session_store
    state = LoginState(10, b"opaque")
    keys = [f"key{i}" for i in range(8)]
    admitted = await asyncio.gather(
        *(store.put_login("app", key, state, now=0, limit=2) for key in keys)
    )
    assert admitted.count(True) == 2
    assert await store.put_login("other-app", "other", state, now=0, limit=2)
    assert await store.put_login("app", "new", replace(state, expires=20), now=10, limit=2)
    for key in keys:
        assert await store.consume_login("app", key) is None


async def test_session_capacity_counts_live_claim_and_prunes_absolute_expiry(session_store):
    store = session_store
    original = Session(20, 10, 0, b"opaque")
    admitted = await asyncio.gather(
        *(store.put_session("app", f"key{i}", original, now=0, limit=1) for i in range(8))
    )
    assert admitted.count(True) == 1
    key = f"key{admitted.index(True)}"
    assert await store.replace_session("app", key, 0, replace(original, revision=-1, payload=b""))
    assert not await store.put_session("app", "new", original, now=9, limit=1)
    assert await store.put_session("other-app", "other", original, now=9, limit=1)
    assert await store.put_session("app", "new", replace(original, absolute=30), now=10, limit=1)
    assert await store.get_session("app", key) is None


async def test_refresh_claim_is_exclusive_and_cannot_upsert_after_logout(session_store):
    store = session_store
    original = Session(10, 20, 0, b"opaque")
    assert await store.put_session("app", "key", original, now=0, limit=1)
    claim = replace(original, revision=-1, payload=b"")
    assert not await store.replace_session("other-app", "key", 0, claim)
    results = await asyncio.gather(
        *(store.replace_session("app", "key", 0, claim) for _ in range(8))
    )
    assert results.count(True) == 1
    await store.delete_session("app", "key", expected_revision=0)
    await store.delete_session("other-app", "key")
    assert await store.get_session("app", "key") == claim
    await store.delete_session("app", "key")
    assert not await store.replace_session("app", "key", -1, replace(original, revision=1))
    assert await store.get_session("app", "key") is None
