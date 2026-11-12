/** AP-02 / ASI-006: navigation hints only, never identity or authorization.
 * Fixed destinations avoid open redirects; storage is per origin/tab and holds
 * only one allowlisted UI word, never OIDC/session/CSRF material. */
const portals = Object.freeze({ start: 'https://start.dhw.wien/', staging: 'https://start-staging.dhw.wien/' })
const key = 'dhw.portal-entry'
export function portalHref(entry) {
  return typeof entry === 'string' && Object.hasOwn(portals, entry) ? portals[entry] : null
}
export function entryForOrigin(origin) {
  return Object.entries(portals).find(([, target]) => target === origin.replace(/\/$/, '') + '/')?.[0] ?? null
}
export function capturePortalEntry(url, storage) {
  const values = url.searchParams.getAll('entry')
  if (values.length) {
    const value = values.length === 1 && portalHref(values[0]) ? values[0] : null
    try { if (value) storage?.setItem(key, value); else storage?.removeItem(key) } catch { /* Storage can be disabled; no authentication depends on it. */ }
    return portalHref(value)
  }
  try { return portalHref(storage?.getItem(key)) } catch { return null }
}
export function initials(name) {
  return String(name || 'Mitglied').trim().split(/\s+/u).filter(Boolean).slice(0, 2).map(part => Array.from(part)[0]).join('').toLocaleUpperCase('de-AT')
}
export function installHeaderInteractions(root) {
  const close = event => {
    for (const menu of root.querySelectorAll('[data-dhw-profile][open]')) {
      if (event.type === 'keydown' && event.key === 'Escape') {
        menu.open = false; menu.querySelector('summary')?.focus()
      } else if (event.type === 'click' && !menu.contains(event.target)) menu.open = false
    }
  }
  document.addEventListener('click', close)
  root.addEventListener('keydown', close)
  return () => { document.removeEventListener('click', close); root.removeEventListener('keydown', close) }
}
