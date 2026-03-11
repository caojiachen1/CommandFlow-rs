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

export interface InputRecordingOptionsPayload {
  recordKeyboard: boolean
  recordMouseClicks: boolean
  recordMouseMoves: boolean
}

export interface RecordedCursorPointPayload {
  x: number
  y: number
  timestampMs: number
}

export type InputRecordingActionPayload =
  | {
      kind: 'keyDown' | 'keyUp'
      key: string
      timestampMs: number
    }
  | {
      kind: 'mouseDown' | 'mouseUp'
      button: string
      x: number
      y: number
      timestampMs: number
    }
  | {
      kind: 'mouseMovePath'
      points: RecordedCursorPointPayload[]
      durationMs: number
      distancePx: number
      simplifiedFrom: number
      timestampMs: number
    }

export interface InputRecordingPresetPayload {
  id: string
  name: string
  options: InputRecordingOptionsPayload
  actions: InputRecordingActionPayload[]
  updatedAt: number
}

export interface InputRecordingStopResultPayload {
  message: string
  actions: InputRecordingActionPayload[]
  operationCount: number
  startedAtMs: number
  endedAtMs: number
  options: InputRecordingOptionsPayload
}

export interface StartMenuAppPayload {
  appName: string
  targetPath: string
  iconPath: string
  sourcePath: string
}

export interface OpenWindowEntryPayload {
  title: string
  programName: string
  programPath: string
  className: string
  processId: number
}

const isTauriRuntime = () => '__TAURI_INTERNALS__' in window
let startMenuAppsCache: StartMenuAppPayload[] | null = null
let startMenuAppsPromise: Promise<StartMenuAppPayload[]> | null = null
const startMenuIconCache = new Map<string, string | null>()
const startMenuIconPromises = new Map<string, Promise<string | null>>()

export const invalidateDynamicOptionCaches = () => {
  startMenuAppsCache = null
  startMenuAppsPromise = null
  startMenuIconCache.clear()
  startMenuIconPromises.clear()
}

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

export const listOpenWindowEntries = async (): Promise<OpenWindowEntryPayload[]> => {
  if (!isTauriRuntime()) {
    return []
  }
  return invoke<OpenWindowEntryPayload[]>('list_open_window_details')
}

export const listStartMenuApps = async (forceRefresh = false): Promise<StartMenuAppPayload[]> => {
  if (!isTauriRuntime()) {
    return []
  }

  if (!forceRefresh && startMenuAppsCache) {
    return startMenuAppsCache
  }

  if (!forceRefresh && startMenuAppsPromise) {
    return startMenuAppsPromise
  }

  startMenuAppsPromise = invoke<StartMenuAppPayload[]>('list_start_menu_apps')
    .then((apps) => {
      startMenuAppsCache = apps
      return apps
    })
    .finally(() => {
      startMenuAppsPromise = null
    })

  return startMenuAppsPromise
}

export const resolveStartMenuAppIcon = async (
  iconPath: string,
  targetPath: string,
  sourcePath?: string,
): Promise<string | null> => {
  const cacheKey = [iconPath, targetPath, sourcePath ?? ''].join('||')

  if (startMenuIconCache.has(cacheKey)) {
    return startMenuIconCache.get(cacheKey) ?? null
  }

  if (startMenuIconPromises.has(cacheKey)) {
    return startMenuIconPromises.get(cacheKey) ?? Promise.resolve(null)
  }

  if (!isTauriRuntime()) {
    return null
  }

  const promise = invoke<string | null>('resolve_start_menu_app_icon', {
    iconPath,
    targetPath,
    sourcePath: sourcePath ?? null,
  })
    .then((result) => {
      const normalized = result?.trim() ? result : null
      startMenuIconCache.set(cacheKey, normalized)
      return normalized
    })
    .catch(() => {
      startMenuIconCache.set(cacheKey, null)
      return null
    })
    .finally(() => {
      startMenuIconPromises.delete(cacheKey)
    })

  startMenuIconPromises.set(cacheKey, promise)
  return promise
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

export const getCursorPosition = async (): Promise<CoordinatePoint> => {
  if (!isTauriRuntime()) {
    return {
      x: 0,
      y: 0,
      isPhysicalPixel: false,
      mode: 'virtualScreen',
    }
  }

  const payload = await invoke<{
    x: number
    y: number
    is_physical_pixel: boolean
    mode: 'virtualScreen' | 'activeWindow'
  }>('get_cursor_position')

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

export const loadInputRecordingPresets = async (): Promise<InputRecordingPresetPayload[]> => {
  if (!isTauriRuntime()) {
    return []
  }
  return invoke<InputRecordingPresetPayload[]>('load_input_recording_presets')
}

export const saveInputRecordingPresets = async (presets: InputRecordingPresetPayload[]): Promise<void> => {
  if (!isTauriRuntime()) {
    return
  }
  await invoke('save_input_recording_presets', { presets })
}

export const startInputRecording = async (options: InputRecordingOptionsPayload): Promise<string> => {
  if (!isTauriRuntime()) {
    return '当前为浏览器预览模式，未连接 Tauri 后端，无法进行真实录制。'
  }
  return invoke<string>('start_input_recording', { options })
}

export const stopInputRecording = async (): Promise<InputRecordingStopResultPayload> => {
  if (!isTauriRuntime()) {
    return {
      message: '当前为浏览器预览模式，未连接 Tauri 后端。',
      actions: [],
      operationCount: 0,
      startedAtMs: Date.now(),
      endedAtMs: Date.now(),
      options: {
        recordKeyboard: true,
        recordMouseClicks: true,
        recordMouseMoves: true,
      },
    }
  }
  return invoke<InputRecordingStopResultPayload>('stop_input_recording')
}
