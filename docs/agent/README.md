# Agent System Documentation

➜ [../product-spec.md](../product-spec.md) – project overview

The AGENT library provides intelligent task automation with Yahoo Fantasy Sports integration, built on top of Redis caching and OAuth authentication.

## Overview

This library contains the logic, tools, and behaviors for LLM-powered agents in the MLBoss project. It includes task orchestration, tool integrations, and agent role definitions. The AGENT library is modular and designed to be extended as new agent capabilities are added.

> **Dashboard integration**: All dashboard cards obtain their data exclusively through typed methods in `src/agent/index.ts` (see `docs/agent/api.md`). Each React hook in `src/lib/hooks/` wraps one of those methods, keeping UI code agent-agnostic.

## Documentation Structure

- [Patterns & Examples](./patterns.md) - Common patterns and code examples
- [Implementation Status](./implementation.md) - Current implementation status and roadmap
- [Statistical Data Architecture](./stats.md) - stat_id usage and data handling
- [API Reference](./api.md) - Complete API documentation

## Quick Start

### Environment Configuration

All required variables are documented in the global **[Setup & Configuration](../setup.md)** guide. Ensure those values are present in your `.env.local` before using the Agent library.

### Basic Usage

```typescript
import { agentFantasy } from '@/agent';

// Get user's leagues with automatic caching
const leagues = await agentFantasy.getUserLeagues('user-123');

// Execute complex fantasy task
const result = await agentFantasy.executeFantasyTask('user-123', async (api) => {
  const leagues = await api.getUserLeagues();
  const teams = await Promise.all(
    leagues.map(league => api.getLeagueTeams(league.league_key))
  );
  return { leagues, teams };
});
```

## Core Components

### AgentState
Redis-based state management for agents. Used for storing agent-specific data, task history, and cooldowns.

### AgentCache
Intelligent caching system with TTL support. Implements tiered caching strategy (Static/Semi-dynamic/Dynamic).

### AgentAuth
Authentication utilities for user-contextualized tasks. Handles token validation and refresh.

### AgentFantasy
Enhanced fantasy sports operations with caching and error handling. Primary interface for Yahoo Fantasy API operations.

## Key Features

- **Automatic Token Management**: Seamless token refresh with 5-minute buffer
- **Tiered Caching**: Static (24-48h), Semi-dynamic (5min-1h), Dynamic (30s-1min)
- **Error Handling**: Comprehensive error handling with fallbacks
- **User Context**: Execute tasks with proper user authentication
- **State Management**: Redis-based state for agent coordination

## Extension Guidelines

When adding new agent capabilities:

1. **Use Existing Patterns**: Follow the established patterns in [patterns.md](./patterns.md)
2. **Implement Caching**: Use appropriate cache tiers for your data
3. **Handle Errors**: Provide graceful error handling and fallbacks
4. **Document APIs**: Add clear JSDoc comments and update [api.md](./api.md)
5. **Test Authentication**: Ensure proper token management

## Dependencies

The agent system depends on:
- `@/lib/redis` - Redis client and utilities
- `@/lib/yahoo-oauth` - Yahoo OAuth management
- `@/lib/yahoo-fantasy-api` - Yahoo Fantasy Sports API
- `@/lib/session` - Session management utilities

## Navigation

- For implementation details, see [implementation.md](./implementation.md)
- For code patterns, see [patterns.md](./patterns.md)
- For statistical data handling, see [stats.md](./stats.md)
- For API reference, see [api.md](./api.md)
- For the main project documentation, see [../../README.md](../../README.md) 