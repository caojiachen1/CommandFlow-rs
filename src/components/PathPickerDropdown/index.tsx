import { useEffect, useRef, useState } from 'react'
import { open as openDialog } from '@tauri-apps/plugin-dialog'

interface PathPickerDropdownProps {
  fieldLabel: string
  onSelect: (value: string) => void
  buttonLabel?: string
  className?: string
}

const MENU_OPTIONS = [
  { label: '选择文件', directory: false },
  { label: '选择文件夹', directory: true },
]

const TRIGGER_BUTTON_CLASS =
  'rounded-xl border border-slate-200 bg-white/85 px-2.5 py-2 text-xs font-semibold text-slate-600 shadow-sm backdrop-blur transition-all hover:border-cyan-500 hover:text-cyan-600 focus:border-cyan-500 focus:outline-none focus:ring-4 focus:ring-cyan-500/10 dark:border-neutral-700 dark:bg-neutral-900/80 dark:text-slate-300 dark:hover:text-cyan-400'

export default function PathPickerDropdown({
  fieldLabel,
  onSelect,
  buttonLabel = '浏览',
  className,
}: PathPickerDropdownProps) {
  const [isOpen, setIsOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!isOpen) return
    const handleOutsideClick = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false)
      }
    }
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsOpen(false)
      }
    }
    document.addEventListener('mousedown', handleOutsideClick)
    document.addEventListener('keydown', handleEscape)
    return () => {
      document.removeEventListener('mousedown', handleOutsideClick)
      document.removeEventListener('keydown', handleEscape)
    }
  }, [isOpen])

  const handleOptionClick = async (directory: boolean) => {
    setIsOpen(false)
    try {
      const resolvedLabel = fieldLabel?.trim().length ? fieldLabel : '路径'
      const picked = await openDialog({
        directory,
        multiple: false,
        title: `${resolvedLabel}（${directory ? '选择文件夹' : '选择文件'}）`,
      })
      if (typeof picked === 'string' && picked.trim().length > 0) {
        onSelect(picked)
      }
    } catch {
      // 用户取消或运行在非 Tauri 环境，静默忽略
    }
  }

  return (
    <div ref={containerRef} className={`relative inline-flex ${className ?? ''}`}>
      <button
        type="button"
        aria-expanded={isOpen}
        aria-haspopup="menu"
        className={`${TRIGGER_BUTTON_CLASS} flex items-center justify-center gap-1`}
        onClick={() => setIsOpen((prev) => !prev)}
      >
        {buttonLabel}
        <span aria-hidden className="text-[9px]">▾</span>
      </button>
      {isOpen && (
        <div className="absolute right-0 top-full z-10 mt-1 min-w-[140px] rounded-xl border border-slate-200 bg-white py-1 shadow-lg ring-1 ring-slate-900/5 dark:border-neutral-700 dark:bg-neutral-900/95">
          {MENU_OPTIONS.map((option) => (
            <button
              key={option.label}
              type="button"
              className="w-full rounded-xl px-3 py-2 text-left text-xs font-semibold text-slate-600 transition-colors hover:bg-slate-100 hover:text-cyan-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500 dark:text-slate-300 dark:hover:bg-neutral-800/60 dark:hover:text-cyan-400"
              onClick={(event) => {
                event.stopPropagation()
                void handleOptionClick(option.directory)
              }}
            >
              {option.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
