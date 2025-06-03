# MLBoss Application Overview (Rewritten for Clarity)

## Introduction
MLBoss is a fantasy baseball management app for a small user base (fewer than 10 concurrent users). It integrates with the Yahoo Fantasy API (using Yahoo OAuth) to help users manage their fantasy baseball leagues. The focus is on simplicity and maintainability.

---

## 1. Core Features
- **Yahoo Fantasy API Integration:** Secure OAuth, server-side API calls
- **User Features:**
  - At-a-glance dashboard (Matchup score, catagory scores, transactions, news, roster issues, future cards to be added)
  - Roster management (Player info, waiver wire, etc.)
  - Matchup evaluation (category-by-category, stat deltas, winner calculation, etc.)
  - Lineup optimization (opposing pitchers, splits, hot/cold, etc.)
  - League overview (Standings, team statistics, etc.)
  - Admin console (cache clearing, debugging, user controls, future admin tools)
  - User data initialization
- **Main Pages:** Dashboard, Lineup, Matchup, Roster, League (each with specific data and actions)

---

## 2. System Architecture
- **Client-server separation:** All Yahoo API calls are server-side, client uses `/api/...` endpoints.
- **Error handling:** User-friendly messages, console logging, graceful API failure handling.
- **Type safety:** Strong TypeScript types/interfaces throughout.

---

## 3. Data Sourcing & Handling
- **Primary:** Yahoo Fantasy API (stat ID-driven logic, team logos, matchup parsing)
- **Secondary:** ESPN API (supplementary/fallback data)
- **Data transformation:** Consistent models, server-side category stat processing
- **Caching:**
  - Static (24h): player metadata, league settings
  - Daily (12h): rosters, standings
  - Realtime (15m): live scores, player stats/status. API first, cache fallback
  - Multi-level, graceful stale data handling, cache invalidation, in-memory for hot data

---

## 4. API Endpoints & Data Entities
- `/api/yahoo/team`: Team details
- `/api/yahoo/matchup`: Current matchup (opponent, category stats)
- `/api/yahoo/roster`: Team roster
- `/api/yahoo/league`: League data
- `/api/yahoo/player`: Player data
- **CategoryStat interface:**
  ```typescript
  interface CategoryStat {
    id: number;
    name: string;
    displayName: string;
    myStat: number;
    opponentStat: number;
    isHigherBetter: boolean;
    winning: boolean | null;
    delta?: number;
  }
  ```
  - `winning` and `delta` are calculated server-side.

---

## 5. Functional Requirements
### Team Data
- Fetch team details (with/without roster), current matchup, roster by date, matchup by week, refresh/invalidate
### Player Data
- Fetch player info, stats (by type/period), search, refresh/invalidate
### League Data
- Fetch league info/settings, standings, scoreboard, transactions, teams, stats, refresh/invalidate
### Game Data
- Which teams are playing on a given day and at what time.
### Client Composite Features
- Calculate/display matchup scores (W-L-T), lineup optimization, user data init

---

## 6. Data Layer & Service Requirements

- All interactions with external APIs (Yahoo, ESPN) must occur on the server side.
- Data returned from external APIs should be transformed on the server as needed to provide a consistent, application-specific shape for the client and UI.
- Transformation logic that is used in multiple places should be implemented in a way that allows for code reuse (e.g., as shared functions or modules).
- The data layer should be kept as simple and easy to maintain as possible, prioritizing clarity over abstraction or scalability.
- The focus is on maintainability and simplicity, not on advanced scaling or security.

---

## 7. UI/UX & Design
- **Layout:** Responsive, fixed sidebar (desktop), collapsible mobile menu, max width 1280px, light gray bg, white cards
- **Color/typography:** Primary purple (#3C1791), Inter/Barlow Condensed/Oswald fonts
- **Navigation/header:** Sidebar (logo, links), header (team info), purple highlights, mobile hamburger
- **Loading states:** EQ animation (auth), skeleton loading (pulse, gray bg)
- **Cards:** White, shadow, padding, rounded, responsive grids, purple accents
- **Responsiveness:** Layout, grid, typography, spacing adapt to device


---