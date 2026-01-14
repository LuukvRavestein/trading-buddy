'use client'

import { useEffect, useState } from 'react'
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts'
import { getWeeklyPnL, getWeeklyPnLAll, type WeeklyPnL } from '@/lib/queries'

interface WeeklyPnlChartProps {
  runId: string | null
}

export function WeeklyPnlChart({ runId }: WeeklyPnlChartProps) {
  const [data, setData] = useState<WeeklyPnL[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!runId) {
      setData([])
      setLoading(false)
      return
    }

    async function loadData() {
      try {
        setLoading(true)
        const id = runId
        if (!id) return
        const weeklyData = id === 'all' ? await getWeeklyPnLAll() : await getWeeklyPnL(id)
        setData(weeklyData)
      } catch (error) {
        console.error('Failed to load weekly PnL:', error)
      } finally {
        setLoading(false)
      }
    }

    loadData()
  }, [runId])

  if (loading) {
    return (
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6 border border-gray-200 dark:border-gray-700">
        <div className="text-sm text-gray-500">Loading chart...</div>
      </div>
    )
  }

  if (!runId || data.length === 0) {
    return (
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6 border border-gray-200 dark:border-gray-700">
        <h3 className="text-lg font-semibold mb-4">Weekly PnL</h3>
        <div className="text-sm text-gray-500">No data available</div>
      </div>
    )
  }

  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6 border border-gray-200 dark:border-gray-700">
      <h3 className="text-lg font-semibold mb-4">Weekly PnL</h3>
      <ResponsiveContainer width="100%" height={300}>
        <LineChart data={data}>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis
            dataKey="week_start"
            tickFormatter={(value) => new Date(value).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
          />
          <YAxis />
          <Tooltip
            labelFormatter={(value) => `Week of ${new Date(value).toLocaleDateString()}`}
            formatter={(value: number) => [`$${value.toFixed(2)}`, 'PnL']}
          />
          <Line
            type="monotone"
            dataKey="pnl_total"
            stroke="#10b981"
            strokeWidth={2}
            dot={{ r: 4 }}
            activeDot={{ r: 6 }}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}
