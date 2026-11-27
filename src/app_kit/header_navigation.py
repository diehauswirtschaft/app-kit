"""Build the Jinja header model from app-owned configuration (AP-02)."""

import re
from collections.abc import Iterable, Mapping

_PORTALS = {"start": "https://start.dhw.wien/", "staging": "https://start-staging.dhw.wien/"}


def require_portal_href(target: str) -> str:
    """Call during bootstrap; never select a default from browser or request data."""
    if target not in _PORTALS:
        raise ValueError("Explicit portal target start or staging required")
    return _PORTALS[target]


def _is_local_nav_path(href: object) -> bool:
    return (
        isinstance(href, str)
        and re.fullmatch(r"/(?:[a-zA-Z0-9_.~-]+/)*[a-zA-Z0-9_.~-]*", href) is not None
        and not {".", ".."}.intersection(href.split("/"))
    )


def local_nav_links(
    items: Iterable[Mapping], pathname: str, limit: int | None = None
) -> list[dict]:
    links = []
    seen = set()
    best = None
    for item in items:
        href, label = item.get("href"), item.get("label")
        if (
            not isinstance(label, str)
            or not label.strip()
            or not _is_local_nav_path(href)
            or href in seen
        ):
            continue
        seen.add(href)
        short = item.get("short_label")
        entry = {
            "href": href,
            "label": label.strip(),
            "current": None,
            "short_label": short.strip() if isinstance(short, str) else None,
        }
        links.append(entry)
        exact = href == pathname
        base = href.rstrip("/")
        if exact or (base and item.get("match") != "exact" and pathname.startswith(base + "/")):
            if best is None or len(href) > len(best["href"]):
                best = entry
        if limit is not None and len(links) >= limit:
            break
    if best is not None:
        best["current"] = "page" if best["href"] == pathname else "location"
    return links


def header_navigation(
    target: str,
    title: str,
    pathname: str,
    *,
    module_nav=(),
    avatar_links=(),
    help_href=None,
    guard=None,
    sticky_tabs=True,
    module_home=None,
) -> dict:
    # AP-02: an embedded module's registered entry must be a local path.
    app_home = module_home if _is_local_nav_path(module_home) else "/"
    menu = [*avatar_links]
    if help_href:
        menu.append({"label": f"Hilfe zu {title}", "href": help_href})
    return {
        "portal_href": require_portal_href(target),
        "app_home": app_home,
        "app_home_active": pathname == app_home,
        "tabs": local_nav_links(module_nav, pathname, 5),
        "menu": local_nav_links(menu, pathname),
        "guard": guard,
        "sticky_tabs": sticky_tabs,
    }
