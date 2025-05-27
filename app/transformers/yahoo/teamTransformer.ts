import { BaseYahooTransformer } from './baseTransformer';
import { PlayerTransformer } from './playerTransformer';
import {
  YahooTeam,
  YahooTeamResponse,
  YahooPlayer,
  YahooStat,
  YahooTeamStats,
  YahooMatchup
} from '@/app/types/yahoo';

/**
 * Transformer for Yahoo Fantasy Sports team data
 * Handles parsing and transformation of team-related API responses
 */
export class TeamTransformer extends BaseYahooTransformer {
  /**
   * Transform raw API response to YahooTeam
   * @param response API response containing team data
   * @param includeRoster Whether to include full roster data
   * @returns Parsed team object
   */
  static transformTeamResponse(response: YahooTeamResponse, includeRoster: boolean = false): YahooTeam {
    const teamData = response.fantasy_content.team?.[0];
    
    if (!teamData) {
      throw new Error('No team data found in response');
    }
    
    return this.transformTeam(teamData, includeRoster);
  }
  
  /**
   * Transform raw team data to YahooTeam
   * @param teamData Raw team data from API
   * @param includeRoster Whether to include full roster data
   * @returns Parsed team object
   */
  static transformTeam(teamData: any, includeRoster: boolean = false): YahooTeam {
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
    const roster = includeRoster ? this.transformRoster(teamData.roster?.[0]) : undefined;
    
    // Extract team stats if available
    const teamStats = this.transformTeamStats(teamData.team_stats?.[0]);
    
    // Extract standings if available
    const teamStandings = this.transformStandings(teamData.standings?.[0]);
    
    // Extract points if available
    const teamPoints = this.transformTeamPoints(teamData.team_points?.[0]);
    
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
   * Transform roster data
   * @param rosterData Raw roster data
   * @returns Parsed roster or undefined
   */
  private static transformRoster(rosterData: any): {
    coverage_type?: string;
    coverage_value?: string;
    date?: string;
    players: YahooPlayer[];
  } | undefined {
    if (!rosterData) return undefined;
    
    const coverageType = this.getString(rosterData.coverage_type);
    const coverageValue = this.getString(rosterData.coverage_value);
    const rosterDate = this.getString(rosterData.date as any);
    
    const players = rosterData.players?.[0]?.player || [];
    const parsedPlayers = players.map((p: any) => PlayerTransformer.transformPlayer(p));
    
    return {
      coverage_type: coverageType,
      coverage_value: coverageValue,
      date: rosterDate,
      players: parsedPlayers
    };
  }
  
  /**
   * Transform team stats data
   * @param statsData Raw stats data
   * @returns Parsed team stats or undefined
   */
  static transformTeamStats(statsData: any): YahooTeamStats | undefined {
    if (!statsData) return undefined;
    
    const coverageType = this.getString(statsData.coverage_type);
    const coverageValue = this.getString(statsData.coverage_value);
    
    const statArray = statsData.stats?.[0]?.stat || [];
    
    return {
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
  
  /**
   * Transform standings data
   * @param standingsData Raw standings data
   * @returns Parsed standings or undefined
   */
  private static transformStandings(standingsData: any) {
    if (!standingsData) return undefined;
    
    const outcomeTotals = standingsData.outcome_totals?.[0] || {};
    
    return {
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
  
  /**
   * Transform team points data
   * @param pointsData Raw points data
   * @returns Parsed points or undefined
   */
  private static transformTeamPoints(pointsData: any) {
    if (!pointsData) return undefined;
    
    return {
      coverage_type: this.getString(pointsData.coverage_type) || '',
      total: this.getNumber(pointsData.total) || 0
    };
  }
  
  /**
   * Transform matchup data
   * @param matchupData Raw matchup data
   * @returns Parsed matchup object
   */
  static transformMatchup(matchupData: any): YahooMatchup {
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
    const teams = teamsData.map((team: any) => this.transformTeamSimple(team));
    
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
   * Transform simplified team object from matchup data
   * @param teamData Raw team data
   * @returns Parsed team object
   */
  private static transformTeamSimple(teamData: any): YahooTeam {
    const teamKey = this.getString(teamData.team_key) || '';
    const teamId = this.getString(teamData.team_id) || '';
    const name = this.getString(teamData.name) || '';
    
    // Extract team points if available
    const teamPoints = this.transformTeamPoints(teamData.team_points?.[0]);
    
    // Extract team stats if available
    const teamStats = this.transformTeamStats(teamData.team_stats?.[0]);
    
    return {
      team_key: teamKey,
      team_id: teamId,
      name,
      team_stats: teamStats,
      team_points: teamPoints
    };
  }
  
  /**
   * Transform matchups array from API response
   * @param response API response containing matchups
   * @returns Array of matchups
   */
  static transformMatchupsResponse(response: any): YahooMatchup[] {
    const matchupsData = response.fantasy_content.team?.[0]?.matchups?.[0]?.matchup || [];
    return matchupsData.map((matchupData: any) => this.transformMatchup(matchupData));
  }
} 