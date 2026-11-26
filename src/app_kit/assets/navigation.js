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
// AP-02 / ASI-023: select at app bootstrap, not from request data or entry hints.
export function requirePortalHref(target) {
  const href = portalHref(target)
  if (!href) throw new Error('Explizites Portalziel start oder staging erforderlich')
  return href
}
export function cleanLegacyPortalEntry(location, history) {
  const url = new URL(location.href)
  if (url.searchParams.has('entry')) {
    url.searchParams.delete('entry')
    history.replaceState(history.state, '', url)
  }
}
// Never allow an app menu to become an open redirect or carry URL credentials.
export function localNavLinks(items = [], pathname = '/', limit = Infinity) {
  const links = []
  for (const item of items) {
    if (!item || typeof item.label !== 'string' || !item.label.trim() || typeof item.href !== 'string' ||
        !/^\/(?:[a-z0-9_.~-]+\/)*[a-z0-9_.~-]*$/i.test(item.href) ||
        item.href.split('/').some(segment => segment === '.' || segment === '..') ||
        links.some(link => link.href === item.href)) continue
    links.push({ label: item.label.trim(), href: item.href, shortLabel: typeof item.shortLabel === 'string' ? item.shortLabel.trim() : undefined, match: item.match, current: undefined })
    if (links.length >= limit) break
  }
  let active
  for (const link of links) {
    const base = link.href.replace(/\/$/, '')
    const exact = link.href === pathname
    const prefix = base && link.match !== 'exact' && pathname.startsWith(`${base}/`)
    if ((exact || prefix) && (!active || link.href.length > active.href.length)) active = link
  }
  if (active) active.current = active.href === pathname ? 'page' : 'location'
  return links
}
export function guardHeaderExit(event, guard, confirmExit = message => window.confirm(message)) {
  if (!guard || (guard.mode === 'confirm' && confirmExit(guard.message))) return true
  event.preventDefault()
  event.stopImmediatePropagation()
  return false
}
export function initials(name) {
  return String(name || 'Mitglied').trim().split(/\s+/u).filter(Boolean).slice(0, 2).map(part => Array.from(part)[0]).join('').toLocaleUpperCase('de-AT')
}
// AP-02: callers own authorization and image delivery. The header never
// contacts an external host or places query credentials in an image URL.
export function avatarPath(value) {
  return typeof value === 'string' && /^\/[a-z0-9_-][a-z0-9_/.-]*$/i.test(value) ? value : null
}
// Overflow presentation is shared across apps, not a consumer prop. Keep the
// scroll implementation for progressive fallback and a future portal preference.
const moduleOverflowMode = 'more'

function installMoreNavigation(root) {
  if (moduleOverflowMode !== 'more') return () => {}
  const states = new Map()
  const refresh = () => {
    for (const [strip, state] of states) {
      if (!root.contains(strip)) {
        state.cleanup()
        states.delete(strip)
      }
    }
    for (const strip of root.querySelectorAll('.dhw-module-nav-frame[data-dhw-module-overflow] > .dhw-module-nav')) {
      if (!states.has(strip)) states.set(strip, moreNavigation(strip))
      states.get(strip).layout()
    }
  }
  const observer = new MutationObserver(records => {
    if (records.some(record => !record.target.closest?.('[data-dhw-more-control]') &&
        (record.type !== 'childList' || [...record.addedNodes, ...record.removedNodes].some(node => !node.matches?.('[data-dhw-more-control]'))))) refresh()
  })
  observer.observe(root, { childList: true, subtree: true, characterData: true, attributes: true,
    attributeFilter: ['aria-current', 'aria-disabled', 'href'] })
  const resize = new ResizeObserver(refresh)
  resize.observe(root)
  document.fonts?.addEventListener('loadingdone', refresh)
  refresh()
  return () => {
    observer.disconnect(); resize.disconnect()
    document.fonts?.removeEventListener('loadingdone', refresh)
    for (const state of states.values()) state.cleanup()
  }
}

function moreNavigation(strip) {
  const frame = strip.parentElement
  const button = document.createElement('button')
  button.type = 'button'; button.className = 'dhw-more-toggle'; button.textContent = '⋯'
  button.setAttribute('aria-label', '⋯ – Weitere Bereiche')
  const panel = document.createElement('div')
  panel.className = 'dhw-more-panel'
  button.dataset.dhwMoreControl = ''; panel.dataset.dhwMoreControl = ''
  strip.append(button, panel)
  const open = value => { panel.hidden = !value; button.setAttribute('aria-expanded', String(value)) }
  const closeOutside = event => {
    if (!panel.contains(event.target) && !button.contains(event.target)) open(false)
  }
  const escape = event => {
    if (event.key === 'Escape' && !panel.hidden) { open(false); button.focus(); event.stopPropagation() }
  }
  button.addEventListener('click', () => open(panel.hidden))
  strip.addEventListener('keydown', escape)
  document.addEventListener('click', closeOutside)
  let previous = ''
  function layout() {
    const links = Array.from(strip.querySelectorAll(':scope > a'))
    const signature = JSON.stringify([frame.clientWidth, links.map(link => [link.textContent, link.getAttribute('aria-current'), link.getAttribute('href'), link.getAttribute('aria-disabled')])])
    if (signature === previous) return
    previous = signature
    const focused = document.activeElement
    const focusHref = panel.contains(focused) ? focused.getAttribute('href') : null
    open(false); button.hidden = true; panel.replaceChildren()
    frame.setAttribute('data-dhw-more-ready', '')
    links.forEach(link => { link.hidden = false; link.removeAttribute('data-dhw-compact') })
    if (strip.scrollWidth > strip.clientWidth + 1) {
      button.hidden = false
      const active = links.find(link => link.hasAttribute('aria-current'))
      const visible = new Set([links[0], active].filter(Boolean))
      const show = () => links.forEach(link => { link.hidden = !visible.has(link) })
      show()
      // Prefer complete labels; compact only if the primary + active links need it.
      if (strip.scrollWidth > strip.clientWidth + 1) {
        for (const link of links.filter(link => link.querySelector('.dhw-nav-short'))) link.setAttribute('data-dhw-compact', '')
      }
      if (strip.scrollWidth > strip.clientWidth + 1) { visible.delete(links[0]); if (active) visible.add(active); show() }
      if (strip.scrollWidth > strip.clientWidth + 1) {
        // Extreme widths/zoom still get reachable links, not clipped controls.
        links.forEach(link => { link.hidden = false; link.removeAttribute('data-dhw-compact') })
        button.hidden = true; frame.removeAttribute('data-dhw-more-ready')
      } else {
        for (const link of links) {
          if (visible.has(link)) continue
          visible.add(link); show()
          if (strip.scrollWidth > strip.clientWidth + 1) { visible.delete(link); show() }
        }
        for (const link of links.filter(link => link.hidden)) {
          // Clone only already validated links. Leave framework-owned nodes in
          // place; shared exit guards still intercept these links in the header.
          const copy = link.cloneNode(false)
          copy.hidden = false; copy.removeAttribute('data-dhw-compact')
          copy.textContent = link.firstElementChild?.textContent ?? link.textContent
          panel.append(copy)
        }
        if (!panel.childElementCount) button.hidden = true
      }
    }
    if (focused?.hidden || focusHref) {
      if (!button.hidden) button.focus()
      else links.find(link => link.getAttribute('href') === focusHref)?.focus()
    }
  }
  return { layout, cleanup() {
    document.removeEventListener('click', closeOutside); strip.removeEventListener('keydown', escape)
    strip.querySelectorAll(':scope > a').forEach(link => { link.hidden = false; link.removeAttribute('data-dhw-compact') })
    button.remove(); panel.remove(); frame.removeAttribute('data-dhw-more-ready')
  } }
}

export function installHeaderInteractions(root) {
  for (const image of root.querySelectorAll('img[data-dhw-avatar-src]')) {
    const path = avatarPath(image.dataset.dhwAvatarSrc)
    if (!path) continue
    image.addEventListener('load', () => { image.hidden = false; image.previousElementSibling.hidden = true }, { once: true })
    image.src = path
  }
  const cleanupMore = installMoreNavigation(root)
  const updateSticky = () => {
    const frame = root.querySelector('.dhw-module-nav-frame')
    root.toggleAttribute('data-dhw-sticky-ready', Boolean(frame))
    if (frame) root.style.setProperty('--dhw-sticky-brand-height', `${frame.offsetTop}px`)
  }
  const updateOverflow = () => {
    updateSticky()
    for (const strip of root.querySelectorAll('.dhw-module-nav')) {
      const frame = strip.parentElement
      // Measure available width before reserving space for indicators so the
      // indicators cannot cause an overflow that wasn't there in the first place.
      if (frame.hasAttribute('data-dhw-more-ready')) {
        for (const attribute of ['data-dhw-overflow', 'data-dhw-more-left', 'data-dhw-more-right']) frame.removeAttribute(attribute)
        continue
      }
      const content = strip.querySelector('a:last-of-type')
      const fullWidth = content ? content.offsetLeft + content.offsetWidth + parseFloat(getComputedStyle(strip).paddingRight) : 0
      const overflow = fullWidth > frame.clientWidth + 1
      frame.toggleAttribute('data-dhw-overflow', overflow)
      frame.toggleAttribute('data-dhw-more-left', overflow && strip.scrollLeft > 1)
      frame.toggleAttribute('data-dhw-more-right', overflow && strip.scrollLeft + strip.clientWidth < strip.scrollWidth - 1)
    }
  }
  const observer = new ResizeObserver(updateOverflow)
  observer.observe(root)
  const changes = new MutationObserver(updateOverflow)
  changes.observe(root, { childList: true, subtree: true, characterData: true })
  // Reposition only the horizontal strip on page load or an active-route
  // change. Do not pull it back while the user swipes to explore other links.
  const revealActiveLinks = () => {
    for (const strip of root.querySelectorAll('.dhw-module-nav')) {
      const link = strip.querySelector('[aria-current]')
      if (!link) continue
      const bounds = strip.getBoundingClientRect()
      const active = link.getBoundingClientRect()
      if (active.left < bounds.left || active.right > bounds.right) {
        strip.scrollLeft += active.left + active.width / 2 - (bounds.left + bounds.width / 2)
      }
    }
  }
  const routeChanges = new MutationObserver(() => { updateOverflow(); revealActiveLinks() })
  routeChanges.observe(root, { attributes: true, attributeFilter: ['aria-current'], childList: true, subtree: true })
  const revealFocusedLink = event => {
    const link = event.target.closest?.('.dhw-module-nav a')
    if (!link?.matches(':focus-visible') || !link.parentElement.matches('.dhw-module-nav')) return
    const strip = link.parentElement
    const bounds = strip.getBoundingClientRect(), target = link.getBoundingClientRect()
    if (target.left < bounds.left) strip.scrollLeft += target.left - bounds.left
    if (target.right > bounds.right) strip.scrollLeft += target.right - bounds.right
  }
  root.addEventListener('scroll', updateOverflow, true)
  root.addEventListener('focusin', revealFocusedLink)
  updateOverflow()
  revealActiveLinks()
  const close = event => {
    for (const menu of root.querySelectorAll('[data-dhw-profile][open]')) {
      if (event.type === 'keydown' && event.key === 'Escape') {
        menu.open = false; menu.querySelector('summary')?.focus()
      } else if (event.type === 'click' && (!menu.contains(event.target) || (!event.defaultPrevented && event.target.closest?.('a[href]')))) menu.open = false
    }
  }
  document.addEventListener('click', close)
  root.addEventListener('keydown', close)
  return () => {
    cleanupMore(); observer.disconnect(); changes.disconnect(); routeChanges.disconnect(); root.removeEventListener('scroll', updateOverflow, true)
    root.removeEventListener('focusin', revealFocusedLink)
    document.removeEventListener('click', close); root.removeEventListener('keydown', close)
  }
}
