import { useEffect } from 'react'
import { useExecutionStore } from '../stores/executionStore'
import { useWorkflowStore } from '../stores/workflowStore'
import { runWorkflow, stopWorkflow } from '../utils/execution'
import { toBackendGraph } from '../utils/workflowBridge'

export const useShortcutBindings = () => {
  const { undo, redo, deleteSelectedNodes, duplicateSelectedNode, resetWorkflow, exportWorkflow } = useWorkflowStore()
  const { setRunning, addLog } = useExecutionStore()

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
      } else if (ctrl && key === 'n') {
        event.preventDefault()
        resetWorkflow()
        addLog('info', '已新建工作流。')
      } else if (event.key === 'F5') {
        event.preventDefault()
        const workflowFile = exportWorkflow()
        const graph = toBackendGraph(workflowFile)
        setRunning(true)
        addLog('info', `开始执行工作流：${workflowFile.graph.name}`)
        void runWorkflow(graph)
          .then((message) => addLog('success', message))
          .catch((error) => addLog('error', `执行失败：${String(error)}`))
          .finally(() => setRunning(false))
      } else if (event.key === 'F6') {
        event.preventDefault()
        void stopWorkflow()
          .then((message) => addLog('warn', message))
          .catch((error) => addLog('error', `停止失败：${String(error)}`))
        setRunning(false)
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [addLog, deleteSelectedNodes, duplicateSelectedNode, exportWorkflow, redo, resetWorkflow, setRunning, undo])
}
