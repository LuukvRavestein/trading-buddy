'use client'

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import { KpiCard } from '@/components/KpiCard'
import { PnlChart } from '@/components/PnlChart'
import { StrategyTable } from '@/components/StrategyTable'
import { getRunOverview, getStrategyPerformance, type RunOverview, type StrategyPerformance } from '@/lib/queries'

export default function RunDetailPage() {
  const params = useParams()
  const runId = params.runId as string

  const [runOverview, setRunOverview] = useState<RunOverview | null>(null)
  const [strategies, setStrategies] = useState<StrategyPerformance[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    async function loadData() {
      try {
        setLoading(true)
        setError(null)
        const [overview, strategyData] = await Promise.all([
          getRunOverview(runId),
          getStrategyPerformance(runId),
        ])
        setRunOverview(overview)
        setStrategies(strategyData)
      } catch (err) {
        console.error('Failed to load run data:', err)
        setError('Failed to load run data')
      } finally {
        setLoading(false)
      }
    }

    if (runId) {
      loadData()
    }
  }, [runId])

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-900 p-8">
        <div className="max-w-7xl mx-auto">
          <div className="text-center py-12">
            <div className="text-lg text-gray-500">Loading run details...</div>
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

  if (!runOverview) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-900 p-8">
        <div className="max-w-7xl mx-auto">
          <div className="text-center py-12">
            <div className="text-lg text-gray-500 dark:text-gray-400">Run not found</div>
            <Link href="/dashboard" className="text-blue-600 dark:text-blue-400 hover:underline mt-4 inline-block">
              Back to Dashboard
            </Link>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 p-8">
      <div className="max-w-7xl mx-auto">
        <div className="mb-8">
          <div className="flex items-center gap-4 mb-2">
            <Link
              href="/dashboard"
              className="text-blue-600 dark:text-blue-400 hover:underline"
            >
              ← Back to Dashboard
            </Link>
          </div>
          <h1 className="text-3xl font-bold text-gray-900 dark:text-gray-100">
            Run: {runOverview.symbol} - {new Date(runOverview.started_at).toLocaleDateString()}
          </h1>
        </div>

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
              <div className="font-medium text-gray-900 dark:text-gray-100">{runOverview.symbol}</div>
            </div>
            <div>
              <div className="text-gray-500 dark:text-gray-400">Timeframe</div>
              <div className="font-medium text-gray-900 dark:text-gray-100">{runOverview.timeframe_min}m</div>
            </div>
            <div>
              <div className="text-gray-500 dark:text-gray-400">Started</div>
              <div className="font-medium text-gray-900 dark:text-gray-100">
                {new Date(runOverview.started_at).toLocaleDateString()}
              </div>
            </div>
            <div>
              <div className="text-gray-500 dark:text-gray-400">Status</div>
              <div className="font-medium text-gray-900 dark:text-gray-100">{runOverview.status}</div>
            </div>
          </div>
          {runOverview.note && (
            <div className="mt-4">
              <div className="text-gray-500 dark:text-gray-400 text-sm">Note</div>
              <div className="text-gray-900 dark:text-gray-100">{runOverview.note}</div>
            </div>
          )}
        </div>

        {/* Daily PnL Chart */}
        <div className="mb-8">
          <PnlChart runId={runId} />
        </div>

        {/* Strategy Performance Table */}
        <div className="mb-8">
          <h2 className="text-xl font-semibold mb-4 text-gray-900 dark:text-gray-100">Strategy Performance</h2>
          <StrategyTable strategies={strategies} runId={runId} />
        </div>
      </div>
    </div>
  )
}
