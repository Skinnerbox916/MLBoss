'use client';

// Export all services
export * from './apiService';
export * from './playerService';
export * from './teamService';
export * from './leagueService';

// Export all service instances
import { playerService } from './playerService';
import { teamService } from './teamService';
import { leagueService } from './leagueService';

/**
 * Collection of all Yahoo Fantasy Sports API services
 */
export const yahooServices = {
  player: playerService,
  team: teamService,
  league: leagueService
};

export default yahooServices; 