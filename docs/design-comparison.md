# Budget ↔ Start comparison and pilot decision

Source inspection: Budget design commit `da1a59a6b589ba41ebc02f7027a092ab40a54098`; portal `services/bff/src/app.css` at `2018317505bf58b9a83f1482335ba07e537f47fd`. Owner approved defaults: Budget-inspired new apps, system dark mode informed by Start, portal itself unchanged, temporary system font without proprietary font redistribution. Meeting/Protokoll, not Leitungskreis, are the first consumers of this implementation.

| Area | Budget source | Portal source | app-kit pilot |
| --- | --- | --- | --- |
| Light base | white, carbon text | white/cream surfaces, navy headings | white/carbon, flat/square |
| Primary action | latest README allows Amber; token description still forbids it | navy, Aqua in dark mode | Amber with carbon text, both modes |
| Geometry | square, thin lines | 12px radius, shadows | square, thin lines, no decorative shadows |
| Dark | not present in tokens/generator | system preference, navy surfaces, pale text | system preference, navy-derived surfaces, bright text/focus |
| Font | Inter pending Moderat license | locally hosted Moderat | system font; no font files included |
| Select controls | experimental base-select plus fallback | native controls | native accessible controls, color-scheme-aware |
| Long-form content | print-inspired treatment | web-readable left alignment | left-aligned web content, visible focus/reflow |

Public portal check on 2026-11-11: verified HTTPS root 200, public stylesheet `/_app/immutable/assets/0.DHt1Slym.css`, SHA256 `9d12630721c0c43a56a2bdbca61cae579bf6e35526c0fbff0b91143f3bba6418`; contains system dark media query. Only anonymous public stylesheet bytes were examined, no session/cookie/token headers saved. This supplements source comparison, not a pixel-identical authenticated portal audit.

The new dark palette is a web adaptation, not a claim that the print guide defines dark mode. Functional danger/success/focus colors remain accessible. The original print PDF/artifact was not re-reviewed; no speculative print rules or licensed font assets were imported.

Local Chromium Protokoll editor/confirmation/publication/export flow: light/dark × 320/390/1280 CSS pixels, Axe WCAG A/AA/2.1/2.2 tags and overflow checks, all zero findings in the recorded synthetic run. This is not a certification of every future page or a real-user SSO test. Native browser controls retain their functional shape. Color text pairs also have explicit >=4.5:1 tests.
