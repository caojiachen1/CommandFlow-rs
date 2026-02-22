import { useEffect } from 'react'
import { useExecutionStore } from '../stores/executionStore'
import { useWorkflowStore } from '../stores/workflowStore'

export const useShortcutBindings = () => {
  const { undo, redo, deleteSelectedNodes, duplicateSelectedNode, resetWorkflow } = useWorkflowStore()
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
        setRunning(true)
        addLog('success', '开始执行工作流。')
      } else if (event.key === 'F6') {
        event.preventDefault()
        setRunning(false)
        addLog('warn', '用户请求停止执行。')
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [addLog, deleteSelectedNodes, duplicateSelectedNode, redo, resetWorkflow, setRunning, undo])
}
