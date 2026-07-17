## MLBoss Documentation Index

This index is the single authoritative table of contents for all Markdown docs in the project. Each entry has a one-sentence description; avoid duplicating content across files. **Load this first if you're new to the project.**

### Read me first

- **[engines.md](./engines.md)** — Index of every prediction / suggestion engine, organized by layer (L1 talent → L7 narrative). Start here to orient.
- **[architecture.md](./architecture.md)** — The constitution: principles, anti-patterns, rules for adding engines / docs / calibration constants. Read once when you join the project.
- **[history.md](./history.md)** — Decision log. Patterns we tried and stopped, with reasons.

### Per-layer engine reference

- **[unified-rating-model.md](./unified-rating-model.md)** — L1 + L2 + L3: talent, forecast, rating. Both batter and pitcher engines, shared substrate, regime probe, calibration anchors.
- **[projection.md](./projection.md)** — L4: team projection, lineup optimizer, slot-aware streaming. Aggregation of per-game ratings.
- **[recommendation-system.md](./recommendation-system.md)** — L5 + L7: `analyzeMatchup`, focus suggestions, Boss Brief, UI surface map. The bridge between rating and roster decisions.
- **[roster-strategy.md](./roster-strategy.md)** — L6: league forecast, forward focus (anchors / swings / concedes), swap strategy. Long-horizon roster construction.

### Cross-cutting concepts

- **[stat-levels.md](./stat-levels.md)** — The four stat levels (raw counting / raw rate / regressed talent / matchup-adjusted) and common pitfalls.
- **[league-baselines.md](./league-baselines.md)** — Cross-engine league-mean constants (`LEAGUE_K_RATE`, `LEAGUE_OPS`, etc.).
- **[points-leagues.md](./points-leagues.md)** — Points-league engine layer (rate vectors, values, VOR, moves) and the points roster page.
- **[data-architecture.md](./data-architecture.md)** — Source / model / compose layering, the three storage legs (Redis cache / obs / Postgres ledger), cache tier discipline, identity contract.
- **[forecast-verification.md](./forecast-verification.md)** — The forecast ledger and scorecard: snapshotting engine predictions, grading them against actual MLB results, model-version discipline. Operator-only, never feeds back into engines.
- **[stats.md](./stats.md)** — Canonical `stat_id` model, stat enrichment, disambiguation patterns.

### UI and page-specific

- **[design-system.md](./design-system.md)** — Color palette, typography, UI component standards.
- **[ui-patterns.md](./ui-patterns.md)** — Shared UI components, display patterns, anti-patterns.
- **[dashboard-components.md](./dashboard-components.md)** — Dashboard card architecture.
- **[streaming-page.md](./streaming-page.md)** — Streaming-page specifics: pickup window, Yahoo pagination, FA matching, Game Plan card.

### API references and setup

- **[product-spec.md](./product-spec.md)** — Product vision, key features, high-level architecture.
- **[setup.md](./setup.md)** — Environment variables and Yahoo OAuth configuration.
- **[yahoo-api-reference.md](./yahoo-api-reference.md)** — Yahoo Fantasy Sports API guide.
- **[mlb-api-reference.md](./mlb-api-reference.md)** — MLB Stats API guide: hydrate params, splits, early-season gap, disambiguation.

### In-flight migrations and proposals

- **[pivotality-migration.md](./pivotality-migration.md)** — Retiring chase/hold/punt as the weight driver; replacing with continuous `pivotality(distance)` + concede/contest. Phases 1-5 shipped for the matchup pages; the L6 roster half of Phase 6 shipped 2026-07 with the roster-value rebuild (leverage-weighted player values — see [roster-strategy.md](./roster-strategy.md) and history.md). Remaining: the L5-side `Focus`-union cleanup sweep (rating-engine bridge, `analyzeMatchup` suggestFocus, streaming-board props, bossBrief reads).

---

➜ **If you add a new doc**, register it here and read [architecture.md](./architecture.md#rules-for-adding-a-new-doc) first.
➜ **If you delete or restructure**, add a [history.md](./history.md) entry.
