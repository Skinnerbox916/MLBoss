'use client';

import { useState } from 'react';
import CopyButton from './CopyButton';
import { Heading } from '@/components/typography';

interface RosterPlayer {
  player_key: string;
  name: string;
  editorial_team_abbr: string;
  display_position: string;
  eligible_positions: string[];
  selected_position: string;
  status?: string;
  on_disabled_list: boolean;
  is_editable: boolean;
  starting_status?: string;
  batting_order: number | null;
}

interface LineupPlayer {
  mlbId: number;
  fullName: string;
  battingOrder: number;
  position: string;
}

interface GameLineup {
  homeTeam: string;
  awayTeam: string;
  homeLineup: LineupPlayer[];
  awayLineup: LineupPlayer[];
}

export default function RosterDebugPanel() {
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [loading, setLoading] = useState(false);
  const [roster, setRoster] = useState<RosterPlayer[] | null>(null);
  const [lineups, setLineups] = useState<GameLineup[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [teamKey, setTeamKey] = useState<string | null>(null);
  const [rawStructure, setRawStructure] = useState<any[] | null>(null);
  const [rawLoading, setRawLoading] = useState(false);

  async function run() {
    setLoading(true);
    setError(null);
    setRoster(null);
    setLineups(null);
    setRawStructure(null);
    try {
      // Get context for team key
      const ctxRes = await fetch('/api/fantasy/context');
      if (!ctxRes.ok) throw new Error('Failed to fetch context');
      const ctx = await ctxRes.json();
      const tk = ctx.primary_team_key;
      setTeamKey(tk);

      // Fetch roster, game-day, and raw structure in parallel
      const [rosterRes, gameDayRes, rawRes] = await Promise.all([
        fetch(`/api/fantasy/roster?teamKey=${tk}&date=${date}`),
        fetch(`/api/mlb/game-day?date=${date}`),
        fetch(`/api/fantasy/roster-raw?teamKey=${tk}&date=${date}&limit=3`),
      ]);

      if (rosterRes.ok) {
        const rosterData = await rosterRes.json();
        setRoster(rosterData.roster ?? []);
      } else {
        setError(`Roster: HTTP ${rosterRes.status}`);
      }

      if (gameDayRes.ok) {
        const gameDayData = await gameDayRes.json();
        const games = gameDayData.games ?? [];
        setLineups(
          games.map((g: any) => ({
            homeTeam: g.homeTeam?.abbreviation ?? '?',
            awayTeam: g.awayTeam?.abbreviation ?? '?',
            homeLineup: g.homeLineup ?? [],
            awayLineup: g.awayLineup ?? [],
          })),
        );
      }

      if (rawRes.ok) {
        const rawData = await rawRes.json();
        setRawStructure(rawData.players ?? []);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  }

  // Find MLB lineup entry for a roster player by matching team + name
  function findLineupEntry(player: RosterPlayer): LineupPlayer | null {
    if (!lineups) return null;
    const teamAbbr = player.editorial_team_abbr.toUpperCase();
    for (const game of lineups) {
      const isHome = game.homeTeam.toUpperCase() === teamAbbr;
      const isAway = game.awayTeam.toUpperCase() === teamAbbr;
      if (!isHome && !isAway) continue;
      const lineup = isHome ? game.homeLineup : game.awayLineup;
      const match = lineup.find(
        lp => lp.fullName.toLowerCase().includes(player.name.split(' ').pop()!.toLowerCase()),
      );
      if (match) return match;
    }
    return null;
  }

  const batters = roster?.filter(
    p => !['SP', 'RP', 'P'].some(pos => p.eligible_positions.includes(pos)),
  );

  return (
    <div className="bg-surface rounded-lg border border-border p-4">
      <Heading as="h2" className="mb-3">Roster &amp; Lineup Debug</Heading>

      <div className="flex items-end gap-3 mb-4">
        <div>
          <label className="block text-xs text-muted-foreground mb-1">Date</label>
          <input
            type="date"
            value={date}
            onChange={e => setDate(e.target.value)}
            className="px-2 py-1.5 text-sm rounded border border-border bg-background text-foreground"
          />
        </div>
        <button
          onClick={run}
          disabled={loading}
          className="px-4 py-1.5 text-sm font-semibold rounded bg-accent text-white hover:bg-accent/90 disabled:opacity-50"
        >
          {loading ? 'Loading…' : 'Fetch'}
        </button>
        {roster && (
          <CopyButton data={{ teamKey, date, roster, lineups }} />
        )}
      </div>

      {error && (
        <div className="bg-error/10 border border-error/30 rounded p-3 mb-4">
          <p className="text-sm text-error">{error}</p>
        </div>
      )}

      {batters && (
        <>
          <div className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-2">
            Batters ({batters.length})
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm border border-border rounded">
              <thead className="bg-surface-muted">
                <tr>
                  <th className="px-2 py-1.5 text-left text-xs font-medium text-muted-foreground">Name</th>
                  <th className="px-2 py-1.5 text-left text-xs font-medium text-muted-foreground">Team</th>
                  <th className="px-2 py-1.5 text-left text-xs font-medium text-muted-foreground">Pos</th>
                  <th className="px-2 py-1.5 text-left text-xs font-medium text-muted-foreground">Slot</th>
                  <th className="px-2 py-1.5 text-left text-xs font-medium text-muted-foreground">Yahoo Status</th>
                  <th className="px-2 py-1.5 text-left text-xs font-medium text-muted-foreground">Yahoo starting_status</th>
                  <th className="px-2 py-1.5 text-left text-xs font-medium text-muted-foreground">Yahoo Bat Order</th>
                  <th className="px-2 py-1.5 text-left text-xs font-medium text-muted-foreground">Editable</th>
                  <th className="px-2 py-1.5 text-left text-xs font-medium text-muted-foreground">MLB Lineup</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {batters.map(p => {
                  const mlbEntry = findLineupEntry(p);
                  const sitting = p.starting_status === 'NS';
                  const inMLBLineup = !!mlbEntry;
                  return (
                    <tr
                      key={p.player_key}
                      className={sitting ? 'bg-error/5' : !inMLBLineup && !p.on_disabled_list ? 'bg-accent/5' : ''}
                    >
                      <td className="px-2 py-1.5 font-medium text-foreground">{p.name}</td>
                      <td className="px-2 py-1.5 text-muted-foreground">{p.editorial_team_abbr}</td>
                      <td className="px-2 py-1.5 text-muted-foreground">{p.display_position}</td>
                      <td className="px-2 py-1.5">
                        <span className={`font-mono text-xs ${p.selected_position === 'BN' ? 'text-muted-foreground' : 'text-success'}`}>
                          {p.selected_position}
                        </span>
                      </td>
                      <td className="px-2 py-1.5">
                        <span className={p.status ? 'text-error' : 'text-muted-foreground'}>
                          {p.status ?? '—'}
                        </span>
                      </td>
                      <td className="px-2 py-1.5">
                        <span className={`font-mono font-bold ${
                          p.starting_status === 'NS' ? 'text-error'
                          : p.starting_status === 'S' ? 'text-success'
                          : 'text-muted-foreground'
                        }`}>
                          {p.starting_status ?? 'undefined'}
                        </span>
                      </td>
                      <td className="px-2 py-1.5">
                        <span className={`font-mono font-bold ${p.batting_order ? 'text-foreground' : 'text-muted-foreground'}`}>
                          {p.batting_order ?? '—'}
                        </span>
                      </td>
                      <td className="px-2 py-1.5">
                        <span className={p.is_editable ? 'text-success' : 'text-error'}>
                          {p.is_editable ? 'yes' : 'no'}
                        </span>
                      </td>
                      <td className="px-2 py-1.5">
                        {mlbEntry ? (
                          <span className="text-success font-mono text-xs">
                            #{mlbEntry.battingOrder} {mlbEntry.position}
                          </span>
                        ) : p.on_disabled_list ? (
                          <span className="text-error text-xs">IL</span>
                        ) : (
                          <span className="text-muted-foreground text-xs">not in lineup</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}

      {rawStructure && rawStructure.length > 0 && (
        <div className="mt-6">
          <div className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-2">
            Raw Yahoo Player Structure (first {rawStructure.length} players)
          </div>
          <p className="text-xs text-muted-foreground mb-3">
            Looking for <code className="bg-surface-muted px-1 rounded">starting_status</code> in
            the sibling objects. Each player&apos;s array elements are shown below.
          </p>
          {rawStructure.map((player: any, pi: number) => (
            <div key={pi} className="mb-4 border border-border rounded-lg overflow-hidden">
              <div className="bg-surface-muted px-3 py-1.5 text-sm font-medium text-foreground">
                {player.name} — {player.element_count} elements in array
              </div>
              <div className="p-3 space-y-2">
                {player.elements?.map((el: any, ei: number) => {
                  const hasStartingStatus = el.type === 'object' && el.content &&
                    JSON.stringify(el.content).includes('starting_status');
                  return (
                    <div
                      key={ei}
                      className={`text-xs font-mono rounded p-2 ${
                        hasStartingStatus ? 'bg-success/10 border border-success/30' : 'bg-background border border-border-muted'
                      }`}
                    >
                      <span className="text-muted-foreground">[{el.index}]</span>{' '}
                      <span className="text-accent">{el.type}</span>
                      {el.type === 'props_array' && (
                        <span className="text-muted-foreground ml-2">
                          keys: {el.keys?.map((k: any) =>
                            Array.isArray(k) ? `{${k.join(',')}}` : k
                          ).join(' | ')}
                        </span>
                      )}
                      {el.type === 'object' && (
                        <pre className="mt-1 text-foreground whitespace-pre-wrap break-all max-h-40 overflow-y-auto">
                          {JSON.stringify(el.content, null, 2)}
                        </pre>
                      )}
                      {el.type !== 'props_array' && el.type !== 'object' && (
                        <span className="text-foreground ml-2">{JSON.stringify(el.value)}</span>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
