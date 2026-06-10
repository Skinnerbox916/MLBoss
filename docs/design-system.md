# MLBoss Design System

This document defines the visual design standards for MLBoss, including colors, typography, and component patterns. All design tokens are implemented as CSS variables and wired into Tailwind CSS utilities.

## Color Palette

### Brand Colors
The color palette is derived from the MLBoss logo and creates a cohesive, professional baseball-themed identity:

| Color | Hex | Usage | Tailwind Class |
|-------|-----|-------|----------------|
| **Prussian Blue** | `#132F43` | Primary brand, main UI elements | `bg-primary`, `text-primary` |
| **Dark Goldenrod** | `#C89222` | Accent, CTAs, highlights | `bg-accent`, `text-accent` |
| **Isabelline** | `#F9F6F1` | Primary background (light mode) | `bg-background` |
| **Dark Spring Green** | `#1F8A5B` | Success states, positive metrics | `bg-success`, `text-success` |
| **Sea Green** | `#4C956C` | Success secondary, lighter success states | `bg-success-light` |
| **Crimson Red** | `#B91C1C` | Error states, destructive actions | `bg-error`, `text-error` |

### Color Variants — 4 stops only
Each brand color (`primary`, `accent`, `success`, `error`) exposes exactly **four** numbered
intensity stops, generated via `color-mix()`. Each stop earns its place; there are intentionally
no `50/200/300/400/600/800` stops. They were removed because a 10-stop ramp produces near-duplicate
neighbors (700 vs 800) that different agents pick inconsistently — drift, not expressiveness.

```css
--color-primary-100: /* opaque soft fill — badges, focus tiles, table-row stripes */
--color-primary-500: /* the brand itself — text, nav, buttons, icons (= var(--primary)) */
--color-primary-700: /* darker brand — button hover, dark-mode chrome */
--color-primary-900: /* deepest — dark-mode background, text-on-tint */
```

`accent`, `success`, and `error` follow the identical four-stop pattern.

**For everything in between, use alpha mixing — not a numbered stop.** Tailwind's slash modifier
mixes the brand color with transparency over whatever surface is behind it:

```tsx
<div className="bg-primary/10">structural wash (zebra stripe, chip fill, hover bar)</div>
<span className="text-accent/60">de-emphasized accent</span>
<div className="border-success/40">tinted hairline</div>
```

**Usage Examples:**
```tsx
<div className="bg-accent/10 text-accent-900">Light tint, dark readable text</div>
<button className="bg-primary hover:bg-primary-700">Primary button</button>
<button className="bg-accent text-white hover:bg-accent-700">Call to action</button>
<div className="bg-error-100 text-error-900">Error message</div>
```

> **Do not reintroduce `50/200/300/400/600/800`.** They are not defined in `globals.css`, so the
> utility silently produces no CSS. If you reach for a sub-`100` wash, use `color/N` alpha instead.

### Dark Mode
Dark mode automatically inverts key colors while maintaining contrast:

```css
@media (prefers-color-scheme: dark) {
  :root {
    --background: #132F43;   /* Prussian blue becomes background */
    --foreground: #F9F6F1;   /* Isabelline becomes text */
    --accent: #d9a63a;       /* Brightened goldenrod for contrast */
    --success: #4C956C;      /* Sea green for better visibility */
    --success-light: #86C39A; /* Lighter green variant */
    --error: #DC2626;         /* Crimson red for errors */
    --error-light: #EF4444;   /* Lighter red variant */
  }
}
```

## Typography

### Font Hierarchy
MLBoss uses a three-font system that balances character with readability:

| Purpose | Font | Variable | Usage |
|---------|------|----------|-------|
| **Display/Headings** | Pacifico | `--font-display` | Headers, titles, brand elements |
| **Body Text** | Quicksand | `--font-body` | Paragraphs, UI text, labels |
| **Monospace** | JetBrains Mono | `--font-mono` | Code, data tables, numeric display |

### Font Loading
Fonts are optimized through Next.js Google Fonts with `display: "swap"` in `src/app/layout.tsx`:

```tsx
import { Pacifico, Quicksand, JetBrains_Mono } from "next/font/google";

const displayFont = Pacifico({
  variable: "--font-display",
  weight: "400", // Only weight available
  subsets: ["latin"],
  display: "swap",
});

const bodyFont = Quicksand({
  variable: "--font-body",
  weight: ["300", "400", "500", "600", "700"],
  subsets: ["latin"],
  display: "swap",
});

const monoFont = JetBrains_Mono({
  variable: "--font-mono",
  subsets: ["latin"],
  display: "swap",
});
```

### Typography Scale
Base typography is automatically applied to HTML elements. The scale is tuned for **Pacifico**, a decorative script font that visually reads ~20% larger than a comparable sans-serif at the same px — `h2`/`h3` are deliberately compact so card and panel titles don't dominate their surfaces.

All headings use `line-height: 1.35`. Pacifico has dramatic descenders (`y`, `g`, `p`, `j`) and a tighter value (e.g. 1.2) lets them clip into any sibling text positioned immediately below the heading. If a future design ever introduces a sans-serif heading variant, give it its own line-height — 1.35 is Pacifico-specific, not a universal heading default.

| Element | Font | Size | Role |
|---------|------|------|------|
| `h1` | Pacifico | `clamp(2rem, 5vw, 3rem)` | Page titles (32-48px) |
| `h2` | Pacifico | `clamp(1.25rem, 2vw, 1.625rem)` | Panel / section heads (20-26px) |
| `h3` | Pacifico | `clamp(1.0625rem, 1.5vw, 1.375rem)` | Card titles (17-22px) |
| `h4` | Pacifico | `clamp(1rem, 1.25vw, 1.125rem)` | Sub-headings (16-18px) |
| `h5` | Pacifico | `1rem` | Minor labels (16px) |
| `h6` | Pacifico | `0.875rem` | Smallest heading (14px) |
| `p, li` | Quicksand | `1rem` | Body text (16px, line-height 1.6) |
| `small` | Quicksand | `0.875rem` | 14px |
| `code, pre` | JetBrains Mono | `0.875rem` | 14px with background |

**Where each level lands in the UI:**
- `h1` → page titles like "Today", "Streaming", "Roster" (one per page)
- `h2` → `Panel` titles ("Matchup Categories – Week 6", "All Batters")
- `h3` → `DashboardCard` titles ("Lineup Issues", "Roster Health")
- `h4`-`h6` → sub-sections inside cards/panels

If a heading visually feels wrong, fix it here in the base layer (and the mirrored `sizeClass` map in `Heading.tsx`) rather than overriding sizes per component. The whole point of this table is one source of truth.

### Typography Utilities
Custom CSS utilities for font control:

```css
.font-display { font-family: var(--font-display), system-ui, sans-serif; }
.font-body { font-family: var(--font-body), system-ui, sans-serif; }
.font-mono { font-family: var(--font-mono), ui-monospace, monospace; }
.font-numeric { 
  font-variant-numeric: tabular-nums; 
  font-feature-settings: "tnum";
}
```

**Usage Examples:**
```tsx
<span className="font-display">Stylized heading text</span>
<p className="font-body">Standard body text</p>
<code className="font-mono">console.log()</code>
<td className="font-mono font-numeric text-right">1,234.56</td>
```

### React Typography Components
Flexible components in `@/components/typography`:

#### Heading Component
```tsx
import { Heading } from '@/components/typography';

// Semantic HTML with proper styling
<Heading as="h1">Page Title</Heading>
<Heading as="h3" size="h1">Visually Large H3</Heading>
<Heading as="h2" className="text-accent">Custom Styled</Heading>
```

**Props:**
- `as`: Semantic heading level (`h1`-`h6`, default: `h2`)  
- `size`: Visual size override (`h1`-`h6`)
- `className`: Additional styling

#### Text Component
```tsx
import { Text } from '@/components/typography';

<Text>Standard paragraph</Text>
<Text variant="muted">Secondary information</Text>
<Text as="span" variant="mono">Inline code</Text>
<Text variant="small">Fine print</Text>
```

**Props:**
- `as`: HTML element (`p`, `span`, `div`, `small`, default: `p`)
- `variant`: Style variant (`body`, `muted`, `small`, `caption`, `mono`)
- `className`: Additional styling

**Text Variants:**
- `body`: Standard body text (default)
- `muted`: Secondary/muted text
- `small`: Smaller body text  
- `caption`: Very small text for captions
- `mono`: Monospace text

### Typography Best Practices

#### Component Discipline (Enforced)
- **Always** use `<Heading>` and `<Text>` from `@/components/typography`. Raw `<h1>`–`<h6>` elements are blocked by ESLint (`react/forbid-elements`); raw `<p>` with ad-hoc `text-xs/sm/base text-muted-foreground` should be replaced with `<Text variant="caption|small|body">` so visual tweaks happen in one place.
- The base layer in `globals.css` already styles `<h1>`–`<h6>` and `<p>` correctly, so `<Heading as="h1">Title</Heading>` requires no className overrides for the default look. Reach for the `size` prop or className only when overriding the spec for a specific layout reason (e.g. dense card titles).

#### Heading Hierarchy
- Use semantic HTML (`h1`-`h6`) via the `as` prop for proper document structure
- Separate visual styling from semantic meaning using the `size` prop
- Limit to one `h1` per page
- Don't skip heading levels

#### Readability Guidelines
- **Line Length**: Keep text lines between 45-75 characters
- **Contrast**: Ensure sufficient contrast (4.5:1 minimum)
- **Responsive**: Headlines use `clamp()` for fluid scaling
- **Accessibility**: Test with screen readers

#### Font Usage
- **Pacifico**: Headings only—decorative font shouldn't be overused
- **Quicksand**: All UI text, body content, labels
- **JetBrains Mono**: Code, data tables, numeric values only

**Common Patterns:**
```tsx
// Page header
<Heading as="h1" className="text-primary mb-4">Dashboard</Heading>
<Text variant="muted">Welcome back, user</Text>

// Card content
<div className="bg-white p-6">
  <Heading as="h3" className="text-primary mb-2">Card Title</Heading>
  <Text>Card description text goes here.</Text>
</div>

// Data display
<table>
  <td className="font-mono font-numeric text-right">1,234.56</td>
</table>

// Code snippet
<Text as="code" variant="mono" className="bg-gray-100 px-2 py-1">
  npm install
</Text>
```

## Implementation

### CSS Variables Structure
All colors and fonts are defined as CSS custom properties in `src/app/globals.css`:

```css
:root {
  /* Base palette */
  --background: #F9F6F1;
  --foreground: #132F43;
  --primary: #132F43;
  --accent: #C89222;
  --success: #1F8A5B;
  --success-light: #4C956C;
  --error: #B91C1C;
  --error-light: #DC2626;
}

@theme inline {
  /* Tailwind integration */
  --color-primary: var(--primary);
  --color-accent: var(--accent);
  --color-success: var(--success);
  --color-success-light: var(--success-light);
  --color-error: var(--error);
  --color-error-light: var(--error-light);
  /* ... intensity variants via color-mix() */
}
```

### Tailwind Integration
Colors are wired into Tailwind CSS v4 via the `@theme` directive, enabling standard utility classes:

**Available Utilities:**
- Background: `bg-primary`, `bg-accent`, `bg-success`, `bg-background`
- Text: `text-primary`, `text-accent`, `text-success`, `text-foreground`
- Border: `border-primary`, `border-accent`, `border-success`
- Four intensity stops only: `bg-primary-100`, `text-accent-700`, `bg-success-900`, etc. (100/500/700/900)
- Everything between stops via alpha: `bg-primary/10`, `text-accent/60`, `border-success/40`

**Responsive & State Variants:**
```tsx
<div className="bg-primary hover:bg-primary-700 md:bg-accent">
  Responsive and interactive styles
</div>
```

## Container Intent Rubric

Every surface in the app is built out of a small, consistent vocabulary of containers. Picking the right one is what keeps the UI feeling coherent across pages. This rubric is the source of truth — when there's a mismatch, follow the table and fix the code to match.

| Container | Use when | Don't use when |
|---|---|---|
| **Page** | One primary decision, one time horizon. | You have ≥3 unrelated decisions on it. Split the page. |
| **`DashboardCard`** | Reference/summary tile on the Dashboard grid. | Outside the Dashboard (use `Panel`). |
| **`Panel`** | Section container on a non-dashboard page (lineup, roster, streaming, league). | On Dashboard (use `DashboardCard`). Anywhere you're tempted to type `bg-surface rounded-lg shadow p-4` by hand. |
| **`Tabs variant="segment"`** | Mode switch — what the user is *doing* changes between tabs (e.g. Batters vs Pitchers). | Peer views of the same data (use `underline`). |
| **`Tabs variant="underline"`** | Peer views of same-shape data (e.g. Batting vs Pitching category tables). | The user's decision changes (use `segment`). |
| **Expanding row** | On-demand detail for one entity in a list (player splits, pitcher score breakdown). | For any global/persistent UI state. |
| **`Badge`** | Non-interactive status or classification tag. | As a button — use a real `<button>`. |
| **Modal** | Destructive actions, forms, or focused flows that must block the page. | Anything that fits inline. We have none today — keep it that way unless a real reason emerges. |

### Page / `DashboardCard` / `Panel`

- **Page** is the top-level route. One horizon (today / this week / construction / reference). One primary decision.
- **`DashboardCard`** wraps grid tiles on `/dashboard`. Built-in header, loading skeleton, size prop (`sm | md | lg | xl`). Only use inside the dashboard.
- **`Panel`** is the non-dashboard equivalent. Replaces the repeated `bg-surface rounded-lg shadow p-4` pattern. Optional `title`, `action`, and `helper` props cover the common "section header + optional count on the right + helper copy" layout:

```tsx
import Panel from '@/components/ui/Panel';

<Panel title="Your Batters" action={<span className="text-caption text-muted-foreground">12 on roster</span>}>
  <RosterTable ... />
</Panel>
```

Use `noPadding` when the child needs full-bleed control (e.g. a wide scrolling table).

### `Tabs`

One component, two variants. The variant telegraphs intent to the user — segment-style means "the mode/task is about to change"; underline means "you're looking at the same kind of information, sliced differently."

```tsx
import Tabs from '@/components/ui/Tabs';

// Mode switch: batters and pitchers are different workflows
<Tabs
  variant="segment"
  items={[{ id: 'batting', label: 'Batters' }, { id: 'pitching', label: 'Pitchers' }]}
  value={mode}
  onChange={setMode}
/>

// Peer data views: same scoreboard, sliced by category group
<Tabs
  variant="underline"
  items={[{ id: 'batting', label: 'Batting' }, { id: 'pitching', label: 'Pitching' }]}
  value={activeTab}
  onChange={setActiveTab}
/>
```

**Do not hand-roll tab styles.** If both variants exist in the codebase, two different tabs should be visually distinct by variant — that's the whole point.

### Shared display patterns

These aren't containers but are shared, reusable display surfaces. Prefer them before inventing new ones:

- **`MatchupPulse`** (`src/components/shared/MatchupPulse.tsx`) — horizontal strip of per-category tiles showing current-week head-to-head. Props: `side: 'batting' | 'pitching' | 'both'`.
- **`CategoryFocusBar`** (`src/components/shared/CategoryFocusBar.tsx`) — multi-state pill group for chase/punt/neutral per category.
- **`DivergingRow`** (`src/components/ui/DivergingRow.tsx`) — center-origin bar showing who's winning a category.

### Anti-patterns

- **No new color systems.** Use `primary | accent | success | error | muted-foreground`.
- **No new pill/tag/chip components.** Use `Badge`.
- **No new card wrappers.** `DashboardCard` for dashboard tiles, `Panel` everywhere else.
- **No inline `bg-surface rounded-lg shadow ...`.** Always `Panel`.
- **No per-file tab styles.** Always `Tabs`.
- **No two visual styles for the same intent.** If you need a new look, update this rubric first and then update every usage.
- **No per-page reinventions** of `MatchupPulse` or `CategoryFocusBar` — they live in `src/components/shared/` and get extended via props.

## Mobile Adaptations

MLBoss is data-dense — "just stack the columns" is not a mobile strategy. The
dense surfaces swap to compact variants rather than shrinking. Two breakpoint
rules, so desktop never sees a mobile treatment:

- **Structural swaps** (one layout replaced by another, e.g. Boss Card corners
  → stacked matchup) happen at **`md`** — the same boundary as the mobile
  chrome. Desktop above `md` always gets the desktop structure.
- **Density swaps** (tiles → chips, 3-line → 2-line, padding steps) happen at
  **`sm`** — they're about available width, not device class.

Shipped patterns (from the MLBoss Design System handoff bundle's mobile
previews):

- **Boss Card matchup header** — below `md` the fight-card corners collapse to
  a vertical stack: your team row, a hairline `vs` rule, then the opponent row
  mirrored (logo right, text right-aligned) so the teams still face each other.
  Leader signal moves from the crown to an accent ring + `leader` tag. Between
  `md` and `lg` the full corners render centered above the rail; at `lg`+ they
  anchor the marquee's sides.
  (`src/components/dashboard/BossCard/Corner.tsx` → `MobileTeamRow`)
- **Category rail** — each side becomes a labeled (`BATTING` / `PITCHING`)
  4-up grid of 2-line tiles (`label` / `my / opp` on one line). The desktop
  vertical divider doesn't survive wrapped grids; the captions replace it.
  (`src/components/dashboard/BossCard/CategoryRail.tsx`)
- **Game Plan chips** — category tiles collapse to stat-name chips whose tint
  encodes status (deep green locked, green lead, amber narrowing, red behind,
  dashed muted conceded). Tapping a chip expands one detail block — projection,
  status, concede/restore — at a time. The cluster reads as a heatmap of the
  matchup and fits without scrolling.
  (`src/components/shared/GamePlanPanel.tsx`)
- **Dashboard cards** — stack 1-up; interior padding drops 24px → 14px
  (`p-3.5 sm:p-6`) so cards don't feel cavernous. Card titles already floor at
  17px via the `h3` clamp. (`src/components/dashboard/DashboardCard.tsx`)
- **Mobile chrome** — 48px top bar + 56px bottom tab bar, 5 destinations max
  (hard ceiling), `env(safe-area-inset-bottom)` reserved.
  (`src/components/layout/MobileChrome.tsx`)

## Component Patterns

### Icon System
Consistent iconography via react-icons with wrapper component:

```tsx
import Icon from '@/components/Icon';
import { GiBaseballBat } from 'react-icons/gi';

<Icon icon={GiBaseballBat} className="text-accent" size={24} />
```

**Icon Libraries:**
- **Baseball/Sports**: Game Icons (`react-icons/gi`)
- **UI Elements**: Feather Icons (`react-icons/fi`)

## Usage Guidelines

### Color Usage Hierarchy
1. **Primary** (`#132F43`): Navigation, headers, primary actions
2. **Accent** (`#C89222`): CTAs, highlights, interactive elements
3. **Success** (`#1F8A5B`): Positive states, confirmations, good metrics
4. **Background/Foreground**: Base layout colors

### Best Practices
- Use a numbered stop only for opaque fills (`bg-primary-100`); use alpha (`bg-primary/10`) for subtle washes and hover backgrounds
- Maintain contrast ratios for accessibility
- Prefer semantic color names over hex values in components
- Test both light and dark modes when adding new color usage

### Common Patterns
```tsx
// Card with primary theme
<div className="bg-white dark:bg-primary-900 border-primary/20">
  <Heading as="h3" className="text-primary">Title</Heading>
  <Text className="text-foreground">Body text</Text>
</div>

// Success state
<div className="bg-success-100 text-success-900 border-success/40">
  <Text variant="small">Success message</Text>
</div>

// Interactive element
<button className="bg-accent hover:bg-accent-700 text-white">
  <Text as="span" className="font-medium">Action Button</Text>
</button>
```

## Corner Radii

Exactly **four** radii are sanctioned, each answering a different question. The scale is
**geometric (4 → 8 → 16)** — each step roughly doubles — so every tier reads as perceptibly
distinct. (A linear `4 → 8 → 12` was rejected: 8px and 12px are nearly indistinguishable at the
sizes these surfaces render, which is how "two LLMs picked Tailwind defaults" drift starts.)

| Radius | Value | Tailwind | Question it answers | Used for |
|--------|-------|----------|---------------------|----------|
| sm | 4px | `rounded` | "is it a chip?" | badges, pills, inputs, segmented/tab buttons, Boss category tiles, player-row body |
| lg | 8px | `rounded-lg` | "is it a container?" **(the default)** | cards, panels, dashboard tiles, focus tiles, callouts |
| xl | 16px | `rounded-xl` | "is it the marquee?" | **Boss Card top-of-dashboard band only — nothing else** |
| full | 9999px | `rounded-full` | "is it round?" | avatars, week chip, status pills |

`rounded-xl` is remapped to **16px** in `globals.css` (`@theme inline { --radius-xl: 1rem }`) —
Tailwind's default is 12px, the ambiguous middle we're deliberately skipping. The marquee keeps
using the `rounded-xl` class; it just renders at 16px now.

**Do not use `rounded-md` (6px) or `rounded-2xl`.** `rounded-md` is the Tailwind default that creeps
in when a component is written without consulting this rubric (`6` is indistinguishable from `8`).
`rounded-2xl` is redundant — the marquee's 16px is `rounded-xl`. More radii means more drift; the
decision between the four above must always be unambiguous. A container is `rounded-lg`; a chip is
`rounded`; only the Boss Card marquee is `rounded-xl`.

## Future Expansion

This design system can be extended with:
- Spacing scale (`--space-*` variables)
- Shadow system (`--shadow-*` variants)
- Animation/transition standards
- Component-specific design tokens

All additions should follow the same CSS variable → Tailwind integration pattern established here. 