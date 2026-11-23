# AP-01: Session storage is owned by the consuming app

## First step: keep the current callers working

- Keep `OIDC(settings, engine)` and the exported table metadata as a legacy PostgreSQL adapter. Protokoll can keep the same tables, opaque cookies, encrypted payloads and database. No schema or deployment change in the avatar patch.
- Meeting already owns its OIDC and sessions. Use the standalone avatar helper with claims from Meeting's verifier; don't switch its authentication or touch recording.
- `app_kit.avatar` does not depend on SQLAlchemy. The package as installed still does until the adapter moves to an optional extra.

## Separate change: extract the storage boundary

1. Extract login-state and session operations into a storage protocol, with opaque encrypted payloads and atomic operations. The core owns OIDC verification, binding, expiry policy and encryption; the adapter implements the atomic storage semantics. Accept an explicitly supplied store, never select a default backend implicitly.
2. Keep the legacy constructor import path as a compatibility facade and move PostgreSQL-specific SQL and SQLAlchemy dependencies into an optional extra. Add a cold-import test using a fresh installation without database dependencies. Protokoll opts into the extra and pins the tested release; existing tables and session data are not migrated for this change. Meeting keeps its own auth implementation.
3. Contract-test atomic login-state consume, capacity, expiry, refresh and logout. A read/write interface or post-refresh CAS alone is insufficient: concurrent refreshes must not submit the same rotating token twice, and logout must prevent an in-flight refresh from reviving a session. Keep the current PostgreSQL locks until those guarantees pass against the real adapter. Any in-memory adapter is explicit and limited to single-process use.

Keep verified `picture` server-side. Apps expose their own session-checked image route and pass only that local path to the shell; no cross-app cookie or token. Keep HTTP client request logging disabled for image URLs. No image upload or resize is introduced here.
