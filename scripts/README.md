# Scripts Directory

This directory contains utility scripts for the MLBoss project. All scripts can be run directly with Node.js.

## Available Scripts

### `fetch-probable-pitchers.js`
Fetches probable pitchers from MLB.com for the current date.

```bash
node scripts/fetch-probable-pitchers.js
```

**Output**: Saves data to `data/probable-pitchers.json`

### `clear-cache.js`
Clears Next.js webpack cache to resolve cache-related build issues.

```bash
node scripts/clear-cache.js
```

## Notes

- All scripts are JavaScript files that can be run directly with Node.js
- No compilation step is required
- Scripts automatically create necessary directories (`logs/`, `data/`) as needed
- Check individual script files for more detailed documentation 