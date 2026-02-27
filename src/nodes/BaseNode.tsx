import { Handle, Position } from '@xyflow/react'
import { createPortal } from 'react-dom'
import { useEffect, useRef, useState } from 'react'
import type { NodeKind, WorkflowNodeData } from '../types/workflow'
import { getNodeMeta, type ParamField } from '../utils/nodeMeta'
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
  if (kind === 'screenshot' && fieldKey === 'path') {
    return true
  }
  return kind === 'fileDelete' && fieldKey === 'path'
}

const isImageMatchImageField = (kind: NodeKind, fieldKey: string) =>
  kind === 'imageMatch' && (fieldKey === 'sourcePath' || fieldKey === 'templatePath')

const isTextFilePathField = (kind: NodeKind, fieldKey: string) =>
  (kind === 'fileReadText' || kind === 'fileWriteText') && fieldKey === 'path'

const isStrictFilePathField = (kind: NodeKind, fieldKey: string) =>
  isImageMatchImageField(kind, fieldKey) || isTextFilePathField(kind, fieldKey) || (kind === 'screenshot' && fieldKey === 'path')

const IMAGE_FILE_FILTERS = [
  { name: '图片文件', extensions: ['png', 'jpg', 'jpeg', 'bmp', 'webp'] },
]

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
  const [pathEditor, setPathEditor] = useState<{
    fieldKey: string
    value: string
    anchorLeft: number
    anchorTop: number
    anchorWidth: number
  } | null>(null)
  const pathEditorPanelRef = useRef<HTMLDivElement | null>(null)

  const updateParam = (key: string, value: unknown) => {
    updateNodeParams(id, {
      ...params,
      [key]: value,
    })
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

  useEffect(() => {
    if (!pathEditor && !openSelectFieldKey) return

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as HTMLElement

      if (pathEditor && pathEditorPanelRef.current && !pathEditorPanelRef.current.contains(target)) {
        setPathEditor(null)
      }

      if (openSelectFieldKey) {
        const inSelectRoot = target.closest('[data-node-select-root="true"]')
        if (!inSelectRoot) {
          setOpenSelectFieldKey(null)
        }
      }
    }

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setPathEditor(null)
      }
    }

    document.addEventListener('pointerdown', handlePointerDown, true)
    document.addEventListener('keydown', handleEscape)

    return () => {
      document.removeEventListener('pointerdown', handlePointerDown, true)
      document.removeEventListener('keydown', handleEscape)
    }
  }, [pathEditor, openSelectFieldKey])

  useEffect(() => {
    if (pathEditor) setPathEditor(null)
    if (openSelectFieldKey) setOpenSelectFieldKey(null)
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
    const canUseArrows = !connectedToInput && isNumber
    const isPathField = isFilePathField(data.kind, field.key)
    const selectOptions = field.options ?? []
    const selectedOption = selectOptions.find((option) => option.value === String(currentValue ?? ''))

    if (isSelect) {
      return (
        <div className="relative" data-node-select-root="true">
          <button
            type="button"
            disabled={connectedToInput}
            onClick={() => {
              if (connectedToInput) return
              setOpenSelectFieldKey((prev) => (prev === field.key ? null : field.key))
            }}
            className="flex w-full items-center rounded-full border border-white/25 bg-black/20 px-2.5 py-1 text-[11px] shadow-inner transition-colors hover:border-cyan-300/60 disabled:cursor-not-allowed disabled:opacity-60 dark:border-white/20 dark:bg-black/35"
          >
            <span className="truncate text-slate-100">{selectedOption?.label ?? '请选择'}</span>
            <span className="ml-auto text-slate-300">▾</span>
          </button>

          <Handle
            id={createParamInputHandleId(field.key)}
            type="target"
            position={Position.Left}
            className="!h-2.5 !w-2.5"
            style={{ top: '50%', left: -6 }}
          />

          {openSelectFieldKey === field.key && !connectedToInput ? (
            <div className="absolute left-0 right-0 z-[260] mt-1 max-h-40 overflow-auto rounded-xl border border-white/20 bg-[#1f2127]/95 p-1 shadow-2xl backdrop-blur">
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
                  className={`block w-full rounded-lg px-2 py-1.5 text-left text-[11px] transition-colors ${
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

    return (
      <div className="relative">
        <div className={`flex items-center rounded-full border bg-black/20 px-2 py-1 text-[11px] shadow-inner dark:bg-black/35 ${errors[field.key] ? 'border-rose-400/80' : 'border-white/25 dark:border-white/20'}`}>
          {canUseArrows ? (
            <button
              type="button"
              onClick={() => {
                if (isNumber) {
                  shiftNumberValue(field, -1)
                  return
                }
                if (isSelect) {
                  shiftSelectValue(field, -1)
                }
              }}
              className="mr-2 rounded-full px-1.5 py-0.5 text-[11px] text-slate-200 transition-colors hover:bg-white/15"
            >
              ◀
            </button>
          ) : null}
          <input
            type="text"
            value={displayValue}
            readOnly={connectedToInput || isPathField}
            disabled={connectedToInput}
            placeholder={connectedToInput ? '已连接上游' : (field.placeholder ?? '')}
            onMouseDown={(event) => {
              if (!isPathField || connectedToInput) return
              event.preventDefault()
              openPathEditorFromInput(event.currentTarget, field.key, String(currentValue ?? ''))
            }}
            onClick={(event) => {
              if (connectedToInput) return
              if (isPathField) {
                event.preventDefault()
                openPathEditorFromInput(event.currentTarget, field.key, String(currentValue ?? ''))
                return
              }
            }}
            onChange={(event) => {
              if (connectedToInput) return
              if (isPathField) {
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
            }}
            onBlur={() => {
              if (connectedToInput) return
              if (isNumber) {
                const currentDraft = drafts[field.key] ?? displayValue
                if (!isCompleteNumber(currentDraft)) {
                  const fallback = String(currentValue ?? '')
                  setDrafts((state) => ({ ...state, [field.key]: fallback }))
                }
              }
            }}
            className={`w-full bg-transparent text-center text-[11px] font-semibold text-slate-100 outline-none ${isPathField ? 'cursor-default select-none caret-transparent' : ''}`}
          />
          {canUseArrows ? (
            <button
              type="button"
              onClick={() => {
                if (isNumber) {
                  shiftNumberValue(field, 1)
                  return
                }
                if (isSelect) {
                  shiftSelectValue(field, 1)
                }
              }}
              className="ml-2 rounded-full px-1.5 py-0.5 text-[11px] text-slate-200 transition-colors hover:bg-white/15"
            >
              ▶
            </button>
          ) : null}
        </div>
        <Handle
          id={createParamInputHandleId(field.key)}
          type="target"
          position={Position.Left}
          className="!h-2.5 !w-2.5"
          style={{ top: '50%', left: -6 }}
        />
        {errors[field.key] ? (
          <div className="mt-1 px-1 text-[10px] text-rose-300">{errors[field.key]}</div>
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
                  className="h-8 w-full rounded-lg border border-white/20 bg-[#23262d] px-2.5 text-xs text-slate-100 outline-none focus:border-cyan-400"
                />
                <PathPickerDropdown
                  fieldLabel={field.label ?? field.key}
                  buttonLabel="浏览"
                  className="shrink-0"
                  buttonClassName="h-8 w-[76px] px-1.5 text-[11px]"
                  pickerMode={isStrictFilePathField(data.kind, field.key) ? 'file' : 'menu'}
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
                  className="h-8 min-w-[66px] shrink-0 rounded-full bg-white/70 px-2.5 text-xs font-bold text-slate-800 transition-colors hover:bg-white"
                >
                  OK
                </button>
              </div>
            </div>
            </>,
            document.body,
          )
        ) : null}
      </div>
    )
  }

  const flowInput = portSpec.inputs.find((port) => port.id === 'in')
  const flowOutputs = portSpec.outputs.filter((port) => !port.id.startsWith('param:'))

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
                className="!h-2.5 !w-2.5"
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
                  className="!h-2.5 !w-2.5"
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
      ) : (
        <div className="rounded-md border border-dashed border-white/20 px-2 py-2 text-[10px] opacity-70">
          无可编辑输入
        </div>
      )}

      <div className="mt-1 px-1 text-[9px] text-slate-300/70">{data.kind}</div>
    </div>
  )
}
