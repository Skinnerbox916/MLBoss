# Data Layer Documentation

## Overview

The data layer provides a unified interface for accessing fantasy baseball data from multiple sources (Yahoo Fantasy Sports API, ESPN, and future sources). It implements intelligent caching strategies to optimize performance and reduce API calls.

## Architecture

### Components

1. **Data Facade** (`app/data/index.ts`)
   - Central entry point for all data operations
   - Server-side only implementation
   - Combines data from multiple sources
   - Handles caching strategies

2. **Services** (`app/services/`)
   - Yahoo API services (league, team, player)
   - ESPN API utilities
   - Each service handles its specific domain

3. **Cache Layer** (`app/lib/server/cache.ts`)
   - Redis-based caching
   - Three cache categories with different TTLs
   - Intelligent cache key generation

### Data Flow

```
UI Component
    ↓
API Route (Next.js)
    ↓
Data Facade
    ↓
┌─────────────┬──────────────┐
│ Yahoo API   │  ESPN API    │  (Future: MLB API)
│ Services    │  Utils       │
└─────────────┴──────────────┘
    ↓              ↓
Redis Cache Layer
```

## Cache Strategy

### Categories

1. **Static Data** (24 hour TTL)
   - Player positions, team info
   - League settings
   - Cache first, allow stale data

2. **Daily Data** (12 hour TTL)
   - Standings, rosters
   - Transactions
   - Cache first, allow stale data

3. **Realtime Data** (15 minute TTL)
   - Live scores, current matchups
   - Player stats for current games
   - API first, cache as fallback

### Cache Behavior by Category

| Category | TTL | Strategy | Use Case |
|----------|-----|----------|----------|
| Static | 24h | Cache first, allow stale | League settings, player eligibility |
| Daily | 12h | Cache first, allow stale | Standings, rosters, transactions |
| Realtime | 15m | API first, cache fallback | Live scores, current stats |

## API Functions

### getDashboardData()

Returns all data needed for the main dashboard view.

```typescript
const dashboardData = await getDashboardData();

// Returns:
{
  league: YahooLeague,
  userTeam: YahooTeam,
  standings: YahooLeagueStandings,
  currentMatchup: YahooMatchup | null,
  recentTransactions: any[],
  todaysGames: {
    yahooGames: any[],
    espnGames: any[]
  },
  lastUpdated: string
}
```

**Cache**: Daily (12 hours)

### getMatchupData(week?: number)

Returns detailed matchup information for a specific week.

```typescript
// Current week
const currentMatchup = await getMatchupData();

// Specific week
const week5Matchup = await getMatchupData(5);

// Returns:
{
  matchup: YahooMatchup,
  userTeam: YahooTeam,
  opponentTeam: YahooTeam,
  userRoster: YahooPlayer[],
  opponentRoster: YahooPlayer[],
  scoringCategories: any[],
  week: number,
  isCurrentWeek: boolean,
  lastUpdated: string
}
```

**Cache**: 
- Current week: Realtime (15 minutes)
- Historical weeks: Daily (12 hours)

### getTeamData(teamKey?: string)

Returns comprehensive team information with enriched roster data.

```typescript
// User's team
const myTeam = await getTeamData();

// Specific team
const otherTeam = await getTeamData('mlb.l.12345.t.6');

// Returns:
{
  team: YahooTeam,
  roster: YahooPlayer[],
  enrichedRoster: EnrichedPlayer[], // Includes game info, probable pitchers
  teamStats: any,
  standings: any,
  schedule: YahooMatchup[],
  transactions: any[],
  lastUpdated: string
}
```

**Cache**: Daily (6 hours)

### getPlayerData(playerKey: string)

Returns detailed player information including stats and news.

```typescript
const player = await getPlayerData('mlb.p.12345');

// Returns:
{
  player: YahooPlayer,
  seasonStats: any,
  recentStats: any,
  gameLog: any[],
  news: any[],
  ownership: any,
  schedule: any[],
  lastUpdated: string
}
```

**Cache**: Daily (6 hours)

### getLeagueOverviewData()

Returns league-wide information for league overview pages.

```typescript
const leagueData = await getLeagueOverviewData();

// Returns:
{
  league: YahooLeague,
  allTeams: YahooTeam[],
  standings: YahooLeagueStandings,
  currentWeekMatchups: YahooMatchup[],
  topPerformers: YahooPlayer[],
  recentTransactions: any[],
  lastUpdated: string
}
```

**Cache**: Daily (12 hours)

## Usage Examples

### In API Routes

```typescript
// app/api/dashboard/route.ts
import { getDashboardData } from '@/app/data';

export async function GET() {
  try {
    const data = await getDashboardData();
    return NextResponse.json(data);
  } catch (error) {
    return NextResponse.json(
      { error: 'Failed to fetch dashboard data' },
      { status: 500 }
    );
  }
}
```

### Error Handling

The facade implements graceful error handling:

1. **Partial Data Returns**: Dashboard endpoint returns partial data on errors
2. **Cache Fallbacks**: Realtime data falls back to cache on API errors
3. **Logging**: All errors are logged for debugging

### Adding New Data Sources

The facade is designed to be extensible:

1. Add new service imports
2. Enhance facade functions to include new data
3. Update return types as needed

Example:
```typescript
// Future enhancement
import { mlbApiService } from '../services/mlb';

// In getTeamData()
const [yahooData, espnData, mlbData] = await Promise.all([
  yahooServices.team.getTeam(),
  getEspnScoreboard(),
  mlbApiService.getTeamStats() // New data source
]);
```

## Performance Considerations

1. **Parallel Fetching**: All facade functions use `Promise.all()` for concurrent API calls
2. **Cache-First Strategy**: Most data uses cache-first approach to minimize API calls
3. **Selective Enrichment**: Player enrichment only happens when needed
4. **Appropriate TTLs**: Cache durations match data update frequency

## TODOs and Future Enhancements

- [ ] Implement probable pitcher detection
- [ ] Add player starting lineup status
- [ ] Implement hot/cold performance ratings
- [ ] Add player news aggregation
- [ ] Add game logs from additional sources
- [ ] Implement request deduplication for concurrent requests

## Monitoring and Debugging

### Cache Keys

Cache keys follow a consistent pattern:
```
{category}:facade:{function}:{params}
```

Examples:
- `daily:facade:dashboard`
- `realtime:facade:matchup:week=current`
- `daily:facade:team:teamKey=mlb.l.12345.t.1`

### Logging

All operations include console logging:
- Cache hits/misses
- API errors with fallback attempts
- Data building operations

### Cache Management

Use the admin endpoints to manage cache:
- View cache statistics
- Clear specific cache categories
- Inspect cache values for debugging 