import { cleanLegacyPortalEntry, guardHeaderExit, installHeaderInteractions } from './navigation.js'

let dirty = false
const header = document.querySelector('.dhw-header')
if (header) {
  cleanLegacyPortalEntry(window.location, window.history)
  installHeaderInteractions(header)
  const { dhwGuardMode: mode, dhwGuardMessage: message } = header.dataset
  if (mode === 'block' || mode === 'confirm') {
    const guard = { mode, message }
    // Run before the document's dirty-editor handler; a rejected Kit exit must
    // never reach the logout form or the app's ordinary navigation (AP-02).
    const kitGuard = event => {
      if (guardHeaderExit(event, guard) && dirty && event.type === 'submit') dirty = false
    }
    document.addEventListener('click', event => {
      if (header.contains(event.target) && event.target.closest?.('a[href], a[role="link"]') &&
          (mode === 'block' || (!dirty && !event.ctrlKey && !event.metaKey && !event.shiftKey && !event.altKey))) kitGuard(event)
    }, true)
    document.addEventListener('submit', event => {
      if (header.contains(event.target) && (mode === 'block' || !dirty)) kitGuard(event)
    }, true)
  }
}

// AP-02: replacing the old links must not discard unsubmitted protocol text.
// The marker is present only on editor forms, never on logout/publication.
for (const form of document.querySelectorAll('form[data-dhw-dirty]')) {
  form.addEventListener('input', () => { dirty = true })
  form.addEventListener('submit', () => { dirty = false })
}
document.addEventListener('submit', event => {
  if (!dirty || event.target.matches('form[data-dhw-dirty]')) return
  if (!window.confirm('Ungespeicherte Änderungen verwerfen und diese Seite verlassen?')) {
    event.preventDefault(); event.stopImmediatePropagation()
  } else dirty = false
}, true)
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
