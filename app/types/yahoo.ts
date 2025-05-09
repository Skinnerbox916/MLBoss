// Yahoo API specific types

/**
 * Yahoo API options for fetch requests
 */
export interface YahooApiOptions {
  ttl?: number;
  skipCache?: boolean;
  timeout?: number;
  /**
   * Data category that determines caching behavior:
   * - static: Longest TTL (24h), prioritizes cached data even if stale
   * - daily: Medium TTL (12h), prioritizes cached data even if stale
   * - realtime: Short TTL (15m), prioritizes fresh data, uses cache as fallback
   */
  category?: 'static' | 'daily' | 'realtime';
}

/**
 * Yahoo player interface
 */
export interface YahooPlayer {
  player_key: string;
  player_id: string;
  name: {
    full: string;
    first: string;
    last: string;
  };
  editorial_team_abbr: string;
  display_position: string;
  eligible_positions: string[];
  selected_position?: {
    position: string;
  };
  status?: string;
  injury_status?: string;
  image_url?: string;
  player_stats?: YahooPlayerStats;
}

export interface YahooPlayerStats {
  stats: {
    stat: Array<{
      stat_id: string;
      value: string | number;
      name?: string;
    }>;
  };
}

/**
 * Yahoo team interface
 */
export interface YahooTeam {
  team_key: string;
  team_id: string;
  name: string;
  manager_id?: string;
  manager_name?: string;
  logo_url?: string;
  roster?: {
    players: YahooPlayer[];
  };
  team_stats?: YahooTeamStats;
}

export interface YahooTeamStats {
  stats: {
    stat: Array<{
      stat_id: string;
      value: string | number;
      name?: string;
    }>;
  };
}

/**
 * Yahoo league interface
 */
export interface YahooLeague {
  league_key: string;
  league_id: string;
  name: string;
  num_teams: number;
  scoring_type: string;
  current_week: number;
  start_week: number;
  end_week: number;
  teams?: YahooTeam[];
}

/**
 * Yahoo game interface
 */
export interface YahooGame {
  game_key: string;
  game_id: string;
  name: string;
  code: string;
  season: string;
  is_registration_over: boolean;
  leagues?: YahooLeague[];
}

/**
 * Yahoo matchup interface
 */
export interface YahooMatchup {
  matchup_id: string;
  week: string;
  week_start: string;
  week_end: string;
  status: string;
  is_playoffs: boolean;
  teams: {
    team: YahooTeam[];
  };
}

/**
 * Yahoo player game info
 */
export interface YahooPlayerGameInfo {
  game_status: string;
  game_start_time: string | null;
  is_home_game?: boolean;
  opponent?: string;
  data_source: string;
} 