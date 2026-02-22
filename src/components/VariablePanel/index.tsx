interface VariablePanelProps {
  expanded: boolean
  onToggle: () => void
}

export default function VariablePanel({ expanded, onToggle }: VariablePanelProps) {
  return (
    <section className="flex flex-col border-b border-slate-200 dark:border-neutral-800">
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center justify-between p-4 hover:bg-slate-100/50 dark:hover:bg-slate-800/30 transition-colors"
      >
        <h2 className="text-[11px] font-bold uppercase tracking-widest text-slate-500 dark:text-slate-400">变量查看器</h2>
        <svg
          className={`h-4 w-4 text-slate-400 transition-transform duration-200 ${expanded ? 'rotate-180' : ''}`}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        >
          <path d="M6 9l6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {expanded && (
        <div className="flex flex-1 flex-col items-center justify-center rounded-xl border border-dashed border-slate-300 p-6 text-[11px] text-slate-400 dark:border-neutral-800 m-4 mt-0">
          <svg className="mb-3 h-8 w-8 text-slate-300 opacity-30 dark:text-slate-700" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" strokeLinecap="round" strokeLinejoin="round" />
            <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          运行后在此查看变量状态
        </div>
      )}
    </section>
  )
}
