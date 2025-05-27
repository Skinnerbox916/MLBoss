# Testing Documentation

## Overview

The MLBoss application includes a comprehensive test suite focusing on critical data transformation and caching logic. Tests are written using Jest and TypeScript.

## Test Structure

```
app/
├── transformers/yahoo/__tests__/
│   └── playerTransformer.test.ts    # Tests for player data transformation
├── data/__tests__/
│   └── facade.test.ts               # Tests for data facade functions
└── lib/server/__tests__/
    ├── cache.test.ts                # Tests for Redis cache implementation
    └── request-deduplication.test.ts # Tests for request deduplication

```

## Running Tests

### Install Dependencies

First, ensure all test dependencies are installed:

```bash
npm install
```

### Run All Tests

```bash
npm test
```

### Run Tests in Watch Mode

For development, run tests in watch mode to automatically re-run on changes:

```bash
npm run test:watch
```

### Run Tests with Coverage

To see test coverage reports:

```bash
npm run test:coverage
```

## Test Categories

### 1. Transformer Tests

Located in `app/transformers/yahoo/__tests__/`

These tests ensure that raw Yahoo API responses are correctly transformed into typed data structures.

**What they test:**
- Null/undefined safety
- Type conversions (string to number, etc.)
- Data normalization
- Edge cases and error handling

**Example:**
```typescript
it('should transform player stats correctly', () => {
  const rawStats = {
    stats: [{
      stat: [
        { stat_id: '7', value: '25' }, // Runs
        { stat_id: '12', value: '10' } // HRs
      ]
    }]
  };

  const result = PlayerTransformer.transformStats(rawStats);

  expect(result).toHaveLength(2);
  expect(result[0]).toEqual({ stat_id: '7', value: 25 });
});
```

### 2. Data Facade Tests

Located in `app/data/__tests__/`

These tests verify that the data facade correctly combines data from multiple sources and handles caching appropriately.

**What they test:**
- Cache hit/miss scenarios
- Data enrichment logic
- Error handling and fallbacks
- Proper cache categorization

**Example:**
```typescript
it('should return cached data when available', async () => {
  const cachedData = { /* ... */ };
  (getCachedData as jest.Mock).mockResolvedValue(cachedData);

  const result = await getDashboardData();

  expect(result).toEqual(cachedData);
  expect(yahooServices.league.getLeague).not.toHaveBeenCalled();
});
```

### 3. Cache Tests

Located in `app/lib/server/__tests__/cache.test.ts`

These tests ensure the Redis cache implementation correctly handles different cache categories and TTLs.

**What they test:**
- TTL enforcement by category
- Stale data handling
- Cache key generation
- Clear cache operations

**Example:**
```typescript
it('should return stale daily data by default', async () => {
  const testData = { test: 'data' };
  const metadata = {
    expiresAt: Date.now() - 3600000, // 1 hour ago
    ttl: 43200,
    category: 'daily'
  };

  // Mock Redis responses
  (mockRedisClient.get as jest.Mock)
    .mockResolvedValueOnce(JSON.stringify(testData))
    .mockResolvedValueOnce(JSON.stringify(metadata));

  const result = await serverCache.getCachedData('daily:test-key');

  expect(result).toEqual(testData);
});
```

### 4. Request Deduplication Tests

Located in `app/lib/server/__tests__/request-deduplication.test.ts`

These tests verify that concurrent identical requests are properly deduplicated.

**What they test:**
- Single execution for concurrent requests
- Proper error propagation
- Statistics tracking
- Sequential request handling

## Writing New Tests

### Test File Naming

- Test files should be placed in `__tests__` directories
- Test files should end with `.test.ts`
- Name should match the file being tested

### Test Structure

```typescript
describe('ComponentName', () => {
  beforeEach(() => {
    // Setup before each test
    jest.clearAllMocks();
  });

  describe('methodName', () => {
    it('should do something specific', () => {
      // Arrange
      const input = { /* ... */ };
      
      // Act
      const result = methodName(input);
      
      // Assert
      expect(result).toEqual(expectedOutput);
    });
  });
});
```

### Mocking

The test suite uses Jest mocks extensively to isolate units of code:

```typescript
// Mock external dependencies
jest.mock('../../services/yahoo');
jest.mock('../../lib/server/cache');

// Mock specific return values
(getCachedData as jest.Mock).mockResolvedValue(mockData);
```

## Best Practices

1. **Test Behavior, Not Implementation**: Focus on what the code does, not how it does it
2. **Use Descriptive Test Names**: Test names should clearly describe what is being tested
3. **Keep Tests Independent**: Each test should be able to run in isolation
4. **Mock External Dependencies**: Don't make real API calls or database connections
5. **Test Edge Cases**: Include tests for error conditions and boundary values

## Troubleshooting

### TypeScript Errors in Tests

If you see TypeScript errors about Jest globals (`describe`, `it`, `expect`), ensure:
1. `@types/jest` is installed
2. The test file is included in `tsconfig.test.json`
3. Your IDE is using the correct TypeScript configuration

### Mock Not Working

If mocks aren't working as expected:
1. Ensure `jest.clearAllMocks()` is called in `beforeEach`
2. Check that the mock path matches the actual import path
3. Verify the mock is set up before the code under test runs

### Async Test Issues

For async tests:
1. Always use `async/await` or return the Promise
2. Use `mockResolvedValue` for async mocks
3. Consider increasing timeout for slow operations

## Coverage Goals

While 100% coverage isn't always necessary, aim for:
- **Transformers**: 90%+ (pure functions, easy to test)
- **Data Facade**: 80%+ (focus on happy paths and error cases)
- **Cache Layer**: 85%+ (critical infrastructure)
- **Utilities**: 90%+ (usually pure functions)

Run `npm run test:coverage` to see current coverage and identify gaps. 