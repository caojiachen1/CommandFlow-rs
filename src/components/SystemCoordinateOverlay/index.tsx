import { useEffect, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { getCurrentWindow } from '@tauri-apps/api/window'

export default function SystemCoordinateOverlay() {
  const [finishing, setFinishing] = useState(false)

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      if (finishing) return

      setFinishing(true)
      void invoke('cancel_coordinate_pick', { reason: '用户取消坐标拾取' })
        .catch(() => undefined)
        .finally(() => {
          void getCurrentWindow().close().catch(() => undefined)
        })
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [finishing])

  const onMouseDown = (event: React.MouseEvent<HTMLDivElement>) => {
    event.preventDefault()

    if (finishing) return

    if (event.button === 2) {
      setFinishing(true)
      void invoke('cancel_coordinate_pick', { reason: '用户取消坐标拾取' })
        .catch(() => undefined)
        .finally(() => {
          void getCurrentWindow().close().catch(() => undefined)
        })
      return
    }

    if (event.button !== 0) return

    setFinishing(true)
    void invoke('confirm_coordinate_pick')
      .catch(() => undefined)
      .finally(() => {
        void getCurrentWindow().close().catch(() => undefined)
      })
  }

  return (
    <div
      className="fixed inset-0 z-[9999] cursor-crosshair bg-black/20"
      onMouseDown={onMouseDown}
      onContextMenu={(event) => event.preventDefault()}
    >
      <div className="pointer-events-none absolute left-1/2 top-8 -translate-x-1/2 rounded-xl border border-white/20 bg-black/45 px-4 py-2 text-xs font-semibold text-white backdrop-blur">
        坐标拾取中：单击确认，右键或 Esc 取消
      </div>
    </div>
  )
}
