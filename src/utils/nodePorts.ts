import type { NodeKind } from '../types/workflow'

export interface NodePort {
  id: string
  label?: string
  maxConnections: number
}

export interface NodePortSpec {
  inputs: NodePort[]
  outputs: NodePort[]
}

const ONE = 1

const singleIn = (): NodePort[] => [{ id: 'in', maxConnections: ONE }]
const singleOut = (): NodePort[] => [{ id: 'next', maxConnections: ONE }]

const specs: Record<NodeKind, NodePortSpec> = {
  hotkeyTrigger: {
    inputs: [],
    outputs: singleOut(),
  },
  timerTrigger: {
    inputs: [],
    outputs: singleOut(),
  },
  manualTrigger: {
    inputs: [],
    outputs: singleOut(),
  },
  windowTrigger: {
    inputs: [],
    outputs: singleOut(),
  },
  mouseClick: {
    inputs: singleIn(),
    outputs: singleOut(),
  },
  mouseMove: {
    inputs: singleIn(),
    outputs: singleOut(),
  },
  mouseDrag: {
    inputs: singleIn(),
    outputs: singleOut(),
  },
  mouseWheel: {
    inputs: singleIn(),
    outputs: singleOut(),
  },
  keyboardKey: {
    inputs: singleIn(),
    outputs: singleOut(),
  },
  keyboardInput: {
    inputs: singleIn(),
    outputs: singleOut(),
  },
  shortcut: {
    inputs: singleIn(),
    outputs: singleOut(),
  },
  screenshot: {
    inputs: singleIn(),
    outputs: singleOut(),
  },
  windowActivate: {
    inputs: singleIn(),
    outputs: singleOut(),
  },
  runCommand: {
    inputs: singleIn(),
    outputs: singleOut(),
  },
  pythonCode: {
    inputs: singleIn(),
    outputs: singleOut(),
  },
  delay: {
    inputs: singleIn(),
    outputs: singleOut(),
  },
  condition: {
    inputs: singleIn(),
    outputs: [
      { id: 'true', label: 'true', maxConnections: ONE },
      { id: 'false', label: 'false', maxConnections: ONE },
    ],
  },
  loop: {
    inputs: singleIn(),
    outputs: [
      { id: 'loop', label: 'loop', maxConnections: ONE },
      { id: 'done', label: 'done', maxConnections: ONE },
    ],
  },
  whileLoop: {
    inputs: singleIn(),
    outputs: [
      { id: 'loop', label: 'loop', maxConnections: ONE },
      { id: 'done', label: 'done', maxConnections: ONE },
    ],
  },
  errorHandler: {
    inputs: singleIn(),
    outputs: singleOut(),
  },
  varDefine: {
    inputs: singleIn(),
    outputs: singleOut(),
  },
  varSet: {
    inputs: singleIn(),
    outputs: singleOut(),
  },
}

export const getNodePortSpec = (kind: NodeKind): NodePortSpec => specs[kind]

const normalizeHandleId = (
  ports: NodePort[],
  handleId: string | null | undefined,
): string | null => {
  if (ports.length === 0) return null
  if (handleId && ports.some((port) => port.id === handleId)) {
    return handleId
  }
  if (ports.length === 1) {
    return ports[0].id
  }
  return null
}

export const normalizeSourceHandleId = (kind: NodeKind, handleId: string | null | undefined): string | null =>
  normalizeHandleId(specs[kind].outputs, handleId)

export const normalizeTargetHandleId = (kind: NodeKind, handleId: string | null | undefined): string | null =>
  normalizeHandleId(specs[kind].inputs, handleId)

export const getOutputHandleMaxConnections = (kind: NodeKind, handleId: string): number =>
  specs[kind].outputs.find((port) => port.id === handleId)?.maxConnections ?? 0

export const getInputHandleMaxConnections = (kind: NodeKind, handleId: string): number =>
  specs[kind].inputs.find((port) => port.id === handleId)?.maxConnections ?? 0
