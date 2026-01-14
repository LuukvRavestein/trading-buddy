'use client'

// Force dynamic rendering - don't prerender this page
export const dynamic = 'force-dynamic'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { RunSelector } from '@/components/RunSelector'
import { KpiCard } from '@/components/KpiCard'
import { PnlChart } from '@/components/PnlChart'
import { WeeklyPnlChart } from '@/components/WeeklyPnlChart'
import { StrategyTable } from '@/components/StrategyTable'
import { TradeReasonTable } from '@/components/TradeReasonTable'
import { HealthWarnings } from '@/components/HealthWarnings'
import { getRunOverview, getRunOverviewAll, getStrategyPerformance, getTradeReasonStats, getTradeReasonStatsAll, getPaperHealthEvents, type RunOverview, type StrategyPerformance, type TradeReasonStat, type PaperEvent } from '@/lib/queries'

export default function DashboardPage() {
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null)
  const [runOverview, setRunOverview] = useState<RunOverview | null>(null)
  const [strategies, setStrategies] = useState<StrategyPerformance[]>([])
  const [reasonStats, setReasonStats] = useState<TradeReasonStat[]>([])
  const [healthEvents, setHealthEvents] = useState<PaperEvent[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!selectedRunId) {
      setRunOverview(null)
      setStrategies([])
      setReasonStats([])
      setHealthEvents([])
      setLoading(false)
      return
    }

    async function loadData() {
      try {
        setLoading(true)
        setError(null)
        // TypeScript guard: selectedRunId is checked above, but we need to assert it's not null
        const runId = selectedRunId
        if (!runId) return
        
        if (runId === 'all') {
          const [overview, reasons, events] = await Promise.all([
            getRunOverviewAll(),
            getTradeReasonStatsAll(5),
            getPaperHealthEvents('all', 10),
          ])
          setRunOverview(overview)
          setStrategies([])
          setReasonStats(reasons)
          setHealthEvents(events)
        } else {
          const [overview, strategyData, reasons, events] = await Promise.all([
            getRunOverview(runId),
            getStrategyPerformance(runId),
            getTradeReasonStats(runId, 5),
            getPaperHealthEvents(runId, 10),
          ])
          setRunOverview(overview)
          setStrategies(strategyData)
          setReasonStats(reasons)
          setHealthEvents(events)
        }
      } catch (err) {
        console.error('Failed to load dashboard data:', err)
        setError('Failed to load dashboard data')
      } finally {
        setLoading(false)
      }
    }

    loadData()
  }, [selectedRunId])

  if (loading && selectedRunId) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-900 p-8">
        <div className="max-w-7xl mx-auto">
          <div className="text-center py-12">
            <div className="text-lg text-gray-500">Loading dashboard...</div>
          </div>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-900 p-8">
        <div className="max-w-7xl mx-auto">
          <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-4">
            <div className="text-red-800 dark:text-red-200">{error}</div>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 p-8">
      <div className="max-w-7xl mx-auto">
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-gray-900 dark:text-gray-100 mb-2">Trading Dashboard</h1>
          <div className="flex items-center justify-between">
            <RunSelector selectedRunId={selectedRunId} onRunChange={setSelectedRunId} />
            <nav className="flex gap-4">
              <Link
                href="/journal"
                className="text-sm text-blue-600 dark:text-blue-400 hover:underline"
              >
                Journal
              </Link>
            </nav>
          </div>
        </div>

        {!selectedRunId ? (
          <div className="text-center py-12">
            <div className="text-lg text-gray-500 dark:text-gray-400">Please select a run to view dashboard</div>
          </div>
        ) : runOverview ? (
          <>
            {/* KPI Cards */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4 mb-8">
              <KpiCard
                title="Total PnL"
                value={`$${runOverview.pnl_total.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
                positive={runOverview.pnl_total >= 0}
                negative={runOverview.pnl_total < 0}
              />
              <KpiCard
                title="Winrate"
                value={`${runOverview.winrate_total.toFixed(2)}%`}
                subtitle={`${runOverview.trades_total} trades`}
              />
              <KpiCard title="Total Trades" value={runOverview.trades_total} />
              <KpiCard
                title="Open Positions"
                value={runOverview.accounts_with_open_position}
                subtitle={`of ${runOverview.strategies} strategies`}
              />
              <KpiCard
                title="Max Drawdown"
                value={`${runOverview.max_drawdown_pct_worst.toFixed(2)}%`}
                negative={true}
              />
            </div>

            {/* Run Info */}
            <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6 border border-gray-200 dark:border-gray-700 mb-8">
              <h2 className="text-xl font-semibold mb-4">Run Information</h2>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                <div>
                  <div className="text-gray-500 dark:text-gray-400">Symbol</div>
                  <div className="font-medium text-gray-900 dark:text-gray-100">
                    {selectedRunId === 'all' ? 'All symbols' : runOverview.symbol}
                  </div>
                </div>
                <div>
                  <div className="text-gray-500 dark:text-gray-400">Timeframe</div>
                  <div className="font-medium text-gray-900 dark:text-gray-100">
                    {selectedRunId === 'all' ? 'All' : `${runOverview.timeframe_min}m`}
                  </div>
                </div>
                <div>
                  <div className="text-gray-500 dark:text-gray-400">Started</div>
                  <div className="font-medium text-gray-900 dark:text-gray-100">
                    {runOverview.started_at ? new Date(runOverview.started_at).toLocaleDateString() : 'n/a'}
                  </div>
                </div>
                <div>
                  <div className="text-gray-500 dark:text-gray-400">Status</div>
                  <div className="font-medium text-gray-900 dark:text-gray-100">
                    {selectedRunId === 'all' ? 'aggregate' : runOverview.status}
                  </div>
                </div>
              </div>
            </div>

            {/* Daily PnL Chart */}
            <div className="mb-8">
              <PnlChart runId={selectedRunId} />
            </div>

            {/* Weekly PnL Chart */}
            <div className="mb-8">
              <WeeklyPnlChart runId={selectedRunId} />
            </div>

            {/* Strategy Performance Table */}
            {selectedRunId !== 'all' && (
              <div className="mb-8">
                <h2 className="text-xl font-semibold mb-4 text-gray-900 dark:text-gray-100">Strategy Performance</h2>
                <StrategyTable strategies={strategies} runId={selectedRunId} />
              </div>
            )}

            {/* Trade Reason Stats */}
            <div className="mb-8">
              <h2 className="text-xl font-semibold mb-4 text-gray-900 dark:text-gray-100">Trade Reason Stats</h2>
              <TradeReasonTable stats={reasonStats} />
            </div>

            {/* Health Warnings */}
            <div className="mb-8">
              <h2 className="text-xl font-semibold mb-4 text-gray-900 dark:text-gray-100">Health Warnings</h2>
              <HealthWarnings events={healthEvents} />
            </div>
          </>
        ) : (
          <div className="text-center py-12">
            <div className="text-lg text-gray-500 dark:text-gray-400">Run not found</div>
          </div>
        )}
      </div>
    </div>
  )
}
