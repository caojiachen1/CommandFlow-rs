import type { NodeProps } from '@xyflow/react'
import BaseNode from './BaseNode'
import type { WorkflowNodeData } from '../types/workflow'

export default function ClickNode({ data, selected }: NodeProps) {
  return <BaseNode data={data as WorkflowNodeData} tone="action" selected={selected} />
}
