import { useExecutionStore } from '../../stores/executionStore'
import { useSettingsStore } from '../../stores/settingsStore'
import { useWorkflowStore } from '../../stores/workflowStore'
import { runWorkflow, stopWorkflow } from '../../utils/execution'
import { announceWorkflowCompleted } from '../../utils/workflowCompletion'
import { toBackendGraph } from '../../utils/workflowBridge'
import { useState } from 'react'
import CoordinatePicker from '../CoordinatePicker'

interface ToolbarProps {
  backgroundMode: boolean
  onToggleBackgroundMode: () => void
  onPickCoordinate: () => void
  coordinatePicking: boolean
}

export default function Toolbar({ backgroundMode, onToggleBackgroundMode, onPickCoordinate, coordinatePicking }: ToolbarProps) {
  const { running, setRunning, addLog, clearVariables } = useExecutionStore()
  const { zoom } = useSettingsStore()
  const { undo, redo, exportWorkflow, graphName, setGraphName } = useWorkflowStore()
  const [isEditingName, setIsEditingName] = useState(false)
  const [editName, setEditName] = useState(graphName)

  const run = async () => {
    if (running) return
    window.dispatchEvent(new Event('commandflow:reset-step-debug'))
    const workflowFile = exportWorkflow()
    const graph = toBackendGraph(workflowFile)

    clearVariables()
    setRunning(true)
    addLog('info', `开始执行流程：${workflowFile.graph.name}`)
    try {
      const message = await runWorkflow(graph)
      addLog('success', message)
      announceWorkflowCompleted({
        body: `${workflowFile.graph.name} 已执行完成。`,
      })
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

  const buttonClass = "flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white/60 px-3.5 py-1.5 text-xs font-medium transition-all duration-150 hover:bg-white hover:shadow-sm active:translate-y-[1px] disabled:opacity-50 dark:border-neutral-800 dark:bg-neutral-900/60 dark:hover:bg-slate-800"
  const mutedActionButtonClass = 'flex items-center gap-2 rounded-lg bg-slate-600 px-4 py-2 text-xs font-bold text-white shadow-lg shadow-slate-700/20 transition-all hover:bg-slate-500 hover:shadow-slate-600/30 active:scale-95 disabled:bg-slate-400 dark:bg-slate-600 dark:hover:bg-slate-500'

  return (
    <div className="relative z-50 flex h-12 items-center gap-2 border-b border-slate-200 bg-slate-50/50 px-4 backdrop-blur-xl dark:border-neutral-800 dark:bg-black/50">
      <button 
        type="button" 
        onClick={run} 
        className="flex items-center gap-2 rounded-lg bg-blue-600 px-5 py-2 text-xs font-bold text-white shadow-lg shadow-blue-600/20 transition-all hover:bg-blue-500 hover:shadow-blue-500/30 active:scale-95 disabled:bg-slate-400"
        disabled={running}
      >
        <span className="h-2 w-2 rounded-full bg-white animate-pulse" />
        F5 运行
      </button>
      <button
        type="button"
        onClick={() => window.dispatchEvent(new Event('commandflow:run-step'))}
        className={mutedActionButtonClass}
        disabled={running}
      >
        <span className="h-2 w-2 rounded-full bg-white" />
        F10 单步
      </button>
      <button
        type="button"
        onClick={onToggleBackgroundMode}
        className={mutedActionButtonClass}
      >
        <span className="h-2 w-2 rounded-full bg-white" />
        {backgroundMode ? '退出后台' : 'F8 后台模式'}
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

      {isEditingName ? (
        <input
          type="text"
          value={editName}
          onChange={(e) => setEditName(e.target.value)}
          onBlur={() => {
            setGraphName(editName.trim() || '未命名工作流')
            setIsEditingName(false)
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              setGraphName(editName.trim() || '未命名工作流')
              setIsEditingName(false)
            } else if (e.key === 'Escape') {
              setEditName(graphName)
              setIsEditingName(false)
            }
          }}
          className="h-7 w-40 rounded border border-slate-300 bg-white px-2 text-xs text-slate-700 outline-none focus:border-cyan-500 dark:border-neutral-700 dark:bg-neutral-800 dark:text-slate-200 dark:focus:border-cyan-500"
          autoFocus
        />
      ) : (
        <button
          type="button"
          onClick={() => {
            setEditName(graphName)
            setIsEditingName(true)
          }}
          className="rounded-lg bg-white/60 px-3 py-1.5 text-xs font-medium text-slate-600 transition-all hover:bg-white hover:shadow-sm dark:bg-neutral-900/60 dark:text-slate-300"
          title="点击修改工作流名称"
        >
          {graphName}
        </button>
      )}

      <div className="ml-auto flex items-center gap-3">
        <CoordinatePicker picking={coordinatePicking} onPick={onPickCoordinate} compact />
        <div className="rounded-full bg-slate-200/50 px-3 py-1 text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:bg-neutral-800/50 dark:text-slate-400">
          缩放: {Math.round(zoom * 100)}%
        </div>
      </div>
    </div>
  )
}
