/**
 * Stamped onto every forecast snapshot so the scorecard can segment
 * before/after model changes instead of blurring them into one average.
 *
 * Bump this (new date string) whenever a change alters what the engines
 * predict: calibration constants, league means, prior strengths, new
 * modifiers, engine math. UI-only and data-plumbing changes don't bump.
 * See docs/forecast-verification.md#model-versions.
 */
export const MODEL_VERSION = '2026.07.17';
