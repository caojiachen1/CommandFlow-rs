import { useEffect, useMemo, useRef, useState } from 'react'

interface SmartInputSelectProps {
  value: string
  placeholder?: string
  options: string[]
  onChange: (nextValue: string) => void
  onEnter?: () => void
  hint?: string
}

const dedupe = (values: string[]) => Array.from(new Set(values.filter((item) => item.trim().length > 0)))

export default function SmartInputSelect({ value, placeholder, options, onChange, onEnter, hint }: SmartInputSelectProps) {
  const [open, setOpen] = useState(false)
  const [activeIndex, setActiveIndex] = useState(0)
  const rootRef = useRef<HTMLDivElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const allOptions = useMemo(() => dedupe(options), [options])
  const filteredOptions = useMemo(() => {
    const keyword = value.trim().toLowerCase()
    if (!keyword) return allOptions
    return allOptions.filter((option) => option.toLowerCase().includes(keyword))
  }, [allOptions, value])

  useEffect(() => {
    if (!open) return
    const onDocumentClick = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', onDocumentClick)
    return () => document.removeEventListener('mousedown', onDocumentClick)
  }, [open])

  useEffect(() => {
    if (!open) return
    const bounded = Math.max(0, Math.min(activeIndex, filteredOptions.length - 1))
    setActiveIndex(bounded)
  }, [activeIndex, filteredOptions.length, open])

  useEffect(() => {
    if (!open) return
    const menu = menuRef.current
    if (!menu) return
    const item = menu.querySelector<HTMLElement>(`[data-option-index="${activeIndex}"]`)
    item?.scrollIntoView({ block: 'nearest' })
  }, [activeIndex, open])

  const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setOpen(true)
      if (filteredOptions.length > 0) {
        setActiveIndex((idx) => Math.min(idx + 1, filteredOptions.length - 1))
      }
      return
    }

    if (event.key === 'ArrowUp') {
      event.preventDefault()
      setOpen(true)
      if (filteredOptions.length > 0) {
        setActiveIndex((idx) => Math.max(idx - 1, 0))
      }
      return
    }

    if (event.key === 'Enter') {
      if (open && filteredOptions.length > 0) {
        event.preventDefault()
        const picked = filteredOptions[activeIndex]
        if (picked !== undefined) {
          onChange(picked)
        }
        setOpen(false)
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
          value={value}
          placeholder={placeholder}
          onFocus={() => {
            setOpen(true)
            if (allOptions.length > 0) {
              setActiveIndex(0)
            }
          }}
          onChange={(event) => {
            onChange(event.target.value)
            setOpen(true)
            if (allOptions.length > 0) {
              setActiveIndex(0)
            }
          }}
          onKeyDown={handleKeyDown}
          className="w-full bg-transparent px-1 py-0.5 text-xs text-slate-700 outline-none placeholder:text-slate-400 dark:text-slate-100 dark:placeholder:text-slate-500"
        />
        <button
          type="button"
          onClick={() => setOpen((prev) => !prev)}
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
          ref={menuRef}
          className="absolute z-[260] mt-1.5 max-h-52 w-full overflow-auto rounded-xl border border-slate-200 bg-white/95 p-1 shadow-2xl backdrop-blur-md dark:border-neutral-700 dark:bg-neutral-900/95"
        >
          {filteredOptions.length > 0 ? (
            filteredOptions.map((option, index) => (
              <button
                key={option}
                data-option-index={index}
                type="button"
                className={`block w-full truncate rounded-lg px-2.5 py-2 text-left text-xs transition-colors ${
                  index === activeIndex
                    ? 'bg-cyan-500 text-white'
                    : 'text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-neutral-800'
                }`}
                onMouseEnter={() => setActiveIndex(index)}
                onClick={() => {
                  onChange(option)
                  setOpen(false)
                }}
              >
                {option}
              </button>
            ))
          ) : (
            <div className="px-2.5 py-2 text-xs text-slate-400 dark:text-slate-500">暂无可选项（可直接输入）</div>
          )}
        </div>
      ) : null}

      {hint ? <p className="mt-1 text-[11px] text-slate-400 dark:text-slate-500">{hint}</p> : null}
    </div>
  )
}
