// UI component types

/**
 * Position display types
 */
export interface PositionDisplayProps {
  position: string;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

/**
 * Skeleton loading props
 */
export interface SkeletonLoadingProps {
  type: 'player-card' | 'lineup' | 'stats' | 'table-row' | 'team-header';
  count?: number;
  className?: string;
}

/**
 * Navigation item
 */
export interface NavigationItem {
  name: string;
  href: string;
  icon?: React.ComponentType<any>;
  current?: boolean;
  children?: NavigationItem[];
}

/**
 * Team header props
 */
export interface TeamHeaderProps {
  team: {
    name: string;
    logo_url?: string;
    record?: string;
    manager?: string;
  };
  loading?: boolean;
  className?: string;
}

/**
 * Matchup display props
 */
export interface MatchupDisplayProps {
  matchup: {
    week: number;
    teams: Array<{
      name: string;
      logo_url?: string;
      score?: number | string;
      isWinner?: boolean;
      projection?: number;
    }>;
    status: 'upcoming' | 'in_progress' | 'completed';
    startDate?: string;
    endDate?: string;
  };
  showProjections?: boolean;
  className?: string;
}

/**
 * Header component props
 */
export interface HeaderProps {
  team?: {
    name: string;
    logo?: string;
    url?: string;
    league: string;
    record: string;
    rank?: number;
  };
  loading?: boolean;
} 