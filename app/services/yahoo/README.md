# Yahoo Fantasy Sports API Data Layer

This module provides a robust, type-safe interface for interacting with the Yahoo Fantasy Sports API. It handles the complexities of Yahoo's API responses, authentication, caching, and error handling to provide a clean, consistent interface for your application.

## Architecture

The data layer follows a service-oriented architecture with these key components:

1. **Base API Service**: Core functionality for making API requests (`apiService.ts`)
2. **Domain Services**: Specialized services for each domain entity:
   - `playerService.ts`: Player data operations
   - `teamService.ts`: Team data operations
   - `leagueService.ts`: League data operations
3. **Types**: Comprehensive TypeScript interfaces that model Yahoo's data structures

## Quick Start

Import and use the services in your React components:

```typescript
import { yahooServices } from '@/app/services/yahoo';

// In a React component
function MyComponent() {
  const [player, setPlayer] = useState(null);
  
  useEffect(() => {
    async function fetchData() {
      try {
        // Get a player by key
        const playerData = await yahooServices.player.getPlayer('123.p.1234');
        setPlayer(playerData);
      } catch (error) {
        console.error('Error fetching player:', error);
      }
    }
    
    fetchData();
  }, []);
  
  // Render component with player data
}
```

## React Query Hooks

The application now provides a more modern approach to data fetching using React Query hooks that wrap these services:

```typescript
// Import the specialized hooks
import { usePlayer, usePlayerStats } from '@/app/hooks/usePlayer';
import { useTeam, useTeamRoster } from '@/app/hooks/useTeam';
import { useLeague, useLeagueStandings } from '@/app/hooks/useLeague';

// In a React component
function PlayerProfile({ playerId }) {
  // Get player data with automatic caching and loading states
  const { 
    data: player, 
    isLoading, 
    isError, 
    error 
  } = usePlayer(playerId);
  
  // Get player stats with custom options
  const { 
    data: stats 
  } = usePlayerStats(playerId, 'season', '2025');
  
  if (isLoading) return <LoadingSpinner />;
  if (isError) return <ErrorMessage error={error} />;
  
  return (
    <div>
      <h1>{player.name.full}</h1>
      <p>Team: {player.editorial_team_abbr}</p>
      <StatsTable stats={stats} />
    </div>
  );
}
```

### Benefits of the React Query Hooks

- **Automatic Caching**: Results are cached and deduplicated
- **Loading & Error States**: Built-in loading and error handling
- **Stale-While-Revalidate**: Shows cached data immediately while fetching updates
- **Refetching**: Automatic background refetching based on window focus and network changes
- **Pagination & Infinite Queries**: Support for paginated data
- **Custom Cache Invalidation**: Invalidate data when it becomes outdated
- **Query Client**: Global query client for manual cache interactions

### Available Hooks

- **Player Hooks**: `usePlayer`, `usePlayerStats`, `usePlayerSearch`, `useInvalidatePlayerData`
- **Team Hooks**: `useTeam`, `useTeamRoster`, `useCurrentMatchup`, `useWeeklyMatchup`, `useInvalidateTeamData`
- **League Hooks**: `useLeague`, `useLeagueStandings`, `useLeagueScoreboard`, `useLeagueTransactions`, `useInvalidateLeagueData`
- **Feature Hooks**: `useLineupOptimizer` and other composite hooks for specific features

## Available Services

### Player Service

Access via `yahooServices.player`

```typescript
// Get player details
const player = await yahooServices.player.getPlayer('playerKey');

// Get player stats for a specific timeframe
const seasonStats = await yahooServices.player.getPlayerStats('playerKey', 'season', '2025');
const weekStats = await yahooServices.player.getPlayerStats('playerKey', 'week', '5');
const dateStats = await yahooServices.player.getPlayerStats('playerKey', 'date', '2025-05-10');

// Get player's game information for today
const gameInfo = await yahooServices.player.getPlayerGameInfo('playerKey');

// Search for players
const players = await yahooServices.player.searchPlayers('Ohtani');
```

### Team Service

Access via `yahooServices.team`

```typescript
// Get the current user's team details
const team = await yahooServices.team.getTeam();

// Get a specific team's details
const otherTeam = await yahooServices.team.getTeam('teamKey');

// Get team roster (current roster by default)
const roster = await yahooServices.team.getTeamRoster();

// Get roster for a specific date
const dateRoster = await yahooServices.team.getTeamRoster(undefined, '2025-05-10');

// Get team stats
const teamStats = await yahooServices.team.getTeamStats();
const weeklyStats = await yahooServices.team.getTeamStats(undefined, 'week', '5');

// Get team standings
const standings = await yahooServices.team.getTeamStandings();

// Get team matchups
const matchups = await yahooServices.team.getTeamMatchups();

// Get current matchup
const currentMatchup = await yahooServices.team.getCurrentMatchup();
```

### League Service

Access via `yahooServices.league`

```typescript
// Get league details
const league = await yahooServices.league.getLeague();

// Get league settings
const settings = await yahooServices.league.getLeagueSettings();

// Get league standings
const standings = await yahooServices.league.getLeagueStandings();

// Get league scoreboard (current week by default)
const scoreboard = await yahooServices.league.getLeagueScoreboard();

// Get scoreboard for a specific week
const week5Scoreboard = await yahooServices.league.getLeagueScoreboard(undefined, 5);

// Get league transactions
const transactions = await yahooServices.league.getLeagueTransactions();

// Filter transactions by type
const addDrops = await yahooServices.league.getLeagueTransactions(undefined, ['add', 'drop']);

// Get all teams in the league
const teams = await yahooServices.league.getLeagueTeams();
```

## Data Categories and Caching

The services implement an intelligent caching strategy with three category levels:

1. **Static Data** (cache TTL: 24h): League settings, game metadata, etc.
2. **Daily Data** (cache TTL: 12h): Team rosters, standings, players
3. **Realtime Data** (cache TTL: 15m): Scores, game info, player stats

Methods select appropriate categories automatically, but you can override them when needed.

## Error Handling

All services implement consistent error handling. Errors from the Yahoo API are properly parsed and propagated. Always wrap API calls in try/catch blocks:

```typescript
try {
  const player = await yahooServices.player.getPlayer('playerKey');
  // Process player data
} catch (error) {
  // Handle errors gracefully
  console.error('Failed to fetch player:', error);
  // Show user-friendly error message
}
```

## Authentication

The services use the authentication system from `app/utils/yahoo-api.ts`. Make sure users are properly authenticated before making API calls.

## Type Safety

The entire data layer is fully typed. Use TypeScript to get the benefits of autocompletion and type checking:

```typescript
import { YahooPlayer, YahooTeam, YahooLeague } from '@/app/types/yahoo';

// Use the types for state or props
const [players, setPlayers] = useState<YahooPlayer[]>([]);
```

## Extension and Customization

To add new API methods or services:

1. Add new methods to the appropriate service class
2. If creating a new domain service:
   - Create a new file following the pattern of existing services
   - Extend the `YahooApiService` base class
   - Export a singleton instance
   - Add it to the `index.ts` exports

## Common Issues

### Rate Limiting

Yahoo's API has rate limits. The service layer automatically implements retry logic, but be careful not to make too many requests at once. Batch requests when possible.

### Authentication Errors

If you encounter 401 errors, the user's authentication token may have expired. The service will attempt to handle this, but you might need to prompt the user to log in again.

### Data Parsing Errors

Yahoo's API response format is complex and sometimes inconsistent. If you encounter parsing errors, check if the data structure has changed and update the parsing logic accordingly.

## Example Component

See `app/components/dashboard/YahooDataExample.tsx` for a complete example of how to use these services in a React component. 