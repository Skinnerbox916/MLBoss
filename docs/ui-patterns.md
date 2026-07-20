# UI Patterns & Shared Components

Before building new UI, check this inventory. Reuse existing patterns and shared components rather than creating new ones.

> **Container choice** (Page / `DashboardCard` / `Panel` / `Tabs` / Modal) is governed by the **Container Intent Rubric** in [`design-system.md`](design-system.md#container-intent-rubric). Read that first for the "which wrapper do I use" question. This doc covers the display-level components (badges, rows, tiles, tables, etc.) you drop *inside* those containers.

## Shared Components (`src/components/ui/`)

### Badge
`Badge` — inline colored label. Use for status indicators, tier labels, verdict pills, position tags.

```tsx
import Badge from '@/components/ui/Badge';

<Badge color="success">W</Badge>
<Badge color="error">IL10</Badge>
<Badge color="accent">SP</Badge>
<Badge color="muted">BN</Badge>
<Badge color="primary">1st</Badge>
```

Colors: `success | error | accent | primary | muted`. Don't create new pill/tag/chip components — use Badge.

### Panel
`Panel` (`src/components/ui/Panel.tsx`) — the standard non-dashboard section container. Replaces the `bg-surface rounded-lg shadow p-4` pattern. Optional `title`, `action`, and `helper` props.

```tsx
import Panel from '@/components/ui/Panel';

<Panel title="Your Batters" action={<span className="text-caption text-muted-foreground">12 on roster</span>}>
  <RosterTable />
</Panel>
```

Use `noPadding` when the child needs full-bleed control (e.g. a wide scrolling table).

### Tabs
`Tabs` (`src/components/ui/Tabs.tsx`) — one component, two variants. See the [design system](design-system.md#tabs) for the full rubric.

- `variant="segment"` for **mode switches** (Batters/Pitchers on `/lineup` and `/roster` — different workflows)
- `variant="underline"` for **peer data views** (Batting/Pitching tabs inside `CurrentScoreCard`, stat rankings on `/league`)

```tsx
<Tabs
  variant="segment"
  items={[{ id: 'batters', label: 'Batters' }, { id: 'pitchers', label: 'Pitchers' }]}
  value={tab}
  onChange={setTab}
/>
```

### DivergingRow
`DivergingRow` — horizontal bar that diverges from center to show who's winning a stat category. Green bar right = winning, red bar left = losing.

```tsx
import DivergingRow from '@/components/ui/DivergingRow';

<DivergingRow
  label="HR"
  myVal="12"
  oppVal="8"
  relDelta={0.5}
  maxRel={1}
  winning={true}
  deltaStr="+4"
/>
```

Used in: BattingCard, PitchingCard, NextWeekCard, SeasonComparisonCard. Use this whenever comparing two teams' stat categories side-by-side.

### DashboardCard
`DashboardCard` — wrapper for dashboard grid cards. Provides header (title + icon), loading skeleton, footer slot, and grid sizing.

```tsx
import DashboardCard from '@/components/dashboard/DashboardCard';

<DashboardCard title="Batting" icon={GiBaseballBat} size="md" isLoading={loading}>
  {content}
</DashboardCard>
```

Sizes: `sm | md | lg | xl` (control grid col-span/row-span). All dashboard cards must use this wrapper.

### Skeleton
`Skeleton` — animated loading placeholder.

```tsx
import Skeleton from '@/components/ui/Skeleton';

<Skeleton className="h-4 w-3/4" />
```

### Icon
`Icon` — wrapper for react-icons. Game Icons (`gi`) for baseball, Feather Icons (`fi`) for UI.

```tsx
import Icon from '@/components/Icon';
import { GiBaseballBat } from 'react-icons/gi';

<Icon icon={GiBaseballBat} size={24} className="text-accent" />
```

### Concede/Contest Controls (In play / Conceded shelves)

Every category-strategy surface renders the same grammar: **In play** tiles ranked by pivotality weight and a **Conceded** shelf, with a single 2-state concede/contest toggle per tile. [`GamePlanPanel`](../src/components/shared/GamePlanPanel.tsx) (lineup/streaming, L5 margins) and [`RosterFocusPanel`](../src/components/roster/RosterFocusPanel.tsx) (roster, L6 RUPM distance) are the two implementations; `FocusResetButton` lives inside `GamePlanPanel`. The 3-state chase/hold/punt `focusPanel.tsx` chrome was deleted in the 2026-07 roster-value rebuild (see history.md) — don't reintroduce a 3-state focus control.

### RosterMoveCard (`src/components/shared/RosterMoveCard.tsx`)

One suggested roster move (drop → add, or "Add to open slot"): names + position/ownership context, caller-provided badges, an optional per-stat delta strip, per-position value deltas with gap annotations, and the net value block. Both roster pages render their Suggested Moves through it — categories passes leverage badges + move-unit deltas, points passes pts/wk deltas. Layout lives here; strategy content stays with the caller.

### PositionalDepthTable (`src/components/shared/PositionalDepthTable.tsx`)

The positional-depth table (Pos / Slots / Eligible / Status / Starters / Best Backup) both roster pages use, with `depthStatus` (GAP / ok / deep) derived from eligible count vs min depth. The Target column renders only when the caller passes `renderTarget` (categories' preferred-depth steppers); points omits it.

### StandingsTable (`src/components/shared/StandingsTable.tsx`)

League standings (# / Team / W / L / T / Pct / GB), scoring-agnostic — both `/league` mode views mount it. Columns are data-driven, not mode-flagged: PF/PA appear when the league reports points totals (points leagues), the streak column when Yahoo includes it. User's team row highlights via `userTeamKey`.

## Shared Utilities (`src/lib/`)

### Stat Formatting (`src/lib/formatStat.ts`)
All stat display formatting goes through two functions:

```tsx
import { formatStatValue, formatStatDelta } from '@/lib/formatStat';

formatStatValue(0.285, 'AVG')   // → ".285"
formatStatValue(3.42, 'ERA')    // → "3.42"
formatStatValue(6.1, 'IP')      // → "6.1"
formatStatValue(12, 'HR')       // → "12"
formatStatValue(null, 'AVG')    // → "-"

formatStatDelta(0.015, 'AVG')   // → "+.015"
formatStatDelta(-0.42, 'ERA')   // → "-0.42"
formatStatDelta(3, 'HR')        // → "+3"
```

Never write inline stat formatting logic. If you need to format a stat value or delta, use these functions.

## Established Display Patterns

These patterns are already implemented. When building features that show similar data, follow the existing pattern rather than inventing a new one.

### Expandable Player Row
Used for batters (`LineupManager`), today's starting pitchers (`TodayPitchers`), and streaming candidates (`StreamingBoard`). Structure:

- Colored left border (3px, tier-based)
- Main row: player name + badges + matchup context + chevron toggle
- Verdict pills row: `Badge` components showing signal strength
- Expanded panel: detailed score breakdown with factor bars

Batter version: `src/components/lineup/PlayerRow.tsx` + `PlayerSplitsPanel.tsx`
Pitcher today version: `src/components/lineup/TodayPitchers.tsx` + `src/components/shared/ScoreBreakdownPanel.tsx`
Pitcher streaming version: `src/components/streaming/StreamingBoard.tsx` + `src/components/shared/ScoreBreakdownPanel.tsx`

### Stat Comparison (head-to-head)
Two patterns exist for showing your stats vs opponent — pick by layout context:

1. **DivergingRow** (`src/components/ui/DivergingRow.tsx`) — center-origin bar chart. Preferred for vertical lists (dashboard cards).
2. **GamePlanPanel** (`src/components/shared/GamePlanPanel.tsx`) — chase/hold/punt-grouped panel showing per-cat current → projected → reason, with the focus control inline on each row. Use this as the action-surface header on action-first pages. Accepts `side: 'batting' | 'pitching'`.

### Day Pills (per-start descriptor)

Used on the streaming pitcher board to surface "which day(s) is this pitcher pitching." Each pill is a compact `MON @ ARI 65` chip — color-coded by per-start score, with a primary ring on the section's active date in by-day view. See `DayPill` in [`src/components/streaming/StreamingBoard.tsx`](../src/components/streaming/StreamingBoard.tsx). Reuse this pattern when you need a "data point belongs to this date" signal in a row that has multiple dates of interest.

### Data Tables
Standings, stat rankings, and roster tables all build `<table>` markup with these conventions:

- `overflow-x-auto` wrapper for horizontal scroll
- `text-xs` body text, `text-muted-foreground font-medium` headers
- `tabular-nums` and `font-mono` for numeric cells, right-aligned
- `border-b border-border/50` between rows, `hover:bg-surface-muted/50`
- User's own team row highlighted with `bg-primary/5`

No shared table component exists yet — follow these conventions when building tables.

### Transaction/Activity Log
`RecentActivityCard` pattern: timeline dot (colored by type) + team name + timestamp + player changes. Used for league transaction feeds.

### Alert/Warning Display
`LineupIssuesCard` pattern: colored left border (3px) + icon + message. Error = red border, warning = accent border.

### App Shell (responsive)

The app chrome (logo, primary nav, account drawer) lives in [`src/components/layout/`](../src/components/layout/) and switches presentation at the `md` (768px) breakpoint:

- **Desktop (`md+`)** — [`DesktopSidebar`](../src/components/layout/DesktopSidebar.tsx): collapsible left rail with logo, nav, and account trigger. Persists `sidebarOpen` to `localStorage`.
- **Mobile (`<md`)** — [`MobileChrome`](../src/components/layout/MobileChrome.tsx): slim top bar (logo + account trigger) + bottom tab bar (5 destinations, icon + label). Reclaims the full viewport width for content.

Both presentations consume the **same** [`navigation`](../src/components/layout/navigation.ts) array — never duplicate the list. Both anchor the same `AccountMenuContent` panel so the menu can't drift between form factors.

The shell is composed by [`AppLayout`](../src/components/layout/AppLayout.tsx), which is a vertical flex column: `[MobileTopBar, {children's <main>}, MobileBottomNav]`. The mobile bars are `md:hidden` so on desktop the column collapses to just the page's `<main>`. **Pages do not need to know about the mobile bars** — they keep rendering `<main className="flex-1 overflow-y-auto bg-background">` as today; the flex column handles spacing automatically.

When adding a primary destination: add it to `navigation.ts` and it shows up in both places. The bottom tab bar is sized for 5 items (per iOS HIG / Material guidance). If you need a 6th destination, fold it into an existing page or move overflow behind a "More" tab — do not let the bottom bar grow past 5.

**Optimistic active state.** Both nav surfaces use [`usePendingNav`](../src/components/layout/usePendingNav.ts) so the tapped item highlights immediately, even if the destination page is slow to resolve. `usePathname()` doesn't update until the new route commits, so without this the tap looks ignored on slow loads. Any new nav surface should consume the same hook — call `markPending(href)` in `onClick` and use `isActiveOrPending(href)` for the active class. Note this does not help when the main thread is fully blocked (clicks queue regardless); that requires a perf fix on the page, not a nav fix.

## Anti-Patterns (Don't Do These)

- **Don't create new pill/tag/chip components.** Use `Badge`.
- **Don't write inline stat formatting.** Use `formatStatValue` / `formatStatDelta`.
- **Don't create new card wrappers for the dashboard.** Use `DashboardCard`.
- **Don't wrap non-dashboard sections in hand-rolled `bg-surface rounded-lg shadow p-4`.** Use `Panel`.
- **Don't hand-roll tab styles.** Use `Tabs` (segment for mode switches, underline for peer views).
- **Don't reinvent `GamePlanPanel` per page.** It lives in `src/components/shared/` and is extended via props (`side: 'batting' | 'pitching'`). It's the consolidated action-surface header on Lineup and Streaming.
- **Don't ship a sibling focus control.** `FocusSegmentedControl` in [`focusPanel.tsx`](../src/components/shared/focusPanel.tsx) is the only chase/punt/neutral toggle (roster page only — see Focus Controls above). Add a prop if you need a tweak; don't add new consumers.
- **Don't build a new comparison visualization** when `DivergingRow` or `GamePlanPanel` already handles it.
- **Don't add a new color system.** Use the semantic colors: `primary`, `accent`, `success`, `error`, `muted-foreground`. See `docs/design-system.md`.
- **Don't create new loading states.** Use `Skeleton` or `DashboardCard`'s built-in `isLoading`.
- **Don't duplicate tier/verdict color logic.** The pattern is: `success` = good/winning/strong, `error` = bad/losing/weak, `accent` = neutral/notable, `muted` = unknown/inactive.
- **Don't add a second navigation list** for mobile. Both the desktop sidebar and mobile bottom nav read from `src/components/layout/navigation.ts`. Adding/removing a primary destination = one line in that file.
- **Don't grow the mobile bottom tab bar past 5 items.** Fold destinations into existing pages or add a "More" sheet — labels stop fitting around 6 items on small phones.

## The Mode Axis (categories × points)

Every page routes by the active league's scoring mode (`useActiveLeague().mode`) through a per-page router (`RosterModeRouter`, `StreamingModeRouter`, `DashboardModeRouter`, `LeagueModeRouter`; `/lineup` is mode-aware inside one shell). The fork exists because the two modes differ in *decision grammar* (leverage/concede vs. one points currency) — but most UI is NOT mode-specific, and building a scoring-agnostic feature inside one side of the fork is how the two views drift into "two sites in a trenchcoat."

**Before building any new UI feature, classify it on the mode axis:**

1. **Scoring-agnostic** (standings W/L/T, activity feeds, waivers, injury/stash policy, schedule strips): build ONE component in `src/components/shared/`, mount it from both mode views. It must not import category or points engines directly — take data via props.
2. **Same grammar, different units** (depth tables, move cards, player boards): one shared component parameterized by the value/label props — the proven pattern (`RosterMoveCard`, `PositionalDepthTable` serve both modes).
3. **Mode-specific by nature** (leverage tiles, concede toggles, VOR boards): lives in the mode's own view. Confirm it's genuinely about the scoring grammar, not just "the other mode's view doesn't exist yet."

When you fix a behavior in one mode's view, grep for the sibling view (`Points*` ↔ the categories manager for that page) and the other player side (batter ↔ pitcher) before closing — if the fix applies there, it was misclassified as mode-specific and should move to a shared home.

## When You Actually Need Something New

If none of the above patterns fit your use case:

1. Check whether an existing component can be extended with a prop rather than creating a new one.
2. If you must create a new shared component, put it in `src/components/ui/` and document it in this file.
3. Keep it generic — a component that only serves one page doesn't belong in `ui/`.
