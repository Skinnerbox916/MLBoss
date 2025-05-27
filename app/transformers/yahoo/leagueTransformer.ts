import { BaseYahooTransformer } from './baseTransformer';
import {
  YahooLeague,
  YahooLeagueResponse,
  YahooScoreboard,
  YahooTransaction,
  YahooTeam
} from '@/app/types/yahoo';

/**
 * Transformer for Yahoo Fantasy Sports league data
 * Handles parsing and transformation of league-related API responses
 */
export class LeagueTransformer extends BaseYahooTransformer {
  /**
   * Transform raw API response to YahooLeague
   * @param response API response containing league data
   * @returns Parsed league object
   */
  static transformLeagueResponse(response: YahooLeagueResponse): YahooLeague {
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
    const settings = this.transformSettings(leagueData.settings?.[0]);
    
    // Extract standings if available
    const standings = this.transformStandings(leagueData.standings?.[0]);
    
    // Extract scoreboard if available
    const scoreboard = this.transformScoreboard(leagueData.scoreboard?.[0]);
    
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
   * Transform league settings data
   * @param settingsData Raw settings data
   * @returns Parsed settings or undefined
   */
  private static transformSettings(settingsData: any) {
    if (!settingsData || Object.keys(settingsData).length === 0) {
      return undefined;
    }
    
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
      value: 0, // League settings stats don't have values, adding default
      name: this.getString(stat.name),
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
    
    return {
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
  
  /**
   * Transform league standings data
   * @param standingsData Raw standings data
   * @returns Parsed standings or undefined
   */
  private static transformStandings(standingsData: any) {
    if (!standingsData) return undefined;
    
    const teamsData = standingsData.teams?.[0]?.team || [];
    return {
      teams: {
        team: teamsData.map((teamData: any) => {
          // Simplified team object with standings data
          return {
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
        })
      }
    };
  }
  
  /**
   * Transform league scoreboard data
   * @param scoreboardData Raw scoreboard data
   * @returns Parsed scoreboard or undefined
   */
  private static transformScoreboard(scoreboardData: any): YahooScoreboard | undefined {
    if (!scoreboardData) return undefined;
    
    const week = this.getString(scoreboardData.week);
    const matchupsData = scoreboardData.matchups?.[0]?.matchup || [];
    
    return {
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
  
  /**
   * Transform transaction data
   * @param transactionData Raw transaction data from API
   * @returns Parsed transaction object
   */
  static transformTransaction(transactionData: any): YahooTransaction {
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
  
  /**
   * Transform transactions array from API response
   * @param response API response containing transactions
   * @returns Array of transactions
   */
  static transformTransactionsResponse(response: any): YahooTransaction[] {
    const transactionsData = response.fantasy_content.league?.[0]?.transactions?.[0]?.transaction || [];
    return transactionsData.map((transactionData: any) => this.transformTransaction(transactionData));
  }
  
  /**
   * Transform teams array from API response
   * @param response API response containing teams
   * @returns Array of teams
   */
  static transformTeamsResponse(response: YahooLeagueResponse): YahooTeam[] {
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
} 