import { invoke } from '@tauri-apps/api/core'
import type { BackendWorkflowGraph } from './workflowBridge'

const isTauriRuntime = () => '__TAURI_INTERNALS__' in window

export const runWorkflow = async (graph: BackendWorkflowGraph): Promise<string> => {
  if (!isTauriRuntime()) {
    return '当前为浏览器预览模式，未连接 Tauri 后端，已跳过真实执行。'
  }
  return invoke<string>('run_workflow', { graph })
}

export const stopWorkflow = async (): Promise<string> => {
  if (!isTauriRuntime()) {
    return '当前为浏览器预览模式，未连接 Tauri 后端。'
  }
  return invoke<string>('stop_workflow')
}

export const listOpenWindows = async (): Promise<string[]> => {
  if (!isTauriRuntime()) {
    return []
  }
  return invoke<string[]>('list_open_windows')
}

export const setBackgroundMode = async (enabled: boolean): Promise<string> => {
  if (!isTauriRuntime()) {
    return enabled ? '浏览器模式：已切换到紧凑视图。' : '浏览器模式：已恢复标准视图。'
  }
  return invoke<string>('set_background_mode', { enabled })
}
