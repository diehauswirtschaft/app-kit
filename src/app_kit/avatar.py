"""ERP photo policy and transport, independent of app sessions and SQLAlchemy.

The consumer must check its own session before serving the returned bytes and
expose only a same-origin image URL to its header (AP-01, ASI-002/006).
"""

import asyncio
import re
from dataclasses import dataclass
from urllib.parse import unquote, urlsplit

import httpx

_LIMIT = 1024 * 1024
_RASTER = {"image/jpeg", "image/png", "image/webp"}


def erp_picture_url(claim: object) -> str | None:
    if not isinstance(claim, str) or len(claim) > 2048 or re.search(r"[\x00-\x20\x7f\\?#]", claim):
        return None
    try:
        url = urlsplit(claim)
        if url.scheme != "https" or url.netloc != "erp.diehauswirtschaft.at":
            return None
        if not re.fullmatch(r"/files/[^/]+", url.path):
            return None
        name = unquote(url.path[len("/files/") :], errors="strict")
        # A signed claim is not an outbound allowlist; don't proxy ERP API routes.
        if name in {".", ".."} or re.search(r"[/\\%?#\x00-\x1f\x7f]", name):
            return None
        return claim
    except ValueError:
        return None


@dataclass(frozen=True)
class Avatar:
    content: bytes
    media_type: str


def _media_type(body: bytearray) -> str | None:
    if body.startswith(b"\x89PNG\r\n\x1a\n"):
        return "image/png"
    if body.startswith(b"\xff\xd8\xff"):
        return "image/jpeg"
    if body.startswith(b"RIFF") and body[8:12] == b"WEBP":
        return "image/webp"
    return None


async def fetch_erp_avatar(
    claim: object, *, transport: httpx.AsyncBaseTransport | None = None
) -> Avatar | None:
    url = erp_picture_url(claim)
    if not url:
        return None
    try:
        # No ambient proxy, credentials, redirects or unbounded decompression.
        async with (
            asyncio.timeout(2.5),
            httpx.AsyncClient(
                transport=transport, trust_env=False, follow_redirects=False
            ) as client,
            client.stream("GET", url, headers={"Accept-Encoding": "identity"}) as response,
        ):
            media_type = response.headers.get("content-type", "").split(";", 1)[0].strip().lower()
            length = response.headers.get("content-length")
            if (
                response.status_code != 200
                or media_type not in _RASTER
                or response.headers.get("content-encoding", "identity").lower() != "identity"
                or (
                    length is not None
                    and (not re.fullmatch(r"[0-9]{1,7}", length) or int(length) > _LIMIT)
                )
            ):
                return None
            body = bytearray()
            async for chunk in response.aiter_bytes(chunk_size=16384):
                if len(body) + len(chunk) > _LIMIT:
                    return None
                body.extend(chunk)
            if _media_type(body) == media_type:
                return Avatar(bytes(body), media_type)
    except (TimeoutError, httpx.HTTPError, httpx.InvalidURL):
        # Missing pictures degrade to initials; don't expose or log ERP URLs.
        return None
    return None
