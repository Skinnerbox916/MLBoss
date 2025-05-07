# Yahoo Fantasy Sports API Reference for Cursor

**Purpose:** Concise, token-efficient lookup for all Fantasy Baseball endpoints. Use `.json` for JSON responses.

---

## 1. Authentication

* **OAuth2.0** required. Obtain tokens via:

  ```http
  POST https://api.login.yahoo.com/oauth2/get_token
    grant_type=authorization_code
    code={AUTH_CODE}
    redirect_uri={REDIRECT_URI}
    client_id={CLIENT_ID}
    client_secret={CLIENT_SECRET}
  ```
* **Response** includes: `access_token`, `token_type`, `expires_in`, `refresh_token`
* **Header** on every request:

  ```http
  Authorization: Bearer {ACCESS_TOKEN}
  ```

---

## 2. Base URL & Format

```text
https://fantasysports.yahooapis.com/fantasy/v2
```

* **Default:** XML
* **JSON:** append `?format=json` or replace `.xml` with `.json`

  ```http
  GET /users;use_login=1/teams.json
  GET /league/{league_key}/scoreboard;week={week}?format=json
  ```

---

## 3. Request Syntax

```
GET /{collection};{filter1}={v1}[;{filter2}={v2}]/[{resource}[;{f}={v}]]?format=json
```

* **Filters:** `;`-separated
* **Multiple keys:** comma-separated (no spaces)
* **Paging:** `;count={n};start={s}`

**Common placeholders**

* `{game_code}` = `mlb`
* `{season}` = `YYYY` (e.g. `2025`)
* `{league_key}` = `{game_code}.l.{league_id}`
* `{team_key}` = `{league_key}.t.{team_id}`
* `{week}` = 1–26

---

## 4. Collections & Endpoints

### 4.1 Users

**Endpoints**

```http
GET /users;use_login=1/games?format=json
GET /users;use_login=1/leagues?format=json
GET /users;use_login=1/teams?format=json
```

**JSON path**: `fantasy_content.users[0].user[]` then `.games`, `.leagues`, `.teams`

* **Fields** (per entry):

  * `user_guid`, `user_id`, `created`, `display_name`
  * Nested: `game.key`, `league.key`, `team.key`, with names and URLs

---

### 4.2 Games

**List available fantasy games**

```http
GET /games;game_codes={game_code};seasons={season};is_available=1?format=json
```

* **Filters:**

  * `game_codes={game_code}` (e.g. `mlb`)
  * `seasons={season}` (e.g. `2025`)
  * `is_available=1`
* **JSON path:** `fantasy_content.games[0].game[]`
* **Fields**:

  * `game_key`, `game_code`, `name`, `season`, `is_available`
  * `url`, `draft_status`, `play_status`
  * Flags: `standings_available`, `scoreboard_available`, `teams_available`, `players_available`

> **Note:** No deeper subresources here. For schedules, use League → scoreboard.

---

### 4.3 Leagues

**Fetch league subresources**

```http
GET /league/{league_key}/{subresource}?format=json
```

**Subresources & key fields**

* **metadata**

  * Path: `fantasy_content.league[0].league[0]`
  * Fields: `league_key`, `name`, `url`, `draft_status`, `play_status`

* **settings**

  * Path: `...league[0].settings[0].settings[0]`
  * Fields: `name`, `code`, `season`, `start_date`, `end_date`, `draft_type`, `scoring_type`
  * Stat categories list under `stat_categories.stat_categories[]`

* **standings**

  * Path: `...league[0].standings[0].teams[0].team[]`
  * Fields per team: `team_key`, `name.full`, `url`, `rank`, `waiver_priority`, `wins`, `losses`, `ties`, `percentage`

* **scoreboard;week={week}**

  * Path: `...league[0].scoreboard[0].matchups[0].matchup[]`
  * Fields per matchup:

    * `week`, `week_start`, `week_end`, `is_playoffs`
    * `start_time` (ISO timestamp)
    * Teams: `home.team_key`, `home.team_name`, `home.team_points`, `away.*`

* **teams**

  * Path: `...league[0].teams[0].team[]`
  * Fields: `team_key`, `nickname`, `name.full`, `url`, `team_logos[0].size.*`

* **players**

  * Endpoint supports `;count={n};start={s}` and `;sort={field}`, `;search={query}`
  * Path: `...league[0].players[0].player[]`
  * Fields: `player_key`, `player_id`, `name.full`, `editorial_team_full_name`, `eligible_positions[]`, `status`

* **draftresults**

  * Path: `...league[0].draft_results[0].draft_results[]`
  * Fields: `round`, `pick`, `team_key`, `player_key`, `name.full`

* **transactions**

  * Path: `...league[0].transactions[0].transaction[]`
  * Fields: `transaction_key`, `type`, `timestamp`, `status`, `players[0].player.key`

---

### 4.4 Teams

**Fetch team subresources**

```http
GET /team/{team_key}/{subresource}?format=json
```

**Subresources & key fields**

* **metadata**

  * Path: `fantasy_content.team[0].team[0]`
  * Fields: `team_key`, `name.full`, `url`, `waiver_priority`, `trade_block`

* **roster;week={week}**

  * Path: `...team[0].roster[0].players[0].player[]`
  * Fields: `player_key`, `player_id`, `name.full`, `selected_position`, `acquisition_type`

* **stats;type=week;week={week}**

  * Path: `...team[0].team_stats[0].stats[0].stat[]`
  * Fields: `stat_id`, `name`, `value`

* **standings**

  * Path: `...team[0].standings[0].team_standings[0]`
  * Fields: `rank`, `wins`, `losses`, `ties`, `percentage`

* **matchups;weeks={w1,w2}**

  * Path: `...team[0].matchups[0].matchup[]`
  * Fields: `week`, `is_playoffs`, `players[0].player[].player_points[0].total`

* **draftresults**

  * Path: `...team[0].draft_results[0].draft_results[]`
  * Fields: `round`, `pick`, `player_key`, `name.full`

---

## 5. Paging & Limits

* Default item counts vary; use `;count={n};start={s}` on any endpoint.
* Example: `/league/{league_key}/players;count=100;start=0?format=json`

---

## 6. JSON Path Tips

* All data under root `fantasy_content`.
* Arrays: always select index `[0]` after each resource name.
* **Example:** Player full name in roster:

  ```text
  fantasy_content.team[0]
    .roster[0]
    .players[0]
    .player[0]
    .name[0].full
  ```

---

## 7. Usage Flow

1. **List MLB games**:

   ```http
   GET /games;game_codes=mlb;seasons=2025;is_available=1?format=json
   ```
2. **Fetch user leagues**:

   ```http
   GET /users;use_login=1/leagues?format=json
   ```
3. **Get league scoreboard**:

   ```http
   GET /league/mlb.l.12345/scoreboard;week=7?format=json
   ```
4. **Fetch team roster & stats**:

   ```http
   GET /team/mlb.l.12345.t.1/roster;week=7?format=json
   ```

*End of reference.*
