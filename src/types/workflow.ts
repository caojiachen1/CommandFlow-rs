import type { Edge, Node } from '@xyflow/react'

export type TriggerNodeKind =
  | 'manualTrigger'
  | 'hotkeyTrigger'
  | 'timerTrigger'
  | 'windowTrigger'
export type ActionNodeKind =
  | 'uiaElement'
  | 'getMousePosition'
  | 'mouseOperation'
  | 'keyboardOperation'
  | 'inputPresetReplay'
  | 'screenshot'
  | 'windowActivate'
  | 'terminateProcess'
  | 'launchApplication'
  | 'fileOperation'
  | 'pythonCode'
  | 'clipboardRead'
  | 'clipboardWrite'
  | 'showMessage'
  | 'delay'
  | 'shutdown'
  | 'restart'
  | 'sleep'
  | 'hibernate'
  | 'lock'
  | 'signOut'
  | 'volumeMute'
  | 'volumeSet'
  | 'volumeAdjust'
  | 'brightnessSet'
  | 'wifiSwitch'
  | 'bluetoothSwitch'
  | 'networkAdapterSwitch'
  | 'theme'
  | 'powerPlan'
  | 'openSettings'
  | 'runCommand'
  | 'guiAgent'
  | 'guiAgentActionParser'
export type ControlNodeKind = 'condition' | 'loop' | 'whileLoop' | 'imageMatch' | 'ocrMatch' | 'tryCatch'
export type DataNodeKind = 'varDefine' | 'varSet' | 'varMath' | 'varGet' | 'constValue'
  | 'currentTime'
  | 'jsonExtract'

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
