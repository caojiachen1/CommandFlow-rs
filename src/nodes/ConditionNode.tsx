import type { NodeProps } from '@xyflow/react'
import BaseNode from './BaseNode'
import type { WorkflowNodeData } from '../types/workflow'

export default function ConditionNode({ data, selected }: NodeProps) {
  return <BaseNode data={data as WorkflowNodeData} tone="control" selected={selected} />
}
