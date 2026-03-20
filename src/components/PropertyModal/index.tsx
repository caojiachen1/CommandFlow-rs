import { useEffect, useState, useCallback, useMemo } from 'react'
import { useWorkflowStore } from '../../stores/workflowStore'
import { useSettingsStore } from '../../stores/settingsStore'
import { getKeyboardOperationKind, getNodeFields, getNodeMeta, getSystemOperationKind, getTriggerMode, type ParamField } from '../../utils/nodeMeta'
import { fetchLlmModels, listOpenWindowEntries, listRunningProcesses, listStartMenuApps, type OpenWindowEntryPayload, type RunningProcessEntryPayload, type StartMenuAppPayload } from '../../utils/execution'
import { COMMAND_FLOW_REFRESH_ALL_EVENT } from '../../utils/refresh'
import { resolveGuiAgentChatEndpointPreview } from '../../utils/llmEndpoint'
import type { NodeKind } from '../../types/workflow'
import { buildLaunchApplicationParams } from '../../utils/startMenuApp'
import SmartInputSelect from '../SmartInputSelect'
import StartMenuAppSelect from '../StartMenuAppSelect'
import StyledSelect from '../StyledSelect'
import PathPickerDropdown from '../PathPickerDropdown'

interface PropertyModalProps {
  open: boolean
  onClose: () => void
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
  (kind === 'varDefine' || kind === 'varSet' || kind === 'varMath') && fieldKey === 'name'

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

const isTerminateProcessNode = (kind: NodeKind) => kind === 'terminateProcess'

export default function PropertyModal({ open, onClose }: PropertyModalProps) {
  const { selectedNodeId, nodes, updateNodeParams, setSelectedNode } = useWorkflowStore()
  const selectedNode = useMemo(
    () => nodes.find((node) => node.id === selectedNodeId) ?? null,
    [nodes, selectedNodeId],
  )
  const selectedTriggerMode = selectedNode?.data.kind === 'trigger' ? getTriggerMode(selectedNode.data.params) : null
  const selectedMeta = useMemo(
    () => (selectedNode ? getNodeMeta(selectedNode.data.kind) : null),
    [selectedNode],
  )
  const selectedFields = useMemo(
    () => (selectedNode && selectedMeta
      ? getNodeFields(selectedNode.data.kind, selectedNode.data.params, selectedMeta.defaultParams)
      : []),
    [selectedMeta, selectedNode],
  )
  const [jsonDrafts, setJsonDrafts] = useState<Record<string, string>>({})
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [openWindows, setOpenWindows] = useState<OpenWindowEntryPayload[]>([])
  const [runningProcesses, setRunningProcesses] = useState<RunningProcessEntryPayload[]>([])
  const [guiModelNames, setGuiModelNames] = useState<string[]>([])
  const [startMenuApps, setStartMenuApps] = useState<StartMenuAppPayload[]>([])
  const inputRecordingPresets = useSettingsStore((state) => state.inputRecordingPresets)

  const variableNames = useMemo(
    () => dedupe(
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
    if (!selectedNode || !open) return
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
  }, [open, selectedNode, selectedTriggerMode])

  useEffect(() => {
    if (!selectedNode || !open || selectedNode.data.kind !== 'launchApplication') {
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
  }, [open, selectedNode])

  useEffect(() => {
    if (!selectedNode || !open || !isTerminateProcessNode(selectedNode.data.kind)) {
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
  }, [open, selectedNode])

  useEffect(() => {
    if (!selectedNode || !open || selectedNode.data.kind !== 'guiAgent') {
      setGuiModelNames([])
      return
    }

    const baseUrl = String(selectedNode.data.params.baseUrl ?? selectedMeta?.defaultParams.baseUrl ?? '').trim()
    const apiKey = String(selectedNode.data.params.apiKey ?? selectedMeta?.defaultParams.apiKey ?? '').trim()

    if (!baseUrl) {
      setGuiModelNames([])
      return
    }

    let cancelled = false
    void fetchLlmModels(baseUrl, apiKey)
      .then((models) => {
        if (cancelled) return
        setGuiModelNames(models)
      })
      .catch(() => {
        if (cancelled) return
        setGuiModelNames([])
      })

    return () => {
      cancelled = true
    }
  }, [open, selectedMeta?.defaultParams.apiKey, selectedMeta?.defaultParams.baseUrl, selectedNode])

  useEffect(() => {
    if (!selectedNode || !open) return

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

      if (isTerminateProcessNode(selectedNode.data.kind)) {
        void listRunningProcesses(true)
          .then((entries) => {
            setRunningProcesses(entries)
          })
          .catch(() => {
            setRunningProcesses([])
          })
      }

      if (selectedNode.data.kind === 'guiAgent') {
        const baseUrl = String(selectedNode.data.params.baseUrl ?? selectedMeta?.defaultParams.baseUrl ?? '').trim()
        const apiKey = String(selectedNode.data.params.apiKey ?? selectedMeta?.defaultParams.apiKey ?? '').trim()

        if (!baseUrl) {
          setGuiModelNames([])
          return
        }

        void fetchLlmModels(baseUrl, apiKey)
          .then((models) => {
            setGuiModelNames(models)
          })
          .catch(() => {
            setGuiModelNames([])
          })
      }
    }

    window.addEventListener(COMMAND_FLOW_REFRESH_ALL_EVENT, handleGlobalRefresh)
    return () => {
      window.removeEventListener(COMMAND_FLOW_REFRESH_ALL_EVENT, handleGlobalRefresh)
    }
  }, [open, selectedMeta?.defaultParams.apiKey, selectedMeta?.defaultParams.baseUrl, selectedNode, selectedTriggerMode])

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
    if (isTerminateProcessNode(kind) && field.key === 'processName') {
      return processNames
    }
    if (isTerminateProcessNode(kind) && field.key === 'processId') {
      return processPids
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
    if (kind === 'guiAgent' && field.key === 'model') {
      return guiModelNames
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
    if (!selectedNode || !isTerminateProcessNode(selectedNode.data.kind)) {
      return false
    }

    const matched = findRunningProcessEntry(fieldKey, value)
    if (!matched) {
      return false
    }

    updateNodeParams(selectedNode.id, {
      ...selectedNode.data.params,
      processName: matched.processName,
      processId: matched.pid,
    })
    return true
  }

  const updateParam = (key: string, value: unknown) => {
    if (!selectedNode) return
    const nextParams: Record<string, unknown> = {
      ...selectedNode.data.params,
      [key]: value,
    }

    if (selectedNode.data.kind === 'systemOperation' && (key === 'percent' || key === 'operation')) {
      const operation = getSystemOperationKind(nextParams, getSystemOperationKind(selectedMeta?.defaultParams ?? {}))
      if (operation === 'volumeSet' || operation === 'brightnessSet') {
        const num = Number(nextParams.percent ?? 50)
        if (!Number.isNaN(num)) {
          nextParams.percent = Math.min(100, Math.max(0, num))
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

  const handleClose = useCallback(() => {
    setSelectedNode(null)
    onClose()
  }, [setSelectedNode, onClose])

  const handleBackdropClick = useCallback((event: React.MouseEvent) => {
    if (event.target === event.currentTarget) {
      handleClose()
    }
  }, [handleClose])

  const handleInputKeyDown = useCallback((event: React.KeyboardEvent) => {
    if (event.key === 'Enter') {
      handleClose()
    }
  }, [handleClose])

  useEffect(() => {
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && open) {
        handleClose()
      }
    }
    document.addEventListener('keydown', handleEscape)
    return () => document.removeEventListener('keydown', handleEscape)
  }, [open, handleClose])

  if (!open || !selectedNode || !selectedMeta) return null

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

    if (field.type === 'boolean') {
      return (
        <label className="flex items-center gap-2 text-xs font-medium text-slate-700 dark:text-slate-300">
          <input
            type="checkbox"
            checked={Boolean(currentValue)}
            onChange={(event) => updateParam(field.key, event.target.checked)}
            onKeyDown={handleInputKeyDown}
            className="h-4 w-4 rounded border-slate-300 text-cyan-600 focus:ring-cyan-500"
          />
          启用
        </label>
      )
    }

    if (field.type === 'select') {
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
            onEnter={handleClose}
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
            onEnter={handleClose}
            placeholder={startMenuApps.length > 0 ? '输入以筛选开始菜单应用' : '未扫描到可用应用'}
            hint="输入可筛选应用，也可用方向键和回车快速选择"
          />
        )
      }

      return (
        <StyledSelect
          value={String(currentValue ?? field.options?.[0]?.value ?? '')}
          options={field.options ?? []}
          onChange={(nextValue) => updateParam(field.key, nextValue)}
          onEnter={handleClose}
          placeholder="请选择"
        />
      )
    }

    if ((isWindowLookupField(selectedNode.data.kind, field.key, selectedNode.data.params) || (isTerminateProcessNode(selectedNode.data.kind) && field.key === 'processId')) && field.key === 'processId') {
      return (
        <SmartInputSelect
          value={String(Number(currentValue ?? 0) > 0 ? currentValue : '')}
          placeholder={field.placeholder}
          options={isTerminateProcessNode(selectedNode.data.kind) ? processPids : windowPids}
          onChange={(nextValue) => updateParam(field.key, nextValue.trim() ? Number(nextValue) : 0)}
          onOptionSelect={(nextValue) => {
            if (!applyWindowEntrySelection(field.key, nextValue)) {
              if (!applyRunningProcessSelection(field.key, nextValue)) {
                updateParam(field.key, nextValue.trim() ? Number(nextValue) : 0)
              }
            }
          }}
          onEnter={handleClose}
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
          disabled={isScreenshotSizeFieldDisabled}
          onChange={(event) => updateParam(field.key, Number(event.target.value))}
          onKeyDown={handleInputKeyDown}
          className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs shadow-sm transition-all focus:border-cyan-500 focus:ring-4 focus:ring-cyan-500/10 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-400 dark:border-neutral-700 dark:bg-neutral-900 dark:disabled:bg-neutral-800 dark:disabled:text-neutral-500"
        />
      )
    }

    if (field.type === 'json') {
      const draft = jsonDrafts[field.key] ?? toJsonDraft(currentValue, field.key)
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
            className="w-full resize-none rounded-xl border border-slate-200 bg-white px-3 py-2 font-mono text-xs shadow-inner transition-all focus:border-cyan-500 focus:ring-4 focus:ring-cyan-500/10 dark:border-neutral-700 dark:bg-neutral-900 !h-64"
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
          className="h-36 w-full resize-y rounded-xl border border-slate-200 bg-white px-3 py-2 font-mono text-xs shadow-inner transition-all focus:border-cyan-500 focus:ring-4 focus:ring-cyan-500/10 dark:border-neutral-700 dark:bg-neutral-900"
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
                onKeyDown={handleInputKeyDown}
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
                    isTextFilePathField(selectedNode.data.kind, field.key, selectedNode.data.params) ||
                    isClipboardImagePathField(selectedNode.data.kind, field.key)
                      ? 'file'
                      : 'menu'
                      )
                  }
                  filters={
                    isImageMatchImageField(selectedNode.data.kind, field.key) || isClipboardImagePathField(selectedNode.data.kind, field.key)
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

        if (isVariableNameField(selectedNode.data.kind, field.key) || isInputVariableField(selectedNode.data.kind, field.key) || variableReferenceField) {
          return (
            <SmartInputSelect
              value={String(currentValue ?? '')}
              placeholder={field.placeholder}
              options={variableNames}
              onChange={(nextValue) => updateParam(field.key, nextValue)}
              onEnter={handleClose}
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
                  if (!applyRunningProcessSelection(field.key, nextValue)) {
                    updateParam(field.key, nextValue)
                  }
                }
              }}
              onEnter={handleClose}
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
            onChange={(event) => updateParam(field.key, event.target.value)}
            onKeyDown={handleInputKeyDown}
            className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs shadow-sm transition-all focus:border-cyan-500 focus:ring-4 focus:ring-cyan-500/10 dark:border-neutral-700 dark:bg-neutral-900"
          />
        )
      })()
    )
  }

  return (
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center bg-black/50 backdrop-blur-sm"
      onClick={handleBackdropClick}
    >
      <div className="flex h-[80vh] w-[480px] flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl dark:border-neutral-700 dark:bg-neutral-900">
        <div className="flex items-center justify-between border-b border-slate-200 bg-slate-50 px-6 py-4 dark:border-neutral-800 dark:bg-neutral-900/50">
          <div className="flex items-center gap-3">
            <h2 className="text-sm font-bold text-slate-700 dark:text-slate-200">节点属性</h2>
            <span className="rounded-full bg-cyan-100 px-3 py-1 text-[10px] font-bold text-cyan-700 dark:bg-cyan-900/30 dark:text-cyan-400">
              {selectedNode.data.kind}
            </span>
          </div>
          <button
            type="button"
            onClick={handleClose}
            className="rounded-lg p-1.5 text-slate-400 transition-colors hover:bg-slate-200 hover:text-slate-600 dark:hover:bg-slate-800"
          >
            <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M18 6L6 18M6 6l12 12" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-6 scrollbar-thin scrollbar-thumb-slate-200 dark:scrollbar-thumb-slate-800">
          <div className="space-y-4">
            <div className="space-y-2">
              <label className="text-[10px] font-bold uppercase tracking-wider text-slate-400">节点名称</label>
              <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-xs font-semibold shadow-sm dark:border-neutral-700 dark:bg-neutral-900/70">
                {selectedNode.data.label}
              </div>
            </div>
            
            <p className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-[11px] leading-relaxed text-slate-500 dark:border-neutral-800 dark:bg-neutral-900/60 dark:text-slate-400">
              {selectedMeta.description}
            </p>

            <div className="space-y-1.5">
              <label className="text-[10px] font-bold uppercase tracking-wider text-slate-400">节点后置间隔(ms)</label>
              <input
                type="number"
                min={0}
                step={1}
                value={Number(selectedNode.data.params.postDelayMs ?? 1000)}
                onChange={(event) => updateParam('postDelayMs', Math.max(0, Number(event.target.value) || 0))}
                onKeyDown={handleInputKeyDown}
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
                    {selectedNode.data.kind === 'guiAgent' && field.key === 'baseUrl' ? (
                      <p className="text-[11px] font-mono text-cyan-600 dark:text-cyan-400">
                        预览：{resolveGuiAgentChatEndpointPreview(String(selectedNode.data.params.baseUrl ?? selectedMeta?.defaultParams.baseUrl ?? '')) || '（请先输入 Base URL）'}
                      </p>
                    ) : null}
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
        </div>

        <div className="flex justify-end gap-3 border-t border-slate-200 bg-slate-50 px-6 py-4 dark:border-neutral-800 dark:bg-neutral-900/50">
          <button
            type="button"
            onClick={handleClose}
            className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-xs font-medium text-slate-600 transition-all hover:bg-slate-50 dark:border-neutral-700 dark:bg-neutral-800 dark:text-slate-300 dark:hover:bg-neutral-700"
          >
            关闭
          </button>
        </div>
      </div>
    </div>
  )
}
