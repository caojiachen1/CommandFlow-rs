import { addEdge, applyEdgeChanges, applyNodeChanges, type Connection, type EdgeChange, type NodeChange } from '@xyflow/react'
import { create } from 'zustand'
import type { CoordinatePoint, NodeKind, WorkflowEdge, WorkflowFile, WorkflowNode } from '../types/workflow'

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
  cursor: CoordinatePoint
  past: Snapshot[]
  future: Snapshot[]
  onNodesChange: (changes: NodeChange<WorkflowNode>[]) => void
  onEdgesChange: (changes: EdgeChange<WorkflowEdge>[]) => void
  onConnect: (connection: Connection) => void
  setSelectedNode: (id: string | null) => void
  setCursor: (x: number, y: number) => void
  addNode: (kind: NodeKind, position: { x: number; y: number }) => void
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

const labels: Record<NodeKind, string> = {
  hotkeyTrigger: '热键触发',
  timerTrigger: '定时触发',
  manualTrigger: '手动触发',
  windowTrigger: '窗口触发',
  mouseClick: '鼠标点击',
  mouseMove: '鼠标移动',
  mouseDrag: '鼠标拖拽',
  mouseWheel: '鼠标滚轮',
  keyboardKey: '键盘按键',
  keyboardInput: '键盘输入',
  shortcut: '组合键',
  screenshot: '屏幕截图',
  windowActivate: '窗口激活',
  runCommand: '执行命令',
  delay: '等待延时',
  condition: '条件判断',
  loop: '循环',
  errorHandler: '错误处理',
  varDefine: '变量定义',
  varSet: '变量赋值',
}

const initialNodes: WorkflowNode[] = [
  {
    id: crypto.randomUUID(),
    type: 'manualTrigger',
    position: { x: 200, y: 120 },
    data: {
      kind: 'manualTrigger',
      label: labels.manualTrigger,
      params: {},
      description: '点击运行按钮开始执行工作流。',
    },
  },
]

const makeInitialNodes = (): WorkflowNode[] => structuredClone(initialNodes)

export const useWorkflowStore = create<WorkflowState>((set, get) => ({
  graphId: crypto.randomUUID(),
  graphName: '未命名工作流',
  nodes: makeInitialNodes(),
  edges: [],
  selectedNodeId: null,
  cursor: { x: 0, y: 0, isPhysicalPixel: true, mode: 'virtualScreen' },
  past: [],
  future: [],
  onNodesChange: (changes) =>
    set((state) => ({
      nodes: applyNodeChanges<WorkflowNode>(changes, state.nodes),
    })),
  onEdgesChange: (changes) =>
    set((state) => ({
      edges: applyEdgeChanges<WorkflowEdge>(changes, state.edges),
    })),
  onConnect: (connection) =>
    set((state) => ({
      edges: addEdge({ ...connection, animated: true }, state.edges),
    })),
  setSelectedNode: (id) => set(() => ({ selectedNodeId: id })),
  setCursor: (x, y) =>
    set((state) => ({
      cursor: {
        ...state.cursor,
        x,
        y,
      },
    })),
  addNode: (kind, position) =>
    set((state) => ({
      past: [...state.past, cloneSnapshot(state.nodes, state.edges)].slice(-100),
      future: [],
      nodes: [
        ...state.nodes,
        {
          id: crypto.randomUUID(),
          type: kind,
          position,
          data: {
            kind,
            label: labels[kind],
            params: {},
          },
        },
      ],
    })),
  deleteSelectedNodes: () =>
    set((state) => {
      if (!state.selectedNodeId) return state
      return {
        past: [...state.past, cloneSnapshot(state.nodes, state.edges)].slice(-100),
        future: [],
        nodes: state.nodes.filter((node) => node.id !== state.selectedNodeId),
        edges: state.edges.filter(
          (edge) => edge.source !== state.selectedNodeId && edge.target !== state.selectedNodeId,
        ),
        selectedNodeId: null,
      }
    }),
  duplicateSelectedNode: () =>
    set((state) => {
      const selected = state.nodes.find((node) => node.id === state.selectedNodeId)
      if (!selected) return state
      const duplicated: WorkflowNode = {
        ...structuredClone(selected),
        id: crypto.randomUUID(),
        position: { x: selected.position.x + 40, y: selected.position.y + 40 },
      }
      return {
        past: [...state.past, cloneSnapshot(state.nodes, state.edges)].slice(-100),
        future: [],
        nodes: [...state.nodes, duplicated],
      }
    }),
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
