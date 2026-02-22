import { useExecutionStore } from '../../stores/executionStore'
import { useSettingsStore } from '../../stores/settingsStore'
import { useWorkflowStore } from '../../stores/workflowStore'

export default function StatusBar() {
  const { cursor, nodes } = useWorkflowStore()
  const { statusText, running } = useExecutionStore()
  const { zoom, coordinateMode } = useSettingsStore()

  return (
    <footer className="relative z-50 flex h-10 items-center gap-6 border-t border-slate-200 bg-white px-4 text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:border-neutral-800 dark:bg-neutral-900 dark:text-slate-400">
      <div className="flex items-center gap-2">
        <span className="h-2 w-2 rounded-full bg-slate-300 dark:bg-neutral-700" />
        <span>坐标: <span className="font-mono text-cyan-600 dark:text-cyan-400">{cursor.x}, {cursor.y}</span></span>
        <span className="ml-1 opacity-50 text-[9px]">({coordinateMode === 'virtualScreen' ? '虚拟屏幕' : '活动窗口'})</span>
      </div>
      
      <div className="h-3 w-[1px] bg-slate-200 dark:bg-neutral-800" />
      
      <div className="flex items-center gap-2">
        <span>节点: <span className="text-slate-900 dark:text-slate-100">{nodes.length}</span></span>
      </div>

      <div className="h-3 w-[1px] bg-slate-200 dark:bg-neutral-800" />

      <div className="flex items-center gap-2">
        <div className={`h-2 w-2 rounded-full transition-all duration-500 ${running ? 'animate-pulse bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]' : 'bg-slate-300 dark:bg-neutral-700'}`} />
        <span>状态: <span className={running ? 'text-emerald-600 dark:text-emerald-400' : 'text-slate-400'}>{statusText}</span></span>
      </div>
      
      <div className="ml-auto flex items-center gap-2 rounded-lg bg-slate-100 px-3 py-1 dark:bg-neutral-800/50">
        <span className="opacity-50">缩放:</span>
        <span className="text-slate-900 dark:text-slate-100">{Math.round(zoom * 100)}%</span>
      </div>
    </footer>
  )
}
