"""AP-01: confidential Keycloak OAuth client, bounded OIDC and encrypted DB sessions.

Only opaque host cookies cross the browser boundary. Roles are validated access-token
claims, never ID-token/UserInfo/header data. No framework SessionMiddleware is used.
"""

import asyncio
import hashlib
import hmac
import json
import math
import re
import secrets
import time
from dataclasses import dataclass
from pathlib import Path
from urllib.parse import urlsplit

import httpx
from authlib.oauth2.client import OAuth2Client
from authlib.oidc.core import CodeIDToken
from cryptography.fernet import Fernet, InvalidToken
from joserfc import jwt
from joserfc.errors import InvalidKeyIdError
from joserfc.jwk import KeySet
from sqlalchemy import (
    Column,
    Float,
    Integer,
    LargeBinary,
    MetaData,
    String,
    Table,
    and_,
    delete,
    func,
    insert,
    select,
    update,
)
from sqlalchemy.ext.asyncio import AsyncEngine
from starlette.requests import Request
from starlette.responses import RedirectResponse, Response

from .secrets import read_secret

metadata = MetaData()
states = Table(
    "kit_login_states",
    metadata,
    Column("id", String(64), primary_key=True),
    Column("scope", String(64), nullable=False),
    Column("expires", Float, nullable=False),
    Column("payload", LargeBinary, nullable=False),
)
sessions = Table(
    "kit_sessions",
    metadata,
    Column("id", String(64), primary_key=True),
    Column("scope", String(64), nullable=False),
    Column("expires", Float, nullable=False),
    Column("absolute", Float, nullable=False),
    Column("revision", Integer, nullable=False),
    Column("payload", LargeBinary, nullable=False),
)


class AuthError(Exception):
    """Safe public error; upstream messages/tokens must never become exception text."""


class AuthUnavailable(AuthError):
    pass


@dataclass(frozen=True)
class Identity:
    issuer: str
    subject: str
    name: str
    roles: frozenset[str]


@dataclass(frozen=True)
class OIDCSettings:
    issuer: str
    client_id: str
    audience: str
    origin: str
    client_secret_file: Path
    session_key_file: Path
    admission_roles: frozenset[str]
    cookie_name: str = "__Host-dhw-session"
    idle_seconds: int = 1800
    absolute_seconds: int = 28800

    def validate(self):
        for value, origin in ((self.issuer, False), (self.origin, True)):
            parsed = urlsplit(value)
            if (
                parsed.scheme != "https"
                or not parsed.hostname
                or parsed.username
                or parsed.password
                or parsed.query
                or parsed.fragment
                or value.endswith("/")
                or (origin and parsed.path)
            ):
                raise ValueError("Explicit HTTPS OIDC URLs required")
        if (
            not self.client_id
            or not self.audience
            or not self.admission_roles
            or not self.cookie_name.startswith("__Host-")
            or not 60 <= self.idle_seconds <= self.absolute_seconds <= 86400
        ):
            raise ValueError("Invalid OIDC policy")


class OIDC:
    def __init__(
        self, settings: OIDCSettings, engine: AsyncEngine, *, transport=None, clock=time.time
    ):
        settings.validate()
        self.settings, self.engine, self.transport, self.clock = settings, engine, transport, clock
        self.secret = read_secret(settings.client_secret_file)
        key = read_secret(settings.session_key_file)
        if hmac.compare_digest(key, self.secret):
            raise ValueError("Independent session key required")
        self.cipher = Fernet(key.encode())
        self.scope = self.digest(settings.issuer + "|" + settings.client_id + "|" + settings.origin)
        self._cache = None
        self._cache_until = 0
        self._rotation_after = 0
        self._cache_lock = asyncio.Lock()

    @staticmethod
    def digest(value):
        return hashlib.sha256(value.encode()).hexdigest()

    def seal(self, data):
        return self.cipher.encrypt(json.dumps(data, ensure_ascii=True, allow_nan=False).encode())

    def unseal(self, data):
        try:
            return json.loads(self.cipher.decrypt(data))
        except (ValueError, InvalidToken):
            raise AuthError("Invalid server session") from None

    async def bounded_json(self, client, method, url, **kwargs):
        # AP-01/ASI-023: fixed verified issuer endpoints; never redirects/proxies.
        async with asyncio.timeout(8), client.stream(method, url, **kwargs) as response:
            if response.status_code != 200:
                raise AuthUnavailable("Identity provider unavailable")
            data = bytearray()
            async for chunk in response.aiter_bytes(16384):
                data.extend(chunk)
                if len(data) > 131072:
                    raise AuthUnavailable("Identity response too large")
            value = json.loads(data)
            if not isinstance(value, dict):
                raise AuthUnavailable("Invalid identity response")
            return value

    def client(self):
        return httpx.AsyncClient(
            transport=self.transport,
            timeout=httpx.Timeout(5),
            follow_redirects=False,
            trust_env=False,
            headers={"Accept-Encoding": "identity"},
        )

    async def provider(self, force=False):
        async with self._cache_lock:
            if not force and self._cache is not None and self.clock() < self._cache_until:
                return self._cache
            async with self.client() as client:
                config = await self.bounded_json(
                    client, "GET", self.settings.issuer + "/.well-known/openid-configuration"
                )
                if config.get("issuer") != self.settings.issuer:
                    raise AuthUnavailable("Issuer mismatch")
                for name in ("authorization_endpoint", "token_endpoint", "jwks_uri"):
                    endpoint = urlsplit(config.get(name, ""))
                    issuer = urlsplit(self.settings.issuer)
                    if (
                        endpoint.scheme != "https"
                        or endpoint.netloc != issuer.netloc
                        or endpoint.username
                        or endpoint.password
                        or endpoint.query
                        or endpoint.fragment
                        or not endpoint.path.startswith(issuer.path + "/")
                    ):
                        raise AuthUnavailable("Untrusted OIDC endpoint")
                keys = await self.bounded_json(client, "GET", config["jwks_uri"])
                raw_keys = keys.get("keys")
                if not isinstance(raw_keys, list) or not 1 <= len(raw_keys) <= 16:
                    raise AuthUnavailable("Invalid signing keys")
                kids = [key.get("kid") for key in raw_keys]
                if (
                    any(not isinstance(kid, str) or not kid for kid in kids)
                    or len(kids) != len(set(kids))
                    or any(
                        key.get("kty") != "RSA"
                        or "d" in key
                        or key.get("use", "sig") != "sig"
                        or key.get("alg", "RS256") != "RS256"
                        for key in raw_keys
                    )
                ):
                    raise AuthUnavailable("Invalid signing keys")
                result = (config, KeySet.import_key_set(keys))
            self._cache, self._cache_until = result, self.clock() + 300
            return result

    async def claims(
        self,
        token,
        *,
        audience,
        access=False,
        nonce=None,
        access_token=None,
        allowed_clients=None,
        refresh=False,
    ):
        if not isinstance(token, str) or not 1 <= len(token) <= 32768:
            raise AuthError("Invalid identity token")
        try:
            _, keys = await self.provider()
            try:
                decoded = jwt.decode(token, keys, algorithms=["RS256"])
            except InvalidKeyIdError:
                # Unknown signing IDs may mean normal provider rotation. Bound
                # refreshes so attacker-chosen IDs cannot flood discovery/JWKS.
                if self.clock() < self._rotation_after:
                    raise AuthError("Unknown signing key") from None
                self._rotation_after = self.clock() + 30
                _, keys = await self.provider(force=True)
                decoded = jwt.decode(token, keys, algorithms=["RS256"])
            if not isinstance(decoded.header.get("kid"), str) or any(
                name in decoded.header for name in ("jku", "jwk", "x5u", "crit")
            ):
                raise AuthError("Unsupported signing header")
            registry = jwt.JWTClaimsRegistry(
                now=int(self.clock()),
                leeway=30,
                iss={"essential": True, "value": self.settings.issuer},
                aud={"essential": True, "value": audience},
                sub={"essential": True},
                exp={"essential": True},
                iat={"essential": True},
            )
            registry.validate(decoded.claims)
            data = decoded.claims
            for field in ("exp", "iat", "nbf"):
                if field in data and (
                    type(data[field]) not in (int, float) or not math.isfinite(data[field])
                ):
                    raise AuthError("Invalid token time")
            if (
                data["iat"] > self.clock() + 30
                or data["exp"] <= data["iat"]
                or not isinstance(data["sub"], str)
                or not 1 <= len(data["sub"]) <= 255
            ):
                raise AuthError("Invalid token claims")
            if access:
                # ID tokens cannot be repurposed as role-bearing access tokens.
                if (
                    data.get("azp")
                    not in (
                        allowed_clients
                        if allowed_clients is not None
                        else {self.settings.client_id}
                    )
                    or data.get("typ") != "Bearer"
                ):
                    raise AuthError("Invalid access-token purpose")
                roles = data.get("realm_access", {}).get("roles", [])
                if (
                    not isinstance(roles, list)
                    or len(roles) > 128
                    or any(not isinstance(role, str) or not 1 <= len(role) <= 128 for role in roles)
                ):
                    raise AuthError("Invalid role claims")
            else:
                CodeIDToken(
                    data,
                    decoded.header,
                    params={
                        # Refresh ID tokens may omit nonce; a present nonce
                        # must still match the original login (AP-01).
                        "nonce": nonce if not refresh or "nonce" in data else None,
                        "client_id": self.settings.client_id,
                        "access_token": access_token,
                    },
                ).validate(now=int(self.clock()), leeway=30)
            return data
        except AuthUnavailable:
            raise
        except Exception:
            raise AuthError("Identity token rejected") from None

    def identity(self, access, display_name):
        roles = frozenset(access.get("realm_access", {}).get("roles", []))
        if not roles.intersection(self.settings.admission_roles):
            raise AuthError("No application role")
        name = display_name if isinstance(display_name, str) else "Mitglied"
        return Identity(self.settings.issuer, access["sub"], name[:120], roles)

    async def login(self, request: Request):
        config, _ = await self.provider()
        state, binding, verifier, nonce = (secrets.token_urlsafe(32) for _ in range(4))
        now = self.clock()
        async with self.engine.begin() as db:
            await db.execute(delete(states).where(states.c.expires < now))
            # Serialize admission across processes; no live login is evicted.
            await db.exec_driver_sql("LOCK TABLE kit_login_states IN SHARE ROW EXCLUSIVE MODE")
            count = await db.scalar(
                select(func.count()).select_from(states).where(states.c.scope == self.scope)
            )
            if count >= 1000:
                raise AuthUnavailable("Login capacity exhausted")
            await db.execute(
                insert(states).values(
                    id=self.digest(state),
                    scope=self.scope,
                    expires=now + 300,
                    payload=self.seal(
                        {"binding": self.digest(binding), "verifier": verifier, "nonce": nonce}
                    ),
                )
            )
        # Authlib implements PKCE S256 and OAuth authorization parameter encoding.
        oauth = OAuth2Client(
            None,
            client_id=self.settings.client_id,
            redirect_uri=self.settings.origin + "/auth/callback",
            scope="openid profile roles",
            code_challenge_method="S256",
        )
        url, _ = oauth.create_authorization_url(
            config["authorization_endpoint"], state=state, nonce=nonce, code_verifier=verifier
        )
        response = RedirectResponse(url, status_code=303)
        response.set_cookie(
            "__Host-dhw-login",
            binding,
            secure=True,
            httponly=True,
            samesite="lax",
            max_age=300,
            path="/",
        )
        return response

    async def callback(self, request: Request):
        # Reject duplicated parameters; consume state before any external call.
        query = request.query_params
        if (
            set(query) - {"code", "state", "session_state", "iss"}
            or any(len(query.getlist(key)) != 1 for key in query)
            or not query.get("code")
            or len(query["code"]) > 8192
            or not re.fullmatch(r"[A-Za-z0-9_-]{43}", query.get("state", ""))
        ):
            raise AuthError("Invalid callback")
        if query.get("iss", self.settings.issuer) != self.settings.issuer:
            raise AuthError("Invalid callback issuer")
        async with self.engine.begin() as db:
            row = (
                (
                    await db.execute(
                        delete(states)
                        .where(
                            and_(
                                states.c.id == self.digest(query["state"]),
                                states.c.scope == self.scope,
                            )
                        )
                        .returning(states)
                    )
                )
                .mappings()
                .first()
            )
        if row is None or row["expires"] < self.clock():
            raise AuthError("Expired login")
        transaction = self.unseal(row["payload"])
        if not hmac.compare_digest(
            transaction["binding"], self.digest(request.cookies.get("__Host-dhw-login", ""))
        ):
            raise AuthError("Login binding mismatch")
        config, _ = await self.provider()
        try:
            async with self.client() as client:
                tokens = await self.bounded_json(
                    client,
                    "POST",
                    config["token_endpoint"],
                    data={
                        "grant_type": "authorization_code",
                        "code": query["code"],
                        "redirect_uri": self.settings.origin + "/auth/callback",
                        "code_verifier": transaction["verifier"],
                    },
                    auth=(self.settings.client_id, self.secret),
                )
            access = await self.claims(
                tokens.get("access_token"), audience=self.settings.audience, access=True
            )
            identity = await self.claims(
                tokens.get("id_token"),
                audience=self.settings.client_id,
                nonce=transaction["nonce"],
                access_token=tokens["access_token"],
            )
            if access["sub"] != identity["sub"]:
                raise AuthError("Subject mismatch")
            self.identity(access, identity.get("name"))
            sid, csrf = secrets.token_urlsafe(32), secrets.token_urlsafe(32)
            now = self.clock()
            async with self.engine.begin() as db:
                await db.execute(delete(sessions).where(sessions.c.expires < now))
                await db.exec_driver_sql("LOCK TABLE kit_sessions IN SHARE ROW EXCLUSIVE MODE")
                if (
                    await db.scalar(
                        select(func.count())
                        .select_from(sessions)
                        .where(sessions.c.scope == self.scope)
                    )
                    >= 1000
                ):
                    raise AuthUnavailable("Session capacity exhausted")
                await db.execute(
                    insert(sessions).values(
                        id=self.digest(sid),
                        scope=self.scope,
                        revision=0,
                        expires=now + self.settings.idle_seconds,
                        absolute=now + self.settings.absolute_seconds,
                        payload=self.seal(
                            {
                                "tokens": tokens,
                                "sub": access["sub"],
                                "name": identity.get("name", "Mitglied"),
                                "nonce": transaction["nonce"],
                                "access_exp": access["exp"],
                                "csrf": csrf,
                                "session_binding": self.digest(sid),
                                "scope": self.scope,
                                "absolute": now + self.settings.absolute_seconds,
                            }
                        ),
                    )
                )
            response = RedirectResponse("/", status_code=303)
            response.set_cookie(
                self.settings.cookie_name,
                sid,
                secure=True,
                httponly=True,
                samesite="lax",
                path="/",
                max_age=self.settings.absolute_seconds,
            )
            response.delete_cookie(
                "__Host-dhw-login", secure=True, httponly=True, samesite="lax", path="/"
            )
            return response
        except AuthError:
            raise
        except Exception:
            raise AuthUnavailable("Login failed") from None

    async def authenticate(self, request: Request):
        sid = request.cookies.get(self.settings.cookie_name, "")
        if not re.fullmatch(r"[A-Za-z0-9_-]{43}", sid):
            return None
        now = self.clock()
        # PG row lock fences refresh-token rotation across workers. It is held
        # only during authentication, never for the subsequent application write.
        async with self.engine.begin() as db:
            row = (
                (
                    await db.execute(
                        select(sessions)
                        .where(
                            and_(sessions.c.id == self.digest(sid), sessions.c.scope == self.scope)
                        )
                        .with_for_update()
                    )
                )
                .mappings()
                .first()
            )
            if row is None or min(row["expires"], row["absolute"]) <= now:
                return None
            try:
                payload = self.unseal(row["payload"])
                # Bind encrypted content to the opaque-cookie hash and app.
                # A database-only attacker cannot swap ciphertext between users.
                if (
                    not hmac.compare_digest(payload.get("session_binding", ""), row["id"])
                    or payload.get("scope") != self.scope
                    or payload.get("absolute", 0) <= now
                ):
                    raise AuthError("Invalid session binding")
                if payload["access_exp"] < now + 60:
                    refresh = payload["tokens"].get("refresh_token")
                    if not isinstance(refresh, str) or not refresh:
                        raise AuthError("Session expired")
                    config, _ = await self.provider()
                    async with self.client() as client:
                        tokens = await self.bounded_json(
                            client,
                            "POST",
                            config["token_endpoint"],
                            data={"grant_type": "refresh_token", "refresh_token": refresh},
                            auth=(self.settings.client_id, self.secret),
                        )
                    access = await self.claims(
                        tokens.get("access_token"), audience=self.settings.audience, access=True
                    )
                    if access["sub"] != payload["sub"]:
                        raise AuthError("Subject changed")
                    if "id_token" in tokens:
                        identity = await self.claims(
                            tokens["id_token"],
                            audience=self.settings.client_id,
                            nonce=payload["nonce"],
                            access_token=tokens["access_token"],
                            refresh=True,
                        )
                        if identity["sub"] != payload["sub"]:
                            raise AuthError("Subject changed")
                    tokens.setdefault("refresh_token", refresh)
                    payload["tokens"] = tokens
                    payload["access_exp"] = access["exp"]
                else:
                    access = await self.claims(
                        payload["tokens"]["access_token"],
                        audience=self.settings.audience,
                        access=True,
                    )
                principal = self.identity(access, payload["name"])
                await db.execute(
                    update(sessions)
                    .where(sessions.c.id == row["id"])
                    .values(
                        payload=self.seal(payload),
                        expires=min(now + self.settings.idle_seconds, row["absolute"]),
                        revision=row["revision"] + 1,
                    )
                )
                request.state.csrf = payload["csrf"]
                return principal
            except Exception:
                # Any uncertain refresh invalidates locally. Never replay an old
                # rotating token or fall back to stale role claims (AP-01).
                await db.execute(delete(sessions).where(sessions.c.id == row["id"]))
                return None

    def require_csrf(self, request: Request, value: str):
        if (
            request.headers.get("origin") != self.settings.origin
            or request.headers.get("sec-fetch-site") == "cross-site"
            or not value
            or not hmac.compare_digest(value, getattr(request.state, "csrf", ""))
        ):
            raise AuthError("Invalid request origin or CSRF token")

    async def logout(self, request: Request, csrf_value: str | None = None):
        self.require_csrf(request, csrf_value or request.headers.get("x-csrf-token", ""))
        async with self.engine.begin() as db:
            await db.execute(
                delete(sessions).where(
                    and_(
                        sessions.c.id
                        == self.digest(request.cookies.get(self.settings.cookie_name, "")),
                        sessions.c.scope == self.scope,
                    )
                )
            )
        # Explicit local logout; UI says 'Hier abmelden'. Global back-channel
        # logout is deferred, not simulated with tokens in a redirect URL.
        response = Response(status_code=204)
        response.delete_cookie(
            self.settings.cookie_name, secure=True, httponly=True, samesite="lax", path="/"
        )
        return response
