import { useEffect, useMemo, useState } from 'react'
import type { NodeKind } from '../../types/workflow'

interface NodeItem {
  label: string
  kind: NodeKind
  color: string
}

interface NodeCategory {
  title: '触发与流程' | '输入控制' | '系统与文件' | '变量与数据'
  items: NodeItem[]
}

const STORAGE_KEY = 'commandflow.nodepanel.collapsed.categories.v1'

const categories: NodeCategory[] = [
  {
    title: '触发与流程',
    items: [
      { label: '热键触发', kind: 'hotkeyTrigger', color: 'bg-orange-500' },
      { label: '定时触发', kind: 'timerTrigger', color: 'bg-amber-500' },
      { label: '手动触发', kind: 'manualTrigger', color: 'bg-yellow-500' },
      { label: '窗口触发', kind: 'windowTrigger', color: 'bg-lime-500' },
      { label: '条件处理', kind: 'condition', color: 'bg-rose-500' },
      { label: 'for 循环', kind: 'loop', color: 'bg-fuchsia-500' },
      { label: 'while 循环', kind: 'whileLoop', color: 'bg-purple-600' },
      { label: '图像匹配', kind: 'imageMatch', color: 'bg-teal-500' },
    ],
  },
  {
    title: '输入控制',
    items: [
      { label: '鼠标操作', kind: 'mouseOperation', color: 'bg-cyan-500' },
      { label: '键盘操作', kind: 'keyboardOperation', color: 'bg-sky-600' },
    ],
  },
  {
    title: '系统与文件',
    items: [
      { label: '系统操作', kind: 'systemOperation', color: 'bg-red-500' },
      { label: '屏幕截图', kind: 'screenshot', color: 'bg-indigo-500' },
      { label: '切换窗口', kind: 'windowActivate', color: 'bg-violet-500' },
      { label: '复制文件/文件夹', kind: 'fileCopy', color: 'bg-fuchsia-500' },
      { label: '移动文件/文件夹', kind: 'fileMove', color: 'bg-pink-500' },
      { label: '删除文件/文件夹', kind: 'fileDelete', color: 'bg-rose-500' },
      { label: '执行命令', kind: 'runCommand', color: 'bg-violet-500' },
      { label: '执行 Python', kind: 'pythonCode', color: 'bg-blue-600' },
      { label: '读取剪贴板', kind: 'clipboardRead', color: 'bg-emerald-500' },
      { label: '写入剪贴板', kind: 'clipboardWrite', color: 'bg-teal-500' },
      { label: '读取文本文件', kind: 'fileReadText', color: 'bg-fuchsia-600' },
      { label: '写入文本文件', kind: 'fileWriteText', color: 'bg-pink-600' },
      { label: '弹窗提示', kind: 'showMessage', color: 'bg-orange-500' },
      { label: '等待延时', kind: 'delay', color: 'bg-purple-500' },
      { label: 'GUI Agent', kind: 'guiAgent', color: 'bg-violet-600' },
      { label: 'GUI Agent 元数据解析', kind: 'guiAgentActionParser', color: 'bg-violet-500' },
    ],
  },
  {
    title: '变量与数据',
    items: [
      { label: '变量定义', kind: 'varDefine', color: 'bg-pink-500' },
      { label: '变量赋值', kind: 'varSet', color: 'bg-emerald-500' },
      { label: '变量运算', kind: 'varMath', color: 'bg-teal-500' },
      { label: '获取变量值', kind: 'varGet', color: 'bg-cyan-500' },
      { label: '常量输出', kind: 'constValue', color: 'bg-slate-500' },
    ],
  },
]

export default function NodePanel() {
  const allCategoryTitles = useMemo(() => categories.map((category) => category.title), [])

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
        {categories.map((category) => (
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
                      <div className={`h-2.5 w-2.5 rounded-full ${item.color} shadow-sm transition-transform group-hover:scale-125`} />
                      <span className="text-xs font-semibold text-slate-700 dark:text-slate-300 group-hover:text-cyan-600 dark:group-hover:text-cyan-400">
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
