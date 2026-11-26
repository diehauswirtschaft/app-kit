import httpx
import pytest

from app_kit.avatar import erp_picture_url, fetch_erp_avatar

SOURCE = "https://erp.diehauswirtschaft.at/files/portrait.png"
PNG = b"\x89PNG\r\n\x1a\n"


@pytest.mark.parametrize(
    "claim",
    [
        None,
        SOURCE + "?x=1",
        SOURCE.replace("https", "http"),
        SOURCE.replace(".at/", ".at.invalid/"),
        SOURCE.replace("/files/", "/api/"),
        SOURCE.replace("portrait.png", "%2e%2e"),
        SOURCE.replace("portrait.png", "a%2fb.png"),
        SOURCE.replace("portrait.png", "a%252fb.png"),
    ],
)
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
