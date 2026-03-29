import { useEffect, useMemo, useRef, useState } from 'react'
import type { StartMenuAppPayload } from '../../utils/execution'
import { getStartMenuAppDisplayName } from '../../utils/startMenuApp'
import StartMenuAppThumbnail from '../StartMenuAppThumbnail'

interface StartMenuAppOptionsListProps {
  apps: StartMenuAppPayload[]
  activeIndex: number
  selectedValue: string
  onHover: (index: number) => void
  onSelect: (app: StartMenuAppPayload) => void
  emptyText: string
  tone?: 'light' | 'dark'
  maxHeightClassName?: string
  textOnly?: boolean
}

const ITEM_HEIGHT = 52
const OVERSCAN = 5

export default function StartMenuAppOptionsList({
  apps,
  activeIndex,
  selectedValue,
  onHover,
  onSelect,
  emptyText,
  tone = 'light',
  maxHeightClassName,
  textOnly = false,
}: StartMenuAppOptionsListProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [scrollTop, setScrollTop] = useState(0)

  const viewportHeight = tone === 'dark' ? 176 : 224
  const totalHeight = apps.length * ITEM_HEIGHT

  const visibleRange = useMemo(() => {
    if (apps.length === 0) {
      return { start: 0, end: 0 }
    }

    const visibleCount = Math.ceil(viewportHeight / ITEM_HEIGHT)
    const start = Math.max(0, Math.floor(scrollTop / ITEM_HEIGHT) - OVERSCAN)
    const end = Math.min(apps.length, start + visibleCount + OVERSCAN * 2)
    return { start, end }
  }, [apps.length, scrollTop, viewportHeight])

  useEffect(() => {
    const container = containerRef.current
    if (!container || apps.length === 0) return

    const itemTop = activeIndex * ITEM_HEIGHT
    const itemBottom = itemTop + ITEM_HEIGHT
    const viewportTop = container.scrollTop
    const viewportBottom = viewportTop + container.clientHeight

    if (itemTop < viewportTop) {
      container.scrollTop = itemTop
      return
    }

    if (itemBottom > viewportBottom) {
      container.scrollTop = itemBottom - container.clientHeight
    }
  }, [activeIndex, apps.length])

  const visibleApps = apps.slice(visibleRange.start, visibleRange.end)

  if (apps.length === 0) {
    return <div className="px-2.5 py-2 text-xs text-slate-400 dark:text-slate-500">{emptyText}</div>
  }

  return (
    <div
      ref={containerRef}
      className={`${maxHeightClassName ?? (tone === 'dark' ? 'max-h-44' : 'max-h-56')} overflow-auto`}
      onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
    >
      <div style={{ height: totalHeight, position: 'relative' }}>
        {visibleApps.map((app, offset) => {
          const index = visibleRange.start + offset
          const selected = app.sourcePath === selectedValue
          const active = index === activeIndex
          const appLabel = getStartMenuAppDisplayName(app)

          return (
            <button
              key={app.sourcePath}
              data-option-index={index}
              type="button"
              onMouseEnter={() => onHover(index)}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => onSelect(app)}
              className={`absolute left-0 right-0 flex items-center gap-2 text-left text-xs transition-colors ${
                textOnly
                  ? (active || selected
                    ? 'font-semibold text-cyan-300'
                    : 'text-slate-200 hover:text-cyan-200')
                  : tone === 'dark'
                    ? active
                      ? 'bg-[#2a2d2e] text-[#f3f3f3]'
                      : 'text-slate-200 hover:bg-white/10'
                    : active
                      ? 'bg-[#2a2d2e] text-[#f3f3f3]'
                      : selected
                        ? 'bg-slate-200/70 text-slate-800 hover:bg-slate-300/70 dark:bg-neutral-800 dark:text-slate-200 dark:hover:bg-neutral-700'
                        : 'text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-neutral-800'
              }`}
              style={{
                top: index * ITEM_HEIGHT,
                height: ITEM_HEIGHT,
                paddingLeft: tone === 'dark' ? 8 : 10,
                paddingRight: tone === 'dark' ? 8 : 10,
                paddingTop: 6,
                paddingBottom: 6,
              }}
            >
              <StartMenuAppThumbnail
                appName={app.appName}
                iconPath={app.iconPath}
                targetPath={app.targetPath}
                sourcePath={app.sourcePath}
                imageClassName={tone === 'dark' ? 'h-8 w-8 shrink-0 rounded-md object-contain' : 'h-9 w-9 shrink-0 rounded-lg object-contain'}
                fallbackClassName={`flex shrink-0 items-center justify-center font-bold ${
                  textOnly
                    ? (tone === 'dark'
                      ? `h-8 w-8 text-[10px] ${active ? 'text-cyan-300' : 'text-slate-300'}`
                      : `h-9 w-9 text-[11px] ${active ? 'text-cyan-600' : 'text-slate-500 dark:text-slate-300'}`)
                    : tone === 'dark'
                      ? `h-8 w-8 rounded-md text-[10px] ${active ? 'bg-white/20 text-white' : 'bg-white/10 text-slate-200'}`
                      : `h-9 w-9 rounded-lg text-[11px] ${active ? 'bg-white/20 text-white' : 'bg-slate-200 text-slate-600 dark:bg-neutral-800 dark:text-slate-300'}`
                }`}
              />
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium">{appLabel}</span>
                <span className={`block truncate text-[10px] ${active ? 'text-slate-300' : 'text-slate-400 dark:text-slate-500'}`}>
                  {app.targetPath || app.sourcePath}
                </span>
              </span>
            </button>
          )
        })}
      </div>
    </div>
  )
}