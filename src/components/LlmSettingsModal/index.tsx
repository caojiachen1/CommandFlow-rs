import { useEffect, useMemo, useState } from 'react'
import { useSettingsStore } from '../../stores/settingsStore'
import { fetchLlmModels } from '../../utils/execution'
import { resolveGuiAgentChatEndpointPreview } from '../../utils/llmEndpoint'
import SmartInputSelect from '../SmartInputSelect'

interface LlmSettingsModalProps {
  open: boolean
  onClose: () => void
}

interface DraftPreset {
  name: string
  baseUrl: string
  apiKey: string
  model: string
}

const EMPTY_DRAFT: DraftPreset = {
  name: '',
  baseUrl: 'https://api.openai.com',
  apiKey: '',
  model: 'gpt-5',
}

export default function LlmSettingsModal({ open, onClose }: LlmSettingsModalProps) {
  const llmPresets = useSettingsStore((state) => state.llmPresets)
  const addLlmPreset = useSettingsStore((state) => state.addLlmPreset)
  const updateLlmPreset = useSettingsStore((state) => state.updateLlmPreset)
  const deleteLlmPreset = useSettingsStore((state) => state.deleteLlmPreset)

  const [selectedId, setSelectedId] = useState<string>('')
  const [draft, setDraft] = useState<DraftPreset>(EMPTY_DRAFT)
  const [modelOptions, setModelOptions] = useState<string[]>([])
  const [modelLoading, setModelLoading] = useState(false)
  const [modelError, setModelError] = useState('')
  const [saveHint, setSaveHint] = useState('')

  useEffect(() => {
    if (!open) return
    if (llmPresets.length === 0) {
      setSelectedId('')
      setDraft(EMPTY_DRAFT)
      return
    }

    const current = llmPresets.find((item) => item.id === selectedId) ?? llmPresets[0]
    setSelectedId(current.id)
    setDraft({
      name: current.name,
      baseUrl: current.baseUrl,
      apiKey: current.apiKey,
      model: current.model,
    })
  }, [llmPresets, open, selectedId])

  const selectedPreset = useMemo(
    () => llmPresets.find((item) => item.id === selectedId) ?? null,
    [llmPresets, selectedId],
  )

  const modelSelectOptions = useMemo(() => {
    const base = modelOptions.length > 0 ? modelOptions : [draft.model || 'gpt-5']
    return Array.from(new Set(base.filter((item) => item.trim().length > 0)))
  }, [draft.model, modelOptions])

  useEffect(() => {
    if (!open || !selectedPreset) return

    const baseUrl = draft.baseUrl.trim()
    if (!baseUrl) {
      setModelOptions([])
      setModelError('')
      return
    }

    let cancelled = false
    setModelLoading(true)
    setModelError('')

    void fetchLlmModels(baseUrl, draft.apiKey)
      .then((models) => {
        if (cancelled) return
        setModelOptions(models)
      })
      .catch((error) => {
        if (cancelled) return
        setModelOptions([])
        setModelError(`模型列表获取失败：${String(error)}`)
      })
      .finally(() => {
        if (cancelled) return
        setModelLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [draft.apiKey, draft.baseUrl, open, selectedPreset])

  useEffect(() => {
    if (!saveHint) return
    const timer = window.setTimeout(() => setSaveHint(''), 1800)
    return () => window.clearTimeout(timer)
  }, [saveHint])

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-[360] flex items-center justify-center bg-black/55 backdrop-blur-sm"
      onClick={(event) => {
        if (event.target === event.currentTarget) {
          onClose()
        }
      }}
    >
      <div className="flex h-[78vh] w-[920px] max-w-[92vw] overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl dark:border-neutral-700 dark:bg-neutral-900">
        <aside className="flex w-72 shrink-0 flex-col border-r border-slate-200 bg-slate-50/70 dark:border-neutral-800 dark:bg-neutral-900/50">
          <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3 dark:border-neutral-800">
            <h3 className="text-sm font-bold text-slate-700 dark:text-slate-200">LLM 预设</h3>
            <button
              type="button"
              onClick={() => {
                const id = addLlmPreset({
                  name: `新预设 ${llmPresets.length + 1}`,
                  baseUrl: 'https://api.openai.com',
                  apiKey: '',
                  model: 'gpt-5',
                })
                setSelectedId(id)
              }}
              className="rounded-full bg-cyan-600 px-3 py-1 text-[11px] font-semibold text-white transition-colors hover:bg-cyan-500"
            >
              + 新增
            </button>
          </div>

          <div className="flex-1 overflow-y-auto p-2">
            {llmPresets.map((preset) => (
              <button
                key={preset.id}
                type="button"
                onClick={() => setSelectedId(preset.id)}
                className={`mb-1.5 block w-full rounded-xl border px-3 py-2 text-left transition-colors ${
                  preset.id === selectedId
                    ? 'border-cyan-500 bg-cyan-50 text-cyan-700 dark:bg-cyan-900/20 dark:text-cyan-300'
                    : 'border-slate-200 bg-white text-slate-700 hover:border-cyan-300 dark:border-neutral-700 dark:bg-neutral-900 dark:text-slate-300'
                }`}
              >
                <div className="truncate text-xs font-semibold">{preset.name}</div>
                <div className="mt-0.5 truncate text-[10px] text-slate-400 dark:text-slate-500">{preset.model}</div>
              </button>
            ))}
          </div>
        </aside>

        <section className="flex min-w-0 flex-1 flex-col">
          <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4 dark:border-neutral-800">
            <h3 className="text-sm font-bold text-slate-700 dark:text-slate-200">LLM 设置</h3>
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg p-1.5 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-neutral-800"
            >
              <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M18 6L6 18M6 6l12 12" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          </div>

          <div className="flex-1 overflow-y-auto p-6">
            {!selectedPreset ? (
              <div className="rounded-xl border border-dashed border-slate-300 p-8 text-center text-sm text-slate-400 dark:border-neutral-700">
                请先新建一个 LLM 预设。
              </div>
            ) : (
              <div className="space-y-4">
                <div className="space-y-1.5">
                  <label className="text-[11px] font-semibold text-slate-500 dark:text-slate-400">预设名称</label>
                  <input
                    type="text"
                    value={draft.name}
                    onChange={(event) => setDraft((state) => ({ ...state, name: event.target.value }))}
                    className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm shadow-sm focus:border-cyan-500 focus:outline-none dark:border-neutral-700 dark:bg-neutral-900"
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="text-[11px] font-semibold text-slate-500 dark:text-slate-400">Base URL</label>
                  <input
                    type="text"
                    value={draft.baseUrl}
                    onChange={(event) => setDraft((state) => ({ ...state, baseUrl: event.target.value }))}
                    className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm shadow-sm focus:border-cyan-500 focus:outline-none dark:border-neutral-700 dark:bg-neutral-900"
                    placeholder="https://api.openai.com"
                  />
                  <p className="text-[11px] font-mono text-cyan-600 dark:text-cyan-400 break-all">
                    预览：{resolveGuiAgentChatEndpointPreview(draft.baseUrl) || '（请先输入 Base URL）'}
                  </p>
                </div>

                <div className="space-y-1.5">
                  <label className="text-[11px] font-semibold text-slate-500 dark:text-slate-400">API Key</label>
                  <input
                    type="password"
                    value={draft.apiKey}
                    onChange={(event) => setDraft((state) => ({ ...state, apiKey: event.target.value }))}
                    className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm shadow-sm focus:border-cyan-500 focus:outline-none dark:border-neutral-700 dark:bg-neutral-900"
                    placeholder="sk-***"
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="text-[11px] font-semibold text-slate-500 dark:text-slate-400">模型名称</label>
                  <SmartInputSelect
                    value={draft.model || 'gpt-5'}
                    options={modelSelectOptions}
                    onChange={(nextValue) => setDraft((state) => ({ ...state, model: nextValue }))}
                    placeholder="输入或筛选模型名称"
                    hint="支持手动输入，也可从 /v1/models 返回结果中筛选"
                  />
                  {modelLoading ? <p className="text-[11px] text-slate-400">正在查询 /v1/models ...</p> : null}
                  {!modelLoading && modelError ? <p className="text-[11px] text-rose-500">{modelError}</p> : null}
                </div>

                <div className="flex items-center justify-between pt-4">
                  <button
                    type="button"
                    onClick={() => {
                      if (!selectedPreset) return
                      deleteLlmPreset(selectedPreset.id)
                    }}
                    className="rounded-full border border-rose-300 px-4 py-2 text-xs font-semibold text-rose-600 transition-colors hover:bg-rose-50 dark:border-rose-700 dark:text-rose-300 dark:hover:bg-rose-900/20"
                  >
                    删除预设
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      if (!selectedPreset) return
                      updateLlmPreset(selectedPreset.id, {
                        name: draft.name,
                        baseUrl: draft.baseUrl,
                        apiKey: draft.apiKey,
                        model: draft.model,
                      })
                      setSaveHint('保存成功')
                    }}
                    className="rounded-full bg-cyan-600 px-5 py-2 text-xs font-semibold text-white transition-colors hover:bg-cyan-500"
                  >
                    保存修改
                  </button>
                </div>
                {saveHint ? <p className="text-[12px] text-emerald-600 dark:text-emerald-400">{saveHint}</p> : null}
              </div>
            )}
          </div>
        </section>
      </div>
    </div>
  )
}
