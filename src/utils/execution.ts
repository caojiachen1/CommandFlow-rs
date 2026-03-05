import { invoke } from '@tauri-apps/api/core'
import type { BackendWorkflowGraph } from './workflowBridge'
import type { CoordinatePoint } from '../types/workflow'

export interface LlmPresetPayload {
  id: string
  name: string
  baseUrl: string
  apiKey: string
  model: string
}

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

export const pickCoordinate = async (): Promise<CoordinatePoint> => {
  if (!isTauriRuntime()) {
    return {
      x: 0,
      y: 0,
      isPhysicalPixel: true,
      mode: 'virtualScreen',
    }
  }

  const payload = await invoke<{
    x: number
    y: number
    is_physical_pixel: boolean
    mode: 'virtualScreen' | 'activeWindow'
  }>('pick_coordinate')

  return {
    x: payload.x,
    y: payload.y,
    isPhysicalPixel: payload.is_physical_pixel,
    mode: payload.mode,
  }
}

export const fetchLlmModels = async (baseUrl: string, apiKey: string): Promise<string[]> => {
  if (!isTauriRuntime()) {
    return []
  }
  return invoke<string[]>('fetch_llm_models', { baseUrl, apiKey })
}

export const playCompletionBeep = async (): Promise<void> => {
  if (!isTauriRuntime()) {
    return
  }
  await invoke<string>('play_completion_beep')
}

export const loadLlmPresets = async (): Promise<LlmPresetPayload[]> => {
  if (!isTauriRuntime()) {
    return []
  }
  return invoke<LlmPresetPayload[]>('load_llm_presets')
}

export const saveLlmPresets = async (presets: LlmPresetPayload[]): Promise<void> => {
  if (!isTauriRuntime()) {
    return
  }
  await invoke('save_llm_presets', { presets })
}
