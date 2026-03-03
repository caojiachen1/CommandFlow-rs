import { create } from 'zustand'

type ThemeMode = 'light' | 'dark' | 'system'
type CoordinateMode = 'virtualScreen' | 'activeWindow'

export interface LlmPreset {
  id: string
  name: string
  baseUrl: string
  apiKey: string
  model: string
}

interface SettingsState {
  theme: ThemeMode
  zoom: number
  coordinateMode: CoordinateMode
  llmPresets: LlmPreset[]
  setTheme: (theme: ThemeMode) => void
  setZoom: (zoom: number) => void
  setCoordinateMode: (mode: CoordinateMode) => void
  addLlmPreset: (preset: Omit<LlmPreset, 'id'>) => string
  updateLlmPreset: (id: string, patch: Partial<Omit<LlmPreset, 'id'>>) => void
  deleteLlmPreset: (id: string) => void
}

const THEME_KEY = 'commandflow.theme'
const LLM_PRESETS_KEY = 'commandflow.llmPresets'
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

const getSavedLlmPresets = (): LlmPreset[] => {
  const raw = localStorage.getItem(LLM_PRESETS_KEY)
  if (!raw) {
    const defaults = [getDefaultPreset()]
    localStorage.setItem(LLM_PRESETS_KEY, JSON.stringify(defaults))
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
  localStorage.setItem(LLM_PRESETS_KEY, JSON.stringify(fallback))
  return fallback
}

const persistLlmPresets = (presets: LlmPreset[]) => {
  localStorage.setItem(LLM_PRESETS_KEY, JSON.stringify(presets))
}

const initialTheme = getSavedTheme()
const initialLlmPresets = getSavedLlmPresets()
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
}))
