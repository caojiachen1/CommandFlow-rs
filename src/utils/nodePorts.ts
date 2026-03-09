import type { NodeKind } from '../types/workflow'
import {
  getFileOperationKind,
  getKeyboardOperationKind,
  getMouseOperationKind,
  getNodeFields,
  getNodeMeta,
} from './nodeMeta'

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

const getGuiAgentParserOperation = (params: Record<string, unknown> = {}): string =>
  String(params.operation ?? 'click').toLowerCase()

const getGuiAgentParserDynamicOutputs = (params: Record<string, unknown> = {}): NodePort[] => {
  const operation = getGuiAgentParserOperation(params)

  if (operation === 'click' || operation === 'left_double' || operation === 'right_single') {
    return [
      { id: 'x', label: 'x', maxConnections: MANY, valueType: 'number' },
      { id: 'y', label: 'y', maxConnections: MANY, valueType: 'number' },
    ]
  }

  if (operation === 'drag') {
    return [
      { id: 'startX', label: 'startX', maxConnections: MANY, valueType: 'number' },
      { id: 'startY', label: 'startY', maxConnections: MANY, valueType: 'number' },
      { id: 'endX', label: 'endX', maxConnections: MANY, valueType: 'number' },
      { id: 'endY', label: 'endY', maxConnections: MANY, valueType: 'number' },
    ]
  }

  if (operation === 'hotkey') {
    return [{ id: 'key', label: 'key', maxConnections: MANY, valueType: 'string' }]
  }

  if (operation === 'type' || operation === 'finished') {
    return [{ id: 'content', label: 'content', maxConnections: MANY, valueType: 'string' }]
  }

  if (operation === 'scroll') {
    return [
      { id: 'x', label: 'x', maxConnections: MANY, valueType: 'number' },
      { id: 'y', label: 'y', maxConnections: MANY, valueType: 'number' },
      { id: 'direction', label: 'direction', maxConnections: MANY, valueType: 'string' },
    ]
  }

  if (operation === 'wait') {
    return [{ id: 'waitSeconds', label: 'waitSeconds', maxConnections: MANY, valueType: 'number' }]
  }

  return []
}

const getMouseOperationDynamicOutputs = (params: Record<string, unknown> = {}): NodePort[] => {
  const operation = getMouseOperationKind(params)

  if (operation === 'drag') {
    return [
      { id: 'toX', label: 'toX', maxConnections: MANY, valueType: 'number' },
      { id: 'toY', label: 'toY', maxConnections: MANY, valueType: 'number' },
    ]
  }

  if (operation === 'wheel') {
    return [{ id: 'vertical', label: 'vertical', maxConnections: MANY, valueType: 'number' }]
  }

  if (operation === 'down' || operation === 'up') {
    return [
      { id: 'x', label: 'x', maxConnections: MANY, valueType: 'number' },
      { id: 'y', label: 'y', maxConnections: MANY, valueType: 'number' },
      { id: 'button', label: 'button', maxConnections: MANY, valueType: 'string' },
    ]
  }

  return [
    { id: 'x', label: 'x', maxConnections: MANY, valueType: 'number' },
    { id: 'y', label: 'y', maxConnections: MANY, valueType: 'number' },
  ]
}

const getKeyboardOperationDynamicOutputs = (params: Record<string, unknown> = {}): NodePort[] => {
  const operation = getKeyboardOperationKind(params)

  if (operation === 'input') {
    return [{ id: 'text', label: 'text', maxConnections: MANY, valueType: 'string' }]
  }

  return [{ id: 'key', label: 'key', maxConnections: MANY, valueType: 'string' }]
}

const getFileOperationDynamicOutputs = (params: Record<string, unknown> = {}): NodePort[] => {
  const operation = getFileOperationKind(params)

  if (operation === 'delete') {
    return [{ id: 'path', label: 'path', maxConnections: MANY, valueType: 'string' }]
  }

  if (operation === 'readText') {
    return [{ id: 'text', label: 'text', maxConnections: MANY, valueType: 'string' }]
  }

  if (operation === 'writeText') {
    return [{ id: 'path', label: 'path', maxConnections: MANY, valueType: 'string' }]
  }

  return [{ id: 'targetPath', label: 'targetPath', maxConnections: MANY, valueType: 'string' }]
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
      { id: 'program', label: 'program', maxConnections: MANY, valueType: 'string' },
      { id: 'programPath', label: 'programPath', maxConnections: MANY, valueType: 'string' },
      { id: 'className', label: 'className', maxConnections: MANY, valueType: 'string' },
      { id: 'processId', label: 'processId', maxConnections: MANY, valueType: 'number' },
    ],
  },
  mouseOperation: {
    inputs: singleIn(),
    outputs: singleOut(),
  },
  keyboardOperation: {
    inputs: singleIn(),
    outputs: singleOut(),
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
    outputs: [...singleOut(), { id: 'metadata', label: 'metadata', maxConnections: MANY, valueType: 'json' }],
  },
  guiAgentActionParser: {
    inputs: singleIn(),
    outputs: singleOut(),
  },
  windowActivate: {
    inputs: singleIn(),
    outputs: [
      ...singleOut(),
      { id: 'title', label: 'title', maxConnections: MANY, valueType: 'string' },
      { id: 'program', label: 'program', maxConnections: MANY, valueType: 'string' },
      { id: 'programPath', label: 'programPath', maxConnections: MANY, valueType: 'string' },
      { id: 'className', label: 'className', maxConnections: MANY, valueType: 'string' },
      { id: 'processId', label: 'processId', maxConnections: MANY, valueType: 'number' },
    ],
  },
  launchApplication: {
    inputs: singleIn(),
    outputs: [
      ...singleOut(),
      { id: 'appName', label: 'appName', maxConnections: MANY, valueType: 'string' },
      { id: 'targetPath', label: 'targetPath', maxConnections: MANY, valueType: 'string' },
      { id: 'sourcePath', label: 'sourcePath', maxConnections: MANY, valueType: 'string' },
      { id: 'iconPath', label: 'iconPath', maxConnections: MANY, valueType: 'string' },
      { id: 'pid', label: 'pid', maxConnections: MANY, valueType: 'number' },
    ],
  },
  fileOperation: {
    inputs: singleIn(),
    outputs: singleOut(),
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
  showMessage: {
    inputs: singleIn(),
    outputs: [...singleOut(), { id: 'message', label: 'message', maxConnections: MANY, valueType: 'string' }],
  },
  delay: {
    inputs: singleIn(),
    outputs: [...singleOut(), { id: 'ms', label: 'ms', maxConnections: MANY, valueType: 'number' }],
  },
  systemOperation: {
    inputs: singleIn(),
    outputs: singleOut(),
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

export const getNodePortSpec = (kind: NodeKind, params: Record<string, unknown> = {}): NodePortSpec => {
  const canUseCache =
    kind !== 'guiAgentActionParser' &&
    kind !== 'mouseOperation' &&
    kind !== 'keyboardOperation' &&
    kind !== 'fileOperation'
  if (canUseCache) {
    const cached = mergedSpecCache.get(kind)
    if (cached) return cached
  }

  const base = specs[kind]
  const meta = getNodeMeta(kind)
  const connectableFields = getNodeFields(kind, params, meta.defaultParams).filter((field) => isConnectableFieldType(field.type))
  const dynamicOutputs =
    kind === 'guiAgentActionParser'
      ? getGuiAgentParserDynamicOutputs(params)
      : kind === 'mouseOperation'
        ? getMouseOperationDynamicOutputs(params)
        : kind === 'keyboardOperation'
          ? getKeyboardOperationDynamicOutputs(params)
          : kind === 'fileOperation'
            ? getFileOperationDynamicOutputs(params)
          : []

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
    outputs: [...base.outputs, ...dynamicOutputs],
  }

  if (canUseCache) {
    mergedSpecCache.set(kind, merged)
  }
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

export const normalizeSourceHandleId = (
  kind: NodeKind,
  handleId: string | null | undefined,
  params: Record<string, unknown> = {},
): string | null =>
  normalizeHandleId(getNodePortSpec(kind, params).outputs, handleId)

export const normalizeTargetHandleId = (kind: NodeKind, handleId: string | null | undefined): string | null =>
  normalizeHandleId(getNodePortSpec(kind).inputs, handleId)

export const getOutputHandleMaxConnections = (
  kind: NodeKind,
  handleId: string,
  params: Record<string, unknown> = {},
): number =>
  getNodePortSpec(kind, params).outputs.find((port) => port.id === handleId)?.maxConnections ?? 0

export const getInputHandleMaxConnections = (kind: NodeKind, handleId: string): number =>
  getNodePortSpec(kind).inputs.find((port) => port.id === handleId)?.maxConnections ?? 0

export const getOutputHandleValueType = (
  kind: NodeKind,
  handleId: string,
  params: Record<string, unknown> = {},
): HandleValueType | null => {
  const normalized = normalizeSourceHandleId(kind, handleId, params)
  if (!normalized) return null

  if (kind === 'constValue' && normalized === 'value') {
    return resolveTypedValueType(params.valueType)
  }

  if ((kind === 'varDefine' || kind === 'varSet') && normalized === 'value') {
    return resolveTypedValueType(params.valueType)
  }

  return getNodePortSpec(kind, params).outputs.find((port) => port.id === normalized)?.valueType ?? null
}

export const getInputHandleValueType = (kind: NodeKind, handleId: string): HandleValueType | null => {
  const normalized = normalizeTargetHandleId(kind, handleId)
  if (!normalized) return null
  return getNodePortSpec(kind).inputs.find((port) => port.id === normalized)?.valueType ?? null
}
