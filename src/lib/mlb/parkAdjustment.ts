/**
 * Canonical park-factor primitive.
 *
 * Single source of truth for "given this park (+ optional batter hand,
 * stat, and weather), what multiplier should the rating apply?". Both
 * the lineup side (`batterRating`) and the streaming/pitcher side
 * (`forecast`) drink from this primitive — there is no second
 * implementation, no inline clamp, and no per-call hand-of-blending
 * logic in feature code.
 *
 * Contract:
 *   - Returns 1.0 (neutral, available: false) for null/missing parks.
 *   - Returns a per-stat multiplier when `statId` is provided.
 *   - Returns a composite multiplier when `statId` is omitted. The
 *     composite is what the pitcher rating wraps around its score.
 *   - Hand resolution: 'L' picks the L-side field, 'R' picks the R-side
 *     field. Switch hitters ('S') always bat opposite the pitcher's
 *     throwing hand — when `pitcherThrows` is provided we resolve to
 *     that side, otherwise we conservatively fall back to overall.
 *     Omitted/unknown hand returns the overall fallback.
 *   - Wind interaction: only fires when `park.windSensitivity === 'high'`,
 *     `weather.windSpeed >= 10`, and the wind direction is parallel to
 *     home plate (out/in). Adds a ±5% bump on HR / 2B / R / RBI; other
 *     stats are wind-independent here (the per-game weather multiplier
 *     in `getWeatherScore` carries the rest).
 *   - Composite (pitcher-side) uses overall `parkFactor` only — the HR
 *     effect is already amplified at the per-PA HR rate (see
 *     `forecast.ts`'s line that scales `expectedPerGame.hr` by the HR
 *     track) and rolls into the ERA / WHIP / W sub-scores. Multiplying
 *     the composite by an HR-derived multiplier on top would
 *     double-count.
 *
 * Adding a new park-factor field (e.g. SB) means extending this file
 * only — feature code never reads `ParkData` directly for math.
 */

import type { ParkData, GameWeather } from './types';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type BatterHand = 'L' | 'R' | 'S' | null | undefined;
export type PitcherHand = 'L' | 'R' | 'S' | null | undefined;

export interface ParkAdjustmentInput {
  park: ParkData | null;
  /** Yahoo stat_id. Omit for the composite (pitcher rating) multiplier. */
  statId?: number;
  batterHand?: BatterHand;
  /** Opposing pitcher's throwing hand. Used to resolve switch-hitters
   *  ('S') to the side they'll actually bat from (opposite of pitcher).
   *  Optional — when missing, switch hitters fall back to the overall
   *  factor. NOT used for L/R hitters. */
  pitcherThrows?: PitcherHand;
  weather?: GameWeather | null;
}

export interface ParkAdjustment {
  /** 1.0 = neutral. Already clamped to the per-stat band. */
  multiplier: number;
  /** Short human-readable hint for the waterfall row (e.g. "HR+ (128 vs L)",
   *  "CHC 15mph out"). Empty when neutral / unavailable. */
  hint: string;
  /** Was park data actually available? Consumers can use this to skip
   *  the multiplier slot in a UI when there's nothing to show. */
  available: boolean;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function clamp(x: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, x));
}

const NEUTRAL: ParkAdjustment = {
  multiplier: 1.0,
  hint: '',
  available: false,
};

/**
 * Resolve the effective batter hand for park-factor lookup. Switch
 * hitters always bat opposite the pitcher — so an 'S' hitter facing a
 * RHP plays as 'L', and facing a LHP plays as 'R'. When the pitcher's
 * throwing hand is unknown, switch hitters resolve to `null` (caller's
 * fallback path — typically the overall factor).
 *
 * `'S'` pitchers (extremely rare; Pat Venditte) flow through as
 * unresolvable since we don't know which hand they'll choose for this
 * matchup. `null` covers that.
 */
function resolveBatterHand(
  hand: BatterHand,
  pitcherThrows: PitcherHand,
): 'L' | 'R' | null {
  if (hand === 'L' || hand === 'R') return hand;
  if (hand !== 'S') return null;
  if (pitcherThrows === 'L') return 'R';
  if (pitcherThrows === 'R') return 'L';
  return null; // unknown SP (or switch-pitcher) → fall back to overall
}

/**
 * Pick a hand-aware base value. The actual fields used depend on which
 * "track" the caller is on (overall lean for AVG/R/RBI, HR-specific for
 * HR/12).
 *
 * Defensively treats missing / non-finite factor fields as neutral (100).
 * The ParkData type declares all factors as required `number`, but in
 * practice the parks.ts table is hand-maintained and a new field added
 * to the type can lag behind the data — when that happens we want a
 * neutral pass-through, not NaN propagating through the rating.
 */
function pickHanded(
  resolvedHand: 'L' | 'R' | null,
  lValue: number,
  rValue: number,
  fallback: number,
): { value: number; resolvedHand: 'L' | 'R' | null } {
  if (resolvedHand === 'L') return { value: finiteOr100(lValue, fallback), resolvedHand };
  if (resolvedHand === 'R') return { value: finiteOr100(rValue, fallback), resolvedHand };
  return { value: finiteOr100(fallback, 100), resolvedHand: null };
}

/** Return `primary` if finite, else `secondary` if finite, else 100. */
function finiteOr100(primary: number, secondary: number): number {
  if (Number.isFinite(primary)) return primary;
  if (Number.isFinite(secondary)) return secondary;
  return 100;
}

/**
 * Wind direction parsing. Returns +1 when the wind helps offense
 * (out to CF / out to LF / out to RF), -1 when it suppresses (in from
 * any direction), 0 otherwise.
 */
function windOffenseDirection(direction: string | null): number {
  if (!direction) return 0;
  const dir = direction.toLowerCase();
  if (dir.includes('out')) return 1;
  if (dir.includes('in')) return -1;
  return 0;
}

/**
 * Wind multiplier ON TOP of the static park factor — only applies in
 * wind-sensitive parks (Wrigley, Oracle, Sutter Health). Adds ±5% at
 * the saturating end (≥ 25 mph), scaling linearly from 10 mph.
 *
 * We deliberately keep this small and parallel to `getWeatherScore`'s
 * own multiplier in `analysis.ts` — `getWeatherScore` already moves
 * the weather slot in the rating, so this primitive only adds the
 * park-amplified excess on the affected stats.
 */
function windAmplification(
  park: ParkData,
  weather: GameWeather | null | undefined,
): { delta: number; hint: string } {
  if (park.windSensitivity !== 'high') return { delta: 0, hint: '' };
  if (!weather || weather.windSpeed == null) return { delta: 0, hint: '' };
  if (weather.windSpeed < 10) return { delta: 0, hint: '' };
  const dir = windOffenseDirection(weather.windDirection);
  if (dir === 0) return { delta: 0, hint: '' };
  // 10 mph → ±0.02, 25+ mph → ±0.05. Linear in between.
  const magnitude = clamp((weather.windSpeed - 5) / 100, 0.02, 0.05);
  const direction = dir === 1 ? 'out' : 'in';
  return {
    delta: dir * magnitude,
    hint: `${park.teamAbbr} ${weather.windSpeed}mph ${direction}`,
  };
}

/** Build the standard "PF NNN [vs L]" hint string. */
function buildHint(label: string, value: number, resolvedHand: 'L' | 'R' | null): string {
  if (Math.abs(value - 100) < 4) return ''; // neutral — nothing to surface
  const sign = value > 100 ? '+' : '−';
  const handTag = resolvedHand ? ` vs ${resolvedHand}` : '';
  return `${label}${sign} (${Math.round(value)}${handTag})`;
}

// ---------------------------------------------------------------------------
// Per-stat tracks
// ---------------------------------------------------------------------------

interface Track {
  /** Diagnostic label. */
  label: string;
  /** Choose the raw factor (0-200ish, where 100 = neutral). */
  pickFactor: (p: ParkData, hand: 'L' | 'R' | null) => { value: number; resolvedHand: 'L' | 'R' | null };
  /** Min/max for the final multiplier (factor / 100 + wind). */
  clampMin: number;
  clampMax: number;
  /** Which hint label to show on the waterfall row. */
  hintLabel: string;
  /** Does wind amplification apply to this stat? */
  windApplies: boolean;
}

/** AVG / R / RBI / H / TB — overall hitter friendliness with hand blending. */
const TRACK_OVERALL_HAND: Track = {
  label: 'overall',
  pickFactor: (p, hand) =>
    pickHanded(hand, p.parkFactorL, p.parkFactorR, p.parkFactor),
  clampMin: 0.85,
  clampMax: 1.15,
  hintLabel: 'PF',
  windApplies: false,
};

const TRACK_RUNS: Track = {
  ...TRACK_OVERALL_HAND,
  clampMin: 0.80,
  clampMax: 1.20,
  hintLabel: 'PF',
  windApplies: true,
};

const TRACK_HR: Track = {
  label: 'HR',
  pickFactor: (p, hand) =>
    pickHanded(hand, p.parkFactorHrL, p.parkFactorHrR, p.parkFactorHR),
  clampMin: 0.7,
  clampMax: 1.4,
  hintLabel: 'HR',
  windApplies: true,
};

const TRACK_2B: Track = {
  label: '2B',
  pickFactor: (p) => ({ value: p.parkFactor2B, resolvedHand: null }),
  clampMin: 0.80,
  clampMax: 1.30,
  hintLabel: '2B',
  windApplies: true,
};

const TRACK_3B: Track = {
  label: '3B',
  pickFactor: (p) => ({ value: p.parkFactor3B, resolvedHand: null }),
  clampMin: 0.70,
  clampMax: 1.40,
  hintLabel: '3B',
  windApplies: false,
};

const TRACK_BACON: Track = {
  label: 'BACON',
  pickFactor: (p) => ({ value: p.parkFactorBACON, resolvedHand: null }),
  clampMin: 0.92,
  clampMax: 1.10,
  hintLabel: 'BACON',
  windApplies: false,
};

const TRACK_BB: Track = {
  label: 'BB',
  pickFactor: (p, hand) =>
    pickHanded(hand, p.parkFactorBBL, p.parkFactorBBR, p.parkFactorBB),
  clampMin: 0.85,
  clampMax: 1.15,
  hintLabel: 'BB',
  windApplies: false,
};

const TRACK_SO: Track = {
  label: 'SO',
  pickFactor: (p, hand) =>
    pickHanded(hand, p.parkFactorSOL, p.parkFactorSOR, p.parkFactorSO),
  clampMin: 0.80,
  clampMax: 1.25,
  hintLabel: 'SO',
  windApplies: false,
};

/**
 * Composite multiplier for the pitcher rating (no statId).
 *
 * Uses **overall `parkFactor` only**. The HR-park amplification is
 * already applied at the per-PA HR-rate path inside `forecast.ts`
 * (which feeds `expectedPerGame.hr` → ERA / WHIP / W sub-scores).
 * Multiplying the composite by an HR-derived factor on top would
 * double-count the HR signal — Yankee Stadium's HR boost would hit the
 * pitcher rating once via the HR-rate path AND again via the composite,
 * making the model over-react to HR-specific parks.
 *
 * Per user direction this stays bats-agnostic — pitcher-side
 * composites do not consume `parkFactorL/R`.
 */
function getCompositeAdjustment(
  park: ParkData,
  weather: GameWeather | null | undefined,
): ParkAdjustment {
  const display = Number.isFinite(park.parkFactor) ? park.parkFactor : 100;
  // Pitcher-perspective: hitter park (>100) → multiplier <1.
  const baseDelta = (100 - display) / 200;
  const wind = windAmplification(park, weather);
  // Wind helps offense (positive delta on offense tracks) → hurts pitcher
  // here, so we subtract.
  const composite = clamp(1 + baseDelta - wind.delta, 0.85, 1.15);

  let hint = '';
  if (display >= 110) hint = 'Hitter park';
  else if (display >= 105) hint = 'Lean hitter park';
  else if (display <= 90) hint = 'Pitcher park';
  else if (display <= 95) hint = 'Lean pitcher park';
  else hint = 'Neutral park';

  if (wind.hint) hint = `${hint} · ${wind.hint}`;

  return { multiplier: composite, hint, available: true };
}

// ---------------------------------------------------------------------------
// Core: getParkAdjustment
// ---------------------------------------------------------------------------

/** Yahoo stat_ids that map to a per-stat track. Stats not listed here
 *  pass through with multiplier 1.0 and `available: false` (e.g. K, BB,
 *  SB — none of which have a meaningful park signal in this system).
 *  H (8) and TB (23) share TRACK_OVERALL_HAND because both are dominated
 *  by overall hitter friendliness with the hand-skew the L/R fields
 *  capture.
 */
const STAT_ID_TO_TRACK: Record<number, Track> = {
  3: TRACK_OVERALL_HAND,  // AVG
  4: TRACK_2B,            // 2B
  5: TRACK_3B,            // 3B
  7: TRACK_RUNS,          // R
  8: TRACK_OVERALL_HAND,  // H
  12: TRACK_HR,           // HR
  13: TRACK_RUNS,         // RBI
  18: TRACK_BB,           // BB
  21: TRACK_SO,           // K
  23: TRACK_OVERALL_HAND, // TB
  // BACON is not a Yahoo stat_id but exposed via TRACK_BACON for
  // potential future consumers (e.g. xBA matchup adjustments).
};

export function getParkAdjustment(input: ParkAdjustmentInput): ParkAdjustment {
  const { park, statId, batterHand, pitcherThrows, weather } = input;
  if (!park) return NEUTRAL;

  // Composite path (pitcher rating).
  if (statId === undefined) {
    return getCompositeAdjustment(park, weather);
  }

  const track = STAT_ID_TO_TRACK[statId];
  if (!track) {
    return { ...NEUTRAL, available: true };
  }

  const resolvedHand = resolveBatterHand(batterHand, pitcherThrows);
  const { value, resolvedHand: usedHand } = track.pickFactor(park, resolvedHand);
  const wind = track.windApplies ? windAmplification(park, weather) : { delta: 0, hint: '' };
  const multiplier = clamp(value / 100 + wind.delta, track.clampMin, track.clampMax);

  // Hint: combine the static-PF hint with the wind hint, dropping empty halves.
  const staticHint = buildHint(track.hintLabel, value, usedHand);
  const hint = [staticHint, wind.hint].filter(Boolean).join(' · ');

  return { multiplier, hint, available: true };
}

// Expose BACON as a named export for future xBA/contact-quality consumers.
// Keeps the track referenced so it isn't tree-shaken away while we build
// it out, and provides a typed entry point that doesn't require callers
// to know it's not a Yahoo stat_id.
export function getBaconAdjustment(park: ParkData | null): ParkAdjustment {
  if (!park) return NEUTRAL;
  const { value } = TRACK_BACON.pickFactor(park, null);
  const multiplier = clamp(value / 100, TRACK_BACON.clampMin, TRACK_BACON.clampMax);
  const hint = buildHint(TRACK_BACON.hintLabel, value, null);
  return { multiplier, hint, available: true };
}

// ---------------------------------------------------------------------------
// Display helper for park-factor badge UIs
// ---------------------------------------------------------------------------

export interface ParkBadge {
  /** The number to render in the badge — null when no park. */
  display: number | null;
  /** Whether the displayed number is the HR-specific factor (in which
   *  case the UI typically appends " HR"). */
  isHR: boolean;
}

/**
 * Pick the badge value for the park column on a card UI. Mirrors the
 * "use whichever factor is more extreme" logic that was previously
 * duplicated between TodayPitchers and StreamingBoard. The badge is
 * independent of any specific batter — it summarises the park itself.
 *
 * NOTE: The badge intentionally still picks the more-extreme factor
 * so a HR-monster park like Yankee Stadium displays "HR 119" instead
 * of "PF 100" — that's what the user wants to see at a glance, even
 * though the math layer's composite uses overall PF only.
 */
export function formatParkBadge(park: ParkData | null): ParkBadge {
  if (!park) return { display: null, isHR: false };
  const pf = park.parkFactor;
  const pfHr = park.parkFactorHR;
  const useHR = Math.abs(pfHr - 100) > Math.abs(pf - 100);
  return {
    display: useHR ? pfHr : pf,
    isHR: useHR && pfHr !== pf,
  };
}
