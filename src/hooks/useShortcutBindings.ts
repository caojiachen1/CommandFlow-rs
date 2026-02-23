import { useEffect } from 'react'
import { useExecutionStore } from '../stores/executionStore'
import { useWorkflowStore } from '../stores/workflowStore'
import { runWorkflow } from '../utils/execution'
import { toBackendGraph } from '../utils/workflowBridge'

export const useShortcutBindings = () => {
  const {
    undo,
    redo,
    deleteSelectedNodes,
    duplicateSelectedNode,
    resetWorkflow,
    exportWorkflow,
    copySelectedNode,
    pasteCopiedNode,
  } = useWorkflowStore()
  const { setRunning, addLog, clearVariables } = useExecutionStore()

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const ctrl = event.ctrlKey || event.metaKey
      const key = event.key.toLowerCase()

      if (ctrl && key === 'z') {
        event.preventDefault()
        undo()
      } else if (ctrl && key === 'y') {
        event.preventDefault()
        redo()
      } else if (event.key === 'Delete') {
        event.preventDefault()
        deleteSelectedNodes()
      } else if (ctrl && key === 'd') {
        event.preventDefault()
        duplicateSelectedNode()
      } else if (ctrl && key === 'c') {
        event.preventDefault()
        const copied = copySelectedNode()
        addLog(copied ? 'info' : 'warn', copied ? '已复制选中节点。' : '未选中节点，无法复制。')
      } else if (ctrl && key === 'v') {
        event.preventDefault()
        const pasted = pasteCopiedNode()
        addLog(pasted ? 'info' : 'warn', pasted ? '已粘贴节点。' : '剪贴板为空，请先复制节点。')
      } else if (ctrl && key === 'n') {
        event.preventDefault()
        resetWorkflow()
        addLog('info', '已新建工作流。')
      } else if (event.key === 'F5') {
        event.preventDefault()
        window.dispatchEvent(new Event('commandflow:reset-step-debug'))
        const workflowFile = exportWorkflow()
        const graph = toBackendGraph(workflowFile)
        clearVariables()
        setRunning(true)
        addLog('info', `开始执行工作流：${workflowFile.graph.name}`)
        void runWorkflow(graph)
          .then((message) => addLog('success', message))
          .catch((error) => addLog('error', `执行失败：${String(error)}`))
          .finally(() => setRunning(false))
      } else if (event.key === 'F6') {
        event.preventDefault()
        window.dispatchEvent(new Event('commandflow:stop-run'))
      } else if (event.key === 'F9') {
        event.preventDefault()
        window.dispatchEvent(new Event('commandflow:run-continuous-step'))
      } else if (event.key === 'F10') {
        event.preventDefault()
        window.dispatchEvent(new Event('commandflow:run-step'))
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [
    addLog,
    copySelectedNode,
    deleteSelectedNodes,
    duplicateSelectedNode,
    exportWorkflow,
    pasteCopiedNode,
    redo,
    resetWorkflow,
    setRunning,
    clearVariables,
    undo,
  ])
}
