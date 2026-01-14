'use client'

import type { PaperEvent } from '@/lib/queries'

type Props = {
  events: PaperEvent[]
}

function formatTime(ts: string) {
  return new Date(ts).toLocaleString()
}

export function HealthWarnings({ events }: Props) {
  if (!events || events.length === 0) {
    return (
      <div className="text-sm text-gray-500 dark:text-gray-400">
        No recent warnings or errors.
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {events.map((event) => (
        <div
          key={event.id}
          className="rounded-md border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/20 px-4 py-3"
        >
          <div className="flex items-center justify-between text-sm">
            <span className="font-semibold text-red-800 dark:text-red-200">{event.level.toUpperCase()}</span>
            <span className="text-red-700 dark:text-red-300">{formatTime(event.ts)}</span>
          </div>
          <div className="mt-1 text-sm text-red-900 dark:text-red-100">{event.message}</div>
        </div>
      ))}
    </div>
  )
}
