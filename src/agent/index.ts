// AGENT Library Entry Point
// This file will contain the main logic, tools, and behaviors for LLM-powered agents in the MLBoss project.

import { redis, redisUtils } from '@/lib/redis';

// Agent state management using Redis
export class AgentState {
  constructor(private agentId: string) {}

  async saveState(key: string, value: any): Promise<void> {
    const stateKey = `agent:${this.agentId}:${key}`;
    await redisUtils.set(stateKey, JSON.stringify(value));
  }

  async getState<T>(key: string): Promise<T | null> {
    const stateKey = `agent:${this.agentId}:${key}`;
    const value = await redisUtils.get(stateKey);
    return value ? JSON.parse(value) : null;
  }

  async deleteState(key: string): Promise<void> {
    const stateKey = `agent:${this.agentId}:${key}`;
    await redisUtils.del(stateKey);
  }
}

// Agent cache utilities
export const agentCache = {
  async cacheResult(key: string, result: any, ttl: number = 3600): Promise<void> {
    const cacheKey = `cache:${key}`;
    await redisUtils.set(cacheKey, JSON.stringify(result), ttl);
  },

  async getCachedResult<T>(key: string): Promise<T | null> {
    const cacheKey = `cache:${key}`;
    const cached = await redisUtils.get(cacheKey);
    return cached ? JSON.parse(cached) : null;
  },

  async invalidateCache(key: string): Promise<void> {
    const cacheKey = `cache:${key}`;
    await redisUtils.del(cacheKey);
  }
};

// Example agent task with Redis integration
export async function exampleAgentTask(agentId: string = 'default'): Promise<string> {
  const state = new AgentState(agentId);
  
  // Check if task has been executed recently
  const lastExecution = await state.getState<number>('lastExecution');
  const now = Date.now();
  
  if (lastExecution && (now - lastExecution) < 60000) { // 1 minute cooldown
    return 'Agent task executed recently. Skipping execution.';
  }
  
  // Save execution timestamp
  await state.saveState('lastExecution', now);
  
  // Example: Cache expensive operation result
  const cacheKey = `expensive-operation-${agentId}`;
  let result = await agentCache.getCachedResult<string>(cacheKey);
  
  if (!result) {
    // Simulate expensive operation
    result = `Expensive operation completed at ${new Date().toISOString()}`;
    await agentCache.cacheResult(cacheKey, result, 300); // Cache for 5 minutes
  }
  
  return `Agent task executed. ${result}`;
}

// Agent health check
export async function agentHealthCheck(): Promise<{ status: string; redis: string }> {
  try {
    const pingResult = await redisUtils.ping();
    return {
      status: 'healthy',
      redis: pingResult === 'PONG' ? 'connected' : 'disconnected'
    };
  } catch (error) {
    return {
      status: 'unhealthy',
      redis: 'error'
    };
  }
} 