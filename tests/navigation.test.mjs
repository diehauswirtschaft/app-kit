import { test } from 'node:test'
import assert from 'node:assert/strict'
import { portalHref, entryForOrigin, capturePortalEntry, initials } from '../src/app_kit/assets/navigation.js'
function storage() {
  const data = new Map()
  return { getItem: key => data.get(key), setItem: (key, value) => data.set(key, value), removeItem: key => data.delete(key), data }
}
test('only fixed portal destinations, never arbitrary return URLs', () => {
  assert.equal(portalHref('start'), 'https://start.dhw.wien/')
  assert.equal(portalHref('staging'), 'https://start-staging.dhw.wien/')
  for (const value of ['https://attacker.test/', '//attacker.test', 'Start', '__proto__', '', null]) assert.equal(portalHref(value), null)
  assert.equal(entryForOrigin('https://start.dhw.wien'), 'start')
  assert.equal(entryForOrigin('https://start-staging.dhw.wien/'), 'staging')
  assert.equal(entryForOrigin('https://start.dhw.wien.attacker.test'), null)
})
test('only a UI word survives the IdP roundtrip in this tab', () => {
  const tab = storage()
  assert.equal(capturePortalEntry(new URL('https://app.example/?entry=start'), tab), 'https://start.dhw.wien/')
  assert.deepEqual([...tab.data.values()], ['start'])
  assert.equal(capturePortalEntry(new URL('https://app.example/auth/callback'), tab), 'https://start.dhw.wien/')
  assert.equal(capturePortalEntry(new URL('https://app.example/'), storage()), null)
  assert.equal(capturePortalEntry(new URL('https://app.example/?entry=start&entry=staging'), tab), null)
  assert.equal(tab.data.size, 0)
})
test('storage-disabled browsers keep authentication independent', () => {
  const blocked = { getItem() { throw Error('unavailable') }, setItem() { throw Error('unavailable') } }
  assert.equal(capturePortalEntry(new URL('https://app.example/?entry=start'), blocked), 'https://start.dhw.wien/')
  assert.equal(capturePortalEntry(new URL('https://app.example/'), blocked), null)
  assert.equal(initials('Erika Musterfrau'), 'EM')
})
