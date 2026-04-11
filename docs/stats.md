# Statistical Data Architecture

## Overview

MLBoss uses `stat_id` as the canonical identifier for all player and team statistics. This numeric key system eliminates ambiguity between similar statistics (like pitcher vs batter strikeouts) and provides consistent identification across all API calls.

## Core Concepts

### stat_id as Canonical Key

Every statistic in the Yahoo Fantasy API is identified by a unique numeric `stat_id`:

```typescript
// Raw stat from Yahoo API
{
  "stat_id": "21",  // Batter strikeouts
  "value": "14"
}
```

### Stat Category Metadata

Each stat_id maps to metadata that includes:
- `name`: Full name of the statistic
- `display_name`: Abbreviated display name
- `position_types`: Array indicating if it's for batters ["B"], pitchers ["P"], or both
- `sort_order`: How to sort (1 = higher is better, 0 = lower is better)

## Usage

### Fetching Stat Categories

```typescript
import { getStatCategories, getStatCategoryMap } from '@/lib/fantasy';

// Get stat categories with automatic caching (48-hour TTL)
const categories = await getStatCategories('458'); // MLB 2025

// Get pre-built lookup map
const categoryMap = await getStatCategoryMap('458');
```

### Enriching Statistics

When receiving raw stats from Yahoo, enrich them with metadata:

```typescript
import { enrichStats } from '@/lib/fantasy';

const rawStats = [
  { stat_id: "21", value: "14" },  // Batter K
  { stat_id: "30", value: "26" },  // Pitcher K
  { stat_id: "12", value: "8" }    // Home runs
];

const enrichedStats = await enrichStats('458', rawStats, userId);
// Result: { stat_id: 21, value: "14", name: "Batter K", display_name: "K",
//           position_types: ["B"], is_pitcher_stat: false, is_batter_stat: true, sort_order: "0" }
```

### League-Specific Categories

Get the stat categories scored by a specific league, enriched with `betterIs` direction:

```typescript
import { getEnrichedLeagueStatCategories } from '@/lib/fantasy';

const categories = await getEnrichedLeagueStatCategories(userId, '458.l.123456');
// Each: { stat_id, name, display_name, position_types,
//         is_pitcher_stat, is_batter_stat, sort_order, betterIs }
```

### Disambiguating Statistics

Some statistics share a name but have different stat_ids by position:

```typescript
const batterStrikeouts = categoryMap[21];  // position_types: ["B"]
const pitcherStrikeouts = categoryMap[42]; // position_types: ["P"]
```

## Common MLB stat_ids

Defined in `src/constants/statCategories.ts` with utility functions:

```typescript
import { COMMON_MLB_STATS, isBatterStat, isPitcherStat, getStatDisplay, disambiguateStatName } from '@/constants/statCategories';
```

**Key batting stats:** 7 (R), 8 (H), 12 (HR), 13 (RBI), 16 (SB), 21 (K)
**Key pitching stats:** 26 (ERA), 27 (WHIP), 28 (W), 32 (SV), 42 (K), 50 (IP), 83 (QS)

## Best Practices

1. **Always use numeric stat_id** — convert string stat_ids to numbers for consistency
2. **Cache aggressively** — stat categories don't change during a season (48h TTL)
3. **Check position_types** — use this to disambiguate stats with the same name
4. **Enrich early** — add metadata to stats as soon as you receive them from Yahoo
5. **Use the map** — pre-built maps allow O(1) lookups when processing many stats
