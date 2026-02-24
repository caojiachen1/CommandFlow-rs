import { useExecutionStore } from '../../stores/executionStore'

const levelTone = {
  info: 'text-slate-500 dark:text-slate-400',
  success: 'text-emerald-600 dark:text-emerald-400',
  warn: 'text-amber-600 dark:text-amber-400',
  error: 'text-rose-600 dark:text-rose-400',
}

export default function ExecutionLog() {
  const { logs, clearLogs } = useExecutionStore()

  return (
    <section className="flex h-full min-h-0 flex-col overflow-hidden">
      <div className="flex shrink-0 items-center justify-between border-b border-slate-200 bg-slate-50/50 px-3 py-2 dark:border-neutral-800 dark:bg-neutral-900/30">
        <h2 className="text-[11px] font-bold uppercase tracking-widest text-slate-500 dark:text-slate-400">执行日志</h2>
        <button
          type="button"
          onClick={clearLogs}
          className="rounded-lg border border-slate-200 bg-white/50 px-3 py-1 text-[10px] font-bold transition-all hover:bg-white active:scale-95 dark:border-neutral-800 dark:bg-neutral-900/50 dark:hover:bg-slate-800"
        >
          清空
        </button>
      </div>
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto overflow-x-hidden px-3 py-2 scrollbar-thin scrollbar-thumb-slate-200 dark:scrollbar-thumb-slate-800">
        {logs.length === 0 ? (
          <div className="flex h-full w-full items-center justify-center text-slate-400 italic font-medium opacity-50">
            等待系统活动...
          </div>
        ) : (
          <div className="w-full space-y-1 font-mono text-[11px]">
            {logs.map((log) => (
              <div key={log.id} className={`${levelTone[log.level]} flex items-start`}> 
                <span className="mr-2 shrink-0 opacity-40 text-[10px]">[{new Date(log.timestamp).toLocaleTimeString()}]</span>
                <span className="whitespace-pre-wrap break-all">{log.message}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  )
}
