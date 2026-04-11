import { mlbFetchSplits } from './client';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TeamOffense {
  mlbId: number;
  name: string;
  gamesPlayed: number;
  // Season totals
  ops: number | null;
  avg: number | null;
  runsPerGame: number | null;
  strikeOutRate: number | null; // K / AB
  homeRunsPerGame: number | null;
  // vs LHP / RHP splits
  vsLeft: { ops: number | null; avg: number | null; strikeOutRate: number | null } | null;
  vsRight: { ops: number | null; avg: number | null; strikeOutRate: number | null } | null;
}

// ---------------------------------------------------------------------------
// MLB Stats API response shapes
// ---------------------------------------------------------------------------

interface RawTeamStat {
  gamesPlayed?: number;
  ops?: string;
  avg?: string;
  runs?: number;
  strikeOuts?: number;
  atBats?: number;
  homeRuns?: number;
}

interface RawTeamSplit {
  split?: { code?: string; description?: string };
  stat: RawTeamStat;
  team?: { id: number; name: string };
}

interface RawTeamStatsGroup {
  type?: { displayName: string };
  splits: RawTeamSplit[];
}

interface RawTeamStatsResponse {
  stats?: RawTeamStatsGroup[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const n = (v: string | undefined): number | null => {
  if (!v) return null;
  const f = parseFloat(v);
  return isNaN(f) ? null : f;
};

function kRate(raw: RawTeamStat): number | null {
  const k = raw.strikeOuts;
  const ab = raw.atBats;
  if (k == null || ab == null || ab === 0) return null;
  return Math.round((k / ab) * 1000) / 1000;
}

function parseSplitLine(raw: RawTeamStat) {
  return {
    ops: n(raw.ops),
    avg: n(raw.avg),
    strikeOutRate: kRate(raw),
  };
}

// ---------------------------------------------------------------------------
// Fetch team season batting stats + vs-handedness splits
// ---------------------------------------------------------------------------

/**
 * Fetch a team's offensive profile: season batting stats and vs-LHP/RHP splits.
 * Cached 1 hour — team-level stats don't move much day-to-day.
 */
export async function getTeamOffense(
  mlbTeamId: number,
  season: number = new Date().getFullYear(),
): Promise<TeamOffense | null> {
  // Fetch season stats and handedness splits in parallel
  const [seasonData, splitsData] = await Promise.all([
    fetchTeamSeason(mlbTeamId, season),
    fetchTeamHandednessSplits(mlbTeamId, season),
  ]);

  if (!seasonData) return null;

  const { stat, name } = seasonData;
  const gp = stat.gamesPlayed ?? 0;

  return {
    mlbId: mlbTeamId,
    name,
    gamesPlayed: gp,
    ops: n(stat.ops),
    avg: n(stat.avg),
    runsPerGame: gp > 0 && stat.runs != null ? Math.round((stat.runs / gp) * 100) / 100 : null,
    strikeOutRate: kRate(stat),
    homeRunsPerGame: gp > 0 && stat.homeRuns != null ? Math.round((stat.homeRuns / gp) * 100) / 100 : null,
    vsLeft: splitsData?.vsLeft ?? null,
    vsRight: splitsData?.vsRight ?? null,
  };
}

async function fetchTeamSeason(
  mlbTeamId: number,
  season: number,
): Promise<{ stat: RawTeamStat; name: string } | null> {
  const path = `/teams/${mlbTeamId}/stats?stats=season&group=hitting&season=${season}&gameType=R`;
  try {
    const raw = await mlbFetchSplits<RawTeamStatsResponse>(path, `team-offense:${mlbTeamId}:${season}`);
    const group = raw.stats?.find(g => g.type?.displayName === 'season');
    const split = group?.splits?.[0];
    if (!split) return null;
    return { stat: split.stat, name: split.team?.name ?? 'Unknown' };
  } catch (err) {
    console.error(`fetchTeamSeason(${mlbTeamId}, ${season}) failed:`, err);
    return null;
  }
}

async function fetchTeamHandednessSplits(
  mlbTeamId: number,
  season: number,
): Promise<{ vsLeft: ReturnType<typeof parseSplitLine>; vsRight: ReturnType<typeof parseSplitLine> } | null> {
  const path = `/teams/${mlbTeamId}/stats?stats=statSplits&group=hitting&season=${season}&sitCodes=vl,vr&gameType=R`;
  try {
    const raw = await mlbFetchSplits<RawTeamStatsResponse>(path, `team-splits:${mlbTeamId}:${season}`);
    const group = raw.stats?.find(g => g.type?.displayName === 'statSplits');
    if (!group) return null;

    let vsLeft: ReturnType<typeof parseSplitLine> | null = null;
    let vsRight: ReturnType<typeof parseSplitLine> | null = null;

    for (const sp of group.splits) {
      const desc = sp.split?.description?.toLowerCase() ?? '';
      if (desc.includes('left')) vsLeft = parseSplitLine(sp.stat);
      else if (desc.includes('right')) vsRight = parseSplitLine(sp.stat);
    }

    if (!vsLeft && !vsRight) return null;
    return {
      vsLeft: vsLeft ?? { ops: null, avg: null, strikeOutRate: null },
      vsRight: vsRight ?? { ops: null, avg: null, strikeOutRate: null },
    };
  } catch (err) {
    console.error(`fetchTeamHandednessSplits(${mlbTeamId}, ${season}) failed:`, err);
    return null;
  }
}
