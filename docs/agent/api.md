# Agent API Reference

## Core Components

### AgentState

Redis-based state management for agents.

```typescript
class AgentState {
  constructor(agentId: string)
  
  // Save state data
  async saveState(key: string, value: any): Promise<void>
  
  // Retrieve state data
  async getState<T>(key: string): Promise<T | null>
  
  // Delete state data
  async deleteState(key: string): Promise<void>
}
```

**Example:**
```typescript
const state = new AgentState('my-agent');
await state.saveState('lastRun', Date.now());
const lastRun = await state.getState<number>('lastRun');
```

### AgentCache

Caching utilities with TTL support.

```typescript
const agentCache = {
  // Cache a result with optional TTL (default: 1 hour)
  async cacheResult(key: string, result: any, ttl?: number): Promise<void>
  
  // Retrieve cached result
  async getCachedResult<T>(key: string): Promise<T | null>
  
  // Invalidate cache entry
  async invalidateCache(key: string): Promise<void>
}
```

**Example:**
```typescript
await agentCache.cacheResult('leagues:user123', leagues, 300); // 5 min TTL
const cached = await agentCache.getCachedResult<League[]>('leagues:user123');
```

### AgentAuth

Authentication utilities for user-contextualized tasks.

```typescript
const agentAuth = {
  // Get user data from Redis
  async getUserFromRedis(userId: string): Promise<any | null>
  
  // Check if user's token is valid
  async isTokenValid(userId: string): Promise<boolean>
  
  // Refresh user's OAuth tokens
  async refreshUserTokens(userId: string): Promise<boolean>
  
  // Get current session user
  async getCurrentUser(): Promise<any | null>
}
```

**Example:**
```typescript
const user = await agentAuth.getUserFromRedis('user-123');
if (!await agentAuth.isTokenValid('user-123')) {
  await agentAuth.refreshUserTokens('user-123');
}
```

### AgentFantasy

Enhanced fantasy sports operations with caching.

```typescript
const agentFantasy = {
  // Get user's leagues with caching
  async getUserLeagues(
    userId: string, 
    gameKeys?: string[], 
    cacheTTL?: number
  ): Promise<League[] | null>
  
  // Get teams in a league with caching
  async getLeagueTeams(
    userId: string, 
    leagueKey: string, 
    includeManagers?: boolean, 
    cacheTTL?: number
  ): Promise<Team[] | null>
  
  // Check user's fantasy access
  async checkUserFantasyAccess(userId: string): Promise<{
    hasAccess: boolean;
    error?: string;
  }>
  
  // Get current MLB game key
  async getCurrentMLBGameKey(userId?: string): Promise<string | null>
  
  // Get stat categories with caching
  async getStatCategories(
    gameKey: string, 
    userId?: string
  ): Promise<StatCategory[] | null>
  
  // Get stat category map
  async getStatCategoryMap(
    gameKey: string, 
    userId?: string
  ): Promise<Record<number, StatCategory> | null>
  
  // Enrich stats with metadata
  async enrichStats<T extends { stat_id: string | number; value: string | number }>(
    gameKey: string,
    stats: T[],
    userId?: string
  ): Promise<Array<T & StatCategoryMetadata> | null>
  
  // Execute complex fantasy task
  async executeFantasyTask<T>(
    userId: string, 
    taskFn: (api: YahooFantasyAPI) => Promise<T>
  ): Promise<T | null>
}
```

**Example:**
```typescript
// Get leagues with 5-minute cache
const leagues = await agentFantasy.getUserLeagues('user-123', undefined, 300);

// Execute complex task
const result = await agentFantasy.executeFantasyTask('user-123', async (api) => {
  const leagues = await api.getUserLeagues();
  return leagues.filter(l => l.scoring_type === 'head');
});
```

### UserAgentTask

Execute tasks with user authentication context.

```typescript
class UserAgentTask {
  constructor(userId: string, agentId?: string)
  
  // Execute task with user context
  async executeWithUserContext<T>(
    taskFn: (userData: any) => Promise<T>
  ): Promise<T | null>
  
  // Save task result
  async saveUserTask(taskName: string, result: any): Promise<void>
  
  // Get task history
  async getUserTaskHistory(taskName: string): Promise<any | null>
}
```

**Example:**
```typescript
const task = new UserAgentTask('user-123', 'analyzer');
const result = await task.executeWithUserContext(async (userData) => {
  return { analyzed: true, user: userData.name };
});
await task.saveUserTask('analysis', result);
```

## Pre-built Tasks

### analyzeUserFantasyLeagues

Comprehensive analysis of user's fantasy leagues.

```typescript
async function analyzeUserFantasyLeagues(
  userId: string
): Promise<LeagueAnalysis | null>

interface LeagueAnalysis {
  summary: {
    total_leagues: number;
    active_leagues: number;
    finished_leagues: number;
    sport_breakdown: Record<string, number>;
  };
  leagues: Array<{
    league_key: string;
    league_name: string;
    sport: string;
    season: string;
    is_active: boolean;
    total_teams: number;
    user_team?: {
      team_key: string;
      team_name: string;
      is_owned: boolean;
    };
  }>;
  timestamp: number;
}
```

### getUserTopTeams

Get user's best performing teams across all leagues.

```typescript
async function getUserTopTeams(
  userId: string, 
  limit?: number
): Promise<TopTeamsResult | null>

interface TopTeamsResult {
  top_teams: Array<{
    team_key: string;
    team_name: string;
    league_key: string;
    league_name: string;
    sport: string;
    estimated_rank: number;
    league_size: number;
    rank_percentage: number;
  }>;
  total_teams_analyzed: number;
  timestamp: number;
}
```

## Utility Functions

### authenticatedAgentTask

Execute a simple authenticated task.

```typescript
async function authenticatedAgentTask(
  userId: string, 
  taskFn: (userData: any) => Promise<any>,
  agentId?: string
): Promise<any>
```

### agentHealthCheck

Check health of all agent systems.

```typescript
async function agentHealthCheck(): Promise<{
  status: string;
  redis: string;
  oauth: string;
  fantasy: string;
  sessionCount: number;
}>
```

### agentOAuth

OAuth state management for agents.

```typescript
const agentOAuth = {
  // Generate OAuth state for agent flows
  async generateAgentOAuthState(
    agentId: string, 
    purpose: string
  ): Promise<string>
  
  // Validate and retrieve OAuth state
  async validateAgentOAuthState(
    state: string
  ): Promise<{ agentId: string; purpose: string } | null>
}
```

## Type Definitions

### League
```typescript
interface League {
  league_key: string;
  league_id: string;
  name: string;
  url: string;
  logo_url?: string;
  draft_status: string;
  num_teams: number;
  scoring_type: string;
  league_type: string;
  current_week?: string;
  is_finished?: number;
  // ... additional properties
}
```

### Team
```typescript
interface Team {
  team_key: string;
  team_id: string;
  name: string;
  is_owned_by_current_login?: number;
  url: string;
  team_logos?: Array<{ size: string; url: string; }>;
  managers?: Array<Manager>;
  // ... additional properties
}
```

### StatCategory
```typescript
interface StatCategory {
  stat_id: number;
  name: string;
  display_name: string;
  sort_order: string;
  position_types?: string[];
  is_composite_stat?: number;
  base_stats?: string[];
}
```

## Error Handling

All agent functions return `null` on error and log errors to console. For more control, use try-catch blocks:

```typescript
try {
  const leagues = await agentFantasy.getUserLeagues('user-123');
  if (!leagues) {
    // Handle null response (error occurred)
  }
} catch (error) {
  // Handle unexpected errors
}
```

## Cache Key Conventions

- **Static data** (24-48h TTL): `static:{resource}:{identifier}`
- **Semi-dynamic data** (5min-1h TTL): `semi-dynamic:{resource}:{identifier}`
- **Dynamic data** (30s-1min TTL): `dynamic:{resource}:{identifier}:{timestamp}`
- **Agent state**: `agent:{agentId}:{key}`
- **User data**: `user:{userId}`
- **OAuth state**: `oauth_state:{state}` 