import json
from pathlib import Path

import httpx
import pytest

from app_kit.avatar import erp_picture_url, fetch_erp_avatar

SOURCE = "https://erp.diehauswirtschaft.at/files/portrait.png"
PNG = b"\x89PNG\r\n\x1a\n"
VECTORS = json.loads(
    (Path(__file__).resolve().parent / "fixtures" / "erp-avatar-vectors.json").read_text()
)


@pytest.mark.parametrize("claim", VECTORS["valid"])
def test_accept_shared_valid_avatar_vectors(claim):
    assert erp_picture_url(claim) == claim


@pytest.mark.parametrize("claim", VECTORS["invalid"])
def test_reject_untrusted_sources(claim):
    assert erp_picture_url(claim) is None


@pytest.mark.asyncio
async def test_avatar_is_bounded_raster_without_credentials_or_redirects():
    assert erp_picture_url(SOURCE) == SOURCE
    for status, body, expected in [
        (200, PNG, PNG),
        (302, PNG, None),
        (200, b"<svg>", None),
        (200, PNG + bytes(1024 * 1024), None),
    ]:

        def respond(request):
            assert str(request.url) == SOURCE
            assert "authorization" not in request.headers and "cookie" not in request.headers
            return httpx.Response(
                status,
                headers={"content-type": "image/png", "location": "https://example.invalid"},
                content=body,
            )

        image = await fetch_erp_avatar(SOURCE, transport=httpx.MockTransport(respond))
        assert (image.content if image else None) == expected
