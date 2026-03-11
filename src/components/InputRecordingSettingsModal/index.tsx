import { useEffect, useMemo, useState } from 'react'
import { useSettingsStore, type InputRecordingAction, type InputRecordingOptions } from '../../stores/settingsStore'

interface InputRecordingSettingsModalProps {
  open: boolean
  onClose: () => void
  onStartRecording: (presetId: string, options: InputRecordingOptions) => void
}

interface DraftPreset {
  name: string
  options: InputRecordingOptions
  actions: InputRecordingAction[]
}

const EMPTY_DRAFT: DraftPreset = {
  name: '',
  options: {
    recordKeyboard: true,
    recordMouseClicks: true,
    recordMouseMoves: true,
  },
  actions: [],
}

const describeAction = (action: InputRecordingAction) => {
  switch (action.kind) {
    case 'keyDown':
      return `按下 ${action.key}`
    case 'keyUp':
      return `松开 ${action.key}`
    case 'mouseDown':
      return `${action.button} 键按下 @ (${action.x}, ${action.y})`
    case 'mouseUp':
      return `${action.button} 键松开 @ (${action.x}, ${action.y})`
    case 'mouseMovePath':
      return `轨迹 ${action.points.length} 点 · ${Math.round(action.distancePx)}px`
    default:
      return '未知操作'
  }
}

export default function InputRecordingSettingsModal({ open, onClose, onStartRecording }: InputRecordingSettingsModalProps) {
  const presets = useSettingsStore((state) => state.inputRecordingPresets)
  const addPreset = useSettingsStore((state) => state.addInputRecordingPreset)
  const updatePreset = useSettingsStore((state) => state.updateInputRecordingPreset)
  const deletePreset = useSettingsStore((state) => state.deleteInputRecordingPreset)

  const [selectedId, setSelectedId] = useState('')
  const [draft, setDraft] = useState<DraftPreset>(EMPTY_DRAFT)
  const [saveHint, setSaveHint] = useState('')
  const [clipStart, setClipStart] = useState(0)
  const [clipEnd, setClipEnd] = useState(0)

  useEffect(() => {
    if (!open) return
    if (presets.length === 0) {
      setSelectedId('')
      setDraft(EMPTY_DRAFT)
      return
    }

    const current = presets.find((item) => item.id === selectedId) ?? presets[0]
    setSelectedId(current.id)
    setDraft({
      name: current.name,
      options: current.options,
      actions: current.actions,
    })
    setClipStart(0)
    setClipEnd(Math.max(0, current.actions.length - 1))
  }, [open, presets, selectedId])

  useEffect(() => {
    if (!saveHint) return
    const timer = window.setTimeout(() => setSaveHint(''), 1800)
    return () => window.clearTimeout(timer)
  }, [saveHint])

  const selectedPreset = useMemo(
    () => presets.find((item) => item.id === selectedId) ?? null,
    [presets, selectedId],
  )

  const totalDurationMs = useMemo(() => {
    if (draft.actions.length <= 1) return 0
    const first = draft.actions[0]
    const last = draft.actions[draft.actions.length - 1]
    const firstTs = first.timestampMs
    const lastTs = last.kind === 'mouseMovePath'
      ? (last.points[last.points.length - 1]?.timestampMs ?? last.timestampMs + last.durationMs)
      : last.timestampMs
    return Math.max(0, lastTs - firstTs)
  }, [draft.actions])

  const updateAction = (index: number, updater: (action: InputRecordingAction) => InputRecordingAction) => {
    setDraft((state) => ({
      ...state,
      actions: state.actions.map((action, actionIndex) => (actionIndex === index ? updater(action) : action)),
    }))
  }

  const moveAction = (index: number, direction: -1 | 1) => {
    setDraft((state) => {
      const nextIndex = index + direction
      if (nextIndex < 0 || nextIndex >= state.actions.length) return state
      const actions = [...state.actions]
      const [current] = actions.splice(index, 1)
      actions.splice(nextIndex, 0, current)
      return { ...state, actions }
    })
  }

  const removeAction = (index: number) => {
    setDraft((state) => ({
      ...state,
      actions: state.actions.filter((_, actionIndex) => actionIndex !== index),
    }))
  }

  const clipActions = () => {
    setDraft((state) => {
      if (state.actions.length === 0) return state
      const start = Math.max(0, Math.min(clipStart, state.actions.length - 1))
      const end = Math.max(start, Math.min(clipEnd, state.actions.length - 1))
      return {
        ...state,
        actions: state.actions.slice(start, end + 1),
      }
    })
    setSaveHint('已按区间剪辑，请记得保存修改')
  }

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
      <div className="flex h-[78vh] w-[960px] max-w-[94vw] overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl dark:border-neutral-700 dark:bg-neutral-900">
        <aside className="flex w-72 shrink-0 flex-col border-r border-slate-200 bg-slate-50/70 dark:border-neutral-800 dark:bg-neutral-900/50">
          <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3 dark:border-neutral-800">
            <h3 className="text-sm font-bold text-slate-700 dark:text-slate-200">键鼠预设</h3>
            <button
              type="button"
              onClick={() => {
                const id = addPreset({
                  name: `新键鼠预设 ${presets.length + 1}`,
                })
                setSelectedId(id)
              }}
              className="rounded-full bg-cyan-600 px-3 py-1 text-[11px] font-semibold text-white transition-colors hover:bg-cyan-500"
            >
              + 新增
            </button>
          </div>

          <div className="flex-1 overflow-y-auto p-2">
            {presets.map((preset) => (
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
                <div className="mt-0.5 text-[10px] text-slate-400 dark:text-slate-500">
                  {preset.actions.length} 个已保存操作
                </div>
              </button>
            ))}
          </div>
        </aside>

        <section className="flex min-w-0 flex-1 flex-col">
          <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4 dark:border-neutral-800">
            <div>
              <h3 className="text-sm font-bold text-slate-700 dark:text-slate-200">键鼠录制设置</h3>
              <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">支持全局快捷键：Scroll Lock 开始，Alt + Scroll Lock 停止</p>
            </div>
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
                请先新建一个键鼠录制预设。
              </div>
            ) : (
              <div className="space-y-5">
                <div className="space-y-1.5">
                  <label className="text-[11px] font-semibold text-slate-500 dark:text-slate-400">预设名称</label>
                  <input
                    type="text"
                    value={draft.name}
                    onChange={(event) => setDraft((state) => ({ ...state, name: event.target.value }))}
                    className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm shadow-sm focus:border-cyan-500 focus:outline-none dark:border-neutral-700 dark:bg-neutral-900"
                  />
                </div>

                <div className="rounded-2xl border border-slate-200 bg-slate-50/70 p-4 dark:border-neutral-700 dark:bg-neutral-800/40">
                  <h4 className="text-xs font-bold text-slate-700 dark:text-slate-200">录制内容</h4>
                  <div className="mt-3 space-y-3 text-sm">
                    {[
                      ['recordKeyboard', '记录键盘操作', '记录按键按下与松开，用于还原快捷键与组合键。'],
                      ['recordMouseClicks', '记录鼠标点击', '记录左键 / 右键 / 中键的按下与松开位置。'],
                      ['recordMouseMoves', '记录鼠标移动轨迹', '自动进行降采样、平滑处理与特征提取，尽量保留原始轨迹走势。'],
                    ].map(([key, label, hint]) => (
                      <label key={key} className="flex items-start gap-3 rounded-xl border border-transparent bg-white/70 px-3 py-3 dark:bg-neutral-900/60">
                        <input
                          type="checkbox"
                          checked={draft.options[key as keyof InputRecordingOptions]}
                          onChange={(event) =>
                            setDraft((state) => ({
                              ...state,
                              options: {
                                ...state.options,
                                [key]: event.target.checked,
                              },
                            }))
                          }
                          className="mt-0.5 h-4 w-4 rounded border-slate-300 text-cyan-600 focus:ring-cyan-500"
                        />
                        <span>
                          <span className="block text-sm font-semibold text-slate-700 dark:text-slate-200">{label}</span>
                          <span className="mt-1 block text-[11px] leading-relaxed text-slate-500 dark:text-slate-400">{hint}</span>
                        </span>
                      </label>
                    ))}
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-neutral-700 dark:bg-neutral-900/60">
                    <div className="text-[11px] font-semibold text-slate-500 dark:text-slate-400">已保存操作</div>
                    <div className="mt-2 text-2xl font-bold text-slate-800 dark:text-slate-100">{draft.actions.length}</div>
                  </div>
                  <div className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-neutral-700 dark:bg-neutral-900/60">
                    <div className="text-[11px] font-semibold text-slate-500 dark:text-slate-400">录制时长</div>
                    <div className="mt-2 text-sm font-medium text-slate-700 dark:text-slate-200">
                      {totalDurationMs > 0 ? `${(totalDurationMs / 1000).toFixed(2)} 秒` : '暂无时长数据'}
                    </div>
                  </div>
                </div>

                <div className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-neutral-700 dark:bg-neutral-900/60">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <h4 className="text-xs font-bold text-slate-700 dark:text-slate-200">录制操作剪辑</h4>
                      <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">支持按操作索引裁剪保留区间，再保存回预设。</p>
                    </div>
                    <button
                      type="button"
                      onClick={clipActions}
                      disabled={draft.actions.length === 0}
                      className="rounded-full border border-cyan-300 px-4 py-2 text-xs font-semibold text-cyan-700 transition-colors hover:bg-cyan-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-cyan-700 dark:text-cyan-300 dark:hover:bg-cyan-900/20"
                    >
                      剪辑保留区间
                    </button>
                  </div>
                  <div className="mt-3 grid grid-cols-2 gap-3">
                    <label className="space-y-1.5 text-[11px] text-slate-500 dark:text-slate-400">
                      <span className="font-semibold">起始索引</span>
                      <input
                        type="number"
                        min={0}
                        max={Math.max(0, draft.actions.length - 1)}
                        value={clipStart}
                        onChange={(event) => setClipStart(Math.max(0, Number(event.target.value) || 0))}
                        className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs shadow-sm focus:border-cyan-500 focus:outline-none dark:border-neutral-700 dark:bg-neutral-900"
                      />
                    </label>
                    <label className="space-y-1.5 text-[11px] text-slate-500 dark:text-slate-400">
                      <span className="font-semibold">结束索引</span>
                      <input
                        type="number"
                        min={0}
                        max={Math.max(0, draft.actions.length - 1)}
                        value={clipEnd}
                        onChange={(event) => setClipEnd(Math.max(0, Number(event.target.value) || 0))}
                        className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs shadow-sm focus:border-cyan-500 focus:outline-none dark:border-neutral-700 dark:bg-neutral-900"
                      />
                    </label>
                  </div>
                </div>

                <div className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-neutral-700 dark:bg-neutral-900/60">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <h4 className="text-xs font-bold text-slate-700 dark:text-slate-200">操作可视化编辑</h4>
                      <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">可调整顺序、删除操作，并编辑关键参数。</p>
                    </div>
                    <span className="rounded-full bg-slate-100 px-3 py-1 text-[11px] font-semibold text-slate-600 dark:bg-neutral-800 dark:text-slate-300">
                      {draft.actions.length} 项
                    </span>
                  </div>

                  <div className="mt-4 max-h-[32vh] space-y-3 overflow-y-auto pr-1">
                    {draft.actions.length === 0 ? (
                      <div className="rounded-xl border border-dashed border-slate-300 px-4 py-6 text-center text-[12px] text-slate-400 dark:border-neutral-700">
                        该预设还没有录制操作，先去录一段精彩的键鼠 ballet 吧。
                      </div>
                    ) : draft.actions.map((action, index) => (
                      <div key={`${action.kind}-${action.timestampMs}-${index}`} className="rounded-2xl border border-slate-200 bg-slate-50/70 p-3 dark:border-neutral-700 dark:bg-neutral-800/40">
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <div className="text-xs font-bold text-slate-700 dark:text-slate-200">#{index + 1} · {describeAction(action)}</div>
                            <div className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">时间戳：{action.timestampMs} ms</div>
                          </div>
                          <div className="flex items-center gap-1">
                            <button type="button" onClick={() => moveAction(index, -1)} className="rounded-lg border border-slate-300 px-2 py-1 text-[11px] font-semibold text-slate-600 hover:bg-slate-100 dark:border-neutral-700 dark:text-slate-300 dark:hover:bg-neutral-800">上移</button>
                            <button type="button" onClick={() => moveAction(index, 1)} className="rounded-lg border border-slate-300 px-2 py-1 text-[11px] font-semibold text-slate-600 hover:bg-slate-100 dark:border-neutral-700 dark:text-slate-300 dark:hover:bg-neutral-800">下移</button>
                            <button type="button" onClick={() => removeAction(index)} className="rounded-lg border border-rose-300 px-2 py-1 text-[11px] font-semibold text-rose-600 hover:bg-rose-50 dark:border-rose-700 dark:text-rose-300 dark:hover:bg-rose-900/20">删除</button>
                          </div>
                        </div>

                        <div className="mt-3 grid grid-cols-2 gap-3 text-[11px]">
                          <label className="space-y-1 text-slate-500 dark:text-slate-400">
                            <span className="font-semibold">时间戳(ms)</span>
                            <input
                              type="number"
                              min={0}
                              value={action.timestampMs}
                              onChange={(event) => updateAction(index, (current) => ({ ...current, timestampMs: Math.max(0, Number(event.target.value) || 0) } as InputRecordingAction))}
                              className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs shadow-sm focus:border-cyan-500 focus:outline-none dark:border-neutral-700 dark:bg-neutral-900"
                            />
                          </label>

                          {'key' in action ? (
                            <label className="space-y-1 text-slate-500 dark:text-slate-400">
                              <span className="font-semibold">按键</span>
                              <input
                                type="text"
                                value={action.key}
                                onChange={(event) => updateAction(index, (current) => ('key' in current ? { ...current, key: event.target.value } : current))}
                                className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs shadow-sm focus:border-cyan-500 focus:outline-none dark:border-neutral-700 dark:bg-neutral-900"
                              />
                            </label>
                          ) : null}

                          {'button' in action ? (
                            <>
                              <label className="space-y-1 text-slate-500 dark:text-slate-400">
                                <span className="font-semibold">按钮</span>
                                <input
                                  type="text"
                                  value={action.button}
                                  onChange={(event) => updateAction(index, (current) => ('button' in current ? { ...current, button: event.target.value } : current))}
                                  className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs shadow-sm focus:border-cyan-500 focus:outline-none dark:border-neutral-700 dark:bg-neutral-900"
                                />
                              </label>
                              <label className="space-y-1 text-slate-500 dark:text-slate-400">
                                <span className="font-semibold">X</span>
                                <input
                                  type="number"
                                  value={action.x}
                                  onChange={(event) => updateAction(index, (current) => ('x' in current ? { ...current, x: Number(event.target.value) || 0 } : current))}
                                  className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs shadow-sm focus:border-cyan-500 focus:outline-none dark:border-neutral-700 dark:bg-neutral-900"
                                />
                              </label>
                              <label className="space-y-1 text-slate-500 dark:text-slate-400">
                                <span className="font-semibold">Y</span>
                                <input
                                  type="number"
                                  value={action.y}
                                  onChange={(event) => updateAction(index, (current) => ('y' in current ? { ...current, y: Number(event.target.value) || 0 } : current))}
                                  className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs shadow-sm focus:border-cyan-500 focus:outline-none dark:border-neutral-700 dark:bg-neutral-900"
                                />
                              </label>
                            </>
                          ) : null}

                          {action.kind === 'mouseMovePath' ? (
                            <>
                              <label className="space-y-1 text-slate-500 dark:text-slate-400">
                                <span className="font-semibold">持续时长(ms)</span>
                                <input
                                  type="number"
                                  min={0}
                                  value={action.durationMs}
                                  onChange={(event) => updateAction(index, (current) => current.kind === 'mouseMovePath' ? { ...current, durationMs: Math.max(0, Number(event.target.value) || 0) } : current)}
                                  className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs shadow-sm focus:border-cyan-500 focus:outline-none dark:border-neutral-700 dark:bg-neutral-900"
                                />
                              </label>
                              <label className="space-y-1 text-slate-500 dark:text-slate-400">
                                <span className="font-semibold">轨迹点数量</span>
                                <div className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs text-slate-600 dark:border-neutral-700 dark:bg-neutral-900 dark:text-slate-300">{action.points.length} / 原始 {action.simplifiedFrom}</div>
                              </label>
                            </>
                          ) : null}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="flex items-center justify-between gap-3 pt-2">
                  <div className="flex items-center gap-3">
                    <button
                      type="button"
                      onClick={() => {
                        if (!selectedPreset) return
                        deletePreset(selectedPreset.id)
                      }}
                      className="rounded-full border border-rose-300 px-4 py-2 text-xs font-semibold text-rose-600 transition-colors hover:bg-rose-50 dark:border-rose-700 dark:text-rose-300 dark:hover:bg-rose-900/20"
                    >
                      删除预设
                    </button>
                    {saveHint ? <p className="text-[12px] text-emerald-600 dark:text-emerald-400">{saveHint}</p> : null}
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        if (!selectedPreset) return
                        updatePreset(selectedPreset.id, {
                          name: draft.name,
                          options: draft.options,
                          actions: draft.actions,
                        })
                        setSaveHint('保存成功')
                      }}
                      className="rounded-full border border-slate-300 px-4 py-2 text-xs font-semibold text-slate-700 transition-colors hover:bg-slate-50 dark:border-neutral-700 dark:text-slate-200 dark:hover:bg-neutral-800"
                    >
                      保存修改
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        if (!selectedPreset) return
                        updatePreset(selectedPreset.id, {
                          name: draft.name,
                          options: draft.options,
                          actions: draft.actions,
                        })
                        onStartRecording(selectedPreset.id, draft.options)
                      }}
                      className="rounded-full bg-cyan-600 px-5 py-2 text-xs font-semibold text-white transition-colors hover:bg-cyan-500"
                    >
                      录制键鼠操作
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        </section>
      </div>
    </div>
  )
}
