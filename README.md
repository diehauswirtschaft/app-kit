# App-kit

App-kit ist die gemeinsame Bibliothek für Kopfzeile, Navigation und Design der
HausWirtschaft-Apps. Für die Anmeldung mit Keycloak gibt es optionale
OIDC-Bausteine für Python und Node/SvelteKit. Jede App verwaltet ihre Routen,
Berechtigungen und Sitzungen selbst.

**Du startest eine neue App?** [app-example](https://github.com/diehauswirtschaft/app-example)
bietet startfertige Vorlagen für FastAPI und SvelteKit. Dort ist app-kit bereits
in einer festgelegten Version eingebunden. Diese README erklärt die Einbindung
und Konfiguration von app-kit, auch für bestehende Apps.

## Basisstile und Kopfzeile einbinden

1. Lege im Lockfile deiner App einen geprüften App-kit-Commit oder ein geprüftes
   Release fest.
2. Wähle den Adapter für Svelte 5, Vue 3 oder Python/Jinja. Binde die Styles
   einmal für die ganze App ein. Bei JavaScript gilt diese Reihenfolge:
   `tokens.css`, `header.css`, `base.css`. In Python liefert `design_css()`
   dieselben drei Dateien in derselben Reihenfolge.
3. Verwende die Routen deiner App. Übergib den aktuellen Pfad, damit die
   Kopfzeile den aktiven Link markieren kann. Lies das Portalziel (`start` oder
   `staging`) aus deiner Deployment-Konfiguration.

`base.css` wendet die Design-Tokens auf den Seitenhintergrund, die Schrift
und den Tastaturfokus an. Setze `<main class="dhw-main">` um den Seiteninhalt.
Die Klasse gibt dem Inhalt einen flexiblen Seitenabstand und eine maximale
Breite. Der Hell- und Dunkelmodus folgt der Systemeinstellung.

Die Beispiele zeigen zwei Registerkarten (**Übersicht**, **Dokumente**) und zwei
Links im Profilmenü (**Einstellungen**, **Hilfe**). Das Profilmenü erscheint nur,
wenn die serverseitige Sitzung eine Anmeldung bestätigt. Links ersetzen keine
Berechtigungsprüfung.

Das W-Signet heißt für Screenreader „Startseite“ und führt zur Startseite des
Portals. Der Titel-Link heißt wie die App oder das Modul. Bei eigenständigen
Apps führt er zu `/`. Ein Portal mit eingebetteten Modulen übergibt den
registrierten Einstiegspfad als `moduleHome` (bei Jinja: `module_home` in
`header_navigation()`). Übergib auch auf Unterseiten diesen Einstiegspfad,
nicht den aktuellen Pfad.

### Svelte 5

```svelte
<script lang="ts">
  import '@diehauswirtschaft/app-kit/tokens.css';
  import '@diehauswirtschaft/app-kit/header.css';
  import '@diehauswirtschaft/app-kit/base.css';
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

Übergib in SvelteKit `page.url.pathname` aus `$app/state`. Das Profilmenü
verlinkt auch `/profil` und sendet einen POST an `/auth/logout`. Das Formular
enthält kein CSRF-Token. Stelle beide Routen bereit und setze den serverseitigen
CSRF-Schutz deiner App für die Abmeldung durch.

### Vue 3

```vue
<script setup lang="ts">
import '@diehauswirtschaft/app-kit/tokens.css'
import '@diehauswirtschaft/app-kit/header.css'
import '@diehauswirtschaft/app-kit/base.css'
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

Verbinde `logout` mit der lokalen, CSRF-geschützten Abmeldefunktion deiner App.

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
        'user': user,  # Angemeldete Person mit Namen oder None.
        'csrf': csrf,
    }
```

1. Wenn du schon eine Jinja-Umgebung hast, ergänze den App-kit-Loader neben dem
   Loader deiner App.
2. Übergib `header_context(...)` an die Vorlage. Binde die Kopfzeile mit
   `{% include 'header.html' %}` ein.
3. Stelle `design_css()` als lokales Stylesheet bereit. Liefere unter
   `/assets/app-kit/` die Dateien `logo.svg`, `logo-dark.svg`, `signet.svg` und
   `signet-dark.svg` über `brand_logo_svg()` aus. Liefere unter demselben Pfad
   `shell.js` und `navigation.js` über `shell_asset()` aus.
4. Prüfe bei `POST /auth/logout` das Formularfeld `_csrf` auf dem Server.

Registerkarten sind normale Links. Die App entscheidet, ob sie die Navigation
im Browser selbst übernimmt. Verwende für zusätzliche Links und Profilbilder
Pfade auf derselben Origin, ohne URL-Parameter oder Fragmente. Die Leiste
erscheint ab zwei gültigen Registerkarten und zeigt höchstens fünf. Mit
`stickyTabs: false` (in Python: `sticky_tabs=False`) bleibt die Leiste beim
Scrollen nicht oben stehen.

## Optional: Serverseitige Anmeldung mit OIDC (Python und Node/SvelteKit)

Eigenständige Apps verwenden einen vertraulichen Keycloak-Client je Umgebung.
Siehe [Keycloak-Client-Vorlage](deploy/keycloak-web-client.template.json).

1. Die Vorlage setzt `fullScopeAllowed: false`. Weise deshalb die Rollen zu, die
   zur Anmeldung berechtigen (zum Beispiel `dhw-member-role`). Der Menüpfad in
   Keycloak lautet **Clients → `<client>` → Client scopes → `<client>-dedicated`
   → Scope → Assign role**.
2. Prüfe in `dhw-dev` unter **Evaluate**, ob die Rollen im Access-Token unter
   `realm_access.roles` stehen. Ohne eine passende Rolle lehnt die App die
   Anmeldung ab.

Die Tokens bleiben auf dem Server. Der Browser erhält nur eine undurchsichtige
Sitzungskennung in einem Cookie, das an den Host der App gebunden ist. Die App
stellt ihren eigenen `SessionStore` bereit und prüft die Berechtigungen für ihre
Routen. Weder der Python- noch der Node-Baustein schreibt eine Datenbank vor.

### Python-Backend

```python
from app_kit.auth import OIDC

auth = OIDC(settings, store=session_store)
```

### Node-/SvelteKit-Backend

```ts
import { OIDC, type SessionStore } from '@diehauswirtschaft/app-kit/oidc';

export const auth = new OIDC(
  {
    issuer: 'https://auth.diehauswirtschaft.at/realms/dhw-dev',
    clientId: 'dhw-example-web',
    audience: 'dhw-example-web',
    origin: 'https://example.dhw.wien',
    clientSecretFile: '/run/secrets/oidc-client-secret',
    sessionKeyFile: '/run/secrets/session-key', // 32 Byte, base64url-kodiert
    admissionRoles: ['dhw-member-role'],
  },
  { store: sessionStore satisfies SessionStore },
);
```

Verbinde die Routen und den Server-Hook so:

| Route oder Hook | App-kit-Methode |
| --- | --- |
| `/auth/login` | `auth.loginResponse()` |
| `/auth/callback` | `auth.callbackResponse(request)` |
| `hooks.server.ts` | `auth.authenticate(request)` |
| `POST /auth/logout` | `auth.logoutResponse(request, { csrfToken, expectedCsrf })` |

Die [Anleitung zum Sitzungsspeicher](docs/session-storage-migration.md) erklärt,
welche Operationen atomar sein müssen und wie der optionale PostgreSQL-Adapter
für Python funktioniert.

## Lokale Prüfungen

```sh
uv sync --locked --python 3.13
uv run --locked ruff check src tests scripts
uv run --locked pytest -q
npm ci --ignore-scripts
node --test tests/*.test.mjs
```

Starte die isolierten Tests für den PostgreSQL-Adapter mit
`uv run --locked --extra postgres python scripts/test_postgres.py -q`.
Führe diese Tests nie gegen eine Datenbank im laufenden Betrieb aus. Lokale
Prüfungen ersetzen keine Abnahme mit echtem SSO, im Browser und in der
Zielumgebung. Siehe [SECURITY.md](SECURITY.md).
