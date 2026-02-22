import { useMemo, useState } from 'react'
import { useWorkflowStore } from '../../stores/workflowStore'

export default function PropertyPanel() {
  const { selectedNodeId, nodes, updateNodeParams } = useWorkflowStore()
  const selectedNode = useMemo(
    () => nodes.find((node) => node.id === selectedNodeId) ?? null,
    [nodes, selectedNodeId],
  )

  const [draft, setDraft] = useState('{}')

  const apply = () => {
    if (!selectedNode) return
    try {
      const parsed = JSON.parse(draft)
      updateNodeParams(selectedNode.id, parsed)
    } catch (e) {
      console.error("Invalid JSON", e)
    }
  }

  return (
    <section className="flex h-1/3 flex-col border-b border-slate-200 p-4 dark:border-neutral-800">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-[11px] font-bold uppercase tracking-widest text-slate-500 dark:text-slate-400">属性面板</h2>
        {selectedNode && (
          <span className="rounded-full bg-cyan-100 px-2.5 py-0.5 text-[10px] font-bold text-cyan-700 dark:bg-cyan-900/30 dark:text-cyan-400">
            {selectedNode.data.kind}
          </span>
        )}
      </div>

      <div className="flex-1 overflow-y-auto pr-1 scrollbar-thin scrollbar-thumb-slate-200 dark:scrollbar-thumb-slate-800">
        {!selectedNode ? (
          <div className="flex h-full flex-col items-center justify-center rounded-xl border border-dashed border-slate-300 p-8 text-center text-[11px] text-slate-400 dark:border-neutral-800">
            <svg className="mb-3 h-8 w-8 opacity-20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-7" />
              <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
            </svg>
            请选择一个节点以编辑其属性
          </div>
        ) : (
          <div className="space-y-4">
            <div className="space-y-2">
              <label className="text-[10px] font-bold uppercase tracking-wider text-slate-400">节点名称</label>
              <div className="rounded-xl border border-slate-200 bg-white/70 px-4 py-2.5 text-xs font-semibold shadow-sm dark:border-neutral-700 dark:bg-neutral-900/70">
                {selectedNode.data.label}
              </div>
            </div>

            <div className="space-y-2">
              <label className="text-[10px] font-bold uppercase tracking-wider text-slate-400">节点参数 (JSON)</label>
              <textarea
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                className="h-32 w-full resize-none rounded-xl border border-slate-200 bg-white px-4 py-3 font-mono text-xs shadow-inner transition-all focus:border-cyan-500 focus:ring-4 focus:ring-cyan-500/10 dark:border-neutral-700 dark:bg-neutral-900 dark:focus:border-cyan-400 dark:focus:ring-cyan-400/10"
                placeholder='{ "action": "click" }'
              />
            </div>

            <button
              type="button"
              onClick={apply}
              className="w-full rounded-xl bg-cyan-600 py-3 text-xs font-bold text-white shadow-lg shadow-cyan-600/20 transition-all hover:bg-cyan-500 hover:shadow-cyan-500/30 active:scale-[0.98] dark:shadow-cyan-950"
            >
              保存并应用更改
            </button>
          </div>
        )}
      </div>
    </section>
  )
}
