"""Shared dHW building blocks. No application identity or data is embedded here."""

from importlib.resources import files

__version__ = "0.1.0a1"


def design_css() -> str:
    """Consumers package this fixed asset at build time, never from a live CDN."""
    return "\n".join(
        files("app_kit").joinpath("assets/" + name).read_text(encoding="utf-8")
        for name in ("tokens.css", "header.css", "app-kit.css")
    )
