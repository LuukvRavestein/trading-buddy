interface KpiCardProps {
  title: string
  value: string | number
  subtitle?: string
  positive?: boolean
  negative?: boolean
}

export function KpiCard({ title, value, subtitle, positive, negative }: KpiCardProps) {
  const valueColor = positive
    ? 'text-green-600 dark:text-green-400'
    : negative
    ? 'text-red-600 dark:text-red-400'
    : 'text-gray-900 dark:text-gray-100'

  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6 border border-gray-200 dark:border-gray-700">
      <div className="text-sm font-medium text-gray-500 dark:text-gray-400">{title}</div>
      <div className={`mt-2 text-3xl font-bold ${valueColor}`}>
        {typeof value === 'number' ? value.toLocaleString() : value}
      </div>
      {subtitle && (
        <div className="mt-1 text-xs text-gray-500 dark:text-gray-400">{subtitle}</div>
      )}
    </div>
  )
}
