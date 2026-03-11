import { create } from 'zustand'
import {
  loadInputRecordingPresets,
  loadLlmPresets,
  saveInputRecordingPresets,
  saveLlmPresets,
  type InputRecordingActionPayload,
  type InputRecordingOptionsPayload,
  type InputRecordingPresetPayload,
} from '../utils/execution'

type ThemeMode = 'light' | 'dark' | 'system'
type CoordinateMode = 'virtualScreen' | 'activeWindow'

export interface LlmPreset {
  id: string
  name: string
  baseUrl: string
  apiKey: string
  model: string
}

export interface InputRecordingOptions {
  recordKeyboard: boolean
  recordMouseClicks: boolean
  recordMouseMoves: boolean
}

export type InputRecordingAction = InputRecordingActionPayload

export interface InputRecordingPreset {
  id: string
  name: string
  options: InputRecordingOptions
  actions: InputRecordingAction[]
  updatedAt: number
}

interface SettingsState {
  theme: ThemeMode
  zoom: number
  coordinateMode: CoordinateMode
  llmPresets: LlmPreset[]
  inputRecordingPresets: InputRecordingPreset[]
  loadLlmPresets: () => Promise<void>
  loadInputRecordingPresets: () => Promise<void>
  setTheme: (theme: ThemeMode) => void
  setZoom: (zoom: number) => void
  setCoordinateMode: (mode: CoordinateMode) => void
  addLlmPreset: (preset: Omit<LlmPreset, 'id'>) => string
  updateLlmPreset: (id: string, patch: Partial<Omit<LlmPreset, 'id'>>) => void
  deleteLlmPreset: (id: string) => void
  addInputRecordingPreset: (preset?: Partial<Omit<InputRecordingPreset, 'id' | 'updatedAt'>>) => string
  updateInputRecordingPreset: (id: string, patch: Partial<Omit<InputRecordingPreset, 'id'>>) => void
  deleteInputRecordingPreset: (id: string) => void
  saveRecordedActionsToPreset: (id: string, actions: InputRecordingAction[], options: InputRecordingOptions) => void
}

const THEME_KEY = 'commandflow.theme'
const LLM_PRESETS_KEY = 'commandflow.llmPresets'
const INPUT_RECORDING_PRESETS_KEY = 'commandflow.inputRecordingPresets'
const isTauriRuntime = () => '__TAURI_INTERNALS__' in window
const isDarkSystem = () => window.matchMedia('(prefers-color-scheme: dark)').matches

const applyTheme = (theme: ThemeMode) => {
  const dark = theme === 'dark' || (theme === 'system' && isDarkSystem())
  document.documentElement.classList.toggle('dark', dark)
}

const getSavedTheme = (): ThemeMode => {
  const value = localStorage.getItem(THEME_KEY)
  if (value === 'light' || value === 'dark' || value === 'system') {
    return value
  }
  return 'system'
}

const getDefaultPreset = (): LlmPreset => ({
  id: `preset-${Date.now()}`,
  name: '默认 OpenAI',
  baseUrl: 'https://api.openai.com',
  apiKey: '',
  model: 'gpt-5',
})

const getDefaultInputRecordingOptions = (): InputRecordingOptions => ({
  recordKeyboard: true,
  recordMouseClicks: true,
  recordMouseMoves: true,
})

const getDefaultInputRecordingPreset = (): InputRecordingPreset => ({
  id: `input-preset-${Date.now()}`,
  name: '默认键鼠预设',
  options: getDefaultInputRecordingOptions(),
  actions: [],
  updatedAt: Date.now(),
})

const sanitizePreset = (raw: unknown): LlmPreset | null => {
  if (!raw || typeof raw !== 'object') return null
  const value = raw as Partial<LlmPreset>
  const id = typeof value.id === 'string' && value.id.trim() ? value.id.trim() : `preset-${Date.now()}`
  const name = typeof value.name === 'string' && value.name.trim() ? value.name.trim() : '未命名预设'
  const baseUrl = typeof value.baseUrl === 'string' ? value.baseUrl.trim() : ''
  const apiKey = typeof value.apiKey === 'string' ? value.apiKey : ''
  const model = typeof value.model === 'string' && value.model.trim() ? value.model.trim() : 'gpt-5'
  return { id, name, baseUrl, apiKey, model }
}

const sanitizeInputRecordingOptions = (raw: unknown): InputRecordingOptions => {
  const value = raw as Partial<InputRecordingOptionsPayload> | null | undefined
  return {
    recordKeyboard: value?.recordKeyboard !== false,
    recordMouseClicks: value?.recordMouseClicks !== false,
    recordMouseMoves: value?.recordMouseMoves !== false,
  }
}

const sanitizeInputRecordingPreset = (raw: unknown): InputRecordingPreset | null => {
  if (!raw || typeof raw !== 'object') return null
  const value = raw as Partial<InputRecordingPresetPayload>
  const id = typeof value.id === 'string' && value.id.trim() ? value.id.trim() : `input-preset-${Date.now()}`
  const name = typeof value.name === 'string' && value.name.trim() ? value.name.trim() : '未命名键鼠预设'
  const updatedAt = typeof value.updatedAt === 'number' && Number.isFinite(value.updatedAt) ? value.updatedAt : Date.now()
  const actions = Array.isArray(value.actions) ? value.actions : []
  return {
    id,
    name,
    updatedAt,
    options: sanitizeInputRecordingOptions(value.options),
    actions,
  }
}

const getSavedLlmPresets = (allowPersist = true): LlmPreset[] => {
  const raw = localStorage.getItem(LLM_PRESETS_KEY)
  if (!raw) {
    const defaults = [getDefaultPreset()]
    if (allowPersist) {
      localStorage.setItem(LLM_PRESETS_KEY, JSON.stringify(defaults))
    }
    return defaults
  }

  try {
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) throw new Error('invalid')
    const list = parsed.map(sanitizePreset).filter((item): item is LlmPreset => Boolean(item))
    if (list.length > 0) {
      return list
    }
  } catch {
    // ignore and fallback
  }

  const fallback = [getDefaultPreset()]
  if (allowPersist) {
    localStorage.setItem(LLM_PRESETS_KEY, JSON.stringify(fallback))
  }
  return fallback
}

const getSavedInputRecordingPresets = (allowPersist = true): InputRecordingPreset[] => {
  const raw = localStorage.getItem(INPUT_RECORDING_PRESETS_KEY)
  if (!raw) {
    const defaults = [getDefaultInputRecordingPreset()]
    if (allowPersist) {
      localStorage.setItem(INPUT_RECORDING_PRESETS_KEY, JSON.stringify(defaults))
    }
    return defaults
  }

  try {
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) throw new Error('invalid')
    const list = parsed.map(sanitizeInputRecordingPreset).filter((item): item is InputRecordingPreset => Boolean(item))
    if (list.length > 0) {
      return list
    }
  } catch {
    // ignore and fallback
  }

  const fallback = [getDefaultInputRecordingPreset()]
  if (allowPersist) {
    localStorage.setItem(INPUT_RECORDING_PRESETS_KEY, JSON.stringify(fallback))
  }
  return fallback
}

const persistLlmPresets = (presets: LlmPreset[]) => {
  if (!isTauriRuntime()) {
    localStorage.setItem(LLM_PRESETS_KEY, JSON.stringify(presets))
    return
  }

  void saveLlmPresets(presets).catch((error) => {
    console.error('保存 LLM 预设到安全存储失败：', error)
  })
}

const persistInputRecordingPresets = (presets: InputRecordingPreset[]) => {
  if (!isTauriRuntime()) {
    localStorage.setItem(INPUT_RECORDING_PRESETS_KEY, JSON.stringify(presets))
    return
  }

  void saveInputRecordingPresets(presets).catch((error) => {
    console.error('保存键鼠录制预设失败：', error)
  })
}

const initialTheme = getSavedTheme()
const initialLlmPresets = getSavedLlmPresets(!isTauriRuntime())
const initialInputRecordingPresets = getSavedInputRecordingPresets(!isTauriRuntime())
applyTheme(initialTheme)

window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
  const current = localStorage.getItem(THEME_KEY)
  if (current === 'system' || current === null) {
    applyTheme('system')
  }
})

export const useSettingsStore = create<SettingsState>((set) => ({
  theme: initialTheme,
  zoom: 1,
  coordinateMode: 'virtualScreen',
  llmPresets: initialLlmPresets,
  inputRecordingPresets: initialInputRecordingPresets,
  loadLlmPresets: async () => {
    if (!isTauriRuntime()) {
      const fallback = getSavedLlmPresets()
      set(() => ({ llmPresets: fallback }))
      return
    }

    const fallback = getSavedLlmPresets(false)

    try {
      const securePresets = (await loadLlmPresets()).map(sanitizePreset).filter((item): item is LlmPreset => Boolean(item))
      const llmPresets = securePresets.length > 0 ? securePresets : fallback

      set(() => ({ llmPresets }))

      if (securePresets.length === 0 && fallback.length > 0) {
        await saveLlmPresets(fallback)
      }

      localStorage.removeItem(LLM_PRESETS_KEY)
    } catch (error) {
      console.error('加载安全 LLM 预设失败，回退到本地存储：', error)
      set(() => ({ llmPresets: fallback }))
    }
  },
  loadInputRecordingPresets: async () => {
    if (!isTauriRuntime()) {
      const fallback = getSavedInputRecordingPresets()
      set(() => ({ inputRecordingPresets: fallback }))
      return
    }

    const fallback = getSavedInputRecordingPresets(false)

    try {
      const securePresets = (await loadInputRecordingPresets())
        .map(sanitizeInputRecordingPreset)
        .filter((item): item is InputRecordingPreset => Boolean(item))
      const inputRecordingPresets = securePresets.length > 0 ? securePresets : fallback

      set(() => ({ inputRecordingPresets }))

      if (securePresets.length === 0 && fallback.length > 0) {
        await saveInputRecordingPresets(fallback)
      }

      localStorage.removeItem(INPUT_RECORDING_PRESETS_KEY)
    } catch (error) {
      console.error('加载安全键鼠预设失败，回退到本地存储：', error)
      set(() => ({ inputRecordingPresets: fallback }))
    }
  },
  setTheme: (theme) => {
    localStorage.setItem(THEME_KEY, theme)
    applyTheme(theme)
    set(() => ({ theme }))
  },
  setZoom: (zoom) =>
    set((state) => {
      if (state.zoom === zoom) return state
      return { zoom }
    }),
  setCoordinateMode: (coordinateMode) =>
    set((state) => {
      if (state.coordinateMode === coordinateMode) return state
      return { coordinateMode }
    }),
  addLlmPreset: (preset) => {
    const id = `preset-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`
    const nextPreset: LlmPreset = {
      id,
      name: preset.name.trim() || '未命名预设',
      baseUrl: preset.baseUrl.trim(),
      apiKey: preset.apiKey,
      model: preset.model.trim() || 'gpt-5',
    }
    set((state) => {
      const llmPresets = [...state.llmPresets, nextPreset]
      persistLlmPresets(llmPresets)
      return { llmPresets }
    })
    return id
  },
  updateLlmPreset: (id, patch) =>
    set((state) => {
      const llmPresets = state.llmPresets.map((item) =>
        item.id === id
          ? {
              ...item,
              ...patch,
              name: (patch.name ?? item.name).trim() || '未命名预设',
              baseUrl: (patch.baseUrl ?? item.baseUrl).trim(),
              model: (patch.model ?? item.model).trim() || 'gpt-5',
              apiKey: patch.apiKey ?? item.apiKey,
            }
          : item,
      )
      persistLlmPresets(llmPresets)
      return { llmPresets }
    }),
  deleteLlmPreset: (id) =>
    set((state) => {
      const remained = state.llmPresets.filter((item) => item.id !== id)
      const llmPresets = remained.length > 0 ? remained : [getDefaultPreset()]
      persistLlmPresets(llmPresets)
      return { llmPresets }
    }),
  addInputRecordingPreset: (preset) => {
    const id = `input-preset-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`
    const nextPreset: InputRecordingPreset = {
      id,
      name: preset?.name?.trim() || `新键鼠预设 ${Date.now()}`,
      options: sanitizeInputRecordingOptions(preset?.options),
      actions: Array.isArray(preset?.actions) ? preset.actions : [],
      updatedAt: Date.now(),
    }
    set((state) => {
      const inputRecordingPresets = [...state.inputRecordingPresets, nextPreset]
      persistInputRecordingPresets(inputRecordingPresets)
      return { inputRecordingPresets }
    })
    return id
  },
  updateInputRecordingPreset: (id, patch) =>
    set((state) => {
      const inputRecordingPresets = state.inputRecordingPresets.map((item) =>
        item.id === id
          ? {
              ...item,
              ...patch,
              name: (patch.name ?? item.name).trim() || '未命名键鼠预设',
              options: patch.options ? sanitizeInputRecordingOptions(patch.options) : item.options,
              actions: Array.isArray(patch.actions) ? patch.actions : item.actions,
              updatedAt: patch.updatedAt ?? Date.now(),
            }
          : item,
      )
      persistInputRecordingPresets(inputRecordingPresets)
      return { inputRecordingPresets }
    }),
  deleteInputRecordingPreset: (id) =>
    set((state) => {
      const remained = state.inputRecordingPresets.filter((item) => item.id !== id)
      const inputRecordingPresets = remained.length > 0 ? remained : [getDefaultInputRecordingPreset()]
      persistInputRecordingPresets(inputRecordingPresets)
      return { inputRecordingPresets }
    }),
  saveRecordedActionsToPreset: (id, actions, options) =>
    set((state) => {
      const inputRecordingPresets = state.inputRecordingPresets.map((item) =>
        item.id === id
          ? {
              ...item,
              actions,
              options: sanitizeInputRecordingOptions(options),
              updatedAt: Date.now(),
            }
          : item,
      )
      persistInputRecordingPresets(inputRecordingPresets)
      return { inputRecordingPresets }
    }),
}))
