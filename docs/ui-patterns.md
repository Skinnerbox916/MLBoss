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

### Focus Pills (chase / punt / neutral)

Two sibling components, both cycle `neutral → chase → punt → neutral` on click. Pick by host context:

- **`FocusPill`** in [`src/components/shared/CategoryFocusBar.tsx`](../src/components/shared/CategoryFocusBar.tsx) — full-width labeled chip ("HR", "ERA"). Lives inside the standalone `CategoryFocusBar` panel. Still used on roster, today, and lineup pages.
- **`RowFocusPill`** in [`src/components/streaming/GamePlanPanel.tsx`](../src/components/streaming/GamePlanPanel.tsx) — compact 5×5 single-character button (`C` / `P` / `·`). Lives as the leftmost cell of each Game Plan row, where horizontal space is at a premium.

Both render an override dot (top-right) when the user's effective focus differs from MLBoss's *suggested* focus. The override dot is the legibility cue that "you've made a manual choice here" — it's the same primitive in both places.

When adding a focus toggle to a new surface, decide based on space: standalone bar context → `FocusPill`, dense row context → `RowFocusPill`. Don't create a third variant.

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
Three patterns exist for showing your stats vs opponent — pick by layout context:

1. **DivergingRow** (`src/components/ui/DivergingRow.tsx`) — center-origin bar chart. Preferred for vertical lists (dashboard cards).
2. **MatchupPulse** (`src/components/shared/MatchupPulse.tsx`) — horizontal strip of per-category tiles with red/green tint. Still used on the dashboard. Accepts `side: 'batting' | 'pitching' | 'both'`. Retired from the streaming page (replaced by Game Plan).
3. **GamePlanPanel** (`src/components/streaming/GamePlanPanel.tsx`) — chase/hold/punt-grouped panel showing per-cat current → projected → reason, with the focus pill inline on each row. Use this as the action-surface header on action-first pages. Accepts `side: 'batting' | 'pitching'`.

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

## Anti-Patterns (Don't Do These)

- **Don't create new pill/tag/chip components.** Use `Badge`.
- **Don't write inline stat formatting.** Use `formatStatValue` / `formatStatDelta`.
- **Don't create new card wrappers for the dashboard.** Use `DashboardCard`.
- **Don't wrap non-dashboard sections in hand-rolled `bg-surface rounded-lg shadow p-4`.** Use `Panel`.
- **Don't hand-roll tab styles.** Use `Tabs` (segment for mode switches, underline for peer views).
- **Don't reinvent `MatchupPulse` / `CategoryFocusBar` / `GamePlanPanel` per page.** They live in `src/components/shared/` (or `src/components/streaming/` for Game Plan) and get extended via props. Game Plan accepts a `side` prop and is the consolidated action-surface header on the streaming page.
- **Don't ship a third focus-pill variant.** `FocusPill` (in standalone bar context) and `RowFocusPill` (in dense row context) cover both layouts. Add a prop to one of them if you need a tweak.
- **Don't build a new comparison visualization** when DivergingRow or MatchupPulse already handles it.
- **Don't add a new color system.** Use the semantic colors: `primary`, `accent`, `success`, `error`, `muted-foreground`. See `docs/design-system.md`.
- **Don't create new loading states.** Use `Skeleton` or `DashboardCard`'s built-in `isLoading`.
- **Don't duplicate tier/verdict color logic.** The pattern is: `success` = good/winning/strong, `error` = bad/losing/weak, `accent` = neutral/notable, `muted` = unknown/inactive.

## When You Actually Need Something New

If none of the above patterns fit your use case:

1. Check whether an existing component can be extended with a prop rather than creating a new one.
2. If you must create a new shared component, put it in `src/components/ui/` and document it in this file.
3. Keep it generic — a component that only serves one page doesn't belong in `ui/`.
