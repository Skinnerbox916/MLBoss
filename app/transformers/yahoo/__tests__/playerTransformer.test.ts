import { PlayerTransformer } from '../playerTransformer';
import type { YahooPlayerResponse } from '@/app/types/yahoo';

describe('PlayerTransformer', () => {
  describe('transformPlayer', () => {
    it('should transform basic player data correctly', () => {
      const rawData = {
        player_key: ['mlb.p.12345'],
        player_id: ['12345'],
        name: [{
          full: ['Mike Trout'],
          first: ['Mike'],
          last: ['Trout'],
          ascii_first: ['Mike'],
          ascii_last: ['Trout']
        }],
        editorial_team_abbr: ['LAA'],
        display_position: ['OF'],
        position_type: ['B']
      };

      const result = PlayerTransformer.transformPlayer(rawData);

      expect(result).toMatchObject({
        player_key: 'mlb.p.12345',
        player_id: '12345',
        name: {
          full: 'Mike Trout',
          first: 'Mike',
          last: 'Trout',
          ascii_first: 'Mike',
          ascii_last: 'Trout'
        },
        editorial_team_abbr: 'LAA',
        display_position: 'OF'
      });
    });

    it('should handle missing optional fields gracefully', () => {
      const rawData = {
        player_key: ['mlb.p.12345'],
        player_id: ['12345'],
        name: [{ full: ['Test Player'] }]
      };

      const result = PlayerTransformer.transformPlayer(rawData);

      expect(result.player_key).toBe('mlb.p.12345');
      expect(result.player_id).toBe('12345');
      expect(result.name.full).toBe('Test Player');
      expect(result.editorial_team_abbr).toBe('');
      expect(result.display_position).toBe('');
    });

    it('should transform player with stats correctly', () => {
      const rawData = {
        player_key: ['mlb.p.12345'],
        player_id: ['12345'],
        name: [{ full: ['Test Player'] }],
        player_stats: [{
          coverage_type: ['season'],
          stats: [{
            stat: [
              { stat_id: ['7'], value: ['25'] }, // Runs
              { stat_id: ['12'], value: ['10'] } // HRs
            ]
          }]
        }]
      };

      const result = PlayerTransformer.transformPlayer(rawData);

      expect(result.player_stats).toBeDefined();
      expect(result.player_stats?.coverage_type).toBe('season');
      expect(result.player_stats?.stats.stat).toHaveLength(2);
      expect(result.player_stats?.stats.stat[0]).toMatchObject({ 
        stat_id: '7', 
        value: '25' 
      });
      expect(result.player_stats?.stats.stat[1]).toMatchObject({ 
        stat_id: '12', 
        value: '10' 
      });
    });

    it('should handle ownership data correctly', () => {
      const rawData = {
        player_key: ['mlb.p.12345'],
        player_id: ['12345'],
        name: [{ full: ['Test Player'] }],
        ownership: [{
          ownership_type: ['team'],
          owner_team_key: ['mlb.l.12345.t.1'],
          owner_team_name: ['Test Team']
        }],
        percent_owned: [{
          coverage_type: ['week'],
          value: ['85']
        }]
      };

      const result = PlayerTransformer.transformPlayer(rawData);

      // Note: The current transformer doesn't handle ownership data
      // This test should be updated when ownership is added to the transformer
      expect(result.player_key).toBe('mlb.p.12345');
    });
  });

  describe('transformPlayerStats', () => {
    it('should transform stats array correctly', () => {
      const rawStats = {
        coverage_type: ['season'],
        stats: [{
          stat: [
            { stat_id: ['7'], value: ['25'] },
            { stat_id: ['12'], value: ['10'] },
            { stat_id: ['13'], value: ['75'] }
          ]
        }]
      };

      const result = PlayerTransformer.transformPlayerStats(rawStats);

      expect(result?.stats.stat).toHaveLength(3);
      expect(result?.stats.stat[0]).toMatchObject({ stat_id: '7', value: '25' });
      expect(result?.stats.stat[1]).toMatchObject({ stat_id: '12', value: '10' });
      expect(result?.stats.stat[2]).toMatchObject({ stat_id: '13', value: '75' });
    });

    it('should handle empty stats gracefully', () => {
      const rawStats = undefined;
      const result = PlayerTransformer.transformPlayerStats(rawStats);
      expect(result).toBeUndefined();
    });

    it('should handle non-numeric values', () => {
      const rawStats = {
        stats: [{
          stat: [
            { stat_id: ['1'], value: ['N/A'] },
            { stat_id: ['2'], value: ['-'] }
          ]
        }]
      };

      const result = PlayerTransformer.transformPlayerStats(rawStats);

      expect(result?.stats.stat).toHaveLength(2);
      expect(result?.stats.stat[0]).toMatchObject({ stat_id: '1', value: 'N/A' });
      expect(result?.stats.stat[1]).toMatchObject({ stat_id: '2', value: '-' });
    });
  });

  describe('transformPlayerGameInfo', () => {
    it('should detect game from coverage start time', () => {
      const response: YahooPlayerResponse = {
        fantasy_content: {
          player: [{
            player_key: ['mlb.p.12345'],
            player_id: ['12345'],
            name: [{ full: ['Test Player'] }],
            display_position: ['OF'],
            player_stats: [{
              coverage_metadata: [{
                coverage_start: ['2024-01-15T19:00:00']
              }],
              is_coverage_day: ['1']
            }],
            opponent: [{
              team_abbr: ['NYY']
            }],
            is_home_game: ['1']
          } as any]
        }
      };

      const result = PlayerTransformer.transformPlayerGameInfo(response, '2024-01-15');

      expect(result).toEqual({
        game_status: 'scheduled',
        game_start_time: '2024-01-15T19:00:00',
        is_home_game: true,
        opponent: 'NYY',
        data_source: 'yahoo_coverage_start'
      });
    });

    it('should return no_game status when no game data available', () => {
      const response: YahooPlayerResponse = {
        fantasy_content: {
          player: [{
            player_key: ['mlb.p.12345'],
            player_id: ['12345'],
            name: [{ full: ['Test Player'] }],
            display_position: ['OF']
          } as any]
        }
      };

      const result = PlayerTransformer.transformPlayerGameInfo(response, '2024-01-15');

      expect(result).toEqual({
        game_status: 'no_game',
        game_start_time: null,
        is_home_game: undefined,
        opponent: undefined,
        data_source: 'yahoo_no_indicators'
      });
    });

    it('should handle missing player data', () => {
      const response: YahooPlayerResponse = {
        fantasy_content: {
          player: undefined as any
        }
      };

      const result = PlayerTransformer.transformPlayerGameInfo(response, '2024-01-15');

      expect(result).toEqual({
        game_status: 'unknown',
        game_start_time: null,
        data_source: 'none'
      });
    });
  });

  describe('transformPlayerResponse', () => {
    it('should transform full API response', () => {
      const response: YahooPlayerResponse = {
        fantasy_content: {
          player: [{
            player_key: ['mlb.p.12345'],
            player_id: ['12345'],
            name: [{
              full: ['Test Player']
            }],
            display_position: ['OF']
          } as any]
        }
      };

      const result = PlayerTransformer.transformPlayerResponse(response);

      expect(result.player_key).toBe('mlb.p.12345');
      expect(result.player_id).toBe('12345');
      expect(result.name.full).toBe('Test Player');
    });

    it('should throw error when no player data in response', () => {
      const response: YahooPlayerResponse = {
        fantasy_content: {
          player: undefined as any
        }
      };

      expect(() => {
        PlayerTransformer.transformPlayerResponse(response);
      }).toThrow('No player data found in response');
    });
  });
}); 