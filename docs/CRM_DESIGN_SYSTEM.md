# Prime Champs CRM design system

## Context

The CRM is an operating environment for research, review, outreach, and partnership management. People use it repeatedly and under time pressure, so it should feel focused, credible, and fast—not promotional or decorative.

The public Prime Champs website supplies the brand language: athletic editorial typography, ink navy, cyan signal color, coral action color, sharp geometry, strong photography, and compact mono labels. The CRM translates that language into a higher-density application system.

## Audit findings

### First impression

The previous CRM looked like an unbranded dashboard starter. Six unrelated accent colors appeared simultaneously on the dashboard, rounded cards and soft shadows weakened the athletic identity, and nearly every piece of information received equal visual weight.

### Visual design

- **Decorative color** — Blue, yellow, purple, green, emerald, and indigo were used as interchangeable card decoration. Color no longer communicated status or action.
- **Weak hierarchy** — Page titles used the same generic sans-serif family as table text and navigation. Important work did not have a strong entry point.
- **Soft surface language** — Rounded cards, pastel fills, and diffuse shadows conflicted with the sharp, technical public website.
- **Inconsistent controls** — Primary actions changed between blue, purple, green, and gradients. Similar buttons did not look related.
- **Emoji as interface icons** — Research and history headings used emoji while the rest of the app used line icons, making the product feel assembled from different kits.

### Interface design

- The horizontal navigation compressed ten destinations into one line and gave Research—the core workflow—the same weight as secondary settings.
- Large loading screens replaced the entire work area with one sentence, which made the product feel slow and unfinished.
- Repeated cards used excessive vertical space, reducing the amount of research and pipeline information visible at once.
- Page-level actions were not consistently positioned, so users had to rescan every screen.

## System

### Palette

- `Ink #06111F` — navigation, headings, high-emphasis text
- `Ink raised #0D1D2D` — elevated dark surfaces
- `Cyan #3DE6EF` — active navigation, focus, progress, primary action
- `Coral #FF5D49` — destructive or high-attention actions
- `Blue #1258CF` — links and selected information states
- `Paper #EEF2F4` — workspace background
- `Paper bright #F9FBFC` — content surfaces
- `Chrome #AAB7C3` — secondary dark-surface text

Green, amber, and red are reserved for success, warning, and failure. They are not decorative category colors.

### Type

- **Barlow Condensed** — page titles, metric values, and section headings
- **Manrope** — body copy, controls, tables, and forms
- **IBM Plex Mono** — navigation labels, eyebrows, metadata, and compact status labels

### Geometry

- 2–3 px radii for application surfaces and controls
- 1 px structural borders instead of default card shadows
- 32 px desktop workspace rhythm; 18 px mobile rhythm
- Dense 40–44 px controls and 56–68 px data rows

### Interaction rules

- Every screen has one clear primary action.
- Cyan means active or ready; coral means destructive/high attention.
- Progress and loading preserve page structure instead of presenting a blank canvas.
- Motion is brief, functional, and disabled under reduced-motion preferences.
- Focus states are visible and use the same cyan signal color as the public brand.
