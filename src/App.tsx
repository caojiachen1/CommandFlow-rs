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
import { listen } from '@tauri-apps/api/event'
import { runWorkflow, stopWorkflow } from './utils/execution'
import { toBackendGraph } from './utils/workflowBridge'
import type { WorkflowFile, WorkflowNode } from './types/workflow'

const menuGroups = {
  文件: ['新建', '打开', '保存', '另存为'],
  编辑: ['撤销', '重做', '复制', '粘贴'],
  视图: ['放大', '缩小', '重置缩放'],
  运行: ['运行', '停止', '单步', '连续单步'],
  帮助: ['文档', '快捷键'],
}

interface StepRuntimeContext {
  variables: Map<string, unknown>
  loopRemaining: Map<string, number>
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
    selectedNodeId,
    nodes,
    edges,
    setSelectedNode,
  } = useWorkflowStore()
  const { running, setRunning, addLog } = useExecutionStore()
  const [activeMenu, setActiveMenu] = useState<string | null>(null)
  const [lastFileName, setLastFileName] = useState<string>('workflow.json')
  const menuRef = useRef<HTMLDivElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const continuousStepRunningRef = useRef(false)
  const continuousStepStopRef = useRef(false)
  const stepCtxRef = useRef<StepRuntimeContext>({
    variables: new Map(),
    loopRemaining: new Map(),
  })

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

  useEffect(() => {
    if (!('__TAURI_INTERNALS__' in window)) {
      return
    }

    let unlisten: (() => void) | null = null
    void listen<{ node_id: string }>('workflow-node-started', (event) => {
      const nodeId = event.payload?.node_id
      if (!nodeId) return
      setSelectedNode(nodeId)
    })
      .then((cleanup) => {
        unlisten = cleanup
      })
      .catch((error) => {
        addLog('warn', `监听执行进度失败：${String(error)}`)
      })

    return () => {
      unlisten?.()
    }
  }, [addLog, setSelectedNode])

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

  const runSingleStep = useCallback(async () => {
    if (running) {
      addLog('warn', '当前正在执行，请先停止后再进行单步。')
      return
    }

    const selectedNode = nodes.find((node) => node.id === selectedNodeId)
    if (!selectedNode) {
      addLog('warn', '请先选中一个节点，再执行单步。')
      return
    }

    const workflowFile = exportWorkflow()
    const stepFile: WorkflowFile = {
      ...workflowFile,
      updatedAt: new Date().toISOString(),
      graph: {
        ...workflowFile.graph,
        nodes: [selectedNode],
        edges: [],
      },
    }

    setRunning(true)
    try {
      addLog('info', `单步执行节点：${selectedNode.data.label}`)
      const message = await runWorkflow(toBackendGraph(stepFile))
      addLog('success', `单步完成：${message}`)
    } catch (error) {
      addLog('error', `单步失败：${String(error)}`)
    } finally {
      setRunning(false)
    }
  }, [addLog, exportWorkflow, nodes, running, selectedNodeId, setRunning])

  const getParamString = (node: WorkflowNode, key: string, fallback = '') => {
    const value = node.data.params[key]
    return typeof value === 'string' ? value : fallback
  }

  const getParamNumber = (node: WorkflowNode, key: string, fallback = 0) => {
    const value = node.data.params[key]
    return typeof value === 'number' && Number.isFinite(value) ? value : fallback
  }

  const toNumeric = (value: unknown) => {
    if (typeof value === 'number') return value
    if (typeof value === 'string') {
      const parsed = Number(value)
      return Number.isFinite(parsed) ? parsed : 0
    }
    if (typeof value === 'boolean') return value ? 1 : 0
    return 0
  }

  const parseOperand = (kind: string, raw: string, variables: Map<string, unknown>) => {
    if (kind === 'var') {
      return variables.get(raw)
    }
    if (raw.toLowerCase() === 'true') return true
    if (raw.toLowerCase() === 'false') return false
    const asNumber = Number(raw)
    if (Number.isFinite(asNumber)) return asNumber
    return raw
  }

  const evaluateCondition = (node: WorkflowNode, variables: Map<string, unknown>) => {
    const leftType = getParamString(node, 'leftType', 'var')
    const rightType = getParamString(node, 'rightType', 'literal')
    const operator = getParamString(node, 'operator', '==')
    const leftRaw = getParamString(node, 'left', '')
    const rightRaw = getParamString(node, 'right', '')

    const left = parseOperand(leftType, leftRaw, variables)
    const right = parseOperand(rightType, rightRaw, variables)

    switch (operator) {
      case '==':
        return left === right
      case '!=':
        return left !== right
      case '>':
        return toNumeric(left) > toNumeric(right)
      case '>=':
        return toNumeric(left) >= toNumeric(right)
      case '<':
        return toNumeric(left) < toNumeric(right)
      case '<=':
        return toNumeric(left) <= toNumeric(right)
      default:
        return false
    }
  }

  const updateStepContextAfterNode = (node: WorkflowNode, ctx: StepRuntimeContext) => {
    const nodeKind = node.data.kind
    if (nodeKind === 'varDefine') {
      const name = getParamString(node, 'name', '').trim()
      if (!name) return
      if (!ctx.variables.has(name)) {
        ctx.variables.set(name, node.data.params.value ?? null)
      }
      return
    }

    if (nodeKind === 'varSet') {
      const name = getParamString(node, 'name', '').trim()
      if (!name) return
      ctx.variables.set(name, node.data.params.value ?? null)
    }
  }

  const pickNextNodeId = (node: WorkflowNode, ctx: StepRuntimeContext) => {
    const outgoing = edges.filter((edge) => edge.source === node.id)
    if (outgoing.length === 0) return null

    const chooseByHandle = (handle: string) =>
      outgoing.find((edge) => edge.sourceHandle === handle || edge.sourceHandle === `${handle}`)

    if (node.data.kind === 'condition') {
      const result = evaluateCondition(node, ctx.variables)
      return (result ? chooseByHandle('true') : chooseByHandle('false') ?? outgoing[0])?.target ?? null
    }

    if (node.data.kind === 'loop') {
      const times = Math.max(0, Math.floor(getParamNumber(node, 'times', 1)))
      const remaining = ctx.loopRemaining.get(node.id) ?? times
      if (remaining > 0) {
        ctx.loopRemaining.set(node.id, remaining - 1)
        return (chooseByHandle('loop') ?? outgoing[0])?.target ?? null
      }
      ctx.loopRemaining.delete(node.id)
      return (chooseByHandle('done') ?? outgoing[0])?.target ?? null
    }

    return outgoing[0]?.target ?? null
  }

  const runContinuousStep = useCallback(async () => {
    if (running) {
      addLog('warn', '当前正在执行，请先停止后再进行连续单步。')
      return
    }

    const selectedNode = nodes.find((node) => node.id === selectedNodeId)
    if (!selectedNode) {
      addLog('warn', '请先选中一个节点，再开始连续单步。')
      return
    }

    continuousStepStopRef.current = false
    continuousStepRunningRef.current = true
    stepCtxRef.current = { variables: new Map(), loopRemaining: new Map() }
    setRunning(true)
    addLog('info', `开始连续单步：${selectedNode.data.label}`)

    let currentNode = selectedNode
    let guard = 0
    try {
      while (!continuousStepStopRef.current && guard < 2000) {
        guard += 1

        const workflowFile = exportWorkflow()
        const stepFile: WorkflowFile = {
          ...workflowFile,
          updatedAt: new Date().toISOString(),
          graph: {
            ...workflowFile.graph,
            nodes: [currentNode],
            edges: [],
          },
        }

        addLog('info', `连续单步执行：${currentNode.data.label}`)
        await runWorkflow(toBackendGraph(stepFile))
        updateStepContextAfterNode(currentNode, stepCtxRef.current)

        const nextNodeId = pickNextNodeId(currentNode, stepCtxRef.current)
        if (!nextNodeId) {
          addLog('success', '连续单步完成：已到达流程末尾。')
          return
        }

        const nextNode = nodes.find((node) => node.id === nextNodeId)
        if (!nextNode) {
          addLog('warn', `连续单步结束：未找到下一个节点 ${nextNodeId}。`)
          return
        }

        setSelectedNode(nextNode.id)
        currentNode = nextNode
        await new Promise((resolve) => setTimeout(resolve, 150))
      }

      if (guard >= 2000) {
        addLog('warn', '连续单步已触发保护上限，已自动停止。')
      } else if (continuousStepStopRef.current) {
        addLog('warn', '连续单步已停止。')
      }
    } catch (error) {
      addLog('error', `连续单步失败：${String(error)}`)
    } finally {
      continuousStepRunningRef.current = false
      continuousStepStopRef.current = false
      setRunning(false)
    }
  }, [addLog, exportWorkflow, nodes, pickNextNodeId, running, selectedNodeId, setRunning, setSelectedNode])

  const stopAllExecution = useCallback(async () => {
    continuousStepStopRef.current = true
    try {
      const message = await stopWorkflow()
      addLog('warn', message)
    } catch (error) {
      addLog('error', `停止失败：${String(error)}`)
    } finally {
      setRunning(false)
    }
  }, [addLog, setRunning])

  useEffect(() => {
    const handleRunStep = () => {
      void runSingleStep()
    }
    window.addEventListener('commandflow:run-step', handleRunStep)
    return () => window.removeEventListener('commandflow:run-step', handleRunStep)
  }, [runSingleStep])

  useEffect(() => {
    const handleRunContinuousStep = () => {
      if (continuousStepRunningRef.current) {
        continuousStepStopRef.current = true
        addLog('warn', '正在停止连续单步...')
        return
      }
      void runContinuousStep()
    }

    const handleStop = () => {
      void stopAllExecution()
    }

    window.addEventListener('commandflow:run-continuous-step', handleRunContinuousStep)
    window.addEventListener('commandflow:stop-run', handleStop)

    return () => {
      window.removeEventListener('commandflow:run-continuous-step', handleRunContinuousStep)
      window.removeEventListener('commandflow:stop-run', handleStop)
    }
  }, [addLog, runContinuousStep, stopAllExecution])

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
        await stopAllExecution()
        break
      case '单步':
        void runSingleStep()
        break
      case '连续单步':
        void runContinuousStep()
        break
      case '文档':
        addLog('info', '文档请查看项目根目录 README.md。')
        break
      case '快捷键':
        addLog('info', '快捷键：Ctrl+N 新建，Ctrl+Z 撤销，Ctrl+Y 重做，Ctrl+C 复制，Ctrl+V 粘贴，Delete 删除，F5 运行，F6 停止，F9 连续单步，F10 单步。')
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
