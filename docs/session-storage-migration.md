# AP-01: Session storage is owned by the consuming app

## New consumers

Pass a consumer implementation of `app_kit.session_store.SessionStore` as
`OIDC(settings, store=store)`. The base package installs no database driver or
ORM, and does not supply a default store. An app that already owns its OIDC
flow (like Meeting) need not adopt `OIDC` to use the header or avatar helper.

The core owns encryption, cookie binding, expiry policy and OIDC validation.
The adapter stores opaque ciphertext and must implement the contract across
all workers that share the app's sessions:

- Admit under a per-scope capacity limit without evicting live entries. Prune
  expired records; a session is expired at the earlier of its two deadlines.
- Consume login state atomically before contacting the provider.
- Compare-and-replace an existing session by scoped key and exact revision.
  Commit a negative revision with an empty payload **before** calling the
  provider; only the winning request can use the old rotating token. Other
  requests wait briefly, then fail closed. Never roll back or reclaim a pending
  revision after a worker dies: the record expires and the user can sign in
  again. Finalization may only replace that exact revision, never insert.
- Delete for logout regardless of revision. Conditional deletes on failed
  validation must not remove a newer revision.

The test-only memory implementation is not a production backend. Run the
contract tests against the app's real adapter and exercise parallel workers
before deploying.

## Existing PostgreSQL pilots

Install the `postgres` extra. `OIDC(settings, engine)` and `metadata`,
`states`, `sessions` imports from `app_kit.auth` still work. New adapter users
can instead construct `PostgresSessionStore(engine)` from `app_kit.postgres`.
The schema, existing ready sessions, encryption and cookies are unchanged. No
new database service or storage migration is needed. Use the normal PostgreSQL
`READ COMMITTED` isolation for the adapter. Keep schema administration out of
runtime processes.

Do not mix old and new auth workers against a shared store during rollout or
rollback: the old implementation does not recognize pending claim revisions.
Stop and drain all workers before switching versions. Before returning to old
code, discard pending rows (negative revisions) in the app's maintenance step.
No consumer rollout is part of this change.

Keep verified `picture` server-side. Apps expose their own session-checked image
route and pass only that local path to the shell; no cross-app cookie or token.
Keep HTTP client request logging disabled for image URLs.
