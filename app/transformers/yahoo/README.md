# Yahoo API Transformers

This directory contains transformer classes that handle the parsing and transformation of Yahoo Fantasy Sports API responses into clean, typed data structures.

## Architecture

The transformer pattern separates data transformation logic from API communication logic, following the Single Responsibility Principle.

### Structure

```
app/transformers/yahoo/
├── baseTransformer.ts      # Base class with common utilities
├── playerTransformer.ts    # Player data transformations
├── teamTransformer.ts      # Team data transformations
├── leagueTransformer.ts    # League data transformations
└── index.ts               # Barrel exports
```

## Benefits

1. **Separation of Concerns**: Services focus on API communication, transformers handle data shaping
2. **Testability**: Transformation logic can be tested without mocking API calls
3. **Reusability**: Transformers can be used with cached data, mock data, or API responses
4. **Type Safety**: Better type guarantees and validation in one place
5. **Maintainability**: Changes to Yahoo's data structure only require updates in transformers

## Usage

```typescript
// In a service
import { PlayerTransformer } from '@/app/transformers/yahoo';

async getPlayer(playerKey: string): Promise<YahooPlayer> {
  const response = await this.get<YahooPlayerResponse>(`/player/${playerKey}`);
  return PlayerTransformer.transformPlayerResponse(response);
}
```

## Common Patterns

### Yahoo's Array-Wrapped Values

Yahoo's API wraps most values in arrays. The base transformer provides utilities to handle this:

```typescript
// Yahoo returns: { "name": ["John Doe"] }
const name = this.getString(data.name); // Returns "John Doe"
```

### Nested Data Structures

Yahoo's API has deeply nested structures. Transformers flatten these into cleaner interfaces:

```typescript
// Yahoo returns complex nested structure
// Transformer returns clean, flat structure
return {
  player_key: playerKey,
  name: {
    full: fullName,
    first: firstName,
    last: lastName
  },
  // ... other fields
};
```

## Testing

Transformers can be easily tested with mock data:

```typescript
describe('PlayerTransformer', () => {
  it('should transform player data correctly', () => {
    const mockData = { /* mock Yahoo response */ };
    const result = PlayerTransformer.transformPlayer(mockData);
    expect(result.player_key).toBe('expected_key');
  });
});
```

## Adding New Transformers

1. Create a new transformer class extending `BaseYahooTransformer`
2. Implement static methods for transforming different response types
3. Export from `index.ts`
4. Update services to use the transformer

## Error Handling

Transformers validate required fields and throw descriptive errors:

```typescript
if (!playerKey || !playerId) {
  throw new Error('Missing required player data');
}
```

This ensures data integrity and helps catch API changes early. 