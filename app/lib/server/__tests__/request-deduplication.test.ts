import { deduplicateRequest, getDeduplicationStats } from '../request-deduplication';

describe('Request Deduplication', () => {
  beforeEach(() => {
    // Clear any pending requests between tests
    jest.clearAllMocks();
  });

  describe('deduplicateRequest', () => {
    it('should execute function for first request', async () => {
      const mockFn = jest.fn().mockResolvedValue('test result');
      
      const result = await deduplicateRequest('test-key', mockFn);
      
      expect(result).toBe('test result');
      expect(mockFn).toHaveBeenCalledTimes(1);
    });

    it('should deduplicate concurrent requests with same key', async () => {
      const mockFn = jest.fn().mockImplementation(() => 
        new Promise(resolve => setTimeout(() => resolve('test result'), 100))
      );
      
      // Start multiple concurrent requests
      const promises = [
        deduplicateRequest('same-key', mockFn),
        deduplicateRequest('same-key', mockFn),
        deduplicateRequest('same-key', mockFn)
      ];
      
      const results = await Promise.all(promises);
      
      // All should get the same result
      expect(results).toEqual(['test result', 'test result', 'test result']);
      // But the function should only be called once
      expect(mockFn).toHaveBeenCalledTimes(1);
    });

    it('should not deduplicate requests with different keys', async () => {
      const mockFn = jest.fn().mockImplementation((key: string) => 
        Promise.resolve(`result for ${key}`)
      );
      
      const promises = [
        deduplicateRequest('key1', () => mockFn('key1')),
        deduplicateRequest('key2', () => mockFn('key2')),
        deduplicateRequest('key3', () => mockFn('key3'))
      ];
      
      const results = await Promise.all(promises);
      
      expect(results).toEqual(['result for key1', 'result for key2', 'result for key3']);
      expect(mockFn).toHaveBeenCalledTimes(3);
    });

    it('should handle errors properly', async () => {
      const mockError = new Error('Test error');
      const mockFn = jest.fn().mockRejectedValue(mockError);
      
      // Start multiple concurrent requests
      const promises = [
        deduplicateRequest('error-key', mockFn).catch(e => e),
        deduplicateRequest('error-key', mockFn).catch(e => e),
        deduplicateRequest('error-key', mockFn).catch(e => e)
      ];
      
      const results = await Promise.all(promises);
      
      // All should get the same error
      expect(results).toEqual([mockError, mockError, mockError]);
      // But the function should only be called once
      expect(mockFn).toHaveBeenCalledTimes(1);
    });

    it('should allow new request after previous completes', async () => {
      const mockFn = jest.fn()
        .mockResolvedValueOnce('first result')
        .mockResolvedValueOnce('second result');
      
      // First request
      const result1 = await deduplicateRequest('sequential-key', mockFn);
      expect(result1).toBe('first result');
      expect(mockFn).toHaveBeenCalledTimes(1);
      
      // Second request (after first completes)
      const result2 = await deduplicateRequest('sequential-key', mockFn);
      expect(result2).toBe('second result');
      expect(mockFn).toHaveBeenCalledTimes(2);
    });
  });

  describe('getDeduplicationStats', () => {
    it('should track deduplication statistics', async () => {
      const mockFn = jest.fn().mockImplementation(() => 
        new Promise(resolve => setTimeout(() => resolve('test'), 50))
      );
      
      // Reset stats
      const initialStats = getDeduplicationStats();
      const baseTotal = initialStats.totalRequests;
      const baseDeduplicated = initialStats.dedupedRequests;
      
      // Make concurrent requests
      await Promise.all([
        deduplicateRequest('stats-key', mockFn),
        deduplicateRequest('stats-key', mockFn),
        deduplicateRequest('stats-key', mockFn)
      ]);
      
      const stats = getDeduplicationStats();
      
      // Should have 3 total requests but 2 were deduplicated
      expect(stats.totalRequests).toBe(baseTotal + 3);
      expect(stats.dedupedRequests).toBe(baseDeduplicated + 2);
      expect(stats.dedupedRequests).toBeGreaterThanOrEqual(2);
    });
  });
}); 