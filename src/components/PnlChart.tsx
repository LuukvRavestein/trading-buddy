'use client'

import { useEffect, useState } from 'react'
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts'
import { getDailyPnL, type DailyPnL } from '@/lib/queries'

interface PnlChartProps {
  runId: string | null
}

export function PnlChart({ runId }: PnlChartProps) {
  const [data, setData] = useState<DailyPnL[]>([])
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
        const dailyData = await getDailyPnL(runId)
        setData(dailyData)
      } catch (error) {
        console.error('Failed to load daily PnL:', error)
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
        <h3 className="text-lg font-semibold mb-4">Daily PnL</h3>
        <div className="text-sm text-gray-500">No data available</div>
      </div>
    )
  }

  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6 border border-gray-200 dark:border-gray-700">
      <h3 className="text-lg font-semibold mb-4">Daily PnL</h3>
      <ResponsiveContainer width="100%" height={300}>
        <LineChart data={data}>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis
            dataKey="day"
            tickFormatter={(value) => new Date(value).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
          />
          <YAxis />
          <Tooltip
            labelFormatter={(value) => new Date(value).toLocaleDateString()}
            formatter={(value: number) => [`$${value.toFixed(2)}`, 'PnL']}
          />
          <Line
            type="monotone"
            dataKey="pnl_total"
            stroke="#3b82f6"
            strokeWidth={2}
            dot={{ r: 4 }}
            activeDot={{ r: 6 }}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}
