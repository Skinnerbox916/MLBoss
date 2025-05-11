'use client';

import { YahooApiService } from './apiService';
import {
  YahooTeam,
  YahooTeamResponse,
  YahooPlayer,
  YahooStat,
  YahooTeamStats,
  YahooMatchup
} from '@/app/types/yahoo';
import { playerService } from './playerService';

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
    
    return this.parseTeamData(response);
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
    
    return this.parseTeamData(response, true);
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
    
    const team = this.parseTeamData(response);
    
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
    
    return this.parseTeamData(response);
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
    
    const matchupsData = response.fantasy_content.team?.[0]?.matchups?.[0]?.matchup || [];
    
    return matchupsData.map((matchupData: any) => this.parseMatchupObject(matchupData));
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
    
    const gameKey = this.getString(this.safeArrayElement(gameData.fantasy_content.games?.[0]?.game, 0)?.game_key);
    
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
  
  /**
   * Parse team data from API response
   * @param response API response containing team data
   * @param includeRoster Whether to include full roster data
   * @returns Parsed team object
   */
  private parseTeamData(response: YahooTeamResponse, includeRoster: boolean = false): YahooTeam {
    const teamData = response.fantasy_content.team?.[0];
    
    if (!teamData) {
      throw new Error('No team data found in response');
    }
    
    // Extract team keys
    const teamKey = this.getString(teamData.team_key);
    const teamId = this.getString(teamData.team_id);
    
    if (!teamKey || !teamId) {
      throw new Error('Missing required team data');
    }
    
    // Extract team name and info
    const name = this.getString(teamData.name) || '';
    const isOwnedByCurrentLogin = this.getBoolean(teamData.is_owned_by_current_login);
    const url = this.getString(teamData.url);
    
    // Extract team logos
    const teamLogos = teamData.team_logos?.[0]?.team_logo || [];
    const logoUrl = teamLogos.length > 0 ? this.getString(teamLogos[0]?.url) : undefined;
    
    // Extract manager info
    const managers = teamData.managers?.[0]?.manager || [];
    const manager = managers.length > 0 ? managers[0] : null;
    const managerId = manager ? this.getString(manager.manager_id) : undefined;
    const managerName = manager ? this.getString(manager.nickname) : undefined;
    
    // Extract roster if available
    const rosterData = teamData.roster?.[0];
    let roster: {
      coverage_type?: string;
      coverage_value?: string;
      date?: string;
      players: YahooPlayer[];
    } | undefined;
    
    if (includeRoster && rosterData) {
      const coverageType = this.getString(rosterData.coverage_type);
      const coverageValue = this.getString(rosterData.coverage_value);
      const rosterDate = this.getString(rosterData.date as any);
      
      const players = rosterData.players?.[0]?.player || [];
      const parsedPlayers = players.map((p: any) => playerService.parsePlayerObject(p));
      
      roster = {
        coverage_type: coverageType,
        coverage_value: coverageValue,
        date: rosterDate,
        players: parsedPlayers
      };
    }
    
    // Extract team stats if available
    const statsData = teamData.team_stats?.[0];
    let teamStats: YahooTeamStats | undefined;
    
    if (statsData) {
      const coverageType = this.getString(statsData.coverage_type);
      const coverageValue = this.getString(statsData.coverage_value);
      
      const statArray = statsData.stats?.[0]?.stat || [];
      
      teamStats = {
        coverage_type: coverageType,
        coverage_value: coverageValue,
        season: this.getString(statsData.season as any),
        week: this.getString(statsData.week as any),
        stats: {
          stat: statArray.map((s: any): YahooStat => ({
            stat_id: this.getString(s.stat_id) || '',
            value: this.getString(s.value) || 0,
            name: this.getString(s.name)
          }))
        }
      };
    }
    
    // Extract standings if available
    const standingsData = teamData.standings?.[0];
    let teamStandings;
    
    if (standingsData) {
      const outcomeTotals = standingsData.outcome_totals?.[0] || {};
      
      teamStandings = {
        rank: this.getNumber(standingsData.rank) || 0,
        playoff_seed: this.getNumber(standingsData.playoff_seed),
        outcome_totals: {
          wins: this.getNumber(outcomeTotals.wins) || 0,
          losses: this.getNumber(outcomeTotals.losses) || 0,
          ties: this.getNumber(outcomeTotals.ties) || 0,
          percentage: this.getNumber(outcomeTotals.percentage) || 0
        }
      };
    }
    
    // Extract points if available
    const pointsData = teamData.team_points?.[0];
    let teamPoints;
    
    if (pointsData) {
      teamPoints = {
        coverage_type: this.getString(pointsData.coverage_type) || '',
        total: this.getNumber(pointsData.total) || 0
      };
    }
    
    // Build and return team object
    return {
      team_key: teamKey,
      team_id: teamId,
      name,
      is_owned_by_current_login: isOwnedByCurrentLogin,
      url,
      logo_url: logoUrl,
      manager_id: managerId,
      manager_name: managerName,
      roster,
      team_stats: teamStats,
      team_standings: teamStandings,
      team_points: teamPoints
    };
  }
  
  /**
   * Parse matchup object from API response
   * @param matchupData Raw matchup data
   * @returns Parsed matchup object
   */
  private parseMatchupObject(matchupData: any): YahooMatchup {
    const matchupId = this.getString(matchupData.matchup_id) || '';
    const week = this.getString(matchupData.week) || '';
    const weekStart = this.getString(matchupData.week_start) || '';
    const weekEnd = this.getString(matchupData.week_end) || '';
    const status = this.getString(matchupData.status) || '';
    const isPlayoffs = this.getBoolean(matchupData.is_playoffs) || false;
    const isConsolation = this.getBoolean(matchupData.is_consolation);
    const isTied = this.getBoolean(matchupData.is_tied);
    const winnerTeamKey = this.getString(matchupData.winner_team_key);
    
    // Extract teams
    const teamsData = matchupData.teams?.[0]?.team || [];
    const teams = teamsData.map((team: any) => this.parseTeamObject(team));
    
    // Extract stat winners if available
    const statWinnersData = matchupData.stat_winners?.[0]?.stat || [];
    const statWinners = statWinnersData.map((stat: any) => ({
      stat_id: this.getString(stat.stat_id) || '',
      winner_team_key: this.getString(stat.winner_team_key),
      is_tied: this.getBoolean(stat.is_tied)
    }));
    
    return {
      matchup_id: matchupId,
      week,
      week_start: weekStart,
      week_end: weekEnd,
      status,
      is_playoffs: isPlayoffs,
      is_consolation: isConsolation,
      is_tied: isTied,
      winner_team_key: winnerTeamKey,
      teams: {
        team: teams
      },
      stat_winners: statWinners.length > 0 ? statWinners : undefined
    };
  }
  
  /**
   * Parse simplified team object from matchup data
   * @param teamData Raw team data
   * @returns Parsed team object
   */
  private parseTeamObject(teamData: any): YahooTeam {
    const teamKey = this.getString(teamData.team_key) || '';
    const teamId = this.getString(teamData.team_id) || '';
    const name = this.getString(teamData.name) || '';
    
    // Extract team points if available
    const pointsData = teamData.team_points?.[0];
    const teamPoints = pointsData ? {
      coverage_type: this.getString(pointsData.coverage_type) || '',
      total: this.getNumber(pointsData.total) || 0
    } : undefined;
    
    // Extract team stats if available
    const statsData = teamData.team_stats?.[0];
    let teamStats;
    
    if (statsData) {
      const statArray = statsData.stats?.[0]?.stat || [];
      
      teamStats = {
        stats: {
          stat: statArray.map((s: any): YahooStat => ({
            stat_id: this.getString(s.stat_id) || '',
            value: this.getString(s.value) || 0,
            name: this.getString(s.name)
          }))
        }
      };
    }
    
    return {
      team_key: teamKey,
      team_id: teamId,
      name,
      team_stats: teamStats,
      team_points: teamPoints
    };
  }
}

// Export singleton instance
export const teamService = new TeamService(); 