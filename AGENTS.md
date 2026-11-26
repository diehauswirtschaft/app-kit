# app-kit

Shared library, not an application. Meeting and Protokoll are the first pilots (owner decision).

- GPL-3.0-only. No credentials, generated test secrets, participant data or proprietary font files in Git.
- Server-side opaque sessions only; access-token roles only; deny by default. Follow AP-01.
- Use established OAuth/JWT/crypto libraries; never implement cryptography or JWT parsing.
- Consumers pin a release/commit; no runtime CDN imports, template copies or shared subdomain cookies.
- German UI, semantic HTML, visible focus, system dark mode, WCAG 2.2 AA.
- Explain security decisions and invariants in comments, cite AP-01/AP-05 or ASI findings.
- Schema creation is an explicit migration command, never sample seeding or implicit startup DDL.
- No Keycloak/network/legacy changes, no Main merges, no force pushes. Work on feature branches.
- No changes under contracts/, docs/requirements/ or docs/architecture/ in any repository.
