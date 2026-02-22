import type { NodeProps } from '@xyflow/react'
import BaseNode from './BaseNode'
import type { WorkflowNodeData } from '../types/workflow'

export default function ImageMatchNode({ data }: NodeProps) {
  return <BaseNode data={data as WorkflowNodeData} tone="action" />
}
