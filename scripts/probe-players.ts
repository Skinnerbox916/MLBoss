import { resolveMLBId, getPitcherSeasonLines } from '../src/lib/mlb/players';
import { computePitcherTalent } from '../src/lib/pitching/talent';
import { getPitcherSeasonRating } from '../src/lib/pitching/roster';
import { fetchStatcastPitchers } from '../src/lib/mlb/savant';

// Mocked categories for a standard league (ERA, WHIP, K, W, QS)
const mockCategories = [
  { stat_id: 26, is_pitcher_stat: true, better_is: 'lower' }, // ERA
  { stat_id: 27, is_pitcher_stat: true, better_is: 'lower' }, // WHIP
  { stat_id: 42, is_pitcher_stat: true, better_is: 'higher' }, // K
  { stat_id: 28, is_pitcher_stat: true, better_is: 'higher' }, // W
  { stat_id: 83, is_pitcher_stat: true, better_is: 'higher' }, // QS
].map(c => ({ ...c, label: '', statId: c.stat_id, betterIs: c.better_is }));

async function probe(name, team) {
  console.log(`\n--- Probing ${name} (${team}) ---`);
  const identity = await resolveMLBId(name, team);
  if (!identity) {
    console.log('Identity not found');
    return;
  }
  console.log(`MLB ID: ${identity.mlbId}`);

  const lines = await getPitcherSeasonLines(identity.mlbId, 2026);
  console.log('Current Line:', lines.current ? 'Found' : 'Null');
  console.log('Prior Line:', lines.prior ? 'Found' : 'Null');

  const savant2026 = await fetchStatcastPitchers(2026);
  const savant2025 = await fetchStatcastPitchers(2025);
  
  const talent = computePitcherTalent({
    mlbId: identity.mlbId,
    throws: identity.throws || 'R',
    currentLine: lines.current,
    priorLine: lines.prior,
    currentSavant: savant2026.get(identity.mlbId) || null,
    priorSavant: savant2025.get(identity.mlbId) || null,
  });

  console.log('Talent Vector:', {
    kPerPA: talent.kPerPA,
    bbPerPA: talent.bbPerPA,
    contactXwoba: talent.contactXwoba,
    hrPerContact: talent.hrPerContact,
    ipPerStart: talent.ipPerStart,
    source: talent.source
  });

  const rating = getPitcherSeasonRating({
    talent,
    scoredCategories: mockCategories,
    focusMap: {}
  });

  console.log('Rating:', {
    score: rating.score,
    tier: rating.tier,
    categories: rating.categories.map(c => `${c.label}: ${c.display} (norm: ${c.normalized.toFixed(2)})`)
  });
}

const players = [
  { name: 'Brent Suter', team: 'CIN' },
  { name: 'Joe Musgrove', team: 'SD' },
  { name: 'Chris Bassitt', team: 'BAL' },
  { name: 'Zach Eflin', team: 'BAL' },
  { name: 'Tyler Mahle', team: 'TEX' },
  { name: 'Colin Rea', team: 'MIL' },
  { name: 'Trevor Williams', team: 'WSH' },
  { name: 'Keegan Akin', team: 'BAL' },
  { name: 'Martin Perez', team: 'SD' },
  { name: 'Connelly Early', team: 'BOS' },
  { name: 'Bubba Chandler', team: 'PIT' },
  { name: 'Zac Gallen', team: 'AZ' },
];

(async () => {
  for (const p of players) {
    await probe(p.name, p.team);
  }
  process.exit(0);
})();
