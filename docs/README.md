# MLBoss Documentation Index

This index is the single authoritative table of contents for all Markdown docs in the project. Each entry has a one-sentence description; avoid duplicating content across files.

- **product-spec.md** — Product vision, key features, and high-level architecture.
- **design-system.md** — Color palette, typography, and UI component standards.
- **setup.md** — Environment variables and Yahoo OAuth configuration.
- **for-ai-developers.md** — Guidelines and navigation tips for LLM contributors.
- **yahoo-api-reference.md** — Comprehensive Yahoo Fantasy Sports API guide.
- **mlb-api-reference.md** — MLB Stats API guide: hydrate params, splits, early-season gap, disambiguation.
- **dashboard-components.md** — Component-based dashboard architecture and integration guide.
- **streaming-page.md** — Streaming board architecture: multi-day probables, data pipeline, pills, composite score, matching.
- **ui-patterns.md** — Shared UI components, display patterns, and anti-patterns for LLM contributors.

Data layer:

- **data-architecture.md** — Three-layer model, fetch + cache contract, identity contract, full Yahoo API reference.
- **scoring-conventions.md** — Stat levels (raw / rate / talent / matchup-adjusted), calibration knobs, one-source-of-truth rule.
- **stats.md** — Canonical `stat_id` model, stat enrichment, and disambiguation patterns.
- **recommendation-system.md** — Matchup-state layer: `analyzeMatchup` as single source of truth, focus suggestions, Boss Brief, leverage bar.
- **unified-rating-model.md** — Canonical reference for both pitcher AND batter rating engines: shared substrate (talent primitives, parkAdjustment, weather, focus map), unified `Rating` shape, `MatchupContext`, edge-case helpers, calibration anchors.
- **pitcher-evaluation.md** — Pitcher-side three-layer engine (PitcherTalent → GameForecast → PitcherRating), regime-shift probe, confidence model. Companion to unified-rating-model.md.

---

➜ If you add a new Markdown file, register it here to keep the index up to date. 