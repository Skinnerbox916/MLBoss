# MLBoss

This project is a Next.js app designed for LLM-driven development and automation.

## Libraries

### README Library
This library serves as a knowledge base for both human developers and LLM agents. It contains documentation, usage examples, and code snippets to help understand, use, and extend the project. The README library is intended to be referenced by LLM agents to automate tasks and generate code.

### AGENT Library
The AGENT library contains the logic, tools, and behaviors for LLM-powered agents. This includes task orchestration, tool integrations, prompt templates, and agent role definitions. The AGENT library is modular and designed to be extended as new agent capabilities are added.

### Redis Client
The project includes a Redis client for caching, session management, and data persistence. The Redis client is configured as a singleton and provides utility functions for common operations.

## Dependencies

- **Next.js 15.3.3** - React framework
- **React 19** - UI library
- **TypeScript** - Type safety
- **Tailwind CSS** - Styling
- **ioredis** - Redis client for Node.js

## Prerequisites

- Node.js (recommended version 18+)
- Redis server running locally (Docker recommended)

## Setup

### 1. Install Dependencies
```bash
npm install
```

### 2. Environment Configuration
Create a `.env.local` file in the project root:

```bash
# Redis Configuration
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_DB=0
# REDIS_PASSWORD=your_password_here_if_needed
```

### 3. Start Redis Server
If using Docker:
```bash
docker run -d -p 6379:6379 redis:alpine
```

### 4. Start Development Server
```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

## Redis Usage

The Redis client is available throughout the application:

```typescript
import { redis, redisUtils } from '@/lib/redis';

// Direct client usage
await redis.set('key', 'value');
const value = await redis.get('key');

// Utility functions
await redisUtils.set('key', 'value', 300); // with TTL
await redisUtils.ping(); // Test connection
```

## Learn More

- [Next.js Documentation](https://nextjs.org/docs)
- [Learn Next.js](https://nextjs.org/learn)
- [Agent Library](./src/agent/) - MLBoss agent functionality
- [ioredis Documentation](https://github.com/redis/ioredis) - Redis client

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
