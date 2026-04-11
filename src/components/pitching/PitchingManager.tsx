'use client';

import { useState, useMemo } from 'react';
import { FiWind, FiSun, FiCloud, FiCloudRain } from 'react-icons/fi';
import Icon from '@/components/Icon';
import { useFantasyContext } from '@/lib/hooks/useFantasyContext';
import { useRoster } from '@/lib/hooks/useRoster';
import { useGameDay, type EnrichedGame } from '@/lib/hooks/useGameDay';
import { useScoreboard } from '@/lib/hooks/useScoreboard';
import { useLeagueCategories } from '@/lib/hooks/useLeagueCategories';
import { useAvailablePitchers } from '@/lib/hooks/useAvailablePitchers';
import { useTeamOffense } from '@/lib/hooks/useTeamOffense';
import type { RosterEntry, FreeAgentPlayer } from '@/lib/yahoo-fantasy-api';
import type { ProbablePitcher, ParkData, PitcherTier, GameWeather } from '@/lib/mlb/types';
import type { TeamOffense } from '@/lib/mlb/teams';

// ---------------------------------------------------------------------------
// Stream-for category pills — per-pitcher indicators
// ---------------------------------------------------------------------------

type StreamGoal = 'QS' | 'K' | 'W' | 'ERA' | 'WHIP';

interface StreamPill {
  goal: StreamGoal;
  verdict: 'strong' | 'weak';
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function todayStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function tomorrowStr(): string {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function isPitcher(p: RosterEntry): boolean {
  return (
    p.eligible_positions.includes('P') ||
    p.eligible_positions.includes('SP') ||
    p.eligible_positions.includes('RP') ||
    p.display_position === 'SP' ||
    p.display_position === 'RP' ||
    p.display_position === 'P'
  );
}

function tierColor(tier: PitcherTier): string {
  switch (tier) {
    case 'ace': return 'text-success font-bold';
    case 'tough': return 'text-success';
    case 'average': return 'text-foreground';
    case 'weak': return 'text-accent';
    case 'bad': return 'text-error';
    default: return 'text-muted-foreground';
  }
}

function tierLabel(tier: PitcherTier): string {
  switch (tier) {
    case 'ace': return 'ACE';
    case 'tough': return 'Tough';
    case 'average': return 'Avg';
    case 'weak': return 'Weak';
    case 'bad': return 'Bad';
    default: return '?';
  }
}

function formatVal(value: string, name: string): string {
  const num = parseFloat(value);
  if (isNaN(num)) return value;
  if (['ERA', 'WHIP'].includes(name)) return num.toFixed(2);
  if (name === 'IP') return num.toFixed(1);
  return Number.isInteger(num) ? num.toString() : num.toFixed(2);
}

function weatherIcon(condition: string | null) {
  if (!condition) return null;
  const c = condition.toLowerCase();
  if (c.includes('rain') || c.includes('drizzle')) return FiCloudRain;
  if (c.includes('sun') || c.includes('clear')) return FiSun;
  return FiCloud;
}

function hasWeatherData(w: GameWeather): boolean {
  return w.condition !== null || w.temperature !== null || w.windSpeed !== null;
}

/** Invert a 0-1 value so lower = better score. */
function invertNorm(val: number | null, min: number, max: number): number {
  if (val === null) return 0.5;
  const clamped = Math.max(min, Math.min(max, val));
  return 1 - (clamped - min) / (max - min);
}

// ---------------------------------------------------------------------------
// Per-pitcher pill evaluation
// ---------------------------------------------------------------------------

interface PillInput {
  pp: ProbablePitcher;
  oppOffense: TeamOffense | null;
  park: ParkData | null;
  weather: GameWeather;
  isHome: boolean;
}

/**
 * Evaluate a streaming pitcher and produce category pills showing what
 * they'd likely help (strong) or hurt (weak) in your matchup.
 */
function getStreamPills(input: PillInput): StreamPill[] {
  const { pp, oppOffense, park, weather, isHome } = input;
  const pills: StreamPill[] = [];

  // Resolve opponent splits against this pitcher's handedness
  const oppOps = pp.throws === 'L'
    ? (oppOffense?.vsLeft?.ops ?? oppOffense?.ops ?? null)
    : (oppOffense?.vsRight?.ops ?? oppOffense?.ops ?? null);
  const oppKRate = pp.throws === 'L'
    ? (oppOffense?.vsLeft?.strikeOutRate ?? oppOffense?.strikeOutRate ?? null)
    : (oppOffense?.vsRight?.strikeOutRate ?? oppOffense?.strikeOutRate ?? null);

  const parkFactor = park?.parkFactor ?? 100;
  const windOut = weather.windDirection?.toLowerCase().includes('out') ?? false;
  const windBad = windOut && (weather.windSpeed ?? 0) >= 10;

  // --- QS: high IP/GS + low ERA + efficient + weak opponent ---
  const ipgs = pp.inningsPerStart;
  const ppi = pp.pitchesPerInning;
  if (ipgs !== null && ipgs >= 5.8 && (pp.era ?? 99) <= 4.00 && (ppi === null || ppi <= 16) && (oppOps === null || oppOps <= .750)) {
    pills.push({ goal: 'QS', verdict: 'strong' });
  } else if (ipgs !== null && ipgs < 5.0) {
    pills.push({ goal: 'QS', verdict: 'weak' });
  } else if ((pp.era ?? 0) > 5.00 && ipgs !== null && ipgs < 5.5) {
    pills.push({ goal: 'QS', verdict: 'weak' });
  }

  // --- K: high K/9 + opponent K-prone ---
  const k9 = pp.strikeoutsPer9;
  if (k9 !== null && k9 >= 9.5) {
    // Elite K rate — strong regardless of opponent
    pills.push({ goal: 'K', verdict: 'strong' });
  } else if (k9 !== null && k9 >= 8.5 && (oppKRate === null || oppKRate >= .210)) {
    // Very good K rate — strong unless opponent is clearly contact-oriented
    pills.push({ goal: 'K', verdict: 'strong' });
  } else if (k9 !== null && k9 >= 7.5 && oppKRate !== null && oppKRate >= .230) {
    // Good K rate + K-prone opponent = matchup boost
    pills.push({ goal: 'K', verdict: 'strong' });
  } else if (k9 !== null && k9 < 5.5) {
    // Low K pitcher — weak regardless
    pills.push({ goal: 'K', verdict: 'weak' });
  } else if (k9 !== null && k9 < 7.5 && oppKRate !== null && oppKRate < .200) {
    // Mediocre K pitcher against a contact-heavy opponent — weak matchup
    pills.push({ goal: 'K', verdict: 'weak' });
  }

  // --- W: good pitcher + weak opponent + home field ---
  if ((pp.era ?? 99) <= 3.75 && (oppOps !== null && oppOps <= .720) && isHome) {
    pills.push({ goal: 'W', verdict: 'strong' });
  } else if ((pp.era ?? 99) <= 3.50 && (oppOps === null || oppOps <= .740)) {
    pills.push({ goal: 'W', verdict: 'strong' });
  } else if ((pp.era ?? 0) > 5.00 && (oppOps !== null && oppOps >= .770)) {
    pills.push({ goal: 'W', verdict: 'weak' });
  }

  // --- ERA: pitcher quality + matchup + park + weather ---
  const eraFriendly = parkFactor <= 97 && !windBad;
  if ((pp.era ?? 99) <= 3.50 && (oppOps === null || oppOps <= .730) && eraFriendly) {
    pills.push({ goal: 'ERA', verdict: 'strong' });
  } else if ((pp.era ?? 99) <= 3.25) {
    // Great pitcher even without perfect conditions
    pills.push({ goal: 'ERA', verdict: 'strong' });
  } else if ((pp.era ?? 0) >= 5.00 || (parkFactor >= 105 && windBad)) {
    pills.push({ goal: 'ERA', verdict: 'weak' });
  }

  // --- WHIP: low WHIP + weak-contact opponent ---
  if ((pp.whip ?? 99) <= 1.15 && (oppOps === null || oppOps <= .730)) {
    pills.push({ goal: 'WHIP', verdict: 'strong' });
  } else if ((pp.whip ?? 99) <= 1.10) {
    pills.push({ goal: 'WHIP', verdict: 'strong' });
  } else if ((pp.whip ?? 0) >= 1.45) {
    pills.push({ goal: 'WHIP', verdict: 'weak' });
  }

  return pills;
}

/** Overall streaming score for sort order — general quality composite. */
function overallScore(input: PillInput): number {
  const { pp, oppOffense, park, weather } = input;
  const oppOps = pp.throws === 'L'
    ? (oppOffense?.vsLeft?.ops ?? oppOffense?.ops ?? null)
    : (oppOffense?.vsRight?.ops ?? oppOffense?.ops ?? null);

  const era = invertNorm(pp.era, 1.5, 6.0);
  const whip = invertNorm(pp.whip, 0.8, 1.6);
  const opp = invertNorm(oppOps, .600, .850);
  const pf = park ? invertNorm(park.parkFactor, 85, 115) : 0.5;
  const windOut = weather.windDirection?.toLowerCase().includes('out') ?? false;
  const wx = 1 - (windOut ? (weather.windSpeed ?? 0) / 20 : 0);

  return era * 0.30 + whip * 0.20 + opp * 0.25 + pf * 0.15 + wx * 0.10;
}

// ---------------------------------------------------------------------------
// Matchup Pulse — pitching category scores vs opponent
// ---------------------------------------------------------------------------

interface PulseProps {
  leagueKey: string | undefined;
  teamKey: string | undefined;
}

function MatchupPulse({ leagueKey, teamKey }: PulseProps) {
  const { matchups, week, isLoading: scoreLoading } = useScoreboard(leagueKey);
  const { categories, isLoading: catsLoading } = useLeagueCategories(leagueKey);

  const isLoading = scoreLoading || catsLoading;

  const userMatchup = teamKey
    ? matchups.find(m => m.teams.some(t => t.team_key === teamKey))
    : undefined;
  const userTeam = userMatchup?.teams.find(t => t.team_key === teamKey);
  const opponent = userMatchup?.teams.find(t => t.team_key !== teamKey);

  const pitchingCats = categories.filter(c => c.is_pitcher_stat);

  const rows = useMemo(() => {
    if (!userTeam?.stats || !opponent?.stats) return [];
    const myMap = new Map(userTeam.stats.map(s => [s.stat_id, s.value]));
    const oppMap = new Map(opponent.stats.map(s => [s.stat_id, s.value]));
    return pitchingCats.flatMap(cat => {
      const myRaw = myMap.get(cat.stat_id);
      const oppRaw = oppMap.get(cat.stat_id);
      if (myRaw === undefined || oppRaw === undefined) return [];
      const myNum = parseFloat(myRaw);
      const oppNum = parseFloat(oppRaw);
      if (isNaN(myNum) || isNaN(oppNum)) return [];
      const delta = myNum - oppNum;
      const winning = cat.betterIs === 'higher' ? delta > 0 : delta < 0;
      return [{
        label: cat.display_name,
        name: cat.name,
        myVal: myRaw,
        oppVal: oppRaw,
        winning: delta === 0 ? null : winning,
      }];
    });
  }, [userTeam, opponent, pitchingCats]);

  if (isLoading) {
    return (
      <div className="bg-surface rounded-lg shadow p-4 animate-pulse">
        <div className="h-4 bg-border-muted rounded w-48 mb-3" />
        <div className="flex gap-4">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="h-14 w-20 bg-border-muted rounded" />
          ))}
        </div>
      </div>
    );
  }

  if (!userMatchup) {
    return (
      <div className="bg-surface rounded-lg shadow p-4">
        <p className="text-sm text-muted-foreground">No active matchup this week</p>
      </div>
    );
  }

  const wins = rows.filter(r => r.winning === true).length;
  const losses = rows.filter(r => r.winning === false).length;
  const ties = rows.filter(r => r.winning === null).length;

  return (
    <div className="bg-surface rounded-lg shadow p-4">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-semibold text-foreground">
          Pitching Categories {week ? `— Week ${week}` : ''}
        </h2>
        <div className="flex items-center gap-2 text-xs">
          <span className="text-muted-foreground">vs {opponent?.name ?? 'Opp'}</span>
          <span className={`px-2 py-0.5 rounded-full font-medium ${
            wins > losses ? 'bg-success/15 text-success' :
            losses > wins ? 'bg-error/15 text-error' :
            'bg-primary/15 text-muted-foreground'
          }`}>
            {wins}W–{losses}L–{ties}T
          </span>
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        {rows.map(row => (
          <div
            key={row.label}
            className={`flex flex-col items-center px-3 py-2 rounded-lg border ${
              row.winning === true ? 'border-success/30 bg-success/5' :
              row.winning === false ? 'border-error/30 bg-error/5' :
              'border-border bg-background'
            }`}
          >
            <span className="text-xs font-medium text-muted-foreground">{row.label}</span>
            <span className="text-sm font-bold text-foreground">{formatVal(row.myVal, row.name)}</span>
            <span className="text-xs text-muted-foreground">{formatVal(row.oppVal, row.name)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// My Staff Today — rostered pitchers with today's matchup info
// ---------------------------------------------------------------------------

interface StaffTodayProps {
  roster: RosterEntry[];
  games: EnrichedGame[];
  isLoading: boolean;
}

function findPitcherGame(teamAbbr: string, games: EnrichedGame[]) {
  const abbr = teamAbbr.toUpperCase();
  for (const g of games) {
    if (g.homeTeam.abbreviation.toUpperCase() === abbr) {
      return { game: g, isHome: true };
    }
    if (g.awayTeam.abbreviation.toUpperCase() === abbr) {
      return { game: g, isHome: false };
    }
  }
  return null;
}

function isStartingToday(pitcher: RosterEntry, games: EnrichedGame[]): boolean {
  const gInfo = findPitcherGame(pitcher.editorial_team_abbr, games);
  if (!gInfo) return false;
  const pp = gInfo.isHome ? gInfo.game.homeProbablePitcher : gInfo.game.awayProbablePitcher;
  if (!pp) return false;
  const yahooLast = pitcher.name.split(' ').pop()?.toLowerCase();
  const mlbLast = pp.name.split(' ').pop()?.toLowerCase();
  return !!yahooLast && yahooLast === mlbLast;
}

function MyStaffRow({ pitcher, games }: { pitcher: RosterEntry; games: EnrichedGame[] }) {
  const gInfo = findPitcherGame(pitcher.editorial_team_abbr, games);
  const starting = isStartingToday(pitcher, games);
  const isBenched = pitcher.selected_position === 'BN';
  const isIL = pitcher.selected_position === 'IL' || pitcher.selected_position === 'IL+' || pitcher.selected_position === 'NA';

  return (
    <div className={`flex items-center gap-3 px-3 py-2 rounded-lg border ${
      isIL ? 'border-error/20 bg-error/5' :
      isBenched ? 'border-border-muted bg-background' :
      starting ? 'border-success/30 bg-success/5' :
      'border-border'
    }`}>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-foreground truncate">{pitcher.name}</span>
          <span className="text-xs px-1.5 py-0.5 rounded bg-surface-muted text-muted-foreground">
            {pitcher.display_position}
          </span>
          {starting && (
            <span className="text-xs px-1.5 py-0.5 rounded bg-success/15 text-success font-medium">Starting</span>
          )}
          {isBenched && (
            <span className="text-xs px-1.5 py-0.5 rounded bg-primary/10 text-muted-foreground font-medium">BN</span>
          )}
          {isIL && (
            <span className="text-xs px-1.5 py-0.5 rounded bg-error/15 text-error font-medium">{pitcher.selected_position}</span>
          )}
        </div>
        <div className="text-xs text-muted-foreground mt-0.5">
          {pitcher.editorial_team_abbr}
          {pitcher.status && <span className="ml-1 text-error">({pitcher.status})</span>}
        </div>
      </div>
      <div className="text-right text-xs">
        {gInfo ? (
          <>
            <div className="text-foreground">
              {gInfo.isHome ? 'vs' : '@'}{' '}
              {gInfo.isHome ? gInfo.game.awayTeam.abbreviation : gInfo.game.homeTeam.abbreviation}
            </div>
            <div className="text-muted-foreground">
              {new Date(gInfo.game.gameDate).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
            </div>
          </>
        ) : (
          <span className="text-muted-foreground italic">No game</span>
        )}
      </div>
    </div>
  );
}

function StaffToday({ roster, games, isLoading }: StaffTodayProps) {
  const pitchers = roster.filter(isPitcher);
  const starters = pitchers.filter(p =>
    p.selected_position !== 'BN' && p.selected_position !== 'IL' && p.selected_position !== 'IL+' && p.selected_position !== 'NA'
  );
  const bench = pitchers.filter(p => p.selected_position === 'BN');
  const injured = pitchers.filter(p =>
    p.selected_position === 'IL' || p.selected_position === 'IL+' || p.selected_position === 'NA'
  );

  if (isLoading) {
    return (
      <div className="bg-surface rounded-lg shadow p-4">
        <div className="h-4 bg-border-muted rounded w-32 mb-3 animate-pulse" />
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="animate-pulse flex items-center gap-3 px-3 py-2 mb-1">
            <div className="flex-1 space-y-1">
              <div className="h-3.5 bg-border-muted rounded w-32" />
              <div className="h-2.5 bg-border-muted rounded w-20" />
            </div>
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="bg-surface rounded-lg shadow p-4">
      <h2 className="text-sm font-semibold text-foreground mb-3">My Staff — Today</h2>
      {pitchers.length === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-4">No pitchers on roster</p>
      ) : (
        <div className="space-y-3">
          {starters.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1.5">Active</p>
              <div className="space-y-1">
                {starters.map(p => <MyStaffRow key={p.player_key} pitcher={p} games={games} />)}
              </div>
            </div>
          )}
          {bench.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1.5">Bench</p>
              <div className="space-y-1">
                {bench.map(p => <MyStaffRow key={p.player_key} pitcher={p} games={games} />)}
              </div>
            </div>
          )}
          {injured.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1.5">Injured</p>
              <div className="space-y-1">
                {injured.map(p => <MyStaffRow key={p.player_key} pitcher={p} games={games} />)}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Streaming Board — enriched with scoring, team offense, weather, park
// ---------------------------------------------------------------------------

interface StreamCandidate {
  player: FreeAgentPlayer;
  pp: ProbablePitcher;
  opponent: string;
  opponentMlbId: number;
  isHome: boolean;
  park: ParkData | null;
  weather: GameWeather;
  pills: StreamPill[];
  sortScore: number;
}

interface StreamingBoardProps {
  date: string;
  games: EnrichedGame[];
  freeAgents: FreeAgentPlayer[];
  gamesLoading: boolean;
  faLoading: boolean;
  faError: boolean;
  teamOffense: Record<number, TeamOffense>;
  offenseLoading: boolean;
}

// Yahoo ↔ MLB team abbreviation aliases (both directions resolve to a canonical key)
const TEAM_ABBR_ALIASES: Record<string, string> = {
  AZ: 'ARI', ARI: 'ARI',
  CHW: 'CWS', CWS: 'CWS',
  WAS: 'WSH', WSH: 'WSH',
  KCR: 'KC', KC: 'KC',
  SDP: 'SD', SD: 'SD',
  SFG: 'SF', SF: 'SF',
  TBR: 'TB', TB: 'TB',
};

function normalizeTeamAbbr(abbr: string): string {
  const upper = (abbr ?? '').toUpperCase();
  return TEAM_ABBR_ALIASES[upper] ?? upper;
}

/** Normalize a name for fuzzy matching: strip diacritics, suffixes, punctuation, lowercase. */
function normalizeName(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // strip combining diacritical marks
    .toLowerCase()
    .replace(/[.,']/g, '')
    .replace(/\s+(jr|sr|ii|iii|iv)$/i, '')
    .trim();
}

/** Extract a normalized last name token for matching. */
function lastNameKey(name: string): string {
  const parts = normalizeName(name).split(/\s+/).filter(Boolean);
  return parts[parts.length - 1] ?? '';
}

function matchFreeAgentToGame(
  fa: FreeAgentPlayer,
  games: EnrichedGame[],
): { game: EnrichedGame; pp: ProbablePitcher; isHome: boolean } | null {
  const abbr = normalizeTeamAbbr(fa.editorial_team_abbr);
  const faLast = lastNameKey(fa.name);
  const faFull = normalizeName(fa.name);

  for (const g of games) {
    const homeAbbr = normalizeTeamAbbr(g.homeTeam.abbreviation);
    const awayAbbr = normalizeTeamAbbr(g.awayTeam.abbreviation);
    const isHome = homeAbbr === abbr;
    const isAway = awayAbbr === abbr;
    if (!isHome && !isAway) continue;

    const pp = isHome ? g.homeProbablePitcher : g.awayProbablePitcher;
    if (!pp) continue;

    const ppLast = lastNameKey(pp.name);
    const ppFull = normalizeName(pp.name);

    // Match on last name, OR on full name containment (handles e.g. "JT Brubaker" vs "J.T. Brubaker")
    if (faLast && ppLast && (faLast === ppLast || faFull === ppFull || faFull.includes(ppLast) || ppFull.includes(faLast))) {
      return { game: g, pp, isHome };
    }
  }
  return null;
}

function StreamingBoard({
  date, games, freeAgents, gamesLoading, faLoading, faError,
  teamOffense, offenseLoading,
}: StreamingBoardProps) {
  const candidates = useMemo(() => {
    if (games.length === 0 || freeAgents.length === 0) return [];
    const results: StreamCandidate[] = [];

    for (const fa of freeAgents) {
      const match = matchFreeAgentToGame(fa, games);
      if (!match) continue;

      const { game, pp, isHome } = match;
      const opponentTeam = isHome ? game.awayTeam : game.homeTeam;
      const oppOffense = teamOffense[opponentTeam.mlbId] ?? null;

      const pillInput: PillInput = {
        pp,
        oppOffense,
        park: game.park ?? null,
        weather: game.weather,
        isHome,
      };

      results.push({
        player: fa,
        pp,
        opponent: opponentTeam.abbreviation,
        opponentMlbId: opponentTeam.mlbId,
        isHome,
        park: game.park ?? null,
        weather: game.weather,
        pills: getStreamPills(pillInput),
        sortScore: overallScore(pillInput),
      });
    }

    results.sort((a, b) => b.sortScore - a.sortScore);
    return results;
  }, [games, freeAgents, teamOffense]);

  const isLoading = gamesLoading || faLoading;

  if (isLoading) {
    return (
      <div className="bg-surface rounded-lg shadow p-4">
        <div className="h-4 bg-border-muted rounded w-48 mb-3 animate-pulse" />
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="animate-pulse flex items-center gap-3 px-3 py-2 mb-1">
            <div className="flex-1 space-y-1">
              <div className="h-3.5 bg-border-muted rounded w-40" />
              <div className="h-2.5 bg-border-muted rounded w-56" />
            </div>
            <div className="h-5 w-12 bg-border-muted rounded" />
          </div>
        ))}
      </div>
    );
  }

  function renderStatLine(c: StreamCandidate): string {
    const parts: string[] = [];
    if (c.pp.era !== null) parts.push(`ERA ${c.pp.era.toFixed(2)}`);
    if (c.pp.whip !== null) parts.push(`WHIP ${c.pp.whip.toFixed(2)}`);
    if (c.pp.strikeoutsPer9 !== null) parts.push(`K/9 ${c.pp.strikeoutsPer9.toFixed(1)}`);
    if (c.pp.inningsPerStart !== null) parts.push(`IP/GS ${c.pp.inningsPerStart.toFixed(1)}`);
    return parts.join(' · ');
  }

  return (
    <div className="bg-surface rounded-lg shadow p-4">
      {/* Header */}
      <div className="flex items-center gap-3 mb-3">
        <h2 className="text-sm font-semibold text-foreground">
          Streaming Board — {date}
        </h2>
        <span className="text-xs text-muted-foreground">
          {candidates.length} starter{candidates.length !== 1 ? 's' : ''}
        </span>
      </div>

      {offenseLoading && (
        <p className="text-xs text-muted-foreground mb-2 animate-pulse">Loading team offense data...</p>
      )}

      {faError ? (
        <p className="text-sm text-error text-center py-4">Failed to load free agents</p>
      ) : candidates.length === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-4">
          {freeAgents.length === 0
            ? 'No free agent data available'
            : 'No free agent pitchers with probable starts found'}
        </p>
      ) : (
        <div className="space-y-1">
          {candidates.map((c, i) => {
            const parkTendency = c.park?.tendency;
            const parkGood = parkTendency === 'pitcher' || parkTendency === 'extreme-pitcher';
            const parkBad = parkTendency === 'hitter' || parkTendency === 'extreme-hitter';
            const windOut = c.weather.windDirection?.toLowerCase().includes('out') ?? false;
            const windBad = windOut && (c.weather.windSpeed ?? 0) >= 10;

            const bgClass = c.sortScore >= 0.7 ? 'bg-success/5'
              : c.sortScore >= 0.5 ? ''
              : 'bg-error/5';

            const initial = c.player.name.charAt(0).toUpperCase();
            const opp = teamOffense[c.opponentMlbId];
            const oppSplit = c.pp.throws === 'L' ? opp?.vsLeft : opp?.vsRight;
            const oppOps = oppSplit?.ops ?? opp?.ops ?? null;

            return (
              <div
                key={c.player.player_key}
                className={`rounded-lg overflow-hidden ${bgClass} hover:bg-surface-muted/40 transition-colors`}
              >
                <div className="flex items-start gap-3 px-3 py-2">
                  {/* Rank */}
                  <div className="w-5 text-center text-xs font-bold text-muted-foreground mt-2.5 shrink-0">
                    {i + 1}
                  </div>

                  {/* Avatar */}
                  {c.player.image_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={c.player.image_url}
                      alt={c.player.name}
                      className="w-9 h-9 rounded-full border border-border object-cover shrink-0 mt-0.5"
                      onError={e => {
                        e.currentTarget.style.display = 'none';
                        e.currentTarget.nextElementSibling?.classList.remove('hidden');
                      }}
                    />
                  ) : null}
                  <div className={`w-9 h-9 rounded-full bg-primary/15 text-primary flex items-center justify-center shrink-0 mt-0.5 text-xs font-bold ${c.player.image_url ? 'hidden' : ''}`}>
                    {initial}
                  </div>

                  {/* Main info column */}
                  <div className="flex-1 min-w-0 space-y-0.5">
                    {/* Line 1: Name + throws + tier + team · position */}
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className="text-sm font-semibold text-foreground truncate">{c.player.name}</span>
                      <span className={`text-[11px] font-bold ${c.pp.throws === 'L' ? 'text-accent' : 'text-primary'}`}>
                        ({c.pp.throws}HP)
                      </span>
                      <span className={`text-[10px] font-bold ${tierColor(c.pp.quality?.tier ?? 'unknown')}`}>
                        {tierLabel(c.pp.quality?.tier ?? 'unknown')}
                      </span>
                      <span className="text-[11px] text-muted-foreground">
                        {c.player.editorial_team_abbr} · {c.player.display_position}
                      </span>
                      {c.player.ownership_type === 'waivers' && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-accent/10 text-accent font-semibold">
                          WW
                        </span>
                      )}
                    </div>

                    {/* Line 2: Matchup context (opponent + park + weather) */}
                    <div className="flex items-center gap-2 flex-wrap text-[11px]">
                      <span className="text-muted-foreground">
                        {c.isHome ? 'vs' : '@'}{' '}
                        <span className="font-semibold text-foreground">{c.opponent}</span>
                      </span>
                      {oppOps !== null && (
                        <>
                          <span className="text-border">|</span>
                          <span className="text-muted-foreground">
                            Opp OPS <span className="text-foreground font-medium">{oppOps.toFixed(3).replace(/^0\./, '.')}</span>
                          </span>
                        </>
                      )}
                      <span className="text-border">|</span>
                      <span className={`px-1.5 py-0.5 rounded text-[10px] ${
                        parkGood ? 'bg-success/10 text-success' :
                        parkBad ? 'bg-error/10 text-error' :
                        'bg-surface-muted text-muted-foreground'
                      }`}>
                        PF {c.park?.parkFactor ?? '—'}
                      </span>
                      {hasWeatherData(c.weather) && (
                        <div className="flex items-center gap-1">
                          {(() => {
                            const Wx = weatherIcon(c.weather.condition);
                            return Wx ? <Icon icon={Wx} size={12} className="text-muted-foreground" /> : null;
                          })()}
                          {c.weather.temperature != null && (
                            <span className="text-muted-foreground">{c.weather.temperature}°</span>
                          )}
                          {c.weather.windSpeed != null && c.weather.windSpeed > 0 && (
                            <span className={`flex items-center gap-0.5 ${windBad ? 'text-error' : 'text-muted-foreground'}`}>
                              <Icon icon={FiWind} size={10} />
                              {c.weather.windSpeed}
                            </span>
                          )}
                        </div>
                      )}
                    </div>

                    {/* Line 3: Stat line */}
                    <div className="text-[11px] text-muted-foreground">
                      {renderStatLine(c)}
                    </div>

                    {/* Line 4: Stream-for pills */}
                    {c.pills.length > 0 && (
                      <div className="flex items-center gap-1.5 flex-wrap pt-0.5">
                        {c.pills.map(pill => (
                          <span
                            key={pill.goal}
                            className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-semibold ${
                              pill.verdict === 'strong'
                                ? 'bg-success/15 text-success'
                                : 'bg-error/15 text-error'
                            }`}
                          >
                            {pill.goal}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export default function PitchingManager() {
  const { teamKey, leagueKey, isLoading: ctxLoading, isError: ctxError } = useFantasyContext();
  const [tab, setTab] = useState<'today' | 'tomorrow'>('tomorrow');

  const today = todayStr();
  const tomorrow = tomorrowStr();

  // Today's data
  const { roster, isLoading: rosterLoading } = useRoster(teamKey, today);
  const { games: todayGames, isLoading: todayGamesLoading } = useGameDay(today);

  // Tomorrow's data
  const { games: tomorrowGames, isLoading: tomorrowGamesLoading } = useGameDay(tomorrow);
  const { players: freeAgents, isLoading: faLoading, isError: faError } = useAvailablePitchers(leagueKey);

  // Collect all opposing team MLB IDs from tomorrow's games for team offense fetch
  const opposingTeamIds = useMemo(() => {
    const ids = new Set<number>();
    for (const g of tomorrowGames) {
      ids.add(g.homeTeam.mlbId);
      ids.add(g.awayTeam.mlbId);
    }
    return Array.from(ids);
  }, [tomorrowGames]);

  const { teams: teamOffense, isLoading: offenseLoading } = useTeamOffense(opposingTeamIds);

  if (ctxError) {
    return (
      <div className="p-6">
        <div className="bg-surface rounded-lg shadow p-8 text-center">
          <p className="text-sm text-error">Failed to load fantasy context</p>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-4">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-foreground">Pitching</h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            {tab === 'today'
              ? 'Sit/start decisions for your active pitchers'
              : 'Find streamers for tomorrow\'s games'}
          </p>
        </div>

        {/* Today / Tomorrow toggle */}
        <div className="flex space-x-1 bg-secondary rounded-lg p-1">
          <button
            onClick={() => setTab('today')}
            className={`py-2 px-4 rounded-md text-sm font-medium transition-colors ${
              tab === 'today'
                ? 'bg-background text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            Today
          </button>
          <button
            onClick={() => setTab('tomorrow')}
            className={`py-2 px-4 rounded-md text-sm font-medium transition-colors ${
              tab === 'tomorrow'
                ? 'bg-background text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            Tomorrow
          </button>
        </div>
      </div>

      {/* Matchup pulse — always visible */}
      <MatchupPulse leagueKey={leagueKey} teamKey={teamKey} />

      {tab === 'today' ? (
        <StaffToday
          roster={roster}
          games={todayGames}
          isLoading={ctxLoading || rosterLoading || todayGamesLoading}
        />
      ) : (
        <StreamingBoard
          date={tomorrow}
          games={tomorrowGames}
          freeAgents={freeAgents}
          gamesLoading={tomorrowGamesLoading}
          faLoading={ctxLoading || faLoading}
          faError={faError}
          teamOffense={teamOffense}
          offenseLoading={offenseLoading}
        />
      )}
    </div>
  );
}
