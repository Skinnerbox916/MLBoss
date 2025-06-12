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

## Implementation

### Fetching Stat Categories

```typescript
// Get stat categories with automatic caching (48-hour TTL)
const categories = await agentFantasy.getStatCategories('458'); // MLB 2025

// Get pre-built lookup map
const categoryMap = await agentFantasy.getStatCategoryMap('458');
```

### Enriching Statistics

When receiving raw stats from Yahoo, enrich them with metadata using the built-in utility:

```typescript
// Raw stats from Yahoo API
const rawStats = [
  { stat_id: "21", value: "14" },  // Batter K
  { stat_id: "30", value: "26" },  // Pitcher K
  { stat_id: "12", value: "8" }    // Home runs
];

// Enrich with metadata using the utility function
const enrichedStats = await agentFantasy.enrichStats('458', rawStats, userId);

// Result includes all original properties plus metadata:
// {
//   stat_id: 21,
//   value: "14",
//   name: "Batter K",
//   display_name: "K",
//   position_types: ["B"],
//   is_pitcher_stat: false,
//   is_batter_stat: true,
//   sort_order: "0"
// }
```

#### Manual Enrichment (Alternative)

For custom enrichment logic, you can manually use the category map:

```typescript
// Get the category map
const categoryMap = await agentFantasy.getStatCategoryMap('458');

// Manual enrichment
const enrichedStats = rawStats.map(stat => {
  const id = Number(stat.stat_id);
  const category = categoryMap[id];
  
  return {
    stat_id: id,
    value: Number(stat.value),
    name: category.name,
    display_name: category.display_name,
    position_types: category.position_types,
    is_pitcher_stat: category.position_types.includes('P'),
    is_batter_stat: category.position_types.includes('B')
  };
});
```

### Disambiguating Statistics

Some statistics have the same name but different stat_ids based on position:

```typescript
// Both are "Strikeouts" but have different IDs
const batterStrikeouts = categoryMap[21];  // position_types: ["B"]
const pitcherStrikeouts = categoryMap[30]; // position_types: ["P"]

// Check position context
if (stat.position_types.includes('P')) {
  // This is a pitcher stat
}
```

## Common MLB stat_ids

Common stat_id mappings are defined in TypeScript at `src/constants/statCategories.ts`. This provides type-safe lookups and utility functions.

**Quick reference utilities:**
```typescript
import { 
  COMMON_MLB_STATS, 
  isBatterStat, 
  isPitcherStat, 
  getStatDisplay,
  disambiguateStatName 
} from '@/constants/statCategories';

// Check stat type
if (isBatterStat(21)) console.log('Batter strikeouts');
if (isPitcherStat(30)) console.log('Pitcher strikeouts');

// Get display names
console.log(getStatDisplay(12)); // "HR"
console.log(disambiguateStatName(21)); // "Batter K"
```

**Key batting stats:** 7 (R), 8 (H), 12 (HR), 13 (RBI), 16 (SB), 21 (K)  
**Key pitching stats:** 26 (ERA), 27 (WHIP), 28 (W), 30 (K), 32 (SV)

For the complete list with position types and sort order, see `COMMON_MLB_STATS` in the constants file.

## Caching Strategy

Stat categories are static data that doesn't change during a season:
- Cached for 48 hours in Redis
- Key format: `static:stat_categories:{game_key}`
- Map format: `static:stat_category_map:{game_key}`

## API Methods

### YahooFantasyAPI

```typescript
// Fetch stat categories from Yahoo
async getStatCategories(gameKey: string): Promise<StatCategory[]>

// Build lookup map from categories
static buildStatCategoryMap(categories: StatCategory[]): Record<number, StatCategory>
```

### agentFantasy

```typescript
// Get categories with caching
async getStatCategories(gameKey: string, userId?: string): Promise<StatCategory[]>

// Get pre-built map with caching
async getStatCategoryMap(gameKey: string, userId?: string): Promise<Record<number, StatCategory>>

// Enrich stats with category metadata
async enrichStats<T extends { stat_id: string | number; value: string | number }>(
  gameKey: string,
  stats: T[],
  userId?: string
): Promise<Array<T & { name: string; display_name: string; position_types: string[]; /* etc */ }>>
```

## Best Practices

1. **Always use numeric stat_id**: Convert string stat_ids to numbers for consistency
2. **Cache aggressively**: Stat categories don't change during a season
3. **Check position_types**: Use this to disambiguate stats with the same name
4. **Enrich early**: Add metadata to stats as soon as you receive them from Yahoo
5. **Use the map**: Pre-built maps allow O(1) lookups when processing many stats 