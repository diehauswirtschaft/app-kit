/**
 * Real RSA-2048 signatures and authenticated JWE sessions; provider transport
 * alone is synthetic. Mirrors tests/test_oidc.py and tests/test_session_store.py.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHash, randomBytes } from 'node:crypto'
import { chmodSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SignJWT, exportJWK, generateKeyPair } from 'jose'

import { AuthError, AuthUnavailable, OIDC, erpPictureUrl } from '../node/oidc.js'
import { UnsafeSecret, readSecret } from '../node/secrets.js'

class MemorySessionStore {
  constructor() {
    this.logins = new Map()
    this.sessions = new Map()
  }

  _key(scope, key) {
    return `${scope}\0${key}`
  }

  _put(map, scope, key, value, now, limit) {
    for (const [k, row] of map.entries()) {
      const deadline = Math.min(row.expires, row.absolute ?? row.expires)
      if (deadline <= now) map.delete(k)
    }
    let count = 0
    for (const k of map.keys()) {
      if (k.startsWith(`${scope}\0`)) count++
    }
    if (count >= limit) return false
    const composite = this._key(scope, key)
    if (map.has(composite)) throw new Error('Duplicate key')
    map.set(composite, value)
    return true
  }

  async putLogin(scope, key, state, { now, limit }) {
    return this._put(this.logins, scope, key, state, now, limit)
  }

  async consumeLogin(scope, key) {
    const composite = this._key(scope, key)
    const row = this.logins.get(composite) ?? null
    this.logins.delete(composite)
    return row
  }

  async putSession(scope, key, session, { now, limit }) {
    return this._put(this.sessions, scope, key, session, now, limit)
  }

  async getSession(scope, key) {
    return this.sessions.get(this._key(scope, key)) ?? null
  }

  async replaceSession(scope, key, expectedRevision, session) {
    const composite = this._key(scope, key)
    const row = this.sessions.get(composite)
    if (!row || row.revision !== expectedRevision) return false
    this.sessions.set(composite, session)
    return true
  }

  async deleteSession(scope, key, { expectedRevision } = {}) {
    const composite = this._key(scope, key)
    const row = this.sessions.get(composite)
    if (row && (expectedRevision === undefined || row.revision === expectedRevision)) {
      this.sessions.delete(composite)
    }
  }
}

async function createProvider() {
  const { publicKey, privateKey } = await generateKeyPair('RS256', { extractable: true })
  const publicJwk = { ...(await exportJWK(publicKey)), kid: 'runtime-key' }
  const privateJwk = { ...(await exportJWK(privateKey)), kid: 'runtime-key' }

  const state = {
    now: Math.floor(Date.now() / 1000),
    issuer: 'https://identity.example/realms/test',
    privateKey,
    publicJwk,
    privateJwk,
    accessChanges: {},
    idChanges: {},
    nonce: null,
    challenge: null,
    omitNonce: false,
    refreshes: 0,
    jwksKeys: null,
    onRefreshEntered: null,
    pauseRefresh: null,
  }

  async function sign(claims, { key = state.privateKey, kid = state.publicJwk.kid, alg = 'RS256' } = {}) {
    return new SignJWT(claims).setProtectedHeader({ alg, kid }).sign(key)
  }

  function atHash(accessToken) {
    const digest = createHash('sha256').update(accessToken, 'ascii').digest()
    return digest.subarray(0, digest.length / 2).toString('base64url')
  }

  async function issueTokens() {
    const base = {
      iss: state.issuer,
      sub: 'synthetic-subject',
      iat: Math.floor(state.now),
      exp: Math.floor(state.now) + 300,
      aud: 'fixture-web',
    }
    const access = await sign({
      ...base,
      azp: 'fixture-web',
      typ: 'Bearer',
      realm_access: { roles: ['dhw-member-role'] },
      ...state.accessChanges,
    })
    const idClaims = {
      ...base,
      nonce: state.nonce,
      name: 'Synthetic identity',
      at_hash: atHash(access),
      realm_access: { roles: ['dhw-admin-role'] },
      ...state.idChanges,
    }
    if (state.omitNonce) delete idClaims.nonce
    const idToken = await sign(idClaims)
    return {
      access_token: access,
      id_token: idToken,
      refresh_token: randomBytes(32).toString('base64url'),
      token_type: 'Bearer',
      expires_in: 300,
    }
  }

  async function fetch(url, init = {}) {
    const parsed = new URL(url)
    if (parsed.pathname.endsWith('/.well-known/openid-configuration')) {
      return Response.json({
        issuer: state.issuer,
        authorization_endpoint: `${state.issuer}/auth`,
        token_endpoint: `${state.issuer}/token`,
        jwks_uri: `${state.issuer}/keys`,
      })
    }
    if (parsed.pathname.endsWith('/keys')) {
      return Response.json({
        keys: state.jwksKeys !== null ? state.jwksKeys : [state.publicJwk],
      })
    }
    if (parsed.pathname.endsWith('/token')) {
      const params = new URLSearchParams(String(init.body ?? ''))
      if (params.get('grant_type') === 'refresh_token') {
        state.refreshes++
        if (state.onRefreshEntered) state.onRefreshEntered()
        if (state.pauseRefresh) await state.pauseRefresh
      } else {
        const verifier = params.get('code_verifier') ?? ''
        const challenge = createHash('sha256').update(verifier, 'ascii').digest('base64url')
        if (challenge !== state.challenge) {
          return new Response('bad verifier', { status: 400 })
        }
      }
      return Response.json(await issueTokens())
    }
    return new Response('not found', { status: 404 })
  }

  async function rotateKey() {
    const next = await generateKeyPair('RS256', { extractable: true })
    state.privateKey = next.privateKey
    state.publicJwk = { ...(await exportJWK(next.publicKey)), kid: 'rotated-runtime-key' }
    state.privateJwk = { ...(await exportJWK(next.privateKey)), kid: 'rotated-runtime-key' }
  }

  return { state, sign, fetch, rotateKey }
}

function makeFixture(provider, store = new MemorySessionStore()) {
  const dir = mkdtempSync(join(tmpdir(), 'app-kit-oidc-'))
  const clientSecretFile = join(dir, 'client-secret')
  const sessionKeyFile = join(dir, 'session-key')
  writeFileSync(clientSecretFile, randomBytes(32).toString('base64url'), { mode: 0o600 })
  writeFileSync(sessionKeyFile, randomBytes(32).toString('base64url'), { mode: 0o600 })
  chmodSync(clientSecretFile, 0o600)
  chmodSync(sessionKeyFile, 0o600)

  const settings = {
    issuer: provider.state.issuer,
    clientId: 'fixture-web',
    audience: 'fixture-web',
    origin: 'https://app.example',
    clientSecretFile,
    sessionKeyFile,
    admissionRoles: ['dhw-member-role'],
  }
  const auth = new OIDC(settings, {
    store,
    fetch: provider.fetch,
    clock: () => provider.state.now,
  })
  return {
    auth,
    settings,
    store,
    dir,
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  }
}

function makeRequest(path = '/', { cookie = '', headers = {} } = {}) {
  const h = new Headers(headers)
  if (cookie) h.set('cookie', cookie)
  return new Request(`https://app.example${path}`, { headers: h })
}

async function signIn(auth, provider) {
  const login = await auth.login()
  const authUrl = new URL(login.location)
  assert.equal(authUrl.searchParams.get('code_challenge_method'), 'S256')
  provider.state.nonce = authUrl.searchParams.get('nonce')
  provider.state.challenge = authUrl.searchParams.get('code_challenge')
  const bindingCookie = login.setCookie.split(';')[0]
  const callbackPath = `/auth/callback?state=${authUrl.searchParams.get('state')}&code=${randomBytes(18).toString('base64url')}`
  const result = await auth.callback(makeRequest(callbackPath, { cookie: bindingCookie }))
  const sessionCookie = result.setCookies
    .find((item) => item.startsWith(`${auth.settings.cookieName}=`))
    .split(';')[0]
  return { sessionCookie, callbackPath, bindingCookie, csrf: result.csrf }
}

test('full code flow: opaque cookie, access-token roles only, encrypted store, no replay', async (t) => {
  const provider = await createProvider()
  const fx = makeFixture(provider)
  t.after(fx.cleanup)

  const { sessionCookie, callbackPath, bindingCookie } = await signIn(fx.auth, provider)
  const sid = sessionCookie.split('=', 2)[1]
  assert.equal(sid.length, 43)
  assert.ok(!sid.includes('.'))

  const session = await fx.auth.authenticate(makeRequest('/', { cookie: sessionCookie }))
  assert.ok(session)
  assert.deepEqual([...session.identity.roles], ['dhw-member-role'])

  const stored = await fx.store.getSession(fx.auth.scope, OIDC.digest(sid))
  const raw = Buffer.from(stored.payload).toString('utf8')
  assert.ok(!raw.includes('access_token'))
  assert.ok(!raw.includes('synthetic-subject'))

  // Single-use login state: replaying callback fails closed.
  await assert.rejects(
    () => fx.auth.callback(makeRequest(callbackPath, { cookie: bindingCookie })),
    AuthError,
  )
})

test('mixed public JWKS uses signature key and rejects encryption kid for JWT verification', async (t) => {
  const provider = await createProvider()
  const fx = makeFixture(provider)
  t.after(fx.cleanup)

  provider.state.jwksKeys = [
    { ...provider.state.publicJwk, kid: 'encryption-key', use: 'enc', alg: 'RSA-OAEP' },
    { ...provider.state.publicJwk, use: 'sig', alg: 'RS256', key_ops: ['verify'] },
  ]
  const { sessionCookie } = await signIn(fx.auth, provider)
  const session = await fx.auth.authenticate(makeRequest('/', { cookie: sessionCookie }))
  assert.deepEqual([...session.identity.roles], ['dhw-member-role'])

  const token = await provider.sign(
    {
      iss: provider.state.issuer,
      sub: 'synthetic-subject',
      iat: provider.state.now,
      exp: provider.state.now + 60,
      aud: 'fixture-web',
      azp: 'fixture-web',
      typ: 'Bearer',
    },
    { kid: 'encryption-key' },
  )
  await assert.rejects(
    () => fx.auth.verifyClaims(token, { audience: 'fixture-web', access: true }),
    AuthError,
  )
})

test('JWKS rejects unusable, ambiguous or private key sets', async (t) => {
  const provider = await createProvider()
  const fx = makeFixture(provider)
  t.after(fx.cleanup)

  const cases = [
    [{ ...provider.state.publicJwk, use: 'enc', alg: 'RSA-OAEP' }],
    [provider.state.publicJwk, provider.state.publicJwk],
    [provider.state.privateJwk],
    [null, provider.state.publicJwk],
    [{ ...provider.state.publicJwk, key_ops: ['encrypt'] }],
    [{ ...provider.state.publicJwk, alg: 'PS256' }],
  ]
  for (const jwksKeys of cases) {
    provider.state.jwksKeys = jwksKeys
    await assert.rejects(() => fx.auth.provider(true), AuthUnavailable)
  }
})

test('negative access-token and ID-token claims are rejected', async (t) => {
  const accessNegatives = [
    { iss: 'https://foreign.example' },
    { aud: 'foreign' },
    { azp: 'foreign' },
    { typ: 'ID' },
    { exp: 1 },
    { nbf: 9999999999 },
    { iat: 9999999999 },
    { sub: null },
    { realm_access: { roles: 'dhw-member-role' } },
  ]
  for (const accessChanges of accessNegatives) {
    const provider = await createProvider()
    const fx = makeFixture(provider)
    provider.state.accessChanges = accessChanges
    await assert.rejects(() => signIn(fx.auth, provider), AuthError)
    fx.cleanup()
  }

  for (const idChanges of [{ nonce: 'wrong' }, { sub: 'foreign' }, { aud: 'foreign' }, { at_hash: 'bad' }]) {
    const provider = await createProvider()
    const fx = makeFixture(provider)
    provider.state.idChanges = idChanges
    await assert.rejects(() => signIn(fx.auth, provider), AuthError)
    fx.cleanup()
  }
})

test('refresh updates roles, revokes on role loss or subject change, checks optional nonce', async (t) => {
  const provider = await createProvider()
  const fx = makeFixture(provider)
  t.after(fx.cleanup)

  const { sessionCookie } = await signIn(fx.auth, provider)
  provider.state.now += 301
  provider.state.omitNonce = true
  provider.state.accessChanges = { realm_access: { roles: ['dhw-member-role', 'fixture-lk'] } }
  const refreshed = await fx.auth.authenticate(makeRequest('/', { cookie: sessionCookie }))
  assert.ok(refreshed.identity.roles.has('fixture-lk'))
  assert.equal(provider.state.refreshes, 1)

  provider.state.now += 301
  provider.state.omitNonce = false
  provider.state.idChanges = { nonce: 'wrong' }
  assert.equal(await fx.auth.authenticate(makeRequest('/', { cookie: sessionCookie })), null)

  // Role revocation invalidates session.
  provider.state.idChanges = {}
  provider.state.accessChanges = {}
  const second = await signIn(fx.auth, provider)
  provider.state.now += 301
  provider.state.accessChanges = { realm_access: { roles: [] } }
  assert.equal(await fx.auth.authenticate(makeRequest('/', { cookie: second.sessionCookie })), null)
  assert.equal(await fx.auth.authenticate(makeRequest('/', { cookie: second.sessionCookie })), null)
})

test('concurrent refresh across two workers rotates only once and logout wins during refresh', async (t) => {
  const provider = await createProvider()
  const fx = makeFixture(provider)
  t.after(fx.cleanup)

  const { sessionCookie } = await signIn(fx.auth, provider)
  const otherWorker = new OIDC(fx.settings, {
    store: fx.store,
    fetch: provider.fetch,
    clock: () => provider.state.now,
  })
  provider.state.now += 301
  const [a, b] = await Promise.all([
    fx.auth.authenticate(makeRequest('/', { cookie: sessionCookie })),
    otherWorker.authenticate(makeRequest('/', { cookie: sessionCookie })),
  ])
  assert.ok(a && b)
  assert.equal(provider.state.refreshes, 1)

  // Logout during in-flight refresh prevents session revival.
  let entered
  const enteredPromise = new Promise((resolve) => {
    entered = resolve
  })
  let resume
  provider.state.onRefreshEntered = entered
  provider.state.pauseRefresh = new Promise((resolve) => {
    resume = resolve
  })
  provider.state.now += 301

  const inFlight = fx.auth.authenticate(makeRequest('/', { cookie: sessionCookie }))
  await enteredPromise
  const logoutReq = makeRequest('/auth/logout', {
    cookie: sessionCookie,
    headers: { origin: 'https://app.example' },
  })
  await assert.rejects(
    () => fx.auth.logout(logoutReq, { csrfToken: 'wrong', expectedCsrf: a.csrf }),
    AuthError,
  )
  const logoutRes = await fx.auth.logoutResponse(logoutReq, {
    csrfToken: a.csrf,
    expectedCsrf: a.csrf,
  })
  assert.equal(logoutRes.status, 204)
  resume()
  assert.equal(await inFlight, null)
  assert.equal(await fx.auth.authenticate(makeRequest('/', { cookie: sessionCookie })), null)
})

test('service allowlist, audience, key rollover and unsigned token rejection', async (t) => {
  const provider = await createProvider()
  const fx = makeFixture(provider)
  t.after(fx.cleanup)

  await fx.auth.provider()
  await provider.rotateKey()

  const token = await provider.sign({
    iss: provider.state.issuer,
    sub: 'service',
    iat: provider.state.now,
    exp: provider.state.now + 60,
    typ: 'Bearer',
    azp: 'fixture-reader',
    aud: 'fixture-api',
    scope: 'protocols:read',
  })
  const accepted = await fx.auth.verifyClaims(token, {
    audience: 'fixture-api',
    access: true,
    allowedClients: ['fixture-reader'],
  })
  assert.equal(accepted.sub, 'service')

  await assert.rejects(
    () => fx.auth.verifyClaims(token, { audience: 'fixture-api', access: true, allowedClients: [] }),
    AuthError,
  )
  await assert.rejects(
    () => fx.auth.verifyClaims(token, { audience: 'fixture-web', access: true }),
    AuthError,
  )
  await assert.rejects(
    () =>
      fx.auth.verifyClaims('eyJhbGciOiJub25lIn0.e30.', {
        audience: 'fixture-api',
        access: true,
        allowedClients: ['fixture-reader'],
      }),
    AuthError,
  )
})

test('readSecret rejects symlinks, group/world readable files and missing store fails closed', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'app-kit-sec-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))

  const secretPath = join(dir, 'secret')
  writeFileSync(secretPath, 'valid-secret-value\n', { mode: 0o600 })
  chmodSync(secretPath, 0o600)
  assert.equal(readSecret(secretPath), 'valid-secret-value')

  chmodSync(secretPath, 0o644)
  assert.throws(() => readSecret(secretPath), UnsafeSecret)

  chmodSync(secretPath, 0o600)
  const linkPath = join(dir, 'link')
  symlinkSync(secretPath, linkPath)
  assert.throws(() => readSecret(linkPath), UnsafeSecret)

  assert.equal(erpPictureUrl('https://erp.diehauswirtschaft.at/files/avatar.jpg'), 'https://erp.diehauswirtschaft.at/files/avatar.jpg')
  assert.equal(erpPictureUrl('https://erp.diehauswirtschaft.at/api/secret'), null)
  assert.equal(erpPictureUrl('https://evil.example/files/avatar.jpg'), null)

  assert.throws(
    () =>
      new OIDC(
        {
          issuer: 'https://identity.example/realms/test',
          clientId: 'fixture-web',
          audience: 'fixture-web',
          origin: 'https://app.example',
          clientSecretFile: secretPath,
          sessionKeyFile: secretPath,
          admissionRoles: ['dhw-member-role'],
        },
        {},
      ),
    TypeError,
  )
})

test('idle expiry, failed refresh claim isolation, callback validation and cross-site CSRF rejection', async (t) => {
  const provider = await createProvider()
  const fx = makeFixture(provider)
  t.after(fx.cleanup)

  // Idle expiry is not extended.
  const first = await signIn(fx.auth, provider)
  provider.state.now += fx.auth.settings.idleSeconds
  assert.equal(await fx.auth.authenticate(makeRequest('/', { cookie: first.sessionCookie })), null)
  assert.equal(provider.state.refreshes, 0)

  // Callback rejects unknown/duplicated parameters and foreign iss.
  const login = await fx.auth.login()
  const state = new URL(login.location).searchParams.get('state')
  const binding = login.setCookie.split(';')[0]
  for (const badPath of [
    `/auth/callback?state=${state}&code=abc&extra=1`,
    `/auth/callback?state=${state}&code=a&code=b`,
    `/auth/callback?state=${state}&code=abc&iss=https://evil.example`,
  ]) {
    await assert.rejects(() => fx.auth.callback(makeRequest(badPath, { cookie: binding })), AuthError)
  }

  // CSRF rejects cross-site Sec-Fetch-Site even with matching token.
  const crossSite = makeRequest('/auth/logout', {
    headers: { origin: 'https://app.example', 'sec-fetch-site': 'cross-site' },
  })
  assert.throws(() => fx.auth.requireCsrf(crossSite, first.csrf, first.csrf), AuthError)

  // Failed refresh deletes the pending claim and never restores the old token.
  const second = await signIn(fx.auth, provider)
  provider.state.now += 301
  provider.state.accessChanges = { sub: 'different-subject' }
  assert.equal(await fx.auth.authenticate(makeRequest('/', { cookie: second.sessionCookie })), null)
  const sid = second.sessionCookie.split('=', 2)[1]
  assert.equal(await fx.store.getSession(fx.auth.scope, OIDC.digest(sid)), null)
})

test('Keycloak 1-client template enforces AP-01 defaults without embedded secrets', () => {
  const template = JSON.parse(
    readFileSync(new URL('../deploy/keycloak-web-client.template.json', import.meta.url), 'utf8'),
  )
  assert.equal(template.publicClient, false)
  assert.equal(template.standardFlowEnabled, true)
  assert.equal(template.implicitFlowEnabled, false)
  assert.equal(template.directAccessGrantsEnabled, false)
  assert.equal(template.serviceAccountsEnabled, false)
  assert.equal(template.fullScopeAllowed, false)
  assert.equal(template.attributes['pkce.code.challenge.method'], 'S256')
  assert.deepEqual(template.defaultClientScopes, ['basic', 'profile', 'roles'])
  assert.equal(template.protocolMappers[0].config['included.client.audience'], template.clientId)
  assert.equal(template.protocolMappers[0].config['access.token.claim'], 'true')
  assert.equal(template.protocolMappers[0].config['id.token.claim'], 'false')
  assert.ok(!('secret' in template))
})
