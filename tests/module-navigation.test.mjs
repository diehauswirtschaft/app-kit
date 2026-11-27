import assert from 'node:assert/strict'
import test from 'node:test'
import { cleanLegacyPortalEntry, guardHeaderExit, localNavLinks, moduleHomeHref, requirePortalHref } from '../src/app_kit/assets/navigation.js'

const items = ['/', '/meine', '/meine/detail', '/meine-alt', '//invalid.test', '/%2e', '/./test'].map(href => ({ label: href, href }))
test('one active area, path boundaries and only same-origin destinations', () => {
  const active = path => localNavLinks(items, path).filter(link => link.current).map(({ href, current }) => [href, current])
  assert.deepEqual(active('/meine/detail/123'), [['/meine/detail', 'location']])
  assert.deepEqual(active('/meine-alt'), [['/meine-alt', 'page']])
  assert.deepEqual(active('/meine-andere'), [])
  assert.equal(localNavLinks(items).length, 4)
  assert.equal(localNavLinks(items, '/', 2).length, 2)
})

test('module titles link to their local entry; standalone apps link to root', () => {
  assert.equal(moduleHomeHref('/wifi'), '/wifi')
  assert.equal(moduleHomeHref(), '/')
  assert.equal(moduleHomeHref('//example.invalid'), '/')
  assert.equal(moduleHomeHref('/wifi/../profil'), '/')
})

test('deployment configuration is explicit and legacy entry changes no destination', () => {
  assert.throws(() => requirePortalHref())
  assert.throws(() => requirePortalHref('https://example.invalid'))
  assert.equal(requirePortalHref('staging'), 'https://start-staging.dhw.wien/')
  const state = {}
  cleanLegacyPortalEntry({ href: 'https://app.example/?q=test&entry=start#here' }, {
    state, replaceState(actual, _, url) { assert.equal(actual, state); assert.equal(url.href, 'https://app.example/?q=test#here') },
  })
})

test('a denied or blocked exit is stopped before the link or logout handler', () => {
  let calls = 0
  const event = { preventDefault() { calls++ }, stopImmediatePropagation() { calls++ } }
  assert.equal(guardHeaderExit(event, { mode: 'block', message: 'Aufnahme läuft' }, () => assert.fail()), false)
  assert.equal(guardHeaderExit(event, { mode: 'confirm', message: 'Entwurf verwerfen?' }, () => false), false)
  assert.equal(guardHeaderExit(event, { mode: 'confirm', message: 'Entwurf verwerfen?' }, () => true), true)
  assert.equal(calls, 4)
})
