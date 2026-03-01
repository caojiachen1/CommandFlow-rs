import type { NodeKind } from '../types/workflow'
import { getNodeMeta } from './nodeMeta'

export type HandleValueType = 'control' | 'string' | 'number' | 'json' | 'any'

export interface NodePort {
  id: string
  label?: string
  maxConnections: number
  valueType?: HandleValueType
}

export interface NodePortSpec {
  inputs: NodePort[]
  outputs: NodePort[]
}

const ONE = 1
const MANY = 8
const singleIn = (): NodePort[] => [{ id: 'in', maxConnections: ONE, valueType: 'control' }]
const singleOut = (): NodePort[] => [{ id: 'next', maxConnections: ONE, valueType: 'control' }]

const PARAM_INPUT_PREFIX = 'param:'
const PARAM_INPUT_SUFFIX = ':in'
const PARAM_OUTPUT_SUFFIX = ':out'

const isConnectableFieldType = (type: string) => type !== 'boolean'

const toHandleValueType = (fieldType: string): HandleValueType => {
  if (fieldType === 'number') return 'number'
  if (fieldType === 'json') return 'json'
  return 'string'
}

const resolveTypedValueType = (raw: unknown): HandleValueType => {
  const value = String(raw ?? '').toLowerCase()
  if (value === 'number') return 'number'
  if (value === 'json') return 'json'
  if (value === 'string') return 'string'
  return 'any'
}

export const isHandleValueTypeCompatible = (
  sourceType: HandleValueType,
  targetType: HandleValueType,
): boolean => {
  if (sourceType === 'control' || targetType === 'control') {
    return sourceType === targetType
  }
  if (sourceType === 'any' || targetType === 'any') {
    return true
  }
  return sourceType === targetType
}

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
    outputs: [
      ...singleOut(),
      { id: 'title', label: 'title', maxConnections: MANY, valueType: 'string' },
    ],
  },
  mouseClick: {
    inputs: singleIn(),
    outputs: [
      ...singleOut(),
      { id: 'x', label: 'x', maxConnections: MANY, valueType: 'number' },
      { id: 'y', label: 'y', maxConnections: MANY, valueType: 'number' },
    ],
  },
  mouseMove: {
    inputs: singleIn(),
    outputs: [
      ...singleOut(),
      { id: 'x', label: 'x', maxConnections: MANY, valueType: 'number' },
      { id: 'y', label: 'y', maxConnections: MANY, valueType: 'number' },
    ],
  },
  mouseDrag: {
    inputs: singleIn(),
    outputs: [
      ...singleOut(),
      { id: 'toX', label: 'toX', maxConnections: MANY, valueType: 'number' },
      { id: 'toY', label: 'toY', maxConnections: MANY, valueType: 'number' },
    ],
  },
  mouseWheel: {
    inputs: singleIn(),
    outputs: [
      ...singleOut(),
      { id: 'vertical', label: 'vertical', maxConnections: MANY, valueType: 'number' },
    ],
  },
  mouseDown: {
    inputs: singleIn(),
    outputs: [
      ...singleOut(),
      { id: 'x', label: 'x', maxConnections: MANY, valueType: 'number' },
      { id: 'y', label: 'y', maxConnections: MANY, valueType: 'number' },
      { id: 'button', label: 'button', maxConnections: MANY, valueType: 'string' },
    ],
  },
  mouseUp: {
    inputs: singleIn(),
    outputs: [
      ...singleOut(),
      { id: 'x', label: 'x', maxConnections: MANY, valueType: 'number' },
      { id: 'y', label: 'y', maxConnections: MANY, valueType: 'number' },
      { id: 'button', label: 'button', maxConnections: MANY, valueType: 'string' },
    ],
  },
  keyboardKey: {
    inputs: singleIn(),
    outputs: [...singleOut(), { id: 'key', label: 'key', maxConnections: MANY, valueType: 'string' }],
  },
  keyboardInput: {
    inputs: singleIn(),
    outputs: [...singleOut(), { id: 'text', label: 'text', maxConnections: MANY, valueType: 'string' }],
  },
  keyboardDown: {
    inputs: singleIn(),
    outputs: [...singleOut(), { id: 'key', label: 'key', maxConnections: MANY, valueType: 'string' }],
  },
  keyboardUp: {
    inputs: singleIn(),
    outputs: [...singleOut(), { id: 'key', label: 'key', maxConnections: MANY, valueType: 'string' }],
  },
  shortcut: {
    inputs: singleIn(),
    outputs: [...singleOut(), { id: 'key', label: 'key', maxConnections: MANY, valueType: 'string' }],
  },
  screenshot: {
    inputs: singleIn(),
    outputs: [
      ...singleOut(),
      { id: 'path', label: 'path', maxConnections: MANY, valueType: 'string' },
      { id: 'screenshot', label: '截图', maxConnections: MANY, valueType: 'string' },
    ],
  },
  guiAgent: {
    inputs: singleIn(),
    outputs: singleOut(),
  },
  windowActivate: {
    inputs: singleIn(),
    outputs: [...singleOut(), { id: 'title', label: 'title', maxConnections: MANY, valueType: 'string' }],
  },
  fileCopy: {
    inputs: singleIn(),
    outputs: [...singleOut(), { id: 'targetPath', label: 'targetPath', maxConnections: MANY, valueType: 'string' }],
  },
  fileMove: {
    inputs: singleIn(),
    outputs: [...singleOut(), { id: 'targetPath', label: 'targetPath', maxConnections: MANY, valueType: 'string' }],
  },
  fileDelete: {
    inputs: singleIn(),
    outputs: [...singleOut(), { id: 'path', label: 'path', maxConnections: MANY, valueType: 'string' }],
  },
  runCommand: {
    inputs: singleIn(),
    outputs: [...singleOut(), { id: 'command', label: 'command', maxConnections: MANY, valueType: 'string' }],
  },
  pythonCode: {
    inputs: singleIn(),
    outputs: singleOut(),
  },
  clipboardRead: {
    inputs: singleIn(),
    outputs: [...singleOut(), { id: 'text', label: 'text', maxConnections: MANY, valueType: 'string' }],
  },
  clipboardWrite: {
    inputs: singleIn(),
    outputs: singleOut(),
  },
  fileReadText: {
    inputs: singleIn(),
    outputs: [...singleOut(), { id: 'text', label: 'text', maxConnections: MANY, valueType: 'string' }],
  },
  fileWriteText: {
    inputs: singleIn(),
    outputs: [...singleOut(), { id: 'path', label: 'path', maxConnections: MANY, valueType: 'string' }],
  },
  showMessage: {
    inputs: singleIn(),
    outputs: [...singleOut(), { id: 'message', label: 'message', maxConnections: MANY, valueType: 'string' }],
  },
  delay: {
    inputs: singleIn(),
    outputs: [...singleOut(), { id: 'ms', label: 'ms', maxConnections: MANY, valueType: 'number' }],
  },
  condition: {
    inputs: singleIn(),
    outputs: [
      { id: 'true', label: 'true', maxConnections: ONE, valueType: 'control' },
      { id: 'false', label: 'false', maxConnections: ONE, valueType: 'control' },
    ],
  },
  loop: {
    inputs: singleIn(),
    outputs: [
      { id: 'loop', label: 'loop', maxConnections: ONE, valueType: 'control' },
      { id: 'done', label: 'done', maxConnections: ONE, valueType: 'control' },
    ],
  },
  whileLoop: {
    inputs: singleIn(),
    outputs: [
      { id: 'loop', label: 'loop', maxConnections: ONE, valueType: 'control' },
      { id: 'done', label: 'done', maxConnections: ONE, valueType: 'control' },
    ],
  },
  imageMatch: {
    inputs: singleIn(),
    outputs: [
      { id: 'true', label: 'true', maxConnections: ONE, valueType: 'control' },
      { id: 'false', label: 'false', maxConnections: ONE, valueType: 'control' },
      { id: 'matchX', label: 'matchX', maxConnections: MANY, valueType: 'number' },
      { id: 'matchY', label: 'matchY', maxConnections: MANY, valueType: 'number' },
      { id: 'similarity', label: 'similarity', maxConnections: MANY, valueType: 'number' },
    ],
  },
  varDefine: {
    inputs: singleIn(),
    outputs: [...singleOut(), { id: 'value', label: 'value', maxConnections: MANY, valueType: 'any' }],
  },
  varSet: {
    inputs: singleIn(),
    outputs: [...singleOut(), { id: 'value', label: 'value', maxConnections: MANY, valueType: 'any' }],
  },
  varMath: {
    inputs: singleIn(),
    outputs: [...singleOut(), { id: 'result', label: 'result', maxConnections: MANY, valueType: 'number' }],
  },
  varGet: {
    inputs: singleIn(),
    outputs: [
      ...singleOut(),
      { id: 'value', label: 'value', maxConnections: MANY, valueType: 'any' },
    ],
  },
  constValue: {
    inputs: singleIn(),
    outputs: [
      ...singleOut(),
      { id: 'value', label: 'value', maxConnections: MANY, valueType: 'any' },
    ],
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
        valueType: toHandleValueType(field.type),
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

export const getOutputHandleValueType = (
  kind: NodeKind,
  handleId: string,
  params: Record<string, unknown> = {},
): HandleValueType | null => {
  const normalized = normalizeSourceHandleId(kind, handleId)
  if (!normalized) return null

  if (kind === 'constValue' && normalized === 'value') {
    return resolveTypedValueType(params.valueType)
  }

  if ((kind === 'varDefine' || kind === 'varSet') && normalized === 'value') {
    return resolveTypedValueType(params.valueType)
  }

  return getNodePortSpec(kind).outputs.find((port) => port.id === normalized)?.valueType ?? null
}

export const getInputHandleValueType = (kind: NodeKind, handleId: string): HandleValueType | null => {
  const normalized = normalizeTargetHandleId(kind, handleId)
  if (!normalized) return null
  return getNodePortSpec(kind).inputs.find((port) => port.id === normalized)?.valueType ?? null
}
