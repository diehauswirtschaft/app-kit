export class AuthError extends Error {
  constructor(message?: string);
}

export class AuthUnavailable extends AuthError {
  constructor(message?: string);
}

export interface LoginState {
  expires: number;
  payload: Uint8Array;
}

export interface SessionRecord {
  expires: number;
  absolute: number;
  /** Negative revisions are durable in-flight refresh claims, not ready sessions. */
  revision: number;
  payload: Uint8Array;
}

/**
 * Consumer-owned atomic persistence contract for Node/SvelteKit OIDC sessions.
 * Mirrors app_kit.session_store.SessionStore (AP-01).
 */
export interface SessionStore {
  putLogin(
    scope: string,
    key: string,
    state: LoginState,
    options: { now: number; limit: number },
  ): Promise<boolean>;
  consumeLogin(scope: string, key: string): Promise<LoginState | null>;
  putSession(
    scope: string,
    key: string,
    session: SessionRecord,
    options: { now: number; limit: number },
  ): Promise<boolean>;
  getSession(scope: string, key: string): Promise<SessionRecord | null>;
  replaceSession(
    scope: string,
    key: string,
    expectedRevision: number,
    session: SessionRecord,
  ): Promise<boolean>;
  deleteSession(
    scope: string,
    key: string,
    options?: { expectedRevision?: number },
  ): Promise<void>;
}

export interface Identity {
  readonly issuer: string;
  readonly subject: string;
  readonly name: string;
  readonly roles: ReadonlySet<string>;
  readonly pictureUrl: string | null;
}

export interface OIDCSettings {
  issuer: string;
  clientId: string;
  audience: string;
  origin: string;
  clientSecretFile: string | URL;
  sessionKeyFile: string | URL;
  admissionRoles: Iterable<string>;
  cookieName?: string;
  idleSeconds?: number;
  absoluteSeconds?: number;
}

export interface OIDCOptions {
  store: SessionStore;
  fetch?: typeof globalThis.fetch;
  clock?: () => number;
}

export interface RequestLike {
  url?: string | URL;
  headers?: Headers | Record<string, string | string[] | undefined>;
}

export function erpPictureUrl(claim: unknown): string | null;
export function validateSettings(settings: OIDCSettings): Readonly<{
  issuer: string;
  clientId: string;
  audience: string;
  origin: string;
  clientSecretFile: string | URL;
  sessionKeyFile: string | URL;
  admissionRoles: ReadonlySet<string>;
  cookieName: string;
  idleSeconds: number;
  absoluteSeconds: number;
}>;

export class OIDC {
  readonly settings: ReturnType<typeof validateSettings>;
  readonly store: SessionStore;
  readonly scope: string;

  constructor(settings: OIDCSettings, options: OIDCOptions);

  static digest(value: string): string;
  seal(data: unknown): Promise<Uint8Array>;
  unseal(payload: Uint8Array | string): Promise<Record<string, unknown>>;
  provider(force?: boolean): Promise<{ config: Record<string, unknown>; keys: Map<string, unknown> }>;
  verifyClaims(
    token: unknown,
    options: {
      audience: string;
      access?: boolean;
      nonce?: string | null;
      accessToken?: string | null;
      allowedClients?: Iterable<string> | null;
      refresh?: boolean;
    },
  ): Promise<Record<string, unknown>>;
  identity(accessClaims: Record<string, unknown>, displayName: unknown): Identity;

  login(): Promise<{ location: string; setCookie: string }>;
  loginResponse(): Promise<Response>;
  callback(request: RequestLike): Promise<{
    identity: Identity;
    csrf: string;
    redirectTo: string;
    setCookies: string[];
  }>;
  callbackResponse(request: RequestLike): Promise<Response>;
  authenticate(request: RequestLike): Promise<{ identity: Identity; csrf: string } | null>;
  requireCsrf(request: RequestLike, value: string, expectedCsrf: string): void;
  logout(
    request: RequestLike,
    options: { csrfToken?: string; expectedCsrf: string },
  ): Promise<{ setCookie: string }>;
  logoutResponse(
    request: RequestLike,
    options: { csrfToken?: string; expectedCsrf: string },
  ): Promise<Response>;
}
