import { mlbFetchSplits } from './client';
import { blendRate } from './talentModel';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Team offensive profile with all rate stats Bayesian-regressed against
 * the prior-season team line and MLB-wide league priors.
 *
 * Consumers see regressed numbers for `ops`, `avg`, `strikeOutRate`, and
 * both handedness splits (`vsLeft`, `vsRight`). Counting stats that don't
 * regress cleanly (`runsPerGame`, `homeRunsPerGame`) remain raw current-
 * season.
 *
 * This fixes the early-April noise problem: a team with 180 AB against
 * LHP doesn't project as the league's worst vs-L offense just because
 * they haven't had their bats turn over yet. See `blendTeamOffenseRate`
 * below for weighting details.
 */
export interface TeamOffense {
  mlbId: number;
  name: string;
  gamesPlayed: number;
  // Season totals (regressed where indicated)
  ops: number | null;              // regressed
  avg: number | null;              // regressed
  runsPerGame: number | null;      // raw current season (counting stat)
  strikeOutRate: number | null;    // regressed — K / AB
  homeRunsPerGame: number | null;  // raw current season (counting stat)
  // vs LHP / RHP splits (all three rate fields regressed)
  vsLeft: { ops: number | null; avg: number | null; strikeOutRate: number | null } | null;
  vsRight: { ops: number | null; avg: number | null; strikeOutRate: number | null } | null;
}

// ---------------------------------------------------------------------------
// League-mean priors and regression shape
// ---------------------------------------------------------------------------

// 2024 MLB team-line averages. Rough but close — the league anchor here
// just needs to be stable, not perfectly calibrated. Updating once a
// season is enough.
const LEAGUE_TEAM_OPS = 0.710;
const LEAGUE_TEAM_AVG = 0.243;
const LEAGUE_TEAM_K_RATE = 0.223;

// Effective sample size for the league-mean prior, expressed in AB. ~200
// AB ≈ one weekend series worth of team ABs, so a team with 600 AB (about
// mid-April) is ~75% themselves and ~25% league mean. By the All-Star
// break (~2500 AB) the prior is a rounding error.
const LEAGUE_PRIOR_AB = 200;

// Cap on how much prior-season data is allowed to count. Team aggregates
// stabilise faster than individuals, so we allow more weight than the
// player-level defaults — a full prior season can match ~2000 AB of
// current-season weight, at which point a team has already clearly
// deviated from its prior identity.
const PRIOR_SEASON_AB_CAP = 2000;

/**
 * Regress a team-level rate against prior-year team + league mean. Uses
 * AB as the universal weight (close enough for all three target stats —
 * OPS, AVG, K-rate — at the team-aggregate grain; team OPS's "true" weight
 * would be PA, but AB correlates ~0.99 with PA for a full team line).
 *
 * Returns null only when every input is null *and* no league prior is
 * active — in practice we always return the league mean if the team has
 * literally no data.
 */
function blendTeamOffenseRate(
  current: number | null,
  currentAb: number,
  prior: number | null,
  priorAb: number,
  leagueMean: number,
): number | null {
  if (current === null && prior === null) return leagueMean;
  return blendRate({
    current,
    currentN: currentAb,
    prior,
    priorN: priorAb,
    leagueMean,
    leaguePriorN: LEAGUE_PRIOR_AB,
    priorCap: PRIOR_SEASON_AB_CAP,
  }).value;
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
  plateAppearances?: number;
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
  return k / ab;
}

interface ParsedSplitLine {
  ops: number | null;
  avg: number | null;
  strikeOutRate: number | null;
  atBats: number;
}

function parseSplitLine(raw: RawTeamStat): ParsedSplitLine {
  return {
    ops: n(raw.ops),
    avg: n(raw.avg),
    strikeOutRate: kRate(raw),
    atBats: raw.atBats ?? 0,
  };
}

function blendSplitLine(
  current: ParsedSplitLine | null,
  prior: ParsedSplitLine | null,
): { ops: number | null; avg: number | null; strikeOutRate: number | null } {
  const curAb = current?.atBats ?? 0;
  const priAb = prior?.atBats ?? 0;
  return {
    ops: blendTeamOffenseRate(current?.ops ?? null, curAb, prior?.ops ?? null, priAb, LEAGUE_TEAM_OPS),
    avg: blendTeamOffenseRate(current?.avg ?? null, curAb, prior?.avg ?? null, priAb, LEAGUE_TEAM_AVG),
    strikeOutRate: blendTeamOffenseRate(
      current?.strikeOutRate ?? null,
      curAb,
      prior?.strikeOutRate ?? null,
      priAb,
      LEAGUE_TEAM_K_RATE,
    ),
  };
}

function roundRate(v: number | null, digits: number): number | null {
  if (v === null) return null;
  const m = Math.pow(10, digits);
  return Math.round(v * m) / m;
}

// ---------------------------------------------------------------------------
// Fetch team season batting stats + vs-handedness splits
// ---------------------------------------------------------------------------

/**
 * Fetch a team's offensive profile with rate stats Bayesian-regressed
 * against prior season + league mean.
 *
 * Fetches current + prior-season totals and both handedness splits in
 * parallel, then blends each rate field (OPS / AVG / K%) through the
 * shared `blendRate` helper. Counting stats (runs/game, HR/game) are
 * kept raw — they don't regress cleanly at the team-aggregate grain and
 * the fantasy consumers treat them as context rather than input to a
 * ranking score.
 *
 * Cached 1 hour per underlying endpoint — team-level stats don't move
 * much day-to-day.
 */
export async function getTeamOffense(
  mlbTeamId: number,
  season: number = new Date().getFullYear(),
): Promise<TeamOffense | null> {
  const priorSeason = season - 1;

  const [
    currentSeasonData,
    currentSplitsData,
    priorSeasonData,
    priorSplitsData,
  ] = await Promise.all([
    fetchTeamSeason(mlbTeamId, season),
    fetchTeamHandednessSplits(mlbTeamId, season),
    fetchTeamSeason(mlbTeamId, priorSeason),
    fetchTeamHandednessSplits(mlbTeamId, priorSeason),
  ]);

  if (!currentSeasonData) return null;

  const { stat, name } = currentSeasonData;
  const gp = stat.gamesPlayed ?? 0;
  const curAb = stat.atBats ?? 0;
  const priStat = priorSeasonData?.stat;
  const priAb = priStat?.atBats ?? 0;

  // Top-line rate regression
  const blendedOps = blendTeamOffenseRate(n(stat.ops), curAb, n(priStat?.ops), priAb, LEAGUE_TEAM_OPS);
  const blendedAvg = blendTeamOffenseRate(n(stat.avg), curAb, n(priStat?.avg), priAb, LEAGUE_TEAM_AVG);
  const blendedK = blendTeamOffenseRate(
    kRate(stat),
    curAb,
    priStat ? kRate(priStat) : null,
    priAb,
    LEAGUE_TEAM_K_RATE,
  );

  return {
    mlbId: mlbTeamId,
    name,
    gamesPlayed: gp,
    ops: roundRate(blendedOps, 3),
    avg: roundRate(blendedAvg, 3),
    runsPerGame: gp > 0 && stat.runs != null ? Math.round((stat.runs / gp) * 100) / 100 : null,
    strikeOutRate: roundRate(blendedK, 3),
    homeRunsPerGame: gp > 0 && stat.homeRuns != null ? Math.round((stat.homeRuns / gp) * 100) / 100 : null,
    vsLeft: currentSplitsData?.vsLeft || priorSplitsData?.vsLeft
      ? finalizeSplit(blendSplitLine(currentSplitsData?.vsLeft ?? null, priorSplitsData?.vsLeft ?? null))
      : null,
    vsRight: currentSplitsData?.vsRight || priorSplitsData?.vsRight
      ? finalizeSplit(blendSplitLine(currentSplitsData?.vsRight ?? null, priorSplitsData?.vsRight ?? null))
      : null,
  };
}

function finalizeSplit(s: { ops: number | null; avg: number | null; strikeOutRate: number | null }) {
  return {
    ops: roundRate(s.ops, 3),
    avg: roundRate(s.avg, 3),
    strikeOutRate: roundRate(s.strikeOutRate, 3),
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
): Promise<{ vsLeft: ParsedSplitLine | null; vsRight: ParsedSplitLine | null } | null> {
  const path = `/teams/${mlbTeamId}/stats?stats=statSplits&group=hitting&season=${season}&sitCodes=vl,vr&gameType=R`;
  try {
    const raw = await mlbFetchSplits<RawTeamStatsResponse>(path, `team-splits:${mlbTeamId}:${season}`);
    const group = raw.stats?.find(g => g.type?.displayName === 'statSplits');
    if (!group) return null;

    let vsLeft: ParsedSplitLine | null = null;
    let vsRight: ParsedSplitLine | null = null;

    for (const sp of group.splits) {
      const desc = sp.split?.description?.toLowerCase() ?? '';
      if (desc.includes('left')) vsLeft = parseSplitLine(sp.stat);
      else if (desc.includes('right')) vsRight = parseSplitLine(sp.stat);
    }

    if (!vsLeft && !vsRight) return null;
    return { vsLeft, vsRight };
  } catch (err) {
    console.error(`fetchTeamHandednessSplits(${mlbTeamId}, ${season}) failed:`, err);
    return null;
  }
}
