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
import { getNodeMeta } from '../utils/nodeMeta'
import {
  getInputHandleMaxConnections,
  getOutputHandleMaxConnections,
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
  setCursor: (x: number, y: number) => void
  addNode: (kind: NodeKind, position: { x: number; y: number }) => string
  deleteSelectedNodes: () => void
  duplicateSelectedNode: () => void
  updateNodeParams: (id: string, params: Record<string, unknown>) => void
  exportWorkflow: () => WorkflowFile
  importWorkflow: (file: WorkflowFile) => void
  resetWorkflow: () => void
  undo: () => void
  redo: () => void
}

const cloneSnapshot = (nodes: WorkflowNode[], edges: WorkflowEdge[]): Snapshot => ({
  nodes: structuredClone(nodes),
  edges: structuredClone(edges),
})

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

const initialNodes: WorkflowNode[] = [
  {
    id: crypto.randomUUID(),
    type: 'manualTrigger',
    position: { x: 200, y: 120 },
    data: {
      kind: 'manualTrigger',
      label: getNodeMeta('manualTrigger').label,
      params: structuredClone(getNodeMeta('manualTrigger').defaultParams),
      description: getNodeMeta('manualTrigger').description,
    },
  },
]

const makeInitialNodes = (): WorkflowNode[] => structuredClone(initialNodes)

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

  const sourceHandle = normalizeSourceHandleId(sourceNode.data.kind, connection.sourceHandle)
  const targetHandle = normalizeTargetHandleId(targetNode.data.kind, connection.targetHandle)
  if (!sourceHandle || !targetHandle) {
    return null
  }

  let nextEdges = edges

  const sourceMax = getOutputHandleMaxConnections(sourceNode.data.kind, sourceHandle)
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

  const targetMax = getInputHandleMaxConnections(targetNode.data.kind, targetHandle)
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
      animated: true,
    },
    nextEdges,
  )
}

export const useWorkflowStore = create<WorkflowState>((set, get) => ({
  graphId: crypto.randomUUID(),
  graphName: '未命名工作流',
  nodes: makeInitialNodes(),
  edges: [],
  selectedNodeId: null,
  selectedNodeIds: [],
  cursor: { x: 0, y: 0, isPhysicalPixel: true, mode: 'virtualScreen' },
  past: [],
  copiedNodes: null,
  future: [],
  onNodesChange: (changes) =>
    set((state) => {
      const nextNodes = applyNodeChanges<WorkflowNode>(changes, state.nodes)
      const selectedNodeIds = deriveSelectedNodeIds(nextNodes)
      return {
        nodes: nextNodes,
        selectedNodeIds,
        selectedNodeId: pickPrimarySelectedId(selectedNodeIds, state.selectedNodeId),
      }
    }),
  onEdgesChange: (changes) =>
    set((state) => ({
      edges: applyEdgeChanges<WorkflowEdge>(changes, state.edges),
    })),
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
        const normalized = normalizeSourceHandleId(node.data.kind, handleId)
        if (!normalized) return state
        const nextEdges = state.edges.filter(
          (edge) => !(edge.source === nodeId && edge.sourceHandle === normalized),
        )
        return nextEdges.length === state.edges.length ? state : { edges: nextEdges }
      }

      const normalized = normalizeTargetHandleId(node.data.kind, handleId)
      if (!normalized) return state
      const nextEdges = state.edges.filter(
        (edge) => !(edge.target === nodeId && edge.targetHandle === normalized),
      )
      return nextEdges.length === state.edges.length ? state : { edges: nextEdges }
    }),
  setSelectedNode: (id) =>
    set((state) => {
      const selectedNodeIds = id ? [id] : []
      return {
        selectedNodeId: id,
        selectedNodeIds,
        nodes: state.nodes.map((node) => ({ ...node, selected: id !== null && node.id === id })),
      }
    }),
  setSelectedNodes: (ids) =>
    set((state) => {
      const selectedSet = new Set(ids)
      const selectedNodeIds = state.nodes
        .filter((node) => selectedSet.has(node.id))
        .map((node) => node.id)
      return {
        selectedNodeIds,
        selectedNodeId: pickPrimarySelectedId(selectedNodeIds, state.selectedNodeId),
        nodes: state.nodes.map((node) => ({ ...node, selected: selectedSet.has(node.id) })),
      }
    }),
  setCursor: (x, y) =>
    set((state) => ({
      cursor: {
        ...state.cursor,
        x,
        y,
      },
    })),
  addNode: (kind, position) => {
    const id = crypto.randomUUID()
    const meta = getNodeMeta(kind)
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
            label: meta.label,
            description: meta.description,
            params: structuredClone(meta.defaultParams),
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
    set((state) => ({
      nodes: state.nodes.map((node) =>
        node.id === id
          ? {
              ...node,
              data: {
                ...node.data,
                params,
              },
            }
          : node,
      ),
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
  importWorkflow: (file) =>
    set((state) => ({
      past: [...state.past, cloneSnapshot(state.nodes, state.edges)].slice(-100),
      future: [],
      graphId: file.graph.id,
      graphName: file.graph.name,
      nodes: file.graph.nodes,
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
