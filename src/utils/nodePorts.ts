import type { NodeKind } from '../types/workflow'
import {
  getFileOperationKind,
  getKeyboardOperationKind,
  getLaunchApplicationMode,
  getMouseOperationKind,
  getNodeFields,
  getNodeMeta,
  getSystemOperationKind,
  getTriggerMode,
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
const MANY = Number.MAX_SAFE_INTEGER
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

const getLaunchApplicationDynamicOutputs = (params: Record<string, unknown> = {}): NodePort[] => {
  const launchMode = getLaunchApplicationMode(params)

  return launchMode === 'shell'
    ? []
    : [{ id: 'pid', label: 'pid', maxConnections: MANY, valueType: 'number' }]
}

const getSystemOperationDynamicOutputs = (params: Record<string, unknown> = {}): NodePort[] => {
  const operation = getSystemOperationKind(params)

  if (operation !== 'runCommand') {
    return []
  }

  return [
    { id: 'command', label: 'command', maxConnections: MANY, valueType: 'string' },
    { id: 'stdout', label: 'stdout', maxConnections: MANY, valueType: 'string' },
    { id: 'stderr', label: 'stderr', maxConnections: MANY, valueType: 'string' },
    { id: 'exitCode', label: 'exitCode', maxConnections: MANY, valueType: 'number' },
  ]
}

const getTriggerDynamicOutputs = (params: Record<string, unknown> = {}): NodePort[] => {
  const triggerMode = getTriggerMode(params)

  if (triggerMode !== 'window') {
    return []
  }

  return [
    { id: 'title', label: 'title', maxConnections: MANY, valueType: 'string' },
    { id: 'program', label: 'program', maxConnections: MANY, valueType: 'string' },
    { id: 'programPath', label: 'programPath', maxConnections: MANY, valueType: 'string' },
    { id: 'className', label: 'className', maxConnections: MANY, valueType: 'string' },
    { id: 'processId', label: 'processId', maxConnections: MANY, valueType: 'number' },
  ]
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
  trigger: {
    inputs: [],
    outputs: singleOut(),
  },
  webOpenPage: {
    inputs: singleIn(),
    outputs: [
      ...singleOut(),
      { id: 'tabId', label: 'tabId', maxConnections: MANY, valueType: 'number' },
      { id: 'url', label: 'url', maxConnections: MANY, valueType: 'string' },
      { id: 'title', label: 'title', maxConnections: MANY, valueType: 'string' },
    ],
  },
  webGetOpenedPage: {
    inputs: singleIn(),
    outputs: [
      ...singleOut(),
      { id: 'tabId', label: 'tabId', maxConnections: MANY, valueType: 'number' },
      { id: 'url', label: 'url', maxConnections: MANY, valueType: 'string' },
      { id: 'title', label: 'title', maxConnections: MANY, valueType: 'string' },
      { id: 'windowId', label: 'windowId', maxConnections: MANY, valueType: 'number' },
    ],
  },
  webElementClick: {
    inputs: singleIn(),
    outputs: [
      ...singleOut(),
      { id: 'clicked', label: 'clicked', maxConnections: MANY, valueType: 'any' },
    ],
  },
  webElementHover: {
    inputs: singleIn(),
    outputs: [
      ...singleOut(),
      { id: 'hovered', label: 'hovered', maxConnections: MANY, valueType: 'any' },
    ],
  },
  webInputFill: {
    inputs: singleIn(),
    outputs: [
      ...singleOut(),
      { id: 'typedLength', label: 'typedLength', maxConnections: MANY, valueType: 'number' },
    ],
  },
  webClosePage: {
    inputs: singleIn(),
    outputs: [
      ...singleOut(),
      { id: 'closed', label: 'closed', maxConnections: MANY, valueType: 'number' },
    ],
  },
  uiaElement: {
    inputs: singleIn(),
    outputs: [
      ...singleOut(),
      { id: 'centerX', label: 'centerX', maxConnections: MANY, valueType: 'number' },
      { id: 'centerY', label: 'centerY', maxConnections: MANY, valueType: 'number' },
      { id: 'name', label: 'name', maxConnections: MANY, valueType: 'string' },
      { id: 'className', label: 'className', maxConnections: MANY, valueType: 'string' },
      { id: 'automationId', label: 'automationId', maxConnections: MANY, valueType: 'string' },
      { id: 'controlType', label: 'controlType', maxConnections: MANY, valueType: 'number' },
      { id: 'processId', label: 'processId', maxConnections: MANY, valueType: 'number' },
      { id: 'rect', label: 'rect', maxConnections: MANY, valueType: 'json' },
      { id: 'elementLocator', label: 'elementLocator', maxConnections: MANY, valueType: 'json' },
      { id: 'summary', label: 'summary', maxConnections: MANY, valueType: 'string' },
      { id: 'fingerprint', label: 'fingerprint', maxConnections: MANY, valueType: 'string' },
    ],
  },
  getMousePosition: {
    inputs: singleIn(),
    outputs: [
      ...singleOut(),
      { id: 'x', label: 'x', maxConnections: MANY, valueType: 'number' },
      { id: 'y', label: 'y', maxConnections: MANY, valueType: 'number' },
      { id: 'isPhysicalPixel', label: 'isPhysicalPixel', maxConnections: MANY, valueType: 'any' },
      { id: 'mode', label: 'mode', maxConnections: MANY, valueType: 'string' },
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
  inputPresetReplay: {
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
  terminateProcess: {
    inputs: singleIn(),
    outputs: [
      ...singleOut(),
      { id: 'targetType', label: 'targetType', maxConnections: MANY, valueType: 'string' },
      { id: 'targetValue', label: 'targetValue', maxConnections: MANY, valueType: 'string' },
      { id: 'killedCount', label: 'killedCount', maxConnections: MANY, valueType: 'number' },
      { id: 'stdout', label: 'stdout', maxConnections: MANY, valueType: 'string' },
      { id: 'stderr', label: 'stderr', maxConnections: MANY, valueType: 'string' },
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
    ],
  },
  fileOperation: {
    inputs: singleIn(),
    outputs: singleOut(),
  },
  pythonCode: {
    inputs: singleIn(),
    outputs: singleOut(),
  },
  clipboardRead: {
    inputs: singleIn(),
    outputs: [
      ...singleOut(),
      { id: 'contentType', label: 'contentType', maxConnections: MANY, valueType: 'string' },
      { id: 'text', label: 'text', maxConnections: MANY, valueType: 'string' },
      { id: 'image', label: 'image', maxConnections: MANY, valueType: 'string' },
      { id: 'imageWidth', label: 'imageWidth', maxConnections: MANY, valueType: 'number' },
      { id: 'imageHeight', label: 'imageHeight', maxConnections: MANY, valueType: 'number' },
      { id: 'content', label: 'content', maxConnections: MANY, valueType: 'json' },
    ],
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
  tryCatch: {
    inputs: singleIn(),
    outputs: [
      { id: 'next', label: 'next', maxConnections: MANY, valueType: 'control' },
      { id: 'success', label: 'success', maxConnections: MANY, valueType: 'control' },
      { id: 'error', label: 'error', maxConnections: MANY, valueType: 'control' },
      { id: 'finally', label: 'finally', maxConnections: MANY, valueType: 'control' },
      { id: 'errorType', label: 'errorType', maxConnections: MANY, valueType: 'string' },
      { id: 'errorMessage', label: 'errorMessage', maxConnections: MANY, valueType: 'string' },
      { id: 'errorDebug', label: 'errorDebug', maxConnections: MANY, valueType: 'string' },
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
  ocrMatch: {
    inputs: singleIn(),
    outputs: [
      { id: 'true', label: 'true', maxConnections: ONE, valueType: 'control' },
      { id: 'false', label: 'false', maxConnections: ONE, valueType: 'control' },
      { id: 'matchX', label: 'matchX', maxConnections: MANY, valueType: 'number' },
      { id: 'matchY', label: 'matchY', maxConnections: MANY, valueType: 'number' },
      { id: 'matchedText', label: 'matchedText', maxConnections: MANY, valueType: 'string' },
      { id: 'confidence', label: 'confidence', maxConnections: MANY, valueType: 'number' },
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
  currentTime: {
    inputs: singleIn(),
    outputs: [
      ...singleOut(),
      { id: 'value', label: 'value', maxConnections: MANY, valueType: 'json' },
      { id: 'iso', label: 'iso', maxConnections: MANY, valueType: 'string' },
      { id: 'localDateTime', label: 'localDateTime', maxConnections: MANY, valueType: 'string' },
      { id: 'localDate', label: 'localDate', maxConnections: MANY, valueType: 'string' },
      { id: 'localTime', label: 'localTime', maxConnections: MANY, valueType: 'string' },
      { id: 'year', label: 'year', maxConnections: MANY, valueType: 'number' },
      { id: 'month', label: 'month', maxConnections: MANY, valueType: 'number' },
      { id: 'day', label: 'day', maxConnections: MANY, valueType: 'number' },
      { id: 'hour', label: 'hour', maxConnections: MANY, valueType: 'number' },
      { id: 'minute', label: 'minute', maxConnections: MANY, valueType: 'number' },
      { id: 'second', label: 'second', maxConnections: MANY, valueType: 'number' },
      { id: 'millisecond', label: 'millisecond', maxConnections: MANY, valueType: 'number' },
      { id: 'weekday', label: 'weekday', maxConnections: MANY, valueType: 'number' },
      { id: 'weekdayName', label: 'weekdayName', maxConnections: MANY, valueType: 'string' },
      { id: 'timestampMs', label: 'timestampMs', maxConnections: MANY, valueType: 'number' },
      { id: 'timestampSec', label: 'timestampSec', maxConnections: MANY, valueType: 'number' },
      { id: 'timezoneOffsetMinutes', label: 'timezoneOffsetMinutes', maxConnections: MANY, valueType: 'number' },
    ],
  },
  jsonExtract: {
    inputs: singleIn(),
    outputs: [
      ...singleOut(),
      { id: 'value', label: 'value', maxConnections: MANY, valueType: 'any' },
    ],
  },
}

export const getNodePortSpec = (kind: NodeKind, params: Record<string, unknown> = {}): NodePortSpec => {
  const base = specs[kind]
  const meta = getNodeMeta(kind)
  const connectableFields = getNodeFields(kind, params, meta.defaultParams).filter((field) => isConnectableFieldType(field.type))
  const dynamicOutputs =
    kind === 'guiAgentActionParser'
      ? getGuiAgentParserDynamicOutputs(params)
      : kind === 'trigger'
        ? getTriggerDynamicOutputs(params)
      : kind === 'mouseOperation'
        ? getMouseOperationDynamicOutputs(params)
        : kind === 'keyboardOperation'
          ? getKeyboardOperationDynamicOutputs(params)
          : kind === 'fileOperation'
            ? getFileOperationDynamicOutputs(params)
            : kind === 'launchApplication'
              ? getLaunchApplicationDynamicOutputs(params)
              : kind === 'systemOperation'
                ? getSystemOperationDynamicOutputs(params)
          : []

  const merged: NodePortSpec = {
    inputs: [
      ...base.inputs,
      ...connectableFields.map((field) => ({
        id: createParamInputHandleId(field.key),
        label: field.label,
        maxConnections: MANY,
        valueType: toHandleValueType(field.type),
      })),
    ],
    outputs: [...base.outputs, ...dynamicOutputs],
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

export const normalizeTargetHandleId = (
  kind: NodeKind,
  handleId: string | null | undefined,
  params: Record<string, unknown> = {},
): string | null =>
  normalizeHandleId(getNodePortSpec(kind, params).inputs, handleId)

export const getOutputHandleMaxConnections = (
  kind: NodeKind,
  handleId: string,
  params: Record<string, unknown> = {},
): number =>
  getNodePortSpec(kind, params).outputs.find((port) => port.id === handleId)?.maxConnections ?? 0

export const getInputHandleMaxConnections = (
  kind: NodeKind,
  handleId: string,
  params: Record<string, unknown> = {},
): number =>
  getNodePortSpec(kind, params).inputs.find((port) => port.id === handleId)?.maxConnections ?? 0

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

export const getInputHandleValueType = (
  kind: NodeKind,
  handleId: string,
  params: Record<string, unknown> = {},
): HandleValueType | null => {
  const normalized = normalizeTargetHandleId(kind, handleId, params)
  if (!normalized) return null
  return getNodePortSpec(kind, params).inputs.find((port) => port.id === normalized)?.valueType ?? null
}
