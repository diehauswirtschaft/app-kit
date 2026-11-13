import pytest

from app_kit import __version__, brand_logo_svg, design_css, shell_asset, user_initials
from app_kit.secrets import UnsafeSecret, read_secret


def test_runtime_version_matches_the_installed_distribution():
    from importlib.metadata import version

    assert __version__ == version("dhw-app-kit")


def test_assets_are_offline_system_dark_mode_without_fonts_or_scripts():
    css = design_css()
    assert "prefers-color-scheme: dark" in css and "prefers-reduced-motion" in css
    assert "url(" not in css and "@font-face" not in css and "@import" not in css
    assert "--dhw-amber: #fbd235" in css and ".dhw-header" in css


@pytest.mark.parametrize(
    "foreground,background",
    [
        ("181a20", "ffffff"),
        ("153362", "ffffff"),
        ("ffffff", "153362"),
        ("545760", "ffffff"),
        ("181a20", "fbd235"),
        ("ffffff", "10264a"),
        ("e1dfdb", "10264a"),
        ("abd4c4", "10264a"),
        ("f2a69f", "10264a"),
        ("8b2533", "ffffff"),
    ],
)
def test_semantic_text_contrast_aa(foreground, background):
    def luminance(value):
        channels = [int(value[i : i + 2], 16) / 255 for i in (0, 2, 4)]
        linear = [v / 12.92 if v <= 0.04045 else ((v + 0.055) / 1.055) ** 2.4 for v in channels]
        return sum(v * weight for v, weight in zip(linear, (0.2126, 0.7152, 0.0722)))

    a, b = sorted([luminance(foreground), luminance(background)])
    assert (b + 0.05) / (a + 0.05) >= 4.5


def test_brand_assets_are_exact_start_vectors_without_fonts_scripts_or_external_refs():
    import hashlib
    import xml.etree.ElementTree as ET

    expected = {
        (False, False): "c77ea075fc17aff63e437bc5a9520b93789939c1e231f28bbd98e1243e9603d6",
        (True, False): "e5138b7d43479d44149911379323af074d1de72f1b6f66215c38cd34d09bd7bf",
        (False, True): "c23539f053248c734192913b13e76377c2e1311c168dc52d37c51ab7021b0ee3",
        (True, True): "b353a3c5008c654f785b7785cfa32ea1d0bf325a8e72e9b6ec138dbf30c4b233",
    }
    for (dark, signet), digest in expected.items():
        data = brand_logo_svg(dark=dark, signet=signet)
        assert hashlib.sha256(data).hexdigest() == digest
        root = ET.fromstring(data)
        assert root.attrib["viewBox"] == ("0 0 306 185" if signet else "0 0 1538 185")
        assert {node.tag.rsplit("}", 1)[-1] for node in root.iter()} <= {"svg", "g", "mask", "path"}
        for node in root.iter():
            assert not any(name.lower().startswith("on") for name in node.attrib)
            for name, value in node.attrib.items():
                if name.rsplit("}", 1)[-1] == "href":
                    assert value.startswith("#")


def test_jinja_brand_preserves_escaping_and_independent_local_logout():
    import secrets
    from types import SimpleNamespace

    from jinja2 import Environment, PackageLoader, select_autoescape

    env = Environment(
        loader=PackageLoader("app_kit", "templates"), autoescape=select_autoescape(["html"])
    )
    env.globals["user_initials"] = user_initials
    markup = env.get_template("header.html").render(
        app_title="<script>unsafe</script>",
        user=SimpleNamespace(name="<img onerror=unsafe>"),
        csrf=secrets.token_urlsafe(32),
    )
    assert "<script>" not in markup and "<img onerror" not in markup
    assert "&lt;script&gt;" in markup and "&lt;img onerror" in markup
    assert "/assets/app-kit/logo-dark.svg" in markup and 'width="1538" height="185"' in markup
    assert 'action="/auth/logout"' in markup and "Hier abmelden" in markup
    assert "vlan" not in markup.lower()
    assert '<div class="dhw-brand">' in markup
    assert 'class="dhw-portal-link" data-dhw-portal-home href="https://start.dhw.wien/"' in markup
    assert 'class="dhw-app-name" href="/"' in markup
    assert 'class="dhw-app-separator" aria-hidden="true"' in markup
    assert ">Übersicht</a>" not in markup
    assert "/assets/app-kit/signet-dark.svg" in markup


def test_short_app_names_cannot_wrap_inside_the_title_box():
    css = design_css()
    assert "white-space: nowrap" in css
    assert "min-width: 44px" in css
    assert ".dhw-brand { display: inline-flex; flex-wrap: wrap;" in css


def test_app_label_metrics_and_optional_portal_wordmark_stay_shared():
    css = design_css()
    assert "font-size-adjust: .5" in css
    assert ".dhw-app-separator { width: 1px; flex: 0 0 1px;" in css
    assert ".dhw-wordmark-mobile .dhw-brand-logo { display: block; }" in css
    assert ".dhw-wordmark-mobile .dhw-brand-signet { display: none; }" in css
    assert "width: clamp(7.5rem, 36vw, 9rem)" in css


def test_header_assets_and_initials_are_bounded_public_helpers():
    assert user_initials("  Erika Musterfrau ") == "EM"
    assert user_initials("") == "M"
    assert b"capturePortalEntry" in shell_asset("shell.js")
    assert b"OIDC" in shell_asset("navigation.js")
    for name in ("../auth.py", "session-key", "navigation.d.ts"):
        with pytest.raises(ValueError):
            shell_asset(name)


def test_secret_descriptors_reject_links_permissions_empty_and_fifo(tmp_path):
    import os
    import secrets

    original = tmp_path / "source"
    original.write_text(secrets.token_urlsafe(32))
    original.chmod(0o600)
    assert bool(read_secret(original))
    original.chmod(0o644)
    with pytest.raises(UnsafeSecret):
        read_secret(original)
    original.chmod(0o600)
    link = tmp_path / "link"
    link.symlink_to(original)
    with pytest.raises(UnsafeSecret):
        read_secret(link)
    empty = tmp_path / "empty"
    empty.touch(mode=0o600)
    with pytest.raises(UnsafeSecret):
        read_secret(empty)
    fifo = tmp_path / "fifo"
    os.mkfifo(fifo, 0o600)
    with pytest.raises(UnsafeSecret):
        read_secret(fifo)
