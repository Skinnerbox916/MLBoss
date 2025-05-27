import { BaseYahooTransformer } from './baseTransformer';
import {
  YahooPlayer,
  YahooPlayerResponse,
  YahooPlayerStats,
  YahooPlayerGameInfo,
  YahooStat
} from '@/app/types/yahoo';

/**
 * Transformer for Yahoo Fantasy Sports player data
 * Handles parsing and transformation of player-related API responses
 */
export class PlayerTransformer extends BaseYahooTransformer {
  /**
   * Transform raw API response to YahooPlayer
   * @param response API response containing player data
   * @returns Parsed player object
   */
  static transformPlayerResponse(response: YahooPlayerResponse): YahooPlayer {
    const playerData = response.fantasy_content.player?.[0];
    
    if (!playerData) {
      throw new Error('No player data found in response');
    }
    
    return this.transformPlayer(playerData);
  }
  
  /**
   * Transform raw player data to YahooPlayer
   * @param playerData Raw player data from API
   * @returns Parsed player object
   */
  static transformPlayer(playerData: any): YahooPlayer {
    // Extract player keys
    const playerKey = this.getString(playerData.player_key);
    const playerId = this.getString(playerData.player_id);
    
    if (!playerKey || !playerId) {
      throw new Error('Missing required player data');
    }
    
    // Extract name
    const nameData = playerData.name?.[0] || {};
    const name = {
      full: this.getString(nameData.full) || '',
      first: this.getString(nameData.first) || '',
      last: this.getString(nameData.last) || '',
      ascii_first: this.getString(nameData.ascii_first),
      ascii_last: this.getString(nameData.ascii_last)
    };
    
    // Extract positions
    const displayPosition = this.getString(playerData.display_position) || '';
    const eligiblePositionsData = playerData.eligible_positions?.[0]?.position || [];
    const eligiblePositions = eligiblePositionsData.map((pos: string[]) => this.getString(pos) || '');
    
    // Extract selected position if available
    const selectedPositionData = playerData.selected_position?.[0];
    const selectedPosition = selectedPositionData ? {
      position: this.getString(selectedPositionData.position) || '',
      is_flex: this.getBoolean(selectedPositionData.is_flex)
    } : undefined;
    
    // Extract status
    const status = this.getString(playerData.status);
    const statusFull = this.getString(playerData.status_full);
    const injuryNote = this.getString(playerData.injury_note);
    
    // Extract team
    const teamAbbr = this.getString(playerData.editorial_team_abbr) || '';
    const teamKey = this.getString(playerData.editorial_team_key);
    const teamFullName = this.getString(playerData.editorial_team_full_name);
    
    // Extract image
    const imageUrl = this.getString(playerData.image_url);
    
    // Extract stats if available
    const playerStats = this.transformPlayerStats(playerData.player_stats?.[0]);
    
    // Build and return player object
    return {
      player_key: playerKey,
      player_id: playerId,
      name,
      editorial_team_abbr: teamAbbr,
      editorial_team_key: teamKey,
      editorial_team_full_name: teamFullName,
      display_position: displayPosition,
      eligible_positions: eligiblePositions,
      selected_position: selectedPosition,
      status,
      status_full: statusFull,
      injury_note: injuryNote,
      image_url: imageUrl,
      player_stats: playerStats
    };
  }
  
  /**
   * Transform player stats data
   * @param statsData Raw stats data
   * @returns Parsed player stats or undefined
   */
  static transformPlayerStats(statsData: any): YahooPlayerStats | undefined {
    if (!statsData) return undefined;
    
    const statArray = statsData.stats?.[0]?.stat || [];
    
    return {
      coverage_type: this.getString(statsData.coverage_type),
      coverage_value: this.getString(statsData.coverage_value),
      date: this.getString(statsData.date),
      season: this.getString(statsData.season),
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
   * Transform player game info from stats response
   * @param response API response for player stats
   * @param today Today's date in YYYY-MM-DD format
   * @returns Player game information
   */
  static transformPlayerGameInfo(response: YahooPlayerResponse, today: string): YahooPlayerGameInfo {
    try {
      // We need to access raw data since the response structure here is different
      const playerData = response.fantasy_content.player?.[0] as any;
      
      if (!playerData) {
        return {
          game_status: 'unknown',
          game_start_time: null,
          data_source: 'none'
        };
      }
      
      // Check for game indicators - using any type to handle Yahoo's inconsistent API
      const coverageStart = this.getString(playerData.player_stats?.[0]?.coverage_metadata?.[0]?.coverage_start);
      const coverageType = this.getString(playerData.player_stats?.[0]?.coverage_type);
      const isCoverageDay = this.getBoolean(playerData.player_stats?.[0]?.is_coverage_day);
      const gameDate = this.getString(playerData.game_date);
      const gameTime = this.getString(playerData.game_time);
      const gameStartTime = this.getString(playerData.game_start_time);
      
      // Find opponent information if available
      const opponent = this.getString(playerData.opponent?.[0]?.team_abbr);
      const isHomeGame = this.getBoolean(playerData.is_home_game);
      
      // First check for coverage start time
      if (coverageStart) {
        return {
          game_status: 'scheduled',
          game_start_time: coverageStart,
          is_home_game: isHomeGame,
          opponent,
          data_source: 'yahoo_coverage_start'
        };
      }
      
      // Next check for coverage day flag
      if (isCoverageDay) {
        return {
          game_status: isCoverageDay ? 'scheduled' : 'no_game',
          game_start_time: gameStartTime || gameTime || null,
          is_home_game: isHomeGame,
          opponent,
          data_source: 'yahoo_coverage_day'
        };
      }
      
      // Check for specific game time fields
      if (gameStartTime || gameTime) {
        return {
          game_status: 'scheduled',
          game_start_time: gameStartTime || gameTime || null,
          is_home_game: isHomeGame,
          opponent,
          data_source: 'yahoo_game_time'
        };
      }
      
      // Fall back to game date check
      if (gameDate && gameDate === today) {
        return {
          game_status: 'scheduled',
          game_start_time: null,
          is_home_game: isHomeGame,
          opponent,
          data_source: 'yahoo_game_date'
        };
      }
      
      // No game found
      return {
        game_status: 'no_game',
        game_start_time: null,
        is_home_game: isHomeGame,
        opponent,
        data_source: 'yahoo_no_indicators'
      };
    } catch (error) {
      console.error('Error transforming player game info:', error);
      return {
        game_status: 'error',
        game_start_time: null,
        data_source: 'error'
      };
    }
  }
  
  /**
   * Transform search results to array of players
   * @param response API response from player search
   * @returns Array of players
   */
  static transformPlayerSearchResults(response: any): YahooPlayer[] {
    // Extract players array
    const players = response.fantasy_content.players?.[0]?.player || [];
    
    // Parse each player
    return players.map((playerData: any) => this.transformPlayer(playerData));
  }
} 