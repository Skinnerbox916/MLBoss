# MLBoss: Fantasy Baseball Decision Support System

>**LLM Agents Please Read:**
>**Purpose of this document**: This file captures the **product vision, user requirements, and high-level architecture**. It does **not** describe the source-code implementation. For engineering details and API contracts, start at `docs/README.md`.

➜ Environment setup: [setup.md](setup.md) | Agent docs: [agent/README.md](agent/README.md)

## Overview
MLBoss is a fantasy baseball decision support tool designed to help users make informed lineup decisions through comprehensive data analysis. The system focuses primarily on batter performance analysis while providing fantasy league-wide context for strategic decision-making.

## Core Purpose
To provide fantasy baseball managers with data-driven insights for daily lineup decisions, with a focus on batter performance against opposing pitchers and contextual factors that influence player performance in fantasy baseball contexts.

## Target Users
- Primary: Individual fantasy baseball managers
- Scale: Designed for 1-25 concurrent users
- Usage Patterns: Supports both casual (weekly) and active (daily) users
- League Support: Compatible with any Yahoo Fantasy Baseball league

## Key Features

### Batter Analysis
- **Opposing Pitcher Analysis**
  - Pitcher handedness (L/R)
  - Current season performance metrics (ERA, WHIP)
  - Future: Pitch mix and bullpen strength analysis
  - Note: Probable pitcher data integration required

### Performance Context
- **Hot/Cold Tracking**
  - Recent performance trends
  - Streak identification

### Statistical Analysis
- **Park Factors**
  - Existing park factor data integration
  - Future: Historical player performance at specific parks

### Splits Analysis
- Left/Right handed pitching
- Day/Night games
- Home/Away performance
- Future: Individual pitcher matchups (with sample size validation)

### Fantasy League Analysis
- Team strength/weakness identification
- Opponent analysis
- Fantasy league-wide statistical comparisons
- League rankings and standings
- Matchup analysis and projections

## Interface Structure

### User Interface
- **Dashboard**
  - Card-based layout for quick insights
  - Key metrics and alerts

### Dedicated Pages
- Matchup Analysis
- Lineup Management
- Roster Management (including future waiver wire and trade features)
- League Overview (rankings, matchups, statistics)

### Admin Panel
- User management
- Cache control
- Debugging tools

## Data Management

### Caching Strategy
Three-tier caching system:
1. **Static** (TTL: 24-48 hours)
   - Historical records
   - Park factors
   - Fantasy league settings
   - Stat category mappings (stat_id to metadata)
2. **Semi-dynamic** (TTL: 5min-1 hour)
   - Fantasy league standings
   - Team rosters
   - League settings
3. **Dynamic** (TTL: 30s-1 minute)
   - Player statistics (API-first with cache fallback)
   - Lineup changes
   - Injury updates
   - Game status

> Data is loaded into cache on the first user request after data is stale, rather than via automated batch jobs.

### Statistical Data Architecture

#### Canonical Stat Identification
All player and team statistics use `stat_id` as the canonical identifier. This numeric key system:
- **Eliminates ambiguity**: Each stat has a unique ID (e.g., 21 for batter strikeouts, 30 for pitcher strikeouts)
- **Provides consistency**: The same stat_id always represents the same statistic across all API calls
- **Enables position context**: Each stat includes position_types metadata indicating if it applies to batters, pitchers, or both

#### Stat Category Mapping
The system maintains a cached mapping of stat_ids to human-readable metadata:
```json
{
  "21": {
    "stat_id": 21,
    "name": "Strikeouts",
    "display_name": "K",
    "position_types": ["B"]
  },
  "30": {
    "stat_id": 30,
    "name": "Strikeouts", 
    "display_name": "K",
    "position_types": ["P"]
  }
}
```

This mapping is fetched once per game/season and cached for 48 hours, allowing instant lookups when processing player or team statistics.

## Technical Scope

### MVP Features
1. Yahoo Fantasy integration (prerequisite)
2. Core data analysis and presentation
3. Basic lineup management
4. Fantasy league-wide statistical analysis

### Future Considerations
- Automated lineup suggestions
- Notification system
- Advanced pitcher analysis
- Custom user preferences
- Multi-platform support
- Individual pitcher matchup analysis
- Historical park performance analysis

## Development Priorities
1. Yahoo Fantasy integration
2. Core data analysis and presentation
3. User interface and experience
4. Admin controls
5. Performance optimization

## UI Conventions

### Color System
MLBoss uses a custom color palette derived from the logo:
- **Primary**: Prussian blue (#132F43) - main brand color
- **Accent**: Dark goldenrod (#C89222) - highlights and CTAs  
- **Success**: Dark spring green (#2C6E49) / Sea green (#4C956C)
- **Background**: Isabelline (#F9F6F1) - warm neutral base

All colors are wired into Tailwind utilities (`bg-primary`, `text-accent`, etc.) with automatic dark mode support. See [design-system.md](design-system.md) for implementation details.

### Icon System
The application uses **react-icons** for consistent iconography:

- **Baseball-specific icons**: Game Icons (`react-icons/gi`)
  - `GiBaseballBat`, `GiBaseballGlove`, `GiBaseballStadium` for sports-related UI
- **General UI icons**: Feather Icons (`react-icons/fi`) 
  - `FiHome`, `FiSettings`, `FiUsers`, `FiList` for standard interface elements

**Usage Pattern**:
```tsx
import { GiBaseballBat } from 'react-icons/gi';
import { FiHome } from 'react-icons/fi';
import Icon from '@/components/Icon';

<Icon icon={GiBaseballBat} className="text-orange-600" />
<Icon icon={FiHome} size={24} />
```

The `Icon` wrapper component provides consistent sizing (default 20px), accessibility, and styling patterns. Both icon libraries use outline/stroke styling that works well together and supports light/dark themes. 