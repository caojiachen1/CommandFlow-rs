import { useMemo, useState, useEffect, useRef, useCallback, type ChangeEvent } from 'react'
import FlowEditor from './components/FlowEditor'
import NodePanel from './components/NodePanel'
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
import type { WorkflowFile } from './types/workflow'

const menuGroups = {
  文件: ['新建', '打开', '保存', '另存为'],
  编辑: ['撤销', '重做', '复制', '粘贴'],
  视图: ['放大', '缩小', '重置缩放'],
  运行: ['运行', '停止', '单步'],
  帮助: ['文档', '快捷键'],
}

function App() {
  const { theme, setTheme } = useSettingsStore()
  const {
    undo,
    redo,
    resetWorkflow,
    exportWorkflow,
    importWorkflow,
    copySelectedNode,
    pasteCopiedNode,
  } = useWorkflowStore()
  const { running, setRunning, addLog } = useExecutionStore()
  const [activeMenu, setActiveMenu] = useState<string | null>(null)
  const [lastFileName, setLastFileName] = useState<string>('workflow.json')
  const menuRef = useRef<HTMLDivElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

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

  const isWorkflowFile = (value: unknown): value is WorkflowFile => {
    if (!value || typeof value !== 'object') return false
    const file = value as Partial<WorkflowFile>
    return (
      file.version === '1.0.0' &&
      !!file.graph &&
      typeof file.graph.id === 'string' &&
      typeof file.graph.name === 'string' &&
      Array.isArray(file.graph.nodes) &&
      Array.isArray(file.graph.edges)
    )
  }

  const downloadWorkflow = (preferredName?: string) => {
    const file = exportWorkflow()
    const requestedName = (preferredName ?? lastFileName ?? `${file.graph.name}.json`).trim()
    const finalName = requestedName.toLowerCase().endsWith('.json') ? requestedName : `${requestedName}.json`

    const payload = JSON.stringify(file, null, 2)
    const blob = new Blob([payload], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = finalName
    anchor.click()
    URL.revokeObjectURL(url)

    setLastFileName(finalName)
    addLog('success', `已保存工作流：${finalName}`)
  }

  const handleOpenFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return

    try {
      const content = await file.text()
      const parsed: unknown = JSON.parse(content)

      if (!isWorkflowFile(parsed)) {
        throw new Error('文件格式不是有效的 CommandFlow 工作流 JSON。')
      }

      importWorkflow(parsed)
      setLastFileName(file.name)
      addLog('success', `已打开工作流：${file.name}`)
    } catch (error) {
      addLog('error', `打开失败：${String(error)}`)
    } finally {
      event.target.value = ''
    }
  }

  const handleMenuAction = async (item: string) => {
    setActiveMenu(null)
    switch (item) {
      case '新建':
        resetWorkflow()
        addLog('info', '已新建工作流。')
        break
      case '打开':
        fileInputRef.current?.click()
        break
      case '保存':
        downloadWorkflow(lastFileName)
        break
      case '另存为': {
        const suggested = lastFileName || 'workflow.json'
        const inputName = window.prompt('请输入文件名（支持 .json）', suggested)
        if (!inputName) return
        downloadWorkflow(inputName)
        break
      }
      case '撤销':
        undo()
        break
      case '重做':
        redo()
        break
      case '复制': {
        const copied = copySelectedNode()
        addLog(copied ? 'info' : 'warn', copied ? '已复制选中节点。' : '未选中节点，无法复制。')
        break
      }
      case '粘贴': {
        const pasted = pasteCopiedNode()
        addLog(pasted ? 'info' : 'warn', pasted ? '已粘贴节点。' : '剪贴板为空，请先复制节点。')
        break
      }
      case '放大':
        window.dispatchEvent(new Event('commandflow:zoom-in'))
        break
      case '缩小':
        window.dispatchEvent(new Event('commandflow:zoom-out'))
        break
      case '重置缩放':
        window.dispatchEvent(new Event('commandflow:zoom-reset'))
        break
      case '运行':
        if (running) return
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
      case '单步':
        addLog('warn', '单步执行尚未实现，敬请期待。')
        break
      case '文档':
        addLog('info', '文档请查看项目根目录 README.md。')
        break
      case '快捷键':
        addLog('info', '快捷键：Ctrl+N 新建，Ctrl+Z 撤销，Ctrl+Y 重做，Ctrl+C 复制，Ctrl+V 粘贴，Delete 删除，F5 运行，F6 停止。')
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

      <main className="flex min-h-0 flex-1 grid-cols-[280px_1fr_320px] overflow-hidden lg:grid">
        <NodePanel />
        <FlowEditor onPaneClick={handleFlowEditorPaneClick} />
        <div className="flex min-h-0 flex-col border-l border-slate-200 bg-slate-50/30 backdrop-blur-md dark:border-neutral-800 dark:bg-neutral-900/40">
          <div className="flex h-1/3 min-h-0 flex-col border-b border-slate-200 dark:border-neutral-800">
            <VariablePanel />
          </div>
          <div className="flex h-2/3 min-h-0 flex-col">
            <ExecutionLog />
          </div>
        </div>
      </main>

      <div className="shrink-0">
        <StatusBar />
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept="application/json,.json"
        className="hidden"
        onChange={handleOpenFile}
      />
    </div>
  )
}

export default App
