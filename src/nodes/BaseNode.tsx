import { Handle, Position } from '@xyflow/react'
import type { WorkflowNodeData } from '../types/workflow'

interface BaseNodeProps {
  data: WorkflowNodeData
  tone?: 'trigger' | 'action' | 'control'
}

const tones = {
  trigger: 'border-emerald-500/70 bg-emerald-50 text-emerald-900 dark:bg-emerald-900/30 dark:text-emerald-100',
  action: 'border-cyan-500/70 bg-cyan-50 text-cyan-900 dark:bg-cyan-900/30 dark:text-cyan-100',
  control: 'border-amber-500/70 bg-amber-50 text-amber-900 dark:bg-amber-900/30 dark:text-amber-100',
}

export default function BaseNode({ data, tone = 'action' }: BaseNodeProps) {
  return (
    <div className={`min-w-[180px] rounded-lg border px-3 py-2 shadow-sm ${tones[tone]}`}>
      <Handle type="target" position={Position.Left} className="!h-2 !w-2" />
      <div className="text-xs font-semibold">{data.label}</div>
      <div className="mt-1 text-[11px] opacity-80">{data.description ?? data.kind}</div>
      <Handle type="source" position={Position.Right} className="!h-2 !w-2" />
    </div>
  )
}
