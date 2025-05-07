# MLBoss

A fantasy baseball management application that integrates with Yahoo Fantasy API.

## Caching Implementation

This application now includes Redis-based caching for Yahoo API responses to improve performance and reduce API calls. The caching system includes:

- In-memory caching for ESPN scoreboard data
- Redis persistent caching for Yahoo API responses
- Configurable TTLs (Time-To-Live) for different types of data
- Stale data handling
- Cache invalidation mechanisms

### Environment Variables

To configure the caching system, copy the following variables to your `.env.local` file:

```
# Redis cache configuration
REDIS_URL=redis://localhost:6379
CACHE_ENABLED=true

# Cache TTLs (in seconds)
DEFAULT_CACHE_TTL=900        # 15 minutes
GAME_DATA_CACHE_TTL=3600     # 1 hour
TEAM_DATA_CACHE_TTL=86400    # 24 hours

# Yahoo API configuration
YAHOO_CLIENT_ID=your_client_id
YAHOO_CLIENT_SECRET=your_client_secret
YAHOO_REDIRECT_URI=http://localhost:3000/api/yahoo/callback
```

### Redis Setup

1. Install Redis locally or use a cloud provider like Redis Labs or AWS ElastiCache
2. Set the `REDIS_URL` environment variable to your Redis instance URL
3. Set `CACHE_ENABLED=true` to enable caching

For local development, you can use Docker Compose:

```bash
# Start Redis
docker-compose up -d

# Check Redis status
docker-compose ps
```

Alternatively, you can run Redis directly with Docker:

```bash
docker run -d -p 6379:6379 --name mlboss-redis redis
```

### Cache TTLs

The caching system uses different TTLs based on the type of data:

- Default: 15 minutes
- Game data (scores, schedules): 1 hour
- Team data (roster, standings): 24 hours

These can be configured through environment variables.

## Getting Started

1. Clone the repository
2. Install dependencies:
   ```bash
   npm install
   ```
3. Set up environment variables in `.env.local`
4. Start the development server:
   ```bash
   npm run dev
   ```

## Features

- Yahoo Fantasy API integration
- MLB game schedules and scores
- Player roster management
- Redis caching for improved performance
- Fallback to ESPN data when Yahoo data is unavailable
