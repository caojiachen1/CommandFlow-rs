import { useExecutionStore } from '../../stores/executionStore'

const levelTone = {
  info: 'text-slate-500 dark:text-slate-400',
  success: 'text-emerald-600 dark:text-emerald-400 border-l-2 border-emerald-500 pl-2 bg-emerald-500/5',
  warn: 'text-amber-600 dark:text-amber-400 border-l-2 border-amber-500 pl-2 bg-amber-500/5',
  error: 'text-rose-600 dark:text-rose-400 border-l-2 border-rose-500 pl-2 bg-rose-500/5',
}

export default function ExecutionLog() {
  const { logs, clearLogs } = useExecutionStore()

  return (
    <section className="flex flex-1 flex-col border-b border-slate-200 p-4 dark:border-neutral-800">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-[11px] font-bold uppercase tracking-widest text-slate-500 dark:text-slate-400">执行日志</h2>
        <button
          type="button"
          onClick={clearLogs}
          className="rounded-lg border border-slate-200 bg-white/50 px-3 py-1 text-[10px] font-bold transition-all hover:bg-white active:scale-95 dark:border-neutral-800 dark:bg-neutral-900/50 dark:hover:bg-slate-800"
        >
          清空
        </button>
      </div>
      <div className="flex-1 overflow-y-auto rounded-xl border border-slate-200 bg-white p-3 text-[11px] shadow-inner scrollbar-thin scrollbar-thumb-slate-200 dark:border-neutral-800 dark:bg-neutral-900 dark:scrollbar-thumb-slate-800">
        {logs.length === 0 && (
          <div className="flex h-full items-center justify-center text-slate-400 italic font-medium opacity-50">
            等待系统活动...
          </div>
        )}
        <div className="space-y-2 font-mono">
          {logs.map((log) => (
            <div key={log.id} className={`${levelTone[log.level]} rounded-lg p-2.5 transition-all hover:translate-x-1`}>
              <span className="mr-2 opacity-40 text-[10px]">[{new Date(log.timestamp).toLocaleTimeString()}]</span>
              <span className="font-semibold">{log.message}</span>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
