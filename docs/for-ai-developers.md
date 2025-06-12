# For AI Developers

➜ [product-spec.md](./product-spec.md) – project overview

This guide is specifically written for LLMs working on the MLBoss codebase. It contains documentation strategy and key patterns to follow.

## Quick Links

- **Implementation Status** - See [agent/implementation.md](./agent/implementation.md)
- **Agent Patterns** - See [agent/patterns.md](./agent/patterns.md)
- **Agent API** - See [agent/api.md](./agent/api.md)
- **Statistical Architecture** - See [agent/stats.md](./agent/stats.md)

## Documentation Strategy

### Core Principles

1. **Keep docs near code** - Documentation lives next to the code it describes
   - `docs/agent/README.md` for agent library
   - Component-level docs in their directories

2. **One README per package root** - Don't over-nest documentation
   - Main concepts at package level
   - Implementation details in code comments

3. **Reality over aspiration** - Document what exists, not what's planned
   - This file tracks actual implementation status
   - No roadmap promises

4. **LLM-first, human-friendly** - Optimize for machine parsing
   - Clear structure and headings
   - Code examples with context
   - Error patterns and solutions

## Common Patterns

All authentication, caching, error-handling, and analysis patterns are now maintained in **[agent/patterns.md](./agent/patterns.md)**. Please refer to that document for up-to-date examples and contribute new patterns there to avoid duplication.

## Navigation Tips

1. **Start with implementation** - Check [agent/implementation.md](./agent/implementation.md) before planning features
2. **Use existing patterns** - See [agent/patterns.md](./agent/patterns.md) for working examples
3. **Check agent docs** - [agent/README.md](./agent/README.md) has the overview
4. **Reference Yahoo API guide** - [yahoo-api-reference.md](./yahoo-api-reference.md) for API details

## Environment Variables

Complete and up-to-date environment variable definitions live in **[Setup & Configuration](./setup.md)**. Refer to that file when updating or reviewing `.env.local`.

## Common Gotchas

1. **OAuth redirect** - Must use HTTPS (use ngrok for local dev)
2. **Token expiration** - Access tokens last ~1 hour, use refresh tokens
3. **Rate limits** - Yahoo allows ~60-100 requests/hour, implement tiered caching (Static/Semi-dynamic/Dynamic)
4. **JSON structure** - Yahoo's JSON has numeric keys, consider using XML

## Quick Command Reference

```powershell
# Start Redis (Docker)
docker run -d -p 6379:6379 redis:alpine

# Start development server
npm run dev

# Check Redis connection
npm run test-redis
```

## Where to Find Things

- **OAuth logic**: `/src/lib/yahoo-oauth.ts`
- **Fantasy API**: `/src/lib/yahoo-fantasy-api.ts`
- **Agent system**: `/src/agent/`
- **API routes**: `/src/app/api/`
- **Session config**: `/src/lib/session.ts`
- **Redis client**: `/src/lib/redis.ts`
- **UI Components**: 
  - Icon system: `/src/components/Icon.tsx` (wrapper for react-icons)
  - Layout: `/src/components/layout/AppLayout.tsx`
  - Utils: `/src/lib/utils.ts` (cn helper for className concatenation) 