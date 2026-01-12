'use client'

import { useEffect, useState } from 'react'
import { getRunOverviews, type RunOverview } from '@/lib/queries'

interface RunSelectorProps {
  selectedRunId: string | null
  onRunChange: (runId: string | null) => void
}

export function RunSelector({ selectedRunId, onRunChange }: RunSelectorProps) {
  const [runs, setRuns] = useState<RunOverview[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function loadRuns() {
      try {
        const data = await getRunOverviews()
        setRuns(data)
        if (data.length > 0 && !selectedRunId) {
          onRunChange(data[0].run_id)
        }
      } catch (error) {
        console.error('Failed to load runs:', error)
      } finally {
        setLoading(false)
      }
    }
    loadRuns()
  }, [selectedRunId, onRunChange])

  if (loading) {
    return <div className="text-sm text-gray-500">Loading runs...</div>
  }

  return (
    <div className="flex items-center gap-2">
      <label htmlFor="run-select" className="text-sm font-medium text-gray-700 dark:text-gray-300">
        Run:
      </label>
      <select
        id="run-select"
        value={selectedRunId || ''}
        onChange={(e) => onRunChange(e.target.value || null)}
        className="px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
      >
        <option value="">Select a run</option>
        {runs.map((run) => (
          <option key={run.run_id} value={run.run_id}>
            {run.symbol} - {new Date(run.started_at).toLocaleDateString()} ({run.status})
          </option>
        ))}
      </select>
    </div>
  )
}
