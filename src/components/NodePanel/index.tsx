import { useEffect, useMemo, useState } from 'react'
import type { NodeKind } from '../../types/workflow'
import { NODE_PALETTE_CATEGORIES } from '../../utils/nodeCatalog'

const STORAGE_KEY = 'commandflow.nodepanel.collapsed.categories.v1'

export default function NodePanel() {
  const allCategoryTitles = useMemo(() => NODE_PALETTE_CATEGORIES.map((category) => category.title), [])

  const [collapsed, setCollapsed] = useState<Record<string, boolean>>(() => {
    const defaults = allCategoryTitles.reduce<Record<string, boolean>>((acc, title) => {
      acc[title] = false
      return acc
    }, {})

    try {
      const raw = localStorage.getItem(STORAGE_KEY)
      if (!raw) return defaults
      const parsed = JSON.parse(raw) as Record<string, unknown>
      for (const title of allCategoryTitles) {
        if (typeof parsed[title] === 'boolean') {
          defaults[title] = parsed[title] as boolean
        }
      }
    } catch {
      // ignore invalid storage payload
    }

    return defaults
  })

  const handleDragStart = (event: React.DragEvent<HTMLDivElement>, kind: NodeKind) => {
    event.dataTransfer.setData('text/plain', kind)
    event.dataTransfer.setData('application/reactflow', kind)
    event.dataTransfer.effectAllowed = 'move'
  }

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(collapsed))
    } catch {
      // ignore storage failures
    }
  }, [collapsed])

  const toggleCategory = (title: string) => {
    setCollapsed((prev) => ({
      ...prev,
      [title]: !prev[title],
    }))
  }

  const setAllCollapsed = (next: boolean) => {
    setCollapsed(() =>
      allCategoryTitles.reduce<Record<string, boolean>>((acc, title) => {
        acc[title] = next
        return acc
      }, {}),
    )
  }

  return (
    <aside className="flex h-full min-h-0 flex-col border-r border-slate-200 bg-slate-50/50 backdrop-blur-md dark:border-neutral-800 dark:bg-black/20">
      <div className="flex h-12 shrink-0 items-center justify-between border-b border-slate-200 px-4 dark:border-neutral-800">
        <h2 className="text-[11px] font-bold uppercase tracking-widest text-slate-500 dark:text-slate-400">节点工具箱</h2>
        <div className="flex items-center gap-1 text-[10px]">
          <button
            type="button"
            onClick={() => setAllCollapsed(false)}
            className="rounded-md px-2 py-1 font-semibold text-slate-500 transition-colors hover:bg-slate-200/80 hover:text-cyan-600 dark:text-slate-400 dark:hover:bg-neutral-800 dark:hover:text-cyan-400"
          >
            展开
          </button>
          <button
            type="button"
            onClick={() => setAllCollapsed(true)}
            className="rounded-md px-2 py-1 font-semibold text-slate-500 transition-colors hover:bg-slate-200/80 hover:text-cyan-600 dark:text-slate-400 dark:hover:bg-neutral-800 dark:hover:text-cyan-400"
          >
            收起
          </button>
        </div>
      </div>
      <div className="min-h-0 flex-1 space-y-6 overflow-y-auto p-4 scrollbar-thin scrollbar-thumb-slate-200 dark:scrollbar-thumb-slate-800">
        {NODE_PALETTE_CATEGORIES.map((category) => (
          <section key={category.title} className="space-y-3">
            <div className="rounded-xl border border-slate-200/80 bg-white/60 dark:border-neutral-800 dark:bg-neutral-900/40">
              <button
                type="button"
                onClick={() => toggleCategory(category.title)}
                className="flex w-full items-center gap-2 rounded-xl px-3 py-2.5 text-left transition-colors hover:bg-slate-100/70 dark:hover:bg-neutral-800/70"
              >
                <svg
                  className={`h-3.5 w-3.5 text-slate-400 transition-transform ${collapsed[category.title] ? '-rotate-90' : 'rotate-0'}`}
                  viewBox="0 0 20 20"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                >
                  <path d="M6 8l4 4 4-4" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                <span className="text-[11px] font-semibold text-slate-700 dark:text-slate-200">{category.title}</span>
                <span className="ml-auto rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-500 dark:bg-neutral-800 dark:text-slate-400">
                  {category.items.length}
                </span>
              </button>

              {!collapsed[category.title] && (
                <div className="grid grid-cols-1 gap-2 px-2 pb-2">
                  {category.items.map((item) => (
                    <div
                      key={item.kind}
                      draggable
                      onDragStart={(event) => handleDragStart(event, item.kind)}
                      className="group flex cursor-grab items-center gap-3 rounded-xl border border-slate-200 bg-white p-3 shadow-sm transition-all hover:border-cyan-500 hover:shadow-xl hover:shadow-cyan-500/10 active:cursor-grabbing dark:border-neutral-800 dark:bg-neutral-900/50 dark:hover:border-cyan-500"
                    >
                      <item.icon className="h-4 w-4 shrink-0 text-white transition-colors group-hover:text-white" size={18} strokeWidth={2.2} />
                      <span className="min-w-0 flex-1 text-xs font-semibold text-white group-hover:text-white">
                        {item.label}
                      </span>
                      <div className="ml-auto opacity-0 transition-opacity group-hover:opacity-100">
                        <svg className="h-3.5 w-3.5 text-slate-300 dark:text-slate-600" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M12 5v14M5 12h14" />
                        </svg>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </section>
        ))}
      </div>
    </aside>
  )
}
