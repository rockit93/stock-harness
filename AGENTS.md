# AlphaDock Repository Instructions

## Scope

These instructions apply to the entire repository. More specific `AGENTS.md` files may add constraints for their own subdirectories.

## Product identity

- User-facing product name: `AlphaDock` / `阿尔法舱`.
- Internal API names, storage keys, and compatibility identifiers may continue to use `stock-harness` unless a migration is explicitly implemented.
- The product is a local quantitative research workspace, not an investment-advice or automatic stock-recommendation system.

## Frontend theme contract

The web application supports `midnight`, `obsidian`, and `daylight`. `midnight` is the default.

- Theme tokens and third-party component overrides live in `frontend/web/src/themes.css`.
- Application components must consume the existing `--app-*` tokens for surfaces, text, borders, shadows, hover states, and accent colors.
- Do not introduce hard-coded white/light cards into a themed workspace. Avoid new `background: white`, `background: #fff`, and fixed gray text in business components.
- Dedicated semantic colors are allowed for danger, warning, success, and financial rise/fall states. General primary actions and selection states use `--app-accent` and `--app-accent-bg`.
- Prefer fixing a shared Arco Design or Element Plus selector in `themes.css` over adding the same page-level override in multiple modules.
- Fixed-column tables must highlight the complete row on hover. Verify normal cells, striped rows, left/right fixed cells, selected rows, and action cells.
- Native controls inside legacy forms must receive the same background, foreground, border, focus-ring, disabled, and placeholder treatment as component-library controls.
- Drawers, modals, dropdowns, popovers, empty states, code blocks, and sticky footers are part of theme acceptance, not optional follow-up work.
- Component-scoped styles may define layout, but theme-dependent colors should use variables so all three themes remain valid.

## Visual acceptance checklist

For every frontend UI change, check:

1. `midnight`, `obsidian`, and `daylight`.
2. Default, hover, focus, active/selected, disabled, loading, and empty states.
3. Main content plus any drawer, modal, dropdown, tooltip, or popover opened by the workflow.
4. Text contrast for headings, body copy, metadata, placeholders, and code.
5. Table row hover across fixed and non-fixed columns.
6. Responsive behavior at the existing `980px` and `700px` breakpoints when relevant.

## Verification

After frontend changes, run:

```bash
cd frontend/web
npm run build
```

After Node API changes, run:

```bash
cd backend/node-api
npm run build
```

Preserve unrelated user changes in the working tree. Do not rewrite generated runtime data or rename compatibility storage keys as part of visual work.
