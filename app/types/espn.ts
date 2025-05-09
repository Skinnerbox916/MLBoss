// ESPN API specific types

/**
 * ESPN Game Status
 */
export type EspnGameStatus = 'pre' | 'in' | 'post' | 'postponed' | 'canceled';

/**
 * ESPN Team interface
 */
export interface EspnTeam {
  id: string;
  abbreviation: string;
  displayName: string;
  shortDisplayName: string;
  name: string;
  logo?: string;
  color?: string;
  alternateColor?: string;
  score?: string | number;
  winner?: boolean;
  homeAway?: 'home' | 'away';
  statistics?: {
    [key: string]: any;
  }[];
}

/**
 * ESPN Competition interface
 */
export interface EspnCompetition {
  id: string;
  date: string;
  status: {
    type: {
      id: string;
      name: string;
      state: EspnGameStatus;
      completed: boolean;
      description: string;
    };
    displayClock: string;
    period: number;
  };
  venue: {
    id: string;
    fullName: string;
    address: {
      city: string;
      state: string;
    };
  };
  competitors: EspnTeam[];
  situation?: {
    balls: number;
    strikes: number;
    outs: number;
    onFirst?: boolean;
    onSecond?: boolean;
    onThird?: boolean;
    batter: {
      id: string;
      fullName: string;
      position: string;
      team: string;
    };
    pitcher: {
      id: string;
      fullName: string;
      position: string;
      team: string;
    };
  };
  probables?: {
    homeTeam: {
      id: string;
      fullName: string;
      wins: number;
      losses: number;
      era: number;
    };
    awayTeam: {
      id: string;
      fullName: string;
      wins: number;
      losses: number;
      era: number;
    };
  };
}

/**
 * ESPN Event interface
 */
export interface EspnEvent {
  id: string;
  date: string;
  name: string;
  shortName: string;
  status: EspnGameStatus;
  competitions: EspnCompetition[];
}

/**
 * ESPN Scoreboard interface
 */
export interface EspnScoreboard {
  leagues: {
    id: string;
    name: string;
    abbreviation: string;
    slug: string;
  }[];
  events: EspnEvent[];
  day: {
    date: string;
  };
}

/**
 * ESPN Game Check Result
 */
export interface EspnGameCheckResult {
  has_game_today: boolean;
  game_start_time: string | null;
  data_source: 'espn_fallback' | 'espn_no_events' | 'espn_no_match' | 'espn_error' | 'none';
} 