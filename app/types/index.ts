// Common type definitions

// Re-export types from other files
export * from './yahoo';
export * from './espn';
export * from './auth';
export * from './ui';

// Player types
export interface Player {
  player_id: string;
  name: string;
  team: string;
  position: string | string[];
  eligible_positions?: string[];
  stats?: PlayerStats;
  status?: string;
  injury_status?: string;
  image_url?: string;
}

export interface PlayerStats {
  [key: string]: number | string;
}

// Team types
export interface Team {
  team_id: string;
  name: string;
  manager?: string;
  logo_url?: string;
  players?: Player[];
  stats?: TeamStats;
}

export interface TeamStats {
  [key: string]: number | string;
}

// Game/Matchup types
export interface Game {
  game_id: string;
  date: string;
  home_team: string;
  away_team: string;
  status: string;
  score?: {
    home: number;
    away: number;
  };
}

// Response type for API calls
export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
}

// User type
export interface User {
  id: string;
  name: string;
  email?: string;
  preferences?: UserPreferences;
}

export interface UserPreferences {
  theme?: 'light' | 'dark';
  [key: string]: any;
} 