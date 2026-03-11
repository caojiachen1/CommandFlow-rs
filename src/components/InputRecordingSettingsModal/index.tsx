import { useEffect, useMemo, useState } from 'react'
import { useSettingsStore, type InputRecordingAction, type InputRecordingOptions } from '../../stores/settingsStore'
import InputRecordingVisualizer, { computeRecordingBounds, formatMs, getActionTs } from '../InputRecordingVisualizer'

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

const describeAction = (action: InputRecordingAction): { label: string; cls: string } => {
  switch (action.kind) {
    case 'keyDown':
      return { label: `↓ ${action.key}`, cls: 'text-violet-600 dark:text-violet-400' }
    case 'keyUp':
      return { label: `↑ ${action.key}`, cls: 'text-slate-400 dark:text-slate-500' }
    case 'mouseDown': {
      const btn = action.button === 'right' ? '右键' : action.button === 'middle' ? '中键' : '左键'
      const cls = action.button === 'right'
        ? 'text-rose-600 dark:text-rose-400'
        : action.button === 'middle'
          ? 'text-amber-600 dark:text-amber-400'
          : 'text-cyan-600 dark:text-cyan-400'
      return { label: `↓ ${btn} @ (${action.x}, ${action.y})`, cls }
    }
    case 'mouseUp': {
      const btn = action.button === 'right' ? '右键' : action.button === 'middle' ? '中键' : '左键'
      return { label: `↑ ${btn} @ (${action.x}, ${action.y})`, cls: 'text-slate-400 dark:text-slate-500' }
    }
    case 'mouseWheel': {
      const direction = action.vertical > 0 ? '上滚' : '下滚'
      return {
        label: `⇵ ${direction} ${Math.abs(action.vertical)} @ (${action.x}, ${action.y})`,
        cls: 'text-fuchsia-600 dark:text-fuchsia-400',
      }
    }
    case 'mouseMovePath': {
      const raw = action as any
      const pts: unknown[] = raw.points ?? []
      const distPx = (raw.distancePx ?? raw.distance_px ?? 0) as number
      const durMs = (raw.durationMs ?? raw.duration_ms ?? 0) as number
      return { label: `→ 轨迹 ${pts.length}点 · ${Math.round(distPx)}px · ${durMs}ms`, cls: 'text-emerald-600 dark:text-emerald-400' }
    }
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
  const [clipStartMs, setClipStartMs] = useState(0)
  const [clipEndMs, setClipEndMs] = useState(0)
  const [logExpanded, setLogExpanded] = useState(false)
  /** Actions snapshot saved just before the most-recent applyClip, for one-level undo */
  const [preClipActions, setPreClipActions] = useState<InputRecordingAction[] | null>(null)
  /** Incrementing this signals the Visualizer to reset its internal playback position */
  const [clipResetSignal, setClipResetSignal] = useState(0)

  // ─── Derived recording info ─────────────────────────────────────────────────

  const recordingBounds = useMemo(() => computeRecordingBounds(draft.actions), [draft.actions])
  const totalDurationMs = recordingBounds.durationMs

  // ─── Effects ────────────────────────────────────────────────────────────────

  useEffect(() => {
    if (!open) return
    if (presets.length === 0) {
      setSelectedId('')
      setDraft(EMPTY_DRAFT)
      setClipStartMs(0)
      setClipEndMs(0)
      return
    }

    const current = presets.find((item) => item.id === selectedId) ?? presets[0]
    setSelectedId(current.id)
    setDraft({
      name: current.name,
      options: current.options,
      actions: current.actions,
    })
    setClipStartMs(0)
    setClipEndMs(computeRecordingBounds(current.actions).durationMs)
    setPreClipActions(null)
  }, [open, presets, selectedId])

  useEffect(() => {
    if (!saveHint) return
    const timer = window.setTimeout(() => setSaveHint(''), 2000)
    return () => window.clearTimeout(timer)
  }, [saveHint])

  const selectedPreset = useMemo(
    () => presets.find((item) => item.id === selectedId) ?? null,
    [presets, selectedId],
  )

  // ─── Handlers ───────────────────────────────────────────────────────────────

  const handleClipChange = (startMs: number, endMs: number) => {
    setClipStartMs(startMs)
    setClipEndMs(endMs)
  }

  const applyClip = () => {
    if (draft.actions.length === 0) return
    const recStart = getActionTs(draft.actions[0])
    const absStart = recStart + clipStartMs
    const absEnd = recStart + clipEndMs

    const clipped = draft.actions
      .filter((a) => {
        const aTs = getActionTs(a)
        const endTs =
          a.kind === 'mouseMovePath'
            ? (() => {
                const last = a.points[a.points.length - 1]
                if (last) return (last as any).timestampMs ?? (last as any).timestamp_ms ?? aTs
                const raw = a as any
                return aTs + ((raw.durationMs ?? raw.duration_ms ?? 0) as number)
              })()
            : aTs
        return aTs <= absEnd && endTs >= absStart
      })
      .map((a) => {
        if (a.kind === 'mouseMovePath') {
          const pts = a.points.filter((pt) => {
            const ptTs = (pt as any).timestampMs ?? (pt as any).timestamp_ms ?? 0
            return ptTs >= absStart && ptTs <= absEnd
          })
          if (pts.length < 2) return null
          return { ...a, points: pts } as InputRecordingAction
        }
        return a
      })
      .filter((a): a is InputRecordingAction => a !== null)

    const newDuration = computeRecordingBounds(clipped).durationMs
    // Save undo snapshot BEFORE mutating draft
    setPreClipActions(draft.actions)
    // Update all state in the same event handler so React batches them correctly
    setDraft((prev) => ({ ...prev, actions: clipped }))
    setClipStartMs(0)
    setClipEndMs(newDuration)
    setClipResetSignal((s) => s + 1)
    setSaveHint('已应用时间轴剪辑，请记得保存修改')
  }

  const restoreClip = () => {
    if (!preClipActions) return
    const newDuration = computeRecordingBounds(preClipActions).durationMs
    setDraft((prev) => ({ ...prev, actions: preClipActions }))
    setClipStartMs(0)
    setClipEndMs(newDuration)
    setClipResetSignal((s) => s + 1)
    setPreClipActions(null)
    setSaveHint('已还原剪辑')
  }

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-[360] flex items-center justify-center bg-black/55 backdrop-blur-sm"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div className="flex h-[84vh] w-[1000px] max-w-[95vw] overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl dark:border-neutral-700 dark:bg-neutral-900">

        {/* ── Sidebar: preset list ── */}
        <aside className="flex w-72 shrink-0 flex-col border-r border-slate-200 bg-slate-50/70 dark:border-neutral-800 dark:bg-neutral-900/50">
          <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3 dark:border-neutral-800">
            <h3 className="text-sm font-bold text-slate-700 dark:text-slate-200">键鼠预设</h3>
            <button
              type="button"
              onClick={() => {
                const id = addPreset({ name: `新键鼠预设 ${presets.length + 1}` })
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
                className={`mb-1.5 block w-full rounded-xl border px-3 py-2.5 text-left transition-colors ${
                  preset.id === selectedId
                    ? 'border-cyan-500 bg-cyan-50 text-cyan-700 dark:bg-cyan-900/20 dark:text-cyan-300'
                    : 'border-slate-200 bg-white text-slate-700 hover:border-cyan-300 dark:border-neutral-700 dark:bg-neutral-900 dark:text-slate-300'
                }`}
              >
                <div className="truncate text-xs font-semibold">{preset.name}</div>
                <div className="mt-0.5 text-[10px] text-slate-400 dark:text-slate-500">
                  {preset.actions.length} 个操作
                  {' · '}
                  {formatMs(computeRecordingBounds(preset.actions).durationMs)}
                </div>
              </button>
            ))}
          </div>
        </aside>

        {/* ── Main content ── */}
        <section className="flex min-w-0 flex-1 flex-col">
          {/* Header */}
          <div className="flex shrink-0 items-center justify-between border-b border-slate-200 px-6 py-4 dark:border-neutral-800">
            <div>
              <h3 className="text-sm font-bold text-slate-700 dark:text-slate-200">键鼠录制设置</h3>
              <p className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">
                Scroll Lock 开始 · Alt + Scroll Lock 停止
              </p>
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

          {/* Scrollable body */}
          <div className="flex-1 overflow-y-auto px-6 py-5">
            {!selectedPreset ? (
              <div className="rounded-xl border border-dashed border-slate-300 p-8 text-center text-sm text-slate-400 dark:border-neutral-700">
                请先新建一个键鼠录制预设。
              </div>
            ) : (
              <div className="space-y-5">

                {/* Preset name */}
                <div className="space-y-1.5">
                  <label className="text-[11px] font-semibold text-slate-500 dark:text-slate-400">预设名称</label>
                  <input
                    type="text"
                    value={draft.name}
                    onChange={(event) => setDraft((s) => ({ ...s, name: event.target.value }))}
                    className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm shadow-sm focus:border-cyan-500 focus:outline-none dark:border-neutral-700 dark:bg-neutral-900"
                  />
                </div>

                {/* Recording options */}
                <div className="rounded-2xl border border-slate-200 bg-slate-50/70 p-2 dark:border-neutral-700 dark:bg-neutral-800/40">
                  <h4 className="text-sm font-bold text-slate-700 dark:text-slate-200 ml-2 mt-1">录制内容</h4>
                  <div className="mt-1 space-y-1 text-sm">
                    {(
                      [
                        ['recordKeyboard', '记录键盘操作', '记录按键按下与松开，用于还原快捷键与组合键。'],
                        ['recordMouseClicks', '记录鼠标点击', '记录左键 / 右键 / 中键的按下与松开位置。'],
                        ['recordMouseMoves', '记录鼠标移动轨迹', '自动降采样、平滑处理与特征提取，保留原始轨迹走势。'],
                      ] as const
                    ).map(([key, label, hint]) => (
                      <label
                        key={key}
                        className="flex items-start gap-1 rounded-xl border border-transparent px-1 py-1 pl-2"
                      >
                        <input
                          type="checkbox"
                          checked={draft.options[key as keyof InputRecordingOptions]}
                          onChange={(event) =>
                            setDraft((s) => ({
                              ...s,
                              options: { ...s.options, [key]: event.target.checked },
                            }))
                          }
                          className="mt-0.5 h-4 w-4 rounded border-slate-300 text-cyan-600 focus:ring-cyan-500"
                        />
                        <span>
                          <span className="block text-sm font-semibold text-slate-700 dark:text-slate-200">{label}</span>
                          <span className="mt-0.5 block text-[11px] leading-relaxed text-slate-500 dark:text-slate-400">{hint}</span>
                        </span>
                      </label>
                    ))}
                  </div>
                </div>

                {/* Stats grid */}
                <div className="grid grid-cols-2 gap-4">
                  <div className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-neutral-700 dark:bg-neutral-900/60">
                    <div className="text-[11px] font-semibold text-slate-500 dark:text-slate-400">已保存操作</div>
                    <div className="mt-1.5 text-2xl font-bold text-slate-800 dark:text-slate-100">
                      {draft.actions.length}
                    </div>
                  </div>
                  <div className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-neutral-700 dark:bg-neutral-900/60">
                    <div className="text-[11px] font-semibold text-slate-500 dark:text-slate-400">录制时长</div>
                    <div className="mt-1.5 text-lg font-semibold text-slate-700 dark:text-slate-200">
                      {totalDurationMs > 0 ? formatMs(totalDurationMs) : '—'}
                    </div>
                  </div>
                </div>

                {/* ── Visualization + Timeline ── */}
                <div className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-neutral-700 dark:bg-neutral-900/60">
                  <div className="mb-3 flex items-center justify-between gap-3">
                    <div>
                      <h4 className="text-xs font-bold text-slate-700 dark:text-slate-200">轨迹可视化与时间轴剪辑</h4>
                      <p className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">
                        拖动两侧手柄选定保留区间，点击时间轴或播放预览录制内容。
                      </p>
                    </div>
                    {draft.actions.length > 0 && totalDurationMs > 0 && (
                      <div className="flex shrink-0 items-center gap-2">
                        {preClipActions && (
                          <button
                            type="button"
                            onClick={restoreClip}
                            className="rounded-full border border-amber-300 px-4 py-1.5 text-xs font-semibold text-amber-700 transition-colors hover:bg-amber-50 dark:border-amber-700 dark:text-amber-300 dark:hover:bg-amber-900/20"
                          >
                            还原剪辑
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={applyClip}
                          className="rounded-full border border-cyan-300 px-4 py-1.5 text-xs font-semibold text-cyan-700 transition-colors hover:bg-cyan-50 dark:border-cyan-700 dark:text-cyan-300 dark:hover:bg-cyan-900/20"
                        >
                          应用剪辑
                        </button>
                      </div>
                    )}
                  </div>

                  <InputRecordingVisualizer
                    actions={draft.actions}
                    clipStartMs={clipStartMs}
                    clipEndMs={clipEndMs}
                    onClipChange={handleClipChange}
                    resetSignal={clipResetSignal}
                  />
                </div>

                {/* ── Collapsible action log ── */}
                {draft.actions.length > 0 && (
                  <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white dark:border-neutral-700 dark:bg-neutral-900/60">
                    <button
                      type="button"
                      onClick={() => setLogExpanded((v) => !v)}
                      className="flex w-full items-center justify-between px-4 py-3 text-left transition-colors hover:bg-slate-50/80 dark:hover:bg-neutral-800/50"
                    >
                      <div>
                        <h4 className="text-xs font-bold text-slate-700 dark:text-slate-200">操作列表</h4>
                        <p className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">
                          {draft.actions.length} 个操作记录
                        </p>
                      </div>
                      <svg
                        className={`h-4 w-4 shrink-0 text-slate-400 transition-transform duration-200 ${logExpanded ? 'rotate-180' : ''}`}
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                      >
                        <path d="M6 9l6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    </button>
                    {logExpanded && (
                      <div className="max-h-72 overflow-y-auto border-t border-slate-100 dark:border-neutral-800">
                        <div className="divide-y divide-slate-50 dark:divide-neutral-800">
                          {draft.actions.map((action, index) => {
                            const { label, cls } = describeAction(action)
                            const firstTs = draft.actions[0] ? getActionTs(draft.actions[0]) : 0
                            const relMs = getActionTs(action) - firstTs
                            return (
                              <div
                                key={`${action.kind}-${action.timestampMs}-${index}`}
                                className="flex items-center gap-2.5 px-4 py-1.5 font-mono text-[11px]"
                              >
                                <span className="w-14 shrink-0 tabular-nums text-[10px] text-slate-400 dark:text-slate-500">
                                  {formatMs(relMs)}
                                </span>
                                <span className={`truncate ${cls}`}>{label}</span>
                              </div>
                            )
                          })}
                        </div>
                      </div>
                    )}
                  </div>
                )}

              </div>
            )}
          </div>

          {/* ── Footer actions ── */}
          {selectedPreset && (
            <div className="flex shrink-0 items-center justify-between gap-3 border-t border-slate-200 px-6 py-4 dark:border-neutral-800">
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => deletePreset(selectedPreset.id)}
                  className="rounded-full border border-rose-300 px-4 py-2 text-xs font-semibold text-rose-600 transition-colors hover:bg-rose-50 dark:border-rose-700 dark:text-rose-300 dark:hover:bg-rose-900/20"
                >
                  删除预设
                </button>
                {saveHint && (
                  <p className="text-[12px] text-emerald-600 dark:text-emerald-400">{saveHint}</p>
                )}
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
          )}
        </section>
      </div>
    </div>
  )
}