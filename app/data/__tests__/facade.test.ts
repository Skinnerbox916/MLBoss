import { getDashboardData, getTeamData, getMatchupData, getPlayerData, getLeagueOverviewData } from '../index';
import { yahooServices } from '../../services/yahoo';
import { getCachedData, setCachedData } from '../../lib/server/cache';
import { getEspnScoreboard, checkTeamGameFromEspn } from '../../utils/espn-api';

// Mock dependencies
jest.mock('../../services/yahoo');
jest.mock('../../lib/server/cache', () => ({
  getCachedData: jest.fn(),
  setCachedData: jest.fn(),
  generateCacheKey: jest.fn((endpoint: string, params: Record<string, string> = {}, category?: string) => {
    const sortedParams = Object.keys(params).sort();
    const paramString = sortedParams.map(key => `${key}=${params[key]}`).join('&');
    const baseKey = `yahoo:${endpoint}${paramString ? '?' + paramString : ''}`;
    return category ? `${category}:${baseKey}` : baseKey;
  })
}));
jest.mock('../../utils/espn-api');

describe('Data Facade', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('getDashboardData', () => {
    it('should return cached data when available', async () => {
      const cachedData = {
        league: { name: 'Test League', league_key: 'mlb.l.12345' },
        userTeam: { name: 'My Team', team_key: 'mlb.l.12345.t.1' },
        standings: { teams: { team: [] } },
        currentMatchup: null,
        recentTransactions: [],
        todaysGames: { yahooGames: [], espnGames: [] },
        lastUpdated: '2024-01-01T00:00:00Z'
      };

      (getCachedData as jest.Mock).mockResolvedValue(cachedData);

      const result = await getDashboardData();

      expect(result).toEqual(cachedData);
      expect(getCachedData).toHaveBeenCalledWith(
        'daily:yahoo:facade:dashboard',
        { category: 'daily', allowStale: true }
      );
      expect(yahooServices.league.getLeague).not.toHaveBeenCalled();
    });

    it('should fetch fresh data when cache miss', async () => {
      const mockLeague = { 
        name: 'Test League',
        league_key: 'mlb.l.12345',
        standings: { teams: { team: [] } },
        scoreboard: { matchups: { matchup: [] } }
      };
      const mockTeam = { 
        team_key: 'mlb.l.12345.t.1',
        name: 'My Team' 
      };
      const mockEspnData = { events: [] };

      (getCachedData as jest.Mock).mockResolvedValue(null);
      (yahooServices.league.getLeague as jest.Mock).mockResolvedValue(mockLeague);
      (yahooServices.team.getTeam as jest.Mock).mockResolvedValue(mockTeam);
      (getEspnScoreboard as jest.Mock).mockResolvedValue(mockEspnData);

      const result = await getDashboardData();

      expect(result.league).toEqual(mockLeague);
      expect(result.userTeam).toEqual(mockTeam);
      expect(setCachedData).toHaveBeenCalledWith(
        'daily:yahoo:facade:dashboard',
        expect.objectContaining({
          league: mockLeague,
          userTeam: mockTeam
        }),
        { category: 'daily', ttl: 12 * 60 * 60 }
      );
    });

    it('should handle ESPN API failures gracefully', async () => {
      const mockLeague = { 
        name: 'Test League',
        standings: { teams: { team: [] } }
      };
      const mockTeam = { name: 'My Team' };

      (getCachedData as jest.Mock).mockResolvedValue(null);
      (yahooServices.league.getLeague as jest.Mock).mockResolvedValue(mockLeague);
      (yahooServices.team.getTeam as jest.Mock).mockResolvedValue(mockTeam);
      (getEspnScoreboard as jest.Mock).mockRejectedValue(new Error('ESPN API Error'));

      const result = await getDashboardData();

      expect(result.todaysGames.espnGames).toEqual([]);
      expect(result.league).toBeDefined();
      expect(result.userTeam).toBeDefined();
    });

    it('should return partial data on Yahoo API failure', async () => {
      (getCachedData as jest.Mock).mockResolvedValue(null);
      (yahooServices.league.getLeague as jest.Mock).mockRejectedValue(new Error('Yahoo API Error'));
      (yahooServices.team.getTeam as jest.Mock).mockRejectedValue(new Error('Yahoo API Error'));
      (getEspnScoreboard as jest.Mock).mockResolvedValue({ events: [] });

      const result = await getDashboardData();

      expect(result.league).toEqual({});
      expect(result.userTeam).toEqual({});
      expect(result.lastUpdated).toBeDefined();
    });
  });

  describe('getTeamData', () => {
    const mockTeam = { 
      team_key: 'mlb.l.12345.t.1',
      name: 'My Team' 
    };
    const mockRoster = [
      { 
        player_key: 'mlb.p.1',
        name: { full: 'Player 1' },
        editorial_team_abbr: 'LAA'
      },
      { 
        player_key: 'mlb.p.2',
        name: { full: 'Player 2' },
        editorial_team_abbr: 'NYY'
      }
    ];

    it('should enrich roster with game information', async () => {
      (getCachedData as jest.Mock).mockResolvedValue(null);
      (yahooServices.team.getTeam as jest.Mock).mockResolvedValue(mockTeam);
      (yahooServices.team.getTeamRoster as jest.Mock).mockResolvedValue({
        roster: { players: mockRoster }
      });
      (yahooServices.player.getPlayerGameInfo as jest.Mock)
        .mockResolvedValueOnce({
          game_status: 'scheduled',
          game_start_time: '2024-01-01T19:00:00Z'
        })
        .mockResolvedValueOnce({
          game_status: 'unknown',
          game_start_time: null
        });
      (yahooServices.team.getTeamMatchups as jest.Mock).mockResolvedValue([]);
      (getEspnScoreboard as jest.Mock).mockResolvedValue(null);
      (checkTeamGameFromEspn as jest.Mock).mockResolvedValue({
        has_game_today: false,
        game_start_time: null
      });

      const result = await getTeamData();

      expect(result.enrichedRoster).toHaveLength(2);
      expect(result.enrichedRoster[0]).toMatchObject({
        player_key: 'mlb.p.1',
        hasGameToday: true,
        gameStartTime: '2024-01-01T19:00:00Z'
      });
      expect(result.enrichedRoster[1]).toMatchObject({
        player_key: 'mlb.p.2',
        hasGameToday: false,
        gameStartTime: null
      });
    });

    it('should use ESPN data as fallback for game info', async () => {
      (getCachedData as jest.Mock).mockResolvedValue(null);
      (yahooServices.team.getTeam as jest.Mock).mockResolvedValue(mockTeam);
      (yahooServices.team.getTeamRoster as jest.Mock).mockResolvedValue({
        roster: { players: [mockRoster[0]] }
      });
      (yahooServices.player.getPlayerGameInfo as jest.Mock).mockRejectedValue(new Error('API Error'));
      (yahooServices.team.getTeamMatchups as jest.Mock).mockResolvedValue([]);
      (getEspnScoreboard as jest.Mock).mockResolvedValue({ events: [] });
      (checkTeamGameFromEspn as jest.Mock).mockResolvedValue({
        has_game_today: true,
        game_start_time: '2024-01-01T20:00:00Z'
      });

      const result = await getTeamData();

      expect(result.enrichedRoster[0]).toMatchObject({
        hasGameToday: true,
        gameStartTime: '2024-01-01T20:00:00Z',
        espnGameInfo: {
          has_game_today: true,
          game_start_time: '2024-01-01T20:00:00Z'
        }
      });
    });

    it('should cache team data with daily category', async () => {
      (getCachedData as jest.Mock).mockResolvedValue(null);
      (yahooServices.team.getTeam as jest.Mock).mockResolvedValue(mockTeam);
      (yahooServices.team.getTeamRoster as jest.Mock).mockResolvedValue({
        roster: { players: [] }
      });
      (yahooServices.team.getTeamMatchups as jest.Mock).mockResolvedValue([]);
      (getEspnScoreboard as jest.Mock).mockResolvedValue(null);

      await getTeamData();

      expect(setCachedData).toHaveBeenCalledWith(
        'daily:yahoo:facade:team?teamKey=user',
        expect.objectContaining({
          team: mockTeam,
          roster: [],
          enrichedRoster: []
        }),
        { category: 'daily', ttl: 6 * 60 * 60 }
      );
    });
  });

  describe('getMatchupData', () => {
    const mockLeague = {
      current_week: 5,
      stat_categories: { stats: { stat: [] } }
    };
    const mockTeam = {
      team_key: 'mlb.l.12345.t.1',
      name: 'My Team'
    };
    const mockMatchup = {
      matchup_id: '1',
      week: '5',
      teams: {
        team: [
          { team_key: 'mlb.l.12345.t.1', name: 'My Team' },
          { team_key: 'mlb.l.12345.t.2', name: 'Opponent' }
        ]
      }
    };

    it('should fetch realtime data for current week', async () => {
      (yahooServices.league.getLeague as jest.Mock).mockResolvedValue(mockLeague);
      (yahooServices.team.getTeam as jest.Mock).mockResolvedValue(mockTeam);
      (yahooServices.league.getLeagueScoreboard as jest.Mock).mockResolvedValue({
        matchups: { matchup: [mockMatchup] }
      });
      (yahooServices.team.getTeamRoster as jest.Mock).mockResolvedValue({
        roster: { players: [] }
      });

      const result = await getMatchupData();

      expect(result).toBeDefined();
      expect(result?.isCurrentWeek).toBe(true);
      expect(result?.week).toBe(5);
      expect(setCachedData).toHaveBeenCalledWith(
        'realtime:yahoo:facade:matchup?week=current',
        expect.any(Object),
        { category: 'realtime', ttl: 15 * 60 }
      );
    });

    it('should use cached data for historical weeks', async () => {
      const cachedMatchup = {
        matchup: mockMatchup,
        userTeam: mockTeam,
        opponentTeam: { team_key: 'mlb.l.12345.t.2', name: 'Opponent' },
        week: 3,
        isCurrentWeek: false,
        lastUpdated: '2024-01-01T00:00:00Z'
      };

      (getCachedData as jest.Mock).mockResolvedValue(cachedMatchup);

      const result = await getMatchupData(3);

      expect(result).toEqual(cachedMatchup);
      expect(yahooServices.league.getLeague).not.toHaveBeenCalled();
    });

    it('should return null when no matchup found', async () => {
      (yahooServices.league.getLeague as jest.Mock).mockResolvedValue(mockLeague);
      (yahooServices.team.getTeam as jest.Mock).mockResolvedValue(mockTeam);
      (yahooServices.league.getLeagueScoreboard as jest.Mock).mockResolvedValue({
        matchups: { matchup: [] }
      });

      const result = await getMatchupData();

      expect(result).toBeNull();
    });
  });

  describe('getPlayerData', () => {
    const mockPlayer = {
      player_key: 'mlb.p.12345',
      name: { full: 'Test Player' },
      ownership: { ownership_type: 'team' }
    };

    it('should fetch and cache player data', async () => {
      (getCachedData as jest.Mock).mockResolvedValue(null);
      (yahooServices.player.getPlayer as jest.Mock).mockResolvedValue(mockPlayer);
      (yahooServices.player.getPlayerStats as jest.Mock)
        .mockResolvedValueOnce({ stats: [] }) // season stats
        .mockResolvedValueOnce({ stats: [] }); // recent stats

      const result = await getPlayerData('mlb.p.12345');

      expect(result.player).toEqual(mockPlayer);
      expect(result.seasonStats).toBeDefined();
      expect(result.recentStats).toBeDefined();
      expect(setCachedData).toHaveBeenCalledWith(
        'daily:yahoo:facade:player?playerKey=mlb.p.12345',
        expect.objectContaining({
          player: mockPlayer
        }),
        { category: 'daily', ttl: 6 * 60 * 60 }
      );
    });

    it('should return cached player data when available', async () => {
      const cachedData = {
        player: mockPlayer,
        seasonStats: { stats: [] },
        recentStats: { stats: [] },
        lastUpdated: '2024-01-01T00:00:00Z'
      };

      (getCachedData as jest.Mock).mockResolvedValue(cachedData);

      const result = await getPlayerData('mlb.p.12345');

      expect(result).toEqual(cachedData);
      expect(yahooServices.player.getPlayer).not.toHaveBeenCalled();
    });
  });

  describe('getLeagueOverviewData', () => {
    const mockLeague = {
      name: 'Test League',
      teams: [
        { team_key: 'mlb.l.12345.t.1', name: 'Team 1' },
        { team_key: 'mlb.l.12345.t.2', name: 'Team 2' }
      ],
      standings: { teams: { team: [] } },
      scoreboard: { matchups: { matchup: [] } },
      transactions: []
    };

    it('should fetch and cache league overview data', async () => {
      (getCachedData as jest.Mock).mockResolvedValue(null);
      (yahooServices.league.getLeague as jest.Mock).mockResolvedValue(mockLeague);

      const result = await getLeagueOverviewData();

      expect(result.league).toEqual(mockLeague);
      expect(result.allTeams).toEqual(mockLeague.teams);
      expect(result.standings).toEqual(mockLeague.standings);
      expect(setCachedData).toHaveBeenCalledWith(
        'daily:yahoo:facade:league-overview',
        expect.objectContaining({
          league: mockLeague,
          allTeams: mockLeague.teams
        }),
        { category: 'daily', ttl: 12 * 60 * 60 }
      );
    });
  });
}); 