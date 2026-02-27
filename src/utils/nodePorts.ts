import type { NodeKind } from '../types/workflow'
import { getNodeMeta } from './nodeMeta'

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

const PARAM_INPUT_PREFIX = 'param:'
const PARAM_INPUT_SUFFIX = ':in'
const PARAM_OUTPUT_SUFFIX = ':out'

const isConnectableFieldType = (type: string) => type !== 'boolean'

export const createParamInputHandleId = (fieldKey: string): string =>
  `${PARAM_INPUT_PREFIX}${fieldKey}${PARAM_INPUT_SUFFIX}`

export const createParamOutputHandleId = (fieldKey: string): string =>
  `${PARAM_INPUT_PREFIX}${fieldKey}${PARAM_OUTPUT_SUFFIX}`

export const isParamInputHandleId = (handleId: string | null | undefined): boolean =>
  typeof handleId === 'string' && handleId.startsWith(PARAM_INPUT_PREFIX) && handleId.endsWith(PARAM_INPUT_SUFFIX)

export const isParamOutputHandleId = (handleId: string | null | undefined): boolean =>
  typeof handleId === 'string' && handleId.startsWith(PARAM_INPUT_PREFIX) && handleId.endsWith(PARAM_OUTPUT_SUFFIX)

export const isParamHandleId = (handleId: string | null | undefined): boolean =>
  isParamInputHandleId(handleId) || isParamOutputHandleId(handleId)

export const getParamFieldKeyFromHandleId = (handleId: string | null | undefined): string | null => {
  if (!handleId || !isParamHandleId(handleId)) return null
  return handleId.slice(PARAM_INPUT_PREFIX.length, handleId.lastIndexOf(':'))
}

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
  mouseDown: {
    inputs: singleIn(),
    outputs: singleOut(),
  },
  mouseUp: {
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
  keyboardDown: {
    inputs: singleIn(),
    outputs: singleOut(),
  },
  keyboardUp: {
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
  fileCopy: {
    inputs: singleIn(),
    outputs: singleOut(),
  },
  fileMove: {
    inputs: singleIn(),
    outputs: singleOut(),
  },
  fileDelete: {
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
  clipboardRead: {
    inputs: singleIn(),
    outputs: singleOut(),
  },
  clipboardWrite: {
    inputs: singleIn(),
    outputs: singleOut(),
  },
  fileReadText: {
    inputs: singleIn(),
    outputs: singleOut(),
  },
  fileWriteText: {
    inputs: singleIn(),
    outputs: singleOut(),
  },
  showMessage: {
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
  imageMatch: {
    inputs: singleIn(),
    outputs: [
      { id: 'true', label: 'true', maxConnections: ONE },
      { id: 'false', label: 'false', maxConnections: ONE },
    ],
  },
  varDefine: {
    inputs: singleIn(),
    outputs: singleOut(),
  },
  varSet: {
    inputs: singleIn(),
    outputs: singleOut(),
  },
  varMath: {
    inputs: singleIn(),
    outputs: singleOut(),
  },
}

const mergedSpecCache = new Map<NodeKind, NodePortSpec>()

export const getNodePortSpec = (kind: NodeKind): NodePortSpec => {
  const cached = mergedSpecCache.get(kind)
  if (cached) return cached

  const base = specs[kind]
  const meta = getNodeMeta(kind)
  const connectableFields = meta.fields.filter((field) => isConnectableFieldType(field.type))

  const merged: NodePortSpec = {
    inputs: [
      ...base.inputs,
      ...connectableFields.map((field) => ({
        id: createParamInputHandleId(field.key),
        label: field.label,
        maxConnections: ONE,
      })),
    ],
    outputs: [...base.outputs],
  }

  mergedSpecCache.set(kind, merged)
  return merged
}

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
  normalizeHandleId(getNodePortSpec(kind).outputs, handleId)

export const normalizeTargetHandleId = (kind: NodeKind, handleId: string | null | undefined): string | null =>
  normalizeHandleId(getNodePortSpec(kind).inputs, handleId)

export const getOutputHandleMaxConnections = (kind: NodeKind, handleId: string): number =>
  getNodePortSpec(kind).outputs.find((port) => port.id === handleId)?.maxConnections ?? 0

export const getInputHandleMaxConnections = (kind: NodeKind, handleId: string): number =>
  getNodePortSpec(kind).inputs.find((port) => port.id === handleId)?.maxConnections ?? 0
