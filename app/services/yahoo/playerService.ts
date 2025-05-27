'use client';

import { YahooApiService } from './apiService';
import { PlayerTransformer } from '@/app/transformers/yahoo';
import {
  YahooPlayer,
  YahooPlayerResponse,
  YahooPlayerStats,
  YahooPlayerGameInfo
} from '@/app/types/yahoo';

/**
 * Service for interacting with Yahoo Fantasy Sports API player resources
 */
export class PlayerService extends YahooApiService {
  /**
   * Get player details by player key
   * @param playerKey Yahoo player key
   * @returns Player details
   */
  async getPlayer(playerKey: string): Promise<YahooPlayer> {
    const response = await this.get<YahooPlayerResponse>(
      `/player/${playerKey}`,
      {},
      { category: 'daily' }
    );
    
    return PlayerTransformer.transformPlayerResponse(response);
  }
  
  /**
   * Get player stats by player key
   * @param playerKey Yahoo player key
   * @param statsType Stats type (season, lastmonth, lastweek, date, etc.)
   * @param statsValue Value for stats type (e.g., "2025" for season or "2025-05-10" for date)
   * @returns Player stats
   */
  async getPlayerStats(
    playerKey: string,
    statsType: string = 'season',
    statsValue: string = new Date().getFullYear().toString()
  ): Promise<YahooPlayerStats> {
    const response = await this.get<YahooPlayerResponse>(
      `/player/${playerKey}/stats;type=${statsType};${statsType}=${statsValue}`,
      {},
      { category: 'realtime' }
    );
    
    const player = PlayerTransformer.transformPlayerResponse(response);
    
    if (!player.player_stats) {
      throw new Error(`No stats found for player ${playerKey}`);
    }
    
    return player.player_stats;
  }
  
  /**
   * Get player's game info for today
   * @param playerKey Yahoo player key
   * @returns Player game information
   */
  async getPlayerGameInfo(playerKey: string): Promise<YahooPlayerGameInfo> {
    const today = new Date().toISOString().split('T')[0];
    
    const response = await this.get<YahooPlayerResponse>(
      `/player/${playerKey}/stats;type=date;date=${today}`,
      {},
      { category: 'realtime', skipCache: true }
    );
    
    return PlayerTransformer.transformPlayerGameInfo(response, today);
  }
  
  /**
   * Search for players
   * @param query Search query
   * @param count Number of results to return
   * @param start Starting position for results
   * @returns Array of players matching the search
   */
  async searchPlayers(query: string, count: number = 25, start: number = 0): Promise<YahooPlayer[]> {
    const response = await this.get<any>(
      `/players;search=${encodeURIComponent(query)};count=${count};start=${start}`,
      {},
      { category: 'daily' }
    );
    
    return PlayerTransformer.transformPlayerSearchResults(response);
  }
}

// Export singleton instance
export const playerService = new PlayerService(); 