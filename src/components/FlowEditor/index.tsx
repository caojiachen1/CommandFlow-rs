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
  useUpdateNodeInternals,
} from '@xyflow/react'
import { createPortal } from 'react-dom'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { FinalConnectionState } from '@xyflow/system'
import { useWorkflowStore } from '../../stores/workflowStore'
import { useSettingsStore } from '../../stores/settingsStore'
import type { NodeKind } from '../../types/workflow'
import { getNodeFields, getNodeMeta } from '../../utils/nodeMeta'
import { COMMAND_FLOW_REFRESH_ALL_EVENT } from '../../utils/refresh'
import {
  getInputHandleValueType,
  getNodePortSpec,
  getOutputHandleValueType,
  isHandleValueTypeCompatible,
  isParamInputHandleId,
  isParamOutputHandleId,
  normalizeSourceHandleId,
  normalizeTargetHandleId,
} from '../../utils/nodePorts'
import { ALL_NODE_KINDS, getNodePaletteItem } from '../../utils/nodeCatalog'
import ClickNode from '../../nodes/ClickNode'
import ConditionNode from '../../nodes/ConditionNode'
import ImageMatchNode from '../../nodes/ImageMatchNode'
import OcrMatchNode from '../../nodes/OcrMatchNode'
import InputPresetReplayNode from '../../nodes/InputPresetReplayNode'
import KeyPressNode from '../../nodes/KeyPressNode'
import LoopNode from '../../nodes/LoopNode'
import TryCatchNode from '../../nodes/TryCatchNode'
import ScreenshotNode from '../../nodes/ScreenshotNode'
import VariableNode from '../../nodes/VariableNode'
import PropertyModal from '../PropertyModal'

const allowedKinds: NodeKind[] = ALL_NODE_KINDS

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

interface GlobalNodeInsertState {
  flowX: number
  flowY: number
}

function NodeThumbnailPreview({ kind }: { kind: NodeKind }) {
  const meta = getNodeMeta(kind)
  const paletteItem = getNodePaletteItem(kind)
  const visibleFields = getNodeFields(kind, meta.defaultParams, meta.defaultParams).slice(0, 3)

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-neutral-700 dark:bg-neutral-900/90">
      <div className="flex items-start gap-3">
        <div className={`mt-1 h-3 w-3 shrink-0 rounded-full ${paletteItem.color}`} />
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold text-slate-900 dark:text-slate-100">{meta.label}</div>
          <div className="mt-1 text-xs leading-5 text-slate-500 dark:text-slate-400">{meta.description}</div>
        </div>
      </div>

      <div className="mt-4 rounded-xl border border-slate-200/80 bg-slate-50/80 p-3 dark:border-neutral-700 dark:bg-neutral-950/80">
        <div className="flex items-center justify-between gap-2">
          <span className="truncate text-[11px] font-semibold text-slate-700 dark:text-slate-200">{meta.label}</span>
          <span className="rounded-full bg-slate-200 px-2 py-0.5 text-[10px] font-medium text-slate-600 dark:bg-neutral-800 dark:text-slate-300">
            {paletteItem.category}
          </span>
        </div>

        <div className="mt-3 space-y-2">
          {visibleFields.length > 0 ? (
            visibleFields.map((field) => (
              <div key={field.key} className="flex items-center gap-2">
                <span className="w-20 shrink-0 text-[10px] font-medium text-slate-500 dark:text-slate-400">{field.label}</span>
                <span className="h-7 flex-1 rounded-full border border-slate-200 bg-white/90 px-3 py-1 text-[10px] text-slate-400 dark:border-neutral-700 dark:bg-neutral-900 dark:text-slate-500">
                  {field.placeholder ?? '默认参数'}
                </span>
              </div>
            ))
          ) : (
            <div className="rounded-xl border border-dashed border-slate-200 px-3 py-3 text-[10px] text-slate-400 dark:border-neutral-700 dark:text-slate-500">
              该节点无需额外参数，添加即可使用。
            </div>
          )}
        </div>
      </div>

      <div className="mt-3 flex items-center justify-between text-[10px] text-slate-400 dark:text-slate-500">
        <span>{kind}</span>
        <span>点击此预览可直接添加</span>
      </div>
    </div>
  )
}

const resolveSourceHandleValueType = (
  kind: NodeKind,
  params: Record<string, unknown>,
  sourceHandleId: string | null,
): ReturnType<typeof getOutputHandleValueType> => {
  const normalizedSource = normalizeSourceHandleId(kind, sourceHandleId, params)
  if (!normalizedSource) return null
  return getOutputHandleValueType(kind, normalizedSource, params)
}

const resolveTargetHandleValueType = (
  kind: NodeKind,
  params: Record<string, unknown>,
  targetHandleId: string | null,
) => {
  const normalizedTarget = normalizeTargetHandleId(kind, targetHandleId, params)
  if (!normalizedTarget) return null
  return getInputHandleValueType(kind, normalizedTarget, params)
}

const resolveQuickInsertTargetHandle = (
  kind: NodeKind,
  sourceValueType: NonNullable<ReturnType<typeof getOutputHandleValueType>>,
): string | null => {
  const spec = getNodePortSpec(kind)

  if (sourceValueType === 'control') {
    return spec.inputs.some((input) => input.id === 'in') ? 'in' : null
  }

  for (const input of spec.inputs) {
    if (!isParamInputHandleId(input.id)) {
      continue
    }
    const targetType = getInputHandleValueType(kind, input.id, getNodeMeta(kind).defaultParams)
    if (targetType && isHandleValueTypeCompatible(sourceValueType, targetType)) {
      return input.id
    }
  }

  return null
}

const resolveQuickInsertSourceHandle = (
  kind: NodeKind,
  targetValueType: NonNullable<ReturnType<typeof getInputHandleValueType>>,
): string | null => {
  const spec = getNodePortSpec(kind)

  if (targetValueType === 'control') {
    const controlOutput = spec.outputs.find(
      (output) => getOutputHandleValueType(kind, output.id, getNodeMeta(kind).defaultParams) === 'control',
    )
    return controlOutput?.id ?? null
  }

  const meta = getNodeMeta(kind)
  const dataOutputs = spec.outputs.filter(
    (output) => getOutputHandleValueType(kind, output.id, meta.defaultParams) !== 'control',
  )
  if (dataOutputs.length === 0) {
    return null
  }

  const firstTypedMatch = dataOutputs.find((output) => {
    const sourceType = getOutputHandleValueType(kind, output.id, meta.defaultParams)
    return Boolean(sourceType && isHandleValueTypeCompatible(sourceType, targetValueType))
  })

  if (firstTypedMatch) {
    return firstTypedMatch.id
  }

  return null
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
    setSelectedNode,
    addNode,
  } = useWorkflowStore()
  const setZoom = useSettingsStore((state) => state.setZoom)
  const reactFlow = useReactFlow()
  const updateNodeInternals = useUpdateNodeInternals()
  const pendingConnectStartRef = useRef<PendingConnectStart | null>(null)
  const quickSearchInputRef = useRef<HTMLInputElement>(null)
  const globalSearchInputRef = useRef<HTMLInputElement>(null)

  const nodeTypes = useMemo(
    () => ({
      uiaElement: ClickNode,
      mouseOperation: ClickNode,
      screenshot: ScreenshotNode,
      keyboardOperation: KeyPressNode,
      inputPresetReplay: InputPresetReplayNode,
      imageMatch: ImageMatchNode,
      ocrMatch: OcrMatchNode,
      condition: ConditionNode,
      loop: LoopNode,
      whileLoop: LoopNode,
      tryCatch: TryCatchNode,
      varDefine: VariableNode,
      varSet: VariableNode,
      varMath: VariableNode,
      varGet: VariableNode,
      constValue: VariableNode,
      jsonExtract: VariableNode,
      trigger: VariableNode,
      windowActivate: ClickNode,
      launchApplication: ClickNode,
      fileOperation: ClickNode,
      pythonCode: ClickNode,
      clipboardRead: ClickNode,
      clipboardWrite: ClickNode,
      showMessage: ClickNode,
      delay: ClickNode,
      systemOperation: ClickNode,
      guiAgent: ClickNode,
      guiAgentActionParser: ClickNode,
    }),
    [],
  )

  const wrapperRef = useRef<HTMLDivElement>(null)
  const [quickInsert, setQuickInsert] = useState<NodeQuickInsertState | null>(null)
  const [quickInsertKeyword, setQuickInsertKeyword] = useState('')
  const [globalInsert, setGlobalInsert] = useState<GlobalNodeInsertState | null>(null)
  const [globalInsertKeyword, setGlobalInsertKeyword] = useState('')
  const [globalHoveredKind, setGlobalHoveredKind] = useState<NodeKind | null>(null)

  const quickInsertItems = useMemo(
    () =>
      allowedKinds
        .map((kind) => {
          const meta = getNodeMeta(kind)
          const paletteItem = getNodePaletteItem(kind)
          return {
            kind,
            label: meta.label,
            description: meta.description,
            category: paletteItem.category,
            color: paletteItem.color,
            searchText: `${meta.label} ${meta.description} ${paletteItem.category} ${kind}`.toLowerCase(),
          }
        }),
    [],
  )

  const filteredGlobalInsertItems = useMemo(() => {
    if (!globalInsert) return []

    const keyword = globalInsertKeyword.trim().toLowerCase()
    if (!keyword) return quickInsertItems
    return quickInsertItems.filter((item) => item.searchText.includes(keyword))
  }, [globalInsert, globalInsertKeyword, quickInsertItems])

  const hoveredGlobalInsertItem = useMemo(() => {
    if (filteredGlobalInsertItems.length === 0) return null
    return (
      filteredGlobalInsertItems.find((item) => item.kind === globalHoveredKind) ?? filteredGlobalInsertItems[0]
    )
  }, [filteredGlobalInsertItems, globalHoveredKind])

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

      const targetValueType = resolveTargetHandleValueType(
        pendingNode.data.kind,
        pendingNode.data.params,
        quickInsert.pendingHandleId,
      )
      if (!targetValueType) return false
      const sourceHandle = resolveQuickInsertSourceHandle(item.kind, targetValueType)
      if (!sourceHandle) return false

      if (sourceHandle === 'value' && item.kind === 'constValue') {
        return true
      }

      const meta = getNodeMeta(item.kind)
      const sourceType = resolveSourceHandleValueType(item.kind, meta.defaultParams, sourceHandle)
      return Boolean(sourceType && isHandleValueTypeCompatible(sourceType, targetValueType))
    })

    if (!keyword) return typeMatchedItems
    return typeMatchedItems.filter((item) => item.searchText.includes(keyword))
  }, [nodes, quickInsert, quickInsertItems, quickInsertKeyword])

  const closeQuickInsert = useCallback(() => {
    setQuickInsert(null)
    setQuickInsertKeyword('')
  }, [])

  const closeGlobalInsert = useCallback(() => {
    setGlobalInsert(null)
    setGlobalInsertKeyword('')
    setGlobalHoveredKind(null)
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
    const wrapper = wrapperRef.current
    if (!wrapper) return

    let frameId = 0
    let paneEl: HTMLElement | null = null

    const handlePaneDoubleClick = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null
      if (!target) {
        return
      }

      if (
        target.closest('.react-flow__node') ||
        target.closest('.react-flow__edge') ||
        target.closest('.react-flow__handle') ||
        target.closest('.react-flow__controls') ||
        target.closest('.react-flow__selection')
      ) {
        return
      }

      event.preventDefault()
      event.stopPropagation()

      const flowPosition = reactFlow.screenToFlowPosition({ x: event.clientX, y: event.clientY })
      setSelectedNode(null)
      closeQuickInsert()
      setGlobalInsert({
        flowX: flowPosition.x,
        flowY: flowPosition.y,
      })
      setGlobalInsertKeyword('')
      setGlobalHoveredKind(quickInsertItems[0]?.kind ?? null)
      onPaneClick?.()
    }

    const attachListener = () => {
      paneEl = wrapper.querySelector('.react-flow__pane') as HTMLElement | null
      if (!paneEl) {
        frameId = window.requestAnimationFrame(attachListener)
        return
      }

      paneEl.addEventListener('dblclick', handlePaneDoubleClick)
    }

    attachListener()

    return () => {
      if (frameId) {
        window.cancelAnimationFrame(frameId)
      }
      paneEl?.removeEventListener('dblclick', handlePaneDoubleClick)
    }
  }, [reactFlow, setSelectedNode, closeQuickInsert, quickInsertItems, onPaneClick])

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

  useEffect(() => {
    const handleGlobalRefresh = () => {
      const nodeIds = nodes.map((node) => node.id)
      if (nodeIds.length === 0) {
        return
      }

      window.requestAnimationFrame(() => {
        nodeIds.forEach((nodeId) => updateNodeInternals(nodeId))

        window.requestAnimationFrame(() => {
          nodeIds.forEach((nodeId) => updateNodeInternals(nodeId))
        })
      })
    }

    window.addEventListener(COMMAND_FLOW_REFRESH_ALL_EVENT, handleGlobalRefresh)
    return () => {
      window.removeEventListener(COMMAND_FLOW_REFRESH_ALL_EVENT, handleGlobalRefresh)
    }
  }, [nodes, updateNodeInternals])

  const [modalOpen, setModalOpen] = useState(false)

  useEffect(() => {
    if (!quickInsert) return
    quickSearchInputRef.current?.focus()
  }, [quickInsert])

  useEffect(() => {
    if (!globalInsert) return
    globalSearchInputRef.current?.focus()
  }, [globalInsert])

  useEffect(() => {
    if (!globalInsert) return

    const firstKind = filteredGlobalInsertItems[0]?.kind ?? null
    if (!firstKind) {
      setGlobalHoveredKind(null)
      return
    }

    setGlobalHoveredKind((current) =>
      current && filteredGlobalInsertItems.some((item) => item.kind === current) ? current : firstKind,
    )
  }, [filteredGlobalInsertItems, globalInsert])

  useEffect(() => {
    if (!globalInsert) return

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        closeGlobalInsert()
      }
    }

    document.addEventListener('keydown', handleEscape)
    return () => {
      document.removeEventListener('keydown', handleEscape)
    }
  }, [closeGlobalInsert, globalInsert])

  const onNodeDoubleClick: NodeMouseHandler = useCallback((_, node) => {
    setSelectedNode(node.id)
    setModalOpen(true)
  }, [setSelectedNode])

  const handlePaneClick = useCallback(() => {
    setSelectedNode(null)
    closeQuickInsert()
    closeGlobalInsert()
    onPaneClick?.()
  }, [setSelectedNode, closeQuickInsert, closeGlobalInsert, onPaneClick])

  const handleConnect = useCallback(
    (connection: Connection) => {
      closeQuickInsert()
      closeGlobalInsert()
      connectNodes(connection)
    },
    [closeQuickInsert, closeGlobalInsert, connectNodes],
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

      closeGlobalInsert()
    },
    [closeGlobalInsert],
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
        const sourceHandle = normalizeSourceHandleId(
          pendingNode.data.kind,
          quickInsert.pendingHandleId,
          pendingNode.data.params,
        )
        const sourceValueType = resolveSourceHandleValueType(
          pendingNode.data.kind,
          pendingNode.data.params,
          quickInsert.pendingHandleId,
        )
        const quickTargetHandle = sourceValueType ? resolveQuickInsertTargetHandle(kind, sourceValueType) : null
        const targetHandle = normalizeTargetHandleId(kind, quickTargetHandle, getNodeMeta(kind).defaultParams)

        if (sourceHandle && targetHandle) {
          connectNodes({
            source: pendingNode.id,
            sourceHandle,
            target: createdNodeId,
            targetHandle,
          })
        }
      } else {
        const targetHandle = normalizeTargetHandleId(
          pendingNode.data.kind,
          quickInsert.pendingHandleId,
          pendingNode.data.params,
        )
        const targetValueType = resolveTargetHandleValueType(
          pendingNode.data.kind,
          pendingNode.data.params,
          quickInsert.pendingHandleId,
        )
        const quickSourceHandle = targetValueType ? resolveQuickInsertSourceHandle(kind, targetValueType) : null

        const sourceMeta = getNodeMeta(kind)
        const sourceType = quickSourceHandle
          ? resolveSourceHandleValueType(kind, sourceMeta.defaultParams, quickSourceHandle)
          : null
        const sourceHandle = normalizeSourceHandleId(kind, quickSourceHandle, sourceMeta.defaultParams)

        if (
          sourceHandle &&
          targetHandle &&
          sourceType &&
          targetValueType &&
          isHandleValueTypeCompatible(sourceType, targetValueType)
        ) {
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

  const insertNodeFromGlobalSearch = useCallback(
    (kind: NodeKind) => {
      if (!globalInsert) return

      const createdNodeId = addNode(kind, { x: globalInsert.flowX, y: globalInsert.flowY })
      setSelectedNode(createdNodeId)
      closeGlobalInsert()
    },
    [addNode, closeGlobalInsert, globalInsert, setSelectedNode],
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

      const normalizedSource = normalizeSourceHandleId(sourceNode.data.kind, sourceHandle, sourceNode.data.params)
      const normalizedTarget = normalizeTargetHandleId(targetNode.data.kind, targetHandle, targetNode.data.params)
      if (!normalizedSource || !normalizedTarget) return false

      const sourceType = resolveSourceHandleValueType(sourceNode.data.kind, sourceNode.data.params, normalizedSource)
      const targetType = resolveTargetHandleValueType(targetNode.data.kind, targetNode.data.params, normalizedTarget)
      if (!sourceType || !targetType) return false

      return isHandleValueTypeCompatible(sourceType, targetType)
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
        edgesReconnectable
        reconnectRadius={28}
        connectionRadius={24}
        selectionMode={SelectionMode.Partial}
        selectionKeyCode="Control"
        multiSelectionKeyCode="Control"
        panOnDrag={[0, 1, 2]}
        zoomOnDoubleClick={false}
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

      {globalInsert
        ? createPortal(
            <div className="fixed inset-0 z-[240] flex items-center justify-center">
              <button
                type="button"
                aria-label="关闭全局节点搜索"
                className="absolute inset-0 bg-black/38 transition-colors dark:bg-black/55"
                onClick={closeGlobalInsert}
              />

              <div
                className="relative z-[241] mx-4 flex h-[560px] max-h-[78vh] w-full max-w-4xl flex-col overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-2xl dark:border-neutral-700 dark:bg-neutral-900"
                onClick={(event) => event.stopPropagation()}
              >
                <div className="border-b border-slate-200 px-6 py-5 dark:border-neutral-800">
                  <div className="mb-2 flex items-center justify-between gap-3">
                    <div>
                      <h3 className="text-lg font-semibold text-slate-900 dark:text-slate-100">添加节点</h3>
                      <p className="text-xs text-slate-500 dark:text-slate-400">双击画板空白处即可呼出，点击预览或右侧列表即可添加节点。</p>
                    </div>
                    <button
                      type="button"
                      onClick={closeGlobalInsert}
                      className="rounded-full border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-500 transition-colors hover:border-cyan-500 hover:text-cyan-600 dark:border-neutral-700 dark:text-slate-400 dark:hover:border-cyan-500 dark:hover:text-cyan-400"
                    >
                      Esc 关闭
                    </button>
                  </div>

                  <input
                    ref={globalSearchInputRef}
                    value={globalInsertKeyword}
                    onChange={(event) => setGlobalInsertKeyword(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' && hoveredGlobalInsertItem) {
                        event.preventDefault()
                        insertNodeFromGlobalSearch(hoveredGlobalInsertItem.kind)
                      }
                    }}
                    placeholder="搜索节点（例如：条件、点击、变量、截图、系统）"
                    className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700 outline-none transition-colors focus:border-cyan-500 focus:bg-white dark:border-neutral-700 dark:bg-neutral-950 dark:text-slate-100"
                  />
                </div>

                <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[280px_minmax(0,1fr)]">
                  <div className="border-b border-slate-200 bg-slate-50/70 p-5 dark:border-neutral-800 dark:bg-neutral-950/60 lg:border-b-0 lg:border-r">
                    <div className="mb-3 flex items-center justify-between">
                      <span className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">缩略图预览</span>
                      {hoveredGlobalInsertItem ? (
                        <span className="text-[11px] text-slate-400 dark:text-slate-500">悬停右侧条目可切换</span>
                      ) : null}
                    </div>

                    {hoveredGlobalInsertItem ? (
                      <button
                        type="button"
                        onClick={() => insertNodeFromGlobalSearch(hoveredGlobalInsertItem.kind)}
                        className="block w-full text-left transition-transform hover:scale-[1.01]"
                      >
                        <NodeThumbnailPreview kind={hoveredGlobalInsertItem.kind} />
                      </button>
                    ) : (
                      <div className="flex h-[320px] items-center justify-center rounded-2xl border border-dashed border-slate-200 bg-white/70 px-6 text-center text-sm text-slate-400 dark:border-neutral-700 dark:bg-neutral-900/60 dark:text-slate-500 lg:h-full">
                        没有匹配的节点，试试换个关键词。
                      </div>
                    )}
                  </div>

                  <div className="flex min-h-0 flex-col p-5">
                    <div className="mb-3 flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
                      <span>搜索结果</span>
                      <span>{filteredGlobalInsertItems.length} 个节点</span>
                    </div>

                    <div className="h-[320px] overflow-y-auto pr-1 lg:h-full">
                      {filteredGlobalInsertItems.length > 0 ? (
                        <div className="space-y-2">
                          {filteredGlobalInsertItems.map((item) => (
                            <button
                              key={item.kind}
                              type="button"
                              onMouseEnter={() => setGlobalHoveredKind(item.kind)}
                              onFocus={() => setGlobalHoveredKind(item.kind)}
                              onClick={() => insertNodeFromGlobalSearch(item.kind)}
                              className={`block w-full rounded-2xl border px-4 py-3 text-left transition-all ${
                                hoveredGlobalInsertItem?.kind === item.kind
                                  ? 'border-cyan-500 bg-cyan-50 shadow-sm dark:bg-cyan-500/10'
                                  : 'border-slate-200 bg-white hover:border-cyan-300 hover:bg-slate-50 dark:border-neutral-800 dark:bg-neutral-900/60 dark:hover:border-cyan-500 dark:hover:bg-neutral-900'
                              }`}
                            >
                              <div className="flex items-start gap-3">
                                <div className={`mt-1 h-2.5 w-2.5 shrink-0 rounded-full ${item.color}`} />
                                <div className="min-w-0 flex-1">
                                  <div className="flex items-center gap-2">
                                    <span className="truncate text-sm font-semibold text-slate-800 dark:text-slate-100">{item.label}</span>
                                    <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-500 dark:bg-neutral-800 dark:text-slate-400">
                                      {item.category}
                                    </span>
                                  </div>
                                  <div className="mt-1 line-clamp-2 text-xs leading-5 text-slate-500 dark:text-slate-400">
                                    {item.description}
                                  </div>
                                  <div className="mt-2 text-[10px] text-slate-400 dark:text-slate-500">{item.kind}</div>
                                </div>
                              </div>
                            </button>
                          ))}
                        </div>
                      ) : (
                        <div className="flex h-full min-h-[220px] items-center justify-center rounded-2xl border border-dashed border-slate-200 bg-slate-50/70 px-6 text-center text-sm text-slate-400 dark:border-neutral-700 dark:bg-neutral-950/60 dark:text-slate-500">
                          没有找到匹配节点，换个关键词再试试～
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </div>,
            document.body,
          )
        : null}
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
