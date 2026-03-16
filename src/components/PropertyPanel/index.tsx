import { useEffect, useMemo, useState } from 'react'
import { useWorkflowStore } from '../../stores/workflowStore'
import { useSettingsStore } from '../../stores/settingsStore'
import { getKeyboardOperationKind, getNodeFields, getNodeMeta, getSystemOperationKind, getTriggerMode, type ParamField } from '../../utils/nodeMeta'
import { listOpenWindowEntries, listStartMenuApps, type OpenWindowEntryPayload, type StartMenuAppPayload } from '../../utils/execution'
import { COMMAND_FLOW_REFRESH_ALL_EVENT } from '../../utils/refresh'
import type { NodeKind } from '../../types/workflow'
import { buildLaunchApplicationParams } from '../../utils/startMenuApp'
import SmartInputSelect from '../SmartInputSelect'
import StartMenuAppSelect from '../StartMenuAppSelect'
import StyledSelect from '../StyledSelect'
import PathPickerDropdown from '../PathPickerDropdown'

interface PropertyPanelProps {
  expanded: boolean
  onToggle: () => void
}

const toJsonDraft = (value: unknown, fieldKey?: string): string => {
  try {
    // Special handling for elementLocator - parse fingerprint if it's a JSON string
    if (fieldKey === 'elementLocator' && value && typeof value === 'object') {
      const locator = value as { fingerprint?: string }
      if (locator.fingerprint) {
        try {
          const parsedFingerprint = JSON.parse(locator.fingerprint)
          return JSON.stringify({ ...locator, fingerprint: parsedFingerprint }, null, 2)
        } catch {
          // If fingerprint is not valid JSON, return as-is
        }
      }
    }
    return JSON.stringify(value ?? null, null, 2)
  } catch {
    return 'null'
  }
}

const buildJsonDrafts = (params: Record<string, unknown>, fields: ParamField[]) => {
  const drafts: Record<string, string> = {}
  for (const field of fields) {
    if (field.type === 'json') {
      drafts[field.key] = toJsonDraft(params[field.key], field.key)
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
  ((kind === 'clipboardWrite' || kind === 'fileOperation' || kind === 'showMessage') && fieldKey === 'inputVar') ||
  (kind === 'clipboardWrite' && fieldKey === 'imageVar')

const isOutputVariableField = (kind: NodeKind, fieldKey: string) =>
  ((kind === 'clipboardRead' || kind === 'fileOperation') && fieldKey === 'outputVar') ||
  (kind === 'clipboardRead' && (fieldKey === 'outputTextVar' || fieldKey === 'outputImageVar'))

const isFilePathField = (kind: NodeKind, fieldKey: string) => {
  if (kind === 'fileOperation' && (fieldKey === 'sourcePath' || fieldKey === 'targetPath' || fieldKey === 'path')) {
    return true
  }
  if (kind === 'imageMatch' && (fieldKey === 'sourcePath' || fieldKey === 'templatePath')) {
    return true
  }
  if (kind === 'ocrMatch' && fieldKey === 'sourcePath') {
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

const isOcrMatchImageField = (kind: NodeKind, fieldKey: string) => kind === 'ocrMatch' && fieldKey === 'sourcePath'

const isTextFilePathField = (kind: NodeKind, fieldKey: string, params: Record<string, unknown> = {}) =>
  kind === 'fileOperation' && fieldKey === 'path' && (params.operation === 'readText' || params.operation === 'writeText')

const isClipboardImagePathField = (kind: NodeKind, fieldKey: string) =>
  kind === 'clipboardWrite' && fieldKey === 'imagePath'

const IMAGE_FILE_FILTERS = [
  { name: '图片文件', extensions: ['png', 'jpg', 'jpeg', 'bmp', 'webp'] },
]

const isWindowLookupNode = (kind: NodeKind, params: Record<string, unknown> = {}) =>
  kind === 'windowActivate' || (kind === 'trigger' && getTriggerMode(params) === 'window')

const isHotkeyTriggerNode = (kind: NodeKind, params: Record<string, unknown> = {}) =>
  kind === 'trigger' && getTriggerMode(params) === 'hotkey'

const isWindowLookupField = (kind: NodeKind, fieldKey: string, params: Record<string, unknown> = {}) =>
  isWindowLookupNode(kind, params) && ['title', 'program', 'programPath', 'className', 'processId'].includes(fieldKey)

export default function PropertyPanel({ expanded, onToggle }: PropertyPanelProps) {
  const { selectedNodeId, nodes, updateNodeParams } = useWorkflowStore()
  const selectedNode = useMemo(
    () => nodes.find((node) => node.id === selectedNodeId) ?? null,
    [nodes, selectedNodeId],
  )
  const selectedTriggerMode = selectedNode?.data.kind === 'trigger' ? getTriggerMode(selectedNode.data.params) : null

  const selectedMeta = selectedNode ? getNodeMeta(selectedNode.data.kind) : null
  const selectedFields = useMemo(
    () => (selectedNode && selectedMeta ? getNodeFields(selectedNode.data.kind, selectedNode.data.params, selectedMeta.defaultParams) : []),
    [selectedMeta, selectedNode],
  )
  const llmPresets = useSettingsStore((state) => state.llmPresets)
  const inputRecordingPresets = useSettingsStore((state) => state.inputRecordingPresets)
  const [jsonDrafts, setJsonDrafts] = useState<Record<string, string>>({})
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [openWindows, setOpenWindows] = useState<OpenWindowEntryPayload[]>([])
  const [startMenuApps, setStartMenuApps] = useState<StartMenuAppPayload[]>([])

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

  useEffect(() => {
    if (!selectedNode || !selectedMeta) {
      setJsonDrafts({})
      setErrors({})
      return
    }
    setJsonDrafts(buildJsonDrafts(selectedNode.data.params, selectedFields))
    setErrors({})
  }, [selectedFields, selectedMeta, selectedNode])

  useEffect(() => {
    if (!selectedNode || !expanded) return
    if (!isWindowLookupNode(selectedNode.data.kind, selectedNode.data.params)) {
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
  }, [expanded, selectedNode, selectedTriggerMode])

  useEffect(() => {
    if (!selectedNode || !expanded || selectedNode.data.kind !== 'launchApplication') {
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
  }, [expanded, selectedNode])

  useEffect(() => {
    if (!selectedNode || !expanded) return

    const handleGlobalRefresh = () => {
      if (isWindowLookupNode(selectedNode.data.kind, selectedNode.data.params)) {
        void listOpenWindowEntries()
          .then((entries) => {
            setOpenWindows(entries)
          })
          .catch(() => {
            setOpenWindows([])
          })
      }

      if (selectedNode.data.kind === 'launchApplication') {
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
  }, [expanded, selectedNode, selectedTriggerMode])

  const getStringSuggestions = (field: ParamField): string[] => {
    if (!selectedNode) return []
    const kind = selectedNode.data.kind
    const params = selectedNode.data.params

    if (isWindowLookupNode(kind, params) && field.key === 'title') {
      return windowTitles
    }
    if (isWindowLookupNode(kind, params) && field.key === 'program') {
      return windowPrograms
    }
    if (isWindowLookupNode(kind, params) && field.key === 'programPath') {
      return windowProgramPaths
    }
    if (isWindowLookupNode(kind, params) && field.key === 'className') {
      return windowClassNames
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
    if (kind === 'keyboardOperation' && field.key === 'key') {
      const operation = getKeyboardOperationKind(selectedNode.data.params)
      if (operation === 'key' || operation === 'down' || operation === 'up' || operation === 'shortcut') {
        return COMMON_KEYS
      }
    }
    if (isHotkeyTriggerNode(kind, params) && field.key === 'hotkey') {
      return COMMON_HOTKEYS
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
    if (!selectedNode || !isWindowLookupField(selectedNode.data.kind, fieldKey, selectedNode.data.params)) {
      return false
    }

    const matchedEntry = findOpenWindowEntry(fieldKey, value)
    if (!matchedEntry) {
      return false
    }

    updateNodeParams(selectedNode.id, {
      ...selectedNode.data.params,
      title: matchedEntry.title,
      program: matchedEntry.programName,
      programPath: matchedEntry.programPath,
      className: matchedEntry.className,
      processId: matchedEntry.processId,
    })
    return true
  }

  const updateParam = (key: string, value: unknown) => {
    if (!selectedNode) return
    const nextParams: Record<string, unknown> = {
      ...selectedNode.data.params,
      [key]: value,
    }

    if (selectedNode.data.kind === 'systemOperation' && key === 'percent') {
      const operation = getSystemOperationKind(nextParams, getSystemOperationKind(selectedMeta?.defaultParams ?? {}))
      if (operation === 'volumeSet' || operation === 'brightnessSet') {
        const num = Number(nextParams.percent ?? 0)
        if (!Number.isNaN(num)) {
          nextParams.percent = Math.min(100, Math.max(0, num))
        }
      }
    }

    // ensure brightness percent stays within 0-100 before any other handling
    if (selectedNode.data.kind === 'systemOperation' && key === 'operation') {
      const operation = getSystemOperationKind(nextParams, getSystemOperationKind(selectedMeta?.defaultParams ?? {}))
      if (operation === 'volumeSet' || operation === 'brightnessSet') {
        const num = Number(nextParams.percent ?? 50)
        if (!Number.isNaN(num)) {
          nextParams.percent = Math.min(100, Math.max(0, num))
        }
      }
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

    if (key === 'processId') {
      const num = Number(value)
      nextParams.processId = Number.isFinite(num) && num > 0 ? Math.floor(num) : 0
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

  const renderField = (field: ParamField) => {
    if (!selectedNode) return null
    const currentValue = getResolvedFieldValue(field)
    const isScreenshotSizeFieldDisabled =
      selectedNode.data.kind === 'screenshot' &&
      (field.key === 'startX' || field.key === 'startY' || field.key === 'width' || field.key === 'height') &&
      Boolean(selectedNode.data.params.fullscreen)
    const isScreenshotSaveDirFieldDisabled =
      selectedNode.data.kind === 'screenshot' &&
      field.key === 'saveDir' &&
      !Boolean(selectedNode.data.params.shouldSave ?? selectedMeta?.defaultParams.shouldSave ?? true)
    const isGuiAgentImageInputDisabled =
      selectedNode.data.kind === 'guiAgent' &&
      field.key === 'imageInput' &&
      Boolean(selectedNode.data.params.continuousMode ?? selectedMeta?.defaultParams.continuousMode ?? true)

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
      if (selectedNode.data.kind === 'guiAgent' && field.key === 'llmPresetId') {
        return (
          <StyledSelect
            value={String(currentValue ?? '')}
            options={llmPresets.map((preset) => ({ label: preset.name, value: preset.id }))}
            onChange={(nextValue) => updateParam(field.key, nextValue)}
            placeholder={llmPresets.length > 0 ? '请选择 LLM 预设' : '请先在设置中新增预设'}
          />
        )
      }

      if (selectedNode.data.kind === 'inputPresetReplay' && field.key === 'presetId') {
        return (
          <StyledSelect
            value={String(currentValue ?? '')}
            options={inputRecordingPresets.map((preset) => ({ label: preset.name, value: preset.id }))}
            onChange={(nextValue) => {
              const matched = inputRecordingPresets.find((preset) => preset.id === nextValue)
              updateNodeParams(selectedNode.id, {
                ...selectedNode.data.params,
                presetId: nextValue,
                presetName: matched?.name ?? '',
              })
            }}
            placeholder={inputRecordingPresets.length > 0 ? '请选择键鼠预设' : '请先在设置中新增键鼠预设'}
          />
        )
      }

      if (selectedNode.data.kind === 'launchApplication' && field.key === 'selectedApp') {
        return (
          <StartMenuAppSelect
            apps={startMenuApps}
            value={String(currentValue ?? '')}
            onSelect={(selectedApp) => {
              updateNodeParams(selectedNode.id, buildLaunchApplicationParams(selectedNode.data.params, selectedApp))
            }}
            placeholder={startMenuApps.length > 0 ? '请选择开始菜单应用' : '未扫描到可用应用'}
            hint="输入可筛选应用，也可用方向键和回车快速选择"
          />
        )
      }

      return (
        <StyledSelect
          value={String(currentValue ?? field.options?.[0]?.value ?? '')}
          options={field.options ?? []}
          onChange={(nextValue) => updateParam(field.key, nextValue)}
          placeholder="请选择"
        />
      )
    }

    if (isWindowLookupField(selectedNode.data.kind, field.key, selectedNode.data.params) && field.key === 'processId') {
      return (
        <SmartInputSelect
          value={String(Number(currentValue ?? 0) > 0 ? currentValue : '')}
          placeholder={field.placeholder}
          options={windowPids}
          onChange={(nextValue) => updateParam(field.key, nextValue.trim() ? Number(nextValue) : 0)}
          onOptionSelect={(nextValue) => {
            if (!applyWindowEntrySelection(field.key, nextValue)) {
              updateParam(field.key, nextValue.trim() ? Number(nextValue) : 0)
            }
          }}
          hint="可下拉选择当前窗口 PID，也可手动输入"
          filterOptions={false}
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
          disabled={isScreenshotSizeFieldDisabled || isGuiAgentImageInputDisabled}
          onChange={(event) => updateParam(field.key, Number(event.target.value))}
          className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs shadow-sm transition-all focus:border-cyan-500 focus:ring-4 focus:ring-cyan-500/10 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-400 dark:border-neutral-700 dark:bg-neutral-900 dark:disabled:bg-neutral-800 dark:disabled:text-neutral-500"
        />
      )
    }

    if (field.type === 'json') {
      const draft = jsonDrafts[field.key] ?? toJsonDraft(currentValue, field.key)
      const fieldError = errors[field.key]
      const isElementLocator = field.key === 'elementLocator'
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
            className={`w-full resize-none rounded-xl border border-slate-200 bg-white px-3 py-2 font-mono text-xs shadow-inner transition-all focus:border-cyan-500 focus:ring-4 focus:ring-cyan-500/10 dark:border-neutral-700 dark:bg-neutral-900 ${isElementLocator ? 'h-48' : 'h-24'}`}
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
                disabled={isScreenshotSaveDirFieldDisabled || isGuiAgentImageInputDisabled}
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
                    isImageMatchImageField(selectedNode.data.kind, field.key) ||
                    isOcrMatchImageField(selectedNode.data.kind, field.key) ||
                    isTextFilePathField(selectedNode.data.kind, field.key, selectedNode.data.params) ||
                    isClipboardImagePathField(selectedNode.data.kind, field.key)
                      ? 'file'
                      : 'menu'
                      )
                  }
                  filters={
                    isImageMatchImageField(selectedNode.data.kind, field.key) ||
                    isOcrMatchImageField(selectedNode.data.kind, field.key) ||
                    isClipboardImagePathField(selectedNode.data.kind, field.key)
                      ? IMAGE_FILE_FILTERS
                      : undefined
                  }
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
              onOptionSelect={(nextValue) => {
                if (!applyWindowEntrySelection(field.key, nextValue)) {
                  updateParam(field.key, nextValue)
                }
              }}
              hint="支持下拉选择，也可手动输入"
              filterOptions={!isWindowLookupField(selectedNode.data.kind, field.key, selectedNode.data.params)}
            />
          )
        }

        return (
          <input
            type="text"
            value={String(currentValue ?? '')}
            placeholder={field.placeholder}
            disabled={isGuiAgentImageInputDisabled}
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
                  value={Number(selectedNode.data.params.postDelayMs ?? 1000)}
                  onChange={(event) => updateParam('postDelayMs', Math.max(0, Number(event.target.value) || 0))}
                  className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs shadow-sm transition-all focus:border-cyan-500 focus:ring-4 focus:ring-cyan-500/10 dark:border-neutral-700 dark:bg-neutral-900"
                />
                <p className="text-[11px] text-slate-400 dark:text-slate-500">每个节点执行完成后都会等待该时长再进入下个节点，默认 1000ms。</p>
              </div>

              {selectedFields.length ? (
                <div className="space-y-3">
                  {selectedFields.map((field) => (
                    <div key={field.key} className="space-y-1.5">
                      <label className="text-[10px] font-bold uppercase tracking-wider text-slate-400">{field.label}</label>
                      {renderField(field)}
                      {field.description ? (
                        <p className="text-[11px] text-slate-400 dark:text-slate-500">{field.description}</p>
                      ) : null}
                    </div>
                  ))}
                  {selectedNode.data.kind === 'guiAgent' && !Boolean(selectedNode.data.params.continuousMode ?? selectedMeta?.defaultParams.continuousMode ?? true) ? (
                    <p className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] text-amber-700 dark:border-amber-700/60 dark:bg-amber-900/20 dark:text-amber-300">
                      非连续模式需手动提供图片输入。
                    </p>
                  ) : null}
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
