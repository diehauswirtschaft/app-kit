"""Shared dHW building blocks. No application identity or data is embedded here."""

from importlib.resources import files

__version__ = "0.1.0a3"


def brand_logo_svg(*, dark: bool = False) -> bytes:
    """AP-02: only packaged, script-free brand artwork; never caller paths."""
    name = "logo-dark.svg" if dark else "logo.svg"
    return files("app_kit").joinpath("assets/" + name).read_bytes()


def design_css() -> str:
    """Consumers package this fixed asset at build time, never from a live CDN."""
    return "\n".join(
        files("app_kit").joinpath("assets/" + name).read_text(encoding="utf-8")
        for name in ("tokens.css", "header.css", "app-kit.css")
    )
