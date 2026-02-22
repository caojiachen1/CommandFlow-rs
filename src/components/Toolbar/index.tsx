import { useExecutionStore } from '../../stores/executionStore'
import { useSettingsStore } from '../../stores/settingsStore'
import { useWorkflowStore } from '../../stores/workflowStore'
import { runWorkflow, stopWorkflow } from '../../utils/execution'
import { toBackendGraph } from '../../utils/workflowBridge'

export default function Toolbar() {
  const { running, setRunning, addLog } = useExecutionStore()
  const { zoom } = useSettingsStore()
  const { undo, redo, exportWorkflow } = useWorkflowStore()

  const run = async () => {
    if (running) return
    const workflowFile = exportWorkflow()
    const graph = toBackendGraph(workflowFile)

    setRunning(true)
    addLog('info', `开始执行流程：${workflowFile.graph.name}`)
    try {
      const message = await runWorkflow(graph)
      addLog('success', message)
    } catch (error) {
      addLog('error', `执行失败：${String(error)}`)
    } finally {
      setRunning(false)
    }
  }

  const stop = async () => {
    try {
      const message = await stopWorkflow()
      addLog('warn', message)
    } catch (error) {
      addLog('error', `停止失败：${String(error)}`)
    }
    setRunning(false)
  }

  const exportJson = () => {
    const data = exportWorkflow()
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `${data.graph.name}.json`
    anchor.click()
    URL.revokeObjectURL(url)
  }

  const buttonClass = "flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white/60 px-3.5 py-1.5 text-xs font-medium transition-all duration-150 hover:bg-white hover:shadow-sm active:translate-y-[1px] disabled:opacity-50 dark:border-neutral-800 dark:bg-neutral-900/60 dark:hover:bg-slate-800"

  return (
    <div className="relative z-50 flex h-12 items-center gap-2 border-b border-slate-200 bg-slate-50/50 px-4 backdrop-blur-xl dark:border-neutral-800 dark:bg-black/50">
      <button 
        type="button" 
        onClick={run} 
        className="flex items-center gap-2 rounded-lg bg-cyan-600 px-5 py-2 text-xs font-bold text-white shadow-lg shadow-cyan-600/20 transition-all hover:bg-cyan-500 hover:shadow-cyan-500/30 active:scale-95 disabled:bg-slate-400"
        disabled={running}
      >
        <span className="h-2 w-2 rounded-full bg-white animate-pulse" />
        F5 运行
      </button>
      <button 
        type="button" 
        onClick={stop} 
        className="flex items-center gap-2 rounded-lg bg-rose-600 px-5 py-2 text-xs font-bold text-white shadow-lg shadow-rose-600/20 transition-all hover:bg-rose-500 hover:shadow-rose-500/30 active:scale-95 disabled:hidden"
        disabled={!running}
      >
        <div className="h-2.5 w-2.5 rounded-sm bg-white" />
        F6 停止
      </button>

      <div className="mx-2 h-5 w-[1px] bg-slate-200 dark:bg-neutral-800" />

      <button type="button" onClick={undo} className={buttonClass}>
        撤销
      </button>
      <button type="button" onClick={redo} className={buttonClass}>
        重做
      </button>
      
      <div className="mx-2 h-5 w-[1px] bg-slate-200 dark:bg-neutral-800" />

      <button type="button" onClick={exportJson} className={buttonClass}>
        导出 JSON
      </button>

      <div className="ml-auto flex items-center gap-3">
        <div className="rounded-full bg-slate-200/50 px-3 py-1 text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:bg-neutral-800/50 dark:text-slate-400">
          缩放: {Math.round(zoom * 100)}%
        </div>
      </div>
    </div>
  )
}
