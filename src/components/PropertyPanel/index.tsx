import { useEffect, useMemo, useState } from 'react'
import { useWorkflowStore } from '../../stores/workflowStore'
import { getNodeMeta, type ParamField } from '../../utils/nodeMeta'
import { listOpenWindows } from '../../utils/execution'
import type { NodeKind } from '../../types/workflow'
import SmartInputSelect from '../SmartInputSelect'
import StyledSelect from '../StyledSelect'
import PathPickerDropdown from '../PathPickerDropdown'

interface PropertyPanelProps {
  expanded: boolean
  onToggle: () => void
}

const toJsonDraft = (value: unknown): string => {
  try {
    return JSON.stringify(value ?? null, null, 2)
  } catch {
    return 'null'
  }
}

const buildJsonDrafts = (params: Record<string, unknown>, fields: ParamField[]) => {
  const drafts: Record<string, string> = {}
  for (const field of fields) {
    if (field.type === 'json') {
      drafts[field.key] = toJsonDraft(params[field.key])
    }
  }
  return drafts
}

const COMMON_KEYS = [
  'Enter',
  'Tab',
  'Esc',
  'Space',
  'Backspace',
  'Delete',
  'ArrowUp',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
  'Home',
  'End',
  'PageUp',
  'PageDown',
  'F1',
  'F2',
  'F3',
  'F4',
  'F5',
  'F6',
  'F7',
  'F8',
  'F9',
  'F10',
  'F11',
  'F12',
]

const COMMON_HOTKEYS = [
  'Ctrl+C',
  'Ctrl+V',
  'Ctrl+S',
  'Ctrl+Shift+S',
  'Ctrl+Z',
  'Ctrl+Y',
  'Ctrl+Shift+R',
  'Alt+Tab',
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

const IMAGE_FILE_FILTERS = [
  { name: '图片文件', extensions: ['png', 'jpg', 'jpeg', 'bmp', 'webp'] },
]

export default function PropertyPanel({ expanded, onToggle }: PropertyPanelProps) {
  const { selectedNodeId, nodes, updateNodeParams } = useWorkflowStore()
  const selectedNode = useMemo(
    () => nodes.find((node) => node.id === selectedNodeId) ?? null,
    [nodes, selectedNodeId],
  )

  const selectedMeta = selectedNode ? getNodeMeta(selectedNode.data.kind) : null
  const [jsonDrafts, setJsonDrafts] = useState<Record<string, string>>({})
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [windowTitles, setWindowTitles] = useState<string[]>([])

  const variableNames = useMemo(
    () =>
      dedupe(
        nodes
          .filter((node) => node.data.kind === 'varDefine')
          .map((node) => (typeof node.data.params.name === 'string' ? node.data.params.name.trim() : '')),
      ),
    [nodes],
  )

  useEffect(() => {
    if (!selectedNode || !selectedMeta) {
      setJsonDrafts({})
      setErrors({})
      return
    }
    setJsonDrafts(buildJsonDrafts(selectedNode.data.params, selectedMeta.fields))
    setErrors({})
  }, [selectedMeta, selectedNode])

  useEffect(() => {
    if (!selectedNode || !expanded) return
    if (selectedNode.data.kind !== 'windowTrigger' && selectedNode.data.kind !== 'windowActivate') {
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
  }, [expanded, selectedNode])

  const getStringSuggestions = (field: ParamField): string[] => {
    if (!selectedNode) return []
    const kind = selectedNode.data.kind

    if (kind === 'windowTrigger' && field.key === 'title') {
      return windowTitles
    }
    if (kind === 'windowActivate' && field.key === 'title') {
      return windowTitles
    }
    if (kind === 'windowActivate' && field.key === 'shortcut') {
      return COMMON_HOTKEYS
    }
    if (kind === 'varSet' && field.key === 'name') {
      return variableNames
    }
    if (kind === 'varMath' && field.key === 'name') {
      return variableNames
    }
    if (kind === 'varGet' && field.key === 'name') {
      return variableNames
    }
    if (isInputVariableField(kind, field.key)) {
      return variableNames
    }
    if (isOutputVariableField(kind, field.key)) {
      return variableNames
    }
    if (isVariableOperandField(kind, field.key)) {
      const typeKey = field.key === 'left' ? 'leftType' : 'rightType'
      const typeValue = selectedNode.data.params[typeKey]
      if (typeValue === 'var') {
        return variableNames
      }
      return []
    }
    if ((kind === 'keyboardKey' || kind === 'keyboardDown' || kind === 'keyboardUp') && field.key === 'key') {
      return COMMON_KEYS
    }
    if (kind === 'shortcut' && field.key === 'key') {
      return COMMON_KEYS
    }
    if (kind === 'hotkeyTrigger' && field.key === 'hotkey') {
      return COMMON_HOTKEYS
    }

    return []
  }

  const updateParam = (key: string, value: unknown) => {
    if (!selectedNode) return
    const nextParams: Record<string, unknown> = {
      ...selectedNode.data.params,
      [key]: value,
    }

    if (selectedNode.data.kind === 'varDefine' || selectedNode.data.kind === 'varSet' || selectedNode.data.kind === 'constValue') {
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

    if (selectedNode.data.kind === 'varMath') {
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

    updateNodeParams(selectedNode.id, nextParams)
  }

  const getFieldDefaultValue = (field: ParamField): unknown =>
    selectedMeta?.defaultParams?.[field.key]

  const getResolvedFieldValue = (field: ParamField): unknown => {
    if (!selectedNode) return getFieldDefaultValue(field)
    const currentValue = selectedNode.data.params[field.key]
    if (currentValue !== undefined && currentValue !== null) {
      return currentValue
    }
    return getFieldDefaultValue(field)
  }

  const shouldShowField = (field: ParamField): boolean => {
    if (!selectedNode) return true
    if (selectedNode.data.kind === 'windowActivate') {
      const mode = String(selectedNode.data.params.switchMode ?? selectedMeta?.defaultParams.switchMode ?? 'title')
      if (mode === 'title') {
        return !['shortcut', 'shortcutTimes', 'shortcutIntervalMs'].includes(field.key)
      }
      if (mode === 'shortcut') {
        return field.key !== 'title'
      }
    }

    if (selectedNode.data.kind === 'varMath' && field.key === 'operand') {
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
      const operation = String(selectedNode.data.params.operation ?? selectedMeta?.defaultParams.operation ?? 'add')
      return !unaryOperations.has(operation)
    }

    if ((selectedNode.data.kind === 'varDefine' || selectedNode.data.kind === 'varSet' || selectedNode.data.kind === 'constValue') && field.key.startsWith('value')) {
      const valueType = String(selectedNode.data.params.valueType ?? 'number')
      if (field.key === 'valueType') return true
      if (field.key === 'valueString') return valueType === 'string'
      if (field.key === 'valueNumber') return valueType === 'number'
      if (field.key === 'valueBoolean') return valueType === 'boolean'
      if (field.key === 'valueJson') return valueType === 'json'
    }

    if (selectedNode.data.kind === 'varMath' && field.key.startsWith('operand')) {
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
      const operation = String(selectedNode.data.params.operation ?? selectedMeta?.defaultParams.operation ?? 'add')
      if (unaryOperations.has(operation)) {
        return field.key === 'operandType'
      }

      const operandType = String(selectedNode.data.params.operandType ?? 'number')
      if (field.key === 'operandType') return true
      if (field.key === 'operandNumber') return operandType === 'number'
      if (field.key === 'operandString') return operandType === 'string'
      if (field.key === 'operandBoolean') return operandType === 'boolean'
      if (field.key === 'operandJson') return operandType === 'json'
    }

    if (
      (selectedNode.data.kind === 'clipboardWrite' || selectedNode.data.kind === 'fileWriteText' || selectedNode.data.kind === 'showMessage') &&
      (field.key === 'inputText' || field.key === 'inputVar')
    ) {
      const inputMode = String(selectedNode.data.params.inputMode ?? 'literal')
      if (field.key === 'inputText') {
        return inputMode === 'literal'
      }
      if (field.key === 'inputVar') {
        return inputMode === 'var'
      }
    }

    return true
  }

  const renderField = (field: ParamField) => {
    if (!selectedNode) return null
    const currentValue = getResolvedFieldValue(field)
    const isScreenshotSizeFieldDisabled =
      selectedNode.data.kind === 'screenshot' &&
      (field.key === 'width' || field.key === 'height') &&
      Boolean(selectedNode.data.params.fullscreen)
    const isScreenshotSaveDirFieldDisabled =
      selectedNode.data.kind === 'screenshot' &&
      field.key === 'saveDir' &&
      !Boolean(selectedNode.data.params.shouldSave ?? selectedMeta?.defaultParams.shouldSave ?? true)

    if (field.type === 'boolean') {
      return (
        <label className="flex items-center gap-2 text-xs font-medium text-slate-700 dark:text-slate-300">
          <input
            type="checkbox"
            checked={Boolean(currentValue)}
            onChange={(event) => updateParam(field.key, event.target.checked)}
            className="h-4 w-4 rounded border-slate-300 text-cyan-600 focus:ring-cyan-500"
          />
          启用
        </label>
      )
    }

    if (field.type === 'select') {
      return (
        <StyledSelect
          value={String(currentValue ?? field.options?.[0]?.value ?? '')}
          options={field.options ?? []}
          onChange={(nextValue) => updateParam(field.key, nextValue)}
          placeholder="请选择"
        />
      )
    }

    if (field.type === 'number') {
      return (
        <input
          type="number"
          value={Number(currentValue ?? 0)}
          min={field.min}
          max={field.max}
          step={field.step ?? 1}
          disabled={isScreenshotSizeFieldDisabled}
          onChange={(event) => updateParam(field.key, Number(event.target.value))}
          className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs shadow-sm transition-all focus:border-cyan-500 focus:ring-4 focus:ring-cyan-500/10 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-400 dark:border-neutral-700 dark:bg-neutral-900 dark:disabled:bg-neutral-800 dark:disabled:text-neutral-500"
        />
      )
    }

    if (field.type === 'json') {
      const draft = jsonDrafts[field.key] ?? toJsonDraft(currentValue)
      const fieldError = errors[field.key]
      return (
        <>
          <textarea
            value={draft}
            onChange={(event) => {
              const value = event.target.value
              setJsonDrafts((state) => ({ ...state, [field.key]: value }))
              try {
                const parsed = JSON.parse(value)
                updateParam(field.key, parsed)
                setErrors((state) => {
                  const next = { ...state }
                  delete next[field.key]
                  return next
                })
              } catch {
                setErrors((state) => ({ ...state, [field.key]: 'JSON 格式不正确' }))
              }
            }}
            className="h-24 w-full resize-none rounded-xl border border-slate-200 bg-white px-3 py-2 font-mono text-xs shadow-inner transition-all focus:border-cyan-500 focus:ring-4 focus:ring-cyan-500/10 dark:border-neutral-700 dark:bg-neutral-900"
          />
          {fieldError ? <p className="mt-1 text-[11px] text-rose-500">{fieldError}</p> : null}
        </>
      )
    }

    if (field.type === 'text') {
      return (
        <textarea
          value={String(currentValue ?? '')}
          placeholder={field.placeholder}
          onChange={(event) => updateParam(field.key, event.target.value)}
          className="h-28 w-full resize-y rounded-xl border border-slate-200 bg-white px-3 py-2 font-mono text-xs shadow-inner transition-all focus:border-cyan-500 focus:ring-4 focus:ring-cyan-500/10 dark:border-neutral-700 dark:bg-neutral-900"
        />
      )
    }

    return (
      (() => {
        if (isFilePathField(selectedNode.data.kind, field.key)) {
          return (
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={String(currentValue ?? '')}
                placeholder={field.placeholder}
                disabled={isScreenshotSaveDirFieldDisabled}
                onChange={(event) => updateParam(field.key, event.target.value)}
                className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs shadow-sm transition-all focus:border-cyan-500 focus:ring-4 focus:ring-cyan-500/10 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-400 dark:border-neutral-700 dark:bg-neutral-900 dark:disabled:bg-neutral-800 dark:disabled:text-neutral-500"
              />
              <div className={`flex shrink-0 items-center ${isScreenshotSaveDirFieldDisabled ? 'pointer-events-none opacity-60' : ''}`}>
                <PathPickerDropdown
                  fieldLabel={field.label ?? field.key}
                  onSelect={(value) => updateParam(field.key, value)}
                  pickerMode={
                    selectedNode.data.kind === 'screenshot' && field.key === 'saveDir'
                      ? 'directory'
                      : (
                    isImageMatchImageField(selectedNode.data.kind, field.key) || isTextFilePathField(selectedNode.data.kind, field.key)
                      ? 'file'
                      : 'menu'
                      )
                  }
                  filters={isImageMatchImageField(selectedNode.data.kind, field.key) ? IMAGE_FILE_FILTERS : undefined}
                />
              </div>
            </div>
          )
        }

        const suggestions = getStringSuggestions(field)
        const variableReferenceField =
          isVariableOperandField(selectedNode.data.kind, field.key) &&
          (field.key === 'left'
            ? selectedNode.data.params.leftType === 'var'
            : selectedNode.data.params.rightType === 'var')

        if (
          isVariableNameField(selectedNode.data.kind, field.key) ||
          isInputVariableField(selectedNode.data.kind, field.key) ||
          isOutputVariableField(selectedNode.data.kind, field.key) ||
          variableReferenceField
        ) {
          return (
            <SmartInputSelect
              value={String(currentValue ?? '')}
              placeholder={field.placeholder}
              options={variableNames}
              onChange={(nextValue) => updateParam(field.key, nextValue)}
              hint="输入可筛选变量名，也可手动输入"
            />
          )
        }

        if (suggestions.length > 0) {
          return (
            <SmartInputSelect
              value={String(currentValue ?? '')}
              placeholder={field.placeholder}
              options={suggestions}
              onChange={(nextValue) => updateParam(field.key, nextValue)}
              hint="支持下拉选择，也可手动输入"
            />
          )
        }

        return (
          <input
            type="text"
            value={String(currentValue ?? '')}
            placeholder={field.placeholder}
            onChange={(event) => updateParam(field.key, event.target.value)}
            className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs shadow-sm transition-all focus:border-cyan-500 focus:ring-4 focus:ring-cyan-500/10 dark:border-neutral-700 dark:bg-neutral-900"
          />
        )
      })()
    )
  }

  return (
    <section className="flex flex-col border-b border-slate-200 dark:border-neutral-800">
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center justify-between p-4 hover:bg-slate-100/50 dark:hover:bg-slate-800/30 transition-colors"
      >
        <h2 className="text-[11px] font-bold uppercase tracking-widest text-slate-500 dark:text-slate-400">属性面板</h2>
        <div className="flex items-center gap-2">
          {selectedNode && (
            <span className="rounded-full bg-cyan-100 px-2.5 py-0.5 text-[10px] font-bold text-cyan-700 dark:bg-cyan-900/30 dark:text-cyan-400">
              {selectedNode.data.kind}
            </span>
          )}
          <svg
            className={`h-4 w-4 text-slate-400 transition-transform duration-200 ${expanded ? 'rotate-180' : ''}`}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <path d="M6 9l6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </div>
      </button>
      {expanded && (
        <div className="flex-1 overflow-y-auto pr-1 scrollbar-thin scrollbar-thumb-slate-200 dark:scrollbar-thumb-slate-800">
          {!selectedNode ? (
            <div className="flex h-full flex-col items-center justify-center rounded-xl border border-dashed border-slate-300 p-8 text-center text-[11px] text-slate-400 dark:border-neutral-800">
              <svg className="mb-3 h-8 w-8 opacity-20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-7" />
                <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
              </svg>
              请选择一个节点以编辑其属性
            </div>
          ) : (
            <div className="space-y-4 p-4 pt-0">
              <div className="space-y-2">
                <label className="text-[10px] font-bold uppercase tracking-wider text-slate-400">节点名称</label>
                <div className="rounded-xl border border-slate-200 bg-white/70 px-4 py-2.5 text-xs font-semibold shadow-sm dark:border-neutral-700 dark:bg-neutral-900/70">
                  {selectedNode.data.label}
                </div>
              </div>
              <p className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-[11px] leading-relaxed text-slate-500 dark:border-neutral-800 dark:bg-neutral-900/60 dark:text-slate-400">
                {selectedMeta?.description}
              </p>

              <div className="space-y-1.5">
                <label className="text-[10px] font-bold uppercase tracking-wider text-slate-400">节点后置间隔(ms)</label>
                <input
                  type="number"
                  min={0}
                  step={1}
                  value={Number(selectedNode.data.params.postDelayMs ?? 50)}
                  onChange={(event) => updateParam('postDelayMs', Math.max(0, Number(event.target.value) || 0))}
                  className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs shadow-sm transition-all focus:border-cyan-500 focus:ring-4 focus:ring-cyan-500/10 dark:border-neutral-700 dark:bg-neutral-900"
                />
                <p className="text-[11px] text-slate-400 dark:text-slate-500">每个节点执行完成后都会等待该时长再进入下个节点，默认 50ms。</p>
              </div>

              {selectedMeta?.fields.length ? (
                <div className="space-y-3">
                  {selectedMeta.fields.filter(shouldShowField).map((field) => (
                    <div key={field.key} className="space-y-1.5">
                      <label className="text-[10px] font-bold uppercase tracking-wider text-slate-400">{field.label}</label>
                      {renderField(field)}
                      {field.description ? (
                        <p className="text-[11px] text-slate-400 dark:text-slate-500">{field.description}</p>
                      ) : null}
                    </div>
                  ))}
                </div>
              ) : (
                <div className="rounded-xl border border-dashed border-slate-300 px-3 py-4 text-[11px] text-slate-400 dark:border-neutral-700 dark:text-slate-500">
                  该节点无可编辑参数。
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </section>
  )
}
