import pytest

from app_kit import design_css
from app_kit.secrets import UnsafeSecret, read_secret


def test_assets_are_offline_system_dark_mode_without_fonts_or_scripts():
    css = design_css()
    assert "prefers-color-scheme: dark" in css and "prefers-reduced-motion" in css
    assert "url(" not in css and "@font-face" not in css and "@import" not in css
    assert "--dhw-amber: #fbd235" in css and ".dhw-header" in css


@pytest.mark.parametrize(
    "foreground,background",
    [
        ("181a20", "ffffff"),
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
