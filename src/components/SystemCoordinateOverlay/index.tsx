import { useEffect, useMemo, useRef, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { previewUiElementPick, type UiElementPreviewPayload } from '../../utils/execution'

const PREVIEW_THROTTLE_MS = 80

export default function SystemCoordinateOverlay() {
  const [finishing, setFinishing] = useState(false)
  const [hoveredElement, setHoveredElement] = useState<UiElementPreviewPayload | null>(null)
  const [overlayOrigin, setOverlayOrigin] = useState({ x: 0, y: 0 })
  const [overlayScaleFactor, setOverlayScaleFactor] = useState(1)
  const previewTimerRef = useRef<number | null>(null)
  const lastPreviewAtRef = useRef(0)

  const pickMode = useMemo(() => {
    const search = new URLSearchParams(window.location.search)
    const mode = (search.get('pickMode') ?? 'coordinate').toLowerCase()
    return mode === 'element' ? 'element' : 'coordinate'
  }, [])

  const isElementMode = pickMode === 'element'

  const closeOverlayWindow = () => {
    void getCurrentWindow().close().catch(() => undefined)
  }

  const cancelPicking = (reason: string) => {
    if (finishing) return
    setFinishing(true)

    const command = isElementMode ? 'cancel_ui_element_pick' : 'cancel_coordinate_pick'
    void invoke(command, { reason })
      .catch(() => undefined)
      .finally(() => {
        closeOverlayWindow()
      })
  }

  const confirmPicking = () => {
    if (finishing) return
    setFinishing(true)

    const command = isElementMode ? 'confirm_ui_element_pick' : 'confirm_coordinate_pick'
    void invoke(command)
      .catch(() => undefined)
      .finally(() => {
        closeOverlayWindow()
      })
  }

  const refreshElementPreview = () => {
    if (!isElementMode || finishing) return

    const now = Date.now()
    const delta = now - lastPreviewAtRef.current

    if (delta < PREVIEW_THROTTLE_MS) {
      if (previewTimerRef.current !== null) {
        window.clearTimeout(previewTimerRef.current)
      }
      previewTimerRef.current = window.setTimeout(() => {
        previewTimerRef.current = null
        refreshElementPreview()
      }, PREVIEW_THROTTLE_MS - delta)
      return
    }

    lastPreviewAtRef.current = now
    void previewUiElementPick()
      .then((payload) => {
        setHoveredElement(payload)
      })
      .catch(() => {
        setHoveredElement(null)
      })
  }

  useEffect(() => {
    let disposed = false

    const refreshOverlayMetrics = async () => {
      try {
        const current = getCurrentWindow()
        const [position, scale] = await Promise.all([
          current.outerPosition(),
          current.scaleFactor(),
        ])

        if (disposed) return
        setOverlayOrigin({ x: position.x, y: position.y })
        setOverlayScaleFactor(scale > 0 ? scale : 1)
      } catch {
        // ignore transient overlay metric failures
      }
    }

    void refreshOverlayMetrics()
    const interval = window.setInterval(() => {
      void refreshOverlayMetrics()
    }, 500)

    return () => {
      disposed = true
      window.clearInterval(interval)
    }
  }, [])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      cancelPicking(isElementMode ? '用户取消元素提取' : '用户取消坐标拾取')
    }

    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [isElementMode, finishing])

  useEffect(() => {
    if (!isElementMode || finishing) {
      setHoveredElement(null)
      return
    }

    refreshElementPreview()
    const interval = window.setInterval(() => {
      refreshElementPreview()
    }, PREVIEW_THROTTLE_MS)

    return () => {
      window.clearInterval(interval)
      if (previewTimerRef.current !== null) {
        window.clearTimeout(previewTimerRef.current)
        previewTimerRef.current = null
      }
    }
  }, [isElementMode, finishing])

  const onMouseDown = (event: React.MouseEvent<HTMLDivElement>) => {
    if (isElementMode) {
      return
    }

    event.preventDefault()

    if (finishing) return

    if (event.button === 2) {
      cancelPicking(isElementMode ? '用户取消元素提取' : '用户取消坐标拾取')
      return
    }

    if (event.button !== 0) return

    confirmPicking()
  }

  const displayRect = useMemo(() => {
    if (!hoveredElement) return null

    const scale = overlayScaleFactor > 0 ? overlayScaleFactor : 1
    const left = (hoveredElement.rect.left - overlayOrigin.x) / scale
    const top = (hoveredElement.rect.top - overlayOrigin.y) / scale
    const right = (hoveredElement.rect.right - overlayOrigin.x) / scale
    const bottom = (hoveredElement.rect.bottom - overlayOrigin.y) / scale

    const width = Math.max(1, right - left)
    const height = Math.max(1, bottom - top)

    return {
      left,
      top,
      right,
      bottom,
      width,
      height,
    }
  }, [hoveredElement, overlayOrigin.x, overlayOrigin.y, overlayScaleFactor])

  const detailPanelPosition = useMemo(() => {
    if (!displayRect) return null

    const viewportWidth = window.innerWidth
    const viewportHeight = window.innerHeight
    const margin = 12
    const panelWidth = 420
    const panelHeight = 190

    const rightCandidate = displayRect.right + margin
    const leftCandidate = displayRect.left - panelWidth - margin

    let left = rightCandidate
    if (rightCandidate + panelWidth > viewportWidth - margin) {
      if (leftCandidate >= margin) {
        left = leftCandidate
      } else {
        left = Math.max(margin, Math.min(viewportWidth - panelWidth - margin, rightCandidate))
      }
    }

    const top = Math.max(margin, Math.min(viewportHeight - panelHeight - margin, displayRect.top))

    return { left, top }
  }, [displayRect])

  return (
    <div
      className="fixed inset-0 z-[9999] cursor-crosshair bg-black/20"
      onMouseDown={onMouseDown}
      onContextMenu={(event) => event.preventDefault()}
    >
      <div className="pointer-events-none absolute left-1/2 top-8 -translate-x-1/2 rounded-xl border border-white/20 bg-black/45 px-4 py-2 text-xs font-semibold text-white backdrop-blur">
        {isElementMode
          ? '元素提取中（穿透模式）：悬停高亮，左键确认加入工作流，右键或 Esc 取消'
          : '坐标拾取中：单击确认，右键或 Esc 取消'}
      </div>

      {isElementMode && hoveredElement && displayRect && detailPanelPosition ? (
        <>
          <div
            className="pointer-events-none absolute rounded-md border border-cyan-300/90 bg-cyan-400/10"
            style={{
              left: displayRect.left,
              top: displayRect.top,
              width: displayRect.width,
              height: displayRect.height,
            }}
          />

          <div
            className="pointer-events-none absolute max-w-[680px] rounded-xl border border-cyan-300/50 bg-black/70 px-4 py-3 text-[11px] text-white shadow-2xl backdrop-blur"
            style={{
              left: detailPanelPosition.left,
              top: detailPanelPosition.top,
            }}
          >
            <div className="font-semibold text-cyan-200">当前悬停元素</div>
            <div className="mt-1 space-y-0.5 text-slate-100">
              <div>名称：{hoveredElement.name || '(无名称)'}</div>
              <div>类名：{hoveredElement.className || '(无类名)'}</div>
              <div>AutomationId：{hoveredElement.automationId || '(无)'}</div>
              <div>
                中心点：({hoveredElement.centerX}, {hoveredElement.centerY})
              </div>
              <div className="text-cyan-100">摘要：{hoveredElement.summary}</div>
              <div className="break-all text-slate-300">指纹：{hoveredElement.locator.fingerprint}</div>
            </div>
          </div>
        </>
      ) : null}
    </div>
  )
}
