'use client';

import { YahooApiService } from './apiService';
import { TeamTransformer } from '@/app/transformers/yahoo';
import {
  YahooTeam,
  YahooTeamResponse,
  YahooTeamStats,
  YahooMatchup
} from '@/app/types/yahoo';

/**
 * Service for interacting with Yahoo Fantasy Sports API team resources
 */
export class TeamService extends YahooApiService {
  /**
   * Get details for the current user's team
   * @param teamKey Optional team key, if not provided will try to find the user's team
   * @returns Team details
   */
  async getTeam(teamKey?: string): Promise<YahooTeam> {
    // If no team key is provided, find the user's team key
    if (!teamKey) {
      teamKey = await this.getUserTeamKey();
    }
    
    const response = await this.get<YahooTeamResponse>(
      `/team/${teamKey}`,
      {},
      { category: 'daily' }
    );
    
    return TeamTransformer.transformTeamResponse(response);
  }
  
  /**
   * Get team roster
   * @param teamKey Optional team key, if not provided will try to find the user's team
   * @param date Optional date for the roster (format: YYYY-MM-DD)
   * @returns Team with roster
   */
  async getTeamRoster(teamKey?: string, date?: string): Promise<YahooTeam> {
    // If no team key is provided, find the user's team key
    if (!teamKey) {
      teamKey = await this.getUserTeamKey();
    }
    
    let resource = `/team/${teamKey}/roster`;
    
    // If date is specified, add it to the request
    if (date) {
      resource += `;date=${date}`;
    }
    
    const response = await this.get<YahooTeamResponse>(
      resource,
      {},
      { category: 'daily' }
    );
    
    return TeamTransformer.transformTeamResponse(response, true);
  }
  
  /**
   * Get team stats
   * @param teamKey Optional team key, if not provided will try to find the user's team
   * @param type Stats type (season, lastweek, lastmonth, date, etc.)
   * @param value Value for stats type (e.g. week number for week type)
   * @returns Team with stats
   */
  async getTeamStats(
    teamKey?: string,
    type: string = 'season',
    value?: string
  ): Promise<YahooTeamStats> {
    // If no team key is provided, find the user's team key
    if (!teamKey) {
      teamKey = await this.getUserTeamKey();
    }
    
    let resource = `/team/${teamKey}/stats`;
    
    // Add type and value if provided
    if (type) {
      resource += `;type=${type}`;
      if (value) {
        resource += `;${type}=${value}`;
      }
    }
    
    const response = await this.get<YahooTeamResponse>(
      resource,
      {},
      { category: 'realtime' }
    );
    
    const team = TeamTransformer.transformTeamResponse(response);
    
    if (!team.team_stats) {
      throw new Error(`No stats found for team ${teamKey}`);
    }
    
    return team.team_stats;
  }
  
  /**
   * Get team standings
   * @param teamKey Optional team key, if not provided will try to find the user's team
   * @returns Team with standings
   */
  async getTeamStandings(teamKey?: string): Promise<YahooTeam> {
    // If no team key is provided, find the user's team key
    if (!teamKey) {
      teamKey = await this.getUserTeamKey();
    }
    
    const response = await this.get<YahooTeamResponse>(
      `/team/${teamKey}/standings`,
      {},
      { category: 'daily' }
    );
    
    return TeamTransformer.transformTeamResponse(response);
  }
  
  /**
   * Get team matchups
   * @param teamKey Optional team key, if not provided will try to find the user's team
   * @param weeks Optional specific weeks to fetch (e.g. "1,2,3" or "current")
   * @returns Team with matchups
   */
  async getTeamMatchups(teamKey?: string, weeks?: string): Promise<YahooMatchup[]> {
    // If no team key is provided, find the user's team key
    if (!teamKey) {
      teamKey = await this.getUserTeamKey();
    }
    
    let resource = `/team/${teamKey}/matchups`;
    
    // Add weeks if provided
    if (weeks) {
      resource += `;weeks=${weeks}`;
    }
    
    const response = await this.get<any>(
      resource,
      {},
      { category: 'daily' }
    );
    
    return TeamTransformer.transformMatchupsResponse(response);
  }
  
  /**
   * Get current matchup for the team
   * @param teamKey Optional team key, if not provided will try to find the user's team
   * @returns Current matchup or null if no current matchup
   */
  async getCurrentMatchup(teamKey?: string): Promise<YahooMatchup | null> {
    try {
      // Get team data first to get the current week
      const team = await this.getTeam(teamKey);
      
      // Get matchups for the current week
      const matchups = await this.getTeamMatchups(teamKey, team.team_standings?.playoff_seed?.toString() || 'current');
      
      // Return the first matchup or null
      return matchups.length > 0 ? matchups[0] : null;
    } catch (error) {
      console.error('Error fetching current matchup:', error);
      return null;
    }
  }
  
  /**
   * Get the user's team key
   * @returns Team key string
   */
  private async getUserTeamKey(): Promise<string> {
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
    
    // Then get the user's teams for this game
    const teamsUrl = `/users;use_login=1/games;game_keys=${gameKey}/teams`;
    const teamData = await this.get<any>(teamsUrl, {}, { category: 'daily' });
    
    const teamKeyPath = teamData.fantasy_content.users?.[0]?.user?.[0]?.games?.[0]?.game?.[0]?.teams?.[0]?.team?.[0]?.team_key;
    const teamKey = this.getString(teamKeyPath);
    
    if (!teamKey) {
      throw new Error('Could not find team key for current user');
    }
    
    return teamKey;
  }
}

// Export singleton instance
export const teamService = new TeamService(); 