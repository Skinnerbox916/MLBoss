# MLBoss Data Layer Architecture

This document provides an in-depth overview of the MLBoss data layer architecture, explaining the design patterns, implementation details, and best practices.

## Architecture Overview

The MLBoss data layer follows a modern React architecture with these key components:

1. **Service Layer**: Low-level API services that directly communicate with external APIs
2. **React Query Layer**: Custom hooks that wrap services with React Query capabilities
3. **Context Layer**: Application-wide state management with React Context
4. **Feature Layer**: Composite hooks that combine multiple data sources for specific features

```
┌─────────────────────┐
│   UI Components     │
└─────────┬───────────┘
          │
┌─────────▼───────────┐     ┌─────────────────────┐
│   Feature Hooks     │◄────►  Context Providers  │
└─────────┬───────────┘     └─────────────────────┘
          │
┌─────────▼───────────┐
│  React Query Hooks  │
└─────────┬───────────┘
          │
┌─────────▼───────────┐     ┌─────────────────────┐
│   Service Layer     │◄────►    Redis Cache      │
└─────────┬───────────┘     └─────────────────────┘
          │
┌─────────▼───────────┐
│   External APIs     │
└─────────────────────┘
```

## 1. Service Layer (app/services/)

The service layer provides a clean interface to external APIs. It handles the complexities of:

- API request formatting
- Response parsing
- Error handling
- Server-side caching with Redis

Services are organized by domain and follow these principles:

- Singleton pattern for consistent instance management
- Method-based API for clear intent
- Domain-based organization (player, team, league)
- Consistent error handling patterns
- Type safety with comprehensive interfaces

### Example: Player Service

```typescript
// in app/services/yahoo/playerService.ts
export class PlayerService extends YahooApiService {
  async getPlayer(playerKey: string): Promise<YahooPlayer> {
    // Implementation with Redis caching and error handling
  }
  
  async getPlayerStats(
    playerKey: string, 
    statsType: string, 
    statsValue: string
  ): Promise<YahooPlayerStats> {
    // Implementation with appropriate caching category
  }
}
```

## 2. React Query Layer (app/hooks/)

The React Query layer provides React hooks that wrap service calls with React Query functionality, handling:

- Client-side caching
- Loading states
- Error states
- Refetching logic
- Stale data handling

Each hook follows these patterns:

- Clear naming convention (use[Entity][Action])
- Consistent return signature with data, loading, error states
- Proper TypeScript typing
- Query key management for effective cache control
- Cache time configuration based on data characteristics

### Example: Player Hooks

```typescript
// in app/hooks/usePlayer.ts
export function usePlayer(playerId?: string, options = {}) {
  return useQuery({
    queryKey: playerId ? playerKeys.detail(playerId) : playerKeys.details(),
    queryFn: () => yahooServices.player.getPlayer(playerId!),
    enabled: !!playerId && (options.enabled !== false),
  });
}
```

### Query Key Factories

Each hook file implements query key factories to manage cache invalidation:

```typescript
const playerKeys = {
  all: ['players'] as const,
  details: () => [...playerKeys.all, 'detail'] as const,
  detail: (playerId: string) => [...playerKeys.details(), playerId] as const,
  // more key factories...
}
```

## 3. Context Layer (app/providers/)

The context layer provides application-wide state using React Context:

- `QueryProvider`: Configures the React Query client
- `FantasyDataProvider`: Provides common fantasy data to the entire app

This layer handles:
- Global state management
- Persistence of key data (e.g., user selections)
- Default configurations
- Data sharing between unrelated components

### Example: Fantasy Data Provider

```typescript
// in app/providers/fantasy-data-provider.tsx
export function FantasyDataProvider({ children }: { children: ReactNode }) {
  // State, effects, and derived data...
  
  return (
    <FantasyDataContext.Provider value={value}>
      {children}
    </FantasyDataContext.Provider>
  );
}

export function useFantasyData() {
  const context = useContext(FantasyDataContext);
  // Error handling...
  return context;
}
```

## 4. Feature Layer (app/hooks/)

The feature layer contains composite hooks that combine multiple data sources for specific features:

- Combines data from multiple sources
- Applies business logic and transformations
- Provides computed values and derived state
- Coordinates related data fetching

### Example: Lineup Optimizer

```typescript
// in app/hooks/useLineupOptimizer.ts
export function useLineupOptimizer(date?: string): UseLineupOptimizerResult {
  // Get team ID from context
  const { teamId } = useFantasyData();
  
  // Get current roster
  const { data: roster, ... } = useTeamRoster(teamId);
  
  // Get stats for roster players
  const playerStatsQueries = useQuery({
    // Query implementation...
  });
  
  // Combine data and apply optimization logic
  const optimizerQuery = useQuery({
    // Query implementation...
  });
  
  // Return combined result
  return {
    optimizedLineup: optimizerQuery.data || [],
    isLoading: rosterLoading || playerStatsQueries.isLoading,
    // More properties...
  };
}
```

## Caching Strategy

MLBoss implements a multi-level caching strategy:

### 1. Redis Server-Side Cache

Managed by the Redis service with category-based TTLs:

- **Static Data** (24h): League settings, player metadata
- **Daily Data** (12h): Rosters, standings, daily matchups
- **Realtime Data** (15m): Scores, live stats, player status

Implementation: `app/utils/cache.ts`

### 2. React Query Client-Side Cache

Configured in the QueryProvider with optimized default settings:

- Default stale time: 5 minutes
- Background refetching of stale data
- Revalidation on window focus
- Automatic retry for failed requests

Implementation: `app/providers/query-provider.tsx`

### 3. Invalidation Strategy

The architecture supports several cache invalidation approaches:

- **Time-Based**: Automatic expiration based on TTLs
- **Event-Based**: Manual invalidation on specific user actions
- **Focus-Based**: Revalidation when browser regains focus
- **Forced**: Explicit refresh functionality in the UI

## Best Practices

When working with the data layer, follow these guidelines:

1. **Use the Right Level of Abstraction**:
   - For UI components, use the feature hooks
   - For reusable components, use the base data hooks
   - Only use services directly for specialized cases

2. **Query Key Management**:
   - Always use the key factories for consistency
   - Include all dependencies in query keys
   - Use array structure for proper nesting

3. **Error Handling**:
   - Always implement appropriate error UI states
   - Use React Query's built-in error handling
   - Add retry logic for transient failures

4. **Performance Optimization**:
   - Set appropriate stale times based on data volatility
   - Use `enabled` option to control when queries run
   - Implement data prefetching for critical paths
   - Batch related queries when possible

5. **Development Patterns**:
   - Create hooks for reusable data access patterns
   - Co-locate related data fetching logic
   - Use custom hooks for complex data transformations
   - Prefer hooks over HOCs or render props

## Extending the Architecture

To add new functionality to the data layer:

1. **New API Service**:
   - Add methods to existing service classes
   - Or create new service class in the appropriate domain
   - Follow the established error handling patterns

2. **New React Query Hook**:
   - Add to existing hook files if related
   - Or create new hook file following naming conventions
   - Implement proper query key factory

3. **New Context Provider**:
   - Only create for truly global state
   - Consider composability with existing providers
   - Implement clear provider/consumer patterns

4. **New Feature Hook**:
   - Create for complex UI features with multiple data dependencies
   - Focus on data transformation and business logic
   - Maintain good separation of concerns

## Examples

See these examples for reference implementations:

- Basic data fetching: `app/components/dashboard/YahooDataHookExample.tsx`
- Composite data with business logic: `app/hooks/useLineupOptimizer.ts`
- Context usage: `app/providers/fantasy-data-provider.tsx` 