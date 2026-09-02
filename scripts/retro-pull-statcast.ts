/**
 * Pull one (or a range of) game date(s) of raw Statcast pitch events into
 * `statcast_events`, then reconcile each game's PA/K/BB/HR/H against the MLB
 * box score. Uses the app's own Drizzle client (DATABASE_URL from .env.local).
 *
 *   npx tsx scripts/retro-pull-statcast.ts 2026-08-09
 *   npx tsx scripts/retro-pull-statcast.ts 2026-08-01 2026-08-09
 */
import { config } from 'dotenv';
config({ path: '.env.local' });

import { pullStatcastDay, eventGameTotals } from '@/lib/retro/statcast';

const PACE_MS = 3000; // be polite to Savant on multi-day pulls

function* dates(from: string, to: string) {
  const d = new Date(`${from}T12:00:00Z`);
  const end = new Date(`${to}T12:00:00Z`);
  for (; d <= end; d.setUTCDate(d.getUTCDate() + 1)) yield d.toISOString().slice(0, 10);
}

async function boxscoreTotals(gameDate: string) {
  const sched = await fetch(`https://statsapi.mlb.com/api/v1/schedule?sportId=1&date=${gameDate}&gameType=R`).then(r => r.json());
  // Postponed / cancelled entries stay on the schedule for their original date
  // with no pitches; Savant has nothing for them, so don't report them as gaps.
  const pks: number[] = (sched.dates ?? []).flatMap((d: { games: { gamePk: number; status: { detailedState: string } }[] }) =>
    d.games.filter(g => !/Postponed|Cancelled|Suspended/.test(g.status.detailedState)).map(g => g.gamePk));
  const out = new Map<number, { pa: number; k: number; bb: number; hr: number; h: number }>();
  for (const pk of pks) {
    const box = await fetch(`https://statsapi.mlb.com/api/v1/game/${pk}/boxscore`).then(r => r.json());
    const sum = (k: string) => Number(box.teams.home.teamStats.batting[k] ?? 0) + Number(box.teams.away.teamStats.batting[k] ?? 0);
    out.set(pk, { pa: sum('plateAppearances'), k: sum('strikeOuts'), bb: sum('baseOnBalls') + sum('intentionalWalks') * 0, hr: sum('homeRuns'), h: sum('hits') });
  }
  return out;
}

async function main() {
  const [from, to = from] = process.argv.slice(2);
  if (!from) { console.error('usage: retro-pull-statcast.ts <from> [to]'); process.exit(2); }
  for (const day of dates(from, to)) {
    const t0 = Date.now();
    const res = await pullStatcastDay(day);
    console.log(`${day}: ${(res.csvBytes / 1e6).toFixed(1)} MB, ${res.parsedRows} pitches parsed, ${res.inserted} upserted (${res.skipped} skipped), ${res.games} games, ${res.plateAppearances} PA — ${((Date.now() - t0) / 1000).toFixed(1)}s`);
    const ours = await eventGameTotals(day);
    const box = await boxscoreTotals(day);
    let mism = 0;
    for (const g of ours) {
      const b = box.get(g.gamePk);
      if (!b) { console.log(`   ${g.gamePk}: no MLB box score`); mism++; continue; }
      const diffs = (['pa', 'k', 'bb', 'hr', 'h'] as const).filter(k => g[k] !== b[k]).map(k => `${k} ${g[k]}/${b[k]}`);
      if (diffs.length) { mism++; console.log(`   ${g.gamePk}: ${diffs.join(', ')}  (events/boxscore)`); }
    }
    const missingGames = [...box.keys()].filter(pk => !ours.some(g => g.gamePk === pk));
    console.log(`   reconciled ${ours.length} games vs MLB box scores: ${ours.length - mism} exact, ${mism} with diffs${missingGames.length ? `, ${missingGames.length} MLB games absent from Savant: ${missingGames.join(',')}` : ''}`);
    if (to !== from) await new Promise(r => setTimeout(r, PACE_MS));
  }
  process.exit(0);
}
main().catch(err => { console.error(err); process.exit(1); });
