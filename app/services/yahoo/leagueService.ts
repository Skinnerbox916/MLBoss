'use client';

import { YahooApiService } from './apiService';
import { LeagueTransformer } from '@/app/transformers/yahoo';
import {
  YahooLeague,
  YahooLeagueResponse,
  YahooScoreboard,
  YahooTransaction,
  YahooTeam
} from '@/app/types/yahoo';

/**
 * Service for interacting with Yahoo Fantasy Sports API league resources
 */
export class LeagueService extends YahooApiService {
  /**
   * Get league details
   * @param leagueKey Optional league key, if not provided will try to find the user's league
   * @returns League details
   */
  async getLeague(leagueKey?: string): Promise<YahooLeague> {
    // If no league key is provided, find the user's league key
    if (!leagueKey) {
      leagueKey = await this.getUserLeagueKey();
    }
    
    const response = await this.get<YahooLeagueResponse>(
      `/league/${leagueKey}`,
      {},
      { category: 'daily' }
    );
    
    return LeagueTransformer.transformLeagueResponse(response);
  }
  
  /**
   * Get league settings
   * @param leagueKey Optional league key, if not provided will try to find the user's league
   * @returns League with settings
   */
  async getLeagueSettings(leagueKey?: string): Promise<YahooLeague> {
    // If no league key is provided, find the user's league key
    if (!leagueKey) {
      leagueKey = await this.getUserLeagueKey();
    }
    
    const response = await this.get<YahooLeagueResponse>(
      `/league/${leagueKey}/settings`,
      {},
      { category: 'static' }
    );
    
    return LeagueTransformer.transformLeagueResponse(response);
  }
  
  /**
   * Get league standings
   * @param leagueKey Optional league key, if not provided will try to find the user's league
   * @returns League with standings
   */
  async getLeagueStandings(leagueKey?: string): Promise<YahooLeague> {
    // If no league key is provided, find the user's league key
    if (!leagueKey) {
      leagueKey = await this.getUserLeagueKey();
    }
    
    const response = await this.get<YahooLeagueResponse>(
      `/league/${leagueKey}/standings`,
      {},
      { category: 'daily' }
    );
    
    return LeagueTransformer.transformLeagueResponse(response);
  }
  
  /**
   * Get league scoreboard
   * @param leagueKey Optional league key, if not provided will try to find the user's league
   * @param week Optional week number, if not provided will use current week
   * @returns League with scoreboard
   */
  async getLeagueScoreboard(leagueKey?: string, week?: number): Promise<YahooScoreboard> {
    // If no league key is provided, find the user's league key
    if (!leagueKey) {
      leagueKey = await this.getUserLeagueKey();
    }
    
    let resource = `/league/${leagueKey}/scoreboard`;
    
    // Add week if provided
    if (week) {
      resource += `;week=${week}`;
    }
    
    const response = await this.get<YahooLeagueResponse>(
      resource,
      {},
      { category: 'realtime' }
    );
    
    const league = LeagueTransformer.transformLeagueResponse(response);
    
    if (!league.scoreboard) {
      throw new Error(`No scoreboard found for league ${leagueKey}`);
    }
    
    return league.scoreboard;
  }
  
  /**
   * Get league transactions
   * @param leagueKey Optional league key, if not provided will try to find the user's league
   * @param types Optional transaction types to filter (add, drop, trade, etc.)
   * @param count Number of transactions to retrieve
   * @returns League transactions
   */
  async getLeagueTransactions(
    leagueKey?: string,
    types?: string[],
    count: number = 10
  ): Promise<YahooTransaction[]> {
    // If no league key is provided, find the user's league key
    if (!leagueKey) {
      leagueKey = await this.getUserLeagueKey();
    }
    
    let resource = `/league/${leagueKey}/transactions`;
    
    // Add types filter if provided
    if (types && types.length > 0) {
      resource += `;types=${types.join(',')}`;
    }
    
    // Add count
    resource += `;count=${count}`;
    
    const response = await this.get<any>(
      resource,
      {},
      { category: 'daily' }
    );
    
    return LeagueTransformer.transformTransactionsResponse(response);
  }
  
  /**
   * Get league teams
   * @param leagueKey Optional league key, if not provided will try to find the user's league
   * @returns League teams
   */
  async getLeagueTeams(leagueKey?: string): Promise<YahooTeam[]> {
    // If no league key is provided, find the user's league key
    if (!leagueKey) {
      leagueKey = await this.getUserLeagueKey();
    }
    
    const response = await this.get<YahooLeagueResponse>(
      `/league/${leagueKey}/teams`,
      {},
      { category: 'daily' }
    );
    
    return LeagueTransformer.transformTeamsResponse(response);
  }
  
  /**
   * Get the user's league key
   * @returns League key string
   */
  private async getUserLeagueKey(): Promise<string> {
    // First get the game key
    const gameUrl = '/games;game_codes=mlb;seasons=' + new Date().getFullYear();
    const gameData = await this.get<any>(gameUrl, {}, { category: 'static' });
    
    // Safely access game data with explicit typing
    type GameObj = { game_key: string[] };
    const games = (gameData?.fantasy_content?.games?.[0]?.game || []) as GameObj[];
    const gameKey = this.getString(this.safeArrayElement(games, 0)?.game_key);
    
    if (!gameKey) {
      throw new Error('Could not find MLB game key');
    }
    
    // Then get the user's leagues for this game
    const leaguesUrl = `/users;use_login=1/games;game_keys=${gameKey}/leagues`;
    const leagueData = await this.get<any>(leaguesUrl, {}, { category: 'daily' });
    
    const leagueKeyPath = leagueData.fantasy_content.users?.[0]?.user?.[0]?.games?.[0]?.game?.[0]?.leagues?.[0]?.league?.[0]?.league_key;
    const leagueKey = this.getString(leagueKeyPath);
    
    if (!leagueKey) {
      throw new Error('Could not find league key for current user');
    }
    
    return leagueKey;
  }
}

// Export singleton instance
export const leagueService = new LeagueService(); 