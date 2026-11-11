# app-kit

Shared, versioned dHW building blocks. **Pre-release pilot, not production-certified.**

Owner decisions: Meeting and Protokoll are the first consumers; Felix continues Leitungskreis independently. The portal is not redesigned. GPL-3.0-only; no proprietary fonts, credentials or participant data are included.

## Contents

- **Design:** framework-neutral tokens, system light/dark mode, flat Budget-inspired light appearance, high-contrast portal-inspired dark palette. Amber primary actions, square controls, visible focus, reduced motion and print support.
- **Headers:** thin Jinja and Vue wrappers over the same CSS. Identity comes from the app's own server session. "Hier abmelden" accurately describes local logout.
- **Python SSO:** Authlib OAuth/PKCE + joserfc RS256 validation, confidential Keycloak client, encrypted server-side PostgreSQL login/session state, opaque Secure/HttpOnly/host-bound cookies. Access-token roles only. Issuer/audience/authorized-party/subject/nonce/time checks, single-use login state, row-locked refresh and fresh role evaluation. Client Credentials validation supports separately allowlisted read clients/audiences.

This is not a generic OAuth provider abstraction, a global permission service, a Keycloak administration tool or a dynamic microfrontend loader. Global back-channel logout is not yet implemented. A cloneable app template follows practical pilot acceptance, not the reverse.

## Install / use

Pin an reviewed immutable commit (or a later reviewed release) in the consumer lockfile. No runtime CDN imports, shared cookies or copied authentication implementations.

Python:

```python
from app_kit import design_css
from app_kit.auth import OIDC, OIDCSettings, metadata
```

`design_css()` returns the combined fixed CSS asset; serve it locally. For Jinja use `PackageLoader('app_kit', 'templates')` and include `header.html` with `app_title`, `user`, and `csrf` from the local authenticated request.

Vue:

```js
import '@diehauswirtschaft/app-kit/tokens.css'
import '@diehauswirtschaft/app-kit/header.css'
import AppHeader from '@diehauswirtschaft/app-kit/vue/AppHeader.vue'
```

The package deliberately does **not** force global HTML/form styles on Vue consumers. PostgreSQL-backed `OIDC` requires explicit installation of `metadata` in the consumer's separate migration step. Runtime must not own schema/DDL rights. Schema and fixtures remain separate. Each app has its own database, runtime credentials, OIDC client and session key.

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

RSA/OIDC/refresh tests require real PostgreSQL and `PILOT_DATABASE_URL_FILE`, pointing to a **private runtime-generated** psycopg URL file. They create/drop only random isolated schemas. Without that setting they explicitly skip; asset/secret tests still run. CI must provide it. Never point acceptance at a live app database.

Design source: `budgetprioritaeten` design commit `da1a59a6b589ba41ebc02f7027a092ab40a54098`; comparison with portal `services/bff/src/app.css`. These are design inputs, not a license grant for fonts or approval to alter the portal. The shared palette is a pilot implementation, not a claim that every derived web rule appears in the print styleguide.

## Release gates

Real Keycloak login/refresh/logout, client/role evaluation, consumer browser checks, runtime dependency audit, deployment isolation and rollback must be accepted before a live SSO switch. Synthetic provider tests are not real SSO acceptance. A service using these libraries is not automatically authorized to run in dHW infrastructure.
