"""Shared dHW building blocks. No application identity or data is embedded here."""

from importlib.resources import files

__version__ = "0.1.0a7"


def brand_logo_svg(*, dark: bool = False, signet: bool = False) -> bytes:
    """AP-02: only packaged, script-free brand artwork; never caller paths."""
    prefix = "signet" if signet else "logo"
    name = prefix + ("-dark.svg" if dark else ".svg")
    return files("app_kit").joinpath("assets/" + name).read_bytes()


def user_initials(name: str) -> str:
    return "".join(part[0] for part in (name.strip() or "Mitglied").split()[:2]).upper()


def shell_asset(name: str) -> bytes:
    # AP-02: a closed set of public modules, never a browser-selected file path.
    if name not in {"navigation.js", "shell.js"}:
        raise ValueError("Unknown header asset")
    return files("app_kit").joinpath("assets/" + name).read_bytes()


def design_css() -> str:
    """Consumers package this fixed asset at build time, never from a live CDN."""
    return "\n".join(
        files("app_kit").joinpath("assets/" + name).read_text(encoding="utf-8")
        for name in ("tokens.css", "header.css", "app-kit.css")
    )
