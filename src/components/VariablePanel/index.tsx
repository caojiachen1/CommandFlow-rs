export default function VariablePanel() {
  return (
    <section className="flex h-full flex-col overflow-hidden">
      <div className="flex shrink-0 items-center justify-between border-b border-slate-200 bg-slate-50/50 px-3 py-2 dark:border-neutral-800 dark:bg-neutral-900/30">
        <h2 className="text-[11px] font-bold uppercase tracking-widest text-slate-500 dark:text-slate-400">变量查看器</h2>
      </div>
      <div className="flex flex-1 items-center justify-center overflow-hidden text-[11px] text-slate-400">
        <div className="flex flex-col items-center rounded-xl border border-dashed border-slate-300 px-6 py-8 text-center dark:border-neutral-800">
          <svg className="mb-3 h-8 w-8 text-slate-300 opacity-30 dark:text-slate-700" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" strokeLinecap="round" strokeLinejoin="round" />
            <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          运行后在此查看变量状态
        </div>
      </div>
    </section>
  )
}
