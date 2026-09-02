/** Retro-capture one or more past game dates.
 *    npx tsx scripts/retro-capture.ts 2026-08-09 [to]
 */
import { config } from 'dotenv';
config({ path: '.env.local' });
import { retroCaptureDay } from '@/lib/retro/capture';

function* dates(from: string, to: string) {
  const d = new Date(`${from}T12:00:00Z`); const end = new Date(`${to}T12:00:00Z`);
  for (; d <= end; d.setUTCDate(d.getUTCDate() + 1)) yield d.toISOString().slice(0, 10);
}
async function main() {
  const [from, to = from] = process.argv.slice(2);
  if (!from) { console.error('usage: retro-capture.ts <from> [to]'); process.exit(2); }
  for (const day of dates(from, to)) {
    const r = await retroCaptureDay(day);
    console.log(`${day}: ${r.games} games, ${r.probables} starters (${r.probablesWithTalent} with talent), ${r.lineups} full lineups → ${r.pitcherRows} retro-pitcher-start + ${r.batterRows} retro-batter-day rows in ${(r.ms / 1000).toFixed(0)}s`);
  }
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
