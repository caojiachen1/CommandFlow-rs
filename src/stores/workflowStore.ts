import {
  addEdge,
  applyEdgeChanges,
  applyNodeChanges,
  type Connection,
  type EdgeChange,
  type NodeChange,
} from '@xyflow/react'
import { create } from 'zustand'
import type { CoordinatePoint, NodeKind, WorkflowEdge, WorkflowFile, WorkflowNode } from '../types/workflow'
import { getNodeDisplayLabel, getNodeMeta } from '../utils/nodeMeta'
import {
  getInputHandleValueType,
  getInputHandleMaxConnections,
  getOutputHandleValueType,
  getOutputHandleMaxConnections,
  isHandleValueTypeCompatible,
  isParamInputHandleId,
  isParamOutputHandleId,
  normalizeSourceHandleId,
  normalizeTargetHandleId,
} from '../utils/nodePorts'

interface Snapshot {
  nodes: WorkflowNode[]
  edges: WorkflowEdge[]
}

interface WorkflowState {
  graphId: string
  graphName: string
  nodes: WorkflowNode[]
  edges: WorkflowEdge[]
  runningNodeIds: string[]
  selectedNodeId: string | null
  selectedNodeIds: string[]
  copiedNodes: WorkflowNode[] | null
  copySelectedNode: () => boolean
  pasteCopiedNode: () => boolean
  cursor: CoordinatePoint
  past: Snapshot[]
  future: Snapshot[]
  onNodesChange: (changes: NodeChange<WorkflowNode>[]) => void
  onEdgesChange: (changes: EdgeChange<WorkflowEdge>[]) => void
  onConnect: (connection: Connection) => void
  onReconnect: (oldEdge: WorkflowEdge, connection: Connection) => void
  disconnectHandleConnections: (
    nodeId: string,
    handleType: 'source' | 'target',
    handleId: string | null,
  ) => void
  setSelectedNode: (id: string | null) => void
  setSelectedNodes: (ids: string[]) => void
  setRunningNode: (id: string | null) => void
  clearRunningNodes: () => void
  setCursor: (cursor: CoordinatePoint) => void
  addNode: (kind: NodeKind, position: { x: number; y: number }) => string
  deleteSelectedNodes: () => void
  duplicateSelectedNode: () => void
  updateNodeParams: (id: string, params: Record<string, unknown>) => void
  setGraphName: (name: string) => void
  exportWorkflow: () => WorkflowFile
  importWorkflow: (file: WorkflowFile, fileName?: string) => void
  resetWorkflow: () => void
  undo: () => void
  redo: () => void
}

const cloneSnapshot = (nodes: WorkflowNode[], edges: WorkflowEdge[]): Snapshot => ({
  nodes: structuredClone(nodes),
  edges: structuredClone(edges),
})

const hasSourceHandle = (node: WorkflowNode, handleId: string | null | undefined) =>
  getOutputHandleMaxConnections(node.data.kind, String(handleId ?? ''), node.data.params) > 0

const hasTargetHandle = (node: WorkflowNode, handleId: string | null | undefined) =>
  getInputHandleMaxConnections(node.data.kind, String(handleId ?? ''), node.data.params) > 0

const deriveSelectedNodeIds = (nodes: WorkflowNode[]) =>
  nodes.filter((node) => Boolean(node.selected)).map((node) => node.id)

const pickPrimarySelectedId = (selectedNodeIds: string[], currentSelectedNodeId: string | null) => {
  if (currentSelectedNodeId && selectedNodeIds.includes(currentSelectedNodeId)) {
    return currentSelectedNodeId
  }
  return selectedNodeIds[0] ?? null
}

const resolveSelectedIds = (state: WorkflowState) => {
  if (state.selectedNodeIds.length > 0) return state.selectedNodeIds
  return state.selectedNodeId ? [state.selectedNodeId] : []
}

const shallowEqualArray = (a: string[], b: string[]) => {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) return false
  }
  return true
}

const initialNodes: WorkflowNode[] = [
  {
    id: crypto.randomUUID(),
    type: 'trigger',
    position: { x: 200, y: 120 },
    data: (() => {
      const meta = getNodeMeta('trigger')
      const params = structuredClone(meta.defaultParams)
      return {
        kind: 'trigger' as const,
        label: getNodeDisplayLabel('trigger', params, meta.label),
        params,
        description: meta.description,
      }
    })(),
  },
]

const makeInitialNodes = (): WorkflowNode[] => structuredClone(initialNodes)

const legacySystemKindToOperation = {
  runCommand: 'runCommand',
  powerShutdown: 'shutdown',
  powerRestart: 'restart',
  powerSleep: 'sleep',
  powerHibernate: 'hibernate',
  powerLock: 'lock',
  powerSignOut: 'signOut',
  systemVolumeMute: 'volumeMute',
  systemVolumeSet: 'volumeSet',
  systemVolumeAdjust: 'volumeAdjust',
  systemBrightnessSet: 'brightnessSet',
  systemWifiSwitch: 'wifiSwitch',
  systemBluetoothSwitch: 'bluetoothSwitch',
  systemNetworkAdapterSwitch: 'networkAdapterSwitch',
  systemTheme: 'theme',
  systemPowerPlan: 'powerPlan',
  systemOpenSettings: 'openSettings',
} as const

const legacyMouseKindToOperation = {
  mouseClick: 'click',
  mouseMove: 'move',
  mouseDrag: 'drag',
  mouseWheel: 'wheel',
  mouseDown: 'down',
  mouseUp: 'up',
} as const

const legacyKeyboardKindToOperation = {
  keyboardKey: 'key',
  keyboardInput: 'input',
  keyboardDown: 'down',
  keyboardUp: 'up',
  shortcut: 'shortcut',
} as const

const legacyFileKindToOperation = {
  fileCopy: 'copy',
  fileMove: 'move',
  fileDelete: 'delete',
  fileReadText: 'readText',
  fileWriteText: 'writeText',
} as const

const legacyTriggerKindToMode = {
  hotkeyTrigger: 'hotkey',
  timerTrigger: 'timer',
  manualTrigger: 'manual',
  windowTrigger: 'window',
} as const

type LegacySystemKind = keyof typeof legacySystemKindToOperation
type LegacyMouseKind = keyof typeof legacyMouseKindToOperation
type LegacyKeyboardKind = keyof typeof legacyKeyboardKindToOperation
type LegacyFileKind = keyof typeof legacyFileKindToOperation
type LegacyTriggerKind = keyof typeof legacyTriggerKindToMode

const isLegacySystemKind = (kind: string): kind is LegacySystemKind => kind in legacySystemKindToOperation
const isLegacyMouseKind = (kind: string): kind is LegacyMouseKind => kind in legacyMouseKindToOperation
const isLegacyKeyboardKind = (kind: string): kind is LegacyKeyboardKind => kind in legacyKeyboardKindToOperation
const isLegacyFileKind = (kind: string): kind is LegacyFileKind => kind in legacyFileKindToOperation
const isLegacyTriggerKind = (kind: string): kind is LegacyTriggerKind => kind in legacyTriggerKindToMode

const normalizeImportedNodeKind = (kind: string): NodeKind =>
  (isLegacyTriggerKind(kind)
    ? 'trigger'
    : isLegacySystemKind(kind)
    ? 'systemOperation'
    : isLegacyMouseKind(kind)
      ? 'mouseOperation'
      : isLegacyFileKind(kind)
        ? 'fileOperation'
      : isLegacyKeyboardKind(kind)
        ? 'keyboardOperation'
        : kind) as NodeKind

const normalizeImportedNodeParams = (kind: string, params: Record<string, unknown>) =>
  isLegacyTriggerKind(kind)
    ? {
        triggerType: legacyTriggerKindToMode[kind],
        ...params,
      }
    : isLegacySystemKind(kind)
    ? {
        operation: legacySystemKindToOperation[kind],
        ...params,
      }
    : isLegacyMouseKind(kind)
      ? {
          operation: legacyMouseKindToOperation[kind],
          ...params,
        }
      : isLegacyFileKind(kind)
        ? {
            operation: legacyFileKindToOperation[kind],
            ...params,
          }
      : isLegacyKeyboardKind(kind)
        ? {
            operation: legacyKeyboardKindToOperation[kind],
            ...params,
          }
        : params

const normalizeImportedNodes = (nodes: WorkflowNode[]): WorkflowNode[] =>
  nodes.map((node) => {
    const rawKind = String(node.data.kind ?? node.type ?? '')
    const normalizedKind = normalizeImportedNodeKind(rawKind)
    const meta = getNodeMeta(normalizedKind)
    const rawParams =
      node.data.params && typeof node.data.params === 'object'
        ? (node.data.params as Record<string, unknown>)
        : {}
    const normalizedParams = normalizeImportedNodeParams(rawKind, rawParams)

    return {
      ...node,
      type: normalizedKind,
      data: {
        ...node.data,
        kind: normalizedKind,
        label: getNodeDisplayLabel(normalizedKind, {
          ...structuredClone(meta.defaultParams),
          ...normalizedParams,
        }, meta.label),
        description: node.data.description || meta.description,
        params: {
          ...structuredClone(meta.defaultParams),
          ...normalizedParams,
        },
      },
    }
  })

const applyConnectionWithReplacement = (
  edges: WorkflowEdge[],
  nodes: WorkflowNode[],
  connection: Connection,
): WorkflowEdge[] | null => {
  if (!connection.source || !connection.target) {
    return null
  }

  if (connection.source === connection.target) {
    return null
  }

  const sourceNode = nodes.find((node) => node.id === connection.source)
  const targetNode = nodes.find((node) => node.id === connection.target)
  if (!sourceNode || !targetNode) {
    return null
  }

  const sourceHandle = normalizeSourceHandleId(sourceNode.data.kind, connection.sourceHandle, sourceNode.data.params)
  const targetHandle = normalizeTargetHandleId(targetNode.data.kind, connection.targetHandle, targetNode.data.params)
  if (!sourceHandle || !targetHandle) {
    return null
  }

  const sourceIsParam = isParamOutputHandleId(sourceHandle)
  const targetIsParam = isParamInputHandleId(targetHandle)
  if (sourceIsParam) {
    return null
  }
  if (!sourceIsParam && !targetIsParam) {
    // 控制流连接：继续走默认逻辑
  } else if (!sourceIsParam && targetIsParam) {
    // 允许流程输出口连接到参数输入口
  } else {
    return null
  }

  const sourceType = getOutputHandleValueType(sourceNode.data.kind, sourceHandle, sourceNode.data.params)
  const targetType = getInputHandleValueType(targetNode.data.kind, targetHandle, targetNode.data.params)
  if (!sourceType || !targetType || !isHandleValueTypeCompatible(sourceType, targetType)) {
    return null
  }

  let nextEdges = edges

  const sourceMax = getOutputHandleMaxConnections(sourceNode.data.kind, sourceHandle, sourceNode.data.params)
  if (sourceMax <= 0) {
    return null
  }
  const sourceCurrent = nextEdges.filter(
    (edge) => edge.source === connection.source && edge.sourceHandle === sourceHandle,
  )
  if (sourceCurrent.length >= sourceMax) {
    const sourceOverflow = sourceCurrent.length - sourceMax + 1
    const sourceDropIds = new Set(sourceCurrent.slice(0, sourceOverflow).map((edge) => edge.id))
    nextEdges = nextEdges.filter((edge) => !sourceDropIds.has(edge.id))
  }

  const targetMax = getInputHandleMaxConnections(targetNode.data.kind, targetHandle, targetNode.data.params)
  if (targetMax <= 0) {
    return null
  }
  const targetCurrent = nextEdges.filter(
    (edge) => edge.target === connection.target && edge.targetHandle === targetHandle,
  )
  if (targetCurrent.length >= targetMax) {
    const targetOverflow = targetCurrent.length - targetMax + 1
    const targetDropIds = new Set(targetCurrent.slice(0, targetOverflow).map((edge) => edge.id))
    nextEdges = nextEdges.filter((edge) => !targetDropIds.has(edge.id))
  }

  const duplicated = nextEdges.some(
    (edge) =>
      edge.source === connection.source &&
      edge.target === connection.target &&
      edge.sourceHandle === sourceHandle &&
      edge.targetHandle === targetHandle,
  )
  if (duplicated) {
    return nextEdges
  }

  return addEdge(
    {
      ...connection,
      sourceHandle,
      targetHandle,
      animated: false,
      style: { stroke: '#0891b2', strokeWidth: 2 },
    },
    nextEdges,
  )
}

export const useWorkflowStore = create<WorkflowState>((set, get) => ({
  graphId: crypto.randomUUID(),
  graphName: '未命名工作流',
  nodes: makeInitialNodes(),
  edges: [],
  runningNodeIds: [],
  selectedNodeId: null,
  selectedNodeIds: [],
  cursor: { x: 0, y: 0, isPhysicalPixel: true, mode: 'virtualScreen' },
  past: [],
  copiedNodes: null,
  future: [],
  onNodesChange: (changes) =>
    set((state) => {
      if (changes.length === 0) return state
      const nextNodes = applyNodeChanges<WorkflowNode>(changes, state.nodes)
      const selectedNodeIds = deriveSelectedNodeIds(nextNodes)
      return {
        nodes: nextNodes,
        selectedNodeIds,
        selectedNodeId: pickPrimarySelectedId(selectedNodeIds, state.selectedNodeId),
      }
    }),
  onEdgesChange: (changes) =>
    set((state) => {
      if (changes.length === 0) return state
      return {
        edges: applyEdgeChanges<WorkflowEdge>(changes, state.edges),
      }
    }),
  onConnect: (connection) =>
    set((state) => {
      const nextEdges = applyConnectionWithReplacement(state.edges, state.nodes, connection)
      if (!nextEdges) return state
      return { edges: nextEdges }
    }),
  onReconnect: (oldEdge, connection) =>
    set((state) => {
      const withoutOld = state.edges.filter((edge) => edge.id !== oldEdge.id)
      const nextEdges = applyConnectionWithReplacement(withoutOld, state.nodes, connection)
      if (!nextEdges) {
        return { edges: withoutOld }
      }
      return { edges: nextEdges }
    }),
  disconnectHandleConnections: (nodeId, handleType, handleId) =>
    set((state) => {
      const node = state.nodes.find((item) => item.id === nodeId)
      if (!node) return state

      if (handleType === 'source') {
        const normalized = normalizeSourceHandleId(node.data.kind, handleId, node.data.params)
        if (!normalized) return state
        const nextEdges = state.edges.filter(
          (edge) => !(edge.source === nodeId && edge.sourceHandle === normalized),
        )
        return nextEdges.length === state.edges.length ? state : { edges: nextEdges }
      }

      const normalized = normalizeTargetHandleId(node.data.kind, handleId, node.data.params)
      if (!normalized) return state
      const nextEdges = state.edges.filter(
        (edge) => !(edge.target === nodeId && edge.targetHandle === normalized),
      )
      return nextEdges.length === state.edges.length ? state : { edges: nextEdges }
    }),
  setSelectedNode: (id) =>
    set((state) => {
      const selectedNodeIds = id ? [id] : []
      if (state.selectedNodeId === id && shallowEqualArray(state.selectedNodeIds, selectedNodeIds)) {
        return state
      }

      return {
        nodes: state.nodes.map((node) => ({
          ...node,
          selected: id ? node.id === id : false,
        })),
        selectedNodeId: id,
        selectedNodeIds,
      }
    }),
  setSelectedNodes: (ids) =>
    set((state) => {
      const selectedSet = new Set(ids)
      const selectedNodeIds = state.nodes
        .filter((node) => selectedSet.has(node.id))
        .map((node) => node.id)
      const nextPrimaryId = pickPrimarySelectedId(selectedNodeIds, state.selectedNodeId)

      if (
        shallowEqualArray(state.selectedNodeIds, selectedNodeIds) &&
        state.selectedNodeId === nextPrimaryId
      ) {
        return state
      }

      return {
        nodes: state.nodes.map((node) => ({
          ...node,
          selected: selectedSet.has(node.id),
        })),
        selectedNodeIds,
        selectedNodeId: nextPrimaryId,
      }
    }),
  setRunningNode: (id) =>
    set((state) => {
      const next = id ? [id] : []
      if (shallowEqualArray(state.runningNodeIds, next)) {
        return state
      }
      return { runningNodeIds: next }
    }),
  clearRunningNodes: () =>
    set((state) => {
      if (state.runningNodeIds.length === 0) {
        return state
      }
      return { runningNodeIds: [] }
    }),
  setCursor: (cursor) =>
    set((state) => {
      if (
        state.cursor.x === cursor.x &&
        state.cursor.y === cursor.y &&
        state.cursor.isPhysicalPixel === cursor.isPhysicalPixel &&
        state.cursor.mode === cursor.mode
      ) {
        return state
      }

      return { cursor }
    }),
  addNode: (kind, position) => {
    const id = crypto.randomUUID()
    const meta = getNodeMeta(kind)
    const initialParams = structuredClone(meta.defaultParams)
    set((state) => ({
      past: [...state.past, cloneSnapshot(state.nodes, state.edges)].slice(-100),
      future: [],
      nodes: [
        ...state.nodes,
        {
          id,
          type: kind,
          position,
          data: {
            kind,
            label: getNodeDisplayLabel(kind, initialParams, meta.label),
            description: meta.description,
            params: initialParams,
          },
        },
      ],
    }))
    return id
  },
  deleteSelectedNodes: () =>
    set((state) => {
      const selectedIds = resolveSelectedIds(state)
      if (selectedIds.length === 0) return state
      const selectedSet = new Set(selectedIds)
      return {
        past: [...state.past, cloneSnapshot(state.nodes, state.edges)].slice(-100),
        future: [],
        nodes: state.nodes.filter((node) => !selectedSet.has(node.id)),
        edges: state.edges.filter((edge) => !selectedSet.has(edge.source) && !selectedSet.has(edge.target)),
        selectedNodeId: null,
        selectedNodeIds: [],
      }
    }),
  duplicateSelectedNode: () =>
    set((state) => {
      const selectedSet = new Set(resolveSelectedIds(state))
      const selectedNodes = state.nodes.filter((node) => selectedSet.has(node.id))
      if (selectedNodes.length === 0) return state

      const duplicatedNodes: WorkflowNode[] = selectedNodes.map((selected) => ({
        ...structuredClone(selected),
        id: crypto.randomUUID(),
        selected: true,
        position: { x: selected.position.x + 40, y: selected.position.y + 40 },
      }))
      const duplicatedIds = duplicatedNodes.map((node) => node.id)
      return {
        past: [...state.past, cloneSnapshot(state.nodes, state.edges)].slice(-100),
        future: [],
        nodes: [...state.nodes.map((node) => ({ ...node, selected: false })), ...duplicatedNodes],
        selectedNodeId: duplicatedIds[0] ?? null,
        selectedNodeIds: duplicatedIds,
      }
    }),
  copySelectedNode: () => {
    const state = get()
    const selectedSet = new Set(resolveSelectedIds(state))
    const selectedNodes = state.nodes.filter((node) => selectedSet.has(node.id))
    if (selectedNodes.length === 0) return false
    set(() => ({ copiedNodes: structuredClone(selectedNodes) }))
    return true
  },
  pasteCopiedNode: () => {
    const state = get()
    if (!state.copiedNodes || state.copiedNodes.length === 0) return false

    const pastedNodes: WorkflowNode[] = state.copiedNodes.map((node) => ({
      ...structuredClone(node),
      id: crypto.randomUUID(),
      selected: true,
      position: {
        x: node.position.x + 40,
        y: node.position.y + 40,
      },
    }))
    const pastedIds = pastedNodes.map((node) => node.id)

    set((current) => ({
      past: [...current.past, cloneSnapshot(current.nodes, current.edges)].slice(-100),
      future: [],
      nodes: [...current.nodes.map((node) => ({ ...node, selected: false })), ...pastedNodes],
      selectedNodeId: pastedIds[0] ?? null,
      selectedNodeIds: pastedIds,
    }))
    return true
  },
  updateNodeParams: (id, params) =>
    set((state) => {
      const nextNodes = state.nodes.map((node) =>
        node.id === id
          ? (() => {
              const meta = getNodeMeta(node.data.kind)
              return {
                ...node,
                data: {
                  ...node.data,
                  label: getNodeDisplayLabel(node.data.kind, params, meta.label),
                  params,
                },
              }
            })()
          : node,
      )

      const updatedNode = nextNodes.find((node) => node.id === id)
      if (!updatedNode) {
        return { nodes: nextNodes }
      }

      const nextEdges = state.edges.filter((edge) => {
        if (edge.source === id && !hasSourceHandle(updatedNode, edge.sourceHandle)) {
          return false
        }
        if (edge.target === id && !hasTargetHandle(updatedNode, edge.targetHandle)) {
          return false
        }
        return true
      })

      return {
        nodes: nextNodes,
        edges: nextEdges,
      }
    }),
  setGraphName: (name) =>
    set(() => ({
      graphName: name,
    })),
  exportWorkflow: () => {
    const state = get()
    return {
      version: '1.0.0',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      graph: {
        id: state.graphId,
        name: state.graphName,
        nodes: state.nodes,
        edges: state.edges,
      },
    }
  },
  importWorkflow: (file, fileName?: string) =>
    set((state) => ({
      past: [...state.past, cloneSnapshot(state.nodes, state.edges)].slice(-100),
      future: [],
      graphId: file.graph.id,
      graphName: fileName ?? file.graph.name,
      nodes: normalizeImportedNodes(file.graph.nodes),
      edges: file.graph.edges,
      selectedNodeId: null,
      selectedNodeIds: [],
    })),
  resetWorkflow: () =>
    set((state) => ({
      past: [...state.past, cloneSnapshot(state.nodes, state.edges)].slice(-100),
      future: [],
      graphId: crypto.randomUUID(),
      graphName: '未命名工作流',
      nodes: makeInitialNodes(),
      edges: [],
      selectedNodeId: null,
      selectedNodeIds: [],
    })),
  undo: () =>
    set((state) => {
      if (state.past.length === 0) return state
      const last = state.past[state.past.length - 1]
      return {
        past: state.past.slice(0, -1),
        future: [cloneSnapshot(state.nodes, state.edges), ...state.future].slice(0, 100),
        nodes: last.nodes,
        edges: last.edges,
      }
    }),
  redo: () =>
    set((state) => {
      if (state.future.length === 0) return state
      const [next, ...rest] = state.future
      return {
        past: [...state.past, cloneSnapshot(state.nodes, state.edges)].slice(-100),
        future: rest,
        nodes: next.nodes,
        edges: next.edges,
      }
    }),
}))
