import type { Edge, Node } from '@xyflow/react'

export type TriggerNodeKind = 'hotkeyTrigger' | 'timerTrigger' | 'manualTrigger' | 'windowTrigger'
export type ActionNodeKind =
  | 'mouseOperation'
  | 'keyboardOperation'
  | 'screenshot'
  | 'windowActivate'
  | 'launchApplication'
  | 'fileOperation'
  | 'runCommand'
  | 'pythonCode'
  | 'clipboardRead'
  | 'clipboardWrite'
  | 'showMessage'
  | 'delay'
  | 'systemOperation'
  | 'guiAgent'
  | 'guiAgentActionParser'
export type ControlNodeKind = 'condition' | 'loop' | 'whileLoop' | 'imageMatch'
export type DataNodeKind = 'varDefine' | 'varSet' | 'varMath' | 'varGet' | 'constValue'

export type NodeKind = TriggerNodeKind | ActionNodeKind | ControlNodeKind | DataNodeKind

export interface WorkflowNodeData {
  [key: string]: unknown
  label: string
  kind: NodeKind
  params: Record<string, unknown>
  description?: string
}

export type WorkflowNode = Node<WorkflowNodeData>
export type WorkflowEdge = Edge

export interface WorkflowGraph {
  id: string
  name: string
  nodes: WorkflowNode[]
  edges: WorkflowEdge[]
}

export interface WorkflowFile {
  version: '1.0.0'
  createdAt: string
  updatedAt: string
  graph: WorkflowGraph
}

export interface CoordinatePoint {
  x: number
  y: number
  isPhysicalPixel: boolean
  mode: 'virtualScreen' | 'activeWindow'
}
