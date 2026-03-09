import { useEffect, useMemo, useRef, useState } from 'react'
import type { StartMenuAppPayload } from '../../utils/execution'
import { filterStartMenuApps, getStartMenuAppDisplayName } from '../../utils/startMenuApp'
import StartMenuAppOptionsList from '../StartMenuAppOptionsList'

interface StartMenuAppSelectProps {
  apps: StartMenuAppPayload[]
  value: string
  placeholder?: string
  onSelect: (app: StartMenuAppPayload) => void
  onEnter?: () => void
  hint?: string
}

export default function StartMenuAppSelect({ apps, value, placeholder, onSelect, onEnter, hint }: StartMenuAppSelectProps) {
  const [open, setOpen] = useState(false)
  const [activeIndex, setActiveIndex] = useState(0)
  const [query, setQuery] = useState('')
  const rootRef = useRef<HTMLDivElement>(null)

  const selectedApp = useMemo(
    () => apps.find((app) => app.sourcePath === value) ?? null,
    [apps, value],
  )

  const selectedLabel = selectedApp ? getStartMenuAppDisplayName(selectedApp) : ''
  const filteredApps = useMemo(() => filterStartMenuApps(apps, query), [apps, query])

  useEffect(() => {
    if (!open) {
      setQuery(selectedLabel)
    }
  }, [open, selectedLabel])

  useEffect(() => {
    if (!open) return

    const onDocumentPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false)
      }
    }

    document.addEventListener('pointerdown', onDocumentPointerDown, true)
    return () => document.removeEventListener('pointerdown', onDocumentPointerDown, true)
  }, [open])

  useEffect(() => {
    if (!open) return
    const bounded = Math.max(0, Math.min(activeIndex, filteredApps.length - 1))
    setActiveIndex(bounded)
  }, [activeIndex, filteredApps.length, open])

  const openMenu = () => {
    setOpen(true)
    setActiveIndex(0)
  }

  const commitSelection = (app: StartMenuAppPayload) => {
    onSelect(app)
    setQuery(getStartMenuAppDisplayName(app))
    setOpen(false)
  }

  const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setOpen(true)
      if (filteredApps.length > 0) {
        setActiveIndex((idx) => Math.min(idx + 1, filteredApps.length - 1))
      }
      return
    }

    if (event.key === 'ArrowUp') {
      event.preventDefault()
      setOpen(true)
      if (filteredApps.length > 0) {
        setActiveIndex((idx) => Math.max(idx - 1, 0))
      }
      return
    }

    if (event.key === 'Enter') {
      if (open && filteredApps.length > 0) {
        event.preventDefault()
        const picked = filteredApps[activeIndex]
        if (picked) {
          commitSelection(picked)
        }
      } else if (onEnter) {
        onEnter()
      }
      return
    }

    if (event.key === 'Escape' && open) {
      event.preventDefault()
      setOpen(false)
    }
  }

  return (
    <div ref={rootRef} className="relative">
      <div className="flex items-center gap-1 rounded-xl border border-slate-200 bg-white/85 px-2 py-1.5 shadow-sm backdrop-blur transition-all focus-within:border-cyan-500 focus-within:ring-4 focus-within:ring-cyan-500/10 dark:border-neutral-700 dark:bg-neutral-900/80">
        <input
          type="text"
          value={query}
          placeholder={placeholder}
          onFocus={openMenu}
          onMouseDown={() => {
            if (!open) {
              openMenu()
            }
          }}
          onClick={() => {
            if (!open) {
              openMenu()
            }
          }}
          onChange={(event) => {
            setQuery(event.target.value)
            openMenu()
          }}
          onKeyDown={handleKeyDown}
          className="w-full bg-transparent px-1 py-0.5 text-xs text-slate-700 outline-none placeholder:text-slate-400 dark:text-slate-100 dark:placeholder:text-slate-500"
        />
        <button
          type="button"
          onClick={() => {
            setOpen((prev) => !prev)
            if (!open) {
              setActiveIndex(0)
            }
          }}
          className="rounded-lg px-1.5 py-1 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-neutral-800 dark:hover:text-slate-200"
          aria-label="切换下拉选项"
        >
          <svg className={`h-3.5 w-3.5 transition-transform ${open ? 'rotate-180' : ''}`} viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
            <path
              fillRule="evenodd"
              d="M5.23 7.21a.75.75 0 011.06.02L10 11.168l3.71-3.938a.75.75 0 111.08 1.04l-4.25 4.51a.75.75 0 01-1.08 0l-4.25-4.51a.75.75 0 01.02-1.06z"
              clipRule="evenodd"
            />
          </svg>
        </button>
      </div>

      {open ? (
        <div
          className="absolute z-[260] mt-1.5 w-full rounded-xl border border-slate-200 bg-white/95 p-1 shadow-2xl backdrop-blur-md dark:border-neutral-700 dark:bg-neutral-900/95"
        >
          <StartMenuAppOptionsList
            apps={filteredApps}
            activeIndex={activeIndex}
            selectedValue={value}
            onHover={setActiveIndex}
            onSelect={commitSelection}
            emptyText="暂无匹配应用，请继续输入关键词"
            tone="light"
          />
        </div>
      ) : null}

      {hint ? <p className="mt-1 text-[11px] text-slate-400 dark:text-slate-500">{hint}</p> : null}
    </div>
  )
}