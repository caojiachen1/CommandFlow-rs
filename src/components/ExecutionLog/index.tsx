import { useExecutionStore } from '../../stores/executionStore'

interface ExecutionLogProps {
  expanded: boolean
  onToggle: () => void
}

const levelTone = {
  info: 'text-slate-500 dark:text-slate-400',
  success: 'text-emerald-600 dark:text-emerald-400 border-l-2 border-emerald-500 pl-2 bg-emerald-500/5',
  warn: 'text-amber-600 dark:text-amber-400 border-l-2 border-amber-500 pl-2 bg-amber-500/5',
  error: 'text-rose-600 dark:text-rose-400 border-l-2 border-rose-500 pl-2 bg-rose-500/5',
}

export default function ExecutionLog({ expanded, onToggle }: ExecutionLogProps) {
  const { logs, clearLogs } = useExecutionStore()

  return (
    <section className="flex flex-col border-b border-slate-200 dark:border-neutral-800">
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center justify-between p-4 hover:bg-slate-100/50 dark:hover:bg-slate-800/30 transition-colors"
      >
        <h2 className="text-[11px] font-bold uppercase tracking-widest text-slate-500 dark:text-slate-400">执行日志</h2>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              clearLogs()
            }}
            className="rounded-lg border border-slate-200 bg-white/50 px-3 py-1 text-[10px] font-bold transition-all hover:bg-white active:scale-95 dark:border-neutral-800 dark:bg-neutral-900/50 dark:hover:bg-slate-800"
          >
            清空
          </button>
          <svg
            className={`h-4 w-4 text-slate-400 transition-transform duration-200 ${expanded ? 'rotate-180' : ''}`}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <path d="M6 9l6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </div>
      </button>
      {expanded && (
        <div className="h-[280px] overflow-y-auto p-4 pt-0 scrollbar-thin scrollbar-thumb-slate-200 dark:scrollbar-thumb-slate-800">
          <div className="rounded-lg border border-slate-200 bg-white p-2 text-[11px] shadow-inner scrollbar-thin scrollbar-thumb-slate-200 dark:border-neutral-800 dark:bg-neutral-900 dark:scrollbar-thumb-slate-800">
            {logs.length === 0 && (
              <div className="flex h-full items-center justify-center text-slate-400 italic font-medium opacity-50">
                等待系统活动...
              </div>
            )}
            <div className="space-y-1.5 font-mono">
              {logs.map((log) => (
                <div key={log.id} className={`${levelTone[log.level]} rounded-md p-1.5`}>
                  <span className="mr-2 opacity-40 text-[10px]">[{new Date(log.timestamp).toLocaleTimeString()}]</span>
                  <span>{log.message}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </section>
  )
}
