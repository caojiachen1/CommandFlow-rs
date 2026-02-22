import type { NodeKind } from '../../types/workflow'

const groups: Array<{ title: string; items: Array<{ label: string; kind: NodeKind; color: string }> }> = [
  {
    title: '触发器',
    items: [
      { label: '热键触发', kind: 'hotkeyTrigger', color: 'bg-orange-500' },
      { label: '定时触发', kind: 'timerTrigger', color: 'bg-amber-500' },
      { label: '手动触发', kind: 'manualTrigger', color: 'bg-yellow-500' },
      { label: '窗口触发', kind: 'windowTrigger', color: 'bg-lime-500' },
    ],
  },
  {
    title: '动作',
    items: [
      { label: '鼠标点击', kind: 'mouseClick', color: 'bg-cyan-500' },
      { label: '鼠标移动', kind: 'mouseMove', color: 'bg-sky-500' },
      { label: '鼠标拖拽', kind: 'mouseDrag', color: 'bg-blue-500' },
      { label: '鼠标滚轮', kind: 'mouseWheel', color: 'bg-indigo-500' },
      { label: '键盘按键', kind: 'keyboardKey', color: 'bg-blue-500' },
      { label: '键盘输入', kind: 'keyboardInput', color: 'bg-cyan-600' },
      { label: '组合键', kind: 'shortcut', color: 'bg-sky-600' },
      { label: '屏幕截图', kind: 'screenshot', color: 'bg-indigo-500' },
      { label: '窗口激活', kind: 'windowActivate', color: 'bg-violet-500' },
      { label: '执行命令', kind: 'runCommand', color: 'bg-violet-500' },
      { label: '等待延时', kind: 'delay', color: 'bg-purple-500' },
    ],
  },
  {
    title: '控制流',
    items: [
      { label: '条件处理', kind: 'condition', color: 'bg-rose-500' },
      { label: '循环处理', kind: 'loop', color: 'bg-fuchsia-500' },
      { label: '错误处理', kind: 'errorHandler', color: 'bg-red-500' },
      { label: '变量定义', kind: 'varDefine', color: 'bg-pink-500' },
      { label: '变量赋值', kind: 'varSet', color: 'bg-emerald-500' },
    ],
  },
]

export default function NodePanel() {
  const handleDragStart = (event: React.DragEvent<HTMLDivElement>, kind: NodeKind) => {
    event.dataTransfer.setData('text/plain', kind)
    event.dataTransfer.setData('application/reactflow', kind)
    event.dataTransfer.effectAllowed = 'move'
  }

  return (
    <aside className="border-r border-slate-200 bg-slate-50/50 backdrop-blur-md dark:border-neutral-800 dark:bg-black/20">
      <div className="flex h-12 items-center border-b border-slate-200 px-4 dark:border-neutral-800">
        <h2 className="text-[11px] font-bold uppercase tracking-widest text-slate-500 dark:text-slate-400">节点工具箱</h2>
      </div>
      <div className="h-[calc(100%-3rem)] overflow-y-auto p-4 space-y-6 scrollbar-thin scrollbar-thumb-slate-200 dark:scrollbar-thumb-slate-800">
        {groups.map((group) => (
          <section key={group.title}>
            <h3 className="mb-3 flex items-center gap-2 text-[10px] font-bold uppercase tracking-wider text-slate-400">
              <span className="h-[1px] flex-1 bg-slate-200 dark:bg-neutral-800" />
              {group.title}
              <span className="h-[1px] flex-1 bg-slate-200 dark:bg-neutral-800" />
            </h3>
            <div className="grid grid-cols-1 gap-2">
              {group.items.map((item) => (
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
          </section>
        ))}
      </div>
    </aside>
  )
}
