import { Handle, Position } from '@xyflow/react'
import { createPortal } from 'react-dom'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { NodeKind, WorkflowNodeData } from '../types/workflow'
import { getNodeFields, getNodeMeta, getSystemOperationKind, getTriggerMode, type ParamField } from '../utils/nodeMeta'
import { listOpenWindowEntries, listRunningProcesses, listStartMenuApps, type OpenWindowEntryPayload, type RunningProcessEntryPayload, type StartMenuAppPayload } from '../utils/execution'
import { COMMAND_FLOW_REFRESH_ALL_EVENT } from '../utils/refresh'
import { buildLaunchApplicationParams, filterStartMenuApps, getStartMenuAppDisplayName } from '../utils/startMenuApp'
import {
  createParamInputHandleId,
  getNodePortSpec,
} from '../utils/nodePorts'
import { useWorkflowStore } from '../stores/workflowStore'
import { useSettingsStore } from '../stores/settingsStore'
import PathPickerDropdown from '../components/PathPickerDropdown'
import StartMenuAppOptionsList from '../components/StartMenuAppOptionsList'

interface BaseNodeProps {
  id: string
  data: WorkflowNodeData
  tone?: 'trigger' | 'action' | 'control'
  selected?: boolean
}

const tones = {
  trigger: 'border-[rgb(53,53,53)] bg-[rgb(53,53,53)] text-gray-100',
  action: 'border-[rgb(53,53,53)] bg-[rgb(53,53,53)] text-gray-100',
  control: 'border-[rgb(53,53,53)] bg-[rgb(53,53,53)] text-gray-100',
}

const selectedStyles = {
  trigger: 'border-gray-400 ring-1 ring-gray-400',
  action: 'border-gray-400 ring-1 ring-gray-400',
  control: 'border-gray-400 ring-1 ring-gray-400',
}

const runningStyles = {
  trigger: 'border-red-500 ring-2 ring-red-500/80 shadow-[0_0_0_1px_rgba(239,68,68,0.35)]',
  action: 'border-red-500 ring-2 ring-red-500/80 shadow-[0_0_0_1px_rgba(239,68,68,0.35)]',
  control: 'border-red-500 ring-2 ring-red-500/80 shadow-[0_0_0_1px_rgba(239,68,68,0.35)]',
}

const isFilePathField = (kind: NodeKind, fieldKey: string) => {
  if (kind === 'fileOperation' && (fieldKey === 'sourcePath' || fieldKey === 'targetPath' || fieldKey === 'path')) {
    return true
  }
  if (kind === 'imageMatch' && (fieldKey === 'sourcePath' || fieldKey === 'templatePath')) {
    return true
  }
  if (kind === 'screenshot' && fieldKey === 'saveDir') {
    return true
  }
  if (kind === 'clipboardWrite' && fieldKey === 'imagePath') {
    return true
  }

  return false
}

const isImageMatchImageField = (kind: NodeKind, fieldKey: string) =>
  kind === 'imageMatch' && (fieldKey === 'sourcePath' || fieldKey === 'templatePath')

const isTextFilePathField = (kind: NodeKind, fieldKey: string, params: Record<string, unknown> = {}) =>
  kind === 'fileOperation' && fieldKey === 'path' && (params.operation === 'readText' || params.operation === 'writeText')

const isStrictFilePathField = (kind: NodeKind, fieldKey: string, params: Record<string, unknown> = {}) =>
  isImageMatchImageField(kind, fieldKey) || isTextFilePathField(kind, fieldKey, params) || (kind === 'clipboardWrite' && fieldKey === 'imagePath')

const IMAGE_FILE_FILTERS = [
  { name: '图片文件', extensions: ['png', 'jpg', 'jpeg', 'bmp', 'webp'] },
]

const dedupe = (values: string[]) => Array.from(new Set(values.filter((value) => value.trim().length > 0)))

const isVariableOperandField = (kind: NodeKind, fieldKey: string) =>
  (kind === 'condition' || kind === 'whileLoop') && (fieldKey === 'left' || fieldKey === 'right')

const isVariableNameField = (kind: NodeKind, fieldKey: string) =>
  (kind === 'varDefine' || kind === 'varSet' || kind === 'varMath' || kind === 'varGet') && fieldKey === 'name'

const isInputVariableField = (kind: NodeKind, fieldKey: string) =>
  ((kind === 'clipboardWrite' || kind === 'fileOperation' || kind === 'showMessage') && fieldKey === 'inputVar') ||
  (kind === 'clipboardWrite' && fieldKey === 'imageVar')

const isOutputVariableField = (kind: NodeKind, fieldKey: string) =>
  ((kind === 'clipboardRead' || kind === 'fileOperation') && fieldKey === 'outputVar') ||
  (kind === 'clipboardRead' && (fieldKey === 'outputTextVar' || fieldKey === 'outputImageVar'))

const isWindowLookupNode = (kind: NodeKind, params: Record<string, unknown> = {}) =>
  kind === 'windowActivate' || (kind === 'trigger' && getTriggerMode(params) === 'window')

const isWindowTitleField = (kind: NodeKind, params: Record<string, unknown>, fieldKey: string) =>
  isWindowLookupNode(kind, params) && fieldKey === 'title'

const isWindowProgramField = (kind: NodeKind, params: Record<string, unknown>, fieldKey: string) =>
  isWindowLookupNode(kind, params) && fieldKey === 'program'

const isWindowProgramPathField = (kind: NodeKind, params: Record<string, unknown>, fieldKey: string) =>
  isWindowLookupNode(kind, params) && fieldKey === 'programPath'

const isWindowClassField = (kind: NodeKind, params: Record<string, unknown>, fieldKey: string) =>
  isWindowLookupNode(kind, params) && fieldKey === 'className'

const isWindowPidField = (kind: NodeKind, params: Record<string, unknown>, fieldKey: string) =>
  isWindowLookupNode(kind, params) && fieldKey === 'processId'

const isWindowLookupField = (kind: NodeKind, params: Record<string, unknown>, fieldKey: string) =>
  isWindowLookupNode(kind, params) && ['title', 'program', 'programPath', 'className', 'processId'].includes(fieldKey)

const isTerminateProcessNode = (kind: NodeKind) => kind === 'terminateProcess'
const isTerminateProcessNameField = (kind: NodeKind, fieldKey: string) => isTerminateProcessNode(kind) && fieldKey === 'processName'
const isTerminateProcessPidField = (kind: NodeKind, fieldKey: string) => isTerminateProcessNode(kind) && fieldKey === 'processId'

const describeHandleValueType = (valueType?: string) => {
  if (valueType === 'control') return '控制流'
  if (valueType === 'number') return '数字'
  if (valueType === 'string') return '字符串'
  if (valueType === 'json') return 'JSON'
  if (valueType === 'boolean') return '布尔'
  if (valueType === 'any') return '任意类型'
  return '通用'
}

const describeControlOutputPurpose = (handleId: string, label: string) => {
  if (handleId === 'true') return '条件结果为 true 时从这里继续执行。'
  if (handleId === 'false') return '条件结果为 false 时从这里继续执行。'
  if (handleId === 'loop') return '循环体继续时从这里进入下一轮。'
  if (handleId === 'done') return '循环结束后从这里流向后续节点。'
  if (handleId === 'success') return 'try 主流程成功完成后从这里继续执行。'
  if (handleId === 'error') return 'try/success 阶段发生错误时从这里继续执行。'
  if (handleId === 'finally') return '不论成功或失败，都会执行该 finally 分支。'
  if (handleId === 'next') return '节点执行完成后默认从这里继续。'
  return `控制流会从「${label}」这个分支继续。`
}

const describeDataOutputPurpose = (handleId: string, label: string) => {
  if (handleId === 'centerX') return '输出定位到的控件中心点 X 坐标。'
  if (handleId === 'centerY') return '输出定位到的控件中心点 Y 坐标。'
  if (handleId === 'x') return '输出计算得到的 X 坐标值。'
  if (handleId === 'y') return '输出计算得到的 Y 坐标值。'
  if (handleId === 'value') return '输出当前节点计算/提取得到的结果值。'
  if (handleId === 'elementLocator') return '输出可复用的 UIA 元素定位指纹(JSON)。'
  if (handleId === 'rect') return '输出目标区域矩形信息(left/top/right/bottom)。'
  if (handleId === 'summary') return '输出面向人的元素摘要说明。'
  if (handleId === 'fingerprint') return '输出元素指纹字符串，便于日志与追踪。'
  if (handleId === 'similarity') return '输出图像匹配相似度(0~1)。'
  if (handleId === 'confidence') return '输出识别/匹配置信度(0~1)。'
  if (handleId === 'matchedText') return '输出实际命中的文本内容。'
  if (handleId === 'path') return '输出文件或截图保存路径。'
  if (handleId === 'screenshot') return '输出截图内容(base64)。'
  if (handleId === 'content') return '输出结构化内容(JSON)。'
  if (handleId === 'contentType') return '输出内容类型标识。'
  if (handleId === 'stdout') return '输出命令标准输出内容。'
  if (handleId === 'stderr') return '输出命令错误输出内容。'
  if (handleId === 'exitCode') return '输出命令退出码。'
  if (handleId === 'errorType') return '输出错误类型（如 validation / automation / canceled）。'
  if (handleId === 'errorMessage') return '输出错误消息文本（errormessage）。'
  if (handleId === 'errorDebug') return '输出错误调试字符串（debug）。'
  if (handleId === 'pid') return '输出启动进程的 PID。'
  return `输出「${label}」的结果值供下游节点使用。`
}

const describeParamInputPurpose = (fieldKey: string, label: string) => {
  if (fieldKey === 'keyPath') return '传入要提取的 JSON 键路径（如 user.name / list[0].id）。'
  if (fieldKey === 'sourceJson') return '传入待提取的源 JSON 数据。'
  if (fieldKey === 'elementLocator') return '传入 UIA 元素定位指纹(JSON)，用于稳定定位控件。'
  if (fieldKey === 'x' || fieldKey === 'y') return `传入鼠标目标 ${label}，覆盖节点中的手动坐标。`
  if (fieldKey === 'centerX' || fieldKey === 'centerY') return `传入控件中心 ${label} 坐标用于后续动作。`
  if (fieldKey === 'title') return '传入窗口标题匹配值。'
  if (fieldKey === 'program') return '传入窗口程序名匹配值。'
  if (fieldKey === 'processId') return '传入目标进程 PID 匹配值。'
  return `传入「${label}」参数，执行时覆盖本节点同名字段。`
}

const buildHandleTooltip = ({
  direction,
  nodeLabel,
  handleId,
  fieldKey,
  label,
  valueType,
}: {
  direction: 'input' | 'output'
  nodeLabel: string
  handleId: string
  fieldKey?: string
  label: string
  valueType?: string
}) => {
  const typeText = describeHandleValueType(valueType)

  if (direction === 'input') {
    if (valueType === 'control') {
      return `流程入口：收到上游控制信号后开始执行「${nodeLabel}」。`
    }
    return `参数输入：${describeParamInputPurpose(fieldKey ?? handleId, label)} 类型：${typeText}。`
  }

  if (valueType === 'control') {
    return `流程输出：${describeControlOutputPurpose(handleId, label)}`
  }

  return `数据输出：${describeDataOutputPurpose(handleId, label)} 类型：${typeText}。`
}

export default function BaseNode({ id, data, tone = 'action', selected = false }: BaseNodeProps) {
  const isSelected = selected
  const runningNodeIds = useWorkflowStore((state) => state.runningNodeIds)
  const isRunning = runningNodeIds.includes(id)
  const portSpec = getNodePortSpec(data.kind, data.params)
  const updateNodeParams = useWorkflowStore((state) => state.updateNodeParams)
  const nodes = useWorkflowStore((state) => state.nodes)
  const edges = useWorkflowStore((state) => state.edges)
  const nodePosition = useWorkflowStore((state) =>
    state.nodes.find((node) => node.id === id)?.position,
  )
  const meta = getNodeMeta(data.kind)
  const params = data.params ?? {}
  const triggerMode = data.kind === 'trigger' ? getTriggerMode(params) : null
  const visibleFields = getNodeFields(data.kind, params, meta.defaultParams)
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [openSelectFieldKey, setOpenSelectFieldKey] = useState<string | null>(null)
  const [openSuggestFieldKey, setOpenSuggestFieldKey] = useState<string | null>(null)
  const [activeSuggestIndex, setActiveSuggestIndex] = useState(0)
  const [openWindows, setOpenWindows] = useState<OpenWindowEntryPayload[]>([])
  const [runningProcesses, setRunningProcesses] = useState<RunningProcessEntryPayload[]>([])
  const [startMenuApps, setStartMenuApps] = useState<StartMenuAppPayload[]>([])
  const llmPresets = useSettingsStore((state) => state.llmPresets)
  const inputRecordingPresets = useSettingsStore((state) => state.inputRecordingPresets)
  const [pathEditor, setPathEditor] = useState<{
    fieldKey: string
    value: string
    anchorLeft: number
    anchorTop: number
    anchorWidth: number
  } | null>(null)
  const [textEditor, setTextEditor] = useState<{
    fieldKey: string
    value: string
    anchorLeft: number
    anchorTop: number
    anchorWidth: number
    isJson: boolean
  } | null>(null)
  const [textEditorError, setTextEditorError] = useState<string | null>(null)
  const pathEditorPanelRef = useRef<HTMLDivElement | null>(null)
  const textEditorPanelRef = useRef<HTMLDivElement | null>(null)

  const variableNames = useMemo(
    () =>
      dedupe(
        nodes
          .filter((node) => node.data.kind === 'varDefine')
          .map((node) => (typeof node.data.params.name === 'string' ? node.data.params.name.trim() : '')),
      ),
    [nodes],
  )

  const windowTitles = useMemo(
    () => dedupe(openWindows.map((entry) => entry.title)),
    [openWindows],
  )

  const windowPrograms = useMemo(
    () => dedupe(openWindows.map((entry) => entry.programName)),
    [openWindows],
  )

  const windowProgramPaths = useMemo(
    () => dedupe(openWindows.map((entry) => entry.programPath)),
    [openWindows],
  )

  const windowClassNames = useMemo(
    () => dedupe(openWindows.map((entry) => entry.className)),
    [openWindows],
  )

  const windowPids = useMemo(
    () => dedupe(openWindows.map((entry) => (entry.processId > 0 ? String(entry.processId) : ''))),
    [openWindows],
  )

  const processNames = useMemo(
    () => dedupe(runningProcesses.map((entry) => entry.processName)),
    [runningProcesses],
  )

  const processPids = useMemo(
    () => dedupe(runningProcesses.map((entry) => (entry.pid > 0 ? String(entry.pid) : ''))),
    [runningProcesses],
  )

  const refreshWindowEntries = () => {
    if (!isWindowLookupNode(data.kind, params)) return

    void listOpenWindowEntries()
      .then((entries) => {
        setOpenWindows(entries)
      })
      .catch(() => {
        setOpenWindows([])
      })
  }

  useEffect(() => {
    if (!isWindowLookupNode(data.kind, params)) {
      setOpenWindows([])
      return
    }

    let cancelled = false
    void listOpenWindowEntries()
      .then((entries) => {
        if (cancelled) return
        setOpenWindows(entries)
      })
      .catch(() => {
        if (cancelled) return
        setOpenWindows([])
      })

    return () => {
      cancelled = true
    }
  }, [data.kind, params, triggerMode])

  useEffect(() => {
    if (data.kind !== 'launchApplication') {
      setStartMenuApps([])
      return
    }

    let cancelled = false
    void listStartMenuApps()
      .then((apps) => {
        if (cancelled) return
        setStartMenuApps(apps)
      })
      .catch(() => {
        if (cancelled) return
        setStartMenuApps([])
      })

    return () => {
      cancelled = true
    }
  }, [data.kind])

  useEffect(() => {
    if (!isTerminateProcessNode(data.kind)) {
      setRunningProcesses([])
      return
    }

    let cancelled = false
    void listRunningProcesses()
      .then((entries) => {
        if (cancelled) return
        setRunningProcesses(entries)
      })
      .catch(() => {
        if (cancelled) return
        setRunningProcesses([])
      })

    return () => {
      cancelled = true
    }
  }, [data.kind])

  useEffect(() => {
    const handleGlobalRefresh = () => {
      if (isWindowLookupNode(data.kind, params)) {
        void listOpenWindowEntries()
          .then((entries) => {
            setOpenWindows(entries)
          })
          .catch(() => {
            setOpenWindows([])
          })
      }

      if (isTerminateProcessNode(data.kind)) {
        void listRunningProcesses(true)
          .then((entries) => {
            setRunningProcesses(entries)
          })
          .catch(() => {
            setRunningProcesses([])
          })
      }

      if (data.kind === 'launchApplication') {
        void listStartMenuApps(true)
          .then((apps) => {
            setStartMenuApps(apps)
          })
          .catch(() => {
            setStartMenuApps([])
          })
      }
    }

    window.addEventListener(COMMAND_FLOW_REFRESH_ALL_EVENT, handleGlobalRefresh)
    return () => {
      window.removeEventListener(COMMAND_FLOW_REFRESH_ALL_EVENT, handleGlobalRefresh)
    }
  }, [data.kind, params, triggerMode])

  const getStringSuggestions = (field: ParamField): string[] => {
    const kind = data.kind

    if (isWindowTitleField(kind, params, field.key)) {
      return windowTitles
    }

    if (isWindowProgramField(kind, params, field.key)) {
      return windowPrograms
    }

    if (isWindowProgramPathField(kind, params, field.key)) {
      return windowProgramPaths
    }

    if (isWindowClassField(kind, params, field.key)) {
      return windowClassNames
    }

    if (isWindowPidField(kind, params, field.key)) {
      return windowPids
    }

    if (isTerminateProcessNameField(kind, field.key)) {
      return processNames
    }

    if (isTerminateProcessPidField(kind, field.key)) {
      return processPids
    }

    const variableReferenceField =
      isVariableOperandField(kind, field.key) &&
      (field.key === 'left' ? params.leftType === 'var' : params.rightType === 'var')

    if (
      isVariableNameField(kind, field.key) ||
      isInputVariableField(kind, field.key) ||
      isOutputVariableField(kind, field.key) ||
      variableReferenceField
    ) {
      return variableNames
    }

    return []
  }

  const findOpenWindowEntry = (fieldKey: string, value: string) => {
    const normalizedValue = value.trim().toLowerCase()
    if (!normalizedValue) return null

    return openWindows.find((entry) => {
      if (fieldKey === 'title') return entry.title.trim().toLowerCase() === normalizedValue
      if (fieldKey === 'program') return entry.programName.trim().toLowerCase() === normalizedValue
      if (fieldKey === 'programPath') return entry.programPath.trim().toLowerCase() === normalizedValue
      if (fieldKey === 'className') return entry.className.trim().toLowerCase() === normalizedValue
      if (fieldKey === 'processId') return String(entry.processId) === value.trim()
      return false
    }) ?? null
  }

  const applyWindowEntrySelection = (fieldKey: string, value: string) => {
    if (!isWindowLookupField(data.kind, params, fieldKey)) {
      return false
    }

    const matchedEntry = findOpenWindowEntry(fieldKey, value)
    if (!matchedEntry) {
      return false
    }

    updateNodeParams(id, {
      ...params,
      title: matchedEntry.title,
      program: matchedEntry.programName,
      programPath: matchedEntry.programPath,
      className: matchedEntry.className,
      processId: matchedEntry.processId,
    })
    setDrafts((state) => ({
      ...state,
      title: matchedEntry.title,
      program: matchedEntry.programName,
      programPath: matchedEntry.programPath,
      className: matchedEntry.className,
      processId: matchedEntry.processId > 0 ? String(matchedEntry.processId) : '',
    }))
    setErrors((state) => {
      const nextState = { ...state }
      delete nextState.title
      delete nextState.program
      delete nextState.programPath
      delete nextState.className
      delete nextState.processId
      return nextState
    })
    return true
  }

  const findRunningProcessEntry = (fieldKey: string, value: string) => {
    const normalizedValue = value.trim().toLowerCase()
    if (!normalizedValue) return null

    return runningProcesses.find((entry) => {
      if (fieldKey === 'processName') return entry.processName.trim().toLowerCase() === normalizedValue
      if (fieldKey === 'processId') return String(entry.pid) === value.trim()
      return false
    }) ?? null
  }

  const applyRunningProcessSelection = (fieldKey: string, value: string) => {
    if (!isTerminateProcessNode(data.kind) || !['processName', 'processId'].includes(fieldKey)) {
      return false
    }

    const matchedEntry = findRunningProcessEntry(fieldKey, value)
    if (!matchedEntry) {
      return false
    }

    updateNodeParams(id, {
      ...params,
      processName: matchedEntry.processName,
      processId: matchedEntry.pid,
    })
    setDrafts((state) => ({
      ...state,
      processName: matchedEntry.processName,
      processId: matchedEntry.pid > 0 ? String(matchedEntry.pid) : '',
    }))
    setErrors((state) => {
      const nextState = { ...state }
      delete nextState.processName
      delete nextState.processId
      return nextState
    })

    return true
  }

  const updateParam = (key: string, value: unknown) => {
    const nextParams: Record<string, unknown> = {
      ...params,
      [key]: value,
    }

    if (data.kind === 'systemOperation' && (key === 'percent' || key === 'operation')) {
      const operation = getSystemOperationKind(nextParams, getSystemOperationKind(meta.defaultParams))
      if (operation === 'volumeSet' || operation === 'brightnessSet') {
        const num = Number(nextParams.percent ?? 50)
        if (!Number.isNaN(num)) {
          nextParams.percent = Math.min(100, Math.max(0, num))
        }
      }
    }

    if (data.kind === 'varDefine' || data.kind === 'varSet' || data.kind === 'constValue') {
      const valueType = String(nextParams.valueType ?? 'number')
      if (valueType === 'string') {
        nextParams.value = String(nextParams.valueString ?? '')
      } else if (valueType === 'number') {
        nextParams.value = Number(nextParams.valueNumber ?? 0)
      } else if (valueType === 'boolean') {
        nextParams.value = String(nextParams.valueBoolean ?? 'false') === 'true'
      } else {
        try {
          nextParams.value = JSON.parse(String(nextParams.valueJson ?? 'null'))
        } catch {
          nextParams.value = null
        }
      }
    }

    if (data.kind === 'varMath') {
      const operandType = String(nextParams.operandType ?? 'number')
      if (operandType === 'string') {
        nextParams.operand = String(nextParams.operandString ?? '0')
      } else if (operandType === 'number') {
        nextParams.operand = Number(nextParams.operandNumber ?? 0)
      } else if (operandType === 'boolean') {
        nextParams.operand = String(nextParams.operandBoolean ?? 'false') === 'true'
      } else {
        try {
          nextParams.operand = JSON.parse(String(nextParams.operandJson ?? '0'))
        } catch {
          nextParams.operand = 0
        }
      }
    }

    if (key === 'processId') {
      const num = Number(value)
      nextParams.processId = Number.isFinite(num) && num > 0 ? Math.floor(num) : 0
    }

    updateNodeParams(id, nextParams)
  }

  const shiftSelectValue = (field: ParamField, direction: -1 | 1) => {
    const options = field.options ?? []
    if (options.length === 0) return
    const currentValue = String(params[field.key] ?? meta.defaultParams[field.key] ?? options[0].value)
    const currentIndex = Math.max(
      0,
      options.findIndex((option) => option.value === currentValue),
    )
    const nextIndex = Math.min(options.length - 1, Math.max(0, currentIndex + direction))
    updateParam(field.key, options[nextIndex].value)
    setDrafts((state) => ({ ...state, [field.key]: options[nextIndex].label }))
    setErrors((state) => {
      const next = { ...state }
      delete next[field.key]
      return next
    })
  }

  const shiftNumberValue = (field: ParamField, direction: -1 | 1) => {
    const step = field.step ?? 1
    const current = Number(params[field.key] ?? meta.defaultParams[field.key] ?? 0)
    const base = Number.isFinite(current) ? current : 0
    let next = base + direction * step
    if (typeof field.min === 'number') next = Math.max(field.min, next)
    if (typeof field.max === 'number') next = Math.min(field.max, next)
    updateParam(field.key, next)
    setDrafts((state) => ({ ...state, [field.key]: String(next) }))
    setErrors((state) => {
      const nextState = { ...state }
      delete nextState[field.key]
      return nextState
    })
  }

  const isCompleteNumber = (value: string) => value !== '' && value !== '-' && value !== '.' && value !== '-.'

  const openPathEditorFromInput = (element: HTMLInputElement, fieldKey: string, value: string) => {
    const rect = element.getBoundingClientRect()
    const viewportWidth = window.innerWidth
    const viewportHeight = window.innerHeight
    const popupWidth = Math.min(360, Math.max(280, viewportWidth * 0.86))

    const centerX = rect.left + rect.width / 2
    const clampedCenterX = Math.max(popupWidth / 2 + 8, Math.min(viewportWidth - popupWidth / 2 - 8, centerX))

    const desiredTop = rect.top - 8
    const minTop = 56
    const maxTop = viewportHeight - 56
    const clampedTop = Math.max(minTop, Math.min(maxTop, desiredTop))

    setPathEditor({
      fieldKey,
      value,
      anchorLeft: clampedCenterX - rect.width / 2,
      anchorTop: clampedTop,
      anchorWidth: rect.width,
    })
  }

  const openTextEditorFromInput = (
    element: HTMLInputElement,
    field: ParamField,
    value: string,
    isJsonEditor: boolean,
  ) => {
    const rect = element.getBoundingClientRect()
    const viewportWidth = window.innerWidth
    const viewportHeight = window.innerHeight
    const popupWidth = Math.min(480, Math.max(320, viewportWidth * 0.88))

    const centerX = rect.left + rect.width / 2
    const clampedCenterX = Math.max(popupWidth / 2 + 8, Math.min(viewportWidth - popupWidth / 2 - 8, centerX))

    const desiredTop = rect.top - 8
    const minTop = 72
    const maxTop = viewportHeight - 72
    const clampedTop = Math.max(minTop, Math.min(maxTop, desiredTop))

    setTextEditor({
      fieldKey: field.key,
      value,
      anchorLeft: clampedCenterX - rect.width / 2,
      anchorTop: clampedTop,
      anchorWidth: rect.width,
      isJson: isJsonEditor,
    })
    setTextEditorError(null)
  }

  useEffect(() => {
    if (!pathEditor && !textEditor && !openSelectFieldKey && !openSuggestFieldKey) return

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as HTMLElement

      if (pathEditor && pathEditorPanelRef.current && !pathEditorPanelRef.current.contains(target)) {
        setPathEditor(null)
      }

      if (textEditor && textEditorPanelRef.current && !textEditorPanelRef.current.contains(target)) {
        setTextEditor(null)
        setTextEditorError(null)
      }

      if (openSelectFieldKey) {
        const inSelectRoot = target.closest<HTMLElement>('[data-node-select-root="true"]')
        const selectFieldKey = inSelectRoot?.dataset.nodeSelectFieldKey ?? null
        const selectNodeId = inSelectRoot?.dataset.nodeSelectNodeId ?? null
        if (!inSelectRoot || selectFieldKey !== openSelectFieldKey || selectNodeId !== id) {
          setOpenSelectFieldKey(null)
        }
      }

      if (openSuggestFieldKey) {
        const inSuggestRoot = target.closest<HTMLElement>('[data-node-suggest-root="true"]')
        const suggestFieldKey = inSuggestRoot?.dataset.nodeSuggestFieldKey ?? null
        const suggestNodeId = inSuggestRoot?.dataset.nodeSuggestNodeId ?? null
        if (!inSuggestRoot || suggestFieldKey !== openSuggestFieldKey || suggestNodeId !== id) {
          if (data.kind === 'launchApplication' && openSuggestFieldKey === 'selectedApp') {
            const selectedApp = startMenuApps.find((app) => app.sourcePath === String(params.selectedApp ?? ''))
            setDrafts((state) => ({ ...state, selectedApp: selectedApp ? getStartMenuAppDisplayName(selectedApp) : '' }))
          }
          setOpenSuggestFieldKey(null)
        }
      }
    }

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setPathEditor(null)
        setTextEditor(null)
        setTextEditorError(null)
      }
    }

    document.addEventListener('pointerdown', handlePointerDown, true)
    document.addEventListener('keydown', handleEscape)

    return () => {
      document.removeEventListener('pointerdown', handlePointerDown, true)
      document.removeEventListener('keydown', handleEscape)
    }
  }, [pathEditor, textEditor, openSelectFieldKey, openSuggestFieldKey])

  useEffect(() => {
    setPathEditor(null)
    setTextEditor(null)
    setTextEditorError(null)
    setOpenSelectFieldKey(null)
    setOpenSuggestFieldKey(null)
  }, [nodePosition?.x, nodePosition?.y])

  const commitStringValue = (field: ParamField, value: string) => {
    setDrafts((state) => ({ ...state, [field.key]: value }))
    updateParam(field.key, value)
    setErrors((state) => {
      const nextState = { ...state }
      delete nextState[field.key]
      return nextState
    })
  }

  const renderFieldInput = (field: ParamField, connectedToInput: boolean) => {
    const currentValue = params[field.key] ?? meta.defaultParams[field.key]
    const isBoolean = field.type === 'boolean'
    const isNumber = field.type === 'number'
    const isWindowPidSuggestionField = isWindowPidField(data.kind, params, field.key)
    const isTerminateProcessPidSuggestionField = isTerminateProcessPidField(data.kind, field.key)
    const isPidSuggestionField = isWindowPidSuggestionField || isTerminateProcessPidSuggestionField
    const isSelect = field.type === 'select'
    const isJson = field.type === 'json'
    const isSensitiveField = data.kind === 'guiAgent' && field.key === 'apiKey'
    const canUseArrows = isNumber && !isPidSuggestionField
    const isPathField = isFilePathField(data.kind, field.key)
    const isScreenshotSizeFieldDisabled =
      data.kind === 'screenshot' &&
      (field.key === 'startX' || field.key === 'startY' || field.key === 'width' || field.key === 'height') &&
      Boolean(params.fullscreen)
    const isScreenshotSaveDirFieldDisabled =
      data.kind === 'screenshot' && field.key === 'saveDir' && !Boolean(params.shouldSave ?? true)
    const isGuiAgentImageInputDisabled =
      data.kind === 'guiAgent' && field.key === 'imageInput' && Boolean(params.continuousMode ?? true)
    const isInputDisabled =
      connectedToInput || isScreenshotSaveDirFieldDisabled || isScreenshotSizeFieldDisabled || isGuiAgentImageInputDisabled

    if (data.kind === 'launchApplication' && field.key === 'selectedApp') {
      const selectedApp = startMenuApps.find((app) => app.sourcePath === String(currentValue ?? '')) ?? null
      const displayValue = drafts[field.key] ?? (selectedApp ? getStartMenuAppDisplayName(selectedApp) : '')
      const filteredApps = filterStartMenuApps(startMenuApps, displayValue)

      const commitLaunchApp = (app: StartMenuAppPayload) => {
        updateNodeParams(id, buildLaunchApplicationParams(params, app))
        setDrafts((state) => ({ ...state, [field.key]: getStartMenuAppDisplayName(app) }))
        setErrors((state) => {
          const nextState = { ...state }
          delete nextState[field.key]
          return nextState
        })
        setOpenSuggestFieldKey(null)
      }

      return (
        <div
          className="relative"
          data-node-suggest-root="true"
          data-node-suggest-node-id={id}
          data-node-suggest-field-key={field.key}
        >
          <div className={`flex items-center gap-1 rounded-full border bg-black/20 px-2 py-1 text-[11px] shadow-inner dark:bg-black/35 ${errors[field.key] ? 'border-rose-400/80' : 'border-white/25 dark:border-white/20'}`}>
            <input
              type="text"
              value={displayValue}
              disabled={isInputDisabled}
              placeholder={startMenuApps.length > 0 ? '输入筛选应用' : '未扫描到可用应用'}
              onFocus={() => {
                if (isInputDisabled) return
                setOpenSelectFieldKey(null)
                setOpenSuggestFieldKey(field.key)
                setActiveSuggestIndex(0)
              }}
              onChange={(event) => {
                if (isInputDisabled) return
                setDrafts((state) => ({ ...state, [field.key]: event.target.value }))
                setOpenSelectFieldKey(null)
                setOpenSuggestFieldKey(field.key)
                setActiveSuggestIndex(0)
              }}
              onClick={() => {
                if (isInputDisabled) return
                setOpenSelectFieldKey(null)
                setOpenSuggestFieldKey(field.key)
                setActiveSuggestIndex(0)
              }}
              onKeyDown={(event) => {
                if (openSuggestFieldKey !== field.key) return

                if (event.key === 'ArrowDown') {
                  event.preventDefault()
                  if (filteredApps.length > 0) {
                    setActiveSuggestIndex((idx) => Math.min(idx + 1, filteredApps.length - 1))
                  }
                  return
                }

                if (event.key === 'ArrowUp') {
                  event.preventDefault()
                  if (filteredApps.length > 0) {
                    setActiveSuggestIndex((idx) => Math.max(idx - 1, 0))
                  }
                  return
                }

                if (event.key === 'Enter') {
                  if (filteredApps.length > 0) {
                    event.preventDefault()
                    const picked = filteredApps[Math.max(0, Math.min(activeSuggestIndex, filteredApps.length - 1))]
                    if (picked) {
                      commitLaunchApp(picked)
                    }
                  }
                  return
                }

                if (event.key === 'Escape') {
                  event.preventDefault()
                  setDrafts((state) => ({ ...state, [field.key]: selectedApp ? getStartMenuAppDisplayName(selectedApp) : '' }))
                  setOpenSuggestFieldKey(null)
                }
              }}
              onDoubleClick={(e) => e.stopPropagation()}
              className={`nodrag w-full bg-transparent px-1 text-[11px] font-semibold ${isInputDisabled ? 'text-slate-400' : 'text-slate-100'} outline-none placeholder:text-slate-400`}
            />
            <button
              type="button"
              disabled={isInputDisabled}
              onClick={() => {
                if (isInputDisabled) return
                setOpenSelectFieldKey(null)
                setOpenSuggestFieldKey((prev) => {
                  const nextOpen = prev === field.key ? null : field.key
                  if (nextOpen) {
                    setActiveSuggestIndex(0)
                  } else {
                    setDrafts((state) => ({ ...state, [field.key]: selectedApp ? getStartMenuAppDisplayName(selectedApp) : '' }))
                  }
                  return nextOpen
                })
              }}
              className="nodrag rounded-full px-1.5 py-0.5 text-slate-300 transition-colors hover:bg-white/10 disabled:cursor-not-allowed disabled:text-slate-500"
              aria-label="切换应用下拉列表"
            >
              ▾
            </button>
          </div>
          <Handle
            id={createParamInputHandleId(field.key)}
            type="target"
            position={Position.Left}
            className="proximity-handle"
            style={{ top: '50%', left: -6 }}
            title={buildHandleTooltip({
              direction: 'input',
              nodeLabel: data.label,
              handleId: createParamInputHandleId(field.key),
              fieldKey: field.key,
              label: field.label,
              valueType: field.type === 'number' ? 'number' : field.type === 'json' ? 'json' : 'string',
            })}
          />

          {openSuggestFieldKey === field.key ? (
            <div
              className="absolute left-0 right-0 z-[270] mt-1 rounded-xl border border-white/20 bg-[#1f2127]/95 p-1 shadow-2xl backdrop-blur"
              onWheelCapture={(event) => event.stopPropagation()}
            >
              <StartMenuAppOptionsList
                apps={filteredApps}
                activeIndex={activeSuggestIndex}
                selectedValue={String(currentValue ?? '')}
                onHover={setActiveSuggestIndex}
                onSelect={commitLaunchApp}
                emptyText="暂无匹配应用"
                tone="dark"
                maxHeightClassName="max-h-44"
              />
            </div>
          ) : null}
        </div>
      )
    }

    if (isBoolean) {
      const checked = Boolean(currentValue)
      return (
        <div className="relative">
          <button
            type="button"
            disabled={isInputDisabled}
            onClick={() => {
              if (isInputDisabled) return
              updateParam(field.key, !checked)
            }}
            className="nodrag flex h-9 w-full items-center rounded-full border border-white/25 bg-black/20 px-2.5 text-[11px] shadow-inner transition-colors hover:border-cyan-300/60 disabled:cursor-not-allowed disabled:opacity-60 dark:border-white/20 dark:bg-black/35"
            title={checked ? '点击切换为 false' : '点击切换为 true'}
          >
            <span className={`text-[11px] font-semibold ${isInputDisabled ? 'text-slate-500' : 'text-slate-100'}`}>
              {checked ? 'true' : 'false'}
            </span>
            <span className={`ml-auto inline-flex h-5 w-9 items-center rounded-full border px-[2px] transition-colors ${checked ? 'border-cyan-300/80 bg-cyan-400/30' : 'border-white/25 bg-black/20'}`}>
              <span
                className={`h-4 w-4 rounded-full bg-white shadow transition-transform ${checked ? 'translate-x-4' : 'translate-x-0'}`}
              />
            </span>
          </button>
          <Handle
            id={createParamInputHandleId(field.key)}
            type="target"
            position={Position.Left}
            className="proximity-handle"
            style={{ top: '50%', left: -6 }}
            title={buildHandleTooltip({
              direction: 'input',
              nodeLabel: data.label,
              handleId: createParamInputHandleId(field.key),
              fieldKey: field.key,
              label: field.label,
              valueType: 'boolean',
            })}
          />
        </div>
      )
    }

    const selectOptions = data.kind === 'guiAgent' && field.key === 'llmPresetId'
      ? llmPresets.map((preset) => ({ label: preset.name, value: preset.id }))
      : data.kind === 'inputPresetReplay' && field.key === 'presetId'
        ? inputRecordingPresets.map((preset) => ({ label: preset.name, value: preset.id }))
      : data.kind === 'launchApplication' && field.key === 'selectedApp'
        ? startMenuApps.map((app) => ({ label: app.appName, value: app.sourcePath }))
        : (field.options ?? [])
    const selectedOption = selectOptions.find((option) => option.value === String(currentValue ?? ''))

    if (isSelect) {
      return (
        <div
          className="relative"
          data-node-select-root="true"
          data-node-select-node-id={id}
          data-node-select-field-key={field.key}
        >
          <button
            type="button"
            disabled={isInputDisabled}
            onClick={() => {
              if (isInputDisabled) return
              setOpenSuggestFieldKey(null)
              setOpenSelectFieldKey((prev) => (prev === field.key ? null : field.key))
            }}
            className="nodrag flex w-full items-center rounded-full border border-white/25 bg-black/20 px-2.5 py-1 text-[11px] shadow-inner transition-colors hover:border-cyan-300/60 disabled:cursor-not-allowed disabled:opacity-60 dark:border-white/20 dark:bg-black/35"
          >
            <span className={`truncate ${connectedToInput ? 'text-slate-400' : 'text-slate-100'}`}>
              {selectedOption?.label ?? '请选择'}
            </span>
            <span className="ml-auto text-slate-300">▾</span>
          </button>

          <Handle
            id={createParamInputHandleId(field.key)}
            type="target"
            position={Position.Left}
            className="proximity-handle"
            style={{ top: '50%', left: -6 }}
            title={buildHandleTooltip({
              direction: 'input',
              nodeLabel: data.label,
              handleId: createParamInputHandleId(field.key),
              fieldKey: field.key,
              label: field.label,
              valueType: field.type === 'number' ? 'number' : field.type === 'json' ? 'json' : 'string',
            })}
          />

          {openSelectFieldKey === field.key && !isInputDisabled ? (
            <div
              className="absolute left-0 right-0 z-[260] mt-1 max-h-40 overflow-auto rounded-xl border border-white/20 bg-[#1f2127]/95 p-1 shadow-2xl backdrop-blur"
              onWheelCapture={(event) => event.stopPropagation()}
            >
              {selectOptions.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => {
                    if (data.kind === 'launchApplication' && field.key === 'selectedApp') {
                      const selectedApp = startMenuApps.find((app) => app.sourcePath === option.value)
                      if (selectedApp) {
                        updateNodeParams(id, buildLaunchApplicationParams(params, selectedApp))
                      } else {
                        updateParam(field.key, option.value)
                      }
                    } else if (data.kind === 'inputPresetReplay' && field.key === 'presetId') {
                      const matchedPreset = inputRecordingPresets.find((preset) => preset.id === option.value)
                      updateNodeParams(id, {
                        ...params,
                        presetId: option.value,
                        presetName: matchedPreset?.name ?? '',
                      })
                    } else {
                      updateParam(field.key, option.value)
                    }
                    setDrafts((state) => ({ ...state, [field.key]: option.label }))
                    setErrors((state) => {
                      const nextState = { ...state }
                      delete nextState[field.key]
                      return nextState
                    })
                    setOpenSelectFieldKey(null)
                  }}
                  className={`nodrag block w-full rounded-lg px-2 py-1.5 text-left text-[11px] transition-colors ${
                    option.value === String(currentValue ?? '')
                      ? 'bg-cyan-500 text-white'
                      : 'text-slate-200 hover:bg-white/10'
                  }`}
                >
                  {option.label}
                </button>
              ))}
            </div>
          ) : null}
        </div>
      )
    }

    const displayValue = (() => {
      if (drafts[field.key] !== undefined) {
        return drafts[field.key]
      }
      if (isSelect) {
        const matched = (field.options ?? []).find((option) => option.value === String(currentValue ?? ''))
        return matched?.label ?? String(currentValue ?? '')
      }
      if (isJson) {
        // Special handling for elementLocator - parse fingerprint if it's a JSON string
        if (field.key === 'elementLocator' && currentValue && typeof currentValue === 'object') {
          const locator = currentValue as { fingerprint?: string }
          if (locator.fingerprint) {
            try {
              const parsedFingerprint = JSON.parse(locator.fingerprint)
              return JSON.stringify({ ...locator, fingerprint: parsedFingerprint }, null, 2)
            } catch {
              // If fingerprint is not valid JSON, fall through
            }
          }
        }
        try {
          return JSON.stringify(currentValue, null, 2)
        } catch {
          return String(currentValue ?? '')
        }
      }
      return String(currentValue ?? '')
    })()

    const suggestions = getStringSuggestions(field)
    const supportsVariableSuggestions =
      isVariableNameField(data.kind, field.key) ||
      isInputVariableField(data.kind, field.key) ||
      isOutputVariableField(data.kind, field.key) ||
      (isVariableOperandField(data.kind, field.key) &&
        (field.key === 'left' ? params.leftType === 'var' : params.rightType === 'var'))

    const supportsWindowTitleSuggestions = isWindowTitleField(data.kind, params, field.key)
    const supportsWindowProgramSuggestions = isWindowProgramField(data.kind, params, field.key)
    const supportsWindowProgramPathSuggestions = isWindowProgramPathField(data.kind, params, field.key)
    const supportsWindowClassSuggestions = isWindowClassField(data.kind, params, field.key)
    const supportsWindowPidSuggestions = isWindowPidSuggestionField
    const supportsProcessNameSuggestions = isTerminateProcessNameField(data.kind, field.key)
    const supportsProcessPidSuggestions = isTerminateProcessPidSuggestionField
    const supportsGuiModelSuggestions = false
    const supportsWindowSuggestions =
      supportsWindowTitleSuggestions ||
      supportsWindowProgramSuggestions ||
      supportsWindowProgramPathSuggestions ||
      supportsWindowClassSuggestions ||
      supportsWindowPidSuggestions
    const supportsProcessSuggestions = supportsProcessNameSuggestions || supportsProcessPidSuggestions
    const supportsInlineSuggestions =
      supportsVariableSuggestions || supportsWindowSuggestions || supportsProcessSuggestions || supportsGuiModelSuggestions

    const canShowSuggestions = !connectedToInput && (!isNumber || isPidSuggestionField) && !isSelect && !isJson && !isPathField && !isSensitiveField && supportsInlineSuggestions
    const usesFloatingTextEditor = !connectedToInput && !isPidSuggestionField && !isNumber && !isSelect && !isPathField && !isSensitiveField && !supportsInlineSuggestions
    const filteredSuggestions = canShowSuggestions
      ? (supportsWindowSuggestions
        ? suggestions
        : suggestions.filter((option) => option.toLowerCase().includes(displayValue.trim().toLowerCase())))
      : []

    const commitSuggestedValue = (value: string) => {
      if (applyWindowEntrySelection(field.key, value)) {
        return
      }

      if (applyRunningProcessSelection(field.key, value)) {
        return
      }

      setDrafts((state) => ({ ...state, [field.key]: value }))
      if (isPidSuggestionField) {
        updateParam(field.key, value.trim() ? Number(value) : 0)
      } else {
        updateParam(field.key, value)
      }
      setErrors((state) => {
        const nextState = { ...state }
        delete nextState[field.key]
        return nextState
      })
    }

    return (
      <div
        className="relative"
        data-node-suggest-root="true"
        data-node-suggest-node-id={id}
        data-node-suggest-field-key={field.key}
      >
        <div className={`flex items-center rounded-full border bg-black/20 px-2 py-1 text-[11px] shadow-inner dark:bg-black/35 ${errors[field.key] ? 'border-rose-400/80' : 'border-white/25 dark:border-white/20'}`}>
          {canUseArrows ? (
            <button
              type="button"
              disabled={isInputDisabled}
              onClick={() => {
                if (isInputDisabled) return
                if (isNumber) {
                  shiftNumberValue(field, -1)
                  return
                }
                if (isSelect) {
                  shiftSelectValue(field, -1)
                }
              }}
              onDoubleClick={(e) => e.stopPropagation()}
              className={`nodrag mr-2 rounded-full px-1.5 py-0.5 text-[11px] transition-colors ${
                isInputDisabled
                  ? 'text-slate-500 cursor-not-allowed'
                  : 'text-slate-200 hover:bg-white/15'
              }`}
            >
              ◀
            </button>
          ) : null}
          <input
            type={isSensitiveField ? 'password' : 'text'}
            value={displayValue}
            readOnly={connectedToInput || isPathField || usesFloatingTextEditor}
            disabled={isInputDisabled}
            placeholder={usesFloatingTextEditor ? '点击打开编辑器' : (field.placeholder ?? '')}
            onMouseDown={(event) => {
              if (!isPathField || isInputDisabled) return
              event.preventDefault()
              openPathEditorFromInput(event.currentTarget, field.key, String(currentValue ?? ''))

              return
            }}
            onMouseDownCapture={(event) => {
              if (!usesFloatingTextEditor || isInputDisabled) return
              event.preventDefault()
              openTextEditorFromInput(
                event.currentTarget,
                field,
                drafts[field.key] ?? displayValue,
                isJson,
              )
            }}
            onClick={(event) => {
              if (isInputDisabled) return
              if (isPathField) {
                event.preventDefault()
                openPathEditorFromInput(event.currentTarget, field.key, String(currentValue ?? ''))
                return
              }

              if (usesFloatingTextEditor) {
                event.preventDefault()
                openTextEditorFromInput(
                  event.currentTarget,
                  field,
                  drafts[field.key] ?? displayValue,
                  isJson,
                )
                return
              }

              if (canShowSuggestions) {
                setOpenSelectFieldKey(null)
                setOpenSuggestFieldKey(field.key)
                setActiveSuggestIndex(0)
              }
            }}
            onChange={(event) => {
              if (isInputDisabled) return
              if (isPathField) {
                return
              }
              if (usesFloatingTextEditor) {
                return
              }
              const nextRaw = event.target.value

              if (isPidSuggestionField) {
                if (!/^\d*$/.test(nextRaw)) {
                  return
                }
                setDrafts((state) => ({ ...state, [field.key]: nextRaw }))
                updateParam(field.key, nextRaw.trim() ? Number(nextRaw) : 0)
                setErrors((state) => {
                  const nextState = { ...state }
                  delete nextState[field.key]
                  return nextState
                })
                if (canShowSuggestions) {
                  setOpenSelectFieldKey(null)
                  setOpenSuggestFieldKey(field.key)
                  setActiveSuggestIndex(0)
                }
                return
              }

              if (isNumber) {
                if (!/^-?\d*(\.\d*)?$/.test(nextRaw)) {
                  return
                }
                setDrafts((state) => ({ ...state, [field.key]: nextRaw }))
                if (!isCompleteNumber(nextRaw)) {
                  setErrors((state) => {
                    const nextState = { ...state }
                    delete nextState[field.key]
                    return nextState
                  })
                  return
                }

                let parsed = Number(nextRaw)
                if (!Number.isFinite(parsed)) {
                  setErrors((state) => ({ ...state, [field.key]: '请输入合法数字' }))
                  return
                }
                if (typeof field.min === 'number') parsed = Math.max(field.min, parsed)
                if (typeof field.max === 'number') parsed = Math.min(field.max, parsed)
                updateParam(field.key, parsed)
                setErrors((state) => {
                  const nextState = { ...state }
                  delete nextState[field.key]
                  return nextState
                })
                return
              }

              if (isJson) {
                setDrafts((state) => ({ ...state, [field.key]: nextRaw }))
                try {
                  const parsed = JSON.parse(nextRaw)
                  updateParam(field.key, parsed)
                  setErrors((state) => {
                    const nextState = { ...state }
                    delete nextState[field.key]
                    return nextState
                  })
                } catch {
                  setErrors((state) => ({ ...state, [field.key]: 'JSON 格式不正确' }))
                }
                return
              }

              setDrafts((state) => ({ ...state, [field.key]: nextRaw }))
              commitStringValue(field, nextRaw)
              if (canShowSuggestions) {
                setOpenSelectFieldKey(null)
                setOpenSuggestFieldKey(field.key)
                setActiveSuggestIndex(0)
              }
            }}
            onFocus={() => {
              if (supportsWindowSuggestions) {
                refreshWindowEntries()
              }
              if (supportsProcessNameSuggestions || supportsProcessPidSuggestions) {
                void listRunningProcesses(true)
                  .then((entries) => {
                    setRunningProcesses(entries)
                  })
                  .catch(() => {
                    setRunningProcesses([])
                  })
              }
              if (canShowSuggestions) {
                setOpenSelectFieldKey(null)
                setOpenSuggestFieldKey(field.key)
                setActiveSuggestIndex(0)
              }
            }}
            onKeyDown={(event) => {
              if (!canShowSuggestions || openSuggestFieldKey !== field.key) return

              if (event.key === 'ArrowDown') {
                event.preventDefault()
                if (filteredSuggestions.length > 0) {
                  setActiveSuggestIndex((idx) => Math.min(idx + 1, filteredSuggestions.length - 1))
                }
                return
              }

              if (event.key === 'ArrowUp') {
                event.preventDefault()
                if (filteredSuggestions.length > 0) {
                  setActiveSuggestIndex((idx) => Math.max(idx - 1, 0))
                }
                return
              }

              if (event.key === 'Enter') {
                if (filteredSuggestions.length > 0) {
                  event.preventDefault()
                  const picked = filteredSuggestions[Math.max(0, Math.min(activeSuggestIndex, filteredSuggestions.length - 1))]
                  if (picked !== undefined) {
                    commitSuggestedValue(picked)
                    setOpenSuggestFieldKey(null)
                  }
                }
                return
              }

              if (event.key === 'Escape') {
                event.preventDefault()
                setOpenSuggestFieldKey(null)
              }
            }}
            onBlur={() => {
              if (isInputDisabled) return
              if (isNumber) {
                const currentDraft = drafts[field.key] ?? displayValue
                if (!isCompleteNumber(currentDraft)) {
                  const fallback = String(currentValue ?? '')
                  setDrafts((state) => ({ ...state, [field.key]: fallback }))
                }
              }
            }}
            onDoubleClick={(e) => e.stopPropagation()}
            className={`nodrag w-full bg-transparent text-center text-[11px] font-semibold ${isInputDisabled ? 'text-slate-400' : 'text-slate-100'} outline-none ${
              isPathField || usesFloatingTextEditor ? 'cursor-default select-none caret-transparent' : ''
            }`}
          />
          {canUseArrows ? (
            <button
              type="button"
              disabled={isInputDisabled}
              onClick={() => {
                if (isInputDisabled) return
                if (isNumber) {
                  shiftNumberValue(field, 1)
                  return
                }
                if (isSelect) {
                  shiftSelectValue(field, 1)
                }
              }}
              onDoubleClick={(e) => e.stopPropagation()}
              className={`nodrag ml-2 rounded-full px-1.5 py-0.5 text-[11px] transition-colors ${
                isInputDisabled
                  ? 'text-slate-500 cursor-not-allowed'
                  : 'text-slate-200 hover:bg-white/15'
              }`}
            >
              ▶
            </button>
          ) : null}
        </div>
        <Handle
          id={createParamInputHandleId(field.key)}
          type="target"
          position={Position.Left}
          className="proximity-handle"
          style={{ top: '50%', left: -6 }}
          title={buildHandleTooltip({
            direction: 'input',
            nodeLabel: data.label,
            handleId: createParamInputHandleId(field.key),
            fieldKey: field.key,
            label: field.label,
            valueType: field.type === 'number' ? 'number' : field.type === 'json' ? 'json' : 'string',
          })}
        />
        {errors[field.key] ? (
          <div className="mt-1 px-1 text-[10px] text-rose-300">{errors[field.key]}</div>
        ) : null}

        {canShowSuggestions && openSuggestFieldKey === field.key ? (
          <div
            className="absolute left-0 right-0 z-[270] mt-1 max-h-36 overflow-auto rounded-xl border border-white/20 bg-[#1f2127]/95 p-1 shadow-2xl backdrop-blur"
            onWheelCapture={(event) => event.stopPropagation()}
          >
            {filteredSuggestions.length > 0 ? (
              filteredSuggestions.map((option, index) => (
                <button
                  key={option}
                  type="button"
                  className={`nodrag block w-full rounded-lg px-2 py-1.5 text-left text-[11px] transition-colors ${
                    index === activeSuggestIndex
                      ? 'bg-cyan-500 text-white'
                      : 'text-slate-200 hover:bg-white/10'
                  }`}
                  onMouseEnter={() => setActiveSuggestIndex(index)}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => {
                    commitSuggestedValue(option)
                    setOpenSuggestFieldKey(null)
                  }}
                >
                  {option}
                </button>
              ))
            ) : (
              <div className="px-2 py-1.5 text-[11px] text-slate-400">暂无可选项</div>
            )}
          </div>
        ) : null}

        {pathEditor?.fieldKey === field.key ? (
          createPortal(
            <>
            <div
              ref={pathEditorPanelRef}
              className="fixed z-[300] w-[360px] max-w-[86vw] rounded-xl border border-white/20 bg-[#1f2127] p-2 shadow-2xl"
              style={{
                left: pathEditor.anchorLeft + pathEditor.anchorWidth / 2,
                top: pathEditor.anchorTop - 8,
                transform: 'translate(-50%, -100%)',
              }}
              onClick={(event) => event.stopPropagation()}
            >
              <div className="mb-1 px-1 text-[11px] font-semibold text-slate-200">{field.label}</div>
              <div className="flex items-center gap-1.5">
                <input
                  autoFocus
                  type="text"
                  value={pathEditor.value}
                  onChange={(event) => setPathEditor((prev) => (prev ? { ...prev, value: event.target.value } : prev))}
                  onKeyDown={(event) => {
                    if (event.key === 'Escape') {
                      event.preventDefault()
                      setPathEditor(null)
                      return
                    }
                    if (event.key === 'Enter') {
                      event.preventDefault()
                      commitStringValue(field, pathEditor.value)
                      setPathEditor(null)
                    }
                  }}
                  className="nodrag h-8 w-full rounded-lg border border-white/20 bg-[#23262d] px-2.5 text-xs text-slate-100 outline-none focus:border-cyan-400"
                />
                <PathPickerDropdown
                  fieldLabel={field.label ?? field.key}
                  buttonLabel="浏览"
                  className="shrink-0"
                  buttonClassName="h-8 w-[76px] px-1.5 text-[11px]"
                  pickerMode={
                    data.kind === 'screenshot' && field.key === 'saveDir'
                      ? 'directory'
                      : (isStrictFilePathField(data.kind, field.key, params) ? 'file' : 'menu')
                  }
                  filters={isImageMatchImageField(data.kind, field.key) ? IMAGE_FILE_FILTERS : undefined}
                  onSelect={(value) => {
                    setPathEditor((prev) => (prev ? { ...prev, value } : prev))
                  }}
                />
                <button
                  type="button"
                  onClick={() => {
                    commitStringValue(field, pathEditor.value)
                    setPathEditor(null)
                  }}
                  className="nodrag h-8 min-w-[66px] shrink-0 rounded-full bg-white/70 px-2.5 text-xs font-bold text-slate-800 transition-colors hover:bg-white"
                >
                  OK
                </button>
              </div>
            </div>
            </>,
            document.body,
          )
        ) : null}

        {textEditor?.fieldKey === field.key ? (
          createPortal(
            (() => {
              return (
                <div
                  ref={textEditorPanelRef}
                  className="fixed z-[305] w-[480px] max-w-[88vw] rounded-xl border border-white/20 bg-[#1f2127] p-2 shadow-2xl"
                  style={{
                    left: textEditor.anchorLeft + textEditor.anchorWidth / 2,
                    top: textEditor.anchorTop - 8,
                    transform: 'translate(-50%, -100%)',
                  }}
                  onClick={(event) => event.stopPropagation()}
                >
                  <div className="mb-1 px-1 text-[11px] font-semibold text-slate-200">{field.label}</div>
                  <textarea
                    autoFocus
                    value={textEditor.value}
                    onChange={(event) => {
                      setTextEditor((prev) => (prev ? { ...prev, value: event.target.value } : prev))
                      if (textEditorError) setTextEditorError(null)
                    }}
                    onKeyDown={(event) => {
                      if (event.key === 'Escape') {
                        event.preventDefault()
                        setTextEditor(null)
                        setTextEditorError(null)
                        return
                      }

                      if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
                        event.preventDefault()
                        if (!textEditor) return

                        if (textEditor.isJson) {
                          try {
                            const parsed = JSON.parse(textEditor.value)
                            setDrafts((state) => ({ ...state, [field.key]: textEditor.value }))
                            updateParam(field.key, parsed)
                            setErrors((state) => {
                              const nextState = { ...state }
                              delete nextState[field.key]
                              return nextState
                            })
                            setTextEditor(null)
                            setTextEditorError(null)
                          } catch {
                            setTextEditorError('JSON 格式不正确')
                          }
                          return
                        }

                        commitStringValue(field, textEditor.value)
                        setTextEditor(null)
                        setTextEditorError(null)
                      }
                    }}
                    className="nodrag w-full resize-y rounded-lg border border-white/20 bg-[#23262d] px-2.5 py-2 text-xs text-slate-100 outline-none focus:border-cyan-400 h-64"
                  />

                  {textEditorError ? <div className="mt-1 px-1 text-[10px] text-rose-300">{textEditorError}</div> : null}
                  <div className="mt-2 flex justify-end gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        setTextEditor(null)
                        setTextEditorError(null)
                      }}
                      className="nodrag h-8 min-w-[66px] rounded-full border border-white/20 px-3 text-xs font-semibold text-slate-200 transition-colors hover:bg-white/10"
                    >
                      取消
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        if (!textEditor) return

                        if (textEditor.isJson) {
                          try {
                            const parsed = JSON.parse(textEditor.value)
                            setDrafts((state) => ({ ...state, [field.key]: textEditor.value }))
                            updateParam(field.key, parsed)
                            setErrors((state) => {
                              const nextState = { ...state }
                              delete nextState[field.key]
                              return nextState
                            })
                            setTextEditor(null)
                            setTextEditorError(null)
                          } catch {
                            setTextEditorError('JSON 格式不正确')
                          }
                          return
                        }

                        commitStringValue(field, textEditor.value)
                        setTextEditor(null)
                        setTextEditorError(null)
                      }}
                      className="nodrag h-8 min-w-[66px] rounded-full bg-white/70 px-3 text-xs font-bold text-slate-800 transition-colors hover:bg-white"
                    >
                      确定
                    </button>
                  </div>
                  <div className="mt-1 px-1 text-[10px] text-slate-400">提示：按 Ctrl+Enter 可快速确认</div>
                </div>
              )
            })(),
            document.body,
          )
        ) : null}
      </div>
    )
  }

  const flowInput = portSpec.inputs.find((port) => port.id === 'in')
  const flowOutputs = portSpec.outputs.filter((port) => !port.id.startsWith('param:'))
  const controlHandleClassName = 'proximity-handle control-flow-handle'

  return (
    <div
      className={`relative min-w-[260px] max-w-[340px] rounded-2xl border px-3 py-2 shadow-sm transition-all duration-200 ${tones[tone]} ${
        isRunning ? runningStyles[tone] : isSelected ? selectedStyles[tone] : ''
      }`}
    >
      <div
        className="px-1 pb-2 pt-1 text-lg font-semibold leading-none text-slate-100 drop-shadow-sm"
        title={data.description ?? meta.description}
      >
        {data.label}
      </div>

      <div className="mb-2 border-t border-white/20" />

      {flowInput || flowOutputs.length > 0 ? (
        <div className="mb-3 flex items-start justify-between px-1 text-[11px]">
          <div className="relative pl-3 pt-0.5 text-slate-300">
            {flowInput ? (
              <>
                in
                <Handle
                  id="in"
                  type="target"
                  position={Position.Left}
                  className={flowInput.valueType === 'control' ? controlHandleClassName : 'proximity-handle'}
                  style={{ top: '52%', left: -1 }}
                  title={buildHandleTooltip({
                    direction: 'input',
                    nodeLabel: data.label,
                    handleId: 'in',
                    label: 'in',
                    valueType: flowInput.valueType,
                  })}
                />
              </>
            ) : null}
          </div>
          <div className="space-y-1.5 text-right">
            {flowOutputs.map((output) => (
              <div key={output.id} className="relative pr-3 text-[12px] text-slate-200">
                {output.label ?? output.id}
                <Handle
                  id={output.id}
                  type="source"
                  position={Position.Right}
                  className={output.valueType === 'control' ? controlHandleClassName : 'proximity-handle'}
                  style={{ top: '55%', right: -6 }}
                  title={buildHandleTooltip({
                    direction: 'output',
                    nodeLabel: data.label,
                    handleId: output.id,
                    label: output.label ?? output.id,
                    valueType: output.valueType,
                  })}
                />
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {visibleFields.length > 0 ? (
        <div className="space-y-2.5 pb-1">
          {visibleFields.map((field) => {
            const inputHandleId = createParamInputHandleId(field.key)
            const connectedToInput = edges.some(
              (edge) => edge.target === id && edge.targetHandle === inputHandleId,
            )

            return (
              <div key={field.key} className="relative px-1">
                <label className="mb-1 block text-[10px] font-semibold text-slate-300/90">{field.label}</label>
                {renderFieldInput(field, connectedToInput)}
              </div>
            )
          })}
          {data.kind === 'guiAgent' && !Boolean(params.continuousMode ?? true) ? (
            <div className="rounded-lg border border-amber-300/60 bg-amber-500/10 px-2 py-1.5 text-[10px] text-amber-200">
              非连续模式需手动提供图片输入。
            </div>
          ) : null}
        </div>
      ) : null}

      <div className="mt-1 px-1 text-[9px] text-slate-300/70">{data.kind}</div>
    </div>
  )
}
