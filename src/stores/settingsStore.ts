import { create } from 'zustand'

type ThemeMode = 'light' | 'dark' | 'system'
type CoordinateMode = 'virtualScreen' | 'activeWindow'

interface SettingsState {
  theme: ThemeMode
  zoom: number
  coordinateMode: CoordinateMode
  setTheme: (theme: ThemeMode) => void
  setZoom: (zoom: number) => void
  setCoordinateMode: (mode: CoordinateMode) => void
}

const THEME_KEY = 'commandflow.theme'
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

const initialTheme = getSavedTheme()
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
  setTheme: (theme) => {
    localStorage.setItem(THEME_KEY, theme)
    applyTheme(theme)
    set(() => ({ theme }))
  },
  setZoom: (zoom) => set(() => ({ zoom })),
  setCoordinateMode: (coordinateMode) => set(() => ({ coordinateMode })),
}))
