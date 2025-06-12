# Agent Patterns & Examples

This document contains common patterns and code examples for working with the MLBoss agent system.

## Authentication Patterns

### Basic Authentication Check
```typescript
// Always check authentication before Yahoo API calls
const session = await getSession();
if (!session.user) {
  return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
}
```

### Token Refresh Pattern
```typescript
// The YahooFantasyAPI class handles this automatically
const api = new YahooFantasyAPI(userId);
// Tokens refresh automatically with 5-minute buffer
const leagues = await api.getUserLeagues();
```

### User Context Pattern
```typescript
import { UserAgentTask } from '@/agent';

const task = new UserAgentTask('user-123', 'fantasy-agent');

// Execute with user context
const result = await task.executeWithUserContext(async (userData) => {
  console.log('User:', userData.name);
  console.log('Email:', userData.email);
  
  // Your task logic here
  return { success: true, message: `Hello ${userData.name}!` };
});
```

## Caching Patterns

### Static Caching Pattern (24-48h TTL)
```typescript
// Use static: prefix for data that never changes during season
const cacheKey = 'static:current_mlb_game';
const cached = await agentCache.getCachedResult(cacheKey);
if (cached) return cached;

const result = await getCurrentMLBSeason();
await agentCache.cacheResult(cacheKey, result, 86400); // 24-hour TTL
return result;
```

### Semi-dynamic Caching Pattern (5min-1h TTL)
```typescript
// Use semi-dynamic: prefix for data that changes occasionally
const cacheKey = `semi-dynamic:leagues:${userId}`;
const cached = await agentCache.getCachedResult(cacheKey);
if (cached) return cached;

const result = await expensiveOperation();
await agentCache.cacheResult(cacheKey, result, 300); // 5-minute TTL
return result;
```

### Dynamic Caching Pattern (30s-1min TTL)
```typescript
// Use dynamic: prefix for frequently changing data
const cacheKey = `dynamic:scoreboard:${leagueKey}:${week}`;
const cached = await agentCache.getCachedResult(cacheKey);
if (cached) return cached;

const result = await getScoreboard(leagueKey, week);
await agentCache.cacheResult(cacheKey, result, 30); // 30-second TTL
return result;
```

### Cache Invalidation Pattern
```typescript
// Invalidate related caches after an update
await agentCache.invalidateCache(`dynamic:roster:${teamKey}`);
await agentCache.invalidateCache(`semi-dynamic:teams:${leagueKey}`);
```

## Error Handling Patterns

### Basic Error Handling
```typescript
try {
  const result = await someOperation();
  return NextResponse.json(result);
} catch (error) {
  console.error('Operation failed:', error);
  return NextResponse.json(
    { error: error.message || 'Operation failed' },
    { status: 500 }
  );
}
```

### Fantasy API Error Handling
```typescript
const result = await agentFantasy.executeFantasyTask('user-123', async (api) => {
  try {
    const leagues = await api.getUserLeagues();
    return { success: true, leagues };
  } catch (error) {
    if (error.message.includes('token')) {
      // Token-related error, already handled by refresh logic
      throw error;
    }
    // Log and return graceful failure
    console.error('Fantasy API error:', error);
    return { success: false, error: error.message };
  }
});
```

## State Management Patterns

### Task Cooldown Pattern
```typescript
import { AgentState } from '@/agent';

async function scheduledFantasyUpdate(userId: string) {
  const state = new AgentState(`fantasy-updater:${userId}`);
  
  // Check if task ran recently (prevent spam)
  const lastRun = await state.getState<number>('lastUpdate');
  const now = Date.now();
  
  if (lastRun && (now - lastRun) < 3600000) { // 1 hour cooldown
    return { message: 'Update skipped - too recent' };
  }
  
  // Execute update
  const result = await analyzeUserFantasyLeagues(userId);
  
  // Save state
  await state.saveState('lastUpdate', now);
  await state.saveState('lastResult', result);
  
  return result;
}
```

### Task History Pattern
```typescript
const task = new UserAgentTask('user-123', 'analysis-agent');

// Execute and save task
const result = await task.executeWithUserContext(async (userData) => {
  // Perform analysis
  return { analyzed: true, timestamp: Date.now() };
});

await task.saveUserTask('daily-analysis', result);

// Retrieve history later
const history = await task.getUserTaskHistory('daily-analysis');
console.log('Last run:', new Date(history.timestamp));
```

## Fantasy Data Patterns

### Efficient League Data Access
```typescript
// Batch operations for efficiency
const leagues = await agentFantasy.getUserLeagues('user-123');
const teamsPromises = leagues.map(league => 
  agentFantasy.getLeagueTeams('user-123', league.league_key)
);
const allTeams = await Promise.all(teamsPromises);
```

### Stat Enrichment Pattern
```typescript
// Always use stat_id as the canonical key for statistics
const categories = await agentFantasy.getStatCategories('458'); // MLB 2025
const categoryMap = await agentFantasy.getStatCategoryMap('458');

// Enrich raw stats with metadata
const enrichedStats = rawStats.map(stat => ({
  stat_id: Number(stat.stat_id),
  value: Number(stat.value),
  ...categoryMap[stat.stat_id] // Adds name, display_name, position_types
}));

// Disambiguate similar stats by position
const isBatterStat = categoryMap[stat_id].position_types.includes('B');
const isPitcherStat = categoryMap[stat_id].position_types.includes('P');
```

### Complex Analysis Pattern
```typescript
// Multi-step analysis with error handling
const analysis = await agentFantasy.executeFantasyTask('user-123', async (api) => {
  const leagues = await api.getUserLeagues();
  const analysis = await Promise.all(leagues.map(async (league) => {
    const teams = await api.getLeagueTeams(league.league_key);
    return {
      league: league.name,
      teamCount: teams.length,
      userTeam: teams.find(t => t.is_owned_by_current_login === 1)?.name
    };
  }));
  
  return { totalLeagues: leagues.length, analysis };
});
```

## Health Check Pattern

```typescript
import { agentHealthCheck } from '@/agent';

// Monitor system health
const health = await agentHealthCheck();

if (health.status !== 'healthy') {
  console.error('Agent system unhealthy:', health);
  // Take corrective action
}

// Check specific components
if (health.redis !== 'connected') {
  console.error('Redis connection lost');
}

if (health.fantasy === 'no_access') {
  console.error('Fantasy API access issues');
}
```

## OAuth State Management Pattern

```typescript
import { agentOAuth } from '@/agent';

// Generate state for agent-initiated auth
const state = await agentOAuth.generateAgentOAuthState('my-agent', 'league-sync');

// Later, validate the state
const stateData = await agentOAuth.validateAgentOAuthState(state);
if (stateData) {
  console.log('Agent:', stateData.agentId);
  console.log('Purpose:', stateData.purpose);
}
```

## Best Practices

1. **Always use typed responses**: Define interfaces for your return types
2. **Cache appropriately**: Use the right cache tier for your data volatility
3. **Handle token refresh**: Let YahooFantasyAPI handle it automatically
4. **Log errors**: Always log errors for debugging but don't expose sensitive data
5. **Use batch operations**: Minimize API calls by batching where possible
6. **Implement cooldowns**: Prevent spam and respect rate limits
7. **Validate user context**: Always ensure proper authentication before operations 