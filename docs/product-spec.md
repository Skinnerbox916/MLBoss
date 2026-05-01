# MLBoss: Fantasy Baseball Decision Support System

>**LLM Agents Please Read:**
>**Purpose of this document**: This file captures the **product vision, user requirements, and high-level architecture**. It does **not** describe the source-code implementation. For engineering details and API contracts, start at `docs/README.md`.

➜ Environment setup: [setup.md](setup.md) | Data layer: [data-architecture.md](data-architecture.md)

## Overview
MLBoss is a fantasy baseball decision support tool designed to help users make informed daily lineup and pitcher-streaming decisions through comprehensive data analysis. The system provides parallel batter and pitcher analysis surfaces backed by fantasy league-wide context for strategic decision-making.

## Core Purpose
To provide fantasy baseball managers with data-driven insights for daily lineup and roster decisions — both batter sit/start choices against opposing pitchers and pitcher streaming choices against opposing offenses — plus the contextual factors (park, weather, splits) that influence player performance in fantasy baseball contexts.

## Target Users
- Primary: Individual fantasy baseball managers
- Scale: Designed for 1-25 concurrent users
- Usage Patterns: Supports both casual (weekly) and active (daily) users
- League Support: Compatible with any Yahoo Fantasy Baseball league

## Key Features

### Batter Analysis
- **Opposing Pitcher Analysis**
  - Pitcher handedness (L/R) and quality tier (ACE → Bad)
  - Current season performance metrics (ERA, WHIP)
  - Future: Pitch mix and bullpen strength analysis
- **Lineup decisions** (sit/start against a given matchup)

### Pitcher Analysis
- **Today's Pitcher Sit/Start**
  - On the Today page alongside batter lineup — rostered pitchers grouped by Active / Bench / Injured with today's matchup context (opponent offense, park, weather) so you can sit a starter walking into Coors.
- **Streaming Board** (dedicated `/streaming` page)
  - Free-agent and waiver starting pitchers with probable starts for the selected day
  - Multi-day date strip covering **D+1 through D+5** — Yahoo only publishes probables for tomorrow, but MLB's schedule hydrates probables 3-5 days out, letting you plan pickups against the 6-moves-per-week cap.
  - Per-pitcher "Stream for:" category indicators (QS / K / W / ERA / WHIP) showing which fantasy categories each start is likely to help or hurt
  - Quality tier and composite quality score (color-coded row backgrounds)
- **Opposing Offense Analysis**
  - Team OPS vs LHP / RHP (handedness-aware matchup strength)
  - Team strikeout rate and runs per game
- **Matchup Pulse**
  - Live head-to-head category scoreboard vs this week's opponent, pinned above both Today and Streaming so pickup/lineup decisions know which categories to chase.

### Performance Context
- **Hot/Cold Tracking**
  - Recent performance trends
  - Streak identification

### Statistical Analysis
- **Park Factors** (applied to both batters and pitchers)
  - Existing park factor data integration
  - Hitter-friendly vs pitcher-friendly tendencies surfaced on pitcher streaming decisions
  - Future: Historical player performance at specific parks
- **Weather**
  - Temperature, wind direction/speed, and rain flagged on the streaming board when available from MLB

### Splits Analysis
- **Batter splits**: Left/Right handed pitching, Day/Night, Home/Away
- **Team offense splits**: Team OPS and strikeout rate vs LHP/RHP (drives handedness-aware pitcher streaming)
- Future: Individual pitcher matchups (with sample size validation)

### Fantasy League Analysis
- Team strength/weakness identification
- Opponent analysis
- Fantasy league-wide statistical comparisons
- League rankings and standings
- Matchup analysis and projections

## Interface Structure

Pages are organized around the **time horizon of the decision** being made rather than entity type. This keeps "Am I punting saves?" (long-term construction), "Do I start Skubal today?" (daily), and "Who do I stream Thursday?" (this week) on distinct, focused surfaces.

### User Interface

Five primary pages in the sidebar, in order of decision cadence:

1. **Dashboard** — reference/mixed-horizon snapshot
2. **Today** — daily sit/start for batters and pitchers
3. **Streaming** — D+1 through D+5 pitcher pickups
4. **Roster** — long-term roster construction (add/drop batters and pitchers)
5. **League** — standings and statistical reference

### Dedicated Pages

- **Dashboard** — card-based grid of key metrics and alerts. Absorbs the head-to-head category scoreboard (`CurrentScoreCard`) and season-comparison view that formerly lived on a separate Matchup page, and adds `OpponentStatusCard` (opponent injuries + probable pitchers) for scouting.
- **Today** — tabs for Batters and Pitchers. Both share a live **Matchup Pulse** at the top showing where you're winning and losing categories this week, so sit/start decisions are made with category leverage in mind.
- **Streaming** — standalone page for pitcher pickups. Date strip spans D+1 through D+5 so the 6-moves-per-week budget can be planned against advance probables; per-row pills call out QS / K / W / ERA / WHIP fit; composite score tints each row.
- **Roster** — tabs for Batters and Pitchers. Top of each tab: **RankStrip**, showing league rank + delta-to-leader for each category aggregated over the last 3 completed weeks of actual stat values (not W/L records) so the punt/chase call reflects recent reality post-roster-move. Batters tab is a full depth-chart + swap optimizer; Pitchers tab lists rostered + available pitchers (full pitcher optimizer is on the roadmap).
- **League Overview** — standings, rankings, statistics.

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
- Custom user preferences
- Multi-platform support
- Historical park performance analysis
- Pitcher hot/cold trend analysis (last N starts vs season baseline)
- Expandable splits panel for streaming candidates (pitch mix, career vs opponent)

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