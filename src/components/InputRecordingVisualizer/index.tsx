import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { InputRecordingAction } from '../../stores/settingsStore'

// ─── Coordinate utilities ──────────────────────────────────────────────────────

interface BBox { minX: number; minY: number; maxX: number; maxY: number }

function computeCoordBbox(actions: InputRecordingAction[]): BBox {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (const a of actions) {
    if (a.kind === 'mouseDown' || a.kind === 'mouseUp') {
      if (a.x < minX) minX = a.x; if (a.y < minY) minY = a.y
      if (a.x > maxX) maxX = a.x; if (a.y > maxY) maxY = a.y
    } else if (a.kind === 'mouseMovePath') {
      for (const p of a.points) {
        if (p.x < minX) minX = p.x; if (p.y < minY) minY = p.y
        if (p.x > maxX) maxX = p.x; if (p.y > maxY) maxY = p.y
      }
    }
  }
  if (!isFinite(minX)) return { minX: 0, minY: 0, maxX: 1920, maxY: 1080 }
  const pw = (maxX - minX) * 0.08 + 24
  const ph = (maxY - minY) * 0.08 + 24
  return { minX: minX - pw, minY: minY - ph, maxX: maxX + pw, maxY: maxY + ph }
}

function worldToCanvas(x: number, y: number, bbox: BBox, W: number, H: number) {
  const bw = bbox.maxX - bbox.minX || 1
  const bh = bbox.maxY - bbox.minY || 1
  const scale = Math.min(W / bw, H / bh)
  const ox = (W - bw * scale) / 2
  const oy = (H - bh * scale) / 2
  return { cx: ox + (x - bbox.minX) * scale, cy: oy + (y - bbox.minY) * scale }
}

/** blue (early) → red (late) gradient */
function timeColor(t: number, alpha = 0.72) {
  const h = (1 - Math.max(0, Math.min(1, t))) * 220
  return `hsla(${h},85%,60%,${alpha})`
}

// ─── Recording bounds ──────────────────────────────────────────────────────────

export function computeRecordingBounds(actions: InputRecordingAction[]) {
  if (actions.length === 0) return { startMs: 0, endMs: 0, durationMs: 0 }
  const startMs = getActionTs(actions[0])
  let endMs = startMs
  for (const a of actions) {
    const ts = getActionTs(a)
    if (a.kind === 'mouseMovePath') {
      const last = a.points[a.points.length - 1]
      const lastTs = last
        ? ((last as any).timestampMs ?? (last as any).timestamp_ms ?? ts)
        : ts + getMovePathFields(a).durationMs
      if (lastTs > endMs) endMs = lastTs
    } else {
      if (ts > endMs) endMs = ts
    }
  }
  return { startMs, endMs, durationMs: Math.max(0, endMs - startMs) }
}

export function formatMs(ms: number) {
  if (!isFinite(ms) || isNaN(ms)) return '—'
  if (ms < 1000) return `${Math.round(ms)}ms`
  return `${(ms / 1000).toFixed(2)}s`
}

/**
 * Safely read an action's timestamp, handling both camelCase (serde rename_all
 * on struct fields) and snake_case (serde rename_all on enum-level only).
 */
export function getActionTs(a: InputRecordingAction): number {
  return (a as any).timestampMs ?? (a as any).timestamp_ms ?? 0
}

/** Same fallback for mouseMovePath-specific fields */
function getMovePathFields(a: Extract<InputRecordingAction, { kind: 'mouseMovePath' }>) {
  const raw = a as any
  return {
    durationMs: (raw.durationMs ?? raw.duration_ms ?? 0) as number,
    distancePx: (raw.distancePx ?? raw.distance_px ?? 0) as number,
    simplifiedFrom: (raw.simplifiedFrom ?? raw.simplified_from ?? 0) as number,
  }
}

// ─── Playback state ────────────────────────────────────────────────────────────

interface ActiveState {
  cursorX: number | null
  cursorY: number | null
  activeKeys: string[]
  activeMouseButtons: string[]
}

function getStateAt(actions: InputRecordingAction[], startMs: number, relMs: number): ActiveState {
  const absMs = startMs + relMs
  let cursorX: number | null = null
  let cursorY: number | null = null
  const keyState = new Map<string, boolean>()
  const mouseState = new Map<string, boolean>()

  for (const a of actions) {
    const aTs = getActionTs(a)
    if (aTs > absMs) break
    if (a.kind === 'keyDown') {
      keyState.set(a.key, true)
    } else if (a.kind === 'keyUp') {
      keyState.delete(a.key)
    } else if (a.kind === 'mouseDown') {
      mouseState.set(a.button, true)
      cursorX = a.x; cursorY = a.y
    } else if (a.kind === 'mouseUp') {
      mouseState.delete(a.button)
      cursorX = a.x; cursorY = a.y
    } else if (a.kind === 'mouseMovePath') {
      let bestPt = a.points[0] ?? null
      for (const pt of a.points) {
        const ptTs = (pt as any).timestampMs ?? (pt as any).timestamp_ms ?? 0
        if (ptTs <= absMs) bestPt = pt
        else break
      }
      if (bestPt) { cursorX = bestPt.x; cursorY = bestPt.y }
    }
  }

  return {
    cursorX, cursorY,
    activeKeys: [...keyState.keys()],
    activeMouseButtons: [...mouseState.keys()],
  }
}

// ─── Timeline sub-component ────────────────────────────────────────────────────

function abbreviateKey(key: string): string {
  const m: Record<string, string> = {
    Left: '←', Right: '→', Up: '↑', Down: '↓',
    Return: '↵', Enter: '↵', Space: '␣', Back: '⌫', Delete: '⌦',
    Escape: 'ESC', Tab: '⇥', Capital: 'CAP', ScrollLock: 'ScLk',
    LShift: '⇧', RShift: '⇧', Shift: '⇧',
    LControl: '⌃', RControl: '⌃', Control: '⌃',
    LAlt: '⌥', RAlt: '⌥', Alt: '⌥',
    LWin: '⊞', RWin: '⊞',
    Prior: 'PgUp', Next: 'PgDn', Home: 'Home', End: 'End', Insert: 'Ins',
    Snapshot: 'PrtSc', Pause: '⏸',
  }
  return m[key] ?? (key.length > 5 ? key.slice(0, 4) + '…' : key)
}

interface TimelineProps {
  durationMs: number
  clipStartMs: number
  clipEndMs: number
  currentMs: number
  actions: InputRecordingAction[]
  recordingStartMs: number
  onClipChange: (s: number, e: number) => void
  onScrub: (ms: number) => void
}

function Timeline({ durationMs, clipStartMs, clipEndMs, currentMs, actions, recordingStartMs, onClipChange, onScrub }: TimelineProps) {
  const trackRef = useRef<HTMLDivElement>(null)
  const [dragging, setDragging] = useState<'clipStart' | 'clipEnd' | 'scrubber' | null>(null)

  const clipStartRef = useRef(clipStartMs)
  const clipEndRef = useRef(clipEndMs)
  useEffect(() => { clipStartRef.current = clipStartMs }, [clipStartMs])
  useEffect(() => { clipEndRef.current = clipEndMs }, [clipEndMs])

  const toPercent = (ms: number) =>
    durationMs > 0 ? `${((ms / durationMs) * 100).toFixed(3)}%` : '0%'

  const msFromClientX = useCallback((clientX: number) => {
    const rect = trackRef.current?.getBoundingClientRect()
    if (!rect || rect.width === 0) return 0
    return Math.max(0, Math.min(durationMs, ((clientX - rect.left) / rect.width) * durationMs))
  }, [durationMs])

  useEffect(() => {
    if (!dragging) return
    const onMove = (e: MouseEvent) => {
      const ms = msFromClientX(e.clientX)
      if (dragging === 'clipStart') {
        onClipChange(Math.min(ms, clipEndRef.current - 50), clipEndRef.current)
      } else if (dragging === 'clipEnd') {
        onClipChange(clipStartRef.current, Math.max(ms, clipStartRef.current + 50))
      } else {
        onScrub(ms)
      }
    }
    const onUp = () => setDragging(null)
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
  }, [dragging, msFromClientX, onClipChange, onScrub])

  const handleTrackClick = (e: React.MouseEvent) => {
    if (dragging) return
    onScrub(msFromClientX(e.clientX))
  }

  // Collect event marks
  const clickMarks = useMemo(() =>
    actions.flatMap((a, i) => {
      if (a.kind !== 'mouseDown') return []
      const rel = getActionTs(a) - recordingStartMs
      const btn = a.button
      const color = btn === 'right' ? '#fb7185' : btn === 'middle' ? '#fbbf24' : '#60a5fa'
      return [{ key: `m${i}`, rel, color, type: 'mouse' as const }]
    }), [actions, recordingStartMs])

  const keyMarks = useMemo(() =>
    actions.flatMap((a, i) => {
      if (a.kind !== 'keyDown') return []
      const rel = getActionTs(a) - recordingStartMs
      return [{ key: `k${i}`, rel, name: abbreviateKey(a.key), fullName: a.key }]
    }), [actions, recordingStartMs])

  return (
    <div className="space-y-1.5">
      {/* Track */}
      <div
        ref={trackRef}
        className="relative h-10 cursor-pointer select-none overflow-hidden rounded-xl bg-slate-100 dark:bg-neutral-800"
        onClick={handleTrackClick}
      >
        {/* Out-of-clip dimming left */}
        <div
          className="pointer-events-none absolute inset-y-0 left-0 bg-slate-300/60 dark:bg-neutral-600/60"
          style={{ width: toPercent(clipStartMs) }}
        />
        {/* Clip region tint */}
        <div
          className="pointer-events-none absolute inset-y-0 border-x-2 border-cyan-500/50 bg-cyan-500/8"
          style={{ left: toPercent(clipStartMs), right: `calc(100% - ${toPercent(clipEndMs)})` }}
        />
        {/* Out-of-clip dimming right */}
        <div
          className="pointer-events-none absolute inset-y-0 right-0 bg-slate-300/60 dark:bg-neutral-600/60"
          style={{ width: `calc(100% - ${toPercent(clipEndMs)})` }}
        />

        {/* Mouse click marks — full-height bars */}
        {clickMarks.map(({ key, rel, color }) => (
          <div
            key={key}
            className="pointer-events-none absolute inset-y-0 w-px"
            style={{ left: toPercent(rel), background: color, opacity: 0.75 }}
          />
        ))}
        {/* Clip start handle */}
        <div
          className="absolute inset-y-0 z-20 flex cursor-col-resize items-center"
          style={{ left: toPercent(clipStartMs), transform: 'translateX(-50%)' }}
          onMouseDown={(e) => { e.stopPropagation(); setDragging('clipStart') }}
        >
          <div className="flex h-full w-4 items-center justify-center rounded-sm bg-cyan-500 shadow-md">
            <svg className="h-3 w-3 text-white" viewBox="0 0 10 12" fill="currentColor">
              <polygon points="7,1 3,6 7,11" />
            </svg>
          </div>
        </div>

        {/* Clip end handle */}
        <div
          className="absolute inset-y-0 z-20 flex cursor-col-resize items-center"
          style={{ left: toPercent(clipEndMs), transform: 'translateX(-50%)' }}
          onMouseDown={(e) => { e.stopPropagation(); setDragging('clipEnd') }}
        >
          <div className="flex h-full w-4 items-center justify-center rounded-sm bg-cyan-500 shadow-md">
            <svg className="h-3 w-3 text-white" viewBox="0 0 10 12" fill="currentColor">
              <polygon points="3,1 7,6 3,11" />
            </svg>
          </div>
        </div>

        {/* Playback scrubber */}
        <div
          className="absolute inset-y-0 z-30 flex cursor-col-resize items-center"
          style={{ left: toPercent(currentMs), transform: 'translateX(-50%)' }}
          onMouseDown={(e) => { e.stopPropagation(); setDragging('scrubber') }}
        >
          <div className="relative h-full w-0.5 bg-white/85 shadow-md">
            <div className="absolute -top-0.5 left-1/2 h-3 w-3 -translate-x-1/2 rounded-full border-2 border-white bg-cyan-400 shadow-lg" />
          </div>
        </div>
      </div>

      {/* Keyboard events row */}
      {keyMarks.length > 0 && (
        <div
          className="relative h-6 cursor-pointer select-none overflow-hidden rounded-lg border border-violet-100 bg-violet-50/60 dark:border-violet-900/30 dark:bg-violet-950/20"
          onClick={(e) => { onScrub(msFromClientX(e.clientX)) }}
        >
          {/* Out-of-clip dimming left */}
          <div
            className="pointer-events-none absolute inset-y-0 left-0 bg-slate-300/50 dark:bg-neutral-600/50"
            style={{ width: toPercent(clipStartMs) }}
          />
          {/* Out-of-clip dimming right */}
          <div
            className="pointer-events-none absolute inset-y-0 right-0 bg-slate-300/50 dark:bg-neutral-600/50"
            style={{ width: `calc(100% - ${toPercent(clipEndMs)})` }}
          />
          {keyMarks.map(({ key, rel, name, fullName }) => (
            <div
              key={key}
              className="absolute inset-y-0 flex flex-col items-center"
              style={{ left: toPercent(rel), transform: 'translateX(-50%)' }}
              title={`${fullName} @ ${formatMs(rel)}`}
            >
              <div className="h-full w-px bg-violet-400/75" />
              {keyMarks.length <= 60 && (
                <span className="pointer-events-none absolute top-0.5 z-10 max-w-[30px] truncate rounded bg-violet-200/90 px-0.5 text-[8px] font-mono leading-[12px] text-violet-800 dark:bg-violet-800/80 dark:text-violet-200">
                  {name}
                </span>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Legend row */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3 text-[10px] text-slate-400 dark:text-slate-500">
          <span className="flex items-center gap-1"><span className="inline-block h-2.5 w-0.5 rounded-full bg-cyan-400 opacity-75" />鼠标点击</span>
          <span className="flex items-center gap-1"><span className="inline-block h-2 w-0.5 rounded-full bg-violet-400 opacity-65" />键盘按键</span>
        </div>
        <div className="flex items-center gap-3 text-[10px] font-medium">
          <span className="text-slate-400 dark:text-slate-500">
            区间 <span className="tabular-nums text-cyan-600 dark:text-cyan-400">{formatMs(clipStartMs)}</span>
            {' – '}
            <span className="tabular-nums text-cyan-600 dark:text-cyan-400">{formatMs(clipEndMs)}</span>
          </span>
          <span className="tabular-nums text-slate-600 dark:text-slate-300">
            {formatMs(currentMs)}
          </span>
        </div>
      </div>
    </div>
  )
}

// ─── Main Visualizer ───────────────────────────────────────────────────────────

export interface VisualizerProps {
  actions: InputRecordingAction[]
  clipStartMs: number
  clipEndMs: number
  onClipChange: (startMs: number, endMs: number) => void
  /** Increment this value to reset playback position to 0 (e.g. after applying a clip) */
  resetSignal?: number
}

export default function InputRecordingVisualizer({ actions, clipStartMs, clipEndMs, onClipChange, resetSignal }: VisualizerProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const heatmapRef = useRef<HTMLCanvasElement>(null)
  const overlayRef = useRef<HTMLCanvasElement>(null)

  const bounds = useMemo(() => computeRecordingBounds(actions), [actions])
  const bbox = useMemo(() => computeCoordBbox(actions), [actions])

  const [currentMs, setCurrentMs] = useState(0)
  const [isPlaying, setIsPlaying] = useState(false)
  const [speed, setSpeed] = useState(1)

  const animRef = useRef<number>(0)
  const lastTickRef = useRef<number>(0)
  const speedRef = useRef(speed)
  const currentMsRef = useRef(currentMs)
  const clipEndMsRef = useRef(clipEndMs)
  const clipStartMsRef = useRef(clipStartMs)

  useEffect(() => { speedRef.current = speed }, [speed])
  useEffect(() => { currentMsRef.current = currentMs }, [currentMs])
  useEffect(() => { clipEndMsRef.current = clipEndMs }, [clipEndMs])
  useEffect(() => { clipStartMsRef.current = clipStartMs }, [clipStartMs])

  // ─── Canvas: heatmap ─────────────────────────────────────────────────────────

  const drawHeatmap = useCallback(() => {
    const canvas = heatmapRef.current
    if (!canvas || canvas.width === 0) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const W = canvas.width
    const H = canvas.height
    const isDark = document.documentElement.classList.contains('dark')

    ctx.clearRect(0, 0, W, H)
    ctx.fillStyle = isDark ? '#1e293b' : '#d1d5db'
    ctx.fillRect(0, 0, W, H)

    // Subtle grid
    ctx.strokeStyle = isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.08)'
    ctx.lineWidth = 1
    for (let x = 0; x < W; x += 50) {
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke()
    }
    for (let y = 0; y < H; y += 50) {
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke()
    }

    if (actions.length === 0) return

    // Draw mouse paths
    ctx.save()
    for (const a of actions) {
      if (a.kind !== 'mouseMovePath' || a.points.length < 2) continue
      const relStart = getActionTs(a) - bounds.startMs
      const inClip = relStart >= clipStartMs && relStart <= clipEndMs

      for (let i = 1; i < a.points.length; i++) {
        const p0 = a.points[i - 1]
        const p1 = a.points[i]
        const p1ts = (p1 as any).timestampMs ?? (p1 as any).timestamp_ms ?? 0
        const t = bounds.durationMs > 0 ? (p1ts - bounds.startMs) / bounds.durationMs : 0
        const c0 = worldToCanvas(p0.x, p0.y, bbox, W, H)
        const c1 = worldToCanvas(p1.x, p1.y, bbox, W, H)

        ctx.strokeStyle = timeColor(t, inClip ? 0.95 : 0.28)
        ctx.lineWidth = inClip ? 3 : 1.5
        ctx.lineCap = 'round'
        ctx.lineJoin = 'round'
        if (inClip) {
          ctx.shadowColor = timeColor(t, 0.55)
          ctx.shadowBlur = 6
        } else {
          ctx.shadowBlur = 0
        }
        ctx.beginPath()
        ctx.moveTo(c0.cx, c0.cy)
        ctx.lineTo(c1.cx, c1.cy)
        ctx.stroke()
      }
    }
    ctx.shadowBlur = 0
    ctx.restore()

    // Draw click markers — solid colored dots
    for (const a of actions) {
      if (a.kind !== 'mouseDown') continue
      const { cx, cy } = worldToCanvas(a.x, a.y, bbox, W, H)
      const relTs = getActionTs(a) - bounds.startMs
      const inClip = relTs >= clipStartMs && relTs <= clipEndMs
      const alpha = inClip ? 1 : 0.28
      const btn = a.button
      // left=blue, right=red, middle=amber
      const [h, s, l] = btn === 'right' ? [4, 90, 58] : btn === 'middle' ? [38, 92, 58] : [217, 90, 62]
      // Outer pulse ring (subtle)
      if (inClip) {
        ctx.beginPath()
        ctx.arc(cx, cy, 9, 0, Math.PI * 2)
        ctx.strokeStyle = `hsla(${h},${s}%,${l}%,0.35)`
        ctx.lineWidth = 1.5
        ctx.stroke()
      }
      // Filled dot
      ctx.beginPath()
      ctx.arc(cx, cy, 5, 0, Math.PI * 2)
      ctx.fillStyle = `hsla(${h},${s}%,${l}%,${alpha})`
      if (inClip) {
        ctx.shadowColor = `hsla(${h},${s}%,${l}%,0.75)`
        ctx.shadowBlur = 10
      }
      ctx.fill()
      ctx.shadowBlur = 0
    }
  }, [actions, bbox, bounds, clipStartMs, clipEndMs])

  // ─── Canvas: overlay (playback cursor) ───────────────────────────────────────

  const drawOverlay = useCallback((relMs: number) => {
    const canvas = overlayRef.current
    if (!canvas || canvas.width === 0) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const W = canvas.width
    const H = canvas.height
    ctx.clearRect(0, 0, W, H)

    const { cursorX, cursorY } = getStateAt(actions, bounds.startMs, relMs)
    if (cursorX === null || cursorY === null) return

    const { cx, cy } = worldToCanvas(cursorX, cursorY, bbox, W, H)

    // Outer ring
    ctx.beginPath()
    ctx.arc(cx, cy, 9, 0, Math.PI * 2)
    ctx.strokeStyle = 'rgba(255,255,255,0.65)'
    ctx.lineWidth = 1.5
    ctx.stroke()

    // Inner filled dot with cyan glow
    ctx.beginPath()
    ctx.arc(cx, cy, 4.5, 0, Math.PI * 2)
    ctx.fillStyle = 'rgba(255,255,255,0.95)'
    ctx.shadowColor = 'rgba(34,211,238,0.95)'
    ctx.shadowBlur = 14
    ctx.fill()
    ctx.shadowBlur = 0
  }, [actions, bbox, bounds])

  // ─── Resize handler ───────────────────────────────────────────────────────────

  const resizeCanvases = useCallback(() => {
    const container = containerRef.current
    const hc = heatmapRef.current
    const oc = overlayRef.current
    if (!container || !hc || !oc) return
    const { width, height } = container.getBoundingClientRect()
    if (width === 0 || height === 0) return
    const w = Math.round(width)
    const h = Math.round(height)
    if (hc.width === w && hc.height === h) return
    hc.width = w; hc.height = h
    oc.width = w; oc.height = h
    drawHeatmap()
    drawOverlay(currentMsRef.current)
  }, [drawHeatmap, drawOverlay])

  useEffect(() => {
    resizeCanvases()
    const ro = new ResizeObserver(resizeCanvases)
    if (containerRef.current) ro.observe(containerRef.current)
    return () => ro.disconnect()
  }, [resizeCanvases])

  useEffect(() => {
    const hc = heatmapRef.current
    if (hc && hc.width > 0) drawHeatmap()
  }, [drawHeatmap])

  useEffect(() => {
    const oc = overlayRef.current
    if (oc && oc.width > 0) drawOverlay(currentMs)
  }, [drawOverlay, currentMs])

  // ─── Playback loop ────────────────────────────────────────────────────────────

  useEffect(() => {
    if (!isPlaying) {
      cancelAnimationFrame(animRef.current)
      return
    }
    lastTickRef.current = performance.now()
    const tick = () => {
      const now = performance.now()
      const delta = (now - lastTickRef.current) * speedRef.current
      lastTickRef.current = now
      setCurrentMs((prev) => {
        const next = prev + delta
        if (next >= clipEndMsRef.current) {
          setIsPlaying(false)
          return clipEndMsRef.current
        }
        return next
      })
      animRef.current = requestAnimationFrame(tick)
    }
    animRef.current = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(animRef.current)
  }, [isPlaying])

  // Reset playback position when clip range changes externally
  useEffect(() => {
    setCurrentMs((prev) => Math.max(clipStartMs, Math.min(prev, clipEndMs)))
  }, [clipStartMs, clipEndMs])

  // Hard-reset playback to start when caller signals a clip was applied
  const prevResetSignalRef = useRef(resetSignal ?? 0)
  useEffect(() => {
    if (resetSignal === undefined) return
    if (resetSignal !== prevResetSignalRef.current) {
      prevResetSignalRef.current = resetSignal
      setIsPlaying(false)
      setCurrentMs(0)
      // Explicitly redraw heatmap so canvas reflects the new (restored/clipped) actions immediately
      const hc = heatmapRef.current
      if (hc && hc.width > 0) drawHeatmap()
    }
  }, [resetSignal, drawHeatmap])

  // ─── Controls ─────────────────────────────────────────────────────────────────

  const handlePlayPause = () => {
    if (Math.round(currentMs) >= Math.round(clipEndMs)) {
      setCurrentMs(clipStartMs)
    }
    setIsPlaying((v) => !v)
  }

  const handleStop = () => {
    setIsPlaying(false)
    setCurrentMs(clipStartMs)
  }

  const activeState = useMemo(
    () => getStateAt(actions, bounds.startMs, currentMs),
    [actions, bounds.startMs, currentMs],
  )

  const hasMouseData = actions.some((a) => a.kind === 'mouseDown' || a.kind === 'mouseMovePath')
  const hasData = actions.length > 0

  return (
    <div className="space-y-3">
      {/* ── Heatmap canvas ── */}
      <div
        ref={containerRef}
        className="relative w-full overflow-hidden rounded-xl border border-slate-200 dark:border-neutral-700"
        style={{ height: 220 }}
      >
        <canvas ref={heatmapRef} className="absolute inset-0" />
        <canvas ref={overlayRef} className="absolute inset-0" />

        {!hasData && (
          <div className="absolute inset-0 flex items-center justify-center">
            <p className="text-[12px] text-slate-400 dark:text-slate-500 italic">暂无录制数据</p>
          </div>
        )}

        {hasData && !hasMouseData && (
          <div className="absolute inset-0 flex items-center justify-center">
            <p className="text-[11px] text-slate-400 dark:text-slate-500">仅含键盘事件，无鼠标轨迹</p>
          </div>
        )}

        {/* Legend */}
        {hasMouseData && (
          <div className="absolute right-2.5 top-2.5 flex flex-col gap-1.5 rounded-xl border border-white/10 bg-black/50 px-2.5 py-2 text-[10px] font-medium text-white backdrop-blur-sm">
            <div className="flex items-center gap-1.5">
              <span className="inline-block h-2 w-2 rounded-full bg-cyan-400" />左键
            </div>
            <div className="flex items-center gap-1.5">
              <span className="inline-block h-2 w-2 rounded-full bg-rose-400" />右键
            </div>
            <div className="flex items-center gap-1.5">
              <span className="inline-block h-2 w-2 rounded-full bg-amber-400" />中键
            </div>
            <div className="flex items-center gap-1.5">
              <span
                className="inline-block h-1.5 w-5 rounded-sm"
                style={{ background: 'linear-gradient(to right, hsl(220,85%,60%), hsl(0,85%,60%))' }}
              />
              早 → 晚
            </div>
          </div>
        )}
      </div>

      {/* ── Timeline ── */}
      {(bounds.durationMs > 0 || actions.length >= 2) && (
        <Timeline
          durationMs={Math.max(bounds.durationMs, 1)}
          clipStartMs={clipStartMs}
          clipEndMs={clipEndMs}
          currentMs={currentMs}
          actions={actions}
          recordingStartMs={bounds.startMs}
          onClipChange={onClipChange}
          onScrub={(ms) => { setCurrentMs(ms); setIsPlaying(false) }}
        />
      )}

      {/* ── Playback controls ── */}
      {(bounds.durationMs > 0 || actions.length >= 2) && (
        <div className="flex items-center gap-2">
          {/* Play / Pause */}
          <button
            type="button"
            onClick={handlePlayPause}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-cyan-600 text-white transition-colors hover:bg-cyan-500 active:scale-95"
          >
            {isPlaying ? (
              <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="currentColor">
                <rect x="6" y="4" width="4" height="16" rx="1" />
                <rect x="14" y="4" width="4" height="16" rx="1" />
              </svg>
            ) : (
              <svg className="h-3.5 w-3.5 translate-x-px" viewBox="0 0 24 24" fill="currentColor">
                <path d="M8 5v14l11-7z" />
              </svg>
            )}
          </button>

          {/* Stop */}
          <button
            type="button"
            onClick={handleStop}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-slate-200 text-slate-600 transition-colors hover:bg-slate-50 dark:border-neutral-700 dark:text-slate-300 dark:hover:bg-neutral-800"
          >
            <svg className="h-3 w-3" viewBox="0 0 24 24" fill="currentColor">
              <rect x="6" y="6" width="12" height="12" rx="1.5" />
            </svg>
          </button>

          {/* Speed selector */}
          <div className="ml-2 flex items-center gap-1">
            <span className="text-[11px] text-slate-400 dark:text-slate-500">速度</span>
            {([0.5, 1, 2, 4] as const).map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setSpeed(s)}
                className={`rounded-full px-2.5 py-0.5 text-[11px] font-semibold transition-colors ${
                  speed === s
                    ? 'bg-cyan-600 text-white'
                    : 'border border-slate-200 text-slate-500 hover:border-cyan-300 dark:border-neutral-700 dark:text-slate-400 dark:hover:border-cyan-700'
                }`}
              >
                {s}×
              </button>
            ))}
          </div>

          {/* Time display */}
          <span className="ml-auto tabular-nums text-[11px] text-slate-500 dark:text-slate-400">
            {formatMs(currentMs)}
            <span className="mx-1 opacity-40">/</span>
            {formatMs(bounds.durationMs)}
          </span>
        </div>
      )}

      {/* ── Active key / mouse button display ── */}
      {(activeState.activeKeys.length > 0 || activeState.activeMouseButtons.length > 0) && (
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-slate-200 bg-slate-50/80 px-3 py-2 dark:border-neutral-700 dark:bg-neutral-900/50">
          <span className="mr-0.5 text-[10px] font-bold uppercase tracking-wide text-slate-400 dark:text-slate-500">
            实时按键
          </span>
          {activeState.activeMouseButtons.map((btn) => {
            const cls =
              btn === 'right'
                ? 'border-rose-300 bg-rose-100 text-rose-700 dark:border-rose-700 dark:bg-rose-900/30 dark:text-rose-300'
                : btn === 'middle'
                  ? 'border-amber-300 bg-amber-100 text-amber-700 dark:border-amber-700 dark:bg-amber-900/30 dark:text-amber-300'
                  : 'border-cyan-300 bg-cyan-100 text-cyan-700 dark:border-cyan-700 dark:bg-cyan-900/30 dark:text-cyan-300'
            return (
              <span key={btn} className={`rounded-md border px-2 py-0.5 text-[11px] font-mono font-semibold ${cls}`}>
                {btn === 'left' ? 'M-L' : btn === 'right' ? 'M-R' : 'M-M'}
              </span>
            )
          })}
          {activeState.activeKeys.map((key) => (
            <span
              key={key}
              className="rounded-md border border-slate-200 bg-white px-2 py-0.5 text-[11px] font-mono font-semibold text-slate-700 shadow-sm dark:border-neutral-600 dark:bg-neutral-800 dark:text-slate-200"
            >
              {key}
            </span>
          ))}
        </div>
      )}
    </div>
  )
}
