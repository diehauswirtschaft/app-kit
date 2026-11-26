# App-kit

App-kit gives HausWirtschaft apps a consistent header, navigation and design
without making each app rebuild them. It also offers optional Python OIDC
helpers for Keycloak. Each app keeps control of its routes, permissions and
session storage.

## Use the header

Pin a reviewed App-kit commit or release in your app's lockfile. Use the Svelte 5,
Vue 3 or Python/Jinja adapter and bundle its assets locally.

All three examples show two tabs (**Übersicht**, **Dokumente**) and two avatar
menu links (**Einstellungen**, **Hilfe**). Use your app's own routes. Pass the
current pathname for active marking and an explicit portal target (`start` or
`staging`) from deployment configuration. The avatar menu requires a signed-in
user from the app's server session. Links are not authorization checks.

### Svelte 5

```svelte
<script lang="ts">
  import '@diehauswirtschaft/app-kit/tokens.css';
  import '@diehauswirtschaft/app-kit/header.css';
  import AppHeader from '@diehauswirtschaft/app-kit/svelte/AppHeader.svelte';
  import type { PortalTarget } from '@diehauswirtschaft/app-kit/navigation';

  let { portalTarget, pathname, user }: {
    portalTarget: PortalTarget;
    pathname: string;
    user: { name: string } | null;
  } = $props();
</script>

<AppHeader title="Beispiel-App" {portalTarget} {pathname}
  authenticated={user !== null} userName={user?.name ?? ''}
  moduleNav={[
    { label: 'Übersicht', href: '/uebersicht' },
    { label: 'Dokumente', href: '/dokumente' },
  ]}
  avatarLinks={[
    { label: 'Einstellungen', href: '/einstellungen' },
    { label: 'Hilfe', href: '/hilfe' },
  ]}
/>
```

In SvelteKit, pass `page.url.pathname` from `$app/state`. The profile menu also
links to `/profil` and posts to `/auth/logout` without a form token. Supply those
routes and enforce your app's server-side CSRF protection on logout.

### Vue 3

```vue
<script setup lang="ts">
import '@diehauswirtschaft/app-kit/tokens.css'
import '@diehauswirtschaft/app-kit/header.css'
import AppHeader from '@diehauswirtschaft/app-kit/vue/AppHeader.vue'
import type { PortalTarget } from '@diehauswirtschaft/app-kit/navigation'

defineProps<{
  portalTarget: PortalTarget
  pathname: string
  user: { name: string } | null
}>()
const emit = defineEmits<{ logout: [] }>()
</script>

<template>
  <AppHeader title="Beispiel-App" :portal-target="portalTarget" :pathname="pathname"
    :authenticated="user !== null" :user-name="user?.name ?? ''"
    :module-nav="[
      { label: 'Übersicht', href: '/uebersicht' },
      { label: 'Dokumente', href: '/dokumente' },
    ]"
    :avatar-links="[
      { label: 'Einstellungen', href: '/einstellungen' },
      { label: 'Hilfe', href: '/hilfe' },
    ]"
    @logout="emit('logout')"
  />
</template>
```

Bind `logout` to the app's local, CSRF-protected logout handler.

### Python / Jinja

```python
from app_kit import user_initials
from app_kit.header_navigation import header_navigation
from jinja2 import Environment, PackageLoader, select_autoescape

jinja = Environment(loader=PackageLoader('app_kit', 'templates'),
                    autoescape=select_autoescape())
jinja.globals['user_initials'] = user_initials


def header_context(portal_target, pathname, *, user, csrf):
    title = 'Beispiel-App'
    return {
        'app_title': title,
        'overview_active': pathname == '/',
        'header_nav': header_navigation(
            portal_target, title, pathname,
            module_nav=[
                {'label': 'Übersicht', 'href': '/uebersicht'},
                {'label': 'Dokumente', 'href': '/dokumente'},
            ],
            avatar_links=[
                {'label': 'Einstellungen', 'href': '/einstellungen'},
                {'label': 'Hilfe', 'href': '/hilfe'},
            ],
        ),
        'user': user,  # Authenticated user with a name, or None.
        'csrf': csrf,
    }
```

If you already have a Jinja environment, add the App-kit loader alongside your
app's loader. Render the page with `header_context(...)` and
`{% include 'header.html' %}`. Serve `design_css()` as a local stylesheet, the
packaged `logo.svg`, `logo-dark.svg`, `signet.svg` and `signet-dark.svg` from
`brand_logo_svg()` under `/assets/app-kit/`, and `shell.js` and `navigation.js`
from `shell_asset()` under the same prefix. On `POST /auth/logout`, validate the
`_csrf` form field server-side.

Tabs are normal links: the app decides whether to handle them client-side.
Use same-origin paths without query strings or fragments for additional links
and avatar images. The strip appears with at least two valid tabs (up to five).
Set `stickyTabs: false` (`sticky_tabs=False` in Python) to disable sticky tabs.

## Optional: Server-side OIDC (Python and Node / SvelteKit)

Standalone apps use one confidential Keycloak client per environment (see
[deploy/keycloak-web-client.template.json](deploy/keycloak-web-client.template.json)).
Tokens stay on the server; the browser receives an opaque host-bound session
cookie. The app provides its own `SessionStore` and enforces route permissions.
Neither the Python nor the Node module requires a specific database.

### Python backend

```python
from app_kit.auth import OIDC

auth = OIDC(settings, store=session_store)
```

### Node / SvelteKit backend

```ts
import { OIDC, type SessionStore } from '@diehauswirtschaft/app-kit/oidc';

export const auth = new OIDC(
  {
    issuer: 'https://auth.diehauswirtschaft.at/realms/dhw-dev',
    clientId: 'dhw-example-web',
    audience: 'dhw-example-web',
    origin: 'https://example.dhw.wien',
    clientSecretFile: '/run/secrets/oidc-client-secret',
    sessionKeyFile: '/run/secrets/session-key', // 32-byte base64url secret
    admissionRoles: ['dhw-member-role'],
  },
  { store: sessionStore satisfies SessionStore },
);
```

Wire `/auth/login` to `auth.loginResponse()`, `/auth/callback` to
`auth.callbackResponse(request)`, `hooks.server.ts` to
`auth.authenticate(request)` and `POST /auth/logout` to
`auth.logoutResponse(request, { csrfToken, expectedCsrf })`. See the
[session storage guide](docs/session-storage-migration.md) for store atomicity
rules and the optional Python PostgreSQL adapter.

## Local checks

```sh
uv sync --locked --python 3.13
uv run --locked ruff check src tests scripts
uv run --locked pytest -q
npm ci --ignore-scripts
node --test tests/*.test.mjs
```

For the isolated PostgreSQL adapter tests, use
`uv run --locked --extra postgres python scripts/test_postgres.py -q`.
Never run those tests against a live database. Local checks do not replace
real SSO, browser and deployment acceptance. See [SECURITY.md](SECURITY.md).
