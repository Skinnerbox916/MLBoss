/**
 * Request deduplication utility for preventing duplicate concurrent API calls
 * This helps reduce API rate limit pressure and improves performance
 */

// Map to store pending requests
const pendingRequests = new Map<string, Promise<any>>();

// Track request counts for monitoring
let deduplicationStats = {
  totalRequests: 0,
  dedupedRequests: 0,
  lastReset: Date.now()
};

/**
 * Reset deduplication stats periodically (every hour)
 */
function resetStatsIfNeeded() {
  const hourAgo = Date.now() - 60 * 60 * 1000;
  if (deduplicationStats.lastReset < hourAgo) {
    console.log(`Request deduplication stats: ${deduplicationStats.dedupedRequests}/${deduplicationStats.totalRequests} requests were deduplicated`);
    deduplicationStats = {
      totalRequests: 0,
      dedupedRequests: 0,
      lastReset: Date.now()
    };
  }
}

/**
 * Clean up the pending requests map to prevent memory leaks
 */
function cleanupPendingRequests() {
  // Clean up if map gets too large
  if (pendingRequests.size > 100) {
    console.warn(`Request deduplication: Clearing ${pendingRequests.size} pending requests to prevent memory leak`);
    pendingRequests.clear();
  }
}

/**
 * Deduplicate concurrent requests with the same key
 * 
 * @param key Unique key for the request
 * @param fn Async function that performs the actual request
 * @returns Promise that resolves to the request result
 */
export async function deduplicateRequest<T>(
  key: string,
  fn: () => Promise<T>
): Promise<T> {
  // Track stats
  deduplicationStats.totalRequests++;
  resetStatsIfNeeded();

  // Check if request is already in flight
  const pending = pendingRequests.get(key);
  if (pending) {
    deduplicationStats.dedupedRequests++;
    console.log(`Request deduplication: Reusing pending request for key: ${key}`);
    return pending as Promise<T>;
  }

  // Create new request promise
  const promise = fn()
    .then(result => {
      // Clean up on success
      pendingRequests.delete(key);
      cleanupPendingRequests();
      return result;
    })
    .catch(error => {
      // Clean up on error
      pendingRequests.delete(key);
      cleanupPendingRequests();
      throw error;
    });

  // Store the pending request
  pendingRequests.set(key, promise);
  
  return promise;
}

/**
 * Get current deduplication statistics
 */
export function getDeduplicationStats() {
  return {
    ...deduplicationStats,
    currentPendingRequests: pendingRequests.size
  };
}

/**
 * Clear all pending requests (use with caution)
 */
export function clearPendingRequests() {
  const count = pendingRequests.size;
  pendingRequests.clear();
  console.log(`Request deduplication: Cleared ${count} pending requests`);
} 