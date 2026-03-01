import { Handle, Position } from '@xyflow/react'
import { createPortal } from 'react-dom'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { NodeKind, WorkflowNodeData } from '../types/workflow'
import { getNodeMeta, type ParamField } from '../utils/nodeMeta'
import { listOpenWindows } from '../utils/execution'
import {
  createParamInputHandleId,
  getNodePortSpec,
} from '../utils/nodePorts'
import { useWorkflowStore } from '../stores/workflowStore'
import PathPickerDropdown from '../components/PathPickerDropdown'

interface BaseNodeProps {
  id: string
  data: WorkflowNodeData
  tone?: 'trigger' | 'action' | 'control'
  selected?: boolean
}

const tones = {
  trigger: 'border-emerald-500/70 bg-emerald-50 text-emerald-900 dark:bg-emerald-900/30 dark:text-emerald-100',
  action: 'border-cyan-500/70 bg-cyan-50 text-cyan-900 dark:bg-cyan-900/30 dark:text-cyan-100',
  control: 'border-amber-500/70 bg-amber-50 text-amber-900 dark:bg-amber-900/30 dark:text-amber-100',
}

const selectedStyles = {
  trigger: 'border-emerald-500 ring-1 ring-emerald-400 ring-offset-1 ring-offset-emerald-50 dark:ring-offset-emerald-900/30',
  action: 'border-cyan-500 ring-1 ring-cyan-400 ring-offset-1 ring-offset-cyan-50 dark:ring-offset-cyan-900/30',
  control: 'border-amber-500 ring-1 ring-amber-400 ring-offset-1 ring-offset-amber-50 dark:ring-offset-amber-900/30',
}

const isFilePathField = (kind: NodeKind, fieldKey: string) => {
  if ((kind === 'fileCopy' || kind === 'fileMove') && (fieldKey === 'sourcePath' || fieldKey === 'targetPath')) {
    return true
  }
  if (kind === 'imageMatch' && (fieldKey === 'sourcePath' || fieldKey === 'templatePath')) {
    return true
  }
  if ((kind === 'fileReadText' || kind === 'fileWriteText') && fieldKey === 'path') {
    return true
  }
  if (kind === 'screenshot' && fieldKey === 'saveDir') {
    return true
  }
  return kind === 'fileDelete' && fieldKey === 'path'
}

const isImageMatchImageField = (kind: NodeKind, fieldKey: string) =>
  kind === 'imageMatch' && (fieldKey === 'sourcePath' || fieldKey === 'templatePath')

const isTextFilePathField = (kind: NodeKind, fieldKey: string) =>
  (kind === 'fileReadText' || kind === 'fileWriteText') && fieldKey === 'path'

const isStrictFilePathField = (kind: NodeKind, fieldKey: string) =>
  isImageMatchImageField(kind, fieldKey) || isTextFilePathField(kind, fieldKey)

const IMAGE_FILE_FILTERS = [
  { name: '图片文件', extensions: ['png', 'jpg', 'jpeg', 'bmp', 'webp'] },
]

const dedupe = (values: string[]) => Array.from(new Set(values.filter((value) => value.trim().length > 0)))

const isVariableOperandField = (kind: NodeKind, fieldKey: string) =>
  (kind === 'condition' || kind === 'whileLoop') && (fieldKey === 'left' || fieldKey === 'right')

const isVariableNameField = (kind: NodeKind, fieldKey: string) =>
  (kind === 'varDefine' || kind === 'varSet' || kind === 'varMath' || kind === 'varGet') && fieldKey === 'name'

const isInputVariableField = (kind: NodeKind, fieldKey: string) =>
  (kind === 'clipboardWrite' || kind === 'fileWriteText' || kind === 'showMessage') && fieldKey === 'inputVar'

const isOutputVariableField = (kind: NodeKind, fieldKey: string) =>
  (kind === 'clipboardRead' || kind === 'fileReadText') && fieldKey === 'outputVar'

const isWindowTitleField = (kind: NodeKind, fieldKey: string) =>
  (kind === 'windowTrigger' || kind === 'windowActivate') && fieldKey === 'title'

const isFieldVisible = (kind: WorkflowNodeData['kind'], field: ParamField, params: Record<string, unknown>) => {
  if (kind === 'windowActivate') {
    const mode = String(params.switchMode ?? 'title')
    if (mode === 'title') {
      return !['shortcut', 'shortcutTimes', 'shortcutIntervalMs'].includes(field.key)
    }
    if (mode === 'shortcut') {
      return field.key !== 'title'
    }
  }

  if (kind === 'varMath' && field.key === 'operand') {
    const unaryOperations = new Set([
      'neg',
      'abs',
      'sign',
      'square',
      'cube',
      'sqrt',
      'cbrt',
      'exp',
      'ln',
      'log2',
      'log10',
      'sin',
      'cos',
      'tan',
      'asin',
      'acos',
      'atan',
      'ceil',
      'floor',
      'round',
      'trunc',
      'frac',
      'recip',
      'lnot',
      'bnot',
    ])
    const operation = String(params.operation ?? 'add')
    return !unaryOperations.has(operation)
  }

  if ((kind === 'varDefine' || kind === 'varSet' || kind === 'constValue') && field.key.startsWith('value')) {
    const valueType = String(params.valueType ?? 'number')
    if (field.key === 'valueType') return true
    if (field.key === 'valueString') return valueType === 'string'
    if (field.key === 'valueNumber') return valueType === 'number'
    if (field.key === 'valueBoolean') return valueType === 'boolean'
    if (field.key === 'valueJson') return valueType === 'json'
    return false
  }

  if (kind === 'varMath' && field.key.startsWith('operand')) {
    const unaryOperations = new Set([
      'neg',
      'abs',
      'sign',
      'square',
      'cube',
      'sqrt',
      'cbrt',
      'exp',
      'ln',
      'log2',
      'log10',
      'sin',
      'cos',
      'tan',
      'asin',
      'acos',
      'atan',
      'ceil',
      'floor',
      'round',
      'trunc',
      'frac',
      'recip',
      'lnot',
      'bnot',
    ])
    const operation = String(params.operation ?? 'add')
    if (unaryOperations.has(operation)) {
      return field.key === 'operandType'
    }

    const operandType = String(params.operandType ?? 'number')
    if (field.key === 'operandType') return true
    if (field.key === 'operandNumber') return operandType === 'number'
    if (field.key === 'operandString') return operandType === 'string'
    if (field.key === 'operandBoolean') return operandType === 'boolean'
    if (field.key === 'operandJson') return operandType === 'json'
    return false
  }

  if (
    (kind === 'clipboardWrite' || kind === 'fileWriteText' || kind === 'showMessage') &&
    (field.key === 'inputText' || field.key === 'inputVar')
  ) {
    const inputMode = String(params.inputMode ?? 'literal')
    if (field.key === 'inputText') return inputMode === 'literal'
    if (field.key === 'inputVar') return inputMode === 'var'
  }

  return field.type !== 'boolean'
}

export default function BaseNode({ id, data, tone = 'action', selected = false }: BaseNodeProps) {
  const isSelected = selected
  const portSpec = getNodePortSpec(data.kind)
  const updateNodeParams = useWorkflowStore((state) => state.updateNodeParams)
  const nodes = useWorkflowStore((state) => state.nodes)
  const edges = useWorkflowStore((state) => state.edges)
  const nodePosition = useWorkflowStore((state) =>
    state.nodes.find((node) => node.id === id)?.position,
  )
  const meta = getNodeMeta(data.kind)
  const params = data.params ?? {}
  const visibleFields = meta.fields.filter((field) => isFieldVisible(data.kind, field, params))
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [openSelectFieldKey, setOpenSelectFieldKey] = useState<string | null>(null)
  const [openSuggestFieldKey, setOpenSuggestFieldKey] = useState<string | null>(null)
  const [activeSuggestIndex, setActiveSuggestIndex] = useState(0)
  const [windowTitles, setWindowTitles] = useState<string[]>([])
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

  const refreshWindowTitles = () => {
    if (data.kind !== 'windowTrigger' && data.kind !== 'windowActivate') return

    void listOpenWindows()
      .then((titles) => {
        setWindowTitles(dedupe(titles))
      })
      .catch(() => {
        setWindowTitles([])
      })
  }

  useEffect(() => {
    if (data.kind !== 'windowTrigger' && data.kind !== 'windowActivate') {
      setWindowTitles([])
      return
    }

    let cancelled = false
    void listOpenWindows()
      .then((titles) => {
        if (cancelled) return
        setWindowTitles(dedupe(titles))
      })
      .catch(() => {
        if (cancelled) return
        setWindowTitles([])
      })

    return () => {
      cancelled = true
    }
  }, [data.kind])

  const getStringSuggestions = (field: ParamField): string[] => {
    const kind = data.kind

    if (isWindowTitleField(kind, field.key)) {
      return windowTitles
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

  const updateParam = (key: string, value: unknown) => {
    const nextParams: Record<string, unknown> = {
      ...params,
      [key]: value,
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
    const isNumber = field.type === 'number'
    const isSelect = field.type === 'select'
    const isJson = field.type === 'json'
    const canUseArrows = isNumber
    const isPathField = isFilePathField(data.kind, field.key)
    const isScreenshotSizeFieldDisabled =
      data.kind === 'screenshot' &&
      (field.key === 'width' || field.key === 'height') &&
      Boolean(params.fullscreen)
    const isScreenshotSaveDirFieldDisabled =
      data.kind === 'screenshot' && field.key === 'saveDir' && !Boolean(params.shouldSave ?? true)
    const isInputDisabled = connectedToInput || isScreenshotSaveDirFieldDisabled || isScreenshotSizeFieldDisabled
    const selectOptions = field.options ?? []
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
                    updateParam(field.key, option.value)
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
        try {
          return JSON.stringify(currentValue)
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

    const supportsWindowTitleSuggestions = isWindowTitleField(data.kind, field.key)
    const supportsInlineSuggestions = supportsVariableSuggestions || supportsWindowTitleSuggestions

    const canShowSuggestions = !connectedToInput && !isNumber && !isSelect && !isJson && !isPathField && supportsInlineSuggestions
    const usesFloatingTextEditor = !connectedToInput && !isNumber && !isSelect && !isPathField && !supportsInlineSuggestions
    const filteredSuggestions = canShowSuggestions
      ? (supportsWindowTitleSuggestions
        ? suggestions
        : suggestions.filter((option) => option.toLowerCase().includes(displayValue.trim().toLowerCase())))
      : []

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
            type="text"
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
              if (supportsWindowTitleSuggestions) {
                refreshWindowTitles()
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
                    commitStringValue(field, picked)
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
                    commitStringValue(field, option)
                    setOpenSuggestFieldKey(null)
                  }}
                >
                  {option}
                </button>
              ))
            ) : (
              <div className="px-2 py-1.5 text-[11px] text-slate-400">暂无已定义变量</div>
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
                      : (isStrictFilePathField(data.kind, field.key) ? 'file' : 'menu')
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
                className="nodrag h-32 w-full resize-y rounded-lg border border-white/20 bg-[#23262d] px-2.5 py-2 text-xs text-slate-100 outline-none focus:border-cyan-400"
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
            </div>,
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
        isSelected ? selectedStyles[tone] : ''
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
            进入
            {flowInput ? (
              <Handle
                id="in"
                type="target"
                position={Position.Left}
                className={flowInput.valueType === 'control' ? controlHandleClassName : 'proximity-handle'}
                style={{ top: '52%', left: -1 }}
              />
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
        </div>
      ) : null}

      <div className="mt-1 px-1 text-[9px] text-slate-300/70">{data.kind}</div>
    </div>
  )
}
