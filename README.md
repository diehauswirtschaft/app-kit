# app-kit

Shared, versioned dHW building blocks. **Pre-release pilot, not production-certified.**

Owner decisions: Meeting and Protokoll are the first consumers; Felix continues Leitungskreis independently. The portal is not redesigned. GPL-3.0-only; no proprietary fonts, credentials or participant data are included.

**Owner clarification, 2026-11-18 — blocking SDK boundary:** Each consumer owns
its session persistence. app-kit must not mandate PostgreSQL, SQLite, Redis,
an ORM, or a separate database service. Shared OIDC/header building blocks must
integrate with the app's session management without choosing its storage.
Server-side tokens, opaque host-bound browser sessions and the common validation
profile remain security requirements, not a prescribed storage technology.
`OIDC` takes an explicit consumer-owned `SessionStore`. The existing
PostgreSQL adapter is optional and only for compatible pilot consumers. No LK
application logic or storage migration is authorized by this pilot.

## Contents

- **Design:** framework-neutral tokens, system light/dark mode, flat Budget-inspired light appearance, high-contrast portal-inspired dark palette. Amber primary actions, square controls, visible focus, reduced motion and print support.
- **Headers:** Svelte, Vue and Jinja use the same styles and artwork. The wordmark always links to the configured portal; the app label links to the app home. Identity and logout remain local to the app. Images use a same-origin path and fall back to initials.

### Header navigation (AP-02)

- Validate the deployment's `start` or `staging` target at bootstrap (`requirePortalHref` in JS, `require_portal_href` in Python). Pass the target as `portalTarget` in Svelte/Vue, or pass `header_nav = header_navigation(target, title, pathname, ...)` to the Jinja template. Replacing an older header pin requires updating this call site; do not derive the target from a request or fall back to production. `entry` is removed from mounted pages but not used by the header. Legacy helper exports remain for Start during the coordinated cutover.
- `moduleNav` / `module_nav` and `avatarLinks` / `avatar_links` are independent optional lists of `{ label, href, match? }`. A module strip takes at most five links and is hidden with fewer than two. Menus may exist without a module strip. `helpHref` / `help_href` adds “Hilfe zu …”. Only local paths, without query or fragment. Pass the current pathname for active-link marking, including on details. The caller still controls roles and authorizes every destination.
- Module overflow uses the shared More menu; apps cannot choose the overflow mode. The More menu keeps the active area and, when they fit together, the first area in the strip. Supply a full `label` and optionally a `shortLabel` (`short_label` in Python) for a label that needs less space. The menu always shows full labels. Extremely narrow layouts and browsers without JS use the scroll strip instead of hiding links. A portal-wide preference may select the mode in a future release; this version does not store or accept one.
- Only the module strip stays at the top on scroll by default. Set `stickyTabs: false` (`sticky_tabs=False` in Python) to let the whole header scroll away. A header without a module strip never sticks. Render the header in the page's scrolling container, not inside a wrapper that ends immediately after the header; a mount-only wrapper may use `display: contents`.
- `guard: { mode: 'block' | 'confirm', message }` is controlled by the consumer. Blocking removes link destinations and disables logout; confirmation precedes ordinary navigation or logout. The Vue recorder flag and Jinja dirty-editor guard remain. App-specific navigation outside the kit and browser exit protection remain the consumer's responsibility.

- **Python SSO:** Authlib OAuth/PKCE + joserfc RS256 validation, confidential Keycloak client, encrypted server-side login/session state in a consumer-supplied store, opaque Secure/HttpOnly/host-bound cookies. Access-token roles only. Issuer/audience/authorized-party/subject/nonce/time checks, single-use login state, atomic refresh claims and fresh role evaluation. Client Credentials validation supports separately allowlisted read clients/audiences. Mixed public JWKS (e.g. Keycloak RSA-OAEP encryption + RS256 signing keys) are filtered to appropriate RS256 verification keys; encryption kids cannot verify JWTs. Private/ambiguous/malformed key sets remain rejected.

This is not a generic OAuth provider abstraction, a global permission service, a Keycloak administration tool or a dynamic microfrontend loader. Global back-channel logout is not yet implemented. A cloneable app template follows practical pilot acceptance, not the reverse.

## Install / use

Pin an reviewed immutable commit (or a later reviewed release) in the consumer lockfile. No runtime CDN imports, shared cookies or copied authentication implementations.

Python:

```python
from app_kit import design_css
from app_kit.auth import OIDC
from app_kit.session_store import SessionStore

# settings and the SessionStore implementation are provided by the app.
def create_auth(settings, store: SessionStore) -> OIDC:
    return OIDC(settings, store=store)
```

`design_css()` returns the combined fixed CSS asset; serve it locally. For Jinja use `PackageLoader('app_kit', 'templates')` and include `header.html` with `app_title`, `user`, and `csrf` from the local authenticated request. Register `user_initials` from `app_kit` in the Jinja environment globals. Serve the packaged `brand_logo_svg()` bytes at `/assets/app-kit/logo.svg` and `brand_logo_svg(dark=True)` at `/assets/app-kit/logo-dark.svg`, both `image/svg+xml`. For the compact mobile header also serve `brand_logo_svg(signet=True)` at `/assets/app-kit/signet.svg` and `brand_logo_svg(signet=True, dark=True)` at `/assets/app-kit/signet-dark.svg`. These are fixed public library assets, not paths supplied by callers. The Vue wrapper imports these same SVG files as bundled local URLs; no CDN or font request is required. Serve `shell_asset('shell.js')` and `shell_asset('navigation.js')` at `/assets/app-kit/shell.js` and `/assets/app-kit/navigation.js` with JavaScript MIME. `header.html` includes the external module under a self-only script CSP; no inline script is required. Editor forms opt into the dirty guard with `data-dhw-dirty`.

Vue:

```js
import '@diehauswirtschaft/app-kit/tokens.css'
import '@diehauswirtschaft/app-kit/header.css'
import AppHeader from '@diehauswirtschaft/app-kit/vue/AppHeader.vue'
```

The package deliberately does **not** force global HTML/form styles on Vue consumers.

For OIDC there is no default store. Each app owns the storage implementation,
migrations and runtime permissions, and uses its own OIDC client and session key.
Existing PostgreSQL pilots can install `dhw-app-kit[postgres]` and keep
`OIDC(settings, engine)` and their existing tables. Schema creation remains a
separate migration using `app_kit.postgres.metadata` (the old import still works).
Runtime must not own DDL rights. See [session storage and pilot compatibility](docs/session-storage-migration.md).

## Authentication configuration

- HTTPS issuer and origin; own client ID/audience, generated confidential-client secret and independent Fernet key in private 0400/0600 files.
- Explicit admission roles; the library does not decide a consumer's document, committee, publication or operator rights.
- New clients use their own client ID as access-token audience, `basic`/`profile`/`roles` default scopes, dedicated audience mapper (access token only), Full Scope Allowed off and explicit role mappings, per AP-01.
- No discovery/token redirects, environment proxies, ID-token roles, UserInfo fallback, browser tokens, shared subdomain cookies or production test-login flags.
- Login state expires after 5 minutes; idle session 30 minutes, absolute 8 hours. Limits: 1,000 concurrent login states/sessions per app. Ingress per-source request-rate limits are additionally required before public rollout.
- Roles update at the next successful refresh. Do not promise immediate realm-role revocation.
- Logout currently clears the local session only. Do not claim cross-app logout.
- Never log OAuth callback query strings, headers, tokens or upstream response bodies. Use route templates and request IDs; disable web access logs that include callback URLs.

## Development

`uv sync --locked --python 3.13`; `uv run ruff check src tests`; `uv run pytest`.

`uv run --locked --extra postgres python scripts/test_postgres.py -q` builds the pinned, hardened PostgreSQL recipe under `scripts/postgres/`, runs the complete suite against a loopback-only ephemeral database and cleans up its own container. No named data volumes or pre-existing DB are used. The original upstream candidate is not accepted as a deployment image: its unused gosu binary and two vulnerable library packages required actual removal/upgrades, not advisory ignores.

The default suite runs RSA/OIDC and storage-contract tests with a test-only
in-memory store. The PostgreSQL runner repeats those tests against the actual
adapter in random isolated schemas. The runner passes one-use credentials
via process environments rather than credential files or command arguments.
Use a trusted local container runtime or an isolated CI runner; privileged
runtime operators can inspect the disposable container environment. Never
point acceptance at a live app database.

Design source: `budgetprioritaeten` design commit `da1a59a6b589ba41ebc02f7027a092ab40a54098`; comparison with portal `services/bff/src/app.css`. These are design inputs, not a license grant for fonts or approval to alter the portal. The shared palette is a pilot implementation, not a claim that every derived web rule appears in the print styleguide.

## Release gates

Real Keycloak login/refresh/logout, client/role evaluation, consumer browser checks, runtime dependency audit, deployment isolation and rollback must be accepted before a live SSO switch. Synthetic provider tests are not real SSO acceptance. A service using these libraries is not automatically authorized to run in dHW infrastructure.
