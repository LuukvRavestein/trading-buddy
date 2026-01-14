'use client'

import type { TradeReasonStat } from '@/lib/queries'

type Props = {
  stats: TradeReasonStat[]
}

function formatNumber(value: number, decimals = 2) {
  return Number.isFinite(value)
    ? value.toLocaleString(undefined, { minimumFractionDigits: decimals, maximumFractionDigits: decimals })
    : '0'
}

export function TradeReasonTable({ stats }: Props) {
  if (!stats || stats.length === 0) {
    return (
      <div className="text-sm text-gray-500 dark:text-gray-400">
        No reason stats available yet.
      </div>
    )
  }

  const winners = [...stats]
    .filter(item => item.trades > 0)
    .sort((a, b) => b.pnl_total - a.pnl_total)
    .slice(0, 8)

  const losers = [...stats]
    .filter(item => item.trades > 0)
    .sort((a, b) => a.pnl_total - b.pnl_total)
    .slice(0, 8)

  const renderTable = (title: string, rows: TradeReasonStat[]) => (
    <div className="bg-white dark:bg-gray-800 rounded-lg shadow border border-gray-200 dark:border-gray-700">
      <div className="px-4 py-3 border-b border-gray-200 dark:border-gray-700">
        <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">{title}</h3>
      </div>
      <div className="overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead className="bg-gray-50 dark:bg-gray-700/50 text-gray-600 dark:text-gray-300">
            <tr>
              <th className="px-3 py-2 text-left">Side</th>
              <th className="px-3 py-2 text-left">Reason</th>
              <th className="px-3 py-2 text-left">Trigger</th>
              <th className="px-3 py-2 text-left">Exit</th>
              <th className="px-3 py-2 text-right">Trades</th>
              <th className="px-3 py-2 text-right">Winrate</th>
              <th className="px-3 py-2 text-right">PnL</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => (
              <tr key={`${row.entry_reason}-${row.exit_reason}-${row.side}-${index}`} className="border-t border-gray-100 dark:border-gray-700">
                <td className="px-3 py-2">{row.side}</td>
                <td className="px-3 py-2">{row.entry_reason}</td>
                <td className="px-3 py-2">{row.trigger_type}</td>
                <td className="px-3 py-2">{row.exit_reason}</td>
                <td className="px-3 py-2 text-right">{row.trades}</td>
                <td className="px-3 py-2 text-right">{formatNumber(row.winrate)}%</td>
                <td className={`px-3 py-2 text-right ${row.pnl_total >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                  {formatNumber(row.pnl_total)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )

  return (
    <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
      {renderTable('Top Winning Reasons', winners)}
      {renderTable('Top Losing Reasons', losers)}
    </div>
  )
}
