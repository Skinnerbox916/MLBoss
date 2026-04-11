# Yahoo Fantasy Baseball API Guide

## Table of Contents

* [Introduction](#introduction)
* [OAuth Setup and Authentication](#oauth-setup-and-authentication)
  * [Registering an App](#registering-an-app)
  * [User Authorization (3‑legged OAuth)](#user-authorization-3-legged-oauth)
  * [Access Tokens and Refresh Tokens](#access-tokens-and-refresh-tokens)
* [API Basics and Endpoints](#api-basics-and-endpoints)
  * [Resource Keys and IDs](#resource-keys-and-ids)
  * [Request & Response Format](#request--response-format)
  * [Collections and Sub‑resources](#collections-and-sub-resources)
  * [Stat Categories & stat_id Mapping](#stat-categories--stat_id-mapping)
* [League Endpoints](#league-endpoints)
  * [League Metadata & Settings](#league-metadata--settings)
  * [Standings & Scoreboard](#standings--scoreboard)
  * [Teams in a League](#teams-in-a-league)
  * [League Players (Free Agents & Waivers)](#league-players-free-agents--waivers)
  * [Draft Results](#draft-results)
  * [League Transactions](#league-transactions)
* [Team Endpoints](#team-endpoints)
  * [Team Metadata & Stats](#team-metadata--stats)
  * [Team Standings](#team-standings)
  * [Team Roster (Viewing)](#team-roster-viewing)
  * [Matchups (Schedule)](#matchups-schedule)
* [Roster Management (Lineup Changes)](#roster-management-lineup-changes)
* [Transactions (Add/Drop & Trades)](#transactions-adddrop--trades)
  * [Adding & Dropping Players](#adding--dropping-players)
  * [Proposing Trades](#proposing-trades)
* [Pagination & Rate Limits](#pagination--rate-limits)
* [Caching Strategy](#caching-strategy)
* [Tips, Quirks, & Best Practices](#tips-quirks--best-practices)
* [Useful Tools & Libraries](#useful-tools--libraries)

---

## Introduction

The Yahoo Fantasy Sports API lets you programmatically manage fantasy baseball leagues: read league data, set line‑ups, add/drop players, propose trades, and more. All write operations require **OAuth 2.0 (three‑legged flow)** so the user can grant your app permission to act on their behalf.

**Base URL**

```
https://fantasysports.yahooapis.com/fantasy/v2/
```

---

## OAuth Setup and Authentication

### Registering an App

1. Create a new application at the Yahoo Developer Network.
2. Enable **Fantasy Sports – Read/Write** permission.
3. Supply a redirect URI (no raw `localhost`; use a public HTTPS URL or an ngrok tunnel while developing).
4. Record your **Client ID** (Consumer Key) and **Client Secret**.

### User Authorization (3‑legged OAuth)

Send the user to Yahoo's consent page:

```
https://api.login.yahoo.com/oauth2/request_auth?client_id=<CLIENT_ID>&redirect_uri=<REDIRECT_URI>&response_type=code&scope=openid%20offline
```

On success Yahoo calls back `redirect_uri?code=AUTH_CODE`.

### Access Tokens and Refresh Tokens

Exchange the auth code for tokens:

```http
POST https://api.login.yahoo.com/oauth2/get_token
Content-Type: application/x-www-form-urlencoded

client_id=<CLIENT_ID>&
client_secret=<CLIENT_SECRET>&
redirect_uri=<REDIRECT_URI>&
grant_type=authorization_code&
code=<AUTH_CODE>
```

Response includes `access_token` (≈1 hr) and `refresh_token` (long‑lived). Use the refresh token with `grant_type=refresh_token` to obtain new access tokens silently.

Include the bearer token in every API request:

```http
Authorization: Bearer <ACCESS_TOKEN>
```

---

## API Basics and Endpoints

### Resource Keys and IDs

| Resource | Key Pattern                | Example            |
| -------- | -------------------------- | ------------------ |
| Game     | `mlb` or numeric           | `458`              |
| League   | `{game_key}.l.{league_id}` | `458.l.123456`     |
| Team     | `{league_key}.t.{team_id}` | `458.l.123456.t.1` |
| Player   | `{game_key}.p.{player_id}` | `458.p.5479`       |

### Request & Response Format

* Default response is **XML**. Append `?format=json` or set `Accept: application/json` for JSON.
* JSON mirrors XML and nests data under `fantasy_content` with numeric keys. Consider parsing XML or using a wrapper library if JSON structure is cumbersome.

### Collections and Sub‑resources

* Multiple keys: `teams;team_keys=KEY1,KEY2`
* Multiple sub‑resources: `league/{league_key}/teams;out=roster`
* Filters (players): `status`, `position`, `search`, `sort`, `count`, `start`

### Stat Categories & stat_id Mapping

Player and team statistics are returned with numeric `stat_id` values that need to be mapped to readable names:

```json
{ "stat_id": "21", "value": "14" }  // What stat is this?
```

Use the stat categories endpoint to get the mapping:

```http
GET /game/{game_key}/stat_categories
```

This returns metadata for each stat including:
- `stat_id`: Unique identifier (e.g., 21 for batter strikeouts, 30 for pitcher strikeouts)
- `name`: Full name (e.g., "Strikeouts")
- `display_name`: Abbreviated name (e.g., "K")
- `position_types`: Array indicating if it's for batters ["B"], pitchers ["P"], or both

**Common MLB stat_ids:**
- Batting: 7 (R), 8 (H), 12 (HR), 13 (RBI), 16 (SB), 21 (K)
- Pitching: 26 (ERA), 27 (WHIP), 28 (W), 32 (SV), 42 (K), 50 (IP), 83 (QS)

Use Static caching (24-48h TTL) as stat categories never change during a season.

### Getting Current Season

To get the current MLB season efficiently:

```http
GET /games;game_codes=mlb
```

This returns all MLB seasons. To get just the current one:
1. Sort by season (highest first)
2. Look for `is_game_over === "0"` to find active season
3. If no active season, use the most recent (highest season number)

Example response structure:
```json
{
  "fantasy_content": {
    "games": {
      "0": {
        "game": [
          {
            "game_key": "458",
            "season": "2025",
            "code": "mlb",
            "is_game_over": "0"
          }
        ]
      }
    }
  }
}
```

Use Static caching (24h TTL) as current season info rarely changes.

---

## League Endpoints

### League Metadata & Settings

```http
GET /league/{league_key}                 # metadata
GET /league/{league_key}/settings        # detailed rules
```

### Standings & Scoreboard

```http
GET /league/{league_key}/standings
GET /league/{league_key}/scoreboard           # current week
GET /league/{league_key}/scoreboard;week=10   # specific week
```

### Teams in a League

```http
GET /league/{league_key}/teams
GET /league/{league_key}/teams;out=managers    # Include manager data (recommended)
```

**Important: Response Structure**

Yahoo's teams endpoint uses an unusual nested structure that requires careful parsing:

```json
{
  "fantasy_content": {
    "league": [
      { /* league metadata */ },
      {
        "teams": {
          "0": {
            "team": [
              [
                {"team_key": "458.l.124766.t.1"},
                {"team_id": "1"},
                {"name": "Team Name"},
                {"is_owned_by_current_login": 1},  // Only present for user's team
                {"url": "https://..."},
                {"team_logos": [...]},
                {"waiver_priority": 3},
                {"number_of_moves": 15},
                {"managers": [...]}  // If using ;out=managers
              ],
              {
                "managers": [...]  // Duplicate managers data
              }
            ]
          },
          "1": { /* next team with same structure */ },
          "count": 8
        }
      }
    ]
  }
}
```

**Key Parsing Notes:**
- Teams are stored as numbered string keys (`"0"`, `"1"`, `"2"`, etc.)
- Each team's properties are separate objects in an array (not a single object)
- The `is_owned_by_current_login` field only appears for the current user's team
- Use `;out=managers` to get manager data needed to identify the user's team
- Manager data appears twice: in the main array and as a separate object
- Always check for the `count` property and skip it during iteration

**Recommended parsing approach:**
```javascript
for (const [teamIndex, teamContainer] of Object.entries(teamsData)) {
  if (teamIndex === 'count') continue;
  
  const teamArray = teamContainer.team;
  const teamPropsArray = teamArray[0];  // Array of property objects
  const teamInfo = {};
  
  // Merge all property objects into one
  for (const propObj of teamPropsArray) {
    Object.assign(teamInfo, propObj);
  }
  
  // Now teamInfo has all team properties in a normal object structure
}
```

### League Players (Free Agents & Waivers)

```http
GET /league/{league_key}/players;status=FA;position=1B;start=0;count=25
```

Use `status=A` for all available (FA + waivers). `count` max is 25—loop with `start` for paging.

### Draft Results

```http
GET /league/{league_key}/draftresults
```

### League Transactions

```http
GET /league/{league_key}/transactions            # recent moves
GET /league/{league_key}/transactions;type=add   # adds only
```

---

## Team Endpoints

### Team Metadata & Stats

```http
GET /team/{team_key}                # metadata
GET /team/{team_key}/stats          # season-to‑date
GET /team/{team_key}/stats;type=week;week=7
```

### Team Standings

```http
GET /team/{team_key}/standings
```

### Team Roster (Viewing)

```http
GET /team/{team_key}/roster                     # today
GET /team/{team_key}/roster;date=2025-06-15     # specific day
GET /team/{team_key}/roster;week=9              # weekly leagues
```

### Matchups (Schedule)

```http
GET /team/{team_key}/matchups;weeks=1,2,3
```

---

## Roster Management (Lineup Changes)

Set your lineup by **PUT**‑ing XML to the roster endpoint.

```http
PUT /team/{team_key}/roster;date=2025-07-01
Content-Type: application/xml
```

```xml
<fantasy_content>
  <roster>
    <coverage_type>date</coverage_type>
    <date>2025-07-01</date>
    <players>
      <player>
        <player_key>458.p.1001</player_key>
        <position>1B</position>
      </player>
      <player>
        <player_key>458.p.2022</player_key>
        <position>BN</position>
      </player>
    </players>
  </roster>
</fantasy_content>
```

Only list players you are moving. Yahoo enforces roster rules and lock times.

---

## Transactions (Add/Drop & Trades)

### Adding & Dropping Players

```http
POST /league/{league_key}/transactions
Content-Type: application/xml
```

```xml
<fantasy_content>
  <transaction>
    <type>add/drop</type>
    <players>
      <player>
        <player_key>{ADD_PLAYER}</player_key>
        <transaction_data>
          <type>add</type>
          <destination_team_key>{YOUR_TEAM}</destination_team_key>
        </transaction_data>
      </player>
      <player>
        <player_key>{DROP_PLAYER}</player_key>
        <transaction_data>
          <type>drop</type>
          <source_team_key>{YOUR_TEAM}</source_team_key>
        </transaction_data>
      </player>
    </players>
  </transaction>
</fantasy_content>
```

Yahoo determines whether the add is immediate or a waiver claim based on league rules.

### Proposing Trades

Structure is similar, but with `<type>trade</type>` and each player identifying both source and destination teams. Pending trades can be accepted, rejected, or vetoed via **PUT** to `/transaction/{transaction_key}` with an `<action>` field (`accept`, `reject`, `allow`, etc.).

---

## Pagination & Rate Limits

* **Players list** limited to 25 per call → iterate with `start`.
* Yahoo does not publish hard limits, but devs report ~60‑100 requests per hour. Implement proper caching strategy (see [Caching Strategy](#caching-strategy)) and batch requests wherever possible.

---

## Caching Strategy

Yahoo Fantasy API endpoints return a mix of data with different volatility levels. Implement a tiered caching strategy to optimize performance and reduce API calls:

### Cache Categories

| Category | TTL | Use Cases | Examples |
|----------|-----|-----------|----------|
| **Static** | 24-48 hours | Data that never changes during season | Game metadata, stat categories, league settings |
| **Semi-dynamic** | 5min-1 hour | Data that changes occasionally | League lists, team rosters, standings |
| **Dynamic** | 30s-1 minute | Real-time data that changes frequently | Scoreboards, live stats, recent transactions |

### Implementation Guidelines

**Static Data (24-48h TTL)**
```
Cache Key: static:{resource}:{identifier}
Examples:
- static:stat_categories:458
- static:current_mlb_game
- static:league_settings:458.l.123456
```

Use for:
- `/game/{game_key}/stat_categories` - Stat definitions never change
- `/games;game_codes=mlb` - Current season info rarely changes
- `/league/{league_key}/settings` - League rules set at start of season

**Semi-dynamic Data (5min-1h TTL)**
```
Cache Key: semi-dynamic:{resource}:{identifier}
Examples:
- semi-dynamic:leagues:user123
- semi-dynamic:teams:458.l.123456
- semi-dynamic:standings:458.l.123456
```

Use for:
- `/users;use_login=1/games/leagues` - User's league list changes occasionally
- `/league/{league_key}/teams` - Team list and basic info stable during season
- `/league/{league_key}/standings` - Updated daily or weekly

**Dynamic Data (30s-1min TTL or no cache)**
```
Cache Key: dynamic:{resource}:{identifier}:{timestamp}
Examples:
- dynamic:scoreboard:458.l.123456:week10
- dynamic:transactions:458.l.123456:recent
- dynamic:roster:458.l.123456.t.1:2025-07-15
```

Use for:
- `/league/{league_key}/scoreboard` - Live scoring updates
- `/team/{team_key}/roster;date=today` - Daily lineup changes
- `/league/{league_key}/transactions` - Recent moves and adds

### Best Practices

1. **Separate static from dynamic data**: Don't call `/league/{key}/teams;out=stats` if you only need team names (static) and not current stats (dynamic).

2. **Use appropriate sub-resources**: Request only what you need:
   ```
   /league/{key}/teams           # Basic team info (semi-dynamic)
   /league/{key}/teams;out=stats # Includes current stats (dynamic)
   ```

3. **Cache invalidation**: Provide manual cache clearing for critical updates:
   ```
   - User makes roster change → clear dynamic:roster:* for that team
   - Trade occurs → clear semi-dynamic:teams:* for that league
   ```

4. **Background refresh**: For frequently accessed data, refresh cache proactively:
   ```
   - Update standings every hour during active play
   - Refresh scoreboards every 2-3 minutes during games
   ```

---

## Tips, Quirks, & Best Practices

* **Use batch calls:** e.g., `/league/{league_key}/teams;out=roster` returns every team with its roster in one request.
* **Teams API has unusual structure:** The `/teams` endpoint returns properties as separate objects in arrays, not standard JSON objects. Always use `;out=managers` and implement proper parsing logic (see Teams section above).
* **XML vs JSON:** JSON mirrors XML with numeric keys—if that's painful, parse XML or rely on a wrapper library.
* **Local testing:** Yahoo callbacks must be HTTPS; use ngrok or a staging domain instead of plain `localhost`.
* **Projected stats & live play‑by‑play** are **not exposed**; you'll need external sources if you need projections.
* **Handle token refresh** automatically; most wrapper libraries include a callback for persisting new tokens.

---

## Useful Tools & Libraries

| Tool / Library          | Language | Notes                                                            |
| ----------------------- | -------- | ---------------------------------------------------------------- |
| **yahoo-fantasy**       | Node.js  | Simplifies OAuth & API calls; handles token refresh and parsing. |
| **NextAuth**            | Node.js  | Add Yahoo provider for web login in Next.js apps.                |
| **yahoo_fantasy_api**   | Python   | Full wrapper for OAuth + endpoints.                              |
| **yahoo_oauth**         | Python   | Handles token storage/refresh; can be combined with raw HTTP.    |
| **YFAR**                | R        | Tidy R interface; returns data frames.                           |
| **Postman**             | Any      | Great for testing endpoints with OAuth tokens.                   |

Leverage these libraries to avoid hand‑rolling OAuth flows and XML parsing so you can focus on your fantasy baseball logic.

---

*Happy coding, and may your team top the standings!*
