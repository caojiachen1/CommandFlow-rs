import { useEffect, useState, useCallback } from 'react'
import { useWorkflowStore } from '../../stores/workflowStore'
import { getNodeMeta, type ParamField } from '../../utils/nodeMeta'
import { listOpenWindows } from '../../utils/execution'
import type { NodeKind } from '../../types/workflow'
import SmartInputSelect from '../SmartInputSelect'

interface PropertyModalProps {
  open: boolean
  onClose: () => void
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

const isVariableOperandField = (kind: NodeKind, fieldKey: string) => kind === 'condition' && (fieldKey === 'left' || fieldKey === 'right')

export default function PropertyModal({ open, onClose }: PropertyModalProps) {
  const { selectedNodeId, nodes, updateNodeParams, setSelectedNode } = useWorkflowStore()
  const selectedNode = nodes.find((node) => node.id === selectedNodeId) ?? null
  const selectedMeta = selectedNode ? getNodeMeta(selectedNode.data.kind) : null
  const [jsonDrafts, setJsonDrafts] = useState<Record<string, string>>({})
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [windowTitles, setWindowTitles] = useState<string[]>([])

  const variableNames = dedupe(
    nodes
      .filter((node) => node.data.kind === 'varDefine')
      .map((node) => (typeof node.data.params.name === 'string' ? node.data.params.name.trim() : '')),
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
    if (!selectedNode || !open) return
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
  }, [open, selectedNode])

  const getStringSuggestions = (field: ParamField): string[] => {
    if (!selectedNode) return []
    const kind = selectedNode.data.kind

    if (kind === 'windowTrigger' && field.key === 'title') {
      return windowTitles
    }
    if (kind === 'windowActivate' && field.key === 'title') {
      return windowTitles
    }
    if (kind === 'varSet' && field.key === 'name') {
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
    if (kind === 'keyboardKey' && field.key === 'key') {
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
    updateNodeParams(selectedNode.id, {
      ...selectedNode.data.params,
      [key]: value,
    })
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
    const currentValue = selectedNode.data.params[field.key]
    const isScreenshotSizeFieldDisabled =
      selectedNode.data.kind === 'screenshot' &&
      (field.key === 'width' || field.key === 'height') &&
      Boolean(selectedNode.data.params.fullscreen)

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
      return (
        <select
          value={String(currentValue ?? '')}
          onChange={(event) => updateParam(field.key, event.target.value)}
          onKeyDown={handleInputKeyDown}
          className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs shadow-sm transition-all focus:border-cyan-500 focus:ring-4 focus:ring-cyan-500/10 dark:border-neutral-700 dark:bg-neutral-900"
        >
          {(field.options ?? []).map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
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
          className="h-36 w-full resize-y rounded-xl border border-slate-200 bg-white px-3 py-2 font-mono text-xs shadow-inner transition-all focus:border-cyan-500 focus:ring-4 focus:ring-cyan-500/10 dark:border-neutral-700 dark:bg-neutral-900"
        />
      )
    }

    return (
      (() => {
        const suggestions = getStringSuggestions(field)
        if (suggestions.length > 0) {
          return (
            <SmartInputSelect
              value={String(currentValue ?? '')}
              placeholder={field.placeholder}
              options={suggestions}
              onChange={(nextValue) => updateParam(field.key, nextValue)}
              onEnter={handleClose}
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

            {selectedMeta.fields.length ? (
              <div className="space-y-3">
                {selectedMeta.fields.map((field) => (
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
