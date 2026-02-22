import { useMemo, useState, useEffect, useRef, useCallback } from 'react'
import FlowEditor from './components/FlowEditor'
import NodePanel from './components/NodePanel'
import PropertyPanel from './components/PropertyPanel'
import Toolbar from './components/Toolbar'
import StatusBar from './components/StatusBar'
import CoordinatePicker from './components/CoordinatePicker'
import VariablePanel from './components/VariablePanel'
import ExecutionLog from './components/ExecutionLog'
import { useSettingsStore } from './stores/settingsStore'
import { useWorkflowStore } from './stores/workflowStore'
import { useExecutionStore } from './stores/executionStore'
import { useShortcutBindings } from './hooks/useShortcutBindings'
import { runWorkflow, stopWorkflow } from './utils/execution'
import { toBackendGraph } from './utils/workflowBridge'

const menuGroups = {
  文件: ['新建', '打开', '保存', '另存为'],
  编辑: ['撤销', '重做', '复制', '粘贴'],
  视图: ['放大', '缩小', '重置缩放'],
  运行: ['运行', '停止', '单步'],
  帮助: ['文档', '快捷键'],
}

function App() {
  const { theme, setTheme } = useSettingsStore()
  const { undo, redo, resetWorkflow, exportWorkflow } = useWorkflowStore()
  const { setRunning, addLog } = useExecutionStore()
  const [activeMenu, setActiveMenu] = useState<string | null>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  useShortcutBindings()

  const menu = useMemo(() => Object.entries(menuGroups), [])

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setActiveMenu(null)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const handleFlowEditorPaneClick = useCallback(() => {
    setActiveMenu(null)
  }, [])

  const handleMenuAction = async (item: string) => {
    setActiveMenu(null)
    switch (item) {
      case '新建':
        resetWorkflow()
        addLog('info', '已新建工作流。')
        break
      case '撤销':
        undo()
        break
      case '重做':
        redo()
        break
      case '运行':
        setRunning(true)
        try {
          const workflowFile = exportWorkflow()
          const graph = toBackendGraph(workflowFile)
          addLog('info', `开始执行：${workflowFile.graph.name}`)
          const message = await runWorkflow(graph)
          addLog('success', message)
        } catch (error) {
          addLog('error', `执行失败：${String(error)}`)
        } finally {
          setRunning(false)
        }
        break
      case '停止':
        try {
          const message = await stopWorkflow()
          addLog('warn', message)
        } catch (error) {
          addLog('error', `停止失败：${String(error)}`)
        } finally {
          setRunning(false)
        }
        break
      default:
        console.log(`点击了 ${item}`)
    }
  }

  return (
    <div className="flex h-screen w-full flex-col overflow-hidden bg-[#202020] text-slate-900 selection:bg-cyan-100 dark:bg-[#202020] dark:text-slate-100 dark:selection:bg-cyan-900/30">
      <header className="relative z-[100] flex h-10 shrink-0 items-center justify-between border-b border-slate-200 bg-[#202020]/70 px-3 backdrop-blur-xl dark:border-neutral-800 dark:bg-[#202020]/70">
        <div className="flex items-center gap-2 text-sm font-medium" ref={menuRef}>
          <div className="mr-3 flex items-center gap-2">
            <div className="h-5 w-5 rounded bg-cyan-600 shadow-sm shadow-cyan-500/50"></div>
            <span className="font-semibold tracking-tight">CommandFlow-rs</span>
          </div>
          {menu.map(([group, items]) => (
            <div key={group} className="relative">
              <button
                type="button"
                onClick={() => setActiveMenu(activeMenu === group ? null : group)}
                className={`rounded-md px-2.5 py-1 text-xs transition-colors hover:bg-slate-200/50 dark:hover:bg-slate-800/70 ${
                  activeMenu === group ? 'bg-slate-200/70 dark:bg-neutral-800/90 text-cyan-600 dark:text-cyan-400 font-semibold' : ''
                }`}
              >
                {group}
              </button>
              {activeMenu === group && (
                <div className="absolute left-0 z-[110] mt-1.5 min-w-[140px] animate-in fade-in slide-in-from-top-1 zoom-in-95 rounded-xl border border-slate-200 bg-white/95 p-1.5 shadow-2xl backdrop-blur-2xl duration-200 dark:border-neutral-700 dark:bg-neutral-900/95">
                  {items.map((item) => (
                    <button
                      key={item}
                      type="button"
                      onClick={() => handleMenuAction(item)}
                      className="block w-full truncate rounded-lg px-3 py-2 text-left text-xs transition-all hover:bg-cyan-500 hover:text-white dark:hover:bg-cyan-600"
                    >
                      {item}
                    </button>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
        <div className="flex items-center gap-3 text-[11px] font-medium">
          <CoordinatePicker />
          <div className="h-3 w-[1px] bg-slate-200 dark:bg-neutral-800" />
          <select
            value={theme}
            onChange={(event) => setTheme(event.target.value as 'light' | 'dark' | 'system')}
            className="cursor-pointer rounded-md border border-slate-200 bg-white/50 px-2 py-1 outline-none backdrop-blur-md transition-all hover:bg-white dark:border-neutral-700 dark:bg-neutral-900/50 dark:hover:bg-slate-800"
          >
            <option value="system">跟随系统</option>
            <option value="dark">深色模式</option>
            <option value="light">浅色模式</option>
          </select>
        </div>
      </header>

      <div className="shrink-0 flex flex-col">
        <Toolbar />
      </div>

      <main className="flex flex-1 grid-cols-[280px_1fr_320px] overflow-hidden lg:grid">
        <NodePanel />
        <FlowEditor onPaneClick={handleFlowEditorPaneClick} />
        <div className="flex flex-col border-l border-slate-200 bg-slate-50/30 backdrop-blur-md dark:border-neutral-800 dark:bg-neutral-900/40">
          <PropertyPanel />
          <div className="h-[1px] w-full bg-slate-200 dark:bg-neutral-800" />
          <VariablePanel />
          <div className="h-[1px] w-full bg-slate-200 dark:bg-neutral-800" />
          <ExecutionLog />
        </div>
      </main>

      <div className="shrink-0">
        <StatusBar />
      </div>
    </div>
  )
}

export default App
