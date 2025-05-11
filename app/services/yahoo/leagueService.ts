'use client';

import { YahooApiService } from './apiService';
import {
  YahooLeague,
  YahooLeagueResponse,
  YahooScoreboard,
  YahooStat,
  YahooTransaction,
  YahooTeam,
  YahooDraftResult
} from '@/app/types/yahoo';
import { teamService } from './teamService';

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
    
    return this.parseLeagueData(response);
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
    
    return this.parseLeagueData(response);
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
    
    return this.parseLeagueData(response);
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
    
    const league = this.parseLeagueData(response);
    
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
    
    const transactionsData = response.fantasy_content.league?.[0]?.transactions?.[0]?.transaction || [];
    
    return transactionsData.map((transactionData: any) => this.parseTransactionObject(transactionData));
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
    
    const teamsData = response.fantasy_content.league?.[0]?.teams?.[0]?.team || [];
    
    return teamsData.map((teamData: any) => {
      // Using any type due to Yahoo API's inconsistent structure
      return {
        team_key: this.getString(teamData.team_key) || '',
        team_id: this.getString(teamData.team_id) || '',
        name: this.getString(teamData.name) || '',
        logo_url: this.getString(teamData.team_logos?.[0]?.team_logo?.[0]?.url),
        manager_name: this.getString(teamData.managers?.[0]?.manager?.[0]?.nickname)
      } as YahooTeam;
    });
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
  
  /**
   * Parse league data from API response
   * @param response API response containing league data
   * @returns Parsed league object
   */
  private parseLeagueData(response: YahooLeagueResponse): YahooLeague {
    const leagueData = response.fantasy_content.league?.[0];
    
    if (!leagueData) {
      throw new Error('No league data found in response');
    }
    
    // Extract league keys
    const leagueKey = this.getString(leagueData.league_key);
    const leagueId = this.getString(leagueData.league_id);
    
    if (!leagueKey || !leagueId) {
      throw new Error('Missing required league data');
    }
    
    // Extract league details
    const name = this.getString(leagueData.name) || '';
    const url = this.getString(leagueData.url);
    const draftStatus = this.getString(leagueData.draft_status) || '';
    const numTeams = parseInt(this.getString(leagueData.num_teams) || '0', 10);
    const scoringType = this.getString(leagueData.scoring_type) || '';
    const currentWeek = parseInt(this.getString(leagueData.current_week) || '0', 10);
    const startWeek = parseInt(this.getString(leagueData.start_week) || '0', 10);
    const endWeek = parseInt(this.getString(leagueData.end_week) || '0', 10);
    const startDate = this.getString(leagueData.start_date);
    const endDate = this.getString(leagueData.end_date);
    
    // Extract settings if available
    const settingsData = leagueData.settings?.[0] || {};
    let settings;
    
    if (Object.keys(settingsData).length > 0) {
      // Type assertion for settingsData
      const typedSettings = settingsData as {
        draft_type: string[];
        scoring_type: string[];
        uses_playoff: string[];
        stat_categories?: [{
          stats: [{
            stat: Array<{
              stat_id: string[];
              name: string[];
              display_name: string[];
              sort_order: string[];
              position_types?: [{
                position_type: string[][];
              }];
            }>;
          }];
        }];
        roster_positions?: [{
          roster_position: Array<{
            position: string[];
            position_type?: string[];
            count: string[];
          }>;
        }];
      };
      
      const draftType = this.getString(typedSettings.draft_type) || '';
      const scoringTypeSetting = this.getString(typedSettings.scoring_type) || '';
      const usesPlayoff = this.getBoolean(typedSettings.uses_playoff) || false;
      
      // Extract stat categories if available
      const statCategoriesData = typedSettings.stat_categories?.[0]?.stats?.[0]?.stat || [];
      const statCategories = statCategoriesData.map((stat: any) => ({
        stat_id: this.getString(stat.stat_id) || '',
        name: this.getString(stat.name) || '',
        display_name: this.getString(stat.display_name),
        sort_order: this.getString(stat.sort_order),
        position_types: stat.position_types?.[0]?.position_type
          ? stat.position_types[0].position_type.map((pt: string[]) => this.getString(pt))
          : undefined
      }));
      
      // Extract roster positions if available
      const rosterPositionsData = typedSettings.roster_positions?.[0]?.roster_position || [];
      const rosterPositions = rosterPositionsData.map((pos: any) => ({
        position: this.getString(pos.position) || '',
        position_type: this.getString(pos.position_type),
        count: parseInt(this.getString(pos.count) || '0', 10),
      }));
      
      settings = {
        draft_type: draftType,
        scoring_type: scoringTypeSetting,
        uses_playoff: usesPlayoff,
        stat_categories: statCategories.length > 0 ? {
          stats: {
            stat: statCategories
          }
        } : undefined,
        roster_positions: rosterPositions.length > 0 ? rosterPositions : undefined,
      };
    }
    
    // Extract standings if available
    const standingsData = leagueData.standings?.[0];
    let standings;
    
    if (standingsData) {
      const teamsData = standingsData.teams?.[0]?.team || [];
      standings = {
        teams: {
          team: teamsData.map((teamData: any) => {
            // Simplified team object with standings data
            const team = {
              team_key: this.getString(teamData.team_key) || '',
              team_id: this.getString(teamData.team_id) || '',
              name: this.getString(teamData.name) || '',
              team_standings: {
                rank: parseInt(this.getString(teamData.team_standings?.[0]?.rank) || '0', 10),
                outcome_totals: {
                  wins: parseInt(this.getString(teamData.team_standings?.[0]?.outcome_totals?.[0]?.wins) || '0', 10),
                  losses: parseInt(this.getString(teamData.team_standings?.[0]?.outcome_totals?.[0]?.losses) || '0', 10),
                  ties: parseInt(this.getString(teamData.team_standings?.[0]?.outcome_totals?.[0]?.ties) || '0', 10),
                  percentage: parseFloat(this.getString(teamData.team_standings?.[0]?.outcome_totals?.[0]?.percentage) || '0')
                }
              }
            } as YahooTeam;
            
            return team;
          })
        }
      };
    }
    
    // Extract scoreboard if available
    const scoreboardData = leagueData.scoreboard?.[0];
    let scoreboard;
    
    if (scoreboardData) {
      const week = this.getString(scoreboardData.week);
      const matchupsData = scoreboardData.matchups?.[0]?.matchup || [];
      
      scoreboard = {
        week,
        matchups: {
          matchup: matchupsData.map((matchupData: any) => {
            return {
              matchup_id: this.getString(matchupData.matchup_id) || '',
              week: this.getString(matchupData.week) || '',
              week_start: this.getString(matchupData.week_start) || '',
              week_end: this.getString(matchupData.week_end) || '',
              status: this.getString(matchupData.status) || '',
              is_playoffs: this.getBoolean(matchupData.is_playoffs) || false,
              is_consolation: this.getBoolean(matchupData.is_consolation),
              is_tied: this.getBoolean(matchupData.is_tied),
              winner_team_key: this.getString(matchupData.winner_team_key),
              teams: {
                team: (matchupData.teams?.[0]?.team || []).map((teamData: any) => {
                  return {
                    team_key: this.getString(teamData.team_key) || '',
                    team_id: this.getString(teamData.team_id) || '',
                    name: this.getString(teamData.name) || '',
                    team_points: teamData.team_points?.[0] ? {
                      coverage_type: this.getString(teamData.team_points[0].coverage_type) || '',
                      total: parseFloat(this.getString(teamData.team_points[0].total) || '0')
                    } : undefined
                  } as YahooTeam;
                })
              }
            };
          })
        }
      };
    }
    
    // Build and return league object
    return {
      league_key: leagueKey,
      league_id: leagueId,
      name,
      url,
      draft_status: draftStatus,
      num_teams: numTeams,
      scoring_type: scoringType,
      current_week: currentWeek,
      start_week: startWeek,
      end_week: endWeek,
      start_date: startDate,
      end_date: endDate,
      settings,
      standings,
      scoreboard
    };
  }
  
  /**
   * Parse transaction object from API response
   * @param transactionData Raw transaction data from API
   * @returns Parsed transaction object
   */
  private parseTransactionObject(transactionData: any): YahooTransaction {
    // Extract transaction details
    const transactionId = this.getString(transactionData.transaction_id) || '';
    const type = this.getString(transactionData.type) || '';
    const status = this.getString(transactionData.status) || '';
    const timestamp = this.getString(transactionData.timestamp) || '';
    
    // Extract trader team info if available
    const traderTeamKey = this.getString(transactionData.trader_team_key);
    const traderTeamName = this.getString(transactionData.trader_team_name);
    
    // Extract tradee team info if available
    const tradeeTeamKey = this.getString(transactionData.tradee_team_key);
    const tradeeTeamName = this.getString(transactionData.tradee_team_name);
    
    // Extract trade note if available
    const tradeNote = this.getString(transactionData.trade_note);
    
    // Parse players if available
    const playersData = transactionData.players?.[0]?.player || [];
    let players;
    
    if (playersData.length > 0) {
      players = {
        player: playersData.map((playerData: any) => {
          // Extract basic player info
          const playerKey = this.getString(playerData.player_key) || '';
          const playerId = this.getString(playerData.player_id) || '';
          
          // Extract name
          const nameData = playerData.name?.[0] || {};
          const name = {
            full: this.getString(nameData.full) || '',
            first: this.getString(nameData.first) || '',
            last: this.getString(nameData.last) || ''
          };
          
          // Extract transaction data
          const transactionDataObj = playerData.transaction_data?.[0] || {};
          const transactionDataType = this.getString(transactionDataObj.type) || '';
          const sourceTeamKey = this.getString(transactionDataObj.source_team_key);
          const sourceTeamName = this.getString(transactionDataObj.source_team_name);
          const destinationTeamKey = this.getString(transactionDataObj.destination_team_key);
          const destinationTeamName = this.getString(transactionDataObj.destination_team_name);
          const faabBid = parseInt(this.getString(transactionDataObj.faab_bid) || '0', 10);
          
          return {
            player_key: playerKey,
            player_id: playerId,
            name,
            transaction_data: {
              type: transactionDataType,
              source_team_key: sourceTeamKey,
              source_team_name: sourceTeamName,
              destination_team_key: destinationTeamKey,
              destination_team_name: destinationTeamName,
              faab_bid: faabBid || undefined
            }
          };
        })
      };
    }
    
    return {
      transaction_id: transactionId,
      type,
      status,
      timestamp,
      players,
      trader_team_key: traderTeamKey,
      trader_team_name: traderTeamName,
      tradee_team_key: tradeeTeamKey,
      tradee_team_name: tradeeTeamName,
      trade_note: tradeNote
    };
  }
}

// Export singleton instance
export const leagueService = new LeagueService(); 