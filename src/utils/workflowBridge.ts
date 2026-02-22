import type { WorkflowFile } from '../types/workflow'

interface BackendWorkflowNode {
  id: string
  label: string
  kind: string
  position_x: number
  position_y: number
  params: Record<string, unknown>
}

interface BackendWorkflowEdge {
  id: string
  source: string
  target: string
  source_handle?: string | null
  target_handle?: string | null
}

export interface BackendWorkflowGraph {
  id: string
  name: string
  nodes: BackendWorkflowNode[]
  edges: BackendWorkflowEdge[]
}

export const toBackendGraph = (file: WorkflowFile): BackendWorkflowGraph => ({
  id: file.graph.id,
  name: file.graph.name,
  nodes: file.graph.nodes.map((node) => ({
    id: node.id,
    label: node.data.label,
    kind: node.data.kind,
    position_x: node.position.x,
    position_y: node.position.y,
    params: node.data.params,
  })),
  edges: file.graph.edges.map((edge) => ({
    id: edge.id,
    source: edge.source,
    target: edge.target,
    source_handle: edge.sourceHandle ?? null,
    target_handle: edge.targetHandle ?? null,
  })),
})
