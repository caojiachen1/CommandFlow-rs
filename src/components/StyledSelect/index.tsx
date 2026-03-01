import { useEffect, useMemo, useRef, useState } from 'react'

export interface StyledSelectOption {
  label: string
  value: string
}

interface StyledSelectProps {
  value: string
  options: StyledSelectOption[]
  onChange: (nextValue: string) => void
  placeholder?: string
  onEnter?: () => void
}

export default function StyledSelect({ value, options, onChange, placeholder, onEnter }: StyledSelectProps) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)

  const normalizedOptions = useMemo(() => {
    const seen = new Set<string>()
    return options.filter((option) => {
      if (seen.has(option.value)) return false
      seen.add(option.value)
      return true
    })
  }, [options])

  const selectedOption = normalizedOptions.find((item) => item.value === value)

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

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        className="flex w-full items-center gap-2 rounded-xl border border-slate-200 bg-white/85 px-3 py-2 text-xs text-slate-700 shadow-sm backdrop-blur transition-all hover:border-cyan-400 focus:border-cyan-500 focus:outline-none focus:ring-4 focus:ring-cyan-500/10 dark:border-neutral-700 dark:bg-neutral-900/80 dark:text-slate-100"
        onClick={() => setOpen((prev) => !prev)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && onEnter) {
            event.preventDefault()
            onEnter()
          }
          if (event.key === 'Escape') {
            event.preventDefault()
            setOpen(false)
          }
        }}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span className="truncate">{selectedOption?.label ?? placeholder ?? '请选择'}</span>
        <span className="ml-auto text-slate-400">
          <svg className={`h-3.5 w-3.5 transition-transform ${open ? 'rotate-180' : ''}`} viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
            <path
              fillRule="evenodd"
              d="M5.23 7.21a.75.75 0 011.06.02L10 11.168l3.71-3.938a.75.75 0 111.08 1.04l-4.25 4.51a.75.75 0 01-1.08 0l-4.25-4.51a.75.75 0 01.02-1.06z"
              clipRule="evenodd"
            />
          </svg>
        </span>
      </button>

      {open ? (
        <div className="absolute z-[260] mt-1.5 max-h-56 w-full overflow-auto rounded-xl border border-slate-200 bg-white/95 p-1 shadow-2xl backdrop-blur-md dark:border-neutral-700 dark:bg-neutral-900/95">
          {normalizedOptions.map((option) => (
            <button
              key={option.value}
              type="button"
              className={`block w-full truncate rounded-lg px-2.5 py-2 text-left text-xs transition-colors ${
                option.value === value
                  ? 'bg-cyan-500 text-white'
                  : 'text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-neutral-800'
              }`}
              onClick={() => {
                onChange(option.value)
                setOpen(false)
              }}
            >
              {option.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  )
}
