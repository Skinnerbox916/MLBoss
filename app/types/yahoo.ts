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

// ==========================================
// Core Entity Interfaces
// ==========================================

/**
 * Yahoo player interface - core player data
 */
export interface YahooPlayer {
  player_key: string;
  player_id: string;
  name: {
    full: string;
    first: string;
    last: string;
    ascii_first?: string;
    ascii_last?: string;
  };
  editorial_team_key?: string;
  editorial_team_full_name?: string;
  editorial_team_abbr: string;
  uniform_number?: string;
  display_position: string;
  primary_position?: string;
  eligible_positions: string[];
  selected_position?: {
    position: string;
    is_flex?: boolean;
  };
  is_undroppable?: boolean;
  position_type?: string;
  has_player_notes?: boolean;
  has_recent_player_notes?: boolean;
  status?: string;
  status_full?: string;
  injury_note?: string;
  injury_status?: string;
  on_disabled_list?: boolean;
  is_editable?: boolean;
  ownership?: YahooPlayerOwnership;
  percent_owned?: YahooPercentOwned;
  draft_analysis?: YahooDraftAnalysis;
  image_url?: string;
  player_stats?: YahooPlayerStats;
  player_advanced_stats?: YahooPlayerAdvancedStats;
  eligible_positions_full?: string[];
  featured_position?: string;
  experience_level?: string;
  headshot_url?: string;
  starting_status?: {
    is_starting?: boolean;
    date?: string;
    coverage_type?: string;
  };
  batting_order?: number;
  has_game_today?: boolean;
  game_status?: string;
  game_start_time?: string;
  is_starting_today?: boolean;
  opponent_team_abbr?: string;
  probable_pitcher?: boolean;
  opponent_probable_pitcher?: string;
}

/**
 * Yahoo player ownership data
 */
export interface YahooPlayerOwnership {
  teams_key?: string[];
  teams_name?: string[];
  ownership_type?: string;
}

/**
 * Yahoo player ownership percentage data
 */
export interface YahooPercentOwned {
  value: string | number;
  delta: string | number;
}

/**
 * Yahoo draft analysis data
 */
export interface YahooDraftAnalysis {
  average_pick: string | number;
  average_round: string | number;
  average_cost: string | number;
  percent_drafted: string | number;
}

/**
 * Yahoo player stats interface
 */
export interface YahooPlayerStats {
  coverage_type?: string;
  coverage_value?: string;
  date?: string;
  season?: string;
  stats: {
    stat: Array<YahooStat>;
  };
}

/**
 * Yahoo player advanced stats interface
 */
export interface YahooPlayerAdvancedStats {
  coverage_type?: string;
  coverage_value?: string;
  season?: string;
  stats: {
    stat: Array<YahooStat>;
  };
}

/**
 * Yahoo individual stat interface
 */
export interface YahooStat {
  stat_id: string;
  value: string | number;
  name?: string;
  display_name?: string;
  sort_order?: string;
  position_types?: string[];
  is_composite_stat?: boolean;
  is_only_display_stat?: boolean;
  is_excluded_from_display?: boolean;
  is_included_in_display?: boolean;
  base_stats?: string[];
}

/**
 * Yahoo team interface
 */
export interface YahooTeam {
  team_key: string;
  team_id: string;
  name: string;
  is_owned_by_current_login?: boolean;
  url?: string;
  team_logo?: string;
  waiver_priority?: number;
  number_of_moves?: string | number;
  number_of_trades?: string | number;
  manager_id?: string;
  manager_name?: string;
  nickname?: string;
  guid?: string;
  email?: string;
  image_url?: string;
  logo_url?: string;
  draft_position?: number;
  faab_balance?: string | number;
  auction_budget_total?: string | number;
  auction_budget_spent?: string | number;
  points?: {
    total?: string | number;
    week?: string | number;
  };
  roster?: {
    coverage_type?: string;
    coverage_value?: string;
    date?: string;
    players: YahooPlayer[];
  };
  team_stats?: YahooTeamStats;
  team_standings?: YahooTeamStandings;
  team_points?: YahooTeamPoints;
  matchups?: YahooMatchup[];
  clinched_playoffs?: boolean;
  draft_results?: YahooDraftResult[];
  streak?: {
    type: string;
    value: string | number;
  };
  has_clinched_playoffs?: boolean;
}

/**
 * Yahoo team standings interface
 */
export interface YahooTeamStandings {
  rank: string | number;
  playoff_seed?: string | number;
  games_back?: string | number;
  outcome_totals: {
    wins: string | number;
    losses: string | number;
    ties: string | number;
    percentage: string | number;
  };
  streak?: {
    type: string;
    value: string | number;
  };
  points_for?: string | number;
  points_against?: string | number;
}

/**
 * Yahoo team points interface
 */
export interface YahooTeamPoints {
  coverage_type: string;
  season?: string;
  week?: string;
  total: string | number;
}

/**
 * Yahoo team stats interface
 */
export interface YahooTeamStats {
  coverage_type?: string;
  coverage_value?: string;
  season?: string;
  week?: string;
  stats: {
    stat: Array<YahooStat>;
  };
}

/**
 * Yahoo league interface
 */
export interface YahooLeague {
  league_key: string;
  league_id: string;
  name: string;
  url?: string;
  logo_url?: string;
  password?: string;
  draft_status: string;
  num_teams: number;
  edit_key?: string;
  weekly_deadline?: string;
  league_update_timestamp?: string;
  scoring_type: string;
  current_week: number;
  start_week: number;
  end_week: number;
  start_date?: string;
  end_date?: string;
  is_finished?: boolean;
  league_type?: string;
  draft_type?: string;
  draft_time?: string;
  draft_pick_time?: string;
  is_pro_league?: boolean;
  is_cash_league?: boolean;
  is_public?: boolean;
  max_teams?: number;
  season?: string;
  use_playoff?: boolean;
  playoff_start_week?: number;
  has_playoff_consolation_games?: boolean;
  has_multiweek_championship?: boolean;
  waiver_type?: string;
  waiver_rule?: string;
  allow_add_to_dl_extra_pos?: boolean;
  allow_opposing_players?: boolean;
  stat_categories?: {
    stats: {
      stat: Array<YahooStat>;
    };
  };
  roster_positions?: Array<{
    position: string;
    position_type?: string;
    count: number;
    is_starting_position?: boolean;
    is_bench?: boolean;
    is_dl?: boolean;
    is_na?: boolean;
  }>;
  teams?: YahooTeam[];
  settings?: YahooLeagueSettings;
  standings?: YahooLeagueStandings;
  scoreboard?: YahooScoreboard;
  transactions?: YahooTransaction[];
  draft_results?: YahooDraftResult[];
}

/**
 * Yahoo league settings interface
 */
export interface YahooLeagueSettings {
  draft_type: string;
  scoring_type: string;
  persistent_url?: string;
  uses_playoff: boolean;
  has_playoff_consolation_games?: boolean;
  playoff_start_week?: number;
  uses_playoff_reseeding?: boolean;
  uses_lock_eliminated_teams?: boolean;
  num_playoff_teams?: number;
  num_playoff_consolation_teams?: number;
  roster_positions?: Array<{
    position: string;
    position_type?: string;
    count: number;
  }>;
  stat_categories?: {
    stats: {
      stat: Array<YahooStat>;
    };
  };
  stat_modifiers?: {
    stats: {
      stat: Array<YahooStat & { modifier: string | number }>;
    };
  };
  divisions?: Array<{
    division_id: string;
    name: string;
    teams: Array<{
      team_key: string;
    }>;
  }>;
  max_weekly_adds?: number;
  faab_budget?: number;
  start_date?: string;
  end_date?: string;
  trade_end_date?: string;
  waiver_time?: number;
  trade_ratification_type?: string;
  waiver_rule?: string;
  waiver_type?: string;
  can_trade_draft_picks?: boolean;
  can_change_position_limit?: boolean;
  is_team_point_input_enabled?: boolean;
}

/**
 * Yahoo league standings interface
 */
export interface YahooLeagueStandings {
  teams: {
    team: YahooTeam[];
  };
}

/**
 * Yahoo scoreboard interface
 */
export interface YahooScoreboard {
  week?: string;
  matchups: {
    matchup: YahooMatchup[];
  };
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
  is_consolation?: boolean;
  is_tied?: boolean;
  winner_team_key?: string;
  teams: {
    team: YahooTeam[];
  };
  stat_winners?: Array<{
    stat_id: string;
    winner_team_key?: string;
    is_tied?: boolean;
  }>;
}

/**
 * Yahoo game interface
 */
export interface YahooGame {
  game_key: string;
  game_id: string;
  name: string;
  code: string;
  type: string;
  url?: string;
  season: string;
  is_registration_over: boolean;
  is_game_over?: boolean;
  is_offseason?: boolean;
  position_types?: {
    position_type: Array<{
      type: string;
      display_name: string;
    }>;
  };
  game_weeks?: {
    game_week: Array<{
      week: string;
      display_name?: string;
      start: string;
      end: string;
    }>;
  };
  stat_categories?: {
    stats: {
      stat: Array<YahooStat>;
    };
  };
  roster_positions?: Array<{
    position: string;
    position_type?: string;
    display_name?: string;
  }>;
  leagues?: YahooLeague[];
}

/**
 * Yahoo player game info
 */
export interface YahooPlayerGameInfo {
  game_status: string;
  game_start_time: string | null;
  is_home_game?: boolean;
  opponent?: string;
  opponent_team_key?: string;
  data_source: string;
  batting_order?: number;
  is_starting_pitcher?: boolean;
  is_probable_starter?: boolean;
}

/**
 * Yahoo transaction interface
 */
export interface YahooTransaction {
  transaction_id: string;
  type: string;
  status: string;
  timestamp: string;
  players?: {
    player: Array<YahooPlayer & {
      transaction_data: {
        type: string;
        source_team_key?: string;
        source_team_name?: string;
        destination_team_key?: string;
        destination_team_name?: string;
        faab_bid?: number;
        waiver_priority?: number;
      };
    }>;
  };
  trader_team_key?: string;
  trader_team_name?: string;
  tradee_team_key?: string;
  tradee_team_name?: string;
  trade_note?: string;
}

/**
 * Yahoo draft result interface
 */
export interface YahooDraftResult {
  draft_result_id?: string;
  pick: string | number;
  round: string | number;
  team_key: string;
  player_key: string;
  cost?: string | number;
}

// ==========================================
// Response Interfaces
// ==========================================

/**
 * Base response interface for Yahoo API
 */
export interface YahooBaseResponse {
  fantasy_content: {
    [key: string]: any;
    copyright?: string;
    time?: string;
  };
}

/**
 * Response for user details
 */
export interface YahooUserResponse extends YahooBaseResponse {
  fantasy_content: {
    [key: string]: any;
    users: {
      count: string;
      user: Array<{
        guid: string[];
        display_name?: string[];
        email?: string[];
        image_url?: string[];
        games?: {
          count: string;
          game: Array<{
            game_key: string[];
            game_id: string[];
            name: string[];
            code: string[];
            type: string[];
            url: string[];
            season: string[];
            leagues?: {
              count: string;
              league: Array<any>;
            };
            teams?: {
              count: string;
              team: Array<any>;
            };
          }>;
        };
      }>;
    };
  };
}

/**
 * Response for league details
 */
export interface YahooLeagueResponse extends YahooBaseResponse {
  fantasy_content: {
    [key: string]: any;
    league: Array<{
      league_key: string[];
      league_id: string[];
      name: string[];
      url: string[];
      draft_status: string[];
      num_teams: string[];
      scoring_type: string[];
      start_week?: string[];
      current_week?: string[];
      end_week?: string[];
      start_date?: string[];
      end_date?: string[];
      settings?: Array<{
        draft_type: string[];
        scoring_type: string[];
        stat_categories?: Array<{
          stats: Array<{
            stat: Array<{
              stat_id: string[];
              name: string[];
              display_name: string[];
              sort_order: string[];
              position_types?: string[];
            }>;
          }>;
        }>;
        roster_positions?: Array<{
          roster_position: Array<{
            position: string[];
            position_type?: string[];
            count: string[];
          }>;
        }>;
      }>;
      standings?: Array<{
        teams: Array<{
          count: string;
          team: Array<any>;
        }>;
      }>;
      players?: Array<{
        count: string;
        player: Array<any>;
      }>;
      teams?: Array<{
        count: string;
        team: Array<any>;
      }>;
      scoreboard?: Array<{
        week?: string[];
        matchups?: Array<{
          count: string;
          matchup: Array<any>;
        }>;
      }>;
      transactions?: Array<{
        count: string;
        transaction: Array<any>;
      }>;
      draft_results?: Array<{
        count: string;
        draft_result: Array<any>;
      }>;
    }>;
  };
}

/**
 * Response for team details
 */
export interface YahooTeamResponse extends YahooBaseResponse {
  fantasy_content: {
    [key: string]: any;
    team: Array<{
      team_key: string[];
      team_id: string[];
      name: string[];
      is_owned_by_current_login?: string[];
      url?: string[];
      team_logos?: Array<{
        team_logo: Array<{
          size: string[];
          url: string[];
        }>;
      }>;
      waiver_priority?: string[];
      number_of_moves?: string[];
      number_of_trades?: string[];
      roster_adds?: {
        coverage_type?: string[];
        coverage_value?: string[];
        value: string[];
      };
      managers?: Array<{
        manager: Array<{
          manager_id: string[];
          nickname: string[];
          guid: string[];
          is_commissioner?: string[];
          email?: string[];
          image_url?: string[];
        }>;
      }>;
      roster?: Array<{
        coverage_type?: string[];
        coverage_value?: string[];
        players: Array<{
          count: string;
          player: Array<any>;
        }>;
      }>;
      matchups?: Array<{
        count: string;
        matchup: Array<any>;
      }>;
      standings?: Array<{
        rank: string[];
        playoff_seed?: string[];
        outcome_totals: Array<{
          wins: string[];
          losses: string[];
          ties: string[];
          percentage: string[];
        }>;
      }>;
      team_stats?: Array<{
        coverage_type?: string[];
        coverage_value?: string[];
        stats: Array<{
          stat: Array<{
            stat_id: string[];
            value: string[];
          }>;
        }>;
      }>;
      team_points?: Array<{
        coverage_type: string[];
        total: string[];
      }>;
    }>;
  };
}

/**
 * Response for player details
 */
export interface YahooPlayerResponse extends YahooBaseResponse {
  fantasy_content: {
    [key: string]: any;
    player: Array<{
      player_key: string[];
      player_id: string[];
      name: Array<{
        full: string[];
        first: string[];
        last: string[];
        ascii_first?: string[];
        ascii_last?: string[];
      }>;
      editorial_team_key?: string[];
      editorial_team_full_name?: string[];
      editorial_team_abbr?: string[];
      uniform_number?: string[];
      display_position: string[];
      position_type?: string[];
      eligible_positions?: Array<{
        position: string[];
      }>;
      selected_position?: Array<{
        position: string[];
        is_flex?: string[];
      }>;
      status?: string[];
      injury_note?: string[];
      on_disabled_list?: string[];
      player_notes_last_timestamp?: string[];
      has_player_notes?: string[];
      has_recent_player_notes?: string[];
      player_stats?: Array<{
        coverage_type?: string[];
        coverage_value?: string[];
        stats: Array<{
          stat: Array<{
            stat_id: string[];
            value: string[];
          }>;
        }>;
      }>;
      ownership?: Array<{
        ownership_type?: string[];
        owner_team_key?: string[];
        owner_team_name?: string[];
      }>;
      percent_owned?: Array<{
        value: string[];
        delta: string[];
      }>;
      image_url?: string[];
    }>;
  };
}

/**
 * Response for transaction details
 */
export interface YahooTransactionResponse extends YahooBaseResponse {
  fantasy_content: {
    [key: string]: any;
    transaction: Array<{
      transaction_id: string[];
      type: string[];
      status: string[];
      timestamp: string[];
      players?: Array<{
        count: string;
        player: Array<any>;
      }>;
      trader_team_key?: string[];
      trader_team_name?: string[];
      tradee_team_key?: string[];
      tradee_team_name?: string[];
      trade_note?: string[];
    }>;
  };
} 