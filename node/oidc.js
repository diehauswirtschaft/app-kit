/**
 * AP-01: confidential Keycloak OAuth/OIDC client, bounded discovery/JWKS and
 * encrypted server-side sessions for Node/SvelteKit backends.
 *
 * Only opaque host-bound cookies cross the browser boundary. Roles are read
 * exclusively from validated access tokens, never from ID tokens, UserInfo or
 * request headers. Session persistence is owned by the consuming application
 * via an explicit SessionStore implementation (no database dependency here).
 */

import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import { CompactEncrypt, compactDecrypt, decodeProtectedHeader, importJWK, jwtVerify } from 'jose'
import { readSecret } from './secrets.js'

const OPAQUE_TOKEN_RE = /^[A-Za-z0-9_-]{43}$/
const SESSION_KEY_RE = /^[A-Za-z0-9_-]{43}=?$/
const MAX_JSON_BYTES = 131072
const MAX_TOKEN_LENGTH = 32768
const PRIVATE_JWK_FIELDS = ['d', 'p', 'q', 'dp', 'dq', 'qi', 'oth', 'k']
const FORBIDDEN_JWT_HEADERS = ['jku', 'jwk', 'x5u', 'crit']
const ALLOWED_CALLBACK_PARAMS = new Set(['code', 'state', 'session_state', 'iss'])
const encoder = new TextEncoder()
const decoder = new TextDecoder()

export class AuthError extends Error {
  /** Safe public error; upstream messages or tokens must never become exception text. */
  constructor(message) {
    super(message)
    this.name = 'AuthError'
  }
}

export class AuthUnavailable extends AuthError {
  constructor(message) {
    super(message)
    this.name = 'AuthUnavailable'
  }
}

function sha256Hex(value) {
  return createHash('sha256').update(value, 'utf8').digest('hex')
}

function safeEqualString(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false
  const digestA = createHash('sha256').update(a, 'utf8').digest()
  const digestB = createHash('sha256').update(b, 'utf8').digest()
  return timingSafeEqual(digestA, digestB) && a.length === b.length
}

function randomToken() {
  return randomBytes(32).toString('base64url')
}

function pkceChallenge(verifier) {
  return createHash('sha256').update(verifier, 'ascii').digest('base64url')
}

function expectedAtHash(accessToken) {
  // OIDC Core §3.1.3.6: left half of SHA-256 hash of ASCII access token for RS256.
  const digest = createHash('sha256').update(accessToken, 'ascii').digest()
  return digest.subarray(0, digest.length / 2).toString('base64url')
}

function parseCookies(cookieHeader) {
  const cookies = new Map()
  if (typeof cookieHeader !== 'string' || !cookieHeader) return cookies
  for (const part of cookieHeader.split(';')) {
    const eq = part.indexOf('=')
    if (eq <= 0) continue
    const name = part.slice(0, eq).trim()
    const value = part.slice(eq + 1).trim()
    if (name && !cookies.has(name)) {
      cookies.set(name, value)
    }
  }
  return cookies
}

function serializeCookie(name, value, { maxAge }) {
  // ASI-006: host-bound (__Host-), Secure, HttpOnly, SameSite=Lax, Path=/, never Domain=.
  return `${name}=${value}; Path=/; Max-Age=${maxAge}; HttpOnly; Secure; SameSite=Lax`
}

function deleteCookie(name) {
  return `${name}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax`
}

function extractHeader(request, name) {
  if (!request) return ''
  if (typeof request.headers?.get === 'function') {
    return request.headers.get(name) ?? ''
  }
  const lower = name.toLowerCase()
  const headers = request.headers ?? {}
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === lower) {
      return Array.isArray(value) ? (value[0] ?? '') : String(value ?? '')
    }
  }
  return ''
}

function extractUrl(request) {
  if (request?.url instanceof URL) return request.url
  if (typeof request?.url === 'string') return new URL(request.url)
  throw new AuthError('Invalid callback')
}

function parseHttpsUrl(value, { originOnly }) {
  if (typeof value !== 'string' || !value || value.endsWith('/')) {
    throw new Error('Explicit HTTPS OIDC URLs required')
  }
  let parsed
  try {
    parsed = new URL(value)
  } catch {
    throw new Error('Explicit HTTPS OIDC URLs required')
  }
  if (
    parsed.protocol !== 'https:' ||
    !parsed.hostname ||
    parsed.username ||
    parsed.password ||
    parsed.search ||
    parsed.hash ||
    (originOnly && parsed.pathname !== '/')
  ) {
    throw new Error('Explicit HTTPS OIDC URLs required')
  }
  return parsed
}

/**
 * Validate an ERP avatar URL claim from a verified access token.
 * Mirrors src/app_kit/avatar.py:erp_picture_url (AP-01).
 * @param {unknown} claim
 * @returns {string | null}
 */
export function erpPictureUrl(claim) {
  if (typeof claim !== 'string' || claim.length > 2048 || /[\x00-\x20\x7f\\?#]/.test(claim)) {
    return null
  }
  let parsed
  try {
    parsed = new URL(claim)
  } catch {
    return null
  }
  if (parsed.protocol !== 'https:' || parsed.host !== 'erp.diehauswirtschaft.at') return null
  if (!/^\/files\/[^/]+$/.test(parsed.pathname)) return null
  let decoded
  try {
    decoded = decodeURIComponent(parsed.pathname.slice('/files/'.length))
  } catch {
    return null
  }
  // A signed claim is not an outbound allowlist; reject path traversal or encoded separators.
  if (decoded === '.' || decoded === '..' || /[/\\%?#\x00-\x1f\x7f]/.test(decoded)) {
    return null
  }
  return claim
}

/**
 * Validate OIDC policy fail-closed at startup (ASI-023, AP-01).
 * @param {import('./oidc.d.ts').OIDCSettings} settings
 */
export function validateSettings(settings) {
  if (!settings || typeof settings !== 'object') {
    throw new Error('Invalid OIDC policy')
  }
  parseHttpsUrl(settings.issuer, { originOnly: false })
  parseHttpsUrl(settings.origin, { originOnly: true })
  const cookieName = settings.cookieName ?? '__Host-dhw-session'
  const idleSeconds = settings.idleSeconds ?? 1800
  const absoluteSeconds = settings.absoluteSeconds ?? 28800
  const admissionRoles = [...(settings.admissionRoles ?? [])].filter(
    (role) => typeof role === 'string' && role.length > 0,
  )
  if (
    typeof settings.clientId !== 'string' ||
    !settings.clientId ||
    typeof settings.audience !== 'string' ||
    !settings.audience ||
    admissionRoles.length === 0 ||
    typeof cookieName !== 'string' ||
    !cookieName.startsWith('__Host-') ||
    !Number.isInteger(idleSeconds) ||
    !Number.isInteger(absoluteSeconds) ||
    idleSeconds < 60 ||
    idleSeconds > absoluteSeconds ||
    absoluteSeconds > 86400
  ) {
    throw new Error('Invalid OIDC policy')
  }
  return Object.freeze({
    issuer: settings.issuer,
    clientId: settings.clientId,
    audience: settings.audience,
    origin: settings.origin,
    clientSecretFile: settings.clientSecretFile,
    sessionKeyFile: settings.sessionKeyFile,
    admissionRoles: new Set(admissionRoles),
    cookieName,
    idleSeconds,
    absoluteSeconds,
  })
}

function decodeSessionKey(encoded) {
  if (typeof encoded !== 'string' || !SESSION_KEY_RE.test(encoded)) {
    throw new Error('Session key must be a 32-byte base64url secret')
  }
  const bytes = Buffer.from(encoded, 'base64url')
  if (bytes.length !== 32) {
    throw new Error('Session key must be a 32-byte base64url secret')
  }
  return new Uint8Array(bytes)
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export class OIDC {
  /**
   * @param {import('./oidc.d.ts').OIDCSettings} settings
   * @param {import('./oidc.d.ts').OIDCOptions} options
   */
  constructor(settings, options) {
    this.settings = validateSettings(settings)
    if (!options?.store || typeof options.store !== 'object') {
      // AP-01: never pick an implicit default store; the app owns persistence.
      throw new TypeError('An explicit SessionStore implementation is required')
    }
    this.store = options.store
    this.fetch = options.fetch ?? globalThis.fetch
    this.clock = options.clock ?? (() => Date.now() / 1000)
    this.clientSecret = readSecret(this.settings.clientSecretFile)
    const rawSessionKey = readSecret(this.settings.sessionKeyFile)
    if (safeEqualString(rawSessionKey, this.clientSecret)) {
      throw new Error('Independent session key required')
    }
    this._sessionKey = decodeSessionKey(rawSessionKey)
    this.scope = OIDC.digest(
      `${this.settings.issuer}|${this.settings.clientId}|${this.settings.origin}`,
    )
    this._cache = null
    this._cacheUntil = 0
    this._rotationAfter = 0
    this._providerInFlight = null
  }

  static digest(value) {
    return sha256Hex(value)
  }

  async seal(data) {
    const plaintext = encoder.encode(JSON.stringify(data))
    const compact = await new CompactEncrypt(plaintext)
      .setProtectedHeader({ alg: 'dir', enc: 'A256GCM' })
      .encrypt(this._sessionKey)
    return encoder.encode(compact)
  }

  async unseal(payload) {
    try {
      const compact = payload instanceof Uint8Array ? decoder.decode(payload) : String(payload)
      const { plaintext } = await compactDecrypt(compact, this._sessionKey, {
        keyManagementAlgorithms: ['dir'],
        contentEncryptionAlgorithms: ['A256GCM'],
      })
      const parsed = JSON.parse(decoder.decode(plaintext))
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error('invalid payload')
      }
      return parsed
    } catch {
      throw new AuthError('Invalid server session')
    }
  }

  async _boundedJson(url, init = {}) {
    // AP-01/ASI-023: fixed verified issuer endpoints; never follow redirects.
    const signal = AbortSignal.timeout(8000)
    const response = await this.fetch(url, {
      ...init,
      redirect: 'manual',
      signal,
      headers: {
        'Accept-Encoding': 'identity',
        ...(init.headers ?? {}),
      },
    })
    if (response.status !== 200) {
      throw new AuthUnavailable('Identity provider unavailable')
    }
    let bytes
    if (response.body && typeof response.body.getReader === 'function') {
      const reader = response.body.getReader()
      const chunks = []
      let total = 0
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        total += value.byteLength
        if (total > MAX_JSON_BYTES) {
          await reader.cancel().catch(() => {})
          throw new AuthUnavailable('Identity response too large')
        }
        chunks.push(value)
      }
      bytes = Buffer.concat(chunks, total)
    } else {
      const buffer = new Uint8Array(await response.arrayBuffer())
      if (buffer.byteLength > MAX_JSON_BYTES) {
        throw new AuthUnavailable('Identity response too large')
      }
      bytes = buffer
    }
    let parsed
    try {
      parsed = JSON.parse(decoder.decode(bytes))
    } catch {
      throw new AuthUnavailable('Invalid identity response')
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new AuthUnavailable('Invalid identity response')
    }
    return parsed
  }

  async provider(force = false) {
    if (!force && this._cache !== null && this.clock() < this._cacheUntil) {
      return this._cache
    }
    if (this._providerInFlight) {
      return this._providerInFlight
    }
    const load = (async () => {
      const config = await this._boundedJson(
        `${this.settings.issuer}/.well-known/openid-configuration`,
        { method: 'GET' },
      )
      if (config.issuer !== this.settings.issuer) {
        throw new AuthUnavailable('Issuer mismatch')
      }
      const issuerUrl = new URL(this.settings.issuer)
      for (const name of ['authorization_endpoint', 'token_endpoint', 'jwks_uri']) {
        let endpoint
        try {
          endpoint = new URL(config[name])
        } catch {
          throw new AuthUnavailable('Untrusted OIDC endpoint')
        }
        if (
          endpoint.protocol !== 'https:' ||
          endpoint.host !== issuerUrl.host ||
          endpoint.username ||
          endpoint.password ||
          endpoint.search ||
          endpoint.hash ||
          !endpoint.pathname.startsWith(`${issuerUrl.pathname}/`)
        ) {
          throw new AuthUnavailable('Untrusted OIDC endpoint')
        }
      }
      const jwks = await this._boundedJson(config.jwks_uri, { method: 'GET' })
      const rawKeys = jwks.keys
      if (
        !Array.isArray(rawKeys) ||
        rawKeys.length < 1 ||
        rawKeys.length > 16 ||
        rawKeys.some((key) => !key || typeof key !== 'object' || Array.isArray(key))
      ) {
        throw new AuthUnavailable('Invalid signing keys')
      }
      const seenKids = new Set()
      for (const key of rawKeys) {
        if (typeof key.kid !== 'string' || key.kid.length < 1 || key.kid.length > 256) {
          throw new AuthUnavailable('Invalid signing keys')
        }
        if (seenKids.has(key.kid)) {
          throw new AuthUnavailable('Invalid signing keys')
        }
        seenKids.add(key.kid)
        if (PRIVATE_JWK_FIELDS.some((field) => field in key)) {
          throw new AuthUnavailable('Invalid signing keys')
        }
      }
      // AP-01 / RFC 7517: providers legitimately publish encryption and signing
      // keys together. Import only public RS256 verifier candidates; an
      // encryption kid must never select a JWT verification key.
      const signingKeys = new Map()
      for (const key of rawKeys) {
        const keyOpsOk =
          !('key_ops' in key) ||
          (Array.isArray(key.key_ops) && key.key_ops.length === 1 && key.key_ops[0] === 'verify')
        if (
          key.kty === 'RSA' &&
          (key.use === undefined || key.use === 'sig') &&
          (key.alg === undefined || key.alg === 'RS256') &&
          keyOpsOk
        ) {
          try {
            const imported = await importJWK(key, 'RS256')
            signingKeys.set(key.kid, imported)
          } catch {
            throw new AuthUnavailable('Invalid signing keys')
          }
        }
      }
      if (signingKeys.size === 0) {
        throw new AuthUnavailable('No supported signing keys')
      }
      const result = { config, keys: signingKeys }
      this._cache = result
      this._cacheUntil = this.clock() + 300
      return result
    })()
    this._providerInFlight = load
    try {
      return await load
    } finally {
      if (this._providerInFlight === load) {
        this._providerInFlight = null
      }
    }
  }

  async verifyClaims(
    token,
    {
      audience,
      access = false,
      nonce = null,
      accessToken = null,
      allowedClients = null,
      refresh = false,
    },
  ) {
    if (typeof token !== 'string' || token.length < 1 || token.length > MAX_TOKEN_LENGTH) {
      throw new AuthError('Invalid identity token')
    }
    try {
      const header = decodeProtectedHeader(token)
      if (
        header.alg !== 'RS256' ||
        typeof header.kid !== 'string' ||
        !header.kid ||
        FORBIDDEN_JWT_HEADERS.some((name) => name in header)
      ) {
        throw new AuthError('Unsupported signing header')
      }
      let { keys } = await this.provider()
      let key = keys.get(header.kid)
      if (!key) {
        // Bound forced JWKS refreshes so attacker-chosen kids cannot flood discovery/JWKS.
        if (this.clock() < this._rotationAfter) {
          throw new AuthError('Unknown signing key')
        }
        this._rotationAfter = this.clock() + 30
        ;({ keys } = await this.provider(true))
        key = keys.get(header.kid)
        if (!key) {
          throw new AuthError('Unknown signing key')
        }
      }
      const now = this.clock()
      const { payload } = await jwtVerify(token, key, {
        algorithms: ['RS256'],
        issuer: this.settings.issuer,
        audience,
        clockTolerance: 30,
        currentDate: new Date(now * 1000),
      })
      for (const field of ['exp', 'iat', 'nbf']) {
        if (field in payload && (typeof payload[field] !== 'number' || !Number.isFinite(payload[field]))) {
          throw new AuthError('Invalid token time')
        }
      }
      if (
        typeof payload.exp !== 'number' ||
        typeof payload.iat !== 'number' ||
        payload.iat > now + 30 ||
        payload.exp <= payload.iat ||
        typeof payload.sub !== 'string' ||
        payload.sub.length < 1 ||
        payload.sub.length > 255
      ) {
        throw new AuthError('Invalid token claims')
      }
      if (access) {
        // AP-01: ID tokens must never be accepted as role-bearing access tokens.
        const permittedClients =
          allowedClients !== null ? new Set(allowedClients) : new Set([this.settings.clientId])
        if (typeof payload.azp !== 'string' || !permittedClients.has(payload.azp) || payload.typ !== 'Bearer') {
          throw new AuthError('Invalid access-token purpose')
        }
        const realmAccess = payload.realm_access
        if (realmAccess !== undefined && (!realmAccess || typeof realmAccess !== 'object' || Array.isArray(realmAccess))) {
          throw new AuthError('Invalid role claims')
        }
        const roles = realmAccess?.roles ?? []
        if (
          !Array.isArray(roles) ||
          roles.length > 128 ||
          roles.some((role) => typeof role !== 'string' || role.length < 1 || role.length > 128)
        ) {
          throw new AuthError('Invalid role claims')
        }
      } else {
        // ID token checks: nonce (required on initial login; if present on refresh must still match),
        // azp when multiple audiences exist, and at_hash when present.
        if (Array.isArray(payload.aud) && payload.aud.length > 1 && payload.azp !== this.settings.clientId) {
          throw new AuthError('Invalid ID token azp')
        }
        if ('azp' in payload && payload.azp !== this.settings.clientId) {
          throw new AuthError('Invalid ID token azp')
        }
        if (!refresh || 'nonce' in payload) {
          if (typeof nonce !== 'string' || !safeEqualString(payload.nonce, nonce)) {
            throw new AuthError('Invalid nonce')
          }
        }
        if ('at_hash' in payload) {
          if (
            typeof accessToken !== 'string' ||
            typeof payload.at_hash !== 'string' ||
            !safeEqualString(payload.at_hash, expectedAtHash(accessToken))
          ) {
            throw new AuthError('Invalid at_hash')
          }
        }
      }
      return payload
    } catch (error) {
      if (error instanceof AuthUnavailable) throw error
      if (error instanceof AuthError) throw error
      throw new AuthError('Identity token rejected')
    }
  }

  identity(accessClaims, displayName) {
    const roles = new Set(accessClaims.realm_access?.roles ?? [])
    let admitted = false
    for (const role of this.settings.admissionRoles) {
      if (roles.has(role)) {
        admitted = true
        break
      }
    }
    if (!admitted) {
      throw new AuthError('No application role')
    }
    const name = typeof displayName === 'string' && displayName ? displayName : 'Mitglied'
    return Object.freeze({
      issuer: this.settings.issuer,
      subject: accessClaims.sub,
      name: name.slice(0, 120),
      roles,
      pictureUrl: erpPictureUrl(accessClaims.picture),
    })
  }

  async login() {
    const { config } = await this.provider()
    const state = randomToken()
    const binding = randomToken()
    const verifier = randomToken()
    const nonce = randomToken()
    const now = this.clock()
    const loginState = {
      expires: now + 300,
      payload: await this.seal({
        binding: OIDC.digest(binding),
        verifier,
        nonce,
      }),
    }
    const stored = await this.store.putLogin(
      this.scope,
      OIDC.digest(state),
      loginState,
      { now, limit: 1000 },
    )
    if (!stored) {
      throw new AuthUnavailable('Login capacity exhausted')
    }
    const authUrl = new URL(config.authorization_endpoint)
    authUrl.searchParams.set('response_type', 'code')
    authUrl.searchParams.set('client_id', this.settings.clientId)
    authUrl.searchParams.set('redirect_uri', `${this.settings.origin}/auth/callback`)
    authUrl.searchParams.set('scope', 'openid profile roles')
    authUrl.searchParams.set('state', state)
    authUrl.searchParams.set('nonce', nonce)
    authUrl.searchParams.set('code_challenge', pkceChallenge(verifier))
    authUrl.searchParams.set('code_challenge_method', 'S256')
    const setCookie = serializeCookie('__Host-dhw-login', binding, { maxAge: 300 })
    return {
      location: authUrl.toString(),
      setCookie,
    }
  }

  async loginResponse() {
    const { location, setCookie } = await this.login()
    return new Response(null, {
      status: 303,
      headers: {
        location,
        'set-cookie': setCookie,
      },
    })
  }

  async callback(request) {
    // Reject unknown/duplicated parameters; consume login state before any external call.
    const url = extractUrl(request)
    const counts = new Map()
    for (const [key] of url.searchParams.entries()) {
      if (!ALLOWED_CALLBACK_PARAMS.has(key)) {
        throw new AuthError('Invalid callback')
      }
      counts.set(key, (counts.get(key) ?? 0) + 1)
    }
    for (const count of counts.values()) {
      if (count !== 1) throw new AuthError('Invalid callback')
    }
    const code = url.searchParams.get('code') ?? ''
    const state = url.searchParams.get('state') ?? ''
    const iss = url.searchParams.get('iss')
    if (!code || code.length > 8192 || !OPAQUE_TOKEN_RE.test(state)) {
      throw new AuthError('Invalid callback')
    }
    if (iss !== null && iss !== this.settings.issuer) {
      throw new AuthError('Invalid callback issuer')
    }
    const row = await this.store.consumeLogin(this.scope, OIDC.digest(state))
    if (!row || row.expires <= this.clock()) {
      throw new AuthError('Expired login')
    }
    const transaction = await this.unseal(row.payload)
    const cookies = parseCookies(extractHeader(request, 'cookie'))
    const loginCookie = cookies.get('__Host-dhw-login') ?? ''
    if (!safeEqualString(transaction.binding, OIDC.digest(loginCookie))) {
      throw new AuthError('Login binding mismatch')
    }
    const { config } = await this.provider()
    try {
      const form = new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: `${this.settings.origin}/auth/callback`,
        code_verifier: transaction.verifier,
      })
      const basic = Buffer.from(`${this.settings.clientId}:${this.clientSecret}`, 'utf8').toString('base64')
      const tokens = await this._boundedJson(config.token_endpoint, {
        method: 'POST',
        headers: {
          authorization: `Basic ${basic}`,
          'content-type': 'application/x-www-form-urlencoded',
        },
        body: form.toString(),
      })
      const access = await this.verifyClaims(tokens.access_token, {
        audience: this.settings.audience,
        access: true,
      })
      const idClaims = await this.verifyClaims(tokens.id_token, {
        audience: this.settings.clientId,
        nonce: transaction.nonce,
        accessToken: tokens.access_token,
      })
      if (access.sub !== idClaims.sub) {
        throw new AuthError('Subject mismatch')
      }
      const principal = this.identity(access, idClaims.name)
      const sid = randomToken()
      const csrf = randomToken()
      const now = this.clock()
      const key = OIDC.digest(sid)
      const absolute = now + this.settings.absoluteSeconds
      const session = {
        expires: now + this.settings.idleSeconds,
        absolute,
        revision: 0,
        payload: await this.seal({
          tokens,
          sub: access.sub,
          name: typeof idClaims.name === 'string' ? idClaims.name : 'Mitglied',
          nonce: transaction.nonce,
          access_exp: access.exp,
          csrf,
          session_binding: key,
          scope: this.scope,
          absolute,
        }),
      }
      const stored = await this.store.putSession(this.scope, key, session, { now, limit: 1000 })
      if (!stored) {
        throw new AuthUnavailable('Session capacity exhausted')
      }
      return {
        identity: principal,
        csrf,
        redirectTo: '/',
        setCookies: [
          serializeCookie(this.settings.cookieName, sid, { maxAge: this.settings.absoluteSeconds }),
          deleteCookie('__Host-dhw-login'),
        ],
      }
    } catch (error) {
      if (error instanceof AuthError) throw error
      throw new AuthUnavailable('Login failed')
    }
  }

  async callbackResponse(request) {
    const result = await this.callback(request)
    const headers = new Headers({ location: result.redirectTo })
    for (const cookie of result.setCookies) {
      headers.append('set-cookie', cookie)
    }
    return new Response(null, { status: 303, headers })
  }

  async authenticate(request) {
    const cookies = parseCookies(extractHeader(request, 'cookie'))
    const sid = cookies.get(this.settings.cookieName) ?? ''
    if (!OPAQUE_TOKEN_RE.test(sid)) {
      return null
    }
    const key = OIDC.digest(sid)
    // AP-01: wait briefly for another worker's refresh, but never authenticate
    // using pre-refresh data. A crashed worker leaves a claim that expires normally.
    const deadline = performance.now() + 2000
    while (true) {
      const row = await this.store.getSession(this.scope, key)
      const now = this.clock()
      if (!row || Math.min(row.expires, row.absolute) <= now) {
        return null
      }
      if (row.revision >= 0) {
        const outcome = await this._authenticateSession(key, row, now)
        if (outcome.status === 'done') return outcome.result
      }
      if (performance.now() >= deadline) {
        throw new AuthUnavailable('Session update in progress')
      }
      await sleep(50)
    }
  }

  async _authenticateSession(key, row, now) {
    let expected = row.revision
    let payload
    let needsRefresh
    try {
      payload = await this.unseal(row.payload)
      // AP-01: ciphertext is bound to this app and cookie; a copied DB row
      // cannot masquerade as another user's session.
      if (
        !safeEqualString(payload.session_binding, key) ||
        payload.scope !== this.scope ||
        typeof payload.absolute !== 'number' ||
        payload.absolute <= now
      ) {
        throw new AuthError('Invalid session binding')
      }
      needsRefresh = payload.access_exp < now + 60
    } catch {
      await this.store.deleteSession(this.scope, key, { expectedRevision: expected })
      return { status: 'done', result: null }
    }
    if (needsRefresh) {
      // AP-01: a committed claim removes the old token from storage before
      // exchanging it. Even cancellation or worker loss cannot replay it.
      const claim = {
        expires: row.expires,
        absolute: row.absolute,
        revision: -(expected + 1),
        payload: new Uint8Array(0),
      }
      const claimed = await this.store.replaceSession(this.scope, key, expected, claim)
      if (!claimed) {
        return { status: 'retry' }
      }
      expected = claim.revision
    }
    let principal
    let updated
    try {
      const access = needsRefresh
        ? await this._refreshSession(payload)
        : await this.verifyClaims(payload.tokens?.access_token, {
            audience: this.settings.audience,
            access: true,
          })
      principal = this.identity(access, payload.name)
      const absolute = Math.min(row.absolute, payload.absolute)
      if (Math.min(row.expires, absolute) <= this.clock()) {
        throw new AuthError('Session expired')
      }
      updated = {
        expires: Math.min(now + this.settings.idleSeconds, absolute),
        absolute,
        revision: row.revision + 1,
        payload: await this.seal(payload),
      }
    } catch {
      // Never invalidate a newer revision on the basis of stale claims.
      await this.store.deleteSession(this.scope, key, { expectedRevision: expected })
      return { status: 'done', result: null }
    }
    // AP-01: logout or expiry cleanup during refresh wins; CAS never inserts.
    const replaced = await this.store.replaceSession(this.scope, key, expected, updated)
    if (!replaced) {
      return needsRefresh ? { status: 'done', result: null } : { status: 'retry' }
    }
    return { status: 'done', result: { identity: principal, csrf: payload.csrf } }
  }

  async _refreshSession(payload) {
    const refresh = payload.tokens?.refresh_token
    if (typeof refresh !== 'string' || !refresh) {
      throw new AuthError('Session expired')
    }
    const { config } = await this.provider()
    const form = new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refresh,
    })
    const basic = Buffer.from(`${this.settings.clientId}:${this.clientSecret}`, 'utf8').toString('base64')
    const tokens = await this._boundedJson(config.token_endpoint, {
      method: 'POST',
      headers: {
        authorization: `Basic ${basic}`,
        'content-type': 'application/x-www-form-urlencoded',
      },
      body: form.toString(),
    })
    const access = await this.verifyClaims(tokens.access_token, {
      audience: this.settings.audience,
      access: true,
    })
    if (access.sub !== payload.sub) {
      throw new AuthError('Subject changed')
    }
    if ('id_token' in tokens) {
      const idClaims = await this.verifyClaims(tokens.id_token, {
        audience: this.settings.clientId,
        nonce: payload.nonce,
        accessToken: tokens.access_token,
        refresh: true,
      })
      if (idClaims.sub !== payload.sub) {
        throw new AuthError('Subject changed')
      }
    }
    if (!tokens.refresh_token) {
      tokens.refresh_token = refresh
    }
    payload.tokens = tokens
    payload.access_exp = access.exp
    return access
  }

  requireCsrf(request, value, expectedCsrf) {
    if (
      extractHeader(request, 'origin') !== this.settings.origin ||
      extractHeader(request, 'sec-fetch-site') === 'cross-site' ||
      typeof value !== 'string' ||
      !value ||
      typeof expectedCsrf !== 'string' ||
      !expectedCsrf ||
      !safeEqualString(value, expectedCsrf)
    ) {
      throw new AuthError('Invalid request origin or CSRF token')
    }
  }

  async logout(request, { csrfToken, expectedCsrf }) {
    const supplied = csrfToken ?? extractHeader(request, 'x-csrf-token')
    this.requireCsrf(request, supplied, expectedCsrf)
    const cookies = parseCookies(extractHeader(request, 'cookie'))
    const sid = cookies.get(this.settings.cookieName) ?? ''
    if (sid) {
      await this.store.deleteSession(this.scope, OIDC.digest(sid))
    }
    return {
      setCookie: deleteCookie(this.settings.cookieName),
    }
  }

  async logoutResponse(request, { csrfToken, expectedCsrf }) {
    const { setCookie } = await this.logout(request, { csrfToken, expectedCsrf })
    return new Response(null, {
      status: 204,
      headers: { 'set-cookie': setCookie },
    })
  }
}
