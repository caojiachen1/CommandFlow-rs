import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react'
import type { InputRecordingAction } from '../../stores/settingsStore'
import { computeRecordingBounds, formatMs, getActionTs } from '../InputRecordingVisualizer'

interface InputRecordingTimelineEditorProps {
  open: boolean
  actions: InputRecordingAction[]
  clipStartMs: number
  clipEndMs: number
  onActionsChange: (nextActions: InputRecordingAction[]) => void
  onClipChange: (startMs: number, endMs: number) => void
  onSave: () => void
  onClose: () => void
}

type EditorDragMode = 'clipStart' | 'clipEnd' | 'scrubber' | null
type ActionKind = InputRecordingAction['kind']

interface CursorPoint {
  x: number
  y: number
  timestampMs: number
}

interface TimelineEventView {
  sourceIndex: number
  kind: ActionKind
  relMs: number
  colorClass: string
  summary: string
}

interface CoordBbox {
  minX: number
  minY: number
  maxX: number
  maxY: number
}

const LABEL_WIDTH = 108
const RULER_HEIGHT = 30
const LANE_HEIGHT = 46
const MIN_CLIP_WINDOW_MS = 50
const PREVIEW_MIN_SCALE = 0.3
const PREVIEW_MAX_SCALE = 120
const TIMELINE_MAX_ZOOM_PX_PER_SEC = 5000
const COMPACT_EDITOR_INPUT_CLASS =
  'h-6 w-full rounded-md border border-slate-300 bg-white px-1.5 py-0 text-[10px] text-slate-700 dark:border-neutral-700 dark:bg-neutral-900 dark:text-slate-200'
const COMPACT_EDITOR_POINT_INPUT_CLASS =
  'h-6 rounded border border-slate-300 bg-white px-1 py-0 text-[10px] dark:border-neutral-700 dark:bg-neutral-900'
const COMPACT_EDITOR_TEXTAREA_CLASS =
  'h-28 w-full rounded-md border border-slate-300 bg-slate-50 px-1.5 py-1 font-mono text-[10px] text-slate-700 outline-none focus:border-cyan-500 dark:border-neutral-700 dark:bg-neutral-950 dark:text-slate-200'

const laneDefs: Array<{ kind: ActionKind; label: string }> = [
  { kind: 'mouseMovePath', label: '轨迹段' },
  { kind: 'mouseDown', label: '鼠标按下' },
  { kind: 'mouseUp', label: '鼠标抬起' },
  { kind: 'mouseWheel', label: '滚轮' },
  { kind: 'keyDown', label: '按键按下' },
  { kind: 'keyUp', label: '按键抬起' },
]

const laneIndexByKind: Record<ActionKind, number> = {
  mouseMovePath: 0,
  mouseDown: 1,
  mouseUp: 2,
  mouseWheel: 3,
  keyDown: 4,
  keyUp: 5,
}

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value))

const toFiniteNumber = (value: unknown, fallback = 0) => {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string') {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) return parsed
  }
  return fallback
}

const getPointTs = (point: unknown): number => {
  const raw = point as Record<string, unknown>
  return toFiniteNumber(raw.timestampMs ?? raw.timestamp_ms, 0)
}

const normalizeMovePath = (
  action: Extract<InputRecordingAction, { kind: 'mouseMovePath' }>,
): Extract<InputRecordingAction, { kind: 'mouseMovePath' }> => {
  const points = (action.points ?? [])
    .map((point) => ({
      x: toFiniteNumber(point.x, 0),
      y: toFiniteNumber(point.y, 0),
      timestampMs: getPointTs(point),
    }))
    .sort((a, b) => a.timestampMs - b.timestampMs)

  let distancePx = 0
  for (let index = 1; index < points.length; index += 1) {
    const prev = points[index - 1]
    const current = points[index]
    const dx = current.x - prev.x
    const dy = current.y - prev.y
    distancePx += Math.hypot(dx, dy)
  }

  const durationMs =
    points.length >= 2
      ? Math.max(0, points[points.length - 1].timestampMs - points[0].timestampMs)
      : 0

  return {
    ...action,
    points,
    durationMs,
    distancePx: Number(distancePx.toFixed(2)),
    simplifiedFrom: Math.max(action.simplifiedFrom ?? points.length, points.length),
    timestampMs:
      points.length > 0
        ? Math.min(toFiniteNumber(action.timestampMs, points[0].timestampMs), points[0].timestampMs)
        : toFiniteNumber(action.timestampMs, 0),
  }
}

const summarizeAction = (action: InputRecordingAction): string => {
  switch (action.kind) {
    case 'keyDown':
      return `按下 ${action.key}`
    case 'keyUp':
      return `抬起 ${action.key}`
    case 'mouseDown':
      return `${action.button} @ (${Math.round(action.x)}, ${Math.round(action.y)})`
    case 'mouseUp':
      return `${action.button} @ (${Math.round(action.x)}, ${Math.round(action.y)})`
    case 'mouseWheel':
      return `${action.vertical > 0 ? '上滚' : '下滚'} ${Math.abs(action.vertical)} @ (${Math.round(action.x)}, ${Math.round(action.y)})`
    case 'mouseMovePath':
      return `轨迹 ${action.points.length} 点 · ${Math.round(action.distancePx)}px`
  }
}

const colorClassForKind = (kind: ActionKind): string => {
  switch (kind) {
    case 'keyDown':
      return 'bg-violet-500 border-violet-200 text-violet-700'
    case 'keyUp':
      return 'bg-violet-300 border-violet-200 text-violet-700'
    case 'mouseDown':
      return 'bg-cyan-500 border-cyan-200 text-cyan-700'
    case 'mouseUp':
      return 'bg-cyan-300 border-cyan-200 text-cyan-700'
    case 'mouseWheel':
      return 'bg-fuchsia-500 border-fuchsia-200 text-fuchsia-700'
    case 'mouseMovePath':
      return 'bg-emerald-500 border-emerald-200 text-emerald-700'
    default:
      return 'bg-slate-400 border-slate-200 text-slate-600'
  }
}

const sortActionsByTimestamp = (actions: InputRecordingAction[]) =>
  [...actions].sort((a, b) => getActionTs(a) - getActionTs(b))

const createDefaultAction = (
  kind: ActionKind,
  timestampMs: number,
): InputRecordingAction => {
  const ts = Math.max(0, Math.round(timestampMs))
  switch (kind) {
    case 'keyDown':
      return { kind, key: 'A', timestampMs: ts }
    case 'keyUp':
      return { kind, key: 'A', timestampMs: ts }
    case 'mouseDown':
      return { kind, button: 'left', x: 960, y: 540, timestampMs: ts }
    case 'mouseUp':
      return { kind, button: 'left', x: 960, y: 540, timestampMs: ts }
    case 'mouseWheel':
      return { kind, x: 960, y: 540, vertical: -120, timestampMs: ts }
    case 'mouseMovePath':
      return {
        kind,
        timestampMs: ts,
        durationMs: 300,
        distancePx: 320,
        simplifiedFrom: 2,
        points: [
          { x: 640, y: 360, timestampMs: ts },
          { x: 960, y: 540, timestampMs: ts + 300 },
        ],
      }
    default:
      return { kind: 'keyDown', key: 'A', timestampMs: ts }
  }
}

const parseActionFromJson = (value: unknown): InputRecordingAction | null => {
  if (!value || typeof value !== 'object') return null
  const raw = value as Record<string, unknown>
  const kind = raw.kind
  if (kind !== 'keyDown' && kind !== 'keyUp' && kind !== 'mouseDown' && kind !== 'mouseUp' && kind !== 'mouseWheel' && kind !== 'mouseMovePath') {
    return null
  }

  const timestampMs = Math.max(0, Math.round(toFiniteNumber(raw.timestampMs ?? raw.timestamp_ms, 0)))

  if (kind === 'keyDown' || kind === 'keyUp') {
    return {
      kind,
      key: String(raw.key ?? ''),
      timestampMs,
    }
  }

  if (kind === 'mouseDown' || kind === 'mouseUp') {
    return {
      kind,
      button: String(raw.button ?? 'left'),
      x: toFiniteNumber(raw.x, 0),
      y: toFiniteNumber(raw.y, 0),
      timestampMs,
    }
  }

  if (kind === 'mouseWheel') {
    return {
      kind,
      x: toFiniteNumber(raw.x, 0),
      y: toFiniteNumber(raw.y, 0),
      vertical: toFiniteNumber(raw.vertical, 0),
      timestampMs,
    }
  }

  const points = Array.isArray(raw.points)
    ? raw.points.map((point) => {
        const data = point as Record<string, unknown>
        return {
          x: toFiniteNumber(data.x, 0),
          y: toFiniteNumber(data.y, 0),
          timestampMs: Math.max(0, Math.round(toFiniteNumber(data.timestampMs ?? data.timestamp_ms, timestampMs))),
        }
      })
    : []

  const moveAction: Extract<InputRecordingAction, { kind: 'mouseMovePath' }> = {
    kind,
    timestampMs,
    durationMs: Math.max(0, Math.round(toFiniteNumber(raw.durationMs ?? raw.duration_ms, 0))),
    distancePx: Math.max(0, toFiniteNumber(raw.distancePx ?? raw.distance_px, 0)),
    simplifiedFrom: Math.max(0, Math.round(toFiniteNumber(raw.simplifiedFrom ?? raw.simplified_from, points.length))),
    points,
  }

  return normalizeMovePath(moveAction)
}

const computeCoordBbox = (actions: InputRecordingAction[]): CoordBbox => {
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity

  for (const action of actions) {
    if (action.kind === 'mouseDown' || action.kind === 'mouseUp' || action.kind === 'mouseWheel') {
      minX = Math.min(minX, action.x)
      minY = Math.min(minY, action.y)
      maxX = Math.max(maxX, action.x)
      maxY = Math.max(maxY, action.y)
      continue
    }

    if (action.kind === 'mouseMovePath') {
      for (const point of action.points) {
        minX = Math.min(minX, point.x)
        minY = Math.min(minY, point.y)
        maxX = Math.max(maxX, point.x)
        maxY = Math.max(maxY, point.y)
      }
    }
  }

  if (!isFinite(minX) || !isFinite(minY) || !isFinite(maxX) || !isFinite(maxY)) {
    return { minX: 0, minY: 0, maxX: 1920, maxY: 1080 }
  }

  const paddingX = (maxX - minX) * 0.08 + 24
  const paddingY = (maxY - minY) * 0.08 + 24
  return {
    minX: minX - paddingX,
    minY: minY - paddingY,
    maxX: maxX + paddingX,
    maxY: maxY + paddingY,
  }
}

const worldToCanvas = (
  x: number,
  y: number,
  bbox: CoordBbox,
  width: number,
  height: number,
) => {
  const bw = bbox.maxX - bbox.minX || 1
  const bh = bbox.maxY - bbox.minY || 1
  const scale = Math.min(width / bw, height / bh)
  const ox = (width - bw * scale) / 2
  const oy = (height - bh * scale) / 2
  return {
    cx: ox + (x - bbox.minX) * scale,
    cy: oy + (y - bbox.minY) * scale,
  }
}

const tickStepFromScale = (durationMs: number, timelineWidth: number) => {
  if (durationMs <= 0 || timelineWidth <= 0) return 100
  const pxPerMs = timelineWidth / durationMs
  const targetPx = 90
  const candidates = [
    10,
    20,
    50,
    100,
    200,
    500,
    1000,
    2000,
    5000,
    10000,
    20000,
    30000,
  ]

  for (const step of candidates) {
    if (step * pxPerMs >= targetPx) {
      return step
    }
  }
  return 60000
}

const pointToSegmentDistance = (
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
) => {
  const abx = bx - ax
  const aby = by - ay
  const apx = px - ax
  const apy = py - ay
  const abLenSq = abx * abx + aby * aby

  if (abLenSq <= 1e-9) {
    return Math.hypot(px - ax, py - ay)
  }

  const t = clamp((apx * abx + apy * aby) / abLenSq, 0, 1)
  const cx = ax + abx * t
  const cy = ay + aby * t
  return Math.hypot(px - cx, py - cy)
}

export default function InputRecordingTimelineEditor({
  open,
  actions,
  clipStartMs,
  clipEndMs,
  onActionsChange,
  onClipChange,
  onSave,
  onClose,
}: InputRecordingTimelineEditorProps) {
  const [selectedIndex, setSelectedIndex] = useState(-1)
  const [currentMs, setCurrentMs] = useState(0)
  const [zoomPxPerSec, setZoomPxPerSec] = useState(130)
  const [newActionKind, setNewActionKind] = useState<ActionKind>('mouseDown')
  const [dragMode, setDragMode] = useState<EditorDragMode>(null)
  const [rawJsonDraft, setRawJsonDraft] = useState('')
  const [rawJsonError, setRawJsonError] = useState('')
  const [previewScale, setPreviewScale] = useState(1)
  const [previewPanX, setPreviewPanX] = useState(0)
  const [previewPanY, setPreviewPanY] = useState(0)
  const [previewPanning, setPreviewPanning] = useState(false)
  const [timelineViewportWidth, setTimelineViewportWidth] = useState(0)

  const timelineTrackRef = useRef<HTMLDivElement>(null)
  const timelineViewportRef = useRef<HTMLDivElement>(null)
  const timelineLaneListRef = useRef<HTMLDivElement>(null)
  const previewHostRef = useRef<HTMLDivElement>(null)
  const previewCanvasRef = useRef<HTMLCanvasElement>(null)
  const clipStartRef = useRef(clipStartMs)
  const clipEndRef = useRef(clipEndMs)
  const previewScaleRef = useRef(1)
  const previewPanXRef = useRef(0)
  const previewPanYRef = useRef(0)
  const previewPanStartRef = useRef<{ clientX: number; clientY: number; panX: number; panY: number } | null>(null)
  const previewDragMovedRef = useRef(false)

  const bounds = useMemo(() => computeRecordingBounds(actions), [actions])
  const durationMs = Math.max(bounds.durationMs, 1)
  const timelineBodyViewportWidth = Math.max(1, timelineViewportWidth)
  const fitZoomPxPerSec = durationMs > 0 ? (timelineBodyViewportWidth * 1000) / durationMs : 1
  const minTimelineZoomPxPerSec = Math.max(0.05, Math.min(60, fitZoomPxPerSec * 0.5 || 0.05))
  const timelineWidth = Math.max(timelineBodyViewportWidth, (durationMs / 1000) * zoomPxPerSec)
  const timelineTotalHeight = RULER_HEIGHT + laneDefs.length * LANE_HEIGHT
  const bbox = useMemo(() => computeCoordBbox(actions), [actions])

  const selectedAction =
    selectedIndex >= 0 && selectedIndex < actions.length ? actions[selectedIndex] : null

  useEffect(() => {
    clipStartRef.current = clipStartMs
  }, [clipStartMs])

  useEffect(() => {
    clipEndRef.current = clipEndMs
  }, [clipEndMs])

  useEffect(() => {
    if (!open) return
    if (actions.length === 0) {
      setSelectedIndex(-1)
      setCurrentMs(0)
      return
    }

    setSelectedIndex((prev) => {
      if (prev < 0 || prev >= actions.length) return 0
      return prev
    })
    setCurrentMs((prev) => clamp(prev, 0, durationMs))
  }, [open, actions.length, durationMs])

  useEffect(() => {
    previewScaleRef.current = previewScale
  }, [previewScale])

  useEffect(() => {
    previewPanXRef.current = previewPanX
  }, [previewPanX])

  useEffect(() => {
    previewPanYRef.current = previewPanY
  }, [previewPanY])

  useEffect(() => {
    if (!open) return
    const viewport = timelineViewportRef.current
    if (!viewport) return

    const updateWidth = () => {
      setTimelineViewportWidth(Math.max(0, Math.round(viewport.clientWidth)))
    }

    updateWidth()
    const observer = new ResizeObserver(() => updateWidth())
    observer.observe(viewport)
    return () => observer.disconnect()
  }, [open])

  useEffect(() => {
    if (!open) return
    const laneList = timelineLaneListRef.current
    if (!laneList) return
    laneList.style.transform = 'translate3d(0, 0px, 0)'
  }, [open])

  useEffect(() => {
    if (!selectedAction) {
      setRawJsonDraft('')
      setRawJsonError('')
      return
    }
    setRawJsonDraft(JSON.stringify(selectedAction, null, 2))
    setRawJsonError('')
  }, [selectedAction])

  const commitActions = useCallback(
    (nextActions: InputRecordingAction[], selectedActionRef: InputRecordingAction | null = null) => {
      const sorted = sortActionsByTimestamp(nextActions)
      onActionsChange(sorted)

      if (sorted.length === 0) {
        setSelectedIndex(-1)
        setCurrentMs(0)
        return
      }

      if (selectedActionRef) {
        const nextIndex = sorted.indexOf(selectedActionRef)
        setSelectedIndex(nextIndex >= 0 ? nextIndex : 0)
        setCurrentMs(clamp(getActionTs(selectedActionRef) - bounds.startMs, 0, durationMs))
      } else {
        setSelectedIndex((prev) => clamp(prev, 0, sorted.length - 1))
      }
    },
    [bounds.startMs, durationMs, onActionsChange],
  )

  const updateSelectedAction = useCallback(
    (updater: (action: InputRecordingAction) => InputRecordingAction) => {
      if (!selectedAction || selectedIndex < 0 || selectedIndex >= actions.length) return
      const updated = updater(selectedAction)
      const next = actions.slice()
      next[selectedIndex] = updated
      commitActions(next, updated)
    },
    [actions, commitActions, selectedAction, selectedIndex],
  )

  const removeSelectedAction = useCallback(() => {
    if (!selectedAction || selectedIndex < 0 || selectedIndex >= actions.length) return
    const next = actions.filter((_, index) => index !== selectedIndex)
    const sorted = sortActionsByTimestamp(next)
    onActionsChange(sorted)

    if (sorted.length === 0) {
      setSelectedIndex(-1)
      setCurrentMs(0)
      return
    }

    const fallbackIndex = Math.min(selectedIndex, sorted.length - 1)
    setSelectedIndex(fallbackIndex)
    setCurrentMs(clamp(getActionTs(sorted[fallbackIndex]) - bounds.startMs, 0, durationMs))
  }, [actions, bounds.startMs, durationMs, onActionsChange, selectedAction, selectedIndex])

  const duplicateSelectedAction = useCallback(() => {
    if (!selectedAction) return
    const duplicated = {
      ...selectedAction,
      timestampMs: getActionTs(selectedAction) + 10,
    } as InputRecordingAction

    const next = [...actions, duplicated]
    commitActions(next, duplicated)
  }, [actions, commitActions, selectedAction])

  const addActionAtCurrentTime = useCallback(() => {
    const absoluteTs = bounds.startMs + currentMs
    const created = createDefaultAction(newActionKind, absoluteTs)
    const next = [...actions, created]
    commitActions(next, created)
  }, [actions, bounds.startMs, commitActions, currentMs, newActionKind])

  const applyClipRange = useCallback(
    (startMs: number, endMs: number) => {
      const minWindow = Math.min(MIN_CLIP_WINDOW_MS, durationMs)
      const start = clamp(startMs, 0, durationMs)
      const end = clamp(endMs, 0, durationMs)

      if (end - start < minWindow) {
        const center = (start + end) / 2
        const adjustedStart = clamp(center - minWindow / 2, 0, durationMs - minWindow)
        const adjustedEnd = clamp(adjustedStart + minWindow, minWindow, durationMs)
        onClipChange(adjustedStart, adjustedEnd)
        return
      }

      onClipChange(start, end)
    },
    [durationMs, onClipChange],
  )

  const msFromClientX = useCallback(
    (clientX: number) => {
      const rect = timelineTrackRef.current?.getBoundingClientRect()
      if (!rect || rect.width === 0) return 0

      const x = clamp(clientX - rect.left, 0, timelineWidth)
      return (x / timelineWidth) * durationMs
    },
    [durationMs, timelineWidth],
  )

  const applyTimelineZoom = useCallback((nextZoomRaw: number) => {
    const nextZoom = clamp(nextZoomRaw, minTimelineZoomPxPerSec, TIMELINE_MAX_ZOOM_PX_PER_SEC)
    setZoomPxPerSec(nextZoom)

    const viewport = timelineViewportRef.current
    if (!viewport || durationMs <= 0) return

    const anchorMsRaw = selectedAction
      ? getActionTs(selectedAction) - bounds.startMs
      : currentMs
    const anchorMs = clamp(anchorMsRaw, 0, durationMs)
    const viewportWidth = Math.max(1, viewport.clientWidth)
    const nextWidth = Math.max(viewportWidth, (durationMs / 1000) * nextZoom)
    const anchorX = (anchorMs / durationMs) * nextWidth
    const maxScroll = Math.max(0, nextWidth - viewportWidth)
    const targetScrollLeft = clamp(anchorX - viewportWidth / 2, 0, maxScroll)

    requestAnimationFrame(() => {
      if (!timelineViewportRef.current) return
      timelineViewportRef.current.scrollLeft = targetScrollLeft
    })
  }, [bounds.startMs, currentMs, durationMs, minTimelineZoomPxPerSec, selectedAction])

  useEffect(() => {
    if (!dragMode) return

    const onMove = (event: MouseEvent) => {
      const ms = msFromClientX(event.clientX)
      if (dragMode === 'scrubber') {
        setCurrentMs(ms)
        return
      }
      if (dragMode === 'clipStart') {
        applyClipRange(ms, clipEndRef.current)
        return
      }
      applyClipRange(clipStartRef.current, ms)
    }

    const onUp = () => setDragMode(null)

    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
  }, [applyClipRange, dragMode, msFromClientX])

  const timelineEvents = useMemo<TimelineEventView[]>(() => {
    return actions
      .map((action, sourceIndex) => ({
        sourceIndex,
        kind: action.kind,
        relMs: getActionTs(action) - bounds.startMs,
        colorClass: colorClassForKind(action.kind),
        summary: summarizeAction(action),
      }))
      .sort((a, b) => a.relMs - b.relMs)
  }, [actions, bounds.startMs])

  const clipStartPx = (clipStartMs / durationMs) * timelineWidth
  const clipEndPx = (clipEndMs / durationMs) * timelineWidth
  const scrubberPx = (currentMs / durationMs) * timelineWidth

  const tickStepMs = tickStepFromScale(durationMs, timelineWidth)
  const timelineTicks = useMemo(() => {
    const ticks: number[] = []
    for (let ms = 0; ms <= durationMs; ms += tickStepMs) {
      ticks.push(ms)
    }
    if (ticks[ticks.length - 1] !== durationMs) {
      ticks.push(durationMs)
    }
    return ticks
  }, [durationMs, tickStepMs])

  const drawTrajectoryPreview = useCallback(() => {
    const canvas = previewCanvasRef.current
    const host = previewHostRef.current
    if (!canvas || !host) return

    const width = Math.max(1, Math.round(host.clientWidth))
    const height = Math.max(1, Math.round(host.clientHeight))
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width
      canvas.height = height
    }

    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const isDark = document.documentElement.classList.contains('dark')
    const transformPreviewPoint = (cx: number, cy: number) => ({
      x: width / 2 + (cx - width / 2) * previewScale + previewPanX,
      y: height / 2 + (cy - height / 2) * previewScale + previewPanY,
    })

    ctx.clearRect(0, 0, width, height)
    ctx.fillStyle = isDark ? '#111827' : '#f8fafc'
    ctx.fillRect(0, 0, width, height)

    ctx.strokeStyle = isDark ? 'rgba(148,163,184,0.12)' : 'rgba(15,23,42,0.08)'
    ctx.lineWidth = 1
    for (let x = 0; x < width; x += 40) {
      ctx.beginPath()
      ctx.moveTo(x, 0)
      ctx.lineTo(x, height)
      ctx.stroke()
    }
    for (let y = 0; y < height; y += 40) {
      ctx.beginPath()
      ctx.moveTo(0, y)
      ctx.lineTo(width, y)
      ctx.stroke()
    }

    for (const action of actions) {
      if (action.kind !== 'mouseMovePath' || action.points.length < 2) continue

      ctx.lineWidth = 2.8
      ctx.lineCap = 'round'
      ctx.lineJoin = 'round'

      for (let index = 1; index < action.points.length; index += 1) {
        const prev = action.points[index - 1]
        const current = action.points[index]
        const progress = durationMs > 0
          ? clamp((getPointTs(current) - bounds.startMs) / durationMs, 0, 1)
          : 0
        const hue = (1 - progress) * 220
        ctx.strokeStyle = `hsla(${hue}, 84%, 58%, 0.95)`

        const c0 = worldToCanvas(prev.x, prev.y, bbox, width, height)
        const c1 = worldToCanvas(current.x, current.y, bbox, width, height)
        const p0 = transformPreviewPoint(c0.cx, c0.cy)
        const p1 = transformPreviewPoint(c1.cx, c1.cy)
        ctx.beginPath()
        ctx.moveTo(p0.x, p0.y)
        ctx.lineTo(p1.x, p1.y)
        ctx.stroke()
      }
    }

    for (const action of actions) {
      if (action.kind === 'mouseDown' || action.kind === 'mouseUp') {
        const base = worldToCanvas(action.x, action.y, bbox, width, height)
        const { x: cx, y: cy } = transformPreviewPoint(base.cx, base.cy)
        const color = action.button === 'right' ? 'rgba(244,63,94,0.95)' : action.button === 'middle' ? 'rgba(245,158,11,0.95)' : 'rgba(34,211,238,0.95)'
        ctx.beginPath()
        ctx.arc(cx, cy, 4.2, 0, Math.PI * 2)
        ctx.fillStyle = color
        ctx.fill()
      } else if (action.kind === 'mouseWheel') {
        const base = worldToCanvas(action.x, action.y, bbox, width, height)
        const { x: cx, y: cy } = transformPreviewPoint(base.cx, base.cy)
        ctx.strokeStyle = action.vertical > 0 ? 'rgba(217,70,239,0.95)' : 'rgba(168,85,247,0.95)'
        ctx.lineWidth = 1.8
        ctx.beginPath()
        ctx.arc(cx, cy, 6.5, 0, Math.PI * 2)
        ctx.stroke()
      }
    }

    if (selectedAction) {
      let anchor: CursorPoint | null = null
      if (
        selectedAction.kind === 'mouseDown' ||
        selectedAction.kind === 'mouseUp' ||
        selectedAction.kind === 'mouseWheel'
      ) {
        anchor = {
          x: selectedAction.x,
          y: selectedAction.y,
          timestampMs: getActionTs(selectedAction),
        }
      } else if (selectedAction.kind === 'mouseMovePath') {
        const point = selectedAction.points[selectedAction.points.length - 1] ?? selectedAction.points[0]
        if (point) {
          anchor = {
            x: point.x,
            y: point.y,
            timestampMs: getPointTs(point),
          }
        }
      }

      if (anchor) {
        const base = worldToCanvas(anchor.x, anchor.y, bbox, width, height)
        const { x: cx, y: cy } = transformPreviewPoint(base.cx, base.cy)
        ctx.beginPath()
        ctx.arc(cx, cy, 9, 0, Math.PI * 2)
        ctx.strokeStyle = 'rgba(255,255,255,0.9)'
        ctx.lineWidth = 2
        ctx.stroke()
      }
    }
  }, [actions, bbox, bounds.startMs, durationMs, previewPanX, previewPanY, previewScale, selectedAction])

  useEffect(() => {
    if (!previewPanning) return

    const onMove = (event: MouseEvent) => {
      const start = previewPanStartRef.current
      if (!start) return
      const dx = event.clientX - start.clientX
      const dy = event.clientY - start.clientY
      if (!previewDragMovedRef.current && (Math.abs(dx) > 2 || Math.abs(dy) > 2)) {
        previewDragMovedRef.current = true
      }
      setPreviewPanX(start.panX + dx)
      setPreviewPanY(start.panY + dy)
    }

    const onUp = () => {
      setPreviewPanning(false)
      previewPanStartRef.current = null
    }

    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
  }, [previewPanning])

  useEffect(() => {
    if (!open) return
    drawTrajectoryPreview()
  }, [drawTrajectoryPreview, open])

  useEffect(() => {
    if (!open) return
    const host = previewHostRef.current
    if (!host) return
    const observer = new ResizeObserver(() => drawTrajectoryPreview())
    observer.observe(host)
    return () => observer.disconnect()
  }, [drawTrajectoryPreview, open])

  const selectedRelMs = selectedAction ? getActionTs(selectedAction) - bounds.startMs : null

  const selectEventAsCurrent = useCallback((sourceIndex: number, relMs?: number) => {
    const target = actions[sourceIndex]
    if (!target) return
    setSelectedIndex(sourceIndex)
    const nextRelMs =
      relMs !== undefined ? relMs : getActionTs(target) - bounds.startMs
    setCurrentMs(clamp(nextRelMs, 0, durationMs))
    setRawJsonDraft(JSON.stringify(target, null, 2))
    setRawJsonError('')
  }, [actions, bounds.startMs, durationMs])

  const handlePreviewClick = useCallback((event: ReactMouseEvent<HTMLDivElement>) => {
    if (previewDragMovedRef.current) {
      previewDragMovedRef.current = false
      return
    }

    const host = previewHostRef.current
    if (!host) return
    const rect = host.getBoundingClientRect()
    if (rect.width <= 0 || rect.height <= 0) return

    const width = Math.max(1, Math.round(host.clientWidth))
    const height = Math.max(1, Math.round(host.clientHeight))
    const pointerX = event.clientX - rect.left
    const pointerY = event.clientY - rect.top

    const scale = previewScaleRef.current
    const panX = previewPanXRef.current
    const panY = previewPanYRef.current
    const projectPoint = (wx: number, wy: number) => {
      const base = worldToCanvas(wx, wy, bbox, width, height)
      return {
        x: width / 2 + (base.cx - width / 2) * scale + panX,
        y: height / 2 + (base.cy - height / 2) * scale + panY,
      }
    }

    let bestIndex = -1
    let bestDist = Infinity
    const testPoint = (sourceIndex: number, x: number, y: number) => {
      const projected = projectPoint(x, y)
      const dist = Math.hypot(projected.x - pointerX, projected.y - pointerY)
      if (dist < bestDist) {
        bestDist = dist
        bestIndex = sourceIndex
      }
    }

    const testMovePath = (sourceIndex: number, action: Extract<InputRecordingAction, { kind: 'mouseMovePath' }>) => {
      if (action.points.length === 0) return

      const projectedPoints = action.points.map((point) => projectPoint(point.x, point.y))

      if (projectedPoints.length === 1) {
        const only = projectedPoints[0]
        const dist = Math.hypot(only.x - pointerX, only.y - pointerY)
        if (dist < bestDist) {
          bestDist = dist
          bestIndex = sourceIndex
        }
        return
      }

      for (let pointIndex = 1; pointIndex < projectedPoints.length; pointIndex += 1) {
        const prev = projectedPoints[pointIndex - 1]
        const curr = projectedPoints[pointIndex]
        const dist = pointToSegmentDistance(
          pointerX,
          pointerY,
          prev.x,
          prev.y,
          curr.x,
          curr.y,
        )
        if (dist < bestDist) {
          bestDist = dist
          bestIndex = sourceIndex
        }
      }
    }

    for (let sourceIndex = 0; sourceIndex < actions.length; sourceIndex += 1) {
      const action = actions[sourceIndex]
      if (action.kind === 'mouseDown' || action.kind === 'mouseUp' || action.kind === 'mouseWheel') {
        testPoint(sourceIndex, action.x, action.y)
        continue
      }

      if (action.kind === 'mouseMovePath' && action.points.length > 0) {
        testMovePath(sourceIndex, action)
      }
    }

    if (bestIndex >= 0 && bestDist <= 12) {
      selectEventAsCurrent(bestIndex)
      return
    }

    setSelectedIndex(-1)
    setRawJsonError('')
  }, [actions, bbox, selectEventAsCurrent])

  const applyRawJsonUpdate = () => {
    if (!selectedAction) return
    try {
      const parsed = JSON.parse(rawJsonDraft)
      const normalized = parseActionFromJson(parsed)
      if (!normalized) {
        throw new Error('JSON 结构不符合录制事件类型')
      }
      updateSelectedAction(() => normalized)
      setRawJsonError('')
    } catch (error) {
      setRawJsonError(String(error))
    }
  }

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-[390] flex items-center justify-center bg-black/65 backdrop-blur-sm"
      onClick={(event) => {
        if (event.target === event.currentTarget) {
          onClose()
        }
      }}
    >
      <div className="flex h-[94vh] w-[96vw] min-w-0 flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl dark:border-neutral-700 dark:bg-neutral-900">
        <header className="flex shrink-0 items-center justify-between gap-4 border-b border-slate-200 px-5 py-3 dark:border-neutral-800">
          <div>
            <h3 className="text-sm font-bold text-slate-700 dark:text-slate-200">高级轨迹时间轴编辑器</h3>
            <p className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">
              全量事件可编辑：时间、键值、坐标、滚轮和轨迹点；画板支持滚轮缩放与拖拽平移。
            </p>
          </div>
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2 rounded-lg border border-slate-200 px-2 py-1 dark:border-neutral-700">
              <span className="text-[11px] text-slate-500 dark:text-slate-400">时间轴缩放（以选中轴居中）</span>
              <input
                type="range"
                min={minTimelineZoomPxPerSec}
                max={TIMELINE_MAX_ZOOM_PX_PER_SEC}
                step={0.05}
                value={zoomPxPerSec}
                onChange={(event) => applyTimelineZoom(toFiniteNumber(event.target.value, zoomPxPerSec))}
                className="w-36"
              />
              <span className="w-16 text-right text-[11px] tabular-nums text-slate-600 dark:text-slate-300">
                {zoomPxPerSec >= 10 ? Math.round(zoomPxPerSec) : zoomPxPerSec.toFixed(2)}px/s
              </span>
              <span className="text-[10px] text-slate-400 dark:text-slate-500">仅时间轴</span>
              <button
                type="button"
                onClick={() => {
                  setZoomPxPerSec(Math.max(0.05, fitZoomPxPerSec))
                  if (timelineViewportRef.current) {
                    timelineViewportRef.current.scrollLeft = 0
                  }
                }}
                className="rounded border border-slate-300 px-1.5 py-0.5 text-[10px] text-slate-600 transition-colors hover:bg-slate-100 dark:border-neutral-700 dark:text-slate-300 dark:hover:bg-neutral-800"
              >
                适配全部
              </button>
            </div>
            <button
              type="button"
              onClick={onSave}
              className="rounded-md bg-cyan-600 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-cyan-500"
            >
              保存
            </button>
            <button
              type="button"
              onClick={onClose}
              className="rounded-md border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 transition-colors hover:bg-slate-100 dark:border-neutral-700 dark:text-slate-200 dark:hover:bg-neutral-800"
            >
              关闭
            </button>
          </div>
        </header>

        <div className="grid min-h-0 flex-1 grid-cols-1 gap-0 overflow-hidden lg:grid-cols-[1.65fr_1fr]">
          <section className="flex min-h-0 min-w-0 flex-col border-b border-slate-200 p-4 dark:border-neutral-800 lg:border-b-0 lg:border-r">
            <div className="mb-3 grid grid-cols-2 gap-2 lg:grid-cols-4">
              <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 dark:border-neutral-700 dark:bg-neutral-800/50">
                <div className="text-[10px] text-slate-500 dark:text-slate-400">总时长</div>
                <div className="mt-1 text-sm font-semibold text-slate-700 dark:text-slate-200">{formatMs(bounds.durationMs)}</div>
              </div>
              <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 dark:border-neutral-700 dark:bg-neutral-800/50">
                <div className="text-[10px] text-slate-500 dark:text-slate-400">事件数量</div>
                <div className="mt-1 text-sm font-semibold text-slate-700 dark:text-slate-200">{actions.length}</div>
              </div>
              <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 dark:border-neutral-700 dark:bg-neutral-800/50">
                <div className="text-[10px] text-slate-500 dark:text-slate-400">剪辑区间</div>
                <div className="mt-1 text-sm font-semibold text-cyan-700 dark:text-cyan-300">
                  {formatMs(clipStartMs)} - {formatMs(clipEndMs)}
                </div>
              </div>
              <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 dark:border-neutral-700 dark:bg-neutral-800/50">
                <div className="text-[10px] text-slate-500 dark:text-slate-400">当前指针</div>
                <div className="mt-1 text-sm font-semibold text-slate-700 dark:text-slate-200">{formatMs(currentMs)}</div>
              </div>
            </div>

            <div
              ref={previewHostRef}
              className={`relative h-64 shrink-0 overflow-hidden rounded-xl border border-slate-200 bg-slate-50 dark:border-neutral-700 dark:bg-neutral-900 ${previewPanning ? 'cursor-grabbing' : 'cursor-grab'}`}
              onWheel={(event) => {
                event.preventDefault()
                const host = previewHostRef.current
                if (!host) return
                const rect = host.getBoundingClientRect()
                if (rect.width <= 0 || rect.height <= 0) return

                const pointerX = event.clientX - rect.left
                const pointerY = event.clientY - rect.top
                const currentScale = previewScaleRef.current
                const zoomRatio = event.deltaY < 0 ? 1.1 : 0.9
                const nextScale = clamp(currentScale * zoomRatio, PREVIEW_MIN_SCALE, PREVIEW_MAX_SCALE)
                if (Math.abs(nextScale - currentScale) < 0.0001) return

                const centerX = rect.width / 2
                const centerY = rect.height / 2
                const panX = previewPanXRef.current
                const panY = previewPanYRef.current
                const ratio = nextScale / currentScale

                const nextPanX = pointerX - centerX - (pointerX - centerX - panX) * ratio
                const nextPanY = pointerY - centerY - (pointerY - centerY - panY) * ratio

                setPreviewScale(nextScale)
                setPreviewPanX(nextPanX)
                setPreviewPanY(nextPanY)
              }}
              onMouseDown={(event) => {
                if (event.button !== 0) return
                event.preventDefault()
                previewDragMovedRef.current = false
                previewPanStartRef.current = {
                  clientX: event.clientX,
                  clientY: event.clientY,
                  panX: previewPanXRef.current,
                  panY: previewPanYRef.current,
                }
                setPreviewPanning(true)
              }}
              onClick={handlePreviewClick}
            >
              <canvas ref={previewCanvasRef} className="absolute inset-0 h-full w-full" />
              <div className="absolute left-2 top-2 flex items-center gap-2 rounded-md border border-slate-200 bg-white/90 px-2 py-1 text-[10px] text-slate-600 shadow-sm backdrop-blur dark:border-neutral-700 dark:bg-neutral-900/85 dark:text-slate-300">
                <span>画板缩放 {Math.round(previewScale * 100)}%</span>
                <button
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation()
                    setPreviewScale(1)
                    setPreviewPanX(0)
                    setPreviewPanY(0)
                  }}
                  className="rounded border border-slate-300 px-1.5 py-0.5 text-[10px] transition-colors hover:bg-slate-100 dark:border-neutral-700 dark:hover:bg-neutral-800"
                >
                  重置视图
                </button>
              </div>
              {actions.length === 0 && (
                <div className="absolute inset-0 flex items-center justify-center text-xs text-slate-400 dark:text-slate-500">
                  暂无可视化轨迹数据
                </div>
              )}
            </div>

            <div className="mt-3 flex items-center gap-2">
              <label className="text-[11px] text-slate-500 dark:text-slate-400">新增事件</label>
              <select
                value={newActionKind}
                onChange={(event) => setNewActionKind(event.target.value as ActionKind)}
                className="rounded-md border border-slate-300 bg-white px-2 py-1 text-xs text-slate-700 dark:border-neutral-700 dark:bg-neutral-900 dark:text-slate-200"
              >
                <option value="mouseMovePath">mouseMovePath</option>
                <option value="mouseDown">mouseDown</option>
                <option value="mouseUp">mouseUp</option>
                <option value="mouseWheel">mouseWheel</option>
                <option value="keyDown">keyDown</option>
                <option value="keyUp">keyUp</option>
              </select>
              <button
                type="button"
                onClick={addActionAtCurrentTime}
                className="rounded-md bg-cyan-600 px-3 py-1 text-xs font-semibold text-white transition-colors hover:bg-cyan-500"
              >
                在当前时间插入
              </button>
            </div>

            <div className="mt-3 flex items-center gap-2 text-[11px]">
              <label className="text-slate-500 dark:text-slate-400">剪辑开始</label>
              <input
                type="number"
                value={Math.round(clipStartMs)}
                min={0}
                max={Math.round(durationMs)}
                onChange={(event) => applyClipRange(toFiniteNumber(event.target.value, 0), clipEndMs)}
                className="w-24 rounded-md border border-slate-300 bg-white px-2 py-1 text-xs text-slate-700 dark:border-neutral-700 dark:bg-neutral-900 dark:text-slate-200"
              />
              <label className="text-slate-500 dark:text-slate-400">剪辑结束</label>
              <input
                type="number"
                value={Math.round(clipEndMs)}
                min={0}
                max={Math.round(durationMs)}
                onChange={(event) => applyClipRange(clipStartMs, toFiniteNumber(event.target.value, durationMs))}
                className="w-24 rounded-md border border-slate-300 bg-white px-2 py-1 text-xs text-slate-700 dark:border-neutral-700 dark:bg-neutral-900 dark:text-slate-200"
              />
              <button
                type="button"
                onClick={() => applyClipRange(0, durationMs)}
                className="rounded-md border border-slate-300 px-2 py-1 text-xs text-slate-600 transition-colors hover:bg-slate-100 dark:border-neutral-700 dark:text-slate-300 dark:hover:bg-neutral-800"
              >
                全部
              </button>
              {selectedRelMs !== null && (
                <button
                  type="button"
                  onClick={() => setCurrentMs(clamp(selectedRelMs, 0, durationMs))}
                  className="rounded-md border border-emerald-300 px-2 py-1 text-xs text-emerald-700 transition-colors hover:bg-emerald-50 dark:border-emerald-700 dark:text-emerald-300 dark:hover:bg-emerald-900/20"
                >
                  跳到选中事件
                </button>
              )}
            </div>

            <div className="mt-3 min-h-0 flex flex-1 flex-col">
              <div className="min-h-0 flex-1 overflow-hidden rounded-xl border border-slate-200 dark:border-neutral-700">
                <div className="flex h-full min-w-0">
                  <div
                    className="relative shrink-0 overflow-hidden border-r border-slate-200 bg-white dark:border-neutral-800 dark:bg-neutral-900"
                    style={{ width: LABEL_WIDTH }}
                  >
                    <div className="sticky top-0 z-30 flex h-[30px] items-center border-b border-slate-200 bg-slate-50 px-3 text-[10px] font-semibold text-slate-500 dark:border-neutral-800 dark:bg-neutral-900 dark:text-slate-400">
                      时间轴
                    </div>
                    <div
                      ref={timelineLaneListRef}
                      className="w-full"
                      style={{
                        height: laneDefs.length * LANE_HEIGHT,
                        transform: 'translate3d(0, 0px, 0)',
                      }}
                    >
                      {laneDefs.map((lane) => (
                        <div
                          key={lane.kind}
                          className="flex items-center border-b border-slate-200/80 bg-white px-3 text-[11px] font-semibold text-slate-500 dark:border-neutral-800/80 dark:bg-neutral-900 dark:text-slate-400"
                          style={{ height: LANE_HEIGHT }}
                        >
                          {lane.label}
                        </div>
                      ))}
                    </div>
                  </div>

                  <div
                    ref={timelineViewportRef}
                    className="min-h-0 min-w-0 flex-1 overflow-x-auto overflow-y-auto"
                    onScroll={(event) => {
                      const nextTop = (event.currentTarget as HTMLDivElement).scrollTop
                      const laneList = timelineLaneListRef.current
                      if (laneList) {
                        laneList.style.transform = `translate3d(0, ${-nextTop}px, 0)`
                      }
                    }}
                  >
                    <div
                      ref={timelineTrackRef}
                      className="relative select-none"
                      style={{
                        width: timelineWidth,
                        height: timelineTotalHeight,
                      }}
                      onMouseDown={(event) => {
                        const target = event.target as HTMLElement
                        if (target.dataset.noTrackClick === 'true') return
                        setSelectedIndex(-1)
                        setRawJsonError('')
                        const ms = msFromClientX(event.clientX)
                        setCurrentMs(ms)
                        setDragMode('scrubber')
                      }}
                    >
                    <div
                      className="pointer-events-none absolute bottom-0 top-0 bg-slate-200/65 dark:bg-neutral-700/60"
                      style={{ left: 0, width: clipStartPx }}
                    />
                    <div
                      className="pointer-events-none absolute bottom-0 top-0 bg-slate-200/65 dark:bg-neutral-700/60"
                      style={{ left: clipEndPx, width: Math.max(0, timelineWidth - clipEndPx) }}
                    />

                    <div
                      className="pointer-events-none absolute top-0 z-0 h-px bg-cyan-500"
                      style={{
                        left: clipStartPx,
                        width: Math.max(0, clipEndPx - clipStartPx),
                        top: 0,
                      }}
                    />

                    <div
                      className="absolute z-20 h-full w-3 -translate-x-1/2 cursor-col-resize"
                      data-no-track-click="true"
                      style={{ left: clipStartPx }}
                      onMouseDown={(event) => {
                        event.stopPropagation()
                        setDragMode('clipStart')
                      }}
                    >
                      <div className="mx-auto h-full w-1 rounded-full bg-cyan-500/90" />
                    </div>

                    <div
                      className="absolute z-20 h-full w-3 -translate-x-1/2 cursor-col-resize"
                      data-no-track-click="true"
                      style={{ left: clipEndPx }}
                      onMouseDown={(event) => {
                        event.stopPropagation()
                        setDragMode('clipEnd')
                      }}
                    >
                      <div className="mx-auto h-full w-1 rounded-full bg-cyan-500/90" />
                    </div>

                    <div
                      className="absolute z-30 h-full w-3 -translate-x-1/2 cursor-col-resize"
                      data-no-track-click="true"
                      style={{ left: scrubberPx }}
                      onMouseDown={(event) => {
                        event.stopPropagation()
                        setDragMode('scrubber')
                      }}
                    >
                      <div className="mx-auto h-full w-0.5 bg-white shadow-[0_0_0_1px_rgba(15,23,42,0.15)]">
                        <div className="absolute left-1/2 top-1 h-2.5 w-2.5 -translate-x-1/2 rounded-full bg-cyan-500" />
                      </div>
                    </div>

                    <div className="sticky top-0 z-50 h-[30px] border-b border-slate-200 bg-slate-50 dark:border-neutral-800 dark:bg-neutral-900">
                      {timelineTicks.map((tickMs) => {
                        const x = (tickMs / durationMs) * timelineWidth
                        const isFirstTick = tickMs === 0
                        return (
                          <div
                            key={`tick-${tickMs}`}
                            className={`absolute inset-y-0 flex flex-col pointer-events-none ${
                              isFirstTick ? 'items-start' : '-translate-x-1/2 items-center'
                            }`}
                            style={{ left: x }}
                          >
                            <span
                              className={`mb-0.5 text-[10px] tabular-nums text-slate-500 dark:text-slate-400 ${
                                isFirstTick ? 'ml-0' : ''
                              }`}
                            >
                              {formatMs(tickMs)}
                            </span>
                            <div className="w-px flex-1 bg-slate-300/70 dark:bg-neutral-700/70" />
                          </div>
                        )
                      })}
                    </div>

                    {laneDefs.map((lane, laneIndex) => (
                      <div
                        key={lane.kind}
                        className="absolute inset-x-0 border-b border-slate-200/80 dark:border-neutral-800/80"
                        style={{
                          top: RULER_HEIGHT + laneIndex * LANE_HEIGHT,
                          height: LANE_HEIGHT,
                        }}
                      />
                    ))}

                    {timelineEvents.map((item, viewIndex) => {
                      const laneIndex = laneIndexByKind[item.kind]
                      const x = (item.relMs / durationMs) * timelineWidth
                      const isSelected = item.sourceIndex === selectedIndex
                      return (
                        <button
                          key={`${item.kind}-${item.sourceIndex}-${viewIndex}`}
                          type="button"
                          data-no-track-click="true"
                          className="absolute z-40 h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow"
                          style={{
                            left: x,
                            top: RULER_HEIGHT + laneIndex * LANE_HEIGHT + LANE_HEIGHT / 2,
                            background: item.kind === 'mouseMovePath'
                              ? 'linear-gradient(135deg, #10b981, #22d3ee)'
                              : item.kind === 'mouseWheel'
                                ? '#d946ef'
                                : item.kind === 'mouseDown' || item.kind === 'mouseUp'
                                  ? '#06b6d4'
                                  : '#8b5cf6',
                            transform: `translate(-50%, -50%) scale(${isSelected ? 1.18 : 1})`,
                          }}
                          title={`${formatMs(item.relMs)} · ${item.summary}`}
                          onClick={(event) => {
                            event.stopPropagation()
                            selectEventAsCurrent(item.sourceIndex, item.relMs)
                          }}
                        />
                      )
                    })}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </section>

          <aside className="flex min-h-0 min-w-0 flex-col gap-2 p-3">
            <div className="rounded-xl border border-slate-200 dark:border-neutral-700">
              <div className="border-b border-slate-200 px-3 py-2 text-xs font-semibold text-slate-600 dark:border-neutral-800 dark:text-slate-300">
                事件总览
              </div>
              <div
                className="max-h-40 overflow-y-auto"
                onClick={(event) => {
                  if (event.target === event.currentTarget) {
                    setSelectedIndex(-1)
                    setRawJsonError('')
                  }
                }}
              >
                {timelineEvents.length === 0 ? (
                  <div className="px-3 py-4 text-xs text-slate-400 dark:text-slate-500">暂无事件</div>
                ) : (
                  timelineEvents.map((item, index) => (
                    <button
                      key={`${item.sourceIndex}-${index}`}
                      type="button"
                      onClick={() => {
                        selectEventAsCurrent(item.sourceIndex, item.relMs)
                      }}
                      className={`flex w-full items-center gap-2 border-b border-slate-100 px-3 py-2 text-left text-[11px] transition-colors last:border-b-0 dark:border-neutral-800 ${
                        item.sourceIndex === selectedIndex
                          ? 'bg-cyan-50 dark:bg-cyan-900/20'
                          : 'hover:bg-slate-50 dark:hover:bg-neutral-800/60'
                      }`}
                    >
                      <span className="w-16 shrink-0 tabular-nums text-slate-500 dark:text-slate-400">{formatMs(item.relMs)}</span>
                      <span className={`inline-flex rounded border px-1.5 py-0.5 text-[10px] font-semibold ${item.colorClass}`}>
                        {item.kind}
                      </span>
                      <span className="truncate text-slate-600 dark:text-slate-300">{item.summary}</span>
                    </button>
                  ))
                )}
              </div>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto rounded-xl border border-slate-200 p-2 dark:border-neutral-700">
              {selectedAction ? (
                <div className="space-y-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <h4 className="text-xs font-bold text-slate-700 dark:text-slate-200">事件编辑</h4>
                    <span className="text-[10px] text-slate-500 dark:text-slate-400">
                      index {selectedIndex} · {selectedAction.kind}
                    </span>
                    <div className="ml-auto flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={duplicateSelectedAction}
                        className="rounded-md border border-slate-300 px-2 py-1 text-[11px] text-slate-600 transition-colors hover:bg-slate-100 dark:border-neutral-700 dark:text-slate-300 dark:hover:bg-neutral-800"
                      >
                        复制
                      </button>
                      <button
                        type="button"
                        onClick={removeSelectedAction}
                        className="rounded-md border border-rose-300 px-2 py-1 text-[11px] text-rose-700 transition-colors hover:bg-rose-50 dark:border-rose-700 dark:text-rose-300 dark:hover:bg-rose-900/20"
                      >
                        删除
                      </button>
                    </div>
                  </div>

                  <label className="block space-y-1 text-[10px] text-slate-500 dark:text-slate-400">
                    时间戳 (ms)
                    <input
                      type="number"
                      value={Math.round(getActionTs(selectedAction))}
                      onChange={(event) => {
                        const nextTs = Math.max(0, Math.round(toFiniteNumber(event.target.value, getActionTs(selectedAction))))
                        updateSelectedAction((action) => {
                          if (action.kind === 'mouseMovePath') {
                            const shift = nextTs - getActionTs(action)
                            const shifted = {
                              ...action,
                              timestampMs: nextTs,
                              points: action.points.map((point) => ({
                                ...point,
                                timestampMs: Math.max(0, Math.round(getPointTs(point) + shift)),
                              })),
                            }
                            return normalizeMovePath(shifted)
                          }
                          return { ...action, timestampMs: nextTs } as InputRecordingAction
                        })
                      }}
                      className={COMPACT_EDITOR_INPUT_CLASS}
                    />
                  </label>

                  {(selectedAction.kind === 'keyDown' || selectedAction.kind === 'keyUp') && (
                    <label className="block space-y-1 text-[10px] text-slate-500 dark:text-slate-400">
                      键值
                      <input
                        type="text"
                        value={selectedAction.key}
                        onChange={(event) => {
                          const key = event.target.value
                          updateSelectedAction((action) => ({ ...action, key } as InputRecordingAction))
                        }}
                        className={COMPACT_EDITOR_INPUT_CLASS}
                      />
                    </label>
                  )}

                  {(selectedAction.kind === 'mouseDown' || selectedAction.kind === 'mouseUp') && (
                    <>
                      <label className="block space-y-1 text-[10px] text-slate-500 dark:text-slate-400">
                        按键
                        <select
                          value={selectedAction.button}
                          onChange={(event) => {
                            const button = event.target.value
                            updateSelectedAction((action) => ({ ...action, button } as InputRecordingAction))
                          }}
                          className={COMPACT_EDITOR_INPUT_CLASS}
                        >
                          <option value="left">left</option>
                          <option value="right">right</option>
                          <option value="middle">middle</option>
                        </select>
                      </label>
                      <div className="grid grid-cols-2 gap-2">
                        <label className="space-y-1 text-[10px] text-slate-500 dark:text-slate-400">
                          X
                          <input
                            type="number"
                            value={selectedAction.x}
                            onChange={(event) => {
                              const x = toFiniteNumber(event.target.value, selectedAction.x)
                              updateSelectedAction((action) => ({ ...action, x } as InputRecordingAction))
                            }}
                            className={COMPACT_EDITOR_INPUT_CLASS}
                          />
                        </label>
                        <label className="space-y-1 text-[10px] text-slate-500 dark:text-slate-400">
                          Y
                          <input
                            type="number"
                            value={selectedAction.y}
                            onChange={(event) => {
                              const y = toFiniteNumber(event.target.value, selectedAction.y)
                              updateSelectedAction((action) => ({ ...action, y } as InputRecordingAction))
                            }}
                            className={COMPACT_EDITOR_INPUT_CLASS}
                          />
                        </label>
                      </div>
                    </>
                  )}

                  {selectedAction.kind === 'mouseWheel' && (
                    <>
                      <div className="grid grid-cols-2 gap-2">
                        <label className="space-y-1 text-[10px] text-slate-500 dark:text-slate-400">
                          X
                          <input
                            type="number"
                            value={selectedAction.x}
                            onChange={(event) => {
                              const x = toFiniteNumber(event.target.value, selectedAction.x)
                              updateSelectedAction((action) => ({ ...action, x } as InputRecordingAction))
                            }}
                            className={COMPACT_EDITOR_INPUT_CLASS}
                          />
                        </label>
                        <label className="space-y-1 text-[10px] text-slate-500 dark:text-slate-400">
                          Y
                          <input
                            type="number"
                            value={selectedAction.y}
                            onChange={(event) => {
                              const y = toFiniteNumber(event.target.value, selectedAction.y)
                              updateSelectedAction((action) => ({ ...action, y } as InputRecordingAction))
                            }}
                            className={COMPACT_EDITOR_INPUT_CLASS}
                          />
                        </label>
                      </div>
                      <label className="block space-y-1 text-[10px] text-slate-500 dark:text-slate-400">
                        vertical
                        <input
                          type="number"
                          value={selectedAction.vertical}
                          onChange={(event) => {
                            const vertical = toFiniteNumber(event.target.value, selectedAction.vertical)
                            updateSelectedAction((action) => ({ ...action, vertical } as InputRecordingAction))
                          }}
                          className={COMPACT_EDITOR_INPUT_CLASS}
                        />
                      </label>
                    </>
                  )}

                  {selectedAction.kind === 'mouseMovePath' && (
                    <>
                      <div className="grid grid-cols-3 gap-2">
                        <label className="space-y-1 text-[10px] text-slate-500 dark:text-slate-400">
                          durationMs
                          <input
                            type="number"
                            value={selectedAction.durationMs}
                            onChange={(event) => {
                              const duration = Math.max(0, Math.round(toFiniteNumber(event.target.value, selectedAction.durationMs)))
                              updateSelectedAction((action) => ({ ...action, durationMs: duration } as InputRecordingAction))
                            }}
                            className={COMPACT_EDITOR_INPUT_CLASS}
                          />
                        </label>
                        <label className="space-y-1 text-[10px] text-slate-500 dark:text-slate-400">
                          distancePx
                          <input
                            type="number"
                            value={selectedAction.distancePx}
                            onChange={(event) => {
                              const distance = Math.max(0, toFiniteNumber(event.target.value, selectedAction.distancePx))
                              updateSelectedAction((action) => ({ ...action, distancePx: distance } as InputRecordingAction))
                            }}
                            className={COMPACT_EDITOR_INPUT_CLASS}
                          />
                        </label>
                        <label className="space-y-1 text-[10px] text-slate-500 dark:text-slate-400">
                          simplifiedFrom
                          <input
                            type="number"
                            value={selectedAction.simplifiedFrom}
                            onChange={(event) => {
                              const simplifiedFrom = Math.max(0, Math.round(toFiniteNumber(event.target.value, selectedAction.simplifiedFrom)))
                              updateSelectedAction((action) => ({ ...action, simplifiedFrom } as InputRecordingAction))
                            }}
                            className={COMPACT_EDITOR_INPUT_CLASS}
                          />
                        </label>
                      </div>

                      <div className="space-y-1">
                        <div className="flex items-center justify-between px-0.5">
                          <span className="text-[11px] font-semibold text-slate-600 dark:text-slate-300">轨迹点</span>
                          <div className="flex items-center gap-1">
                            <button
                              type="button"
                              onClick={() => {
                                const points = selectedAction.points
                                const last = points[points.length - 1]
                                const nextPoint = last
                                  ? {
                                      x: last.x + 10,
                                      y: last.y + 10,
                                      timestampMs: getPointTs(last) + 16,
                                    }
                                  : { x: 0, y: 0, timestampMs: getActionTs(selectedAction) }
                                updateSelectedAction((action) =>
                                  normalizeMovePath({
                                    ...(action as Extract<InputRecordingAction, { kind: 'mouseMovePath' }>),
                                    points: [...(action as Extract<InputRecordingAction, { kind: 'mouseMovePath' }>).points, nextPoint],
                                  }),
                                )
                              }}
                              className="rounded border border-slate-300 px-1.5 py-0.5 text-[10px] text-slate-600 transition-colors hover:bg-slate-100 dark:border-neutral-700 dark:text-slate-300 dark:hover:bg-neutral-800"
                            >
                              + 点
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                updateSelectedAction((action) =>
                                  normalizeMovePath(action as Extract<InputRecordingAction, { kind: 'mouseMovePath' }>),
                                )
                              }}
                              className="rounded border border-emerald-300 px-1.5 py-0.5 text-[10px] text-emerald-700 transition-colors hover:bg-emerald-50 dark:border-emerald-700 dark:text-emerald-300 dark:hover:bg-emerald-900/20"
                            >
                              重新计算
                            </button>
                          </div>
                        </div>

                        <div className="max-h-40 overflow-y-auto rounded-md border border-slate-200 px-2 dark:border-neutral-700">
                          {selectedAction.points.map((point, pointIndex) => (
                            <div key={`pt-${pointIndex}`} className="grid grid-cols-[1fr_1fr_1fr_auto] gap-1.5 border-b border-slate-100 py-1.5 text-[11px] last:border-b-0 dark:border-neutral-800">
                              <input
                                type="number"
                                value={point.x}
                                onChange={(event) => {
                                  const x = toFiniteNumber(event.target.value, point.x)
                                  updateSelectedAction((action) => {
                                    const move = action as Extract<InputRecordingAction, { kind: 'mouseMovePath' }>
                                    const points = move.points.slice()
                                    points[pointIndex] = { ...points[pointIndex], x }
                                    return normalizeMovePath({ ...move, points })
                                  })
                                }}
                                className={COMPACT_EDITOR_POINT_INPUT_CLASS}
                              />
                              <input
                                type="number"
                                value={point.y}
                                onChange={(event) => {
                                  const y = toFiniteNumber(event.target.value, point.y)
                                  updateSelectedAction((action) => {
                                    const move = action as Extract<InputRecordingAction, { kind: 'mouseMovePath' }>
                                    const points = move.points.slice()
                                    points[pointIndex] = { ...points[pointIndex], y }
                                    return normalizeMovePath({ ...move, points })
                                  })
                                }}
                                className={COMPACT_EDITOR_POINT_INPUT_CLASS}
                              />
                              <input
                                type="number"
                                value={getPointTs(point)}
                                onChange={(event) => {
                                  const timestampMs = Math.max(0, Math.round(toFiniteNumber(event.target.value, getPointTs(point))))
                                  updateSelectedAction((action) => {
                                    const move = action as Extract<InputRecordingAction, { kind: 'mouseMovePath' }>
                                    const points = move.points.slice()
                                    points[pointIndex] = { ...points[pointIndex], timestampMs }
                                    return normalizeMovePath({ ...move, points })
                                  })
                                }}
                                className={COMPACT_EDITOR_POINT_INPUT_CLASS}
                              />
                              <button
                                type="button"
                                onClick={() => {
                                  updateSelectedAction((action) => {
                                    const move = action as Extract<InputRecordingAction, { kind: 'mouseMovePath' }>
                                    const points = move.points.filter((_, index) => index !== pointIndex)
                                    return normalizeMovePath({ ...move, points })
                                  })
                                }}
                                className="rounded border border-rose-300 px-1.5 py-1 text-[10px] text-rose-700 transition-colors hover:bg-rose-50 dark:border-rose-700 dark:text-rose-300 dark:hover:bg-rose-900/20"
                              >
                                删除
                              </button>
                            </div>
                          ))}
                        </div>
                      </div>
                    </>
                  )}

                  <div className="space-y-1">
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] font-semibold text-slate-600 dark:text-slate-300">原始 JSON（高级修改）</span>
                      <button
                        type="button"
                        onClick={applyRawJsonUpdate}
                        className="rounded-md border border-cyan-300 px-2 py-0.5 text-[11px] text-cyan-700 transition-colors hover:bg-cyan-50 dark:border-cyan-700 dark:text-cyan-300 dark:hover:bg-cyan-900/20"
                      >
                        应用 JSON
                      </button>
                    </div>
                    <textarea
                      value={rawJsonDraft}
                      onChange={(event) => setRawJsonDraft(event.target.value)}
                      className={COMPACT_EDITOR_TEXTAREA_CLASS}
                    />
                    {rawJsonError && (
                      <p className="text-[11px] text-rose-600 dark:text-rose-400">{rawJsonError}</p>
                    )}
                  </div>
                </div>
              ) : (
                <div className="text-xs text-slate-400 dark:text-slate-500">请先从时间轴或事件总览中选择一个事件。</div>
              )}
            </div>
          </aside>
        </div>
      </div>
    </div>
  )
}