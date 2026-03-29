import { useEffect, useMemo, useState } from 'react'
import { Columns2, ListCollapse } from 'lucide-react'
import type { NodeKind } from '../../types/workflow'
import { NODE_PALETTE_CATEGORIES } from '../../utils/nodeCatalog'

const STORAGE_KEY = 'commandflow.nodepanel.collapsed.categories.v1'

interface NodePanelProps {
  onToggleHidden?: () => void
}

export default function NodePanel({ onToggleHidden }: NodePanelProps) {
  const allCategoryTitles = useMemo(() => NODE_PALETTE_CATEGORIES.map((category) => category.title), [])
  const [searchKeyword, setSearchKeyword] = useState('')

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

  const normalizedKeyword = searchKeyword.trim().toLowerCase()
  const searching = normalizedKeyword.length > 0

  const categoryEntries = useMemo(() => {
    return NODE_PALETTE_CATEGORIES
      .map((category) => {
        const items = searching
          ? category.items.filter((item) => item.label.toLowerCase().includes(normalizedKeyword))
          : category.items
        return { category, items }
      })
      .filter((entry) => entry.items.length > 0)
  }, [normalizedKeyword, searching])

  const allExpanded = useMemo(
    () => allCategoryTitles.every((title) => collapsed[title] === false),
    [allCategoryTitles, collapsed],
  )

  return (
    <aside className="cf-window cf-pane flex h-full min-h-0 flex-col border-r border-slate-200 bg-slate-50/50 backdrop-blur-md dark:border-neutral-800 dark:bg-[#1f1f1f]">
      <div className="flex h-11 min-w-0 shrink-0 items-center gap-2 border-b border-slate-200/70 pl-3 pr-1.5 dark:border-neutral-800/80">
        <h2 className="ml-0.5 truncate text-[13px] font-bold tracking-[0.02em] text-slate-700 dark:text-slate-200">节点</h2>
        <div className="ml-1 flex min-w-0 flex-1 items-center gap-1">
          <div className="relative min-w-0 flex-1">
            <svg
              className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <circle cx="11" cy="11" r="7" />
              <path d="m20 20-3.5-3.5" strokeLinecap="round" />
            </svg>
            <input
              type="text"
              value={searchKeyword}
              onChange={(event) => setSearchKeyword(event.target.value)}
              placeholder="搜索节点"
              className="h-7 w-full rounded-md border border-slate-300 bg-white/85 pl-7 pr-6 text-[12px] text-slate-700 outline-none placeholder:text-slate-400 focus:border-cyan-500 dark:border-neutral-700 dark:bg-neutral-900/80 dark:text-slate-100"
            />
            {searchKeyword.length > 0 && (
              <button
                type="button"
                onClick={() => setSearchKeyword('')}
                className="absolute right-1 top-1/2 inline-flex h-5 w-5 -translate-y-1/2 items-center justify-center rounded-sm !border-0 !bg-transparent p-0 text-[14px] leading-none text-slate-400 shadow-none transition-[color,box-shadow,transform] hover:-translate-y-[calc(50%+1px)] hover:!bg-transparent hover:text-slate-700 hover:shadow-[0_0_0_1px_rgba(100,116,139,0.38),0_6px_14px_rgba(15,23,42,0.34)] dark:text-slate-500 dark:hover:!bg-transparent dark:hover:text-white dark:hover:shadow-[0_0_0_1px_rgba(71,85,105,0.75),0_6px_14px_rgba(0,0,0,0.78)]"
                aria-label="清空搜索"
                title="清空搜索"
              >
                ×
              </button>
            )}
          </div>

          <button
            type="button"
            onClick={() => setAllCollapsed(allExpanded)}
            className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md !border-0 !bg-transparent p-0 text-slate-600 shadow-none transition-[color,box-shadow,transform] hover:-translate-y-px hover:!bg-transparent hover:text-slate-900 hover:shadow-[0_0_0_1px_rgba(100,116,139,0.38),0_6px_14px_rgba(15,23,42,0.34)] active:!bg-transparent dark:text-slate-200 dark:hover:!bg-transparent dark:hover:text-white dark:hover:shadow-[0_0_0_1px_rgba(71,85,105,0.75),0_6px_14px_rgba(0,0,0,0.78)]"
            title={allExpanded ? '收回全部分组' : '展开全部分组'}
            aria-label={allExpanded ? '收回全部分组' : '展开全部分组'}
          >
            <ListCollapse className="h-3.5 w-3.5" strokeWidth={2.1} />
          </button>

          <button
            type="button"
            onClick={onToggleHidden}
            className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md !border-0 !bg-transparent p-0 text-slate-600 shadow-none transition-[color,box-shadow,transform] hover:-translate-y-px hover:!bg-transparent hover:text-slate-900 hover:shadow-[0_0_0_1px_rgba(100,116,139,0.38),0_6px_14px_rgba(15,23,42,0.34)] active:!bg-transparent dark:text-slate-200 dark:hover:!bg-transparent dark:hover:text-white dark:hover:shadow-[0_0_0_1px_rgba(71,85,105,0.75),0_6px_14px_rgba(0,0,0,0.78)]"
            title="隐藏节点工具箱"
            aria-label="隐藏节点工具箱"
          >
            <Columns2 className="h-3.5 w-3.5" strokeWidth={2.1} />
          </button>
        </div>
      </div>
      <div className="min-h-0 flex-1 space-y-1 overflow-y-auto p-2 scrollbar-thin scrollbar-thumb-slate-200 dark:scrollbar-thumb-neutral-700">
        {categoryEntries.length === 0 ? (
          <div className="cf-empty mt-2 rounded-md border border-dashed border-slate-300 px-3 py-4 text-center text-[12px] text-slate-500 dark:border-neutral-700 dark:text-slate-400">
            未找到匹配的节点
          </div>
        ) : categoryEntries.map(({ category, items }) => {
          const CategoryIcon = category.items[0]?.icon
          const isCollapsed = searching ? false : collapsed[category.title]
          return (
            <section key={category.title} className="space-y-1">
              <button
                type="button"
                onClick={() => {
                  if (!searching) {
                    toggleCategory(category.title)
                  }
                }}
                className="group !border-0 !bg-transparent flex h-8 w-full items-center gap-2 rounded-md px-2 py-0 text-left transition-colors hover:!bg-slate-300/90 dark:hover:!bg-neutral-700/95"
              >
                <svg
                  className={`h-3.5 w-3.5 shrink-0 text-slate-400 transition-transform ${isCollapsed ? '-rotate-90' : 'rotate-0'}`}
                  viewBox="0 0 20 20"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                >
                  <path d="M6 8l4 4 4-4" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                {CategoryIcon ? (
                  <CategoryIcon className="h-3.5 w-3.5 shrink-0 text-slate-500 dark:text-slate-400" strokeWidth={2.1} />
                ) : null}
                <span className="truncate text-[13px] font-medium text-slate-700 dark:text-slate-200">
                  {category.title}
                </span>
              </button>

              {!isCollapsed && (
                <div className="mt-1.5 space-y-1 pl-7">
                  {items.map((item) => (
                    <div
                      key={item.kind}
                      draggable
                      onDragStart={(event) => handleDragStart(event, item.kind)}
                      className="group flex cursor-grab select-none items-center gap-2 rounded-md px-2 py-1.5 transition-colors hover:bg-slate-300/90 dark:hover:bg-neutral-700/90 active:cursor-grabbing"
                      title="拖拽到画布中创建节点"
                    >
                      <item.icon
                        className="h-3.5 w-3.5 shrink-0 text-slate-500 transition-colors group-hover:text-slate-700 dark:text-slate-400 dark:group-hover:text-slate-200"
                        strokeWidth={2.1}
                      />
                      <span className="min-w-0 flex-1 truncate text-[13px] text-slate-700 dark:text-slate-200">
                        {item.label}
                      </span>
                      <span className="opacity-0 transition-opacity group-hover:opacity-100 text-[11px] text-slate-400 dark:text-slate-500">
                        +
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </section>
          )
        })}
      </div>
    </aside>
  )
}
