'use client'

import { useState, useEffect } from 'react'
import { RunSelector } from '@/components/RunSelector'
import { JournalTable } from '@/components/JournalTable'
import { getPaperJournal, getRunOverviews, type PaperJournal, type RunOverview } from '@/lib/queries'

export default function JournalPage() {
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null)
  const [configRank, setConfigRank] = useState<string>('')
  const [startDate, setStartDate] = useState<string>('')
  const [endDate, setEndDate] = useState<string>('')
  const [trades, setTrades] = useState<PaperJournal[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [selectedTrade, setSelectedTrade] = useState<PaperJournal | null>(null)

  const pageSize = 50

  useEffect(() => {
    loadTrades()
  }, [selectedRunId, configRank, startDate, endDate, page])

  async function loadTrades() {
    if (!selectedRunId) {
      setTrades([])
      setTotal(0)
      return
    }

    try {
      setLoading(true)
      setError(null)
      // TypeScript guard: selectedRunId is checked above
      const runId = selectedRunId
      if (!runId) return
      
      const result = await getPaperJournal({
        runId: runId,
        configRank: configRank ? parseInt(configRank, 10) : undefined,
        limit: pageSize,
        offset: (page - 1) * pageSize,
        startDate: startDate || undefined,
        endDate: endDate || undefined,
      })
      setTrades(result.data)
      setTotal(result.total)
    } catch (err) {
      console.error('Failed to load trades:', err)
      setError('Failed to load trades')
    } finally {
      setLoading(false)
    }
  }

  const handleFilterChange = () => {
    setPage(1) // Reset to first page when filters change
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 p-8">
      <div className="max-w-7xl mx-auto">
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-gray-900 dark:text-gray-100 mb-4">Trading Journal</h1>
          
          {/* Filters */}
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6 border border-gray-200 dark:border-gray-700 mb-6">
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  Run (required)
                </label>
                <RunSelector selectedRunId={selectedRunId} onRunChange={(id) => { setSelectedRunId(id); handleFilterChange(); }} />
              </div>
              <div>
                <label htmlFor="config-rank" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  Strategy Rank (optional)
                </label>
                <input
                  id="config-rank"
                  type="number"
                  value={configRank}
                  onChange={(e) => { setConfigRank(e.target.value); handleFilterChange(); }}
                  placeholder="Filter by rank"
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <label htmlFor="start-date" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  Start Date (optional)
                </label>
                <input
                  id="start-date"
                  type="date"
                  value={startDate}
                  onChange={(e) => { setStartDate(e.target.value); handleFilterChange(); }}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <label htmlFor="end-date" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  End Date (optional)
                </label>
                <input
                  id="end-date"
                  type="date"
                  value={endDate}
                  onChange={(e) => { setEndDate(e.target.value); handleFilterChange(); }}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
            </div>
          </div>
        </div>

        {error && (
          <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-4 mb-6">
            <div className="text-red-800 dark:text-red-200">{error}</div>
          </div>
        )}

        {!selectedRunId ? (
          <div className="text-center py-12">
            <div className="text-lg text-gray-500 dark:text-gray-400">Please select a run to view trades</div>
          </div>
        ) : loading ? (
          <div className="text-center py-12">
            <div className="text-lg text-gray-500">Loading trades...</div>
          </div>
        ) : (
          <JournalTable
            trades={trades}
            total={total}
            page={page}
            pageSize={pageSize}
            onPageChange={setPage}
            onTradeClick={setSelectedTrade}
          />
        )}

        {/* Trade Detail Modal/Drawer */}
        {selectedTrade && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4" onClick={() => setSelectedTrade(null)}>
            <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
              <div className="p-6">
                <div className="flex justify-between items-center mb-4">
                  <h2 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Trade Details</h2>
                  <button
                    onClick={() => setSelectedTrade(null)}
                    className="text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
                  >
                    ✕
                  </button>
                </div>
                <div className="space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <div className="text-sm text-gray-500 dark:text-gray-400">Trade ID</div>
                      <div className="font-mono text-sm text-gray-900 dark:text-gray-100">{selectedTrade.trade_id}</div>
                    </div>
                    <div>
                      <div className="text-sm text-gray-500 dark:text-gray-400">Strategy Rank</div>
                      <div className="text-gray-900 dark:text-gray-100">{selectedTrade.config_rank >= 0 ? selectedTrade.config_rank : '-'}</div>
                    </div>
                    <div>
                      <div className="text-sm text-gray-500 dark:text-gray-400">Side</div>
                      <div className="text-gray-900 dark:text-gray-100">{selectedTrade.side.toUpperCase()}</div>
                    </div>
                    <div>
                      <div className="text-sm text-gray-500 dark:text-gray-400">Quantity</div>
                      <div className="text-gray-900 dark:text-gray-100">{selectedTrade.qty}</div>
                    </div>
                    <div>
                      <div className="text-sm text-gray-500 dark:text-gray-400">Entry Price</div>
                      <div className="text-gray-900 dark:text-gray-100">${selectedTrade.entry_px.toLocaleString()}</div>
                    </div>
                    <div>
                      <div className="text-sm text-gray-500 dark:text-gray-400">Exit Price</div>
                      <div className="text-gray-900 dark:text-gray-100">
                        {selectedTrade.exit_px ? `$${selectedTrade.exit_px.toLocaleString()}` : '-'}
                      </div>
                    </div>
                    <div>
                      <div className="text-sm text-gray-500 dark:text-gray-400">Entry Time</div>
                      <div className="text-gray-900 dark:text-gray-100">
                        {new Date(selectedTrade.entry_ts).toLocaleString()}
                      </div>
                    </div>
                    <div>
                      <div className="text-sm text-gray-500 dark:text-gray-400">Exit Time</div>
                      <div className="text-gray-900 dark:text-gray-100">
                        {selectedTrade.exit_ts ? new Date(selectedTrade.exit_ts).toLocaleString() : 'Open'}
                      </div>
                    </div>
                    <div>
                      <div className="text-sm text-gray-500 dark:text-gray-400">PnL</div>
                      <div className={`font-semibold ${
                        selectedTrade.pnl && selectedTrade.pnl >= 0
                          ? 'text-green-600 dark:text-green-400'
                          : selectedTrade.pnl && selectedTrade.pnl < 0
                          ? 'text-red-600 dark:text-red-400'
                          : 'text-gray-500 dark:text-gray-400'
                      }`}>
                        {selectedTrade.pnl !== null ? `$${selectedTrade.pnl.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '-'}
                      </div>
                    </div>
                    <div>
                      <div className="text-sm text-gray-500 dark:text-gray-400">PnL %</div>
                      <div className="text-gray-900 dark:text-gray-100">
                        {selectedTrade.pnl_pct !== null ? `${selectedTrade.pnl_pct.toFixed(2)}%` : '-'}
                      </div>
                    </div>
                    <div>
                      <div className="text-sm text-gray-500 dark:text-gray-400">Fees</div>
                      <div className="text-gray-900 dark:text-gray-100">
                        {selectedTrade.fees !== null ? `$${selectedTrade.fees.toLocaleString()}` : '-'}
                      </div>
                    </div>
                    <div>
                      <div className="text-sm text-gray-500 dark:text-gray-400">Duration</div>
                      <div className="text-gray-900 dark:text-gray-100">
                        {selectedTrade.duration_seconds !== null
                          ? `${Math.floor(selectedTrade.duration_seconds / 3600)}h ${Math.floor((selectedTrade.duration_seconds % 3600) / 60)}m`
                          : '-'}
                      </div>
                    </div>
                    <div>
                      <div className="text-sm text-gray-500 dark:text-gray-400">Outcome</div>
                      <div className="text-gray-900 dark:text-gray-100">
                        {selectedTrade.outcome ? selectedTrade.outcome.toUpperCase() : 'OPEN'}
                      </div>
                    </div>
                    {selectedTrade.sl && (
                      <div>
                        <div className="text-sm text-gray-500 dark:text-gray-400">Stop Loss</div>
                        <div className="text-gray-900 dark:text-gray-100">${selectedTrade.sl.toLocaleString()}</div>
                      </div>
                    )}
                    {selectedTrade.tp && (
                      <div>
                        <div className="text-sm text-gray-500 dark:text-gray-400">Take Profit</div>
                        <div className="text-gray-900 dark:text-gray-100">${selectedTrade.tp.toLocaleString()}</div>
                      </div>
                    )}
                  </div>
                  {selectedTrade.meta && (
                    <div>
                      <div className="text-sm text-gray-500 dark:text-gray-400 mb-2">Metadata</div>
                      <pre className="bg-gray-50 dark:bg-gray-900 p-4 rounded text-xs overflow-x-auto">
                        {JSON.stringify(selectedTrade.meta, null, 2)}
                      </pre>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
