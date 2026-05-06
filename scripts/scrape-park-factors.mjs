#!/usr/bin/env node
/**
 * Pull canonical park-factor data from Baseball Savant's Statcast Park
 * Factors leaderboard. Run on an as-needed basis (preseason refresh)
 * to update `src/lib/mlb/parks.ts`. The leaderboard renders its raw
 * JSON into a `var data = [...]` block on the HTML page, which is the
 * supported way to get programmatic access — there's no public API.
 *
 * Usage:
 *   node scripts/scrape-park-factors.mjs [year] [rolling]
 *
 * Defaults match the leaderboard's current default view: year=current,
 * rolling=3 (3-year rolling ending in `year`). When refreshing for a
 * new season, pass the season as `year` — e.g. for 2026, pass 2026 and
 * you'll get the 2024-2026 window, which is what users see when they
 * open the Savant leaderboard.
 *
 * The output is a JSON object keyed by `venue_id` with every numeric
 * field the leaderboard exposes, plus `bat_l` / `bat_r` slices so we
 * can populate the per-handedness fields. Pipe to a file or jq for
 * inspection.
 */

const CURRENT_YEAR = String(new Date().getFullYear());
const YEAR = process.argv[2] ?? CURRENT_YEAR;
const ROLLING = process.argv[3] ?? '3';
const UA = 'Mozilla/5.0 (compatible; mlboss-park-scraper/1.0)';

async function fetchSlice(batSide) {
  const url = new URL('https://baseballsavant.mlb.com/leaderboard/statcast-park-factors');
  url.searchParams.set('type', 'year');
  url.searchParams.set('year', YEAR);
  url.searchParams.set('batSide', batSide);
  url.searchParams.set('stat', 'index_wOBA');
  url.searchParams.set('condition', 'All');
  url.searchParams.set('rolling', ROLLING);
  url.searchParams.set('parks', 'mlb');
  const res = await fetch(url, { headers: { 'User-Agent': UA } });
  if (!res.ok) throw new Error(`HTTP ${res.status} for batSide=${batSide || 'both'}`);
  const html = await res.text();
  const m = html.match(/var data = (\[.+?\]);/s);
  if (!m) throw new Error(`no data block for batSide=${batSide || 'both'}`);
  return JSON.parse(m[1]);
}

const NUMERIC_FIELDS = [
  'n_pa', 'index_runs', 'index_woba', 'index_hits', 'index_1b',
  'index_2b', 'index_3b', 'index_hr', 'index_bacon', 'index_obp',
  'index_so', 'index_bb', 'index_hardhit', 'index_xbacon',
];

function num(v) {
  if (v === undefined || v === null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

(async () => {
  const [both, lhb, rhb] = await Promise.all([
    fetchSlice(''),
    fetchSlice('L'),
    fetchSlice('R'),
  ]);

  const byId = new Map();
  for (const row of both) {
    const id = row.venue_id;
    const out = { venue_id: id, venue_name: row.venue_name, club: row.name_display_club };
    for (const k of NUMERIC_FIELDS) out[k] = num(row[k]);
    byId.set(id, out);
  }
  for (const row of lhb) {
    const cur = byId.get(row.venue_id);
    if (!cur) continue;
    cur.bat_l = {};
    for (const k of NUMERIC_FIELDS) cur.bat_l[k] = num(row[k]);
  }
  for (const row of rhb) {
    const cur = byId.get(row.venue_id);
    if (!cur) continue;
    cur.bat_r = {};
    for (const k of NUMERIC_FIELDS) cur.bat_r[k] = num(row[k]);
  }

  const out = {
    meta: {
      source: 'Baseball Savant Statcast Park Factors',
      year: YEAR,
      rolling: Number(ROLLING),
      pulled_at: new Date().toISOString(),
      park_count: byId.size,
    },
    parks: Array.from(byId.values()).sort((a, b) => a.venue_name.localeCompare(b.venue_name)),
  };

  console.log(JSON.stringify(out, null, 2));
})().catch(err => {
  console.error('scrape failed:', err.message);
  process.exit(1);
});
