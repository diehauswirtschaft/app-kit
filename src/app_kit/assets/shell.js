import { capturePortalEntry, installHeaderInteractions } from './navigation.js'

const header = document.querySelector('.dhw-header')
if (header) {
  let storage = null
  try { storage = window.sessionStorage } catch { /* UI preference unavailable, not an auth failure. */ }
  const url = new URL(window.location.href)
  const target = capturePortalEntry(url, storage)
  if (url.searchParams.has('entry')) {
    url.searchParams.delete('entry')
    window.history.replaceState(window.history.state, '', url)
  }
  const back = header.querySelector('[data-dhw-portal-back]')
  if (back && target) { back.href = target; back.hidden = false }
  installHeaderInteractions(header)
}

// AP-02: replacing the old links must not discard unsubmitted protocol text.
// The marker is present only on editor forms, never on logout/publication.
let dirty = false
for (const form of document.querySelectorAll('form[data-dhw-dirty]')) {
  form.addEventListener('input', () => { dirty = true })
  form.addEventListener('submit', () => { dirty = false })
}
window.addEventListener('beforeunload', event => {
  if (dirty) { event.preventDefault(); event.returnValue = '' }
})
document.addEventListener('click', event => {
  const link = event.target.closest?.('a[href]')
  if (!dirty || !link || link.target === '_blank' || event.ctrlKey || event.metaKey || event.shiftKey || link.getAttribute('href').startsWith('#')) return
  if (!window.confirm('Ungespeicherte Änderungen verwerfen und diese Seite verlassen?')) {
    event.preventDefault(); event.stopImmediatePropagation()
  } else dirty = false
}, true)
