import type { ExecutionLogItem } from '../../stores/executionStore'

interface InputRecorderCompactPanelProps {
  logs: ExecutionLogItem[]
  recording: boolean
  operationCount: number
  onStart: () => void
  onStop: () => void
  onExit: () => void
}

const levelTone = {
  info: 'text-slate-500 dark:text-slate-400',
  success: 'text-emerald-600 dark:text-emerald-400',
  warn: 'text-amber-600 dark:text-amber-400',
  error: 'text-rose-600 dark:text-rose-400',
}

export default function InputRecorderCompactPanel({
  logs,
  recording,
  operationCount,
  onStart,
  onStop,
  onExit,
}: InputRecorderCompactPanelProps) {
  return (
    <main className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <div className="flex shrink-0 items-center gap-2 border-b border-slate-200 bg-slate-50/40 px-3 py-2 dark:border-neutral-800 dark:bg-neutral-900/40">
        <button
          type="button"
          disabled={recording}
          onClick={onStart}
          className="rounded-md bg-blue-600 px-3 py-1 text-[11px] font-semibold text-white transition-colors hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-50"
        >
          开始录制
        </button>
        <button
          type="button"
          disabled={!recording}
          onClick={onStop}
          className="rounded-md bg-rose-600 px-3 py-1 text-[11px] font-semibold text-white transition-colors hover:bg-rose-500 disabled:cursor-not-allowed disabled:opacity-50"
        >
          停止录制
        </button>
        <div className="ml-auto flex items-center gap-3 text-[11px] text-slate-500 dark:text-slate-400">
          <button
            type="button"
            onClick={onExit}
            className="rounded-md bg-slate-600 px-3 py-1 font-semibold text-white transition-colors hover:bg-slate-500"
          >
            退出录制模式
          </button>
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <div className="flex items-center justify-between border-b border-slate-200 bg-slate-50/50 px-3 py-2 dark:border-neutral-800 dark:bg-neutral-900/30">
          <div>
            <h2 className="text-[11px] font-bold uppercase tracking-widest text-slate-500 dark:text-slate-400">键鼠操作日志</h2>
            <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">已记录 {operationCount} 个操作{recording ? ' · 录制中' : ''}</p>
          </div>
        </div>
        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto overflow-x-hidden px-3 py-2 scrollbar-thin scrollbar-thumb-slate-200 dark:scrollbar-thumb-slate-800">
          {logs.length === 0 ? (
            <div className="flex h-full w-full items-center justify-center text-slate-400 italic font-medium opacity-50">
              还没有录制日志，准备就绪。
            </div>
          ) : (
            <div className="w-full space-y-1 font-mono text-[11px]">
              {logs.map((log) => (
                <div key={log.id} className={`${levelTone[log.level]} flex items-start`}>
                  <span className="mr-2 shrink-0 text-[10px] opacity-40">[{new Date(log.timestamp).toLocaleTimeString()}]</span>
                  <span className="whitespace-pre-wrap break-all">{log.message}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </main>
  )
}
