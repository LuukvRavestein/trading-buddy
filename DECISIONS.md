# Architecture Decisions

This document records key architectural decisions and their rationale.

## ADR-001: ESM Modules

**Decision**: Use ES Modules (`"type": "module"`) instead of CommonJS.

**Rationale**:
- Modern JavaScript standard
- Better tree-shaking and static analysis
- Native async/await support
- Future-proof

**Trade-offs**:
- Config files must use `.cjs` extension (next.config.cjs, tailwind.config.cjs)
- Some older packages may not support ESM

## ADR-002: Supabase as Single Source of Truth

**Decision**: Use Supabase for all data persistence (candles, state, trades, stats).

**Rationale**:
- Single database reduces complexity
- Built-in RLS for security
- Real-time subscriptions possible
- PostgreSQL provides robust features

**Trade-offs**:
- Vendor lock-in to Supabase
- Network latency for all DB operations

## ADR-003: Stateless Workers

**Decision**: Workers are stateless and use checkpoint-based resumption.

**Rationale**:
- Can restart without losing progress
- Horizontal scaling possible
- Resilient to crashes
- Idempotent operations

**Trade-offs**:
- Requires checkpoint logic in each worker
- Slightly more complex than stateful workers

## ADR-004: Paper Trading First

**Decision**: Always start with paper trading mode before live trading.

**Rationale**:
- Safe testing environment
- No financial risk during development
- Validate strategies before risking capital
- Same code path as live (just different execution)

**Trade-offs**:
- Paper trading may not perfectly simulate live conditions (slippage, fills)

## ADR-005: Multi-Timeframe Analysis

**Decision**: Use multiple timeframes (1m, 5m, 15m, 60m) for trend alignment.

**Rationale**:
- Higher timeframes provide trend context
- Lower timeframes provide entry precision
- Reduces false signals
- Industry best practice

**Trade-offs**:
- More complex state management
- Requires more candles in database

## ADR-006: Next.js App Router for Dashboard

**Decision**: Use Next.js 14 App Router for the dashboard frontend.

**Rationale**:
- Server components for efficient data fetching
- Built-in routing and layouts
- Vercel deployment optimized
- TypeScript support

**Trade-offs**:
- Learning curve for App Router
- Some libraries not yet compatible

## ADR-007: SQL Views for Dashboard

**Decision**: Use SQL views (`v_run_overview`, `v_strategy_performance`, etc.) instead of client-side joins.

**Rationale**:
- Performance (computed in database)
- Reusable across different clients
- Single source of truth for aggregations
- Easier to maintain

**Trade-offs**:
- Views must be kept in sync with schema changes
- Less flexible than client-side queries
