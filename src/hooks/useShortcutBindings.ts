import { useEffect } from 'react'
import { useExecutionStore } from '../stores/executionStore'
import { useWorkflowStore } from '../stores/workflowStore'
import { runWorkflow } from '../utils/execution'
import { toBackendGraph } from '../utils/workflowBridge'

const isEditableTarget = (target: EventTarget | null): boolean => {
  if (!(target instanceof HTMLElement)) return false

  if (target.isContentEditable) return true

  const tagName = target.tagName
  if (tagName === 'TEXTAREA' || tagName === 'SELECT') return true
  if (tagName === 'INPUT') {
    const input = target as HTMLInputElement
    return !input.readOnly && !input.disabled
  }

  return Boolean(target.closest('[contenteditable="true"]'))
}

export const useShortcutBindings = () => {
  const {
    nodes,
    undo,
    redo,
    setSelectedNodes,
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
      const editable = isEditableTarget(event.target)

      if (editable) {
        const isNativeEditCombo = ctrl && ['a', 'c', 'v', 'x', 'z', 'y'].includes(key)
        const isNativeDelete = event.key === 'Delete' || event.key === 'Backspace'
        if (isNativeEditCombo || isNativeDelete) {
          return
        }
      }

      if (ctrl && key === 'z') {
        event.preventDefault()
        undo()
      } else if (ctrl && key === 'a') {
        event.preventDefault()
        setSelectedNodes(nodes.map((node) => node.id))
        addLog('info', `已全选 ${nodes.length} 个节点。`)
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
      } else if (ctrl && key === 'x') {
        event.preventDefault()
        const copied = copySelectedNode()
        if (copied) {
          deleteSelectedNodes()
          addLog('info', '已剪切选中节点。')
        } else {
          addLog('warn', '未选中节点，无法剪切。')
        }
      } else if (ctrl && key === 'n') {
        event.preventDefault()
        resetWorkflow()
        addLog('info', '已新建工作流。')
      } else if (ctrl && key === 'o') {
        event.preventDefault()
        window.dispatchEvent(new Event('commandflow:open-workflow'))
      } else if (ctrl && key === 's' && event.shiftKey) {
        event.preventDefault()
        window.dispatchEvent(new Event('commandflow:save-workflow-as'))
      } else if (ctrl && key === 's') {
        event.preventDefault()
        window.dispatchEvent(new Event('commandflow:save-workflow'))
      } else if (ctrl && (key === '=' || key === '+')) {
        event.preventDefault()
        window.dispatchEvent(new Event('commandflow:zoom-in'))
      } else if (ctrl && key === '-') {
        event.preventDefault()
        window.dispatchEvent(new Event('commandflow:zoom-out'))
      } else if (ctrl && key === '0') {
        event.preventDefault()
        window.dispatchEvent(new Event('commandflow:zoom-reset'))
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
        if ('__TAURI_INTERNALS__' in window) {
          return
        }
        event.preventDefault()
        window.dispatchEvent(new Event('commandflow:run-step'))
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [
    addLog,
    nodes,
    copySelectedNode,
    deleteSelectedNodes,
    duplicateSelectedNode,
    exportWorkflow,
    pasteCopiedNode,
    redo,
    resetWorkflow,
    setSelectedNodes,
    setRunning,
    clearVariables,
    undo,
  ])
}
