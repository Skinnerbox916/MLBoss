/** Retro-capture one or more past game dates. Re-running a date REPLACES its
 *  retro rows for the sides run (they are reconstructions — see
 *  docs/forecast-verification.md#retro-rows-are-reconstructions).
 *    npx tsx scripts/retro-capture.ts 2026-08-09 [to] [pitchers|batters]
 */
import { config } from 'dotenv';
config({ path: '.env.local' });
import { retroCaptureDay, type RetroSide } from '@/lib/retro/capture';

function* dates(from: string, to: string) {
  const d = new Date(`${from}T12:00:00Z`); const end = new Date(`${to}T12:00:00Z`);
  for (; d <= end; d.setUTCDate(d.getUTCDate() + 1)) yield d.toISOString().slice(0, 10);
}
async function main() {
  const args = process.argv.slice(2);
  const sideFlag = args.find(a => a === 'pitchers' || a === 'batters');
  const sides: RetroSide[] = sideFlag === 'pitchers' ? ['pitcher'] : sideFlag === 'batters' ? ['batter'] : ['pitcher', 'batter'];
  const [from, to = from] = args.filter(a => a !== sideFlag);
  if (!from || !/^\d{4}-\d{2}-\d{2}$/.test(from)) { console.error('usage: retro-capture.ts <from> [to] [pitchers|batters]'); process.exit(2); }
  for (const day of dates(from, to)) {
    const r = await retroCaptureDay(day, sides);
    console.log(`${day}: ${r.games} games, ${r.probables} starters (${r.probablesWithTalent} with talent), ${r.lineups} full lineups → ${r.pitcherRows} retro-pitcher-start + ${r.batterRows} retro-batter-day rows written${r.staleRemoved ? `, ${r.staleRemoved} stale removed` : ''} in ${(r.ms / 1000).toFixed(0)}s`);
  }
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
