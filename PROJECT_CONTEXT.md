# Project Context

## Overview

Trading Buddy is an autonomous Bitcoin daytrading bot that runs entirely in the cloud. It operates on Deribit exchange using a multi-layered architecture for market data ingestion, state analysis, strategy evaluation, risk management, and trade execution.

## Architecture

The bot consists of 5 main layers:

1. **Market Data Ingest** - Fetches OHLCV candles from Deribit API
2. **Timeframe State Builder** - Computes trend, ATR, swing points, BOS/CHoCH indicators
3. **Strategy Engine** - Generates trade signals based on multi-timeframe analysis
4. **Risk Engine** - Validates and filters trades based on risk parameters
5. **Execution Engine** - Executes paper trades or live orders

## Technology Stack

- **Runtime**: Node.js 20.x (ESM modules)
- **Database**: Supabase (PostgreSQL)
- **Exchange**: Deribit API (REST + WebSocket)
- **Frontend**: Next.js 14 (App Router), React, TypeScript, Tailwind CSS
- **Deployment**: Render (worker), Vercel (dashboard)
- **Charts**: Recharts

## Key Components

- `worker.mjs` - Main worker loop (runs on Render)
- `src/ingest/` - Market data ingestion
- `src/analysis/` - State building and analysis
- `src/strategy/` - Strategy evaluation
- `src/paper/` - Paper trading engine
- `src/backtest/` - Backtesting and optimization
- `src/app/` - Next.js dashboard (runs on Vercel)
- `supabase/migrations/` - Database schema migrations

## Modes of Operation

- **Paper Trading**: Simulated trading for strategy validation
- **Live Trading**: Real order execution on Deribit (future)
- **Backtesting**: Historical strategy optimization
- **Paper Runner**: Parallel evaluation of multiple strategy configs

## Data Flow

1. Deribit API → Candles → Supabase `candles` table
2. Candles → State Builder → `timeframe_state` table
3. State → Strategy Evaluator → `trade_proposals` table
4. Proposals → Paper Engine → `paper_trades` table
5. Results → Dashboard views → Next.js frontend

## Environment

- Cloud-only (no local dependencies)
- Designed for 24/7 operation
- Stateless workers (checkpoint-based resumption)
- Idempotent operations (safe to retry)
