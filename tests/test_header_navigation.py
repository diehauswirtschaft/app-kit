import pytest
from jinja2 import Environment, PackageLoader, StrictUndefined, select_autoescape

from app_kit.header_navigation import header_navigation, require_portal_href


def test_config_and_optional_menu_without_module_strip():
    with pytest.raises(ValueError):
        require_portal_href("")
    env = Environment(
        loader=PackageLoader("app_kit", "templates"),
        autoescape=select_autoescape(),
        undefined=StrictUndefined,
    )
    template = env.get_template("header.html")
    params = {
        "app_title": "Mittagstisch",
        "header_nav": header_navigation(
            "staging",
            "Mittagstisch",
            "/meine",
            avatar_links=[{"label": "Buchungen", "href": "/meine"}],
            module_nav=[{"label": "Übersicht", "href": "/"}],
            help_href="//example.invalid",
        ),
        "user": {"name": "Mitglied"},
        "user_initials": lambda name: name[0],
        "csrf": "",
        "overview_active": False,
    }
    html = template.render(params)
    assert 'href="https://start-staging.dhw.wien/"' in html
    assert "data-dhw-sticky-tabs" in html
    assert header_navigation("staging", "Vorschau", "/", sticky_tabs=False)["sticky_tabs"] is False
    assert 'href="/meine" aria-current="page"' in html
    assert "dhw-module-nav" not in html and "example.invalid" not in html
    params["header_nav"]["guard"] = {"mode": "block", "message": "Aufnahme läuft"}
    blocked = template.render(params)
    assert 'href="/meine"' not in blocked and 'aria-describedby="dhw-nav-lock"' in blocked
    assert 'type="submit" disabled' in blocked


def test_unique_most_specific_active_target():
    entries = [
        {"label": value, "href": value} for value in ["/", "/meine", "/meine/detail", "/meine-alt"]
    ]
    nav = header_navigation("start", "Meeting", "/meine/detail/123", module_nav=entries)
    assert [(item["href"], item["current"]) for item in nav["tabs"] if item["current"]] == [
        ("/meine/detail", "location")
    ]
