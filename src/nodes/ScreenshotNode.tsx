import type { NodeProps } from '@xyflow/react'
import BaseNode from './BaseNode'
import type { WorkflowNodeData } from '../types/workflow'

export default function ScreenshotNode({ id, data, selected }: NodeProps) {
  return <BaseNode id={id} data={data as WorkflowNodeData} tone="action" selected={selected} />
}
