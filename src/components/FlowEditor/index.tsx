import {
  Background,
  BackgroundVariant,
  Controls,
  ReactFlow,
  ReactFlowProvider,
  type NodeMouseHandler,
  useReactFlow,
} from '@xyflow/react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useWorkflowStore } from '../../stores/workflowStore'
import { useSettingsStore } from '../../stores/settingsStore'
import type { NodeKind } from '../../types/workflow'
import ClickNode from '../../nodes/ClickNode'
import ConditionNode from '../../nodes/ConditionNode'
import ImageMatchNode from '../../nodes/ImageMatchNode'
import KeyPressNode from '../../nodes/KeyPressNode'
import LoopNode from '../../nodes/LoopNode'
import ScreenshotNode from '../../nodes/ScreenshotNode'
import VariableNode from '../../nodes/VariableNode'
import PropertyModal from '../PropertyModal'

const allowedKinds: NodeKind[] = [
  'hotkeyTrigger',
  'timerTrigger',
  'manualTrigger',
  'windowTrigger',
  'mouseClick',
  'mouseMove',
  'mouseDrag',
  'mouseWheel',
  'keyboardKey',
  'keyboardInput',
  'shortcut',
  'screenshot',
  'windowActivate',
  'runCommand',
  'delay',
  'condition',
  'loop',
  'errorHandler',
  'varDefine',
  'varSet',
]

const isNodeKind = (value: string): value is NodeKind => allowedKinds.includes(value as NodeKind)

function InnerFlowEditor({ onPaneClick }: { onPaneClick?: () => void }) {
  const {
    nodes,
    edges,
    onNodesChange,
    onEdgesChange,
    onConnect,
    setSelectedNode,
    addNode,
    setCursor,
  } = useWorkflowStore()
  const setZoom = useSettingsStore((state) => state.setZoom)
  const reactFlow = useReactFlow()

  const nodeTypes = useMemo(
    () => ({
      mouseClick: ClickNode,
      screenshot: ScreenshotNode,
      keyboardKey: KeyPressNode,
      keyboardInput: KeyPressNode,
      shortcut: KeyPressNode,
      imageMatch: ImageMatchNode,
      condition: ConditionNode,
      loop: LoopNode,
      varDefine: VariableNode,
      varSet: VariableNode,
      manualTrigger: VariableNode,
      hotkeyTrigger: VariableNode,
      timerTrigger: VariableNode,
      windowTrigger: VariableNode,
      mouseMove: ClickNode,
      mouseDrag: ClickNode,
      mouseWheel: ClickNode,
      windowActivate: ClickNode,
      runCommand: ClickNode,
      delay: ClickNode,
      errorHandler: ConditionNode,
    }),
    [],
  )

  const wrapperRef = useRef<HTMLDivElement>(null)

  // Use native DOM event listeners for drag-and-drop to avoid issues with
  // React synthetic events not reaching through ReactFlow's internal DOM.
  useEffect(() => {
    const el = wrapperRef.current
    if (!el) return

    const handleDragOver = (event: DragEvent) => {
      event.preventDefault()
      if (event.dataTransfer) {
        event.dataTransfer.dropEffect = 'move'
      }
    }

    const handleDrop = (event: DragEvent) => {
      event.preventDefault()
      if (!event.dataTransfer) return

      const rawKind =
        event.dataTransfer.getData('text/plain') ||
        event.dataTransfer.getData('application/reactflow')

      if (!rawKind || !isNodeKind(rawKind)) return

      const position = reactFlow.screenToFlowPosition({
        x: event.clientX,
        y: event.clientY,
      })

      addNode(rawKind, position)
    }

    el.addEventListener('dragover', handleDragOver)
    el.addEventListener('drop', handleDrop)

    return () => {
      el.removeEventListener('dragover', handleDragOver)
      el.removeEventListener('drop', handleDrop)
    }
  }, [reactFlow, addNode])

  useEffect(() => {
    const handleZoomIn = () => {
      void reactFlow.zoomIn({ duration: 150 })
      setZoom(reactFlow.getZoom())
    }

    const handleZoomOut = () => {
      void reactFlow.zoomOut({ duration: 150 })
      setZoom(reactFlow.getZoom())
    }

    const handleZoomReset = () => {
      void reactFlow.fitView({ duration: 200, padding: 0.2 })
      setZoom(reactFlow.getZoom())
    }

    window.addEventListener('commandflow:zoom-in', handleZoomIn)
    window.addEventListener('commandflow:zoom-out', handleZoomOut)
    window.addEventListener('commandflow:zoom-reset', handleZoomReset)

    return () => {
      window.removeEventListener('commandflow:zoom-in', handleZoomIn)
      window.removeEventListener('commandflow:zoom-out', handleZoomOut)
      window.removeEventListener('commandflow:zoom-reset', handleZoomReset)
    }
  }, [reactFlow, setZoom])

  const onNodeClick: NodeMouseHandler = useCallback((_, node) => {
    setSelectedNode(node.id)
  }, [setSelectedNode])

  const [modalOpen, setModalOpen] = useState(false)

  const onNodeDoubleClick: NodeMouseHandler = useCallback((_, node) => {
    setSelectedNode(node.id)
    setModalOpen(true)
  }, [setSelectedNode])

  const handlePaneClick = useCallback(() => {
    setSelectedNode(null)
    onPaneClick?.()
  }, [setSelectedNode, onPaneClick])

  const onPaneMouseMove = useCallback(
    (event: React.MouseEvent<Element>) => {
      const point = reactFlow.screenToFlowPosition({ x: event.clientX, y: event.clientY })
      setCursor(Math.round(point.x), Math.round(point.y))
    },
    [reactFlow, setCursor],
  )

  return (
    <div
      ref={wrapperRef}
      className="h-full w-full bg-slate-50 dark:bg-neutral-950 transition-colors"
    >
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onMove={(_, viewport) => setZoom(viewport.zoom)}
        onNodeClick={onNodeClick}
        onNodeDoubleClick={onNodeDoubleClick}
        onPaneClick={handlePaneClick}
        onPaneMouseMove={onPaneMouseMove}
        fitView
        panOnDrag
        snapToGrid
        snapGrid={[15, 15]}
        defaultEdgeOptions={{
          animated: true,
          style: { stroke: '#0891b2', strokeWidth: 2 }
        }}
      >
        <Background
          variant={BackgroundVariant.Dots}
          gap={24}
          size={1.2}
          color="var(--flow-grid-color)"
          className="dark:opacity-[0.6] opacity-[0.3]"
        />
        <Controls
          className="!flex !flex-col !gap-1 !p-1 !mb-20 !mr-6 !bg-white/90 !shadow-2xl backdrop-blur-md dark:!bg-slate-900/90 dark:border dark:border-neutral-800 rounded-xl overflow-hidden"
          showInteractive={false}
          position="bottom-right"
        />
        <PropertyModal open={modalOpen} onClose={() => setModalOpen(false)} />
      </ReactFlow>
    </div>
  )
}

export default function FlowEditor({ onPaneClick }: { onPaneClick?: () => void }) {
  return (
    <section className="h-full flex-1 relative z-0">
      <ReactFlowProvider>
        <InnerFlowEditor onPaneClick={onPaneClick} />
      </ReactFlowProvider>
    </section>
  )
}
