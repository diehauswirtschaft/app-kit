"""Real RSA signatures with a synthetic provider and interchangeable stores."""

import asyncio
import base64
import hashlib
import hmac
import secrets
import time
from urllib.parse import parse_qs, urlsplit

import httpx
import pytest
from cryptography.fernet import Fernet
from joserfc import jwt
from joserfc.jwk import RSAKey
from starlette.requests import Request

from app_kit.auth import OIDC, AuthError, AuthUnavailable, OIDCSettings


class Provider:
    def __init__(self):
        self.now = [time.time()]
        self.key = RSAKey.generate_key(2048, private=True, parameters={"kid": "runtime-key"})
        self.issuer = "https://identity.example/realms/test"
        self.access_changes = {}
        self.id_changes = {}
        self.nonce = None
        self.challenge = None
        self.refresh_entered = asyncio.Event()
        self.resume_refresh = asyncio.Event()
        self.resume_refresh.set()
        self.omit_nonce = False
        self.refreshes = 0
        self.jwks_keys = None
        self.transport = httpx.MockTransport(self.handle)

    def token(self, claims):
        return jwt.encode(
            {"alg": "RS256", "kid": self.key.as_dict(private=False)["kid"]}, claims, self.key
        )

    def tokens(self):
        base = {
            "iss": self.issuer,
            "sub": "synthetic-subject",
            "iat": int(self.now[0]),
            "exp": int(self.now[0]) + 300,
            "aud": "fixture-web",
        }
        access = self.token(
            {
                **base,
                "azp": "fixture-web",
                "typ": "Bearer",
                "realm_access": {"roles": ["dhw-member-role"]},
                **self.access_changes,
            }
        )
        id_claims = {
            **base,
            "nonce": self.nonce,
            "name": "Synthetic identity",
            "realm_access": {"roles": ["dhw-admin-role"]},
            **self.id_changes,
        }
        if self.omit_nonce:
            id_claims.pop("nonce", None)
        identity = self.token(id_claims)
        return {
            "access_token": access,
            "id_token": identity,
            "refresh_token": secrets.token_urlsafe(32),
            "token_type": "Bearer",
            "expires_in": 300,
        }

    async def handle(self, request):
        if request.url.path.endswith("/.well-known/openid-configuration"):
            return httpx.Response(
                200,
                json={
                    "issuer": self.issuer,
                    **{
                        key: self.issuer + "/" + value
                        for key, value in {
                            "authorization_endpoint": "auth",
                            "token_endpoint": "token",
                            "jwks_uri": "keys",
                        }.items()
                    },
                },
            )
        if request.url.path.endswith("/keys"):
            return httpx.Response(
                200,
                json={
                    "keys": self.jwks_keys
                    if self.jwks_keys is not None
                    else [self.key.as_dict(private=False)]
                },
            )
        if request.url.path.endswith("/token"):
            data = parse_qs(request.content.decode())
            if data["grant_type"] == ["refresh_token"]:
                self.refreshes += 1
                self.refresh_entered.set()
                await self.resume_refresh.wait()
            else:
                verifier = data["code_verifier"][0]
                calculated = (
                    base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest())
                    .rstrip(b"=")
                    .decode()
                )
                if not hmac.compare_digest(calculated, self.challenge):
                    return httpx.Response(400)
            return httpx.Response(200, json=self.tokens())
        return httpx.Response(404)


@pytest.fixture
def oidc(tmp_path, store_args):
    provider = Provider()
    client = tmp_path / "client"
    client.write_text(secrets.token_urlsafe(40))
    client.chmod(0o600)
    key = tmp_path / "session"
    key.write_bytes(Fernet.generate_key())
    key.chmod(0o600)
    settings = OIDCSettings(
        provider.issuer,
        "fixture-web",
        "fixture-web",
        "https://app.example",
        client,
        key,
        frozenset({"dhw-member-role"}),
    )
    return OIDC(
        settings, **store_args, transport=provider.transport, clock=lambda: provider.now[0]
    ), provider


def request(path="/", cookie="", query="", headers=()):
    return Request(
        {
            "type": "http",
            "method": "GET",
            "scheme": "https",
            "server": ("app.example", 443),
            "client": ("127.0.0.1", 1234),
            "path": path,
            "query_string": query.encode(),
            "headers": [(b"cookie", cookie.encode()), *headers],
        }
    )


async def sign_in(auth, provider):
    response = await auth.login(request("/auth/login"))
    query = parse_qs(urlsplit(response.headers["location"]).query)
    provider.nonce = query["nonce"][0]
    assert query["code_challenge_method"] == ["S256"]
    binding = response.headers["set-cookie"].split(";")[0]
    provider.challenge = query["code_challenge"][0]
    params = "state=" + query["state"][0] + "&code=" + secrets.token_urlsafe(24)
    result = await auth.callback(request("/auth/callback", binding, params))
    cookies = result.headers.getlist("set-cookie")
    return (
        next(
            item.split(";")[0]
            for item in cookies
            if item.startswith(auth.settings.cookie_name + "=")
        ),
        params,
        binding,
    )


async def test_mixed_public_jwks_uses_signature_key_not_encryption_key(oidc):
    auth, provider = oidc
    public = provider.key.as_dict(private=False)
    provider.jwks_keys = [
        {**public, "kid": "encryption-key", "use": "enc", "alg": "RSA-OAEP"},
        {**public, "use": "sig", "alg": "RS256", "key_ops": ["verify"]},
    ]
    cookie, _, _ = await sign_in(auth, provider)
    principal = await auth.authenticate(request(cookie=cookie))
    assert principal.roles == frozenset({"dhw-member-role"})


async def test_encryption_kid_cannot_verify_even_mathematically_valid_rs256_signature(oidc):
    auth, provider = oidc
    public = provider.key.as_dict(private=False)
    provider.jwks_keys = [
        {**public, "kid": "encryption-key", "use": "enc", "alg": "RSA-OAEP"},
        public,
    ]
    claims = {
        "iss": provider.issuer,
        "sub": "synthetic-subject",
        "iat": int(provider.now[0]),
        "exp": int(provider.now[0]) + 60,
        "aud": "fixture-web",
        "azp": "fixture-web",
        "typ": "Bearer",
    }
    token = jwt.encode({"alg": "RS256", "kid": "encryption-key"}, claims, provider.key)
    with pytest.raises(AuthError):
        await auth.claims(token, audience="fixture-web", access=True)


@pytest.mark.parametrize(
    "case",
    [
        "only-encryption",
        "duplicate-kid",
        "private-material",
        "malformed-entry",
        "wrong-key-ops",
        "unsupported-algorithm",
    ],
)
async def test_jwks_rejects_unusable_or_ambiguous_signing_material(oidc, case):
    auth, provider = oidc
    public = provider.key.as_dict(private=False)
    sets = {
        "only-encryption": [{**public, "use": "enc", "alg": "RSA-OAEP"}],
        "duplicate-kid": [public, public],
        "private-material": [provider.key.as_dict(private=True)],
        "malformed-entry": [None, public],
        "wrong-key-ops": [{**public, "key_ops": ["encrypt"]}],
        "unsupported-algorithm": [{**public, "alg": "PS256"}],
    }
    provider.jwks_keys = sets[case]
    with pytest.raises(AuthUnavailable):
        await auth.provider()


async def test_code_flow_cookie_opaque_access_roles_encrypted_and_no_replay(oidc):
    auth, provider = oidc
    cookie, params, binding = await sign_in(auth, provider)
    value = cookie.split("=", 1)[1]
    assert len(value) == 43 and "." not in value
    principal = await auth.authenticate(request(cookie=cookie))
    assert principal.roles == frozenset({"dhw-member-role"})
    row = await auth.store.get_session(auth.scope, auth.digest(value))
    assert b"access_token" not in row.payload and b"synthetic-subject" not in row.payload
    with pytest.raises(AuthError):
        await auth.callback(request("/auth/callback", binding, params))


@pytest.mark.parametrize(
    "changes",
    [
        {"iss": "https://foreign.example"},
        {"aud": "foreign"},
        {"azp": "foreign"},
        {"typ": "ID"},
        {"exp": 1},
        {"nbf": 9999999999},
        {"iat": 9999999999},
        {"sub": None},
        {"realm_access": {"roles": "dhw-member-role"}},
    ],
)
async def test_access_negative_claims(oidc, changes):
    auth, provider = oidc
    provider.access_changes = changes
    with pytest.raises(AuthError):
        await sign_in(auth, provider)


@pytest.mark.parametrize("changes", [{"nonce": "wrong"}, {"sub": "foreign"}, {"aud": "foreign"}])
async def test_id_nonce_subject_audience(oidc, changes):
    auth, provider = oidc
    provider.id_changes = changes
    with pytest.raises(AuthError):
        await sign_in(auth, provider)


async def test_expired_access_refresh_roles_and_revoke_on_subject_change(oidc):
    auth, provider = oidc
    cookie, _, _ = await sign_in(auth, provider)
    provider.now[0] += 301
    provider.access_changes = {"realm_access": {"roles": ["dhw-member-role", "fixture-lk"]}}
    principal = await auth.authenticate(request(cookie=cookie))
    assert "fixture-lk" in principal.roles and provider.refreshes == 1
    provider.now[0] += 301
    provider.access_changes = {"sub": "foreign"}
    assert await auth.authenticate(request(cookie=cookie)) is None
    assert await auth.authenticate(request(cookie=cookie)) is None


async def test_role_revocation_and_cookie_binding(oidc):
    auth, provider = oidc
    cookie, _, _ = await sign_in(auth, provider)
    provider.now[0] += 301
    provider.access_changes = {"realm_access": {"roles": []}}
    assert await auth.authenticate(request(cookie=cookie)) is None
    response = await auth.login(request())
    query = parse_qs(urlsplit(response.headers["location"]).query)
    with pytest.raises(AuthError):
        await auth.callback(
            request(query="state=" + query["state"][0] + "&code=" + secrets.token_urlsafe(24))
        )


async def test_concurrent_refresh_single_provider_rotation_and_key_rollover(oidc):
    auth, provider = oidc
    cookie, _, _ = await sign_in(auth, provider)
    provider.now[0] += 301
    other_worker = OIDC(auth.settings, store=auth.store, transport=provider.transport, clock=auth.clock)
    result = await asyncio.gather(
        auth.authenticate(request(cookie=cookie)), other_worker.authenticate(request(cookie=cookie))
    )
    assert all(value is not None for value in result) and provider.refreshes == 1
    provider.key = RSAKey.generate_key(
        2048, private=True, parameters={"kid": "rotated-runtime-key"}
    )
    claims = {
        "iss": provider.issuer,
        "sub": "service",
        "iat": int(provider.now[0]),
        "exp": int(provider.now[0]) + 60,
        "typ": "Bearer",
        "azp": "fixture-reader",
        "aud": "fixture-api",
    }
    accepted = await auth.claims(
        provider.token(claims),
        audience="fixture-api",
        access=True,
        allowed_clients={"fixture-reader"},
    )
    assert accepted["sub"] == "service"


async def test_logout_wins_while_refresh_in_flight(oidc):
    auth, provider = oidc
    cookie, _, _ = await sign_in(auth, provider)
    logout = request(cookie=cookie, headers=[(b"origin", b"https://app.example")])
    assert await auth.authenticate(logout) is not None
    provider.now[0] += 301
    provider.resume_refresh.clear()
    refresh = asyncio.create_task(auth.authenticate(request(cookie=cookie)))
    try:
        await asyncio.wait_for(provider.refresh_entered.wait(), 3)
        with pytest.raises(AuthError):
            await auth.logout(logout, "wrong")
        assert (await auth.logout(logout, logout.state.csrf)).status_code == 204
    finally:
        provider.resume_refresh.set()
        result = await refresh
    assert result is None
    assert await auth.authenticate(request(cookie=cookie)) is None


async def test_cancelled_refresh_never_restores_old_token(oidc):
    auth, provider = oidc
    cookie, _, _ = await sign_in(auth, provider)
    provider.now[0] += 301
    provider.resume_refresh.clear()
    refresh = asyncio.create_task(auth.authenticate(request(cookie=cookie)))
    try:
        await asyncio.wait_for(provider.refresh_entered.wait(), 3)
    finally:
        refresh.cancel()
        with pytest.raises(asyncio.CancelledError):
            await refresh
    row = await auth.store.get_session(auth.scope, auth.digest(cookie.split("=", 1)[1]))
    assert row.revision < 0 and row.payload == b""
    assert provider.refreshes == 1


@pytest.mark.parametrize("during_refresh", [False, True])
async def test_idle_expiry_is_not_extended(oidc, during_refresh):
    auth, provider = oidc
    cookie, _, _ = await sign_in(auth, provider)
    if not during_refresh:
        provider.now[0] += auth.settings.idle_seconds
        assert await auth.authenticate(request(cookie=cookie)) is None
        assert provider.refreshes == 0
        return
    provider.now[0] += 301
    provider.resume_refresh.clear()
    refresh = asyncio.create_task(auth.authenticate(request(cookie=cookie)))
    try:
        await asyncio.wait_for(provider.refresh_entered.wait(), 3)
        provider.now[0] += auth.settings.idle_seconds
    finally:
        provider.resume_refresh.set()
        result = await refresh
    assert result is None


async def test_refresh_optional_nonce_but_present_nonce_must_match(oidc):
    auth, provider = oidc
    cookie, _, _ = await sign_in(auth, provider)
    provider.now[0] += 301
    provider.omit_nonce = True
    assert await auth.authenticate(request(cookie=cookie)) is not None
    provider.now[0] += 301
    provider.omit_nonce = False
    provider.id_changes = {"nonce": "wrong"}
    assert await auth.authenticate(request(cookie=cookie)) is None


async def test_signature_algorithm_service_allowlist_and_audience(oidc):
    auth, provider = oidc
    claims = {
        "iss": provider.issuer,
        "sub": "service",
        "iat": int(provider.now[0]),
        "exp": int(provider.now[0]) + 60,
        "typ": "Bearer",
        "azp": "fixture-reader",
        "aud": "fixture-api",
        "scope": "protocols:read",
    }
    token = provider.token(claims)
    result = await auth.claims(
        token, audience="fixture-api", access=True, allowed_clients=frozenset({"fixture-reader"})
    )
    assert result["sub"] == "service"
    with pytest.raises(AuthError):
        await auth.claims(token, audience="fixture-api", access=True, allowed_clients=frozenset())
    with pytest.raises(AuthError):
        await auth.claims(token, audience="fixture-web", access=True)
    foreign = RSAKey.generate_key(2048, private=True, parameters={"kid": "runtime-key"})
    invalid = jwt.encode({"alg": "RS256", "kid": "runtime-key"}, claims, foreign)
    with pytest.raises(AuthError):
        await auth.claims(
            invalid, audience="fixture-api", access=True, allowed_clients={"fixture-reader"}
        )
    unsigned = "eyJhbGciOiJub25lIn0.e30."
    with pytest.raises(AuthError):
        await auth.claims(
            unsigned, audience="fixture-api", access=True, allowed_clients={"fixture-reader"}
        )
