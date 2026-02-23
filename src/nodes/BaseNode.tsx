import { Handle, Position } from '@xyflow/react'
import type { WorkflowNodeData } from '../types/workflow'
import { getNodePortSpec } from '../utils/nodePorts'

interface BaseNodeProps {
  data: WorkflowNodeData
  tone?: 'trigger' | 'action' | 'control'
  selected?: boolean
}

const tones = {
  trigger: 'border-emerald-500/70 bg-emerald-50 text-emerald-900 dark:bg-emerald-900/30 dark:text-emerald-100',
  action: 'border-cyan-500/70 bg-cyan-50 text-cyan-900 dark:bg-cyan-900/30 dark:text-cyan-100',
  control: 'border-amber-500/70 bg-amber-50 text-amber-900 dark:bg-amber-900/30 dark:text-amber-100',
}

const selectedStyles = {
  trigger: 'border-emerald-500 ring-1 ring-emerald-400 ring-offset-1 ring-offset-emerald-50 dark:ring-offset-emerald-900/30',
  action: 'border-cyan-500 ring-1 ring-cyan-400 ring-offset-1 ring-offset-cyan-50 dark:ring-offset-cyan-900/30',
  control: 'border-amber-500 ring-1 ring-amber-400 ring-offset-1 ring-offset-amber-50 dark:ring-offset-amber-900/30',
}

export default function BaseNode({ data, tone = 'action', selected = false }: BaseNodeProps) {
  const isSelected = selected
  const portSpec = getNodePortSpec(data.kind)

  const calcTop = (index: number, total: number) => `${((index + 1) / (total + 1)) * 100}%`

  return (
    <div
      className={`relative min-w-[180px] rounded-lg border px-3 py-2 shadow-sm transition-all duration-200 ${tones[tone]} ${
        isSelected ? selectedStyles[tone] : ''
      }`}
    >
      {portSpec.inputs.map((input, index) => (
        <Handle
          key={`target-${input.id}`}
          id={input.id}
          type="target"
          position={Position.Left}
          style={{ top: calcTop(index, portSpec.inputs.length) }}
          className="!h-2 !w-2"
        />
      ))}
      <div className="text-xs font-semibold">{data.label}</div>
      <div className="mt-1 text-[8px] opacity-70">{data.description ?? data.kind}</div>

      {portSpec.outputs.map((output, index) => (
        <div key={`source-wrap-${output.id}`}>
          <Handle
            id={output.id}
            type="source"
            position={Position.Right}
            style={{ top: calcTop(index, portSpec.outputs.length) }}
            className="!h-2 !w-2"
          />
          {portSpec.outputs.length > 1 && output.label ? (
            <span
              className="pointer-events-none absolute right-3 -translate-y-1/2 text-[10px] font-semibold opacity-70"
              style={{ top: calcTop(index, portSpec.outputs.length) }}
            >
              {output.label}
            </span>
          ) : null}
        </div>
      ))}
    </div>
  )
}
