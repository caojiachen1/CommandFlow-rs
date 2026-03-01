import {
  Background,
  BackgroundVariant,
  Controls,
  ReactFlow,
  ReactFlowProvider,
  SelectionMode,
  type Connection,
  type Edge,
  type NodeMouseHandler,
  type OnConnectStartParams,
  useReactFlow,
} from '@xyflow/react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { FinalConnectionState } from '@xyflow/system'
import { useWorkflowStore } from '../../stores/workflowStore'
import { useSettingsStore } from '../../stores/settingsStore'
import type { NodeKind } from '../../types/workflow'
import { getNodeMeta } from '../../utils/nodeMeta'
import {
  createParamInputHandleId,
  getParamFieldKeyFromHandleId,
  getNodePortSpec,
  isParamInputHandleId,
  isParamOutputHandleId,
  normalizeSourceHandleId,
  normalizeTargetHandleId,
} from '../../utils/nodePorts'
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
  'mouseDown',
  'mouseUp',
  'keyboardKey',
  'keyboardInput',
  'keyboardDown',
  'keyboardUp',
  'shortcut',
  'screenshot',
  'windowActivate',
  'fileCopy',
  'fileMove',
  'fileDelete',
  'runCommand',
  'pythonCode',
  'clipboardRead',
  'clipboardWrite',
  'fileReadText',
  'fileWriteText',
  'showMessage',
  'delay',
  'condition',
  'loop',
  'whileLoop',
  'imageMatch',
  'varDefine',
  'varSet',
  'varMath',
  'varGet',
  'constValue',
]

const isNodeKind = (value: string): value is NodeKind => allowedKinds.includes(value as NodeKind)

interface PendingConnectStart {
  nodeId: string
  handleType: 'source' | 'target'
  handleId: string | null
}

interface NodeQuickInsertState {
  pendingNodeId: string
  pendingHandleType: 'source' | 'target'
  pendingHandleId: string | null
  flowX: number
  flowY: number
  panelX: number
  panelY: number
}

type HandleValueType = 'control' | 'string' | 'number' | 'json' | 'any'

const CONTROL_FLOW_SOURCE_HANDLES = new Set(['next', 'true', 'false', 'loop', 'done'])

const toValueTypeFromFieldType = (fieldType: string): HandleValueType => {
  if (fieldType === 'number') return 'number'
  if (fieldType === 'json') return 'json'
  return 'string'
}

const isTypeCompatible = (sourceType: HandleValueType, targetType: HandleValueType): boolean => {
  if (sourceType === 'control' || targetType === 'control') {
    return sourceType === targetType
  }
  if (sourceType === 'any' || targetType === 'any') {
    return true
  }
  return sourceType === targetType
}

const resolveSourceHandleValueType = (
  kind: NodeKind,
  params: Record<string, unknown>,
  sourceHandleId: string | null,
): HandleValueType | null => {
  const normalizedSource = normalizeSourceHandleId(kind, sourceHandleId)
  if (!normalizedSource) return null

  if (CONTROL_FLOW_SOURCE_HANDLES.has(normalizedSource)) {
    return 'control'
  }

  if (kind === 'varGet' && normalizedSource === 'value') {
    return 'any'
  }

  if (kind === 'constValue' && normalizedSource === 'value') {
    const valueType = String(params.valueType ?? 'number')
    if (valueType === 'number') return 'number'
    if (valueType === 'json') return 'json'
    if (valueType === 'boolean') return 'any'
    return 'string'
  }

  return 'any'
}

const resolveTargetHandleValueType = (kind: NodeKind, targetHandleId: string | null): HandleValueType | null => {
  const normalizedTarget = normalizeTargetHandleId(kind, targetHandleId)
  if (!normalizedTarget) return null

  if (normalizedTarget === 'in') {
    return 'control'
  }

  if (!isParamInputHandleId(normalizedTarget)) {
    return null
  }

  const fieldKey = getParamFieldKeyFromHandleId(normalizedTarget)
  if (!fieldKey) return null
  const field = getNodeMeta(kind).fields.find((item) => item.key === fieldKey)
  if (!field) return null
  return toValueTypeFromFieldType(field.type)
}

const resolveQuickInsertTargetHandle = (kind: NodeKind, sourceValueType: HandleValueType): string | null => {
  const spec = getNodePortSpec(kind)

  if (sourceValueType === 'control') {
    return spec.inputs.some((input) => input.id === 'in') ? 'in' : null
  }

  const meta = getNodeMeta(kind)
  for (const field of meta.fields) {
    const handleId = createParamInputHandleId(field.key)
    if (!spec.inputs.some((input) => input.id === handleId)) {
      continue
    }
    const targetType = toValueTypeFromFieldType(field.type)
    if (isTypeCompatible(sourceValueType, targetType)) {
      return handleId
    }
  }

  return null
}

const resolveQuickInsertSourceHandle = (kind: NodeKind, targetValueType: HandleValueType): string | null => {
  const spec = getNodePortSpec(kind)

  if (targetValueType === 'control') {
    const controlOutput = spec.outputs.find((output) => CONTROL_FLOW_SOURCE_HANDLES.has(output.id))
    return controlOutput?.id ?? null
  }

  const dataOutputs = spec.outputs.filter((output) => !CONTROL_FLOW_SOURCE_HANDLES.has(output.id))
  if (dataOutputs.length === 0) {
    return null
  }

  if (kind === 'varGet') {
    return dataOutputs.some((output) => output.id === 'value') ? 'value' : dataOutputs[0].id
  }

  if (kind === 'constValue') {
    return dataOutputs.some((output) => output.id === 'value') ? 'value' : dataOutputs[0].id
  }

  return dataOutputs[0].id
}

const getClientPoint = (event: MouseEvent | TouchEvent) => {
  if ('touches' in event) {
    const point = event.changedTouches[0] ?? event.touches[0]
    if (!point) return null
    return { x: point.clientX, y: point.clientY }
  }

  return { x: event.clientX, y: event.clientY }
}

function InnerFlowEditor({ onPaneClick }: { onPaneClick?: () => void }) {
  const {
    nodes,
    edges,
    onNodesChange,
    onEdgesChange,
    onConnect: connectNodes,
    onReconnect,
    disconnectHandleConnections,
    setSelectedNode,
    addNode,
    setCursor,
  } = useWorkflowStore()
  const setZoom = useSettingsStore((state) => state.setZoom)
  const reactFlow = useReactFlow()
  const pendingConnectStartRef = useRef<PendingConnectStart | null>(null)
  const quickSearchInputRef = useRef<HTMLInputElement>(null)

  const nodeTypes = useMemo(
    () => ({
      mouseClick: ClickNode,
      screenshot: ScreenshotNode,
      keyboardKey: KeyPressNode,
      keyboardInput: KeyPressNode,
      keyboardDown: KeyPressNode,
      keyboardUp: KeyPressNode,
      shortcut: KeyPressNode,
      imageMatch: ImageMatchNode,
      condition: ConditionNode,
      loop: LoopNode,
      whileLoop: LoopNode,
      varDefine: VariableNode,
      varSet: VariableNode,
      varMath: VariableNode,
      varGet: VariableNode,
      constValue: VariableNode,
      manualTrigger: VariableNode,
      hotkeyTrigger: VariableNode,
      timerTrigger: VariableNode,
      windowTrigger: VariableNode,
      mouseMove: ClickNode,
      mouseDrag: ClickNode,
      mouseWheel: ClickNode,
      mouseDown: ClickNode,
      mouseUp: ClickNode,
      windowActivate: ClickNode,
      fileCopy: ClickNode,
      fileMove: ClickNode,
      fileDelete: ClickNode,
      runCommand: ClickNode,
      pythonCode: ClickNode,
      clipboardRead: ClickNode,
      clipboardWrite: ClickNode,
      fileReadText: ClickNode,
      fileWriteText: ClickNode,
      showMessage: ClickNode,
      delay: ClickNode,
    }),
    [],
  )

  const wrapperRef = useRef<HTMLDivElement>(null)
  const [quickInsert, setQuickInsert] = useState<NodeQuickInsertState | null>(null)
  const [quickInsertKeyword, setQuickInsertKeyword] = useState('')

  const quickInsertItems = useMemo(
    () =>
      allowedKinds
        .map((kind) => {
          const meta = getNodeMeta(kind)
          return {
            kind,
            label: meta.label,
            searchText: `${meta.label} ${kind}`.toLowerCase(),
          }
        }),
    [],
  )

  const filteredQuickInsertItems = useMemo(() => {
    if (!quickInsert) return []

    const keyword = quickInsertKeyword.trim().toLowerCase()
    const pendingNode = nodes.find((node) => node.id === quickInsert.pendingNodeId)
    if (!pendingNode) return []

    const typeMatchedItems = quickInsertItems.filter((item) => {
      if (quickInsert.pendingHandleType === 'source') {
        const sourceValueType = resolveSourceHandleValueType(
          pendingNode.data.kind,
          pendingNode.data.params,
          quickInsert.pendingHandleId,
        )
        if (!sourceValueType) return false
        return Boolean(resolveQuickInsertTargetHandle(item.kind, sourceValueType))
      }

      const targetValueType = resolveTargetHandleValueType(pendingNode.data.kind, quickInsert.pendingHandleId)
      if (!targetValueType) return false
      const sourceHandle = resolveQuickInsertSourceHandle(item.kind, targetValueType)
      if (!sourceHandle) return false

      if (sourceHandle === 'value' && item.kind === 'constValue') {
        return true
      }

      const meta = getNodeMeta(item.kind)
      const sourceType = resolveSourceHandleValueType(item.kind, meta.defaultParams, sourceHandle)
      return Boolean(sourceType && isTypeCompatible(sourceType, targetValueType))
    })

    if (!keyword) return typeMatchedItems
    return typeMatchedItems.filter((item) => item.searchText.includes(keyword))
  }, [nodes, quickInsert, quickInsertItems, quickInsertKeyword])

  const closeQuickInsert = useCallback(() => {
    setQuickInsert(null)
    setQuickInsertKeyword('')
  }, [])

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

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void reactFlow.fitView({ duration: 0, padding: 0.2 })
      setZoom(reactFlow.getZoom())
    }, 0)

    return () => {
      window.clearTimeout(timer)
    }
  }, [reactFlow, setZoom])

  const [modalOpen, setModalOpen] = useState(false)

  useEffect(() => {
    if (!quickInsert) return
    quickSearchInputRef.current?.focus()
  }, [quickInsert])

  const onNodeDoubleClick: NodeMouseHandler = useCallback((_, node) => {
    setSelectedNode(node.id)
    setModalOpen(true)
  }, [setSelectedNode])

  const handlePaneClick = useCallback(() => {
    setSelectedNode(null)
    closeQuickInsert()
    onPaneClick?.()
  }, [setSelectedNode, closeQuickInsert, onPaneClick])

  const handleConnect = useCallback(
    (connection: Connection) => {
      closeQuickInsert()
      connectNodes(connection)
    },
    [closeQuickInsert, connectNodes],
  )

  const onPaneMouseMove = useCallback(
    (event: React.MouseEvent<Element>) => {
      const point = reactFlow.screenToFlowPosition({ x: event.clientX, y: event.clientY })
      setCursor(Math.round(point.x), Math.round(point.y))
    },
    [reactFlow, setCursor],
  )

  const onConnectStart = useCallback(
    (_event: MouseEvent | TouchEvent, params: OnConnectStartParams) => {
      if (!params.nodeId || !params.handleType) {
        pendingConnectStartRef.current = null
        return
      }

      pendingConnectStartRef.current = {
        nodeId: params.nodeId,
        handleType: params.handleType,
        handleId: params.handleId ?? null,
      }

      disconnectHandleConnections(params.nodeId, params.handleType, params.handleId ?? null)
    },
    [disconnectHandleConnections],
  )

  const onConnectEnd = useCallback(
    (event: MouseEvent | TouchEvent, connectionState: FinalConnectionState) => {
      const pending = pendingConnectStartRef.current
      pendingConnectStartRef.current = null

      if (!pending || connectionState.isValid) {
        return
      }

      const clientPoint = getClientPoint(event)
      if (!clientPoint || !wrapperRef.current) {
        return
      }

      const rect = wrapperRef.current.getBoundingClientRect()
      const panelWidth = 280
      const panelHeight = 280
      const panelX = Math.min(Math.max(clientPoint.x - rect.left + 8, 8), Math.max(8, rect.width - panelWidth - 8))
      const panelY = Math.min(Math.max(clientPoint.y - rect.top + 8, 8), Math.max(8, rect.height - panelHeight - 8))
      const flowPosition = reactFlow.screenToFlowPosition({ x: clientPoint.x, y: clientPoint.y })

      window.setTimeout(() => {
        setQuickInsert({
          pendingNodeId: pending.nodeId,
          pendingHandleType: pending.handleType,
          pendingHandleId: pending.handleId,
          flowX: flowPosition.x,
          flowY: flowPosition.y,
          panelX,
          panelY,
        })
        setQuickInsertKeyword('')
      }, 0)
    },
    [reactFlow],
  )

  const insertNodeAndConnect = useCallback(
    (kind: NodeKind) => {
      if (!quickInsert) return

      const createdNodeId = addNode(kind, { x: quickInsert.flowX, y: quickInsert.flowY })
      const pendingNode = nodes.find((node) => node.id === quickInsert.pendingNodeId)

      if (!pendingNode) {
        closeQuickInsert()
        return
      }

      if (quickInsert.pendingHandleType === 'source') {
        const sourceHandle = normalizeSourceHandleId(pendingNode.data.kind, quickInsert.pendingHandleId)
        const sourceValueType = resolveSourceHandleValueType(
          pendingNode.data.kind,
          pendingNode.data.params,
          quickInsert.pendingHandleId,
        )
        const quickTargetHandle = sourceValueType ? resolveQuickInsertTargetHandle(kind, sourceValueType) : null
        const targetHandle = normalizeTargetHandleId(kind, quickTargetHandle)

        if (sourceHandle && targetHandle) {
          connectNodes({
            source: pendingNode.id,
            sourceHandle,
            target: createdNodeId,
            targetHandle,
          })
        }
      } else {
        const targetHandle = normalizeTargetHandleId(pendingNode.data.kind, quickInsert.pendingHandleId)
        const targetValueType = resolveTargetHandleValueType(pendingNode.data.kind, quickInsert.pendingHandleId)
        const quickSourceHandle = targetValueType ? resolveQuickInsertSourceHandle(kind, targetValueType) : null

        const sourceMeta = getNodeMeta(kind)
        const sourceType = quickSourceHandle
          ? resolveSourceHandleValueType(kind, sourceMeta.defaultParams, quickSourceHandle)
          : null
        const sourceHandle = normalizeSourceHandleId(kind, quickSourceHandle)

        if (sourceHandle && targetHandle && sourceType && targetValueType && isTypeCompatible(sourceType, targetValueType)) {
          connectNodes({
            source: createdNodeId,
            sourceHandle,
            target: pendingNode.id,
            targetHandle,
          })
        }
      }

      closeQuickInsert()
    },
    [addNode, closeQuickInsert, connectNodes, nodes, quickInsert],
  )

  const onReconnectEdge = useCallback(
    (oldEdge: Edge, connection: Connection) => {
      onReconnect(oldEdge, connection)
    },
    [onReconnect],
  )

  const isValidConnection = useCallback(
    (connection: { source?: string | null; target?: string | null; sourceHandle?: string | null; targetHandle?: string | null }) => {
      const { source, target, sourceHandle, targetHandle } = connection
      if (!source || !target || !sourceHandle || !targetHandle) return false

      const sourceIsParam = isParamOutputHandleId(sourceHandle)
      if (sourceIsParam) return false

      const sourceNode = nodes.find((node) => node.id === source)
      const targetNode = nodes.find((node) => node.id === target)
      if (!sourceNode || !targetNode) return false

      const normalizedSource = normalizeSourceHandleId(sourceNode.data.kind, sourceHandle)
      const normalizedTarget = normalizeTargetHandleId(targetNode.data.kind, targetHandle)
      if (!normalizedSource || !normalizedTarget) return false

      const sourceType = resolveSourceHandleValueType(sourceNode.data.kind, sourceNode.data.params, normalizedSource)
      const targetType = resolveTargetHandleValueType(targetNode.data.kind, normalizedTarget)
      if (!sourceType || !targetType) return false

      return isTypeCompatible(sourceType, targetType)
    },
    [nodes],
  )

  const renderedEdges = useMemo(
    () =>
      edges.map((edge) => ({
        ...edge,
        animated: false,
        style: {
          stroke: '#0891b2',
          strokeWidth: 2,
          ...edge.style,
        },
      })),
    [edges],
  )

  return (
    <div
      ref={wrapperRef}
      className="relative h-full w-full bg-slate-50 dark:bg-neutral-950 transition-colors"
    >
      <ReactFlow
        nodes={nodes}
        edges={renderedEdges}
        nodeTypes={nodeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={handleConnect}
        isValidConnection={isValidConnection}
        onConnectStart={onConnectStart}
        onConnectEnd={onConnectEnd}
        onReconnect={onReconnectEdge}
        onMove={(_, viewport) => setZoom(viewport.zoom)}
        onNodeDoubleClick={onNodeDoubleClick}
        onPaneClick={handlePaneClick}
        onPaneMouseMove={onPaneMouseMove}
        edgesReconnectable
        reconnectRadius={28}
        connectionRadius={24}
        selectionMode={SelectionMode.Partial}
        selectionKeyCode="Control"
        multiSelectionKeyCode="Control"
        panOnDrag={[0, 1, 2]}
        snapToGrid={false}
        snapGrid={[15, 15]}
        defaultEdgeOptions={{
          animated: false,
          style: { stroke: '#0891b2', strokeWidth: 2 },
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
          className="!flex !flex-col !mb-20 !mr-6 !bg-white/80 dark:!bg-neutral-900/80 !border !border-slate-200 dark:!border-neutral-800 !shadow-2xl !rounded-lg overflow-hidden !p-0"
          showInteractive={false}
          position="bottom-right"
        />
        <PropertyModal open={modalOpen} onClose={() => setModalOpen(false)} />
      </ReactFlow>

      {quickInsert ? (
        <>
          <button
            type="button"
            aria-label="关闭节点搜索"
            className="absolute inset-0 z-[140] cursor-default bg-transparent"
            onClick={closeQuickInsert}
          />
          <div
            className="absolute z-[150] w-[280px] rounded-xl border border-slate-200 bg-white/95 p-2 shadow-2xl backdrop-blur dark:border-neutral-700 dark:bg-neutral-900/95"
            style={{ left: quickInsert.panelX, top: quickInsert.panelY }}
            onClick={(event) => event.stopPropagation()}
          >
            <input
              ref={quickSearchInputRef}
              value={quickInsertKeyword}
              onChange={(event) => setQuickInsertKeyword(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Escape') {
                  event.preventDefault()
                  closeQuickInsert()
                  return
                }

                if (event.key === 'Enter' && filteredQuickInsertItems.length > 0) {
                  event.preventDefault()
                  insertNodeAndConnect(filteredQuickInsertItems[0].kind)
                }
              }}
              placeholder="检索节点（如：条件、点击、变量）"
              className="mb-2 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-700 outline-none transition-colors focus:border-cyan-500 dark:border-neutral-700 dark:bg-neutral-950 dark:text-slate-100"
            />
            <div className="max-h-56 overflow-y-auto">
              {filteredQuickInsertItems.length > 0 ? (
                filteredQuickInsertItems.map((item) => (
                  <button
                    key={item.kind}
                    type="button"
                    className="mb-1 block w-full rounded-lg px-3 py-2 text-left text-xs text-slate-700 transition-colors hover:bg-cyan-500 hover:text-white dark:text-slate-200"
                    onClick={() => insertNodeAndConnect(item.kind)}
                  >
                    {item.label}
                  </button>
                ))
              ) : (
                <div className="px-2 py-3 text-xs text-slate-400 dark:text-slate-500">没有匹配的节点</div>
              )}
            </div>
          </div>
        </>
      ) : null}
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
